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

        // Robust Payload Validation
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

        // L10 v4.3.4 Sentinel Fidelity Tier: physics_score > 0.99 or explicit sentinel flag
        let isSentinelFidelityPersist = (isSentinelFidelityVal === true || isSentinelFidelityVal === 'true') ||
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
          multiplierReason = marketMultiplier.reason;
          const baseReward = new Decimal(source_value || 0).times(rule.reward_multiplier);
          pointsAwarded = baseReward.times(marketMultiplier.multiplier).toDecimalPlaces(8);

          console.log(`[L10] Reward calculated: ${pointsAwarded.toNumber()} points (Source: ${source_value}, Rule Mult: ${rule.reward_multiplier}, Market Mult: ${marketMultiplier.multiplier.toNumber()})`);
        }

        if (pointsAwarded.isZero()) {
          console.log(`[L10] Reward is zero for event ${event_id}, skipping.`);
          return;
        }

        // 4. Log the Reward (pending)
        const rewardLog = await logRewardTransaction(
          driver_id,
          rule_id,
          event_id,
          source_value || 0,
          pointsAwarded.toNumber(),
          'pending',
          iso,
          physicsScorePersist,
          isHighFidelityPersist,
          multiplierReason,
          confidenceScorePersist,
          resourceTypeVal,
          isSentinelFidelityPersist,
          siteIdVal
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

module.exports = { app, getDynamicMultiplier, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY, redisClient };
