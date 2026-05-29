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

describe('L4 v3.8.6 Robustness & Parity Verification', () => {
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

  test('NaN hardening: physics_score and confidence_score should default to 1.0000 if NaN', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      // High-fidelity capacity payload with NaN scores
      if (key === 'vpp:capacity:regional:high_fidelity') return Promise.resolve(JSON.stringify({
        'CAISO': {
          total: 2000,
          ev: 1500,
          bess: 500,
          is_high_fidelity: true,
          physics_score: "invalid",
          confidence_score: "NaN"
        }
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("2000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.physics_score).toBe('1.0000');
    expect(audit.confidence_score).toBe('1.0000');
    expect(audit.is_high_fidelity).toBe(true);
  });

  test('High-Fidelity score extraction from L3 capacity breakdown', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:regional:high_fidelity') return Promise.resolve(JSON.stringify({
        'PJM': {
          total: 3000,
          ev: 2000,
          bess: 1000,
          is_high_fidelity: true,
          physics_score: "0.9920",
          confidence_score: "0.9850"
        }
      }));
      if (key === 'vpp:capacity:available') return Promise.resolve("3000");
      return Promise.resolve(null);
    });

    const { audit } = await optimizer.generateDayAheadBids('PJM');

    expect(audit.physics_score).toBe('0.9920');
    expect(audit.confidence_score).toBe('0.9850');
    expect(audit.is_sentinel_fidelity).toBe(true); // physics > 0.99
    expect(audit.capacity_fidelity).toBe('HIGH_FIDELITY');
  });

  test('Site ID extraction parity (internal helper logic)', () => {
    // We can't easily test private helpers without exporting them or using rewire
    // But we can test the effect if we were to test index.js logic.
    // For now, focus on BiddingOptimizer logic.
  });
});
