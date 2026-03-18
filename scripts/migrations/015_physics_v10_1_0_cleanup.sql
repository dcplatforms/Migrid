-- MiGrid Physics Engine - v10.1.0 Cleanup & High-Fidelity Schema Hardening
-- 015_physics_v10_1_0_cleanup.sql

-- 1. Ensure audit_log table schema alignment with L2/L4 Phase 5 standards
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS iso_region VARCHAR(50),
ADD COLUMN IF NOT EXISTS market_price_at_session DECIMAL(12,4);

-- 2. Audit metadata check: ensuring v2g_active is archived for L11 training readiness
COMMENT ON COLUMN audit_log.metadata IS 'Archives high-fidelity telemetry: v2g_active, vehicle_id, vin, current_soc, and variance_pct';

-- 3. Optimization: Add index for regional market-aware reporting
CREATE INDEX IF NOT EXISTS idx_audit_log_iso_region ON audit_log(iso_region);
