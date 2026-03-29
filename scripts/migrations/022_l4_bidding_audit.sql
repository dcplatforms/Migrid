-- L4: Market Gateway Bidding Auditability
-- Supports L11 ML Engine Ground Truth data extraction

-- Add audit columns to market_bids table
ALTER TABLE market_bids ADD COLUMN IF NOT EXISTS physics_score NUMERIC(4,3);
ALTER TABLE market_bids ADD COLUMN IF NOT EXISTS capacity_fidelity VARCHAR(20);
ALTER TABLE market_bids ADD COLUMN IF NOT EXISTS audit_context JSONB;

-- Comment on columns for clarity
COMMENT ON COLUMN market_bids.physics_score IS 'Snapshot of L1 Physics Score at the time of bidding (0.0 to 1.0)';
COMMENT ON COLUMN market_bids.capacity_fidelity IS 'The fidelity status of the aggregated capacity (HIGH_FIDELITY or STANDARD)';
COMMENT ON COLUMN market_bids.audit_context IS 'Raw safety lock and regional context metadata for post-bid auditing';
