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
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
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
    version: '2.1.0',
    status: 'healthy',
    layer: 'L2',
    openadr_version: '3.0.0'
  });
});

/**
 * Get OpenADR 3.0 Reports (VEN)
 * Returns recent grid events for compliance and auditing
 */
app.get('/openadr/v3/reports', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT event_id, event_type, status, received_at FROM grid_events ORDER BY received_at DESC LIMIT 50'
    );
    res.json({
      reports: result.rows,
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

    console.log('📢 [L2] Received OpenADR Event:', event.id);

    // 2. Save event to ledger
    await pool.query(
      'INSERT INTO grid_events (event_id, event_type, payload, status, received_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (event_id) DO NOTHING',
      [event.id, event.type || 'demand-response', JSON.stringify(event), 'active']
    );

    // 3. Cache event in Redis for 1 hour
    await redisClient.setEx(`event:${event.id}`, 3600, JSON.stringify(event));

    // 4. Broadcast enriched event to other services via Kafka
    // Mapping OpenADR 3.0 fields for L3/L8 consumption
    await producer.send({
      topic: 'grid_signals',
      messages: [{
        value: JSON.stringify({
          event_id: event.id,
          type: event.type,
          priority: event.priority || 'NORMAL',
          site_id: event.site_id || 'ALL',
          intervals: event.intervals || [],
          targets: event.targets || [],
          signals: event.signals || [],
          payload: event,
          timestamp: new Date().toISOString()
        })
      }]
    });

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
 * Listen for L1 Physics Alerts to manage Safety Lock
 * Aligned with Phase 5: Handling granular metadata and unified safety lock
 */
async function startSafetyConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'migrid.physics.alerts', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const alert = JSON.parse(message.value.toString());

      // PHYSICS RULE: Trigger lock if CRITICAL/FRAUD OR if variance exceeds 15%
      const isCritical = alert.severity === 'CRITICAL' || alert.severity === 'FRAUD';
      const isHighVariance = alert.variance_pct > 15;

      if (isCritical || isHighVariance) {
        const reason = isHighVariance ? 'HIGH_VARIANCE_THRESHOLD' : alert.event_type;
        console.error(`🚨 [L2] L1 SAFETY ALERT: ${reason} on Site ${alert.site_id}. Locking grid dispatch.`);

        // Detailed logging for engineering audit
        console.log(`[L2 Audit] Metadata: Vehicle=${alert.vehicle_id}, VIN=${alert.vin}, SoC=${alert.current_soc}%, Variance=${alert.variance_pct}%, Billing=${alert.billing_mode}, VPP_Active=${alert.vpp_active}`);

        // Unified Safety Lock: Set to '1' for L4 compatibility, with 15m TTL
        await redisClient.setEx(SAFETY_LOCK_KEY, 900, '1');

        // Store detailed alert context for UI/Diagnostics and downstream layer alignment
        await redisClient.setEx(`${SAFETY_LOCK_KEY}:context`, 900, JSON.stringify({
          ...alert,
          reason,
          billing_mode: alert.billing_mode,
          vpp_active: alert.vpp_active,
          locked_at: new Date().toISOString()
        }));
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
