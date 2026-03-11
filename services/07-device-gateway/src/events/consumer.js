const { Kafka } = require('kafkajs');
const config = require('../config');

const kafka = new Kafka({
    clientId: 'l7-device-gateway-consumer',
    brokers: config.kafkaBrokers
});

const consumer = kafka.consumer({ groupId: 'l7-device-gateway-group' });

async function connectConsumer(messageHandler) {
    try {
        await consumer.connect();
        await consumer.subscribe({ topics: ['migrid.l8.control', 'migrid.l3.v2g'], fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const payload = JSON.parse(message.value.toString());
                console.log(`[L7] Received control signal from ${topic}:`, payload);
                await messageHandler(topic, payload);
            },
        });
        console.log('✅ [L7] Kafka Consumer connected and subscribed');
    } catch (error) {
        console.error('❌ [L7] Kafka Consumer error:', error);
    }
}

module.exports = { connectConsumer };
