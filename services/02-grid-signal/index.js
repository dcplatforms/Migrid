/**
 * L2: Grid Signal Service
 * OpenADR 3.0 VEN implementation for demand response and price signals
 */

const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

const app = express();
const port = process.env.PORT || 3002;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const kafka = new Kafka({
  clientId: 'grid-signal',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'grid-signal',
    version: '2.0.0',
    status: 'healthy',
    layer: 'L2'
  });
});

/**
 * Receive OpenADR 3.0 Event (VEN)
 */
app.post('/openadr/v3/events', async (req, res) => {
  const event = req.body;

  try {
    console.log('📢 [L2] Received OpenADR Event:', event.id);

    // Save event to ledger
    await pool.query(
      'INSERT INTO grid_events (event_id, event_type, payload, status, received_at) VALUES ($1, $2, $3, $4, NOW())',
      [event.id, event.type || 'demand-response', JSON.stringify(event), 'active']
    );

    // Broadcast event to other services via Kafka
    await producer.send({
      topic: 'grid_signals',
      messages: [{ value: JSON.stringify({ event_id: event.id, type: event.type }) }]
    });

    res.status(202).json({ status: 'RECEIVED', event_id: event.id });
  } catch (error) {
    console.error('[Grid Signal Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

async function start() {
  try {
    await producer.connect();
    console.log('✅ [L2] Connected to Kafka');

    app.listen(port, () => {
      console.log(`[Grid Signal] Running on port ${port} (OpenADR 3.0)`);
    });
  } catch (error) {
    console.error('❌ [L2] Failed to start:', error);
    process.exit(1);
  }
}

start();

process.on('SIGTERM', async () => {
  console.log('[Grid Signal] Shutting down...');
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});
