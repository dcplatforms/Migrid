const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock pg
const mockClient = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn()
};
jest.mock('pg', () => {
  return { Client: jest.fn(() => mockClient) };
});

// Mock kafkajs
const mockProducer = {
  connect: jest.fn(),
  send: jest.fn(),
  disconnect: jest.fn()
};
const mockConsumer = {
  connect: jest.fn(),
  subscribe: jest.fn(),
  run: jest.fn(),
  disconnect: jest.fn()
};
const mockKafka = {
  producer: jest.fn(() => mockProducer),
  consumer: jest.fn(() => mockConsumer)
};
jest.mock('kafkajs', () => {
  return { Kafka: jest.fn(() => mockKafka) };
});

// Mock redis
const mockRedisClient = {
  connect: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  setEx: jest.fn(),
  hGetAll: jest.fn(),
  scan: jest.fn(() => ({ cursor: '0', keys: [] })),
  quit: jest.fn()
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

describe('L1 Physics Engine Security Hardening', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('GET /health should return 200 and run successfully without authentication', async () => {
    const { app } = require('./index');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('physics-engine');
  });

  test('Authenticated route should fail securely with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev_secret_change_in_production'; // weak secret

    const { app } = require('./index');
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/data/training/physics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should verify token correctly when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_12345';
    process.env.JWT_SECRET = strongSecret;

    mockClient.query.mockResolvedValueOnce({
      rows: [{
        session_id: 'session-123',
        violation_type: 'EFFICIENCY_ALERT',
        expected_value: 0.85,
        actual_value: 0.70,
        severity: 'WARNING',
        metadata: {},
        billing_mode: 'FLEET',
        vpp_active: true,
        v2g_active: false,
        iso_region: 'CAISO',
        market_price_at_session: 50.0,
        physics_score: 0.80,
        is_high_fidelity: true,
        created_at: new Date().toISOString()
      }]
    });

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'admin' }, strongSecret); // System token (no fleet_id)

    const res = await request(app)
      .get('/data/training/physics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.record_count).toBe(1);
  });
});
