const Decimal = require('decimal.js');
const { getDynamicMultiplier, priceCache, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY } = require('../index');

// Setup mock prices for testing
priceCache.CAISO = { price: 20.0 }; // Surplus
priceCache.PJM = { price: 120.0 }; // Scarcity
priceCache.ERCOT = { price: 50.0 }; // Normal

describe('L10 Token Engine - Reward Logic', () => {
  beforeEach(() => {
    // Reset priceCache for tests
    priceCache['CAISO'] = { price: 20.0 }; // Surplus
    priceCache['PJM'] = { price: 120.0 }; // Scarcity
    priceCache['ERCOT'] = { price: 50.0 }; // Normal
    priceCache['ENTSOE'] = { price: 25.0 }; // European Surplus
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

  test('Multi-region support (ENTSOE, NORDPOOL) with normalization', () => {
    priceCache.ENTSOE = { price: 10.0 };
    priceCache.NORDPOOL = { price: 150.0 };

    const { multiplier: entsoeMult } = getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(entsoeMult.toNumber()).toBe(1.5);

    const { multiplier: nordpoolMult } = getDynamicMultiplier('NordPool', 'v2g_discharge');
    expect(nordpoolMult.toNumber()).toBe(2.0);
  });

  test('Decimal precision check', () => {
    const sourceValue = 12.3456789;
    const ruleMultiplier = 1.2;
    const marketMultiplier = new Decimal(1.5);
    const result = new Decimal(sourceValue).times(ruleMultiplier).times(marketMultiplier).toDecimalPlaces(8);
    expect(result.toNumber()).toBe(22.22222202);
  });
});
