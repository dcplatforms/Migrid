const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'l8-energy-manager',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();

async function connectProducer() {
    try {
        await producer.connect();
        console.log('✅ [L8] Kafka Producer connected');
    } catch (error) {
        console.error('❌ [L8] Kafka Producer connection error:', error);
    }
}

async function publishDlmProfiles(siteId, allocations) {
    try {
        // Map to 2.1-style control structure
        const enrichedAllocations = allocations.map(a => ({
            ...a,
            limitKw: a.allocatedKw,
            unit: 'W',
            mode: 'Charge'
        }));

        await producer.send({
            topic: 'migrid.l8.control',
            messages: [{
                key: siteId,
                value: JSON.stringify({
                    siteId,
                    timestamp: new Date().toISOString(),
                    allocations: enrichedAllocations,
                    protocol: 'ocpp2.1-optimized'
                })
            }],
        });
    } catch (error) {
        console.error('❌ [L8] Failed to publish DLM profiles:', error);
    }
}

module.exports = { connectProducer, publishDlmProfiles };
