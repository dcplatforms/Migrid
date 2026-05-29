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

const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'token-engine',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

// Redis connection for market price context (Sync with L6)
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

const consumer = kafka.consumer({ groupId: 'token-engine-group' });

const JWT_SECRET = process.env.JWT_SECRET;
// Security Directive: No hardcoded fallback for JWT_SECRET in production.
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is missing.');
  process.exit(1);
}

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

async function logRewardTransaction(driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status = 'queued', iso = 'CAISO', physicsScore = null, isHighFidelity = false, multiplierReason = 'Standard Reward', confidenceScore = null, resourceType = 'EV', isSentinelFidelity = false, siteId = null) {
  // April 2026 Audit Standard: Strict 4-decimal formatting for physics/confidence scores
  const physicsScoreFormatted = (physicsScore !== null && !isNaN(physicsScore)) ? parseFloat(physicsScore).toFixed(4) : null;
  const confidenceScoreFormatted = (confidenceScore !== null && !isNaN(confidenceScore)) ? parseFloat(confidenceScore).toFixed(4) : null;

  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status, iso, physics_score, is_high_fidelity, multiplier_reason, confidence_score, resource_type, is_sentinel_fidelity, site_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status, iso, physicsScoreFormatted, isHighFidelity, multiplierReason, confidenceScoreFormatted, resourceType, isSentinelFidelity, siteId]
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

// --- Reward Multiplier Logic ---

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

  if (isCharging && latestPrice.lt(LMP_THRESHOLD_SURPLUS)) {
    console.log(`[L10 Strategy] Surplus detected in ${iso} ($${latestPrice}). Applying 1.5x bonus for charging.`);
    return { multiplier: new Decimal(1.5), reason: 'Grid Surplus Bonus (1.5x)' };
  } else if (actionType === 'v2g_discharge' && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}). Applying 2.0x bonus for grid support.`);
    return { multiplier: new Decimal(2.0), reason: 'High Scarcity Reward (2.0x)' };
  } else if (isCharging && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    if (isVppEvent) {
      console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}) during VPP event. Applying 2.0x bonus for helpful charging.`);
      return { multiplier: new Decimal(2.0), reason: 'VPP Scarcity Bonus (2.0x)' };
    } else {
      console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}) without VPP alignment. Applying 0.5x penalty for harmful charging.`);
      return { multiplier: new Decimal(0.5), reason: 'High Scarcity Surcharge (0.5x)' };
    }
  }

  return { multiplier: new Decimal(1.0), reason: 'Standard Reward' };
}

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    service: 'token-engine',
    version: '4.3.6',
    status: 'healthy',
    layer: 'L10'
  });
});

/**
 * [Phase 6 AI Readiness]
 * GET /data/training/rewards
 * Exposes high-fidelity reward data for L11 ML Engine training.
 * Security: Restricts global access to system/admin tokens (no fleet_id).
 */
app.get('/data/training/rewards', authenticateToken, async (req, res) => {
  // Security check: Reject requests with fleet_id to restrict to admin/system tokens
  if (req.user && req.user.fleet_id) {
    console.warn(`[Security] Unauthorized global rewards data export attempt by fleet_id: ${req.user.fleet_id}`);
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Global reward data export restricted to system tokens' });
  }

  const { site_id, limit = 100 } = req.query;
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
      source: 'L10_TOKEN_ENGINE_V4.3.6',
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
    await consumer.subscribe({ topics: ['driver_actions', 'MARKET_PRICE_UPDATED'], fromBeginning: true });

    if (require.main === module) {
      app.listen(port, () => {
        console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
      });
      // Start the Reward Batching Worker (L10-P3)
      setInterval(processBatchMint, 10000); // Process every 10 seconds
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());

          if (topic === 'MARKET_PRICE_UPDATED') {
            const iso = payload.iso.toUpperCase().replace(/-/g, '');
            const price = payload.profitability_index || payload.price_per_mwh;
            console.log(`[L10 Market Watch] Received price update for ${iso}: $${price}/MWh`);
            await redisClient.hSet('market:profitability', iso, price.toString());
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
            resourceType,
            site_id,
            siteId,
            location_id,
            locationId
          } = payload;

          const vppAligned = !!(is_vpp_event || isVppEvent);

          // Robust Payload Validation and Standardization (Snake_case & CamelCase support)
          let physicsScoreVal = physics_score !== undefined ? parseFloat(physics_score) : (physicsScore !== undefined ? parseFloat(physicsScore) : null);
          if (physicsScoreVal !== null && isNaN(physicsScoreVal)) physicsScoreVal = null;

          let confidenceScoreVal = confidence_score !== undefined ? parseFloat(confidence_score) : (confidenceScore !== undefined ? parseFloat(confidenceScore) : null);
          if (confidenceScoreVal !== null && isNaN(confidenceScoreVal)) confidenceScoreVal = null;

          const isHighFidelityVal = is_high_fidelity !== undefined ? is_high_fidelity : (isHighFidelity !== undefined ? isHighFidelity : false);
          const isSentinelFidelityVal = is_sentinel_fidelity !== undefined ? is_sentinel_fidelity : (isSentinelFidelity !== undefined ? isSentinelFidelity : false);
          const siteIdVal = site_id || siteId || location_id || locationId || null;
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

          // Robust payload validation and parsing
          let physicsScorePersist = (physicsScoreVal !== undefined && physicsScoreVal !== null) ? parseFloat(physicsScoreVal) : null;
          let confidenceScorePersist = (confidenceScoreVal !== undefined && confidenceScoreVal !== null) ? parseFloat(confidenceScoreVal) : null;

          if (physicsScoreVal !== undefined && isNaN(physicsScorePersist)) {
            console.warn(`[L10 Audit] Received NaN physics_score for event ${event_id}. Skipping.`);
            return;
          }

          // April 2026 Audit Standard: Explicit high-fidelity flag OR physics OR confidence > 0.95
          let isHighFidelityPersist = (isHighFidelityVal === true || isHighFidelityVal === 'true') ||
                                       (physicsScorePersist !== null && physicsScorePersist > 0.95) ||
                                       (confidenceScorePersist !== null && confidenceScorePersist > 0.95);

          // L10 v4.3.6 Sentinel Fidelity Tier: physics_score > 0.99 or explicit sentinel flag (supports boolean, string 'true', and integer 1)
          let isSentinelFidelityPersist = (isSentinelFidelityVal === true || isSentinelFidelityVal === 'true' || isSentinelFidelityVal === 1) ||
                                           (physicsScorePersist !== null && physicsScorePersist > 0.99);

          // Fetch rule early for idempotency check
          const rule = await getRewardRule(action_type);
          const isBehavioral = action_type === 'challenge_completed' || action_type === 'achievement_unlocked' || action_type === 'grid_response';

          if (!rule && !isBehavioral) {
            console.warn(`⚠️ No active reward rule found for action type: ${action_type}`);
            return;
          }
          rule_id = rule ? rule.rule_id : '00000000-0000-0000-0000-000000000000';

          // 2. Idempotency Check (Fixed parameter order: driver_id, event_id, rule_id)
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
            if (physicsScorePersist !== null) {
              const fidelityStatus = isHighFidelityPersist ? 'HIGH_FIDELITY' : 'STANDARD';

              if (physicsScorePersist <= 0.0) {
                console.warn(`[L10 Audit] [${fidelityStatus}] Rejected reward for event ${event_id}: Physics Score too low (${physicsScorePersist}). Driver: ${driver_id} [Resource: ${resourceTypeVal}]`);
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
            const totalMultiplier = marketMultiplier.multiplier.times(siteMultiplier.multiplier);
            multiplierReason = marketMultiplier.multiplier.eq(1.0) ? siteMultiplier.reason : `${marketMultiplier.reason} + ${siteMultiplier.reason}`;

            const baseReward = new Decimal(source_value || 0).times(rule.reward_multiplier);
            pointsAwarded = baseReward.times(totalMultiplier).toDecimalPlaces(8);

            console.log(`[L10] Reward calculated: ${pointsAwarded.toNumber()} points (Source: ${source_value}, Rule Mult: ${rule.reward_multiplier}, Total Mult: ${totalMultiplier.toNumber()})`);
          }

          if (pointsAwarded.isZero()) {
            console.log(`[L10] Reward is zero for event ${event_id}, skipping.`);
            return;
          }

          // 4. Log the Reward (queued for batch processing)
          await logRewardTransaction(
            driver_id,
            rule_id,
            event_id,
            source_value || 0,
            pointsAwarded.toNumber(),
            'queued',
            iso,
            physicsScorePersist,
            isHighFidelityPersist,
            multiplierReason,
            confidenceScorePersist,
            resourceTypeVal,
            isSentinelFidelityPersist,
            siteIdVal
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

module.exports = { app, getDynamicMultiplier, getSiteMultiplier, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY, redisClient };
