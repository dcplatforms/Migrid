const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const express = require('express');
const Decimal = require('decimal.js');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 3010;

const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'token-engine',
  brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092').split(',')
});

// Redis client for market context
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

const consumer = kafka.consumer({ groupId: 'token-engine-group' });

// Thresholds for Dynamic Multipliers (surplus/scarcity) - Configurable via ENV
const LMP_THRESHOLD_SURPLUS = new Decimal(process.env.LMP_THRESHOLD_SURPLUS || '30.0');
const LMP_THRESHOLD_SCARCITY = new Decimal(process.env.LMP_THRESHOLD_SCARCITY || '100.0');

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

async function logRewardTransaction(driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status = 'pending', iso = 'CAISO', physicsScore = null, isHighFidelity = null, multiplierReason = 'Standard') {
  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status, iso, physics_score, is_high_fidelity, multiplier_reason) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status, iso, physicsScore, isHighFidelity, multiplierReason]
  );
  return res.rows[0];
}

async function updateRewardTransactionStatus(logId, newStatus, openWalletTransactionId = null) {
  await pgClient.query(
    'UPDATE token_reward_log SET status = $1, open_wallet_transaction_id = $2 WHERE log_id = $3;',
    [newStatus, openWalletTransactionId, logId]
  );
}

/**
 * Idempotency Helper: Checks if this reward has already been processed using unique DB constraint.
 * This prevents double-minting tokens if Kafka delivers the same message twice.
 */
async function checkIdempotency(driverId, triggeringEventId, ruleId) {
  const res = await pgClient.query(
    'SELECT log_id FROM token_reward_log WHERE driver_id = $1 AND triggering_event_id = $2 AND rule_id = $3;',
    [driverId, triggeringEventId, ruleId]
  );
  return res.rows.length > 0;
}

// --- Reward Multiplier Logic ---

/**
 * Asynchronous Reward Multiplier Logic (v4.3.0)
 * Uses Redis (L6 context) to calculate dynamic multipliers and penalties.
 */
async function getDynamicMultiplier(isoRaw, actionType) {
  const iso = isoRaw.toUpperCase().replace(/-/g, '');
  let profitability = 50.0; // Default context

  try {
    const profitStr = await redisClient.hGet('market:profitability', iso);
    if (profitStr) profitability = parseFloat(profitStr);
  } catch (err) {
    console.warn(`[L10 Multiplier] Redis lookup failed for ${iso}, using default.`);
  }

  const latestPrice = new Decimal(profitability);

  // 1. Surplus Bonus (LMP < $30)
  if (latestPrice.lt(LMP_THRESHOLD_SURPLUS)) {
    if (actionType === 'session_completed' || actionType === 'green_charging') {
      return { multiplier: new Decimal(1.5), reason: 'Grid Surplus Bonus (1.5x)' };
    }
  }

  // 2. Scarcity Logic (LMP > $100)
  if (latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    if (actionType === 'v2g_discharge') {
      return { multiplier: new Decimal(2.0), reason: 'V2G Scarcity Bonus (2.0x)' };
    }
    if (actionType === 'session_completed' || actionType === 'green_charging') {
      // Penalty for charging during scarcity unless it's a VPP event
      return { multiplier: new Decimal(0.5), reason: 'High Scarcity Surcharge (0.5x)' };
    }
  }

  return { multiplier: new Decimal(1.0), reason: 'Standard' };
}

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    service: 'token-engine',
    version: '4.3.0',
    status: 'healthy',
    layer: 'L10'
  });
});

// --- Main Application Logic ---

async function start() {
  try {
    await pgClient.connect();
    console.log('✅ [L10 Token Engine] Connected to Ledger.');

    await redisClient.connect();
    console.log('✅ [L10 Token Engine] Connected to Redis context.');

    await consumer.connect();
    await consumer.subscribe({ topics: ['driver_actions', 'MARKET_PRICE_UPDATED'], fromBeginning: true });

    if (require.main === module) {
      app.listen(port, () => {
        console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
      });
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const payload = JSON.parse(message.value.toString());

        // MARKET_PRICE_UPDATED is handled by L2 -> L6 (Redis), L10 now consumes from Redis for consistency
        if (topic === 'MARKET_PRICE_UPDATED') return;

        console.log(`⚡ [L10] Processing message from ${topic}:`, payload);

        const { driver_id, action_type, source_value, event_id, iso: payloadIso, physics_score, is_high_fidelity } = payload;

        // 1. Get Wallet and ISO Context
        const driverWallet = await getOrCreateDriverWallet(driver_id);
        if (!driverWallet) return;
        const iso = (payloadIso || driverWallet.iso || 'CAISO').toUpperCase().replace(/-/g, '');

        let pointsAwarded = new Decimal(0);
        let rule_id;
        let multiplierReason = 'Standard';

        // 2. Load Reward Rule
        const rule = await getRewardRule(action_type);
        if (!rule && action_type !== 'challenge_completed' && action_type !== 'achievement_unlocked') {
          console.warn(`⚠️ No active reward rule found for: ${action_type}`);
          return;
        }
        rule_id = rule ? rule.rule_id : '00000000-0000-0000-0000-000000000000';

        // 3. Check Idempotency (v4.3.0)
        if (await checkIdempotency(driver_id, event_id, rule_id)) {
          console.log(`[L10 Idempotency] Reward already processed for event ${event_id}, skipping.`);
          return;
        }

        // 4. Calculate Points with Audit Gate
        if (action_type === 'challenge_completed' || action_type === 'achievement_unlocked') {
          pointsAwarded = new Decimal(source_value || 0);
          multiplierReason = 'Behavioral Achievement';
        } else {
          // Proof of Physics Gate
          if (physics_score === undefined || physics_score === null) {
            console.warn(`[L10 Audit] Rejected reward for ${event_id}: Physics Score missing.`);
            return;
          }
          if (parseFloat(physics_score) <= 0.0) {
            console.warn(`[L10 Audit] Rejected reward for ${event_id}: Low Physics Score (${physics_score}).`);
            return;
          }

          const dynamicResult = await getDynamicMultiplier(iso, action_type);
          multiplierReason = dynamicResult.reason;
          const baseReward = new Decimal(source_value || 0).times(rule.reward_multiplier);
          pointsAwarded = baseReward.times(dynamicResult.multiplier).toDecimalPlaces(8);
        }

        if (pointsAwarded.isZero()) return;

        // 5. Log and Audit the Reward
        const rewardLog = await logRewardTransaction(
          driver_id,
          rule_id,
          event_id,
          source_value || 0,
          pointsAwarded.toNumber(),
          'pending',
          iso,
          physics_score,
          is_high_fidelity,
          multiplierReason
        );

        // 6. Execute Blockchain/Wallet Transaction
        try {
          const openWalletResponse = await axios.post(`${process.env.OPEN_WALLET_API_URL}/transactions`, {
            walletAddress: driverWallet.open_wallet_address,
            amount: pointsAwarded.toNumber(),
            currency: 'MiGridPoints',
            referenceId: rewardLog.log_id
          });
          await updateRewardTransactionStatus(rewardLog.log_id, 'complete', openWalletResponse.data.transactionId);
          console.log(`✅ [L10] Reward minted: ${pointsAwarded.toNumber()} points (${multiplierReason})`);
        } catch (error) {
          console.error(`❌ [L10] Reward failed for log ${rewardLog.log_id}:`, error.message);
          await updateRewardTransactionStatus(rewardLog.log_id, 'failed');
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

module.exports = {
  app,
  start,
  getDynamicMultiplier,
  redisClient,
  LMP_THRESHOLD_SURPLUS,
  LMP_THRESHOLD_SCARCITY
};
