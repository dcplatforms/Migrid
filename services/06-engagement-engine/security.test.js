const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock Redis
const mockRedis = {
  connect: jest.fn(),
  on: jest.fn(),
  get: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
  quit: jest.fn(),
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedis),
}));

// Mock Kafka
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        subscribe: jest.fn(),
        run: jest.fn(),
        disconnect: jest.fn(),
      })),
      producer: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        send: jest.fn(),
        disconnect: jest.fn(),
      })),
    })),
  };
});

// Mock pg
const mockPool = {
  query: jest.fn(),
  end: jest.fn(),
};
jest.mock('pg', () => {
  return { Pool: jest.fn(() => mockPool) };
});

describe('L6 Engagement Engine Security Hardening', () => {
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
    expect(res.body.service).toBe('engagement-engine');
  });

  test('Authenticated endpoint should fail securely with 500 when NODE_ENV is production and JWT_SECRET is default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // Force default

    const { app } = require('./index');
    // Signs with default dev secret
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/leaderboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Internal server configuration error');
  });

  test('Authenticated endpoint should fail securely with 500 when NODE_ENV is production and JWT_SECRET is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret'; // Weak secret

    const { app } = require('./index');
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, 'secret');

    const res = await request(app)
      .get('/leaderboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Internal server configuration error');
  });

  test('Authenticated endpoint should succeed when NODE_ENV is production and JWT_SECRET is strong', async () => {
    process.env.NODE_ENV = 'production';
    const strongSecret = 'super_strong_unpredictable_production_secret_key_1234567890';
    process.env.JWT_SECRET = strongSecret;

    mockPool.query.mockResolvedValueOnce({
      rows: [
        { rank: 1, total_points: 100, green_score: 95, driver_id: 'driver-123', first_name: 'John', last_name: 'Doe', fleet_name: 'Fleet A' }
      ]
    });

    const { app } = require('./index');
    const token = jwt.sign({ driver_id: 'driver-123', fleet_id: 'fleet-abc' }, strongSecret);

    const res = await request(app)
      .get('/leaderboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toBeDefined();
    expect(res.body.leaderboard[0].driver_id).toBe('driver-123');
  });
});
