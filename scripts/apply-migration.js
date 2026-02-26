const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgres://migrid:dev_password_123@localhost:5432/migrid_core';

async function applyMigration() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to database');

    const migrationFile = path.join(__dirname, 'migrations', '004_physics_engine_updates.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Applying migration 004_physics_engine_updates.sql...');
    await client.query(sql);
    console.log('Migration applied successfully');

  } catch (err) {
    console.error('Error applying migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
