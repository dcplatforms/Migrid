# MiGrid Master Backlog & Dependency Matrix

**Version:** 10.1.0
**Last Updated:** March 2026
**Status:** Phase 5 "Enterprise Scale" (55% Complete)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **ISO-15118-PC** | Full ISO 15118-20 Bidirectional Certificate Exchange & Plug & Charge UI (OCPP 2.1) | L7, L5, L1 | 75% | Phase 5: Enterprise Scale |
| 2 | **COMMERCE-BILLING** | Complete L9 Commerce Engine Tariff Engine and Flexible Billing Logic | L9, L5 | 60% | Phase 5: Commerce Sync |
| 3 | **OCPI-2.2-ROAM** | OCPI 2.2 Roaming Integration for cross-network orchestration | L7, L9 | 20% | Phase 5: Global Expansion |
| 4 | **REGIONAL-CHALLENGE** | Implementation of L6 Regional Team Challenges & Live Grid Events | L6, L2 | 10% | Phase 5: Grid-Aware Gamification |
| 5 | **ML-FORECASTING** | L11 ML Engine: Demand Forecasting and Predictive Analytics Foundation | L11, L3 | 5% | Phase 6: AI & Optimization |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Status |
|:---|:---|:---|:---|
| **L5 Driver DX** | ISO 15118 Cert Status | **L7 Device Gateway** | 🚧 PKI Implementation 75% |
| **L9 Commerce** | Physics Audit Logs | **L1 Physics Engine** | ✅ Audit Log <15% Variance Active |
| **L4 Market Gateway** | Available Capacity (Redis) | **L3 VPP Aggregator** | ✅ Redis Key `vpp:capacity:available` Live |
| **L10 Token Engine** | Deterministic driver_actions | **L6 Engagement Engine** | ✅ Regional `iso` context integrated |
| **L7 Device Gateway** | Control Profiles | **L8 Energy Manager** | ✅ Site limits (DLM) enforced |

---

## 🛠️ Active Engineering Sprints (Phase 5)

### Layer 1: Physics Engine
- [✓] **Digital Twin Sync**: Fleet-filtered Redis sync for vehicle states.
- [✓] **Contextual Safety Locks**: metadata-enriched `l1:safety:lock:context` in Redis.
- [ ] **Fraud Analytics**: Long-term audit log pattern recognition (Planned).

### Layer 3: VPP Aggregator
- [✓] **Redis Capacity Cache**: Sub-50ms reporting for L4 bidding.
- [✓] **Fuse Rule 2.0**: 20% SoC hard floor integrated into capacity formula.
- [ ] **BESS Integration**: Support for stationary storage assets.

### Layer 4: Market Gateway
- [✓] **ERCOT Active**: Full integration with Texas market.
- [✓] **Profitability Index**: Real-time $/MWh broadcasting for L9/L10.
- [✓] **Proactive Polling**: Background market price polling loop.

### Layer 6: Engagement Engine
- [✓] **Rank Change Logic**: Optimized WebSocket emissions.
- [~] **Grid-Aware Gamification**: Regional challenges using L2 Kafka signals (In Progress).

### Layer 7: Device Gateway
- [✓] **OCPP 2.1 V2X**: Native bidirectional profile support.
- [~] **ISO 15118-20**: Certificate exchange and PKI (75%).

---

## 📉 Risk & Mitigation Tracker

| Risk ID | Description | Severity | Mitigation Strategy |
|:---:|:---|:---:|:---|
| **R-001** | ISO 15118 PKI Complexity | Medium | Partner with trusted CAs; phased rollout starting with L7. |
| **R-002** | Multi-Tenant Isolation | Critical | Row-Level Security (RLS) implementation in Phase 7. |
| **R-003** | ML Model Accuracy | High | A/B testing with human-in-the-loop fallback rules. |

---

*“Single Source of Truth: If it's not in the backlog, it's not in the system.”*
