-- MiGrid Engagement Engine - Streaks and Challenges
-- 009_engagement_engine_streaks_challenges.sql

-- 1. Add Streak Tracking to Leaderboard
ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0;
ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS last_charging_at TIMESTAMPTZ;

-- 2. Create Challenges Table
CREATE TABLE IF NOT EXISTS challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    points_reward INTEGER DEFAULT 0,
    token_reward INTEGER DEFAULT 0,
    required_count INTEGER DEFAULT 1,
    challenge_type VARCHAR(50) NOT NULL, -- 'charging_streak', 'v2g_participation', etc.
    start_date TIMESTAMPTZ DEFAULT NOW(),
    end_date TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- 3. Create Driver Actions Table (to track granular events for achievements/challenges)
CREATE TABLE IF NOT EXISTS driver_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    action_type VARCHAR(50) NOT NULL, -- 'session_completed', 'v2g_discharge', etc.
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Driver Challenge Progress Table
CREATE TABLE IF NOT EXISTS driver_challenge_progress (
    driver_id UUID NOT NULL REFERENCES drivers(id),
    challenge_id UUID NOT NULL REFERENCES challenges(id),
    current_count INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (driver_id, challenge_id)
);

-- 5. Seed New Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('Plug & Charge Pro', 'Maintain a 7-day streak of physics-verified charging sessions.', 'zap-fast', 500),
('VPP Hero', 'Successfully participate in 10 V2G grid support events.', 'shield-star', 1000)
ON CONFLICT (name) DO NOTHING;

-- 6. Seed Initial Challenges
INSERT INTO challenges (name, description, points_reward, token_reward, required_count, challenge_type, end_date)
VALUES
('Weekly Warrior', 'Charge off-peak 7 consecutive days', 500, 250, 7, 'charging_streak', NOW() + INTERVAL '7 days'),
('Grid Guardian Challenge', 'Participate in 5 V2G events this month', 1000, 500, 5, 'v2g_participation', NOW() + INTERVAL '30 days')
ON CONFLICT DO NOTHING;
