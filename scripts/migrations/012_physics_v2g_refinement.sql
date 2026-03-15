-- MiGrid Physics Engine - V2G Refinement & AI Data Readiness (v10.1.0)
-- 012_physics_v2g_refinement.sql

-- 1. Update charging_sessions with V2G and Market Context
ALTER TABLE charging_sessions
ADD COLUMN IF NOT EXISTS energy_pushed_to_grid_kwh DECIMAL(12,6) DEFAULT 0.000000,
ADD COLUMN IF NOT EXISTS iso_region VARCHAR(50),
ADD COLUMN IF NOT EXISTS market_price_at_session DECIMAL(12,4);

-- 2. Update audit_log with regional context for L11 training
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS iso_region VARCHAR(50),
ADD COLUMN IF NOT EXISTS market_price_at_session DECIMAL(12,4);

-- 3. Refine validate_physics_invariant for bidirectional flow
CREATE OR REPLACE FUNCTION validate_physics_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_variance_pct DECIMAL(8,4);
    v_efficiency_pct DECIMAL(8,4);
    v_expected_delta DECIMAL(12,6);
    v_v2g_active BOOLEAN;
BEGIN
    -- V2G Logic: E_expected = E_dispensed (Import) - E_pushed (Export) + E_regen
    v_expected_delta := COALESCE(NEW.energy_dispensed_kwh, 0) - COALESCE(NEW.energy_pushed_to_grid_kwh, 0) + COALESCE(NEW.energy_regen_kwh, 0);
    v_v2g_active := COALESCE(NEW.energy_pushed_to_grid_kwh, 0) > 0;

    -- Calculate variance: |E_batt - E_expected| / MAX(E_dispensed, E_pushed, 1.0) to avoid div by zero
    IF GREATEST(COALESCE(NEW.energy_dispensed_kwh, 0), COALESCE(NEW.energy_pushed_to_grid_kwh, 0)) > 0 THEN
        v_variance_pct := ABS(COALESCE(NEW.energy_battery_delta_kwh, 0) - v_expected_delta) / GREATEST(COALESCE(NEW.energy_dispensed_kwh, 0), COALESCE(NEW.energy_pushed_to_grid_kwh, 0));
    ELSE
        v_variance_pct := 0;
    END IF;

    -- Update variance in charging_sessions
    NEW.variance_percentage := v_variance_pct * 100;

    -- Check PHYSICS_FRAUD (> 15% variance)
    IF v_variance_pct > 0.15 THEN
        INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, variance_pct, severity, billing_mode, iso_region, market_price_at_session)
        VALUES (NEW.id, 'PHYSICS_FRAUD', v_expected_delta, NEW.energy_battery_delta_kwh, v_variance_pct * 100, 'FRAUD', NEW.billing_mode, NEW.iso_region, NEW.market_price_at_session);

        NEW.is_valid := FALSE;

        -- Notify Node.js L1 Physics Engine for Kafka alert
        PERFORM pg_notify('physics_alerts', json_build_object(
            'event_type', 'PHYSICS_FRAUD',
            'session_id', NEW.id,
            'variance_pct', v_variance_pct * 100,
            'expected', v_expected_delta,
            'actual', NEW.energy_battery_delta_kwh,
            'billing_mode', NEW.billing_mode,
            'iso_region', NEW.iso_region,
            'v2g_active', v_v2g_active,
            'timestamp', NOW()
        )::text);
    ELSE
        NEW.is_valid := TRUE;
    END IF;

    -- Check EFFICIENCY_ALERT (< 85% efficiency)
    IF ABS(v_expected_delta) > 0 THEN
        v_efficiency_pct := COALESCE(NEW.energy_battery_delta_kwh, 0) / v_expected_delta;
        IF v_efficiency_pct < 0.85 AND v_efficiency_pct > 0 THEN
            INSERT INTO audit_log (session_id, violation_type, expected_value, actual_value, variance_pct, severity, metadata, billing_mode, iso_region, market_price_at_session)
            VALUES (NEW.id, 'EFFICIENCY_ALERT', 0.85, v_efficiency_pct, (0.85 - v_efficiency_pct) * 100, 'WARNING',
                    jsonb_build_object('efficiency_pct', v_efficiency_pct * 100), NEW.billing_mode, NEW.iso_region, NEW.market_price_at_session);

            -- Notify Node.js L1 Physics Engine for Kafka alert
            PERFORM pg_notify('physics_alerts', json_build_object(
                'event_type', 'EFFICIENCY_ALERT',
                'session_id', NEW.id,
                'efficiency_pct', v_efficiency_pct * 100,
                'threshold', 85,
                'billing_mode', NEW.billing_mode,
                'iso_region', NEW.iso_region,
                'v2g_active', v_v2g_active,
                'timestamp', NOW()
            )::text);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Reinforce The Fuse Rule: 20% SoC Hard Stop with Market Context
CREATE OR REPLACE FUNCTION enforce_fuse_rule()
RETURNS TRIGGER AS $$
DECLARE
    v_vpp_active BOOLEAN;
BEGIN
    -- Fetch VPP participation status from driver_preferences
    SELECT vpp_participation_active INTO v_vpp_active
    FROM driver_preferences
    WHERE driver_id = (SELECT id FROM drivers WHERE id = NEW.id OR id = (SELECT id FROM drivers WHERE fleet_id = NEW.fleet_id LIMIT 1));

    -- Prevent current_soc from dropping below 20.0
    IF NEW.current_soc < 20.0 AND OLD.current_soc >= 20.0 THEN
        -- Log Capacity Violation
        INSERT INTO audit_log (violation_type, expected_value, actual_value, severity, metadata, vpp_active)
        VALUES ('CAPACITY_VIOLATION', 20.0, NEW.current_soc, 'CRITICAL',
                jsonb_build_object(
                    'vehicle_id', NEW.id,
                    'vin', NEW.vin,
                    'msg', 'BESS Discharge Rejection: SoC < 20% (Aggressive Market Bid Rejected)'
                ),
                v_vpp_active);

        -- Notify Node.js L1 Physics Engine for Kafka alert
        PERFORM pg_notify('physics_alerts', json_build_object(
            'event_type', 'CAPACITY_VIOLATION',
            'vehicle_id', NEW.id,
            'vin', NEW.vin,
            'current_soc', NEW.current_soc,
            'threshold', 20.0,
            'vpp_active', v_vpp_active,
            'timestamp', NOW()
        )::text);

        -- Hard Stop: Prevent the update
        NEW.current_soc := OLD.current_soc;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
