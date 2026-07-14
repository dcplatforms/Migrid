const request = require('supertest');
const jwt = require('jsonwebtoken');

// Virtual mocks MUST be defined before requiring index
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue(),
    sAdd: jest.fn().mockResolvedValue(),
    sRem: jest.fn().mockResolvedValue(),
    sMembers: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue(),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
    mGet: jest.fn().mockResolvedValue([]),
    hGetAll: jest.fn().mockResolvedValue({}),
    on: jest.fn()
  })
}), { virtual: true });

const mockConsumer = {
  connect: jest.fn().mockResolvedValue(),
  subscribe: jest.fn().mockResolvedValue(),
  run: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue()
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(),
      send: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue()
    }),
    consumer: jest.fn().mockReturnValue(mockConsumer)
  }))
}), { virtual: true });

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue()
  }))
}), { virtual: true });

const { app, redisClient, localSafetyCache, updateLocalSafetyCache, startSafetyConsumer } = require('./index');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const systemToken = jwt.sign({ sub: 'admin' }, JWT_SECRET);

describe('L2 v2.5.5 Site-Specific Safety Verification', () => {
  let kafkaConsumerEachMessage;

  beforeAll(async () => {
    await startSafetyConsumer();
    kafkaConsumerEachMessage = mockConsumer.run.mock.calls[0][0].eachMessage;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localSafetyCache.global_safety = false;
    localSafetyCache.regional_safety = {};
    localSafetyCache.site_safety = {};
  });

  test('CRITICAL DER_ALARM_REPORTED should set site-specific safety lock in Redis', async () => {
    const alarmPayload = {
      site_id: 'SITE-ALARM-1',
      alarm_type: 'INVERTER_FAULT',
      severity: 'CRITICAL',
      timestamp: new Date().toISOString()
    };

    await kafkaConsumerEachMessage({
      topic: 'DER_ALARM_REPORTED',
      message: { value: JSON.stringify(alarmPayload) }
    });

    expect(redisClient.setEx).toHaveBeenCalledWith(
      'l1:safety:lock:site:SITE-ALARM-1',
      900,
      '1'
    );
  });

  test('POST /openadr/v3/events should reject when site-specific safety lock is active', async () => {
    const siteId = 'SITE-LOCKED-PROMPT';
    localSafetyCache.site_safety[siteId] = true;

    const event = {
      id: 'evt-site-locked',
      type: 'demand-response',
      site_id: siteId,
      targets: [{ type: 'site', value: siteId }]
    };

    const response = await request(app)
      .post('/openadr/v3/events')
      .set('Authorization', `Bearer ${systemToken}`)
      .send(event);

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('REJECTED');
    expect(response.body.reason).toBe('SAFETY_VIOLATION_L1');
    expect(response.body.site_id).toBe(siteId);
  });

  test('updateLocalSafetyCache should populate site_safety from Redis', async () => {
    redisClient.get.mockResolvedValue(null);
    redisClient.scan
      .mockResolvedValueOnce({ cursor: '0', keys: [] }) // regional safety
      .mockResolvedValueOnce({ cursor: '0', keys: [] }) // regional grid
      .mockResolvedValueOnce({ cursor: '0', keys: ['l1:safety:lock:site:SITE-X'] }); // site safety
    redisClient.mGet.mockResolvedValueOnce(['1']);

    await updateLocalSafetyCache();

    expect(localSafetyCache.site_safety['SITE-X']).toBe(true);
  });

  test('GET /openadr/v3/reports should include site safety locks', async () => {
    localSafetyCache.site_safety['SITE-Y'] = true;

    const response = await request(app)
      .get('/openadr/v3/reports')
      .set('Authorization', `Bearer ${systemToken}`);

    expect(response.status).toBe(200);
    expect(response.body.safety_lock.site).toHaveProperty('SITE-Y', true);
  });
});
