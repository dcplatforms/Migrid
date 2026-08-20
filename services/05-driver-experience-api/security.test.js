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
const mockKafka = {
  producer: jest.fn(() => mockProducer)
};
jest.mock('kafkajs', () => {
  return { Kafka: jest.fn(() => mockKafka) };
});

// Mock notifications to prevent setInterval from keeping Jest open
jest.mock('./notifications', () => ({
  init: jest.fn(),
  queueForBatch: jest.fn(),
  sendImmediate: jest.fn()
}));

describe('L5 Driver Experience API Security Hardening', () => {
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
    expect(res.body.service).toBe('driver-experience-api');
  });

  test('POST /auth/login should fail securely with 500 when NODE_ENV is production and JWT_SECRET is default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // This forces default to be used

    const { app } = require('./index');
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should fail securely with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret'; // weak secret

    const { app } = require('./index');
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, 'secret');

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server configuration error');
  });

  test('Authenticated route should verify token correctly when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_12345';
    process.env.JWT_SECRET = strongSecret;

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'driver-123',
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        fleet_id: 'fleet-abc',
        is_plug_and_charge_ready: false,
        escrow_balance: 0,
        blockchain_balance: 0,
        open_wallet_address: 'OW-address',
        preferred_billing_mode: 'FLEET',
        min_target_soc: 20,
        target_departure_time: '08:00',
        vpp_participation_active: true
      }]
    });

    const { app } = require('./index');
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, strongSecret);

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('driver-123');
  });
});
