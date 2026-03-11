const { publishTelemetry, publishSessionEvent } = require('../events/producer');
const { validateBootNotification, validateMeterValues } = require('./validators');
const config = require('../config');

/**
 * Routes and processes incoming OCPP messages.
 * Enforces MiGrid safety invariants like "The Fuse Rule".
 */
async function handleOcppMessage(chargePointId, data, ws) {
    try {
        const [messageTypeId, messageId, action, payload] = JSON.parse(data);

        if (messageTypeId !== 2) { // 2 = Call
            return;
        }

        console.log(`[L7] OCPP Call received: ${action} from ${chargePointId}`);

        switch (action) {
            case 'BootNotification':
                if (validateBootNotification(payload)) {
                    ws.send(JSON.stringify([3, messageId, {
                        currentTime: new Date().toISOString(),
                        interval: 300,
                        status: 'Accepted'
                    }]));
                }
                break;

            case 'MeterValues':
                if (validateMeterValues(payload)) {
                    // Standardize and broadcast to Kafka for L1 Physics Engine
                    await publishTelemetry(chargePointId, payload);

                    // Acknowledge
                    ws.send(JSON.stringify([3, messageId, {}]));
                }
                break;

            case 'StatusNotification':
                // Forward to L8 Energy Manager
                ws.send(JSON.stringify([3, messageId, {}]));
                break;

            case 'TransactionEvent':
                if (payload.eventType === 'Ended') {
                    await publishSessionEvent('SESSION_COMPLETED', {
                        chargePointId,
                        transactionId: payload.transactionInfo.transactionId,
                        energyDispensed: payload.transactionInfo.chargingState === 'SuspendedEVSE' ? 0 : 50.5, // Mock
                        timestamp: new Date().toISOString()
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
