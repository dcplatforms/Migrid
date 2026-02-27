const puppeteer = require('puppeteer');
const { pool } = require('../../config');
const Decimal = require('decimal.js');

class InvoicingService {
  async aggregateSessionsAndCreateInvoice({ fleet_id, start_date, end_date }) {
    // 1. Calculate totals for sessions in period
    const totals = await pool.query(
      `SELECT SUM(energy_dispensed_kwh) as total_energy,
              SUM(cost) as total_amount,
              SUM(tax_amount) as total_tax,
              SUM(platform_fee) as total_platform_fees
       FROM charging_sessions cs
       JOIN vehicles v ON cs.vehicle_id = v.id
       WHERE v.fleet_id = $1 AND cs.start_time >= $2 AND cs.start_time <= $3 AND cs.invoice_id IS NULL AND cs.billing_mode = 'FLEET'`,
      [fleet_id, start_date, end_date]
    );

    const { total_energy, total_amount, total_tax, total_platform_fees } = totals.rows[0];

    if (!total_energy) return null;

    // 2. Create Invoice Record
    const invoice = await pool.query(
      `INSERT INTO invoices (fleet_id, billing_period_start, billing_period_end, total_energy_kwh, total_amount, total_tax, total_platform_fees, billing_entity_type, billing_entity_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [fleet_id, start_date, end_date, total_energy, total_amount, total_tax, total_platform_fees, 'FLEET', fleet_id, 'DRAFT']
    );

    // 3. Link sessions
    await pool.query(
      `UPDATE charging_sessions SET invoice_id = $1
       WHERE id IN (
         SELECT cs.id FROM charging_sessions cs
         JOIN vehicles v ON cs.vehicle_id = v.id
         WHERE v.fleet_id = $2 AND cs.start_time >= $3 AND cs.start_time <= $4 AND cs.invoice_id IS NULL AND cs.billing_mode = 'FLEET'
       )`,
      [invoice.rows[0].id, fleet_id, start_date, end_date]
    );

    return invoice.rows[0];
  }

  async generateInvoicePDF(invoiceId) {
    try {
      const invoiceResult = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
      const invoice = invoiceResult.rows[0];
      if (!invoice) throw new Error('Invoice not found');

      // Fetch linked sessions
      const sessionsResult = await pool.query(
        'SELECT * FROM charging_sessions WHERE invoice_id = $1',
        [invoiceId]
      );
      const sessions = sessionsResult.rows;

      const htmlContent = this._generateHTML(invoice, sessions);

      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: 'new'
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent);
      const pdfBuffer = await page.pdf({ format: 'A4' });

      await browser.close();
      console.log(`[InvoicingService] PDF generated for invoice ${invoiceId}`);
      return pdfBuffer;
    } catch (err) {
      console.error('[InvoicingService] PDF generation failed:', err);
      throw err;
    }
  }

  _generateHTML(invoice, sessions) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: sans-serif; margin: 40px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #eee; padding-bottom: 20px; }
          .invoice-title { font-size: 24px; color: #333; }
          .summary { margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #eee; padding: 12px; text-align: left; }
          th { background: #f9f9f9; }
          .total { margin-top: 20px; text-align: right; font-size: 18px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="invoice-title">MiGrid Invoice</div>
          <div>
            <strong>Invoice ID:</strong> ${invoice.id}<br>
            <strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}<br>
            <strong>Period:</strong> ${new Date(invoice.billing_period_start).toLocaleDateString()} - ${new Date(invoice.billing_period_end).toLocaleDateString()}
          </div>
        </div>

        <div class="summary">
          <h3>Billing Summary</h3>
          <p><strong>Entity:</strong> ${invoice.billing_entity_type} (${invoice.billing_entity_id})</p>
          <p><strong>Total Energy:</strong> ${invoice.total_energy_kwh} kWh</p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Date</th>
              <th>Energy (kWh)</th>
              <th>Cost (${invoice.currency})</th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map(s => `
              <tr>
                <td>${s.id.substring(0, 8)}...</td>
                <td>${new Date(s.start_time).toLocaleDateString()}</td>
                <td>${s.energy_dispensed_kwh}</td>
                <td>${s.cost}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="total">
          Subtotal: ${new Decimal(invoice.total_amount).minus(invoice.total_tax || 0).toFixed(2)} ${invoice.currency}<br>
          Tax: ${invoice.total_tax || '0.00'} ${invoice.currency}<br>
          Total Amount: ${invoice.total_amount} ${invoice.currency}
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new InvoicingService();
