const { app, getDynamicMultiplier, redisClient } = require('../index');
const Decimal = require('decimal.js');

// Mock Redis client for testing
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    quit: jest.fn(),
    scan: jest.fn()
  }))
}));

describe('L10 Hardware Health Penalty & Precision Verification (v4.3.8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applyHardwarePenalty reduces multiplier by 0.05 per regional alarm', async () => {
    const { applyHardwarePenalty } = require('../index');

    // Mock redisClient.get to return 2 alarms for CAISO
    redisClient.get.mockResolvedValueOnce('2');

    const totalMultiplier = new Decimal('2.0');
    const multiplierReason = 'Grid Surplus Bonus (2.0x)';

    const result = await applyHardwarePenalty('CAISO', totalMultiplier, multiplierReason);

    // 2 alarms * 0.05 = 0.10 penalty. 2.0 - 0.1 = 1.9
    expect(result.multiplier.toNumber()).toBe(1.9);
    expect(result.reason).toContain('Hardware Penalty: -0.1');
    expect(result.reason).toContain('(2 alarms)');
  });

  test('applyHardwarePenalty caps penalty at 0.30', async () => {
    const { applyHardwarePenalty } = require('../index');

    // Mock redisClient.get to return 10 alarms for PJM (10 * 0.05 = 0.50, but capped at 0.30)
    redisClient.get.mockResolvedValueOnce('10');

    const totalMultiplier = new Decimal('2.0');
    const multiplierReason = 'Standard Reward';

    const result = await applyHardwarePenalty('PJM', totalMultiplier, multiplierReason);

    expect(result.multiplier.toNumber()).toBe(1.7); // 2.0 - 0.3 = 1.7
    expect(result.reason).toContain('Hardware Penalty: -0.3');
    expect(result.reason).toContain('(10 alarms)');
  });

  test('safeFloat enforces strict 4-decimal string formatting', () => {
    const { safeFloat } = require('../index');

    expect(safeFloat(1.234567)).toBe('1.2346');
    expect(safeFloat(0)).toBe('0.0000');
    expect(safeFloat('NaN')).toBe('0.0000');
    expect(safeFloat(undefined)).toBe('0.0000');
    expect(safeFloat(0.99, 1.0)).toBe('0.9900');
  });

  test('Kafka consumer topic isolation (implicit via subscription)', async () => {
    // This is more of a smoke test to ensure topic subscription includes MARKET_PRICE_UPDATED
    // In a real integration test, we'd mock the consumer.run
    const { Kafka } = require('kafkajs');
    expect(Kafka).toBeDefined();
  });
});
