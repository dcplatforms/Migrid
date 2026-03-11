-- MiGrid Engagement Engine Schema
-- Achievements, Leaderboards, and Challenges

-- 1. Achievements Definition Table
CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(100), -- Icon identifier for the mobile app
    points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Driver Achievements (Many-to-Many)
CREATE TABLE IF NOT EXISTS driver_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    achievement_id UUID NOT NULL REFERENCES achievements(id),
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(driver_id, achievement_id)
);

-- 3. Leaderboard Table
CREATE TABLE IF NOT EXISTS leaderboard (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id),
    fleet_id UUID NOT NULL REFERENCES fleets(id),
    total_points INTEGER DEFAULT 0,
    green_score DECIMAL(5,2) DEFAULT 0.0,
    rank INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Seed Initial Achievements
INSERT INTO achievements (name, description, icon, points)
VALUES
('Early Adopter', 'Complete your first physics-verified charging session.', 'award-star', 100),
('Grid Guardian', 'Participate in a V2G discharge event to support the grid.', 'shield-check', 250),
('Plug & Charge Ready', 'Enable ISO 15118 Plug & Charge for your vehicle.', 'zap', 150)
ON CONFLICT (name) DO NOTHING;
