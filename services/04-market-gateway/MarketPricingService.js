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
   * Helper: Normalize ISO string to uppercase and remove hyphens.
   * @param {string} iso - The ISO name
   * @returns {string|null} Normalized ISO or null
   */
  normalizeIso(iso) {
    if (!iso) return null;
    return iso.toUpperCase().replace(/-/g, '');
  }

  /**
   * Fetches the latest LMP prices for a given ISO.
   * @param {string} iso - The ISO name (e.g., 'CAISO')
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} List of LMP price records
   */
  async getLatestPrices(iso, limit = 10) {
    const normalizedIso = this.normalizeIso(iso);
    const result = await this.pool.query(`
      SELECT location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE iso = $1
        AND timestamp > NOW() - INTERVAL '5 minutes'
      ORDER BY timestamp DESC
      LIMIT $2
    `, [normalizedIso, limit]);

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
    const isoFilter = (iso && iso !== 'ALL') ? this.normalizeIso(iso) : null;
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
    const normalizedIso = this.normalizeIso(iso);
    const price = new Decimal(price_per_mwh);
    await this.pool.query(`
      INSERT INTO lmp_prices (iso, location, price_per_mwh, timestamp)
      VALUES ($1, $2, $3, $4)
    `, [normalizedIso, location, price.toString(), timestamp]);
  }

  /**
   * Fetches the Day-Ahead forecasted LMP prices for a given ISO.
   * For the purpose of this implementation, we'll query the lmp_prices table
   * assuming it contains forecasted data for the next 24 hours.
   * @param {string} iso - The ISO name
   * @returns {Promise<Array>} List of forecasted price records for the next 24 hours
   */
  async getDayAheadForecast(iso) {
    const normalizedIso = this.normalizeIso(iso);
    // Prefer Day-Ahead Market (DAM) prices from lmp_prices if they exist
    // We assume ingestPrice handles DAM/RTM distinction by timestamp or a flag if we had one.
    // For now, we query the next 24 hours.
    const result = await this.pool.query(`
      SELECT location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE iso = $1
        AND timestamp >= NOW()
        AND timestamp < NOW() + INTERVAL '36 hours'
      ORDER BY timestamp ASC
    `, [normalizedIso]);

    return result.rows.map(row => ({
      ...row,
      price_per_mwh: new Decimal(row.price_per_mwh)
    }));
  }

  /**
   * DA vs RT Spread Analysis
   * Calculates the spread between Day-Ahead and Real-Time prices over a sliding window.
   */
  async getDARTSpreadAnalysis(iso, location, days = 30) {
    const normalizedIso = this.normalizeIso(iso);
    // This query assumes we have both DA and RT prices in the lmp_prices table,
    // possibly distinguishable by some metadata or we might need a separate table.
    // For the initial rollout, we'll look at historical volatility as a proxy if explicit DA/RT tags are missing.
    const result = await this.pool.query(`
      SELECT
        AVG(price_per_mwh::numeric) as avg_price,
        STDDEV(price_per_mwh::numeric) as volatility,
        MAX(price_per_mwh::numeric) - MIN(price_per_mwh::numeric) as spread
      FROM lmp_prices
      WHERE iso = $1 AND location = $2
        AND timestamp > NOW() - (make_interval(days => $3))
    `, [normalizedIso, location, days]);

    return result.rows[0];
  }

  /**
   * Fetches the latest Fuel Mix / Carbon Intensity for an ISO
   */
  async getLatestFuelMix(iso) {
    const normalizedIso = this.normalizeIso(iso);
    const result = await this.pool.query(`
      SELECT fuel_type, gen_mw, timestamp
      FROM fuel_mix
      WHERE iso = $1
      ORDER BY timestamp DESC
      LIMIT 20
    `, [normalizedIso]);

    return result.rows;
  }

  /**
   * Fetches historical Fuel Mix / Carbon Intensity data.
   * Optimized for L11 ML Engine training.
   * @param {string} iso - The ISO name
   * @param {number} days - Number of days of history
   * @returns {Promise<Array>} List of historical fuel mix records
   */
  async getFuelMixHistory(iso, days = 7) {
    const isoFilter = (iso && iso !== 'ALL') ? this.normalizeIso(iso) : null;
    const intervalDays = parseInt(days) || 7;

    const result = await this.pool.query(`
      SELECT iso, fuel_type, gen_mw, timestamp
      FROM fuel_mix
      WHERE ($1::text IS NULL OR iso = $1)
        AND timestamp > NOW() - (make_interval(days => $2))
      ORDER BY timestamp ASC
    `, [isoFilter, intervalDays]);

    return result.rows.map(row => ({
      ...row,
      gen_mw: new Decimal(row.gen_mw)
    }));
  }

  /**
   * Fetches historical Load Forecast data.
   * Optimized for L11 ML Engine training.
   * @param {string} iso - The ISO name
   * @param {number} days - Number of days of history
   * @returns {Promise<Array>} List of historical load forecast records
   */
  async getLoadForecastHistory(iso, days = 7) {
    const isoFilter = (iso && iso !== 'ALL') ? this.normalizeIso(iso) : null;
    const intervalDays = parseInt(days) || 7;

    const result = await this.pool.query(`
      SELECT iso, location, forecast_mw, forecast_timestamp, publish_time
      FROM load_forecasts
      WHERE ($1::text IS NULL OR iso = $1)
        AND forecast_timestamp > NOW() - (make_interval(days => $2))
      ORDER BY forecast_timestamp ASC
    `, [isoFilter, intervalDays]);

    return result.rows.map(row => ({
      ...row,
      forecast_mw: new Decimal(row.forecast_mw)
    }));
  }

  /**
   * Fetches historical Net Load data.
   * Optimized for L11 CAISO "Duck Curve" analysis.
   * @param {string} iso - The ISO name
   * @param {number} days - Number of days of history
   * @returns {Promise<Array>} List of historical net load records
   */
  async getNetLoadHistory(iso, days = 7) {
    const isoFilter = (iso && iso !== 'ALL') ? this.normalizeIso(iso) : null;
    const intervalDays = parseInt(days) || 7;

    const result = await this.pool.query(`
      SELECT iso, actual_load_mw, net_load_mw, renewables_mw, timestamp
      FROM net_load
      WHERE ($1::text IS NULL OR iso = $1)
        AND timestamp > NOW() - (make_interval(days => $2))
      ORDER BY timestamp ASC
    `, [isoFilter, intervalDays]);

    return result.rows.map(row => ({
      ...row,
      net_load_mw: new Decimal(row.net_load_mw),
      actual_load_mw: row.actual_load_mw ? new Decimal(row.actual_load_mw) : null,
      renewables_mw: row.renewables_mw ? new Decimal(row.renewables_mw) : null
    }));
  }
}

module.exports = MarketPricingService;
