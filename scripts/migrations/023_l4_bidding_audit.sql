-- MiGrid Market Gateway - Bidding Auditability (v3.7.0)
-- 023_l4_bidding_audit.sql

-- Add audit context columns to market_bids for L11 training data
ALTER TABLE market_bids
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4),
ADD COLUMN IF NOT EXISTS capacity_fidelity VARCHAR(20),
ADD COLUMN IF NOT EXISTS audit_context JSONB;

-- Update existing records with default audit metadata
UPDATE market_bids SET physics_score = 1.0, capacity_fidelity = 'STANDARD' WHERE physics_score IS NULL;
