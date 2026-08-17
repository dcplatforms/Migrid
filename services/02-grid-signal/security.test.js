const request = require('supertest');
const jwt = require('jsonwebtoken');

// Virtual mocks MUST be defined before requiring index
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue(),
    sAdd: jest.fn().mockResolvedValue(),
    sRem: jest.fn().mockResolvedValue(),
    sMembers: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue(),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
    mGet: jest.fn().mockResolvedValue([]),
    hGetAll: jest.fn().mockResolvedValue({}),
    on: jest.fn()
  })
}), { virtual: true });

const mockConsumer = {
  connect: jest.fn().mockResolvedValue(),
  subscribe: jest.fn().mockResolvedValue(),
  run: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue()
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(),
      send: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue()
    }),
    consumer: jest.fn().mockReturnValue(mockConsumer)
  }))
}), { virtual: true });

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue()
  }))
}), { virtual: true });

describe('L2 Grid Signal Security Hardening', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('GET /health should return 200 and healthy status', async () => {
    const { app } = require('./index');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('grid-signal');
    expect(res.body.version).toBe('2.5.6');
  });

  test('Authenticated endpoint should fail with 500 when NODE_ENV is production and JWT_SECRET is default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // Force default

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'admin' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/openadr/v3/reports')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_CONFIGURATION_ERROR');
    expect(res.body.message).toContain('Weak authentication secrets rejected in production mode');
  });

  test('Authenticated endpoint should fail with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret'; // Weak secret

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'admin' }, 'secret');

    const res = await request(app)
      .get('/openadr/v3/reports')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_CONFIGURATION_ERROR');
    expect(res.body.message).toContain('Weak authentication secrets rejected in production mode');
  });

  test('Authenticated endpoint should succeed when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_9876543210';
    process.env.JWT_SECRET = strongSecret;

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'admin' }, strongSecret);

    const res = await request(app)
      .get('/openadr/v3/reports')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.reports).toBeDefined();
  });
});
