-- MiGrid Engagement Engine - V2X Pioneer and ISO Explorer Updates (v10.1.0)
-- 016_l6_v2x_and_iso_explorer.sql

-- 1. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('V2X Pioneer', 'Participate in a bidirectional V2G discharge event using native OCPP 2.1.', 'battery-charging', 750),
('ISO Explorer', 'Demonstrate fleet mobility by participating in grid response events across 3+ distinct ISO regions.', 'map', 1000)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed Global Grid Guardian Regional Team Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES
('Global Grid Guardian', 'Support global grid stability! Participate in grid response events across 3 different ISO regions.', 2500, 1000, 3, 'multi_iso_response', NOW() + INTERVAL '30 days')
ON CONFLICT DO NOTHING;
