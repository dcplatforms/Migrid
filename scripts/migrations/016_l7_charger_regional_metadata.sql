-- MiGrid Device Gateway - Regional Metadata Integration (v10.1.0)
-- 016_l7_charger_regional_metadata.sql

-- 1. Add iso_region to chargers table to support regional grid locks and L11 training
ALTER TABLE chargers
ADD COLUMN IF NOT EXISTS iso_region VARCHAR(50);

-- 2. Seed initial regional mapping for existing chargers (demo sites)
-- CAISO: California
-- ERCOT: Texas
-- PJM: Pennsylvania-New Jersey-Maryland
-- NORDPOOL: Nordic Countries

UPDATE chargers SET iso_region = 'CAISO' WHERE serial_number LIKE 'CA%';
UPDATE chargers SET iso_region = 'ERCOT' WHERE serial_number LIKE 'TX%';
UPDATE chargers SET iso_region = 'PJM' WHERE serial_number LIKE 'PJM%';
UPDATE chargers SET iso_region = 'NORDPOOL' WHERE serial_number LIKE 'NP%';
UPDATE chargers SET iso_region = 'CAISO' WHERE iso_region IS NULL; -- Default for demo
