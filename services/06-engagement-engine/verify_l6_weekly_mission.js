const fs = require('fs');

async function verifyL6Mission() {
  console.log('--- Starting L6 Weekly Mission Verification (Static Analysis) ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');

    const checks = [
      { name: 'Redis Integration', pattern: "require('redis')" },
      { name: 'Bulk CTE handleGridSignal', pattern: 'WITH target_drivers AS' },
      { name: 'ERCOT Pioneer in CTE', pattern: "a.name = 'ERCOT Pioneer' AND td.iso = 'ERCOT'" },
      { name: 'CAISO Pioneer in CTE', pattern: "a.name = 'CAISO Pioneer' AND td.iso = 'CAISO'" },
      { name: 'PJM Pioneer in CTE', pattern: "a.name = 'PJM Pioneer' AND td.iso = 'PJM'" },
      { name: 'ML Contributor Achievement Logic', pattern: "checkMLContributorAchievement" },
      { name: 'ML Contributor Action Trigger', pattern: "low_variance_session" },
      { name: 'Grid Alignment Bonus (1.5x)', pattern: "pointsMultiplier = 1.5" },
      { name: 'Rank Notification Throttling', pattern: "row.new_rank <= 10 || Math.abs(row.rank_delta) >= 5" },
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

verifyL6Mission();
