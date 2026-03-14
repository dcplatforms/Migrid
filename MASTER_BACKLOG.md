# MiGrid Master Backlog & Strategic Dependency Matrix

**Version:** 10.1.0
**Last Updated:** March 2026
**Status:** Phase 5 "Enterprise Scale" (Syncing with Phase 6)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Feature / Task | Primary Layer | Blocking Dependencies | Target Phase |
|:---:|:---|:---:|:---|:---:|
| **P0** | **ISO 15118 Cert Exchange** | L7 (Device) | L5 (Driver API) must update payload schemas | Phase 5 |
| **P1** | **Dynamic Wholesale Tariffs** | L9 (Commerce) | L4 (Market) must finalize ERCOT pricing feed | Phase 5 |
| **P2** | **AI Data Readiness (L1 Audit)** | L1 (Physics) | None | Phase 6 Prep |
| **P3** | **ML Demand Forecasting** | L11 (ML Engine) | L3 (VPP) historical capacity data structuring | Phase 6 |
| **P4** | **OCPI 2.2 Roaming** | L7 (Device) | L9 (Commerce) settlement engine integration | Phase 5 |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure |
|:---|:---|:---|:---|
| **L11 ML Engine** | Training Datasets | **L1 Physics / L4 Market** | Inaccurate demand forecasting and bidding |
| **L5 Driver DX** | ISO 15118 Cert Status | **L7 Device Gateway** | Driver cannot see Plug & Charge readiness |
| **L9 Commerce** | Physics Audit Logs | **L1 Physics Engine** | Inaccurate split-billing for fleet vs driver |
| **L4 Market Gateway** | Available Capacity (Redis) | **L3 VPP Aggregator** | Market bidding latency exceeds 50ms SLA |
| **L10 Token Engine** | Deterministic driver_actions | **L6 Engagement Engine** | Token rewards cannot be minted or audited |
| **L7 Device Gateway** | Control Profiles | **L8 Energy Manager** | Local site limits (DLM) violated; Fuse Rule risk |

---

## 🛠️ Active Engineering Sprints

### Phase 6 Readiness: AI Data Epics
- [ ] **L1 (Physics)**: **AI Data Readiness Epic** — Implement high-fidelity timeseries export of audit logs for L11 training.
- [ ] **L7 (Device)**: **AI Data Readiness Epic** — Ensure all vehicle telemetry is perfectly structured in TimescaleDB for behavior profiling.
- [ ] **L8 (Energy)**: **AI Data Readiness Epic** — Structure building load telemetry to enable L11 predictive load models.

### Phase 5 Finalization (Enterprise Scale)
- [~] **L9 (Commerce Engine)**: Finalizing multi-currency billing and international settlement logic.
- [~] **L7 (Device Gateway)**: Final testing of ISO 15118-20 V2G bidirectional discharge.
- [✓] **L4 (Market Gateway)**: ERCOT adapter active; profitability index broadcasting live.
- [✓] **L1 (Physics Engine)**: Digital Twin Redis sync complete (filtered by `FLEET_ID`).

---

## 📉 Risk & Mitigation Tracker

| Risk ID | Description | Severity | Mitigation Strategy |
|:---:|:---|:---:|:---|
| **R-001** | Data Quality for L11 | High | Enforce strict L1 physics audit (<15% variance) as data filter. |
| **R-002** | Multi-Tenant Isolation | Critical | Row-Level Security (RLS) implementation in Phase 7. |
| **R-003** | Bidding Latency | Medium | L3 Redis Caching ensures <50ms response for high-frequency markets. |

---
*“Single Source of Truth: If it's not in the backlog, it's not in the system.”*
