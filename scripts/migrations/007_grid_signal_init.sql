-- MiGrid Grid Signal Schema
-- Layer 2: OpenADR 3.0 Event Storage

CREATE TABLE IF NOT EXISTS grid_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(255) UNIQUE NOT NULL,
    event_type VARCHAR(50) NOT NULL DEFAULT 'demand-response',
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Index for fast lookup by event_id
CREATE INDEX IF NOT EXISTS idx_grid_events_event_id ON grid_events(event_id);

-- Index for status tracking
CREATE INDEX IF NOT EXISTS idx_grid_events_status ON grid_events(status);
