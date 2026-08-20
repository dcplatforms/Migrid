process.env.JWT_SECRET = 'test_secret';
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock redis before importing app
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn()
  }))
}));

// Mock pg before importing app
jest.mock('pg', () => {
  const mClient = {
    connect: jest.fn(),
    query: jest.fn(() => Promise.resolve({ rows: [] })),
    end: jest.fn(),
    on: jest.fn(),
  };
  return { Client: jest.fn(() => mClient) };
});

const { app } = require('../index');

describe('L10 Token Engine Security Hardening', () => {
  test('GET /data/training/rewards should return 401 if no token provided', async () => {
    const response = await request(app).get('/data/training/rewards');
    expect(response.status).toBe(401);
  });

  test('GET /data/training/rewards should return 403 if invalid token provided', async () => {
    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', 'Bearer invalid_token');
    expect(response.status).toBe(403);
  });

  test('GET /data/training/rewards should return 403 if token contains fleet_id (non-admin)', async () => {
    const token = jwt.sign({ driver_id: 'driver-1', fleet_id: 'fleet-1' }, process.env.JWT_SECRET);
    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Unauthorized access to global training data');
  });

  test('GET /data/training/rewards should return 200 (or pass auth) if valid admin token provided', async () => {
    const token = jwt.sign({ driver_id: 'admin-1' }, process.env.JWT_SECRET);

    const { Client } = require('pg');
    const mClient = new Client();
    mClient.query.mockResolvedValueOnce({ rows: [] });

    // We expect it to NOT be 401 or 403. It might be 200 or 500 (if DB query fails)
    // but the point is it passed the auth middleware.
    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);
  });

  test('GET /health should return security headers via helmet', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBeDefined();
  });

  test('GET /data/training/rewards should return 500 in production if weak secret is used', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalJwtSecret = process.env.JWT_SECRET;

    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test_secret';

    const token = jwt.sign({ driver_id: 'admin-1' }, process.env.JWT_SECRET);

    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Internal server configuration error');

    // Restore
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    process.env.JWT_SECRET = originalJwtSecret;
  });
});
