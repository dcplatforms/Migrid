const fs = require('fs');

async function verifyL6Mission() {
  console.log('--- Starting L6 Weekly Mission Verification (Static Analysis) ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');
    const packageContent = fs.readFileSync('./package.json', 'utf8');

    const checks = [
      { name: 'Redis Integration', pattern: "require('redis')" },
      { name: 'Bulk CTE handleGridSignal', pattern: 'WITH target_drivers AS' },
      { name: 'Global Grid Guardian in CTE', pattern: "(a.name = 'Global Grid Guardian' AND gc.iso_count >= 5)" },
      { name: 'ERCOT Pioneer in CTE', pattern: "a.name = 'ERCOT Pioneer' AND td.iso = 'ERCOT'" },
      { name: 'CAISO Pioneer in CTE', pattern: "a.name = 'CAISO Pioneer' AND td.iso = 'CAISO'" },
      { name: 'PJM Pioneer in CTE', pattern: "a.name = 'PJM Pioneer' AND td.iso = 'PJM'" },
      { name: 'ML Contributor Achievement Logic (Consecutive)', pattern: "WITH recent_sessions AS" },
      { name: 'Sustainability Champion Strict Check', pattern: "WITH RECURSIVE dates AS" },
      { name: 'Rank Notification previous_rank', pattern: "previous_rank: row.new_rank + row.rank_delta" },
      { name: 'Achievement Notification Metadata', pattern: "data: { achievement_id, name, points, icon }" },
      { name: 'Service Version 5.5.0', pattern: "version: '5.5.0'" },
      { name: 'ENTSO-E Pioneer in CTE', pattern: "a.name = 'ENTSO-E Pioneer' AND td.iso = 'ENTSOE'" },
      { name: 'Grid Impact in CTE', pattern: "(a.name = 'Grid Impact' AND gc.action_count >= 10)" },
      { name: 'Market Master Scarcity Alignment', pattern: "High Profitability Threshold: $100/MWh" },
      { name: 'L11 Data Guardian Logic', pattern: "checkL11DataGuardianAchievement" },
      { name: 'High Fidelity Physics Check', pattern: "physicsScore > 0.95" },
      { name: 'WebSocket Physics Enrichment', pattern: "physics_score: physicsScore.toFixed(4)" }
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = indexContent.includes(check.pattern) || packageContent.includes(check.pattern);
      console.log(`- ${check.name}: ${passed ? '✅' : '❌'}`);
      if (!passed) {
          console.log(`  (Pattern not found: ${check.pattern})`);
          allPassed = false;
      }
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
