/**
 * L5: Driver Experience API
 * Mobile app backend with authentication, smart routing, and rewards
 */

const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3005;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

app.use(express.json());

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
    service: 'driver-experience-api',
    version: '4.0.0',
    status: 'healthy',
    layer: 'L5'
  });
});

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

// Register new driver
app.post('/auth/register', async (req, res) => {
  const { email, password, first_name, last_name, fleet_id } = req.body;

  try {
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create driver
    const result = await pool.query(`
      INSERT INTO drivers (fleet_id, email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, first_name, last_name
    `, [fleet_id, email, password_hash, first_name, last_name]);

    const driver = result.rows[0];

    // Create wallet for driver
    await pool.query(`
      INSERT INTO driver_wallets (driver_id, escrow_balance)
      VALUES ($1, 0)
    `, [driver.id]);

    res.status(201).json({
      success: true,
      driver: {
        id: driver.id,
        email: driver.email,
        first_name: driver.first_name,
        last_name: driver.last_name
      }
    });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Email already registered' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(`
      SELECT id, email, password_hash, first_name, last_name, fleet_id
      FROM drivers
      WHERE email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const driver = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, driver.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { driver_id: driver.id, email: driver.email, fleet_id: driver.fleet_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      driver: {
        id: driver.id,
        email: driver.email,
        first_name: driver.first_name,
        last_name: driver.last_name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current driver profile
app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.email, d.first_name, d.last_name, d.fleet_id,
             dw.escrow_balance, dw.blockchain_balance
      FROM drivers d
      LEFT JOIN driver_wallets dw ON d.id = dw.driver_id
      WHERE d.id = $1
    `, [req.user.driver_id]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CHARGER & ROUTING ENDPOINTS
// ============================================================================

// Find nearby chargers (restricted to driver's fleet)
app.get('/chargers/nearby', authenticateToken, async (req, res) => {
  const { lat, lng, radius = 10 } = req.query;

  try {
    // Security Fix: Added fleet_id filter to prevent cross-fleet charger enumeration
    // In production, use PostGIS for geospatial queries
    const result = await pool.query(`
      SELECT c.id, c.charger_id, c.name, c.location,
             c.max_power_kw, c.status, c.last_heartbeat_at
      FROM chargers c
      WHERE c.status = 'available' AND c.fleet_id = $1
      ORDER BY c.max_power_kw DESC
      LIMIT 20
    `, [req.user.fleet_id]);

    res.json({
      chargers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    // Security Fix: Generic error message to prevent information leakage
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Get charger details (restricted to driver's fleet)
app.get('/chargers/:id', authenticateToken, async (req, res) => {
  try {
    // Security Fix: Added fleet_id filter to prevent Insecure Direct Object Reference (IDOR)
    const result = await pool.query(`
      SELECT id, charger_id, name, location, max_power_kw, status, last_heartbeat_at
      FROM chargers
      WHERE id = $1 AND fleet_id = $2
    `, [req.params.id, req.user.fleet_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Charger not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    // Security Fix: Generic error message to prevent information leakage
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// CHARGING SESSION ENDPOINTS
// ============================================================================

// Get driver's charging sessions
app.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cs.*, v.make, v.model, c.name as charger_name
      FROM charging_sessions cs
      JOIN vehicles v ON cs.vehicle_id = v.id
      JOIN chargers c ON cs.charger_id = c.id
      WHERE cs.driver_id = $1
      ORDER BY cs.start_time DESC
      LIMIT 50
    `, [req.user.driver_id]);

    res.json({
      sessions: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active session
app.get('/sessions/active', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cs.*, v.make, v.model, c.name as charger_name, c.max_power_kw
      FROM charging_sessions cs
      JOIN vehicles v ON cs.vehicle_id = v.id
      JOIN chargers c ON cs.charger_id = c.id
      WHERE cs.driver_id = $1 AND cs.end_time IS NULL
      LIMIT 1
    `, [req.user.driver_id]);

    if (result.rows.length === 0) {
      return res.json({ active_session: null });
    }

    res.json({ active_session: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// REWARDS ENDPOINTS
// ============================================================================

// Get reward balance
app.get('/rewards/balance', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT escrow_balance, blockchain_balance,
             (escrow_balance + blockchain_balance) as total_balance
      FROM driver_wallets
      WHERE driver_id = $1
    `, [req.user.driver_id]);

    if (result.rows.length === 0) {
      return res.json({ escrow_balance: 0, blockchain_balance: 0, total_balance: 0 });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get reward history
app.get('/rewards/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT event_type, tokens_awarded, reason, awarded_at
      FROM token_reward_log
      WHERE driver_id = $1
      ORDER BY awarded_at DESC
      LIMIT 100
    `, [req.user.driver_id]);

    res.json({
      rewards: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// VOICE COMMAND ENDPOINT
// ============================================================================

// Process voice command
app.post('/voice/command', authenticateToken, async (req, res) => {
  const { command_text } = req.body;

  try {
    // Simple command parsing
    const lowerCommand = command_text.toLowerCase();

    if (lowerCommand.includes('start charging')) {
      return res.json({
        action: 'start_charging',
        message: 'Starting charging session...',
        success: true
      });
    }

    if (lowerCommand.includes('stop charging')) {
      return res.json({
        action: 'stop_charging',
        message: 'Stopping charging session...',
        success: true
      });
    }

    if (lowerCommand.includes('balance') || lowerCommand.includes('rewards')) {
      const balance = await pool.query(`
        SELECT (escrow_balance + blockchain_balance) as total
        FROM driver_wallets WHERE driver_id = $1
      `, [req.user.driver_id]);

      return res.json({
        action: 'check_balance',
        message: `Your reward balance is ${balance.rows[0]?.total || 0} tokens`,
        data: balance.rows[0],
        success: true
      });
    }

    res.json({
      action: 'unknown',
      message: 'I didn\'t understand that command. Try "start charging" or "check balance".',
      success: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`[Driver Experience API] Running on port ${port}`);
  console.log('[Driver Experience API] Features: Auth, Smart Routing, Voice Commands, Rewards');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Driver Experience API] Shutting down gracefully...');
  pool.end();
  process.exit(0);
});
