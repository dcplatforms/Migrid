-- MiGrid Physics Engine - L11 AI Readiness (v10.1.0)
-- 022_physics_l11_readiness.sql

-- 1. Update audit_log with physics_score and high-fidelity flag
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4) DEFAULT 1.0000,
ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT TRUE;

-- 2. Add GIN index to metadata for L11 training data extraction
CREATE INDEX IF NOT EXISTS idx_audit_log_metadata_gin ON audit_log USING GIN (metadata);

-- 3. Update vehicles with current physics_score and fidelity status
ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4) DEFAULT 1.0000,
ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT TRUE;
