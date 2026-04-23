const GridStatusClient = require('./GridStatusClient');
const MarketPricingService = require('./MarketPricingService');
const { createClient } = require('redis');
const { Kafka } = require('kafkajs');
const Decimal = require('decimal.js');

/**
 * GridStatusSyncWorker
 * Proactively syncs data from Grid Status API to Postgres and Redis.
 * Also implements Solar Ramp Detection for CAISO.
 */
class GridStatusSyncWorker {
  constructor(pool, apiKey, kafkaBrokers, redisUrl) {
    this.pool = pool;
    this.pricingService = new MarketPricingService(pool);
    this.client = new GridStatusClient(apiKey);
    this.redisClient = createClient({ url: redisUrl });

    const kafka = new Kafka({
      clientId: 'grid-status-sync-worker',
      brokers: kafkaBrokers.split(',')
    });
    this.producer = kafka.producer();

    this.hubs = {
      'CAISO': ['TH_NP15', 'TH_SP15', 'TH_ZP26'],
      'PJM': ['PJM WH HUB'],
      'ERCOT': ['HB_NORTH', 'HB_WEST']
    };
  }

  async start() {
    await this.redisClient.connect();
    await this.producer.connect();
    console.log('✅ [GridStatusSyncWorker] Connected to Redis and Kafka');

    // Run initial sync and wait for it to complete to ensure data readiness
    console.log('[GridStatusSyncWorker] Performing initial data sync...');
    await this.syncAll();
    console.log('[GridStatusSyncWorker] Initial sync complete.');

    // Schedule periodic sync (every 5 minutes)
    setInterval(() => this.syncAll(), 5 * 60 * 1000);
  }

  async syncAll() {
    console.log(`[GridStatusSyncWorker] Starting sync cycle: ${new Date().toISOString()}`);

    for (const iso of Object.keys(this.hubs)) {
      try {
        await this.syncLMP(iso);
        await this.syncDAM(iso);
        await this.syncLoadForecast(iso);
        await this.syncFuelMix(iso);

        if (iso === 'CAISO') {
          await this.syncNetLoadAndDetectRamp(iso);
        }
      } catch (error) {
        console.error(`[GridStatusSyncWorker] Sync failed for ${iso}:`, error.message);
      }
    }
  }

  async syncLMP(iso) {
    for (const hub of this.hubs[iso]) {
      const data = await this.client.getLatestLMP(iso, hub);
      if (data && data.length > 0) {
        const latest = data[0];
        // Grid Status typically returns 'interval_start_utc'
        const timestamp = latest.interval_start_utc || latest.timestamp;
        const price = latest.lmp || latest.price;

        await this.pricingService.ingestPrice(iso, hub, price, new Date(timestamp));

        // Cache in Redis for sub-ms access
        await this.redisClient.setEx(`market:lmp:latest:${iso}:${hub}`, 600, JSON.stringify({
          price,
          timestamp,
          source: 'gridstatus.io'
        }));
      }
    }
  }

  async syncLoadForecast(iso) {
    const data = await this.client.getLoadForecast(iso);
    if (data && data.length > 0) {
      for (const record of data.slice(0, 24)) { // Take next 24 hours
        await this.pool.query(`
          INSERT INTO load_forecasts (iso, location, forecast_mw, forecast_timestamp, publish_time)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [
          iso,
          'SYSTEM_WIDE',
          record.load_forecast || record.forecast,
          new Date(record.interval_start_utc || record.timestamp),
          new Date(record.publish_time || new Date())
        ]);
      }

      // Update Redis context
      const latest = data[0];
      await this.redisClient.setEx(`market:load_forecast:latest:${iso}`, 600, JSON.stringify(latest));
    }
  }

  async syncDAM(iso) {
    for (const hub of this.hubs[iso]) {
      try {
        const data = await this.client.getDayAheadPrices(iso, hub);
        if (data && data.length > 0) {
          for (const record of data) {
            const timestamp = record.interval_start_utc || record.timestamp;
            const price = record.lmp || record.price;
            await this.pricingService.ingestPrice(iso, hub, price, new Date(timestamp));
          }
          console.log(`[GridStatusSyncWorker] Synced ${data.length} DAM records for ${iso}:${hub}`);
        }
      } catch (err) {
        console.warn(`[GridStatusSyncWorker] DAM sync failed for ${iso}:${hub}:`, err.message);
      }
    }
  }

  async syncFuelMix(iso) {
    const data = await this.client.getFuelMix(iso);
    if (data && data.length > 0) {
      let totalGen = new Decimal(0);
      let renewableGen = new Decimal(0);

      const timestamp = new Date(data[0].interval_start_utc || data[0].timestamp);

      for (const record of data) {
        // Simple heuristic for "renewable"
        const fuel = (record.fuel_type || record.fuel).toLowerCase();
        const gen = new Decimal(record.gen_mw || record.market_generation || 0);

        totalGen = totalGen.plus(gen);
        if (['solar', 'wind', 'hydro', 'geothermal', 'biomass'].includes(fuel)) {
          renewableGen = renewableGen.plus(gen);
        }

        await this.pool.query(`
          INSERT INTO fuel_mix (iso, fuel_type, gen_mw, timestamp)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [iso, fuel, gen.toString(), timestamp]);
      }

      const renewablePct = totalGen.gt(0) ? renewableGen.dividedBy(totalGen).toNumber() : 0;

      // Broadcast Grid Health to Layer 10
      await this.producer.send({
        topic: 'GRID_HEALTH_UPDATED',
        messages: [{
          value: JSON.stringify({
            iso,
            renewable_percentage: renewablePct,
            is_green: renewablePct > 0.6,
            timestamp: timestamp.toISOString()
          })
        }]
      });

      // Cache in Redis
      await this.redisClient.setEx(`market:grid_health:${iso}`, 600, JSON.stringify({
        renewable_percentage: renewablePct,
        timestamp: timestamp.toISOString()
      }));
    }
  }

  async syncNetLoadAndDetectRamp(iso) {
    const data = await this.client.getNetLoad(iso);
    if (data && data.length > 0) {
      for (const record of data.slice(0, 10)) {
        await this.pool.query(`
          INSERT INTO net_load (iso, actual_load_mw, net_load_mw, renewables_mw, timestamp)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [
          iso,
          record.actual_load,
          record.net_load,
          record.renewables,
          new Date(record.interval_start_utc || record.timestamp)
        ]);
      }

      // Duck Curve / Solar Ramp Detection
      // Logic: If net load is increasing by > 10% in the last 3 intervals (e.g. 15 mins)
      // AND it's between 15:00 and 20:00 local time, trigger Advance Charge.
      const latest = data[0];
      const previous = data[2]; // ~10-15 mins ago

      if (latest && previous) {
        const netLoadNow = new Decimal(latest.net_load);
        const netLoadPrev = new Decimal(previous.net_load);
        const rampRate = netLoadNow.minus(netLoadPrev).dividedBy(netLoadPrev);

        const nowLocal = new Date(latest.interval_start_local || latest.timestamp);
        const hour = nowLocal.getHours();

        if (rampRate.gt(0.1) && hour >= 15 && hour <= 20) {
          console.warn(`[GridStatusSyncWorker] 🦆 Solar Ramp Detected in ${iso}. Ramp: ${rampRate.times(100).toFixed(2)}%. Triggering Advance Charge.`);

          await this.producer.send({
            topic: 'ADVANCE_CHARGE_SIGNAL',
            messages: [{
              value: JSON.stringify({
                iso,
                reason: 'SOLAR_RAMP_DETECTED',
                ramp_rate: rampRate.toNumber(),
                net_load_mw: latest.net_load,
                timestamp: new Date().toISOString()
              })
            }]
          });
        }
      }
    }
  }
}

module.exports = GridStatusSyncWorker;
