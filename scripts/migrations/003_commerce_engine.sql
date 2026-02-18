-- MiGrid Commerce Engine Schema
-- Tariffs and Billing

CREATE TABLE tariffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_id UUID REFERENCES fleets(id),
    name VARCHAR(255) NOT NULL,
    base_rate_kwh DECIMAL(10,4) NOT NULL, -- Price per kWh
    peak_rate_kwh DECIMAL(10,4),          -- Optional peak price
    peak_start_time TIME,                 -- Start of peak period
    peak_end_time TIME,                   -- End of peak period
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_id UUID REFERENCES fleets(id),
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    total_energy_kwh DECIMAL(15,3) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'DRAFT', -- DRAFT, SENT, PAID, OVERDUE
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link charging sessions to invoices (optional, but good for tracking)
ALTER TABLE charging_sessions ADD COLUMN invoice_id UUID REFERENCES invoices(id);
ALTER TABLE charging_sessions ADD COLUMN cost DECIMAL(10,2);
