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
    mGet: jest.fn().mockResolvedValue([]),
    setEx: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
    scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
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

  test('startSafetyConsumer should cache market price updates', async () => {
    const { consumer, startSafetyConsumer } = require('./index');
    await startSafetyConsumer();

    const eachMessage = consumer.run.mock.calls[0][0].eachMessage;

    const marketUpdate = {
      iso: 'ERCOT',
      price_per_mwh: 120.0,
      profitability_index: 100.0,
      timestamp: new Date().toISOString()
    };

    await eachMessage({
      topic: 'MARKET_PRICE_UPDATED',
      message: { value: Buffer.from(JSON.stringify(marketUpdate)) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'market:latest:context',
      600,
      expect.stringContaining('"iso":"ERCOT"')
    );
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'market:latest:context',
      600,
      expect.stringContaining('"price_per_mwh":120')
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

  test('POST /openadr/v3/events should reject when regional L4 grid lock is active', async () => {
    redisClient.get.mockImplementation((key) => {
      if (key === 'l4:grid:lock:CAISO') return Promise.resolve('1');
      return Promise.resolve(null);
    });

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${mockToken}`)
      .send({
        id: 'evt-lock-regional',
        type: 'demand-response',
        targets: [{ type: 'region', value: 'CAISO' }]
      });

    expect(response.status).toBe(503);
    expect(response.body.reason).toBe('GRID_LOCK_ACTIVE');
    expect(response.body.region).toBe('CAISO');
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
