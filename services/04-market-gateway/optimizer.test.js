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
    delete process.env.DEGRADATION_COST_KWH;
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
      site_id: 'SITE-123',
      iso_region: 'CAISO',
      vpp_active: true,
      v2g_active: true
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('true');
      if (key === 'l1:safety:lock:context') return Promise.resolve(context);
      return Promise.resolve(null);
    });

    await optimizer.generateDayAheadBids('CAISO');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('L1 safety lock is active'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reason: PHYSICS_FRAUD, Severity: FRAUD, Score: N/A, Site: SITE-123, Region: CAISO, VPPActive: true, V2GActive: true'));

    consoleSpy.mockRestore();
  });

  test('should log physics_score when present in safety lock context', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const context = JSON.stringify({
      event_type: 'CAPACITY_VIOLATION',
      severity: 'CRITICAL',
      physics_score: 0.85,
      site_id: 'SITE-456',
      iso_region: 'PJM',
      vpp_active: true,
      v2g_active: false
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('true');
      if (key === 'l1:safety:lock:context') return Promise.resolve(context);
      return Promise.resolve(null);
    });

    await optimizer.generateDayAheadBids('PJM');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Score: 0.85'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reason: CAPACITY_VIOLATION, Severity: CRITICAL, Score: 0.85, Site: SITE-456, Region: PJM'));

    consoleSpy.mockRestore();
  });

  test('should respect configurable degradation cost via environment variable', async () => {
    // Set degradation cost to $0.05/kWh ($50/MWh)
    process.env.DEGRADATION_COST_KWH = '0.05';

    // LMP is $40/MWh (which is < $50/MWh)
    const lmp = 40.00;
    const capacityKw = 500;

    mockRedisClient.get.mockResolvedValue(capacityKw.toString());
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: lmp, timestamp: new Date() }
    ]);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    expect(bids[0]).toContain('38=0.00'); // Should not bid as it is below $50/MWh
    expect(bids[0]).toContain('44=50.00'); // Limit price should be $50.00

    // Now set LMP to $60/MWh (which is > $50/MWh)
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 60.00, timestamp: new Date() }
    ]);

    const activeBids = await optimizer.generateDayAheadBids('CAISO');
    expect(activeBids[0]).toContain('38=0.50'); // Should bid
    expect(activeBids[0]).toContain('44=50.00');
  });

  test('should return no bids when L4 grid lock is active', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l4:grid:lock') return Promise.resolve('true');
      if (key === 'l1:safety:lock') return Promise.resolve('false');
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const forecasts = [
      { location: 'LOC1', price_per_mwh: 50.00, timestamp: new Date() }
    ];
    mockPricingService.getDayAheadForecast.mockResolvedValue(forecasts);

    const bids = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l4:grid:lock');
  });

  test('should return no bids when regional L4 grid lock is active for specific ISO', async () => {
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'l4:grid:lock:ERCOT') return Promise.resolve('true');
      if (key === 'l4:grid:lock:ENTSOE') return Promise.resolve('true');
      if (key === 'l4:grid:lock') return Promise.resolve('false');
      if (key === 'l1:safety:lock') return Promise.resolve('false');
      if (key === 'vpp:capacity:available') return Promise.resolve('500');
      return Promise.resolve(null);
    });

    const forecasts = [
      { location: 'TEXAS_NODE', price_per_mwh: 150.00, timestamp: new Date() }
    ];
    mockPricingService.getDayAheadForecast.mockResolvedValue(forecasts);

    const bids = await optimizer.generateDayAheadBids('ERCOT');

    expect(bids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l4:grid:lock:ERCOT');

    // Test hyphenated ISO normalization
    const entsoeBids = await optimizer.generateDayAheadBids('ENTSO-E');
    expect(entsoeBids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l4:grid:lock:ENTSOE');

    // Should NOT be locked for CAISO if only ERCOT and ENTSOE are locked
    const caisoBids = await optimizer.generateDayAheadBids('CAISO');
    expect(caisoBids).toHaveLength(1);
  });

  test('should prioritize regional capacity from Redis when available', async () => {
    const globalCapacity = '500'; // 0.5 MW
    const regionalData = JSON.stringify({
      'ERCOT': { capacity: 1200, is_high_fidelity: true }, // 1.2 MW
      'CAISO': { capacity: 800, is_high_fidelity: false }   // 0.8 MW
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:available') return Promise.resolve(globalCapacity);
      if (key === 'vpp:capacity:regional') return Promise.resolve(regionalData);
      return Promise.resolve(null);
    });

    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 100.00, timestamp: new Date() }
    ]);

    // Test ERCOT specific capacity
    const ercotBids = await optimizer.generateDayAheadBids('ERCOT');
    expect(ercotBids[0]).toContain('38=1.20');

    // Test CAISO specific capacity
    const caisoBids = await optimizer.generateDayAheadBids('CAISO');
    expect(caisoBids[0]).toContain('38=0.80');

    // Test PJM (not in regional data) should fall back to global
    const pjmBids = await optimizer.generateDayAheadBids('PJM');
    expect(pjmBids[0]).toContain('38=0.50');
  });

  test('should fall back to global capacity if regional data is malformed', async () => {
    const globalCapacity = '500';
    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:available') return Promise.resolve(globalCapacity);
      if (key === 'vpp:capacity:regional') return Promise.resolve('invalid-json');
      return Promise.resolve(null);
    });

    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 100.00, timestamp: new Date() }
    ]);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const bids = await optimizer.generateDayAheadBids('CAISO');
    expect(bids[0]).toContain('38=0.50');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse regional capacity'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });
});
