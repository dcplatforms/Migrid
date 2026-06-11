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

console.log('--- L7 v5.12.0 Verification ---');

let allPassed = true;

allPassed &= checkFileContains('package.json', '"version": "5.12.0"', 'Package version bumped to 5.12.0');
allPassed &= checkFileContains('src/server.js', "version: '5.12.0'", 'Server health endpoint version updated');
allPassed &= checkFileContains('src/events/producer.js', "source: 'L7_GATEWAY_V5.12.0'", 'Kafka source tag updated');
allPassed &= checkFileContains('src/ocpp/handler.js', "case 'Heartbeat':", 'Heartbeat action added to handler');
allPassed &= checkFileContains('src/ocpp/handler.js', "await redis.set(`charger_heartbeat:${chargePointId}`", 'Heartbeat persisting to Redis');
allPassed &= checkFileContains('src/ocpp/handler.js', "energyDispensed = isNaN(parsed) ? 0.0 : parsed;", 'isNaN protection for energy dispensed');
allPassed &= checkFileContains('src/events/producer.js', "const safeFloat = (val, fallback = 0.0) => {", 'safeFloat utility implemented');
allPassed &= checkFileContains('src/events/producer.js', "return safeFloat(rv.value);", 'extractMeterValue uses safeFloat');
allPassed &= checkFileContains('src/ocpp/validators.js', "'Heartbeat': compileLegacy(),", 'Heartbeat added to validators');

if (allPassed) {
    console.log('\n✨ All L7 v5.12.0 checks PASSED');
    process.exit(0);
} else {
    console.error('\n⚠️ Some L7 v5.12.0 checks FAILED');
    process.exit(1);
}
