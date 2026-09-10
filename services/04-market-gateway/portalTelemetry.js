/**
 * Portal telemetry for the Admin Portal "VPP Market Bids" page.
 *
 * Serves a live view of the wholesale market book (bids + revenue KPIs). In
 * production these come from the bidding optimizer / ISO integrations; here an
 * in-memory simulator keeps clearing prices and statuses moving in dev.
 */

const BIDS = [
  { id: 'BID-5521', market: 'CAISO', product: 'Day-Ahead Energy', capacityMw: 1.2, unit: '/MWh', base: 78.4, status: 'Cleared' },
  { id: 'BID-5519', market: 'PJM', product: 'Frequency Reg (RegD)', capacityMw: 0.8, unit: '/MW', base: 21.15, status: 'Cleared' },
  { id: 'BID-5514', market: 'ERCOT', product: 'Responsive Reserve', capacityMw: 1.5, unit: '/MW', base: 44.9, status: 'Pending' },
  { id: 'BID-5510', market: 'CAISO', product: 'Real-Time Energy', capacityMw: 0.6, unit: '/MWh', base: 112.3, status: 'Cleared' },
  { id: 'BID-5507', market: 'Nord Pool', product: 'mFRR', capacityMw: 0.9, unit: '/MW', base: 38.2, currency: '€', status: 'Rejected' },
];

const toneFor = (status) =>
  status === 'Cleared' ? 'success' : status === 'Pending' ? 'warning' : 'danger';

let revenue30dK = 182.4;
let clearedBids = 63;
let state = BIDS.map((b) => ({ ...b, price: b.base }));

let ticks = 0;
function tick() {
  ticks += 1;
  revenue30dK = Number((revenue30dK + Math.random() * 0.6).toFixed(1));

  state = state.map((b) => {
    let status = b.status;
    // Pending bids occasionally clear.
    if (status === 'Pending' && Math.random() < 0.25) {
      status = 'Cleared';
      clearedBids += 1;
    }
    const price = Math.max(5, b.price + (Math.random() - 0.5) * (b.base * 0.04));
    return { ...b, price: Number(price.toFixed(2)), status };
  });

  // Refresh a cleared Pending back to Pending now and then to keep it lively.
  if (ticks % 8 === 0) {
    const idx = state.findIndex((b) => b.id === 'BID-5514');
    if (idx >= 0) state[idx] = { ...state[idx], status: 'Pending' };
  }
}

function bids() {
  return state.map((b) => ({
    id: b.id,
    market: b.market,
    product: b.product,
    capacity: `${b.capacityMw.toFixed(1)} MW`,
    clearing: `${b.currency || '$'}${b.price.toFixed(2)}${b.unit}`,
    status: b.status,
    tone: toneFor(b.status),
  }));
}

function summary() {
  const dispatchableMw = state.reduce((s, b) => s + b.capacityMw, 0);
  return {
    dispatchableMw: Number((dispatchableMw + (Math.random() - 0.5) * 0.2).toFixed(1)),
    revenue30dK: Number(revenue30dK.toFixed(1)),
    clearedBids,
    avgClearingUsd: Number((70 + Math.random() * 8).toFixed(2)),
    timestamp: new Date().toISOString(),
    source: 'market-gateway',
  };
}

function mountPortalTelemetry(app, intervalMs = 5000) {
  setInterval(tick, intervalMs);

  app.use('/api/market', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/market/summary', (req, res) => res.json(summary()));
  app.get('/api/market/bids', (req, res) =>
    res.json({ bids: bids(), timestamp: new Date().toISOString(), source: 'market-gateway' })
  );

  console.log('✅ [L4 Market] Portal telemetry mounted at /api/market');
}

module.exports = { mountPortalTelemetry };
