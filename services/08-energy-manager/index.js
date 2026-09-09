/**
 * L8: Energy Manager
 * Modular bootstrap for Dynamic Load Management
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { startEngine } = require('./src/loop/dlmEngine');
const { connectProducer } = require('./src/events/producer');
const { connectConsumer } = require('./src/events/consumer');
const { setSiteConfig } = require('./src/state/topologyMgr');
const { startSiteSimulator } = require('./src/sim/siteSimulator');
const { getSiteEnergy, getSiteEnergySeries } = require('./src/api/telemetry');
const ModbusClient = require('./src/modbus/client');

const app = express();
const port = process.env.PORT || 3008;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const SITE_ID = process.env.SITE_ID || 'LOCAL-DEPOT-001';
const MODBUS_HOST = process.env.MODBUS_HOST || '192.168.1.100';
const MODBUS_PORT = parseInt(process.env.MODBUS_PORT || 502);
const DEFAULT_GRID_LIMIT_KW = parseFloat(process.env.GRID_CONNECTION_LIMIT_KW || '250');

app.use(express.json());

// Permissive CORS for local dev tooling (the Admin Portal proxies through Vite).
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.get('/health', (req, res) => {
    res.json({
        service: 'energy-manager',
        version: '2.1.0',
        status: 'healthy',
        siteId: SITE_ID,
    });
});

app.get('/api/site/energy', async (req, res) => {
    try {
        const data = await getSiteEnergy(req.query.siteId || SITE_ID);
        res.json(data);
    } catch (error) {
        console.error('❌ [L8] /api/site/energy error:', error.message);
        res.status(503).json({ error: 'TELEMETRY_UNAVAILABLE', message: error.message });
    }
});

app.get('/api/site/energy/series', async (req, res) => {
    try {
        const data = await getSiteEnergySeries(req.query.siteId || SITE_ID);
        res.json(data);
    } catch (error) {
        console.error('❌ [L8] /api/site/energy/series error:', error.message);
        res.status(503).json({ error: 'TELEMETRY_UNAVAILABLE', message: error.message });
    }
});

/**
 * Bring up runtime dependencies. Each dependency degrades independently so the
 * telemetry API stays available even when Postgres, Kafka, or the site meter
 * are offline (mirrors the resilient "offline mode" used by the L1 engine).
 */
async function bootstrap() {
    console.log(`🚀 [L8] Bootstrapping Energy Manager for Site: ${SITE_ID}`);

    // 1. Initial configuration from Postgres (fall back to a default limit).
    let gridLimit = DEFAULT_GRID_LIMIT_KW;
    try {
        const fleetResult = await pool.query('SELECT grid_connection_limit_kw FROM fleets LIMIT 1');
        gridLimit = fleetResult.rows[0]?.grid_connection_limit_kw || DEFAULT_GRID_LIMIT_KW;
        console.log(`✅ [L8] Site config loaded from Postgres. Grid Limit: ${gridLimit}kW`);
    } catch (error) {
        console.warn(`⚠️  [L8] Postgres unavailable (${error.message}). Using default grid limit ${gridLimit}kW.`);
    }

    try {
        await setSiteConfig(SITE_ID, { max_capacity_kw: gridLimit });
    } catch (error) {
        console.error('❌ [L8] Failed to persist site config to Redis:', error.message);
    }

    // 2. Initialize Modbus meter interface (stub in dev).
    try {
        const modbus = new ModbusClient(SITE_ID, MODBUS_HOST, MODBUS_PORT);
        await modbus.connect();
    } catch (error) {
        console.warn(`⚠️  [L8] Modbus meter offline (${error.message}).`);
    }

    // 3. Start the live site-telemetry simulator (site meter surrogate) before
    //    touching Kafka so the dashboard has data immediately even if the broker
    //    is offline.
    try {
        await startSiteSimulator(SITE_ID);
    } catch (error) {
        console.error('❌ [L8] Failed to start site simulator:', error.message);
    }

    // 4. Start the DLM control loop.
    try {
        startEngine(SITE_ID);
    } catch (error) {
        console.error('❌ [L8] Failed to start DLM engine:', error.message);
    }

    // 5. Connect Kafka in the background (helpers swallow their own errors, and
    //    retries must not block telemetry from coming online).
    connectProducer().catch(() => {});
    connectConsumer().catch(() => {});
}

app.listen(port, () => {
    console.log(`✅ [L8] Energy Manager API running on port ${port}`);
    bootstrap().catch((error) => {
        console.error('❌ [L8] Bootstrap failure (API remains up):', error.message);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[L8] Shutting down gracefully...');
    pool.end();
    process.exit(0);
});

module.exports = { app };
