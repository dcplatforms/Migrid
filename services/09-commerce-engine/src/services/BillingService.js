const Decimal = require('decimal.js');
const { pool } = require('../../config');
const TariffService = require('../services/TariffService');
const TaxService = require('./TaxService');

class BillingService {
  async processSessionCompletion(payload) {
    const { sessionId, vehicleId, energyDispensedKwh, timestamp } = payload;
    console.log(`[BillingService] Processing completion for session ${sessionId}`);

    try {
      // 1. Get Session, Vehicle, and Fleet Details
      const sessionResult = await pool.query(`
        SELECT cs.*, c.location_id
        FROM charging_sessions cs
        LEFT JOIN chargers c ON cs.charger_id = c.id
        WHERE cs.id = $1
      `, [sessionId]);
      const session = sessionResult.rows[0];
      if (!session) throw new Error('Session not found');

      const vehicleResult = await pool.query('SELECT fleet_id FROM vehicles WHERE id = $1', [vehicleId]);
      const vehicle = vehicleResult.rows[0];
      if (!vehicle) throw new Error('Vehicle not found');
      const fleetId = vehicle.fleet_id;

      // 2. Determine Billing Mode (from session or driver preferences)
      let billingMode = session.billing_mode || 'FLEET';
      const prefResult = await pool.query('SELECT preferred_billing_mode FROM driver_preferences WHERE driver_id = $1', [vehicleId]); // Assuming vehicleId as driverId for now or link via vehicle
      if (prefResult.rows.length > 0) {
        billingMode = prefResult.rows[0].preferred_billing_mode;
      }

      // 3. Get Active Tariff
      const tariffResult = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true LIMIT 1', [fleetId]);
      const tariff = tariffResult.rows[0];

      const rate = await TariffService.calculateCurrentRate(tariff, new Date(timestamp));
      const energy = new Decimal(energyDispensedKwh);
      const totalCost = energy.times(rate);

      // 4. Calculate Revenue Share and Platform Fees
      let platformFee = new Decimal(0);
      let hostRevenue = totalCost;

      if (session.charger_id) {
        const metadataResult = await pool.query('SELECT * FROM charger_metadata WHERE charger_id = $1', [session.charger_id]);
        const metadata = metadataResult.rows[0];

        if (metadata) {
          const platformFeePercent = new Decimal(metadata.platform_fee_percentage).dividedBy(100);
          platformFee = totalCost.times(platformFeePercent);
          hostRevenue = totalCost.minus(platformFee);
        }
      }

      // 5. Tax Calculation
      const { taxAmount, taxRate } = await TaxService.calculateTaxForSession(
        sessionId,
        session.location_id,
        totalCost
      );
      const finalCostWithTax = totalCost.plus(taxAmount);

      // 6. Update Session with Billing Details
      await pool.query(
        `UPDATE charging_sessions
         SET cost = $1, billing_mode = $2, platform_fee = $3, host_revenue = $4, tax_amount = $5, tax_rate = $6
         WHERE id = $7`,
        [finalCostWithTax.toFixed(2), billingMode, platformFee.toFixed(2), hostRevenue.toFixed(2), taxAmount.toFixed(2), taxRate.toFixed(2), sessionId]
      );

      console.log(`[BillingService] Session ${sessionId} billed: ${finalCostWithTax.toFixed(2)} (${billingMode})`);

    } catch (err) {
      console.error('[BillingService] Error processing session completion:', err);
    }
  }
}

module.exports = new BillingService();
