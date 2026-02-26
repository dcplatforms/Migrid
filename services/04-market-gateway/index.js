/**
 * L4: Market Gateway Service
 * Wholesale energy market integration (CAISO, PJM, ERCOT)
 */

const express = require('express');
const { Pool } = require('pg');
const Decimal = require('decimal.js');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3004;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

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

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'market-gateway',
    version: '3.1.0',
    status: 'healthy',
    layer: 'L4',
    markets: ['CAISO', 'PJM']
  });
});

// Get current LMP prices
app.get('/markets/:iso/prices', authenticateToken, async (req, res) => {
  const { iso } = req.params;

  try {
    // Fetch LMP data from ISO/RTO API
    // This is a simplified example
    const result = await pool.query(`
      SELECT location, price_per_mwh, timestamp
      FROM lmp_prices
      WHERE iso = $1
        AND timestamp > NOW() - INTERVAL '5 minutes'
      ORDER BY timestamp DESC
      LIMIT 10
    `, [iso.toUpperCase()]);

    res.json({
      iso: iso.toUpperCase(),
      prices: result.rows,
      strategy: {
        should_charge: result.rows[0]?.price_per_mwh < LMP_THRESHOLD_BUY.toNumber(),
        should_discharge: result.rows[0]?.price_per_mwh > LMP_THRESHOLD_SELL.toNumber()
      }
    });
  } catch (error) {
    console.error('[Market Gateway Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
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
        status: 'planned',
        markets: ['day-ahead', 'real-time']
      }
    ]
  });
});

// Start server
app.listen(port, () => {
  console.log(`[Market Gateway] Running on port ${port}`);
  console.log(`[Market Gateway] LMP Strategy: Buy < $${LMP_THRESHOLD_BUY}, Sell > $${LMP_THRESHOLD_SELL}`);
  console.log('[Market Gateway] Using Decimal.js for financial precision');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Market Gateway] Shutting down gracefully...');
  pool.end();
  process.exit(0);
});
