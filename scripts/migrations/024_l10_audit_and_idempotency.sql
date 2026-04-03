-- MiGrid Token Engine v4.3.0 Audit and Idempotency Migration
-- scripts/migrations/024_l10_audit_and_idempotency.sql

-- 1. Add audit columns to token_reward_log
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS physics_score DECIMAL(5, 4);
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT FALSE;
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS multiplier_reason VARCHAR(255) DEFAULT 'Standard Reward';
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS iso VARCHAR(20);

-- 2. Add unique constraint for reward idempotency
-- Prevents double-minting for the same driver, action, and triggering event.
ALTER TABLE token_reward_log ADD CONSTRAINT unique_reward_trigger UNIQUE (driver_id, triggering_event_id, rule_id);

-- 3. Backfill ISO for existing logs if possible
-- (Assumes existing logic already populated some ISO data, but ensures column exists)
UPDATE token_reward_log SET iso = 'CAISO' WHERE iso IS NULL;
