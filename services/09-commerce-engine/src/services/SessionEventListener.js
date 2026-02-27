const { Kafka } = require('kafkajs');
const { kafkaBrokers } = require('../../config');
const BillingService = require('./BillingService');

class SessionEventListener {
  constructor() {
    this.kafka = new Kafka({
      clientId: 'commerce-engine-session-listener',
      brokers: kafkaBrokers,
    });
    this.consumer = this.kafka.consumer({ groupId: 'commerce-engine-session-group' });
  }

  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'SESSION_COMPLETED', fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const payload = JSON.parse(message.value.toString());
        await BillingService.processSessionCompletion(payload);
      },
    });
    console.log('[SessionEventListener] Listening for SESSION_COMPLETED events');
  }
}

module.exports = new SessionEventListener();
