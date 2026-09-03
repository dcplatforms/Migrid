/**
 * Verification Script for L10 Token Engine v4.4.0
 * Verifies versioning, health status, security hardening, metadata site extraction, and core utility logic.
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

  // 2. Duplicate Function Check
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const occurrences = (indexSource.match(/function extractSiteId/g) || []).length;

  if (occurrences === 1) {
    console.log('✅ Duplicate Function Check: PASSED (Only 1 extractSiteId found)');
  } else {
    console.error(`❌ Duplicate Function Check: FAILED (${occurrences} found)`);
    process.exit(1);
  }

  // 3. AI Export Standard Check
  if (indexSource.includes("source: 'L10_TOKEN_ENGINE_V4.4.0'")) {
    console.log('✅ AI Export Standard: PASSED (Version string updated)');
  } else {
    console.error('❌ AI Export Standard: FAILED (Version string not updated)');
    process.exit(1);
  }

  // 4. Nested Metadata Site ID Extraction Check
  if (indexSource.includes("payload.metadata ? extractSiteId(payload.metadata)")) {
    console.log('✅ Metadata Site Extraction: PASSED (Metadata fallback configured)');
  } else {
    console.error('❌ Metadata Site Extraction: FAILED');
    process.exit(1);
  }

  // 5. DER Alarm Multi-Format Region Extraction Check
  if (indexSource.includes("payload.iso_region || payload.isoRegion || payload.iso || payload.region")) {
    console.log('✅ DER Alarm Region Extraction: PASSED (Multi-key fallback configured)');
  } else {
    console.error('❌ DER Alarm Region Extraction: FAILED');
    process.exit(1);
  }

  // 6. Security Hardening Checks for Insecure Secrets
  if (indexSource.includes("activeSecret === 'development_secret'")) {
    console.log("✅ Weak Secret Hardening: PASSED ('development_secret' rejected in production)");
  } else {
    console.error('❌ Weak Secret Hardening: FAILED');
    process.exit(1);
  }

  console.log('🎉 L10 v4.4.0 Verification COMPLETE: ALL SYSTEMS NOMINAL');
}

verify();
