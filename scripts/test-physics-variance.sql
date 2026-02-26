-- MiGrid Physics Variance Verification Suite
-- To be run with psql or the migration applicator

BEGIN;

-- 1. Setup Test Environment
-- (Assumes migrations 001-004 are applied)

TRUNCATE charging_sessions, audit_log, vehicles, fleets RESTART IDENTITY CASCADE;

INSERT INTO fleets (name, grid_connection_limit_kw) VALUES ('Test Fleet', 500) RETURNING id;

INSERT INTO vehicles (fleet_id, vin, battery_capacity_kwh, current_soc, make, model)
VALUES ((SELECT id FROM fleets LIMIT 1), 'VIN001', 100, 50, 'Tesla', 'Model 3');

-- 2. Test Case: Normal Session with < 15% Variance (PASS)
-- E_disp = 10, E_regen = 2, E_batt = 11.5
-- Expected = 12. Variance = |11.5 - 12| / 10 = 0.5 / 10 = 0.05 (5%)
INSERT INTO charging_sessions (vehicle_id, start_time, energy_dispensed_kwh, energy_regen_kwh, energy_battery_delta_kwh)
VALUES ((SELECT id FROM vehicles WHERE vin='VIN001'), NOW(), 10.0, 2.0, 11.5);

SELECT id, energy_dispensed_kwh, variance_percentage, is_valid
FROM charging_sessions WHERE energy_battery_delta_kwh = 11.5;

-- 3. Test Case: Boundary Session at Exactly 15% Variance (PASS)
-- E_disp = 10, E_regen = 0, E_batt = 11.5
-- Expected = 10. Variance = |11.5 - 10| / 10 = 1.5 / 10 = 0.15 (15%)
INSERT INTO charging_sessions (vehicle_id, start_time, energy_dispensed_kwh, energy_regen_kwh, energy_battery_delta_kwh)
VALUES ((SELECT id FROM vehicles WHERE vin='VIN001'), NOW(), 10.0, 0.0, 11.5);

SELECT id, variance_percentage, is_valid
FROM charging_sessions WHERE energy_battery_delta_kwh = 11.5 AND energy_regen_kwh = 0;

-- 4. Test Case: Variance > 15% Triggering PHYSICS_FRAUD
-- E_disp = 10, E_regen = 0, E_batt = 12.0
-- Expected = 10. Variance = |12.0 - 10| / 10 = 0.2 (20%)
INSERT INTO charging_sessions (vehicle_id, start_time, energy_dispensed_kwh, energy_regen_kwh, energy_battery_delta_kwh)
VALUES ((SELECT id FROM vehicles WHERE vin='VIN001'), NOW(), 10.0, 0.0, 12.0);

SELECT id, variance_percentage, is_valid
FROM charging_sessions WHERE energy_battery_delta_kwh = 12.0;

-- Check Audit Log for Fraud
SELECT violation_type, variance_pct, severity
FROM audit_log WHERE violation_type = 'PHYSICS_FRAUD';

-- 5. Test Case: Efficiency < 85% Triggering EFFICIENCY_ALERT
-- E_disp = 10, E_regen = 0, E_batt = 8.0
-- Efficiency = 8 / 10 = 0.8 (80%)
INSERT INTO charging_sessions (vehicle_id, start_time, energy_dispensed_kwh, energy_regen_kwh, energy_battery_delta_kwh)
VALUES ((SELECT id FROM vehicles WHERE vin='VIN001'), NOW(), 10.0, 0.0, 8.0);

SELECT violation_type, expected_value, actual_value, severity
FROM audit_log WHERE violation_type = 'EFFICIENCY_ALERT';

-- 6. Test Case: The Fuse Rule (20% SoC Rejection)
-- Try to update vehicle SoC to 15.0
DO $$
BEGIN
    UPDATE vehicles SET current_soc = 15.0 WHERE vin = 'VIN001';
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Caught Expected Rejection: %', SQLERRM;
END $$;

-- Check Audit Log for Capacity Violation
SELECT violation_type, severity, metadata->>'msg' as message
FROM audit_log WHERE violation_type = 'CAPACITY_VIOLATION';

-- 7. High Concurrency Simulation (100 sessions)
DO $$
BEGIN
    FOR i IN 1..100 LOOP
        INSERT INTO charging_sessions (vehicle_id, start_time, energy_dispensed_kwh, energy_battery_delta_kwh)
        VALUES ((SELECT id FROM vehicles WHERE vin='VIN001'), NOW(), 1.0, 1.05);
    END LOOP;
END $$;

SELECT count(*) as high_concurrency_count FROM charging_sessions;

ROLLBACK; -- Clean up
