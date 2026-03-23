-- MiGrid Engagement Engine - ENTSO-E Pioneer and Sustainability Refinement (v10.1.0)
-- 017_l6_entsoe_and_sustainability_refinement.sql

-- 1. Seed ENTSO-E Pioneer Achievement
INSERT INTO achievements (name, description, icon, points)
VALUES
('ENTSO-E Pioneer', 'Participate in a grid response event within the ENTSO-E (European) region.', 'globe', 250)
ON CONFLICT (name) DO NOTHING;
