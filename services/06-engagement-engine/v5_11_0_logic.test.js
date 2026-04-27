const { Pool } = require('pg');
const redis = require('redis');

// Mock kafkajs
const mockProducer = {
  connect: jest.fn().mockResolvedValue(),
  send: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
};

jest.mock('kafkajs', () => {
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
  hGet: jest.fn().mockResolvedValue('50.0'),
  get: jest.fn().mockResolvedValue(null),
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

const { handleAdvanceChargeSignal } = require('./index');

describe('L6 Engagement Engine v5.11.0 - Solar Ramp Gamification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handleAdvanceChargeSignal identifies active drivers and records actions', async () => {
    const driverId = 'driver-789';
    const iso = 'CAISO';

    // Mock sequential queries
    mockPool.query.mockImplementation((query, params) => {
      // 1. Find active sessions in ISO
      if (query.includes('FROM charging_sessions cs')) {
        return Promise.resolve({ rows: [{ driver_id: driverId, iso: 'CAISO' }] });
      }
      // 2. Record action
      if (query.includes('INSERT INTO driver_actions')) {
        return Promise.resolve({ rows: [] });
      }
      // 3. Challenge progress count (from updateChallengeProgress)
      if (query.includes('SELECT id, required_count FROM challenges')) {
          return Promise.resolve({ rows: [{ id: 'chal-1', required_count: 5 }] });
      }
      if (query.includes('SELECT is_completed FROM driver_challenge_progress')) {
          return Promise.resolve({ rows: [{ is_completed: false }] });
      }
      if (query.includes('INSERT INTO driver_challenge_progress')) {
          return Promise.resolve({ rows: [{ current_count: 1 }] });
      }
      // 4. Solar Surge count check
      if (query.includes("SELECT COUNT(*) FROM driver_actions") && query.includes("'solar_ramp_response'")) {
          return Promise.resolve({ rows: [{ count: 1 }] });
      }
      // Default
      return Promise.resolve({ rows: [] });
    });

    const payload = {
      iso,
      reason: 'SOLAR_RAMP_DETECTED',
      ramp_rate: 0.15,
      timestamp: new Date().toISOString()
    };

    await handleAdvanceChargeSignal(payload);

    // Verify driver search query
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM charging_sessions cs'),
      expect.arrayContaining(['CAISO'])
    );

    // Verify action recording
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_actions'),
      expect.arrayContaining([driverId, 'solar_ramp_response'])
    );
  });

  test('Solar Surge achievement awarded after 5 responses', async () => {
    const driverId = 'driver-789';
    const iso = 'CAISO';

    mockPool.query.mockImplementation((query, params) => {
      if (query.includes('FROM charging_sessions cs')) {
        return Promise.resolve({ rows: [{ driver_id: driverId, iso: 'CAISO' }] });
      }
      // Count is now 5
      if (query.includes("SELECT COUNT(*) FROM driver_actions") && query.includes("'solar_ramp_response'")) {
          return Promise.resolve({ rows: [{ count: 5 }] });
      }
      if (query.includes("SELECT id FROM achievements WHERE name = 'Solar Surge'")) {
          return Promise.resolve({ rows: [{ id: 'ach-solar-surge' }] });
      }
      if (query.includes("SELECT id FROM driver_achievements")) {
          return Promise.resolve({ rows: [] }); // Not yet earned
      }
      if (query.includes("INSERT INTO driver_achievements")) {
          return Promise.resolve({ rows: [] });
      }
      // Fleet lookup for awardAchievement
      if (query.includes("SELECT f.iso FROM drivers d")) {
          return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      }
      // Achievement points for awardAchievement
      if (query.includes("SELECT name, points FROM achievements WHERE id = $1")) {
          return Promise.resolve({ rows: [{ name: 'Solar Surge', points: 500 }] });
      }
      if (query.includes("SELECT icon FROM achievements WHERE id = $1")) {
          return Promise.resolve({ rows: [{ icon: 'sun-bolt' }] });
      }

      return Promise.resolve({ rows: [] });
    });

    const payload = { iso, reason: 'SOLAR_RAMP_DETECTED' };
    await handleAdvanceChargeSignal(payload);

    // Verify achievement was awarded
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO driver_achievements'),
      expect.arrayContaining([driverId, 'ach-solar-surge'])
    );
  });
});
