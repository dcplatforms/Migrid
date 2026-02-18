const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
const port = process.env.PORT || 3007;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Device Gateway' });
});

/**
 * L7: ISO 15118 Certificate-Based Authentication
 * This is a simplified implementation of the Plug & Charge handshake.
 */
app.post('/iso15118/authenticate', async (req, res) => {
  const { contract_id, certificate_chain, challenge_signature } = req.body;

  console.log(`🔐 [L7] Authenticating vehicle with Contract ID: ${contract_id}`);

  // In a real implementation, we would:
  // 1. Verify the certificate chain against the V2G Root CA.
  // 2. Verify the challenge signature using the public key from the certificate.
  // 3. Check if the contract is valid and not blacklisted.

  // Simplified logic for this implementation:
  if (!contract_id || !certificate_chain) {
    return res.status(400).json({ status: 'FAILED', reason: 'Missing credentials' });
  }

  try {
    // Check if vehicle exists with this contract ID (in our case, we might use VIN or a dedicated field)
    const result = await pool.query('SELECT * FROM vehicles WHERE vin = $1', [contract_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'FAILED', reason: 'Unknown Contract ID' });
    }

    const vehicle = result.rows[0];

    // Simulate successful authentication
    console.log(`✅ [L7] Authentication successful for Vehicle: ${vehicle.id}`);

    const token = jwt.sign({ vehicle_id: vehicle.id, fleet_id: vehicle.fleet_id }, process.env.JWT_SECRET || 'secret');

    res.json({
      status: 'ACCEPTED',
      auth_token: token,
      v2g_session_id: `v2g-${Date.now()}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Plug & Charge: Start Session automatically after authentication
 */
app.post('/iso15118/start-charge', async (req, res) => {
  const { auth_token, evse_id } = req.body;

  try {
    const decoded = jwt.verify(auth_token, process.env.JWT_SECRET || 'secret');
    const { vehicle_id } = decoded;

    console.log(`⚡ [L7] Plug & Charge started for Vehicle: ${vehicle_id} at EVSE: ${evse_id}`);

    // Update vehicle status
    await pool.query('UPDATE vehicles SET is_plugged_in = true WHERE id = $1', [vehicle_id]);

    // Create a new charging session
    const sessionResult = await pool.query(
      'INSERT INTO charging_sessions (vehicle_id, start_time, start_soc) VALUES ($1, NOW(), (SELECT current_soc FROM vehicles WHERE id = $1)) RETURNING *',
      [vehicle_id]
    );

    res.status(201).json(sessionResult.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired auth token' });
  }
});

app.listen(port, () => {
  console.log(`🔌 Device Gateway listening at http://localhost:${port}`);
});
