const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('L10 Token Engine - Security Hardening', () => {
  const JWT_SECRET = 'test_secret';
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    // Require app AFTER setting JWT_SECRET so it's picked up
    const index = require('../index');
    app = index.app;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  test('GET /data/training/rewards should require authentication', async () => {
    const response = await request(app).get('/data/training/rewards');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Access token required');
  });

  test('GET /data/training/rewards should reject invalid token', async () => {
    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', 'Bearer invalid_token');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Invalid or expired token');
  });

  test('GET /data/training/rewards should reject token with fleet_id', async () => {
    const token = jwt.sign({ driver_id: 'driver-1', fleet_id: 'fleet-1' }, JWT_SECRET);
    const response = await request(app)
      .get('/data/training/rewards')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
    expect(response.body.message).toBe('Global reward data export restricted to system tokens');
  });
});
