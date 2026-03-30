-- L6 Engagement Engine v5.6.0
-- Achievement: Physics Sentinel

INSERT INTO achievements (name, description, icon, points)
VALUES
('Physics Sentinel', 'Complete 10 consecutive physics-verified sessions with >0.99 fidelity score.', 'shield-check', 500)
ON CONFLICT (name) DO NOTHING;
