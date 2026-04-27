/**
 * L2: Grid Signal Service
 * OpenADR 3.0 VEN implementation for demand response and price signals
 * Enhanced with L1 Physics Safety Guards and Redis Caching
 */

require('dotenv').config();
const express = require('express');
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

// Redis safety key constants
const SAFETY_LOCK_KEY = 'l1:safety:lock';

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    service: 'grid-signal',
    version: '2.4.7',
    status: 'healthy',
    layer: 'L2',
    openadr_version: '3.0.0'
  });
});

/**
 * Get OpenADR 3.0 Reports (VEN)
 * Returns recent grid events for compliance and auditing
 * [L2 v2.4.3] Optimized: Utilizes unified context for sub-50ms reporting
 * Security: Enforces authentication and masks PII in safety context.
 */
app.get('/openadr/v3/reports', authenticateToken, async (req, res) => {
  try {
    const [result, unifiedContextRaw, safetyLock, safetyContextRaw, gridLock, marketContextRaw, regionalCapacityRaw] = await Promise.all([
      pool.query('SELECT event_id, event_type, status, received_at FROM grid_events ORDER BY received_at DESC LIMIT 50'),
      redisClient.get('l2:unified:context'),
      redisClient.get(SAFETY_LOCK_KEY),
      redisClient.get(`${SAFETY_LOCK_KEY}:context`),
      redisClient.get('l4:grid:lock'),
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
      confidence_score: 1.0
    };

    const marketContext = marketContextRaw ? JSON.parse(marketContextRaw) : null;
    let safetyContext = safetyContextRaw ? JSON.parse(safetyContextRaw) : null;
    const regionalCapacity = regionalCapacityRaw ? JSON.parse(regionalCapacityRaw) : {};

    // Security Enhancement: Mask PII in safety context for reporting
    if (safetyContext) {
      if (safetyContext.vin) safetyContext.vin = '[MASKED]';
      if (safetyContext.vehicle_id) safetyContext.vehicle_id = '[MASKED]';
    }

    res.json({
      reports: result.rows,
      market_context: marketContext,
      regional_markets: unifiedContext.regional_markets,
      regional_capacity: Object.keys(unifiedContext.regional_capacity).length > 0 ? unifiedContext.regional_capacity : regionalCapacity,
      regional_stats: unifiedContext.digital_twin,
      regional_confidence: unifiedContext.regional_confidence,
      safety_lock: {
        active: safetyLock === '1' || safetyLock === 'true',
        context: safetyContext
      },
      grid_lock: {
        active: gridLock === '1' || gridLock === 'true',
        regional: unifiedContext.regional_locks
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
    // 1. Check Safety Lock from L1 Physics Engine
    const safetyLock = await redisClient.get(SAFETY_LOCK_KEY);
    if (safetyLock === '1' || safetyLock === 'true') {
      console.warn('🚨 [L2] DISPATCH REJECTED: L1 Safety Lock active');

      // Fetch context if available for richer error response
      const lockContext = await redisClient.get(`${SAFETY_LOCK_KEY}:context`);
      const details = lockContext ? JSON.parse(lockContext) : null;

      return res.status(503).json({
        status: 'REJECTED',
        reason: 'SAFETY_VIOLATION_L1',
        message: 'Grid dispatch suspended due to physics engine safety lock',
        details: details ? { alert_type: details.event_type, severity: details.severity } : 'No details available',
        timestamp: new Date().toISOString()
      });
    }

    // 1.1 Check L4 Grid Lock (Global and Regional) - Phase 5 Forward Engineering
    const gridLock = await redisClient.get('l4:grid:lock');
    // Normalize ISO Region: uppercase and remove hyphens for cross-layer consistency
    const isoRegion = (event.targets?.find(t => t.type === 'region')?.value || '').toUpperCase().replace(/-/g, '');
    const regionalLock = isoRegion ? await redisClient.get(`l4:grid:lock:${isoRegion}`) : null;

    // Fetch regional market metadata for broadcast enrichment
    let marketMetadata = {};
    if (isoRegion) {
      const marketRaw = await redisClient.get(`market:context:${isoRegion}`);
      if (marketRaw) {
        marketMetadata = JSON.parse(marketRaw);
      }
    }

    if (gridLock === 'true' || gridLock === '1' || regionalLock === 'true' || regionalLock === '1') {
      console.warn(`🚨 [L2] DISPATCH REJECTED: L4 Grid Lock active (Global: ${gridLock}, Regional: ${regionalLock})`);
      return res.status(503).json({
        status: 'REJECTED',
        reason: 'GRID_LOCK_ACTIVE',
        message: 'Grid dispatch suspended due to high-priority grid stability event',
        region: isoRegion || 'GLOBAL',
        timestamp: new Date().toISOString()
      });
    }

    // 1.2 Check L8 Safe Mode (Site Specific)
    if (event.site_id) {
      const safeMode = await redisClient.get(`l8:site:${event.site_id}:safe_mode`);
      if (safeMode === 'true' || safeMode === '1') {
        console.warn(`🚨 [L2] DISPATCH REJECTED: Site ${event.site_id} in L8 Safe Mode`);
        return res.status(503).json({
          status: 'REJECTED',
          reason: 'SITE_IN_SAFE_MODE',
          message: 'Grid dispatch suspended: Site energy manager is in Safe Mode (Meter Offline)',
          site_id: event.site_id,
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
    const siteStatus = event.site_id ? await redisClient.get(`l8:site:status:${event.site_id}`) : null;

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
      const confidenceScore = parseFloat((safetyContext.confidence_score !== undefined) ? safetyContext.confidence_score :
                                         (safetyContext.physics_score !== undefined ? safetyContext.physics_score : regionalAvgConfidence.toString()));
      const physicsScore = parseFloat(safetyContext.physics_score ?? '1.0000');
      // [L1-124] Aligned High-Fidelity Standard: physics > 0.95 OR confidence > 0.95
      const fidelityStatus = (physicsScore > 0.95 || confidenceScore > 0.95) ? 'HIGH_FIDELITY' : 'STANDARD';

      const regionalCapacity = unifiedContext?.regional_capacity?.[isoRegion] || null;
      await producer.send({
        topic: 'grid_signals',
        messages: [{
          value: JSON.stringify({
            event_id: event.id,
            program_id: event.program_id || 'DEFAULT',
            type: event.type,
            priority: event.priority || 'NORMAL',
            site_id: event.site_id || 'ALL',
            site_status: siteStatus || 'OPERATIONAL',
            v2g_requested: v2gRequested,
            der_control: Object.keys(derControl).length > 0 ? derControl : null,
            iso_region: isoRegion,
            regional_capacity: regionalCapacity, // L2 v2.4.4: Regional capacity breakdown (Total/EV/BESS)
            market_price_at_session: event.metadata?.market_price_at_session ?? (marketMetadata.price_per_mwh ?? 0), // L2 v2.4.1: Nullish coalescing for 0-price preservation
            profitability_index: marketMetadata.profitability_index,
            degradation_cost_mwh: marketMetadata.degradation_cost_mwh,
            physics_score: physicsScore,
            confidence_score: confidenceScore, // L2 v2.4.5: Prioritized confidence score for L11
            fidelity_status: fidelityStatus,
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
 */
app.get('/data/training/events', authenticateToken, async (req, res) => {
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
    regional_confidence: {}
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
            context.digital_twin[iso] = { vehicle_count: 0, high_fidelity_count: 0, ev_count: 0, bess_count: 0 };
            confidenceSums[iso] = 0;
          }
          context.digital_twin[iso].vehicle_count++;
          if (data) {
            // [L1-124] Aligned High-Fidelity Standard
            if (data.is_high_fidelity || data.physics_score > 0.95 || data.confidence_score > 0.95) {
              context.digital_twin[iso].high_fidelity_count++;
            }
            if (data.resource_type === 'EV') context.digital_twin[iso].ev_count++;
            if (data.resource_type === 'BESS') context.digital_twin[iso].bess_count++;

            // [L2-v2.4.6] Track confidence sum for regional average
            confidenceSums[iso] += parseFloat(data.confidence_score || '1.0');
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
        context.regional_confidence[iso] = parseFloat((confidenceSums[iso] / count).toFixed(4));
      } else {
        context.regional_confidence[iso] = 1.0;
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
        context.confidence_score = parseFloat((safetyContext.confidence_score !== undefined) ? safetyContext.confidence_score :
                                               (safetyContext.physics_score !== undefined ? safetyContext.physics_score : '1.0'));
      } catch (e) {}
    } else {
      context.confidence_score = 1.0; // Default to full confidence if no locks/alerts
    }

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
    topics: ['migrid.physics.alerts', 'MARKET_PRICE_UPDATED', 'migrid.l8.status', 'L8_SAFE_MODE_CHANGED'],
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const payload = JSON.parse(message.value.toString());

      if (topic === 'migrid.l8.status') {
        console.log(`[L2] Received status update from L8 for site ${payload.site_id}: ${payload.status}`);
        // Cache site status (e.g., SAFE_MODE, METER_OFFLINE)
        await redisClient.setEx(`l8:site:status:${payload.site_id}`, 3600, payload.status);
      } else if (topic === 'L8_SAFE_MODE_CHANGED') {
        const { site_id, safe_mode } = payload;
        console.log(`🛡️ [L2] L8 Safe Mode Change: Site ${site_id} is now ${safe_mode ? 'LOCKED' : 'RELEASED'}`);

        if (safe_mode) {
          await redisClient.sAdd('l3:vpp:safemode_sites', site_id.toString());
          await redisClient.setEx(`l8:site:status:${site_id}`, 3600, 'SAFE_MODE');
        } else {
          await redisClient.sRem('l3:vpp:safemode_sites', site_id.toString());
          await redisClient.setEx(`l8:site:status:${site_id}`, 3600, 'OPERATIONAL');
        }
      } else if (topic === 'migrid.physics.alerts') {
        // PHYSICS RULE: Trigger lock if CRITICAL/FRAUD OR if variance exceeds thresholds
        // [L2 v2.4.4] BESS Invariant: 10% variance threshold; EV Invariant: 15% threshold.
        const isCritical = payload.severity === 'CRITICAL' || payload.severity === 'FRAUD';
        const varianceThreshold = payload.resource_type === 'BESS' ? 10 : 15;
        const isHighVariance = payload.variance_pct > varianceThreshold;

        if (isHighVariance || isCritical) {
          const reason = isHighVariance ? 'HIGH_VARIANCE_THRESHOLD' : payload.event_type;

          // CORE INVARIANT: Respect physics variance thresholds from L1 Physics Engine
          if (isHighVariance) {
            console.error(`🚨 [L2] CRITICAL INVARIANT VIOLATION: Variance (${payload.variance_pct}%) exceeds ${varianceThreshold}% threshold for ${payload.resource_type || 'EV'} on Site ${payload.site_id}. Locking grid dispatch.`);
          } else {
            console.error(`🚨 [L2] L1 SAFETY ALERT: ${reason} on Site ${payload.site_id}. Region: ${payload.iso_region}. Locking grid dispatch.`);
          }

          // Detailed logging for engineering audit
          console.log(`[L2 Audit] Metadata: Vehicle=${payload.vehicle_id}, VIN=${payload.vin}, SoC=${payload.current_soc}%, Variance=${payload.variance_pct}%, Billing=${payload.billing_mode}, VPP_Active=${payload.vpp_active}, V2G_Active=${payload.v2g_active}`);

          // Unified Safety Lock: Set to '1' for L4 compatibility, with 15m TTL
          await redisClient.setEx(SAFETY_LOCK_KEY, 900, '1');

          // Store detailed alert context for UI/Diagnostics and downstream layer alignment
          await redisClient.setEx(`${SAFETY_LOCK_KEY}:context`, 900, JSON.stringify({
            ...payload,
            reason,
            message: isHighVariance ? `Variance (${payload.variance_pct}%) exceeds ${varianceThreshold}% threshold for ${payload.resource_type || 'EV'}` : undefined,
            billing_mode: payload.billing_mode,
            vpp_active: payload.vpp_active,
            v2g_active: payload.v2g_active,
            iso_region: payload.iso_region,
            market_price_at_session: payload.market_price_at_session,
            locked_at: new Date().toISOString()
          }));
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

module.exports = { app, producer, consumer, redisClient, startSafetyConsumer };

process.on('SIGTERM', async () => {
  console.log('[L2 Grid Signal] Shutting down...');
  await producer.disconnect();
  await consumer.disconnect();
  await redisClient.quit();
  await pool.end();
  process.exit(0);
});
