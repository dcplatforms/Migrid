# L1 Physics Engine Weekly Steering Report - April 2026 (AI Readiness & Confidence Scoring)

## Impact Summary
This week's updates focus on hardening the L1-L11 data pipeline for the upcoming launch of the **L11: ML Engine**. To ensure the ML engine receives only the highest-fidelity "Ground Truth" data, L1 now implements a **Data Confidence Score [L1-118]**. This score enables L11 to filter training inputs based on historical reliability (sentinel streaks) and data freshness (sync frequency).

Additionally, L1 now leverages **L7 Device Gateway's** Redis-based resource caching as a high-performance fallback. This ensures that `resource_type` metadata (EV vs. BESS) is always preserved in the digital twin, even during transient database connectivity issues, maintaining absolute fidelity in our regional reporting.

## Code Proposed
- **Data Confidence Scoring [L1-118]**: Implemented `calculateConfidenceScore(streak, lastSync)` in `services/01-physics-engine/index.js`.
    - Base Confidence: 0.5
    - Streak Bonus: +0.1 per sentinel streak point (max +0.4)
    - Frequency Bonus: +0.1 for syncs within the last 24 hours
- **L7 Redis Fallback**: Enhanced `syncDigitalTwin` to check `charger_resource:{id}` in Redis if the database join fails to provide a specific `resource_type`.
- **Real-Time Confidence Integration**: Added `confidence_score` to all Kafka alerts (`migrid.physics.alerts`) and the Redis safety lock context, providing L2-L4 with real-time reliability metrics.
- **Verification Suite 10.2.x**: Expanded `physics_engine.test.js` to 33 tests, validating confidence score calculations and Redis fallback mechanics.

## Backlog Updates
- **[L1-120]**: (L11 Alignment) Implement a "Confidence Decay" rule for vehicles that have been inactive for more than 30 days.
- **[L1-121]**: Research integrating L8 Site Energy snapshots into the L1 Confidence Score to account for local grid volatility.

## RFCs Needed
- **RFC-L1-C1**: Proposed formal specification for the "Data Confidence Score" to be consumed by L11 and L9 for risk-adjusted billing.

---
*“We do not trust the driver; we verify the physics.”*
