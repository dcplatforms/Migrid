const { getSiteState } = require('../state/topologyMgr');
const { calculateAllocations } = require('../dlm/allocator');
const { publishDlmProfiles } = require('../events/producer');
const Redis = require('ioredis');

// Shared Redis client for the control loop to prevent connection leaks
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function runDlmCycle(siteId) {
    try {
        const { limitKw, buildingLoadKw, activeSessions } = await getSiteState(siteId);

        // SAFE MODE CHECK: If buildingLoadKw is 0, it might mean we've lost Modbus connectivity.
        // In a real scenario, building load is rarely exactly 0.
        // We also check if buildingLoadKw is explicitly null or undefined from a more robust check.
        if (buildingLoadKw === 0 && limitKw > 0) {
            console.warn(`[L8 DLM] WARNING: Building load is 0 for Site ${siteId}. Entering SAFE MODE.`);

            await redis.set(`l8:site:${siteId}:safe_mode`, 'true', 'EX', 300); // 5 min TTL

            const safeAllocations = activeSessions.map(s => ({
                chargePointId: s.chargePointId,
                allocatedKw: 1.4, // ~6 Amps at 230V
                reason: 'SAFE_MODE_METER_OFFLINE'
            }));
            await publishDlmProfiles(siteId, safeAllocations);
            return;
        } else {
            await redis.del(`l8:site:${siteId}:safe_mode`);
        }

        if (activeSessions.length === 0) return; // Nothing to manage

        // Run the math
        const newAllocations = calculateAllocations(limitKw, buildingLoadKw, activeSessions);

        // Broadcast to L7 Device Gateway via Kafka
        await publishDlmProfiles(siteId, newAllocations);

        console.log(`[L8 DLM] Cycle Complete for Site ${siteId}. Headroom: ${(limitKw - buildingLoadKw).toFixed(2)}kW. Managed ${activeSessions.length} EVSEs.`);

    } catch (error) {
        console.error(`[L8 DLM] Critical Error in control loop for Site ${siteId}:`, error.message);
        // Fallback: Drop all to minimum safe rate
        // In a production environment, we'd pull activeSessions again or have it in a local cache
    }
}

/**
 * Start the DLM engine for a site.
 */
function startEngine(siteId, intervalMs = 15000) {
    console.log(`[L8 DLM] Engine started for Site ${siteId} (Interval: ${intervalMs}ms)`);
    setInterval(() => runDlmCycle(siteId), intervalMs);
}

module.exports = { startEngine };
