const axios = require('axios');

/**
 * GridStatusClient
 * Integration with gridstatus.io API for high-fidelity grid and market data.
 */
class GridStatusClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.gridstatus.io/v1';
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-api-key': this.apiKey
      }
    });
  }

  /**
   * Helper to query a dataset
   */
  async queryDataset(datasetId, params = {}) {
    try {
      const response = await this.client.get(`/datasets/${datasetId}/query`, {
        params: {
          ...params,
          limit: params.limit || 100
        }
      });
      return response.data.data;
    } catch (error) {
      console.error(`[GridStatusClient] Error querying dataset ${datasetId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetches latest LMP for specific ISO and location (hub)
   */
  async getLatestLMP(iso, location) {
    const datasetMap = {
      'CAISO': 'caiso_standard_lmp_rtm',
      'PJM': 'pjm_standard_lmp_rtm',
      'ERCOT': 'ercot_standard_lmp_rtm'
    };

    const datasetId = datasetMap[iso.toUpperCase()];
    if (!datasetId) throw new Error(`LMP dataset not mapped for ISO: ${iso}`);

    return this.queryDataset(datasetId, {
      filter_column: 'location',
      filter_value: location,
      order: 'desc',
      limit: 10
    });
  }

  /**
   * Fetches Day-Ahead Load Forecast
   */
  async getLoadForecast(iso) {
    const datasetMap = {
      'CAISO': 'caiso_load_forecast',
      'PJM': 'pjm_load_forecast',
      'ERCOT': 'ercot_load_forecast'
    };

    const datasetId = datasetMap[iso.toUpperCase()];
    if (!datasetId) throw new Error(`Load Forecast dataset not mapped for ISO: ${iso}`);

    return this.queryDataset(datasetId, {
      order: 'desc',
      limit: 50
    });
  }

  /**
   * Fetches latest Fuel Mix (Carbon Intensity)
   */
  async getFuelMix(iso) {
    const datasetMap = {
      'CAISO': 'caiso_fuel_mix',
      'PJM': 'pjm_fuel_mix',
      'ERCOT': 'ercot_fuel_mix'
    };

    const datasetId = datasetMap[iso.toUpperCase()];
    if (!datasetId) throw new Error(`Fuel Mix dataset not mapped for ISO: ${iso}`);

    return this.queryDataset(datasetId, {
      order: 'desc',
      limit: 50
    });
  }

  /**
   * Fetches Net Load data (Actual vs Forecast)
   */
  async getNetLoad(iso) {
    // CAISO specifically has a net load dataset
    if (iso.toUpperCase() === 'CAISO') {
      return this.queryDataset('caiso_net_load_rtm', {
        order: 'desc',
        limit: 50
      });
    }

    // For others, we might need to derive it or use system load
    // For now, return load forecast as a fallback if net load isn't explicitly available
    return this.getLoadForecast(iso);
  }

  /**
   * Fetches Day-Ahead Market Prices for Arbitrage analysis
   */
  async getDayAheadPrices(iso, location) {
    const datasetMap = {
      'CAISO': 'caiso_standard_lmp_dam',
      'PJM': 'pjm_standard_lmp_dam',
      'ERCOT': 'ercot_standard_lmp_dam'
    };

    const datasetId = datasetMap[iso.toUpperCase()];
    if (!datasetId) throw new Error(`DAM dataset not mapped for ISO: ${iso}`);

    return this.queryDataset(datasetId, {
      filter_column: 'location',
      filter_value: location,
      order: 'desc',
      limit: 48 // 2 days of hourly data
    });
  }
}

module.exports = GridStatusClient;
