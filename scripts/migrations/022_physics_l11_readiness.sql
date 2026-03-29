-- MiGrid Physics Engine - v10.1.0 L11 ML Readiness Update
-- 022_physics_l11_readiness.sql

-- 1. Add high-fidelity training columns to audit_log for L11 ML Engine Ground Truth
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4),
ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT FALSE;

-- 2. Create index on physics_score for high-fidelity data extraction (L11 training)
CREATE INDEX IF NOT EXISTS idx_audit_log_physics_score ON audit_log (physics_score);
CREATE INDEX IF NOT EXISTS idx_audit_log_high_fidelity ON audit_log (is_high_fidelity) WHERE is_high_fidelity = TRUE;

-- 3. Optimized GIN index for metadata enriched filtering (L11 ML Engine readiness)
CREATE INDEX IF NOT EXISTS idx_audit_log_metadata_gin ON audit_log USING GIN (metadata);

-- 4. Comment on table for data dictionary clarity
COMMENT ON COLUMN audit_log.physics_score IS 'L1 Physics Engine confidence score (0.0 to 1.0). <15% variance mapping.';
COMMENT ON COLUMN audit_log.is_high_fidelity IS 'TRUE if physics_score > 0.95, indicating gold-standard training data for L11.';
