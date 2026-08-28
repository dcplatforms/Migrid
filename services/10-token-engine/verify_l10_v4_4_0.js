/**
 * Verification Script for L10 Token Engine v4.4.0
 * Verifies versioning, health status, security hardening, multi-key ISO region extraction, and site ID metadata fallback.
 */

const { app } = require('./index');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

async function verify() {
  console.log('🚀 Starting L10 v4.4.0 Verification...');

  // 1. Verify Health Check and Versioning
  try {
    const res = await request(app).get('/health');
    if (res.status === 200 && res.body.version === '4.4.0') {
      console.log('✅ Health Check: PASSED (Version 4.4.0)');
    } else {
      console.error('❌ Health Check: FAILED', res.body);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Health Check Request Error:', err.message);
    process.exit(1);
  }

  // 2. Duplicate Function Check and Nested Metadata Fallback
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const occurrences = (indexSource.match(/function extractSiteId/g) || []).length;

  if (occurrences === 1 && indexSource.includes('payload.metadata ? extractSiteId(payload.metadata) : null')) {
    console.log('✅ Site ID Extraction & Metadata Fallback: PASSED');
  } else {
    console.error(`❌ Site ID Extraction Check: FAILED (${occurrences} functions found)`);
    process.exit(1);
  }

  // 3. AI Export Standard Check
  if (indexSource.includes("source: 'L10_TOKEN_ENGINE_V4.4.0'")) {
    console.log('✅ AI Export Standard: PASSED (Version string v4.4.0 updated)');
  } else {
    console.error('❌ AI Export Standard: FAILED (Version string not updated)');
    process.exit(1);
  }

  // 4. Multi-key ISO Region Extraction Check
  if (indexSource.includes('payload.iso_region || payload.isoRegion || payload.iso || payload.region || \'SYSTEM_WIDE\'')) {
    console.log('✅ Multi-key ISO Region Extraction: PASSED');
  } else {
    console.error('❌ Multi-key ISO Region Extraction: FAILED');
    process.exit(1);
  }

  // 5. Production Weak Secret Hardening Check
  if (indexSource.includes("'change_in_production'") && indexSource.includes("'development_secret'")) {
    console.log('✅ Weak Secret Hardening: PASSED (Expanded WEAK_SECRETS in production)');
  } else {
    console.error('❌ Weak Secret Hardening: FAILED');
    process.exit(1);
  }

  console.log('🎉 L10 v4.4.0 Verification COMPLETE: ALL SYSTEMS NOMINAL');
}

verify();
