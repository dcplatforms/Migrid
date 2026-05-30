/**
 * Verification Test for L6 v5.16.0
 */

const request = require('supertest');
const { app, pool, redisClient, processChargingEvent, checkPhase6DataPioneerAchievement, producer } = require('./index');

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

describe('L6 Engagement Engine v5.16.0 - Phase 6 & Telemetry Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('Health check returns version v5.16.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.16.0');
    expect(res.body.status).toBe('healthy');
  });

  test('isSentinelFidelity should support integer 1 flag and format scores', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('SELECT cs.variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: '2.0', resource_type: 'EV' }] });
      if (q.includes('SELECT COUNT(*) FROM charging_sessions')) return Promise.resolve({ rows: [{ count: 0 }] });
      if (q.includes('SELECT streak_days')) return Promise.resolve({ rows: [{ streak_days: 0, last_charging_at: null }] });
      if (q.includes('WITH recent_sessions')) return Promise.resolve({ rows: [{ total: 0, low_variance_count: 0, perfect_count: 0 }] });
      return Promise.resolve({ rows: [] });
    });

    const event = {
      driverId: 'driver-123',
      sessionId: 'sess-456',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 20,
      physics_score: 0.995,
      confidence_score: 0.96,
      is_sentinel_fidelity: 1 // Integer flag
    };

    producer.send = jest.fn().mockResolvedValue({});

    await processChargingEvent(event);

    expect(producer.send).toHaveBeenCalled();
    const actionCall = producer.send.mock.calls.find(c => c[0].topic === 'driver_actions');
    const payload = JSON.parse(actionCall[0].messages[0].value);

    // physics_score recalculates to 0.8667 based on 2.0% variance and 15% threshold
    expect(payload.physics_score).toBe("0.8667");
    expect(payload.confidence_score).toBe("0.9600");
  });

  test('Phase 6 Data Pioneer Achievement detection', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('WITH recent_sessions')) return Promise.resolve({ rows: [{ total: 5, perfect_count: 5 }] });
      if (q.includes("SELECT id FROM achievements WHERE name = 'Phase 6 Data Pioneer'")) return Promise.resolve({ rows: [{ id: 'ach-pioneer' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT name, points FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ name: 'Phase 6 Data Pioneer', points: 500 }] });
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'pioneer.png' }] });
      return Promise.resolve({ rows: [] });
    });

    await checkPhase6DataPioneerAchievement('driver-123');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.anything()
    );
  });
});
