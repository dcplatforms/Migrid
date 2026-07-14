const Decimal = require('decimal.js');
const { applyHardwarePenalty, redisClient } = require('../index');

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

describe('L10 Token Engine - Hardware Health Penalty v4.3.8', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should apply 0.05 penalty for 1 regional alarm', async () => {
    redisClient.get.mockResolvedValue('1');
    const { multiplier, reason } = await applyHardwarePenalty('CAISO', 1.0, 'Standard Reward');
    expect(multiplier.toNumber()).toBe(0.95);
    expect(reason).toContain('Hardware Health Penalty (-0.05)');
  });

  test('Should apply 0.15 penalty for 3 regional alarms', async () => {
    redisClient.get.mockResolvedValue('3');
    const { multiplier, reason } = await applyHardwarePenalty('PJM', 1.5, 'Grid Surplus Bonus (1.5x)');
    expect(multiplier.toNumber()).toBe(1.35);
    expect(reason).toContain('Hardware Health Penalty (-0.15)');
  });

  test('Should cap penalty at 0.30 for 10 regional alarms', async () => {
    redisClient.get.mockResolvedValue('10');
    const { multiplier, reason } = await applyHardwarePenalty('ERCOT', 1.0, 'Standard Reward');
    expect(multiplier.toNumber()).toBe(0.70);
    expect(reason).toContain('Hardware Health Penalty (-0.30)');
  });

  test('Should not go below zero multiplier', async () => {
    redisClient.get.mockResolvedValue('10');
    const { multiplier } = await applyHardwarePenalty('CAISO', 0.2, 'Low Base');
    expect(multiplier.toNumber()).toBe(0);
  });

  test('Should not apply penalty if no alarms', async () => {
    redisClient.get.mockResolvedValue(null);
    const { multiplier, reason } = await applyHardwarePenalty('CAISO', 1.0, 'Standard Reward');
    expect(multiplier.toNumber()).toBe(1.0);
    expect(reason).toBe('Standard Reward');
  });

  test('Should handle Redis error gracefully', async () => {
    redisClient.get.mockRejectedValue(new Error('Redis Error'));
    const { multiplier, reason } = await applyHardwarePenalty('CAISO', 1.0, 'Standard Reward');
    expect(multiplier.toNumber()).toBe(1.0);
    expect(reason).toBe('Standard Reward');
  });
});
