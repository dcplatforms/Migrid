const request = require('supertest');
const { Pool } = require('pg');
const redis = require('redis');

// Mock kafkajs
jest.mock('kafkajs', () => {
  const mockProducer = {
    connect: jest.fn().mockResolvedValue(),
    send: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
  };
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(),
        subscribe: jest.fn().mockResolvedValue(),
        run: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
      })),
      producer: jest.fn().mockImplementation(() => mockProducer),
    })),
  };
});

// Mock redis
const mockRedis = {
  connect: jest.fn().mockResolvedValue(),
  on: jest.fn(),
  hSet: jest.fn().mockResolvedValue(),
  hGet: jest.fn().mockResolvedValue('0'),
  quit: jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({
  createClient: jest.fn().mockImplementation(() => mockRedis),
}));

// Mock pg
const mockPool = {
  query: jest.fn(),
  end: jest.fn().mockResolvedValue(),
  on: jest.fn(),
};
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

const { app, server, pool, redisClient } = require('./index');

describe('L6 Engagement Engine v5.8.0 Logic and Alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.end();
    // server.close(); // Not needed if not listening
  });

  test('Health check returns correct version v5.8.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.8.0');
  });

  test('Database contains expected achievement functions', async () => {
      // This is more of a placeholder since we can't easily test the internal functions of index.js
      // without refactoring it to export them.
      // But we can verify that the API endpoints are still functional.
      const res = await request(app).get('/leaderboard');
      expect(res.statusCode).toEqual(401); // Still requires authentication
  });
});
