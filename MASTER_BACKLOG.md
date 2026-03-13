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
