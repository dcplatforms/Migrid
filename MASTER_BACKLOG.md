# MiGrid Master Backlog

**Last Updated:** January 23, 2026
**Status:** Phase 5 "Enterprise Scale" (51% Complete)

## 1. High-Priority Cross-Layer Dependencies (The "Blockers")

| ID | Task | Impacted Layers | Dependency | Status |
|----|------|-----------------|------------|--------|
| **CRIT-001** | ISO 15118 PKI & Cert Exchange | L7, L5 | L7 must deliver cert chain to L5 for Plug & Charge UI | In Progress (70%) |
| **CRIT-002** | Proactive Market Price Polling | L4, L9 | L4 must broadcast `MARKET_PRICE_UPDATED` for L9 Billing | Planned |
| **CRIT-003** | Reward Minting Logic | L6, L10 | L10 needs smart contract logic for L6 Streak/Challenge rewards | Planned |
| **CRIT-004** | Fuse Rule UI Sync | L1, L3, L8, L5 | L5 must show "Safety Throttled" when L1 enforces 20% SoC | In Progress |
| **CRIT-005** | OCPI 2.2 CDR Alignment | L7, L9 | Standardize Charge Detail Record (CDR) for Roaming Billing | Planned |

---

## 2. Layer-Specific Backlogs

### L1: Physics Engine
- [ ] **Fraud Analytics**: Analyze `audit_log` for sensor degradation patterns.
- [ ] **Dynamic Thresholds**: Support site-specific Fuse Rule floors (>20%).
- [✓] **Granular Alerts**: Enhanced `migrid.physics.alerts` with VIN/SoC context.

### L2: Grid Signal
- [ ] **IEEE 2030.5**: Initial discovery and registration logic.
- [✓] **Resilient Rejection**: 503 responses for safety-halted utility dispatches.

### L3: VPP Aggregator
- [ ] **BESS Registration**: Support for stationary battery assets.
- [ ] **Redis Capacity Cache**: Optimize for sub-50ms L4 queries.
- [✓] **Refined Capacity Formula**: Integration of the L1 20% floor.

### L4: Market Gateway
- [ ] **ERCOT Integration**: Finalize market adapter and polling.
- [ ] **Decimal.js Audit**: Remove all standard float arithmetic from bidding logic.
- [✓] **Safety Context Logging**: Capture `l1:safety:lock:context` in logs.

### L5: Driver Experience API
- [ ] **Plug & Charge UI**: Visual status for ISO 15118 sessions.
- [ ] **Safety Throttling Alerts**: Push notifications for L1/L8 interventions.
- [✓] **JWT Auth**: Hardened authentication for mobile endpoints.

### L6: Engagement Engine
- [ ] **Streak Validation**: Logic to verify session validity via `is_valid` column.
- [✓] **Real-time Leaderboards**: Socket.io updates for driver rankings.

### L7: Device Gateway
- [ ] **Bidirectional OCPP 2.1**: Implement `V2XProfile` support.
- [✓] **Modular Refactor**: Decoupled transport and protocol layers.

### L8: Energy Manager
- [ ] **Modbus RTU Resilience**: Improved error recovery for local meter polling.
- [✓] **Water-Filling DLM**: Proportional fairness allocation implementation.

### L9: Commerce Engine
- [ ] **Split-Billing Logic**: Separating Fleet vs. Driver costs in CDRs.
- [ ] **Dynamic Tariffs**: Consuming L4 price signals for real-time rates.

### L10: Token Engine
- [ ] **Smart Contract Rewards**: Polygon deployment for streak-based minting.
- [✓] **Open-Wallet Bridge**: Basic Kafka-to-Wallet event routing.

---

## 3. Platform Technical Debt
- **[ ] Edge-to-Cloud Recon**: Proposal for handling mass site reconnection (RFC-L1-OFFLINE-RECON).
- **[ ] Unified Logging**: Move all services to a standardized JSON logging format for ELK integration.
- **[ ] Health-Check Probes**: Standardize `/health` endpoint across all 10 layers.
