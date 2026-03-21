-- MiGrid L2: Grid Signal Schema Hardening
-- Layer 2: OpenADR 3.1.0 Readiness & Metadata Support
-- March 2026

ALTER TABLE grid_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for efficient metadata queries (e.g., filtering by program_id)
CREATE INDEX IF NOT EXISTS idx_grid_events_metadata ON grid_events USING GIN (metadata);
