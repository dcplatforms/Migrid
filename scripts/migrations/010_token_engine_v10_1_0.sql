-- MiGrid L10 Token Engine v10.1.0 update
-- 010_token_engine_v10_1_0.sql

-- Add ISO regional context to fleets (impacts L4 and L10)
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS iso VARCHAR(10) DEFAULT 'CAISO';

-- Add ISO regional context to token_reward_log for high-precision auditing
ALTER TABLE token_reward_log ADD COLUMN IF NOT EXISTS iso VARCHAR(10) DEFAULT 'CAISO';

-- Update existing fleets to localized context if needed (example)
UPDATE fleets SET iso = 'CAISO' WHERE iso IS NULL;
