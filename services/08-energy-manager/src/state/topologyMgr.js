const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Retrieves the current physical state of the site to feed the DLM algorithm.
 * @param {string} siteId - The physical location ID
 */
async function getSiteState(siteId) {
    // 1. Get Site Limits (e.g., Main Transformer limit)
    const siteConfig = await redis.hgetall(`site:${siteId}:config`);
    const limitKw = parseFloat(siteConfig.max_capacity_kw) || 0;

    // 2. Get Real-Time Building Load (updated via Kafka or Modbus)
    const buildingLoadKw = parseFloat(await redis.get(`site:${siteId}:building_load_kw`)) || 0;

    // 3. Get all currently active charging sessions at this site
    // Stored as a Hash: ChargePointId -> JSON String of session details
    const activeSessionsRaw = await redis.hgetall(`site:${siteId}:active_sessions`);

    const activeSessions = Object.keys(activeSessionsRaw).map(cpId => {
        const data = JSON.parse(activeSessionsRaw[cpId]);
        return {
            chargePointId: cpId,
            maxHardwareKw: data.maxHardwareKw, // The physical limit of the charger (e.g., 50kW)
            currentSoc: data.currentSoc,
            targetSoc: data.targetSoc || 80.0,
            departureTime: data.departureTime, // ISO string
            priorityScore: data.priorityScore || 1.0
        };
    });

    return { limitKw, buildingLoadKw, activeSessions };
}

/**
 * Updates the building load in Redis (called by Modbus poller).
 */
async function updateBuildingLoad(siteId, loadKw) {
    await redis.set(`site:${siteId}:building_load_kw`, loadKw);
}

/**
 * Sets the site configuration in Redis (called during initialization or on update).
 */
async function setSiteConfig(siteId, config) {
    await redis.hset(`site:${siteId}:config`, config);
}

module.exports = { getSiteState, updateBuildingLoad, setSiteConfig };
