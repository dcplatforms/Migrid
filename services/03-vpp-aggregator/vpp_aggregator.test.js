const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock Redis
const mockRedisClient = {
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(),
    setEx: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
    keys: jest.fn().mockResolvedValue([]),
    sMembers: jest.fn().mockResolvedValue([]),
    sAdd: jest.fn().mockResolvedValue(),
    sRem: jest.fn().mockResolvedValue(),
    on: jest.fn()
};

jest.mock('redis', () => ({
    createClient: jest.fn().mockReturnValue(mockRedisClient)
}), { virtual: true });

// Mock Kafka
const mockConsumer = {
    connect: jest.fn().mockResolvedValue(),
    subscribe: jest.fn().mockResolvedValue(),
    run: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue()
};

const mockProducer = {
    connect: jest.fn().mockResolvedValue(),
    send: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue()
};

jest.mock('kafkajs', () => ({
    Kafka: jest.fn().mockImplementation(() => ({
        consumer: jest.fn().mockReturnValue(mockConsumer),
        producer: jest.fn().mockReturnValue(mockProducer)
    }))
}), { virtual: true });

// Mock PG
const mockPool = {
    query: jest.fn(),
    end: jest.fn().mockResolvedValue()
};

jest.mock('pg', () => ({
    Pool: jest.fn(() => mockPool)
}), { virtual: true });

// Require the app after mocks
const { app, updateGlobalCapacity } = require('./index');

const JWT_SECRET = 'dev_secret_change_in_production';
const mockToken = jwt.sign({ fleet_id: 'FLEET-001' }, JWT_SECRET);

describe('L3 VPP Aggregator Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /health should return status healthy', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('healthy');
        expect(response.body.layer).toBe('L3');
    });

    test('GET /capacity/available should return capacity from database', async () => {
        mockRedisClient.get.mockResolvedValue(null); // No cache, no safety lock
        mockPool.query.mockResolvedValue({
            rows: [{ raw_capacity_kwh: 150.5, vehicle_count: 3 }]
        });

        const response = await request(app)
            .get('/capacity/available')
            .set('Authorization', `Bearer ${mockToken}`);

        expect(response.status).toBe(200);
        expect(response.body.available_capacity_kwh).toBe(150.5);
        expect(response.body.resource_count).toBe(3);
        expect(mockPool.query).toHaveBeenCalled();
        expect(mockRedisClient.setEx).toHaveBeenCalled();
    });

    test('GET /capacity/available should return 0 when L1 safety lock is active', async () => {
        mockRedisClient.get.mockImplementation((key) => {
            if (key === 'l1:safety:lock') return Promise.resolve('1');
            return Promise.resolve(null);
        });

        const response = await request(app)
            .get('/capacity/available')
            .set('Authorization', `Bearer ${mockToken}`);

        expect(response.status).toBe(200);
        expect(response.body.available_capacity_kwh).toBe(0);
        expect(response.body.status).toBe('HALTED_BY_PHYSICS_SAFEGUARD');
        expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('GET /capacity/available should return 0 when L1 contextual safety lock is active', async () => {
        mockRedisClient.get.mockImplementation((key) => {
            if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({ vpp_active: true }));
            return Promise.resolve(null);
        });

        const response = await request(app)
            .get('/capacity/available')
            .set('Authorization', `Bearer ${mockToken}`);

        expect(response.status).toBe(200);
        expect(response.body.available_capacity_kwh).toBe(0);
        expect(response.body.status).toBe('HALTED_BY_PHYSICS_SAFEGUARD');
    });

    test('GET /capacity/available should exclude Safe Mode sites', async () => {
        mockRedisClient.get.mockResolvedValue(null);
        mockRedisClient.sMembers.mockResolvedValue(['SITE-001']);
        mockPool.query.mockResolvedValue({
            rows: [{ raw_capacity_kwh: 50, vehicle_count: 1 }]
        });

        const response = await request(app)
            .get('/capacity/available')
            .set('Authorization', `Bearer ${mockToken}`);

        expect(response.status).toBe(200);
        expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('!= ALL($2)'), expect.any(Array));
        expect(mockPool.query.mock.calls[0][1][1]).toContain('SITE-001');
    });

    test('GET /capacity/available should return cached capacity if available', async () => {
        const cachedData = {
            available_capacity_kwh: 100,
            available_capacity_kw: 100,
            resource_count: 2,
            timestamp: new Date().toISOString(),
            source: 'cache'
        };
        mockRedisClient.get.mockImplementation((key) => {
            if (key === 'vpp:capacity:available:FLEET-001') return Promise.resolve(JSON.stringify(cachedData));
            return Promise.resolve(null);
        });

        const response = await request(app)
            .get('/capacity/available')
            .set('Authorization', `Bearer ${mockToken}`);

        expect(response.status).toBe(200);
        expect(response.body.available_capacity_kwh).toBe(100);
        expect(response.body.source).toBe('cache');
        expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('POST /resources/register should register a resource', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [{ fleet_id: 'FLEET-001' }] }); // Vehicle check
        mockPool.query.mockResolvedValueOnce({ rows: [] }); // Insert

        const response = await request(app)
            .post('/resources/register')
            .set('Authorization', `Bearer ${mockToken}`)
            .send({
                vehicle_id: 'VEH-001',
                battery_capacity_kwh: 75,
                v2g_enabled: true,
                resource_type: 'BESS'
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('resource_type'), expect.arrayContaining(['BESS']));
    });

    test('POST /resources/register should reject invalid resource_type', async () => {
        const response = await request(app)
            .post('/resources/register')
            .set('Authorization', `Bearer ${mockToken}`)
            .send({
                vehicle_id: 'VEH-001',
                battery_capacity_kwh: 75,
                v2g_enabled: true,
                resource_type: 'INVALID'
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('resource_type must be EV or BESS');
    });

    describe('POST /dispatch/v2g', () => {
        test('should return 400 if input is invalid', async () => {
            const response = await request(app)
                .post('/dispatch/v2g')
                .set('Authorization', `Bearer ${mockToken}`)
                .send({ amountKw: 100 }); // Missing chargePointId

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('chargePointId is required');
        });

        test('should return 403 if charger belongs to another fleet (IDOR fix)', async () => {
            mockPool.query.mockResolvedValue({ rows: [] }); // Charger not found for this fleet

            const response = await request(app)
                .post('/dispatch/v2g')
                .set('Authorization', `Bearer ${mockToken}`)
                .send({
                    chargePointId: 'OTHER-CHG-001',
                    amountKw: 50
                });

            expect(response.status).toBe(403);
            expect(response.body.error).toContain('Forbidden');
        });

        test('should return 200 and dispatch if authorized', async () => {
            mockPool.query.mockResolvedValue({ rows: [{ id: 'UUID-123' }] }); // Charger belongs to fleet

            const response = await request(app)
                .post('/dispatch/v2g')
                .set('Authorization', `Bearer ${mockToken}`)
                .send({
                    chargePointId: 'CHG-001',
                    amountKw: 50
                });

            expect(response.status).toBe(200);
            expect(response.body.status).toBe('DISPATCHED');
            expect(mockProducer.send).toHaveBeenCalled();
        });

    test('updateGlobalCapacity should correctly aggregate regional EV/BESS data (v3.3.0 Bugfix)', async () => {
        mockRedisClient.get.mockResolvedValue(null); // No safety locks
        mockRedisClient.sMembers.mockResolvedValue([]); // No safe mode sites

        mockPool.query.mockResolvedValue({
            rows: [
                { region: 'CAISO', resource_type: 'EV', raw_capacity_kwh: 100 },
                { region: 'CAISO', resource_type: 'BESS', raw_capacity_kwh: 50 },
                { region: 'ERCOT', resource_type: 'EV', raw_capacity_kwh: 200 }
            ]
        });

        await updateGlobalCapacity();

        // Verify total capacity: 100 + 50 + 200 = 350
        expect(mockRedisClient.set).toHaveBeenCalledWith('vpp:capacity:available', '350');

        // Verify high-fidelity regional capacity object
        const highFidelityCall = mockRedisClient.set.mock.calls.find(call => call[0] === 'vpp:capacity:regional:high_fidelity');
        const highFidelityData = JSON.parse(highFidelityCall[1]);

        expect(highFidelityData.CAISO.total).toBe(150);
        expect(highFidelityData.CAISO.ev).toBe(100);
        expect(highFidelityData.CAISO.bess).toBe(50);
        expect(highFidelityData.ERCOT.total).toBe(200);
        expect(highFidelityData.ERCOT.ev).toBe(200);
        expect(highFidelityData.ERCOT.bess).toBe(0);

        // Verify legacy flat mapping for L4 compatibility
        const legacyCall = mockRedisClient.set.mock.calls.find(call => call[0] === 'vpp:capacity:regional');
        const legacyData = JSON.parse(legacyCall[1]);
        expect(legacyData.CAISO).toBe(150);
        expect(legacyData.ERCOT).toBe(200);
    });
    });

    describe('updateGlobalCapacity', () => {
        test('should aggregate EV and BESS correctly for regional breakdown', async () => {
            mockRedisClient.get.mockResolvedValue(null);
            mockPool.query.mockResolvedValueOnce({
                rows: [
                    { region: 'CAISO', resource_type: 'EV', raw_capacity_kwh: 100 },
                    { region: 'CAISO', resource_type: 'BESS', raw_capacity_kwh: 50 },
                    { region: 'PJM', resource_type: 'EV', raw_capacity_kwh: 200 }
                ]
            });

            await updateGlobalCapacity();

            // Verify high-fidelity Redis key
            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'vpp:capacity:regional:high_fidelity',
                expect.stringContaining('"CAISO":{"total":150,"ev":100,"bess":50}')
            );

            // Verify legacy Redis key (should be just the total number)
            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'vpp:capacity:regional',
                expect.stringContaining('"CAISO":150')
            );
        });
    });
});
