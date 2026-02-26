-- MiGrid Physics Engine Updates
-- Layer 1 Physics Invariants and Safety Rules

-- 1. Update charging_sessions table with high-precision telemetry fields
ALTER TABLE charging_sessions
ADD COLUMN IF NOT EXISTS energy_regen_kwh DECIMAL(12,6) DEFAULT 0.000000,
ADD COLUMN IF NOT EXISTS energy_battery_delta_kwh DECIMAL(12,6) DEFAULT 0.000000;

-- 2. Define Enums for Audit Logging
DO $$ BEGIN
    CREATE TYPE violation_type AS ENUM (
        'PHYSICS_FRAUD',
        'EFFICIENCY_ALERT',
        'CAPACITY_VIOLATION',
        'REGEN_ANOMALY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE severity_level AS ENUM (
        'WARNING',
        'CRITICAL',
        'FRAUD'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Create Append-Only Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES charging_sessions(id),
    violation_type violation_type NOT NULL,
    expected_value DECIMAL(12,6),
    actual_value DECIMAL(12,6),
    variance_pct DECIMAL(8,4),
    severity severity_level NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('audit_log', 'created_at', if_not_exists => TRUE);

-- 4. Physics Invariant Validation Function
CREATE OR REPLACE FUNCTION validate_physics_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_variance_pct DECIMAL(8,4);
    v_efficiency_pct DECIMAL(8,4);
    v_expected_delta DECIMAL(12,6);
BEGIN
    -- E_expected = E_dispensed + E_regen
    v_expected_delta := COALESCE(NEW.energy_dispensed_kwh, 0) + COALESCE(NEW.energy_regen_kwh, 0);

    -- Calculate variance: |E_batt - E_expected| / E_dispensed
    IF COALESCE(NEW.energy_dispensed_kwh, 0) > 0 THEN
        v_variance_pct := ABS(COALESCE(NEW.energy_battery_delta_kwh, 0) - v_expected_delta) / NEW.energy_dispensed_kwh;
    ELSE
        v_variance_pct := 0;
    END IF;

    -- Update variance in charging_sessions
    NEW.variance_percentage := v_variance_pct * 100;

    -- Check PHYSICS_FRAUD (> 15% variance)
    IF v_variance_pct > 0.15 THEN
        INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, variance_pct, severity)
        VALUES (NEW.id, 'PHYSICS_FRAUD', v_expected_delta, NEW.energy_battery_delta_kwh, v_variance_pct * 100, 'FRAUD');
        NEW.is_valid := FALSE;
    ELSE
        NEW.is_valid := TRUE;
    END IF;

    -- Check EFFICIENCY_ALERT (< 85% efficiency)
    IF v_expected_delta > 0 THEN
        v_efficiency_pct := COALESCE(NEW.energy_battery_delta_kwh, 0) / v_expected_delta;
        IF v_efficiency_pct < 0.85 THEN
            INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, variance_pct, severity, metadata)
            VALUES (NEW.id, 'EFFICIENCY_ALERT', 0.85, v_efficiency_pct, (0.85 - v_efficiency_pct) * 100, 'WARNING',
                    jsonb_build_object('efficiency_pct', v_efficiency_pct * 100));

            -- Notify Node.js L1 Physics Engine for Kafka alert
            PERFORM pg_notify('physics_alerts', json_build_object(
                'event_type', 'EFFICIENCY_ALERT',
                'session_id', NEW.id,
                'efficiency_pct', v_efficiency_pct * 100,
                'threshold', 85,
                'timestamp', NOW()
            )::text);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger for Physics Validation
DROP TRIGGER IF EXISTS trg_validate_physics ON charging_sessions;
CREATE TRIGGER trg_validate_physics
BEFORE INSERT OR UPDATE OF energy_dispensed_kwh, energy_regen_kwh, energy_battery_delta_kwh
ON charging_sessions
FOR EACH ROW
EXECUTE FUNCTION validate_physics_invariant();

-- 6. The Fuse Rule: 20% SoC Hard Stop
CREATE OR REPLACE FUNCTION enforce_fuse_rule()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent current_soc from dropping below 20.0
    IF NEW.current_soc < 20.0 AND OLD.current_soc >= 20.0 THEN
        -- Log Capacity Violation
        INSERT INTO audit_log (violation_type, expected_value, actual_value, severity, metadata)
        VALUES ('CAPACITY_VIOLATION', 20.0, NEW.current_soc, 'CRITICAL',
                jsonb_build_object('vehicle_id', NEW.id, 'vin', NEW.vin, 'msg', 'BESS Discharge Rejection: SoC < 20%'));

        RAISE EXCEPTION 'BESS Capacity Violation: SoC cannot drop below 20%%. Command rejected by L1 Physics Engine (The Fuse Rule).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for Fuse Rule on Vehicles
DROP TRIGGER IF EXISTS trg_fuse_rule ON vehicles;
CREATE TRIGGER trg_fuse_rule
BEFORE UPDATE OF current_soc
ON vehicles
FOR EACH ROW
WHEN (NEW.current_soc < OLD.current_soc)
EXECUTE FUNCTION enforce_fuse_rule();
