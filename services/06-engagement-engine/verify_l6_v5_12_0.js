/**
 * L6 v5.12.0 Verification Script
 * Simulates Kafka events with site_id and is_sentinel_fidelity
 */

const { processChargingEvent, pool } = require('./index');
const redis = require('redis');

// Mock pool.query to verify SQL calls
const originalQuery = pool.query;
const queryLogs = [];
pool.query = async (...args) => {
    queryLogs.push(args);
    // Minimal mock returns to keep the logic moving
    if (args[0].includes('SELECT f.iso')) return { rows: [{ iso: 'CAISO' }] };
    if (args[0].includes('SELECT is_valid')) return { rows: [{ is_valid: true }] };
    if (args[0].includes('SELECT cs.variance_percentage')) return { rows: [{ variance_percentage: 1.0, resource_type: 'EV' }] };
    if (args[0].includes('SELECT COUNT(*)')) return { rows: [{ count: 0, total: 0, sentinel_count: 0, high_fidelity_count: 0, compliant_days: 0 }] };
    if (args[0].includes('SELECT id FROM achievements')) return { rows: [{ id: 'ach-123' }] };
    return { rows: [] };
};

async function verify() {
    console.log('🚀 Starting L6 v5.12.0 Verification...');

    const mockEvent = {
        driver_id: 'driver-789',
        session_id: 'session-abc',
        energyDispensedKwh: 25.5,
        type: 'SESSION_COMPLETED',
        site_id: 'site-gold-1',
        is_sentinel_fidelity: true,
        physics_score: 0.995,
        confidence_score: 0.98
    };

    try {
        await processChargingEvent(mockEvent);

        // Check if driver_actions inserts include the new fields in metadata
        const sessionCompletedInsert = queryLogs.find(q => q[1] && q[1][1] === 'session_completed');
        if (sessionCompletedInsert) {
            const metadata = JSON.parse(sessionCompletedInsert[1][2]);
            console.log('✅ session_completed metadata:', metadata);
            if (metadata.site_id === 'site-gold-1' && metadata.is_sentinel_fidelity === true) {
                console.log('✅ Site ID and Sentinel Fidelity correctly persisted in session_completed.');
            } else {
                throw new Error('❌ Site ID or Sentinel Fidelity missing from session_completed metadata.');
            }
        } else {
            throw new Error('❌ session_completed action not recorded.');
        }

        const lowVarianceInsert = queryLogs.find(q => q[1] && q[1][1] === 'low_variance_session');
        if (lowVarianceInsert) {
            const metadata = JSON.parse(lowVarianceInsert[1][2]);
            console.log('✅ low_variance_session metadata:', metadata);
            if (metadata.site_id === 'site-gold-1' && metadata.is_sentinel_fidelity === true) {
                console.log('✅ Site ID and Sentinel Fidelity correctly persisted in low_variance_session.');
            } else {
                throw new Error('❌ Site ID or Sentinel Fidelity missing from low_variance_session metadata.');
            }
        }

        console.log('✨ L6 v5.12.0 Verification Successful!');
    } catch (error) {
        console.error('❌ Verification Failed:', error.message);
        process.exit(1);
    } finally {
        pool.query = originalQuery;
        // pool.end() would hang if we don't close it, but we are using mocks
        process.exit(0);
    }
}

// Mock Redis to prevent connection issues
const redisClientMock = {
    get: async () => null,
    hGet: async () => null,
    hSet: async () => null,
    connect: async () => null,
    on: () => null
};

// Replace redisClient in the module if we were actually importing it,
// but processChargingEvent uses the internal redisClient.
// For this script, we assume a local environment or that redis is running.
// If it fails due to redis, we'd need a more invasive mock.

verify();
