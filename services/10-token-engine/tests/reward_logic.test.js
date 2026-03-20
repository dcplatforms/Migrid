const Decimal = require('decimal.js');

// Mock data and constants
const priceCache = {
  CAISO: { price: 20.0 }, // Surplus
  PJM: { price: 120.0 }, // Scarcity
  ERCOT: { price: 50.0 } // Normal
};

const LMP_THRESHOLD_SURPLUS = new Decimal('30.0');
const LMP_THRESHOLD_SCARCITY = new Decimal('100.0');

function getDynamicMultiplier(iso, actionType) {
  const priceData = priceCache[iso.toUpperCase()];
  const latestPrice = priceData ? new Decimal(priceData.price) : new Decimal(50.0);

  if (actionType === 'session_completed' && latestPrice.lt(LMP_THRESHOLD_SURPLUS)) {
    return new Decimal(1.5);
  } else if (actionType === 'v2g_discharge' && latestPrice.gt(LMP_THRESHOLD_SCARCITY)) {
    return new Decimal(2.0);
  }

  return new Decimal(1.0);
}

describe('L10 Token Engine - Reward Logic', () => {
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

  test('Decimal precision check', () => {
    const sourceValue = 12.3456789;
    const ruleMultiplier = 1.2;
    const marketMultiplier = new Decimal(1.5);
    const result = new Decimal(sourceValue).times(ruleMultiplier).times(marketMultiplier).toDecimalPlaces(8);
    expect(result.toNumber()).toBe(22.22222202);
  });
});
