-- L5 Driver Experience Updates
-- Mobility Constraints, VPP Participation, and Mobile UX support

-- 1. Ensure drivers table exists (L5 creates it implicitly in some environments,
-- but we need to ensure it has a stable structure here for references)
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_id UUID REFERENCES fleets(id),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add Push Token and ISO 15118 status to drivers
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS expo_push_token VARCHAR(255);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_plug_and_charge_ready BOOLEAN DEFAULT false;

-- 3. Ensure driver_preferences table exists and add mobility/VPP fields
CREATE TABLE IF NOT EXISTS driver_preferences (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id),
    preferred_billing_mode VARCHAR(20) DEFAULT 'FLEET', -- FLEET, PERSONAL
    min_target_soc DECIMAL(5,2) DEFAULT 80.0,
    target_departure_time TIME DEFAULT '08:00:00',
    vpp_participation_active BOOLEAN DEFAULT true,
    selected_tariff_id UUID REFERENCES tariffs(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Ensure driver_wallets table is up to date with blockchain identity and claiming support
ALTER TABLE driver_wallets ADD COLUMN IF NOT EXISTS open_wallet_address VARCHAR(255) UNIQUE;
ALTER TABLE driver_wallets ADD COLUMN IF NOT EXISTS external_wallet_address VARCHAR(255);
ALTER TABLE driver_wallets ADD COLUMN IF NOT EXISTS last_claim_at TIMESTAMPTZ;
