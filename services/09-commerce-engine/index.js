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
  const { fleet_id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency } = req.body;

  if (fleet_id !== req.user.fleet_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to manage tariffs for other fleets' });
  }

  try {
    const tariff = await Tariff.create({ fleet_id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency });
    res.status(201).json(tariff);
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

    app.listen(port, () => {
      console.log(`💰 [L9] Commerce Engine (Modular) listening at http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start Commerce Engine services:', err);
    process.exit(1);
  }
}

startServices();
