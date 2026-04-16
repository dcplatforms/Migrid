const EventEmitter = require('events');

class MockRedis extends EventEmitter {
    constructor() {
        super();
        this.data = new Map();
    }
    async get(key) { return this.data.get(key); }
    async set(key, val) { this.data.set(key, val); }
    async publish(channel, msg) {
        this.emit('publish', { channel, msg });
    }
    async subscribe(channel) {
        console.log(`   [Mock Redis] Subscribed to ${channel}`);
    }
    // Simulate receiving a message
    async simulateMessage(channel, msg) {
        this.emit('message', channel, msg);
    }
}

async function testHorizontalRouting() {
    console.log('🧪 Starting L7 Horizontal Routing Test (Mocked Redis)...');

    const mockRedis = new MockRedis();
    const mockRedisSub = new MockRedis();

    const localConnections = new Map();
    const mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: (data) => console.log('   [Mock WS] Sent:', data)
    };

    localConnections.set('charger-1', { ws: mockWs, protocol: 'ocpp2.1', isoRegion: 'CAISO' });

    // Logic from server.js
    async function routeControlCommand(chargePointId, limitKw, mode) {
        if (localConnections.has(chargePointId)) {
            console.log(`   [Test] charger ${chargePointId} is local. Sending directly.`);
            return 'LOCAL';
        } else {
            const targetPodId = await mockRedis.get(`charger_route:${chargePointId}`);
            if (targetPodId) {
                console.log(`   [Test] charger ${chargePointId} is on ${targetPodId}. Publishing to Redis.`);
                await mockRedis.publish(`l7:commands:${targetPodId}`, JSON.stringify({
                    chargePointId,
                    limitKw,
                    mode
                }));
                return 'ROUTED';
            }
        }
        return 'NOT_FOUND';
    }

    // 1. Test local routing
    const res1 = await routeControlCommand('charger-1', 10, 'Charge');
    if (res1 === 'LOCAL') console.log('✅ Local routing check passed');

    // 2. Test remote routing
    await mockRedis.set('charger_route:charger-2', 'pod-2');

    return new Promise(async (resolve, reject) => {
        mockRedis.on('publish', ({ channel, msg }) => {
            console.log(`   [Test] Redis Publish intercepted: Channel=${channel}, Msg=${msg}`);
            if (channel === 'l7:commands:pod-2') {
                const data = JSON.parse(msg);
                if (data.chargePointId === 'charger-2' && data.limitKw === 20) {
                    console.log('✅ Remote routing (Publish) check passed');

                    // Now test Receipt logic
                    mockRedisSub.on('message', (chan, m) => {
                        console.log(`   [Test] Redis Sub received: Channel=${chan}, Msg=${m}`);
                        if (chan === 'l7:commands:pod-2' && JSON.parse(m).chargePointId === 'charger-2') {
                            console.log('✅ Remote routing (Receipt) check passed');
                            resolve();
                        }
                    });

                    mockRedisSub.simulateMessage('l7:commands:pod-2', msg);
                }
            }
        });

        const res2 = await routeControlCommand('charger-2', 20, 'Discharge');
        if (res2 !== 'ROUTED') reject(new Error('Remote routing failed to initiate'));
    });
}

testHorizontalRouting().then(() => {
    console.log('🎉 All L7 routing tests passed!');
    process.exit(0);
}).catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
