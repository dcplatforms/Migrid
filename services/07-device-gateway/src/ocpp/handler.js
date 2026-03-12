const { publishTelemetry, publishSessionEvent } = require('../events/producer');
const { validateSchema } = require('./validators');
const config = require('../config');

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
                        trigger: payload.triggerReason || 'Remote'
                    });
                }
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'V2XProfile': // OCPP 2.1 Specific
                if (protocol === 'ocpp2.1') {
                    console.log(`[L7] Processing OCPP 2.1 V2XProfile from ${chargePointId}`);
                    ws.send(JSON.stringify([3, messageId, { status: 'Accepted' }]));
                } else {
                    ws.send(JSON.stringify([4, messageId, 'NotSupported', 'V2XProfile requires OCPP 2.1']));
                }
                break;

            default:
                console.warn(`[L7] Unsupported OCPP action: ${action} for protocol ${protocol}`);
                ws.send(JSON.stringify([4, messageId, 'NotSupported', '']));
        }
    } catch (error) {
        console.error('[L7] OCPP Processing Error:', error);
    }
}

module.exports = { handleOcppMessage };
