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
    const rawRegion = await redis.get(`charger_region:${chargePointId}`) || 'CAISO';
    const isoRegion = rawRegion.toUpperCase().replace(/-/g, '');

    // 1. Hardware Agnostic Normalization: Extract universal values regardless of source protocol
    const importEnergy = protocol === 'ocpp2.1' && payload.bidirEnergyFlowData
        ? extractBidirValue(payload.bidirEnergyFlowData, 'Energy.Active.Import.Register')
        : extractMeterValue(payload, 'Energy.Active.Import.Register');

    const exportEnergy = protocol === 'ocpp2.1' && payload.bidirEnergyFlowData
        ? extractBidirValue(payload.bidirEnergyFlowData, 'Energy.Active.Export.Register')
        : extractMeterValue(payload, 'Energy.Active.Export.Register');

    const importPower = protocol === 'ocpp2.1' && payload.bidirEnergyFlowData
        ? extractBidirValue(payload.bidirEnergyFlowData, 'Power.Active.Import')
        : extractMeterValue(payload, 'Power.Active.Import');

    const exportPower = protocol === 'ocpp2.1' && payload.bidirEnergyFlowData
        ? extractBidirValue(payload.bidirEnergyFlowData, 'Power.Active.Export')
        : extractMeterValue(payload, 'Power.Active.Export');

    // Physics Engine Contextual Data for L11 AI Readiness
    const safetyContextRaw = await redis.get('l1:safety:lock:context');
    let physicsScore = 1.0;
    let fidelityStatus = 'HIGH_FIDELITY';
    let isHighFidelity = true;

    if (safetyContextRaw) {
        try {
            const context = JSON.parse(safetyContextRaw);
            if (context.physics_score !== undefined) {
                physicsScore = parseFloat(context.physics_score);
                isHighFidelity = physicsScore > 0.95;
                fidelityStatus = isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD';
            }
        } catch (e) {
            console.error('[L7] Failed to parse safety context for telemetry:', e.message);
        }
    }

    // Fetch Resource Type (EV/BESS) from Redis cache (populated at session start)
    // Core Principle: Absolute fidelity and ZERO latency in the telemetry hot path.
    const resourceType = await redis.get(`charger_resource:${chargePointId}`) || 'EV';

    // 2. Standardized Output: Broadcast a unified schema to Kafka
    event = {
        chargePointId,
        timestamp: payload.timestamp || new Date().toISOString(),
        energyActiveImport: importEnergy,
        energyActiveExport: exportEnergy,
        powerActiveImport: importPower,
        powerActiveExport: exportPower,
        protocol: protocol,
        iso_region: isoRegion,
        physics_score: physicsScore,
        is_high_fidelity: isHighFidelity,
        fidelity_status: fidelityStatus,
        resource_type: resourceType,
        source: 'L7_GATEWAY_V5.6.0'
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
    const chargePointId = payload.chargePointId || payload.evseId;
    const rawRegion = payload.iso_region || (chargePointId ? await redis.get(`charger_region:${chargePointId}`) : 'CAISO') || 'CAISO';
    const isoRegion = rawRegion.toUpperCase().replace(/-/g, '');

    const enrichedPayload = {
        ...payload,
        iso_region: isoRegion
    };

    await producer.send({
        topic: type, // e.g., SESSION_COMPLETED
        messages: [{ value: JSON.stringify(enrichedPayload) }]
    });

    // Also publish to a generic charging_events topic for L6/L10 consumption if it's a completion
    if (type === 'SESSION_COMPLETED' || type === 'CHARGER_STATUS_UPDATED') {
        await producer.send({
            topic: 'charging_events',
            messages: [{ value: JSON.stringify({ ...payload, type: type }) }]
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
