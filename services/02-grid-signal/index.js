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
    type: { type: 'string' },
    priority: { type: ['string', 'number'] },
    site_id: { type: 'string' },
    signals: { type: 'array' },
    targets: { type: 'array' },
    intervals: { type: 'array' }
  },
  required: ['id', 'type'],
  additionalProperties: false
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
    version: '2.3.0',
    status: 'healthy',
    layer: 'L2',
    openadr_version: '3.0.0'
  });
});

/**
 * Get OpenADR 3.0 Reports (VEN)
 * Returns recent grid events for compliance and auditing
 * Enhanced with Market Context from L4 and Safety Context from L1
 */
app.get('/openadr/v3/reports', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT event_id, event_type, status, received_at FROM grid_events ORDER BY received_at DESC LIMIT 50'
    );

    // Fetch latest market context from Redis (provided by L4)
    const marketContextRaw = await redisClient.get('market:latest:context');
    const marketContext = marketContextRaw ? JSON.parse(marketContextRaw) : null;

    // Phase 5 Enhancement: Aggregate all regional market contexts (Optimized with SCAN and MGET)
    const regionalMarkets = {};
    let cursor = 0;
    const marketKeys = [];
    do {
      const result = await redisClient.scan(cursor, { MATCH: 'market:context:*', COUNT: 100 });
      cursor = result.cursor;
      marketKeys.push(...result.keys);
    } while (cursor !== 0);

    if (marketKeys.length > 0) {
      const marketValues = await redisClient.mGet(marketKeys);
      marketKeys.forEach((key, index) => {
        const iso = key.split(':').pop();
        const value = marketValues[index];
        if (value) {
          regionalMarkets[iso] = JSON.parse(value);
        }
      });
    }

    // Fetch latest safety context from Redis (provided by L1)
    const safetyLock = await redisClient.get(SAFETY_LOCK_KEY);
    const safetyContextRaw = await redisClient.get(`${SAFETY_LOCK_KEY}:context`);
    const safetyContext = safetyContextRaw ? JSON.parse(safetyContextRaw) : null;

    // Fetch grid lock status (provided by L4)
    const gridLock = await redisClient.get('l4:grid:lock');

    // Fetch regional grid locks (Optimized with SCAN and MGET)
    const regionalLocks = {};
    let lockCursor = 0;
    const lockKeys = [];
    do {
      const result = await redisClient.scan(lockCursor, { MATCH: 'l4:grid:lock:*', COUNT: 100 });
      lockCursor = result.cursor;
      lockKeys.push(...result.keys);
    } while (lockCursor !== 0);

    if (lockKeys.length > 0) {
      const lockValues = await redisClient.mGet(lockKeys);
      lockKeys.forEach((key, index) => {
        const region = key.split(':').pop();
        const value = lockValues[index];
        if (value === '1' || value === 'true') {
          regionalLocks[region] = true;
        }
      });
    }

    res.json({
      reports: result.rows,
      market_context: marketContext,
      regional_markets: regionalMarkets,
      safety_lock: {
        active: safetyLock === '1' || safetyLock === 'true',
        context: safetyContext
      },
      grid_lock: {
        active: gridLock === '1' || gridLock === 'true',
        regional: regionalLocks
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[L2 Grid Signal] Report Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
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
    const isoRegion = event.targets?.find(t => t.type === 'region')?.value;
    const regionalLock = isoRegion ? await redisClient.get(`l4:grid:lock:${isoRegion.toUpperCase()}`) : null;

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

    console.log('📢 [L2] Received OpenADR Event:', event.id);

    // 1.1 V2G Detection Logic (Phase 5 Forward Engineering)
    const v2gRequested = (event.type === 'discharge' ||
                          (event.signals && event.signals.some(s => s.value < 0 || s.type === 'discharge')));

    // 2. Save event to ledger
    await pool.query(
      'INSERT INTO grid_events (event_id, event_type, payload, status, received_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (event_id) DO NOTHING',
      [event.id, event.type || 'demand-response', JSON.stringify(event), 'active']
    );

    // 3. Cache event in Redis for 1 hour
    await redisClient.setEx(`event:${event.id}`, 3600, JSON.stringify(event));

    // 4. Broadcast enriched event to other services via Kafka
    // Enhanced resilience: Wrap in try-catch with retry awareness
    try {
      await producer.send({
        topic: 'grid_signals',
        messages: [{
          value: JSON.stringify({
            event_id: event.id,
            type: event.type,
            priority: event.priority || 'NORMAL',
            site_id: event.site_id || 'ALL',
            v2g_requested: v2gRequested,
            iso_region: isoRegion,
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
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
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
 * Listen for cross-layer Kafka events (L1 Safety & L4 Market)
 * Aligned with Phase 5: Forward engineering for market-aware reporting
 */
async function startSafetyConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['migrid.physics.alerts', 'MARKET_PRICE_UPDATED'], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const payload = JSON.parse(message.value.toString());

      if (topic === 'migrid.physics.alerts') {
        // PHYSICS RULE: Trigger lock if CRITICAL/FRAUD OR if variance exceeds 15%
        const isCritical = payload.severity === 'CRITICAL' || payload.severity === 'FRAUD';
        const isHighVariance = payload.variance_pct > 15;

        if (isHighVariance || isCritical) {
          const reason = isHighVariance ? 'HIGH_VARIANCE_THRESHOLD' : payload.event_type;
          console.error(`🚨 [L2] L1 SAFETY ALERT: ${reason} on Site ${payload.site_id}. Region: ${payload.iso_region}. Locking grid dispatch.`);

          // Detailed logging for engineering audit
          console.log(`[L2 Audit] Metadata: Vehicle=${payload.vehicle_id}, VIN=${payload.vin}, SoC=${payload.current_soc}%, Variance=${payload.variance_pct}%, Billing=${payload.billing_mode}, VPP_Active=${payload.vpp_active}, V2G_Active=${payload.v2g_active}`);

          // Unified Safety Lock: Set to '1' for L4 compatibility, with 15m TTL
          await redisClient.setEx(SAFETY_LOCK_KEY, 900, '1');

          // Store detailed alert context for UI/Diagnostics and downstream layer alignment
          await redisClient.setEx(`${SAFETY_LOCK_KEY}:context`, 900, JSON.stringify({
            ...payload,
            reason,
            billing_mode: payload.billing_mode,
            vpp_active: payload.vpp_active,
            v2g_active: payload.v2g_active,
            iso_region: payload.iso_region,
            locked_at: new Date().toISOString()
          }));
        }
      } else if (topic === 'MARKET_PRICE_UPDATED') {
        console.log(`[L2] Received market update for ${payload.iso}: $${payload.price_per_mwh}/MWh`);

        const marketContext = JSON.stringify({
          iso: payload.iso,
          price_per_mwh: payload.price_per_mwh,
          profitability_index: payload.profitability_index,
          updated_at: payload.timestamp
        });

        // Cache the latest market context with a 10-minute TTL (600s) for reporting enrichment
        await redisClient.setEx('market:latest:context', 600, marketContext);

        // Phase 5 Enhancement: Store ISO-specific context for regional visibility
        await redisClient.setEx(`market:context:${payload.iso.toUpperCase()}`, 600, marketContext);
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
