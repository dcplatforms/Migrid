const supertest = require('supertest');
const Decimal = require('decimal.js');
const jwt = require('jsonwebtoken');

// Mock redis BEFORE requiring index.js
const mockRedisClient = {
  get: jest.fn().mockResolvedValue(null),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  mGet: jest.fn().mockResolvedValue([]),
  connect: jest.fn().mockResolvedValue(),
  on: jest.fn(),
  setEx: jest.fn().mockResolvedValue('OK'),
  incrBy: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1)
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

const mockProducer = {
  connect: jest.fn(),
  send: jest.fn().mockResolvedValue([{}]),
  disconnect: jest.fn()
};

const mockConsumer = {
  connect: jest.fn(),
  subscribe: jest.fn(),
  run: jest.fn(),
  disconnect: jest.fn()
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => mockProducer,
    consumer: () => mockConsumer
  }))
}));

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [] })
  };
  return { Pool: jest.fn(() => mPool) };
});

const { app, localSafetyCache } = require('./index');

describe('L4 v3.9.0 Hardening & Site-Aware Bidding Synchronization', () => {
  const secret = 'dev_secret_change_in_production';
  const token = jwt.sign({ sub: 'test-user', role: 'admin' }, secret);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /bids/optimize supports site_id parameter for targeted optimization', async () => {
    localSafetyCache.last_updated = new Date().toISOString();
    localSafetyCache.site_safety = { 'SITE-OMEGA': true };

    const res = await supertest(app)
      .post('/bids/optimize')
      .set('Authorization', `Bearer ${token}`)
      .send({ iso: 'PJM', site_id: 'SITE-OMEGA' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.iso).toBe('PJM');
    expect(res.body.audit.locks.l1).toBe(true);
    expect(res.body.bid_count).toBe(0);
  });

  test('POST /bids/optimize succeeds for non-locked site', async () => {
    localSafetyCache.last_updated = new Date().toISOString();
    localSafetyCache.site_safety = { 'SITE-OMEGA': true };

    const res = await supertest(app)
      .post('/bids/optimize')
      .set('Authorization', `Bearer ${token}`)
      .send({ iso: 'PJM', site_id: 'SITE-ALPHA' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.audit.locks.l1).toBe(false);
  });
});
