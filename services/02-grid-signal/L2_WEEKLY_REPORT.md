### 🌐 L2 Grid Signal: Weekly Sync & Update (v2.4.1)
*   **Cross-Layer Delta:**
    *   **L1 (Physics Engine):** Confirmed alignment with v10.1.0; ensuring `<15% variance threshold` and `physics_score` (0.0-1.0) propagation in all grid event broadcasts.
    *   **L3 (VPP Aggregator):** Integrated regional capacity metadata from Redis for enhanced reporting.
    *   **L4 (Market Gateway):** Synchronized ISO normalization (uppercase, no hyphens) for 'ENTSOE' and other regional identifiers to ensure cross-layer consistency in grid locks and price signals.
    *   **L8 (Energy Manager):** Hardened site-level status tracking (OPERATIONAL, SAFE_MODE, METER_OFFLINE) to prevent dispatch to disconnected assets.

*   **OpenADR 3.0 Health:**
    *   **Protocol Compliance:** Maintained 100% compliance with OpenADR 3.0 specifications.
    *   **OpenADR 3.1.0 Readiness:** Hardened `program_id` and `metadata` preservation to support upcoming 3.1.0 standard alignment across the MiGrid ecosystem.

*   **Engineered Updates:**
    *   **ISO Normalization:** Implemented `isoRegion.toUpperCase().replace(/-/g, '')` in `index.js` and Kafka consumers for consistent regional grid lock and price handling.
    *   **Nullish Coalescing Price Logic:** Updated `market_price_at_session` propagation to use `??` for zero-value preservation, unblocking high-fidelity ML training.
    *   **Version Bump:** Service updated to **v2.4.1** for March 2026 platform synchronization.
    *   **Unit Tests:** Added verification for ISO normalization and zero-price handling in `grid_signal.test.js`.

*   **Safety Invariants Checked:**
    *   **L1 Variance Rule:** Dispatch is strictly rejected if variance exceeds 15% or if the `l1:safety:lock` is active in Redis.
    *   **L4 Grid Lock:** Global and regional grid locks are respected with sub-millisecond check latency via Redis.
    *   **The Fuse Rule:** Respects the 20% SoC hard floor communicated via L1/L3 capacity signals.

*   **Action Items / PRs:**
    *   Internal Refactor: Hardened Kafka broadcast payload for L11 ML Engine readiness.
    *   Documentation Update: Sync'd `PLATFORM_STATUS.md` with L2 v2.4.1.
