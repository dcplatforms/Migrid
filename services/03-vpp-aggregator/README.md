# L3: VPP Aggregator Service

**Version:** 3.3.0
**Status:** ✅ Complete (March 2026)
**Phase:** Enterprise Scale

## Overview

The VPP (Virtual Power Plant) Aggregator service coordinates fleet vehicles and BESS (Battery Energy Storage Systems) into aggregated resources for wholesale market participation under FERC Order 2222.

## Features

### ✅ v3.0.0 — VPP Aggregator (July 2025)

- **Fleet Capacity Aggregation**: Real-time available kW/kWh calculation
  - Formula: `Σ(MAX(0, (current_soc - MAX(min_soc, 20.0)) / 100) × battery_capacity × availability_factor)`
  - Minimum threshold: 100kW for market participation
  - Redis Caching: `<50ms` latency for Market Gateway (L4)

- **BESS Integration**: Stationary storage coordination
  - Safety constraint: Never discharge below 20% SoC
  - Charge/discharge rate optimization

- **Availability Forecasting**: ML-based vehicle availability prediction
  - Historical pattern analysis
  - Driver schedule integration
  - Weather and event-based adjustments

## Architecture

```
VPP Aggregator (L3)
├── Capacity Calculator
│   ├── Real-time aggregation
│   └── Availability scoring
├── BESS Coordinator
│   ├── Safety monitoring
│   └── Dispatch optimization
└── Forecasting Engine
    ├── Time-series prediction
    └── Pattern recognition
```

## API Endpoints

- `GET /capacity/available` - Get current available capacity
- `GET /capacity/forecast` - Get forecasted capacity
- `POST /dispatch` - Dispatch aggregated resources
- `GET /resources` - List all registered resources
- `POST /resources/register` - Register new EV/BESS resource

## Resource Registration

Resources must meet these requirements:
- Minimum battery capacity: 50 kWh
- Bidirectional charging capability (V2G)
- Telemetry reporting enabled
- Grid interconnection approval

## Integration Points

- **L1 (Physics Engine)**: Vehicle SoC and battery data
- **L2 (Grid Signal)**: Demand response events
- **L4 (Market Gateway)**: Bid submission and settlement
- **L7 (Device Gateway)**: V2G control signals

## Environment Variables

```bash
VPP_MIN_CAPACITY_KW=100
VPP_BESS_MIN_SOC=20
VPP_FORECAST_HORIZON_HOURS=72
DATABASE_URL=postgresql://...
KAFKA_BROKERS=localhost:9092
REDIS_URL=redis://localhost:6379
```

## Safety Constraints

1. **Never discharge BESS below 20% SoC** (The Fuse Rule - L1 Enforced)
2. **Respect driver-set minimum vehicle SoC** (if > 20%)
3. **Honor vehicle departure schedules**
4. **Maximum ramp rate: 10 kW/minute**

## Phase 5 Backlog (Q1 2026)

- [~] **ISO 15118 PnC Ready Aggregation**: Prioritize resources with Plug & Charge capability (75% L7 sync).
- [x] **Redis-Based Capacity Cache**: Sub-50ms reporting via `vpp:capacity:available` key for L4.
- [~] **OpenADR 3.0 Automated Dispatch**: Integrated Kafka `grid_signals` with `program_id` and `market_context` for touchless DR.
- [x] **L8 Safe Mode Integration**: Site-level exclusion from aggregation during meter offline events.
- [x] **Contextual Safety Locks**: Respects L1 `l1:safety:lock:context` for granular physics enforcement.
- [x] **Physics-Aware Forecasting**: Factor L1 variance data (physics_score) into capacity predictions and reporting.
- [x] **High-Fidelity Alignment (v3.3.1)**: Integrated `confidence_score` and `(physics_score > 0.95 || confidence_score > 0.95)` audit standards.
- [x] **Real-Time Event Re-aggregation**: Added Kafka `charging_events` handlers for instant capacity updates on charger connect/disconnect.

## Phase 6 Backlog: AI & Optimization (Q2 2026)

- [ ] **ML Demand Forecasting**: Full integration with L11 ML Engine for 24-72h ahead capacity predictions.
- [ ] **Dynamic Pricing Optimizer**: Reinforcement learning for bidding optimization based on L4 price streams.
- [ ] **Predictive Battery Health**: Factor L1 predictive maintenance models into VPP availability factors.

## Phase 8 Backlog: Advanced Grid Services (Q4 2026)

- [ ] **Fast Frequency Response (FFR)**: Implement sub-500ms dispatch trigger for ancillary services.
- [ ] **V2G Bidirectional Optimization**: ISO 15118-20 based discharge coordination.
- [ ] **Synthetic Inertia Emulation**: High-frequency grid stability services.

## Deployment

```bash
docker build -t migrid/vpp-aggregator:3.2.0 .
docker run -p 3003:3003 migrid/vpp-aggregator:3.2.0
```

## Monitoring

Key metrics:
- Total available capacity (kW)
- Number of active resources
- Forecast accuracy (MAPE)
- Dispatch response time

---

*Part of MiGrid Phase 3: Market Access*
