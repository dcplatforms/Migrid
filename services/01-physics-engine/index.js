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
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const { createClient } = require('redis');

const app = express();
const port = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const SITE_ID = process.env.SITE_ID || 'LOCAL-DEPOT-001';

const SAFETY_LOCK_KEY = 'l1:safety:lock';
const SAFETY_LOCK_CONTEXT_KEY = 'l1:safety:lock:context';
const SAFETY_LOCK_TTL = 900; // 15 minutes
const HEARTBEAT_INTERVAL = 5000;
const MAX_MISSED_HEARTBEATS = 3;
const DIGITAL_TWIN_SYNC_INTERVAL_DEFAULT = 30000; // 30 seconds
const DIGITAL_TWIN_SYNC_INTERVAL_SCARCITY = 10000; // 10 seconds (Scarcity Mode)
const SCARCITY_PRICE_THRESHOLD = 100.0;

let missedHeartbeats = 0;
let lastMarketPrice = 0.0;
let syncIntervalId = null;
let isOffline = false;

// [L1-133] Sub-millisecond local safety cache
const localSafetyCache = {
  global: false,
  regional: {},
  site: {}
};

// 1. Database Connection
const pgClient = new Client({ connectionString: DATABASE_URL });

// 2. Kafka Connection
const kafka = new Kafka({
  clientId: 'physics-engine',
  brokers: KAFKA_BROKERS,
});
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'physics-engine-group' });

// 3. Redis Connection (Local Sidecar)
const redisClient = createClient({ url: REDIS_URL });

app.use(helmet());
app.use(express.json());

/**
 * Middleware: Verify JWT token (Zero-Trust Security)
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    service: 'physics-engine',
    version: '10.1.6',
    status: 'healthy',
    layer: 'L1'
  });
});

/**
 * L11 AI Data Readiness: Export historical physics audit data for training
 * Restricted to system tokens (no fleet_id)
 */
app.get('/data/training/physics', authenticateToken, async (req, res) => {
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global data export restricted to system tokens' });
  }

  const { days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const result = await pgClient.query(
      `SELECT session_id, violation_type, expected_value, actual_value, severity, metadata, billing_mode, vpp_active, v2g_active, iso_region, market_price_at_session, physics_score, is_high_fidelity, created_at
       FROM audit_log
       WHERE created_at > NOW() - ($1 || ' days')::interval
       ORDER BY created_at ASC`,
      [daysInt]
    );

    res.json({
      record_count: result.rows.length,
      data: result.rows,
      version: '1.0.1',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L1 Physics] Data Export Error:', error.message);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

async function connectServices() {
  try {
    await pgClient.connect();
    console.log('✅ [L1 Physics] Connected to PostgreSQL.');

    await producer.connect();
    console.log('✅ [L1 Physics] Connected to Kafka Producer.');

    await consumer.connect();
    await consumer.subscribe({ topic: 'DER_ALARM_REPORTED', fromBeginning: false });
    console.log('✅ [L1 Physics] Connected to Kafka Consumer.');

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          await handleDerAlarm(payload);
        } catch (err) {
          console.error('❌ [L1 Physics] Kafka Consumer Error:', err.message);
        }
      },
    });

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
 * [L1 v10.1.6] safeFloat: Robust isNaN protection for telemetry scoring
 * Enforces strict 4-decimal string formatting (.toFixed(4)).
 */
function safeFloat(val, fallback = 0.0) {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback.toFixed(4) : parsed.toFixed(4);
}

/**
 * [L1-118] Calculate Data Confidence Score for L11 ML Engine
 * @param {number} streak - Current sentinel streak
 * @param {string} lastSync - ISO string of last sync
 * @param {object} siteLoadData - Optional site load data { loadKw, limitKw }
 * @returns {string} Confidence score (0.0000 to 1.0000)
 */
function calculateConfidenceScore(streak, lastSync, siteLoadData) {
  let score = 0.5; // Base confidence

  // Streak bonus: 0.1 per streak point, max 0.4 (total 0.9)
  score += Math.min(0.4, (streak || 0) * 0.1);

  // Frequency bonus: if synced recently (within last 24h), add 0.1
  if (lastSync) {
    const lastSyncDate = new Date(lastSync);
    const now = new Date();
    const diffHours = (now - lastSyncDate) / (1000 * 60 * 60);
    if (diffHours < 24) {
      score += 0.1;
    }

    // [L1-120] Confidence Decay: -0.2 if inactive for > 30 days
    if (diffHours > 24 * 30) {
      score -= 0.2;
    }
  }

  // [L1-121] Site Energy Snapshot: -0.15 if load > 90% capacity
  if (siteLoadData && siteLoadData.limitKw > 0) {
    const loadFactor = siteLoadData.loadKw / siteLoadData.limitKw;
    if (loadFactor > 0.9) {
      score -= 0.15;
    }
  }

  return safeFloat(Math.max(0, Math.min(1.0, score)));
}

/**
 * Handle DER_ALARM_REPORTED events from Kafka (L7)
 * Activates site-specific safety lock for CRITICAL/HIGH alarms.
 */
async function handleDerAlarm(payload) {
  const severity = (payload.severity || 'LOW').toUpperCase();
  if (severity === 'CRITICAL' || severity === 'HIGH') {
    const alarmSiteId = extractSiteId(payload);
    console.log(`🚨 [L1 Physics] Received ${severity} DER Alarm for site ${alarmSiteId}. Activating Safety Lock.`);

    try {
      await redisClient.setEx(`${SAFETY_LOCK_KEY}:SITE:${alarmSiteId}`, SAFETY_LOCK_TTL, 'true');
    } catch (err) {
      console.error('❌ [L1 Physics] Failed to set site safety lock:', err.message);
    }
  }
}

/**
 * Helper: Standardize ISO region naming for cross-layer consistency
 */
function normalizeIso(iso) {
  return (iso || 'CAISO').toUpperCase().replace(/-/g, '');
}

/**
 * Helper: robust isNaN protection with fallback
 */
function safeFloat(val, fallback = 0.0) {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Helper: Extract site ID from multi-key payload
 * Standardized for multi-site parity (site_id, siteId, location_id, locationId)
 */
function extractSiteId(payload) {
  if (!payload) return null;
  return payload.site_id || payload.siteId || payload.location_id || payload.locationId || null;
}

/**
 * Centralized Physics Metadata Calculation
 * Calculates physics_score, is_high_fidelity, and is_sentinel_fidelity.
 */
function calculatePhysicsMetadata(payload) {
  let physicsScore = 1.0;
  // [L1-117] BESS Efficiency Curves: Stricter 10% threshold for BESS (vs 15% for EV)
  const varianceThreshold = (payload.resource_type === 'BESS') ? 10.0 : 15.0;

  if (payload.event_type === 'PHYSICS_FRAUD' || payload.event_type === 'CAPACITY_VIOLATION') {
    physicsScore = 0.0;
  } else if (payload.variance_pct !== undefined) {
    physicsScore = Math.max(0, Math.min(1, 1 - (payload.variance_pct / varianceThreshold)));
  } else if (payload.efficiency_pct !== undefined) {
    physicsScore = Math.max(0, Math.min(1, payload.efficiency_pct / 100.0));
  }

  const scoreStr = safeFloat(physicsScore);
  // [L1-130] Sentinel Hardening: Support boolean, string, and integer (1) formats
  const explicitSentinel = payload.is_sentinel_fidelity === true ||
                           payload.is_sentinel_fidelity === 'true' ||
                           payload.is_sentinel_fidelity === 1;

  return {
    physicsScore: scoreStr,
    isPhysicsHighFidelity: physicsScore > 0.95,
    isSentinelFidelity: explicitSentinel || physicsScore > 0.99
  };
}

/**
 * [L1-135] Handle DER Alarms from L7
 * Activates site-specific safety locks for CRITICAL/HIGH alarms.
 */
async function handleDerAlarm(message) {
  try {
    const payload = JSON.parse(message.value.toString());
    const { alarmType, severity, siteId } = payload;
    const normalizedSiteId = siteId || extractSiteId(payload);

    if (severity === 'CRITICAL' || severity === 'HIGH') {
      console.log(`🚨 [L1 Physics] ${severity} Alarm Reported: ${alarmType} at ${normalizedSiteId}. Activating Site Lock.`);
      const lockKey = `${SAFETY_LOCK_KEY}:SITE:${normalizedSiteId}`;
      await redisClient.setEx(lockKey, SAFETY_LOCK_TTL, 'true');
    }
  } catch (err) {
    console.error('❌ [L1 Physics] DER Alarm processing error:', err.message);
  }
}

/**
 * Handle EFFICIENCY_ALERT notifications from PostgreSQL
 */
async function handlePhysicsAlert(msg) {
  const payload = JSON.parse(msg.payload);
  console.log('⚡ [L1 Physics] Received Physics Alert:', payload);

  const severity = (payload.event_type === 'PHYSICS_FRAUD') ? 'FRAUD' : (payload.event_type === 'CAPACITY_VIOLATION' ? 'CRITICAL' : 'WARNING');

  const { physicsScore, isPhysicsHighFidelity, isSentinelFidelity } = calculatePhysicsMetadata(payload);

  // [L1-114] Sentinel Streak Tracker: Track consecutive 0.99+ sessions in Redis
  if (payload.vehicle_id && (payload.event_type === 'SESSION_COMPLETED' || payload.event_type === 'EFFICIENCY_ALERT')) {
    const streakKey = `l1:streak:sentinel:${payload.vehicle_id}`;
    try {
      if (isSentinelFidelity) {
        // [L1-116] Streak Decay: Reset if inactivity > 7 days
        const ttl = await redisClient.ttl(streakKey);
        const thirtyDays = 86400 * 30;
        const sevenDays = 86400 * 7;

        if (ttl > 0 && ttl < (thirtyDays - sevenDays)) {
          console.log(`⏳ [L1 Physics] Sentinel Streak decayed for ${payload.vehicle_id} due to 7+ days inactivity.`);
          await redisClient.set(streakKey, '1');
        } else {
          await redisClient.incr(streakKey);
        }
        await redisClient.expire(streakKey, thirtyDays); // 30-day retention
        console.log(`✨ [L1 Physics] Sentinel Streak incremented for ${payload.vehicle_id}`);
      } else {
        await redisClient.set(streakKey, '0');
        console.log(`📉 [L1 Physics] Sentinel Streak reset for ${payload.vehicle_id} (Score: ${physicsScore})`);
      }
    } catch (streakErr) {
      console.error('❌ [L1 Physics] Failed to update sentinel streak:', streakErr.message);
    }
  }

  // Cross-Layer ISO Normalization (e.g., ENTSO-E -> ENTSOE)
  const isoRegion = normalizeIso(payload.iso_region);

  // Update last known market price for Scarcity Mode detection
  if (payload.market_price_at_session !== undefined) {
    lastMarketPrice = parseFloat(payload.market_price_at_session);
    checkScarcityMode();
  }

  // [L1-118] Fetch streak to calculate confidence score for real-time alerts
  let currentStreak = 0;
  if (payload.vehicle_id) {
    const streakKey = `l1:streak:sentinel:${payload.vehicle_id}`;
    const streakVal = await redisClient.get(streakKey);
    currentStreak = parseInt(streakVal || '0');
  }

  // [L1-121] Fetch Site Load Data for Confidence Scoring
  const alertSiteId = extractSiteId(payload.metadata || payload);
  const buildingLoadKw = safeFloat(await redisClient.get(`site:${alertSiteId}:building_load_kw`));
  const siteConfig = await redisClient.hGetAll(`site:${alertSiteId}:config`) || {};
  const limitKw = safeFloat(siteConfig.max_capacity_kw);

  const confidenceScore = calculateConfidenceScore(
    currentStreak,
    payload.timestamp || new Date().toISOString(),
    { loadKw: buildingLoadKw, limitKw }
  );

  // [L1-124] April 2026 High-Fidelity Standard: Physics OR Confidence > 0.95
  const isHighFidelity = isPhysicsHighFidelity || parseFloat(confidenceScore) > 0.95;

  // 1. Verify the Physics: Set Safety Lock in Redis for critical violations
  if (payload.event_type === 'PHYSICS_FRAUD' || payload.event_type === 'CAPACITY_VIOLATION') {
    try {
      await redisClient.setEx(SAFETY_LOCK_KEY, SAFETY_LOCK_TTL, 'true');
      localSafetyCache.global = true;

      // Regional Lock: If ISO region is known, set regional lock as well
      if (isoRegion) {
        await redisClient.setEx(`${SAFETY_LOCK_KEY}:${isoRegion}`, SAFETY_LOCK_TTL, 'true');
        localSafetyCache.regional[isoRegion] = true;
      }

      // [L1-134] Site-Specific Lock: Always set site-specific lock for critical violations
      if (alertSiteId) {
        await redisClient.setEx(`${SAFETY_LOCK_KEY}:site:${alertSiteId}`, SAFETY_LOCK_TTL, 'true');
        localSafetyCache.site[alertSiteId] = true;
      }

      // Phase 5 Enhancement: Detailed Safety Lock Context for L2/L4 transparency
      const context = {
        event_type: payload.event_type,
        severity: severity,
        site_id: alertSiteId,
        vehicle_id: payload.vehicle_id,
        vin: payload.vin,
        variance_pct: payload.variance_pct,
        physics_score: physicsScore,
        is_high_fidelity: isHighFidelity,
        is_sentinel_fidelity: isSentinelFidelity,
        confidence_score: confidenceScore,
        current_soc: payload.current_soc,
        billing_mode: payload.billing_mode,
        vpp_active: payload.vpp_active,
        v2g_active: payload.v2g_active,
        iso_region: isoRegion,
        market_price_at_session: payload.market_price_at_session,
        locked_at: new Date().toISOString()
      };
      await redisClient.setEx(SAFETY_LOCK_CONTEXT_KEY, SAFETY_LOCK_TTL, JSON.stringify(context));

      console.log(`🔒 [L1 Physics] Safety Lock and Context activated in Redis: ${SAFETY_LOCK_KEY} (Physics Score: ${physicsScore})`);
    } catch (redisErr) {
      console.error('❌ [L1 Physics] Failed to set safety lock in Redis:', redisErr.message);
    }
  }

  if (isOffline) {
    // [L1-126] Hardened Offline Mode: Persist scores to prevent metadata loss
    const offlinePayload = {
      ...payload,
      physics_score: physicsScore,
      confidence_score: confidenceScore,
      is_high_fidelity: isHighFidelity,
      is_sentinel_fidelity: isSentinelFidelity
    };
    await redisClient.lPush('local_audit_log', JSON.stringify(offlinePayload));
    return;
  }

  try {
    // Kafka alert format
    const alert = {
      event_type: payload.event_type || 'EFFICIENCY_ALERT',
      session_id: payload.session_id,
      vehicle_id: payload.vehicle_id,
      vin: payload.vin,
      site_id: alertSiteId,
      efficiency_pct: payload.efficiency_pct,
      variance_pct: payload.variance_pct,
      resource_type: payload.resource_type || 'EV',
      current_soc: payload.current_soc,
      threshold: payload.threshold || (payload.event_type === 'EFFICIENCY_ALERT' ? 0.85 : (payload.event_type === 'CAPACITY_VIOLATION' ? 20.0 : null)),
      expected: payload.expected,
      actual: payload.actual,
      physics_score: physicsScore,
      is_high_fidelity: isHighFidelity,
      is_sentinel_fidelity: isSentinelFidelity,
      confidence_score: confidenceScore,
      billing_mode: payload.billing_mode,
      vpp_active: payload.vpp_active,
      v2g_active: payload.v2g_active,
      iso_region: isoRegion,
      market_price_at_session: payload.market_price_at_session,
      timestamp: payload.timestamp || new Date().toISOString(),
      source_layer: 'L1',
      severity: severity
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
 * [L1-133] Local Safety Cache Poller
 * Ensures sub-millisecond lookup by periodic polling of Redis locks.
 */
async function updateLocalSafetyCache() {
  try {
    const globalLock = await redisClient.get(SAFETY_LOCK_KEY);
    localSafetyCache.global = (globalLock === 'true' || globalLock === '1');

    let cursor = '0';
    const newRegionalLocks = {};
    const newSiteLocks = {};
    do {
      const reply = await redisClient.scan(cursor, { MATCH: `${SAFETY_LOCK_KEY}:*`, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        const values = await redisClient.mGet(reply.keys);
        reply.keys.forEach((key, index) => {
          if (key === SAFETY_LOCK_CONTEXT_KEY) return;

          if (key.startsWith(`${SAFETY_LOCK_KEY}:site:`)) {
            const siteId = key.replace(`${SAFETY_LOCK_KEY}:site:`, '');
            newSiteLocks[siteId] = (values[index] === 'true' || values[index] === '1');
          } else {
            const iso = key.split(':').pop().toUpperCase();
            newRegionalLocks[iso] = (values[index] === 'true' || values[index] === '1');
          }
        });
      }
    } while (cursor !== '0' && cursor !== 0);
    localSafetyCache.regional = newRegionalLocks;
    localSafetyCache.site = newSiteLocks;
  } catch (err) {
    console.error('❌ [L1 Physics] Failed to update local safety cache:', err.message);
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

      // Map severity correctly
      const severity = (payload.event_type === 'PHYSICS_FRAUD') ? 'FRAUD' : (payload.event_type === 'CAPACITY_VIOLATION' ? 'CRITICAL' : 'WARNING');

      // [L1-124] Re-calculate scores for high-fidelity reconciliation
      // Note: We use the stored scores if available (Hardened Offline Mode)
      const physicsMetadata = calculatePhysicsMetadata(payload);
      const physicsScore = payload.physics_score ? safeFloat(payload.physics_score).toFixed(4) : physicsMetadata.physicsScore;
      const isPhysicsHighFidelity = safeFloat(physicsScore) > 0.95;
      const confidenceScore = payload.confidence_score ? safeFloat(payload.confidence_score).toFixed(4) : (0.5).toFixed(4);
      const isHighFidelity = isPhysicsHighFidelity || safeFloat(confidenceScore) > 0.95;
      // [L1-130] Sentinel Hardening: Support boolean, string, and integer (1) formats
      const explicitSentinel = payload.is_sentinel_fidelity === true ||
                               payload.is_sentinel_fidelity === 'true' ||
                               payload.is_sentinel_fidelity === 1;
      const isSentinelFidelity = explicitSentinel || parseFloat(physicsScore) > 0.99;

      // Re-publish missed alerts to Kafka
      const alert = {
        event_type: payload.event_type || 'EFFICIENCY_ALERT',
        session_id: payload.session_id,
        vehicle_id: payload.vehicle_id,
        vin: payload.vin,
        site_id: extractSiteId(payload) || extractSiteId(payload.metadata) || SITE_ID,
        efficiency_pct: payload.efficiency_pct,
        variance_pct: payload.variance_pct,
        resource_type: payload.resource_type || 'EV',
        current_soc: payload.current_soc,
        threshold: payload.threshold || (payload.event_type === 'EFFICIENCY_ALERT' ? 0.85 : (payload.event_type === 'CAPACITY_VIOLATION' ? 20.0 : null)),
        expected: payload.expected,
        actual: payload.actual,
        physics_score: physicsScore,
        is_high_fidelity: isHighFidelity,
        is_sentinel_fidelity: isSentinelFidelity,
        confidence_score: confidenceScore,
        billing_mode: payload.billing_mode,
        vpp_active: payload.vpp_active,
        v2g_active: payload.v2g_active,
        iso_region: normalizeIso(payload.iso_region),
        market_price_at_session: payload.market_price_at_session || 0.0,
        timestamp: payload.timestamp || new Date().toISOString(),
        source_layer: 'L1',
        severity: severity,
        reconciled: true
      };

      await producer.send({
        topic: 'migrid.physics.alerts',
        messages: [{ value: JSON.stringify(alert) }],
      });

      // High-Fidelity SQL Insertion: map values correctly based on event_type
      let expectedValue = payload.threshold || (payload.resource_type === 'BESS' ? 0.90 : 0.85);
      let actualValue = payload.efficiency_pct;

      if (payload.event_type === 'PHYSICS_FRAUD') {
        expectedValue = payload.expected;
        actualValue = payload.actual;
      } else if (payload.event_type === 'CAPACITY_VIOLATION') {
        expectedValue = payload.threshold || 20.0;
        actualValue = payload.current_soc;
      }

      await pgClient.query(`
        INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, severity, metadata, billing_mode, vpp_active, v2g_active, iso_region, market_price_at_session, physics_score, is_high_fidelity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT DO NOTHING
      `, [
        payload.session_id,
        payload.event_type || 'EFFICIENCY_ALERT',
        expectedValue,
        actualValue,
        severity,
        JSON.stringify({
          reconciled: true,
          original_ts: payload.timestamp,
          vehicle_id: payload.vehicle_id,
          vin: payload.vin,
          v2g_active: payload.v2g_active,
          current_soc: payload.current_soc,
          variance_pct: payload.variance_pct,
          efficiency_pct: payload.efficiency_pct,
          physics_score: physicsScore,
          confidence_score: confidenceScore,
          is_high_fidelity: isHighFidelity
        }),
        payload.billing_mode,
        payload.vpp_active,
        payload.v2g_active,
        normalizeIso(payload.iso_region),
        payload.market_price_at_session || 0.0,
        physicsScore,
        isHighFidelity
      ]);

      console.log(`✅ [L1 Physics] Reconciled high-fidelity log for session: ${payload.session_id || 'CAPACITY_VIOLATION'}`);
    } catch (err) {
      console.error('❌ [L1 Physics] Reconciliation error:', err.message);
    }
  }
}

/**
 * Digital Twin Sync: Periodically cache vehicle state in Redis
 * Ensures sub-50ms capacity lookups for L3/L4 and edge resilience.
 * Scalability: Filtered by FLEET_ID to avoid massive full-table scans.
 * [L1-107] Enhancement: Regional namespaces (e.g., l1:CAISO:vehicle:ID)
 */
async function syncDigitalTwin() {
  const fleetId = process.env.FLEET_ID;
  if (isOffline || !fleetId) return;

  try {
    // JOIN with fleets to get the ISO region for regional keying
    // JOIN with vpp_resources to include resource_type (EV/BESS) for L2/L3 alignment
    // JOIN with charging_sessions/chargers to get site_id (location_id) for L1-121
    // [L1-107] Enhancement: Fetch physics_score and is_high_fidelity for L2 reporting
    const result = await pgClient.query(
      `SELECT v.id, v.fleet_id, v.battery_capacity_kwh, v.current_soc, v.is_plugged_in, v.v2g_enabled, v.physics_score, v.is_high_fidelity, f.iso, COALESCE(vr.resource_type, 'EV') as resource_type, c.location_id as site_id
       FROM vehicles v
       JOIN fleets f ON v.fleet_id = f.id
       LEFT JOIN vpp_resources vr ON v.id = vr.vehicle_id
       LEFT JOIN charging_sessions cs ON v.id = cs.vehicle_id AND cs.end_time IS NULL
       LEFT JOIN chargers c ON cs.charger_id = c.id
       WHERE v.fleet_id = $1`,
      [fleetId]
    );

    // [L1-125] Multi-Site Awareness: Cache site load data for performance
    const siteCache = new Map();

    for (const vehicle of result.rows) {
      const vehicleSiteId = vehicle.site_id || SITE_ID;

      // [L1-125] Multi-Site Awareness: Cache site load data for performance
      if (!siteCache.has(vehicleSiteId)) {
        const buildingLoadKw = safeFloat(await redisClient.get(`site:${vehicleSiteId}:building_load_kw`));
        const siteConfig = await redisClient.hGetAll(`site:${vehicleSiteId}:config`) || {};
        const limitKw = safeFloat(siteConfig.max_capacity_kw);
        siteCache.set(vehicleSiteId, { loadKw: buildingLoadKw, limitKw });
        console.log(`📡 [L1 Physics] Cached site data for ${vehicleSiteId}: ${buildingLoadKw}kW / ${limitKw}kW`);
      }
      const siteLoadData = siteCache.get(vehicleSiteId);

      const iso = normalizeIso(vehicle.iso);
      const key = `l1:${iso}:vehicle:${vehicle.id}`;

      // [L1-118] Implement Data Confidence Score for L11 ML Engine
      const streakKey = `l1:streak:sentinel:${vehicle.id}`;
      const streakVal = await redisClient.get(streakKey);
      const streak = parseInt(streakVal || '0');

      // Fetch last known sync state to determine frequency
      const existingDataRaw = await redisClient.get(key);
      let lastSync = null;
      if (existingDataRaw) {
        const existingData = JSON.parse(existingDataRaw);
        lastSync = existingData.last_sync;
      }

      const confidenceScore = calculateConfidenceScore(streak, lastSync, siteLoadData);

      // [L7 Fallback] If resource_type is missing or default, check L7's Redis cache
      let resourceType = vehicle.resource_type;
      if (!resourceType || resourceType === 'EV') {
        const cachedResource = await redisClient.get(`charger_resource:${vehicle.id}`);
        if (cachedResource) {
          resourceType = cachedResource;
        }
      }

      const physicsScore = safeFloat(vehicle.physics_score, 1.0).toFixed(4);

      // [L1-124] April 2026 High-Fidelity Standard
      const isHighFidelity = safeFloat(physicsScore) > 0.95 || safeFloat(confidenceScore) > 0.95;
      // [L1-130] Sentinel Hardening: Support boolean, string, and integer (1) formats
      const explicitSentinel = vehicle.is_sentinel_fidelity === true ||
                               vehicle.is_sentinel_fidelity === 'true' ||
                               vehicle.is_sentinel_fidelity === 1;

      await redisClient.setEx(key, 60, JSON.stringify({
        ...vehicle,
        resource_type: resourceType,
        physics_score: physicsScore,
        is_high_fidelity: isHighFidelity,
        is_sentinel_fidelity: explicitSentinel || parseFloat(physicsScore) > 0.99,
        confidence_score: confidenceScore,
        last_sync: new Date().toISOString()
      }));
    }
    console.log(`📡 [L1 Physics] Digital Twin synced ${result.rows.length} vehicles to Regional Redis (Last Price: $${lastMarketPrice}).`);
  } catch (err) {
    console.error('❌ [L1 Physics] Digital Twin sync error:', err.message);
  }
}

/**
 * [L1-108] Scarcity Mode: Increase polling frequency when prices > $100
 */
function checkScarcityMode() {
  const currentInterval = (lastMarketPrice > SCARCITY_PRICE_THRESHOLD)
    ? DIGITAL_TWIN_SYNC_INTERVAL_SCARCITY
    : DIGITAL_TWIN_SYNC_INTERVAL_DEFAULT;

  // We only reset the interval if it's different from the current one
  if (syncIntervalId) {
    const isCurrentlyScarcity = syncIntervalId._idleTimeout === DIGITAL_TWIN_SYNC_INTERVAL_SCARCITY;
    const shouldBeScarcity = lastMarketPrice > SCARCITY_PRICE_THRESHOLD;

    if (isCurrentlyScarcity !== shouldBeScarcity) {
      console.log(`🚀 [L1 Physics] Switching Scarcity Mode: ${shouldBeScarcity ? 'ON' : 'OFF'} (Interval: ${currentInterval}ms)`);
      clearInterval(syncIntervalId);
      syncIntervalId = setInterval(syncDigitalTwin, currentInterval);
      syncIntervalId._idleTimeout = currentInterval; // Manual sync for test environments
    }
  }
}

async function start() {
  await connectServices();
  startHeartbeat();

  // Start Safety Lock Poller [L1-133]
  setInterval(updateLocalSafetyCache, 5000);
  await updateLocalSafetyCache();

  // Start Digital Twin Sync
  syncIntervalId = setInterval(syncDigitalTwin, DIGITAL_TWIN_SYNC_INTERVAL_DEFAULT);
  syncIntervalId._idleTimeout = DIGITAL_TWIN_SYNC_INTERVAL_DEFAULT; // Manual sync for test environments
  syncDigitalTwin(); // Initial sync
}

if (require.main === module) {
  start().then(() => {
    app.listen(port, () => {
      console.log(`✅ [L1 Physics] API running on port ${port} (ML Readiness)`);
    });
  });
}

module.exports = {
  app,
  localSafetyCache,
  updateLocalSafetyCache,
  handleDerAlarm,
  handlePhysicsAlert,
  handleDerAlarm,
  calculatePhysicsMetadata,
  safeFloat,
  producer,
  consumer,
  connectServices,
  syncDigitalTwin,
  reconcileLogs,
  start,
  getSyncIntervalId: () => syncIntervalId,
  getLastMarketPrice: () => lastMarketPrice,
  safeFloat
};

process.on('SIGTERM', async () => {
  await pgClient.end();
  await producer.disconnect();
  await consumer.disconnect();
  await redisClient.quit();
  process.exit(0);
});
