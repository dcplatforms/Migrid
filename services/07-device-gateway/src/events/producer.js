const { Kafka } = require('kafkajs');
const config = require('../config');

const kafka = new Kafka({
    clientId: 'l7-device-gateway',
    brokers: config.kafkaBrokers
});

const producer = kafka.producer();

async function connectProducer() {
    try {
        await producer.connect();
        console.log('✅ [L7] Kafka Producer connected');
    } catch (error) {
        console.error('❌ [L7] Kafka Producer connection error:', error);
    }
}

/**
 * Normalizes raw OCPP data and broadcasts to internal MiGrid services.
 */
async function publishTelemetry(chargePointId, meterValuesPayload) {
    const event = {
        chargePointId,
        timestamp: new Date().toISOString(),
        // Normalize nested OCPP 2.0.1 payload into flat MiGrid schema
        energyActiveImport: extractMeterValue(meterValuesPayload, 'Energy.Active.Import.Register'),
        powerActiveImport: extractMeterValue(meterValuesPayload, 'Power.Active.Import')
    };

    await producer.send({
        topic: 'migrid.l1.telemetry',
        messages: [{
            key: chargePointId,
            value: JSON.stringify(event)
        }],
    });
}

/**
 * Helper to emit session events to L9 Commerce Engine
 */
async function publishSessionEvent(type, payload) {
    await producer.send({
        topic: type, // e.g., SESSION_COMPLETED
        messages: [{ value: JSON.stringify(payload) }]
    });
}

function extractMeterValue(payload, measurand) {
    // Logic to parse the complex OCPP 2.0.1 MeterValues array
    // Returns the normalized numeric value
    // This is a simplified implementation for Phase 5
    if (!payload || !payload.meterValue) return 0.0;

    for (const mv of payload.meterValue) {
        for (const rv of mv.sampledValue) {
            if (rv.measurand === measurand) {
                return parseFloat(rv.value);
            }
        }
    }
    return 0.0;
}

module.exports = { connectProducer, publishTelemetry, publishSessionEvent };
