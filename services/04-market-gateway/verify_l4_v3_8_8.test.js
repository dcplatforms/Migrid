
const redis = require('redis');

// Mock redis BEFORE requiring index.js
const mockRedisClient = {
  get: jest.fn(),
  scan: jest.fn(),
  mGet: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

jest.mock('kafkajs');
jest.mock('pg');

const { localSafetyCache, updateLocalSafetyCache } = require('./index');

describe('L4 v3.8.8 localSafetyCache & Alarm Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updateLocalSafetyCache updates local state correctly', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('true');
      if (key === 'l4:grid:lock') return Promise.resolve('false');
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        physics_score: 0.995,
        confidence_score: 0.98,
        is_sentinel_fidelity: true
      }));
      if (key === 'l2:unified:context') return Promise.resolve(JSON.stringify({
        regional_confidence: { CAISO: 0.97 }
      }));
      return Promise.resolve(null);
    });

    mockRedisClient.scan.mockReturnValue(Promise.resolve({ cursor: 0, keys: ['l4:grid:lock:ERCOT'] }));
    mockRedisClient.mGet.mockReturnValue(Promise.resolve(['true']));

    await updateLocalSafetyCache();

    expect(localSafetyCache.l1_physics).toBe(true);
    expect(localSafetyCache.l4_grid).toBe(false);
    expect(localSafetyCache.physics_score).toBe("0.9950");
    expect(localSafetyCache.confidence_score).toBe("0.9800");
    expect(localSafetyCache.is_sentinel_fidelity).toBe(true);
    expect(localSafetyCache.l4_regional.ERCOT).toBe(true);
    expect(localSafetyCache.regional_confidence.CAISO).toBe(0.97);
  });
});
