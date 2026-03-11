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
const ModbusClient = require('./src/modbus/client');

const app = express();
const port = process.env.PORT || 3008;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

const SITE_ID = process.env.SITE_ID || 'LOCAL-DEPOT-001';
const MODBUS_HOST = process.env.MODBUS_HOST || '192.168.1.100';
const MODBUS_PORT = parseInt(process.env.MODBUS_PORT || 502);

async function bootstrap() {
    try {
        console.log(`🚀 [L8] Bootstrapping Energy Manager for Site: ${SITE_ID}`);

        // 1. Initial configuration from Postgres
        const fleetResult = await pool.query('SELECT grid_connection_limit_kw FROM fleets LIMIT 1');
        const gridLimit = fleetResult.rows[0]?.grid_connection_limit_kw || 500;

        await setSiteConfig(SITE_ID, {
            max_capacity_kw: gridLimit
        });
        console.log(`✅ [L8] Site config initialized. Grid Limit: ${gridLimit}kW`);

        // 2. Connect Kafka
        await connectProducer();
        await connectConsumer();

        // 3. Initialize Modbus polling
        const modbus = new ModbusClient(SITE_ID, MODBUS_HOST, MODBUS_PORT);
        await modbus.connect();
        modbus.startPolling();

        // 4. Start the DLM Control Loop
        startEngine(SITE_ID);

        // 5. Start Minimal API for health checks
        app.get('/health', (req, res) => {
            res.json({
                service: 'energy-manager',
                version: '2.0.0',
                status: 'healthy',
                siteId: SITE_ID
            });
        });

        app.listen(port, () => {
            console.log(`✅ [L8] Health API running on port ${port}`);
        });

    } catch (error) {
        console.error('❌ [L8] Bootstrap failure:', error);
        process.exit(1);
    }
}

bootstrap();

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[L8] Shutting down gracefully...');
    pool.end();
    process.exit(0);
});
