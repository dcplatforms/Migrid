const Decimal = require('decimal.js');
const { app, applyHardwarePenalty, redisClient } = require('../index');

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    subscribe: jest.fn(),
    run: jest.fn(),
    quit: jest.fn()
  }))
}));

describe('L10 Hardware Health Penalty (v4.3.8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applyHardwarePenalty should apply no penalty when alarm count is 0', async () => {
    redisClient.get = jest.fn().mockResolvedValue('0');

    const initialMultiplier = new Decimal(1.5);
    const initialReason = 'Grid Surplus Bonus (1.5x)';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(1.5);
    expect(result.reason).toBe(initialReason);
    expect(result.alarmCount).toBe(0);
  });

  test('applyHardwarePenalty should apply penalty for regional alarms', async () => {
    // 2 alarms = 0.10 penalty
    redisClient.get = jest.fn().mockResolvedValue('2');

    const initialMultiplier = new Decimal(1.5);
    const initialReason = 'Grid Surplus Bonus (1.5x)';

    const result = await applyHardwarePenalty('PJM', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(1.4); // 1.5 - (2 * 0.05)
    expect(result.reason).toContain('Hardware Health Penalty');
    expect(result.alarmCount).toBe(2);
    expect(result.penalty.toNumber()).toBe(0.1);
  });

  test('applyHardwarePenalty should cap penalty at 0.30', async () => {
    // 10 alarms = 0.50 penalty, but capped at 0.30
    redisClient.get = jest.fn().mockResolvedValue('10');

    const initialMultiplier = new Decimal(1.0);
    const initialReason = 'Standard Reward';

    const result = await applyHardwarePenalty('ERCOT', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(0.7); // 1.0 - 0.30
    expect(result.penalty.toNumber()).toBe(0.3);
    expect(result.alarmCount).toBe(10);
  });

  test('applyHardwarePenalty should not let multiplier go below 0.1 floor', async () => {
    redisClient.get = jest.fn().mockResolvedValue('10');

    const initialMultiplier = new Decimal(0.2);
    const initialReason = 'Low Base Reward';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    expect(result.multiplier.toNumber()).toBe(0.1); // 0.2 - 0.3 = -0.1, floor is 0.1
  });
});
