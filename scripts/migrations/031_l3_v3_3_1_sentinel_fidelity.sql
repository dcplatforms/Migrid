-- MiGrid VPP Aggregator - Phase 6 AI & Optimization Readiness (v3.3.1)
-- 031_l3_v3_3_1_sentinel_fidelity.sql

-- 1. Add is_sentinel_fidelity column to vpp_capacity_history for Phase 6 training
ALTER TABLE vpp_capacity_history ADD COLUMN IF NOT EXISTS is_sentinel_fidelity BOOLEAN DEFAULT FALSE;

-- 2. Backfill sentinel status for historical records (physics_multiplier > 0.99)
UPDATE vpp_capacity_history SET is_sentinel_fidelity = TRUE WHERE physics_multiplier > 0.99;

-- 3. Create index for L11 training data filtering
CREATE INDEX IF NOT EXISTS idx_vpp_history_sentinel ON vpp_capacity_history (is_sentinel_fidelity);

-- 4. Audit Note: This migration aligns L3 with L1 (v10.1.3), L7 (v5.7.0), and L10 (v4.3.4) sentinel standards.
