-- MiGrid VPP Aggregator - Phase 5 Enterprise Scale (v3.3.0)
-- 022_l3_bess_and_ml_refinement.sql

-- 1. Create vpp_resources table (ensuring it exists)
CREATE TABLE IF NOT EXISTS vpp_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID UNIQUE NOT NULL,
    battery_capacity_kwh DECIMAL(10,2) NOT NULL,
    v2g_enabled BOOLEAN DEFAULT false,
    resource_type VARCHAR(20) DEFAULT 'EV', -- 'EV' or 'BESS'
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add resource_type to vpp_resources if table already existed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vpp_resources' AND column_name='resource_type') THEN
        ALTER TABLE vpp_resources ADD COLUMN resource_type VARCHAR(20) DEFAULT 'EV';
    END IF;
END $$;

-- 3. Add safety_context to vpp_capacity_history for L11 training data enrichment
ALTER TABLE vpp_capacity_history ADD COLUMN IF NOT EXISTS safety_context JSONB;

-- 4. Create index for resource_type queries
CREATE INDEX IF NOT EXISTS idx_vpp_resources_type ON vpp_resources (resource_type);

-- 5. Backfill existing vehicles into vpp_resources as 'EV'
INSERT INTO vpp_resources (vehicle_id, battery_capacity_kwh, v2g_enabled, resource_type)
SELECT id, battery_capacity_kwh, v2g_enabled, 'EV'
FROM vehicles
ON CONFLICT (vehicle_id) DO NOTHING;
