const { pool } = require('../../config');

class Tariff {
  static async create({ fleet_id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency }) {
    const result = await pool.query(
      'INSERT INTO tariffs (fleet_id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [fleet_id, name, tariff_type, base_rate_kwh, margin_per_kwh, currency]
    );
    return result.rows[0];
  }

  static async findByFleetId(fleet_id) {
    const result = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true', [fleet_id]);
    return result.rows;
  }

  static async findActiveForFleet(fleet_id) {
    const result = await pool.query('SELECT * FROM tariffs WHERE fleet_id = $1 AND is_active = true LIMIT 1', [fleet_id]);
    return result.rows[0];
  }

  static async getTimeBlocks(tariff_id) {
    const result = await pool.query('SELECT * FROM tariff_time_blocks WHERE tariff_id = $1 ORDER BY start_time ASC', [tariff_id]);
    return result.rows;
  }
}

module.exports = Tariff;
