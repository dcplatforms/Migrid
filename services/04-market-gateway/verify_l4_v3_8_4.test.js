const BiddingOptimizer = require('./BiddingOptimizer');
const { createClient } = require('redis');

jest.mock('redis');
jest.mock('./MarketPricingService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      getLatestFuelMix: jest.fn().mockResolvedValue([]),
      getDayAheadForecast: jest.fn().mockResolvedValue([{ location: 'NODE_1', price_per_mwh: 50.00, timestamp: new Date() }]),
      getDARTSpreadAnalysis: jest.fn().mockResolvedValue({ volatility: 0 })
    };
  });
});

describe('L4 v3.8.4 High-Fidelity Verification', () => {
  let mockRedisClient;
  let optimizer;

  beforeEach(() => {
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(),
      get: jest.fn(),
      quit: jest.fn().mockResolvedValue(),
      on: jest.fn(),
    };
    createClient.mockReturnValue(mockRedisClient);
    optimizer = new BiddingOptimizer({}, 'redis://localhost:6379');
  });

  test('should format physics_score and confidence_score as strings in audit', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.992,
        confidence_score: 0.958
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(typeof audit.physics_score).toBe('string');
    expect(audit.physics_score).toBe('0.9920');
    expect(typeof audit.confidence_score).toBe('string');
    expect(audit.confidence_score).toBe('0.9580');
  });

  test('should harden is_sentinel_fidelity detection using explicit flag (boolean)', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.98, // Normally not sentinel
        is_sentinel_fidelity: true // Explicitly set
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.is_sentinel_fidelity).toBe(true);
  });

  test('should harden is_sentinel_fidelity detection using explicit flag (string)', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.98,
        is_sentinel_fidelity: 'true' // Explicitly set as string
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.is_sentinel_fidelity).toBe(true);
  });

  test('should fallback to physics_score > 0.99 for is_sentinel_fidelity', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.995,
        // no is_sentinel_fidelity flag
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.is_sentinel_fidelity).toBe(true);
  });
});
