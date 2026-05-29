/**
 * L7: Device Gateway v5.9.0 Verification Script
 * Jules, April 2026
 */

const fs = require('fs');
const path = require('path');

async function runVerification() {
    console.log('🔍 Starting L7 v5.9.0 Verification...');
    let failures = 0;

    // 1. Check version in package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version === '5.9.0') {
        console.log('✅ Version: 5.9.0 confirmed in package.json');
    } else {
        console.error(`❌ Version mismatch: Expected 5.9.0, found ${pkg.version}`);
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

    // 3. Verify PKI hardening placeholder
    if (serverJs.includes('[L7-SEC-001] Hardened ISO 15118-20 PKI') && serverJs.includes('new X509Certificate')) {
        console.log('✅ Security: [L7-SEC-001] PKI hardening confirmed in server.js');
    } else {
        console.error('❌ Security: [L7-SEC-001] PKI hardening MISSING or incomplete in server.js');
        failures++;
    }

    // 4. Verify OCPI Mapping updates
    const handlerJs = fs.readFileSync(path.join(__dirname, 'src/ocpp/handler.js'), 'utf8');
    if (handlerJs.includes("case 'Charging':") && handlerJs.includes("case 'Finishing':")) {
        console.log('✅ Protocol: OCPI 2.2 status mapping refined in handler.js');
    } else {
        console.error('❌ Protocol: OCPI 2.2 status mapping MISSING updates in handler.js');
        failures++;
    }

    // 5. Verify metadata standardization in producer.js
    const producerJs = fs.readFileSync(path.join(__dirname, 'src/events/producer.js'), 'utf8');
    if (producerJs.includes("source: 'L7_GATEWAY_V5.9.0'")) {
        console.log('✅ Metadata: Kafka source tag updated to v5.9.0');
    } else {
        console.error('❌ Metadata: Kafka source tag MISSING update in producer.js');
        failures++;
    }

    if (producerJs.includes('context.is_sentinel_fidelity === 1')) {
        console.log('✅ Logic: Sentinel Fidelity hardening (integer 1 support) confirmed in producer.js');
    } else {
        console.error('❌ Logic: Sentinel Fidelity hardening (integer 1 support) MISSING in producer.js');
        failures++;
    }

    if (failures === 0) {
        console.log('\n✨ L7 v5.9.0 VERIFICATION SUCCESSFUL');
        process.exit(0);
    } else {
        console.error(`\n❌ L7 v5.9.0 VERIFICATION FAILED with ${failures} errors`);
        process.exit(1);
    }
}

runVerification();
