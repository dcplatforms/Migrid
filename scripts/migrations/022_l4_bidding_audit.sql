-- L4 Market Gateway: Bidding Auditability & ML Readiness
-- Adds physics_score and capacity_fidelity to market_bids to provide Ground Truth for L11

ALTER TABLE market_bids
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4),
ADD COLUMN IF NOT EXISTS capacity_fidelity VARCHAR(20) DEFAULT 'STANDARD',
ADD COLUMN IF NOT EXISTS audit_context JSONB;

-- Update existing records to reflect standard fidelity
UPDATE market_bids SET capacity_fidelity = 'STANDARD' WHERE capacity_fidelity IS NULL;
