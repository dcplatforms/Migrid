const request = require('supertest');
const { app, redisClient, producer } = require('./index');

// Mock Redis (Virtual to bypass environment issues)
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn(),
    setEx: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
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

  test('POST /openadr/v3/events should accept valid OpenADR event', async () => {
    redisClient.get.mockResolvedValue(null); // No safety lock

    const response = await request(app)
      .post('/openadr/v3/events')
      .send({
        id: 'evt-123',
        type: 'demand-response',
        priority: 'HIGH'
      });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('RECEIVED');
    expect(response.body.event_id).toBe('evt-123');
    expect(producer.send).toHaveBeenCalled();
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

  test('POST /openadr/v3/events should return 400 for invalid payload', async () => {
    const response = await request(app)
      .post('/openadr/v3/events')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });
});
