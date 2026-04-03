-- MiGrid Token Engine - Ledger Alignment (v4.3.0)
-- 024_l10_token_log_alignment.sql

-- 1. Add ISO and Fidelity columns to token_reward_log for L11 training data and regional auditability
ALTER TABLE token_reward_log
ADD COLUMN IF NOT EXISTS iso VARCHAR(20) DEFAULT 'CAISO',
ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT TRUE;

-- 2. Add Index for regional performance queries
CREATE INDEX IF NOT EXISTS idx_token_reward_log_iso ON token_reward_log(iso);
CREATE INDEX IF NOT EXISTS idx_token_reward_log_fidelity ON token_reward_log(is_high_fidelity);

-- 3. Update existing records (Default to high-fidelity for legacy behavioral rewards)
UPDATE token_reward_log SET iso = 'CAISO' WHERE iso IS NULL;
UPDATE token_reward_log SET is_high_fidelity = TRUE WHERE is_high_fidelity IS NULL;
