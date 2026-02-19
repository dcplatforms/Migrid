const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
const port = process.env.PORT || 3009;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  res.json({ status: 'OK', service: 'Commerce Engine' });
});

/**
 * Manage Tariffs
 */
app.post('/tariffs', authenticateToken, async (req, res) => {
  const { fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency } = req.body;

  // Multi-tenancy isolation
  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to manage tariffs for other fleets' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO tariffs (fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Commerce Engine Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.get('/tariffs/:fleet_id', authenticateToken, async (req, res) => {
  // Multi-tenancy isolation
  if (req.params.fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to view tariffs for other fleets' });
  }

  try {
    const result = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true', [req.params.fleet_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('[Commerce Engine Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * Billing Logic: Calculate cost for a charging session
 */
async function calculateSessionCost(sessionId) {
  const sessionResult = await pool.query('SELECT * FROM charging_sessions WHERE id = $1', [sessionId]);
  const session = sessionResult.rows[0];
  if (!session) throw new Error('Session not found');

  const vehicleResult = await pool.query('SELECT fleet_id FROM vehicles WHERE id = $1', [session.vehicle_id]);
  const fleetId = vehicleResult.rows[0].fleet_id;

  const tariffResult = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true LIMIT 1', [fleetId]);
  const tariff = tariffResult.rows[0];

  if (!tariff) return 0; // No tariff set, maybe free charging?

  let rate = tariff.base_rate_kwh;
  const sessionTime = new Date(session.start_time).toTimeString().split(' ')[0];

  if (tariff.peak_rate_kwh && tariff.peak_start_time && tariff.peak_end_time) {
    if (sessionTime >= tariff.peak_start_time && sessionTime <= tariff.peak_end_time) {
      rate = tariff.peak_rate_kwh;
    }
  }

  const cost = session.energy_dispensed_kwh * rate;
  await pool.query('UPDATE charging_sessions SET cost = $1 WHERE id = $2', [cost, sessionId]);
  return cost;
}

app.post('/billing/calculate/:sessionId', authenticateToken, async (req, res) => {
  try {
    // In production, verify session ownership
    const cost = await calculateSessionCost(req.params.sessionId);
    res.json({ session_id: req.params.sessionId, cost });
  } catch (err) {
    console.error('[Commerce Engine Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * Generate Invoice for a fleet
 */
app.post('/invoices/generate', authenticateToken, async (req, res) => {
  const { fleet_id, start_date, end_date } = req.body;

  // Multi-tenancy isolation
  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to generate invoices for other fleets' });
  }

  try {
    // 1. Calculate costs for all sessions in period that don't have an invoice_id
    const sessions = await pool.query(
      'SELECT id FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE v.fleet_id = $1 AND cs.start_time >= $2 AND cs.start_time <= $3 AND cs.invoice_id IS NULL',
      [fleet_id, start_date, end_date]
    );

    for (const s of sessions.rows) {
      await calculateSessionCost(s.id);
    }

    // 2. Sum up totals
    const totals = await pool.query(
      'SELECT SUM(energy_dispensed_kwh) as total_energy, SUM(cost) as total_amount FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE v.fleet_id = $1 AND cs.start_time >= $2 AND cs.start_time <= $3 AND cs.invoice_id IS NULL',
      [fleet_id, start_date, end_date]
    );

    const { total_energy, total_amount } = totals.rows[0];

    if (!total_energy) {
      return res.status(404).json({ message: 'No billable sessions found for this period' });
    }

    // 3. Create Invoice
    const invoice = await pool.query(
      'INSERT INTO invoices (fleet_id, billing_period_start, billing_period_end, total_energy_kwh, total_amount, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [fleet_id, start_date, end_date, total_energy, total_amount, 'DRAFT']
    );

    // 4. Link sessions to invoice
    await pool.query(
      'UPDATE charging_sessions SET invoice_id = $1 WHERE id IN (SELECT cs.id FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE v.fleet_id = $2 AND cs.start_time >= $3 AND cs.start_time <= $4 AND cs.invoice_id IS NULL)',
      [invoice.rows[0].id, fleet_id, start_date, end_date]
    );

    res.status(201).json(invoice.rows[0]);
  } catch (err) {
    console.error('[Commerce Engine Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.listen(port, () => {
  console.log(`💰 Commerce Engine listening at http://localhost:${port}`);
});
