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
    mockPricingService = optimizer.pricingService;
    mockPricingService.getLatestFuelMix = jest.fn().mockResolvedValue([]);
    mockPricingService.getDARTSpreadAnalysis = jest.fn().mockResolvedValue({ volatility: 0 });
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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    const fixMsg = bids[0];

    // FIX-PROT-AUDIT: Check audit metadata
    expect(audit.physics_score).toBe(1.0);
    expect(audit.capacity_fidelity).toBe('STANDARD');

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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    const fixMsg = bids[0];

    expect(audit.capacity_fidelity).toBe('STANDARD');
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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(2);
    expect(bids[0]).toContain('38=0.00');
    expect(bids[1]).toContain('38=1.00');
    expect(audit.physics_score).toBe(1.0);
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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(0);
    expect(audit.capacity_fidelity).toBe('HIGH_FIDELITY'); // Default physics_score is 1.0
    expect(mockRedisClient.get).toHaveBeenCalledWith('l1:safety:lock');
  });

  test('should log safety lock context when bidding is halted', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const context = JSON.stringify({
      event_type: 'PHYSICS_FRAUD',
      severity: 'FRAUD',
      physics_score: 0.0,
      confidence_score: 0.0,
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

    const { audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(audit.physics_score).toBe(0.0);
    expect(audit.confidence_score).toBe(0.0);
    expect(audit.capacity_fidelity).toBe('STANDARD');
    expect(audit.audit_context.event_type).toBe('PHYSICS_FRAUD');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('L1 safety lock is active'));

    consoleSpy.mockRestore();
  });

  test('should log physics_score and confidence_score when present in safety lock context', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const context = JSON.stringify({
      event_type: 'CAPACITY_VIOLATION',
      severity: 'CRITICAL',
      physics_score: 0.85,
      confidence_score: 0.80,
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

    const { audit } = await optimizer.generateDayAheadBids('PJM');

    expect(audit.physics_score).toBe(0.85);
    expect(audit.confidence_score).toBe(0.80);
    expect(audit.capacity_fidelity).toBe('STANDARD'); // Both <= 0.95
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Score: 0.85'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Confidence: 0.8'));

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

    const { bids } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(1);
    expect(bids[0]).toContain('38=0.00'); // Should not bid as it is below $50/MWh
    expect(bids[0]).toContain('44=50.00'); // Limit price should be $50.00

    // Now set LMP to $60/MWh (which is > $50/MWh)
    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 60.00, timestamp: new Date() }
    ]);

    const { bids: activeBids } = await optimizer.generateDayAheadBids('CAISO');
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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids).toHaveLength(0);
    expect(audit.capacity_fidelity).toBe('HIGH_FIDELITY'); // Default physics_score is 1.0
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

    const { bids: ercotBids } = await optimizer.generateDayAheadBids('ERCOT');

    expect(ercotBids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l4:grid:lock:ERCOT');

    // Test hyphenated ISO normalization
    const { bids: entsoeBids } = await optimizer.generateDayAheadBids('ENTSO-E');
    expect(entsoeBids).toHaveLength(0);
    expect(mockRedisClient.get).toHaveBeenCalledWith('l4:grid:lock:ENTSOE');

    // Should NOT be locked for CAISO if only ERCOT and ENTSOE are locked
    const { bids: caisoBids } = await optimizer.generateDayAheadBids('CAISO');
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
    const { bids: ercotBids, audit: ercotAudit } = await optimizer.generateDayAheadBids('ERCOT');
    expect(ercotBids[0]).toContain('38=1.20');
    expect(ercotAudit.capacity_fidelity).toBe('HIGH_FIDELITY');

    // Test CAISO specific capacity
    const { bids: caisoBids, audit: caisoAudit } = await optimizer.generateDayAheadBids('CAISO');
    expect(caisoBids[0]).toContain('38=0.80');
    expect(caisoAudit.capacity_fidelity).toBe('STANDARD');

    // Test PJM (not in regional data) should fall back to global
    const { bids: pjmBids } = await optimizer.generateDayAheadBids('PJM');
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

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');
    expect(bids[0]).toContain('38=0.50');
    expect(audit.capacity_fidelity).toBe('STANDARD');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse regional capacity'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  test('should prioritize L3 v3.3.0 high-fidelity capacity breakdown', async () => {
    const hfData = JSON.stringify({
      'CAISO': { total: 2000, ev: 1500, bess: 500, is_high_fidelity: true }
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:regional:high_fidelity') return Promise.resolve(hfData);
      return Promise.resolve(null);
    });

    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 100.00, timestamp: new Date() }
    ]);

    const { bids, audit } = await optimizer.generateDayAheadBids('CAISO');

    expect(bids[0]).toContain('38=2.00'); // Total 2000kW = 2.0MW
    expect(audit.capacity_fidelity).toBe('HIGH_FIDELITY');
    expect(audit.audit_context.ev_capacity_kw).toBe(1500);
    expect(audit.audit_context.bess_capacity_kw).toBe(500);
    expect(audit.audit_context.v3_capacity_fidelity).toBe(true);
  });

  test('should correctly fall back to legacy regional data if high-fidelity is missing', async () => {
    const legacyData = JSON.stringify({
      'PJM': 750 // 0.75 MW
    });

    mockRedisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:regional:high_fidelity') return Promise.resolve(null);
      if (key === 'vpp:capacity:regional') return Promise.resolve(legacyData);
      return Promise.resolve(null);
    });

    mockPricingService.getDayAheadForecast.mockResolvedValue([
      { location: 'LOC1', price_per_mwh: 100.00, timestamp: new Date() }
    ]);

    const { bids, audit } = await optimizer.generateDayAheadBids('PJM');

    expect(bids[0]).toContain('38=0.75');
    expect(audit.audit_context.ev_capacity_kw).toBe(750);
    expect(audit.audit_context.bess_capacity_kw).toBe(0);
  });
});
