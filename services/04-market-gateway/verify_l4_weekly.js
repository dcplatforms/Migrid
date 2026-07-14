const redis = require('redis');
const axios = require('axios');
const BiddingOptimizer = require('./BiddingOptimizer');

async function verify() {
  const redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

  console.log('--- Testing Regional & Site Lock Reporting (v3.8.9) ---');
  await redisClient.setEx('l4:grid:lock:CAISO', 60, 'true');
  await redisClient.setEx('l1:safety:lock:site:SITE-ALPHA', 60, 'true');

  const { localSafetyCache, updateLocalSafetyCache } = require('./index');

  // Need to wait for scan to complete
  await updateLocalSafetyCache();

  console.log('Local Safety Cache (L4 Regional):', localSafetyCache.l4_regional);
  console.log('Local Safety Cache (Site Safety):', localSafetyCache.site_safety);

  if (localSafetyCache.l4_regional.CAISO && localSafetyCache.site_safety['SITE-ALPHA']) {
    console.log('✅ Regional and Site lock scanning verified.');
  } else {
    console.error('❌ Regional and Site lock scanning FAILED.');
  }

  const optimizer = new BiddingOptimizer(null, process.env.REDIS_URL || 'redis://localhost:6379', localSafetyCache);

  console.log('\n--- Testing Site-Specific Bidding Halted ---');
  const siteLockResult = await optimizer.generateDayAheadBids('PJM', 'SITE-ALPHA');
  if (siteLockResult.audit.locks.l1 === true && siteLockResult.bids.length === 0) {
    console.log('✅ Site-specific bidding halt verified.');
  } else {
    console.error('❌ Site-specific bidding halt FAILED.');
  }

  const nonLockedSiteResult = await optimizer.generateDayAheadBids('PJM', 'SITE-BETA');
  if (nonLockedSiteResult.audit.locks.l1 === false) {
    console.log('✅ Site-specific non-interference verified.');
  } else {
    console.error('❌ Site-specific non-interference FAILED.');
  }

  console.log('\n--- Testing Hardware Health Penalty (v3.8.9) ---');
  // Set 3 alarms for ERCOT -> 0.15 penalty
  await redisClient.set('l4:regional:alarms:ERCOT', '3');

  // Mock pricing for ERCOT
  optimizer.pricingService.getDayAheadForecast = async () => [
    { location: 'TEXAS_NODE', price_per_mwh: 100.00, timestamp: new Date() }
  ];

  const ercotResult = await optimizer.generateDayAheadBids('ERCOT');
  console.log('ERCOT Confidence Score (Expected ~0.85):', ercotResult.audit.confidence_score);
  console.log('ERCOT Hardware Penalty (Expected 0.15):', ercotResult.audit.hardware_penalty);
  console.log('ERCOT Alarm Count (Expected 3):', ercotResult.audit.regional_alarm_count);

  if (parseFloat(ercotResult.audit.confidence_score) <= 0.85 && ercotResult.audit.hardware_penalty === '0.1500') {
    console.log('✅ Hardware Health Penalty verified.');
  } else {
    console.error('❌ Hardware Health Penalty FAILED.');
  }

  console.log('\n--- Testing Penalty Cap (v3.8.9) ---');
  // Set 10 alarms -> 0.50 penalty -> Capped at 0.30
  await redisClient.set('l4:regional:alarms:PJM', '10');
  const pjmResult = await optimizer.generateDayAheadBids('PJM');
  console.log('PJM Hardware Penalty (Expected 0.30):', pjmResult.audit.hardware_penalty);
  if (pjmResult.audit.hardware_penalty === '0.3000') {
    console.log('✅ Hardware Health Penalty cap verified.');
  } else {
    console.error('❌ Hardware Health Penalty cap FAILED.');
  }

  // Cleanup
  await redisClient.del('l4:grid:lock:CAISO');
  await redisClient.del('l1:safety:lock:site:SITE-ALPHA');
  await redisClient.del('l4:regional:alarms:ERCOT');
  await redisClient.del('l4:regional:alarms:PJM');
  await redisClient.quit();
}

verify().catch(err => {
    console.error(err);
    process.exit(1);
});
