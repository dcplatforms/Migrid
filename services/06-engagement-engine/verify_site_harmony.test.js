/**
 * Verification Script for Site Harmony Achievement
 * This script mocks the database and Redis to test the processChargingEvent logic.
 */

const redis = require('redis');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

// Mocking Redis
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(null),
    get: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    quit: jest.fn().mockResolvedValue(null),
  }),
}));

// Mocking pg
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

// Mocking KafkaJS to prevent connection attempts
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(null),
        subscribe: jest.fn().mockResolvedValue(null),
        run: jest.fn().mockResolvedValue(null),
        disconnect: jest.fn().mockResolvedValue(null),
      }),
      producer: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(null),
        send: jest.fn().mockResolvedValue(null),
        disconnect: jest.fn().mockResolvedValue(null),
      }),
    })),
  };
});

// Now require index after mocks
const { processChargingEvent } = require('./index');

describe('Site Harmony Achievement Verification', () => {
  let pool;
  let redisClient;

  beforeEach(() => {
    pool = new Pool();
    redisClient = redis.createClient();
    jest.clearAllMocks();
  });

  test('Should award Site Harmony achievement for high confidence session', async () => {
    const mockEvent = {
      driverId: 'driver-123',
      sessionId: 'session-456',
      vehicleId: 'vehicle-789',
      type: 'SESSION_COMPLETED',
      energyDispensedKwh: 20
    };

    // Use mockImplementation to handle sequential queries
    pool.query.mockImplementation((query, params) => {
      if (query.includes('FROM drivers d JOIN fleets f')) {
        return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      }
      if (query.includes('FROM charging_sessions cs')) {
        return Promise.resolve({ rows: [{ variance_percentage: 2.0, resource_type: 'EV' }] });
      }
      if (query.includes('INSERT INTO driver_actions')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM charging_sessions WHERE driver_id')) {
        return Promise.resolve({ rows: [{ count: '1' }] });
      }
      if (query.includes('SELECT id FROM achievements WHERE name')) {
        return Promise.resolve({ rows: [{ id: 'ach-id' }] });
      }
      if (query.includes('SELECT streak_days')) {
        return Promise.resolve({ rows: [{ streak_days: 1, last_charging_at: new Date() }] });
      }
      if (query.includes('WITH RECURSIVE dates')) {
        return Promise.resolve({ rows: [{ compliant_days: '5' }] });
      }
      if (query.includes('FROM driver_achievements WHERE driver_id')) {
        return Promise.resolve({ rows: [] }); // Not earned yet
      }
      if (query.includes('INSERT INTO driver_achievements')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('INSERT INTO leaderboard')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT rank, total_points')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE leaderboard')) {
          return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT id, required_count FROM challenges')) {
          return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT (metadata->>\'physics_score\')::float as physics_score')) {
          return Promise.resolve({ rows: [{ total: '1', sentinel_count: '1' }] });
      }
      if (query.includes('SELECT (metadata->>\'isHighFidelity\')::boolean as is_high_fidelity')) {
          return Promise.resolve({ rows: [{ total: '1', high_fidelity_count: '1' }] });
      }
      if (query.includes('SELECT (metadata->>\'isLowVariance\')::boolean as is_low_variance')) {
          return Promise.resolve({ rows: [{ total: '1', low_variance_count: '1' }] });
      }
      if (query.includes('SELECT icon FROM achievements WHERE id')) {
          return Promise.resolve({ rows: [{ icon: 'icon-test' }] });
      }

      return Promise.resolve({ rows: [{ count: '1', total: '1', low_variance_count: '1', sentinel_count: '1', high_fidelity_count: '1' }] });
    });

    // Mock Digital Twin Confidence Score (L1)
    redisClient.get.mockImplementation((key) => {
        if (key.includes('l1:CAISO:vehicle:vehicle-789')) {
            return Promise.resolve(JSON.stringify({ confidence_score: 0.98 }));
        }
        return Promise.resolve(null);
    });

    // Execute
    await processChargingEvent(mockEvent);

    // Verify achievement 'Site Harmony' was checked and awarded
    expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM achievements WHERE name = \'Site Harmony\'')
    );

    // Verify it was awarded (inserted into driver_achievements)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.arrayContaining(['driver-123', 'ach-id'])
    );
  });
});
