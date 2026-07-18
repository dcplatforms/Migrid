process.env.JWT_SECRET = 'secure_test_secret';
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock DB Pool
const mockPool = {
  query: jest.fn(),
  end: jest.fn()
};
jest.mock('./config', () => {
  return {
    pool: mockPool,
    port: 3009,
    jwtSecret: 'secure_test_secret',
    kafkaBrokers: ['localhost:9092']
  };
});

const { app } = require('./index');
const { pool } = require('./config');

const JWT_SECRET = 'secure_test_secret';

// Mock services to prevent actual side effects or connection attempts
jest.mock('./src/services/MarketRateService', () => ({
  start: jest.fn()
}));
jest.mock('./src/services/SessionEventListener', () => ({
  start: jest.fn()
}));
jest.mock('./src/services/BillingService', () => ({
  processSessionCompletion: jest.fn()
}));
jest.mock('./src/services/InvoicingService', () => ({
  calculateSessionCost: jest.fn().mockResolvedValue('50.00'),
  aggregateSessionsAndCreateInvoice: jest.fn()
}));

describe('L9 Commerce Engine Security Tests', () => {
  let fleetAToken;
  let fleetBToken;

  beforeAll(() => {
    fleetAToken = jwt.sign({ fleet_id: 'fleet-A' }, JWT_SECRET);
    fleetBToken = jwt.sign({ fleet_id: 'fleet-B' }, JWT_SECRET);
  });

  afterAll(async () => {
    // No need to close pool if mocked, but good practice
  });

  describe('POST /billing/calculate/:sessionId IDOR Protection', () => {
    test('should allow billing calculation for session belonging to own fleet', async () => {
      const sessionId = 'session-123';

      // Mock database response: session belongs to fleet-A
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: sessionId,
          vehicle_id: 'vehicle-1',
          energy_dispensed_kwh: 50.0,
          end_time: new Date()
        }]
      });

      const response = await request(app)
        .post(`/billing/calculate/${sessionId}`)
        .set('Authorization', `Bearer ${fleetAToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE cs.id = $1 AND v.fleet_id = $2'),
        [sessionId, 'fleet-A']
      );
    });

    test('should reject billing calculation for session belonging to different fleet', async () => {
      const sessionId = 'session-999';

      // Mock database response: session NOT found for fleet-B (IDOR check fails)
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post(`/billing/calculate/${sessionId}`)
        .set('Authorization', `Bearer ${fleetBToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Unauthorized');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE cs.id = $1 AND v.fleet_id = $2'),
        [sessionId, 'fleet-B']
      );
    });
  });
});
