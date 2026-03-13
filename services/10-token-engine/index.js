const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const express = require('express');
const Decimal = require('decimal.js');

const app = express();
const port = process.env.PORT || 3010;

const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'token-engine',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'token-engine-group' });

// --- In-Memory Price Cache ---
const priceCache = {
  CAISO: { price: 45.0, timestamp: new Date() },
  PJM: { price: 45.0, timestamp: new Date() },
  ERCOT: { price: 45.0, timestamp: new Date() }
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
    // In a real system, this would involve calling open-wallet to create an address
    // For now, we'll generate a mock address.
    const mockOpenWalletAddress = `OW-${driverId.substring(0, 8)}-${Date.now()}`;

    // Get fleet ISO for regional context
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

async function logRewardTransaction(driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status = 'pending', iso = 'CAISO') {
  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status, iso) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status, iso]
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

function getDynamicMultiplier(iso) {
  const priceData = priceCache[iso.toUpperCase()];
  if (!priceData) return new Decimal(1.0);

  const price = new Decimal(priceData.price);

  // Bonus for Surplus (Price < $30/MWh)
  if (price.lt(30)) {
    console.log(`[L10] Surplus detected in ${iso} ($${price}/MWh). Applying 1.5x Multiplier.`);
    return new Decimal(1.5);
  }

  // Bonus for Scarcity (Price > $100/MWh)
  if (price.gt(100)) {
    console.log(`[L10] Scarcity detected in ${iso} ($${price}/MWh). Applying 2.0x Multiplier.`);
    return new Decimal(2.0);
  }

  return new Decimal(1.0);
}

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    service: 'token-engine',
    version: '1.0.0',
    status: 'healthy',
    layer: 'L10'
  });
});

// --- Main Application Logic ---

async function start() {
  try {
    await pgClient.connect();
    console.log('✅ [L10 Token Engine] Connected to Ledger.');

    await consumer.connect();
    await consumer.subscribe({ topics: ['driver_actions', 'MARKET_PRICE_UPDATED'], fromBeginning: true });

    app.listen(port, () => {
      console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const payload = JSON.parse(message.value.toString());

        if (topic === 'MARKET_PRICE_UPDATED') {
          console.log(`[L10] Updating price cache: ${payload.iso} = $${payload.price_per_mwh}/MWh`);
          priceCache[payload.iso] = {
            price: payload.price_per_mwh,
            timestamp: new Date(payload.timestamp)
          };
          return;
        }

        console.log(`⚡ Received message from ${topic}:`, payload);

        const { driver_id, action_type, source_value, event_id, token_reward } = payload;

        // 3. Ensure Driver Wallet Exists (and get address)
        const driverWallet = await getOrCreateDriverWallet(driver_id);
        if (!driverWallet) {
          console.error(`❌ Failed to get or create wallet for driver: ${driver_id}`);
          return;
        }
        const iso = driverWallet.iso || 'CAISO';

        let pointsAwarded;
        let rule_id;

        if (action_type === 'challenge_completed') {
          // Challenge rewards are direct token amounts
          pointsAwarded = new Decimal(token_reward || 0).toNumber();
          // For challenge, we might not have a rule_id, so we use a dummy or a special one
          const challengeRule = await getRewardRule('challenge_completed');
          rule_id = challengeRule ? challengeRule.rule_id : '00000000-0000-0000-0000-000000000000';
          console.log(`[L10] Challenge completed by driver ${driver_id}. Awarding ${pointsAwarded} tokens.`);
        } else {
          // 1. Get Reward Rule
          const rule = await getRewardRule(action_type);
          if (!rule) {
            console.warn(`⚠️ No active reward rule found for action type: ${action_type}`);
            return;
          }
          rule_id = rule.rule_id;

          // 2. Calculate Reward with Dynamic Boosting
          const marketMultiplier = getDynamicMultiplier(iso);
          const baseReward = new Decimal(source_value).times(rule.reward_multiplier);
          pointsAwarded = baseReward.times(marketMultiplier).toDecimalPlaces(8).toNumber();

          console.log(`[L10] Calculated reward: ${pointsAwarded} points for driver ${driver_id} (Source: ${source_value}, Rule Multiplier: ${rule.reward_multiplier}, Market Multiplier: ${marketMultiplier})`);
        }

        // 4. Log the Reward (initial pending state)
        const rewardLog = await logRewardTransaction(
          driver_id,
          rule_id,
          event_id,
          source_value || 0,
          pointsAwarded,
          'pending',
          iso
        );
        console.log(`Reward logged (pending): ${rewardLog.log_id}`);

        // 5. Call Open-Wallet API
        try {
          const openWalletResponse = await axios.post(process.env.OPEN_WALLET_API_URL + '/transactions', {
            walletAddress: driverWallet.open_wallet_address,
            amount: pointsAwarded,
            currency: 'MiGridPoints',
            referenceId: rewardLog.log_id // Link back to our log
          });
          await updateRewardTransactionStatus(rewardLog.log_id, 'complete', openWalletResponse.data.transactionId);
          console.log(`✅ Reward transaction completed via Open-Wallet: ${openWalletResponse.data.transactionId}`);
        } catch (openWalletError) {
          console.error(`❌ Failed to send reward to Open-Wallet for log ${rewardLog.log_id}:`, openWalletError.message);
          await updateRewardTransactionStatus(rewardLog.log_id, 'failed');
        }
      },
    });

    console.log('✅ [L10 Token Engine] Listening for driver_actions.');
  } catch (error) {
    console.error('❌ [L10 Token Engine] Startup error:', error);
    process.exit(1);
  }
}

start();

process.on('SIGINT', async () => {
  console.log('👋 [L10 Token Engine] Shutting down...');
  await consumer.disconnect();
  await pgClient.end();
  process.exit(0);
});
