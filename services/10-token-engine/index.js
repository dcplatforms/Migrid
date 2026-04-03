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
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

// Redis connection for market price context (Sync with L6)
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

async function logRewardTransaction(driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status = 'pending', iso = 'CAISO', isHighFidelity = true) {
  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status, iso, is_high_fidelity) VALUES($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status, iso, isHighFidelity]
  );
  return res.rows[0];
}

async function updateRewardTransactionStatus(logId, newStatus, openWalletTransactionId = null) {
  await pgClient.query(
    'UPDATE token_reward_log SET status = $1, open_wallet_transaction_id = $2 WHERE log_id = $3;',
    [newStatus, openWalletTransactionId, logId]
  );
}

// --- Reward Multiplier Logic ---

async function getDynamicMultiplier(isoRaw, actionType) {
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

  if (actionType === 'session_completed' && latestPrice.lt(LMP_THRESHOLD_SURPLUS)) {
    console.log(`[L10 Strategy] Surplus detected in ${iso} ($${latestPrice}). Applying 1.5x bonus for charging.`);
    return new Decimal(1.5);
  } else if (actionType === 'v2g_discharge' && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    console.log(`[L10 Strategy] Scarcity detected in ${iso} ($${latestPrice}). Applying 2.0x bonus for grid support.`);
    return new Decimal(2.0);
  }

  return new Decimal(1.0);
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
    console.log('✅ [L10 Token Engine] Connected to Redis.');

    await consumer.connect();
    await consumer.subscribe({ topics: ['driver_actions', 'MARKET_PRICE_UPDATED'], fromBeginning: true });

    if (require.main === module) {
      app.listen(port, () => {
        console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
      });
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

          const { driver_id, action_type, source_value, event_id, iso: payloadIso, physics_score, is_high_fidelity } = payload;

          // 1. Ensure Driver Wallet Exists (and get address)
          const driverWallet = await getOrCreateDriverWallet(driver_id);
          if (!driverWallet) {
            console.error(`❌ Failed to get or create wallet for driver: ${driver_id}`);
            return;
          }
          const iso = (payloadIso || driverWallet.iso || 'CAISO').toUpperCase().replace(/-/g, '');

          let pointsAwarded = new Decimal(0);
          let rule_id;
          let isHighFidelity = is_high_fidelity !== undefined ? !!is_high_fidelity : true;

          if (action_type === 'challenge_completed' || action_type === 'achievement_unlocked') {
            // Fixed-value rewards (points/tokens)
            pointsAwarded = new Decimal(source_value || 0);

            const rule = await getRewardRule(action_type);
            rule_id = rule ? rule.rule_id : '00000000-0000-0000-0000-000000000000';

            console.log(`[L10] ${action_type} by driver ${driver_id}. Awarding ${pointsAwarded.toNumber()} tokens.`);
          } else {
            // Proof of Physics Gate: Energy-based rewards must have verified physics
            if (physics_score !== undefined && physics_score !== null) {
              const score = parseFloat(physics_score);
              if (score <= 0.0) {
                console.warn(`[L10 Audit] Rejected reward for event ${event_id}: Physics Score too low (${score}).`);
                return;
              }
              // Standard L1/L6 threshold for high fidelity is 0.95
              isHighFidelity = score > 0.95;
            } else {
              console.warn(`[L10 Audit] Rejected energy-based reward for event ${event_id}: Physics Score missing.`);
              return;
            }

            const rule = await getRewardRule(action_type);
            if (!rule) {
              console.warn(`⚠️ No active reward rule found for action type: ${action_type}`);
              return;
            }
            rule_id = rule.rule_id;

            // 2. Calculate Reward with Dynamic Boosting (Energy-based)
            const marketMultiplier = await getDynamicMultiplier(iso, action_type);
            const baseReward = new Decimal(source_value || 0).times(rule.reward_multiplier);
            pointsAwarded = baseReward.times(marketMultiplier).toDecimalPlaces(8);

            console.log(`[L10] Reward calculated: ${pointsAwarded.toNumber()} points (Source: ${source_value}, Rule Mult: ${rule.reward_multiplier}, Market Mult: ${marketMultiplier})`);
          }

          if (pointsAwarded.isZero()) {
            console.log(`[L10] Reward is zero for event ${event_id}, skipping.`);
            return;
          }

          // 3. Log the Reward (pending)
          const rewardLog = await logRewardTransaction(
            driver_id,
            rule_id,
            event_id,
            source_value || 0,
            pointsAwarded.toNumber(),
            'pending',
            iso,
            isHighFidelity
          );

          // 4. Execute Open-Wallet Transaction
          try {
            const openWalletResponse = await axios.post(`${process.env.OPEN_WALLET_API_URL}/transactions`, {
              walletAddress: driverWallet.open_wallet_address,
              amount: pointsAwarded.toNumber(),
              currency: 'MiGridPoints',
              referenceId: rewardLog.log_id
            });
            await updateRewardTransactionStatus(rewardLog.log_id, 'complete', openWalletResponse.data.transactionId);
            console.log(`✅ [L10] Reward transaction completed: ${openWalletResponse.data.transactionId}`);
          } catch (error) {
            console.error(`❌ [L10] Open-Wallet transaction failed for log ${rewardLog.log_id}:`, error.message);
            await updateRewardTransactionStatus(rewardLog.log_id, 'failed');
          }
        } catch (msgError) {
          console.error(`[L10] Error processing message: ${msgError.message}`);
        }
      },
    });

  } catch (error) {
    console.error('❌ [L10 Token Engine] Startup error:', error);
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

module.exports = { app, getDynamicMultiplier, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY, redisClient };
