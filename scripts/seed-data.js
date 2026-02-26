/**
 * Seed Script for MiGrid Platform
 * Creates demo data for all layers
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://migrid:dev_password_123@localhost:5432/migrid_core'
});

async function seed() {
  console.log('🌱 Seeding MiGrid database...\n');

  try {
    // Fleet
    console.log('Creating demo fleet...');
    const fleet = await pool.query(`
      INSERT INTO fleets (name, organization, contact_email, grid_connection_limit_kw)
      VALUES ('Green Transport Co', 'GreenCorp Inc', 'fleet@greentransport.com', 500)
      RETURNING id
    `);
    const fleetId = fleet.rows[0].id;
    console.log(`✓ Fleet created: ${fleetId}`);

    // Drivers
    console.log('\nCreating demo drivers...');
    const bcrypt = require('bcrypt');
    const demoPassword = await bcrypt.hash('demo123', 10);

    const drivers = await pool.query(`
      INSERT INTO drivers (fleet_id, email, password_hash, first_name, last_name)
      VALUES
        ($1, 'alice@demo.com', $2, 'Alice', 'Johnson'),
        ($1, 'bob@demo.com', $2, 'Bob', 'Smith'),
        ($1, 'carol@demo.com', $2, 'Carol', 'Williams')
      RETURNING id, email
    `, [fleetId, demoPassword]);
    console.log(`✓ Created ${drivers.rows.length} drivers`);

    // Create wallets for drivers
    for (const driver of drivers.rows) {
      await pool.query(`
        INSERT INTO driver_wallets (driver_id, escrow_balance)
        VALUES ($1, 100)
      `, [driver.id]);
    }
    console.log('✓ Created driver wallets with 100 token balance');

    // Vehicles
    console.log('\nCreating demo vehicles...');
    const vehicles = await pool.query(`
      INSERT INTO vehicles (fleet_id, driver_id, make, model, year, vin, battery_capacity_kwh, current_soc, v2g_enabled)
      VALUES
        ($1, $2, 'Ford', 'F-150 Lightning', 2024, '1FTFW1E84PFA00001', 131, 85.0, true),
        ($1, $3, 'Rivian', 'R1T', 2024, '7SAYGDEE0PA000002', 135, 72.0, true),
        ($1, $4, 'Tesla', 'Semi', 2024, '5YJ3E1EB0PF000003', 500, 90.0, false)
      RETURNING id, make, model
    `, [fleetId, drivers.rows[0].id, drivers.rows[1].id, drivers.rows[2].id]);
    console.log(`✓ Created ${vehicles.rows.length} vehicles`);

    // Register vehicles as VPP resources
    for (const vehicle of vehicles.rows) {
      const v = await pool.query('SELECT id, battery_capacity_kwh, v2g_enabled FROM vehicles WHERE id = $1', [vehicle.id]);
      await pool.query(`
        INSERT INTO vpp_resources (vehicle_id, battery_capacity_kwh, v2g_enabled)
        VALUES ($1, $2, $3)
      `, [vehicle.id, v.rows[0].battery_capacity_kwh, v.rows[0].v2g_enabled]);
    }
    console.log('✓ Registered vehicles as VPP resources');

    // Chargers
    console.log('\nCreating demo chargers...');
    const chargers = await pool.query(`
      INSERT INTO chargers (fleet_id, charger_id, name, location, max_power_kw, ocpp_version, status)
      VALUES
        ($1, 'CHG-001', 'North Depot - Bay 1', '123 Fleet St, Building A', 150, '2.0.1', 'available'),
        ($1, 'CHG-002', 'North Depot - Bay 2', '123 Fleet St, Building A', 150, '2.0.1', 'available'),
        ($1, 'CHG-003', 'South Depot - Bay 1', '456 Energy Ave, Building B', 350, '2.0.1', 'available')
      RETURNING id, name
    `, [fleetId]);
    console.log(`✓ Created ${chargers.rows.length} chargers`);

    // Historical charging sessions
    console.log('\nCreating historical charging sessions...');
    const now = new Date();
    for (let i = 0; i < 20; i++) {
      const startTime = new Date(now.getTime() - (i * 3 * 60 * 60 * 1000)); // Every 3 hours back
      const endTime = new Date(startTime.getTime() + (1.5 * 60 * 60 * 1000)); // 1.5 hour sessions
      const vehicle = vehicles.rows[i % vehicles.rows.length];
      const charger = chargers.rows[i % chargers.rows.length];
      const driver = drivers.rows[i % drivers.rows.length];

      const startSoc = 20 + Math.random() * 30;
      const endSoc = startSoc + 40 + Math.random() * 20;
      const energyDispensed = ((endSoc - startSoc) / 100) * 131; // Assuming avg 131 kWh battery

      await pool.query(`
        INSERT INTO charging_sessions
        (vehicle_id, charger_id, driver_id, start_time, end_time, start_soc, end_soc, energy_dispensed_kwh, variance_percentage, is_valid)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      `, [vehicle.id, charger.id, driver.id, startTime, endTime, startSoc, endSoc, energyDispensed, 5.2]);
    }
    console.log('✓ Created 20 historical charging sessions');

    // LMP Price data
    console.log('\nCreating LMP price data...');
    for (let i = 0; i < 24; i++) {
      const timestamp = new Date(now.getTime() - (i * 60 * 60 * 1000));
      const price = 25 + Math.random() * 100; // $25-125/MWh

      await pool.query(`
        INSERT INTO lmp_prices (iso, location, price_per_mwh, timestamp)
        VALUES ('CAISO', 'NP15', $1, $2)
      `, [price, timestamp]);
    }
    console.log('✓ Created 24 hours of LMP price data');

    // Leaderboard entries
    console.log('\nInitializing leaderboard...');
    for (let i = 0; i < drivers.rows.length; i++) {
      const driver = drivers.rows[i];
      const points = 1000 + Math.floor(Math.random() * 500);
      const greenScore = 75 + Math.random() * 25;

      await pool.query(`
        INSERT INTO leaderboard (driver_id, fleet_id, total_points, green_score, rank)
        VALUES ($1, $2, $3, $4, $5)
      `, [driver.id, fleetId, points, greenScore, i + 1]);
    }
    console.log('✓ Created leaderboard entries');

    console.log('\n✅ Database seeded successfully!');
    console.log('\n📊 Summary:');
    console.log('   • 1 Fleet');
    console.log(`   • ${drivers.rows.length} Drivers`);
    console.log(`   • ${vehicles.rows.length} Vehicles`);
    console.log(`   • ${chargers.rows.length} Chargers`);
    console.log('   • 20 Charging Sessions');
    console.log('   • 24 Hours of LMP Data');
    console.log('\n🔐 Demo Credentials:');
    console.log('   Email: alice@demo.com');
    console.log('   Password: demo123');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed();
