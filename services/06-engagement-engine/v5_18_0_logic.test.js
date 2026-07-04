/**
 * Verification Test for L6 v5.18.0 - Hardware Health & safeFloat
 */

const request = require('supertest');
const { app, pool, redisClient, safeFloat, checkHardwareHealthGuardianAchievement } = require('./index');

// Mock Kafka
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        subscribe: jest.fn(),
        run: jest.fn(),
        disconnect: jest.fn(),
      })),
      producer: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        send: jest.fn(),
        disconnect: jest.fn(),
      })),
    })),
  };
});

// Mock pg
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    quit: jest.fn(),
  })),
}));

describe('L6 Engagement Engine v5.18.0 - Hardware Health Guardian', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Health check returns version v5.18.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.18.0');
    expect(res.body.status).toBe('healthy');
  });

  test('safeFloat utility enforces 4-decimal string formatting', () => {
    expect(safeFloat(1.23456)).toBe('1.2346');
    expect(safeFloat(0.99)).toBe('0.9900');
    expect(safeFloat(NaN)).toBe('0.0000');
    expect(safeFloat("invalid")).toBe('0.0000');
    expect(safeFloat(0)).toBe('0.0000');
  });

  test('Hardware Health Guardian achievement awarded when zero alarms and 10+ HF sessions', async () => {
    // 1. Mock Redis to return 0 alarms
    redisClient.get.mockResolvedValue('0');

    // 2. Mock Pool to return 10 HF sessions and achievement data
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT COUNT(*) as hf_count')) return Promise.resolve({ rows: [{ hf_count: 10 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'Hardware Health Guardian'")) return Promise.resolve({ rows: [{ id: 'ach-hhg' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] }); // Not earned yet
      if (q.includes('SELECT name, points FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ name: 'Hardware Health Guardian', points: 500 }] });
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'guardian.png' }] });
      return Promise.resolve({ rows: [] });
    });

    await checkHardwareHealthGuardianAchievement('driver-123', 'CAISO');

    // Verify achievement was awarded
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.arrayContaining(['driver-123', 'ach-hhg'])
    );
  });

  test('Hardware Health Guardian achievement NOT awarded when alarms present', async () => {
    // 1. Mock Redis to return 1 alarm
    redisClient.get.mockResolvedValue('1');

    await checkHardwareHealthGuardianAchievement('driver-123', 'CAISO');

    // Verify no achievement check was performed against DB
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*) as hf_count'),
      expect.anything()
    );
  });
});
