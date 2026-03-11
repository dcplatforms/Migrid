# L3 VPP Aggregator: Weekly Technical Steering & PO Report

## 1. Cross-Layer Impact Analysis
Recent updates across the MiGrid ecosystem have direct implications for the VPP Aggregator's coordination and dispatch logic:

*   **L1 (Physics Engine) - The Fuse Rule**: L1 now strictly enforces a 20% SoC hard stop (the "Fuse Rule") via database triggers and emits `CAPACITY_VIOLATION` alerts to Kafka. L3 must integrate this 20% floor into all capacity calculations to ensure that market bids and dispatch commands are physically achievable and do not trigger L1 safety rejections.
*   **L2 (Grid Signal) - OpenADR 3.0**: L2 is now successfully broadcasting utility events via the `grid_signals` Kafka topic. L3 must consume these events to trigger automated dispatch sequences for fleet and BESS resources.
*   **L4 (Market Gateway) - Bidding SLA**: L4 requires sub-50ms latency for available capacity queries to optimize high-frequency bidding strategies. L3 must move from real-time database aggregation to a Redis-cached capacity model to meet this SLA.
*   **L9 (Commerce Engine) - High-Precision Billing**: L9's move to split-billing (FLEET vs. DRIVER) increases the need for accurate VPP participation logging to ensure correct revenue distribution for grid-supportive actions.

## 2. Engineering Directives & Spec Updates
To align with the above impacts, the following engineering updates are being implemented in `services/03-vpp-aggregator`:

*   **Refined Capacity Formula**: The SQL aggregation logic is updated to:
    `SUM(MAX(0, (v.current_soc - GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)) / 100.0 * v.battery_capacity_kwh * COALESCE(v.availability_factor, 1.0)))`
    This ensures that the 20% L1 floor is always respected, even if the driver's `min_soc_threshold` is set lower.
*   **Kafka Integration (kafkajs)**: Transitioning from `kafka-node` to `kafkajs` for parity with L1/L2. Implementing consumers for `migrid.physics.alerts` (to track safety-throttled resources) and `grid_signals` (to trigger DR events).
*   **Redis Caching Strategy**: A background job will update the `vpp:capacity:available` key in Redis every 10 seconds. The `/capacity/available` API endpoint will serve from Redis as the primary source of truth for L4.
*   **IEEE 2030.5 Compliance**: Ensuring all dispatch messages include necessary SEP 2.0 metadata for interoperability with utility-scale DERMS.

## 3. Updated L3 Backlog & Action Items
Based on the Phase 5 "Enterprise Scale" objectives and current ecosystem deltas:

*   **[STORY] BESS Integration (Q1 2026)**: Expand resource registration and capacity logic to support stationary Battery Energy Storage Systems.
    *   *AC*: BESS assets must also adhere to the 20% SoC hard stop.
    *   *AC*: Dispatch logic must prioritize BESS before mobile EVs for high-frequency regulation.
*   **[TASK] Redis-Based Capacity Cache**: Implement sub-50ms capacity reporting for L4.
*   **[TASK] OpenADR 3.0 Automated Dispatch**: Integrate L2 Kafka signals to automate the VPP response to utility demand-response events.
*   **[TASK] Physics-Aware Forecasting**: Update forecasting algorithms to incorporate L1 variance data to improve bid reliability.
