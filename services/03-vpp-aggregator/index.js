/**
 * L3: VPP Aggregator Service
 * Aggregates EV fleet and BESS capacity for wholesale market participation
 */

const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');

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
app.get('/capacity/available', async (req, res) => {
  try {
    // Calculate: Σ(vehicle_soc × battery_capacity × availability_factor)
    const result = await pool.query(`
      SELECT
        SUM(v.current_soc * v.battery_capacity_kwh * v.availability_factor) as total_capacity_kwh,
        COUNT(*) as vehicle_count
      FROM vehicles v
      WHERE v.is_plugged_in = true
        AND v.v2g_enabled = true
        AND v.current_soc > v.min_soc_threshold
    `);

    const capacity = result.rows[0];
    res.json({
      available_capacity_kwh: parseFloat(capacity.total_capacity_kwh || 0),
      available_capacity_kw: parseFloat(capacity.total_capacity_kwh || 0), // Simplified
      resource_count: parseInt(capacity.vehicle_count || 0),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register resource
app.post('/resources/register', async (req, res) => {
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
    res.status(500).json({ error: error.message });
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
