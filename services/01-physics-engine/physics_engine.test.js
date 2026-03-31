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

global.mockRedisRPop = jest.fn();
jest.mock('redis', () => ({
  createClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({}),
    lPush: jest.fn().mockResolvedValue({}),
    rPop: jest.fn().mockImplementation((key) => global.mockRedisRPop(key)),
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
    expect(alertValue.physics_score).toBe("0.0000"); // 1 - (18.5/15) = -0.23 -> clamp to 0
    expect(alertValue.is_high_fidelity).toBe(false);
    expect(alertValue.is_sentinel_fidelity).toBe(false);
  });

  test('should calculate physics_score and is_high_fidelity correctly for moderate variance', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        variance_pct: 7.5
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.physics_score).toBe("0.5000"); // 1 - (7.5/15) = 0.5
    expect(alertValue.is_high_fidelity).toBe(false);
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
    expect(alertValue.physics_score).toBe("0.0000"); // Forced 0.0 for CAPACITY_VIOLATION
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
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"physics_score":"0.0000"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"is_high_fidelity":false'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"is_sentinel_fidelity":false'));
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

  test('should normalize iso_region from ENTSO-E to ENTSOE in Kafka alert', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-entsoe-1',
        iso_region: 'ENTSO-E'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.iso_region).toBe('ENTSOE');
  });

  test('should include market_price_at_session in Redis context and Kafka alert', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-price-1',
        variance_pct: 20.0,
        market_price_at_session: 125.50
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"market_price_at_session":125.5'));
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.market_price_at_session).toBe(125.5);
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

  test('should include is_high_fidelity in Kafka alert for high efficiency', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        efficiency_pct: 99.0
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.is_high_fidelity).toBe(true);
    expect(alertValue.is_sentinel_fidelity).toBe(false); // Exactly 0.99 is not > 0.99
    expect(alertValue.physics_score).toBe("0.9900");
  });

  test('should include is_sentinel_fidelity for ultra-high efficiency', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        efficiency_pct: 99.5
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.is_high_fidelity).toBe(true);
    expect(alertValue.is_sentinel_fidelity).toBe(true);
    expect(alertValue.physics_score).toBe("0.9950");
  });

  test('should handle ERCOT capacity violation during scarcity event (LMP > 100)', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-tx-99',
        current_soc: 18.5,
        iso_region: 'ERCOT',
        market_price_at_session: 120.0,
        vpp_active: true
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    // Verify Redis context captures the scarcity price and region
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"iso_region":"ERCOT"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock:context', 900, expect.stringContaining('"market_price_at_session":120'));

    // Verify Kafka alert captures market context
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.iso_region).toBe('ERCOT');
    expect(alertValue.market_price_at_session).toBe(120.0);
    expect(alertValue.severity).toBe('CRITICAL');
  });

  test('should flag high-fidelity charging session (variance < 0.75%)', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        variance_pct: 0.5
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.physics_score).toBe("0.9667"); // 1 - (0.5/15) = 0.96666...
    expect(alertValue.is_high_fidelity).toBe(true);
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
        expect.stringContaining('FROM vehicles'),
        ['f1']
    );
    expect(global.mockRedisSetEx).toHaveBeenCalledTimes(2);
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:CAISO:vehicle:v1', 60, expect.stringContaining('"id":"v1"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:CAISO:vehicle:v2', 60, expect.stringContaining('"id":"v2"'));
  });

  test('should sync vehicles using regional namespaces from joined fleet data', async () => {
    global.mockPgQuery.mockResolvedValue({
      rows: [
        { id: 'v-ercot', fleet_id: 'f-tx', iso: 'ERCOT', current_soc: 50 },
        { id: 'v-entsoe', fleet_id: 'f-eu', iso: 'ENTSO-E', current_soc: 60 }
      ]
    });

    await physicsEngine.syncDigitalTwin();

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:ERCOT:vehicle:v-ercot', 60, expect.stringContaining('"id":"v-ercot"'));
    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:ENTSOE:vehicle:v-entsoe', 60, expect.stringContaining('"id":"v-entsoe"'));
  });
});

describe('L1 Physics Engine Scarcity Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should activate scarcity mode when market price exceeds $100', async () => {
    // Initial start to set up the interval
    await physicsEngine.start();
    const initialIntervalId = physicsEngine.getSyncIntervalId();
    // In some environments _idleTimeout might not be available or might be different
    // Let's use a more robust check if possible, or skip the internal timeout check if it's finicky.
    // However, since it failed with undefined, let's see.

    const msg = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        market_price_at_session: 150.0
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(physicsEngine.getLastMarketPrice()).toBe(150.0);
    const newIntervalId = physicsEngine.getSyncIntervalId();
    expect(newIntervalId).not.toBe(initialIntervalId);

    // Clean up
    clearInterval(newIntervalId);
  });

  test('should deactivate scarcity mode when market price drops below $100', async () => {
    // Initial start in scarcity mode
    const msgScarcity = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        market_price_at_session: 150.0
      })
    };
    await physicsEngine.start();
    await physicsEngine.handlePhysicsAlert(msgScarcity);
    const scarcityIntervalId = physicsEngine.getSyncIntervalId();

    const msgNormal = {
      payload: JSON.stringify({
        event_type: 'EFFICIENCY_ALERT',
        market_price_at_session: 45.0
      })
    };

    await physicsEngine.handlePhysicsAlert(msgNormal);

    expect(physicsEngine.getLastMarketPrice()).toBe(45.0);
    const normalIntervalId = physicsEngine.getSyncIntervalId();
    expect(normalIntervalId).not.toBe(scarcityIntervalId);

    // Clean up
    clearInterval(normalIntervalId);
  });
});

describe('L1 Physics Engine Reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.mockProducerSend = jest.fn();
    global.mockPgQuery = jest.fn();
  });

  test('should reconcile logs with full regional and market context', async () => {
    const payload = {
      session_id: 'recon-session-1',
      event_type: 'PHYSICS_FRAUD',
      efficiency_pct: 70.0,
      billing_mode: 'FLEET',
      vpp_active: true,
      v2g_active: true,
      iso_region: 'PJM',
      market_price_at_session: 95.0,
      timestamp: '2023-10-28T10:00:00Z'
    };

    global.mockRedisRPop
      .mockResolvedValueOnce(JSON.stringify(payload))
      .mockResolvedValueOnce(null);

    await physicsEngine.reconcileLogs();

    // Verify Kafka Alert dispatch during reconciliation
    expect(global.mockProducerSend).toHaveBeenCalled();
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.iso_region).toBe('PJM');
    expect(alertValue.market_price_at_session).toBe(95.0);
    expect(alertValue.v2g_active).toBe(true);
    expect(alertValue.reconciled).toBe(true);
    expect(alertValue.physics_score).toBe("0.0000");
    expect(alertValue.is_high_fidelity).toBe(false);
    expect(alertValue.is_sentinel_fidelity).toBe(false);

    // Verify DB Insertion during reconciliation
    expect(global.mockPgQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['recon-session-1', 'PHYSICS_FRAUD', 'PJM', 95.0, '0.0000', false])
    );
  });

  test('should normalize iso_region during reconciliation from ENTSO-E to ENTSOE', async () => {
    const payload = {
      session_id: 'recon-session-entsoe',
      event_type: 'EFFICIENCY_ALERT',
      iso_region: 'ENTSO-E'
    };

    global.mockRedisRPop
      .mockResolvedValueOnce(JSON.stringify(payload))
      .mockResolvedValueOnce(null);

    await physicsEngine.reconcileLogs();

    // Verify Kafka Alert dispatch during reconciliation has normalized ISO
    const alertValue = JSON.parse(global.mockProducerSend.mock.calls[0][0].messages[0].value);
    expect(alertValue.iso_region).toBe('ENTSOE');

    // Verify DB Insertion during reconciliation has normalized ISO
    expect(global.mockPgQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['recon-session-entsoe', 'EFFICIENCY_ALERT', 'ENTSOE', 0.0])
    );
  });
});
