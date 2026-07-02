/**
 * L7 v5.13.0 Compliance Verification (Isolated)
 * Validates Heartbeat hash indexing, 4-decimal string telemetry, and normalized individual DER alarm broadcasts.
 */

// 1. Mock dependencies before requiring source files
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function() {
  const arg = arguments[0];
  if (arg === 'kafkajs') {
    return {
      Kafka: function() {
        return {
          producer: () => ({ connect: async () => {}, send: async () => {} }),
          consumer: () => ({ connect: async () => {}, subscribe: async () => {}, run: async () => {} })
        };
      }
    };
  }
  if (arg === 'ioredis') {
    return function() {
      return {
        get: async () => null,
        set: async () => 'OK',
        hset: async () => 1,
        del: async () => 1,
        scan: async () => ['0', []],
        subscribe: async () => {},
        on: () => {}
      };
    };
  }
  if (arg === 'pg') {
    return {
      Pool: function() {
        return {
          query: async () => ({ rows: [] }),
          on: () => {}
        };
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { safeFloat } = require('./src/events/producer');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function verifyTelemetryPrecision() {
    console.log('🧪 Verifying 4-decimal string telemetry precision...');
    const val = safeFloat(10.5);
    console.log('   Result:', val);
    assert.strictEqual(typeof val, 'string');
    assert.strictEqual(val, '10.5000');

    const nanVal = safeFloat('invalid', 0.0);
    console.log('   NaN Fallback:', nanVal);
    assert.strictEqual(nanVal, '0.0000');
    console.log('✅ Telemetry precision verified.');
}

async function verifyStructuralChanges() {
    console.log('\n🔍 Verifying structural changes in source code...');

    const handlerPath = path.join(__dirname, 'src/ocpp/handler.js');
    const handlerContent = fs.readFileSync(handlerPath, 'utf8');

    console.log('   Checking Heartbeat hash indexing...');
    assert.ok(handlerContent.includes("redis.hset('l7:heartbeats'"), 'Heartbeat should use hset');

    console.log('   Checking DER alarm normalization loop...');
    assert.ok(handlerContent.includes('for (const alarm of payload.alarms)'), 'DER Alarms should be iterated');
    assert.ok(handlerContent.includes('alarmType: alarm.code'), 'code should be promoted to alarmType');

    const serverPath = path.join(__dirname, 'src/server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    console.log('   Checking Site-specific safety locks...');
    assert.ok(serverContent.includes('site: {}'), 'localSafetyCache should include site object');
    assert.ok(serverContent.includes('l1:safety:lock:site:*'), 'Poller should scan for site locks');
    assert.ok(serverContent.includes('localSafetyCache.site[siteId]'), 'Dispatch should check site lock');

    console.log('✅ Structural changes verified.');
}

async function run() {
    try {
        console.log('🚀 Starting L7 v5.13.0 Compliance Verification...');
        await verifyTelemetryPrecision();
        await verifyStructuralChanges();
        console.log('\n✨ Compliance verification passed.');
    } catch (err) {
        console.error('\n❌ Verification FAILED:', err.message);
        process.exit(1);
    }
}

run();
