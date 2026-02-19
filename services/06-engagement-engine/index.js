/**
 * L6: Engagement Engine
 * Gamification, leaderboards, achievements, and driver engagement
 */

const express = require('express');
const { Pool } = require('pg');
const kafka = require('kafka-node');
const jwt = require('jsonwebtoken');

const app = express();
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

// Kafka consumer for charging events
let kafkaClient, consumer;
if (process.env.KAFKA_BROKERS) {
  kafkaClient = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_BROKERS });
  consumer = new kafka.Consumer(
    kafkaClient,
    [{ topic: 'charging_events', partition: 0 }],
    { autoCommit: true }
  );

  consumer.on('message', async (message) => {
    try {
      const event = JSON.parse(message.value);
      await processChargingEvent(event);
    } catch (error) {
      console.error('[Engagement] Error processing event:', error);
    }
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'engagement-engine',
    version: '4.1.0',
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
    const query = `
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
      WHERE l.fleet_id = $1
      ORDER BY l.rank ASC LIMIT ${parseInt(limit)}
    `;

    const result = await pool.query(query, [fleet_id]);

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

  // IDOR check: Drivers can only award achievements to themselves (or this should be an internal service call)
  if (driver_id !== req.user.driver_id.toString()) {
    return res.status(403).json({ error: 'Unauthorized to award achievements to other drivers' });
  }

  try {
    // Check if already earned
    const existing = await pool.query(`
      SELECT id FROM driver_achievements
      WHERE driver_id = $1 AND achievement_id = $2
    `, [driver_id, achievement_id]);

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Achievement already earned' });
    }

    // Award achievement
    await pool.query(`
      INSERT INTO driver_achievements (driver_id, achievement_id)
      VALUES ($1, $2)
    `, [driver_id, achievement_id]);

    // Get achievement details for points
    const achievement = await pool.query(`
      SELECT points FROM achievements WHERE id = $1
    `, [achievement_id]);

    const points = achievement.rows[0]?.points || 0;

    // Update leaderboard
    await pool.query(`
      INSERT INTO leaderboard (driver_id, fleet_id, total_points)
      SELECT $1, d.fleet_id, $2
      FROM drivers d WHERE d.id = $1
      ON CONFLICT (driver_id)
      DO UPDATE SET total_points = leaderboard.total_points + $2,
                    updated_at = NOW()
    `, [driver_id, points]);

    // Recalculate ranks
    await recalculateRanks();

    res.json({
      success: true,
      message: 'Achievement awarded',
      points_earned: points
    });
  } catch (error) {
    console.error('[Engagement Error]', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// ============================================================================
// CHALLENGES ENDPOINTS
// ============================================================================

// Get active challenges
app.get('/challenges/active', authenticateToken, async (req, res) => {
  // Hardcoded challenges for demo
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
  console.log('[Engagement] Processing event:', event.type);

  // Check for achievement triggers
  if (event.type === 'session_completed') {
    await checkFirstSessionAchievement(event.driver_id);
    await checkOffPeakStreakAchievement(event.driver_id);
  }

  if (event.type === 'v2g_discharge') {
    await checkV2GAchievements(event.driver_id);
  }
}

async function checkFirstSessionAchievement(driver_id) {
  const count = await pool.query(`
    SELECT COUNT(*) FROM charging_sessions WHERE driver_id = $1
  `, [driver_id]);

  if (parseInt(count.rows[0].count) === 1) {
    // Award "Early Adopter" achievement
    const achievement = await pool.query(`
      SELECT id FROM achievements WHERE name = 'Early Adopter'
    `);

    if (achievement.rows.length > 0) {
      await awardAchievement(driver_id, achievement.rows[0].id);
    }
  }
}

async function checkOffPeakStreakAchievement(driver_id) {
  // Simplified: Check for 30-day streak
  // In production, implement proper streak tracking
}

async function checkV2GAchievements(driver_id) {
  // Check for V2G participation milestones
}

async function awardAchievement(driver_id, achievement_id) {
  try {
    await pool.query(`
      INSERT INTO driver_achievements (driver_id, achievement_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [driver_id, achievement_id]);
    console.log(`[Engagement] Achievement awarded to driver ${driver_id}`);
  } catch (error) {
    console.error('[Engagement] Error awarding achievement:', error);
  }
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
app.listen(port, () => {
  console.log(`[Engagement Engine] Running on port ${port}`);
  console.log('[Engagement Engine] Features: Leaderboards, Achievements, Challenges');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Engagement Engine] Shutting down gracefully...');
  if (consumer) consumer.close();
  if (kafkaClient) kafkaClient.close();
  pool.end();
  process.exit(0);
});
