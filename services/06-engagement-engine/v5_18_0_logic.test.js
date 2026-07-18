/**
 * Verification Test for L6 v5.18.0
 */

const request = require('supertest');

// Mock Redis
const mockRedis = {
  connect: jest.fn(),
  on: jest.fn(),
  get: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
  quit: jest.fn(),
};
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedis),
}));

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

const { app, pool, handleDerAlarm, processChargingEvent } = require('./index');

describe('L6 Engagement Engine v5.18.0 - Hardware Health Guardian & ML Parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Health check returns version v5.18.0', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBe('5.18.0');
    expect(res.body.status).toBe('healthy');
  });

  test('Hardware Health Guardian Achievement awarded when alarms are zero', async () => {
    mockRedis.get.mockImplementation((key) => {
      if (key.includes('l4:regional:alarms:')) return Promise.resolve('0');
      return Promise.resolve(null);
    });

    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: 0.1 }] });
      if (q.includes('recent_sessions')) return Promise.resolve({ rows: [{ total: 10, hf_count: 10, low_variance_count: 10, perfect_count: 10, high_fidelity_count: 10, sentinel_count: 10, site_count: 1 }] });
      if (q.includes("name = 'Hardware Health Guardian'")) return Promise.resolve({ rows: [{ id: 'ach-hhg' }] });
      if (q.includes('SELECT id FROM driver_achievements')) return Promise.resolve({ rows: [] });
      if (q.includes('SELECT name, points FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ name: 'Hardware Health Guardian', points: 500 }] });
      if (q.includes('SELECT icon FROM achievements WHERE id = $1')) return Promise.resolve({ rows: [{ icon: 'hhg.png' }] });
      if (q.includes('COUNT(*) FROM charging_sessions')) return Promise.resolve({ rows: [{ count: 5 }] });
      if (q.includes('leaderboard')) return Promise.resolve({ rows: [{ streak_days: 1, last_charging_at: new Date() }] });
      return Promise.resolve({ rows: [{ count: 0, compliant_days: 0 }] });
    });

    const event = {
      driver_id: 'driver-123',
      sessionId: 'sess-456',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 25,
      physics_score: 1.0,
      confidence_score: 1.0
    };

    await processChargingEvent(event);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO driver_achievements"),
      expect.anything()
    );
  });

  test('Hardware Health Guardian NOT awarded when alarms are present', async () => {
    mockRedis.get.mockImplementation((key) => {
      if (key.includes('l4:regional:alarms:')) return Promise.resolve('2');
      return Promise.resolve(null);
    });

    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: 0.1 }] });
      if (q.includes('COUNT(*) FROM charging_sessions')) return Promise.resolve({ rows: [{ count: 5 }] });
      if (q.includes('leaderboard')) return Promise.resolve({ rows: [{ streak_days: 1, last_charging_at: new Date() }] });
      if (q.includes('recent_sessions')) return Promise.resolve({ rows: [{ total: 10, low_variance_count: 10, perfect_count: 10, high_fidelity_count: 10, sentinel_count: 10, site_count: 1 }] });
      return Promise.resolve({ rows: [{ count: 0, compliant_days: 0 }] });
    });

    const event = {
      driver_id: 'driver-123',
      sessionId: 'sess-456',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 25,
      physics_score: 1.0,
      confidence_score: 1.0
    };

    await processChargingEvent(event);

    // Should NOT award achievement if alarms > 0
    const awardCall = pool.query.mock.calls.some(call => call[0].includes("INSERT INTO driver_achievements") && call[1][1] === 'ach-hhg');
    expect(awardCall).toBe(false);
  });

  test('processChargingEvent enriches metadata with regional alarm count', async () => {
    mockRedis.get.mockImplementation((key) => {
      if (key.includes('l4:regional:alarms:')) return Promise.resolve('5');
      return Promise.resolve(null);
    });

    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT f.iso')) return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      if (q.includes('SELECT is_valid')) return Promise.resolve({ rows: [{ is_valid: true }] });
      if (q.includes('variance_percentage')) return Promise.resolve({ rows: [{ variance_percentage: 0.1 }] });
      if (q.includes('COUNT(*) FROM charging_sessions')) return Promise.resolve({ rows: [{ count: 5 }] });
      if (q.includes('leaderboard')) return Promise.resolve({ rows: [{ streak_days: 1, last_charging_at: new Date() }] });
      if (q.includes('recent_sessions')) return Promise.resolve({ rows: [{ total: 10, low_variance_count: 10, perfect_count: 10, high_fidelity_count: 10, sentinel_count: 10, site_count: 1 }] });
      return Promise.resolve({ rows: [{ count: 0, compliant_days: 0 }] });
    });

    const event = {
      driver_id: 'driver-123',
      sessionId: 'sess-456',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 25,
      physics_score: 1.0,
      confidence_score: 0.98
    };

    await processChargingEvent(event);

    const actionCall = pool.query.mock.calls.find(call => call[0].includes('INSERT INTO driver_actions') && call[1][1] === 'session_completed');
    const metadata = JSON.parse(actionCall[1][2]);
    expect(metadata.regional_alarm_count).toBe(5);
    expect(metadata.physics_score).toBe("0.9933"); // 1 - (0.1/15) = 0.99333...
    expect(metadata.confidence_score).toBe("0.9800");
  });

  test('handleDerAlarm standardizes scores and metadata', async () => {
    pool.query.mockImplementation((q) => {
      if (q.includes('SELECT id FROM drivers')) return Promise.resolve({ rows: [{ id: 'driver-123' }] });
      return Promise.resolve({ rows: [] });
    });

    const payload = {
      alarm_type: 'FrequencyViolation',
      severity: 'Critical',
      vehicle_id: 'veh-789',
      iso_region: 'PJM'
    };

    await handleDerAlarm(payload);

    const actionCall = pool.query.mock.calls.find(call => call[0].includes('INSERT INTO driver_actions') && call[1][1] === 'der_alarm_response');
    const metadata = JSON.parse(actionCall[1][2]);
    expect(metadata.iso).toBe('PJM');
    expect(metadata.physics_score).toBe("1.0000");
    expect(metadata.confidence_score).toBe("1.0000");
  });
});
