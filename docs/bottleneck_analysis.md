# MiGrid Strategic Bottleneck Analysis: 1,000+ Concurrent V2G Sessions

**Phase 5: Enterprise Scale** • **Target: 1,000+ Concurrent V2G/Charging Sessions**

## Executive Summary

To support our Phase 5 goals of enterprise-scale operation (1,000+ concurrent sessions), we analyzed the current Layer 1 Physics Engine architecture. While the use of PL/pgSQL for real-time validation provides high performance, several systemic bottlenecks must be addressed to ensure sub-500ms latency for frequency regulation compliance.

---

## 1. PostgreSQL Connection Pool Saturation

### Current State
- Every session update triggers a PL/pgSQL function.
- `max_connections` in default PostgreSQL is typically 100.
- With 1,000+ concurrent sessions, we will hit connection limits and increase query wait times.

### Risk
- Connection exhaustion (ECONNREFUSED) for API services.
- Latency spikes during peak telemetry bursts (OCPP MeterValues).

### Recommendation
- **Implement PgBouncer** for transaction-level pooling to handle thousands of connections with a smaller backend pool.
- **Horizontal Sharding:** Partition `charging_sessions` by `fleet_id` using PostgreSQL Declarative Partitioning.

---

## 2. Kafka Consumer Lag on `migrid.physics.alerts`

### Current State
- L1 Physics Engine service acts as a single producer for alerts.
- L8 Energy Manager subscribes to this topic.

### Risk
- If L8 processing is slower than the incoming rate of efficiency alerts (which could be hundreds per second during grid events), lag will grow.
- DLM actions (curtailment) will be delayed, potentially violating grid connection limits.

### Recommendation
- **Increase Partitions:** Set `migrid.physics.alerts` to 12+ partitions.
- **Consumer Groups:** Run multiple instances of L8 Energy Manager in a consumer group to parallelize processing.

---

## 3. Redis Memory Footprint for Edge Sites

### Current State
- L1 and L7 cache SoC, session states, and local audit logs in Redis.
- Memory usage is O(N) where N is the number of active sessions.

### Risk
- 1,000 sessions × 10KB state each = 10MB. This is small, but if local logs (reconciliation buffer) are not cleared due to persistent cloud offline status, Redis memory could overflow.

### Recommendation
- **Eviction Policy:** Use `volatile-lru` and ensure safety-critical keys (SoC, safety limits) have NO expiry, while audit logs are capped.
- **Redis Sentinel/Cluster:** For high availability at larger depot sites.

---

## 4. Physics Variance Calculation Latency

### Current State
- Complexity: O(1) per update (arithmetic).
- Target: Sub-500ms.

### Bottleneck
- Trigger overhead on high-velocity inserts.
- TimescaleDB hypertable indexing overhead for 100+ writes/second.

### Recommendation
- **Async Validation:** Consider moving the 15% variance check to a background job if real-time enforcement is not required for the ledger (though our PO-optimized prompt insisted on real-time).
- **Index Tuning:** Optimize indices on `charging_sessions` to ensure `vehicle_id` and `start_time` lookups are sub-10ms.

---

## Phase 5 Scalability Conclusion

The current L1 architecture is robust for hundreds of sessions. To reach **1,000+ sessions**, we must prioritize **PgBouncer integration** and **Kafka partitioning** to maintain our <500ms latency requirement. Vertical scaling will suffice for the DB (64GB+ RAM) for Phase 5, but Phase 7 (Global Expansion) will require horizontal sharding.
