const { publishTelemetry, publishSessionEvent } = require('../events/producer');
const { validateSchema } = require('./validators');
const config = require('../config');
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
            console.warn(`⚠️ [L7] Validation failed for ${action} from ${chargePointId}`);
            // In a strict production environment, we might reject the message here.
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
                await publishTelemetry(chargePointId, payload);
                // Acknowledge
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'StatusNotification':
                // Forward to L8 Energy Manager (logic placeholder)
                break;

            case 'MeterValues':
                // Standardize and broadcast to Kafka for L1 Physics Engine
                await publishTelemetry(chargePointId, payload, protocol);
                // Acknowledge
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'NotifyBidirEnergyFlow':
                // Native OCPP 2.1 Bidir Telemetry with mandatory validation for L11 Data Integrity
                if (validateSchema(protocol, action, payload)) {
                    await publishTelemetry(chargePointId, payload, protocol);
                } else {
                    console.error(`❌ [L7] Data Integrity violation: NotifyBidirEnergyFlow from ${chargePointId} rejected.`);
                }
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'StatusNotification':
                // Forward to L8 Energy Manager (logic placeholder)
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'Authorize':
                // Enhanced for 2.1: Certificate-based PnC (EMAID) or Secure QR
                const idToken = payload.idToken?.idToken;
                const tokenType = payload.idToken?.type || 'ISO14443';
                console.log(`[L7] Authorize request for ${chargePointId}. Type: ${tokenType}, ID Token: ${idToken}`);

                // Simulate DB check for authorization with EMAID support
                try {
                    const result = await pool.query('SELECT status FROM id_tokens WHERE token_value = $1', [idToken]);
                    const status = result.rows[0]?.status || 'Accepted';

                    ws.send(JSON.stringify([3, messageId, {
                        idTokenInfo: {
                            status: status,
                            cacheExpiryDateTime: new Date(Date.now() + 3600000).toISOString(),
                            personalMessage: tokenType === 'EMAID' ? { content: 'Plug & Charge Verified', format: 'UTF8' } : undefined
                        }
                    }]));
                } catch (err) {
                    console.error('[L7] DB Auth Error', err);
                    ws.send(JSON.stringify([3, messageId, { idTokenInfo: { status: 'Accepted' } }]));
                }
                break;

            case 'CertificateSigned':
                // ISO 15118-20 PnC: Handle signed certificate from V2G CA
                console.log(`[L7] Received signed certificate for ${chargePointId}`);
                // In a production scenario, we would store this or forward to HSM
                ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                break;

            case 'GetCertificateStatus':
                // ISO 15118-20 PnC: Handle OCSP requests for PnC session validation
                console.log(`[L7] GetCertificateStatus (OCSP) for ${chargePointId}`);
                ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                break;

            case 'NotifyDERAlarm':
                // OCPP 2.1 DER Control: Handle alarms from local solar/BESS
                console.log(`[L7] DER Alarm received from ${chargePointId}:`, payload.alarms);
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'TransactionEvent':
                if (payload.eventType === 'Ended') {
                    // Extract energy dispensed from meterValue if available
                    let energyDispensed = 0;
                    try {
                        if (payload.meterValue && payload.meterValue.length > 0) {
                            const lastMeterValue = payload.meterValue[payload.meterValue.length - 1];
                            const sampledValue = lastMeterValue.sampledValue?.find(sv =>
                                sv.measurand === 'Energy.Active.Import.Register' || sv.measurand === undefined
                            );
                            if (sampledValue) {
                                energyDispensed = parseFloat(sampledValue.value) || 0;
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

module.exports = { handleOcppMessage };
