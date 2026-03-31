-- Migration: 022_l6_market_synchronizer.sql
-- Description: Seed 'Market Synchronizer' achievement for grid-aligned charging behavior.

INSERT INTO achievements (name, description, icon, points)
VALUES (
    'Market Synchronizer',
    'Awarded for charging during grid surplus (LMP < $30/MWh) 5 times, optimizing both cost and grid stability.',
    'sync',
    750
)
ON CONFLICT (name) DO NOTHING;
