-- L6 Engagement Engine v5.8.0: Data Confidence and ML Readiness
-- Introducing achievements and challenges aligned with L11 ML Engine requirements.

-- 1. New Achievement: High-Confidence Contributor
INSERT INTO achievements (name, description, icon, points)
VALUES (
    'High-Confidence Contributor',
    'Awarded for maintaining a Data Confidence Score > 0.95, ensuring high-fidelity inputs for ML forecasting.',
    'shield-check',
    500
) ON CONFLICT (name) DO NOTHING;

-- 2. New Challenge: ML Data Pioneer
-- Encourage drivers to provide high-fidelity data (low variance) for ML training.
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, is_active, end_date)
VALUES (
    'ML Data Pioneer',
    'Complete 10 charging sessions with a physics score > 0.98 to help train the L11 ML Engine.',
    1000,
    50,
    10,
    'ml_data_pioneer',
    true,
    NOW() + INTERVAL '30 days'
) ON CONFLICT (name) DO NOTHING;

-- 3. New Challenge: High-Confidence Charging
-- Encourage drivers to stay synced and maintain streaks to boost confidence scores.
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, is_active, end_date)
VALUES (
    'Reliable Node',
    'Complete 5 charging sessions with a Data Confidence Score > 0.90.',
    500,
    25,
    5,
    'high_confidence_charging',
    true,
    NOW() + INTERVAL '30 days'
) ON CONFLICT (name) DO NOTHING;
