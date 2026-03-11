/**
 * L6: Engagement Engine
 * Gamification, leaderboards, achievements, and driver engagement
 */

const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
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

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

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
  await consumer.subscribe({ topics: ['charging_events', 'SESSION_COMPLETED', 'vpp_participation_updates'], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        console.log(`[Engagement] Received message from ${topic}:`, payload);

        if (topic === 'SESSION_COMPLETED' || topic === 'charging_events') {
          await processChargingEvent(payload);
        } else if (topic === 'vpp_participation_updates') {
          // Handle specific driver updates like Plug & Charge Ready if surfaced here
          // Or we can poll/check driver status periodically
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
    version: '5.0.0',
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

// Get active challenges
app.get('/challenges/active', authenticateToken, async (req, res) => {
  const challenges = [
    {
      id: 'week-warrior',
      name: 'Week Warrior',
      description: 'Charge off-peak 7 consecutive days',
      reward_tokens: 250,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      progress_current: 0,
      progress_required: 7
    },
    {
      id: 'grid-guardian',
      name: 'Grid Guardian',
      description: 'Participate in 5 V2G events this month',
      reward_tokens: 500,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      progress_current: 0,
      progress_required: 5
    }
  ];

  res.json({ challenges });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function processChargingEvent(event) {
  const driverId = event.driverId || event.driver_id;
  const sessionId = event.sessionId || event.session_id;

  // Verify Physics Integrity before awarding points
  if (sessionId) {
    const session = await pool.query('SELECT is_valid FROM charging_sessions WHERE id = $1', [sessionId]);
    if (session.rows.length > 0 && session.rows[0].is_valid === false) {
      console.warn(`[Engagement] Session ${sessionId} rejected for scoring due to Physics Violation.`);
      return;
    }
  }

  if (event.type === 'session_completed' || event.energyDispensedKwh) {
    await checkFirstSessionAchievement(driverId);

    // Award Green Driver Score points (Example: 10 points per kWh if valid)
    if (event.energyDispensedKwh) {
      const points = Math.floor(parseFloat(event.energyDispensedKwh) * 10);
      await updateLeaderboardPoints(driverId, points);
    }
  }

  if (event.type === 'v2g_discharge') {
    await checkV2GAchievements(driverId);
  }

  // Periodic check for Plug & Charge Ready status
  await checkPlugAndChargeAchievement(driverId);
}

async function checkFirstSessionAchievement(driver_id) {
  const count = await pool.query(`
    SELECT COUNT(*) FROM charging_sessions WHERE driver_id = $1
  `, [driver_id]);

  if (parseInt(count.rows[0].count) === 1) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Early Adopter'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkV2GAchievements(driver_id) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Grid Guardian'");
    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
}

async function checkPlugAndChargeAchievement(driver_id) {
  const driver = await pool.query('SELECT is_plug_and_charge_ready FROM drivers WHERE id = $1', [driver_id]);
  if (driver.rows.length > 0 && driver.rows[0].is_plug_and_charge_ready === true) {
    const achievement = await pool.query("SELECT id FROM achievements WHERE name = 'Plug & Charge Ready'");
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
    await producer.send({
      topic: 'driver_actions',
      messages: [{
        value: JSON.stringify({
          driver_id,
          action_type: 'achievement_unlocked',
          achievement_name: name,
          source_value: points,
          event_id: achievement_id
        })
      }]
    });

    console.log(`[Engagement] Achievement '${name}' awarded to driver ${driver_id}. L10 notified.`);
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
  await pool.query(`
    WITH ranked AS (
      SELECT driver_id,
             ROW_NUMBER() OVER (ORDER BY total_points DESC) as new_rank
      FROM leaderboard
    )
    UPDATE leaderboard l
    SET rank = r.new_rank, updated_at = NOW()
    FROM ranked r
    WHERE l.driver_id = r.driver_id
  `);
}

// Start server
server.listen(port, () => {
  console.log(`[Engagement Engine] Running on port ${port}`);
  console.log('[Engagement Engine] Features: Leaderboards, Achievements, WebSockets');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Engagement Engine] Shutting down gracefully...');
  await consumer.disconnect();
  await producer.disconnect();
  pool.end();
  process.exit(0);
});

module.exports = { app, server, pool };
