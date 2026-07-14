
const redis = require('redis');
const Decimal = require('decimal.js');

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
const BiddingOptimizer = require('./BiddingOptimizer');

describe('L4 v3.8.9 Hardware-Aware Bidding Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset localSafetyCache
    localSafetyCache.l4_regional_alarms = {};
    localSafetyCache.last_updated = null;
  });

  test('updateLocalSafetyCache updates regional alarms correctly', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    // Mock regional locks scan
    mockRedisClient.scan.mockReturnValueOnce(Promise.resolve({ cursor: 0, keys: [] }));

    // Mock regional alarms scan
    mockRedisClient.scan.mockReturnValueOnce(Promise.resolve({ cursor: 0, keys: ['l4:regional:alarms:CAISO', 'l4:regional:alarms:ERCOT'] }));
    mockRedisClient.mGet.mockResolvedValueOnce(['3', '1']);

    await updateLocalSafetyCache();

    expect(localSafetyCache.l4_regional_alarms.CAISO).toBe(3);
    expect(localSafetyCache.l4_regional_alarms.ERCOT).toBe(1);
  });

  test('BiddingOptimizer incorporates regional alarm count in audit', async () => {
    // Setup cache with alarms
    localSafetyCache.l4_regional_alarms = { CAISO: 2 };
    localSafetyCache.last_updated = new Date().toISOString();
    localSafetyCache.physics_score = "1.0000";
    localSafetyCache.confidence_score = "1.0000";
    localSafetyCache.l4_regional = {};

    const mockPool = {};
    const optimizer = new BiddingOptimizer(mockPool, 'redis://localhost:6379', localSafetyCache);

    // Mock capacity and pricing service
    optimizer.getAggregatedCapacity = jest.fn().mockResolvedValue({
      capacity: new Decimal(1000),
      fidelity: 'STANDARD',
      breakdown: { ev: 1000, bess: 0 },
      physics_score: "1.0000",
      confidence_score: "1.0000"
    });
    optimizer.pricingService.getLatestFuelMix = jest.fn().mockResolvedValue([]);
    optimizer.pricingService.getDayAheadForecast = jest.fn().mockResolvedValue([]);
    optimizer.connect = jest.fn();

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.audit_context.regional_alarm_count).toBe(2);
    // Confidence penalty: 2 alarms * 0.05 = 0.1 penalty. 1.0 - 0.1 = 0.9
    expect(audit.confidence_score).toBe("0.9000");
  });
});
