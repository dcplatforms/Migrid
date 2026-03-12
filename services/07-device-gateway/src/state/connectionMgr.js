const Redis = require('ioredis');

// Use environment variable or fallback to default
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

/**
 * Maps a charger to the specific Device Gateway instance holding its WebSocket.
 */
async function registerConnection(chargePointId, instanceId) {
    // Set with a TTL (e.g., 5 minutes) that gets refreshed via heartbeat/ping
    await redis.set(`charger_route:${chargePointId}`, instanceId, 'EX', 300);
}

async function removeConnection(chargePointId) {
    await redis.del(`charger_route:${chargePointId}`);
}

module.exports = { redis, registerConnection, removeConnection };
