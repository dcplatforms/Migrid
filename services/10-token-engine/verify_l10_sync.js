const { Kafka } = require('kafkajs');
const Decimal = require('decimal.js');

const kafka = new Kafka({
  clientId: 'l10-verifier',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();

async function run() {
  await producer.connect();
  console.log('Connected to Kafka producer.');

  const testMessages = [
    {
      topic: 'MARKET_PRICE_UPDATED',
      payload: { iso: 'ENTSO-E', price_per_mwh: 10.5, timestamp: new Date().toISOString() }
    },
    {
      topic: 'driver_actions',
      payload: {
        driver_id: 'driver-test-123',
        action_type: 'session_completed',
        source_value: 15.0, // 15 kWh
        event_id: 'session-123',
        iso: 'ENTSO-E',
        physics_score: 0.995,
        is_sentinel_fidelity: true,
        site_id: 'SITE-ALPHA'
      }
    },
    {
      topic: 'driver_actions',
      payload: {
        driver_id: 'driver-test-123',
        action_type: 'v2g_discharge',
        source_value: 5.0,
        event_id: 'v2g-123',
        iso: 'PJM',
        physics_score: -0.1 // Should be rejected by L10
      }
    }
  ];

  for (const msg of testMessages) {
    await producer.send({
      topic: msg.topic,
      messages: [{ value: JSON.stringify(msg.payload) }]
    });
    console.log(`Sent to ${msg.topic}:`, msg.payload);
  }

  await producer.disconnect();
  console.log('Verification messages sent.');
}

run().catch(console.error);
