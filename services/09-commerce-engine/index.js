const express = require('express');
const { pool, port } = require('./config');
const { authenticateToken } = require('./src/utils/auth');
const MarketRateService = require('./src/services/MarketRateService');
const SessionEventListener = require('./src/services/SessionEventListener');
const Tariff = require('./src/models/Tariff');
const InvoicingService = require('./src/services/InvoicingService');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Commerce Engine', version: '5.0.0' });
});

/**
 * Manage Tariffs
 */
app.post('/tariffs', authenticateToken, async (req, res) => {
  const { fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency, type, monthly_fee } = req.body;

  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to manage tariffs for other fleets' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO tariffs (fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency, type, monthly_fee) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [fleet_id, name, base_rate_kwh, peak_rate_kwh, peak_start_time, peak_end_time, currency, type || 'CONSUMPTION', monthly_fee || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Tariff Creation Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.get('/tariffs/:fleet_id', authenticateToken, async (req, res) => {
  if (req.params.fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to view tariffs for other fleets' });
  }

  try {
    const tariffs = await Tariff.findByFleetId(req.params.fleet_id);
    res.json(tariffs);
  } catch (err) {
    console.error('[Tariff Retrieval Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * Invoices Generation
 */
app.post('/invoices/generate', authenticateToken, async (req, res) => {
  const { fleet_id, start_date, end_date } = req.body;

  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const cost = session.energy_dispensed_kwh * rate;
  await pool.query('UPDATE charging_sessions SET cost = $1 WHERE id = $2', [cost, sessionId]);
  return cost;
}

/**
 * Manage Driver Assignments & Split Billing
 */
app.post('/drivers/assign', authenticateToken, async (req, res) => {
  const { fleet_id, driver_id, split_percentage } = req.body;

  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO fleet_driver_assignments (fleet_id, driver_id, split_percentage) VALUES ($1, $2, $3) RETURNING *',
      [fleet_id, driver_id, split_percentage]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Driver Assignment Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.post('/billing/calculate/:sessionId', authenticateToken, async (req, res) => {
  try {
    const invoice = await InvoicingService.aggregateSessionsAndCreateInvoice({ fleet_id, start_date, end_date });
    if (!invoice) {
      return res.status(404).json({ error: 'No billable sessions found' });
    }
    res.status(201).json(invoice);
  } catch (err) {
    console.error('[Invoice Generation Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.get('/invoices/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const pdfBuffer = await InvoicingService.generateInvoicePDF(req.params.id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=invoice-${req.params.id}.pdf`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Invoice PDF Error]', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Start background services
async function startServices() {
  try {
    await MarketRateService.start();
    await SessionEventListener.start();

    // 2. Sum up totals
    const totals = await pool.query(
      'SELECT SUM(energy_dispensed_kwh) as total_energy, SUM(cost) as total_amount FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE v.fleet_id = $1 AND cs.start_time >= $2 AND cs.start_time <= $3 AND cs.invoice_id IS NULL',
      [fleet_id, start_date, end_date]
    );

    const { total_energy, total_amount } = totals.rows[0];

    if (!total_energy) {
      return res.status(404).json({ message: 'No billable sessions found for this period' });
    }

    // 3. Check for Subscription fees
    const activeTariff = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true LIMIT 1', [fleet_id]);
    let finalAmount = parseFloat(total_amount);
    if (activeTariff.rows[0] && activeTariff.rows[0].type === 'SUBSCRIPTION') {
      finalAmount += parseFloat(activeTariff.rows[0].monthly_fee);
    }

    // 4. Create Invoice
    const invoice = await pool.query(
      'INSERT INTO invoices (fleet_id, billing_period_start, billing_period_end, total_energy_kwh, total_amount, status, type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [fleet_id, start_date, end_date, total_energy, finalAmount, 'DRAFT', 'FLEET']
    );

    // 5. Link sessions to invoice
    await pool.query(
      'UPDATE charging_sessions SET invoice_id = $1 WHERE id IN (SELECT cs.id FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE v.fleet_id = $2 AND cs.start_time >= $3 AND cs.start_time <= $4 AND cs.invoice_id IS NULL)',
      [invoice.rows[0].id, fleet_id, start_date, end_date]
    );

    res.status(201).json(invoice.rows[0]);
  } catch (err) {
    console.error('Failed to start Commerce Engine services:', err);
    process.exit(1);
  }
}

startServices();
