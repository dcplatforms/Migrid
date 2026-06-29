# MiGrid Master Backlog & Strategic Dependency Matrix

**Version:** 10.1.6
**Last Updated:** June 2026
**Status:** Phase 6 "AI & Optimization" (Active)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Feature / Task | Primary Layer | Blocking Dependencies | Target Phase |
|:---:|:---|:---:|:---|:---:|
| **P0** | **ML Demand Forecasting** | L11 (ML Engine) | ✅ Phase 6 Telemetry Parity (100%) | Phase 6 |
| **P1** | **BESS RL Bidding** | L4 (Market) | ✅ L3 v3.3.3 BESS Integration (100%) | Phase 6 |
| **P2** | **Hardware Health Penalty** | L10 (Token) | ✅ L7 v5.13.0 DER Alarms (100%) | Phase 6 |
| **P3** | **Site-Specific Locks** | L1/L2 (Core) | ✅ Redis Site-Lock Polling (100%) | Phase 6 |
| **P4** | **ISO 15118 Cert Exchange** | L7 (Device) | ✅ L7 v5.13.0 Heartbeat Indexing | Phase 5 |

| **P5** | **Dynamic Wholesale Tariffs** | L9 (Commerce) | ✅ L4 v3.8.9 Hardware-Aware Bidding | Phase 6 |

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **ISO-15118-PC** | Full ISO 15118-20 Bidirectional Certificate Exchange & Plug & Charge UI (OCPP 2.1) | L7, L5, L1 | ✅ 100% | Phase 5: Enterprise Scale |
| 2 | **COMMERCE-BILLING** | Complete L9 Commerce Engine Tariff Engine and Flexible Billing Logic | L9, L5 | ✅ 100% | Phase 5: Commerce Sync |
| 3 | **OCPI-2.2-ROAM** | OCPI 2.2 Roaming Integration for cross-network orchestration | L7, L9 | ✅ 100% | Phase 5: Global Expansion |
| 4 | **REGIONAL-CHALLENGE** | Implementation of L6 Regional Team Challenges & Live Grid Events | L6, L2 | ✅ 100%| Phase 5: Grid-Aware Gamification |
| 5 | **ML-FORECASTING** | L11 ML Engine: Demand Forecasting and Predictive Analytics Foundation | L11, L3 | 60% | Phase 6: AI & Optimization |
| 6 | **L2-NAN-HARDEN** | Hardened telemetry parsing with `isNaN` protection and `.toFixed(4)` parity. | L2 | ✅ 100% | Phase 5: Enterprise Scale |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure | Status |
|:---|:---|:---|:---|:---|
| **L11 ML Engine** | High-Fidelity Logs | **L1 Physics (v10.1.6)** | ML training data lacks regional context | ✅ Active |
| **L5 Driver DX** | PnC Auth Status | **L7 Device Gateway** | Driver cannot use Plug & Charge sessions | ✅ Active |
| **L9 Commerce** | Billing Reconciliation | **L1 Physics / L4 Market** | Inaccurate split-billing or tariff logic | ✅ Active |
| **L4 Market Gateway** | Capacity Cache | **L3 VPP Aggregator** | Bidding latency exceeds 50ms ISO SLA | ✅ v3.3.3 Active |
| **L4 Market Gateway** | Confidence Fallback | **L2 Grid Signal (v2.5.5)** | Missing high-fidelity metadata for L11 | ✅ Active |
| **L10 Token Engine** | Engagement Triggers | **L6 Engagement Engine (v5.18.0)** | Rewards fail for 'ISO Explorer' challenges | ✅ Sync |
| **L2 Grid Signal** | Regional Pricing | **L4 Market Gateway (v3.8.9)** | VTN cannot see market-aware grid signals | ✅ Sync |
| **L11 ML Engine** | Sentinel Audit | **L10 Token Engine (v4.3.8)** | Phase 6 AI auditing lacks ground truth | ✅ Active |

---

## 🛠️ Active Engineering Sprints (Phase 6)

### Layer 1: Physics Engine (v10.1.6)
- [✓] **Site-Specific Resilience**: Achieved 100% site-lock parity via Redis poller.
- [✓] **Phase 6 Parity**: Enforced strict .toFixed(4) string formatting for all scores.
- [✓] **Security Hardening**: Integrated `helmet()` and secured `/data/training/physics`.

### Layer 2: Grid Signal (v2.5.5)
- [✓] **Site-Specific Locks**: Integrated sub-millisecond site safety verification.
- [✓] **Security Hardening**: Global data endpoints explicitly reject `fleet_id` tokens.
- [✓] **L11 Parity**: Enforced strict `.toFixed(4)` string formatting for audit trails.

### Layer 3: VPP Aggregator (v3.3.3)
- [✓] **SoC Floor Hardening**: Enforced strict 20% SoC floor for all BESS assets.
- [✓] **BESS Integration**: Full support for stationary storage assets (100%).
- [✓] **Sentinel Fidelity**: Detection logic supports multi-format fidelity flags.

### Layer 4: Market Gateway (v3.8.9)
- [✓] **Hardware-Aware Bidding**: Integrated DER Alarms into bidding confidence logic.
- [✓] **Bidding Auditability**: Included `regional_alarm_count` in audit metadata.
- [~] **BESS RL Bidding**: Implementation phase for reinforcement learning (30%).

### Layer 6: Engagement Engine (v5.18.0)
- [✓] **Hardware Health Guardian**: Achievement for sessions at zero-alarm sites.
- [✓] **Test Maintenance**: Synchronized legacy health check assertions for CI compliance.
- [✓] **Metadata Enrichment**: Sessions enriched with regional alarm metadata.

### Layer 7: Device Gateway (v5.13.0)
- [✓] **Heartbeat Optimization**: Redis Hash indexing for high-scale fleet tracking.
- [✓] **DER Alarm Normalization**: Broadcasting individual alarms with root-level severity.
- [✓] **Site-Specific Resilience**: Redis `SCAN` based site-lock poller implemented.

### Layer 10: Token Engine (v4.3.8)
- [✓] **Hardware Health Penalty**: Reducing rewards by 0.05 per regional alarm.
- [✓] **ISO Normalization**: Standardized uppercase/no-hyphen ISO lookup for Redis.
- [✓] **Kafka Topic Isolation**: Isolated `DER_ALARM_REPORTED` for precise handling.

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
