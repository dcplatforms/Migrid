-- MiGrid Engagement Engine - Nord Pool and Energy Architect Updates (v10.1.0)
-- 014_l6_nordpool_and_energy_architect.sql

-- 1. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('Nord Pool Pioneer', 'Participate in a grid response event within the NORDPOOL region.', 'cloud', 500),
('Energy Architect', 'Maintain high-fidelity data with <5% variance for 10 consecutive charging sessions.', 'trending-up', 1000)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed Nord Pool Regional Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date, target_region)
VALUES
('Nordic Grid Stability', 'Support the Nordic grid! Participate in 3 grid response events in the NORDPOOL region.', 1500, 750, 3, 'grid_response', NOW() + INTERVAL '14 days', 'NORDPOOL')
ON CONFLICT DO NOTHING;
