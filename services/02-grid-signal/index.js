/**
 * L2: Grid Signal Service (v2.5.5)
 * OpenADR 3.0 VEN implementation for demand response and price signals
 * Enhanced with L1 Physics Safety Guards and Redis Caching
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const Ajv = require('ajv');

const app = express();
const port = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

const ajv = new Ajv({ allowUnionTypes: true });
const eventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    program_id: { type: 'string' },
    type: { type: 'string' },
    priority: { type: ['string', 'number'] },
    site_id: { type: 'string' },
    signals: { type: 'array' },
    targets: { type: 'array' },
    intervals: { type: 'array' },
    metadata: { type: 'object' }
  },
  required: ['id', 'type'],
  additionalProperties: true
};
const validateEvent = ajv.compile(eventSchema);

// 1. Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// 2. Kafka Connection
const kafka = new Kafka({
  clientId: 'grid-signal',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  transactionTimeout: 30000
});
const consumer = kafka.consumer({ groupId: 'grid-signal-group' });

// 3. Redis Connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// [L2-133] Sub-millisecond local safety cache
const localSafetyCache = {
  global_safety: false,
  global_grid: false,
  regional_safety: {},
  regional_grid: {},
  site_safety: {} // [L2-v2.5.5] Site-specific safety locks
};

app.use(helmet());
app.use(express.json());

/**
 * Helper: Extract site ID from multi-key payload
 * [L2 v2.5.2] Standardized extraction for L3/L4/L6/L10 parity
 */
const extractSiteId = (payload) => {
  if (!payload) return null;
  return payload.site_id || payload.siteId || payload.location_id || payload.locationId || null;
};

/**
 * Helper: Robust float parsing with isNaN protection
 * [L2 v2.5.5] Standardized: Returns string formatted to .toFixed(4) for L11 ML parity
 */
const safeFloat = (val, fallback = 1.0) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback.toFixed(4) : parsed.toFixed(4);
};

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

// Redis safety key constants
const SAFETY_LOCK_KEY = 'l1:safety:lock';

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    service: 'grid-signal',
    version: '2.5.5',
    status: 'healthy',
    layer: 'L2',
    openadr_version: '3.0.0'
  });
});

/**
 * Get OpenADR 3.0 Reports (VEN)
 * Returns recent grid events for compliance and auditing
 * [L2 v2.4.8] Optimized: Utilizes unified context for sub-50ms reporting
 * Security [L2 v2.5.2]: Restricted to system tokens (no fleet_id)
 */
app.get('/openadr/v3/reports', authenticateToken, async (req, res) => {
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global reports restricted to system tokens' });
  }

  try {
    const [result, unifiedContextRaw, safetyContextRaw, marketContextRaw, regionalCapacityRaw] = await Promise.all([
      pool.query('SELECT event_id, event_type, status, received_at FROM grid_events ORDER BY received_at DESC LIMIT 50'),
      redisClient.get('l2:unified:context'),
      redisClient.get(`${SAFETY_LOCK_KEY}:context`),
      redisClient.get('market:latest:context'),
      redisClient.get('vpp:capacity:regional')
    ]);

    const unifiedContext = unifiedContextRaw ? JSON.parse(unifiedContextRaw) : {
      digital_twin: {},
      regional_markets: {},
      regional_locks: {},
      site_statuses: {},
      regional_capacity: {},
      regional_confidence: {},
      grid_health: {},
      advance_charge: {},
      confidence_score: '1.0000'
    };

    const marketContext = marketContextRaw ? JSON.parse(marketContextRaw) : null;
    let safetyContext = safetyContextRaw ? JSON.parse(safetyContextRaw) : null;
    const regionalCapacity = regionalCapacityRaw ? JSON.parse(regionalCapacityRaw) : {};

    // Security Enhancement: Mask PII in safety context for reporting
    if (safetyContext) {
      if (safetyContext.vin) safetyContext.vin = '[MASKED]';
      if (safetyContext.vehicle_id) safetyContext.vehicle_id = '[MASKED]';

      // Ensure scores are strictly string-formatted (v2.5.5)
      if (safetyContext.physics_score !== undefined) safetyContext.physics_score = safeFloat(safetyContext.physics_score, 1.0);
      if (safetyContext.confidence_score !== undefined) safetyContext.confidence_score = safeFloat(safetyContext.confidence_score, 1.0);

      // Ensure sentinel flag is explicitly boolean, handling boolean, string, and integer formats (v2.5.5)
      const rawSentinel = safetyContext.is_sentinel_fidelity;
      const pScore = safeFloat(safetyContext.physics_score, 1.0);
      safetyContext.is_sentinel_fidelity = !!(rawSentinel === true || rawSentinel === 'true' || rawSentinel === 1 || parseFloat(pScore) > 0.99);
    }

    res.json({
      reports: result.rows,
      market_context: marketContext,
      regional_markets: unifiedContext.regional_markets,
      regional_capacity: Object.keys(unifiedContext.regional_capacity).length > 0 ? unifiedContext.regional_capacity : regionalCapacity,
      regional_stats: unifiedContext.digital_twin,
      regional_confidence: unifiedContext.regional_confidence,
      grid_health: unifiedContext.grid_health,
      advance_charge: unifiedContext.advance_charge,
      safety_lock: {
        active: localSafetyCache.global_safety,
        context: safetyContext,
        regional: localSafetyCache.regional_safety,
        site: localSafetyCache.site_safety
      },
      grid_lock: {
        active: localSafetyCache.global_grid,
        regional: localSafetyCache.regional_grid
      },
      confidence_score: unifiedContext.confidence_score,
      digital_twin: unifiedContext.digital_twin,
      site_statuses: unifiedContext.site_statuses,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[L2 Grid Signal] Report Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An internal server error occurred' });
  }
});

/**
 * Receive OpenADR 3.0 Event (VEN)
 */
app.post('/openadr/v3/events', authenticateToken, async (req, res) => {
  const event = req.body;

  // 0. Payload validation (OpenADR 3.0 Compliance)
  const valid = validateEvent(event);
  if (!valid) {
    return res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'Schema validation failed',
      details: validateEvent.errors
    });
  }

  try {
    // Normalize ISO Region: uppercase and remove hyphens for cross-layer consistency
    const isoRegion = (event.targets?.find(t => t.type === 'region')?.value || '').toUpperCase().replace(/-/g, '');

    // 1. Check Safety Lock from L1 Physics Engine (Utilize sub-millisecond local cache)
    // [L2-v2.5.5] Enhanced: Check site-specific safety locks
    const siteIdVal = extractSiteId(event);
    const isSiteSafetyLocked = siteIdVal && localSafetyCache.site_safety[siteIdVal.toUpperCase()];
    const isSafetyLocked = localSafetyCache.global_safety || (isoRegion && localSafetyCache.regional_safety[isoRegion]) || isSiteSafetyLocked;

    if (isSafetyLocked) {
      console.warn(`🚨 [L2] DISPATCH REJECTED: L1 Safety Lock active (Global: ${localSafetyCache.global_safety}, Regional: ${localSafetyCache.regional_safety[isoRegion]}, Site: ${isSiteSafetyLocked})`);

      // Fetch context if available for richer error response (Redis fallback)
      const lockContext = (siteIdVal && isSiteSafetyLocked) ? await redisClient.get(`${SAFETY_LOCK_KEY}:site:${siteIdVal.toUpperCase()}:context`) : await redisClient.get(`${SAFETY_LOCK_KEY}:context`);
      const details = lockContext ? JSON.parse(lockContext) : null;

      return res.status(503).json({
        status: 'REJECTED',
        reason: 'SAFETY_VIOLATION_L1',
        message: 'Grid dispatch suspended due to physics engine safety lock',
        details: details ? { alert_type: details.event_type, severity: details.severity } : 'No details available',
        timestamp: new Date().toISOString()
      });
    }

    // 1.1 Check L4 Grid Lock (Global and Regional) - Utilizing local cache
    const isGridLocked = localSafetyCache.global_grid || (isoRegion && localSafetyCache.regional_grid[isoRegion]);

    if (isGridLocked) {
      console.warn(`🚨 [L2] DISPATCH REJECTED: L4 Grid Lock active (Global: ${localSafetyCache.global_grid}, Regional: ${localSafetyCache.regional_grid[isoRegion]})`);
      return res.status(503).json({
        status: 'REJECTED',
        reason: 'GRID_LOCK_ACTIVE',
        message: 'Grid dispatch suspended due to high-priority grid stability event',
        region: isoRegion || 'GLOBAL',
        timestamp: new Date().toISOString()
      });
    }

    // Fetch regional market metadata for broadcast enrichment
    let marketMetadata = {};
    if (isoRegion) {
      const marketRaw = await redisClient.get(`market:context:${isoRegion}`);
      if (marketRaw) {
        marketMetadata = JSON.parse(marketRaw);
      }
    }

    // 1.2 Check L8 Safe Mode (Site Specific)
    // [L2 v2.5.2] Robust multi-key site identification via helper
    if (siteIdVal) {
      const safeMode = await redisClient.get(`l8:site:${siteIdVal}:safe_mode`);
      if (safeMode === 'true' || safeMode === '1') {
        console.warn(`🚨 [L2] DISPATCH REJECTED: Site ${siteIdVal} in L8 Safe Mode`);
        return res.status(503).json({
          status: 'REJECTED',
          reason: 'SITE_IN_SAFE_MODE',
          message: 'Grid dispatch suspended: Site energy manager is in Safe Mode (Meter Offline)',
          site_id: siteIdVal,
          timestamp: new Date().toISOString()
        });
      }
    }

    console.log('📢 [L2] Received OpenADR Event:', event.id);

    // 1.1 V2G Detection Logic (Phase 5 Forward Engineering)
    const v2gRequested = (event.type === 'discharge' ||
                          (event.signals && event.signals.some(s => s.value < 0 || s.type === 'discharge')));

    // IEEE 2030.5 DERControl Mapping (Phase 5 Forward Engineering)
    const derControl = {};
    if (event.signals) {
      const opModeSignal = event.signals.find(s => s.type === 'level');
      if (opModeSignal) derControl.op_mode = opModeSignal.value;

      const setPointSignal = event.signals.find(s => s.type === 'setpoint');
      if (setPointSignal) derControl.set_point_kw = setPointSignal.value;
    }

    // 2. Save event to ledger
    await pool.query(
      'INSERT INTO grid_events (event_id, event_type, payload, status, received_at, metadata) VALUES ($1, $2, $3, $4, NOW(), $5) ON CONFLICT (event_id) DO NOTHING',
      [event.id, event.type || 'demand-response', JSON.stringify(event), 'active', JSON.stringify({ ...event.metadata, program_id: event.program_id })]
    );

    // 3. Cache event in Redis for 1 hour
    await redisClient.setEx(`event:${event.id}`, 3600, JSON.stringify(event));

    // 1.2 Check L8 Site Status (Safe Mode / Meter Offline)
    const siteStatus = siteIdVal ? await redisClient.get(`l8:site:status:${siteIdVal}`) : null;

    // 4. Broadcast enriched event to other services via Kafka
    // Enhanced resilience: Wrap in try-catch with retry awareness
    try {
      const safetyContextRaw = await redisClient.get(`${SAFETY_LOCK_KEY}:context`);
      const safetyContext = safetyContextRaw ? JSON.parse(safetyContextRaw) : {};

      // Fetch high-fidelity capacity/context snapshot for this region if available
      const unifiedContextRaw = await redisClient.get('l2:unified:context');
      const unifiedContext = unifiedContextRaw ? JSON.parse(unifiedContextRaw) : null;

      // [L2-v2.4.5/6] Enhanced High-Fidelity Kafka Broadcast with Confidence & Regional Context
      // [L2-v2.4.6] Prioritize regional average confidence if no safety lock is active
      const regionalAvgConfidence = unifiedContext?.regional_confidence?.[isoRegion] ?? 1.0;
      const confidenceScore = safeFloat((safetyContext.confidence_score !== undefined) ? safetyContext.confidence_score :
                                         (safetyContext.physics_score !== undefined ? safetyContext.physics_score : regionalAvgConfidence.toString()), 1.0);
      const physicsScore = safeFloat(safetyContext.physics_score ?? '1.0000', 1.0);
      // [L2 v2.5.5] Hardened sentinel detection supporting boolean, string, and integer formats
      const rawSentinel = safetyContext.is_sentinel_fidelity;
      const isSentinelFidelity = !!(rawSentinel === true || rawSentinel === 'true' || rawSentinel === 1 || parseFloat(physicsScore) > 0.99);
      // [L1-124] Aligned High-Fidelity Standard: physics > 0.95 OR confidence > 0.95
      const fidelityStatus = (parseFloat(physicsScore) > 0.95 || parseFloat(confidenceScore) > 0.95) ? 'HIGH_FIDELITY' : 'STANDARD';

      const regionalCapacity = unifiedContext?.regional_capacity?.[isoRegion] || null;
      await producer.send({
        topic: 'grid_signals',
        messages: [{
          value: JSON.stringify({
            event_id: event.id,
            program_id: event.program_id || 'DEFAULT',
            type: event.type,
            priority: event.priority || 'NORMAL',
            site_id: siteIdVal || 'ALL',
            site_status: siteStatus || 'OPERATIONAL',
            v2g_requested: v2gRequested,
            der_control: Object.keys(derControl).length > 0 ? derControl : null,
            iso_region: isoRegion,
            regional_capacity: regionalCapacity, // L2 v2.4.4: Regional capacity breakdown (Total/EV/BESS)
            market_price_at_session: event.metadata?.market_price_at_session ?? (marketMetadata.price_per_mwh ?? 0), // L2 v2.4.1: Nullish coalescing for 0-price preservation
            profitability_index: marketMetadata.profitability_index,
            degradation_cost_mwh: marketMetadata.degradation_cost_mwh,
            physics_score: physicsScore,
            confidence_score: confidenceScore, // L2 v2.5.5: Hardened string formatting
            fidelity_status: fidelityStatus,
            is_sentinel_fidelity: isSentinelFidelity,
            metadata: event.metadata || {}, // L2 v2.4.1: Full metadata preservation (OpenADR 3.1.0)
            billing_mode: event.metadata?.billing_mode,
            intervals: event.intervals || [],
            targets: event.targets || [],
            signals: event.signals || [],
            payload: event,
            timestamp: new Date().toISOString()
          })
        }]
      });
    } catch (kafkaError) {
      console.error(`❌ [L2] Kafka Broadcast Failed for event ${event.id}:`, kafkaError.message);
      // We still return 202 to the utility as the event is saved in our DB,
      // but we log the internal broadcast failure for L3/L4/L8.
    }

    res.status(202).json({
      status: 'RECEIVED',
      event_id: event.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[L2 Grid Signal Error]', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An internal server error occurred' });
  }
});

/**
 * L11 AI Data Readiness: Export historical grid event data for training
 * Security [L2 v2.5.2]: Restricted to system tokens (no fleet_id)
 */
app.get('/data/training/events', authenticateToken, async (req, res) => {
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global data export restricted to system tokens' });
  }

  const { days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const result = await pool.query(
      'SELECT event_id, event_type, payload, status, received_at FROM grid_events WHERE received_at > NOW() - ($1 || \' days\')::interval ORDER BY received_at ASC',
      [daysInt]
    );

    res.json({
      record_count: result.rows.length,
      data: result.rows,
      version: '1.0.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Data Export Error]', error);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

/**
 * [L2-133] Local Safety Cache Poller
 * Ensures sub-millisecond lookup by periodic polling of Redis locks.
 */
const updateLocalSafetyCache = async () => {
  try {
    const [safetyGlobal, gridGlobal] = await Promise.all([
      redisClient.get(SAFETY_LOCK_KEY),
      redisClient.get('l4:grid:lock')
    ]);

    localSafetyCache.global_safety = (safetyGlobal === 'true' || safetyGlobal === '1');
    localSafetyCache.global_grid = (gridGlobal === 'true' || gridGlobal === '1');

    // Sync regional and site locks
    let cursor = '0';
    const newRegionalSafety = {};
    const newRegionalGrid = {};
    const newSiteSafety = {};

    do {
      const safetyReply = await redisClient.scan(cursor, { MATCH: `${SAFETY_LOCK_KEY}:*`, COUNT: 100 });
      cursor = safetyReply.cursor;
      if (safetyReply.keys.length > 0) {
        const values = await redisClient.mGet(safetyReply.keys);
        safetyReply.keys.forEach((key, index) => {
          if (key.endsWith(':context')) return;
          const parts = key.split(':');
          const lastPart = parts.pop().toUpperCase().replace(/-/g, '');

          // Distinguish between regional (ISO) and site-specific locks
          // Site IDs in L1 usually follow 'SITE-XXXX' or similar, ISOs are usually 3-6 chars
          // For robustness, we check if the key structure matches site-specific patterns or if it's a known ISO
          if (key.includes(':site:')) {
            newSiteSafety[lastPart] = (values[index] === 'true' || values[index] === '1');
          } else {
            newRegionalSafety[lastPart] = (values[index] === 'true' || values[index] === '1');
          }
        });
      }
    } while (cursor !== '0' && cursor !== 0);

    cursor = '0';
    do {
      const gridReply = await redisClient.scan(cursor, { MATCH: 'l4:grid:lock:*', COUNT: 100 });
      cursor = gridReply.cursor;
      if (gridReply.keys.length > 0) {
        const values = await redisClient.mGet(gridReply.keys);
        gridReply.keys.forEach((key, index) => {
          const iso = key.split(':').pop().toUpperCase().replace(/-/g, '');
          newRegionalGrid[iso] = (values[index] === 'true' || values[index] === '1');
        });
      }
    } while (cursor !== '0' && cursor !== 0);

    localSafetyCache.regional_safety = newRegionalSafety;
    localSafetyCache.regional_grid = newRegionalGrid;
    localSafetyCache.site_safety = newSiteSafety;
  } catch (err) {
    console.error('❌ [L2] Failed to update local safety cache:', err.message);
  }
};

/**
 * Background task: Aggregate regional stats and contexts for sub-500ms reporting
 * [L2 v2.4.3] Unified Context Aggregation for AI Readiness
 */
const updateRegionalStats = async () => {
  const context = {
    digital_twin: {},
    regional_markets: {},
    regional_locks: {},
    site_statuses: {},
    regional_capacity: {},
    regional_confidence: {},
    grid_health: {},
    advance_charge: {}
  };

  try {
    // 1. Aggregate Regional Digital Twin Statistics and Confidence (from L1)
    let twinCursor = '0';
    const confidenceSums = {};

    do {
      const result = await redisClient.scan(twinCursor, { MATCH: 'l1:*:vehicle:*', COUNT: 100 });
      twinCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const parts = key.split(':');
          const iso = parts[1].toUpperCase().replace(/-/g, '');
          const data = values[index] ? JSON.parse(values[index]) : null;

          if (!context.digital_twin[iso]) {
            context.digital_twin[iso] = { vehicle_count: 0, high_fidelity_count: 0, sentinel_fidelity_count: 0, ev_count: 0, bess_count: 0 };
            confidenceSums[iso] = 0;
          }
          context.digital_twin[iso].vehicle_count++;
          if (data) {
            const pScore = safeFloat(data.physics_score, 1.0);
            const cScore = safeFloat(data.confidence_score, 1.0);

            // [L1-124] Aligned High-Fidelity Standard
            if (data.is_high_fidelity || parseFloat(pScore) > 0.95 || parseFloat(cScore) > 0.95) {
              context.digital_twin[iso].high_fidelity_count++;
            }
            const rawSentinel = data.is_sentinel_fidelity;
            if (rawSentinel === true || rawSentinel === 'true' || rawSentinel === 1 || parseFloat(pScore) > 0.99) {
              context.digital_twin[iso].sentinel_fidelity_count++;
            }
            if (data.resource_type === 'EV') context.digital_twin[iso].ev_count++;
            if (data.resource_type === 'BESS') context.digital_twin[iso].bess_count++;

            // [L2-v2.4.6] Track confidence sum for regional average
            confidenceSums[iso] += parseFloat(cScore);
          } else {
            confidenceSums[iso] += 1.0;
          }
        });
      }
    } while (twinCursor !== 0 && twinCursor !== '0');

    // Calculate Regional Averages
    Object.keys(context.digital_twin).forEach(iso => {
      const count = context.digital_twin[iso].vehicle_count;
      if (count > 0) {
        context.regional_confidence[iso] = safeFloat(confidenceSums[iso] / count, 1.0);
      } else {
        context.regional_confidence[iso] = '1.0000';
      }
    });

    // 2. Aggregate all regional market contexts (from L4)
    let marketCursor = '0';
    do {
      const result = await redisClient.scan(marketCursor, { MATCH: 'market:context:*', COUNT: 100 });
      marketCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const iso = key.split(':').pop().toUpperCase().replace(/-/g, '');
          if (values[index]) {
            context.regional_markets[iso] = JSON.parse(values[index]);
          }
        });
      }
    } while (marketCursor !== 0 && marketCursor !== '0');

    // 3. Aggregate regional grid locks (from L4)
    let lockCursor = '0';
    do {
      const result = await redisClient.scan(lockCursor, { MATCH: 'l4:grid:lock:*', COUNT: 100 });
      lockCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const iso = key.split(':').pop().toUpperCase().replace(/-/g, '');
          if (values[index] === '1' || values[index] === 'true') {
            context.regional_locks[iso] = true;
          }
        });
      }
    } while (lockCursor !== 0 && lockCursor !== '0');

    // 4. Aggregate Site Statuses and Safe Mode (from L8 and L3)
    let statusCursor = '0';
    do {
      const result = await redisClient.scan(statusCursor, { MATCH: 'l8:site:status:*', COUNT: 100 });
      statusCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const siteId = key.split(':').pop();
          context.site_statuses[siteId] = values[index];
        });
      }
    } while (statusCursor !== 0 && statusCursor !== '0');

    const safeModeSites = await redisClient.sMembers('l3:vpp:safemode_sites');
    if (safeModeSites && safeModeSites.length > 0) {
      safeModeSites.forEach(siteId => {
        context.site_statuses[siteId] = 'SAFE_MODE';
      });
    }

    // 5. Fetch high-fidelity regional capacity aggregation (from L3)
    const regionalCapacityRaw = await redisClient.get('vpp:capacity:regional:high_fidelity') || await redisClient.get('vpp:capacity:regional');
    if (regionalCapacityRaw) {
      context.regional_capacity = JSON.parse(regionalCapacityRaw);
    }

    // 6. Aggregate Physics Confidence Score (from L1)
    const safetyContextRaw = await redisClient.get(`${SAFETY_LOCK_KEY}:context`);
    if (safetyContextRaw) {
      try {
        const safetyContext = JSON.parse(safetyContextRaw);
        // [L2 v2.4.5] Prioritize explicit confidence_score from L1 context
        context.confidence_score = safeFloat((safetyContext.confidence_score !== undefined) ? safetyContext.confidence_score :
                                               (safetyContext.physics_score !== undefined ? safetyContext.physics_score : '1.0'), 1.0);
      } catch (e) {}
    } else {
      context.confidence_score = '1.0000'; // Default to full confidence if no locks/alerts
    }

    // 7. Aggregate Grid Health and Advance Charge signals (from L4 via L2 cache)
    let healthCursor = '0';
    do {
      const result = await redisClient.scan(healthCursor, { MATCH: 'l2:grid_health:*', COUNT: 100 });
      healthCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const iso = key.split(':').pop().toUpperCase();
          if (values[index]) {
            context.grid_health[iso] = JSON.parse(values[index]);
          }
        });
      }
    } while (healthCursor !== 0 && healthCursor !== '0');

    let chargeCursor = '0';
    do {
      const result = await redisClient.scan(chargeCursor, { MATCH: 'l2:advance_charge:*', COUNT: 100 });
      chargeCursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        const values = await redisClient.mGet(result.keys);
        result.keys.forEach((key, index) => {
          const iso = key.split(':').pop().toUpperCase();
          if (values[index]) {
            context.advance_charge[iso] = JSON.parse(values[index]);
          }
        });
      }
    } while (chargeCursor !== 0 && chargeCursor !== '0');

    // Cache unified results for 30s to meet sub-500ms SLA
    await redisClient.setEx('l2:unified:context', 30, JSON.stringify(context));
    // Legacy support for digital twin stats
    await redisClient.setEx('l2:regional:stats', 30, JSON.stringify(context.digital_twin));
  } catch (error) {
    console.error('[L2 Grid Signal] Unified Context Background Task Error:', error.message);
  }
};

/**
 * Listen for cross-layer Kafka events (L1 Safety & L4 Market)
 * Aligned with Phase 5: Forward engineering for market-aware reporting
 */
async function startSafetyConsumer() {
  await consumer.connect();
  await consumer.subscribe({
    topics: ['migrid.physics.alerts', 'MARKET_PRICE_UPDATED', 'migrid.l8.status', 'L8_SAFE_MODE_CHANGED', 'ADVANCE_CHARGE_SIGNAL', 'GRID_HEALTH_UPDATED', 'DER_ALARM_REPORTED'],
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const payload = JSON.parse(message.value.toString());

      if (topic === 'DER_ALARM_REPORTED') {
        const siteIdVal = extractSiteId(payload);
        console.log(`⚠️ [L2] DER Alarm Reported: Site=${siteIdVal}, Type=${payload.alarm_type}, Severity=${payload.severity}`);
        if (siteIdVal) {
          await redisClient.setEx(`l7:site:alarm:${siteIdVal}`, 3600, JSON.stringify(payload));
          // If critical alarm, log for engineering audit
          if (payload.severity === 'CRITICAL') {
            console.warn(`🚨 [L2] CRITICAL DER ALARM at Site ${siteIdVal}. Monitoring for grid instability.`);
          }
        }
      } else if (topic === 'ADVANCE_CHARGE_SIGNAL') {
        const iso = payload.iso.toUpperCase().replace(/-/g, '');
        console.log(`[L2] Received Advance Charge Signal for ${iso}: ${payload.reason}`);
        await redisClient.setEx(`l2:advance_charge:${iso}`, 600, JSON.stringify(payload));
      } else if (topic === 'GRID_HEALTH_UPDATED') {
        const iso = payload.iso.toUpperCase().replace(/-/g, '');
        console.log(`[L2] Received Grid Health Update for ${iso}: ${(payload.renewable_percentage * 100).toFixed(1)}% renewable`);
        await redisClient.setEx(`l2:grid_health:${iso}`, 600, JSON.stringify(payload));
      } else if (topic === 'migrid.l8.status') {
        const siteIdVal = extractSiteId(payload);
        console.log(`[L2] Received status update from L8 for site ${siteIdVal}: ${payload.status}`);
        // Cache site status (e.g., SAFE_MODE, METER_OFFLINE)
        if (siteIdVal) await redisClient.setEx(`l8:site:status:${siteIdVal}`, 3600, payload.status);
      } else if (topic === 'L8_SAFE_MODE_CHANGED') {
        const siteIdVal = extractSiteId(payload);
        const { safe_mode } = payload;
        console.log(`🛡️ [L2] L8 Safe Mode Change: Site ${siteIdVal} is now ${safe_mode ? 'LOCKED' : 'RELEASED'}`);

        if (siteIdVal) {
          if (safe_mode) {
            await redisClient.sAdd('l3:vpp:safemode_sites', siteIdVal.toString());
            await redisClient.setEx(`l8:site:status:${siteIdVal}`, 3600, 'SAFE_MODE');
          } else {
            await redisClient.sRem('l3:vpp:safemode_sites', siteIdVal.toString());
            await redisClient.setEx(`l8:site:status:${siteIdVal}`, 3600, 'OPERATIONAL');
          }
        }
      } else if (topic === 'migrid.physics.alerts') {
        const siteIdVal = extractSiteId(payload);
        // PHYSICS RULE: Trigger lock if CRITICAL/FRAUD OR if variance exceeds thresholds
        // [L2 v2.4.4] BESS Invariant: 10% variance threshold; EV Invariant: 15% threshold.
        const isCritical = payload.severity === 'CRITICAL' || payload.severity === 'FRAUD';
        const varianceThreshold = payload.resource_type === 'BESS' ? 10 : 15;
        const vPct = safeFloat(payload.variance_pct, 0.0);
        const isHighVariance = parseFloat(vPct) > varianceThreshold;

        if (isHighVariance || isCritical) {
          const reason = isHighVariance ? 'HIGH_VARIANCE_THRESHOLD' : payload.event_type;

          // CORE INVARIANT: Respect physics variance thresholds from L1 Physics Engine
          if (isHighVariance) {
            console.error(`🚨 [L2] CRITICAL INVARIANT VIOLATION: Variance (${vPct}%) exceeds ${varianceThreshold}% threshold for ${payload.resource_type || 'EV'} on Site ${siteIdVal}. Locking grid dispatch.`);
          } else {
            console.error(`🚨 [L2] L1 SAFETY ALERT: ${reason} on Site ${siteIdVal}. Region: ${payload.iso_region}. Locking grid dispatch.`);
          }

          // Detailed logging for engineering audit
          console.log(`[L2 Audit] Metadata: Vehicle=${payload.vehicle_id}, VIN=${payload.vin}, SoC=${payload.current_soc}%, Variance=${vPct}%, Billing=${payload.billing_mode}, VPP_Active=${payload.vpp_active}, V2G_Active=${payload.v2g_active}`);

          // Unified Safety Lock: Set to '1' for L4 compatibility, with 15m TTL
          await redisClient.setEx(SAFETY_LOCK_KEY, 900, '1');

          // [L2-v2.5.5] Set Site-Specific Safety Lock
          if (siteIdVal) {
            const siteLockKey = `${SAFETY_LOCK_KEY}:site:${siteIdVal.toUpperCase()}`;
            await redisClient.setEx(siteLockKey, 900, '1');
          }

          // Store detailed alert context for UI/Diagnostics and downstream layer alignment
          // [L2 v2.5.5] Hardened sentinel detection supporting boolean, string, and integer formats
          const rawSentinel = payload.is_sentinel_fidelity;
          const pScore = safeFloat(payload.physics_score, 1.0);
          const isSentinelFidelity = !!(rawSentinel === true || rawSentinel === 'true' || rawSentinel === 1 || parseFloat(pScore) > 0.99);

          const alertContext = JSON.stringify({
            ...payload,
            reason,
            message: isHighVariance ? `Variance (${vPct}%) exceeds ${varianceThreshold}% threshold for ${payload.resource_type || 'EV'}` : undefined,
            billing_mode: payload.billing_mode,
            vpp_active: payload.vpp_active,
            v2g_active: payload.v2g_active,
            iso_region: payload.iso_region,
            is_sentinel_fidelity: isSentinelFidelity,
            physics_score: pScore,
            confidence_score: safeFloat(payload.confidence_score, parseFloat(pScore)),
            market_price_at_session: parseFloat(safeFloat(payload.market_price_at_session, 0.0)),
            locked_at: new Date().toISOString()
          });

          await redisClient.setEx(`${SAFETY_LOCK_KEY}:context`, 900, alertContext);

          // [L2-v2.5.5] Store Site-Specific Context
          if (siteIdVal) {
            const siteContextKey = `${SAFETY_LOCK_KEY}:site:${siteIdVal.toUpperCase()}:context`;
            await redisClient.setEx(siteContextKey, 900, alertContext);
          }
        }
      } else if (topic === 'MARKET_PRICE_UPDATED') {
        const iso = payload.iso.toUpperCase().replace(/-/g, ''); // L2 v2.4.1: ISO Normalization
        console.log(`[L2] Received market update for ${iso}: $${payload.price_per_mwh}/MWh`);

        const marketContext = JSON.stringify({
          iso,
          price_per_mwh: payload.price_per_mwh,
          profitability_index: payload.profitability_index,
          degradation_cost_mwh: payload.degradation_cost_mwh,
          updated_at: payload.timestamp
        });

        // Cache the latest market context with a 10-minute TTL (600s) for reporting enrichment
        await redisClient.setEx('market:latest:context', 600, marketContext);

        // Phase 5 Enhancement: Store ISO-specific context for regional visibility
        await redisClient.setEx(`market:context:${payload.iso.toUpperCase().replace(/-/g, '')}`, 600, marketContext);
      }
    }
  });
}

async function start() {
  try {
    await redisClient.connect();
    console.log('✅ [L2] Connected to Redis');

    await producer.connect();
    console.log('✅ [L2] Connected to Kafka Producer');

    await startSafetyConsumer();
    console.log('✅ [L2] Safety Consumer running (Listening to L1)');

    // Start local safety cache poller [L2-133]
    setInterval(updateLocalSafetyCache, 5000);
    await updateLocalSafetyCache();

    // Start regional stats aggregation loop
    setInterval(updateRegionalStats, 15000);
    updateRegionalStats();

    app.listen(port, () => {
      console.log(`[L2 Grid Signal] Running on port ${port} (OpenADR 3.0 Ready)`);
    });
  } catch (error) {
    console.error('❌ [L2] Failed to start:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  producer,
  consumer,
  redisClient,
  startSafetyConsumer,
  localSafetyCache,
  updateLocalSafetyCache
};

process.on('SIGTERM', async () => {
  console.log('[L2 Grid Signal] Shutting down...');
  await producer.disconnect();
  await consumer.disconnect();
  await redisClient.quit();
  await pool.end();
  process.exit(0);
});
