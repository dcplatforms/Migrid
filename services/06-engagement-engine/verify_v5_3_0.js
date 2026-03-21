const fs = require('fs');

async function verifyL6Mission() {
  console.log('--- Starting L6 Weekly Mission Verification (v5.3.0) ---');

  try {
    const indexContent = fs.readFileSync('./index.js', 'utf8');

    const checks = [
      { name: 'Version 5.3.0', pattern: "version: '5.3.0'" },
      { name: 'V2X Pioneer logic in processChargingEvent', pattern: "protocol: event.protocol" },
      { name: 'ISO Explorer in CTE', pattern: "a.name = 'ISO Explorer' AND gc.distinct_iso_count >= 3" },
      { name: 'ISO Metadata in grid_response action', pattern: "jsonb_build_object('event_id', $2::jsonb->>'event_id', 'iso', td.iso)" },
      { name: 'Multi-ISO Challenge Logic', pattern: "SELECT challenge_type FROM challenges WHERE id = EXCLUDED.challenge_id" },
      { name: 'V2X Pioneer in checkV2GAchievements', pattern: "V2X Pioneer" }
    ];

    let allPassed = true;
    for (const check of checks) {
      const passed = indexContent.includes(check.pattern);
      console.log(`- ${check.name}: ${passed ? '✅' : '❌'}`);
      if (!passed) {
          allPassed = false;
          console.error(`  - Failed to find: ${check.pattern}`);
      }
    }

    if (allPassed) {
      console.log('--- Verification Complete: v5.3.0 logic present ---');
      process.exit(0);
    } else {
      console.error('--- Verification Failed: Missing critical v5.3.0 logic ---');
      process.exit(1);
    }
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  }
}

verifyL6Mission();
