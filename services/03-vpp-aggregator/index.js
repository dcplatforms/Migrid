/**
 * L3: VPP Aggregator Service
 * Aggregates EV fleet and BESS capacity for wholesale market participation
 */

const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');

const app = express();
const port = process.env.PORT || 3003;

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Kafka connection
const kafka = new Kafka({
  clientId: 'vpp-aggregator',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: 'vpp-aggregator-group' });

app.use(express.json());

/**
 * Middleware: Verify JWT token
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'vpp-aggregator',
    version: '3.0.0',
    status: 'healthy',
    layer: 'L3'
  });
});

// Get available capacity
app.get('/capacity/available', authenticateToken, async (req, res) => {
  try {
    // Try to serve from Redis first for L4 performance SLA (<50ms)
    const cachedCapacity = await redisClient.get(`vpp:capacity:available:${req.user.fleet_id}`);
    if (cachedCapacity) {
      return res.json(JSON.parse(cachedCapacity));
    }

    const result = await pool.query(`
      SELECT
        SUM(
          GREATEST(0, (v.current_soc - GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)) / 100.0)
          * v.battery_capacity_kwh
          * COALESCE(v.availability_factor, 1.0)
        ) as total_capacity_kwh,
        COUNT(*) as vehicle_count
      FROM vehicles v
      WHERE v.is_plugged_in = true
        AND v.v2g_enabled = true
        AND v.current_soc > GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)
        AND v.fleet_id = $1
    `, [req.user.fleet_id]);

    const capacity = result.rows[0];
    const response = {
      available_capacity_kwh: parseFloat(capacity.total_capacity_kwh || 0),
      available_capacity_kw: parseFloat(capacity.total_capacity_kwh || 0), // Assuming 1-hour discharge for kW estimate
      resource_count: parseInt(capacity.vehicle_count || 0),
      timestamp: new Date().toISOString(),
      source: 'database'
    };

    // Cache the result for 10 seconds
    await redisClient.setEx(
      `vpp:capacity:available:${req.user.fleet_id}`,
      10,
      JSON.stringify(response)
    );

    // Global capacity key for L4 Market Gateway
    await redisClient.set('vpp:capacity:available', capacity.total_capacity_kwh || 0);

    res.json(response);
  } catch (error) {
    console.error('[VPP Aggregator] Capacity retrieval error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Register resource
app.post('/resources/register', authenticateToken, async (req, res) => {
  const { vehicle_id, battery_capacity_kwh, v2g_enabled } = req.body;

  if (!vehicle_id || typeof vehicle_id !== 'string' || typeof battery_capacity_kwh !== 'number' || typeof v2g_enabled !== 'boolean') {
    return res.status(400).json({ error: 'Invalid input parameters' });
  }

  if (battery_capacity_kwh < 50) {
    return res.status(400).json({ error: 'Minimum battery capacity is 50 kWh' });
  }

  try {
    const vehicleCheck = await pool.query('SELECT fleet_id FROM vehicles WHERE id = $1', [vehicle_id]);

    if (vehicleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicleCheck.rows[0].fleet_id !== req.user.fleet_id) {
      return res.status(403).json({ error: 'Unauthorized: Fleet mismatch' });
    }

    await pool.query(`
      INSERT INTO vpp_resources (vehicle_id, battery_capacity_kwh, v2g_enabled, registered_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        battery_capacity_kwh = $2, v2g_enabled = $3, updated_at = NOW()
    `, [vehicle_id, battery_capacity_kwh, v2g_enabled]);

    res.json({ success: true, message: 'Resource registered' });
  } catch (error) {
    console.error('[VPP Aggregator] Resource registration error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * Initialize Kafka Consumers
 */
const initKafka = async () => {
  try {
    await consumer.connect();
    await consumer.subscribe({ topics: ['migrid.physics.alerts', 'grid_signals'], fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const payload = JSON.parse(message.value.toString());
        console.log(`📥 [VPP Aggregator] Received Kafka message [${topic}]:`, payload);

        if (topic === 'migrid.physics.alerts' && payload.event_type === 'CAPACITY_VIOLATION') {
          console.warn(`⚠️ [VPP Aggregator] Physics alert: Resource ${payload.vehicle_id} hit safety limit.`);
          // Trigger capacity refresh/invalidation
          await redisClient.del(`vpp:capacity:available:${payload.fleet_id}`);
        }

        if (topic === 'grid_signals') {
          console.log(`⚡ [VPP Aggregator] Grid Signal received: ${payload.event_id}. Sequence initiated.`);
          // TODO: Implement automated dispatch sequence
        }
      },
    });
    console.log('✅ [VPP Aggregator] Kafka Consumers initialized.');
  } catch (error) {
    console.error('❌ [VPP Aggregator] Kafka initialization error:', error);
  }
};

// Start server
app.listen(port, async () => {
  console.log(`[VPP Aggregator] Running on port ${port}`);
  await redisClient.connect();
  await initKafka();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[VPP Aggregator] Shutting down gracefully...');
  await consumer.disconnect();
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});
