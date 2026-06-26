const Decimal = require('decimal.js');
const { getDynamicMultiplier, applyHardwarePenalty, redisClient, safeFloat } = require('../index');

// Mock Redis client
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

describe('L10 Token Engine v4.3.8 - Hardware Penalty & Telemetry Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('safeFloat should enforce strict 4-decimal string formatting', () => {
    expect(safeFloat(1)).toBe('1.0000');
    expect(safeFloat(0.95)).toBe('0.9500');
    expect(safeFloat(0.99999)).toBe('1.0000'); // Rounds correctly
    expect(safeFloat('0.85')).toBe('0.8500');
    expect(safeFloat(NaN)).toBe('0.0000');
    expect(safeFloat(undefined)).toBe('0.0000');
    expect(safeFloat(null)).toBe('0.0000');
  });

  test('applyHardwarePenalty should reduce multiplier by 0.05 per regional alarm', async () => {
    // 2 alarms in CAISO
    redisClient.get.mockResolvedValue('2');
    const initialMultiplier = new Decimal(1.0);
    const initialReason = 'Standard Reward';

    const result = await applyHardwarePenalty('CAISO', initialMultiplier, initialReason);

    // 1.0 - (2 * 0.05) = 0.90
    expect(result.multiplier.toNumber()).toBe(0.90);
    expect(result.reason).toContain('Hardware Health Penalty (-0.1)');
  });

  test('applyHardwarePenalty should cap at 0.30 (6+ alarms)', async () => {
    // 10 alarms in PJM
    redisClient.get.mockResolvedValue('10');
    const initialMultiplier = new Decimal(1.5);
    const initialReason = 'Grid Surplus Bonus (1.5x)';

    const result = await applyHardwarePenalty('PJM', initialMultiplier, initialReason);

    // 1.5 - 0.30 = 1.20
    expect(result.multiplier.toNumber()).toBe(1.20);
    expect(result.reason).toContain('Hardware Health Penalty (-0.3)');
  });

  test('applyHardwarePenalty should handle ISO normalization', async () => {
    redisClient.get.mockResolvedValue('1');
    await applyHardwarePenalty('ENTSO-E', new Decimal(1.0), 'Standard');
    expect(redisClient.get).toHaveBeenCalledWith('l4:regional:alarms:ENTSOE');
  });

  test('getDynamicMultiplier should incorporate hardware penalty', async () => {
    // Mock normal price ($50) -> multiplier 1.0
    redisClient.hGet.mockResolvedValue('50.0');
    // Mock 1 regional alarm
    redisClient.get.mockResolvedValue('1');

    const result = await getDynamicMultiplier('CAISO', 'session_completed');

    // 1.0 - 0.05 = 0.95
    expect(result.multiplier.toNumber()).toBe(0.95);
    expect(result.reason).toBe('Standard Reward | Hardware Health Penalty (-0.05)');
  });

  test('Hardware penalty should not result in negative multiplier', async () => {
    // Mock high scarcity surcharge -> 0.5x
    redisClient.hGet.mockResolvedValue('150.0');
    // Mock 12 regional alarms -> penalty 0.60 (capped at 0.30)
    redisClient.get.mockResolvedValue('12');

    const result = await getDynamicMultiplier('CAISO', 'session_completed', false);

    // 0.5 - 0.30 = 0.20
    expect(result.multiplier.toNumber()).toBe(0.20);
    expect(result.reason).toContain('Hardware Health Penalty (-0.3)');
  });
});
