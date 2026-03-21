/**
 * L5: Driver Experience API
 * Mobile app backend with authentication, smart routing, and rewards
 */

const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const notifications = require('./notifications');

const app = express();
const port = process.env.PORT || 3005;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Initialize Notification Service with the same pool
notifications.init(pool);

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

// Kafka Setup for broadcasting VPP opt-out events
const kafka = new Kafka({
  clientId: 'driver-experience-api',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});
const producer = kafka.producer();

// Resilient Kafka connection handler
let kafkaConnected = false;
const connectKafka = async () => {
    try {
        await producer.connect();
        kafkaConnected = true;
        console.log('[L5 API] Kafka producer connected');
    } catch (err) {
        console.error('[L5 API] Failed to connect to Kafka:', err.message);
        // Retry in 10 seconds
        setTimeout(connectKafka, 10000);
    }
};
connectKafka();

app.use(express.json());

// Rate limiting state: In-memory Maps to track attempts
const loginAttempts = new Map();
const registrationAttempts = new Map();

/**
 * Middleware: Simple rate limiter for login attempts
 */
const loginRateLimiter = (req, res, next) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') return next();

  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 5;

  const attempts = (loginAttempts.get(email) || [])
    .filter(timestamp => now - timestamp < windowMs);

  if (attempts.length >= maxAttempts) {
    console.warn(`[Security] Rate limit exceeded for email: ${email}`);
    return res.status(429).json({
      error: 'Too many login attempts. Please try again later.'
    });
  }

  attempts.push(now);
  loginAttempts.set(email, attempts);
  next();
};

/**
 * Middleware: IP-based rate limiter for registration
 */
const registrationRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxAttempts = 3;

  const attempts = (registrationAttempts.get(ip) || [])
    .filter(timestamp => now - timestamp < windowMs);

  if (attempts.length >= maxAttempts) {
    console.warn(`[Security] Registration rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({
      error: 'Too many registration attempts from this IP. Please try again later.'
    });
  }

  attempts.push(now);
  registrationAttempts.set(ip, attempts);
  next();
};

// Middleware: Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'driver-experience-api',
    version: '4.1.0',
    status: 'healthy',
    kafka_connected: kafkaConnected,
    layer: 'L5'
  });
});

// ============================================================================
// AUTHENTICATION & PROFILE ENDPOINTS
// ============================================================================

// Register new driver (With Transaction and Security Sanitization)
app.post('/auth/register', registrationRateLimiter, async (req, res) => {
  const client = await pool.connect();
  const { email, password, first_name, last_name, fleet_id } = req.body;

  try {
    await client.query('BEGIN');
    const password_hash = await bcrypt.hash(password, 10);

    // 1. Insert Driver
    const driverResult = await client.query(`
      INSERT INTO drivers (fleet_id, email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, first_name, last_name, fleet_id, created_at
    `, [fleet_id, email, password_hash, first_name, last_name]);

    const driver = driverResult.rows[0];

    // 2. Create wallet for driver
    const mockOpenWalletAddress = `OW-${driver.id.substring(0, 8)}-${Date.now()}`;
    await client.query(`
      INSERT INTO driver_wallets (driver_id, open_wallet_address, escrow_balance)
      VALUES ($1, $2, 0)
    `, [driver.id, mockOpenWalletAddress]);

    // 3. Initialize driver preferences
    await client.query(`
        INSERT INTO driver_preferences (driver_id, preferred_billing_mode, vpp_participation_active)
        VALUES ($1, 'FLEET', true)
        ON CONFLICT (driver_id) DO NOTHING
    `, [driver.id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, driver });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Registration Error]', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Email already registered' });
    } else {
      res.status(500).json({ error: 'An internal server error occurred' });
    }
  } finally {
    client.release();
  }
});

// Login (With Security Sanitization)
app.post('/auth/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(`
      SELECT id, email, password_hash, first_name, last_name, fleet_id
      FROM drivers WHERE email = $1
    `, [email]);

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const driver = result.rows[0];
    const validPassword = await bcrypt.compare(password, driver.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { driver_id: driver.id, email: driver.email, fleet_id: driver.fleet_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Sanitize response: Exclude password_hash
    const { password_hash, ...driverData } = driver;

    res.json({ success: true, token, driver: driverData });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Get current driver profile
app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.email, d.first_name, d.last_name, d.fleet_id, d.is_plug_and_charge_ready,
             dw.escrow_balance, dw.blockchain_balance, dw.open_wallet_address,
             dp.preferred_billing_mode, dp.min_target_soc, dp.target_departure_time, dp.vpp_participation_active
      FROM drivers d
      LEFT JOIN driver_wallets dw ON d.id = dw.driver_id
      LEFT JOIN driver_preferences dp ON d.id = dp.driver_id
      WHERE d.id = $1
    `, [req.user.driver_id]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Profile Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Update Mobility Preferences & VPP Toggle
app.patch('/profile/mobility-preferences', authenticateToken, async (req, res) => {
    const { min_target_soc, target_departure_time, vpp_participation_active, preferred_billing_mode } = req.body;

    try {
        const result = await pool.query(`
            UPDATE driver_preferences
            SET min_target_soc = COALESCE($1, min_target_soc),
                target_departure_time = COALESCE($2, target_departure_time),
                vpp_participation_active = COALESCE($3, vpp_participation_active),
                preferred_billing_mode = COALESCE($4, preferred_billing_mode),
                updated_at = NOW()
            WHERE driver_id = $5
            RETURNING *
        `, [min_target_soc, target_departure_time, vpp_participation_active, preferred_billing_mode, req.user.driver_id]);

        // Broadcast VPP opt-out to L3 Aggregator via Kafka if participation changed
        if (vpp_participation_active !== undefined && kafkaConnected) {
            await producer.send({
                topic: 'vpp_participation_updates',
                messages: [{
                    key: req.user.driver_id,
                    value: JSON.stringify({
                        driver_id: req.user.driver_id,
                        vpp_participation_active,
                        timestamp: new Date()
                    })
                }]
            });
        }

        notifications.queueForBatch(req.user.driver_id, 'Mobility preferences updated successfully.');
        res.json({ success: true, preferences: result.rows[0] });
    } catch (error) {
        console.error('[Update Preferences Error]', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

// Push Token Registration
app.post('/notifications/register', authenticateToken, async (req, res) => {
    const { expo_push_token } = req.body;
    try {
        await pool.query('UPDATE drivers SET expo_push_token = $1 WHERE id = $2', [expo_push_token, req.user.driver_id]);
        res.json({ success: true, message: 'Push token registered' });
    } catch (error) {
        console.error('[Push Register Error]', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

// ============================================================================
// CHARGER & TARIFF ENDPOINTS
// ============================================================================

app.get('/chargers/nearby', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT c.id, c.charger_id, c.name, c.location,
               c.max_power_kw, c.status, c.last_heartbeat_at
        FROM chargers c
        WHERE c.status = 'available' AND c.fleet_id = $1
        ORDER BY c.max_power_kw DESC
        LIMIT 20
      `, [req.user.fleet_id]);

      res.json({ chargers: result.rows, count: result.rows.length });
    } catch (error) {
      res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.get('/chargers/:id', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, charger_id, name, location, max_power_kw, status, last_heartbeat_at
        FROM chargers
        WHERE id = $1 AND fleet_id = $2
      `, [req.params.id, req.user.fleet_id]);

      if (result.rows.length === 0) return res.status(404).json({ error: 'Charger not found' });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.get('/tariffs/available', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency
            FROM tariffs
            WHERE fleet_id = $1 AND is_active = true
        `, [req.user.fleet_id]);
        res.json({ tariffs: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.post('/profile/tariff-selection', authenticateToken, async (req, res) => {
    const { tariff_id } = req.body;
    try {
        // IDOR Check: Ensure the tariff belongs to the driver's fleet
        const tariffCheck = await pool.query(
            'SELECT id FROM tariffs WHERE id = $1 AND fleet_id = $2',
            [tariff_id, req.user.fleet_id]
        );

        if (tariffCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Unauthorized: Tariff does not belong to your fleet' });
        }

        await pool.query('UPDATE driver_preferences SET selected_tariff_id = $1 WHERE driver_id = $2', [tariff_id, req.user.driver_id]);
        res.json({ success: true, message: 'Tariff plan updated' });
    } catch (error) {
        console.error('[Tariff Selection Error]', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

// ============================================================================
// CHARGING SESSION ENDPOINTS
// ============================================================================

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

      res.json({ sessions: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('[Sessions Error]', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.get('/sessions/active', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cs.*, v.make, v.model, c.name as charger_name, c.max_power_kw,
             t.base_rate_kwh as current_tariff_rate,
             (cs.energy_dispensed_kwh * t.base_rate_kwh) as current_cost_estimate
      FROM charging_sessions cs
      JOIN vehicles v ON cs.vehicle_id = v.id
      JOIN chargers c ON cs.charger_id = c.id
      LEFT JOIN driver_preferences dp ON cs.driver_id = dp.driver_id
      LEFT JOIN tariffs t ON dp.selected_tariff_id = t.id
      WHERE cs.driver_id = $1 AND cs.end_time IS NULL
      LIMIT 1
    `, [req.user.driver_id]);

    if (result.rows.length === 0) return res.json({ active_session: null });
    res.json({ active_session: result.rows[0] });
  } catch (error) {
    console.error('[Active Session Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// REWARDS ENDPOINTS
// ============================================================================

app.get('/rewards/balance', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT dw.escrow_balance, dw.blockchain_balance, dw.open_wallet_address, dw.external_wallet_address,
               (dw.escrow_balance + dw.blockchain_balance) as total_balance
        FROM driver_wallets dw
        WHERE dw.driver_id = $1
      `, [req.user.driver_id]);

      if (result.rows.length === 0) {
        return res.json({ escrow_balance: 0, blockchain_balance: 0, total_balance: 0 });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[Reward Balance Error]', error);
      res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.get('/rewards/history', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT log_id, rule_id, source_value, points_awarded, status, created_at
        FROM token_reward_log
        WHERE driver_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `, [req.user.driver_id]);

      res.json({ rewards: result.rows, count: result.rows.length });
    } catch (error) {
      console.error('[Reward History Error]', error);
      res.status(500).json({ error: 'An internal server error occurred' });
    }
});

app.post('/rewards/claim', authenticateToken, async (req, res) => {
    const { external_wallet_address } = req.body;
    try {
        await pool.query(`
            UPDATE driver_wallets
            SET external_wallet_address = $1, last_claim_at = NOW()
            WHERE driver_id = $2
        `, [external_wallet_address, req.user.driver_id]);

        notifications.sendImmediate(req.user.driver_id, 'Claim Submitted', 'Your token claim request has been received.');
        res.json({
            success: true,
            message: 'Claim request submitted. Tokens will be transferred to your external wallet shortly.'
        });
    } catch (error) {
        console.error('[Claim Error]', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

// ============================================================================
// VOICE COMMAND ENDPOINT
// ============================================================================

app.post('/voice/command', authenticateToken, async (req, res) => {
  const { command_text } = req.body;
  try {
    const lowerCommand = command_text.toLowerCase();
    if (lowerCommand.includes('start charging')) return res.json({ action: 'start_charging', success: true });
    if (lowerCommand.includes('stop charging')) return res.json({ action: 'stop_charging', success: true });
    res.json({ action: 'unknown', success: false });
  } catch (error) {
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Start server
app.listen(port, () => {
    console.log(`[Driver Experience API] Running on port ${port}`);
    console.log('[Phase 5 Updates] Version 4.1.0 Synchronization Active');
});

process.on('SIGTERM', async () => {
  if (kafkaConnected) await producer.disconnect();
  pool.end();
  process.exit(0);
});
