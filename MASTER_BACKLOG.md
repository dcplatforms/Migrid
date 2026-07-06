# MiGrid Master Backlog & Strategic Dependency Matrix

**Version:** 10.1.5
**Last Updated:** April 2026
**Status:** Phase 6 "AI & Optimization" (Active)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Feature / Task | Primary Layer | Blocking Dependencies | Target Phase |
|:---:|:---|:---:|:---|:---:|
| **P0** | **ML Demand Forecasting** | L11 (ML Engine) | ✅ Phase 6 Telemetry Parity (100%) | Phase 6 |
| **P1** | **ISO 15118 Cert Exchange** | L7 (Device) | ✅ L7 v5.11.0 localSafetyCache (100%) | Phase 5 |
| **P2** | **Dynamic Wholesale Tariffs** | L9 (Commerce) | ✅ L4 v3.8.9 Hardware-Aware Resilience (100% Complete) | Phase 5 |
| **P3** | **OCPI 2.2 Roaming** | L7 (Device) | ✅ L9 v5.1.0 tariff engine sync (100% Complete) | Phase 5 |
| **P4** | **BESS RL Bidding** | L4 (Market) | 🚧 L3 BESS Integration (75% Complete) | Phase 6 |

| **P5** | **Resource-Aware Bidding** | L4 (Market) | ✅ L3 v3.3.2 High-Fidelity Breakdown | Phase 5 |

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **ISO-15118-PC** | Full ISO 15118-20 Bidirectional Certificate Exchange & Plug & Charge UI (OCPP 2.1) | L7, L5, L1 | ✅ 100% | Phase 5: Enterprise Scale |
| 2 | **COMMERCE-BILLING** | Complete L9 Commerce Engine Tariff Engine and Flexible Billing Logic | L9, L5 | ✅ 100% | Phase 5: Commerce Sync |
| 3 | **OCPI-2.2-ROAM** | OCPI 2.2 Roaming Integration for cross-network orchestration | L7, L9 | ✅ 100% | Phase 5: Global Expansion |
| 4 | **REGIONAL-CHALLENGE** | Implementation of L6 Regional Team Challenges & Live Grid Events | L6, L2 | ✅ 100%| Phase 5: Grid-Aware Gamification |
| 5 | **ML-FORECASTING** | L11 ML Engine: Demand Forecasting and Predictive Analytics Foundation | L11, L3 | 50% | Phase 6: AI & Optimization |
| 6 | **L2-NAN-HARDEN** | Hardened telemetry parsing with `isNaN` protection and `.toFixed(4)` parity. | L2 | ✅ 100% | Phase 5: Enterprise Scale |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure | Status |
|:---|:---|:---|:---|:---|
| **L11 ML Engine** | High-Fidelity Logs | **L1 Physics (v10.1.5)** | ML training data lacks regional context | ✅ Active |
| **L5 Driver DX** | PnC Auth Status | **L7 Device Gateway** | Driver cannot use Plug & Charge sessions | ✅ Active |
| **L9 Commerce** | Billing Reconciliation | **L1 Physics / L4 Market** | Inaccurate split-billing or tariff logic | ✅ Active |
| **L4 Market Gateway** | Capacity Cache | **L3 VPP Aggregator** | Bidding latency exceeds 50ms ISO SLA | ✅ v3.3.2 Active |
| **L4 Market Gateway** | Confidence Fallback | **L2 Grid Signal (v2.5.3)** | Missing high-fidelity metadata for L11 | ✅ Active |
| **L10 Token Engine** | Engagement Triggers | **L6 Engagement Engine (v5.17.0)** | Rewards fail for 'ISO Explorer' challenges | ✅ Sync |
| **L2 Grid Signal** | Regional Pricing | **L4 Market Gateway (v3.8.9)** | VTN cannot see market-aware grid signals | ✅ Sync |
| **L11 ML Engine** | Sentinel Audit | **L10 Token Engine (v4.3.7)** | Phase 6 AI auditing lacks ground truth | ✅ Active |

---

## 🛠️ Active Engineering Sprints (Phase 6)

### Layer 1: Physics Engine (v10.1.5)
- [✓] **[L1-133] Local Safety Cache**: 5s background poller for sub-millisecond resilience.
- [✓] **Phase 6 Parity**: Enforced strict .toFixed(4) string formatting for all scores.
- [✓] **Standardized Site ID**: Implemented `extractSiteId` for multi-site identification.
- [✓] **Digital Twin Sync**: Hardened fleet-filtered Redis sync with string handling.
- [✓] **Contextual Safety Locks**: metadata-enriched `l1:safety:lock:context` in Redis.
- [✓] **API Security**: Integrated `helmet` and secured `/data/training/physics`.

### Layer 2: Grid Signal (v2.5.3)
- [✓] **Telemetry Hardening**: implemented `isNaN` protection for physics/confidence scores.
- [✓] **L11 Parity**: enforced strict `.toFixed(4)` string formatting for audit trails.
- [✓] **Secure Reporting**: authenticateToken and PII masking applied to `/openadr/v3/reports`.
- [✓] **Fleet Security**: Hardened global data endpoints to reject `fleet_id` tokens.

### Layer 3: VPP Aggregator (v3.3.2)
- [✓] **Redis Capacity Cache**: Sub-50ms reporting for L4 bidding.
- [✓] **Fuse Rule 2.0**: 20% SoC hard floor integrated into capacity formula.
- [✓] **Multi-Site Parity**: Implemented `extractSiteId` for standardized site identification.
- [~] **BESS Integration**: Support for stationary storage assets (75%).

### Layer 4: Market Gateway (v3.8.9)
- [✓] **Hardware-Aware Resilience**: Site-specific safety isolation and dynamic hardware health penalties.
- [✓] **ML Parity**: Enforced strict string formatting (`.toFixed(4)`) for all scores.
- [✓] **NaN Protection**: Hardened bidding logic via `safeFloat` utility.
- [✓] **Multi-Site Parity**: Hardened grid signal consumer with multi-key site identification.
- [✓] **Bidding Auditability**: High-fidelity audit context for all bids.
- [✓] **AI Readiness**: Training endpoints for fuel-mix, load-forecast, and net-load active.
- [~] **BESS RL Bidding**: Research phase for reinforcement learning models (10%).

### Layer 6: Engagement Engine (v5.17.0)
- [✓] **Phase 6 Alignment**: Standardized physics and confidence scores as 4-decimal strings.
- [✓] **Multi-Site Parity**: Hardened site identification via `extractSiteId`.
- [✓] **AI Model Master**: Achievement for 100+ cumulative high-fidelity sessions.
- [✓] **Phase 6 Data Pioneer**: Achievement for 5 consecutive sessions with physics_score > 0.99.
- [✓] **Solar Flare**: Achievement for 25 cumulative solar ramp responses.
- [✓] **Sentinel Elite**: Achievement for 50 total sentinel-fidelity sessions.

### Layer 7: Device Gateway (v5.11.0)
- [✓] **[L7-133] Resilience**: Implemented `localSafetyCache` for sub-millisecond dispatch.
- [✓] **DER Alarms**: Enhanced hardware-agnostic alarm handling via `NotifyDERAlarm`.
- [✓] **ISO 15118-20**: Hardened Certificate Exchange and EMAID handling (100%).
- [✓] **ML Parity**: Enforced strict string-formatted telemetry (.toFixed(4)).
- [✓] **Security Hardening**: Integrated helmet() and updated Kafka tagging.

### Layer 10: Token Engine (v4.3.7)
- [✓] **Reward Batching**: Standardized atomic background worker for reward minting.
- [✓] **ML Parity**: Enforced strict .toFixed(4) telemetry formatting.
- [✓] **Site Awareness**: Standardized identification via `extractSiteId`.
- [✓] **Global Data Security**: Restricted `/data/training/rewards` to admin tokens.
- [✓] **Sentinel Fidelity**: Detection and flag (is_sentinel_fidelity) for score > 0.99.

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
