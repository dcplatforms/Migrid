/**
 * Verification Test for L6 v5.18.0
 */

const request = require('supertest');
const { app, pool, redisClient, handleDerAlarm, checkDerSentinelAchievement, producer } = require('./index');

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

describe('L6 Engagement Engine v5.18.0 - DER Sentinel & Training Data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Health check returns version v5.18.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.18.0');
    expect(res.body.status).toBe('healthy');
  });

  test('DER Sentinel Achievement detection', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT COUNT(*) as alarm_count')) return Promise.resolve({ rows: [{ alarm_count: 3 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'DER Sentinel'")) return Promise.resolve({ rows: [{ id: 'ach-der' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT name, points FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ name: 'DER Sentinel', points: 300 }] });
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'der.png' }] });
      return Promise.resolve({ rows: [] });
    });

    await checkDerSentinelAchievement('driver-123');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.anything()
    );
  });

  test('handleDerAlarm records action and checks achievement', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT id FROM drivers')) return Promise.resolve({ rows: [{ id: 'driver-123' }] });
      if (q.includes('SELECT COUNT(*) as alarm_count')) return Promise.resolve({ rows: [{ alarm_count: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    const payload = {
      alarm_type: 'VoltageDeviation',
      severity: 'Critical',
      vehicle_id: 'veh-789',
      site_id: 'site-999'
    };

    await handleDerAlarm(payload);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_actions'),
      expect.arrayContaining(['der_alarm_response'])
    );
  });

  test('GET /data/training/engagement restricts access via fleet_id', async () => {
    // We need to bypass authenticateToken or mock it.
    // In L6 index.js, authenticateToken uses JWT_SECRET.
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ driver_id: 'admin', fleet_id: 'fleet-123' }, 'dev_secret_change_in_production');

    const res = await request(app)
      .get('/data/training/engagement')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Unauthorized');
  });

  test('GET /data/training/engagement allowed for system tokens', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ driver_id: 'system' }, 'dev_secret_change_in_production'); // No fleet_id

    pool.query.mockResolvedValue({ rows: [{ driver_id: 'd1', action_type: 'test' }] });

    const res = await request(app)
      .get('/data/training/engagement')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
