# L4: Market Gateway Service

**Version:** 3.1.0
**Status:** ✅ Complete (Q3 2025)
**Phase:** Market Access

## Overview

The Market Gateway service provides integration with wholesale energy markets (CAISO, PJM, ERCOT) for day-ahead and real-time bidding, enabling revenue generation through energy arbitrage and ancillary services.

## Features

### ✅ v3.1.0 — Market Gateway Alpha (August 2025)

- **CAISO Adapter**: Day-ahead and real-time market bidding
  - OASIS API integration
  - LMP (Locational Marginal Pricing) data ingestion
  - Bid submission and validation

- **PJM Adapter**: Regulation and capacity market integration
  - eDART API integration
  - RegD, RegA market participation
  - Settlement and invoicing

- **LMP Optimization**: Locational marginal pricing arbitrage
  - Strategy: Charge when LMP < threshold, discharge when LMP > threshold
  - Real-time price monitoring
  - Automated bid optimization

## Supported Markets

| ISO/RTO | Markets | Status |
|---------|---------|--------|
| **CAISO** | Day-ahead, Real-time, Ancillary services | ✅ Live |
| **PJM** | Day-ahead, Real-time, Regulation, Capacity | ✅ Live |
| **ERCOT** | Day-ahead, Real-time | 🔄 Planned |

## Architecture

```
Market Gateway (L4)
├── CAISO Adapter
│   ├── OASIS API client
│   └── Bid formatter
├── PJM Adapter
│   ├── eDART API client
│   └── Settlement processor
├── LMP Optimizer
│   ├── Price analyzer
│   └── Bid strategy engine
└── Settlement Engine
    ├── Invoice reconciliation
    └── Payment tracking
```

## API Endpoints

### Markets
- `GET /markets` - List available markets
- `GET /markets/:iso/prices` - Get current LMP prices
- `GET /markets/:iso/forecast` - Get price forecasts

### Bidding
- `POST /bids/submit` - Submit energy bid
- `GET /bids/:id` - Get bid status
- `DELETE /bids/:id` - Cancel pending bid

### Settlement
- `GET /settlements` - List settlements
- `GET /settlements/:id` - Get settlement details
- `POST /settlements/:id/reconcile` - Reconcile settlement

## Market Participation Requirements

### CAISO
- SC (Scheduling Coordinator) ID required
- Minimum bid size: 100 kW
- Certification: CAISO DERP (Distributed Energy Resource Provider)

### PJM
- Member ID required
- Minimum bid size: 100 kW
- Telemetry: 4-second interval reporting

## LMP Strategy

```javascript
// Charging strategy
if (current_lmp < threshold_buy) {
  charge_fleet(max_capacity);
}

// Discharging strategy
if (current_lmp > threshold_sell) {
  discharge_fleet(available_capacity);
}
```

## Bid Types

### Energy Bids
- Day-ahead: Submit by 10 AM PST (CAISO)
- Real-time: Rolling 5-minute windows

### Ancillary Services
- Regulation Up/Down
- Spinning Reserve
- Non-Spinning Reserve

## Integration Points

- **L3 (VPP Aggregator)**: Available capacity data
- **L2 (Grid Signal)**: Price signals and events
- **L9 (Commerce)**: Revenue settlement
- **L10 (Token)**: Driver incentive distribution

## Environment Variables

```bash
CAISO_SC_ID=YOUR_SC_ID
CAISO_API_KEY=your_api_key
PJM_MEMBER_ID=YOUR_MEMBER_ID
PJM_API_KEY=your_api_key
LMP_THRESHOLD_BUY=30.00
LMP_THRESHOLD_SELL=100.00
DATABASE_URL=postgresql://...
```

## Financials

All financial calculations use `Decimal.js` to prevent rounding errors:

```javascript
const Decimal = require('decimal.js');

const revenue = new Decimal(energy_kwh)
  .times(lmp_price)
  .toFixed(2);
```

## Risk Management

- Maximum bid size: 500 kW per interval
- Stop-loss: Exit position if LMP drops 50% below entry
- Position limits: $10,000 exposure per day

## Deployment

```bash
docker build -t migrid/market-gateway:3.1.0 .
docker run -p 3004:3004 migrid/market-gateway:3.1.0
```

## Monitoring

Key metrics:
- Total revenue (USD)
- Win rate (bid acceptance %)
- Average LMP spread
- Settlement accuracy

---

*Part of MiGrid Phase 3: Market Access*
