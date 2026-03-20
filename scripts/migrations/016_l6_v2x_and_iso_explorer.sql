-- MiGrid Engagement Engine - V2X Pioneer and ISO Explorer (v10.1.0)
-- 016_l6_v2x_and_iso_explorer.sql

-- 1. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('V2X Pioneer', 'Be the first to participate in a bidirectional discharge event using native OCPP 2.1 V2X profiles.', 'zap', 500),
('ISO Explorer', 'Participate in grid response events across 3 distinct ISO regions (e.g., CAISO, ERCOT, Nord Pool).', 'globe', 1000)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed Global Grid Guardian Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES
('Global Grid Guardian', 'Support grid stability across the globe! Participate in grid response events in 3 distinct ISO regions.', 2000, 1000, 3, 'iso_explorer', NOW() + INTERVAL '30 days')
ON CONFLICT DO NOTHING;
