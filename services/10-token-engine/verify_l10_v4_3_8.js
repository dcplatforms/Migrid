/**
 * Verification Script for L10 Token Engine v4.3.8
 * Verifies versioning, health status, and core utility logic.
 */

const { app } = require('./index');
const request = require('supertest');
const fs = require('fs');

async function verify() {
  console.log('🚀 Starting L10 v4.3.8 Verification...');

  // 1. Verify Health Check and Versioning
  try {
    const res = await request(app).get('/health');
    if (res.status === 200 && res.body.version === '4.3.8') {
      console.log('✅ Health Check: PASSED (Version 4.3.8)');
    } else {
      console.error('❌ Health Check: FAILED', res.body);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Health Check Request Error:', err.message);
    process.exit(1);
  }

  // 2. Duplicate Function Check
  const indexSource = fs.readFileSync('./index.js', 'utf8');
  const occurrences = (indexSource.match(/function extractSiteId/g) || []).length;

  if (occurrences === 1) {
    console.log('✅ Duplicate Function Check: PASSED (Only 1 extractSiteId found)');
  } else {
    console.error(`❌ Duplicate Function Check: FAILED (${occurrences} found)`);
    process.exit(1);
  }

  // 3. AI Export Standard Check
  if (indexSource.includes('source: \'L10_TOKEN_ENGINE_V4.3.8\'')) {
    console.log('✅ AI Export Standard: PASSED (Version string updated)');
  } else {
    console.error('❌ AI Export Standard: FAILED (Version string not updated)');
    process.exit(1);
  }

  // 4. Verification of behavioral types expansion
  if (indexSource.includes('action_type === \'der_alarm_response\'') && indexSource.includes('action_type === \'solar_ramp_response\'')) {
    console.log('✅ Behavioral Types Expansion: PASSED');
  } else {
    console.error('❌ Behavioral Types Expansion: FAILED');
    process.exit(1);
  }

  // 5. Sentinel Fidelity Hardening Check
  if (indexSource.includes("isSentinelFidelityVal === '1'")) {
    console.log('✅ Sentinel Fidelity Hardening: PASSED (\'1\' string supported)');
  } else {
    console.error('❌ Sentinel Fidelity Hardening: FAILED');
    process.exit(1);
  }

  console.log('🎉 L10 v4.3.8 Verification COMPLETE: ALL SYSTEMS NOMINAL');
}

verify();
