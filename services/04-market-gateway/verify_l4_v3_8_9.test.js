
const redis = require('redis');
const Decimal = require('decimal.js');

// Mock redis BEFORE requiring index.js
const mockRedisClient = {
  get: jest.fn(),
  scan: jest.fn(),
  mGet: jest.fn(),
  setEx: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

jest.mock('kafkajs');
jest.mock('pg');

const { localSafetyCache, updateLocalSafetyCache } = require('./index');
const BiddingOptimizer = require('./BiddingOptimizer');

describe('L4 v3.8.9 Site Safety & Hardware Penalty Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset localSafetyCache
    localSafetyCache.l1_physics = false;
    localSafetyCache.l4_grid = false;
    localSafetyCache.l4_regional = {};
    localSafetyCache.site_safety = {};
  });

  test('updateLocalSafetyCache detects site-specific locks', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('false');
      if (key === 'l4:grid:lock') return Promise.resolve('false');
      return Promise.resolve(null);
    });

    mockRedisClient.scan.mockReturnValue(Promise.resolve({
      cursor: 0,
      keys: ['l1:safety:lock:site:SITE-001', 'l4:grid:lock:CAISO']
    }));
    mockRedisClient.mGet.mockReturnValue(Promise.resolve(['true', 'true']));

    await updateLocalSafetyCache();

    expect(localSafetyCache.l4_regional.CAISO).toBe(true);
    expect(localSafetyCache.site_safety['SITE-001']).toBe(true);
  });

  test('BiddingOptimizer does NOT halt for granular site locks', async () => {
    const localCache = {
      last_updated: new Date().toISOString(),
      l1_physics: false,
      l4_grid: false,
      l4_regional: {},
      site_safety: { 'SITE-001': true }, // Site lock active
      physics_score: "1.0000",
      confidence_score: "1.0000"
    };

    const optimizer = new BiddingOptimizer({}, 'redis://localhost', localCache);
    const locks = await optimizer.getSafetyLockStatus('CAISO');

    // l1 lock should be false because granular locks shouldn't halt the whole system
    expect(locks.l1).toBe(false);
    expect(locks.l4).toBe(false);
  });

  test('BiddingOptimizer applies Hardware Health Penalty', async () => {
    const localCache = {
      last_updated: new Date().toISOString(),
      l1_physics: false,
      l4_grid: false,
      l4_regional: {},
      site_safety: {},
      physics_score: "1.0000",
      confidence_score: "1.0000"
    };

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l4:regional:alarms:CAISO') return Promise.resolve('2'); // 2 alarms -> 0.10 penalty
      if (key === 'vpp:capacity:available') return Promise.resolve('1000');
      return Promise.resolve(null);
    });

    const optimizer = new BiddingOptimizer({}, 'redis://localhost', localCache);

    // Mock pricing service methods used in generateDayAheadBids
    optimizer.pricingService.getLatestFuelMix = jest.fn().mockResolvedValue([]);
    optimizer.pricingService.getDayAheadForecast = jest.fn().mockResolvedValue([
      { location: 'NODE1', price_per_mwh: 150, timestamp: new Date() } // High price -> bid
    ]);
    optimizer.pricingService.getDARTSpreadAnalysis = jest.fn().mockResolvedValue({ volatility: 0 });

    const result = await optimizer.generateDayAheadBids('CAISO');

    expect(result.audit.regional_alarm_count).toBe(2);
    expect(result.audit.hardware_penalty).toBe(0.10);

    // Original capacity 1000kW = 1.0 MW.
    // Penalty 0.10 -> 0.9 MW bid.
    // FIX message tag 38 is OrderQty
    expect(result.bids[0]).toContain('38=0.90');
  });

  test('Hardware Health Penalty is capped at 0.30', async () => {
    const localCache = {
      last_updated: new Date().toISOString(),
      l1_physics: false,
      l4_grid: false,
      l4_regional: {},
      site_safety: {},
      physics_score: "1.0000",
      confidence_score: "1.0000"
    };

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l4:regional:alarms:CAISO') return Promise.resolve('10'); // 10 alarms -> 0.50 -> capped at 0.30
      if (key === 'vpp:capacity:available') return Promise.resolve('1000');
      return Promise.resolve(null);
    });

    const optimizer = new BiddingOptimizer({}, 'redis://localhost', localCache);

    optimizer.pricingService.getLatestFuelMix = jest.fn().mockResolvedValue([]);
    optimizer.pricingService.getDayAheadForecast = jest.fn().mockResolvedValue([
      { location: 'NODE1', price_per_mwh: 150, timestamp: new Date() }
    ]);
    optimizer.pricingService.getDARTSpreadAnalysis = jest.fn().mockResolvedValue({ volatility: 0 });

    const result = await optimizer.generateDayAheadBids('CAISO');

    expect(result.audit.regional_alarm_count).toBe(10);
    expect(result.audit.hardware_penalty).toBe(0.30);

    // 1.0 MW * (1 - 0.30) = 0.70 MW
    expect(result.bids[0]).toContain('38=0.70');
  });
});
