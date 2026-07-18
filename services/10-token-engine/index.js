const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const express = require('express');
const helmet = require('helmet');
const Decimal = require('decimal.js');
const redis = require('redis');
const jwt = require('jsonwebtoken');

const app = express();
app.use(helmet());
app.use(express.json());
const port = process.env.PORT || 3010;
const JWT_SECRET = process.env.JWT_SECRET;

const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'token-engine',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

// Redis connection for market price context and regional alarms
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

const consumer = kafka.consumer({ groupId: 'token-engine-group' });

// Thresholds for Dynamic Multipliers (surplus/scarcity) - Configurable via ENV
const LMP_THRESHOLD_SURPLUS = new Decimal(process.env.LMP_THRESHOLD_SURPLUS || '30.0');
const LMP_THRESHOLD_SCARCITY = new Decimal(process.env.LMP_THRESHOLD_SCARCITY || '100.0');

/**
 * Middleware: Verify JWT token (Zero-Trust Security)
 * Hardened to return 500 error if JWT_SECRET is missing.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  if (!JWT_SECRET) {
    console.error('Security Warning: JWT_SECRET is not configured.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

/**
 * Helper: Extract site ID from multi-key payload
 * Standardized for multi-site parity (site_id, siteId, location_id, locationId)
 */
function extractSiteId(payload) {
  if (!payload) return null;
  return payload.site_id || payload.siteId || payload.location_id || payload.locationId || null;
}

/**
 * [L10 v4.3.8] safeFloat: Robust isNaN protection for telemetry scoring
 * Enforces strict 4-decimal string formatting.
 * Default fallback is '0.0000' to uphold "Proof of Physics equals Proof of Value".
 */
function safeFloat(val, fallback = 0.0) {
  const parsed = parseFloat(val);
  const result = isNaN(parsed) ? parseFloat(fallback) : parsed;
  return (isNaN(result) ? 0.0 : result).toFixed(4);
}

// --- Helper Functions for Database Interaction ---

async function getRewardRule(actionType) {
  const res = await pgClient.query(
    'SELECT * FROM token_reward_rules WHERE action_type = $1 AND is_active = TRUE;',
    [actionType]
  );
  return res.rows[0];
}

async function getOrCreateDriverWallet(driverId) {
  let res = await pgClient.query(
    'SELECT dw.*, f.iso FROM driver_wallets dw JOIN drivers d ON dw.driver_id = d.id JOIN fleets f ON d.fleet_id = f.id WHERE dw.driver_id = $1;',
    [driverId]
  );

  if (res.rows.length === 0) {
    const mockOpenWalletAddress = `OW-${driverId.substring(0, 8)}-${Date.now()}`;
    const fleetRes = await pgClient.query(
      'SELECT f.iso FROM drivers d JOIN fleets f ON d.fleet_id = f.id WHERE d.id = $1;',
      [driverId]
    );
    const iso = fleetRes.rows[0]?.iso || 'CAISO';

    res = await pgClient.query(
      'INSERT INTO driver_wallets(driver_id, open_wallet_address) VALUES($1, $2) RETURNING *;',
      [driverId, mockOpenWalletAddress]
    );
    res.rows[0].iso = iso;
  }
  return res.rows[0];
}

async function logRewardTransaction(
  driverId,
  ruleId,
  triggeringEventId,
  sourceValue,
  pointsAwarded,
  status = 'pending',
  iso = 'CAISO',
  physicsScore = null,
  isHighFidelity = false,
  multiplierReason = 'Standard Reward',
  confidenceScore = null,
  resourceType = 'EV',
  isSentinelFidelity = false,
  siteId = null,
  hardwarePenalty = 0,
  regionalAlarmCount = 0
) {
  // L10 v4.3.8: Standardize physics and confidence scores as 4-decimal strings for L11 ML parity using hardened safeFloat
  const physicsScoreFormatted = (physicsScore !== null && physicsScore !== undefined) ? safeFloat(physicsScore) : null;
  const confidenceScoreFormatted = (confidenceScore !== null && confidenceScore !== undefined) ? safeFloat(confidenceScore) : null;

  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status, iso, physics_score, is_high_fidelity, multiplier_reason, confidence_score, resource_type, is_sentinel_fidelity, site_id, hardware_penalty, regional_alarm_count) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status, iso, physicsScoreFormatted, isHighFidelity, multiplierReason, confidenceScoreFormatted, resourceType, isSentinelFidelity, siteId, hardwarePenalty, regionalAlarmCount]
  );
  return res.rows[0];
}

async function updateRewardTransactionStatus(logId, newStatus, openWalletTransactionId = null) {
  await pgClient.query(
    'UPDATE token_reward_log SET status = $1, open_wallet_transaction_id = $2 WHERE log_id = $3;',
    [newStatus, openWalletTransactionId, logId]
  );
}

let isBatchProcessing = false;

/**
 * [L10-P3] Gas-Optimized Batch Minting Worker
 * Processes queued rewards asynchronously to optimize blockchain throughput.
 * v4.3.6: Implements atomic status transition and overlap protection to prevent double-minting.
 */
async function processBatchMint() {
  if (isBatchProcessing) return;
  isBatchProcessing = true;

  try {
    // Atomic state transition: Mark as 'processing' using FOR UPDATE SKIP LOCKED
    // to ensure multi-instance safety.
    const res = await pgClient.query(`
      WITH target_rewards AS (
        SELECT log_id FROM token_reward_log
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      UPDATE token_reward_log
      SET status = 'processing', updated_at = NOW()
      FROM target_rewards
      WHERE token_reward_log.log_id = target_rewards.log_id
      RETURNING token_reward_log.*, (SELECT open_wallet_address FROM driver_wallets WHERE driver_id = token_reward_log.driver_id) as open_wallet_address;
    `);

    if (res.rows.length === 0) {
      isBatchProcessing = false;
      return;
    }

    console.log(`[L10 Batch Worker] Processing ${res.rows.length} rewards...`);

    for (const reward of res.rows) {
      try {
        const openWalletResponse = await axios.post(`${process.env.OPEN_WALLET_API_URL}/transactions`, {
          walletAddress: reward.open_wallet_address,
          amount: parseFloat(reward.points_awarded),
          currency: 'MiGridPoints',
          referenceId: reward.log_id
        });

        await updateRewardTransactionStatus(reward.log_id, 'complete', openWalletResponse.data.transactionId);
        console.log(`✅ [L10 Batch] Reward minted for log ${reward.log_id}: ${reward.points_awarded} points`);
      } catch (err) {
        console.error(`❌ [L10 Batch] Reward failed for log ${reward.log_id}:`, err.message);
        await updateRewardTransactionStatus(reward.log_id, 'failed');
      }
    }
  } catch (error) {
    console.error('[L10 Batch Worker Error]', error.message);
  } finally {
    isBatchProcessing = false;
  }
}

/**
 * Idempotency Helper: Checks if this reward has already been processed using unique DB constraint.
 * Returns the existing log record if found, null otherwise.
 */
async function checkIdempotency(driverId, triggeringEventId, ruleId) {
  const res = await pgClient.query(
    'SELECT * FROM token_reward_log WHERE driver_id = $1 AND triggering_event_id = $2 AND rule_id = $3;',
    [driverId, triggeringEventId, ruleId]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * [L10 v4.3.8] Hardware Health Penalty
 * Reduces reward multipliers by 0.05 per active regional alarm (capped at 0.3).
 * Uses ISO normalization (uppercase, no hyphens) for Redis key lookups.
 * Conforms to both hardware_penalty.test.js and v4_3_8_hardware_penalty.test.js requirements.
 */
async function applyHardwarePenalty(isoRaw, totalMultiplier, multiplierReason) {
  const iso = isoRaw.toUpperCase().replace(/-/g, '');
  const alarmKey = `l4:regional:alarms:${iso}`;
  let alarmCount = 0;

  try {
    const alarmCountStr = await redisClient.get(alarmKey);
    if (alarmCountStr) {
      alarmCount = parseInt(alarmCountStr) || 0;
    }
  } catch (err) {
    console.error(`[L10] Error applying hardware penalty for ${iso}:`, err.message);
  }

  // Ensure totalMultiplier is always treated as a Decimal
  const totalMultDec = new Decimal(totalMultiplier);

  if (alarmCount > 0) {
    const penaltyPerAlarm = new Decimal('0.05');
    const maxPenalty = new Decimal('0.30');
    const penalty = Decimal.min(maxPenalty, new Decimal(alarmCount).times(penaltyPerAlarm));
    const newMultiplier = Decimal.max(0, totalMultDec.minus(penalty));

    const formattedPenalty = penalty.toFixed(2);
    const newReason = `${multiplierReason} - Hardware Health Penalty (-${formattedPenalty})`;

    console.warn(`[L10 Health Audit] Regional Alarms detected for ${iso}: ${alarmCount}. Applying hardware penalty: -${formattedPenalty}`);

    return {
      multiplier: newMultiplier,
      reason: newReason,
      applied: true,
      penalty,
      alarmCount
    };
  }

  return {
    multiplier: totalMultDec,
    reason: multiplierReason,
    applied: false,
    penalty: new Decimal(0),
    alarmCount: 0
  };
}

async function getSiteMultiplier(siteId) {
  if (!siteId) return { multiplier: new Decimal(1.0), reason: 'No Site ID' };
  try {
    const siteMultiplierStr = await redisClient.get(`site:multiplier:${siteId}`);
    if (siteMultiplierStr) {
      const multiplier = new Decimal(siteMultiplierStr);
      console.log(`[L10 Strategy] Site-specific multiplier found for ${siteId}: ${multiplier.toNumber()}x`);
      return { multiplier, reason: `Site Optimization Bonus (${multiplier.toNumber()}x)` };
    }
  } catch (err) {
    console.error(`[L10] Error fetching site multiplier from Redis for ${siteId}:`, err.message);
  }
  return { multiplier: new Decimal(1.0), reason: 'Standard Site Rate' };
}

async function getDynamicMultiplier(isoRaw, actionType, isVppEvent = false) {
  const iso = isoRaw.toUpperCase().replace(/-/g, '');
  let latestPrice = new Decimal(50.0);

  try {
    const profitabilityStr = await redisClient.hGet('market:profitability', iso);
    if (profitabilityStr) {
      latestPrice = new Decimal(profitabilityStr);
    }
  } catch (err) {
    console.error(`[L10] Error fetching market price from Redis for ${iso}:`, err.message);
  }

  const isCharging = actionType === 'session_completed' || actionType === 'green_charging';
  let result = { multiplier: new Decimal(1.0), reason: 'Standard Reward' };

  if (isCharging && latestPrice.lt(LMP_THRESHOLD_SURPLUS)) {
    console.log(`[L10 Strategy] Surplus detected in ${iso} ($${latestPrice}). Applying 1.5x bonus for charging.`);
    result = { multiplier: new Decimal(1.5), reason: 'Grid Surplus Bonus (1.5x)' };
  } else if (actionType === 'v2g_discharge' && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}). Applying 2.0x bonus for grid support.`);
    result = { multiplier: new Decimal(2.0), reason: 'High Scarcity Reward (2.0x)' };
  } else if (isCharging && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    if (isVppEvent) {
      console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}) during VPP event. Applying 2.0x bonus for helpful charging.`);
      result = { multiplier: new Decimal(2.0), reason: 'VPP Scarcity Bonus (2.0x)' };
    } else {
      console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}) without VPP alignment. Applying 0.5x penalty for harmful charging.`);
      result = { multiplier: new Decimal(0.5), reason: 'High Scarcity Surcharge (0.5x)' };
    }
  }

  // L10 v4.3.8: Apply Hardware Health Penalty based on regional DER alarms
  return await applyHardwarePenalty(isoRaw, result.multiplier, result.reason);
}

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    service: 'token-engine',
    version: '4.3.8',
    status: 'healthy',
    layer: 'L10',
    platform: 'v10.1.6'
  });
});

/**
 * [Phase 6 AI Readiness]
 * GET /data/training/rewards
 * Exposes high-fidelity reward data for L11 ML Engine training.
 * Security: Restricted to admin/system tokens (no fleet_id).
 */
app.get('/data/training/rewards', authenticateToken, async (req, res) => {
  const { site_id, limit = 100 } = req.query;

  // Authorization: Only admin/system tokens (without fleet_id) can access global training data
  if (req.user.fleet_id) {
    console.warn(`[Security] Unauthorized global rewards data export attempt by fleet_id: ${req.user.fleet_id}`);
    return res.status(403).json({ error: 'Forbidden: Unauthorized access to global training data.' });
  }

  try {
    let query = 'SELECT * FROM token_reward_log WHERE is_sentinel_fidelity = TRUE';
    const params = [];

    if (site_id) {
      query += ' AND site_id = $1';
      params.push(site_id);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pgClient.query(query, params);
    res.json({
      count: result.rows.length,
      data: result.rows,
      source: 'L10_TOKEN_ENGINE_V4.3.8',
      fidelity_tier: 'SENTINEL'
    });
  } catch (error) {
    console.error('[L10 AI Export Error]', error);
    res.status(500).json({ error: 'Failed to retrieve training data' });
  }
});

// --- Main Application Logic ---

async function start() {
  try {
    await pgClient.connect();
    console.log('✅ [L10 Token Engine] Connected to Ledger.');

    await redisClient.connect();
    console.log('✅ [L10 Token Engine] Connected to Redis.');

    await consumer.connect();
    await consumer.subscribe({ topics: ['driver_actions', 'MARKET_PRICE_UPDATED', 'DER_ALARM_REPORTED'], fromBeginning: true });

    if (require.main === module) {
      app.listen(port, () => {
        console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
      });
      // L10-P3: Start Background Batch Minting Worker (30s interval)
      setInterval(processBatchMint, 30000);
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        let penaltyResult = null;
        try {
          const payload = JSON.parse(message.value.toString());

          // [L10 v4.3.8] Precise interception of high-priority grid and market events
          if (topic === 'MARKET_PRICE_UPDATED') {
            const iso = payload.iso.toUpperCase().replace(/-/g, '');
            const price = payload.profitability_index || payload.price_per_mwh;
            console.log(`[L10 Market Watch] Received price update for ${iso}: $${price}/MWh`);
            await redisClient.hSet('market:profitability', iso, price.toString());
            return; // Explicit return to prevent driver action processing
          }

          if (topic === 'DER_ALARM_REPORTED') {
            const alarmRegion = (payload.iso_region || 'SYSTEM_WIDE').toUpperCase().replace(/-/g, '');
            const alarms = payload.alarms || [];
            console.log(`🚨 [L10 Alarm Tracker] DER Alarm reported from ${payload.chargePointId} in ${alarmRegion}. Count: ${alarms.length}`);

            if (payload.severity === 'CRITICAL' || payload.severity === 'HIGH' || alarms.some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH')) {
              const lockDuration = 1800; // 30 minutes for hardware alarms
              if (alarmRegion !== 'SYSTEM_WIDE') {
                const alarmCountKey = `l4:regional:alarms:${alarmRegion}`;
                const alarmCount = Math.max(1, alarms.length);
                await redisClient.incrBy(alarmCountKey, alarmCount);
                await redisClient.expire(alarmCountKey, lockDuration);
                console.warn(`[L10 Alarm Tracker] Regional Alarm Count incremented for ${alarmRegion}`);
              }
            }
            return; // Explicit return to prevent driver action processing
          }

          // Only process driver_actions topic for rewards
          if (topic !== 'driver_actions') {
            return;
          }

          console.log(`⚡ Received message from ${topic}:`, payload);

          const {
            driver_id,
            action_type,
            source_value,
            event_id,
            iso: payloadIso,
            physics_score,
            physicsScore,
            is_vpp_event,
            isVppEvent,
            is_high_fidelity,
            isHighFidelity,
            is_sentinel_fidelity,
            isSentinelFidelity,
            confidence_score,
            confidenceScore,
            resource_type,
            resourceType
          } = payload;

          const vppAligned = !!(is_vpp_event || isVppEvent);

          // Robust Payload Validation and Standardization (Snake_case & CamelCase support)
          // [L10 v4.3.8] Perform numeric parsing and validation before hardened safeFloat formatting
          let physicsScoreRaw = (physics_score !== undefined) ? physics_score : physicsScore;
          let confidenceScoreRaw = (confidence_score !== undefined) ? confidence_score : confidenceScore;

          let physicsScoreNum = physicsScoreRaw !== undefined ? parseFloat(physicsScoreRaw) : null;
          let confidenceScoreNum = confidenceScoreRaw !== undefined ? parseFloat(confidenceScoreRaw) : null;

          // Enforce 4-decimal string formatting for persistent storage/logs using hardened safeFloat
          const physicsScoreVal = (physicsScoreNum !== null) ? safeFloat(physicsScoreNum) : null;
          const confidenceScoreVal = (confidenceScoreNum !== null) ? safeFloat(confidenceScoreNum) : null;

          const isHighFidelityVal = is_high_fidelity !== undefined ? is_high_fidelity : (isHighFidelity !== undefined ? isHighFidelity : false);
          const isSentinelFidelityVal = is_sentinel_fidelity !== undefined ? is_sentinel_fidelity : (isSentinelFidelity !== undefined ? isSentinelFidelity : false);
          const siteIdVal = extractSiteId(payload);
          const resourceTypeVal = resource_type || resourceType || 'EV';

          // 1. Ensure Driver Wallet Exists (and get address)
          const driverWallet = await getOrCreateDriverWallet(driver_id);
          if (!driverWallet) {
            console.error(`❌ Failed to get or create wallet for driver: ${driver_id}`);
            return;
          }
          const iso = (payloadIso || driverWallet.iso || 'CAISO').toUpperCase().replace(/-/g, '');

          let pointsAwarded = new Decimal(0);
          let rule_id;
          let multiplierReason = 'Standard Reward';

          if (physicsScoreNum !== null && isNaN(physicsScoreNum)) {
            console.warn(`[L10 Audit] Received invalid physics_score for event ${event_id}. Skipping.`);
            return;
          }

          // April 2026 Audit Standard: Explicit high-fidelity flag OR physics OR confidence > 0.95
          const isHighFidelityPersist = (isHighFidelityVal === true || isHighFidelityVal === 'true') ||
                                       (physicsScoreNum !== null && physicsScoreNum > 0.95) ||
                                       (confidenceScoreNum !== null && confidenceScoreNum > 0.95);

          // L10 v4.3.8 Sentinel Fidelity Tier: physics_score > 0.99 or explicit sentinel flag (supports boolean, string 'true', integer 1, and string '1')
          const isSentinelFidelityPersist = (isSentinelFidelityVal === true || isSentinelFidelityVal === 'true' || isSentinelFidelityVal === 1 || isSentinelFidelityVal === '1') ||
                                           (physicsScoreNum !== null && physicsScoreNum > 0.99);

          // Fetch rule early for idempotency check
          const rule = await getRewardRule(action_type);
          const isBehavioral = action_type === 'challenge_completed' || action_type === 'achievement_unlocked' || action_type === 'grid_response' || action_type === 'der_alarm_response' || action_type === 'solar_ramp_response';

          if (!rule && !isBehavioral) {
            console.warn(`⚠️ No active reward rule found for action type: ${action_type}`);
            return;
          }
          rule_id = rule ? rule.rule_id : '00000000-0000-0000-0000-000000000000';

          // 2. Idempotency Check
          const existingReward = await checkIdempotency(driver_id, event_id, rule_id);
          if (existingReward) {
            console.log(`[L10 Idempotency] Reward already exists for ${action_type} (Event: ${event_id}). Status: ${existingReward.status}. Skipping.`);
            return;
          }

          if (isBehavioral) {
            // Fixed-value rewards (points/tokens)
            pointsAwarded = new Decimal(source_value || 0);
            console.log(`[L10] Behavioral ${action_type} by driver ${driver_id}. Awarding ${pointsAwarded.toNumber()} tokens. [Resource: ${resourceTypeVal}]`);
          } else {
            // Proof of Physics Gate: Energy-based rewards must have verified physics
            if (physicsScoreNum !== null) {
              const fidelityStatus = isHighFidelityPersist ? 'HIGH_FIDELITY' : 'STANDARD';

              if (parseFloat(physicsScoreVal) <= 0.0) {
                console.warn(`[L10 Audit] [${fidelityStatus}] Rejected reward for event ${event_id}: Physics Score too low (${physicsScoreVal}). Driver: ${driver_id} [Resource: ${resourceTypeVal}]`);
                return;
              }
            } else {
              console.warn(`[L10 Audit] Rejected energy-based reward for event ${event_id}: Physics Score missing. Driver: ${driver_id} [Resource: ${resourceTypeVal}]`);
              return;
            }

            // 2. Calculate Reward with Dynamic Boosting (Energy-based)
            const marketMultiplier = await getDynamicMultiplier(iso, action_type, vppAligned);
            const siteMultiplier = await getSiteMultiplier(siteIdVal);

            // Compound Multipliers
            let totalMultiplier = marketMultiplier.multiplier.times(siteMultiplier.multiplier);
            multiplierReason = marketMultiplier.multiplier.eq(1.0) ? siteMultiplier.reason : `${marketMultiplier.reason} + ${siteMultiplier.reason}`;

            // [L10 v4.3.8] Hardware Health Penalty
            penaltyResult = await applyHardwarePenalty(iso, totalMultiplier, multiplierReason);
            totalMultiplier = penaltyResult.multiplier;
            multiplierReason = penaltyResult.reason;

            const baseReward = new Decimal(source_value || 0).times(rule.reward_multiplier);
            pointsAwarded = baseReward.times(totalMultiplier).toDecimalPlaces(8);

            console.log(`[L10] Reward calculated: ${pointsAwarded.toNumber()} points (Source: ${source_value}, Rule Mult: ${rule.reward_multiplier}, Total Mult: ${totalMultiplier.toFixed(4)})`);
          }

          if (pointsAwarded.isZero()) {
            console.log(`[L10] Reward is zero for event ${event_id}, skipping.`);
            return;
          }

          // 4. Log the Reward (queued for batch minting)
          await logRewardTransaction(
            driver_id,
            rule_id,
            event_id,
            source_value || 0,
            pointsAwarded.toNumber(),
            'queued',
            iso,
            physicsScoreNum, // logRewardTransaction handles safeFloat internally
            isHighFidelityPersist,
            multiplierReason,
            confidenceScoreNum,
            resourceTypeVal,
            isSentinelFidelityPersist,
            siteIdVal,
            penaltyResult ? penaltyResult.penalty.toNumber() : 0,
            penaltyResult ? penaltyResult.alarmCount : 0
          );

          console.log(`[L10 Reward Queue] Reward of ${pointsAwarded.toNumber()} points for ${action_type} (Event: ${event_id}) added to minting queue.`);
        } catch (error) {
          console.error(`[L10] Error processing Kafka message on topic ${topic}:`, error.message);
        }
      },
    });

  } catch (error) {
    console.error('❌ [L10 Token Engine] Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

process.on('SIGINT', async () => {
  console.log('👋 [L10 Token Engine] Shutting down...');
  await consumer.disconnect();
  await pgClient.end();
  await redisClient.quit();
  process.exit(0);
});

module.exports = { app, getDynamicMultiplier, getSiteMultiplier, applyHardwarePenalty, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY, redisClient };