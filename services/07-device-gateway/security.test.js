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

// Mock ioredis / connectionMgr
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn().mockResolvedValue(['0', []]),
  mget: jest.fn().mockResolvedValue([]),
  publish: jest.fn().mockResolvedValue(1),
  subscribe: jest.fn().mockResolvedValue('OK'),
  on: jest.fn()
};

jest.mock('./src/state/connectionMgr', () => ({
  redis: mockRedis,
  redisSub: mockRedis,
  registerConnection: jest.fn().mockResolvedValue(true),
  removeConnection: jest.fn().mockResolvedValue(true)
}));

// Mock kafkajs / event producers and consumers
jest.mock('./src/events/producer', () => ({
  connectProducer: jest.fn().mockResolvedValue(true),
  publishSessionEvent: jest.fn().mockResolvedValue(true),
  publishTelemetry: jest.fn().mockResolvedValue(true)
}));

jest.mock('./src/events/consumer', () => ({
  connectConsumer: jest.fn().mockResolvedValue(true)
}));

describe('L7 Device Gateway Security Hardening', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('GET /health should return 200 and OK status', async () => {
    const { app } = require('./src/server');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('Device Gateway');
    expect(res.body.layer).toBe('L7');
    expect(res.body.version).toBe('5.13.0');
  });

  test('POST /iso15118/authenticate should fail securely with 500 when NODE_ENV is production and secret is default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // Default to 'secret'

    const { app } = require('./src/server');
    const res = await request(app)
      .post('/iso15118/authenticate')
      .send({ contract_id: 'VIN123456', certificate_chain: ['cert1', 'cert2'] });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route /iso15118/v2g-discharge should fail securely with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev_secret_change_in_production';

    const { app } = require('./src/server');
    const token = jwt.sign({ vehicle_id: 'v-123', fleet_id: 'f-456' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .post('/iso15118/v2g-discharge')
      .set('Authorization', `Bearer ${token}`)
      .send({ evse_id: 'EVSE-01', discharge_amount_kw: 10 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should verify token correctly when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_999';
    process.env.JWT_SECRET = strongSecret;

    // Re-require config/server with strongSecret set in env
    mockPool.query.mockResolvedValueOnce({
      rows: [{ current_soc: 80.0 }]
    });

    const { app } = require('./src/server');
    const token = jwt.sign({ vehicle_id: 'v-123', fleet_id: 'f-456' }, strongSecret);

    const res = await request(app)
      .post('/iso15118/v2g-discharge')
      .set('Authorization', `Bearer ${token}`)
      .send({ evse_id: 'EVSE-01', discharge_amount_kw: 10 });

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXECUTING');
    expect(res.body.discharge_amount_kw).toBe(10);
  });
});
