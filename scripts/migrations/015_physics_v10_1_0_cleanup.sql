-- MiGrid Physics Engine - v10.1.0 Cleanup & Audit Hardening
-- 015_physics_v10_1_0_cleanup.sql

-- 1. Hardening audit_log schema for Phase 5 enterprise standards
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS v2g_active BOOLEAN;

-- 2. Optimize enforce_fuse_rule for sub-millisecond execution and regional transparency
CREATE OR REPLACE FUNCTION enforce_fuse_rule()
RETURNS TRIGGER AS $$
DECLARE
    v_vpp_active BOOLEAN;
    v_iso_region VARCHAR(50);
    v_market_price DECIMAL(12,4);
BEGIN
    -- Concurrent check for VPP participation
    SELECT vpp_participation_active INTO v_vpp_active
    FROM driver_preferences
    WHERE driver_id = (SELECT id FROM drivers WHERE id = NEW.id OR id = (SELECT id FROM drivers WHERE fleet_id = NEW.fleet_id LIMIT 1));

    -- Prevent current_soc from dropping below 20.0
    IF NEW.current_soc < 20.0 AND OLD.current_soc >= 20.0 THEN
        -- Optimized context lookup (single scan)
        SELECT iso_region, market_price_at_session INTO v_iso_region, v_market_price
        FROM charging_sessions
        WHERE vehicle_id = NEW.id
        ORDER BY start_time DESC
        LIMIT 1;

        -- Log Capacity Violation with regional context
        INSERT INTO audit_log (violation_type, expected_value, actual_value, severity, metadata, vpp_active, iso_region, market_price_at_session)
        VALUES ('CAPACITY_VIOLATION', 20.0, NEW.current_soc, 'CRITICAL',
                jsonb_build_object(
                    'vehicle_id', NEW.id,
                    'vin', NEW.vin,
                    'msg', 'BESS Discharge Rejection: SoC < 20% (Aggressive Market Bid Rejected)'
                ),
                v_vpp_active, v_iso_region, v_market_price);

        -- Enriched notification for L1 Physics Engine
        PERFORM pg_notify('physics_alerts', json_build_object(
            'event_type', 'CAPACITY_VIOLATION',
            'vehicle_id', NEW.id,
            'vin', NEW.vin,
            'current_soc', NEW.current_soc,
            'threshold', 20.0,
            'vpp_active', v_vpp_active,
            'iso_region', v_iso_region,
            'market_price_at_session', v_market_price,
            'timestamp', NOW()
        )::text);

        -- Hard Stop: Preserve physical battery floor
        NEW.current_soc := OLD.current_soc;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
