/**
 * Verification Test for L6 v5.18.0 - Hardware Health Awareness
 */

const request = require('supertest');
const { app, pool, redisClient, checkHardwareHealthGuardianAchievement, handleDerAlarm } = require('./index');

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

describe('L6 Engagement Engine v5.18.0 - Hardware Health Awareness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Health check returns version v5.18.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.18.0');
    expect(res.body.status).toBe('healthy');
  });

  test('Hardware Health Guardian Achievement: Successful detection', async () => {
    // Mock 10 healthy sessions
    pool.query.mockImplementation((q) => {
      if (q.includes('WITH healthy_sessions')) return Promise.resolve({ rows: [{ total: 10, healthy_count: 10 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'Hardware Health Guardian'")) return Promise.resolve({ rows: [{ id: 'ach-hhg' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT name, points FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ name: 'Hardware Health Guardian', points: 500 }] });
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'health.png' }] });
      return Promise.resolve({ rows: [] });
    });

    await checkHardwareHealthGuardianAchievement('driver-123');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.anything()
    );
  });

  test('Hardware Health Guardian Achievement: Failed when alarms exist', async () => {
    // Mock 10 sessions but only 8 healthy
    pool.query.mockImplementation((q) => {
      if (q.includes('WITH healthy_sessions')) return Promise.resolve({ rows: [{ total: 10, healthy_count: 8 }] });
      return Promise.resolve({ rows: [] });
    });

    await checkHardwareHealthGuardianAchievement('driver-123');

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.anything()
    );
  });

  test('handleDerAlarm enriches metadata with regional alarm count', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT id FROM drivers')) return Promise.resolve({ rows: [{ id: 'driver-123' }] });
      return Promise.resolve({ rows: [] });
    });

    redisClient.get.mockResolvedValue('5'); // 5 regional alarms

    const payload = {
      alarm_type: 'GroundFault',
      severity: 'Critical',
      vehicle_id: 'veh-abc',
      iso: 'ERCOT',
      site_id: 'site-x'
    };

    await handleDerAlarm(payload);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_actions'),
      expect.arrayContaining([expect.stringContaining('"regional_alarm_count":5')])
    );
  });

  test('safeFloat handles NaN and formats to 4 decimals', async () => {
    const { safeFloat } = require('./index');
    expect(safeFloat(0.987654)).toBe('0.9877');
    expect(safeFloat('NaN')).toBe('1.0000');
    expect(safeFloat(undefined)).toBe('1.0000');
    expect(safeFloat(1)).toBe('1.0000');
  });
});
