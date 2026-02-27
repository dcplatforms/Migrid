-- Add subscription and split-billing support to Commerce Engine

ALTER TABLE tariffs ADD COLUMN type VARCHAR(50) DEFAULT 'CONSUMPTION'; -- CONSUMPTION, SUBSCRIPTION
ALTER TABLE tariffs ADD COLUMN monthly_fee DECIMAL(15,2) DEFAULT 0;

CREATE TABLE fleet_driver_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_id UUID REFERENCES fleets(id),
    driver_id UUID, -- References driver_id from L5/L10 if exists
    split_percentage DECIMAL(5,2) DEFAULT 100.0, -- Percentage billed to fleet
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices now have a type
ALTER TABLE invoices ADD COLUMN type VARCHAR(50) DEFAULT 'FLEET'; -- FLEET, DRIVER
ALTER TABLE invoices ADD COLUMN driver_id UUID;
