const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
});

const round1 = (n) => Number(Number(n).toFixed(1));

const statusTone = {
    Charging: 'success',
    Discharging: 'info',
    Available: 'neutral',
    Faulted: 'danger',
};

/**
 * Live site-energy snapshot assembled from the real-time state the DLM engine
 * and site meter maintain in Redis. This is what the Admin Portal's
 * "Live Site Energy" page consumes.
 */
async function getSiteEnergy(siteId) {
    const config = await redis.hgetall(`site:${siteId}:config`);
    const gridLimitKw = parseFloat(config.max_capacity_kw) || 250;

    const buildingLoadKw = parseFloat(await redis.get(`site:${siteId}:building_load_kw`)) || 0;

    const connRaw = await redis.get(`site:${siteId}:connectors`);
    const connectors = (connRaw ? JSON.parse(connRaw) : []).map((c) => ({
        ...c,
        tone: statusTone[c.status] || 'neutral',
    }));

    const evLoadKw = connectors.reduce((sum, c) => sum + (c.kw || 0), 0);
    const totalLoadKw = buildingLoadKw + evLoadKw;
    const availableKw = gridLimitKw - totalLoadKw;
    const utilizationPct = gridLimitKw > 0 ? Math.round((totalLoadKw / gridLimitKw) * 100) : 0;
    const safeMode = (await redis.get(`l8:site:${siteId}:safe_mode`)) === 'true';

    return {
        siteId,
        timestamp: new Date().toISOString(),
        gridLimitKw: round1(gridLimitKw),
        buildingLoadKw: round1(buildingLoadKw),
        evLoadKw: round1(evLoadKw),
        totalLoadKw: round1(totalLoadKw),
        availableKw: round1(availableKw),
        utilizationPct,
        safeMode,
        connectors,
        source: 'energy-manager',
    };
}

/**
 * Rolling total-site-load time series for the dashboard chart.
 */
async function getSiteEnergySeries(siteId) {
    const items = await redis.lrange(`site:${siteId}:load_history`, 0, -1);
    const points = items
        .map((raw) => {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
    return { siteId, unit: 'kW', points };
}

module.exports = { getSiteEnergy, getSiteEnergySeries };
