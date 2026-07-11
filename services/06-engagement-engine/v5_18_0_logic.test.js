/**
 * Verification Test for L6 v5.18.0
 * Hardware Health Guardian & safeFloat Standard
 */

const request = require('supertest');
const {
  app,
  pool,
  redisClient,
  safeFloat,
  checkHardwareHealthGuardianAchievement,
  processChargingEvent
} = require('./index');

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
jest.mock('redis', () => {
  const mRedis = {
    connect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    quit: jest.fn(),
  };
  return { createClient: jest.fn(() => mRedis) };
});

describe('L6 Engagement Engine v5.18.0 - Hardware Health Guardian', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('safeFloat utility enforces 4-decimal string formatting', () => {
    expect(safeFloat(1.23)).toBe('1.2300');
    expect(safeFloat(0.95001)).toBe('0.9500');
    expect(safeFloat(NaN)).toBe('0.0000');
    expect(safeFloat(undefined, 1.0)).toBe('1.0000');
    expect(safeFloat('0.98')).toBe('0.9800');
  });

  test('Health check returns version v5.18.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.18.0');
    expect(res.body.status).toBe('healthy');
  });

  test('Hardware Health Guardian: Does not award if regional alarms > 0', async () => {
    redisClient.get.mockResolvedValue('5'); // 5 alarms in region

    await checkHardwareHealthGuardianAchievement('driver-1', 'CAISO');

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.anything()
    );
  });

  test('Hardware Health Guardian: Awards if 10 sessions with 0 regional alarms', async () => {
    redisClient.get.mockResolvedValue('0'); // 0 alarms in region
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT COUNT(*) as perfect_health_count')) return Promise.resolve({ rows: [{ perfect_health_count: 10 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'Hardware Health Guardian'")) return Promise.resolve({ rows: [{ id: 'ach-hhg' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'health.png' }] });
      return Promise.resolve({ rows: [] });
    });

    await checkHardwareHealthGuardianAchievement('driver-1', 'CAISO');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.arrayContaining(['driver-1', 'ach-hhg'])
    );
  });

  test('processChargingEvent fetches regional alarms and passes metadata', async () => {
    redisClient.get.mockResolvedValue('2'); // 2 alarms in region
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'ERCOT' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('SELECT cs.variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: 2.0, resource_type: 'EV' }] });
      return Promise.resolve({ rows: [] });
    });

    const event = {
      driver_id: 'driver-1',
      session_id: 'sess-1',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 10.0,
      physics_score: 0.98,
      site_id: 'site-1'
    };

    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'ERCOT' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('SELECT cs.variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: 2.0, resource_type: 'EV' }] });
      if (q.includes('SELECT COUNT(*) FROM charging_sessions')) return Promise.resolve({ rows: [{ count: 1 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'Early Adopter'")) return Promise.resolve({ rows: [{ id: 'early-adopter' }] });
      return Promise.resolve({ rows: [] });
    });

    await processChargingEvent(event);

    // Verify Redis was checked for ERCOT alarms
    expect(redisClient.get).toHaveBeenCalledWith('l4:regional:alarms:ERCOT');

    // Verify regional_alarm_count was stored in metadata
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_actions'),
      expect.arrayContaining([expect.stringContaining('"regional_alarm_count":2')])
    );
  });
});
