-- MiGrid Engagement Engine - Regional Pioneers and ML Readiness (v10.1.0)
-- 013_l6_regional_and_ml_readiness.sql

-- 1. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('ML Contributor', 'Maintain high-fidelity data with <5% variance for 5 consecutive charging sessions.', 'database', 500),
('CAISO Pioneer', 'Participate in a grid response event within the CAISO (California) region.', 'sun', 250),
('PJM Pioneer', 'Participate in a grid response event within the PJM region.', 'wind', 250)
ON CONFLICT (name) DO NOTHING;

-- 2. Seed Data Integrity Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES
('Data Integrity Challenge', 'Ensure your charging behavior is perfectly aligned with physics. Complete 3 sessions with <5% variance.', 1000, 500, 3, 'low_variance_charging', NOW() + INTERVAL '14 days')
ON CONFLICT DO NOTHING;
