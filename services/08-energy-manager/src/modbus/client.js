// const ModbusRTU = require('modbus-serial');
const { updateBuildingLoad } = require('../state/topologyMgr');

class ModbusClient {
    constructor(siteId, host, port) {
        this.siteId = siteId;
        this.host = host;
        this.port = port;
        // this.client = new ModbusRTU();
        this.interval = null;
    }

    async connect() {
        console.log(`[L8 Modbus] Connecting to ${this.host}:${this.port} for site ${this.siteId}`);
        // await this.client.connectTCP(this.host, { port: this.port });
    }

    startPolling(intervalMs = 5000) {
        this.interval = setInterval(async () => {
            try {
                // In production:
                // const data = await this.client.readHoldingRegisters(0, 1);
                // const loadKw = data.data[0];

                // Simulation:
                const loadKw = 200 + Math.random() * 50;

                await updateBuildingLoad(this.siteId, loadKw);
            } catch (error) {
                console.error(`[L8 Modbus] Polling error for site ${this.siteId}:`, error.message);
                // Trigger Safe Mode by setting load to 0 or null
                await updateBuildingLoad(this.siteId, 0);
            }
        }, intervalMs);
    }

    stopPolling() {
        if (this.interval) clearInterval(this.interval);
    }
}

module.exports = ModbusClient;
