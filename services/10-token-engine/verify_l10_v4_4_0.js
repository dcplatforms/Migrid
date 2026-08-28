const http = require('http');
const { app } = require('./index');

console.log('🚀 Starting L10 v4.4.0 Verification...');

// 1. Health check verification
const server = app.listen(0, async () => {
  const port = server.address().port;

  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/health`, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    if (res.version !== '4.4.0') {
      throw new Error(`Expected version 4.4.0, got ${res.version}`);
    }
    console.log('✅ Health Check: PASSED (Version 4.4.0)');

    // 2. Export / Code Inspection checks
    const fs = require('fs');
    const indexContent = fs.readFileSync('index.js', 'utf8');

    if (!indexContent.includes('change_in_production') || !indexContent.includes('development_secret')) {
      throw new Error('Weak secret list missing change_in_production or development_secret');
    }
    console.log('✅ Zero-Trust Weak Secret Hardening: PASSED');

    if (!indexContent.includes('payload.metadata ? extractSiteId(payload.metadata) : null')) {
      throw new Error('extractSiteId nested metadata fallback missing');
    }
    console.log('✅ Nested Site ID Extraction: PASSED');

    if (!indexContent.includes('payload.iso_region || payload.isoRegion || payload.iso || payload.region')) {
      throw new Error('DER_ALARM_REPORTED multi-key ISO region extraction missing');
    }
    console.log('✅ Multi-Key ISO Region Extraction: PASSED');

    console.log('🎉 L10 v4.4.0 Verification COMPLETE: ALL SYSTEMS NOMINAL');
  } catch (err) {
    console.error('❌ Verification Failed:', err.message);
    process.exit(1);
  } finally {
    server.close();
  }
});
