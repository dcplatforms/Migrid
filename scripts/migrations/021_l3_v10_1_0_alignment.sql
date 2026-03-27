-- MiGrid VPP Aggregator - Phase 5 Enterprise Scale (v3.3.0)
-- 021_l3_v10_1_0_alignment.sql

-- Add is_high_fidelity column to vpp_capacity_history
ALTER TABLE vpp_capacity_history ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT FALSE;

-- Update existing records based on physics_multiplier
UPDATE vpp_capacity_history SET is_high_fidelity = TRUE WHERE physics_multiplier > 0.95;
