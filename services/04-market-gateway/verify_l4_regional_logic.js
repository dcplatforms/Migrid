const redis = require('redis');
const BiddingOptimizer = require('./BiddingOptimizer');
const { Pool } = require('pg');

async function verify() {
  console.log('--- Starting L4 Regional Bidding Logic Verification ---');

  const redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

  const mockPool = {
    query: async () => ({ rows: [] })
  };

  const optimizer = new BiddingOptimizer(mockPool, process.env.REDIS_URL || 'redis://localhost:6379');

  // Test 1: Global capacity fallback
  await redisClient.set('vpp:capacity:available', '500');
  await redisClient.del('vpp:capacity:regional');
  const cap1 = await optimizer.getAggregatedCapacity('CAISO');
  console.log(`Test 1 (Global Fallback): Expected 500, Got ${cap1.toNumber()}`);
  if (cap1.equals(500)) {
    console.log('✅ Test 1 Passed');
  } else {
    console.error('❌ Test 1 Failed');
  }

  // Test 2: Regional capacity prioritization
  const regionalData = {
    'ERCOT': 1200,
    'CAISO': 800
  };
  await redisClient.set('vpp:capacity:regional', JSON.stringify(regionalData));
  const cap2 = await optimizer.getAggregatedCapacity('ERCOT');
  console.log(`Test 2 (Regional ERCOT): Expected 1200, Got ${cap2.toNumber()}`);
  if (cap2.equals(1200)) {
    console.log('✅ Test 2 Passed');
  } else {
    console.error('❌ Test 2 Failed');
  }

  const cap3 = await optimizer.getAggregatedCapacity('CAISO');
  console.log(`Test 3 (Regional CAISO): Expected 800, Got ${cap3.toNumber()}`);
  if (cap3.equals(800)) {
    console.log('✅ Test 3 Passed');
  } else {
    console.error('❌ Test 3 Failed');
  }

  // Test 4: Unknown ISO falls back to global
  const cap4 = await optimizer.getAggregatedCapacity('PJM');
  console.log(`Test 4 (Unknown ISO Fallback): Expected 500, Got ${cap4.toNumber()}`);
  if (cap4.equals(500)) {
    console.log('✅ Test 4 Passed');
  } else {
    console.error('❌ Test 4 Failed');
  }

  // Cleanup
  await redisClient.del('vpp:capacity:available');
  await redisClient.del('vpp:capacity:regional');
  await optimizer.disconnect();
  await redisClient.quit();

  console.log('--- Verification Complete ---');
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
