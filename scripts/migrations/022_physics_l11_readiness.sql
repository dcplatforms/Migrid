-- Migration: 022_physics_l11_readiness.sql
-- Description: Add physics_score and is_high_fidelity to audit_log for L11 ML Engine training.

ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS physics_score NUMERIC(5,4),
ADD COLUMN IF NOT EXISTS is_high_fidelity BOOLEAN DEFAULT FALSE;

-- Update existing records: sessions with <15% variance are considered high fidelity
UPDATE audit_log
SET physics_score = GREATEST(0, LEAST(1, 1 - (variance_pct / 15.0))),
    is_high_fidelity = (1 - (variance_pct / 15.0) > 0.95)
WHERE physics_score IS NULL AND variance_pct IS NOT NULL;

-- Default for others (where variance_pct might be missing but efficiency_pct exists)
UPDATE audit_log
SET physics_score = GREATEST(0, LEAST(1, actual_value / 100.0)),
    is_high_fidelity = (actual_value / 100.0 > 0.95)
WHERE physics_score IS NULL AND violation_type = 'EFFICIENCY_ALERT';

-- Index for ML Engine data extraction
CREATE INDEX IF NOT EXISTS idx_audit_log_fidelity ON audit_log (is_high_fidelity, physics_score);
