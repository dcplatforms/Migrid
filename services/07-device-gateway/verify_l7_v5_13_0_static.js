const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

function checkFileContains(filepath, pattern, description) {
    const content = fs.readFileSync(path.join(baseDir, filepath), 'utf8');
    if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) {
        console.log(`✅ [PASS] ${description}`);
        return true;
    } else {
        console.error(`❌ [FAIL] ${description}`);
        console.error(`       Pattern not found: ${pattern}`);
        return false;
    }
}

console.log('--- L7 v5.13.0 Static Verification ---');

let allPassed = true;

allPassed &= checkFileContains('package.json', '"version": "5.13.0"', 'Package version bumped to 5.13.0');
allPassed &= checkFileContains('src/server.js', "version: '5.13.0'", 'Server health endpoint version updated');
allPassed &= checkFileContains('src/events/producer.js', "source: 'L7_GATEWAY_V5.13.0'", 'Kafka source tag updated to 5.13.0');

allPassed &= checkFileContains('src/events/producer.js', "result.toFixed(4)", 'safeFloat returns 4-decimal string');
allPassed &= checkFileContains('src/ocpp/handler.js', "await redis.hset('l7:heartbeats'", 'Heartbeat using Redis Hash');
allPassed &= checkFileContains('src/ocpp/handler.js', "alarmType: alarm.code || alarm.alarmType,", 'DER Alarms decomposed into individual events');
allPassed &= checkFileContains('src/server.js', "site: {}", 'localSafetyCache includes site');
allPassed &= checkFileContains('src/server.js', "if (siteId && localSafetyCache.site[siteId])", 'Site lock enforced in sendSetChargingProfile');

if (allPassed) {
    console.log('\n✨ All L7 v5.13.0 checks PASSED');
} else {
    console.error('\n⚠️ Some L7 v5.13.0 checks FAILED');
}
