# MiGrid Master Backlog & Strategic Dependency Matrix

**Version:** 10.1.1
**Last Updated:** April 2026
**Status:** Phase 5 "Enterprise Scale" (92% Complete)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Feature / Task | Primary Layer | Blocking Dependencies | Target Phase |
|:---:|:---|:---:|:---|:---:|
| **P0** | **ML Demand Forecasting** | L11 (ML Engine) | ✅ Phase 5 High-Fidelity Data Pipelines (L1, L2, L3, L4) | Phase 6 |
| **P1** | **ISO 15118 Cert Exchange** | L7 (Device) | 🚧 L7 v5.6.0 Hardened (90% Complete) | Phase 5 |
| **P2** | **Dynamic Wholesale Tariffs** | L9 (Commerce) | ✅ L4 (Market) v3.7.0 Bidding Auditability | Phase 5 |
| **P3** | **OCPI 2.2 Roaming** | L7 (Device) | 🚧 L9 (Commerce) v5.1.0 tariff engine sync | Phase 5 |
| **P4** | **BESS RL Bidding** | L4 (Market) | 🚧 L3 BESS Integration (75% Complete) | Phase 6 |

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **ISO-15118-PC** | Full ISO 15118-20 Bidirectional Certificate Exchange & Plug & Charge UI (OCPP 2.1) | L7, L5, L1 | 90% | Phase 5: Enterprise Scale |
| 2 | **COMMERCE-BILLING** | Complete L9 Commerce Engine Tariff Engine and Flexible Billing Logic | L9, L5 | 65% | Phase 5: Commerce Sync |
| 3 | **OCPI-2.2-ROAM** | OCPI 2.2 Roaming Integration for cross-network orchestration | L7, L9 | 60% | Phase 5: Global Expansion |
| 4 | **REGIONAL-CHALLENGE** | Implementation of L6 Regional Team Challenges & Live Grid Events | L6, L2 | ✅ 100%| Phase 5: Grid-Aware Gamification |
| 5 | **ML-FORECASTING** | L11 ML Engine: Demand Forecasting and Predictive Analytics Foundation | L11, L3 | 35% | Phase 6: AI & Optimization |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure | Status |
|:---|:---|:---|:---|:---|
| **L11 ML Engine** | High-Fidelity Logs | **L1 Physics (v10.1.0)** | ML training data lacks regional context | ✅ Active |
| **L5 Driver DX** | PnC Auth Status | **L7 Device Gateway** | Driver cannot use Plug & Charge sessions | 🚧 90% |
| **L9 Commerce** | Billing Reconciliation | **L1 Physics / L4 Market** | Inaccurate split-billing or tariff logic | ✅ Active |
| **L4 Market Gateway** | Capacity Cache | **L3 VPP Aggregator** | Bidding latency exceeds 50ms ISO SLA | ✅ v3.3.0 Active |
| **L10 Token Engine** | Engagement Triggers | **L6 Engagement Engine** | Rewards fail for 'ISO Explorer' challenges | ✅ v5.6.0 Sync |
| **L2 Grid Signal** | Regional Pricing | **L4 Market Gateway** | VTN cannot see market-aware grid signals | ✅ v3.6.0 Sync |

---

## 🛠️ Active Engineering Sprints (Phase 5)

### Layer 1: Physics Engine (v10.1.1)
- [✓] **Digital Twin Sync**: Fleet-filtered Redis sync for vehicle states.
- [✓] **Contextual Safety Locks**: metadata-enriched `l1:safety:lock:context` in Redis.
- [✓] **High-Fidelity Reconcile**: Preservation of regional metadata in audit logs.
- [✓] **Confidence Scoring**: Integrated 0.0-1.0 confidence metrics for L11 training.
- [✓] **[L1-120] Confidence Decay**: -0.2 penalty for syncs > 30 days old.
- [✓] **[L1-121] Site Integration**: -0.15 penalty for sites > 90% load utilization.
- [✓] **Site Energy Snapshot**: Real-time load/capacity fetching for confidence scoring.

### Layer 2: Grid Signal (v2.4.6)
- [✓] **BESS-Aware Safety**: 10% variance threshold enforced for stationary storage.
- [✓] **Regional Confidence**: Averaging vehicle scores for OpenADR high-fidelity fallback.
- [✓] **Regional Context**: High-fidelity capacity breakdown (Total/EV/BESS) in OpenADR reports.
- [✓] **Confidence Propagation**: Forwarding L1 confidence scores to L11 pipelines.
- [✓] **Unified Context**: Optimized aggregation of digital twin stats into `l2:unified:context`.

### Layer 3: VPP Aggregator (v3.3.0)
- [✓] **Redis Capacity Cache**: Sub-50ms reporting for L4 bidding.
- [✓] **Fuse Rule 2.0**: 20% SoC hard floor integrated into capacity formula.
- [✓] **ISO Normalization**: Consistent region identifiers (no-hyphen, uppercase) for L4/L10 sync.
- [✓] **L11 AI Readiness**: High-fidelity data tracking (is_high_fidelity) for ML training.
- [✓] **Physics-Aware Reporting**: Integration of `physics_score` and `is_high_fidelity` for L11.
- [~] **BESS Integration**: Support for stationary storage assets (75%).

### Layer 4: Market Gateway (v3.8.0)
- [✓] **Bidding Auditability**: High-fidelity audit context (physics_score, confidence_score, capacity_fidelity) for all bids.
- [✓] **Regional Grid Lock**: Improved observability and specific ISO lock logging.
- [✓] **ERCOT & Nord Pool**: Full activation of Texas and Nordic market adapters.
- [~] **BESS RL Bidding**: Research phase for reinforcement learning models (10%).

### Layer 6: Engagement Engine (v5.10.0)
- [✓] **ENTSO-E Pioneer**: European regional grid response achievement.
- [✓] **Sustainability Refinement**: Optimized recursive CTE for consecutive charging streaks.
- [✓] **ISO Explorer**: Multi-regional achievement logic using bulk CTE/UNION.
- [✓] **Energy Architect**: Achievement for AI Readiness and historical data contribution.
- [✓] **Grid-Aware Gamification**: Regional challenges using L2 Kafka signals.
- [✓] **Scarcity Savior**: Achievement for high-scarcity V2G discharge response.
- [✓] **Market Synchronizer**: Surplus-charging incentive logic (LMP < $30).
- [✓] **High-Confidence Contributor**: Physics-fidelity incentive (confidence >= 0.95).
- [✓] **ML Data Pioneer**: High-fidelity session streak tracker (physics_score > 0.98).
- [✓] **Sentinel of the Grid**: L1-integrated 30-day high-fidelity streak tracking.
- [✓] **BESS Specialist**: Achievements for BESS Power and Precision Specialist.
- [✓] **Hardened Metadata**: Kafka events enriched with `resource_type`.
- [✓] **Site Harmony**: Integrated site-level physics score into engagement mechanics.

### Layer 7: Device Gateway (v5.6.0)
- [✓] **ISO 15118-20**: Hardened Certificate Exchange and EMAID handling (90%).
- [✓] **OCPP 2.1 V2X**: Native bidirectional profile support.
- [✓] **Resource Caching**: Redis-based `resource_type` (EV/BESS) lifecycle management.
- [✓] **Horizontal Scaling**: Cross-pod command routing via Redis Pub/Sub.

### Layer 10: Token Engine (v4.3.1)
- [✓] **Dynamic Multipliers**: Surplus (1.5x) and Scarcity (2.0x) logic active.
- [✓] **Reward Idempotency**: PostgreSQL unique constraints + Redis checkIdempotency.
- [✓] **High-Fidelity Auditing**: Persistence of `physics_score` and `confidence_score` in logs.
- [✓] **Logic Hardening**: Fixed rule_id/event_id swap and improved malformed message handling.

---

## 📉 Risk & Mitigation Tracker

| Risk ID | Description | Severity | Mitigation Strategy | Status |
|:---:|:---|:---:|:---|:---:|
| **R-001** | Data Quality for L11 | High | Enforce strict L1 physics audit (<15% variance) as data filter. | Mitigated |
| **R-002** | Multi-Tenant Isolation | Critical | Row-Level Security (RLS) implementation in Phase 7. | Q3 2026 |
| **R-003** | Bidding Latency | Medium | L3 Redis Caching ensures <50ms response for high-frequency markets. | ✅ Mitigated |
| **R-004** | ISO 15118 PKI Complexity | Medium | Partner with trusted CAs; phased rollout starting with L7. | Active |
| **R-005** | ML Model Accuracy | High | A/B testing with human-in-the-loop fallback rules. | Q2 2026 |

---
*“Single Source of Truth: If it's not in the backlog, it's not in the system.”*
