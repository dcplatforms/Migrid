/**
 * L1: Physics Engine (Green Audit)
 *
 * Objectives:
 * 1. Listen to PostgreSQL notifications for physics violations.
 * 2. Publish alerts to Kafka (migrid.physics.alerts).
 * 3. Enforce "The Fuse Rule" and monitor BESS safety.
 * 4. Resilient Edge operation with local Redis fallback.
 * 5. Heartbeat monitoring (Cloud-Offline detection).
 */

require('dotenv').config();
const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const { createClient } = require('redis');

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const HEARTBEAT_INTERVAL = 5000;
const MAX_MISSED_HEARTBEATS = 3;

let missedHeartbeats = 0;
let isOffline = false;

// 1. Database Connection
const pgClient = new Client({ connectionString: DATABASE_URL });

// 2. Kafka Connection
const kafka = new Kafka({
  clientId: 'physics-engine',
  brokers: KAFKA_BROKERS,
});
const producer = kafka.producer();

// 3. Redis Connection (Local Sidecar)
const redisClient = createClient({ url: REDIS_URL });

async function connectServices() {
  try {
    await pgClient.connect();
    console.log('✅ [L1 Physics] Connected to PostgreSQL.');

    await producer.connect();
    console.log('✅ [L1 Physics] Connected to Kafka.');

    await redisClient.connect();
    console.log('✅ [L1 Physics] Connected to Local Redis.');

    // Setup DB listeners
    await pgClient.query('LISTEN physics_alerts');
    pgClient.on('notification', handlePhysicsAlert);

  } catch (err) {
    console.error('❌ [L1 Physics] Initial connection error:', err.message);
    enterOfflineMode();
  }
}

/**
 * Handle EFFICIENCY_ALERT notifications from PostgreSQL
 */
async function handlePhysicsAlert(msg) {
  if (isOffline) {
    // Log to local Redis for later reconciliation
    await redisClient.lPush('local_audit_log', msg.payload);
    return;
  }

  try {
    const payload = JSON.parse(msg.payload);
    console.log('⚡ [L1 Physics] Received Physics Alert:', payload);

    // Kafka alert format
    const alert = {
      event_type: payload.event_type || 'EFFICIENCY_ALERT',
      session_id: payload.session_id,
      site_id: payload.site_id || 'LOCAL-DEPOT-001', // Should be dynamic
      efficiency_pct: payload.efficiency_pct,
      threshold: payload.threshold || 0.85,
      timestamp: new Date().toISOString(),
      source_layer: 'L1'
    };

    await producer.send({
      topic: 'migrid.physics.alerts',
      messages: [{ value: JSON.stringify(alert) }],
    });
    console.log('📤 [L1 Physics] Kafka alert dispatched.');
  } catch (err) {
    console.error('❌ [L1 Physics] Failed to process alert:', err.message);
  }
}

/**
 * Heartbeat Mechanism (Cloud-Offline Detection)
 */
async function startHeartbeat() {
  setInterval(async () => {
    try {
      if (!isOffline) {
        // Attempt simple query to cloud DB as heartbeat
        await pgClient.query('SELECT 1');
        missedHeartbeats = 0;
      } else {
        // Try to reconnect
        await pgClient.query('SELECT 1');
        await exitOfflineMode();
      }
    } catch (err) {
      missedHeartbeats++;
      console.warn(`⚠️ [L1 Physics] Heartbeat missed (${missedHeartbeats}/${MAX_MISSED_HEARTBEATS})`);
      if (missedHeartbeats >= MAX_MISSED_HEARTBEATS && !isOffline) {
        enterOfflineMode();
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function enterOfflineMode() {
  console.error('🚨 [L1 Physics] Entering OFFLINE Mode. Switching to Redis local cache.');
  isOffline = true;
  // In OFFLINE mode, L1 must default to the local Redis cache
  // which maintains last known SoC, BESS thresholds, etc.
}

async function exitOfflineMode() {
  console.log('🏠 [L1 Physics] Re-connected to Cloud. Exiting OFFLINE Mode.');
  isOffline = false;
  missedHeartbeats = 0;
  await reconcileLogs();
}

/**
 * Reconcile local logs with Cloud Database
 */
async function reconcileLogs() {
  console.log('🔄 [L1 Physics] Reconciling local logs with Cloud DB...');
  let logEntry;
  while ((logEntry = await redisClient.rPop('local_audit_log')) !== null) {
    try {
      const payload = JSON.parse(logEntry);

      // Re-publish missed alerts to Kafka
      const alert = {
        event_type: payload.event_type || 'EFFICIENCY_ALERT',
        session_id: payload.session_id,
        site_id: payload.site_id || 'LOCAL-DEPOT-001',
        efficiency_pct: payload.efficiency_pct,
        threshold: payload.threshold || 0.85,
        timestamp: payload.timestamp || new Date().toISOString(),
        source_layer: 'L1',
        reconciled: true
      };

      await producer.send({
        topic: 'migrid.physics.alerts',
        messages: [{ value: JSON.stringify(alert) }],
      });

      // Ensure it exists in the primary audit_log table
      await pgClient.query(`
        INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, severity, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [
        payload.session_id,
        payload.event_type || 'EFFICIENCY_ALERT',
        payload.threshold || 0.85,
        payload.efficiency_pct,
        'WARNING',
        JSON.stringify({ reconciled: true, original_ts: payload.timestamp })
      ]);

      console.log(`✅ [L1 Physics] Reconciled log for session: ${payload.session_id}`);
    } catch (err) {
      console.error('❌ [L1 Physics] Reconciliation error:', err.message);
    }
  }
}

async function start() {
  await connectServices();
  startHeartbeat();
}

start();

process.on('SIGTERM', async () => {
  await pgClient.end();
  await producer.disconnect();
  await redisClient.quit();
  process.exit(0);
});
