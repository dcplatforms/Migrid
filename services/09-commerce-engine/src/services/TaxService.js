const { pool } = require('../../config');
const Decimal = require('decimal.js');

class TaxService {
  async calculateTaxForSession(sessionId, locationId, totalAmount) {
    // 1. Fetch location details for jurisdiction
    const locationResult = await pool.query('SELECT tax_jurisdiction_id FROM locations WHERE id = $1', [locationId]);
    const location = locationResult.rows[0];

    // 2. Determine tax rate based on jurisdiction (Mock logic for Phase 5)
    let rate = new Decimal(0.08); // Default 8%

    if (location && location.tax_jurisdiction_id === 'EU-VAT') {
      rate = new Decimal(0.20); // 20% VAT
    } else if (location && location.tax_jurisdiction_id === 'CA-TAX') {
      rate = new Decimal(0.075); // 7.5% California average
    }

    const taxAmount = new Decimal(totalAmount).times(rate);

    return {
      taxAmount: taxAmount.toFixed(2),
      taxRate: rate.toFixed(4)
    };
  }
}

module.exports = new TaxService();
