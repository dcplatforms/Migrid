/**
 * L3: VPP Aggregator Service
 * Aggregates EV fleet and BESS capacity for wholesale market participation
 */

const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const { connectProducer, dispatchV2G } = require('./src/events/producer');

const app = express();
const port = process.env.PORT || 3003;

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const CAPACITY_UPDATE_INTERVAL = parseInt(process.env.CAPACITY_UPDATE_INTERVAL) || 10000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Kafka connection
const kafka = new Kafka({
  clientId: 'vpp-aggregator',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: 'vpp-aggregator-group' });

app.use(express.json());

const SAFETY_LOCK_KEY = 'l1:safety:lock';
const SAFETY_CONTEXT_KEY = 'l1:safety:lock:context';
const SAFE_MODE_SITES_SET = 'l3:vpp:safemode_sites';

/**
 * Helper: Get sites currently in Safe Mode from Redis
 */
const getSafeModeSites = async () => {
  try {
    // Optimization: Using SMEMBERS on a dedicated set instead of SCAN
    return await redisClient.sMembers(SAFE_MODE_SITES_SET);
  } catch (error) {
    console.error('[VPP Aggregator] Error fetching Safe Mode sites:', error);
    return [];
  }
};

/**
 * Middleware: Verify JWT token
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'vpp-aggregator',
    version: '3.3.0',
    status: 'healthy',
    layer: 'L3'
  });
});

// Get available capacity
app.get('/capacity/available', authenticateToken, async (req, res) => {
  try {
    // 1. Check L1 Safety Lock (Global and Contextual)
    const safetyLock = await redisClient.get(SAFETY_LOCK_KEY);
    const safetyContext = await redisClient.get(SAFETY_CONTEXT_KEY);
    let isLocked = (safetyLock === '1' || safetyLock === 'true');

    if (safetyContext) {
      try {
        const context = JSON.parse(safetyContext);
        // Halt if VPP violation is active, or if it's fleet-specific
        if (context.vpp_active || context.fleet_id === req.user.fleet_id) {
          isLocked = true;
        }
      } catch (e) {
        console.error('[VPP Aggregator] Failed to parse safety context:', e.message);
      }
    }

    if (isLocked) {
      console.warn(`🚨 [VPP Aggregator] Capacity Request Rejected: L1 Safety Lock active for fleet ${req.user.fleet_id}`);
      return res.json({
        available_capacity_kwh: 0,
        available_capacity_kw: 0,
        resource_count: 0,
        timestamp: new Date().toISOString(),
        status: 'HALTED_BY_PHYSICS_SAFEGUARD'
      });
    }

    // Try to serve from Redis first for L4 performance SLA (<50ms)
    const cachedCapacity = await redisClient.get(`vpp:capacity:available:${req.user.fleet_id}`);
    if (cachedCapacity) {
      return res.json(JSON.parse(cachedCapacity));
    }

    // Check Safe Mode sites from L8
    const safeModeSites = await getSafeModeSites();

    // L1 Physics Confidence Derating (Phase 5 Forward Engineering)
    let physicsMultiplier = 1.0;
    let isHighFidelity = false;
    if (safetyContext && typeof safetyContext === 'string') {
      try {
        const context = JSON.parse(safetyContext);
        if (context.physics_score) {
          physicsMultiplier = parseFloat(context.physics_score);
          isHighFidelity = physicsMultiplier > 0.95;
        }
      } catch (e) {}
    }

    const result = await pool.query(`
      SELECT
        SUM(
          GREATEST(0, (v.current_soc - GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)) / 100.0)
          * v.battery_capacity_kwh
          * COALESCE(v.availability_factor, 1.0)
        ) as raw_capacity_kwh,
        COUNT(*) as vehicle_count
      FROM vehicles v
      LEFT JOIN charging_sessions cs ON v.id = cs.vehicle_id AND cs.end_time IS NULL
      LEFT JOIN chargers c ON cs.charger_id = c.id
      WHERE v.is_plugged_in = true
        AND v.v2g_enabled = true
        AND v.current_soc > GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)
        AND v.fleet_id = $1
        AND (c.location_id IS NULL OR c.location_id::text != ALL($2))
    `, [req.user.fleet_id, safeModeSites]);

    const capacity = result.rows[0];
    const totalCapacityKwh = parseFloat(capacity.raw_capacity_kwh || 0) * physicsMultiplier;

    const response = {
      available_capacity_kwh: totalCapacityKwh,
      available_capacity_kw: totalCapacityKwh, // Assuming 1-hour discharge for kW estimate
      physics_multiplier: physicsMultiplier,
      is_high_fidelity: isHighFidelity,
      resource_count: parseInt(capacity.vehicle_count || 0),
      timestamp: new Date().toISOString(),
      source: 'database'
    };

    // Cache the result for 10 seconds
    await redisClient.setEx(
      `vpp:capacity:available:${req.user.fleet_id}`,
      10,
      JSON.stringify(response)
    );

    res.json(response);
  } catch (error) {
    console.error('[VPP Aggregator] Capacity retrieval error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Register resource
app.post('/resources/register', authenticateToken, async (req, res) => {
  const { vehicle_id, battery_capacity_kwh, v2g_enabled, resource_type = 'EV' } = req.body;

  if (!vehicle_id || typeof vehicle_id !== 'string' || typeof battery_capacity_kwh !== 'number' || typeof v2g_enabled !== 'boolean') {
    return res.status(400).json({ error: 'Invalid input parameters' });
  }

  if (!['EV', 'BESS'].includes(resource_type)) {
    return res.status(400).json({ error: 'resource_type must be EV or BESS' });
  }

  if (battery_capacity_kwh < 50) {
    return res.status(400).json({ error: 'Minimum battery capacity is 50 kWh' });
  }

  try {
    const vehicleCheck = await pool.query('SELECT fleet_id FROM vehicles WHERE id = $1', [vehicle_id]);

    if (vehicleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicleCheck.rows[0].fleet_id !== req.user.fleet_id) {
      return res.status(403).json({ error: 'Unauthorized: Fleet mismatch' });
    }

    await pool.query(`
      INSERT INTO vpp_resources (vehicle_id, battery_capacity_kwh, v2g_enabled, resource_type, registered_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        battery_capacity_kwh = $2, v2g_enabled = $3, resource_type = $4, updated_at = NOW()
    `, [vehicle_id, battery_capacity_kwh, v2g_enabled, resource_type]);

    res.json({ success: true, message: 'Resource registered' });
  } catch (error) {
    console.error('[VPP Aggregator] Resource registration error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

/**
 * Global Capacity Aggregation (Background Job)
 * Meets L4 Market Gateway sub-50ms SLA
 */
const updateGlobalCapacity = async () => {
  try {
    // Check safety lock first (Global and Contextual)
    const safetyLock = await redisClient.get(SAFETY_LOCK_KEY);
    const safetyContextRaw = await redisClient.get(SAFETY_CONTEXT_KEY);
    let isLocked = (safetyLock === '1' || safetyLock === 'true');
    let lockedFleetId = null;
    let physicsMultiplier = 1.0;

    if (safetyContextRaw) {
      try {
        const context = JSON.parse(safetyContextRaw);
        if (context.vpp_active) {
          isLocked = true;
        }
        if (context.fleet_id) {
          lockedFleetId = context.fleet_id;
        }
        if (context.physics_score) {
          physicsMultiplier = parseFloat(context.physics_score);
        }
      } catch (e) {
        console.error('[VPP Aggregator] Failed to parse safety context in background job:', e.message);
      }
    }

    if (isLocked) {
        await redisClient.set('vpp:capacity:available', '0');
        await redisClient.set('vpp:capacity:regional', JSON.stringify({}));
        await redisClient.set('vpp:capacity:regional:high_fidelity', JSON.stringify({}));
        return;
    }

    // Check Safe Mode sites from L8
    const safeModeSites = await getSafeModeSites();

    // Regional Capacity Aggregation (Phase 5 Forward Engineering for ERCOT/Nord Pool)
    const result = await pool.query(`
      SELECT
        COALESCE(cs.iso_region, 'SYSTEM_WIDE') as region,
        r.resource_type,
        SUM(
          GREATEST(0, (v.current_soc - GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)) / 100.0)
          * v.battery_capacity_kwh
          * COALESCE(v.availability_factor, 1.0)
        ) as raw_capacity_kwh
      FROM vehicles v
      LEFT JOIN vpp_resources r ON v.id = r.vehicle_id
      LEFT JOIN charging_sessions cs ON v.id = cs.vehicle_id AND cs.end_time IS NULL
      LEFT JOIN chargers c ON cs.charger_id = c.id
      WHERE (v.is_plugged_in = true OR COALESCE(r.resource_type, 'EV') = 'BESS')
        AND COALESCE(r.v2g_enabled, v.v2g_enabled) = true
        AND v.current_soc > GREATEST(COALESCE(v.min_soc_threshold, 0), 20.0)
        AND (c.location_id IS NULL OR c.location_id::text != ALL($1))
        AND ($2::UUID IS NULL OR v.fleet_id != $2)
      GROUP BY region, r.resource_type
    `, [safeModeSites, lockedFleetId]);

    let totalCapacity = 0;
    const regionalCapacity = {};
    const isHighFidelity = physicsMultiplier > 0.95;

    result.rows.forEach(row => {
      // ISO Normalization: Uppercase and remove hyphens (e.g., 'ENTSO-E' to 'ENTSOE')
      const regionStr = row.region || 'SYSTEM_WIDE';
      const normalizedRegion = regionStr.toUpperCase().replace(/-/g, '');
      const deratedCapacity = parseFloat(row.raw_capacity_kwh || 0) * physicsMultiplier;
      const resourceType = row.resource_type || 'EV';

      totalCapacity += deratedCapacity;

      if (!regionalCapacity[normalizedRegion]) {
        regionalCapacity[normalizedRegion] = { total: 0, ev: 0, bess: 0, is_high_fidelity: isHighFidelity };
      }

      regionalCapacity[normalizedRegion].total += deratedCapacity;
      if (resourceType === 'EV') regionalCapacity[normalizedRegion].ev += deratedCapacity;
      if (resourceType === 'BESS') regionalCapacity[normalizedRegion].bess += deratedCapacity;
    });

    await redisClient.set('vpp:capacity:available', totalCapacity.toString());

    // L4 Compatibility: Also provide legacy flat mapping for L4 (until L4 is updated to v3.7.0)
    const legacyRegional = {};
    Object.keys(regionalCapacity).forEach(region => {
        legacyRegional[region] = regionalCapacity[region].total;
    });

    await redisClient.set('vpp:capacity:regional', JSON.stringify(legacyRegional));
    await redisClient.set('vpp:capacity:regional:high_fidelity', JSON.stringify(regionalCapacity));

    // Save historical state for L11 ML Engine Training
    await pool.query(
      'INSERT INTO vpp_capacity_history (total_capacity_kwh, regional_data, physics_multiplier, is_high_fidelity, safety_context, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())',
      [totalCapacity, JSON.stringify(regionalCapacity), physicsMultiplier, isHighFidelity, safetyContextRaw]
    ).catch(e => console.error('[VPP Aggregator] Failed to log history for L11:', e.message));

    console.log(`[VPP Aggregator] Global Capacity Updated: ${totalCapacity.toFixed(2)} kWh (Multiplier: ${physicsMultiplier}, Fidelity: ${isHighFidelity})`);
  } catch (error) {
    console.error('[VPP Aggregator] Global capacity update error:', error);
  }
};

/**
 * Initialize Kafka Consumers
 */
const initKafka = async () => {
  try {
    await consumer.connect();
    await consumer.subscribe({
        topics: ['migrid.physics.alerts', 'grid_signals', 'VPP_PARTICIPATION_CHANGED', 'L8_SAFE_MODE_CHANGED'],
        fromBeginning: false
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        let payload;
        try {
            payload = JSON.parse(message.value.toString());
        } catch (parseError) {
            console.error(`❌ [VPP Aggregator] Failed to parse Kafka message on topic ${topic}:`, parseError.message);
            return;
        }

        console.log(`📥 [VPP Aggregator] Received Kafka message [${topic}]:`, payload);

        if (topic === 'migrid.physics.alerts') {
          if (payload.event_type === 'CAPACITY_VIOLATION' || payload.event_type === 'PHYSICS_FRAUD') {
            console.warn(`⚠️ [VPP Aggregator] Physics alert: Resource ${payload.vehicle_id} | Type: ${payload.event_type} | Severity: ${payload.severity}`);
            console.log(`[VPP Aggregator] Alert Context: Site=${payload.site_id}, BillingMode=${payload.billing_mode}, VPP_Active=${payload.vpp_active}`);

            // Invalidate cache
            await redisClient.del(`vpp:capacity:available:${payload.fleet_id}`);
            // Trigger immediate global capacity update
            await updateGlobalCapacity();
          }
        }

        if (topic === 'VPP_PARTICIPATION_CHANGED') {
            console.log(`👤 [VPP Aggregator] VPP Participation changed for driver: ${payload.driver_id}. Active: ${payload.vpp_participation_active}`);
            // Trigger global update
            await updateGlobalCapacity();
        }

        if (topic === 'L8_SAFE_MODE_CHANGED') {
            const { site_id, safe_mode } = payload;
            console.log(`🛡️ [VPP Aggregator] L8 Safe Mode Change: Site ${site_id} is now ${safe_mode ? 'LOCKED' : 'RELEASED'}`);

            if (safe_mode) {
              await redisClient.sAdd(SAFE_MODE_SITES_SET, site_id.toString());
            } else {
              await redisClient.sRem(SAFE_MODE_SITES_SET, site_id.toString());
            }

            // Trigger global update
            await updateGlobalCapacity();
        }

        if (topic === 'grid_signals') {
          const { event_id, program_id, market_context, site_id, priority, v2g_requested, der_control } = payload;
          console.log(`⚡ [VPP Aggregator] Grid Signal received: ${event_id}. Program: ${program_id}, Market: ${market_context}, Site: ${site_id}, Priority: ${priority}`);

          if (v2g_requested || der_control) {
            console.log(`🔋 [IEEE 2030.5] Initiating Automated V2G Dispatch Sequence for Event: ${event_id}`);

            // IEEE 2030.5 DERControl Skeleton (Phase 7/8 Forward Engineering)
            if (der_control) {
                const { op_mode, set_point_kw } = der_control;
                console.log(`[IEEE 2030.5] DERControl received: Mode=${op_mode}, Target=${set_point_kw}kW`);
                // Logic to select specific BESS/EV assets based on op_mode (e.g., peak shaving vs frequency response)
            }

            // Phase 8 Preview: Fast Frequency Response logic would trigger here
            // Currently: Dispatches to all available authorized resources in the site/region
          }
        }
      },
    });
    console.log('✅ [VPP Aggregator] Kafka Consumers initialized.');
  } catch (error) {
    console.error('❌ [VPP Aggregator] Kafka initialization error:', error);
  }
};

/**
 * L11 AI Data Readiness: Export historical VPP capacity states for training
 */
app.get('/data/training/capacity', authenticateToken, async (req, res) => {
    const { days } = req.query;
    const daysInt = parseInt(days) || 7;

    try {
        const result = await pool.query(
            'SELECT * FROM vpp_capacity_history WHERE timestamp > NOW() - ($1 || \' days\')::interval ORDER BY timestamp ASC',
            [daysInt]
        );

        res.json({
            record_count: result.rows.length,
            data: result.rows,
            version: '1.0.0',
            status: 'READY_FOR_L11'
        });
    } catch (error) {
        console.error('[L11 Data Export Error]', error);
        res.status(500).json({ error: 'Failed to export training data' });
    }
});

/**
 * V2G Dispatch Endpoint
 * Authorized V2G discharge trigger for specific chargers.
 * Security: Enforces fleet isolation and validates input.
 */
app.post('/dispatch/v2g', authenticateToken, async (req, res) => {
    const { chargePointId, amountKw } = req.body;

    // 1. Input Validation
    if (!chargePointId || typeof chargePointId !== 'string') {
        return res.status(400).json({ error: 'chargePointId is required and must be a string.' });
    }
    if (!amountKw || typeof amountKw !== 'number' || amountKw <= 0) {
        return res.status(400).json({ error: 'amountKw must be a positive number.' });
    }

    try {
        // 2. IDOR / Authorization Check: Ensure the charger belongs to the user's fleet
        const chargerCheck = await pool.query(
            'SELECT id FROM chargers WHERE serial_number = $1 AND fleet_id = $2',
            [chargePointId, req.user.fleet_id]
        );

        if (chargerCheck.rows.length === 0) {
            console.warn(`[Security] Unauthorized V2G dispatch attempt by fleet ${req.user.fleet_id} on charger ${chargePointId}`);
            return res.status(403).json({
                error: 'Forbidden: You are not authorized to dispatch this resource.'
            });
        }

        // 3. Dispatch Signal to Kafka
        await dispatchV2G(chargePointId, amountKw);
        res.json({ status: 'DISPATCHED', chargePointId, amountKw });
    } catch (error) {
        console.error('[VPP Aggregator] Dispatch error:', error);
        res.status(500).json({ error: 'An internal server error occurred' });
    }
});

// Start server function
async function startServer() {
  console.log(`[VPP Aggregator] Running on port ${port}`);
  await redisClient.connect();
  await connectProducer();
  await initKafka();

  // Start background job
  setInterval(updateGlobalCapacity, CAPACITY_UPDATE_INTERVAL);
  // Initial run
  await updateGlobalCapacity();

  return app.listen(port);
}

if (require.main === module) {
  startServer();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[VPP Aggregator] Shutting down gracefully...');
  await consumer.disconnect();
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});

module.exports = { app, updateGlobalCapacity };
