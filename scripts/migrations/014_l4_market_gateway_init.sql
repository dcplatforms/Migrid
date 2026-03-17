-- MiGrid Market Gateway Schema
-- Layer 4: Wholesale Market Integration (CAISO, PJM, ERCOT, NORDPOOL)

-- 1. LMP Prices Table (Time-series)
CREATE TABLE IF NOT EXISTS lmp_prices (
    id UUID DEFAULT gen_random_uuid(),
    iso VARCHAR(50) NOT NULL,
    location VARCHAR(255) NOT NULL,
    price_per_mwh DECIMAL(12,4) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (id, timestamp)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('lmp_prices', 'timestamp', if_not_exists => TRUE);

-- 2. Market Bids Table (Time-series)
CREATE TABLE IF NOT EXISTS market_bids (
    id UUID DEFAULT gen_random_uuid(),
    iso VARCHAR(50) NOT NULL,
    market_type VARCHAR(50) NOT NULL, -- day-ahead, real-time, etc.
    quantity_kw DECIMAL(12,2) NOT NULL,
    price_per_mwh DECIMAL(12,4) NOT NULL,
    total_value_usd DECIMAL(12,2) NOT NULL,
    delivery_hour INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, submitted_at)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('market_bids', 'submitted_at', if_not_exists => TRUE);

-- 3. Indices for performance
CREATE INDEX IF NOT EXISTS idx_lmp_prices_iso_timestamp ON lmp_prices(iso, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_bids_iso_status ON market_bids(iso, status);
