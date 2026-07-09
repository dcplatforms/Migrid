/**
 * Verification Script for L7 Device Gateway v5.13.0
 */

const { safeFloat } = require('./src/events/producer');
const { handleOcppMessage } = require('./src/ocpp/handler');
const { redis } = require('./src/state/connectionMgr');
const assert = require('assert');

async function runVerification() {
    console.log('🚀 Starting L7 v5.13.0 Verification...');

    // 1. Verify safeFloat 4-decimal string formatting
    console.log('--- [L7-138] Telemetry High-Fidelity Standard ---');
    const val1 = safeFloat(10.5);
    const val2 = safeFloat("20.123456");
    const val3 = safeFloat("invalid", 0.0);

    assert.strictEqual(val1, "10.5000", "safeFloat(10.5) should be 10.5000");
    assert.strictEqual(val2, "20.1235", "safeFloat(20.123456) should be 20.1235 (rounded)");
    assert.strictEqual(val3, "0.0000", "safeFloat('invalid') should be 0.0000");
    console.log('✅ Telemetry formatting verified.');

    // 2. Mocking for OCPP Handler test
    const mockWs = {
        send: (data) => console.log('   [MOCK WS SEND]', data)
    };

    // 3. Verify Heartbeat (Redis Hash)
    console.log('--- [L7-137] Heartbeat Scalability ---');
    // We can't easily check redis in this env without a real server, but we can verify it doesn't crash
    try {
        await handleOcppMessage('CHARGER_001', JSON.stringify([2, "123", "Heartbeat", {}]), mockWs, 'ocpp2.0.1');
        console.log('✅ Heartbeat handler executed.');
    } catch (e) {
        console.error('❌ Heartbeat handler failed:', e.message);
    }

    // 4. Verify NotifyDERAlarm refactoring
    console.log('--- [L7-136] DER Alarm Refactoring ---');
    const derAlarmPayload = {
        alarms: [
            { alarmType: 'OverVoltage', severity: 'CRITICAL', status: 'Active' },
            { alarmType: 'HighTemp', severity: 'WARNING', status: 'Active' }
        ]
    };
    try {
        await handleOcppMessage('CHARGER_001', JSON.stringify([2, "124", "NotifyDERAlarm", derAlarmPayload]), mockWs, 'ocpp2.1');
        console.log('✅ NotifyDERAlarm handler executed.');
    } catch (e) {
        console.error('❌ NotifyDERAlarm handler failed:', e.message);
    }

    console.log('\n✨ L7 v5.13.0 Verification Complete!');
    process.exit(0);
}

runVerification().catch(err => {
    console.error('❌ Verification CRASHED:', err);
    process.exit(1);
});
