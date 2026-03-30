const { Kafka } = require('kafkajs');
const redis = require('redis');

const kafka = new Kafka({
  clientId: 'l6-verifier',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

async function run() {
  await producer.connect();
  await redisClient.connect();
  console.log('Connected to Kafka and Redis.');

  // Set market profitability to trigger multipliers
  await redisClient.hSet('market:profitability', 'CAISO', '120'); // Scarcity
  await redisClient.hSet('market:profitability', 'PJM', '10');    // Surplus
  await redisClient.hSet('market:profitability', 'ERCOT', '50');  // Normal
  console.log('Mock market prices set in Redis.');

  const testEvents = [
    {
      topic: 'SESSION_COMPLETED',
      payload: {
        driver_id: 'driver-scarcity-123',
        session_id: 'session-scarcity-123',
        energyDispensedKwh: 10.0,
        type: 'SESSION_COMPLETED',
        physics_score: 0.98,
        iso: 'CAISO'
      }
    },
    {
      topic: 'SESSION_COMPLETED',
      payload: {
        driver_id: 'driver-surplus-456',
        session_id: 'session-surplus-456',
        energyDispensedKwh: 10.0,
        type: 'SESSION_COMPLETED',
        physics_score: 0.97,
        iso: 'PJM'
      }
    },
    {
      topic: 'charging_events',
      payload: {
        driver_id: 'driver-v2g-789',
        session_id: 'session-v2g-789',
        energyDischargedKwh: 5.0,
        type: 'v2g_discharge',
        protocol: 'ocpp2.1',
        iso: 'CAISO'
      }
    }
  ];

  for (const event of testEvents) {
    await producer.send({
      topic: event.topic,
      messages: [{ value: JSON.stringify(event.payload) }]
    });
    console.log(`Sent to ${event.topic}:`, event.payload);
  }

  await producer.disconnect();
  await redisClient.quit();
  console.log('Verification events sent.');
}

run().catch(console.error);
