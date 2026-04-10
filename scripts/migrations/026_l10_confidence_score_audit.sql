-- Migration: 026_l10_confidence_score_audit
-- Layer: L10 Token Engine
-- Description: Adds confidence_score column to token_reward_log for L11 ML Engine auditability.

-- 1. Add confidence_score column to token_reward_log
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5,4);

-- 2. Comment on column for audit traceability
COMMENT ON COLUMN token_reward_log.confidence_score IS 'L1 Physics data confidence score (0.0 to 1.0) for ML training auditability';
