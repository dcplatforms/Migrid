const { applyHardwarePenalty, safeFloat } = require('../index');
const Decimal = require('decimal.js');
const redis = require('redis');

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    quit: jest.fn()
  })
}));

describe('L10 v4.3.8: Hardware Health Penalty & Telemetry Precision', () => {
  let redisMock;

  beforeEach(() => {
    redisMock = redis.createClient();
    // We need to access the mock instance used by index.js if possible,
    // but since index.js creates its own, we rely on the jest.mock above.
    // Actually, index.js exports redisClient.
    const { redisClient } = require('../index');
    redisMock = redisClient;
  });

  describe('applyHardwarePenalty', () => {
    it('should apply a penalty of 0.05 per alarm', async () => {
      redisMock.get.mockResolvedValue('2'); // 2 alarms
      const initialMultiplier = new Decimal('1.5');
      const initialReason = 'Grid Surplus Bonus (1.5x)';

      const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

      expect(result.multiplier.toNumber()).toBe(1.4); // 1.5 - (2 * 0.05)
      expect(result.reason).toContain('Hardware Penalty: -0.1 due to 2 alarms');
    });

    it('should cap the penalty at 0.30', async () => {
      redisMock.get.mockResolvedValue('10'); // 10 alarms -> 0.5 penalty if not capped
      const initialMultiplier = new Decimal('1.5');
      const initialReason = 'Grid Surplus Bonus (1.5x)';

      const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

      expect(result.multiplier.toNumber()).toBe(1.2); // 1.5 - 0.30 (capped)
      expect(result.reason).toContain('Hardware Penalty: -0.3 due to 10 alarms');
    });

    it('should handle zero alarms without penalty', async () => {
      redisMock.get.mockResolvedValue(null);
      const initialMultiplier = new Decimal('1.0');
      const initialReason = 'Standard Reward';

      const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

      expect(result.multiplier.toNumber()).toBe(1.0);
      expect(result.reason).toBe('Standard Reward');
    });

    it('should not result in a negative multiplier', async () => {
      redisMock.get.mockResolvedValue('10'); // 0.30 penalty
      const initialMultiplier = new Decimal('0.2');
      const initialReason = 'Low Scarcity Surcharge (0.2x)';

      const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

      expect(result.multiplier.toNumber()).toBe(0);
    });
  });

  describe('safeFloat', () => {
    it('should format numbers to 4 decimal places as strings', () => {
      expect(safeFloat(1.23456)).toBe('1.2346');
      expect(safeFloat(0.1)).toBe('0.1000');
    });

    it('should handle NaN and return fallback formatted to 4 decimals', () => {
      expect(safeFloat('invalid', 0.5)).toBe('0.5000');
      expect(safeFloat(NaN, 0.0)).toBe('0.0000');
    });

    it('should handle string numbers', () => {
      expect(safeFloat('0.98765')).toBe('0.9877');
    });
  });
});
