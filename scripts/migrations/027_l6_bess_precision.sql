-- L6 Engagement Engine v5.9.0: BESS Precision & Cross-Layer Fidelity
-- Introducing BESS-specific achievements to incentivize high-precision stationary storage telemetry.

-- 1. New Achievement: BESS Power
INSERT INTO achievements (name, description, icon, points)
VALUES (
    'BESS Power',
    'Awarded for the first successful physics-verified discharge or session from a stationary BESS resource.',
    'battery-bolt',
    300
) ON CONFLICT (name) DO NOTHING;

-- 2. New Achievement: BESS Precision Specialist
INSERT INTO achievements (name, description, icon, points)
VALUES (
    'BESS Precision Specialist',
    'Awarded for maintaining extreme telemetry precision (10 consecutive BESS sessions with <5% variance).',
    'target',
    750
) ON CONFLICT (name) DO NOTHING;
