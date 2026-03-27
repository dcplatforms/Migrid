const Decimal = require('decimal.js');
const { getDynamicMultiplier, priceCache, LMP_THRESHOLD_SURPLUS, LMP_THRESHOLD_SCARCITY } = require('../index');

describe('L10 Token Engine - Reward Logic', () => {
  beforeEach(() => {
    // Reset priceCache for tests
    priceCache['CAISO'] = { price: 20.0 }; // Surplus
    priceCache['PJM'] = { price: 120.0 }; // Scarcity
    priceCache['ERCOT'] = { price: 50.0 }; // Normal
    priceCache['ENTSOE'] = { price: 25.0 }; // European Surplus
  });

  test('Charging during surplus should receive 1.5x multiplier', () => {
    const mult = getDynamicMultiplier('CAISO', 'session_completed');
    expect(mult.toNumber()).toBe(1.5);
  });

  test('V2G discharge during scarcity should receive 2.0x multiplier', () => {
    const mult = getDynamicMultiplier('PJM', 'v2g_discharge');
    expect(mult.toNumber()).toBe(2.0);
  });

  test('Standard charging should receive 1.0x multiplier', () => {
    const mult = getDynamicMultiplier('ERCOT', 'session_completed');
    expect(mult.toNumber()).toBe(1.0);
  });

  test('ISO normalization (hyphens) should work', () => {
    const mult = getDynamicMultiplier('ENTSO-E', 'session_completed');
    expect(mult.toNumber()).toBe(1.5);
  });

  test('ISO normalization (lowercase) should work', () => {
    const mult = getDynamicMultiplier('caiso', 'session_completed');
    expect(mult.toNumber()).toBe(1.5);
  });

  test('Decimal precision check', () => {
    const sourceValue = 12.3456789;
    const ruleMultiplier = 1.2;
    const marketMultiplier = new Decimal(1.5);
    const result = new Decimal(sourceValue).times(ruleMultiplier).times(marketMultiplier).toDecimalPlaces(8);
    expect(result.toNumber()).toBe(22.22222202);
  });
});
