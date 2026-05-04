const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { redis, redisSub, registerConnection, removeConnection } = require('./state/connectionMgr');
const { handleOcppMessage } = require('./ocpp/handler');
const { connectProducer, publishSessionEvent } = require('./events/producer');
const { connectConsumer } = require('./events/consumer');
const config = require('./config');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: config.databaseUrl,
});

const podId = process.env.POD_ID || 'gateway-instance-1';

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
  res.json({
    service: 'Device Gateway',
    layer: 'L7',
    status: 'OK',
    version: '5.6.0',
    podId: process.env.POD_ID || 'gateway-instance-1'
  });
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

    // Cache resource type in Redis for high-fidelity telemetry performance
    const resourceRes = await pool.query('SELECT resource_type FROM vpp_resources WHERE vehicle_id = $1', [vehicle_id]);
    const resourceType = resourceRes.rows[0]?.resource_type || 'EV';
    await redis.set(`charger_resource:${evse_id}`, resourceType, 'EX', 86400); // 24h cache

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

      // Cleanup resource cache
      await redis.del(`charger_resource:${evse_id}`);

      const rawRegion = await redis.get(`charger_region:${evse_id}`) || 'CAISO';
      const isoRegion = rawRegion.toUpperCase().replace(/-/g, '');

      await publishSessionEvent('SESSION_COMPLETED', {
        sessionId: session.id,
        vehicleId: vehicle_id,
        energyDispensedKwh: energy_dispensed_kwh,
        timestamp: new Date().toISOString(),
        evseId: evse_id,
        iso_region: isoRegion,
        protocol: 'iso15118'
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

// Protocols supported by MiGrid, prioritized (highest first)
const SUPPORTED_PROTOCOLS = ['ocpp2.1', 'ocpp2.0.1'];

const handleControlSignal = async (topic, payload) => {
    // 1. Verify the Physics: Check for L1 Safety Lock before dispatching control
    const safetyLock = await redis.get('l1:safety:lock');
    if (safetyLock === '1' || safetyLock === 'true') {
        console.warn(`🛑 [L7] Control Signal HALTED. L1 Safety Lock is ACTIVE.`);
        return;
    }

    if (topic === 'migrid.l8.control') {
        // DLM update for multiple chargers
        for (const allocation of payload.allocations) {
            await routeControlCommand(allocation.chargePointId, allocation.limitKw, 'Charge');
        }
    } else if (topic === 'migrid.l3.v2g') {
        // Specific V2G/V2X Dispatch
        await routeControlCommand(payload.chargePointId, payload.limitKw, payload.mode || 'Discharge');
    }
};

/**
 * Routes a control command to the correct L7 instance.
 */
async function routeControlCommand(chargePointId, limitKw, mode) {
    if (localConnections.has(chargePointId)) {
        await sendSetChargingProfile(chargePointId, limitKw, mode);
    } else {
        // Look up target pod for this charger
        const targetPodId = await redis.get(`charger_route:${chargePointId}`);
        if (targetPodId) {
            console.log(`[L7] Routing command for ${chargePointId} to pod ${targetPodId} via Redis Pub/Sub`);
            await redis.publish(`l7:commands:${targetPodId}`, JSON.stringify({
                chargePointId,
                limitKw,
                mode
            }));
        } else {
            console.warn(`⚠️ [L7] No route found for charger ${chargePointId}. Command dropped.`);
        }
    }
}

async function sendSetChargingProfile(chargePointId, limitKw, mode) {
    const connection = localConnections.get(chargePointId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ [L7] Cannot send command to ${chargePointId}: Connection not open locally.`);
        return;
    }

    const rawRegion = await redis.get(`charger_region:${chargePointId}`) || 'CAISO';
    const isoRegion = rawRegion.toUpperCase().replace(/-/g, '');
    const gridLock = await redis.get(`l4:grid:lock:${isoRegion}`);
    if (gridLock === '1' || gridLock === 'true') {
        console.warn(`🛑 [L7] Control Signal HALTED for ${chargePointId}. L4 GRID LOCK in ${isoRegion} is ACTIVE.`);
        return;
    }

    const { ws, protocol } = connection;
    console.log(`[L7] Dispatching ${mode} to ${chargePointId} (${limitKw}kW) via ${protocol}`);

    let profile;
    if (protocol === 'ocpp2.1') {
        // Native OCPP 2.1 Profile
        profile = {
            id: Math.floor(Math.random() * 1000),
            stackLevel: mode === 'Discharge' ? 1 : 0,
            chargingProfilePurpose: mode === 'Discharge' ? 'V2XProfile' : 'TxProfile',
            chargingProfileKind: 'Absolute',
            energyTransferMode: mode === 'Discharge' ? 'Discharge' : 'Charge',
            chargingSchedule: [{
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{ startPeriod: 0, limit: Math.abs(limitKw) * 1000 }]
            }]
        };
    } else {
        // OCPP 2.0.1 Translation (Legacy "Negative Limit" Hack)
        profile = {
            id: Math.floor(Math.random() * 1000),
            stackLevel: 0,
            chargingProfilePurpose: 'TxProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: [{
                chargingRateUnit: 'W',
                chargingSchedulePeriod: [{
                    startPeriod: 0,
                    limit: (mode === 'Discharge' ? -Math.abs(limitKw) : limitKw) * 1000
                }]
            }]
        };
    }

    const call = [2, Date.now().toString(), 'SetChargingProfile', {
        evseId: 1,
        chargingProfile: profile
    }];
    ws.send(JSON.stringify(call));
}

server.on('upgrade', (request, socket, head) => {
    const urlParts = request.url.split('/');
    const chargePointId = urlParts[urlParts.length - 1];

    if (!chargePointId || !request.url.includes('/ocpp')) {
        return;
    }

    // 2. Parse the requested protocols from the hardware
    const requestedProtocols = request.headers['sec-websocket-protocol']
        ? request.headers['sec-websocket-protocol'].split(',').map(p => p.trim())
        : [];

    // 3. Negotiate the protocol (find the highest overlap)
    const negotiatedProtocol = SUPPORTED_PROTOCOLS.find(p => requestedProtocols.includes(p));

    if (!negotiatedProtocol) {
        console.warn(`🛑 [L7] Protocol negotiation failed for ${chargePointId}. Requested: ${requestedProtocols.join(', ')}`);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, chargePointId, negotiatedProtocol);
    });
});

wss.on('connection', async (ws, request, chargePointId, protocol) => {
    console.log(`[L7] Charger Connected: ${chargePointId} | Protocol: ${protocol}`);

    const chargerRes = await pool.query('SELECT iso_region, location_id FROM chargers WHERE serial_number = $1', [chargePointId]);
    const rawRegion = chargerRes.rows[0]?.iso_region || 'CAISO';
    const isoRegion = rawRegion.toUpperCase().replace(/-/g, '');
    const siteId = chargerRes.rows[0]?.location_id;

    localConnections.set(chargePointId, { ws, protocol, isoRegion, siteId });
    await registerConnection(chargePointId, podId, isoRegion);

    // Cache site metadata for low-latency telemetry (L1 multi-site awareness)
    if (siteId) {
        await redis.set(`charger_site:${chargePointId}`, siteId, 'EX', 86400);
    }

    await publishSessionEvent('CHARGER_CONNECTED', {
        chargePointId,
        podId,
        iso_region: isoRegion,
        protocol,
        timestamp: new Date().toISOString()
    });

    ws.on('message', async (data) => {
        // Pass negotiated protocol to the handler
        await handleOcppMessage(chargePointId, data, ws, protocol);
    });

    ws.on('close', async () => {
        console.log(`[L7] Charger Disconnected: ${chargePointId}`);
        localConnections.delete(chargePointId);
        await removeConnection(chargePointId);

        await publishSessionEvent('CHARGER_DISCONNECTED', {
            chargePointId,
            podId,
            timestamp: new Date().toISOString()
        });
    });
});

async function startServer() {
    await connectProducer();
    await connectConsumer(handleControlSignal);

    // Subscribe to commands routed from other L7 pods
    await redisSub.subscribe(`l7:commands:${podId}`);
    redisSub.on('message', async (channel, message) => {
        try {
            const { chargePointId, limitKw, mode } = JSON.parse(message);
            console.log(`[L7] Received routed command from Redis for ${chargePointId}`);
            await sendSetChargingProfile(chargePointId, limitKw, mode);
        } catch (e) {
            console.error('[L7] Error processing routed command:', e.message);
        }
    });

    server.listen(config.port, () => {
        console.log(`[L7] Device Gateway listening on port ${config.port} (Pod: ${podId})`);
    });
}

module.exports = { startServer };
