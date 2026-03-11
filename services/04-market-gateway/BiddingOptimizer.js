const { createClient } = require('redis');
const { convertToFIX, getCurrentUTCTimeStamp } = require('fix-protocol/fixutils');
const MarketPricingService = require('./MarketPricingService');
const Decimal = require('decimal.js');

class BiddingOptimizer {
  constructor(pool, redisUrl) {
    this.pricingService = new MarketPricingService(pool);
    this.redisClient = createClient({ url: redisUrl });
    this.redisClient.on('error', (err) => console.error('Redis Client Error', err));
    this.isRedisConnected = false;
  }

  async connect() {
    if (!this.isRedisConnected) {
      await this.redisClient.connect();
      this.isRedisConnected = true;
    }
  }

  async disconnect() {
    if (this.isRedisConnected) {
      await this.redisClient.quit();
      this.isRedisConnected = false;
    }
  }

  /**
   * Fetches real-time aggregated capacity from Redis.
   * @returns {Promise<Decimal>} Capacity in kW
   */
  async getAggregatedCapacity() {
    await this.connect();
    const capacity = await this.redisClient.get('vpp:capacity:available');
    return new Decimal(capacity || '0');
  }

  /**
   * Checks if the L1 Physics safety lock is active in Redis.
   * @returns {Promise<boolean>} True if safety lock is active
   */
  async isSafetyLockActive() {
    await this.connect();
    const lock = await this.redisClient.get('l1:safety:lock');
    return lock === 'true' || lock === '1';
  }

  /**
   * Run optimization and generate FIX messages for Day-Ahead market.
   * @param {string} iso - The ISO name (e.g., 'CAISO')
   * @returns {Promise<Array<string>>} List of FIX messages
   */
  async generateDayAheadBids(iso) {
    // Verify the Physics: Check for L1 safety lock before bidding
    if (await this.isSafetyLockActive()) {
      const lockContext = await this.redisClient.get('l1:safety:lock:context');
      const details = lockContext ? JSON.parse(lockContext) : null;

      console.warn(`🚨 [L4 Market Gateway] Bidding halted: L1 safety lock is active for ${iso}`);
      if (details) {
        console.warn(`[L4 Safety Context] Reason: ${details.event_type}, Severity: ${details.severity}, Site: ${details.site_id || 'N/A'}`);
      }
      return [];
    }

    const forecasts = await this.pricingService.getDayAheadForecast(iso);
    const pVppKw = await this.getAggregatedCapacity();
    const pVppMw = pVppKw.dividedBy(1000);

    const degradationCostKwh = new Decimal('0.02');
    const degradationCostMwh = degradationCostKwh.times(1000); // $20/MWh

    const bids = [];
    let seqNum = 1;

    for (const forecast of forecasts) {
      const lmpMwh = new Decimal(forecast.price_per_mwh);
      let pBidMw = new Decimal(0);

      // Optimization Invariant: maximize (Pbid * LMP - Cdeg(Pbid))
      // Profit = Pbid * (LMP - 20)
      // If LMP > 20, maximize Pbid (set to Pvpp)
      // If LMP <= 20, Pbid should be 0
      if (lmpMwh.gt(degradationCostMwh)) {
        pBidMw = pVppMw;
      }

      // Format as FIX message
      // Use degradation cost as the limit price to ensure we only clear when profitable
      const fixMsg = this.formatFixBid(iso, forecast.timestamp, pBidMw, degradationCostMwh, seqNum++);
      bids.push(fixMsg);
    }

    return bids;
  }

  /**
   * Formats a bid into a FIX message.
   * @param {string} iso - ISO name
   * @param {Date} timestamp - Delivery hour timestamp
   * @param {Decimal} quantityMw - Bid capacity in MW
   * @param {Decimal} limitPriceMwh - Limit price ($/MWh)
   * @param {number} seqNum - Message sequence number
   * @returns {string} FIX message
   */
  formatFixBid(iso, timestamp, quantityMw, limitPriceMwh, seqNum) {
    const msgraw = {
      '8': 'FIX.4.4',
      '35': 'D', // NewOrderSingle
      '49': 'MIGRID', // SenderCompID
      '56': iso.toUpperCase(), // TargetCompID
      '34': seqNum.toString(), // MsgSeqNum
      '52': getCurrentUTCTimeStamp(), // SendingTime
      '11': `BID-${iso}-${timestamp.getTime()}`, // ClOrdID
      '38': quantityMw.toFixed(2), // OrderQty (MW)
      '40': '2', // OrdType (Limit)
      '44': limitPriceMwh.toFixed(2), // Price ($/MWh)
      '54': '2', // Side (Sell - discharging battery to grid)
      '60': getCurrentUTCTimeStamp(), // TransactTime
    };

    return convertToFIX(
      msgraw,
      msgraw['8'],
      msgraw['52'],
      msgraw['49'],
      msgraw['56'],
      msgraw['34']
    );
  }
}

module.exports = BiddingOptimizer;
