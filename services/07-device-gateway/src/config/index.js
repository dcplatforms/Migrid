require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3007,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  jwtSecret: process.env.JWT_SECRET || 'secret',
  bessSafetyMinSoc: 20.0,
  heartbeatInterval: 5000,
};
