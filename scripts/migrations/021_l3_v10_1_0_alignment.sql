-- Migration: L3 Alignment with Physics v10.1.0 and L11 Data Readiness
-- Layer: L3 (VPP Aggregator)
-- Version: 3.3.0

-- Add high-fidelity flag to historical capacity table to unblock L11 ML training
ALTER TABLE vpp_capacity_history ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT FALSE;

-- Update existing records based on a 0.95 multiplier threshold (if data exists)
UPDATE vpp_capacity_history SET is_high_fidelity = TRUE WHERE physics_multiplier > 0.95;

COMMENT ON COLUMN vpp_capacity_history.is_high_fidelity IS 'Identifies records with physics_multiplier > 0.95, suitable for high-confidence ML training.';
