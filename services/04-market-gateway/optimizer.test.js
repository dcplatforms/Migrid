const BiddingOptimizer = require('./BiddingOptimizer');
const MarketPricingService = require('./MarketPricingService');
const { createClient } = require('redis');

jest.mock('redis');
jest.mock('./MarketPricingService');

describe('BiddingOptimizer', () => {
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
    // BiddingOptimizer creates its own MarketPricingService, so we need to access it or mock the constructor
    mockPricingService = MarketPricingService.prototype;
  });

  test('should bid 0 MW when LMP is below 0.02 USD/kWh ($20/MWh)', async () => {
    // 0.015 USD/kWh = 15 USD/MWh
    const lowLmp = 15.00;
    const capacityKw = 500; // 0.5 MW

    mockRedisClient.get.mockResolvedValue(capacityKw.toString());
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'SLAP_PGP2-APND', price_per_mwh: lowLmp, timestamp: new Date() }
    ]);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    const fixMsg = bids[0];

    // FIX tag 38 is OrderQty
    expect(fixMsg).toContain('38=0.00');
    // FIX tag 44 is Price, should be degradation cost ($20.00/MWh)
    expect(fixMsg).toContain('44=20.00');
    expect(fixMsg).toContain('56=CAISO');
  });

  test('should bid full capacity when LMP is above 0.02 USD/kWh ($20/MWh)', async () => {
    // 0.03 USD/kWh = 30 USD/MWh
    const highLmp = 30.00;
    const capacityKw = 500; // 0.5 MW

    mockRedisClient.get.mockResolvedValue(capacityKw.toString());
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'SLAP_PGP2-APND', price_per_mwh: highLmp, timestamp: new Date() }
    ]);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    const fixMsg = bids[0];

    // 500 kW = 0.50 MW
    expect(fixMsg).toContain('38=0.50');
    // Limit price should still be degradation cost ($20.00/MWh)
    expect(fixMsg).toContain('44=20.00');
    // FIX tag 40 is OrdType, 2 = Limit
    expect(fixMsg).toContain('40=2');
  });

  test('should handle multiple intervals in the day-ahead forecast', async () => {
    const capacityKw = 1000; // 1.0 MW
    mockRedisClient.get.mockResolvedValue(capacityKw.toString());

    const now = new Date();
    const forecast = [
      { location: 'LOC1', price_per_mwh: 10.00, timestamp: new Date(now.getTime() + 3600000) }, // Hour 1: Low price
      { location: 'LOC1', price_per_mwh: 50.00, timestamp: new Date(now.getTime() + 7200000) }, // Hour 2: High price
    ];
    mockPricingService.getDayAheadForecast.mockResolvedValue(forecast);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(2);
    expect(bids[0]).toContain('38=0.00');
    expect(bids[1]).toContain('38=1.00');
  });

  test('should return no bids when L1 safety lock is active', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('true');
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const forecasts = [
      { location: 'LOC1', price_per_mwh: 50.00, timestamp: new Date() }
    ];
    mockPricingService.getDayAheadForecast.mockResolvedValue(forecasts);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l1:safety:lock');
  });

  test('should log safety lock context when bidding is halted', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const context = JSON.stringify({
      event_type: 'PHYSICS_FRAUD',
      severity: 'FRAUD',
      site_id: 'SITE-123'
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('true');
      if (key === 'l1:safety:lock:context') return Promise.resolve(context);
      return Promise.resolve(null);
    });

    await optimizer.generateDayAheadBids('CAISO');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('L1 safety lock is active'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reason: PHYSICS_FRAUD, Severity: FRAUD, Site: SITE-123'));

    consoleSpy.mockRestore();
  });
});
