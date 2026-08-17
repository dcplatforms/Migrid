const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock pg
const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn()
};
jest.mock('pg', () => {
  return { Pool: jest.fn(() => mockPool) };
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
  mGet: jest.fn(),
  scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
  quit: jest.fn(),
  on: jest.fn()
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

// Mock MarketPricingService
jest.mock('./MarketPricingService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      getLatestPrices: jest.fn().mockResolvedValue([]),
      getHistoricalPrices: jest.fn().mockResolvedValue([]),
      getFuelMixHistory: jest.fn().mockResolvedValue([]),
      getLoadForecastHistory: jest.fn().mockResolvedValue([]),
      getNetLoadHistory: jest.fn().mockResolvedValue([])
    };
  });
});

describe('L4 Market Gateway Security Hardening Suite', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('GET /health should return 200 and version 3.9.0', async () => {
    const { app } = require('./index');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('market-gateway');
    expect(res.body.version).toBe('3.9.0');
  });

  test('Protected endpoint GET /markets/CAISO/prices should fail securely with 500 when NODE_ENV is production and default JWT secret is used', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // force default secret

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'user-123' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Protected endpoint should fail securely with 500 when NODE_ENV is production and weak secret is used', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret'; // weak secret in list

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'user-123' }, 'secret');

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Protected endpoint should verify token correctly when NODE_ENV is production and a strong secret is configured', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_998877';
    process.env.JWT_SECRET = strongSecret;

    const { app } = require('./index');
    const token = jwt.sign({ sub: 'user-123' }, strongSecret);

    const res = await request(app)
      .get('/markets/CAISO/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.iso).toBe('CAISO');
  });
});
