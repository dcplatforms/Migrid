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
 * Helper to fetch high-fidelity metadata from Redis
 */
async function getHighFidelityMetadata() {
    const safetyContextRaw = await redis.get('l1:safety:lock:context');
    let physicsScore = 1.0;
    let confidenceScore = 1.0;
    let isHighFidelity = true;
    let isSentinelFidelity = true;
    let fidelityStatus = 'HIGH_FIDELITY';

    if (safetyContextRaw) {
        try {
            const context = JSON.parse(safetyContextRaw);
            physicsScore = context.physics_score !== undefined ? parseFloat(context.physics_score) : 1.0;
            confidenceScore = context.confidence_score !== undefined ? parseFloat(context.confidence_score) : 1.0;

            // [L1-124] April 2026 High-Fidelity Standard: Physics OR Confidence > 0.95
            isHighFidelity = (physicsScore > 0.95 || confidenceScore > 0.95);
            isSentinelFidelity = (physicsScore > 0.99);
            fidelityStatus = isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD';
        } catch (e) {
            console.error('[L7] Failed to parse safety context:', e.message);
        }
    }
    return { physicsScore, confidenceScore, isHighFidelity, isSentinelFidelity, fidelityStatus };
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
    const hf = await getHighFidelityMetadata();

    // Fetch Resource Type (EV/BESS) and Site ID from Redis cache (populated at connection/session start)
    // Core Principle: Absolute fidelity and ZERO latency in the telemetry hot path.
    const resourceType = await redis.get(`charger_resource:${chargePointId}`) || 'EV';
    const siteId = await redis.get(`charger_site:${chargePointId}`);

    // 2. Standardized Output: Broadcast a unified schema to Kafka
    event = {
        chargePointId,
        site_id: siteId,
        timestamp: payload.timestamp || new Date().toISOString(),
        energyActiveImport: importEnergy,
        energyActiveExport: exportEnergy,
        powerActiveImport: importPower,
        powerActiveExport: exportPower,
        protocol: protocol,
        iso_region: isoRegion,
        physics_score: hf.physicsScore,
        confidence_score: hf.confidenceScore,
        is_high_fidelity: hf.isHighFidelity,
        is_sentinel_fidelity: hf.isSentinelFidelity,
        fidelity_status: hf.fidelityStatus,
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
    const siteId = payload.site_id || (chargePointId ? await redis.get(`charger_site:${chargePointId}`) : null);

    const enrichedPayload = {
        ...payload,
        iso_region: isoRegion,
        site_id: siteId
    };

    // For auditing and high-fidelity verification (L11 ML readiness)
    if (type === 'SESSION_COMPLETED') {
        const hf = await getHighFidelityMetadata();
        Object.assign(enrichedPayload, {
            physics_score: hf.physicsScore,
            confidence_score: hf.confidenceScore,
            is_high_fidelity: hf.isHighFidelity,
            is_sentinel_fidelity: hf.isSentinelFidelity,
            fidelity_status: hf.fidelityStatus
        });
    }

    await producer.send({
        topic: type, // e.g., SESSION_COMPLETED
        messages: [{ value: JSON.stringify(enrichedPayload) }]
    });

    // Also publish to a generic charging_events topic for L6/L10 consumption if it's a completion
    if (type === 'SESSION_COMPLETED' || type === 'CHARGER_STATUS_UPDATED') {
        await producer.send({
            topic: 'charging_events',
            messages: [{ value: JSON.stringify({ ...enrichedPayload, type: type }) }]
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
