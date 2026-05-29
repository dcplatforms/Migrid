/**
 * Verification script for L6 v5.15.0: Robust Site ID Extraction
 */
const { handleGridSignal, pool } = require('./index');

// Mock Kafka producer
const mockProducer = {
  send: jest.fn().mockResolvedValue(true)
};

// Mock the global producer used in index.js
require('./index').producer = mockProducer;

describe('L6 v5.15.0 Robust Site ID Extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock pool.query to return empty results by default to avoid DB errors during logic check
    pool.query = jest.fn().mockResolvedValue({ rows: [] });
  });

  test('handleGridSignal extracts site_id correctly', async () => {
    const payload = { event_id: 'evt-1', priority: 'HIGH', site_id: 'SITE-A' };
    await handleGridSignal(payload);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('($1 = \'ALL\' OR chr.location_id = $1)'),
      ['SITE-A', expect.any(String)]
    );
  });

  test('handleGridSignal extracts siteId correctly', async () => {
    const payload = { event_id: 'evt-2', priority: 'HIGH', siteId: 'SITE-B' };
    await handleGridSignal(payload);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('($1 = \'ALL\' OR chr.location_id = $1)'),
      ['SITE-B', expect.any(String)]
    );
  });

  test('handleGridSignal extracts location_id correctly', async () => {
    const payload = { event_id: 'evt-3', priority: 'HIGH', location_id: 'SITE-C' };
    await handleGridSignal(payload);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('($1 = \'ALL\' OR chr.location_id = $1)'),
      ['SITE-C', expect.any(String)]
    );
  });

  test('handleGridSignal extracts locationId correctly', async () => {
    const payload = { event_id: 'evt-4', priority: 'HIGH', locationId: 'SITE-D' };
    await handleGridSignal(payload);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('($1 = \'ALL\' OR chr.location_id = $1)'),
      ['SITE-D', expect.any(String)]
    );
  });

  test('handleGridSignal defaults to ALL if no site ID provided', async () => {
    const payload = { event_id: 'evt-5', priority: 'HIGH' };
    await handleGridSignal(payload);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('($1 = \'ALL\' OR chr.location_id = $1)'),
      ['ALL', expect.any(String)]
    );
  });
});
