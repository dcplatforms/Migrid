-- MiGrid VPP Aggregator - Phase 5 Enterprise Scale (v3.3.0)
-- 018_l3_capacity_history_and_regional_aggregation.sql

-- 1. Create table for VPP Capacity History (L11 ML Training Data)
CREATE TABLE IF NOT EXISTS vpp_capacity_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    total_capacity_kwh DECIMAL(12,2) NOT NULL,
    regional_data JSONB NOT NULL,
    physics_multiplier DECIMAL(5,4) DEFAULT 1.0,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable for high-performance time-series queries
SELECT create_hypertable('vpp_capacity_history', 'timestamp', if_not_exists => TRUE);

-- 2. Index for L11 training data export optimization
CREATE INDEX IF NOT EXISTS idx_vpp_capacity_timestamp ON vpp_capacity_history (timestamp DESC);

-- 3. Note: iso_region is already present in charging_sessions (via migration 012)
-- and in chargers (via migration 016) to support regional aggregation in L3.
