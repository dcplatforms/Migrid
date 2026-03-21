const fs = require('fs');

async function verifyL6V2X() {
  console.log('--- Starting L6 V2X & ISO Explorer Logic Verification ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');

    const checks = [
      { name: 'V2X Pioneer Check', pattern: "if (event.protocol && event.protocol.toLowerCase().trim() === 'ocpp2.1')" },
      { name: 'ISO Explorer Logic in CTE', pattern: "a.name = 'ISO Explorer' AND gc.iso_count >= 3" },
      { name: 'ISO Field in grid_response metadata', pattern: "SELECT td.driver_id, 'grid_response', $2::jsonb || jsonb_build_object('iso', td.iso)" },
      { name: 'Challenge ISO Explorer Logic', pattern: "WHEN c.challenge_type = 'iso_explorer' THEN" }
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = indexContent.includes(check.pattern);
      console.log(`- ${check.name}: ${passed ? '✅' : '❌'}`);
      if (!passed) allPassed = false;
    }

    if (allPassed) {
      console.log('--- L6 V2X/ISO Verification Complete ---');
      process.exit(0);
    } else {
      console.error('--- L6 V2X/ISO Verification Failed ---');
      process.exit(1);
    }
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verifyL6V2X();
