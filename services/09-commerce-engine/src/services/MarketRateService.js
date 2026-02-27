const { Kafka } = require('kafkajs');
const { kafkaBrokers } = require('../../config');

class MarketRateService {
  constructor() {
    this.kafka = new Kafka({
      clientId: 'commerce-engine-market-rate',
      brokers: kafkaBrokers,
    });
    this.consumer = this.kafka.consumer({ groupId: 'commerce-engine-market-rates' });
    this.latestRates = new Map(); // iso -> price
  }

  async start() {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'MARKET_PRICE_UPDATED', fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const payload = JSON.parse(message.value.toString());
        // payload: { iso: 'CAISO', price_per_mwh: 45.00, timestamp: '...' }
        this.latestRates.set(payload.iso.toUpperCase(), payload.price_per_mwh);
        console.log(`[MarketRateService] Updated rate for ${payload.iso}: ${payload.price_per_mwh}`);
      },
    });
  }

  getLatestRate(iso) {
    return this.latestRates.get(iso.toUpperCase()) || null;
  }
}

module.exports = new MarketRateService();
