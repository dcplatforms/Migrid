/**
 * L7: Device Gateway v5.10.0 Verification Script
 * Jules, April 2026
 */

const fs = require('fs');
const path = require('path');

async function runVerification() {
    console.log('🔍 Starting L7 v5.10.0 Verification...');
    let failures = 0;

    // 1. Check version in package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version === '5.10.0') {
        console.log('✅ Version: 5.10.0 confirmed in package.json');
    } else {
        console.error(`❌ Version mismatch: Expected 5.10.0, found ${pkg.version}`);
        failures++;
    }

    // 2. Verify security headers (helmet) in server.js
    const serverJs = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
    if (serverJs.includes('app.use(helmet())')) {
        console.log('✅ Security: helmet() middleware confirmed in server.js');
    } else {
        console.error('❌ Security: helmet() middleware MISSING in server.js');
        failures++;
    }

    // 3. Verify health check version
    if (serverJs.includes("version: '5.10.0'")) {
        console.log('✅ Version: 5.10.0 confirmed in server.js health check');
    } else {
        console.error('❌ Version: 5.10.0 MISSING in server.js health check');
        failures++;
    }

    // 4. Verify Site ID extraction logic in producer.js
    const producerJs = fs.readFileSync(path.join(__dirname, 'src/events/producer.js'), 'utf8');
    if (producerJs.includes('const extractSiteId = (payload) => {') &&
        producerJs.includes('payload.siteId') &&
        producerJs.includes('payload.locationId')) {
        console.log('✅ Logic: Standardized extractSiteId helper confirmed in producer.js');
    } else {
        console.error('❌ Logic: Standardized extractSiteId helper MISSING or incomplete in producer.js');
        failures++;
    }

    // 5. Verify isNaN protection and score formatting
    if (producerJs.includes('isNaN(rawPhysics)') &&
        producerJs.includes('physicsVal.toFixed(4)')) {
        console.log('✅ Logic: isNaN protection and .toFixed(4) formatting confirmed in producer.js');
    } else {
        console.error('❌ Logic: isNaN protection or .toFixed(4) formatting MISSING in producer.js');
        failures++;
    }

    // 6. Verify Kafka source tag
    if (producerJs.includes("source: 'L7_GATEWAY_V5.10.0'")) {
        console.log('✅ Metadata: Kafka source tag updated to v5.10.0 in producer.js');
    } else {
        console.error('❌ Metadata: Kafka source tag MISSING update in producer.js');
        failures++;
    }

    if (failures === 0) {
        console.log('\n✨ L7 v5.10.0 VERIFICATION SUCCESSFUL');
        process.exit(0);
    } else {
        console.error(`\n❌ L7 v5.10.0 VERIFICATION FAILED with ${failures} errors`);
        process.exit(1);
    }
}

runVerification();
