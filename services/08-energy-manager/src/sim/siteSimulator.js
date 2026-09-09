const Redis = require('ioredis');
const { updateBuildingLoad } = require('../state/topologyMgr');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
});

const HISTORY_KEY = (siteId) => `site:${siteId}:load_history`;
const CONNECTORS_KEY = (siteId) => `site:${siteId}:connectors`;
const MAX_HISTORY = 24;

/**
 * Baseline connector fleet for the demo depot. In production these values are
 * driven by OCPP MeterValues from L7; here the site meter/simulator keeps them
 * evolving so the DLM engine and dashboard have live telemetry to work with.
 */
const baseConnectors = [
    { id: 'DEPOT-A · CP-01', vehicle: 'Van #4102', status: 'Charging', base: 48 },
    { id: 'DEPOT-A · CP-02', vehicle: 'Van #4088', status: 'Charging', base: 22 },
    { id: 'DEPOT-A · CP-03', vehicle: 'V2G export', status: 'Discharging', base: -19 },
    { id: 'DEPOT-B · CP-07', vehicle: 'Idle · plug free', status: 'Available', base: 0 },
    { id: 'DEPOT-B · CP-09', vehicle: 'Fault · overtemp', status: 'Faulted', base: 0 },
];

const jitter = (value, amount) => value + (Math.random() * 2 - 1) * amount;

let buildingLoad = 72;

function buildConnectors() {
    return baseConnectors.map((c) => {
        let kw = 0;
        if (c.status === 'Charging') kw = Math.max(6, jitter(c.base, 4));
        else if (c.status === 'Discharging') kw = Math.min(-5, jitter(c.base, 3));
        return {
            id: c.id,
            vehicle: c.vehicle,
            status: c.status,
            kw: Number(kw.toFixed(1)),
        };
    });
}

async function tick(siteId, timestamp = new Date()) {
    buildingLoad = Math.min(90, Math.max(58, jitter(buildingLoad, 3)));
    await updateBuildingLoad(siteId, Number(buildingLoad.toFixed(2)));

    const connectors = buildConnectors();
    await redis.set(CONNECTORS_KEY(siteId), JSON.stringify(connectors));

    const evLoad = connectors.reduce((sum, c) => sum + c.kw, 0);
    const totalLoadKw = Number((buildingLoad + evLoad).toFixed(1));

    await redis.rpush(
        HISTORY_KEY(siteId),
        JSON.stringify({ t: timestamp.toISOString(), totalLoadKw })
    );
    await redis.ltrim(HISTORY_KEY(siteId), -MAX_HISTORY, -1);
}

/**
 * Backfill the history ring buffer with spaced samples so the chart renders a
 * full window immediately on first load, then advance every intervalMs.
 */
async function startSiteSimulator(siteId, intervalMs = 5000) {
    const now = Date.now();
    for (let i = MAX_HISTORY - 1; i >= 0; i--) {
        await tick(siteId, new Date(now - i * intervalMs));
    }
    console.log(`[L8 Sim] Site telemetry simulator started for ${siteId} (interval ${intervalMs}ms)`);
    return setInterval(
        () => tick(siteId).catch((e) => console.error('[L8 Sim] tick error:', e.message)),
        intervalMs
    );
}

module.exports = { startSiteSimulator };
