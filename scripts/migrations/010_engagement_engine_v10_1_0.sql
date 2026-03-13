-- MiGrid Engagement Engine - Phase 5 Enterprise Scale (v10.1.0 Alignment)
-- 010_engagement_engine_v10_1_0.sql

-- 1. Seed New Achievements for Grid Support and Physics Integrity
INSERT INTO achievements (name, description, icon, points)
VALUES
('Grid Warrior', 'Participate in 5 separate Demand Response events verified by the grid.', 'swords', 750),
('Sustainability Champion', 'Complete 30 consecutive days of charging with 100% Physics Audit compliance.', 'leaf', 1500),
('VPP Ready', 'Opt-in to the Virtual Power Plant program to support grid stability.', 'battery-charging', 300)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed a Recurring Fleet-Wide VPP Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES
('VPP Mobilization', 'The fleet needs you! Opt-in to VPP and participate in at least one discharge event this week.', 1000, 500, 1, 'vpp_participation', NOW() + INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- 3. Add Region-Based Isolation to Challenges (Future-Proofing for L7/L8 Site Scaling)
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS target_region VARCHAR(100);
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS target_fleet_id UUID REFERENCES fleets(id);

-- 4. Indexing for Performance (Phase 5 Scale)
CREATE INDEX IF NOT EXISTS idx_driver_actions_type_driver ON driver_actions(action_type, driver_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_fleet_rank ON leaderboard(fleet_id, rank);
CREATE INDEX IF NOT EXISTS idx_charging_sessions_driver_valid_time ON charging_sessions(driver_id, is_valid, start_time);
