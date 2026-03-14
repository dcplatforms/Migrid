-- MiGrid Token Engine Update v10.1.0
-- 010_token_engine_v10_1_0.sql

-- 1. Add token_reward to challenges for L6 -> L10 bridging
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS token_reward INTEGER DEFAULT 0;

-- 2. Add ISO column to fleets for regional market context in rewards
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS iso VARCHAR(20) DEFAULT 'CAISO';

-- 3. Update existing challenges with token rewards
UPDATE challenges SET token_reward = 250 WHERE name = 'Weekly Warrior';
UPDATE challenges SET token_reward = 500 WHERE name = 'Grid Guardian Challenge';

-- 4. Set default ISO for existing fleets
UPDATE fleets SET iso = 'CAISO' WHERE iso IS NULL;
