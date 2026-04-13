-- MiGrid L4: Bidding Auditability (v3.8.0)
-- Layer 4: Market Gateway
-- Requirement: FIX-PROT-AUDIT (High-Fidelity Confidence Scoring)

ALTER TABLE market_bids
ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,4);

-- Comment for engineering clarity
COMMENT ON COLUMN market_bids.confidence_score IS 'L1 Physics Engine data confidence score (0.0 - 1.0) for L11 ML readiness';

-- Update existing records with default confidence score
UPDATE market_bids SET confidence_score = 1.0 WHERE confidence_score IS NULL;
