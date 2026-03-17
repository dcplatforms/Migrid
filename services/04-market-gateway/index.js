/**
 * L4: Market Gateway Service
 * Wholesale energy market integration (CAISO, PJM, ERCOT)
 */

const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const redis = require('redis');
const Decimal = require('decimal.js');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const BiddingOptimizer = require('./BiddingOptimizer');
const MarketPricingService = require('./MarketPricingService');

const app = express();
const port = process.env.PORT || 3004;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const pricingService = new MarketPricingService(pool);

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
 * Broadcast market price update to Kafka for other services (L9 Commerce)
 * Enriched with location metadata for L11 ML Engine readiness
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

    const payload = {
      iso: iso.toUpperCase(),
      location: location,
      price_per_mwh: price.toNumber(),
      profitability_index: profitabilityIndex.toDecimalPlaces(2).toNumber(),
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
  await consumer.subscribe({ topic: 'grid_signals', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const signal = JSON.parse(message.value.toString());
      console.log(`[Market Gateway] Received grid signal: ${signal.event_id} (Type: ${signal.type}, Priority: ${signal.priority})`);

      if (signal.priority === 'HIGH' || signal.priority === 'CRITICAL') {
        console.warn(`⚠️ [Market Gateway] High priority grid signal received. Market bidding should be reviewed for site ${signal.site_id}.`);

        // Phase 5 Forward Engineering: Halt market participation during high-priority grid events
        // Set a 15-minute TTL lock (900 seconds)
        const lockDuration = 900;
        await redisClient.setEx('l4:grid:lock', lockDuration, 'true');

        // Regional locking: if signal targets a specific ISO/Region
        const targetRegion = signal.targets?.find(t => t.type === 'region')?.value;
        if (targetRegion) {
          const regionLockKey = `l4:grid:lock:${targetRegion.toUpperCase()}`;
          await redisClient.setEx(regionLockKey, lockDuration, 'true');
          console.log(`[Market Gateway] L4 Regional Grid Lock activated for ${targetRegion} due to signal ${signal.event_id}`);
        }

        console.log(`[Market Gateway] L4 Global Grid Lock activated for 15 minutes due to signal ${signal.event_id}`);
      }
    }
  });
}

/**
 * Proactive background loop to poll market prices and notify other layers (L9)
 */
async function startPriceBroadcaster() {
  const isos = ['CAISO', 'PJM', 'ERCOT', 'NORDPOOL'];
  console.log(`[Market Gateway] Initializing proactive price broadcaster for: ${isos.join(', ')}`);

  // Initial poll
  for (const iso of isos) {
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
    console.log('[L11 Readiness] Heartbeat: LMP price streams active for ML training');
    for (const iso of isos) {
      try {
        const prices = await pricingService.getLatestPrices(iso, 1);
        if (prices && prices.length > 0) {
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
  let l1Lock = 'false';
  let l4Lock = 'false';

  try {
    l1Lock = await redisClient.get('l1:safety:lock') || 'false';
    l4Lock = await redisClient.get('l4:grid:lock') || 'false';
  } catch (error) {
    console.error('[Market Gateway Health] Redis check failed:', error.message);
  }

  res.json({
    service: 'market-gateway',
    version: '3.4.0',
    status: 'healthy',
    layer: 'L4',
    markets: ['CAISO', 'PJM', 'ERCOT', 'NORDPOOL'],
    safety_locks: {
      l1_physics: l1Lock === 'true' || l1Lock === '1',
      l4_grid: l4Lock === 'true' || l4Lock === '1'
    }
  });
});

// Get current LMP prices
app.get('/markets/:iso/prices', authenticateToken, async (req, res) => {
  const { iso } = req.params;

  try {
    const prices = await pricingService.getLatestPrices(iso);

    if (prices.length > 0) {
      // Broadcast the latest price for dynamic billing/L9
      await broadcastMarketPrice(iso, prices[0].price_per_mwh, prices[0].location);
    }

    const latestPrice = prices[0] ? prices[0].price_per_mwh : null;

    res.json({
      iso: iso.toUpperCase(),
      prices: prices.map(p => ({ ...p, price_per_mwh: p.price_per_mwh.toNumber() })),
      strategy: {
        should_charge: latestPrice ? latestPrice.lt(LMP_THRESHOLD_BUY) : false,
        should_discharge: latestPrice ? latestPrice.gt(LMP_THRESHOLD_SELL) : false
      }
    });
  } catch (error) {
    console.error('[Market Gateway Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Generate and submit optimized bids
app.post('/bids/optimize', authenticateToken, async (req, res) => {
  const { iso } = req.body;

  if (!iso) {
    return res.status(400).json({ error: 'ISO is required' });
  }

  try {
    const optimizer = new BiddingOptimizer(pool, process.env.REDIS_URL || 'redis://localhost:6379');
    const bids = await optimizer.generateDayAheadBids(iso);

    // In a real scenario, we would send these FIX messages to CAISO
    // For now, we'll return them and log them
    console.log(`[Market Gateway] Generated ${bids.length} optimized bids for ${iso}`);

    res.json({
      success: true,
      iso,
      bid_count: bids.length,
      bids: bids // Returning FIX messages for verification
    });
  } catch (error) {
    console.error('[Market Gateway Optimization Error]', error);
    res.status(500).json({ error: 'An internal server error occurred during optimization' });
  }
});

// Submit energy bid
app.post('/bids/submit', authenticateToken, async (req, res) => {
  const { iso, market_type, quantity_kw, price_per_mwh, delivery_hour } = req.body;

  // Validate bid size
  if (quantity_kw < 100) {
    return res.status(400).json({
      error: 'Minimum bid size is 100 kW'
    });
  }

  try {
    // Use Decimal.js for financial calculations
    const quantity_mwh = new Decimal(quantity_kw).dividedBy(1000);
    const total_value = quantity_mwh.times(price_per_mwh);

    // Insert bid record
    const result = await pool.query(`
      INSERT INTO market_bids (
        iso, market_type, quantity_kw, price_per_mwh,
        total_value_usd, delivery_hour, status, submitted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
      RETURNING id, status
    `, [
      iso.toUpperCase(),
      market_type,
      quantity_kw,
      price_per_mwh,
      total_value.toFixed(2),
      delivery_hour
    ]);

    res.json({
      success: true,
      bid_id: result.rows[0].id,
      status: result.rows[0].status,
      message: 'Bid submitted to market'
    });
  } catch (error) {
    console.error('[Market Gateway Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * L11 AI Data Readiness: Export historical LMP data for training
 */
app.get('/data/training/lmp', authenticateToken, async (req, res) => {
  const { iso, days } = req.query;
  const daysInt = parseInt(days) || 7;

  try {
    const result = await pool.query(`
      SELECT iso, location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE ($1::text IS NULL OR iso = $1)
        AND timestamp > NOW() - ($2 || ' days')::interval
      ORDER BY timestamp ASC
    `, [iso ? iso.toUpperCase() : null, daysInt]);

    res.json({
      iso: iso || 'ALL',
      record_count: result.rows.length,
      data: result.rows.map(r => ({
        ...r,
        price_per_mwh: new Decimal(r.price_per_mwh).toNumber()
      })),
      version: '1.0.0',
      status: 'READY_FOR_L11'
    });
  } catch (error) {
    console.error('[L11 Data Export Error]', error);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

// Get list of available markets
app.get('/markets', (req, res) => {
  res.json({
    markets: [
      {
        iso: 'CAISO',
        name: 'California Independent System Operator',
        status: 'active',
        markets: ['day-ahead', 'real-time', 'ancillary-services']
      },
      {
        iso: 'PJM',
        name: 'PJM Interconnection',
        status: 'active',
        markets: ['day-ahead', 'real-time', 'regulation', 'capacity']
      },
      {
        iso: 'ERCOT',
        name: 'Electric Reliability Council of Texas',
        status: 'active',
        markets: ['day-ahead', 'real-time', 'ancillary-services']
      },
      {
        iso: 'NORDPOOL',
        name: 'Nord Pool European Power Exchange',
        status: 'planned',
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

    // Start background tasks
    await startPriceBroadcaster();

    app.listen(port, () => {
      console.log(`[Market Gateway] Running on port ${port}`);
      console.log(`[Market Gateway] LMP Strategy: Buy < $${LMP_THRESHOLD_BUY}, Sell > $${LMP_THRESHOLD_SELL}`);
      console.log('[Market Gateway] Using Decimal.js for financial precision');
    });
  } catch (error) {
    console.error('❌ [Market Gateway] Failed to start:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Market Gateway] Shutting down gracefully...');
  await producer.disconnect();
  await consumer.disconnect();
  await redisClient.quit();
  pool.end();
  process.exit(0);
});
