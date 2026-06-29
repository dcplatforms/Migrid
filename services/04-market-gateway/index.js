/**
 * L4: Market Gateway Service (v3.8.9)
 * Wholesale energy market integration (CAISO, PJM, ERCOT)
 */

const express = require('express');
const helmet = require('helmet');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const redis = require('redis');
const Decimal = require('decimal.js');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const BiddingOptimizer = require('./BiddingOptimizer');
const MarketPricingService = require('./MarketPricingService');
const GridStatusSyncWorker = require('./GridStatusSyncWorker');

const app = express();
const port = process.env.PORT || 3004;

app.use(helmet());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const pricingService = new MarketPricingService(pool);

// Supported market regions for L4
const SUPPORTED_ISOS = ['CAISO', 'PJM', 'ERCOT', 'NORDPOOL', 'ENTSOE'];

// [L4-133] Sub-millisecond local safety cache
const localSafetyCache = {
  l1_physics: false,
  l4_grid: false,
  l4_regional: {},
  site_safety: {},
  physics_score: "1.0000",
  confidence_score: "1.0000",
  is_sentinel_fidelity: false,
  regional_confidence: {},
  last_updated: null
};

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Kafka initialization
const kafka = new Kafka({
  clientId: 'market-gateway',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});
const producer = kafka.producer({
  allowAutoTopicCreation: true,
  transactionTimeout: 30000
});
const consumer = kafka.consumer({ groupId: 'market-gateway-group' });

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

/**
 * Helper: Standardized site ID extraction for multi-key parity (L2/L3/L10)
 */
const extractSiteId = (payload) => {
  return payload.site_id || payload.siteId || payload.location_id || payload.locationId || 'SYSTEM_WIDE';
};

/**
 * [L4 v3.8.7] safeFloat: Robust isNaN protection for telemetry scoring
 */
const safeFloat = (val, fallback = 1.0) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback.toFixed(4) : parsed.toFixed(4);
};

/**
 * [L4 v3.8.7] isSentinel: Hardened sentinel fidelity detection
 */
const isSentinel = (flag, score) => {
  const isExplicit = flag === true || flag === 'true' || flag === 1;
  return isExplicit || parseFloat(score) > 0.99;
};

// Middleware: Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// LMP thresholds
const LMP_THRESHOLD_BUY = new Decimal(process.env.LMP_THRESHOLD_BUY || '30.00');
const LMP_THRESHOLD_SELL = new Decimal(process.env.LMP_THRESHOLD_SELL || '100.00');

/**
 * [L4-133] Local Safety Cache Poller
 * Ensures sub-millisecond lookup by periodic polling of Redis locks.
 */
async function updateLocalSafetyCache() {
  try {
    const [l1, l4, context, unifiedRaw] = await Promise.all([
      redisClient.get('l1:safety:lock'),
      redisClient.get('l4:grid:lock'),
      redisClient.get('l1:safety:lock:context'),
      redisClient.get('l2:unified:context')
    ]);

    localSafetyCache.l1_physics = (l1 === 'true' || l1 === '1');
    localSafetyCache.l4_grid = (l4 === 'true' || l4 === '1');

    if (context) {
      const details = JSON.parse(context);
      localSafetyCache.physics_score = safeFloat(details.physics_score, 1.0);
      localSafetyCache.confidence_score = safeFloat(details.confidence_score, 1.0);
      localSafetyCache.is_sentinel_fidelity = isSentinel(details.is_sentinel_fidelity, localSafetyCache.physics_score);
    }

    if (unifiedRaw) {
      const unified = JSON.parse(unifiedRaw);
      localSafetyCache.regional_confidence = unified.regional_confidence || {};
    }

    // Regional & Site-specific locks discovery [L4-133 Upgrade]
    // Pattern l*:*lock:* ensures we capture l4:grid:lock:* and l1:safety:lock:site:*
    const newRegionalLocks = {};
    const newSiteLocks = {};
    let cursor = '0';
    do {
      const reply = await redisClient.scan(cursor, { MATCH: 'l*:*lock:*', COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        const values = await redisClient.mGet(reply.keys);
        reply.keys.forEach((key, index) => {
          const val = values[index];
          if (val === 'true' || val === '1') {
            if (key.startsWith('l4:grid:lock:')) {
              const iso = key.split(':').pop().toUpperCase();
              newRegionalLocks[iso] = true;
            } else if (key.startsWith('l1:safety:lock:site:')) {
              const siteId = key.split(':').pop();
              newSiteLocks[siteId] = true;
            }
          }
        });
      }
    } while (cursor !== 0 && cursor !== '0');

    localSafetyCache.l4_regional = newRegionalLocks;
    localSafetyCache.site_safety = newSiteLocks;
    localSafetyCache.last_updated = new Date().toISOString();
  } catch (err) {
    console.error('❌ [Market Gateway] Failed to update local safety cache:', err.message);
  }
}

/**
 * Discovers and returns all regional grid locks (l4:grid:lock:<ISO>)
 * [L4-133] Now uses local cache for sub-millisecond response
 */
async function getRegionalGridLocks() {
  return localSafetyCache.l4_regional;
}

/**
 * Broadcast market price update to Kafka for other services (L9 Commerce)
 * Enriched with location metadata and L1 Physics Scores for L11 ML Engine readiness
 */
async function broadcastMarketPrice(iso, price_per_mwh, location = 'SYSTEM_WIDE') {
  try {
    // Ensure we use Decimal for precision before broadcasting
    const price = new Decimal(price_per_mwh);

    // Calculate profitability index (Price - Degradation Cost)
    // "Verify the Physics": Consistent with BiddingOptimizer.js
    const degradationCostKwh = new Decimal(process.env.DEGRADATION_COST_KWH || '0.02');
    const degradationCostMwh = degradationCostKwh.times(1000);
    const profitabilityIndex = price.minus(degradationCostMwh);

    // AI Readiness: Include physics score and confidence score from L1 safety context if available
    // [L4-133] Optimized: Use localSafetyCache for zero-latency lookups
    let physicsScore = localSafetyCache.physics_score;
    let confidenceScore = localSafetyCache.confidence_score;
    let isSentinelFidelity = localSafetyCache.is_sentinel_fidelity;
    const currentIso = iso.toUpperCase().replace(/-/g, '');

    // Regional Fallback: Use L2 confidence if L1 lock is not active or missing for this region
    if (localSafetyCache.regional_confidence[currentIso]) {
      confidenceScore = safeFloat(localSafetyCache.regional_confidence[currentIso], 1.0);
    }

    // [L4 v3.8.9] Hardware Health Penalty: Adjust confidence based on regional alarms using Decimal.js
    const alarmCountRaw = await redisClient.get(`l4:regional:alarms:${currentIso}`);
    const alarmCount = new Decimal(alarmCountRaw || '0');
    const hardwarePenalty = Decimal.min('0.30', alarmCount.times('0.05'));
    confidenceScore = Decimal.max('0', new Decimal(confidenceScore).minus(hardwarePenalty)).toFixed(4);

    // If cache is empty or stale, or we need regional fallback, check Redis (legacy path)
    if (!localSafetyCache.last_updated) {
      try {
        const lockContext = await redisClient.get('l1:safety:lock:context');
        if (lockContext) {
          const details = JSON.parse(lockContext);
          physicsScore = safeFloat(details.physics_score);
          confidenceScore = safeFloat(details.confidence_score);
          isSentinelFidelity = isSentinel(details.is_sentinel_fidelity, physicsScore);
        }
      } catch (err) {
        console.warn('[Market Gateway] Failed to parse physics score from Redis:', err.message);
      }
    }

    const isHighFidelity = (parseFloat(physicsScore) > 0.95 || parseFloat(confidenceScore) > 0.95);
    // [L4 v3.8.5] Standardized Sentinel logic with fallback
    isSentinelFidelity = isSentinel(isSentinelFidelity, physicsScore);

    const payload = {
      iso: iso.toUpperCase().replace(/-/g, ''),
      location: location || 'SYSTEM_WIDE',
      site_id: location || 'SYSTEM_WIDE', // L10 v4.3.5 site-aware reward parity
      price_per_mwh: price.toNumber(),
      profitability_index: profitabilityIndex.toDecimalPlaces(2).toNumber(),
      degradation_cost_mwh: degradationCostMwh.toNumber(),
      physics_score: physicsScore,
      confidence_score: confidenceScore,
      hardware_penalty: hardwarePenalty.toFixed(4),
      regional_alarm_count: alarmCount,
      is_high_fidelity: isHighFidelity,
      is_sentinel_fidelity: isSentinelFidelity,
      fidelity_status: isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD',
      site_aware_sync: true, // L1 v10.1.3 compliance
      timestamp: new Date().toISOString()
    };

    await producer.send({
      topic: 'MARKET_PRICE_UPDATED',
      messages: [{ value: JSON.stringify(payload) }]
    });

    console.log(`[Market Gateway] Broadcasted price update for ${iso}: $${price.toFixed(2)}/MWh (Profitability: $${profitabilityIndex.toFixed(2)}/MWh)`);
  } catch (error) {
    console.error('[Market Gateway] Failed to broadcast price update:', error.message);
  }
}

/**
 * Listen for grid signals to adjust bidding strategy or halt bidding
 */
async function startGridSignalConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['grid_signals', 'DER_ALARM_REPORTED'], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const signal = JSON.parse(message.value.toString());

        // [L4 v3.8.6] Robust Payload Extraction & NaN Hardening (Parity with L10 v4.3.6)
        const siteIdVal = extractSiteId(signal);

        const physicsScore = safeFloat(signal.physics_score, 1.0);
        const confidenceScore = safeFloat(signal.confidence_score, 1.0);

        const isSentinelFidelity = isSentinel(signal.is_sentinel_fidelity, physicsScore);

        if (topic === 'DER_ALARM_REPORTED') {
          console.log(`🚨 [Market Gateway] DER Alarm reported: ${signal.alarmType} (Severity: ${signal.severity})`);

          // [L4 v3.8.9] Site-Specific Safety Isolation for CRITICAL alarms
          if (signal.severity === 'CRITICAL') {
            const siteLockKey = `l1:safety:lock:site:${siteIdVal}`;
            const siteLockTTL = 900; // 15 minutes
            await redisClient.setEx(siteLockKey, siteLockTTL, 'true');
            console.warn(`🔒 [Market Gateway] Site-Specific Safety Lock ACTIVATED for ${siteIdVal} due to CRITICAL DER alarm`);
          }

          if (signal.severity === 'CRITICAL' || signal.severity === 'HIGH') {
            const alarmRegion = (signal.iso_region || 'SYSTEM_WIDE').toUpperCase().replace(/-/g, '');
            const lockDuration = 1800; // 30 minutes for hardware alarms
            if (alarmRegion !== 'SYSTEM_WIDE') {
              const regionLockKey = `l4:grid:lock:${alarmRegion}`;
              await redisClient.setEx(regionLockKey, lockDuration, 'true');
              console.warn(`[Market Gateway] L4 Regional Grid Lock ACTIVATED for ${alarmRegion} for ${lockDuration}s due to hardware alarm`);
            } else {
              await redisClient.setEx('l4:grid:lock', lockDuration, 'true');
              console.warn(`[Market Gateway] L4 Global Grid Lock ACTIVATED for ${lockDuration}s due to critical hardware alarm`);
            }
          }
          return;
        }

        console.log(`[Market Gateway] Received grid signal: ${signal.event_id} (Site: ${siteIdVal}, Physics: ${physicsScore}, Sentinel: ${isSentinelFidelity})`);

        if (signal.priority === 'HIGH' || signal.priority === 'CRITICAL') {
          console.warn(`⚠️ [Market Gateway] High priority grid signal received. Market bidding should be reviewed for site ${siteIdVal}.`);

          // Phase 5 Forward Engineering: Halt market participation during high-priority grid events
          // Set a 15-minute TTL lock (900 seconds)
          const lockDuration = 900;
          await redisClient.setEx('l4:grid:lock', lockDuration, 'true');

          // Regional locking: if signal targets a specific ISO/Region
          const targetRegion = signal.targets?.find(t => t.type === 'region')?.value;
          if (targetRegion) {
            const iso = targetRegion.toUpperCase().replace(/-/g, '');
            const regionLockKey = `l4:grid:lock:${iso}`;
            await redisClient.setEx(regionLockKey, lockDuration, 'true');
            console.warn(`[Market Gateway] L4 Regional Grid Lock ACTIVATED for ${iso} for ${lockDuration}s due to signal ${signal.event_id}`);
          }

          console.log(`[Market Gateway] L4 Global Grid Lock activated for 15 minutes due to signal ${signal.event_id}`);
        }
      } catch (err) {
        console.error(`[Market Gateway] Failed to process grid signal: ${err.message}`);
      }
    }
  });
}

/**
 * Proactive background loop to poll market prices and notify other layers (L9)
 */
async function startPriceBroadcaster() {
  console.log(`[Market Gateway v3.8.0] Initializing proactive price broadcaster for: ${SUPPORTED_ISOS.join(', ')}`);

  const simulationEnabled = process.env.ENABLE_MARKET_SIMULATION === 'true' || process.env.NODE_ENV === 'test';

  // Phase 5 Enhancement: Simulated Market Feed
  // If no prices exist, seed the database with initial values to unblock L9/L10
  if (simulationEnabled) {
    for (const iso of SUPPORTED_ISOS) {
      try {
        const existing = await pricingService.getLatestPrices(iso, 1);
        if (existing.length === 0) {
          console.log(`[L4 Simulation] Seeding initial market data for ${iso}...`);
          const mockPrice = new Decimal(30).plus(new Decimal(Math.random()).times(100));
          await pricingService.ingestPrice(iso, 'SIMULATED_NODE_001', mockPrice);
        }
      } catch (err) {
        console.warn(`[L4 Simulation] Failed to seed ${iso}:`, err.message);
      }
    }
  }

  // Initial poll
  for (const iso of SUPPORTED_ISOS) {
    try {
      const prices = await pricingService.getLatestPrices(iso, 1);
      if (prices && prices.length > 0) {
        await broadcastMarketPrice(iso, prices[0].price_per_mwh, prices[0].location);
      }
      // Introduce jitter to optimize resource usage
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
    } catch (error) {
      console.error(`[Market Gateway] Initial poll failed for ${iso}:`, error.message);
    }
  }

  // Set interval for every 5 minutes
  setInterval(async () => {
    console.log(`[L11 Readiness] Heartbeat: LMP price streams active for ML training (${new Date().toISOString()})`);
    for (const iso of SUPPORTED_ISOS) {
      try {
        // Phase 5 Enhancement: Inject fresh simulated data periodically
        if (simulationEnabled) {
          const mockPrice = new Decimal(30).plus(new Decimal(Math.random()).times(100));
          await pricingService.ingestPrice(iso, 'SIMULATED_NODE_001', mockPrice);
        }

        const prices = await pricingService.getLatestPrices(iso, 1);
        if (prices && prices.length > 0) {
          console.log(`[L11 Readiness] Polling high-fidelity data for ${iso} at ${prices[0].location}`);
          await broadcastMarketPrice(iso, prices[0].price_per_mwh, prices[0].location);
        }
        // Jitter helps prevent bursty database/network load
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
      } catch (error) {
        console.error(`[Market Gateway] Error polling prices for ${iso}:`, error.message);
      }
    }
  }, 5 * 60 * 1000);
}

// Health check
app.get('/health', async (req, res) => {
  // [L4-133] Sub-millisecond response via localSafetyCache
  res.json({
    service: 'market-gateway',
    version: '3.8.9',
    status: 'healthy',
    mode: process.env.USE_LIVE_DATA === 'true' ? 'LIVE' : 'SIMULATION',
    layer: 'L4',
    markets: SUPPORTED_ISOS,
    safety_locks: {
      l1_physics: localSafetyCache.l1_physics,
      l4_grid: localSafetyCache.l4_grid,
      l4_regional: localSafetyCache.l4_regional
    },
    telemetry: {
      physics_score: localSafetyCache.physics_score,
      confidence_score: localSafetyCache.confidence_score,
      is_sentinel_fidelity: localSafetyCache.is_sentinel_fidelity,
      cache_last_updated: localSafetyCache.last_updated
    }
  });
});

// Get current LMP prices
app.get('/markets/:iso/prices', authenticateToken, async (req, res) => {
  const { iso } = req.params;
  const normalizedIso = iso.toUpperCase().replace(/-/g, '');

  try {
    const prices = await pricingService.getLatestPrices(normalizedIso);

    if (prices.length > 0) {
      // Broadcast the latest price for dynamic billing/L9
      await broadcastMarketPrice(normalizedIso, prices[0].price_per_mwh, prices[0].location);
    }

    const latestPrice = prices[0] ? prices[0].price_per_mwh : null;

    res.json({
      iso: normalizedIso,
      prices: prices.map(p => ({ ...p, price_per_mwh: p.price_per_mwh.toNumber() })),
      strategy: {
        should_charge: latestPrice ? latestPrice.lt(LMP_THRESHOLD_BUY) : false,
        should_discharge: latestPrice ? latestPrice.gt(LMP_THRESHOLD_SELL) : false
      }
    });
  } catch (error) {
    console.error('[Market Gateway Error]', error.message);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Generate and submit optimized bids
app.post('/bids/optimize', authenticateToken, async (req, res) => {
  const { iso } = req.body;

  if (!iso) {
    return res.status(400).json({ error: 'ISO is required' });
  }

  const normalizedIso = iso.toUpperCase().replace(/-/g, '');

  try {
    const optimizer = new BiddingOptimizer(pool, process.env.REDIS_URL || 'redis://localhost:6379', localSafetyCache);
    const { bids, audit } = await optimizer.generateDayAheadBids(normalizedIso);

    // In a real scenario, we would send these FIX messages to CAISO
    // For now, we'll return them and log them
    console.log(`[Market Gateway] Generated ${bids.length} optimized bids for ${normalizedIso} (Physics Score: ${audit.physics_score})`);

    res.json({
      success: true,
      iso: normalizedIso,
      bid_count: bids.length,
      bids: bids, // Returning FIX messages for verification
      audit: audit // FIX-PROT-AUDIT requirements
    });
  } catch (error) {
    console.error('[Market Gateway Optimization Error]', error.message);
    res.status(500).json({ error: 'An internal server error occurred during optimization' });
  }
});

// Submit energy bid
// Phase 5 Enhancement: Persist audit metadata for L11 ML Engine (FIX-PROT-AUDIT)
app.post('/bids/submit', authenticateToken, async (req, res) => {
  const { iso, market_type, quantity_kw, price_per_mwh, delivery_hour, physics_score, confidence_score, capacity_fidelity, audit_context } = req.body;

  if (!iso) {
    return res.status(400).json({ error: 'ISO is required' });
  }

  // Validate bid size
  if (quantity_kw < 100) {
    return res.status(400).json({
      error: 'Minimum bid size is 100 kW'
    });
  }

  const normalizedIso = iso.toUpperCase().replace(/-/g, '');

  try {
    // Use Decimal.js for financial calculations
    const quantity_mwh = new Decimal(quantity_kw).dividedBy(1000);
    const total_value = quantity_mwh.times(price_per_mwh);

    // Insert bid record with auditing columns (v3.8.5)
    // Enforce string formatting for scores as per L1 v10.1.4 standard
    const result = await pool.query(`
      INSERT INTO market_bids (
        iso, market_type, quantity_kw, price_per_mwh,
        total_value_usd, delivery_hour, status, submitted_at,
        physics_score, confidence_score, capacity_fidelity, audit_context
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7, $8, $9, $10)
      RETURNING id, status
    `, [
      normalizedIso,
      market_type,
      quantity_kw,
      price_per_mwh,
      total_value.toFixed(2),
      delivery_hour,
      safeFloat(physics_score, 1.0),
      safeFloat(confidence_score, 1.0),
      capacity_fidelity || 'STANDARD',
      JSON.stringify(audit_context || {})
    ]);

    res.json({
      success: true,
      bid_id: result.rows[0].id,
      status: result.rows[0].status,
      message: 'Bid submitted to market with audit metadata'
    });
  } catch (error) {
    console.error('[Market Gateway Error]', error.message);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * L11 AI Data Readiness: Export historical LMP data for training
 */
app.get('/data/training/lmp', authenticateToken, async (req, res) => {
  // [L4 v3.8.7] Security: Reject tokens containing a fleet_id to restrict global training data
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global training data restricted to system tokens' });
  }

  const { iso, days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const prices = await pricingService.getHistoricalPrices(iso, daysInt);

    res.json({
      iso: iso || 'ALL',
      type: 'LMP_PRICES',
      record_count: prices.length,
      data: prices.map(p => ({
        ...p,
        price_per_mwh: p.price_per_mwh.toNumber()
      })),
      version: '1.1.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Data Export Error]', error.message);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

/**
 * L11 AI Data Readiness: Export historical Fuel Mix data for training
 */
app.get('/data/training/fuel-mix', authenticateToken, async (req, res) => {
  // [L4 v3.8.7] Security: Reject tokens containing a fleet_id to restrict global training data
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global training data restricted to system tokens' });
  }

  const { iso, days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const data = await pricingService.getFuelMixHistory(iso, daysInt);

    res.json({
      iso: iso || 'ALL',
      type: 'FUEL_MIX',
      record_count: data.length,
      data: data.map(d => ({
        ...d,
        gen_mw: d.gen_mw.toNumber()
      })),
      version: '1.1.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Fuel Mix Export Error]', error.message);
    res.status(500).json({ error: 'Failed to export fuel mix training data' });
  }
});

/**
 * L11 AI Data Readiness: Export historical Load Forecast data for training
 */
app.get('/data/training/load-forecast', authenticateToken, async (req, res) => {
  // [L4 v3.8.7] Security: Reject tokens containing a fleet_id to restrict global training data
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global training data restricted to system tokens' });
  }

  const { iso, days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const data = await pricingService.getLoadForecastHistory(iso, daysInt);

    res.json({
      iso: iso || 'ALL',
      type: 'LOAD_FORECAST',
      record_count: data.length,
      data: data.map(d => ({
        ...d,
        forecast_mw: d.forecast_mw.toNumber()
      })),
      version: '1.1.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Load Forecast Export Error]', error.message);
    res.status(500).json({ error: 'Failed to export load forecast training data' });
  }
});

/**
 * L11 AI Data Readiness: Export historical Net Load data for training
 */
app.get('/data/training/net-load', authenticateToken, async (req, res) => {
  // [L4 v3.8.7] Security: Reject tokens containing a fleet_id to restrict global training data
  if (req.user && req.user.fleet_id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global training data restricted to system tokens' });
  }

  const { iso, days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const data = await pricingService.getNetLoadHistory(iso, daysInt);

    res.json({
      iso: iso || 'ALL',
      type: 'NET_LOAD',
      record_count: data.length,
      data: data.map(d => ({
        ...d,
        net_load_mw: d.net_load_mw.toNumber(),
        actual_load_mw: d.actual_load_mw ? d.actual_load_mw.toNumber() : null,
        renewables_mw: d.renewables_mw ? d.renewables_mw.toNumber() : null
      })),
      version: '1.1.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Net Load Export Error]', error.message);
    res.status(500).json({ error: 'Failed to export net load training data' });
  }
});

// Get list of available markets
app.get('/markets', async (req, res) => {
  const regionalLocks = {};

  try {
    const lockPromises = SUPPORTED_ISOS.map(iso => redisClient.get(`l4:grid:lock:${iso}`));
    const lockValues = await Promise.all(lockPromises);

    SUPPORTED_ISOS.forEach((iso, index) => {
      regionalLocks[iso] = (lockValues[index] === 'true' || lockValues[index] === '1');
    });

    const discovered = await getRegionalGridLocks();
    Object.assign(regionalLocks, discovered);
  } catch (error) {
    console.error('[Market Gateway Markets] Redis check failed:', error.message);
  }

  res.json({
    markets: [
      {
        iso: 'CAISO',
        name: 'California Independent System Operator',
        status: 'active',
        grid_lock: !!regionalLocks['CAISO'],
        markets: ['day-ahead', 'real-time', 'ancillary-services']
      },
      {
        iso: 'PJM',
        name: 'PJM Interconnection',
        status: 'active',
        grid_lock: !!regionalLocks['PJM'],
        markets: ['day-ahead', 'real-time', 'regulation', 'capacity']
      },
      {
        iso: 'ERCOT',
        name: 'Electric Reliability Council of Texas',
        status: 'active',
        grid_lock: !!regionalLocks['ERCOT'],
        markets: ['day-ahead', 'real-time', 'ancillary-services']
      },
      {
        iso: 'NORDPOOL',
        name: 'Nord Pool European Power Exchange',
        status: 'active',
        grid_lock: !!regionalLocks['NORDPOOL'],
        markets: ['day-ahead', 'intraday']
      },
      {
        iso: 'ENTSOE',
        name: 'European Network of Transmission System Operators for Electricity',
        status: 'active',
        grid_lock: !!regionalLocks['ENTSOE'],
        markets: ['day-ahead', 'intraday']
      }
    ]
  });
});

// Start server
async function start() {
  try {
    await redisClient.connect();
    console.log('✅ [Market Gateway] Connected to Redis');

    await producer.connect();
    console.log('✅ [Market Gateway] Connected to Kafka Producer');

    await startGridSignalConsumer();
    console.log('✅ [Market Gateway] Grid Signal Consumer running (Listening to L2)');

    // Start Safety Lock Poller [L4-133]
    setInterval(updateLocalSafetyCache, 5000);
    await updateLocalSafetyCache();

    // Start background tasks
    const GRID_STATUS_API_KEY = process.env.GRID_STATUS_API_KEY;
    const USE_LIVE_DATA = process.env.USE_LIVE_DATA === 'true';

    if (USE_LIVE_DATA) {
      console.log('🚀 [Market Gateway] Starting Live Data Integration via GridStatus.io');
      const syncWorker = new GridStatusSyncWorker(
        pool,
        GRID_STATUS_API_KEY,
        process.env.KAFKA_BROKERS || 'localhost:9092',
        process.env.REDIS_URL || 'redis://localhost:6379'
      );
      await syncWorker.start();
    } else {
      console.log('📉 [Market Gateway] Running in Simulation Mode');
      await startPriceBroadcaster();
    }

    if (process.env.NODE_ENV !== 'test') {
      app.listen(port, () => {
        console.log(`[Market Gateway] Running on port ${port}`);
        console.log(`[Market Gateway] LMP Strategy: Buy < $${LMP_THRESHOLD_BUY}, Sell > $${LMP_THRESHOLD_SELL}`);
        console.log('[Market Gateway] Using Decimal.js for financial precision');
      });
    }
  } catch (error) {
    console.error('❌ [Market Gateway] Failed to start:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}

module.exports = { app, localSafetyCache, updateLocalSafetyCache };

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Market Gateway] Shutting down gracefully...');
  await producer.disconnect();
  await consumer.disconnect();
  await redisClient.quit();
  pool.end();
  process.exit(0);
});
