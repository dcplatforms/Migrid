-- MiGrid Engagement Engine - Grid Impact and Alignment (v10.1.0)
-- 019_l6_grid_impact_and_alignment.sql

-- 1. Seed Grid Impact Achievement
INSERT INTO achievements (name, description, icon, points)
VALUES
('Grid Impact', 'Awarded for exceptional sustained contribution to grid stability (10+ grid response participations).', 'bolt', 500)
ON CONFLICT (name) DO NOTHING;
