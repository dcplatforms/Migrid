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
const app = require('./index');

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
            rows: [{ total_capacity_kwh: 150.5, vehicle_count: 3 }]
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
                v2g_enabled: true
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});
