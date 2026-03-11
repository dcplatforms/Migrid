const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { registerConnection, removeConnection } = require('./state/connectionMgr');
const { handleOcppMessage } = require('./ocpp/handler');
const { connectProducer, publishSessionEvent } = require('./events/producer');
const { connectConsumer } = require('./events/consumer');
const config = require('./config');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Local memory map for active WebSocket connections on this instance
const localConnections = new Map();

// Middleware for auth
const authenticateInternal = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  jwt.verify(token, config.jwtSecret, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

// --- HTTP Endpoints ---

app.get('/health', (req, res) => {
  res.json({ service: 'Device Gateway', layer: 'L7', status: 'OK', podId: process.env.POD_ID || 'gateway-instance-1' });
});

app.post('/iso15118/authenticate', async (req, res) => {
  const { contract_id, certificate_chain } = req.body;
  if (!certificate_chain || certificate_chain.length < 2) {
    return res.status(400).json({ status: 'FAILED', reason: 'Invalid certificate chain' });
  }

  try {
    const result = await pool.query('SELECT id, fleet_id FROM vehicles WHERE vin = $1', [contract_id]);
    if (result.rows.length === 0) return res.status(404).json({ status: 'FAILED', reason: 'Unknown Contract ID' });

    const vehicle = result.rows[0];
    const token = jwt.sign({ vehicle_id: vehicle.id, fleet_id: vehicle.fleet_id }, config.jwtSecret);
    res.json({ status: 'ACCEPTED', auth_token: token });
  } catch (err) {
    console.error('[L7 Auth Error]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/iso15118/v2g-discharge', authenticateInternal, async (req, res) => {
  const { evse_id, discharge_amount_kw } = req.body;
  const { vehicle_id } = req.user;

  try {
    const resSoc = await pool.query('SELECT current_soc FROM vehicles WHERE id = $1', [vehicle_id]);
    const current_soc = parseFloat(resSoc.rows[0]?.current_soc);

    if (current_soc < config.bessSafetyMinSoc) {
      return res.status(403).json({
        status: 'REJECTED',
        reason: 'CAPACITY_VIOLATION',
        message: 'BESS Discharge Forbidden: SoC below 20% hard limit.'
      });
    }

    console.log(`⚡ [L7] V2G Discharge initiated for vehicle ${vehicle_id} at ${evse_id}`);
    res.json({ status: 'EXECUTING', discharge_amount_kw });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/iso15118/start-charge', authenticateInternal, async (req, res) => {
  const { evse_id } = req.body;
  const { vehicle_id } = req.user;
  try {
    await pool.query('UPDATE vehicles SET is_plugged_in = true WHERE id = $1', [vehicle_id]);
    const chargerRes = await pool.query('SELECT id FROM chargers WHERE serial_number = $1', [evse_id]);
    const charger_id = chargerRes.rows[0]?.id;

    await pool.query(
      'INSERT INTO charging_sessions (vehicle_id, charger_id, start_time, start_soc) VALUES ($1, $2, NOW(), (SELECT current_soc FROM vehicles WHERE id = $1))',
      [vehicle_id, charger_id]
    );
    res.status(201).json({ status: 'CHARGING', vehicle_id });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/iso15118/stop-charge', authenticateInternal, async (req, res) => {
  const { evse_id, energy_dispensed_kwh } = req.body;
  const { vehicle_id } = req.user;
  try {
    const sessionRes = await pool.query(
      'SELECT id FROM charging_sessions WHERE vehicle_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
      [vehicle_id]
    );
    const session = sessionRes.rows[0];

    if (session) {
      await pool.query(
        'UPDATE charging_sessions SET end_time = NOW(), energy_dispensed_kwh = $1 WHERE id = $2',
        [energy_dispensed_kwh, session.id]
      );
      await pool.query('UPDATE vehicles SET is_plugged_in = false WHERE id = $1', [vehicle_id]);

      await publishSessionEvent('SESSION_COMPLETED', {
        sessionId: session.id,
        vehicleId: vehicle_id,
        energyDispensedKwh: energy_dispensed_kwh,
        timestamp: new Date().toISOString(),
        evseId: evse_id
      });
    }
    res.json({ status: 'STOPPED', sessionId: session?.id });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// --- WebSocket & OCPP ---

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const handleControlSignal = async (topic, payload) => {
    const { chargePointId, limitKw, schedule } = payload;
    const ws = localConnections.get(chargePointId);

    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log(`[L7] Sending SetChargingProfile to ${chargePointId} (${limitKw}kW)`);
        // OCPP 2.0.1 SetChargingProfile Call
        const call = [2, Date.now().toString(), 'SetChargingProfile', {
            evseId: 1, // Simplified
            chargingProfile: {
                id: 101,
                stackLevel: 0,
                chargingProfilePurpose: 'TxProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: [{
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: limitKw * 1000 }]
                }]
            }
        }];
        ws.send(JSON.stringify(call));
    }
};

server.on('upgrade', (request, socket, head) => {
    const urlParts = request.url.split('/');
    const chargePointId = urlParts[urlParts.length - 1];

    if (!chargePointId || !request.url.includes('/ocpp')) {
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, chargePointId);
    });
});

wss.on('connection', async (ws, request, chargePointId) => {
    console.log(`[L7] Charger Connected: ${chargePointId}`);
    const podId = process.env.POD_ID || 'gateway-instance-1';

    localConnections.set(chargePointId, ws);
    await registerConnection(chargePointId, podId);

    ws.on('message', async (data) => {
        await handleOcppMessage(chargePointId, data, ws);
    });

    ws.on('close', async () => {
        console.log(`[L7] Charger Disconnected: ${chargePointId}`);
        localConnections.delete(chargePointId);
        await removeConnection(chargePointId);
    });
});

async function startServer() {
    await connectProducer();
    await connectConsumer(handleControlSignal);

    server.listen(config.port, () => {
        console.log(`[L7] Device Gateway listening on port ${config.port}`);
    });
}

module.exports = { startServer };
