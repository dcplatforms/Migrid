# MiGrid Master Backlog & Strategic Dependency Matrix

**Version:** 10.1.6
**Last Updated:** June 2026
**Status:** Phase 6 "AI & Optimization" (Active)

---

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Feature / Task | Primary Layer | Blocking Dependencies | Target Phase |
|:---:|:---|:---:|:---|:---:|
| **P0** | **ML Demand Forecasting** | L11 (ML Engine) | ✅ Phase 6 Telemetry Parity (100%) | Phase 6 |
| **P1** | **Hardware Health Guardian** | L6 (Engagement) | ✅ L4 Regional Alarm Redis Parity (100%) | Phase 6 |
| **P2** | **Site-Specific Safety Isolation**| L1 (Physics) | ✅ L7 NotifyDERAlarm Refactor (100%) | Phase 6 |
| **P3** | **Hardware Health Penalty** | L4 (Market) | ✅ L7 DER Alarm Normalization (100%) | Phase 6 |
| **P4** | **BESS RL Bidding** | L4 (Market) | 🚧 L3 BESS Integration (85% Complete) | Phase 6 |

| **P5** | **Resource-Aware Bidding** | L4 (Market) | ✅ L3 v3.3.3 High-Fidelity Breakdown | Phase 5 |

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **HW-HEALTH-PENALTY** | Implementation of Hardware Health Penalties (-0.05 per alarm) in bidding and rewards | L4, L10 | ✅ 100% | Phase 6: Hardware-Aware Economics |
| 2 | **SITE-SAFETY-LOCKS** | Site-specific safety locks triggered by CRITICAL DER Alarms (900s TTL) | L1, L2, L7 | ✅ 100% | Phase 6: Automated Resilience |
| 3 | **HW-HEALTH-GUARDIAN**| Achievement for sessions at sites with zero regional alarms | L6 | ✅ 100% | Phase 6: Behavioral Optimization |
| 4 | **L11-TELEMETRY-PARITY**| Standardization of 4-decimal string telemetry across all 11 layers | All | ✅ 100%| Phase 6: AI Training Quality |
| 5 | **ML-FORECASTING** | L11 ML Engine: Demand Forecasting and Predictive Analytics Foundation | L11, L3 | 60% | Phase 6: AI & Optimization |
| 6 | **KAFKA-ALARM-REFACTOR**| Refactored DER alarm broadcasting for granular individual events | L7 | ✅ 100% | Phase 5: Technical Debt |

---

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure | Status |
|:---|:---|:---|:---|:---|
| **L1 Physics Engine** | Site-Specific Locks | **L7 Device Gateway (v5.13.0)**| Safety isolation fails for hardware alarms | ✅ Active |
| **L4 Market Gateway** | Regional Alarm Count | **Redis (L7 Heartbeat/Alarm)** | Bidding optimizer ignores hardware health | ✅ Active |
| **L10 Token Engine** | Health Multiplier | **L4 Market Optimizer** | Reward multipliers out of sync with bid price | ✅ Active |
| **L6 Engagement** | Regional Alarm Meta | **L7 NotifyDERAlarm** | Achievements fail to reward hardware health | ✅ Active |
| **L11 ML Engine** | 4-Decimal Strings | **L1/L3/L4/L6/L10** | ML training data lacks precision parity | ✅ Active |
| **L2 Grid Signal** | Auto-Isolation | **L7 DER Alarm Severity** | Grid signals ignore site hardware failures | ✅ Active |

---

## 🛠️ Active Engineering Sprints (Phase 6)

### Layer 1: Physics Engine (v10.1.6)
- [✓] **Site-Specific Safety Locks**: Implemented `l1:safety:lock:site:<SITE_ID>` in `handlePhysicsAlert`.
- [✓] **Scan Optimization**: `updateLocalSafetyCache` uses `redisClient.scan` for site-level keys.
- [✓] **ML Parity**: Enforced strict .toFixed(4) string formatting for all physics/confidence scores.

### Layer 2: Grid Signal (v2.5.5)
- [✓] **Auto-Isolation**: Kafka consumer sets Redis site-specific locks upon `CRITICAL` alarms.
- [✓] **L11 Parity**: Enforced strict `.toFixed(4)` string formatting for audit trails.
- [✓] **Secure Reporting**: authenticateToken and PII masking applied to `/openadr/v3/reports`.

### Layer 3: VPP Aggregator (v3.3.3)
- [✓] **Telemetry Hardening**: Standardized `safeFloat` utility for 4-decimal string formatting.
- [✓] **Fuse Rule 2.0**: 20% SoC hard floor integrated into capacity formula.
- [~] **BESS Integration**: Support for stationary storage assets (85%).

### Layer 4: Market Gateway (v3.8.9)
- [✓] **Hardware Health Penalty**: Integrated `Decimal.js` penalty logic (0.05/alarm) into bids.
- [✓] **Bidding Auditability**: Included `regional_alarm_count` in audit metadata.
- [✓] **Bidding Logic Hardening**: `capacity_fidelity` calculated before safety lock checks.
- [~] **BESS RL Bidding**: Research phase for reinforcement learning models (15%).

### Layer 6: Engagement Engine (v5.18.0)
- [✓] **Hardware Health Guardian**: Achievement for drivers using sites with zero regional alarms.
- [✓] **Metadata Enrichment**: Enriched charging events with regional alarm metadata for L11.
- [✓] **Telemetry Hardening**: Enforced 4-decimal string formatting via `safeFloat`.

### Layer 7: Device Gateway (v5.13.0)
- [✓] **NotifyDERAlarm Refactor**: Broadcasts individual Kafka events with root-level severity.
- [✓] **Heartbeat Optimization**: Optimized tracking via Redis Hash `l7:heartbeats`.
- [✓] **Site-Specific Safety**: Validates site-level locks before dispatching setChargingProfile.

### Layer 10: Token Engine (v4.3.8)
- [✓] **Hardware Health Penalty**: Applied multiplier reductions (-0.05 per alarm) to rewards.
- [✓] **Syntax Fix**: Resolved duplicate `extractSiteId` declaration causing SyntaxError.
- [✓] **ML Parity**: Enforced strict .toFixed(4) telemetry formatting via `safeFloat`.

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
