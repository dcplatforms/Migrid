const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

// Mocking dependencies
const mockPool = {
  query: jest.fn(),
};

jest.mock('../config', () => ({
  pool: mockPool,
  jwtSecret: 'test_secret',
  port: 3009,
}));

const { authenticateToken } = require('../src/utils/auth');

describe('Commerce Engine Security Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    app.get('/test-auth', authenticateToken, (req, res) => {
      res.json({ success: true, user: req.user });
    });

    // We can't easily test the full app without more complex mocking of InvoicingService
    // but we can test the middleware specifically.
  });

  it('should reject requests without a token', async () => {
    const response = await request(app).get('/test-auth');
    expect(response.status).toBe(401);
  });

  it('should reject requests with an invalid token', async () => {
    const response = await request(app)
      .get('/test-auth')
      .set('Authorization', 'Bearer invalid_token');
    expect(response.status).toBe(403);
  });

  it('should accept requests with a valid token', async () => {
    const token = jwt.sign({ fleet_id: 'fleet-1' }, 'test_secret');
    const response = await request(app)
      .get('/test-auth')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.user.fleet_id).toBe('fleet-1');
  });

  it('should fail securely if JWT_SECRET is default', async () => {
    // Reset modules to reload auth with different secret
    jest.resetModules();
    jest.mock('../config', () => ({
      jwtSecret: 'dev_secret_change_in_production',
    }));
    const { authenticateToken: auth } = require('../src/utils/auth');
    const localApp = express();
    localApp.get('/test-auth', auth, (req, res) => res.json({ success: true }));

    const token = jwt.sign({ fleet_id: 'fleet-1' }, 'dev_secret_change_in_production');
    const response = await request(localApp)
      .get('/test-auth')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server configuration error');
  });
});
