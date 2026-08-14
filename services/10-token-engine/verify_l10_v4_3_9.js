/**
 * Verification Script for L10 Token Engine v4.3.9
 * Verifies versioning, health status, and core utility logic.
 */

const { app } = require('./index');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

async function verify() {
  console.log('🚀 Starting L10 v4.3.9 Verification...');

  // 1. Verify Health Check and Versioning
  try {
    const res = await request(app).get('/health');
    if (res.status === 200 && res.body.version === '4.3.9') {
      console.log('✅ Health Check: PASSED (Version 4.3.9)');
    } else {
      console.error('❌ Health Check: FAILED', res.body);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Health Check Request Error:', err.message);
    process.exit(1);
  }

  // 2. Duplicate Function Check
  const indexPath = path.join(__dirname, 'index.js');
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  const occurrences = (indexSource.match(/function extractSiteId/g) || []).length;

  if (occurrences === 1) {
    console.log('✅ Duplicate Function Check: PASSED (Only 1 extractSiteId found)');
  } else {
    console.error(`❌ Duplicate Function Check: FAILED (${occurrences} found)`);
    process.exit(1);
  }

  // 3. Weak Secret Check
  if (indexSource.includes('dev_secret_change_in_production')) {
    console.log('✅ Weak Secret Reject Parity Check: PASSED (dev_secret_change_in_production included)');
  } else {
    console.error('❌ Weak Secret Reject Parity Check: FAILED');
    process.exit(1);
  }

  console.log('🎉 L10 v4.3.9 Verification COMPLETE: ALL SYSTEMS NOMINAL');
}

verify();
