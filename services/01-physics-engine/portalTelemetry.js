/**
 * Portal telemetry for the Admin Portal "Charging Sessions" page.
 *
 * Serves a live view of the physics-audit session feed. In production these
 * rows come from the audit_log table / Kafka stream; here an in-memory
 * simulator keeps them evolving so the dashboard has live data in dev.
 */

const DRIVERS = [
  'Alice Nguyen', 'Marcus Reed', 'Priya Shah', 'Diego Alvarez',
  'Sara Kim', 'Tom Becker', 'Lena Osei', 'Owen Park', 'Maya Cohen',
];
const VEHICLES = [
  'Ford E-Transit #4102', 'Rivian EDV #3391', 'BrightDrop Zevo #2210',
  'Ford E-Transit #4088', 'Rivian EDV #3377', 'BrightDrop Zevo #2188',
  'Ford E-Transit #4110',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let seq = 90241;
let sessionsToday = 1284;
let energyMwh = 42.7;
let sessions = [];

function makeSession() {
  seq += 1;
  const discharge = Math.random() < 0.15;
  const energy = discharge ? -(10 + Math.random() * 15) : 15 + Math.random() * 50;
  const variance = discharge ? Math.random() * 2 : Math.random() * 20;

  let status, statusTone, varianceTone;
  if (discharge) {
    status = 'V2G Export';
    statusTone = 'info';
    varianceTone = 'info';
  } else if (variance < 5) {
    status = 'Verified';
    statusTone = 'success';
    varianceTone = 'success';
  } else if (variance < 15) {
    status = 'Review';
    statusTone = 'warning';
    varianceTone = 'warning';
  } else {
    status = 'Flagged';
    statusTone = 'danger';
    varianceTone = 'danger';
  }

  return {
    id: `SES-${seq}`,
    driver: pick(DRIVERS),
    vehicle: pick(VEHICLES),
    energyKwh: Number(energy.toFixed(2)),
    variancePct: Number(variance.toFixed(1)),
    varianceTone,
    status,
    statusTone,
  };
}

let ticks = 0;
function tick() {
  ticks += 1;
  sessionsToday += Math.floor(Math.random() * 3);
  energyMwh = Number((energyMwh + Math.random() * 0.2).toFixed(1));

  // Occasionally a fresh session lands at the top of the feed.
  if (ticks % 3 === 0) {
    sessions.unshift(makeSession());
    sessions = sessions.slice(0, 7);
  } else {
    // Light jitter so active rows feel live.
    sessions = sessions.map((s) =>
      s.status === 'Verified' && Math.random() < 0.4
        ? { ...s, energyKwh: Number((s.energyKwh + (Math.random() - 0.5)).toFixed(2)) }
        : s
    );
  }
}

function seed() {
  for (let i = 0; i < 7; i++) sessions.push(makeSession());
}

function summary() {
  return {
    sessionsToday,
    energyMwh,
    physicsPassRatePct: Number((96 + Math.random() * 2.5).toFixed(1)),
    flagged: 10 + Math.floor(Math.random() * 8),
    timestamp: new Date().toISOString(),
    source: 'physics-engine',
  };
}

function mountPortalTelemetry(app, intervalMs = 5000) {
  seed();
  setInterval(tick, intervalMs);

  app.use('/api/sessions', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/sessions/summary', (req, res) => res.json(summary()));
  app.get('/api/sessions', (req, res) =>
    res.json({ sessions, timestamp: new Date().toISOString(), source: 'physics-engine' })
  );

  console.log('✅ [L1 Physics] Portal telemetry mounted at /api/sessions');
}

module.exports = { mountPortalTelemetry };
