const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  pool,
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_in_production',
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  port: process.env.PORT || 3009,
};
