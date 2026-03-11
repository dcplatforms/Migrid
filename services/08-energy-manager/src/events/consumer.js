const { Kafka } = require('kafkajs');
const { setSiteConfig } = require('../state/topologyMgr');

const kafka = new Kafka({
    clientId: 'l8-energy-manager-consumer',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: 'l8-energy-manager-group' });

async function connectConsumer() {
    try {
        await consumer.connect();
        await consumer.subscribe({ topics: ['migrid.topology.updated', 'migrid.l3.v2g'], fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const payload = JSON.parse(message.value.toString());
                console.log(`[L8] Received message from ${topic}:`, payload);

                if (topic === 'migrid.topology.updated') {
                    await setSiteConfig(payload.siteId, payload.config);
                }

                // Handle V2G dispatch from L3
                if (topic === 'migrid.l3.v2g') {
                    // Logic to adjust DLM headroom for discharge
                    console.log(`[L8] V2G Dispatch requested for site ${payload.siteId}`);
                }
            },
        });
        console.log('✅ [L8] Kafka Consumer connected');
    } catch (error) {
        console.error('❌ [L8] Kafka Consumer error:', error);
    }
}

module.exports = { connectConsumer };
