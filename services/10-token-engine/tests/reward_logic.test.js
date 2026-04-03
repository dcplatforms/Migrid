const Decimal = require('decimal.js');
const { getDynamicMultiplier, redisClient, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY } = require('../index');

// Mock Redis Client
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    hGet: jest.fn(),
    quit: jest.fn().mockResolvedValue()
  })
}));

describe('L10 Token Engine - Reward Logic v4.3.0', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Charging during surplus should receive 1.5x multiplier', async () => {
    // Mock Redis returning surplus price ($20)
    redisClient.hGet.mockResolvedValue('20.0');

    const result = await getDynamicMultiplier('CAISO', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(1.5);
    expect(result.reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('V2G discharge during scarcity should receive 2.0x multiplier', async () => {
    // Mock Redis returning scarcity price ($120)
    redisClient.hGet.mockResolvedValue('120.0');

    const result = await getDynamicMultiplier('PJM', 'v2g_discharge');
    expect(result.multiplier.toNumber()).toBe(2.0);
    expect(result.reason).toBe('V2G Scarcity Bonus (2.0x)');
  });

  test('Charging during scarcity should receive 0.5x penalty', async () => {
    // Mock Redis returning scarcity price ($120)
    redisClient.hGet.mockResolvedValue('120.0');

    const result = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(0.5);
    expect(result.reason).toBe('High Scarcity Surcharge (0.5x)');
  });

  test('Standard charging should receive 1.0x multiplier', async () => {
    // Mock Redis returning normal price ($50)
    redisClient.hGet.mockResolvedValue('50.0');

    const result = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.reason).toBe('Standard');
  });

  test('Multi-region support (ENTSOE) with normalization', async () => {
    // Mock Redis for ENTSOE
    redisClient.hGet.mockImplementation((key, field) => {
      if (field === 'ENTSOE') return Promise.resolve('25.0');
      return Promise.resolve('50.0');
    });

    const result = await getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(1.5);
    expect(result.reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('Decimal precision check', () => {
    const sourceValue = 12.3456789;
    const ruleMultiplier = 1.2;
    const marketMultiplier = new Decimal(1.5);
    const result = new Decimal(sourceValue).times(ruleMultiplier).times(marketMultiplier).toDecimalPlaces(8);
    expect(result.toNumber()).toBe(22.22222202);
  });

  test('Fallback to default price if Redis lookup fails', async () => {
    redisClient.hGet.mockRejectedValue(new Error('Redis Down'));

    const result = await getDynamicMultiplier('CAISO', 'session_completed');
    // Default is 50.0, so multiplier should be 1.0
    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.reason).toBe('Standard');
  });
});
