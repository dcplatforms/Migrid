-- Migration: 030_l10_v4_3_3_sentinel_and_site_audit
-- Layer: L10 Token Engine
-- Description: Adds is_sentinel_fidelity and site_id columns to token_reward_log for Phase 6 AI auditing and L7 v5.6.0 synchronization.

-- 1. Add is_sentinel_fidelity column
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS is_sentinel_fidelity BOOLEAN DEFAULT FALSE;

-- 2. Add site_id column
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS site_id VARCHAR(100);

-- 3. Comment on columns for audit traceability
COMMENT ON COLUMN token_reward_log.is_sentinel_fidelity IS 'High-tier physics verification flag (score > 0.99) for L11 training ground truth';
COMMENT ON COLUMN token_reward_log.site_id IS 'MiGrid Site/Location identifier for site-aware reward analysis';

-- 4. Create index for site-aware queries
CREATE INDEX IF NOT EXISTS idx_token_reward_log_site_id ON token_reward_log(site_id);
