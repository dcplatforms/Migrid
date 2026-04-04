const request = require('supertest');
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

const { checkHighConfidenceAchievement } = require('./index');

describe('L6 Engagement Engine v5.8.0 - Data Confidence and ML Readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // await pool.end();
  });

  test('L6-118: checkHighConfidenceAchievement awards achievement if confidence >= 0.95', async () => {
    const driverId = 'driver-123';
    const vehicleId = 'vehicle-456';

    // 1. Mock driver/fleet lookup
    mockPool.query.mockImplementation((query, params) => {
      if (query.includes('SELECT f.iso FROM drivers d JOIN fleets f')) {
        return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
      }
      if (query.includes('SELECT id FROM driver_achievements')) {
        return Promise.resolve({ rows: [] }); // Not yet earned
      }
      if (query.includes("SELECT id FROM achievements WHERE name = 'High-Confidence Contributor'")) {
        return Promise.resolve({ rows: [{ id: 'ach-789' }] });
      }
      if (query.includes("SELECT name, points FROM achievements WHERE id = $1")) {
          return Promise.resolve({ rows: [{ name: 'High-Confidence Contributor', points: 500 }] });
      }
      if (query.includes("SELECT icon FROM achievements WHERE id = $1")) {
          return Promise.resolve({ rows: [{ icon: 'shield-check' }] });
      }
      if (query.includes("INSERT INTO driver_achievements")) {
          return Promise.resolve({ rows: [] });
      }
      if (query.includes("INSERT INTO leaderboard")) {
          return Promise.resolve({ rows: [] });
      }
      if (query.includes("SELECT l.rank")) {
          return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // 2. Mock Redis digital twin with high confidence
    mockRedis.get.mockResolvedValue(JSON.stringify({
      id: vehicleId,
      confidence_score: 0.98
    }));

    await checkHighConfidenceAchievement(driverId, vehicleId);

    // Verify achievement awarded
    expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO driver_achievements'),
        expect.arrayContaining([driverId, 'ach-789'])
    );
  });

  test('L6-118: checkHighConfidenceAchievement does not award if confidence < 0.95', async () => {
    const driverId = 'driver-123';
    const vehicleId = 'vehicle-456';

    mockPool.query.mockImplementation((query, params) => {
        if (query.includes('SELECT f.iso FROM drivers d JOIN fleets f')) {
          return Promise.resolve({ rows: [{ iso: 'CAISO' }] });
        }
        return Promise.resolve({ rows: [] });
    });

    mockRedis.get.mockResolvedValue(JSON.stringify({
      id: vehicleId,
      confidence_score: 0.8
    }));

    await checkHighConfidenceAchievement(driverId, vehicleId);

    expect(mockPool.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO driver_achievements'),
        expect.anything()
    );
  });

  test('L6-118: Database Migration 025 exists', async () => {
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '../../scripts/migrations/025_l6_confidence_and_ml_engagement.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf8');
    expect(content).toContain('High-Confidence Contributor');
    expect(content).toContain('ML Data Pioneer');
  });
});
