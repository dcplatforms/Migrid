const { Client } = require('pg');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const express = require('express');

const app = express();
const port = process.env.PORT || 3010;

const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({
  clientId: 'token-engine',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'token-engine-group' });

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
    'SELECT * FROM driver_wallets WHERE driver_id = $1;',
    [driverId]
  );

  if (res.rows.length === 0) {
    // In a real system, this would involve calling open-wallet to create an address
    // For now, we'll generate a mock address.
    const mockOpenWalletAddress = `OW-${driverId.substring(0, 8)}-${Date.now()}`;
    res = await pgClient.query(
      'INSERT INTO driver_wallets(driver_id, open_wallet_address) VALUES($1, $2) RETURNING *;',
      [driverId, mockOpenWalletAddress]
    );
  }
  return res.rows[0];
}

async function logRewardTransaction(driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status = 'pending') {
  const res = await pgClient.query(
    'INSERT INTO token_reward_log(driver_id, rule_id, triggering_event_id, source_value, points_awarded, status) VALUES($1, $2, $3, $4, $5, $6) RETURNING *;',
    [driverId, ruleId, triggeringEventId, sourceValue, pointsAwarded, status]
  );
  return res.rows[0];
}

async function updateRewardTransactionStatus(logId, newStatus, openWalletTransactionId = null) {
  await pgClient.query(
    'UPDATE token_reward_log SET status = $1, open_wallet_transaction_id = $2 WHERE log_id = $3;',
    [newStatus, openWalletTransactionId, logId]
  );
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
    console.log("✅ [L10 Token Engine] Connected to Ledger.");

    await consumer.connect();
    await consumer.subscribe({ topic: 'driver_actions', fromBeginning: true });

    app.listen(port, () => {
      console.log(`✅ [L10 Token Engine] Health check server running on port ${port}`);
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const payload = JSON.parse(message.value.toString());
        console.log(`⚡ Received message from ${topic}:`, payload);

        const { driver_id, action_type, source_value, event_id } = payload;

        // 1. Get Reward Rule
        const rule = await getRewardRule(action_type);
        if (!rule) {
          console.warn(`⚠️ No active reward rule found for action type: ${action_type}`);
          return;
        }

        // 2. Calculate Reward
        const pointsAwarded = parseFloat((source_value * rule.reward_multiplier).toFixed(8)); // Use toFixed for precision

        console.log(`Calculated reward: ${pointsAwarded} points for driver ${driver_id} (Source: ${source_value}, Multiplier: ${rule.reward_multiplier})`);

        // 3. Ensure Driver Wallet Exists (and get address)
        const driverWallet = await getOrCreateDriverWallet(driver_id);
        if (!driverWallet) {
            console.error(`❌ Failed to get or create wallet for driver: ${driver_id}`);
            return;
        }

        // 4. Log the Reward (initial pending state)
        const rewardLog = await logRewardTransaction(
          driver_id,
          rule.rule_id,
          event_id,
          source_value,
          pointsAwarded,
          'pending'
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

    console.log("✅ [L10 Token Engine] Listening for driver_actions.");
  } catch (error) {
    console.error("❌ [L10 Token Engine] Startup error:", error);
    process.exit(1);
  }
}

start();

process.on('SIGINT', async () => {
  console.log("👋 [L10 Token Engine] Shutting down...");
  await consumer.disconnect();
  await pgClient.end();
  process.exit(0);
});
