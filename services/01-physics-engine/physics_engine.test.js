// Manual mocks
global.mockProducerSend = jest.fn();
global.mockRedisSetEx = jest.fn();
global.mockRedisRPop = jest.fn();
global.mockPgQuery = jest.fn();

// Mock dependencies (hoisted by Jest)
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue({}),
      send: jest.fn().mockImplementation((args) => {
          global.mockProducerSend(args);
          return Promise.resolve({});
      }),
      disconnect: jest.fn().mockResolvedValue({})
    })
  }))
}), { virtual: true });

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({}),
    query: jest.fn().mockImplementation((query, params) => {
        return global.mockPgQuery(query, params);
    }),
    on: jest.fn(),
    end: jest.fn()
  }))
}), { virtual: true });

jest.mock('redis', () => ({
  createClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({}),
    lPush: jest.fn().mockResolvedValue({}),
    rPop: jest.fn().mockImplementation((key) => {
        return global.mockRedisRPop(key);
    }),
    setEx: jest.fn().mockImplementation((key, ttl, value) => {
        global.mockRedisSetEx(key, ttl, value);
        return Promise.resolve('OK');
    }),
    quit: jest.fn().mockResolvedValue({}),
    on: jest.fn()
  }))
}), { virtual: true });

jest.mock('dotenv', () => ({ config: jest.fn() }), { virtual: true });

const physicsEngine = require('./index');

describe('L1 Physics Engine Alert Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.mockProducerSend = jest.fn();
    global.mockRedisSetEx = jest.fn();
  });

  test('should dispatch PHYSICS_FRAUD alert to Kafka', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-123',
        variance_pct: 18.5,
        expected: 50.0,
        actual: 60.0,
        timestamp: '2023-10-27T10:00:00Z'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockProducerSend).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'migrid.physics.alerts'
    }));

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('PHYSICS_FRAUD');
    expect(alertValue.severity).toBe('FRAUD');
    expect(alertValue.variance_pct).toBe(18.5);
  });

  test('should dispatch CAPACITY_VIOLATION alert to Kafka', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-456',
        vin: 'TESTVIN123',
        current_soc: 19.5,
        threshold: 20.0,
        timestamp: '2023-10-27T10:05:00Z'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockProducerSend).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'migrid.physics.alerts'
    }));

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('CAPACITY_VIOLATION');
    expect(alertValue.severity).toBe('CRITICAL');
    expect(alertValue.current_soc).toBe(19.5);
  });

  test('should dispatch CAPACITY_VIOLATION with VPP status', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-789',
        vin: 'VPPTESTVIN',
        current_soc: 18.0,
        threshold: 20.0,
        vpp_active: true,
        timestamp: '2023-10-27T10:10:00Z'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('CAPACITY_VIOLATION');
    expect(alertValue.vpp_active).toBe(true);
    expect(alertValue.severity).toBe('CRITICAL');
  });

  test('should include billing_mode in PHYSICS_FRAUD alert', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-999',
        variance_pct: 25.0,
        billing_mode: 'PERSONAL',
        timestamp: '2023-10-27T11:00:00Z'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('PHYSICS_FRAUD');
    expect(alertValue.billing_mode).toBe('PERSONAL');
  });

  test('should set safety lock and context in Redis for PHYSICS_FRAUD', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-fraud-1',
        site_id: 'SITE-001',
        variance_pct: 20.0,
        billing_mode: 'FLEET'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock', 900, 'true');
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"event_type":"PHYSICS_FRAUD"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"severity":"FRAUD"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"site_id":"SITE-001"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"billing_mode":"FLEET"'));
  });

  test('should set safety lock and context in Redis for CAPACITY_VIOLATION', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-v1',
        current_soc: 15.0
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock', 900, 'true');
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"event_type":"CAPACITY_VIOLATION"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"severity":"CRITICAL"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"current_soc":15'));
  });

  test('should NOT set safety lock for EFFICIENCY_ALERT', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        session_id: 'session-eff-1'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).not.toHaveBeenCalled();
  });

  test('should extract site_id from metadata if site_id is missing at top level', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        session_id: 'session-meta-1',
        metadata: { site_id: 'DYNAMIC-SITE-999' }
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.site_id).toBe('DYNAMIC-SITE-999');
  });

  test('should include v2g_active and iso_region in Kafka alert', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-v2g-1',
        variance_pct: 16.0,
        v2g_active: true,
        iso_region: 'ERCOT',
        timestamp: '2023-10-27T12:00:00Z'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.v2g_active).toBe(true);
    expect(alertValue.iso_region).toBe('ERCOT');
  });

  test('should include v2g_active and iso_region in Redis safety context', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-v2g-2',
        variance_pct: 20.0,
        v2g_active: true,
        iso_region: 'CAISO'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"v2g_active":true'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"iso_region":"CAISO"'));
  });

  test('should handle CAPACITY_VIOLATION from aggressive market bid and activate safety lock', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-ercot-1',
        vin: 'TEXAS-BATT-001',
        current_soc: 19.9,
        threshold: 20.0,
        vpp_active: true,
        metadata: { msg: 'BESS Discharge Rejection: SoC < 20% (Aggressive Market Bid Rejected)' }
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    // Verify Safety Lock activation
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock', 900, 'true');

    // Verify Context richness
    const contextValue = JSON.parse(global.mockRedisSetEx.mock.calls.find(call => call[0] === 'l1:safety:lock:context')[2]);
    expect(contextValue.event_type).toBe('CAPACITY_VIOLATION');
    expect(contextValue.severity).toBe('CRITICAL');
    expect(contextValue.current_soc).toBe(19.9);
    expect(contextValue.vpp_active).toBe(true);

    // Verify Kafka alert dispatch
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('CAPACITY_VIOLATION');
    expect(alertValue.vin).toBe('TEXAS-BATT-001');
  });
});

describe('L1 Physics Engine Digital Twin Sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.mockRedisSetEx = jest.fn();
    global.mockPgQuery = jest.fn();
    process.env.FLEET_ID = 'f1';
  });

  afterAll(() => {
    delete process.env.FLEET_ID;
  });

  test('should sync vehicles to Redis when FLEET_ID is set', async () => {
    global.mockPgQuery.mockResolvedValue({
      rows: [
        { id: 'v1', fleet_id: 'f1', battery_capacity_kwh: 100, current_soc: 80, is_plugged_in: true, v2g_enabled: true },
        { id: 'v2', fleet_id: 'f1', battery_capacity_kwh: 100, current_soc: 75, is_plugged_in: false, v2g_enabled: true }
      ]
    });

    // We need to re-require or manually trigger the config if we were relying on it at module load,
    // but here we just need FLEET_ID to be available when syncDigitalTwin is called.
    await physicsEngine.syncDigitalTwin();

    expect(global.mockPgQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, fleet_id, battery_capacity_kwh, current_soc, is_plugged_in, v2g_enabled FROM vehicles WHERE fleet_id = $1'),
        ['f1']
    );
    expect(global.mockRedisSetEx).toHaveBeenCalledTimes(2);
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:digital_twin:vehicle:v1', 60, expect.stringContaining('"id":"v1"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:digital_twin:vehicle:v2', 60, expect.stringContaining('"id":"v2"'));
  });
});

describe('L1 Physics Engine Log Reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.mockProducerSend = jest.fn();
    global.mockPgQuery = jest.fn();
    global.mockRedisRPop = jest.fn();
  });

  test('should reconcile PHYSICS_FRAUD from local Redis to Cloud DB with high-fidelity', async () => {
    const fraudPayload = {
      event_type: 'PHYSICS_FRAUD',
      session_id: 'reconcile-session-1',
      expected: 50.0,
      actual: 60.0,
      variance_pct: 20.0,
      billing_mode: 'FLEET',
      iso_region: 'ERCOT',
      market_price_at_session: 150.0,
      timestamp: '2026-03-22T10:00:00Z'
    };

    global.mockRedisRPop
      .mockResolvedValueOnce(JSON.stringify(fraudPayload))
      .mockResolvedValueOnce(null);

    await physicsEngine.reconcileLogs();

    // Verify Kafka Alert (Re-published)
    expect(global.mockProducerSend).toHaveBeenCalled();
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.event_type).toBe('PHYSICS_FRAUD');
    expect(alertValue.reconciled).toBe(true);
    expect(alertValue.severity).toBe('FRAUD');
    expect(alertValue.iso_region).toBe('ERCOT');

    // Verify Database Insertion
    expect(global.mockPgQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining([
        'reconcile-session-1',
        'PHYSICS_FRAUD',
        50.0,
        60.0,
        'FRAUD',
        expect.stringContaining('"reconciled":true'),
        'FLEET',
        undefined, // vpp_active not in payload
        'ERCOT',
        150.0
      ])
    );
  });

  test('should reconcile CAPACITY_VIOLATION with mapping to CRITICAL severity', async () => {
    const capacityPayload = {
      event_type: 'CAPACITY_VIOLATION',
      vehicle_id: 'v-99',
      vin: 'VIN99',
      current_soc: 18.5,
      threshold: 20.0,
      vpp_active: true,
      iso_region: 'CAISO'
    };

    global.mockRedisRPop
      .mockResolvedValueOnce(JSON.stringify(capacityPayload))
      .mockResolvedValueOnce(null);

    await physicsEngine.reconcileLogs();

    // Verify Database Insertion
    expect(global.mockPgQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining([
        undefined, // session_id missing
        'CAPACITY_VIOLATION',
        20.0,
        18.5,
        'CRITICAL',
        expect.stringContaining('"vehicle_id":"v-99"'),
        undefined, // billing_mode missing
        true,
        'CAISO'
      ])
    );
  });
});
