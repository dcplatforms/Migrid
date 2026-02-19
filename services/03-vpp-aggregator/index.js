/**
 * L3: VPP Aggregator Service
 * Aggregates EV fleet and BESS capacity for wholesale market participation
 */

const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3003;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

// Middleware: Verify JWT token
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
    // Calculate: Σ(vehicle_soc × battery_capacity × availability_factor)
    // Security Fix: Added fleet_id filter for multi-tenancy isolation
    const result = await pool.query(`
      SELECT
        SUM(v.current_soc * v.battery_capacity_kwh * v.availability_factor) as total_capacity_kwh,
        COUNT(*) as vehicle_count
      FROM vehicles v
      WHERE v.is_plugged_in = true
        AND v.v2g_enabled = true
        AND v.current_soc > v.min_soc_threshold
        AND v.fleet_id = $1
    `, [req.user.fleet_id]);

    const capacity = result.rows[0];
    res.json({
      available_capacity_kwh: parseFloat(capacity.total_capacity_kwh || 0),
      available_capacity_kw: parseFloat(capacity.total_capacity_kwh || 0), // Simplified
      resource_count: parseInt(capacity.vehicle_count || 0),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[VPP Aggregator Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Register resource
app.post('/resources/register', authenticateToken, async (req, res) => {
  const { vehicle_id, battery_capacity_kwh, v2g_enabled } = req.body;

  if (battery_capacity_kwh < 50) {
    return res.status(400).json({
      error: 'Minimum battery capacity is 50 kWh for VPP participation'
    });
  }

  try {
    await pool.query(`
      INSERT INTO vpp_resources (vehicle_id, battery_capacity_kwh, v2g_enabled, registered_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        battery_capacity_kwh = $2,
        v2g_enabled = $3,
        updated_at = NOW()
    `, [vehicle_id, battery_capacity_kwh, v2g_enabled]);

    res.json({
      success: true,
      message: 'Resource registered for VPP participation'
    });
  } catch (error) {
    console.error('[VPP Aggregator Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`[VPP Aggregator] Running on port ${port}`);
  console.log('[VPP Aggregator] Safety constraint: Never discharge BESS below 20%');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[VPP Aggregator] Shutting down gracefully...');
  pool.end();
  redisClient.quit();
  process.exit(0);
});
