const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'vpp-aggregator-producer',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();

async function connectProducer() {
    await producer.connect();
}

async function dispatchV2G(chargePointId, amountKw, mode = 'Discharge') {
    await producer.send({
        topic: 'migrid.l3.v2g',
        messages: [{
            key: chargePointId,
            value: JSON.stringify({
                chargePointId,
                timestamp: new Date().toISOString(),
                mode, // 'Charge' or 'Discharge'
                limitKw: Math.abs(amountKw),
                v2xProfile: true // Flag to indicate we want native 2.1 V2X if available
            })
        }]
    });
}

module.exports = { connectProducer, dispatchV2G };
