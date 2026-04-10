const Decimal = require('decimal.js');
const { getDynamicMultiplier, redisClient, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY } = require('../index');

// Mock Redis client for testing
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn()
  }))
}));

describe('L10 Token Engine - Reward Logic v4.3.1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Charging during surplus should receive 1.5x multiplier', async () => {
    // Surplus is < 30.0. Default is 50.0.
    redisClient.hGet.mockResolvedValue('10.0');
    const { multiplier, reason } = await getDynamicMultiplier('CAISO', 'session_completed');
    expect(multiplier.toNumber()).toBe(1.5);
    expect(reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('Green charging during surplus should receive 1.5x multiplier (Alignment)', async () => {
    redisClient.hGet.mockResolvedValue('10.0');
    const { multiplier, reason } = await getDynamicMultiplier('CAISO', 'green_charging');
    expect(multiplier.toNumber()).toBe(1.5);
    expect(reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('V2G discharge during scarcity should receive 2.0x multiplier', async () => {
    // Scarcity is > 100.0
    redisClient.hGet.mockResolvedValue('150.0');
    const { multiplier, reason } = await getDynamicMultiplier('PJM', 'v2g_discharge');
    expect(multiplier.toNumber()).toBe(2.0);
    expect(reason).toBe('High Scarcity Reward (2.0x)');
  });

  test('Standard charging should receive 1.0x multiplier', async () => {
    redisClient.hGet.mockResolvedValue('50.0');
    const { multiplier, reason } = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(multiplier.toNumber()).toBe(1.0);
    expect(reason).toBe('Standard Reward');
  });

  test('Charging during scarcity without VPP alignment should receive 0.5x penalty', async () => {
    redisClient.hGet.mockResolvedValue('150.0');
    const { multiplier, reason } = await getDynamicMultiplier('PJM', 'session_completed', false);
    expect(multiplier.toNumber()).toBe(0.5);
    expect(reason).toBe('High Scarcity Surcharge (0.5x)');
  });

  test('Charging during scarcity with VPP alignment should receive 2.0x bonus', async () => {
    redisClient.hGet.mockResolvedValue('150.0');
    const { multiplier, reason } = await getDynamicMultiplier('PJM', 'session_completed', true);
    expect(multiplier.toNumber()).toBe(2.0);
    expect(reason).toBe('VPP Scarcity Bonus (2.0x)');
  });

  test('Standard charging should receive 1.0x multiplier with Redis lookup', async () => {
    // Mock Redis returning normal price ($50)
    redisClient.hGet.mockResolvedValue('50.0');

    const result = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.reason).toBe('Standard Reward');
  });

  test('ISO normalization for regional multipliers', async () => {
    redisClient.hGet.mockResolvedValue('10.0');
    const { multiplier: entsoeMult } = await getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(entsoeMult.toNumber()).toBe(1.5);
    expect(redisClient.hGet).toHaveBeenLastCalledWith('market:profitability', 'ENTSOE');

    redisClient.hGet.mockResolvedValue('150.0');
    const { multiplier: nordpoolMult } = await getDynamicMultiplier('NordPool', 'v2g_discharge');
    expect(nordpoolMult.toNumber()).toBe(2.0);
    expect(redisClient.hGet).toHaveBeenLastCalledWith('market:profitability', 'NORDPOOL');
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
    expect(result.reason).toBe('Standard Reward');
  });

  test('Grid response should be recognized as behavioral and exempt from physics threshold', () => {
    // This is more of a logic check for the consumer, but we can verify the multiplier for it.
    // grid_response is not charging or v2g_discharge so it should get standard reward 1.0x
    const actionType = 'grid_response';
    return getDynamicMultiplier('CAISO', actionType).then(({ multiplier, reason }) => {
      expect(multiplier.toNumber()).toBe(1.0);
      expect(reason).toBe('Standard Reward');
    });
  });
});
