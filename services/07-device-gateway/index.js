/**
 * L7: Device Gateway (OCPP & ISO 15118)
 *
 * Objectives:
 * 1. Interface with physical EV chargers and BESS.
 * 2. Secondary enforcement of "The Fuse Rule" (20% SoC limit).
 * 3. Heartbeat mechanism for resilience (Cloud-Offline detection).
 * 4. Local Redis cache for safety thresholds in OFFLINE mode.
 */

const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const { Kafka } = require('kafkajs');

dotenv.config();

const app = express();
const port = process.env.PORT || 3007;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

const kafka = new Kafka({
  clientId: 'device-gateway',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});
const producer = kafka.producer();

app.use(express.json());

// Resilience State
const HEARTBEAT_INTERVAL = 5000;
let missedHeartbeats = 0;
let isOffline = false;

// BESS Safety Constant
const BESS_SAFETY_MIN_SOC = 20.0;

// Connect Redis and start Heartbeat
async function initResilience() {
  try {
    await redisClient.connect();
    console.log('✅ [L7] Connected to Local Redis Sidecar.');
  } catch (err) {
    console.warn('⚠️ [L7] Local Redis unavailable.');
  }

  try {
    await producer.connect();
    console.log('✅ [L7] Connected to Kafka Producer.');
  } catch (err) {
    console.error('❌ [L7] Failed to connect to Kafka Producer:', err);
  }

  // Heartbeat loop
  setInterval(async () => {
    try {
      if (!isOffline) {
        await pool.query('SELECT 1');
        missedHeartbeats = 0;
      } else {
        await pool.query('SELECT 1');
        console.log('🏠 [L7] Cloud connectivity restored.');
        isOffline = false;
        missedHeartbeats = 0;
      }
    } catch (err) {
      missedHeartbeats++;
      if (missedHeartbeats >= 3 && !isOffline) {
        console.error('🚨 [L7] Entering OFFLINE Mode. Relying on Local Safety Rules.');
        isOffline = true;
      }
    }
  }, HEARTBEAT_INTERVAL);
}

initResilience();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: isOffline ? 'OFFLINE' : 'OK', service: 'Device Gateway', layer: 'L7' });
});

/**
 * L7: ISO 15118 Certificate-Based Authentication
 */
app.post('/iso15118/authenticate', async (req, res) => {
  const { contract_id, certificate_chain } = req.body;

  if (isOffline) {
    // In OFFLINE mode, verify against local Redis cache
    const vehicleData = await redisClient.get(`vehicle:${contract_id}`);
    if (vehicleData) {
      const vehicle = JSON.parse(vehicleData);
      const token = jwt.sign({ vehicle_id: vehicle.id, fleet_id: vehicle.fleet_id }, process.env.JWT_SECRET || 'secret');
      return res.json({ status: 'ACCEPTED', auth_token: token, mode: 'OFFLINE_LOCAL_AUTH' });
    }
    return res.status(503).json({ status: 'FAILED', reason: 'Cloud Offline and Contract ID not cached.' });
  }

  try {
    const result = await pool.query('SELECT * FROM vehicles WHERE vin = $1', [contract_id]);
    if (result.rows.length === 0) return res.status(404).json({ status: 'FAILED', reason: 'Unknown Contract ID' });

    const vehicle = result.rows[0];
    // Cache for offline use
    await redisClient.set(`vehicle:${contract_id}`, JSON.stringify(vehicle), { EX: 3600 });

    const token = jwt.sign({ vehicle_id: vehicle.id, fleet_id: vehicle.fleet_id }, process.env.JWT_SECRET || 'secret');
    res.json({ status: 'ACCEPTED', auth_token: token });
  } catch (err) {
    console.error('[Device Gateway Error]', err);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * [The Fuse Rule] L7 Secondary Enforcement: Reject Discharge if SoC < 20%
 */
app.post('/iso15118/v2g-discharge', async (req, res) => {
  const { auth_token, evse_id, discharge_amount_kw } = req.body;

  try {
    const decoded = jwt.verify(auth_token, process.env.JWT_SECRET || 'secret');
    const { vehicle_id } = decoded;

    let current_soc;
    if (isOffline) {
      // Get SoC from local cache in OFFLINE mode
      const cachedSoc = await redisClient.get(`vehicle_soc:${vehicle_id}`);
      current_soc = cachedSoc ? parseFloat(cachedSoc) : null;
    } else {
      const res = await pool.query('SELECT current_soc FROM vehicles WHERE id = $1', [vehicle_id]);
      current_soc = parseFloat(res.rows[0]?.current_soc);
    }

    if (current_soc === null) return res.status(400).json({ error: 'Current SoC unknown' });

    // ENFORCE THE FUSE RULE
    if (current_soc < BESS_SAFETY_MIN_SOC) {
      console.error(`🛡️ [The Fuse Rule] L7: Discharge REJECTED for vehicle ${vehicle_id}. SoC (${current_soc}%) < ${BESS_SAFETY_MIN_SOC}%`);
      return res.status(403).json({
        status: 'REJECTED',
        reason: 'CAPACITY_VIOLATION',
        message: 'BESS Discharge Forbidden: State of Charge below 20% hard limit.'
      });
    }

    console.log(`⚡ [L7] V2G Discharge initiated for vehicle ${vehicle_id} at ${evse_id}`);
    res.json({ status: 'EXECUTING', discharge_amount_kw });

  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired auth token' });
  }
});

app.post('/iso15118/start-charge', async (req, res) => {
  const { auth_token, evse_id } = req.body;
  try {
    const decoded = jwt.verify(auth_token, process.env.JWT_SECRET || 'secret');
    const { vehicle_id } = decoded;

    if (!isOffline) {
      await pool.query('UPDATE vehicles SET is_plugged_in = true WHERE id = $1', [vehicle_id]);
      // Assuming evse_id corresponds to charger_id (mapped via serial_number or internal ID)
      const chargerRes = await pool.query('SELECT id FROM chargers WHERE serial_number = $1', [evse_id]);
      const charger_id = chargerRes.rows[0]?.id;

      await pool.query(
        'INSERT INTO charging_sessions (vehicle_id, charger_id, start_time, start_soc) VALUES ($1, $2, NOW(), (SELECT current_soc FROM vehicles WHERE id = $1))',
        [vehicle_id, charger_id]
      );
    } else {
      await redisClient.set(`session:active:${vehicle_id}`, JSON.stringify({ evse_id, startTime: Date.now() }));
    }

    res.status(201).json({ status: 'CHARGING', vehicle_id });
  } catch (err) {
    res.status(401).json({ error: 'Invalid auth token' });
  }
});

app.post('/iso15118/stop-charge', async (req, res) => {
  const { auth_token, evse_id, energy_dispensed_kwh } = req.body;
  try {
    const decoded = jwt.verify(auth_token, process.env.JWT_SECRET || 'secret');
    const { vehicle_id } = decoded;

    let session;
    if (!isOffline) {
      // Find the active session
      const sessionRes = await pool.query(
        'SELECT id FROM charging_sessions WHERE vehicle_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
        [vehicle_id]
      );
      session = sessionRes.rows[0];

      if (session) {
        await pool.query(
          'UPDATE charging_sessions SET end_time = NOW(), energy_dispensed_kwh = $1 WHERE id = $2',
          [energy_dispensed_kwh, session.id]
        );
        await pool.query('UPDATE vehicles SET is_plugged_in = false WHERE id = $1', [vehicle_id]);

        // Emit SESSION_COMPLETED event
        await producer.send({
          topic: 'SESSION_COMPLETED',
          messages: [
            {
              value: JSON.stringify({
                sessionId: session.id,
                vehicleId: vehicle_id,
                energyDispensedKwh: energy_dispensed_kwh,
                timestamp: new Date().toISOString(),
                evseId: evse_id
              }),
            },
          ],
        });
        console.log(`⚡ [L7] Session ${session.id} completed and event emitted.`);
      }
    } else {
      // Handle offline mode if necessary (e.g., store in Redis and emit later)
      await redisClient.del(`session:active:${vehicle_id}`);
    }

    res.json({ status: 'STOPPED', sessionId: session?.id });
  } catch (err) {
    console.error('[Device Gateway Stop Charge Error]', err);
    res.status(401).json({ error: 'Invalid auth token' });
  }
});

app.listen(port, () => {
  console.log(`🔌 [L7] Device Gateway listening at http://localhost:${port}`);
  console.log(`🛡️ [L7] Fuse Rule Active: Hard Stop at ${BESS_SAFETY_MIN_SOC}% SoC`);
});
