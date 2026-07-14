const fs = require('fs');
const path = require('path');

console.log('--- L7 v5.13.0 Verification ---');

const producerPath = path.join(__dirname, 'src/events/producer.js');
const handlerPath = path.join(__dirname, 'src/ocpp/handler.js');
const serverPath = path.join(__dirname, 'src/server.js');
const packagePath = path.join(__dirname, 'package.json');

const producerContent = fs.readFileSync(producerPath, 'utf8');
const handlerContent = fs.readFileSync(handlerPath, 'utf8');
const serverContent = fs.readFileSync(serverPath, 'utf8');
const packageContent = fs.readFileSync(packagePath, 'utf8');

const checks = [
    {
        name: 'Package version bumped to 5.13.0',
        passed: JSON.parse(packageContent).version === '5.13.0'
    },
    {
        name: 'Server health endpoint version updated to 5.13.0',
        passed: serverContent.includes("version: '5.13.0'")
    },
    {
        name: 'Kafka source tag updated to v5.13.0',
        passed: producerContent.includes("source: 'L7_GATEWAY_V5.13.0'")
    },
    {
        name: 'safeFloat returns 4-decimal strings',
        passed: producerContent.includes('fallback.toFixed(4) : parsed.toFixed(4)')
    },
    {
        name: 'Heartbeat hash indexing implemented',
        passed: handlerContent.includes("redis.hset('l7:heartbeats'")
    },
    {
        name: 'DER Alarm individual broadcasting implemented',
        passed: handlerContent.includes('for (const alarm of payload.alarms)') &&
                handlerContent.includes('alarmType: alarm.code')
    },
    {
        name: 'Redundant toFixed(4) removed in publishTelemetry',
        passed: !producerContent.includes('importEnergy.toFixed(4)') &&
                producerContent.includes('energyActiveImport: importEnergy')
    }
];

let allPassed = true;
checks.forEach(check => {
    if (check.passed) {
        console.log(`✅ [PASS] ${check.name}`);
    } else {
        console.log(`❌ [FAIL] ${check.name}`);
        allPassed = false;
    }
});

if (allPassed) {
    console.log('\n✨ All L7 v5.13.0 checks PASSED');
} else {
    console.log('\n🚨 Some checks FAILED');
    process.exit(1);
}
