/**
 * L6: Engagement Engine
 * Gamification, leaderboards, achievements, and driver engagement
 */

const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const port = process.env.PORT || 3006;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/migrid'
});

// Redis connection for market price context and caching
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

io.on('connection', (socket) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;

  if (!token) {
    console.warn('[L6 WebSockets] Connection attempt without token.');
    return socket.disconnect();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.warn('[L6 WebSockets] Invalid token on connection.');
      return socket.disconnect();
    }

    const driverId = decoded.driver_id;
    socket.join(`driver:${driverId}`);
    console.log(`[L6 WebSockets] Driver ${driverId} authenticated and joined private room.`);
  });
});

// Middleware: Verify JWT token
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

// Kafka Setup
const kafka = new Kafka({
  clientId: 'engagement-engine',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const consumer = kafka.consumer({ groupId: 'engagement-engine-group' });
const producer = kafka.producer();

async function initKafka() {
  await consumer.connect();
  await producer.connect();

  // Listen for both direct events and session completions
  await consumer.subscribe({ topics: ['charging_events', 'SESSION_COMPLETED', 'vpp_participation_updates', 'grid_signals', 'MARKET_PRICE_UPDATED'], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        console.log(`[Engagement] Received message from ${topic}:`, payload);

        if (topic === 'SESSION_COMPLETED' || topic === 'charging_events') {
          await processChargingEvent(payload);
        } else if (topic === 'vpp_participation_updates') {
          await handleVPPParticipationUpdate(payload);
        } else if (topic === 'grid_signals') {
          await handleGridSignal(payload);
        } else if (topic === 'MARKET_PRICE_UPDATED') {
          const { iso, price_per_mwh, profitability_index } = payload;
          const normalizedIso = iso.toUpperCase().replace(/-/g, '');
          await redisClient.hSet('market:profitability', normalizedIso, profitability_index.toString());
          console.log(`[Engagement] Updated Redis Market Profitability for ${normalizedIso}: $${profitability_index}/MWh`);
        }
      } catch (error) {
        console.error('[Engagement] Error processing Kafka message:', error);
      }
    }
  });
}

initKafka().catch(console.error);

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'engagement-engine',
    version: '5.6.0', // Weekly Product Update: Physics Sentinel & L10 Sync
    status: 'healthy',
    layer: 'L6'
  });
});

// ============================================================================
// LEADERBOARD ENDPOINTS
// ============================================================================

// Get global leaderboard
app.get('/leaderboard', authenticateToken, async (req, res) => {
  const { limit = 50 } = req.query;
  const fleet_id = req.user.fleet_id; // Multi-tenancy isolation

  try {
    let query = `
      SELECT
        l.rank,
        l.total_points,
        l.green_score,
        d.id as driver_id,
        d.first_name,
        d.last_name,
        f.name as fleet_name
      FROM leaderboard l
      JOIN drivers d ON l.driver_id = d.id
      JOIN fleets f ON l.fleet_id = f.id
    `;
    const params = [];

    if (fleet_id) {
      query += ' WHERE l.fleet_id = $1';
      params.push(fleet_id);
    }

    query += ` ORDER BY l.rank ASC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    res.json({
      leaderboard: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Get driver's rank
app.get('/leaderboard/driver/:driver_id', authenticateToken, async (req, res) => {
  // IDOR check: Drivers can only view their own rank
  if (req.params.driver_id !== req.user.driver_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to view other driver ranks' });
  }

  try {
    const result = await pool.query(`
      SELECT
        l.rank,
        l.total_points,
        l.green_score,
        d.first_name,
        d.last_name
      FROM leaderboard l
      JOIN drivers d ON l.driver_id = d.id
      WHERE l.driver_id = $1
    `, [req.params.driver_id]);

    if (result.rows.length === 0) {
      return res.json({ rank: null, message: 'Driver not ranked yet' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// ACHIEVEMENTS ENDPOINTS
// ============================================================================

// Get all available achievements
app.get('/achievements', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description, icon, points
      FROM achievements
      ORDER BY points ASC
    `);

    res.json({
      achievements: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Get driver's achievements
app.get('/achievements/driver/:driver_id', authenticateToken, async (req, res) => {
  // IDOR check: Drivers can only view their own achievements
  if (req.params.driver_id !== req.user.driver_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to view other driver achievements' });
  }

  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.name,
        a.description,
        a.icon,
        a.points,
        da.earned_at
      FROM driver_achievements da
      JOIN achievements a ON da.achievement_id = a.id
      WHERE da.driver_id = $1
      ORDER BY da.earned_at DESC
    `, [req.params.driver_id]);

    res.json({
      achievements: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Award achievement to driver
app.post('/achievements/award', authenticateToken, async (req, res) => {
  const { driver_id, achievement_id } = req.body;

  // IDOR check
  if (driver_id !== req.user.driver_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const points = await awardAchievement(driver_id, achievement_id);
    res.json({ success: true, points_earned: points });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: error.message || 'An internal server error occurred' });
  }
});

// ============================================================================
// CHALLENGES ENDPOINTS
// ============================================================================

// Get active challenges from database with driver progress
app.get('/challenges/active', authenticateToken, async (req, res) => {
  const driver_id = req.user.driver_id;
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.description, c.points_reward, c.token_reward,
        c.required_count, c.challenge_type, c.end_date,
        COALESCE(dcp.current_count, 0) as progress_current,
        COALESCE(dcp.is_completed, false) as is_completed
      FROM challenges c
      LEFT JOIN driver_challenge_progress dcp ON c.id = dcp.challenge_id AND dcp.driver_id = $1
      WHERE c.is_active = true AND (c.end_date IS NULL OR c.end_date > NOW())
    `, [driver_id]);

    res.json({ challenges: result.rows });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function processChargingEvent(event) {
  const driverId = event.driverId || event.driver_id;
  const sessionId = event.sessionId || event.session_id;
  const type = event.type || (event.energyDispensedKwh ? 'session_update' : 'unknown');

  // Get regional context (ISO) for the driver
  const driverData = await pool.query('SELECT f.iso FROM drivers d JOIN fleets f ON d.fleet_id = f.id WHERE d.id = $1', [driverId]);
  const iso = (driverData.rows[0]?.iso || 'CAISO').toUpperCase().replace(/-/g, '');

  // Verify Physics Integrity before awarding points
  let isValid = true;
  if (sessionId) {
    const session = await pool.query('SELECT is_valid FROM charging_sessions WHERE id = $1', [sessionId]);
    if (session.rows.length > 0 && session.rows[0].is_valid === false) {
      console.warn(`[Engagement] Session ${sessionId} rejected for scoring due to Physics Violation.`);
      isValid = false;
    }
  }

  if ((type === 'SESSION_COMPLETED' || type === 'session_completed' || event.energyDispensedKwh) && isValid) {
    const isFinal = type === 'SESSION_COMPLETED' || type === 'session_completed';

    // Calculate physics_score and isHighFidelity if not already provided
    let physics_score = 1.0;
    let isHighFidelity = true;
    let isLowVariance = true;

    // Use event-provided score if available
    if (event.physicsScore !== undefined) physics_score = parseFloat(event.physicsScore);
    if (event.physics_score !== undefined) physics_score = parseFloat(event.physics_score);
    isHighFidelity = physics_score > 0.95;

    if (isFinal) {
      const sessionData = await pool.query('SELECT variance_percentage FROM charging_sessions WHERE id = $1', [sessionId]);
      const variance = parseFloat(sessionData.rows[0]?.variance_percentage || '100');
      isLowVariance = variance < 5.0;
      physics_score = Math.max(0, Math.min(1, 1 - (variance / 15.0)));
      isHighFidelity = physics_score > 0.95;

      await pool.query('INSERT INTO driver_actions (driver_id, action_type, metadata) VALUES ($1, $2, $3)',
        [driverId, 'session_completed', JSON.stringify({ sessionId, energyDispensedKwh: event.energyDispensedKwh, isLowVariance, physics_score, isHighFidelity })]);

      await checkFirstSessionAchievement(driverId);
      await updateStreaks(driverId);
      await checkSustainabilityChampion(driverId);
      // Market Master is awarded only on session completion to ensure it's session-based
      await checkMarketMasterAchievement(driverId, iso, sessionId);

      // Phase 6 AI Readiness: Check for ML Contributor (High-fidelity data)
      if (isLowVariance) {
        await pool.query('INSERT INTO driver_actions (driver_id, action_type, metadata) VALUES ($1, $2, $3)', [driverId, 'low_variance_session', JSON.stringify({ sessionId, variance, physics_score })]);
        await checkMLContributorAchievement(driverId);
        await checkEnergyArchitectAchievement(driverId);
        await checkL11DataGuardianAchievement(driverId);
        await checkPhysicsSentinelAchievement(driverId);
        await updateChallengeProgress(driverId, 'low_variance_charging');
      }
    }

    // Award Green Driver Score points (Example: 10 points per kWh if valid)
    if (event.energyDispensedKwh) {
      let pointsMultiplier = 1.0;
      try {
        const profitabilityStr = await redisClient.hGet('market:profitability', iso);
        const profitability = parseFloat(profitabilityStr || '0');
        if (profitability > 100) {
          pointsMultiplier = 2.0;
          console.log(`[L6] High Scarcity Bonus applied for ${iso}: 2.0x multiplier (L10 Scarcity Alignment).`);
        } else if (profitability > 30) {
          pointsMultiplier = 1.5;
          console.log(`[L6] Grid Alignment Bonus applied for ${iso}: 1.5x multiplier (L10 Surplus Alignment).`);
        }
      } catch (err) {
        console.error('[L6] Error fetching market profitability for bonus:', err.message);
      }

      const points = Math.floor(parseFloat(event.energyDispensedKwh) * 10 * pointsMultiplier);
      await updateLeaderboardPoints(driverId, points);

      // Notify of points earned
      const notification = {
        driver_id: driverId,
        type: 'points_earned',
        title: 'Points Earned! ⚡',
        body: `You just earned ${points} points for your charging session.`,
        data: {
          session_id: sessionId,
          points,
          physics_score: physics_score.toFixed(4),
          fidelity_status: isHighFidelity ? 'HIGH_FIDELITY' : 'STANDARD'
        }
      };

      // Notify L10 Token Engine for points fulfillment
      await producer.send({
        topic: 'driver_actions',
        messages: [{
          value: JSON.stringify({
            driver_id: driverId,
            action_type: 'green_charging',
            source_value: parseFloat(event.energyDispensedKwh),
            event_id: sessionId,
            iso: iso,
            physics_score: physics_score
          })
        }]
      });

      await producer.send({
        topic: 'engagement_notifications',
        messages: [{ key: driverId, value: JSON.stringify(notification) }]
      });

      // WebSocket Real-time Push
      io.to(`driver:${driverId}`).emit('notification', notification);

      // Emit to driver_actions for L10 Token Engine (Proof of Physics)
      await producer.send({
        topic: 'driver_actions',
        messages: [{
          value: JSON.stringify({
            driver_id: driverId,
            action_type: 'session_completed',
            source_value: parseFloat(event.energyDispensedKwh),
            event_id: sessionId,
            iso: iso,
            physics_score: physics_score
          })
        }]
      });
    }
  }

  if (event.type === 'v2g_discharge' && isValid) {
    let pointsMultiplier = 1.0;
    let isHighScarcity = false;
    try {
      const profitabilityStr = await redisClient.hGet('market:profitability', iso);
      const profitability = parseFloat(profitabilityStr || '0');
      if (profitability > 100) {
        pointsMultiplier = 2.0;
        isHighScarcity = true;
        console.log(`[L6] High Scarcity Bonus applied for ${iso}: 2.0x multiplier (L10 Scarcity Alignment).`);
      }
    } catch (err) {
      console.error('[L6] Error fetching market profitability for V2G bonus:', err.message);
    }

    const energyDischargedKwh = parseFloat(event.energyDischargedKwh || 1.0);
    const points = Math.floor(energyDischargedKwh * 25 * pointsMultiplier); // V2G earns base 25 points/kWh

    await pool.query('INSERT INTO driver_actions (driver_id, action_type, metadata) VALUES ($1, $2, $3)',
      [driverId, 'v2g_discharge', JSON.stringify({ event, protocol: event.protocol, points, isHighScarcity })]);

    // Award local points
    await updateLeaderboardPoints(driverId, points);

    // Notify L10 Token Engine for V2G fulfillment
    await producer.send({
      topic: 'driver_actions',
      messages: [{
        value: JSON.stringify({
          driver_id: driverId,
          action_type: 'v2g_discharge',
          source_value: energyDischargedKwh,
          event_id: sessionId,
          iso: iso,
          physics_score: 1.0 // V2G discharge is physics-verified by L1/L3
        })
      }]
    });

    await checkV2GAchievements(driverId, iso, sessionId);
    await updateChallengeProgress(driverId, 'v2g_participation');
    await updateChallengeProgress(driverId, 'vpp_participation');

    // V2X Pioneer Achievement (OCPP 2.1 native)
    if (event.protocol && event.protocol.toLowerCase().trim() === 'ocpp2.1') {
      const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'V2X Pioneer'");
      if (achievement.rows.length > 0) {
        await awardAchievement(driverId, achievement.rows[0].id);
      }
    }
  }

  // Periodic check for Plug & Charge Ready status
  await checkPlugAndChargeAchievement(driverId);
}

async function checkMarketMasterAchievement(driverId, iso, sessionId) {
  try {
    const normalizedIso = iso.toUpperCase().replace(/-/g, '');
    const profitabilityStr = await redisClient.hGet('market:profitability', normalizedIso);
    const profitability = parseFloat(profitabilityStr || '0');

    // High Profitability Threshold: $100/MWh (Matching L10 Scarcity Boost)
    if (profitability > 100) {
      console.log(`[L6] High profitability charging detected in ${iso} ($${profitability}/MWh) for session ${sessionId}.`);

      await pool.query('INSERT INTO driver_actions (driver_id, action_type, metadata) VALUES ($1, $2, $3)',
        [driverId, 'high_profitability_charge', JSON.stringify({ iso, profitability, sessionId })]);

      const count = await pool.query(`
        SELECT COUNT(*) FROM driver_actions
        WHERE driver_id = $1 AND action_type = 'high_profitability_charge'
      `, [driverId]);

      if (parseInt(count.rows[0].count) >= 5) {
        const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Market Master'");
        if (achievement.rows.length > 0) {
          await awardAchievement(driverId, achievement.rows[0].id);
        }
      }
    }
  } catch (error) {
    console.error('[Engagement] Error checking Market Master achievement:', error);
  }
}

async function checkScarcitySaviorAchievement(driverId, iso, sessionId) {
  try {
    const normalizedIso = iso.toUpperCase().replace(/-/g, '');
    const profitabilityStr = await redisClient.hGet('market:profitability', normalizedIso);
    const profitability = parseFloat(profitabilityStr || '0');

    // High Scarcity Threshold: $100/MWh
    if (profitability > 100) {
      console.log(`[L6] High scarcity V2G detected in ${iso} ($${profitability}/MWh) for session ${sessionId}.`);

      // requirement: 3 V2G actions during high scarcity
      const count = await pool.query(`
        SELECT COUNT(*) FROM driver_actions
        WHERE driver_id = $1 AND action_type = 'v2g_discharge'
          AND (metadata->>'isHighScarcity')::boolean = true
      `, [driverId]);

      if (parseInt(count.rows[0].count) >= 3) {
        const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Scarcity Savior'");
        if (achievement.rows.length > 0) {
          await awardAchievement(driverId, achievement.rows[0].id);
        }
      }
    }
  } catch (error) {
    console.error('[Engagement] Error checking Scarcity Savior achievement:', error);
  }
}

async function handleVPPParticipationUpdate(payload) {
  const { driver_id, vpp_participation_active } = payload;
  if (vpp_participation_active) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'VPP Ready'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
    // Update challenge progress for opting in
    await updateChallengeProgress(driver_id, 'vpp_participation');
  }
}

async function handleGridSignal(payload) {
  const { event_id, priority, site_id } = payload;
  console.log(`[L6] Handling Grid Signal for Team Challenge: ${event_id} (${priority}) - Site: ${site_id}`);

  try {
    // 1. Fully Bulked Database Operation:
    // This query handles:
    // - Recording 'grid_response' action for all target drivers
    // - Updating challenge progress for all target drivers
    // - Awarding points for completed challenges
    // - Awarding 'Grid Warrior' and 'ERCOT Pioneer' achievements in bulk
    // - Returning data needed for notifications
    const results = await pool.query(`
      WITH target_drivers AS (
          SELECT cs.driver_id, f.iso, f.id as fleet_id
          FROM charging_sessions cs
          JOIN drivers d ON cs.driver_id = d.id
          JOIN fleets f ON d.fleet_id = f.id
          LEFT JOIN chargers chr ON cs.charger_id = chr.id
          WHERE cs.end_time IS NULL
            AND ($1 = 'ALL' OR chr.location_id = $1)
      ),
      inserted_actions AS (
          INSERT INTO driver_actions (driver_id, action_type, metadata)
          SELECT td.driver_id, 'grid_response', $2::jsonb || jsonb_build_object('iso', td.iso)
          FROM target_drivers td
          RETURNING driver_id
      ),
      updated_progress AS (
          INSERT INTO driver_challenge_progress (driver_id, challenge_id, current_count)
          SELECT td.driver_id, c.id,
                 CASE
                    WHEN c.challenge_type = 'iso_explorer' THEN
                        (SELECT COUNT(DISTINCT iso_val) FROM (
                            SELECT metadata->>'iso' as iso_val FROM driver_actions WHERE driver_id = td.driver_id AND action_type = 'grid_response'
                            UNION
                            SELECT td.iso as iso_val
                        ) as combined_isos)
                    ELSE 1
                 END
          FROM target_drivers td
          CROSS JOIN challenges c
          WHERE (c.challenge_type = 'grid_response' OR c.challenge_type = 'iso_explorer')
            AND c.is_active = true
            AND (c.target_region IS NULL OR c.target_region = td.iso)
            AND (c.target_fleet_id IS NULL OR c.target_fleet_id = td.fleet_id)
          ON CONFLICT (driver_id, challenge_id)
          DO UPDATE SET current_count =
                         CASE
                            WHEN (SELECT challenge_type FROM challenges WHERE id = EXCLUDED.challenge_id) = 'iso_explorer' THEN EXCLUDED.current_count
                            ELSE driver_challenge_progress.current_count + 1
                         END,
                        updated_at = NOW()
          WHERE driver_challenge_progress.is_completed = false
          RETURNING driver_id, challenge_id, current_count
      ),
      completed_challenges AS (
          UPDATE driver_challenge_progress dcp
          SET is_completed = true
          FROM updated_progress up
          JOIN challenges c ON up.challenge_id = c.id
          WHERE dcp.driver_id = up.driver_id
            AND dcp.challenge_id = up.challenge_id
            AND up.current_count >= c.required_count
          RETURNING dcp.driver_id, c.points_reward, c.name, dcp.challenge_id
      ),
      grid_counts AS (
          SELECT da.driver_id,
                 COUNT(*) as action_count,
                 COUNT(DISTINCT (da.metadata->>'iso')) as iso_count
          FROM driver_actions da
          WHERE da.action_type = 'grid_response'
          AND da.driver_id IN (SELECT driver_id FROM target_drivers)
          GROUP BY da.driver_id
      ),
      new_achievements AS (
          SELECT gc.driver_id, a.id as achievement_id, a.name, a.points, td.iso
          FROM grid_counts gc
          JOIN target_drivers td ON gc.driver_id = td.driver_id
          CROSS JOIN achievements a
          WHERE (
              (a.name = 'Grid Warrior' AND gc.action_count >= 5) OR
              (a.name = 'Grid Impact' AND gc.action_count >= 10) OR
              (a.name = 'CAISO Pioneer' AND td.iso = 'CAISO' AND gc.action_count >= 1) OR
              (a.name = 'PJM Pioneer' AND td.iso = 'PJM' AND gc.action_count >= 1) OR
              (a.name = 'ERCOT Pioneer' AND td.iso = 'ERCOT' AND gc.action_count >= 1) OR
              (a.name = 'Nord Pool Pioneer' AND td.iso = 'NORDPOOL' AND gc.action_count >= 1) OR
              (a.name = 'ENTSO-E Pioneer' AND td.iso = 'ENTSOE' AND gc.action_count >= 1) OR
              (a.name = 'ISO Explorer' AND gc.iso_count >= 3) OR
              (a.name = 'Global Grid Guardian' AND gc.iso_count >= 5)
          )
          AND NOT EXISTS (
              SELECT 1 FROM driver_achievements da2
              WHERE da2.driver_id = gc.driver_id AND da2.achievement_id = a.id
          )
      ),
      inserted_achievements AS (
          INSERT INTO driver_achievements (driver_id, achievement_id)
          SELECT driver_id, achievement_id FROM new_achievements
          ON CONFLICT DO NOTHING
          RETURNING driver_id, achievement_id
      ),
      points_award AS (
          UPDATE leaderboard l
          SET total_points = l.total_points + COALESCE(cc.points_reward, 0) + COALESCE(na.points, 0),
              updated_at = NOW()
          FROM target_drivers td
          LEFT JOIN (SELECT driver_id, SUM(points_reward) as points_reward FROM completed_challenges GROUP BY 1) cc ON td.driver_id = cc.driver_id
          LEFT JOIN (SELECT driver_id, SUM(points) as points FROM new_achievements GROUP BY 1) na ON td.driver_id = na.driver_id
          WHERE l.driver_id = td.driver_id
            AND (cc.points_reward IS NOT NULL OR na.points IS NOT NULL)
      )
      SELECT
          td.driver_id,
          td.iso,
          COALESCE(JSON_AGG(DISTINCT cc.name) FILTER (WHERE cc.name IS NOT NULL), '[]') as completed_challenges,
          COALESCE(JSON_AGG(DISTINCT na.name) FILTER (WHERE na.name IS NOT NULL), '[]') as unlocked_achievements
      FROM target_drivers td
      LEFT JOIN completed_challenges cc ON td.driver_id = cc.driver_id
      LEFT JOIN new_achievements na ON td.driver_id = na.driver_id
      GROUP BY td.driver_id, td.iso
    `, [site_id || 'ALL', JSON.stringify({ event_id })]);

    // 2. Optimized Notification Handling
    for (const row of results.rows) {
      const challenges = JSON.parse(row.completed_challenges);
      const achievements = JSON.parse(row.unlocked_achievements);

      for (const chalName of challenges) {
        const notification = {
          driver_id: row.driver_id,
          type: 'challenge_completed',
          title: 'Challenge Completed! 🎖️',
          body: `Congratulations! You've completed the '${chalName}' challenge.`,
        };
        await producer.send({ topic: 'engagement_notifications', messages: [{ key: row.driver_id, value: JSON.stringify(notification) }] });
        io.to(`driver:${row.driver_id}`).emit('notification', notification);
      }

      for (const achName of achievements) {
        const achData = await pool.query('SELECT points, icon FROM achievements WHERE name = $1', [achName]);
        const points = achData.rows[0]?.points || 0;
        const icon = achData.rows[0]?.icon;

        const notification = {
          driver_id: row.driver_id,
          type: 'achievement_unlocked',
          title: 'Achievement Unlocked! 🏆',
          body: `You've earned the '${achName}' badge!`,
          data: { name: achName, points, icon }
        };
        await producer.send({ topic: 'engagement_notifications', messages: [{ key: row.driver_id, value: JSON.stringify(notification) }] });
        io.to(`driver:${row.driver_id}`).emit('notification', notification);
      }
    }

    await recalculateRanks();

  } catch (error) {
    console.error('[Engagement] Error handling grid signal:', error);
  }
}

async function checkFirstSessionAchievement(driver_id) {
  const count = await pool.query(`
    SELECT COUNT(*) FROM charging_sessions WHERE driver_id = $1
  `, [driver_id]);

  if (parseInt(count.rows[0].count) === 1) {
    const achievement = await pool.query('SELECT id FROM achievements WHERE name = \'Early Adopter\'');
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkPhysicsSentinelAchievement(driver_id) {
  // Requirement: 10 consecutive high-fidelity sessions (Physics Score > 0.99)
  // We check the last 10 'session_completed' actions and ensure they all have physics_score > 0.99.
  const result = await pool.query(`
    WITH recent_sessions AS (
      SELECT (metadata->>'physics_score')::float as physics_score
      FROM driver_actions
      WHERE driver_id = $1 AND action_type = 'session_completed'
      ORDER BY created_at DESC
      LIMIT 10
    )
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE physics_score > 0.99) as sentinel_count
    FROM recent_sessions
  `, [driver_id]);

  const { total, sentinel_count } = result.rows[0];

  if (parseInt(total) >= 10 && parseInt(sentinel_count) === 10) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Physics Sentinel'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkL11DataGuardianAchievement(driver_id) {
  // Requirement: 15 consecutive high-fidelity sessions (Physics Score > 0.95)
  // We check the last 15 'session_completed' actions and ensure they all have isHighFidelity = true in metadata.
  const result = await pool.query(`
    WITH recent_sessions AS (
      SELECT (metadata->>'isHighFidelity')::boolean as is_high_fidelity,
             (metadata->>'physics_score')::float as physics_score
      FROM driver_actions
      WHERE driver_id = $1 AND action_type = 'session_completed'
      ORDER BY created_at DESC
      LIMIT 15
    )
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE is_high_fidelity = true AND physics_score > 0.95) as high_fidelity_count
    FROM recent_sessions
  `, [driver_id]);

  const { total, high_fidelity_count } = result.rows[0];

  if (parseInt(total) >= 15 && parseInt(high_fidelity_count) === 15) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'L11 Data Guardian'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkErcotPioneerAchievement(driver_id) {
  // Requirement: Participate in at least 1 grid response event in ERCOT
  const count = await pool.query(`
    SELECT COUNT(*) FROM driver_actions
    WHERE driver_id = $1 AND action_type = 'grid_response'
  `, [driver_id]);

  if (parseInt(count.rows[0].count) >= 1) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'ERCOT Pioneer'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function updateChallengeProgress(driver_id, challenge_type) {
  try {
    const activeChallenges = await pool.query(
      'SELECT id, required_count FROM challenges WHERE challenge_type = $1 AND is_active = true',
      [challenge_type]
    );

    for (const challenge of activeChallenges.rows) {
      // Avoid redundant processing for already completed challenges
      const existing = await pool.query(
        'SELECT is_completed FROM driver_challenge_progress WHERE driver_id = $1 AND challenge_id = $2',
        [driver_id, challenge.id]
      );
      if (existing.rows.length > 0 && existing.rows[0].is_completed) continue;

      const progress = await pool.query(`
        INSERT INTO driver_challenge_progress (driver_id, challenge_id, current_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (driver_id, challenge_id)
        DO UPDATE SET current_count = driver_challenge_progress.current_count + 1,
                      updated_at = NOW()
        RETURNING current_count
      `, [driver_id, challenge.id]);

      if (progress.rows[0].current_count >= challenge.required_count) {
        await pool.query('UPDATE driver_challenge_progress SET is_completed = true WHERE driver_id = $1 AND challenge_id = $2', [driver_id, challenge.id]);

        const chal = await pool.query('SELECT name, points_reward, token_reward FROM challenges WHERE id = $1', [challenge.id]);
        await updateLeaderboardPoints(driver_id, chal.rows[0].points_reward);

        // Notify L10 Token Engine of challenge completion
        await producer.send({
          topic: 'driver_actions',
          messages: [{
            value: JSON.stringify({
              driver_id,
              action_type: 'challenge_completed',
              challenge_id: challenge.id,
              challenge_name: chal.rows[0].name,
              token_reward: chal.rows[0].token_reward,
              event_id: challenge.id
            })
          }]
        });

        const notification = {
          driver_id,
          type: 'challenge_completed',
          title: 'Challenge Completed! 🎖️',
          body: `Congratulations! You've completed the '${chal.rows[0].name}' challenge.`,
          data: { challenge_id: challenge.id }
        };

        await producer.send({
          topic: 'engagement_notifications',
          messages: [{ key: driver_id, value: JSON.stringify(notification) }]
        });

        io.to(`driver:${driver_id}`).emit('notification', notification);

        // Emit to driver_actions for L10 Token Engine
        const driverDataForChallenge = await pool.query('SELECT f.iso FROM drivers d JOIN fleets f ON d.fleet_id = f.id WHERE d.id = $1', [driver_id]);
        const isoForChallenge = driverDataForChallenge.rows[0]?.iso || 'CAISO';

        await producer.send({
          topic: 'driver_actions',
          messages: [{
            value: JSON.stringify({
              driver_id,
              action_type: 'challenge_completed',
              challenge_name: chal.rows[0].name,
              source_value: chal.rows[0].token_reward || chal.rows[0].points_reward,
              event_id: challenge.id,
              iso: isoForChallenge
            })
          }]
        });
      }
    }
  } catch (error) {
    console.error('[Engagement] Error updating challenge progress:', error);
  }
}

async function updateStreaks(driver_id) {
  try {
    const result = await pool.query(
      'SELECT streak_days, last_charging_at FROM leaderboard WHERE driver_id = $1',
      [driver_id]
    );

    if (result.rows.length === 0) return;

    const { streak_days, last_charging_at } = result.rows[0];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let new_streak = streak_days || 0;

    if (!last_charging_at) {
      new_streak = 1;
    } else {
      const lastDate = new Date(last_charging_at);
      const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
      const diffTime = today - lastDay;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        new_streak += 1;
      } else if (diffDays > 1) {
        new_streak = 1;
      }
    }

    await pool.query(
      'UPDATE leaderboard SET streak_days = $1, last_charging_at = $2 WHERE driver_id = $3',
      [new_streak, now, driver_id]
    );

    // Update challenge progress for streaks
    await updateChallengeProgress(driver_id, 'charging_streak');

    // Plug & Charge Pro Achievement (7-day streak)
    if (new_streak >= 7) {
      const achievement = await pool.query('SELECT id FROM achievements WHERE name = \'Plug & Charge Pro\'');
      if (achievement.rows.length > 0) {
        await awardAchievement(driver_id, achievement.rows[0].id);
      }
    }
  } catch (error) {
    console.error('[Engagement] Error updating streaks:', error);
  }
}

async function checkV2GAchievements(driver_id, iso, sessionId) {
  try {
    // Scarcity Savior check
    if (iso) await checkScarcitySaviorAchievement(driver_id, iso, sessionId);

    // 1. Grid Guardian (1 participation)
    const ggAchievement = await pool.query('SELECT id FROM achievements WHERE name = \'Grid Guardian\'');
    if (ggAchievement.rows.length > 0) {
      await awardAchievement(driver_id, ggAchievement.rows[0].id);
    }

    // 2. VPP Hero (10 participations)
    const v2gCountRes = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE LOWER(TRIM(metadata->>'protocol')) = 'ocpp2.1') as ocpp21_count
      FROM driver_actions
      WHERE driver_id = $1 AND action_type = 'v2g_discharge'
    `, [driver_id]);

    const v2gCount = parseInt(v2gCountRes.rows[0]?.total || '0');
    const ocpp21Count = parseInt(v2gCountRes.rows[0]?.ocpp21_count || '0');

    if (v2gCount >= 10) {
      const heroAchievement = await pool.query('SELECT id FROM achievements WHERE name = \'VPP Hero\'');
      if (heroAchievement.rows.length > 0) {
        await awardAchievement(driver_id, heroAchievement.rows[0].id);
      }
    }

    // 3. V2X Pioneer (1 participation via OCPP 2.1)
    if (ocpp21Count >= 1) {
      const pioneerAchievement = await pool.query('SELECT id FROM achievements WHERE name = \'V2X Pioneer\'');
      if (pioneerAchievement.rows.length > 0) {
        await awardAchievement(driver_id, pioneerAchievement.rows[0].id);
      }
    }
  } catch (error) {
    console.error('[Engagement] Error checking V2G achievements:', error);
  }
}

async function checkGridWarriorAchievement(driver_id) {
  const count = await pool.query(`
    SELECT COUNT(*) FROM driver_actions
    WHERE driver_id = $1 AND action_type = 'grid_response'
  `, [driver_id]);

  if (parseInt(count.rows[0].count) >= 5) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Grid Warrior'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkMLContributorAchievement(driver_id) {
  // Requirement: 5 consecutive low-variance sessions (<5%)
  const result = await pool.query(`
    WITH recent_sessions AS (
      SELECT (metadata->>'isLowVariance')::boolean as is_low_variance,
             (metadata->>'physics_score')::float as physics_score
      FROM driver_actions
      WHERE driver_id = $1 AND action_type = 'session_completed'
      ORDER BY created_at DESC
      LIMIT 5
    )
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE is_low_variance = true AND physics_score > 0.66) as low_variance_count
    FROM recent_sessions
  `, [driver_id]);

  const { total, low_variance_count } = result.rows[0];

  if (parseInt(total) >= 5 && parseInt(low_variance_count) === 5) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'ML Contributor'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkEnergyArchitectAchievement(driver_id) {
  // Requirement: 10 consecutive low-variance sessions (<5%)
  // We check the last 10 'session_completed' actions and ensure they all have isLowVariance = true in metadata.
  const result = await pool.query(`
    WITH recent_sessions AS (
      SELECT (metadata->>'isLowVariance')::boolean as is_low_variance,
             (metadata->>'physics_score')::float as physics_score
      FROM driver_actions
      WHERE driver_id = $1 AND action_type = 'session_completed'
      ORDER BY created_at DESC
      LIMIT 10
    )
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE is_low_variance = true AND physics_score > 0.66) as low_variance_count
    FROM recent_sessions
  `, [driver_id]);

  const { total, low_variance_count } = result.rows[0];

  if (parseInt(total) >= 10 && parseInt(low_variance_count) === 10) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Energy Architect'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkSustainabilityChampion(driver_id) {
  // 100% Compliance Check: Verify at least one valid session for each of the last 30 consecutive days.
  // This enforces the "Green Audit" (<15% variance) via the L1-verified 'is_valid' flag.
  // Performance Optimization: Use a filtered subquery for charging_sessions to minimize join overhead.
  const result = await pool.query(`
    WITH RECURSIVE dates AS (
        SELECT CURRENT_DATE - INTERVAL '29 days' as day
        UNION ALL
        SELECT day + INTERVAL '1 day' FROM dates WHERE day < CURRENT_DATE
    ),
    recent_sessions AS (
        SELECT DATE_TRUNC('day', start_time) as session_day, is_valid
        FROM charging_sessions
        WHERE driver_id = $1 AND start_time >= CURRENT_DATE - INTERVAL '30 days'
    ),
    daily_compliance AS (
        SELECT
            d.day,
            COUNT(rs.session_day) as session_count,
            COALESCE(BOOL_AND(rs.is_valid), false) as all_valid
        FROM dates d
        LEFT JOIN recent_sessions rs ON rs.session_day = d.day
        GROUP BY d.day
    )
    SELECT
        COUNT(*) as compliant_days
    FROM daily_compliance
    WHERE session_count > 0 AND all_valid = true
  `, [driver_id]);

  if (result.rows.length > 0) {
    const { compliant_days } = result.rows[0];

    // Achievement requires 30 distinct, consecutive days of valid charging
    if (parseInt(compliant_days) >= 30) {
      const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Sustainability Champion'");
      if (achievement.rows.length > 0) {
        await awardAchievement(driver_id, achievement.rows[0].id);
      }
    }
  }
}

async function checkPlugAndChargeAchievement(driver_id) {
  const driver = await pool.query('SELECT is_plug_and_charge_ready FROM drivers WHERE id = $1', [driver_id]);
  if (driver.rows.length > 0 && driver.rows[0].is_plug_and_charge_ready === true) {
    const achievement = await pool.query('SELECT id FROM achievements WHERE name = \'Plug & Charge Ready\'');
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function awardAchievement(driver_id, achievement_id) {
  try {
    // 1. Check if already earned
    const existing = await pool.query(
      'SELECT id FROM driver_achievements WHERE driver_id = $1 AND achievement_id = $2',
      [driver_id, achievement_id]
    );

    if (existing.rows.length > 0) return 0;

    // 2. Award achievement
    await pool.query(
      'INSERT INTO driver_achievements (driver_id, achievement_id) VALUES ($1, $2)',
      [driver_id, achievement_id]
    );

    // 3. Get points
    const achievement = await pool.query('SELECT name, points FROM achievements WHERE id = $1', [achievement_id]);
    const points = achievement.rows[0]?.points || 0;
    const name = achievement.rows[0]?.name;

    // 4. Update leaderboard
    await updateLeaderboardPoints(driver_id, points);

    // 5. Emit Kafka message for L10 Token Engine
    const driverData = await pool.query('SELECT f.iso FROM drivers d JOIN fleets f ON d.fleet_id = f.id WHERE d.id = $1', [driver_id]);
    const iso = driverData.rows[0]?.iso || 'CAISO';

    await producer.send({
      topic: 'driver_actions',
      messages: [{
        value: JSON.stringify({
          driver_id,
          action_type: 'achievement_unlocked',
          achievement_name: name,
          source_value: points,
          event_id: achievement_id,
          iso: iso
        })
      }]
    });

    console.log(`[Engagement] Achievement '${name}' awarded to driver ${driver_id}. L10 notified.`);

    // 6. Emit Engagement Notification for L5 Driver Experience
    const achievementData = await pool.query('SELECT icon FROM achievements WHERE id = $1', [achievement_id]);
    const icon = achievementData.rows[0]?.icon;

    const notification = {
      driver_id,
      type: 'achievement_unlocked',
      title: 'Achievement Unlocked! 🏆',
      body: `You've earned the '${name}' badge and ${points} points!`,
      data: { achievement_id, name, points, icon }
    };

    await producer.send({
      topic: 'engagement_notifications',
      messages: [{ key: driver_id, value: JSON.stringify(notification) }]
    });

    // WebSocket Real-time Push
    io.to(`driver:${driver_id}`).emit('notification', notification);

    return points;
  } catch (error) {
    console.error('[Engagement] Error awarding achievement:', error);
    throw error;
  }
}

async function updateLeaderboardPoints(driver_id, points) {
  await pool.query(`
    INSERT INTO leaderboard (driver_id, fleet_id, total_points)
    SELECT $1, d.fleet_id, $2
    FROM drivers d WHERE d.id = $1
    ON CONFLICT (driver_id)
    DO UPDATE SET total_points = leaderboard.total_points + $2,
                  updated_at = NOW()
  `, [driver_id, points]);

  await recalculateRanks();

  // Broadcast updated leaderboard via WebSockets
  const topPlayers = await pool.query(`
    SELECT l.rank, l.total_points, d.first_name, d.last_name
    FROM leaderboard l JOIN drivers d ON l.driver_id = d.id
    ORDER BY l.rank ASC LIMIT 10
  `);
  io.emit('leaderboard_update', topPlayers.rows);
}

async function recalculateRanks() {
  // Optimized: Only update and return drivers whose rank has actually changed
  const result = await pool.query(`
    WITH ranked AS (
      SELECT driver_id,
             ROW_NUMBER() OVER (ORDER BY total_points DESC) as new_rank
      FROM leaderboard
    )
    UPDATE leaderboard l
    SET rank = r.new_rank, updated_at = NOW()
    FROM ranked r
    WHERE l.driver_id = r.driver_id AND (l.rank IS DISTINCT FROM r.new_rank)
    RETURNING l.driver_id, l.rank, r.new_rank, (l.rank - r.new_rank) as rank_delta
  `);

  // Phase 5 Optimization: Notify only for Top 10 or significant jumps (>= 5 positions)
  for (const row of result.rows) {
    if (row.new_rank <= 10 || Math.abs(row.rank_delta) >= 5) {
      io.to(`driver:${row.driver_id}`).emit('notification', {
        type: 'rank_change',
        title: 'Rank Updated! 📈',
        body: `Your new rank on the leaderboard is #${row.new_rank}.`,
        data: {
          rank: row.new_rank,
          previous_rank: row.new_rank + row.rank_delta,
          delta: row.rank_delta
        }
      });
    }
  }

  // Broadcast top 10 change to everyone if any of the top 10 changed
  const topTenChanged = result.rows.some(row => row.rank <= 10);
  if (topTenChanged) {
    const topPlayers = await pool.query(`
      SELECT l.rank, l.total_points, d.first_name, d.last_name
      FROM leaderboard l JOIN drivers d ON l.driver_id = d.id
      ORDER BY l.rank ASC LIMIT 10
    `);
    io.emit('leaderboard_update', topPlayers.rows);
  }
}

// Start server
async function start() {
  try {
    await redisClient.connect();
    console.log('✅ [Engagement Engine] Connected to Redis');

    server.listen(port, () => {
      console.log(`[Engagement Engine] Running on port ${port}`);
      console.log('[Engagement Engine] Features: Leaderboards, Achievements, WebSockets');
    });
  } catch (err) {
    console.error('❌ [Engagement Engine] Startup error:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Engagement Engine] Shutting down gracefully...');
  await consumer.disconnect();
  await producer.disconnect();
  await redisClient.quit();
  pool.end();
  process.exit(0);
});

module.exports = { app, server, pool, redisClient };
