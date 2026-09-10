/**
 * Portal telemetry for the Admin Portal "Driver Management" page.
 *
 * Serves a live driver leaderboard + engagement KPIs. In production these come
 * from the engagement scoring pipeline / L10 token bridge; here an in-memory
 * simulator jitters scores (and re-ranks) so the leaderboard is live in dev.
 */

const DEPOTS = {
  'Alice Nguyen': 'Depot A · San Jose',
  'Marcus Reed': 'Depot A · San Jose',
  'Priya Shah': 'Depot B · Fremont',
  'Diego Alvarez': 'Depot B · Fremont',
  'Sara Kim': 'Depot C · Oakland',
  'Tom Becker': 'Depot C · Oakland',
};

const STATUSES = [
  { status: 'Active', tone: 'success' },
  { status: 'On Route', tone: 'info' },
  { status: 'Idle', tone: 'neutral' },
];

function tierFor(score) {
  if (score >= 900) return { tier: 'Platinum', tierTone: 'info' };
  if (score >= 820) return { tier: 'Gold', tierTone: 'warning' };
  return { tier: 'Silver', tierTone: 'neutral' };
}

let drivers = [
  { name: 'Alice Nguyen', score: 982, tokens: 12540, status: 'Active', tone: 'success' },
  { name: 'Marcus Reed', score: 934, tokens: 10870, status: 'Active', tone: 'success' },
  { name: 'Priya Shah', score: 901, tokens: 9220, status: 'Active', tone: 'success' },
  { name: 'Diego Alvarez', score: 845, tokens: 7650, status: 'On Route', tone: 'info' },
  { name: 'Sara Kim', score: 788, tokens: 6110, status: 'Idle', tone: 'neutral' },
  { name: 'Tom Becker', score: 742, tokens: 5430, status: 'Active', tone: 'success' },
];

let tokensMinted30d = 1.24; // millions (MGT)

let ticks = 0;
function tick() {
  ticks += 1;
  tokensMinted30d = Number((tokensMinted30d + Math.random() * 0.004).toFixed(3));

  drivers = drivers.map((d) => {
    const score = Math.max(700, Math.min(999, d.score + Math.round((Math.random() - 0.45) * 6)));
    const tokens = d.tokens + Math.floor(Math.random() * 40);
    let { status, tone } = d;
    if (ticks % 6 === 0 && Math.random() < 0.5) {
      const s = STATUSES[Math.floor(Math.random() * STATUSES.length)];
      status = s.status;
      tone = s.tone;
    }
    return { ...d, score, tokens, status, tone };
  });

  // Live re-rank by engagement score.
  drivers.sort((a, b) => b.score - a.score);
}

function leaderboard() {
  return drivers.map((d) => {
    const t = tierFor(d.score);
    return {
      name: d.name,
      depot: DEPOTS[d.name] || 'Depot A · San Jose',
      score: d.score,
      tokens: `${d.tokens.toLocaleString()} MGT`,
      tier: t.tier,
      tierTone: t.tierTone,
      status: d.status,
      statusTone: d.tone,
    };
  });
}

function summary() {
  return {
    activeDrivers: 338 + Math.floor(Math.random() * 8),
    avgEngagement: 84 + Math.floor(Math.random() * 5),
    tokensMinted30dM: Number(tokensMinted30d.toFixed(2)),
    v2gParticipationPct: 61 + Math.floor(Math.random() * 4),
    timestamp: new Date().toISOString(),
    source: 'engagement-engine',
  };
}

function mountPortalTelemetry(app, intervalMs = 5000) {
  setInterval(tick, intervalMs);

  app.use('/api/drivers', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/drivers/summary', (req, res) => res.json(summary()));
  app.get('/api/drivers', (req, res) =>
    res.json({ drivers: leaderboard(), timestamp: new Date().toISOString(), source: 'engagement-engine' })
  );

  console.log('✅ [L6 Engagement] Portal telemetry mounted at /api/drivers');
}

module.exports = { mountPortalTelemetry };
