/**
 * L1: Physics Engine - AI Data Readiness (L11 ML Engine Export)
 *
 * This script exports high-fidelity physics timeseries data from PostgreSQL
 * to a JSON format optimized for L11 ML Engine training pipelines.
 *
 * Usage: SITE_ID=LOCAL-001 DATABASE_URL=... node export_timeseries.js [days]
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL;
const SITE_ID = process.env.SITE_ID || 'LOCAL-DEPOT-001';
const DAYS_TO_EXPORT = parseInt(process.argv[2]) || 7;

async function exportPhysicsData() {
  const pgClient = new Client({ connectionString: DATABASE_URL });

  try {
    await pgClient.connect();
    console.log(`📡 [L1 Export] Connected to DB. Exporting last ${DAYS_TO_EXPORT} days for site: ${SITE_ID}`);

    // 1. Fetch High-Fidelity Charging Sessions
    const sessionQuery = `
      SELECT
        cs.id,
        cs.vehicle_id,
        v.vin,
        cs.start_time,
        cs.end_time,
        cs.energy_dispensed_kwh,
        cs.energy_regen_kwh,
        cs.energy_pushed_to_grid_kwh,
        cs.energy_battery_delta_kwh,
        cs.variance_percentage,
        cs.is_valid,
        cs.iso_region,
        cs.market_price_at_session
      FROM charging_sessions cs
      JOIN vehicles v ON cs.vehicle_id = v.id
      WHERE cs.start_time > NOW() - INTERVAL '${DAYS_TO_EXPORT} days'
      ORDER BY cs.start_time DESC;
    `;

    const sessions = await pgClient.query(sessionQuery);
    console.log(`✅ [L1 Export] Found ${sessions.rows.length} charging sessions.`);

    // 2. Fetch Audit Violations (Ground Truth for Fraud detection)
    const auditQuery = `
      SELECT
        id,
        session_id,
        violation_type,
        expected_value,
        actual_value,
        variance_pct,
        severity,
        created_at,
        metadata,
        iso_region,
        market_price_at_session,
        vpp_active,
        v2g_active,
        physics_score,
        is_high_fidelity
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '${DAYS_TO_EXPORT} days'
      ORDER BY created_at DESC;
    `;

    const auditLogs = await pgClient.query(auditQuery);
    console.log(`✅ [L1 Export] Found ${auditLogs.rows.length} audit violations.`);

    // 3. Construct Export Payload
    const exportData = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      site_id: SITE_ID,
      lookback_days: DAYS_TO_EXPORT,
      summary: {
        total_sessions: sessions.rows.length,
        total_violations: auditLogs.rows.length,
        fraud_count: auditLogs.rows.filter(l => l.violation_type === 'PHYSICS_FRAUD').length
      },
      data: {
        sessions: sessions.rows,
        audit_logs: auditLogs.rows
      }
    };

    const fileName = `physics_timeseries_${SITE_ID}_${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(fileName, JSON.stringify(exportData, null, 2));

    console.log(`📦 [L1 Export] High-fidelity data saved to: ${fileName}`);
    console.log(`🚀 [L11 Readiness] Export complete. Ground Truth ready for ML Engine training.`);

  } catch (err) {
    console.error('❌ [L1 Export] Export failed:', err.message);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  exportPhysicsData();
}

module.exports = { exportPhysicsData };
