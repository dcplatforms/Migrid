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
  res.json({ status: 'OK', service: 'Commerce Engine', version: '5.1.0' });
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

  // Authorization: Ensure the user belongs to the fleet being billed
  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to generate invoices for other fleets' });
  }

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  try {
    const invoice = await InvoicingService.aggregateSessionsAndCreateInvoice({ fleet_id, start_date, end_date });
    if (!invoice) {
      return res.status(404).json({ error: 'No billable sessions found for the specified period' });
    }
    res.status(201).json({ success: true, invoice });
  } catch (err) {
    console.error('[Invoice Generation Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

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
  const { sessionId } = req.params;
  try {
    // IDOR Check: Ensure the session belongs to the user's fleet
    const sessionRes = await pool.query(
      'SELECT cs.id, cs.vehicle_id, cs.energy_dispensed_kwh, cs.start_time FROM charging_sessions cs JOIN vehicles v ON cs.vehicle_id = v.id WHERE cs.id = $1 AND v.fleet_id = $2',
      [sessionId, req.user.fleet_id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: Session does not belong to your fleet' });
    }

    const session = sessionRes.rows[0];
    const BillingService = require('./src/services/BillingService');
    await BillingService.processSessionCompletion({
        sessionId: session.id,
        vehicleId: session.vehicle_id,
        energyDispensedKwh: session.energy_dispensed_kwh,
        timestamp: session.start_time
    });

    const updatedSession = await pool.query('SELECT cost FROM charging_sessions WHERE id = $1', [sessionId]);
    res.json({ success: true, cost: updatedSession.rows[0].cost });
  } catch (err) {
    console.error('[Billing Calculation Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

app.get('/invoices/:id/pdf', authenticateToken, async (req, res) => {
  try {
    // Security Enhancement: Passing fleet_id from JWT to prevent IDOR
    const pdfBuffer = await InvoicingService.generateInvoicePDF(req.params.id, req.user.fleet_id);
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
    console.log('[Commerce Engine] Background services started successfully');
  } catch (err) {
    console.error('Failed to start Commerce Engine services:', err);
    process.exit(1);
  }
}

startServices();
