const { createClient } = require('redis');
const { convertToFIX, getCurrentUTCTimeStamp } = require('fix-protocol/fixutils');
const MarketPricingService = require('./MarketPricingService');
const Decimal = require('decimal.js');

/**
 * [L4 v3.8.7] safeFloat: Robust isNaN protection for telemetry scoring
 */
const safeFloat = (val, fallback = 1.0) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback.toFixed(4) : parsed.toFixed(4);
};

/**
 * [L4 v3.8.7] isSentinel: Hardened sentinel fidelity detection
 */
const isSentinel = (flag, score) => {
  const isExplicit = flag === true || flag === 'true' || flag === 1;
  return isExplicit || parseFloat(score) > 0.99;
};

class BiddingOptimizer {
  constructor(pool, redisUrl, localCache = null) {
    this.pricingService = new MarketPricingService(pool);
    this.redisClient = createClient({ url: redisUrl });
    this.redisClient.on('error', (err) => console.error('Redis Client Error', err));
    this.isRedisConnected = false;
    this.localCache = localCache;
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
   * Supports regional aggregation and high-fidelity breakdowns (Phase 5/6 Forward Engineering).
   * @param {string} iso - Optional ISO for regional capacity lookup
   * @returns {Promise<Object>} { capacity: Decimal, fidelity: string, breakdown: { ev: number, bess: number }, physics_score: string, confidence_score: string }
   */
  async getAggregatedCapacity(iso = null) {
    await this.connect();

    if (iso) {
      try {
        // [L3 v3.3.0 Upgrade] Prioritize high-fidelity regional breakdown
        const hfKey = 'vpp:capacity:regional:high_fidelity';
        const legacyKey = 'vpp:capacity:regional';

        const [hfRaw, legacyRaw] = await Promise.all([
          this.redisClient.get(hfKey),
          this.redisClient.get(legacyKey)
        ]);

        const isoKey = iso.toUpperCase().replace(/-/g, '');

        // 1. Attempt high-fidelity lookup
        if (hfRaw) {
          const hfData = JSON.parse(hfRaw);
          const data = hfData[isoKey];

          if (data && typeof data === 'object') {
            const fidelity = data.is_high_fidelity ? 'HIGH_FIDELITY' : 'STANDARD';
            console.log(`[BiddingOptimizer] Using HIGH-FIDELITY regional capacity for ${isoKey}: ${data.total} kWh (EV: ${data.ev}, BESS: ${data.bess})`);

            const pScore = safeFloat(data.physics_score, 1.0);
            const cScore = safeFloat(data.confidence_score, 1.0);

            return {
              capacity: new Decimal(data.total || '0'),
              fidelity: fidelity,
              breakdown: {
                ev: data.ev || 0,
                bess: data.bess || 0
              },
              physics_score: pScore,
              confidence_score: cScore
            };
          }
        }

        // 2. Fallback to legacy regional lookup
        if (legacyRaw) {
          const legacyData = JSON.parse(legacyRaw);
          const data = legacyData[isoKey];

          if (data !== undefined) {
            const isObject = (typeof data === 'object' && data !== null);
            const capacityValue = isObject ? data.capacity : data;
            const isHighFidelity = isObject ? !!data.is_high_fidelity : false;
            const fidelity = isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD';

            console.log(`[BiddingOptimizer] Using legacy regional capacity for ${isoKey}: ${capacityValue} kWh`);
            return {
              capacity: new Decimal(capacityValue || '0'),
              fidelity: fidelity,
              breakdown: { ev: capacityValue || 0, bess: 0 } // Assume EV if breakdown missing
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
      fidelity: 'STANDARD',
      breakdown: { ev: parseFloat(capacity || '0'), bess: 0 },
      physics_score: "1.0000",
      confidence_score: "1.0000"
    };
  }

  /**
   * Checks if any safety lock (L1 Physics or L4 Grid) is active.
   * [L4-133] Optimized: Uses localCache if available for zero-latency checks.
   * @param {string} iso - The ISO name
   * @param {string} siteId - Optional site ID for granular safety enforcement
   * @returns {Promise<Object>} Status of safety locks
   */
  async getSafetyLockStatus(iso = null, siteId = null) {
    if (this.localCache && this.localCache.last_updated) {
      let l4Regional = false;
      let l1SiteLock = false;

      if (iso) {
        const isoKey = iso.toUpperCase().replace(/-/g, '');
        l4Regional = !!this.localCache.l4_regional[isoKey];
      }

      if (siteId) {
        l1SiteLock = !!this.localCache.site_safety?.[siteId];
      }

      return {
        l1: this.localCache.l1_physics || l1SiteLock,
        l4: this.localCache.l4_grid || l4Regional
      };
    }

    await this.connect();
    const l1Lock = await this.redisClient.get('l1:safety:lock');
    const l4Lock = await this.redisClient.get('l4:grid:lock');
    let l4RegionalLock = 'false';
    let l1SiteLock = 'false';

    if (iso) {
      const isoKey = iso.toUpperCase().replace(/-/g, '');
      l4RegionalLock = await this.redisClient.get(`l4:grid:lock:${isoKey}`);
    }

    if (siteId) {
      l1SiteLock = await this.redisClient.get(`l1:safety:lock:site:${siteId}`);
    }

    return {
      l1: l1Lock === 'true' || l1Lock === '1' || l1SiteLock === 'true' || l1SiteLock === '1',
      l4: l4Lock === 'true' || l4Lock === '1' || l4RegionalLock === 'true' || l4RegionalLock === '1'
    };
  }

  /**
   * Run optimization and generate FIX messages for Day-Ahead market.
   * Returns a structured object with bids and audit metadata for L11 ML Engine.
   * @param {string} iso - The ISO name (e.g., 'CAISO')
   * @param {string} siteId - Optional site ID for granular auditing
   * @returns {Promise<Object>} Object containing bids and audit metadata
   */
  async generateDayAheadBids(iso, siteId = null) {
    await this.connect();
    const isoKey = iso.toUpperCase().replace(/-/g, '');

    // [L4 v3.8.9] Hardware Health Penalty: Fetch regional alarm count using Decimal.js
    const alarmCountRaw = await this.redisClient.get(`l4:regional:alarms:${isoKey}`);
    const regionalAlarmCount = new Decimal(alarmCountRaw || '0');
    const hardwarePenalty = Decimal.min('0.30', regionalAlarmCount.times('0.05'));

    // 1. Verify the Physics & Grid signals: Check for safety locks before bidding
    const locks = await this.getSafetyLockStatus(iso, siteId);

    // 2. Fetch safety lock context for audit (L11 ML Engine readiness)
    // [L4-133] Optimized: Use localCache for zero-latency audit metadata
    let physicsScore = this.localCache?.physics_score || "1.0000";
    let confidenceScore = this.localCache?.confidence_score || "1.0000";
    let isSentinelFidelity = !!this.localCache?.is_sentinel_fidelity;
    let auditContext = null;

    if (this.localCache && this.localCache.regional_confidence?.[isoKey]) {
      confidenceScore = safeFloat(this.localCache.regional_confidence[isoKey], 1.0);
    }

    if (!this.localCache || !this.localCache.last_updated) {
      try {
        const [lockContextRaw, unifiedRaw] = await Promise.all([
          this.redisClient.get('l1:safety:lock:context'),
          this.redisClient.get('l2:unified:context')
        ]);

        if (lockContextRaw) {
          auditContext = JSON.parse(lockContextRaw);
          physicsScore = safeFloat(auditContext.physics_score);
          confidenceScore = safeFloat(auditContext.confidence_score);
          isSentinelFidelity = isSentinel(auditContext.is_sentinel_fidelity, physicsScore);
        } else if (unifiedRaw) {
          const unified = JSON.parse(unifiedRaw);
          confidenceScore = unified.regional_confidence?.[isoKey] || unified.confidence_score || 1.0;
          console.log(`[BiddingOptimizer] Using L2 regional confidence fallback for ${isoKey}: ${confidenceScore}`);
        }
      } catch (err) {
        console.warn('[BiddingOptimizer] Failed to fetch safety lock context from Redis:', err.message);
      }
    }

    // 4. Fetch Capacity Data (Moved up for audit consistency and high-fidelity synchronization)
    const {
      capacity: pVppKw,
      fidelity: capacityFidelityFromRedis,
      breakdown,
      physics_score: pScoreFromL3,
      confidence_score: cScoreFromL3
    } = await this.getAggregatedCapacity(iso);
    const pVppMw = pVppKw.dividedBy(1000);

    // [L4 v3.8.6] Synchronize scores with L3 High-Fidelity context if available
    if (capacityFidelityFromRedis === 'HIGH_FIDELITY') {
      physicsScore = pScoreFromL3;
      confidenceScore = cScoreFromL3;
    }

    // [L4 v3.8.9] Apply Hardware Health Penalty to confidence score using Decimal.js
    let adjustedConfidenceScore = Decimal.max('0', new Decimal(confidenceScore).minus(hardwarePenalty)).toFixed(4);

    // High-Fidelity logic: physics_score > 0.95 OR confidence_score > 0.95 (Align with L10 v4.3.5)
    const isHighFidelity = (parseFloat(physicsScore) > 0.95 || parseFloat(adjustedConfidenceScore) > 0.95);
    // [L4 v3.8.5] Standardized Sentinel logic with fallback
    isSentinelFidelity = isSentinel(isSentinelFidelity, physicsScore);
    const capacityFidelity = isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD';

    // 3. Handle Halted Bidding
    if (locks.l1 || locks.l4) {
      if (locks.l1) {
        console.warn(`🚨 [L4 Market Gateway v3.8.9] Bidding halted: L1 safety lock is active for ${iso}`);
        if (auditContext) {
          console.warn(`[L4 Safety Context] Reason: ${auditContext.event_type}, Severity: ${auditContext.severity}, Score: ${auditContext.physics_score || 'N/A'}, Confidence: ${auditContext.confidence_score || 'N/A'}, Region: ${auditContext.iso_region || 'N/A'}`);
        }
      }

      if (locks.l4) {
        const regionalLockActive = await this.redisClient.get(`l4:grid:lock:${iso.toUpperCase().replace(/-/g, '')}`);
        const scope = (regionalLockActive === 'true' || regionalLockActive === '1') ? `Regional (${iso})` : 'Global';
        console.warn(`⚠️ [L4 Market Gateway v3.8.9] Bidding halted: ${scope} L4 grid signal lock is active for ${iso}`);
      }

      return {
        bids: [],
        audit: {
          locks,
          physics_score: physicsScore,
          confidence_score: adjustedConfidenceScore,
          is_high_fidelity: isHighFidelity,
          is_sentinel_fidelity: isSentinelFidelity,
          capacity_fidelity: capacityFidelity,
          hardware_penalty: hardwarePenalty.toFixed(4),
          regional_alarm_count: regionalAlarmCount.toNumber(),
          audit_context: {
            ...auditContext,
            ev_capacity_kw: breakdown.ev,
            bess_capacity_kw: breakdown.bess,
            v3_capacity_fidelity: capacityFidelityFromRedis === 'HIGH_FIDELITY',
            is_sentinel_fidelity: isSentinelFidelity,
            hardware_penalty: hardwarePenalty.toFixed(4),
            regional_alarm_count: regionalAlarmCount.toNumber()
          },
          timestamp: new Date().toISOString()
        }
      };
    }

    // [L4-BESS-OPT] Resource-Aware Degradation Costs
    const evDegradationKwh = new Decimal(process.env.DEGRADATION_COST_KWH || '0.02');
    const bessDegradationKwh = new Decimal(process.env.BESS_DEGRADATION_COST_KWH || '0.01');

    // Calculate weighted degradation cost based on resource breakdown
    let weightedDegradationKwh = evDegradationKwh;
    if (pVppKw.gt(0)) {
      const evWeight = new Decimal(breakdown.ev).dividedBy(pVppKw);
      const bessWeight = new Decimal(breakdown.bess).dividedBy(pVppKw);
      weightedDegradationKwh = evDegradationKwh.times(evWeight).plus(bessDegradationKwh.times(bessWeight));
    }
    const degradationCostMwh = weightedDegradationKwh.times(1000);

    // 5. Generate Bids
    // 5. Fetch Additional Smart Data (Fuel Mix and Load Forecast)
    const fuelMix = await this.pricingService.getLatestFuelMix(iso);
    let renewablePct = 0;
    if (fuelMix.length > 0) {
      let totalGen = new Decimal(0);
      let renewableGen = new Decimal(0);
      for (const record of fuelMix) {
        const gen = new Decimal(record.gen_mw);
        totalGen = totalGen.plus(gen);
        if (['solar', 'wind', 'hydro', 'geothermal', 'biomass'].includes(record.fuel_type)) {
          renewableGen = renewableGen.plus(gen);
        }
      }
      renewablePct = totalGen.gt(0) ? renewableGen.dividedBy(totalGen).toNumber() : 0;
    }

    const forecasts = await this.pricingService.getDayAheadForecast(iso);
    const bids = [];
    let seqNum = 1;

    // Pre-calculate DART spread analysis per unique location to avoid N+1 queries
    const uniqueLocations = [...new Set(forecasts.map(f => f.location))];
    const dartAnalysisMap = {};
    for (const loc of uniqueLocations) {
      dartAnalysisMap[loc] = await this.pricingService.getDARTSpreadAnalysis(iso, loc);
    }

    // 6. Generate Bids with Carbon-Aware and DA/RT Arbitrage Logic
    for (const forecast of forecasts) {
      const lmpMwh = new Decimal(forecast.price_per_mwh);
      let pBidMw = new Decimal(0);

      // SMARTER LOGIC:
      // A) Carbon-Aware: If renewablePct is high (> 60%), we prefer to hold capacity for charging
      // (charging happens when LMP is low, but we might also avoid discharging to keep "green" electrons)
      const greenThreshold = parseFloat(process.env.CARBON_GREEN_THRESHOLD || '0.6');
      const isGreenHour = renewablePct > greenThreshold;

      // B) DA vs RT Spread: Simple heuristic - if volatility is high, we hold 30% of capacity for RT spikes
      const volatilityThreshold = parseFloat(process.env.RT_VOLATILITY_THRESHOLD || '20');
      const rtReservePct = parseFloat(process.env.RT_RESERVE_PERCENTAGE || '0.3');

      const analysis = dartAnalysisMap[forecast.location];
      const isVolatile = analysis && parseFloat(analysis.volatility) > volatilityThreshold;
      const capacityMultiplier = isVolatile ? (1 - rtReservePct) : 1.0;

      // Optimization Invariant: maximize (Pbid * LMP - Cdeg(Pbid))
      if (lmpMwh.gt(degradationCostMwh)) {
        // If it's a green hour, we might require a higher price to discharge (preserving green credentials)
        const greenPremiumValue = parseFloat(process.env.CARBON_GREEN_PREMIUM || '10');
        const greenPremium = isGreenHour ? new Decimal(greenPremiumValue) : new Decimal(0);

        if (lmpMwh.gt(degradationCostMwh.plus(greenPremium))) {
          pBidMw = pVppMw.times(capacityMultiplier);
        }
      }

      const fixMsg = this.formatFixBid(iso, forecast.timestamp, pBidMw, degradationCostMwh, seqNum++);
      bids.push(fixMsg);
    }

    return {
      bids,
      audit: {
        locks,
        physics_score: physicsScore,
        confidence_score: adjustedConfidenceScore,
        is_high_fidelity: isHighFidelity,
        is_sentinel_fidelity: isSentinelFidelity,
        capacity_fidelity: capacityFidelityFromRedis, // Already normalized in getAggregatedCapacity
        hardware_penalty: hardwarePenalty.toFixed(4),
        regional_alarm_count: regionalAlarmCount.toNumber(),
        audit_context: {
          ...auditContext,
          ev_capacity_kw: breakdown.ev,
          bess_capacity_kw: breakdown.bess,
          v3_capacity_fidelity: capacityFidelityFromRedis === 'HIGH_FIDELITY',
          is_sentinel_fidelity: isSentinelFidelity,
          hardware_penalty: hardwarePenalty.toFixed(4),
          regional_alarm_count: regionalAlarmCount.toNumber(),
          site_aware_sync: true // L1 v10.1.3 requirement
        },
        pVppKw: pVppKw.toNumber(),
        timestamp: new Date().toISOString()
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
