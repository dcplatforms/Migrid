# MiGrid Product Roadmap

**Version:** 10.0.0  
**Last Updated:** January 2025  
**License:** Apache 2.0

---

## Executive Summary

MiGrid is being developed across five major phases spanning Q1 2025 through Q1 2026. The roadmap prioritizes foundational OT infrastructure first, followed by grid integration, market access, driver experience, and finally enterprise scale features.

| Phase | Version | Quarter | Focus |
|-------|---------|---------|-------|
| Foundation | v1.0 | Q1 2025 | Physics verification, Energy Manager MVP |
| Grid Integration | v2.0 | Q2 2025 | OpenADR 3.0, Telematics bridges |
| Market Access | v3.0 | Q3 2025 | VPP aggregation, Wholesale markets |
| Driver Experience | v4.0 | Q4 2025 | Mobile app, Token ecosystem |
| Enterprise Scale | v5.0 | Q1 2026 | Commerce, Global markets |

---

## Current Status

**Features Complete:** 10  
**In Progress:** 4  
**Planned:** 22

---

## Phase 1: Foundation (Q1 2025) ✅

*Core infrastructure and physics verification*

### v1.0.0 — Genesis Release (January 2025) ✅

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L1 | Physics Engine Core | Variance calculation with <15% threshold | ✅ Complete |
| L1 | Vehicle Physics Database | 2025 model specs (F-150 Lightning, Rivian R1T, Tesla Semi) | ✅ Complete |
| L7 | OCPP 1.6 Support | Basic charger communication protocol | ✅ Complete |
| L8 | Energy Manager MVP | Modbus load monitoring, basic DLM | ✅ Complete |

**Key Deliverables:**
- `services/01-physics-engine/` — PostgreSQL listener for charging session audits
- Variance formula: `|E_dispensed - (ΔSoC × BatteryCapacity)| < 15%`
- Modbus TCP/RTU integration for building load monitoring

### v1.1.0 — Admin Portal Alpha (February 2025) ✅

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L5 | Fleet Portal Web | React + FluentUI admin dashboard | ✅ Complete |
| L8 | Live Site Energy Dashboard | Real-time load visualization with Chart.js | ✅ Complete |
| L10 | Token Engine Foundation | Kafka consumer, reward rules engine | ✅ Complete |

**Key Deliverables:**
- `apps/admin-portal-web/` — Vite + React 19 + FluentUI v9
- Live Site Energy page with KPI cards and time-series charts
- `services/10-token-engine/` — Kafka consumer with Open-Wallet integration
- Database migrations: `drivers`, `driver_wallets`, `token_reward_rules`, `token_reward_log`

---

## Phase 2: Grid Integration (Q2 2025) 🔄

*OpenADR 3.0 and utility program connectivity*

### v2.0.0 — Grid Signal Release (April 2025) 🔄 In Progress

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L2 | OpenADR 3.0 VEN | Virtual End Node implementation per spec | 🔄 In Progress |
| L2 | Price Signal Ingestion | Day-ahead and real-time pricing events | 🔄 In Progress |
| L2 | Demand Response Events | Load shed, CPP, VPP event handling | 📋 Planned |
| L7 | OCPP 2.0.1 Upgrade | Smart charging profiles, ISO 15118 prep | 📋 Planned |

**Technical Approach:**
- Implement OpenADR 3.0 VEN per `1_OpenADR_3.1.0_20250801.yaml` spec
- OAuth 2.0 client credential flow for VTN authentication
- MQTT subscription for real-time event notifications
- Event types: `PRICE`, `SIMPLE`, `ALERT_GRID_EMERGENCY`, `IMPORT_CAPACITY_LIMIT`

**Key Integrations:**
- REST API polling and webhook subscriptions
- MQTT broker connection for async notifications
- JWT token handling for VTN authorization

### v2.1.0 — Telematics Bridge (May 2025) 📋

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L1 | Samsara Integration | Real-time vehicle SoC via Fleet Admin API | 📋 Planned |
| L1 | Geotab Integration | Telematics webhook ingestion | 📋 Planned |
| L1 | Fleetio Integration | Asset mapping and driver assignment | 📋 Planned |

**Technical Approach:**
- Fleet Admin API token-based authentication
- Asset mapping: Vehicle ID → Driver → MiGrid system
- Data ingestion: GPS, odometer, SoC, charging status
- Webhook + polling hybrid for reliability

---

## Phase 3: Market Access (Q3 2025) 📋

*VPP aggregation and wholesale market bidding*

### v3.0.0 — VPP Aggregator (July 2025) 📋

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L3 | Fleet Capacity Aggregation | Real-time available kW/kWh calculation | 📋 Planned |
| L3 | BESS Integration | Stationary storage coordination | 📋 Planned |
| L3 | Availability Forecasting | ML-based vehicle availability prediction | 📋 Planned |

**Technical Approach:**
- Aggregate available capacity: `Σ(vehicle_soc × battery_capacity × availability_factor)`
- Safety constraint: Never discharge BESS below 20%
- Time-series forecasting for vehicle return/departure patterns
- Resource registration with ISO/RTO requirements

### v3.1.0 — Market Gateway Alpha (August 2025) 📋

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L4 | CAISO Adapter | Day-ahead and real-time market bidding | 📋 Planned |
| L4 | PJM Adapter | Regulation and capacity market integration | 📋 Planned |
| L4 | LMP Optimization | Locational marginal pricing arbitrage | 📋 Planned |

**Technical Approach:**
- Market interfaces: CAISO OASIS, PJM eDART
- Bid types: Energy, regulation up/down, spinning reserve
- Settlement: Automated invoice reconciliation
- LMP optimization: Charge when LMP < threshold, hold/discharge when LMP > threshold

---

## Phase 4: Driver Experience (Q4 2025) 🔮

*Mobile app and driver reward ecosystem*

### v4.0.0 — Driver App Launch (October 2025) 🔮

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L5 | React Native Mobile App | iOS and Android driver interface | 🔮 Future |
| L5 | Smart Routing | Optimal charging location recommendations | 🔮 Future |
| L5 | Voice Commands | Hands-free charging session control | 🔮 Future |

**Technical Approach:**
- `apps/driver-app-mobile/` — React Native with Expo
- Charger availability: Real-time OCPI location data
- Route optimization: Factor in SoC, charger availability, pricing
- Voice: Native speech recognition + command mapping

### v4.1.0 — Reward Ecosystem (November 2025) 🔮

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L10 | Open-Wallet Integration | Token minting and redemption | 🔮 Future |
| L10 | $GRID Token Launch | ERC-20 on Polygon mainnet | 🔮 Future |
| L6 | Gamification Engine | Leaderboards, achievements, bonuses | 🔮 Future |

**Technical Approach:**
- Hybrid ledger: Private SQL (escrow) → Public blockchain (freedom)
- Token minting: Only for physics-verified transactions
- Fleet manager controls: Freeze credits before blockchain mint
- Redemption: Exchange portal, transfer, or third-party marketplace

---

## Phase 5: Enterprise Scale (Q1 2026) 🔮

*Multi-site, multi-fleet orchestration*

### v5.0.0 — Enterprise Platform (January 2026) 🔮

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L9 | Commerce Engine | Flexible billing, tariffs, split-billing | 🔮 Future |
| L7 | ISO 15118 Plug & Charge | Certificate-based vehicle authentication | 🔮 Future |
| L7 | OCPI 2.2 Roaming | Cross-network charging orchestration | 🔮 Future |

**Technical Approach:**
- `packages/iso15118-crypto/` — PKI certificate handling
- Tariff engine: Time-of-use, demand charges, dynamic pricing
- Split billing: Driver personal vs. fleet business accounts
- OCPI EMSPs/CPOs: ChargePoint, EVgo, Electrify America

### v5.1.0 — Global Markets (March 2026) 🔮

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L4 | ENTSO-E Adapter | European market integration | 🔮 Future |
| L4 | Nord Pool Adapter | Nordic zonal pricing support | 🔮 Future |
| L8 | Edge Runtime v2 | Multi-site orchestration, mesh networking | 🔮 Future |

**Technical Approach:**
- ENTSO-E Transparency Platform API
- Nord Pool Intraday/Day-ahead markets
- Edge mesh: Site-to-site coordination without cloud dependency
- Geo-redundant deployment: AWS/GCP multi-region

---

## Layer Development Progress

| Layer | Service | Features | Complete | Progress |
|-------|---------|----------|----------|----------|
| L1 | Physics Engine | 6 | 2 | ████░░░░░░ 33% |
| L2 | Grid Signal | 3 | 0 | ░░░░░░░░░░ 0% |
| L3 | VPP Aggregator | 3 | 0 | ░░░░░░░░░░ 0% |
| L4 | Market Gateway | 5 | 0 | ░░░░░░░░░░ 0% |
| L5 | Driver DX | 4 | 1 | ██░░░░░░░░ 25% |
| L6 | Engagement | 1 | 0 | ░░░░░░░░░░ 0% |
| L7 | Device Gateway | 4 | 1 | ██░░░░░░░░ 25% |
| L8 | Energy Manager | 4 | 2 | █████░░░░░ 50% |
| L9 | Commerce | 1 | 0 | ░░░░░░░░░░ 0% |
| L10 | Token Bridge | 3 | 1 | ███░░░░░░░ 33% |

---

## Dependencies & Prerequisites

### External Systems
- **TimescaleDB** — Time-series data for energy metrics
- **Redis** — Session caching and real-time state
- **Apache Kafka** — Event streaming for token engine
- **PostgreSQL 15+** — Core relational data

### Standards Compliance
- **OpenADR 3.0** — Utility demand response (Q2 2025)
- **OCPP 1.6/2.0.1** — Charger communication (Q1-Q2 2025)
- **OCPI 2.2** — Roaming networks (Q1 2026)
- **ISO 15118** — Plug & Charge (Q1 2026)

### Cloud Infrastructure
- **Docker + Kubernetes** — Container orchestration
- **Terraform** — Infrastructure as Code
- **Edge Runtime** — On-premise deployment option

---

## Risk Factors & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenADR 3.0 certification delays | High | Begin certification process Q1 2025 |
| Telematics API rate limits | Medium | Implement caching and webhook priority |
| Market gateway latency | High | Edge compute for market-critical decisions |
| ISO 15118 PKI complexity | Medium | Partner with established certificate authorities |
| Regulatory changes | Medium | Modular architecture for quick adaptation |

---

## Contributing

MiGrid is governed by a Technical Steering Committee (TSC). Major architectural changes require an RFC (Request for Comments).

1. Read the specs in `docs/architecture/`
2. Use the AI context prompt in `docs/context-prompt.md`
3. Submit PRs with physics constraint unit tests
4. Follow safety invariants (e.g., "Never discharge BESS below 20%")

---

## Legend

- ✅ **Complete** — Feature shipped and operational
- 🔄 **In Progress** — Active development
- 📋 **Planned** — Scheduled for development
- 🔮 **Future** — Planned for future phases

---

*MiGrid: The Operating System for Sustainable Fleet Electrification*  
*Apache 2.0 License • Copyright © 2025 MiGrid Contributors*
