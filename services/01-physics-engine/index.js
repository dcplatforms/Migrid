const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function start() {
  await client.connect();
  console.log("✅ [L1 Physics] Connected to Ledger.");
  
  // Listen for new sessions to audit
  client.query('LISTEN new_charging_session');
  client.on('notification', async (msg) => {
    console.log("⚡ Received Session for Audit:", msg.payload);
    // Call verify_charging_session() function here
  });
}

start();
