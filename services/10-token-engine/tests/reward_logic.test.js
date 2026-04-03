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

describe('L10 Token Engine - Reward Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Charging during surplus should receive 1.5x multiplier', async () => {
    // Mock Redis returning surplus price
    redisClient.hGet.mockResolvedValue('20.0');

    const mult = await getDynamicMultiplier('CAISO', 'session_completed');
    expect(mult.toNumber()).toBe(1.5);
    expect(redisClient.hGet).toHaveBeenCalledWith('market:profitability', 'CAISO');
  });

  test('V2G discharge during scarcity should receive 2.0x multiplier', async () => {
    // Mock Redis returning scarcity price
    redisClient.hGet.mockResolvedValue('120.0');

    const mult = await getDynamicMultiplier('PJM', 'v2g_discharge');
    expect(mult.toNumber()).toBe(2.0);
    expect(redisClient.hGet).toHaveBeenCalledWith('market:profitability', 'PJM');
  });

  test('Standard charging should receive 1.0x multiplier', async () => {
    // Mock Redis returning normal price
    redisClient.hGet.mockResolvedValue('50.0');

    const mult = await getDynamicMultiplier('ERCOT', 'session_completed');
    expect(mult.toNumber()).toBe(1.0);
  });

  test('Multi-region support (ENTSOE, NORDPOOL) with normalization', async () => {
    // ENTSOE Surplus
    redisClient.hGet.mockResolvedValueOnce('10.0');
    const entsoeMult = await getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(entsoeMult.toNumber()).toBe(1.5);
    expect(redisClient.hGet).toHaveBeenLastCalledWith('market:profitability', 'ENTSOE');

    // NORDPOOL Scarcity
    redisClient.hGet.mockResolvedValueOnce('150.0');
    const nordpoolMult = await getDynamicMultiplier('NordPool', 'v2g_discharge');
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
});
