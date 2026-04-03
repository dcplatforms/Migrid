const Decimal = require('decimal.js');
const { getDynamicMultiplier, redisClient } = require('../index');

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

describe('L10 Token Engine - Reward Logic v4.3.0', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Charging during surplus should receive 1.5x multiplier', () => {
    const { multiplier, reason } = getDynamicMultiplier('CAISO', 'session_completed');
    expect(multiplier.toNumber()).toBe(1.5);
    expect(reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('Green charging during surplus should receive 1.5x multiplier (Alignment)', () => {
    const { multiplier, reason } = getDynamicMultiplier('CAISO', 'green_charging');
    expect(multiplier.toNumber()).toBe(1.5);
    expect(reason).toBe('Grid Surplus Bonus (1.5x)');
  });

  test('V2G discharge during scarcity should receive 2.0x multiplier', () => {
    const { multiplier, reason } = getDynamicMultiplier('PJM', 'v2g_discharge');
    expect(multiplier.toNumber()).toBe(2.0);
    expect(reason).toBe('High Scarcity Reward (2.0x)');
  });

  test('Standard charging should receive 1.0x multiplier', () => {
    const { multiplier, reason } = getDynamicMultiplier('ERCOT', 'session_completed');
    expect(multiplier.toNumber()).toBe(1.0);
    expect(reason).toBe('Standard Reward');
  });

  test('Charging during scarcity without VPP alignment should receive 0.5x penalty', () => {
    const mult = getDynamicMultiplier('PJM', 'session_completed', false);
    expect(mult.toNumber()).toBe(0.5);
  });

  test('Charging during scarcity with VPP alignment should receive 2.0x bonus', () => {
    const mult = getDynamicMultiplier('PJM', 'session_completed', true);
    expect(mult.toNumber()).toBe(2.0);
  });

  test('Standard charging should receive 1.0x multiplier', async () => {
    // Mock Redis returning normal price ($50)
    redisClient.hGet.mockResolvedValue('50.0');

    const result = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.reason).toBe('Standard');
  });

    const { multiplier: entsoeMult } = getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(entsoeMult.toNumber()).toBe(1.5);
    expect(redisClient.hGet).toHaveBeenLastCalledWith('market:profitability', 'ENTSOE');

    const { multiplier: nordpoolMult } = getDynamicMultiplier('NordPool', 'v2g_discharge');
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
    expect(result.reason).toBe('Standard');
  });
});
