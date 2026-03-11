const Ajv = require('ajv');
const ajv = new Ajv();

const bootNotificationSchema = {
  type: 'object',
  properties: {
    chargerModel: { type: 'string' },
    chargerVendor: { type: 'string' },
  },
  required: ['chargerModel', 'chargerVendor'],
};

const meterValuesSchema = {
  type: 'object',
  properties: {
    evseId: { type: 'integer' },
    meterValue: { type: 'array' },
  },
  required: ['evseId', 'meterValue'],
};

module.exports = {
  validateBootNotification: ajv.compile(bootNotificationSchema),
  validateMeterValues: ajv.compile(meterValuesSchema),
};
