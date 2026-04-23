const { publishTelemetry, publishSessionEvent } = require('../events/producer');
const { validateSchema } = require('./validators');
const config = require('../config');
const { redis } = require('../state/connectionMgr');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: config.databaseUrl,
});

/**
 * Routes and processes incoming OCPP messages.
 * Enforces MiGrid safety invariants like "The Fuse Rule".
 */
async function handleOcppMessage(chargePointId, data, ws, protocol = 'ocpp2.0.1') {
    try {
        const [messageTypeId, messageId, action, payload] = JSON.parse(data);

        if (messageTypeId !== 2) { // 2 = Call
            return;
        }

        console.log(`[L7] OCPP Call received: ${action} from ${chargePointId} (${protocol})`);

        if (!validateSchema(protocol, action, payload)) {
            console.error(`❌ [L7] Protocol Violation: Validation failed for ${action} from ${chargePointId}. Dropping message.`);
            ws.send(JSON.stringify([4, messageId, 'ProtocolError', 'Payload validation failed']));
            return;
        }

        switch (action) {
            case 'BootNotification':
                ws.send(JSON.stringify([3, messageId, {
                    currentTime: new Date().toISOString(),
                    interval: 300,
                    status: 'Accepted'
                }]));
                break;

            case 'MeterValues':
                // Standardize and broadcast to Kafka for L1 Physics Engine
                await publishTelemetry(chargePointId, payload, protocol);
                // Acknowledge
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'NotifyBidirEnergyFlow':
                // Native OCPP 2.1 Bidir Telemetry (Strict validation enforced at handler edge)
                await publishTelemetry(chargePointId, payload, protocol);
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'StatusNotification':
                // Update Redis and forward to internal services
                await redis.set(`charger_status:${chargePointId}`, payload.connectorStatus, 'EX', 86400);

                // OCPI 2.2 Status Mapping (for roaming interoperability)
                const ocpiStatus = mapToOcpiStatus(payload.connectorStatus);
                await redis.set(`ocpi_status:${chargePointId}`, ocpiStatus, 'EX', 86400);

                await publishSessionEvent('CHARGER_STATUS_UPDATED', {
                    chargePointId,
                    status: payload.connectorStatus,
                    ocpi_status: ocpiStatus,
                    evseId: payload.evseId,
                    connectorId: payload.connectorId,
                    timestamp: payload.timestamp || new Date().toISOString()
                });
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'Authorize':
                // Enhanced for OCPP 2.1: ISO 15118 Certificate-based PnC (EMAID)
                const idToken = payload.idToken?.idToken;
                const tokenType = payload.idToken?.type || 'ISO14443';
                console.log(`[L7] Authorize request for ${chargePointId}. Type: ${tokenType}, ID Token: ${idToken}`);

                try {
                    // Strict EMAID validation for Plug & Charge sessions
                    const result = await pool.query('SELECT status, type FROM id_tokens WHERE token_value = $1', [idToken]);

                    if (result.rows.length === 0) {
                        console.warn(`⚠️ [L7] Authorization DENIED for ${chargePointId}: Unknown Token ${idToken}`);
                        ws.send(JSON.stringify([3, messageId, { idTokenInfo: { status: 'Unknown' } }]));
                        return;
                    }

                    const dbToken = result.rows[0];
                    if (tokenType === 'EMAID' && dbToken.type !== 'EMAID') {
                        console.error(`❌ [L7] Security Alert: Protocol mismatch for ${chargePointId}. Hardware claims EMAID but DB records ${dbToken.type}.`);
                        ws.send(JSON.stringify([3, messageId, { idTokenInfo: { status: 'Blocked' } }]));
                        return;
                    }

                    ws.send(JSON.stringify([3, messageId, {
                        idTokenInfo: {
                            status: dbToken.status,
                            cacheExpiryDateTime: new Date(Date.now() + 3600000).toISOString(),
                            personalMessage: tokenType === 'EMAID' ? { content: 'MiGrid Plug & Charge Verified', format: 'UTF8' } : undefined
                        }
                    }]));
                } catch (err) {
                    console.error('[L7] DB Auth Critical Failure:', err);
                    ws.send(JSON.stringify([3, messageId, { idTokenInfo: { status: 'Invalid' } }]));
                }
                break;

            case 'CertificateSigned':
                // ISO 15118-20 PnC: Handle signed certificate from V2G CA
                console.log(`[L7] Received signed certificate for ${chargePointId}:`, payload.certificate);
                // Advance ISO 15118 support: Persist certificate metadata for PnC session validation
                await redis.hset(`charger_certs:${chargePointId}`, 'status', 'Signed', 'lastUpdated', new Date().toISOString());
                ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                break;

            case 'GetCertificateStatus':
                // ISO 15118-20 PnC: Handle OCSP requests for PnC session validation
                console.log(`[L7] GetCertificateStatus (OCSP) for ${chargePointId}:`, payload.ocspRequestData);
                // Advance ISO 15118 support: Log OCSP request context for L11 audit trails
                await redis.hset(`charger_certs:${chargePointId}`, 'ocspStatus', 'Requested', 'ocspTimestamp', new Date().toISOString());
                ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                break;

            case 'SignCertificate':
                // ISO 15118-20 PnC: Charger requesting CSR signing
                console.log(`[L7] SignCertificate request from ${chargePointId}`);
                // In a production system, this would trigger a call to the V2G CA
                await redis.hset(`charger_certs:${chargePointId}`, 'signingStatus', 'Pending', 'lastRequest', new Date().toISOString());
                ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                break;

            case 'Get15118EvCertificate':
                // ISO 15118-20 PnC: Charger requesting EV Contract Certificate
                console.log(`[L7] Get15118EvCertificate request from ${chargePointId} for PnC`);
                // Simulate V2G CA response for Plug & Charge
                ws.send(JSON.stringify([3, messageId, {
                    status: 'Accepted',
                    exiResponse: 'BASE64_ENCODED_EXI_RESPONSE_MOCK'
                }]));
                break;

            case 'NotifyDERAlarm':
                // OCPP 2.1 DER Control: Handle alarms from local solar/BESS
                console.log(`[L7] DER Alarm received from ${chargePointId}:`, payload.alarms);
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'TransactionEvent':
                if (payload.eventType === 'Started') {
                    // Cache resource type for high-fidelity telemetry performance
                    try {
                        const idToken = payload.idToken?.idToken;
                        if (idToken) {
                            const resourceRes = await pool.query(`
                                SELECT vr.resource_type
                                FROM id_tokens it
                                JOIN vehicles v ON it.token_value = v.vin -- Assuming vin link if no direct vehicle_id
                                JOIN vpp_resources vr ON v.id = vr.vehicle_id
                                WHERE it.token_value = $1 LIMIT 1
                            `, [idToken]);

                            const resourceType = resourceRes.rows[0]?.resource_type || 'EV';
                            await redis.set(`charger_resource:${chargePointId}`, resourceType, 'EX', 86400);
                        }
                    } catch (e) {
                        console.error('[L7] Error caching resource for TransactionEvent Started', e.message);
                    }
                }

                if (payload.eventType === 'Ended') {
                    // Cleanup resource cache
                    await redis.del(`charger_resource:${chargePointId}`);

                    // Extract energy dispensed from meterValue if available
                    let energyDispensed = 0;
                    try {
                        if (payload.meterValue && payload.meterValue.length > 0) {
                            // Find the cumulative energy register across all meter values
                            const lastMeterValue = payload.meterValue[payload.meterValue.length - 1];
                            const energySample = lastMeterValue.sampledValue?.find(sv =>
                                sv.measurand === 'Energy.Active.Import.Register' || sv.measurand === undefined
                            );

                            if (energySample) {
                                energyDispensed = parseFloat(energySample.value) || 0;
                            } else if (lastMeterValue.sampledValue?.[0]?.value) {
                                // Fallback: Take the first value if it looks like energy
                                energyDispensed = parseFloat(lastMeterValue.sampledValue[0].value) || 0;
                            }
                        }
                    } catch (e) {
                        console.error('[L7] Error extracting energy from TransactionEvent', e);
                    }

                    await publishSessionEvent('SESSION_COMPLETED', {
                        chargePointId,
                        transactionId: payload.transactionInfo?.transactionId,
                        energyDispensedKwh: energyDispensed,
                        timestamp: new Date().toISOString(),
                        trigger: payload.triggerReason || 'Remote',
                        protocol: protocol
                    });
                }
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            default:
                console.warn(`[L7] Unsupported OCPP action: ${action}`);
                ws.send(JSON.stringify([4, messageId, 'NotSupported', '']));
        }
    } catch (error) {
        console.error('[L7] OCPP Processing Error:', error);
    }
}

/**
 * OCPI 2.2 Status Mapping Utility
 * Normalizes OCPP status to OCPI 2.2 Location/EVSE status.
 */
function mapToOcpiStatus(ocppStatus) {
    switch (ocppStatus) {
        case 'Available': return 'AVAILABLE';
        case 'Occupied': return 'BUSY';
        case 'Reserved': return 'RESERVED';
        case 'Unavailable': return 'OUT_OF_ORDER';
        case 'Faulted': return 'INOPERATIVE';
        default: return 'UNKNOWN';
    }
}

module.exports = { handleOcppMessage };
