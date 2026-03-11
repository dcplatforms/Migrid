/**
 * L7: Device Gateway (OCPP & ISO 15118)
 * Modular Architecture Implementation (Phase 5)
 */

const { startServer } = require('./src/server');

async function bootstrap() {
    try {
        console.log('🚀 [L7] Bootstrapping Device Gateway modular core...');
        await startServer();
    } catch (error) {
        console.error('❌ [L7] Bootstrap failure:', error);
        process.exit(1);
    }
}

bootstrap();
