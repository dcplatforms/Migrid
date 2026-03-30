-- MiGrid L4: Bidding Auditability
-- Layer 4: Market Gateway
-- Requirement: FIX-PROT-AUDIT (Auditability for FIX message bidding)

ALTER TABLE market_bids
ADD COLUMN IF NOT EXISTS physics_score DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS capacity_fidelity VARCHAR(20),
ADD COLUMN IF NOT EXISTS audit_context JSONB;

-- Comment for engineering clarity
COMMENT ON COLUMN market_bids.physics_score IS 'L1 Physics Engine confidence score at time of bid generation (0.0 - 1.0)';
COMMENT ON COLUMN market_bids.capacity_fidelity IS 'Fidelity status of L3 aggregated capacity (HIGH_FIDELITY or STANDARD)';
COMMENT ON COLUMN market_bids.audit_context IS 'Metadata containing L1 safety lock context and regional grid lock status at time of bid';
