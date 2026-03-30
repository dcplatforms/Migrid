const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, redisClient, producer } = require('./index');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const mockToken = jwt.sign({ fleet_id: 'fleet-123' }, JWT_SECRET);

// Mock Redis (Virtual to bypass environment issues)
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn(),
    setEx: jest.fn().mockResolvedValue(),
    sAdd: jest.fn().mockResolvedValue(),
    sRem: jest.fn().mockResolvedValue(),
    sMembers: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue(),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    mGet: jest.fn().mockResolvedValue([]),
    on: jest.fn()
  })
}), { virtual: true });

// Mock Kafka (Virtual)
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      producer: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(),
        send: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue()
      }),
      consumer: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(),
        subscribe: jest.fn().mockResolvedValue(),
        run: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue()
      })
    }))
  };
}, { virtual: true });

// Mock PG (Virtual)
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue()
  };
  return { Pool: jest.fn(() => mPool) };
}, { virtual: true });

// Mock dotenv (Virtual)
jest.mock('dotenv', () => ({
  config: jest.fn()
}), { virtual: true });

describe('L2 Grid Signal Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /openadr/v3/events should accept valid OpenADR event with AUTH', async () => {
    redisClient.get.mockResolvedValue(null); // No safety lock

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-123',
        type: 'demand-response',
        priority: 'HIGH',
        signals: [{ type: 'level', value: 1 }]
      });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('RECEIVED');
    expect(response.body.event_id).toBe('evt-123');
    expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'grid_signals',
      messages: expect.arrayContaining([
        expect.objectContaining({
          value: expect.stringMatching(/"site_id":"ALL"/)
        })
      ])
    }));
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.signals).toEqual([{ type: 'level', value: 1 }]);
    expect(sentValue.v2g_requested).toBe(false);
    expect(sentValue.program_id).toBe('DEFAULT');
  });

  test('POST /openadr/v3/events should accept program_id (OpenADR 3.1.0)', async () => {
    redisClient.get.mockResolvedValue(null);

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-310',
        type: 'demand-response',
        program_id: 'PROG-ABC'
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.program_id).toBe('PROG-ABC');
  });

  test('POST /openadr/v3/events should include market_price_at_session and high-fidelity metadata in broadcast', async () => {
    const mockMarketContext = {
      price_per_mwh: 42.5,
      profitability_index: 22.5,
      degradation_cost_mwh: 20.0
    };

    redisClient.get.mockImplementation((key) => {
      if (key === 'market:context:CAISO') return Promise.resolve(JSON.stringify(mockMarketContext));
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-high-fidelity-check',
        type: 'demand-response',
        targets: [{ type: 'region', value: 'caiso' }],
        metadata: {
          billing_mode: 'V2G_OPTIMIZED'
        }
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.market_price_at_session).toBe(42.5);
    expect(sentValue.profitability_index).toBe(22.5);
    expect(sentValue.degradation_cost_mwh).toBe(20.0);
    expect(sentValue.billing_mode).toBe('V2G_OPTIMIZED');
  });

  test('POST /openadr/v3/events should include physics_score in broadcast (Phase 5)', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({ physics_score: '0.9850' }));
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-physics-check',
        type: 'demand-response'
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.physics_score).toBe(0.9850);
    expect(sentValue.fidelity_status).toBe('HIGH_FIDELITY');
  });

  test('POST /openadr/v3/events should include STANDARD fidelity_status when score <= 0.95', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({ physics_score: '0.8500' }));
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-standard-fidelity',
        type: 'demand-response'
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.physics_score).toBe(0.8500);
    expect(sentValue.fidelity_status).toBe('STANDARD');
    expect(sentValue.physics_score).toBe('0.9850');
    expect(sentValue.fidelity_status).toBe('HIGH_FIDELITY');
  });

  test('POST /openadr/v3/events should preserve zero price per MWh (Nullish Coalescing L2 v2.4.1)', async () => {
    const mockMarketContext = {
      price_per_mwh: 0,
      profitability_index: 0
    };

    redisClient.get.mockImplementation((key) => {
      if (key === 'market:context:CAISO') return Promise.resolve(JSON.stringify(mockMarketContext));
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-zero-price',
        type: 'demand-response',
        targets: [{ type: 'region', value: 'caiso' }]
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.market_price_at_session).toBe(0); // Should be exactly 0, not defaulted
  });

  test('POST /openadr/v3/events should support program_id (3.1.0 Alignment)', async () => {
    redisClient.get.mockResolvedValue(null);

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-prog-1',
        program_id: 'PROG-ALPHA',
        type: 'demand-response'
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.program_id).toBe('PROG-ALPHA');
  });

  test('POST /openadr/v3/events should detect V2G requests', async () => {
    redisClient.get.mockResolvedValue(null);

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-v2g',
        type: 'discharge',
        signals: [{ type: 'level', value: -1 }]
      });

    expect(response.status).toBe(202);
    expect(producer.send).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'grid_signals',
      messages: expect.arrayContaining([
        expect.objectContaining({
          value: expect.stringContaining('"v2g_requested":true')
        })
      ])
    }));
  });

  test('POST /openadr/v3/events should include L8 site status in broadcast', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l8:site:status:SITE-456') return Promise.resolve('SAFE_MODE');
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-site-status',
        type: 'demand-response',
        site_id: 'SITE-456'
      });

    expect(response.status).toBe(202);
    const sentValue = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(sentValue.site_status).toBe('SAFE_MODE');
  });

  test('POST /openadr/v3/events should reject unauthorized request', async () => {
    const response = await request(app)
      .post('/openadr/v3/events')
      .send({ id: 'evt-auth', type: 'demand-response' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHORIZED');
  });

  test('GET /openadr/v3/reports should return recent events and market context', async () => {
    const mockMarketContext = {
      iso: 'CAISO',
      price_per_mwh: 45.5,
      profitability_index: 25.5,
      updated_at: new Date().toISOString()
    };

    redisClient.get.mockImplementation((key) => {
      if (key === 'market:latest:context') return Promise.resolve(JSON.stringify(mockMarketContext));
      return Promise.resolve(null);
    });

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('reports');
    expect(response.body.market_context.iso).toBe('CAISO');
    expect(response.body.market_context.price_per_mwh).toBe(45.5);
    expect(response.body.safety_lock.active).toBe(false);
    expect(response.body).toHaveProperty('timestamp');
  });

  test('GET /openadr/v3/reports should return regional market contexts', async () => {
    const mockCaisoContext = { iso: 'CAISO', price_per_mwh: 45.5 };
    const mockErcotContext = { iso: 'ERCOT', price_per_mwh: 120.0 };

    redisClient.scan.mockResolvedValue({ cursor: 0, keys: ['market:context:CAISO', 'market:context:ERCOT'] });
    redisClient.mGet.mockResolvedValue([
      JSON.stringify(mockCaisoContext),
      JSON.stringify(mockErcotContext)
    ]);

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body.regional_markets.CAISO.price_per_mwh).toBe(45.5);
    expect(response.body.regional_markets.ERCOT.price_per_mwh).toBe(120.0);
  });

  test('GET /openadr/v3/reports should return regional capacity data (Phase 5)', async () => {
    const mockRegionalCapacity = { CAISO: 500.5, ERCOT: 1200.0 };

    redisClient.get.mockImplementation((key) => {
      if (key === 'vpp:capacity:regional') return Promise.resolve(JSON.stringify(mockRegionalCapacity));
      return Promise.resolve(null);
    });

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body.regional_capacity.CAISO).toBe(500.5);
    expect(response.body.regional_capacity.ERCOT).toBe(1200.0);
  });

  test('GET /openadr/v3/reports should aggregate regional digital twin stats from L1 keys', async () => {
    const mockVehicle1 = { id: 'V1', physics_score: 0.98 };
    const mockVehicle2 = { id: 'V2', physics_score: 0.80 };

    redisClient.scan.mockImplementation((cursor, options) => {
      if (options && options.MATCH === 'l1:*:vehicle:*') {
        if (cursor === '0' || cursor === 0) {
          return Promise.resolve({ cursor: '123', keys: ['l1:CAISO:vehicle:V1'] });
        }
        return Promise.resolve({ cursor: 0, keys: ['l1:ERCOT:vehicle:V2'] });
      }
      return Promise.resolve({ cursor: 0, keys: [] });
    });

    redisClient.mGet.mockImplementation((keys) => {
      if (keys.includes('l1:CAISO:vehicle:V1')) return Promise.resolve([JSON.stringify(mockVehicle1)]);
      if (keys.includes('l1:ERCOT:vehicle:V2')) return Promise.resolve([JSON.stringify(mockVehicle2)]);
      return Promise.resolve([]);
    });

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body.digital_twin.CAISO.vehicle_count).toBe(1);
    expect(response.body.digital_twin.CAISO.high_fidelity_count).toBe(1);
    expect(response.body.digital_twin.ERCOT.vehicle_count).toBe(1);
    expect(response.body.digital_twin.ERCOT.high_fidelity_count).toBe(0);
  });

  test('GET /openadr/v3/reports should return safety context when locked', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('1');
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        severity: 'FRAUD',
        iso_region: 'ERCOT'
      }));
      return Promise.resolve(null);
    });

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body.safety_lock.active).toBe(true);
    expect(response.body.safety_lock.context.iso_region).toBe('ERCOT');
  });

  test('POST /openadr/v3/events should reject when L1 safety lock is active (Phase 5 Alignment)', async () => {
    // Phase 5 uses '1' or 'true' for the lock key
    redisClient.get.mockImplementation((key) => {
      if (key === 'l1:safety:lock') return Promise.resolve('1');
      if (key === 'l1:safety:lock:context') return Promise.resolve(JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        severity: 'CRITICAL',
        site_id: 'SITE-001'
      }));
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-456',
        type: 'demand-response'
      });

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('REJECTED');
    expect(response.body.reason).toBe('SAFETY_VIOLATION_L1');
    expect(response.body.details.alert_type).toBe('CAPACITY_VIOLATION');
    expect(redisClient.get).toHaveBeenCalledWith('l1:safety:lock');
  });

  test('POST /openadr/v3/events should return 400 for invalid payload (Ajv Validation)', async () => {
    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({ id: 'bad-payload' }); // Missing 'type'

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.message).toBe('Schema validation failed');
  });

  test('startSafetyConsumer should activate lock for high variance (>15%)', async () => {
    const { consumer } = require('./index');
    const { startSafetyConsumer } = require('./index');

    // We need to trigger the consumer.run call
    await startSafetyConsumer();

    const runMock = consumer.run;
    const eachMessage = runMock.mock.calls[0][0].eachMessage;

    const highVarianceAlert = {
      severity: 'WARNING',
      event_type: 'EFFICIENCY_ALERT',
      site_id: 'SITE-999',
      variance_pct: 18.5,
      vehicle_id: 'V-123',
      billing_mode: 'PREPAID',
      vpp_active: true,
      v2g_active: true,
      iso_region: 'CAISO'
    };

    await eachMessage({
      topic: 'migrid.physics.alerts',
      message: { value: Buffer.from(JSON.stringify(highVarianceAlert)) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith('l1:safety:lock', 900, '1');
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l1:safety:lock:context',
      900,
      expect.stringContaining('"reason":"HIGH_VARIANCE_THRESHOLD"')
    );
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l1:safety:lock:context',
      900,
      expect.stringContaining('"iso_region":"CAISO"')
    );
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l1:safety:lock:context',
      900,
      expect.stringContaining('"v2g_active":true')
    );
  });

  test('startSafetyConsumer should preserve market_price_at_session in lock context', async () => {
    const { consumer, startSafetyConsumer } = require('./index');
    await startSafetyConsumer();

    const eachMessage = consumer.run.mock.calls[0][0].eachMessage;

    const criticalAlert = {
      severity: 'CRITICAL',
      event_type: 'CAPACITY_VIOLATION',
      site_id: 'SITE-LOCK-1',
      market_price_at_session: 150.0,
      iso_region: 'PJM'
    };

    await eachMessage({
      topic: 'migrid.physics.alerts',
      message: { value: Buffer.from(JSON.stringify(criticalAlert)) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l1:safety:lock:context',
      900,
      expect.stringContaining('"market_price_at_session":150')
    );
  });

  test('startSafetyConsumer should cache L8 site status updates', async () => {
    const { consumer, startSafetyConsumer } = require('./index');
    await startSafetyConsumer();

    const eachMessage = consumer.run.mock.calls[0][0].eachMessage;

    const l8Update = {
      site_id: 'SITE-X',
      status: 'METER_OFFLINE',
      timestamp: new Date().toISOString()
    };

    await eachMessage({
      topic: 'migrid.l8.status',
      message: { value: Buffer.from(JSON.stringify(l8Update)) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l8:site:status:SITE-X',
      3600,
      'METER_OFFLINE'
    );
  });

  test('startSafetyConsumer should cache market price updates with degradation cost and ISO Normalization (v2.4.1)', async () => {
    const { consumer, startSafetyConsumer } = require('./index');
    await startSafetyConsumer();

    const eachMessage = consumer.run.mock.calls[0][0].eachMessage;

    const marketUpdate = {
      iso: 'ENTSO-E',
      price_per_mwh: 120.0,
      profitability_index: 100.0,
      degradation_cost_mwh: 20.0,
      timestamp: new Date().toISOString()
    };

    await eachMessage({
      topic: 'MARKET_PRICE_UPDATED',
      message: { value: Buffer.from(JSON.stringify(marketUpdate)) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'market:latest:context',
      600,
      expect.stringContaining('"iso":"ENTSOE"')
    );
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'market:latest:context',
      600,
      expect.stringContaining('"degradation_cost_mwh":20')
    );
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'market:context:ENTSOE',
      600,
      expect.stringContaining('"iso":"ENTSOE"')
    );
  });

  test('POST /openadr/v3/events should reject when global L4 grid lock is active', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l4:grid:lock') return Promise.resolve('true');
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-lock-global',
        type: 'demand-response'
      });

    expect(response.status).toBe(503);
    expect(response.body.reason).toBe('GRID_LOCK_ACTIVE');
    expect(response.body.region).toBe('GLOBAL');
  });

  test('POST /openadr/v3/events should reject when regional L4 grid lock is active (ISO Normalization L2 v2.4.1)', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l4:grid:lock:ENTSOE') return Promise.resolve('1');
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-lock-entsoe',
        type: 'demand-response',
        targets: [{ type: 'region', value: 'ENTSO-E' }] // Hyphenated region
      });

    expect(response.status).toBe(503);
    expect(response.body.reason).toBe('GRID_LOCK_ACTIVE');
    expect(response.body.region).toBe('ENTSOE'); // Normalized: Uppercase, no hyphens
  });

  test('POST /openadr/v3/events should reject when site is in L8 Safe Mode', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l8:site:SITE-456:safe_mode') return Promise.resolve('true');
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-safe-mode',
        type: 'demand-response',
        site_id: 'SITE-456'
      });

    expect(response.status).toBe(503);
    expect(response.body.reason).toBe('SITE_IN_SAFE_MODE');
    expect(response.body.site_id).toBe('SITE-456');
  });

  test('GET /openadr/v3/reports should return L8 site statuses (Optimized with SMEMBERS)', async () => {
    redisClient.scan.mockImplementation((cursor, options) => {
      if (options.MATCH === 'l8:site:status:*') {
        return Promise.resolve({ cursor: 0, keys: ['l8:site:status:SITE-1', 'l8:site:status:SITE-2'] });
      }
      return Promise.resolve({ cursor: 0, keys: [] });
    });

    redisClient.mGet.mockImplementation((keys) => {
      if (keys.includes('l8:site:status:SITE-1')) return Promise.resolve(['OPERATIONAL', 'OPERATIONAL']);
      return Promise.resolve([]);
    });

    redisClient.sMembers.mockImplementation((key) => {
      if (key === 'l3:vpp:safemode_sites') return Promise.resolve(['SITE-2']);
      return Promise.resolve([]);
    });

    const response = await request(app).get('/openadr/v3/reports');
    expect(response.status).toBe(200);
    expect(response.body.site_statuses['SITE-1']).toBe('OPERATIONAL');
    expect(response.body.site_statuses['SITE-2']).toBe('SAFE_MODE');
  });

  test('startSafetyConsumer should handle L8_SAFE_MODE_CHANGED event', async () => {
    const { consumer, startSafetyConsumer } = require('./index');
    await startSafetyConsumer();

    const eachMessage = consumer.run.mock.calls[0][0].eachMessage;

    // 1. Test Safe Mode Activation
    const safeModeActivation = {
      site_id: 'SITE-LOCK-99',
      safe_mode: true,
      timestamp: new Date().toISOString()
    };

    await eachMessage({
      topic: 'L8_SAFE_MODE_CHANGED',
      message: { value: Buffer.from(JSON.stringify(safeModeActivation)) }
    });

    expect(redisClient.sAdd).toHaveBeenCalledWith('l3:vpp:safemode_sites', 'SITE-LOCK-99');
    expect(redisClient.setEx).toHaveBeenCalledWith('l8:site:status:SITE-LOCK-99', 3600, 'SAFE_MODE');

    // 2. Test Safe Mode Release
    const safeModeRelease = {
      site_id: 'SITE-LOCK-99',
      safe_mode: false,
      timestamp: new Date().toISOString()
    };

    await eachMessage({
      topic: 'L8_SAFE_MODE_CHANGED',
      message: { value: Buffer.from(JSON.stringify(safeModeRelease)) }
    });

    expect(redisClient.sRem).toHaveBeenCalledWith('l3:vpp:safemode_sites', 'SITE-LOCK-99');
    expect(redisClient.setEx).toHaveBeenCalledWith('l8:site:status:SITE-LOCK-99', 3600, 'OPERATIONAL');
  });

  test('GET /data/training/events should return historical grid events', async () => {
    const { Pool } = require('pg');
    const mPool = new Pool();
    mPool.query.mockResolvedValue({
      rows: [
        { event_id: 'evt-1', event_type: 'demand-response', payload: {}, status: 'active', received_at: new Date() }
      ]
    });

    const response = await request(app)
      .get('/data/training/events')
      .set('Authorization', `Bearer ${mockToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('READY_FOR_L11');
    expect(response.body.record_count).toBe(1);
    expect(response.body.data[0].event_id).toBe('evt-1');
  });
});
