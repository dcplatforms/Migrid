const { Kafka } = require('kafkajs');
const config = require('../config');
const { redis } = require('../state/connectionMgr');

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
 * Up-converts telemetry to standardized OCPP 2.1-style internal schema.
 */
async function publishTelemetry(chargePointId, payload, protocol = 'ocpp2.1') {
    let event;
    const isoRegion = await redis.get(`charger_region:${chargePointId}`) || 'CAISO';

    if (protocol === 'ocpp2.1' && payload.bidirEnergyFlowData) {
        // Native 2.1 NotifyBidirEnergyFlow
        event = {
            chargePointId,
            timestamp: payload.timestamp || new Date().toISOString(),
            energyActiveImport: extractBidirValue(payload.bidirEnergyFlowData, 'Energy.Active.Import.Register'),
            energyActiveExport: extractBidirValue(payload.bidirEnergyFlowData, 'Energy.Active.Export.Register'),
            powerActiveImport: extractBidirValue(payload.bidirEnergyFlowData, 'Power.Active.Import'),
            powerActiveExport: extractBidirValue(payload.bidirEnergyFlowData, 'Power.Active.Export'),
            protocol: 'ocpp2.1',
            iso_region: isoRegion
        };
    } else {
        // Up-convert legacy MeterValues to 2.1 schema
        const importEnergy = extractMeterValue(payload, 'Energy.Active.Import.Register');
        const importPower = extractMeterValue(payload, 'Power.Active.Import');
        const exportEnergy = extractMeterValue(payload, 'Energy.Active.Export.Register');
        const exportPower = extractMeterValue(payload, 'Power.Active.Export');

        event = {
            chargePointId,
            timestamp: new Date().toISOString(),
            energyActiveImport: importEnergy,
            energyActiveExport: exportEnergy,
            powerActiveImport: importPower,
            powerActiveExport: exportPower,
            protocol: 'ocpp2.0.1_upconverted',
            iso_region: isoRegion
        };
    }

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
    const chargePointId = payload.chargePointId || payload.evseId;
    const isoRegion = payload.iso_region || (chargePointId ? await redis.get(`charger_region:${chargePointId}`) : 'CAISO') || 'CAISO';

    const enrichedPayload = {
        ...payload,
        iso_region: isoRegion
    };

    await producer.send({
        topic: type, // e.g., SESSION_COMPLETED
        messages: [{ value: JSON.stringify(enrichedPayload) }]
    });

    // Also publish to a generic charging_events topic for L6/L10 consumption if it's a completion
    if (type === 'SESSION_COMPLETED') {
        await producer.send({
            topic: 'charging_events',
            messages: [{ value: JSON.stringify({ ...payload, type: 'SESSION_COMPLETED' }) }]
        });
    }
}

function extractMeterValue(payload, measurand) {
    if (!payload || !payload.meterValue) return 0.0;
    for (const mv of payload.meterValue) {
        for (const rv of mv.sampledValue) {
            if (rv.measurand === measurand || (measurand === 'Energy.Active.Import.Register' && rv.measurand === undefined)) {
                return parseFloat(rv.value);
            }
        }
    }
    return 0.0;
}

function extractBidirValue(bidirEnergyFlowData, measurand) {
    if (!bidirEnergyFlowData) return 0.0;
    const entry = bidirEnergyFlowData.find(d => d.measurand === measurand);
    return entry ? parseFloat(entry.value) : 0.0;
}

module.exports = { connectProducer, publishTelemetry, publishSessionEvent };
