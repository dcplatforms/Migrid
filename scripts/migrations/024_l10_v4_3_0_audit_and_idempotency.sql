-- Migration: 024_l10_v4_3_0_audit_and_idempotency
-- Layer: L10 Token Engine
-- Description: Adds audit metadata columns and unique constraint for reward idempotency.

-- 1. Add audit metadata columns to token_reward_log
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS physics_score DECIMAL(5,4);
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN;
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS multiplier_reason VARCHAR(255);
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS iso VARCHAR(20);

-- 2. Add unique constraint for reward idempotency
-- Prevents duplicate token minting if the same triggering event is processed multiple times for the same rule.
ALTER TABLE token_reward_log ADD CONSTRAINT unique_reward_trigger UNIQUE (driver_id, triggering_event_id, rule_id);

-- 3. Comment on columns for audit traceability
COMMENT ON COLUMN token_reward_log.physics_score IS 'L1 Physics verified variance score (0.0 to 1.0)';
COMMENT ON COLUMN token_reward_log.is_high_fidelity IS 'Flag indicating if the session met high-fidelity requirements (>0.95 score)';
COMMENT ON COLUMN token_reward_log.multiplier_reason IS 'Auditable reason for dynamic reward multipliers or penalties';
