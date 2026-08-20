const request = require('supertest');
const jwt = require('jsonwebtoken');

// 1. Mock network dependencies before requiring the app
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn()
    };
  });
});

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({}),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('kafkajs', () => {
  const mProducer = {
    connect: jest.fn().mockResolvedValue(),
    send: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
  };
  const mConsumer = {
    connect: jest.fn().mockResolvedValue(),
    subscribe: jest.fn().mockResolvedValue(),
    run: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
  };
  const mKafka = {
    producer: jest.fn(() => mProducer),
    consumer: jest.fn(() => mConsumer)
  };
  return { Kafka: jest.fn(() => mKafka) };
});

const { app } = require('./src/server');
const config = require('./src/config');

describe('L7 Device Gateway Security Hardening', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = config.jwtSecret;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    config.jwtSecret = originalSecret;
  });

  test('GET /health should return 200 with service information and include security headers via helmet', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.service).toBe('Device Gateway');
    expect(response.body.version).toBe('5.13.0');

    // Security Headers from Helmet
    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBeDefined();
  });

  test('In non-production, standard JWT secrets (even weak ones) are accepted', async () => {
    process.env.NODE_ENV = 'development';
    config.jwtSecret = 'secret';

    const token = jwt.sign({ vehicle_id: 1, fleet_id: 'fleet-1' }, config.jwtSecret);
    const response = await request(app)
      .post('/iso15118/v2g-discharge')
      .set('Authorization', `Bearer ${token}`)
      .send({ evse_id: 'evse-1', discharge_amount_kw: 10 });

    // It should not be 500 (configuration error), since non-prod environments allow the default secret.
    // It might be 403 or 200 depending on DB mocks, but definitely not 500 configuration error.
    expect(response.status).not.toBe(500);
  });

  test('In production, weak JWT secrets are rejected with 500 config error in authenticateInternal', async () => {
    process.env.NODE_ENV = 'production';
    config.jwtSecret = 'secret'; // Weak secret

    const token = jwt.sign({ vehicle_id: 1, fleet_id: 'fleet-1' }, config.jwtSecret);
    const response = await request(app)
      .post('/iso15118/v2g-discharge')
      .set('Authorization', `Bearer ${token}`)
      .send({ evse_id: 'evse-1', discharge_amount_kw: 10 });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Internal server configuration error');
  });

  test('In production, weak JWT secrets are rejected with 500 config error in /iso15118/authenticate', async () => {
    process.env.NODE_ENV = 'production';
    config.jwtSecret = 'secret'; // Weak secret

    const response = await request(app)
      .post('/iso15118/authenticate')
      .send({ contract_id: 'vin-1', certificate_chain: ['cert-1', 'cert-2'] });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Internal server configuration error');
  });

  test('In production, a strong secure JWT secret is accepted for authentication', async () => {
    process.env.NODE_ENV = 'production';
    config.jwtSecret = 'extremely_strong_secure_key_1234567890!';

    const token = jwt.sign({ vehicle_id: 1, fleet_id: 'fleet-1' }, config.jwtSecret);
    const response = await request(app)
      .post('/iso15118/v2g-discharge')
      .set('Authorization', `Bearer ${token}`)
      .send({ evse_id: 'evse-1', discharge_amount_kw: 10 });

    expect(response.status).not.toBe(500);
  });
});
