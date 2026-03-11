// Manual mock producer
global.mockProducerSend = jest.fn();
global.mockRedisSetEx = jest.fn();

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
    query: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    end: jest.fn()
  }))
}), { virtual: true });

jest.mock('redis', () => ({
  createClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({}),
    lPush: jest.fn().mockResolvedValue({}),
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

  test('should set safety lock in Redis for PHYSICS_FRAUD', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'PHYSICS_FRAUD',
        session_id: 'session-fraud-1'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock', 900, 'true');
  });

  test('should set safety lock in Redis for CAPACITY_VIOLATION', async () => {
    const msg = {
      payload: JSON.stringify({
        event_type: 'CAPACITY_VIOLATION',
        vehicle_id: 'vehicle-v1'
      })
    };

    await physicsEngine.handlePhysicsAlert(msg);

    expect(global.mockRedisSetEx).toHaveBeenCalledWith('l1:safety:lock', 900, 'true');
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
});
