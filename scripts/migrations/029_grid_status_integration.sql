-- Migration 029: Grid Status Data Integration (Load Forecast and Fuel Mix)
-- Dedicated tables for high-fidelity data from gridstatus.io

-- 1. Load Forecasts Table
CREATE TABLE IF NOT EXISTS load_forecasts (
    id SERIAL PRIMARY KEY,
    iso TEXT NOT NULL,
    location TEXT NOT NULL,
    forecast_mw DECIMAL(15, 4) NOT NULL,
    forecast_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    publish_time TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable for time-series optimization
SELECT create_hypertable('load_forecasts', 'forecast_timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_load_forecasts_iso_time ON load_forecasts (iso, forecast_timestamp DESC);

-- 2. Fuel Mix (Carbon Intensity) Table
CREATE TABLE IF NOT EXISTS fuel_mix (
    id SERIAL PRIMARY KEY,
    iso TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    gen_mw DECIMAL(15, 4) NOT NULL,
    carbon_intensity_score DECIMAL(10, 4), -- Optional derived field
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('fuel_mix', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_fuel_mix_iso_time ON fuel_mix (iso, timestamp DESC);

-- 3. Net Load Table (Dedicated for CAISO "Duck Curve" and similar)
CREATE TABLE IF NOT EXISTS net_load (
    id SERIAL PRIMARY KEY,
    iso TEXT NOT NULL,
    actual_load_mw DECIMAL(15, 4),
    net_load_mw DECIMAL(15, 4) NOT NULL,
    renewables_mw DECIMAL(15, 4),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('net_load', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_net_load_iso_time ON net_load (iso, timestamp DESC);

-- Add comments for engineering audit
COMMENT ON TABLE load_forecasts IS 'L4: Grid Status Load Forecasts for predictive bidding';
COMMENT ON TABLE fuel_mix IS 'L4: Grid Status Fuel Mix for carbon-aware bidding and L10 rewards';
COMMENT ON TABLE net_load IS 'L4: Grid Status Net Load for Solar Ramp/Duck Curve detection';
