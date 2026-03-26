const Redis = require('ioredis');

// Use environment variable or fallback to default
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

/**
 * Maps a charger to the specific Device Gateway instance holding its WebSocket.
 * Also caches the charger's ISO region for regional grid lock checks.
 */
async function registerConnection(chargePointId, instanceId, isoRegion = 'CAISO') {
    // Normalize region: uppercase and remove hyphens (e.g., ENTSO-E -> ENTSOE)
    const normalizedRegion = isoRegion.toUpperCase().replace(/-/g, '');

    // Set with a TTL (e.g., 5 minutes) that gets refreshed via heartbeat/ping
    await redis.set(`charger_route:${chargePointId}`, instanceId, 'EX', 300);
    // Cache the regional context for rapid grid-lock verification (L2/L4 sync)
    await redis.set(`charger_region:${chargePointId}`, normalizedRegion, 'EX', 300);
}

async function removeConnection(chargePointId) {
    await redis.del(`charger_route:${chargePointId}`);
    await redis.del(`charger_region:${chargePointId}`);
}

module.exports = { redis, registerConnection, removeConnection };
