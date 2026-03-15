const fs = require('fs');

async function verifyMarketLogic() {
  console.log('--- Starting L6 Market Logic Verification (Static Analysis) ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');

    const checks = [
      { name: 'Redis Integration', pattern: "require('redis')" },
      { name: 'Bulk CTE handleGridSignal', pattern: 'WITH target_drivers AS' },
      { name: 'ERCOT Pioneer in CTE', pattern: "a.name = 'ERCOT Pioneer' AND td.iso = 'ERCOT'" },
      { name: 'Grid Warrior in CTE', pattern: "a.name = 'Grid Warrior' AND gc.action_count >= 5" },
      { name: 'Market Master on Session Complete', pattern: "await checkMarketMasterAchievement(driverId, iso, sessionId)" },
      { name: 'Market Master from Redis', pattern: "await redisClient.hGet('market:profitability', iso)" },
      { name: 'Market update to Redis', pattern: "await redisClient.hSet('market:profitability', iso" }
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = indexContent.includes(check.pattern);
      console.log(`- ${check.name}: ${passed ? '✅' : '❌'}`);
      if (!passed) allPassed = false;
    }

    if (allPassed) {
      console.log('--- Verification Complete: All logic components present ---');
      process.exit(0);
    } else {
      console.error('--- Verification Failed: Some logic components missing ---');
      process.exit(1);
    }
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verifyMarketLogic();
