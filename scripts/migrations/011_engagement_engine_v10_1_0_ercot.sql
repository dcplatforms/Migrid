-- MiGrid Engagement Engine - ERCOT and Market Master Updates (v10.1.0)
-- 011_engagement_engine_v10_1_0_ercot.sql

-- 1. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('ERCOT Pioneer', 'Participate in a grid response event within the ERCOT (Texas) region.', 'map-pin', 500),
('Market Master', 'Successfully complete 5 charging sessions during periods of high market profitability (> $50/MWh).', 'trending-up', 1000)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed ERCOT Regional Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date, target_region)
VALUES
('Texas Grid Strength', 'Support the Texas grid! Participate in 3 grid response events in the ERCOT region.', 1500, 750, 3, 'grid_response', NOW() + INTERVAL '14 days', 'ERCOT')
ON CONFLICT DO NOTHING;

-- 3. Add column to track specific achievement progress if needed (optional, using driver_actions for now)
-- For Market Master, we can use driver_actions with action_type 'high_profitability_charge'
