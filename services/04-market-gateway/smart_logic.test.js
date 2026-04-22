const BiddingOptimizer = require('./BiddingOptimizer');
const MarketPricingService = require('./MarketPricingService');
const { createClient } = require('redis');

jest.mock('redis');
jest.mock('./MarketPricingService');

describe('BiddingOptimizer Smart Logic', () => {
  let optimizer;
  let mockPool;
  let mockRedisClient;
  let mockPricingService;

  beforeEach(() => {
    mockPool = {};
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(),
      get: jest.fn(),
      quit: jest.fn().mockResolvedValue(),
      on: jest.fn(),
    };
    createClient.mockReturnValue(mockRedisClient);

    optimizer = new BiddingOptimizer(mockPool, 'redis://localhost:6379');
    mockPricingService = optimizer.pricingService;
  });

  test('Carbon-Aware: should apply green premium when renewables are high', async () => {
    const capacityKw = 1000;
    mockRedisClient.get.mockResolvedValue(capacityKw.toString());

    // High renewables (> 60%)
    mockPricingService.getLatestFuelMix.mockResolvedValue([
      { fuel_type: 'solar', gen_mw: 700 },
      { fuel_type: 'gas', gen_mw: 300 }
    ]);

    // LMP is $25/MWh. Degradation is $20/MWh.
    // Usually we bid, but since it's "green", we want a $10 premium ($20 + $10 = $30).
    // $25 < $30, so should NOT bid.
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 25.00, timestamp: new Date() }
    ]);
    mockPricingService.getDARTSpreadAnalysis.mockResolvedValue({ volatility: 0 });

    const { bids } = await optimizer.generateDayAheadBids('CAISO');
    expect(bids[0]).toContain('38=0.00');

    // If LMP is $35/MWh ($35 > $30), we SHOULD bid.
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 35.00, timestamp: new Date() }
    ]);
    const { bids: activeBids } = await optimizer.generateDayAheadBids('CAISO');
    expect(activeBids[0]).toContain('38=1.00');
  });

  test('DA/RT Arbitrage: should hold 30% capacity when volatility is high', async () => {
    const capacityKw = 1000;
    mockRedisClient.get.mockResolvedValue(capacityKw.toString());

    mockPricingService.getLatestFuelMix.mockResolvedValue([]);

    // LMP is $50/MWh (well above $20 degradation)
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 50.00, timestamp: new Date() }
    ]);

    // High volatility (> 20)
    mockPricingService.getDARTSpreadAnalysis.mockResolvedValue({ volatility: 35.5 });

    const { bids } = await optimizer.generateDayAheadBids('CAISO');

    // Should only bid 70% of 1.0 MW = 0.70 MW
    expect(bids[0]).toContain('38=0.70');
  });
});
