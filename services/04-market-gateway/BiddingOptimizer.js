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
   * Supports regional aggregation (Phase 5 Forward Engineering).
   * @param {string} iso - Optional ISO for regional capacity lookup
   * @returns {Promise<Object>} { capacity: Decimal, fidelity: string }
   */
  async getAggregatedCapacity(iso = null) {
    await this.connect();

    if (iso) {
      try {
        const regionalCapacityRaw = await this.redisClient.get('vpp:capacity:regional');
        if (regionalCapacityRaw) {
          const regionalCapacity = JSON.parse(regionalCapacityRaw);
          // ISO Normalization: Uppercase and remove hyphens (consistent with L3 v3.3.0)
          const isoKey = iso.toUpperCase().replace(/-/g, '');
          const data = regionalCapacity[isoKey];

          if (data !== undefined) {
            // Support both flat value (legacy) and nested object (v3.3.0+)
            const isObject = (typeof data === 'object' && data !== null);
            const capacityValue = isObject ? data.capacity : data;
            const fidelity = isObject ? (data.is_high_fidelity ? 'HIGH_FIDELITY' : 'STANDARD') : 'STANDARD';

            console.log(`[BiddingOptimizer] Using regional capacity for ${isoKey}: ${capacityValue} kWh (Fidelity: ${fidelity})`);
            return {
              capacity: new Decimal(capacityValue || '0'),
              fidelity: fidelity
            };
          }
        }
      } catch (err) {
        console.error(`[BiddingOptimizer] Failed to parse regional capacity for ${iso}:`, err.message);
      }
    }

    const capacity = await this.redisClient.get('vpp:capacity:available');
    return {
      capacity: new Decimal(capacity || '0'),
      fidelity: 'STANDARD'
    };
  }

  /**
   * Checks if any safety lock (L1 Physics or L4 Grid) is active in Redis.
   * @returns {Promise<Object>} Status of safety locks
   */
  async getSafetyLockStatus(iso = null) {
    await this.connect();
    const l1Lock = await this.redisClient.get('l1:safety:lock');
    const l4Lock = await this.redisClient.get('l4:grid:lock');
    let l4RegionalLock = 'false';

    if (iso) {
      const isoKey = iso.toUpperCase().replace(/-/g, '');
      l4RegionalLock = await this.redisClient.get(`l4:grid:lock:${isoKey}`);
    }

    return {
      l1: l1Lock === 'true' || l1Lock === '1',
      l4: l4Lock === 'true' || l4Lock === '1' || l4RegionalLock === 'true' || l4RegionalLock === '1'
    };
  }

  /**
   * Run optimization and generate FIX messages for Day-Ahead market.
   * @param {string} iso - The ISO name (e.g., 'CAISO')
   * @returns {Promise<Object>} Object containing bids and audit metadata
   */
  async generateDayAheadBids(iso) {
    // Verify the Physics & Grid signals: Check for safety locks before bidding
    const locks = await this.getSafetyLockStatus(iso);
    const auditContext = {
      locks,
      timestamp: new Date().toISOString()
    };

    if (locks.l1 || locks.l4) {
      if (locks.l1) {
        const lockContext = await this.redisClient.get('l1:safety:lock:context');
        const details = lockContext ? JSON.parse(lockContext) : null;
        auditContext.l1_details = details;

        console.warn(`🚨 [L4 Market Gateway v3.7.0] Bidding halted: L1 safety lock is active for ${iso}`);
        if (details) {
          console.warn(`[L4 Safety Context] Reason: ${details.event_type}, Severity: ${details.severity}, Score: ${details.physics_score || 'N/A'}, Site: ${details.site_id || 'N/A'}, Region: ${details.iso_region || 'N/A'}, VPPActive: ${details.vpp_active}, V2GActive: ${details.v2g_active}`);

    if (locks.l1 || locks.l4) {
      if (locks.l1) {
        console.warn(`🚨 [L4 Market Gateway v3.7.0] Bidding halted: L1 safety lock is active for ${iso}`);
        if (auditContext) {
          console.warn(`[L4 Safety Context] Reason: ${auditContext.event_type}, Severity: ${auditContext.severity}, Score: ${auditContext.physics_score || 'N/A'}, Region: ${auditContext.iso_region || 'N/A'}`);
        }
      }

      if (locks.l4) {
        const regionalLockActive = await this.redisClient.get(`l4:grid:lock:${iso.toUpperCase().replace(/-/g, '')}`);
        const scope = (regionalLockActive === 'true' || regionalLockActive === '1') ? `Regional (${iso})` : 'Global';
        console.warn(`⚠️ [L4 Market Gateway v3.7.0] Bidding halted: ${scope} L4 grid signal lock is active for ${iso}`);
      }

      return { bids: [], audit: auditContext };
    }

    const forecasts = await this.pricingService.getDayAheadForecast(iso);

    // Fetch capacity and fidelity (Phase 5/6 requirement)
    let pVppKw = new Decimal(0);
    let isHighFidelity = false;

    try {
      await this.connect();
      const regionalCapacityRaw = await this.redisClient.get('vpp:capacity:regional');
      if (regionalCapacityRaw) {
        const regionalCapacity = JSON.parse(regionalCapacityRaw);
        const isoKey = iso.toUpperCase().replace(/-/g, '');
        const data = regionalCapacity[isoKey];
        if (data !== undefined) {
          pVppKw = new Decimal((typeof data === 'object' && data !== null) ? data.capacity : data);
          isHighFidelity = (typeof data === 'object' && data !== null) ? !!data.is_high_fidelity : false;
        } else {
          // Fallback to global capacity
          const globalCapacity = await this.redisClient.get('vpp:capacity:available');
          pVppKw = new Decimal(globalCapacity || '0');
        }
      } else {
        // Fallback to global capacity
        const globalCapacity = await this.redisClient.get('vpp:capacity:available');
        pVppKw = new Decimal(globalCapacity || '0');
      }
    } catch (err) {
      console.error(`[BiddingOptimizer] Failed to parse regional capacity for audit:`, err.message);
      // Fallback to global capacity
      const globalCapacity = await this.redisClient.get('vpp:capacity:available');
      pVppKw = new Decimal(globalCapacity || '0');
    }

    const pVppMw = pVppKw.dividedBy(1000);

    const degradationCostKwh = new Decimal(process.env.DEGRADATION_COST_KWH || '0.02');
    const degradationCostMwh = degradationCostKwh.times(1000); // $20/MWh

    const bids = [];
    let seqNum = 1;

    // Fetch latest physics score for audit
    let currentPhysicsScore = 1.0;
    try {
      const lockContext = await this.redisClient.get('l1:safety:lock:context');
      if (lockContext) {
        const details = JSON.parse(lockContext);
        if (details.physics_score !== undefined) {
          currentPhysicsScore = parseFloat(details.physics_score);
        }
      }
    } catch (err) {}

    for (const forecast of forecasts) {
      const lmpMwh = new Decimal(forecast.price_per_mwh);
      let pBidMw = new Decimal(0);

      // Optimization Invariant: maximize (Pbid * LMP - Cdeg(Pbid))
      if (lmpMwh.gt(degradationCostMwh)) {
        pBidMw = pVppMw;
      }

      const fixMsg = this.formatFixBid(iso, forecast.timestamp, pBidMw, degradationCostMwh, seqNum++);
      bids.push(fixMsg);
    }

    return {
      bids,
      audit: {
        ...auditContext,
        physics_score: currentPhysicsScore,
        capacity_fidelity: isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD',
        pVppKw: pVppKw.toNumber()
      }
    };
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
