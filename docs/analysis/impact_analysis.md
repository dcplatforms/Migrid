# L1 Physics Engine: Weekly Impact Analysis (L2-L10 Updates)

## Overview
This document analyzes the impact of recent updates across Layers 2 through 10 on the Layer 1 (L1) Physics Engine's invariants and safety rules.

## Cross-Layer Impacts

### L3: VPP Aggregator & L8: Energy Manager
- **Observation**: Both L3 and L8 utilize the `min_soc_threshold` field from the `vehicles` table to determine available capacity for V2G discharge and power allocation.
- **Risk**: If `min_soc_threshold` is configured below the L1 "Fuse Rule" limit (20% SoC), these layers may overestimate available energy or attempt to command discharges that L1 will physically reject.
- **L1 Requirement**: L1 must maintain the 20% hard stop as the absolute "Ground Truth," regardless of upstream configuration.

### L4: Market Gateway
- **Observation**: L4 generates Day-Ahead bids based on aggregated capacity from L3. It optimizes for battery degradation cost ($0.02/kWh).
- **Risk**: Aggressive bidding based on inaccurate capacity (from L3) could lead to non-delivery of promised grid services when L1 enforces the Fuse Rule.
- **L1 Requirement**: L1 must provide clear "Capacity Violation" alerts to notify L4 and L3 that they are operating too close to the safety margin.

### L7: Device Gateway
- **Observation**: L7 has transitioned to **OCPP 2.1 (Flagship)**, enabling native V2X and high-precision power control.
- **Risk**: Increased telemetry frequency (for bidirectional flow) increases the processing load on L1's physics validation triggers.
- **L1 Requirement**: L1's heartbeat and reconciliation logic must remain the master record for energy dispensed vs. battery delta (The Green Audit) even under high-frequency V2X cycles.

### L11: ML Engine
- **Observation**: L11 performs demand forecasting and predictive maintenance using L1's historical physics-verified data.
- **Risk**: Inaccurate L1 audit logs (e.g., due to telematics lag) will degrade the accuracy of ML predictions for L3/L4.
- **L1 Requirement**: L1 must ensure all telemetry data is time-stamped with millisecond precision to allow L11 to correlate physics events with grid price signals accurately.

### L9: Commerce Engine
- **Observation**: New split-billing and subscription models (FLEET vs. DRIVER) depend on accurate `energy_dispensed_kwh`.
- **Impact**: L1's Green Audit (<15% variance rule) is now even more critical for financial ledger integrity. Any fraud detection (PHYSICS_FRAUD) must immediately invalidate the session for billing.

## Conclusion
The L1 Physics Engine must be enhanced to provide more granular alerting for `PHYSICS_FRAUD` and `CAPACITY_VIOLATION` to ensure upstream layers (L3, L4, L8) and the newly integrated **L11 ML Engine** can react to physical constraints and optimize the platform based on verified grid-edge reality.
