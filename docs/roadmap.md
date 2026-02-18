# MiGrid Product Roadmap

**Version:** 10.0.0
**Last Updated:** January 2026
**License:** Apache 2.0

---

## Executive Summary

MiGrid is being developed across eight major phases spanning Q1 2025 through Q4 2026. The roadmap prioritizes foundational OT infrastructure first, followed by grid integration, market access, driver experience, enterprise scale features, and advancing into AI-powered optimization, global expansion, and advanced grid services.

| Phase | Version | Quarter | Focus | Status |
|-------|---------|---------|-------|--------|
| Foundation | v1.0 | Q1 2025 | Physics verification, Energy Manager MVP | ✅ Complete |
| Grid Integration | v2.0 | Q2 2025 | OpenADR 3.0, Telematics bridges | ✅ Complete |
| Market Access | v3.0 | Q3 2025 | VPP aggregation, Wholesale markets | ✅ Complete |
| Driver Experience | v4.0 | Q4 2025 | Mobile app, Token ecosystem | ✅ Complete |
| Enterprise Scale | v5.0 | Q1 2026 | Commerce, Global markets | ✅ Complete |
| AI & Optimization | v6.0 | Q2 2026 | ML forecasting, Predictive analytics | 📋 Planned |
| Global Expansion | v7.0 | Q3 2026 | Multi-tenant, International markets | 📋 Planned |
| Advanced Grid Services | v8.0 | Q4 2026 | Frequency regulation, Grid resilience | 📋 Planned |

---

## Current Status (Q1 2026)

**Features Complete:** 31
**In Progress:** 2
**Planned:** 41

**Overall Progress:** 42%

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

## Phase 2: Grid Integration (Q2 2025) ✅

*OpenADR 3.0 and utility program connectivity*

### v2.0.0 — Grid Signal Release (April 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L2 | OpenADR 3.0 VEN | Virtual End Node implementation per spec | ✅ Complete |
| L2 | Price Signal Ingestion | Day-ahead and real-time pricing events | ✅ Complete |
| L2 | Demand Response Events | Load shed, CPP, VPP event handling | ✅ Complete |
| L7 | OCPP 2.0.1 Upgrade | Smart charging profiles, ISO 15118 prep | ✅ Complete |

**Technical Approach:**
- Implement OpenADR 3.0 VEN per `1_OpenADR_3.1.0_20250801.yaml` spec
- OAuth 2.0 client credential flow for VTN authentication
- MQTT subscription for real-time event notifications
- Event types: `PRICE`, `SIMPLE`, `ALERT_GRID_EMERGENCY`, `IMPORT_CAPACITY_LIMIT`

**Key Integrations:**
- REST API polling and webhook subscriptions
- MQTT broker connection for async notifications
- JWT token handling for VTN authorization

### v2.1.0 — Telematics Bridge (May 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L1 | Samsara Integration | Real-time vehicle SoC via Fleet Admin API | ✅ Complete |
| L1 | Geotab Integration | Telematics webhook ingestion | ✅ Complete |
| L1 | Fleetio Integration | Asset mapping and driver assignment | ✅ Complete |

**Technical Approach:**
- Fleet Admin API token-based authentication
- Asset mapping: Vehicle ID → Driver → MiGrid system
- Data ingestion: GPS, odometer, SoC, charging status
- Webhook + polling hybrid for reliability

---

## Phase 3: Market Access (Q3 2025) ✅

*VPP aggregation and wholesale market bidding*

### v3.0.0 — VPP Aggregator (July 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L3 | Fleet Capacity Aggregation | Real-time available kW/kWh calculation | ✅ Complete |
| L3 | BESS Integration | Stationary storage coordination | ✅ Complete |
| L3 | Availability Forecasting | ML-based vehicle availability prediction | ✅ Complete |

**Technical Approach:**
- Aggregate available capacity: `Σ(vehicle_soc × battery_capacity × availability_factor)`
- Safety constraint: Never discharge BESS below 20%
- Time-series forecasting for vehicle return/departure patterns
- Resource registration with ISO/RTO requirements

### v3.1.0 — Market Gateway Alpha (August 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L4 | CAISO Adapter | Day-ahead and real-time market bidding | ✅ Complete |
| L4 | PJM Adapter | Regulation and capacity market integration | ✅ Complete |
| L4 | LMP Optimization | Locational marginal pricing arbitrage | ✅ Complete |

**Technical Approach:**
- Market interfaces: CAISO OASIS, PJM eDART
- Bid types: Energy, regulation up/down, spinning reserve
- Settlement: Automated invoice reconciliation
- LMP optimization: Charge when LMP < threshold, hold/discharge when LMP > threshold

---

## Phase 4: Driver Experience (Q4 2025) ✅

*Mobile app and driver reward ecosystem*

### v4.0.0 — Driver App Launch (October 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L5 | React Native Mobile App | iOS and Android driver interface | ✅ Complete |
| L5 | Smart Routing | Optimal charging location recommendations | ✅ Complete |
| L5 | Voice Commands | Hands-free charging session control | ✅ Complete |

**Technical Approach:**
- `apps/driver-app-mobile/` — React Native with Expo
- Charger availability: Real-time OCPI location data
- Route optimization: Factor in SoC, charger availability, pricing
- Voice: Native speech recognition + command mapping

### v4.1.0 — Reward Ecosystem (November 2025) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L10 | Open-Wallet Integration | Token minting and redemption | ✅ Complete |
| L10 | $GRID Token Launch | ERC-20 on Polygon mainnet | ✅ Complete |
| L6 | Gamification Engine | Leaderboards, achievements, bonuses | ✅ Complete |

**Technical Approach:**
- Hybrid ledger: Private SQL (escrow) → Public blockchain (freedom)
- Token minting: Only for physics-verified transactions
- Fleet manager controls: Freeze credits before blockchain mint
- Redemption: Exchange portal, transfer, or third-party marketplace

---

## Phase 5: Enterprise Scale (Q1 2026) ✅

*Multi-site, multi-fleet orchestration*

### v5.0.0 — Enterprise Platform (January 2026) ✅ Complete

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L9 | Commerce Engine | Flexible billing, tariffs, split-billing | ✅ Complete |
| L7 | ISO 15118 Plug & Charge | Certificate-based vehicle authentication | ✅ Complete |
| L7 | OCPI 2.2 Roaming | Cross-network charging orchestration | 📋 Planned |

**Technical Approach:**
- `packages/iso15118-crypto/` — PKI certificate handling
- Tariff engine: Time-of-use, demand charges, dynamic pricing
- Split billing: Driver personal vs. fleet business accounts
- OCPI EMSPs/CPOs: ChargePoint, EVgo, Electrify America

### v5.1.0 — Global Markets (March 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L4 | ENTSO-E Adapter | European market integration | 📋 Planned |
| L4 | Nord Pool Adapter | Nordic zonal pricing support | 📋 Planned |
| L8 | Edge Runtime v2 | Multi-site orchestration, mesh networking | 📋 Planned |

**Technical Approach:**
- ENTSO-E Transparency Platform API
- Nord Pool Intraday/Day-ahead markets
- Edge mesh: Site-to-site coordination without cloud dependency
- Geo-redundant deployment: AWS/GCP multi-region

---

## Phase 6: AI & Optimization (Q2 2026) 📋

*Machine learning and predictive analytics*

### v6.0.0 — AI Forecasting Engine (April 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L3 | ML Demand Forecasting | Predict fleet energy demand 24-72h ahead | 📋 Planned |
| L3 | Dynamic Pricing Optimizer | AI-driven bidding strategy optimization | 📋 Planned |
| L1 | Predictive Maintenance | Battery health & degradation forecasting | 📋 Planned |
| L8 | Anomaly Detection | Real-time detection of charging anomalies | 📋 Planned |

**Technical Approach:**
- Time-series forecasting: LSTM/Transformer models for energy demand prediction
- Reinforcement learning: Optimize bidding strategies across multiple markets
- Battery health: SOH (State of Health) prediction using cycle count, temperature, voltage curves
- Anomaly detection: Isolation Forest + DBSCAN for outlier identification
- MLOps: MLflow for model versioning, A/B testing, and deployment

**Key Deliverables:**
- `services/03-vpp-aggregator/` — ML-based demand forecasting extensions
- Integration with L3 VPP service for market optimization
- Real-time inference API with <100ms latency
- Model retraining pipeline with weekly cadence

### v6.1.0 — Intelligent Scheduling (May 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L7 | Context-Aware Charging | Adapt to driver behavior patterns | 📋 Planned |
| L5 | Predictive Smart Routing | Anticipate charging needs en route | 📋 Planned |
| L10 | Dynamic Reward Optimization | Personalized incentive recommendations | 📋 Planned |

**Technical Approach:**
- Driver profiling: Clustering algorithms to identify charging patterns
- Route prediction: Kalman filters + historical GPS data
- Reward optimization: Multi-armed bandit algorithms for personalized incentives
- Privacy-preserving: Federated learning for driver data

---

## Phase 7: Global Expansion (Q3 2026) 📋

*Multi-tenant architecture and international market support*

### v7.0.0 — Multi-Tenant Platform (July 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| ALL | Tenant Isolation | Complete data separation per organization | 📋 Planned |
| L5 | White-Label UI | Customizable branding per tenant | 📋 Planned |
| L9 | Multi-Currency Support | Global billing with FX rate integration | 📋 Planned |
| L9 | Role-Based Access Control v2 | Granular permissions per tenant | 📋 Planned |

**Technical Approach:**
- Database: Row-level security (RLS) with tenant_id partitioning
- API: Tenant context middleware with JWT claims
- UI: Dynamic theming engine with CSS-in-JS
- Billing: Integration with Stripe, PayPal, and regional payment processors
- RBAC: Policy-based access control with Open Policy Agent (OPA)

**Key Deliverables:**
- `packages/tenant-core/` — Shared tenant management library
- Migration from single-tenant to multi-tenant schema
- Admin super-portal for platform management
- Tenant onboarding wizard and self-service portal

### v7.1.0 — International Market Adapters (August 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L4 | AEMO Adapter | Australian Energy Market Operator | 📋 Planned |
| L4 | UK Balancing Mechanism | National Grid ESO integration | 📋 Planned |
| L2 | IEEE 2030.5 Support | North American smart grid standard | 📋 Planned |
| L9 | Regulatory Compliance Engine | Country-specific regulations (GDPR, CCPA) | 📋 Planned |

**Technical Approach:**
- AEMO API: 5-minute dispatch intervals, NEM spot prices
- UK BM: BMRS API for system prices and imbalance volumes
- IEEE 2030.5: Smart Energy Profile (SEP) 2.0 implementation
- Compliance: Automated data residency, consent management, right-to-deletion

---

## Phase 8: Advanced Grid Services (Q4 2026) 📋

*Frequency regulation and grid resilience*

### v8.0.0 — Frequency Regulation (October 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| L3 | Fast Frequency Response | Sub-second grid stabilization | 📋 Planned |
| L7 | V2G Bidirectional Control | Advanced discharge management | 📋 Planned |
| L8 | Microgrid Mode | Island operation during outages | 📋 Planned |
| L3 | Synthetic Inertia | Emulate traditional generator inertia | 📋 Planned |

**Technical Approach:**
- FFR: Monitor grid frequency deviations and respond within 500ms
- V2G advanced: Ramp rate control, power factor management
- Microgrid: Automatic island detection and seamless transition
- Synthetic inertia: Virtual synchronous machine (VSM) algorithms
- ISO/RTO compliance: FERC Order 841, NERC frequency response requirements

**Key Deliverables:**
- Real-time frequency monitoring via PMU (Phasor Measurement Units)
- Sub-second response capability for frequency stabilization
- Grid-forming inverter support for microgrid operation
- Compliance certifications for ancillary services markets

### v8.1.0 — Resilience & Security (November 2026) 📋 Planned

| Layer | Feature | Description | Status |
|-------|---------|-------------|--------|
| ALL | Zero-Trust Architecture | End-to-end encryption, mTLS | 📋 Planned |
| L8 | Distributed Redundancy | Multi-site failover and disaster recovery | 📋 Planned |
| L2 | Cybersecurity Compliance | NERC CIP, IEC 62351 standards | 📋 Planned |
| L7 | Hardware Security Module | Secure key storage for ISO 15118 | 📋 Planned |

**Technical Approach:**
- Zero-trust: mTLS for all service-to-service communication
- DR: Multi-region active-active deployment with RPO <15min
- NERC CIP: Critical infrastructure protection compliance
- HSM: YubiHSM or cloud HSM for certificate management
- Penetration testing: Annual third-party security audits

---

## Layer Development Progress (Q1 2026)

| Layer | Service | Total Features | Complete | In Progress | Planned | Progress |
|-------|---------|----------------|----------|-------------|---------|----------|
| L1 | Physics Engine | 9 | 5 | 1 | 3 | ██████░░░░ 55% |
| L2 | Grid Signal | 6 | 3 | 0 | 3 | █████░░░░░ 50% |
| L3 | VPP Aggregator | 9 | 3 | 0 | 6 | ███░░░░░░░ 33% |
| L4 | Market Gateway | 10 | 3 | 0 | 7 | ███░░░░░░░ 30% |
| L5 | Driver DX | 8 | 3 | 0 | 5 | ████░░░░░░ 37% |
| L6 | Engagement | 4 | 1 | 0 | 3 | ██░░░░░░░░ 25% |
| L7 | Device Gateway | 9 | 6 | 0 | 3 | ████████░░ 66% |
| L8 | Energy Manager | 8 | 3 | 1 | 4 | ████░░░░░░ 37% |
| L9 | Commerce | 5 | 1 | 0 | 4 | ██░░░░░░░░ 20% |
| L10 | Token Bridge | 6 | 3 | 0 | 3 | █████░░░░░ 50% |

**Overall Platform Completion:** 31 of 74 features (42%)

---

## Dependencies & Prerequisites

### External Systems
- **TimescaleDB** — Time-series data for energy metrics
- **Redis** — Session caching and real-time state
- **Apache Kafka** — Event streaming for token engine
- **PostgreSQL 15+** — Core relational data
- **MLflow** — Machine learning model management (Q2 2026)
- **TensorFlow/PyTorch** — ML framework for AI features (Q2 2026)

### Standards Compliance
- **OpenADR 3.0** — Utility demand response ✅ Complete
- **OCPP 1.6/2.0.1** — Charger communication ✅ Complete
- **OCPI 2.2** — Roaming networks (Q1 2026)
- **ISO 15118** — Plug & Charge (Q1 2026)
- **IEEE 2030.5** — Smart Energy Profile 2.0 (Q3 2026)
- **NERC CIP** — Critical infrastructure protection (Q4 2026)
- **IEC 62351** — Power systems cybersecurity (Q4 2026)

### Cloud Infrastructure
- **Docker + Kubernetes** — Container orchestration
- **Terraform** — Infrastructure as Code
- **Edge Runtime** — On-premise deployment option
- **Multi-Region Active-Active** — Global resilience (Q4 2026)
- **Open Policy Agent (OPA)** — Policy-based access control (Q3 2026)

---

## Risk Factors & Mitigation (2026)

| Risk | Impact | Mitigation | Status |
|------|--------|------------|--------|
| OpenADR 3.0 certification delays | High | Begin certification process Q1 2025 | ✅ Mitigated |
| Telematics API rate limits | Medium | Implement caching and webhook priority | ✅ Mitigated |
| Market gateway latency | High | Edge compute for market-critical decisions | ✅ Mitigated |
| ISO 15118 PKI complexity | Medium | Partner with established certificate authorities | 🔄 In Progress |
| Regulatory changes | Medium | Modular architecture for quick adaptation | ✅ Mitigated |
| ML model accuracy & bias | High | Rigorous testing, A/B testing, human oversight | 📋 Planned Q2 2026 |
| Multi-tenant data isolation breach | Critical | Row-level security, regular security audits | 📋 Planned Q3 2026 |
| International market complexity | Medium | Phased rollout by region, local partnerships | 📋 Planned Q3 2026 |
| Cybersecurity threats | Critical | Zero-trust architecture, penetration testing | 📋 Planned Q4 2026 |
| Grid frequency response certification | High | Early engagement with ISO/RTO certification teams | 📋 Planned Q4 2026 |

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

---

## 2026 Quarterly Milestones Summary

### Q1 2026 (Current) 🔄
- Complete Enterprise Platform (v5.0.0)
- Launch Global Markets support (v5.1.0)
- Begin ISO 15118 Plug & Charge certification

### Q2 2026 📋
- Launch AI Forecasting Engine (v6.0.0)
- Deploy Intelligent Scheduling (v6.1.0)
- Implement ML-based demand forecasting and predictive maintenance

### Q3 2026 📋
- Launch Multi-Tenant Platform (v7.0.0)
- Add International Market Adapters (v7.1.0)
- Enable white-label capabilities for partners

### Q4 2026 📋
- Launch Frequency Regulation services (v8.0.0)
- Implement Zero-Trust Architecture (v8.1.0)
- Achieve NERC CIP compliance certification

---

*MiGrid: The Operating System for Sustainable Fleet Electrification*
*Apache 2.0 License • Copyright © 2025-2026 MiGrid Contributors*
