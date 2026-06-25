const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

function checkFileContains(filepath, pattern, description) {
    const fullPath = path.join(baseDir, filepath);
    if (!fs.existsSync(fullPath)) {
        console.error(`❌ [FAIL] File missing: ${filepath}`);
        return false;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) {
        console.log(`✅ [PASS] ${description}`);
        return true;
    } else {
        console.error(`❌ [FAIL] ${description}`);
        console.error(`       Pattern not found: ${pattern}`);
        return false;
    }
}

console.log('--- L7 v5.13.0 Verification ---');

let allPassed = true;

allPassed &= checkFileContains('package.json', '"version": "5.13.0"', 'Package version bumped to 5.13.0');
allPassed &= checkFileContains('src/server.js', "site_safety: {} // [L7-v5.13.0]", 'localSafetyCache expanded with site_safety');
allPassed &= checkFileContains('src/server.js', "MATCH', 'l1:safety:lock:site:*'", 'Poller syncs site-specific locks');
allPassed &= checkFileContains('src/server.js', "if (siteId && localSafetyCache.site_safety[siteId])", 'Site safety lock enforced in control path');
allPassed &= checkFileContains('src/ocpp/handler.js', "redis.hset('l7:heartbeats'", 'Heartbeat uses Redis Hash indexing');
allPassed &= checkFileContains('src/ocpp/handler.js', "for (const alarm of payload.alarms)", 'NotifyDERAlarm iterates through individual alarms');
allPassed &= checkFileContains('src/ocpp/handler.js', "alarmType: alarm.alarmType", 'NotifyDERAlarm broadcasts individual alarm metadata');
allPassed &= checkFileContains('src/events/producer.js', "source: 'L7_GATEWAY_V5.13.0'", 'Kafka source tag updated to v5.13.0');
allPassed &= checkFileContains('src/events/producer.js', "result.toFixed(4)", 'safeFloat utility returns 4-decimal string');
allPassed &= checkFileContains('src/events/producer.js', "return (0.0).toFixed(4)", 'extractMeterValue fallback returns 4-decimal string');

if (allPassed) {
    console.log('\n✨ All L7 v5.13.0 checks PASSED');
    process.exit(0);
} else {
    console.error('\n⚠️ Some L7 v5.13.0 checks FAILED');
    process.exit(1);
}
