const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock redis BEFORE requiring index.js
const mockRedisClient = {
  get: jest.fn(),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  mGet: jest.fn(),
  connect: jest.fn().mockResolvedValue(),
  on: jest.fn(),
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

// Mock pg BEFORE requiring index.js
const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn()
};
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool)
}));

// Mock kafkajs BEFORE requiring index.js
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
jest.mock('kafkajs', () => ({
  Kafka: jest.fn(() => mockKafka)
}));

describe('L4 Market Gateway Security Hardening', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('GET /health should return 200 and run successfully', async () => {
    const { app } = require('./index');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('market-gateway');
    expect(res.body.version).toBe('3.9.0');
  });

  test('Authenticated route should fail securely with 500 when NODE_ENV is production and JWT_SECRET is default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // Force default key 'dev_secret_change_in_production'

    const { app } = require('./index');
    const token = jwt.sign({ user: 'operator', role: 'admin' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should fail securely with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret'; // Weak secret from WEAK_SECRETS

    const { app } = require('./index');
    const token = jwt.sign({ user: 'operator', role: 'admin' }, 'secret');

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should succeed when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_12345';
    process.env.JWT_SECRET = strongSecret;

    const { app } = require('./index');
    const token = jwt.sign({ user: 'operator', role: 'admin' }, strongSecret);

    mockPool.query.mockResolvedValueOnce({
      rows: []
    });

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    // If query returns empty, res status could be 200 or similar, but definitely NOT 500 configuration error
    expect(res.status).not.toBe(500);
  });
});
