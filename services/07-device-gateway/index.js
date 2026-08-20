/**
 * L7: Device Gateway (OCPP & ISO 15118)
 * Modular Architecture Implementation (Phase 5)
 */

const { app, startServer } = require('./src/server');

async function bootstrap() {
    try {
        console.log('🚀 [L7] Bootstrapping Device Gateway modular core...');
        await startServer();
    } catch (error) {
        console.error('❌ [L7] Bootstrap failure:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    bootstrap();
}

module.exports = { app, startServer };
