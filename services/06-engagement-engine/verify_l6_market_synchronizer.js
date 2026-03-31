const fs = require('fs');

async function verifyMarketSynchronizer() {
  console.log('--- Starting L6 Market Synchronizer Logic Verification ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');

    const checks = [
      { name: 'Market Synchronizer Achievement Check', pattern: 'checkMarketSynchronizerAchievement(driverId, iso, sessionId)' },
      { name: 'Market Synchronizer Definition', pattern: 'async function checkMarketSynchronizerAchievement' },
      { name: 'Surplus Threshold Check', pattern: 'if (profitability < 30 && profitability !== 0)' },
      { name: 'Surplus Charge Action Recording', pattern: "action_type = 'surplus_charge'" },
      { name: 'Surplus Charge Action Insertion', pattern: "INSERT INTO driver_actions (driver_id, action_type, metadata) VALUES ($1, $2, $3)" },
      { name: 'Surplus Charge Action metadata', pattern: 'JSON.stringify({ iso, sessionId, physicsScore, isHighFidelity })' },
      { name: 'Achievement Query', pattern: "SELECT id FROM achievements WHERE name = 'Market Synchronizer'" }
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = indexContent.includes(check.pattern);
      console.log(`- ${check.name}: ${passed ? '✅' : '❌'}`);
      if (!passed) {
          console.log(`  (Pattern not found: ${check.pattern})`);
          allPassed = false;
      }
    }

    if (allPassed) {
      console.log('--- Verification Complete: Market Synchronizer logic verified ---');
      process.exit(0);
    } else {
      console.error('--- Verification Failed: Market Synchronizer logic incomplete ---');
      process.exit(1);
    }
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verifyMarketSynchronizer();
