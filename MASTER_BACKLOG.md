# MiGrid Master Backlog

**Version:** 10.1.0
**Last Updated:** January 23, 2026
**Status:** Phase 5 "Enterprise Scale" (55% Complete)

---

## 🚀 The Priority Path (Top 5 Critical Items)

| Rank | Task ID | Description | Primary Owners | Dependency |
|------|---------|-------------|----------------|------------|
| 1 | **CORE-001** | **ISO 15118 Bidirectional Cert Exchange** | L7, L5 | Blocker for L5 Plug & Charge UI |
| 2 | **FIN-001** | **Proactive Price Polling & Broadcast** | L4 | Required for L9 Dynamic Billing |
| 3 | **PHYS-001** | **Redis-Based Capacity Cache (Sub-50ms)** | L3 | Required for L4 Bidding SLA |
| 4 | **EDGE-001** | **L1 Digital Twin & Redis Sync** | L1 | Prevents state drift during offline transitions |
| 5 | **ENG-001** | **Streak & Challenge Database Integration** | L6 | Completes 009 Migration requirements |

---

## 🔗 Cross-Layer Dependency Matrix

| Requiring Layer | Dependent Feature | Providing Layer | Status |
|-----------------|-------------------|-----------------|--------|
| **L5 (Driver)** | Plug & Charge Status | **L7 (Device)** | 🚧 L7 ISO 15118 PKI In-Progress (70%) |
| **L9 (Commerce)** | Real-time Market Rates | **L4 (Market)** | 🚧 L4 Background Polling In-Progress |
| **L4 (Market)** | Aggregated Capacity | **L3 (VPP)** | ✅ Redis Key `vpp:capacity:available` Live |
| **L3 (VPP)** | Safety Floor (20%) | **L1 (Physics)** | ✅ Fuse Rule enforced via DB Trigger |
| **L10 (Token)** | Verified Green Energy | **L1 (Physics)** | ✅ Audit Log <15% Variance Rule Active |
| **L2 (Grid)** | Unified Safety Lock | **L1 (Physics)** | ✅ `l1:safety:lock` Integrated |

---

## 🛠 Active Layer Backlogs

### Layer 1: Physics Engine
- [ ] Implement periodic sync between local Redis cache and `vehicles` table.
- [ ] Develop Fraud Analytics service for long-term `audit_log` pattern recognition.
- [ ] **RFC-L1-OFFLINE-RECON**: Draft protocol for edge-to-cloud reconciliation.

### Layer 3: VPP Aggregator
- [ ] **BESS Integration**: Expand capacity logic to support stationary storage (Target Q1 2026).
- [ ] **Automated Dispatch**: Fully integrate L2 Kafka signals for hands-off OpenADR response.
- [ ] Physics-Aware Forecasting: Incorporate L1 variance data into bid reliability models.

### Layer 4: Market Gateway
- [ ] **ERCOT Integration**: Complete adapter for Texas market support.
- [ ] Full `Decimal.js` audit across `MarketPricingService`.
- [ ] Enhanced Safety Observability: Map `l1:safety:lock:context` to market bid rejection logs.

### Layer 6: Engagement Engine
- [ ] Finalize Calendar-day based streak tracking in `processChargingEvent`.
- [ ] Enable Socket.io private rooms for real-time `achievement_unlocked` notifications.

### Layer 7: Device Gateway
- [ ] Implement local buffering for telemetry during Kafka connectivity interruptions.
- [ ] ISO 15118-20 Bidirectional certificate exchange finalization.

---

## 📉 Risk & Mitigation Tracker

| Risk ID | Description | Severity | Mitigation Strategy |
|---------|-------------|----------|---------------------|
| **R-001** | ISO 15118 PKI Complexity | Medium | Partner with trusted CAs; phased rollout starting with L7. |
| **R-002** | Multi-Tenant Isolation | Critical | Row-Level Security (RLS) implementation in Phase 7. |
| **R-003** | Market Bidding Latency | High | L3 Redis Caching (Priority 3) to ensure <50ms response. |

---

*“Single Source of Truth: If it's not in the backlog, it's not in the system.”*
# MiGrid Master Backlog & Dependency Matrix

**Version:** 1.0.0
**Last Updated:** January 23, 2026

## 🚀 The Priority Path (Top 5 Strategic Items)

| Priority | Task ID | Description | Primary Layers | Status | Strategic Alignment |
|:---:|:---:|:---|:---:|:---:|:---|
| 1 | **ISO-15118-PC** | Full ISO 15118-20 Bidirectional Certificate Exchange & Plug & Charge UI | L7, L5, L1 | 70% | Phase 5: Enterprise Scale |
| 2 | **PROACTIVE-PRICE** | Proactive Market Price Polling & Dynamic Tariff Integration | L4, L9, L10 | 60% | Phase 5: Commerce Sync |
| 3 | **REDIS-VPP-SLA** | Migration to Redis-cached VPP capacity model for sub-50ms Market Bidding | L3, L4 | 90% | Phase 5: Performance |
| 4 | **FUSE-RULE-ENF** | "The Fuse Rule" (20% SoC) hard enforcement across all dispatch layers | L1, L8, L3 | 100% | Safety Invariant |
| 5 | **OCPI-2.2-ROAM** | OCPI 2.2 Roaming Integration for cross-network orchestration | L7, L9 | 20% | Phase 5: Global Expansion |

## 🔗 Cross-Layer Dependency Matrix

| Downstream Layer | Dependency | Upstream Source | Impact of Failure |
|:---|:---|:---|:---|
| **L5 Driver DX** | ISO 15118 Cert Status | **L7 Device Gateway** | Driver cannot see Plug & Charge readiness |
| **L9 Commerce** | Physics Audit Logs | **L1 Physics Engine** | Inaccurate split-billing for fleet vs driver |
| **L4 Market Gateway** | Available Capacity (Redis) | **L3 VPP Aggregator** | Market bidding latency exceeds 50ms SLA |
| **L10 Token Engine** | Deterministic driver_actions | **L6 Engagement Engine** | Token rewards cannot be minted or audited |
| **L7 Device Gateway** | Control Profiles | **L8 Energy Manager** | Local site limits (DLM) violated; Fuse Rule risk |

## 🛠️ Active Engineering Sprints

### Phase 5: Enterprise Scale (Q1 2026)
- [~] **L9 Commerce Engine**: Finishing flexible billing logic and tariff engine (60%).
- [~] **L7 Device Gateway**: Implementing ISO 15118-20 bidirectional support.
- [✓] **L4 Market Gateway**: Proactive price broadcasting loop for CAISO/PJM.
- [✓] **L3 VPP Aggregator**: Redis-based capacity caching implementation.
- [✓] **L2 Grid Signal**: Unified safety lock mechanism with L1 metadata context.

## ⚠️ Critical Blockers
- **None currently identified.** Velocity is high across all 10 layers.

---
*MiGrid Master Backlog • Maintained by the Chief Platform Owner*
