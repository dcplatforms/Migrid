const Decimal = require('decimal.js');
const Tariff = require('../models/Tariff');
const MarketRateService = require('./MarketRateService');

class TariffService {
  async calculateCurrentRate(tariff, sessionTime, iso = 'CAISO') {
    if (!tariff) return new Decimal(0);

    const type = tariff.tariff_type || 'FIXED';

    switch (type) {
      case 'FIXED':
        return new Decimal(tariff.base_rate_kwh);

      case 'TOU':
        return await this._calculateTOURate(tariff, sessionTime);

      case 'DYNAMIC':
        return this._calculateDynamicRate(tariff, iso);

      default:
        return new Decimal(tariff.base_rate_kwh);
    }
  }

  async _calculateTOURate(tariff, sessionTime) {
    const timeBlocks = await Tariff.getTimeBlocks(tariff.id);
    const timeStr = sessionTime.toTimeString().split(' ')[0]; // HH:MM:SS
    const dayOfWeek = sessionTime.getDay();

    const activeBlock = timeBlocks.find(block => {
      const isDayMatch = block.day_of_week === null || block.day_of_week === dayOfWeek;

      let isTimeMatch;
      if (block.start_time <= block.end_time) {
        // Standard block (e.g., 09:00 - 17:00)
        isTimeMatch = timeStr >= block.start_time && timeStr <= block.end_time;
      } else {
        // Over-midnight block (e.g., 22:00 - 06:00)
        isTimeMatch = timeStr >= block.start_time || timeStr <= block.end_time;
      }

      return isDayMatch && isTimeMatch;
    });

    return activeBlock ? new Decimal(activeBlock.rate_kwh) : new Decimal(tariff.base_rate_kwh);
  }

  _calculateDynamicRate(tariff, iso) {
    const marketPriceMWh = MarketRateService.getLatestRate(iso);
    if (marketPriceMWh === null) {
      // Fallback to base rate if market price is unavailable
      return new Decimal(tariff.base_rate_kwh);
    }

    // Convert MWh to kWh
    const marketPriceKWh = new Decimal(marketPriceMWh).dividedBy(1000);
    const margin = new Decimal(tariff.margin_per_kwh || 0);

    return marketPriceKWh.plus(margin);
  }
}

module.exports = new TariffService();
