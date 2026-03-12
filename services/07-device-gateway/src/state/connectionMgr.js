const Redis = require('ioredis');

// Use environment variable or fallback to default
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

/**
 * Maps a charger to the specific Device Gateway instance holding its WebSocket.
 */
async function registerConnection(chargePointId, instanceId, protocol = 'ocpp2.0.1') {
    // Store route and protocol metadata in a hash
    const key = `charger_route:${chargePointId}`;
    await redis.hset(key, 'instanceId', instanceId, 'protocol', protocol);
    await redis.expire(key, 300); // 5 minute TTL
}

async function removeConnection(chargePointId) {
    await redis.del(`charger_route:${chargePointId}`);
}

module.exports = { redis, registerConnection, removeConnection };
