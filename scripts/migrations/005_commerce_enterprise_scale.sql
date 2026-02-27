-- MiGrid Commerce Engine - Enterprise Scale Migration
-- Phase 5: Flexible billing, tariffs, and split-billing

-- 1. Locations and Chargers
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    tax_jurisdiction_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chargers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES locations(id),
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    model VARCHAR(100),
    firmware_version VARCHAR(50),
    status VARCHAR(50) DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Revenue Sharing Metadata
CREATE TABLE charger_metadata (
    charger_id UUID PRIMARY KEY REFERENCES chargers(id),
    platform_fee_percentage DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    host_revenue_percentage DECIMAL(5, 2) NOT NULL DEFAULT 95.00,
    is_public BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Flexible Tariff Schedules
-- Redefining Tariffs to be more flexible
ALTER TABLE tariffs ADD COLUMN tariff_type VARCHAR(20) DEFAULT 'FIXED'; -- FIXED, TOU, DYNAMIC
ALTER TABLE tariffs ADD COLUMN margin_per_kwh DECIMAL(10, 4) DEFAULT 0; -- For DYNAMIC (LMP + Margin)

CREATE TABLE tariff_time_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id UUID REFERENCES tariffs(id),
    day_of_week INTEGER, -- 0-6, NULL for all days
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    rate_kwh DECIMAL(10, 4) NOT NULL,
    label VARCHAR(50), -- Peak, Off-Peak, Shoulder
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Driver Preferences for Split-Billing
CREATE TABLE driver_preferences (
    driver_id UUID PRIMARY KEY, -- REFERENCES drivers(driver_id) - assuming drivers table exists or will be linked
    preferred_billing_mode VARCHAR(20) DEFAULT 'FLEET', -- FLEET, PERSONAL
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Updates to Charging Sessions
ALTER TABLE charging_sessions ADD COLUMN charger_id UUID REFERENCES chargers(id);
ALTER TABLE charging_sessions ADD COLUMN billing_mode VARCHAR(20) DEFAULT 'FLEET'; -- FLEET, PERSONAL
ALTER TABLE charging_sessions ADD COLUMN platform_fee DECIMAL(10, 2);
ALTER TABLE charging_sessions ADD COLUMN host_revenue DECIMAL(10, 2);
ALTER TABLE charging_sessions ADD COLUMN tax_amount DECIMAL(10, 2);
ALTER TABLE charging_sessions ADD COLUMN tax_rate DECIMAL(5, 2);

-- 6. Invoices Enhancements
ALTER TABLE invoices ADD COLUMN total_tax DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN total_platform_fees DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN currency VARCHAR(3) DEFAULT 'USD';
ALTER TABLE invoices ADD COLUMN billing_entity_type VARCHAR(20); -- FLEET, INDIVIDUAL
ALTER TABLE invoices ADD COLUMN billing_entity_id UUID; -- fleet_id or driver_id
