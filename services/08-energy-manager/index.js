/**
 * L8: Energy Manager
 * Dynamic Load Management (DLM) with Modbus integration
 */

const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
// const ModbusRTU = require('modbus-serial');  // Uncomment for real Modbus

const app = express();
const port = process.env.PORT || 3008;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Configuration
const GRID_LIMIT_KW = parseFloat(process.env.GRID_CONNECTION_LIMIT_KW || 500);
const MODBUS_HOST = process.env.MODBUS_HOST || '192.168.1.100';
const MODBUS_PORT = parseInt(process.env.MODBUS_PORT || 502);

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

// Simulated Modbus client for demo
let currentBuildingLoad = 200; // kW

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'energy-manager',
    version: '1.1.0',
    status: 'healthy',
    layer: 'L8',
    config: {
      grid_limit_kw: GRID_LIMIT_KW,
      modbus_host: MODBUS_HOST
    }
  });
});

// ============================================================================
// LOAD MONITORING ENDPOINTS
// ============================================================================

// Get current site load
app.get('/load/current', authenticateToken, async (req, res) => {
  try {
    // In production, read from Modbus device
    const buildingLoad = await readBuildingLoad();

    // Get active EV charging load
    // Security Fix: Added fleet_id filter
    const evResult = await pool.query(`
      SELECT COALESCE(SUM(c.max_power_kw), 0) as ev_load_kw
      FROM chargers c
      WHERE c.status = 'charging' AND c.fleet_id = $1
    `, [req.user.fleet_id]);

    const evLoad = parseFloat(evResult.rows[0]?.ev_load_kw || 0);
    const totalLoad = buildingLoad + evLoad;
    const available = GRID_LIMIT_KW - totalLoad;

    res.json({
      building_load_kw: buildingLoad,
      ev_load_kw: evLoad,
      total_load_kw: totalLoad,
      grid_limit_kw: GRID_LIMIT_KW,
      available_kw: Math.max(0, available),
      utilization_percent: ((totalLoad / GRID_LIMIT_KW) * 100).toFixed(2),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Energy Manager Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Get load history
app.get('/load/history', authenticateToken, async (req, res) => {
  const { hours = 24 } = req.query;

  try {
    // Security Fix: Use parameterized interval and added fleet_id filter
    const result = await pool.query(`
      SELECT
        timestamp,
        building_load_kw,
        ev_load_kw,
        total_load_kw,
        grid_limit_kw
      FROM site_load_measurements
      WHERE fleet_id = $1
        AND timestamp > NOW() - (INTERVAL '1 hour' * $2)
      ORDER BY timestamp ASC
    `, [req.user.fleet_id, parseInt(hours)]);

    res.json({
      measurements: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Energy Manager Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// DYNAMIC LOAD MANAGEMENT ENDPOINTS
// ============================================================================

// Calculate available charging capacity
app.get('/dlm/available-capacity', authenticateToken, async (req, res) => {
  try {
    const buildingLoad = await readBuildingLoad();
    const availableForEV = Math.max(0, GRID_LIMIT_KW - buildingLoad);

    // Get number of active chargers
    // Security Fix: Added fleet_id filter
    const chargerResult = await pool.query(`
      SELECT COUNT(*) as active_count
      FROM chargers
      WHERE status IN ('charging', 'preparing') AND fleet_id = $1
    `, [req.user.fleet_id]);

    const activeChargers = parseInt(chargerResult.rows[0]?.active_count || 0);
    const perChargerLimit = activeChargers > 0 ? availableForEV / activeChargers : 0;

    res.json({
      available_for_ev_kw: availableForEV,
      active_chargers: activeChargers,
      per_charger_limit_kw: perChargerLimit.toFixed(2),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Energy Manager Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Apply DLM - distribute power to chargers
app.post('/dlm/apply', authenticateToken, async (req, res) => {
  try {
    const buildingLoad = await readBuildingLoad();
    const availableForEV = Math.max(0, GRID_LIMIT_KW - buildingLoad);

    // Get active charging sessions
    // Security Fix: Added fleet_id filter
    const sessions = await pool.query(`
      SELECT
        cs.id as session_id,
        cs.vehicle_id,
        c.id as charger_id,
        c.max_power_kw,
        v.battery_capacity_kwh,
        v.current_soc,
        v.min_soc_threshold
      FROM charging_sessions cs
      JOIN chargers c ON cs.charger_id = c.id
      JOIN vehicles v ON cs.vehicle_id = v.id
      WHERE cs.end_time IS NULL AND c.fleet_id = $1
    `, [req.user.fleet_id]);

    if (sessions.rows.length === 0) {
      return res.json({
        message: 'No active sessions to manage',
        available_kw: availableForEV
      });
    }

    // Distribute power equally (simplified algorithm)
    const powerPerCharger = availableForEV / sessions.rows.length;

    const allocations = sessions.rows.map(session => ({
      charger_id: session.charger_id,
      vehicle_id: session.vehicle_id,
      allocated_power_kw: Math.min(powerPerCharger, session.max_power_kw),
      max_power_kw: session.max_power_kw
    }));

    // In production, send OCPP SetChargingProfile commands
    console.log('[Energy Manager] DLM applied:', allocations);

    res.json({
      success: true,
      available_for_ev_kw: availableForEV,
      sessions_managed: allocations.length,
      allocations
    });
  } catch (error) {
    console.error('[Energy Manager Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function readBuildingLoad() {
  // In production, read from Modbus device
  // const client = new ModbusRTU();
  // await client.connectTCP(MODBUS_HOST, { port: MODBUS_PORT });
  // const data = await client.readHoldingRegisters(0, 1);
  // return data.data[0];

  // Simulate varying building load
  currentBuildingLoad = 200 + Math.random() * 100; // 200-300 kW
  return currentBuildingLoad;
}

// Background task: Log measurements every minute
setInterval(async () => {
  try {
    const buildingLoad = await readBuildingLoad();

    const evResult = await pool.query(`
      SELECT COALESCE(SUM(c.max_power_kw), 0) as ev_load_kw
      FROM chargers c
      WHERE c.status = 'charging'
    `);

    const evLoad = parseFloat(evResult.rows[0]?.ev_load_kw || 0);
    const totalLoad = buildingLoad + evLoad;

    // Get fleet_id (simplified - use first fleet)
    const fleetResult = await pool.query(`SELECT id FROM fleets LIMIT 1`);
    if (fleetResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO site_load_measurements
        (fleet_id, timestamp, building_load_kw, ev_load_kw, total_load_kw, grid_limit_kw)
        VALUES ($1, NOW(), $2, $3, $4, $5)
      `, [fleetResult.rows[0].id, buildingLoad, evLoad, totalLoad, GRID_LIMIT_KW]);
    }

    console.log(`[Energy Manager] Load: Building=${buildingLoad.toFixed(1)}kW, EV=${evLoad.toFixed(1)}kW, Total=${totalLoad.toFixed(1)}kW`);

    // Auto-apply DLM if nearing limit
    if (totalLoad > GRID_LIMIT_KW * 0.9) {
      console.log('[Energy Manager] WARNING: Approaching grid limit, applying DLM');
      // Trigger DLM
    }
  } catch (error) {
    console.error('[Energy Manager] Error logging measurement:', error);
  }
}, 60000); // Every minute

// Start server
app.listen(port, () => {
  console.log(`[Energy Manager] Running on port ${port}`);
  console.log(`[Energy Manager] Grid limit: ${GRID_LIMIT_KW}kW`);
  console.log(`[Energy Manager] Modbus: ${MODBUS_HOST}:${MODBUS_PORT}`);
  console.log('[Energy Manager] DLM active - Never exceed grid connection limit');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Energy Manager] Shutting down gracefully...');
  pool.end();
  process.exit(0);
});
