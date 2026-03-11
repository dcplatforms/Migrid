const request = require('supertest');

// Mock kafkajs
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(),
        subscribe: jest.fn().mockResolvedValue(),
        run: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
      })),
      producer: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(),
        send: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
      })),
    })),
  };
});

// Mock pg
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    end: jest.fn().mockResolvedValue(),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

const { app, server, pool } = require('./index');

describe('Engagement Engine API', () => {
  afterAll(async () => {
    await pool.end();
    server.close();
  });

  describe('GET /health', () => {
    it('should return 200 and healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('service', 'engagement-engine');
    });
  });

  describe('GET /leaderboard', () => {
    it('should return 401 if no token provided', async () => {
      const res = await request(app).get('/leaderboard');
      expect(res.statusCode).toEqual(401);
    });
  });

  describe('GET /achievements', () => {
    it('should return 401 if no token provided', async () => {
      const res = await request(app).get('/achievements');
      expect(res.statusCode).toEqual(401);
    });
  });
});
