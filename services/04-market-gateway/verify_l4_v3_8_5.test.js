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

describe('L4 v3.8.5 Standardization Verification', () => {
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

  test('Score formatting should be strictly string .toFixed(4)', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.987654,
        confidence_score: 0.954321,
        is_sentinel_fidelity: true
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("1000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(typeof audit.physics_score).toBe('string');
    expect(audit.physics_score).toBe('0.9877'); // Rounded to 4 decimals
    expect(typeof audit.confidence_score).toBe('string');
    expect(audit.confidence_score).toBe('0.9543');
    expect(audit.is_sentinel_fidelity).toBe(true);
  });

  test('Sentinel Fidelity should handle string "true"', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.96,
        confidence_score: 0.96,
        is_sentinel_fidelity: 'true'
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("1000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('PJM');
    expect(audit.is_sentinel_fidelity).toBe(true);
  });

  test('Sentinel Fidelity should handle number 1', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.96,
        confidence_score: 0.96,
        is_sentinel_fidelity: 1
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("1000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('PJM');
    expect(audit.is_sentinel_fidelity).toBe(true);
  });

  test('Sentinel Fidelity should fallback to physics_score > 0.99', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.995,
        confidence_score: 0.90,
        is_sentinel_fidelity: false
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("1000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('ERCOT');
    expect(audit.is_sentinel_fidelity).toBe(true);
  });
});
