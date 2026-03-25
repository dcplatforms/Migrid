-- Migration: 020_l6_l11_data_guardian.sql
-- Description: Seed 'L11 Data Guardian' achievement for Phase 6 AI Readiness.

INSERT INTO achievements (name, description, icon, points)
VALUES (
    'L11 Data Guardian',
    'Awarded for 15 consecutive sessions with a high-fidelity physics score (> 0.95), unblocking L11 ML Engine training.',
    'shield-star',
    1000
)
ON CONFLICT (name) DO NOTHING;
