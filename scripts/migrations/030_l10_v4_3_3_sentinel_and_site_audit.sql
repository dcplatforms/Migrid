-- Migration: 030_l10_v4_3_3_sentinel_and_site_audit
-- Layer: L10 Token Engine
-- Description: Adds is_sentinel_fidelity and site_id columns to token_reward_log for enhanced auditability and Phase 6 ML readiness.

-- 1. Add is_sentinel_fidelity column
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS is_sentinel_fidelity BOOLEAN DEFAULT FALSE;

-- 2. Add site_id column
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS site_id VARCHAR(255);

-- 3. Comments for auditability
COMMENT ON COLUMN token_reward_log.is_sentinel_fidelity IS 'Sentinel Fidelity tier (physics_score > 0.99) for elite ML training data';
COMMENT ON COLUMN token_reward_log.site_id IS 'Site identifier (or location_id) for site-aware load analysis and L11 ML readiness';
