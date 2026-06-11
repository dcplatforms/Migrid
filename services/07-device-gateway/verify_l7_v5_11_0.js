/**
 * L7: Device Gateway v5.11.0 Verification Script
 */

const fs = require('fs');
const path = require('path');

async function runVerification() {
    console.log('🔍 Starting L7 v5.11.0 Verification...');
    let failures = 0;

    const gatewayDir = path.join(__dirname);

    // 1. Check version in package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(gatewayDir, 'package.json'), 'utf8'));
    if (pkg.version === '5.11.0') {
        console.log('✅ Version: 5.11.0 confirmed in package.json');
    } else {
        console.error(`❌ Version mismatch in package.json: Expected 5.11.0, found ${pkg.version}`);
        failures++;
    }

    // 2. Verify health check version in server.js
    const serverJs = fs.readFileSync(path.join(gatewayDir, 'src/server.js'), 'utf8');
    if (serverJs.includes("version: '5.11.0'")) {
        console.log('✅ Version: 5.11.0 confirmed in server.js health check');
    } else {
        console.error('❌ Version: 5.11.0 MISSING in server.js health check');
        failures++;
    }

    // 3. Verify Local Safety Cache implementation
    if (serverJs.includes('const localSafetyCache =') &&
        serverJs.includes('async function updateLocalSafetyCache()') &&
        serverJs.includes('setInterval(updateLocalSafetyCache, 5000)')) {
        console.log('✅ Resilience: localSafetyCache and poller confirmed in server.js');
    } else {
        console.error('❌ Resilience: localSafetyCache implementation MISSING in server.js');
        failures++;
    }

    // 4. Verify Local Safety Cache usage
    if (serverJs.includes('localSafetyCache.global') &&
        serverJs.includes('localSafetyCache.regional[isoRegion]')) {
        console.log('✅ Resilience: localSafetyCache usage confirmed in server.js');
    } else {
        console.error('❌ Resilience: localSafetyCache usage MISSING in server.js');
        failures++;
    }

    // 5. Verify DER Alarm broadcasting in handler.js
    const handlerJs = fs.readFileSync(path.join(gatewayDir, 'src/ocpp/handler.js'), 'utf8');
    if (handlerJs.includes("publishSessionEvent('DER_ALARM_REPORTED'")) {
        console.log('✅ Protocol: DER Alarm broadcasting confirmed in handler.js');
    } else {
        console.error('❌ Protocol: DER Alarm broadcasting MISSING in handler.js');
        failures++;
    }

    // 6. Verify Kafka source tag and telemetry formatting in producer.js
    const producerJs = fs.readFileSync(path.join(gatewayDir, 'src/events/producer.js'), 'utf8');
    if (producerJs.includes("source: 'L7_GATEWAY_V5.11.0'")) {
        console.log('✅ Metadata: Kafka source tag updated to v5.11.0 in producer.js');
    } else {
        console.error('❌ Metadata: Kafka source tag MISSING update in producer.js');
        failures++;
    }

    if (producerJs.includes('energyActiveImport: importEnergy.toFixed(4)') &&
        producerJs.includes('powerActiveExport: exportPower.toFixed(4)')) {
        console.log('✅ Logic: Strict 4-decimal telemetry formatting confirmed in producer.js');
    } else {
        console.error('❌ Logic: Strict 4-decimal telemetry formatting MISSING in producer.js');
        failures++;
    }

    // 7. Verify zero-latency region lookup in server.js
    if (serverJs.includes('const isoRegion = connection.isoRegion || \'CAISO\'')) {
        console.log('✅ Resilience: Zero-latency region lookup confirmed in server.js');
    } else {
        console.error('❌ Resilience: Zero-latency region lookup MISSING in server.js');
        failures++;
    }

    // 8. Verify NotifyDERAlarm schema
    if (fs.existsSync(path.join(gatewayDir, 'src/ocpp/schemas/NotifyDERAlarm.json'))) {
        console.log('✅ Protocol: NotifyDERAlarm JSON schema confirmed');
    } else {
        console.error('❌ Protocol: NotifyDERAlarm JSON schema MISSING');
        failures++;
    }

    if (failures === 0) {
        console.log('\n✨ L7 v5.11.0 VERIFICATION SUCCESSFUL');
        process.exit(0);
    } else {
        console.error(`\n❌ L7 v5.11.0 VERIFICATION FAILED with ${failures} errors`);
        process.exit(1);
    }
}

runVerification();
