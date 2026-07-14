const { applyHardwarePenalty, redisClient } = require('../index');
const Decimal = require('decimal.js');

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    quit: jest.fn()
  }))
}));

describe('L10 v4.3.8 Hardware Health Penalty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applyHardwarePenalty applies correct reduction for 1 alarm', async () => {
    redisClient.get.mockResolvedValueOnce('1'); // 1 alarm

    const initialMultiplier = new Decimal('1.5');
    const initialReason = 'Grid Surplus Bonus (1.5x)';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(1.45); // 1.5 - 0.05
    expect(result.reason).toContain('Hardware Health Penalty (0.05)');
    expect(result.applied).toBe(true);
  });

  test('applyHardwarePenalty normalizes ISO strings correctly (e.g. CA-ISO)', async () => {
    redisClient.get.mockResolvedValueOnce('1');

    const initialMultiplier = new Decimal('1.0');
    const initialReason = 'Standard Reward';

    // Pass non-normalized ISO
    await applyHardwarePenalty('ca-iso', initialMultiplier, initialReason);

    // Verify it checked the normalized key
    expect(redisClient.get).toHaveBeenCalledWith('l4:regional:alarms:CAISO');
  });

  test('applyHardwarePenalty caps reduction at 0.30 for 10 alarms', async () => {
    redisClient.get.mockResolvedValueOnce('10'); // 10 alarms -> 0.50 penalty, but capped at 0.30

    const initialMultiplier = new Decimal('1.0');
    const initialReason = 'Standard Reward';

    const result = await applyHardwarePenalty('PJM', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(0.70); // 1.0 - 0.30
    expect(result.reason).toContain('Hardware Health Penalty (0.30)');
    expect(result.applied).toBe(true);
  });

  test('applyHardwarePenalty does not go below zero', async () => {
    redisClient.get.mockResolvedValueOnce('10'); // 0.30 penalty

    const initialMultiplier = new Decimal('0.2');
    const initialReason = 'Some Low Multiplier';

    const result = await applyHardwarePenalty('ERCOT', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(0); // 0.2 - 0.3 = -0.1 -> 0
  });

  test('applyHardwarePenalty handles no alarms correctly', async () => {
    redisClient.get.mockResolvedValueOnce('0');

    const initialMultiplier = new Decimal('1.0');
    const initialReason = 'Standard Reward';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.applied).toBe(false);
  });

  test('applyHardwarePenalty handles missing redis data', async () => {
    redisClient.get.mockResolvedValueOnce(null);

    const initialMultiplier = new Decimal('1.0');
    const initialReason = 'Standard Reward';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(1.0);
    expect(result.applied).toBe(false);
  });
});
