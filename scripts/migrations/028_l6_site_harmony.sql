-- L6 Engagement Engine v5.10.0: Site Harmony & High-Fidelity Engagement
-- Introducing achievements and challenges that reward behavior aligned with site capacity limits.

-- 1. New Achievement: Site Harmony
INSERT INTO achievements (name, description, icon, points)
VALUES (
    'Site Harmony',
    'Awarded for completing high-confidence charging sessions that respect site-level capacity constraints.',
    'home-heart',
    500
) ON CONFLICT (name) DO NOTHING;

-- 2. New Challenge: Confidence King
-- 2. New Challenge: Site Harmony Challenge
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES (
    'Site Harmony Challenge',
    'Complete 10 high-confidence charging sessions to ensure your behavior is in harmony with site-level load limits.',
    500,
    200,
    10,
    'site_harmony_charging',
    NOW() + INTERVAL '30 days'
) ON CONFLICT DO NOTHING;
