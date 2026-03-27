const Decimal = require('decimal.js');

/**
 * MarketPricingService
 * Handles retrieval of Locational Marginal Pricing (LMP) from the database.
 */
class MarketPricingService {
  /**
   * @param {import('pg').Pool} pool - PostgreSQL connection pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Fetches the latest LMP prices for a given ISO.
   * @param {string} iso - The ISO name (e.g., 'CAISO')
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} List of LMP price records
   */
  async getLatestPrices(iso, limit = 10) {
    const result = await this.pool.query(`
      SELECT location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE iso = $1
        AND timestamp > NOW() - INTERVAL '5 minutes'
      ORDER BY timestamp DESC
      LIMIT $2
    `, [iso.toUpperCase(), limit]);

    return result.rows.map(row => ({
      ...row,
      price_per_mwh: new Decimal(row.price_per_mwh)
    }));
  }

  /**
   * Fetches historical LMP prices for a given ISO.
   * Supporting L11 AI Training readiness and L9 Commerce settlement reports.
   * @param {string} iso - The ISO name
   * @param {number} days - Number of days of history
   * @returns {Promise<Array>} List of historical price records
   */
  async getHistoricalPrices(iso, days = 7) {
    // Phase 5 Enhancement: Handle nullish ISO filters and optimize for L11 training
    const isoFilter = (iso && iso !== 'ALL') ? iso.toUpperCase().replace(/-/g, '') : null;
    const intervalDays = parseInt(days) || 7;

    const result = await this.pool.query(`
      SELECT iso, location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE ($1::text IS NULL OR iso = $1)
        AND timestamp > NOW() - (make_interval(days => $2))
      ORDER BY timestamp ASC
    `, [isoFilter, intervalDays]);

    return result.rows.map(row => ({
      ...row,
      price_per_mwh: new Decimal(row.price_per_mwh)
    }));
  }

  /**
   * Ingests a new LMP price into the database.
   * @param {string} iso - The ISO name
   * @param {string} location - Pricing node location
   * @param {number|Decimal} price_per_mwh - Price in $/MWh
   * @param {Date} timestamp - Price timestamp
   */
  async ingestPrice(iso, location, price_per_mwh, timestamp = new Date()) {
    const price = new Decimal(price_per_mwh);
    await this.pool.query(`
      INSERT INTO lmp_prices (iso, location, price_per_mwh, timestamp)
      VALUES ($1, $2, $3, $4)
    `, [iso.toUpperCase(), location, price.toString(), timestamp]);
  }

  /**
   * Fetches the Day-Ahead forecasted LMP prices for a given ISO.
   * For the purpose of this implementation, we'll query the lmp_prices table
   * assuming it contains forecasted data for the next 24 hours.
   * @param {string} iso - The ISO name
   * @returns {Promise<Array>} List of forecasted price records for the next 24 hours
   */
  async getDayAheadForecast(iso) {
    // In a real scenario, this might query a different table or use a specific filter.
    // Based on requirements, we'll use the existing lmp_prices table.
    const result = await this.pool.query(`
      SELECT location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE iso = $1
        AND timestamp >= date_trunc('day', NOW() + INTERVAL '1 day')
        AND timestamp < date_trunc('day', NOW() + INTERVAL '2 days')
      ORDER BY timestamp ASC
    `, [iso.toUpperCase()]);

    return result.rows.map(row => ({
      ...row,
      price_per_mwh: new Decimal(row.price_per_mwh)
    }));
  }
}

module.exports = MarketPricingService;
