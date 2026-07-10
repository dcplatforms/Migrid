const { applyHardwarePenalty, safeFloat, extractSiteId } = require('../index');
const Decimal = require('decimal.js');

// Mock Redis Client
const redisMock = {
  get: jest.fn()
};

// Inject mock into the required module's scope if necessary,
// but since we are testing exported functions that might depend on a global redisClient,
// we need to be careful. In index.js, applyHardwarePenalty uses the top-level redisClient.

// Let's mock redis globally for the test
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    subscribe: jest.fn(),
    run: jest.fn()
  })
}));

const { redisClient } = require('../index');

describe('L10 v4.3.8 Hardware Health Penalty & Telemetry', () => {

  describe('applyHardwarePenalty', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should apply 0.05 penalty per alarm (2 alarms = 0.10 penalty)', async () => {
      redisClient.get.mockResolvedValue('2');
      const totalMultiplier = new Decimal('1.5');
      const result = await applyHardwarePenalty('CAISO', totalMultiplier, 'Standard Reward');

      expect(result.multiplier.toNumber()).toBe(1.4);
      expect(result.reason).toContain('Hardware Health Penalty (0.1x)');
    });

    it('should cap the penalty at 0.30 (10 alarms = 0.30 penalty)', async () => {
      redisClient.get.mockResolvedValue('10');
      const totalMultiplier = new Decimal('1.5');
      const result = await applyHardwarePenalty('PJM', totalMultiplier, 'Standard Reward');

      expect(result.multiplier.toNumber()).toBe(1.2);
      expect(result.reason).toContain('Hardware Health Penalty (0.3x)');
    });

    it('should not go below the 0.1x floor', async () => {
      redisClient.get.mockResolvedValue('10'); // 0.3 penalty
      const totalMultiplier = new Decimal('0.2');
      const result = await applyHardwarePenalty('ERCOT', totalMultiplier, 'Standard Reward');

      expect(result.multiplier.toNumber()).toBe(0.1);
    });

    it('should return original multiplier if no alarms found', async () => {
      redisClient.get.mockResolvedValue(null);
      const totalMultiplier = new Decimal('1.0');
      const result = await applyHardwarePenalty('CAISO', totalMultiplier, 'Standard Reward');

      expect(result.multiplier.toNumber()).toBe(1.0);
      expect(result.reason).toBe('Standard Reward');
    });
  });

  describe('safeFloat Telemetry Precision', () => {
    it('should format valid floats to 4 decimal places as strings', () => {
      expect(safeFloat(0.98765)).toBe('0.9877');
      expect(safeFloat(1)).toBe('1.0000');
      expect(safeFloat('0.95')).toBe('0.9500');
    });

    it('should return 0.0000 for invalid inputs', () => {
      expect(safeFloat(NaN)).toBe('0.0000');
      expect(safeFloat(undefined)).toBe('0.0000');
      expect(safeFloat('not-a-number')).toBe('0.0000');
    });
  });

  describe('extractSiteId Multi-key Support', () => {
    it('should extract site_id', () => {
      expect(extractSiteId({ site_id: 'SITE_A' })).toBe('SITE_A');
    });
    it('should extract siteId', () => {
      expect(extractSiteId({ siteId: 'SITE_B' })).toBe('SITE_B');
    });
    it('should extract location_id', () => {
      expect(extractSiteId({ location_id: 'SITE_C' })).toBe('SITE_C');
    });
    it('should extract locationId', () => {
      expect(extractSiteId({ locationId: 'SITE_D' })).toBe('SITE_D');
    });
    it('should return null if no site key found', () => {
      expect(extractSiteId({ other: 'data' })).toBeNull();
    });
  });
});
