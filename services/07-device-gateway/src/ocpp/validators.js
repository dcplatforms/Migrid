const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

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

const statusNotificationSchema = {
  type: 'object',
  properties: {
    timestamp: { type: 'string' },
    connectorStatus: { type: 'string' },
    evseId: { type: 'integer' },
    connectorId: { type: 'integer' },
  },
  required: ['timestamp', 'connectorStatus', 'evseId', 'connectorId'],
};

// V2X Profile Schema (Simplified for 2.1)
const v2xProfileSchema = {
    type: 'object',
    properties: {
        evseId: { type: 'integer' },
        chargingProfile: {
            type: 'object',
            properties: {
                chargingProfilePurpose: { enum: ['V2XProfile', 'TxProfile'] }
            }
        }
    }
};

const validators = {
    'ocpp2.0.1': {
        'BootNotification': ajv.compile(bootNotificationSchema),
        'MeterValues': ajv.compile(meterValuesSchema),
        'StatusNotification': ajv.compile(statusNotificationSchema)
    },
    'ocpp2.1': {
        'BootNotification': ajv.compile(bootNotificationSchema), // Reusing for demo
        'MeterValues': ajv.compile(meterValuesSchema),
        'StatusNotification': ajv.compile(statusNotificationSchema),
        'SetChargingProfile': ajv.compile(v2xProfileSchema)
    }
};

function validateSchema(protocol, action, payload) {
    const protocolValidators = validators[protocol] || validators['ocpp2.0.1'];
    const validate = protocolValidators[action];

    if (!validate) {
        // Fallback or ignore if no validator exists for this action
        return true;
    }

    const isValid = validate(payload);
    if (!isValid) {
        console.error(`❌ [L7] Validation failed for ${protocol}/${action}:`, validate.errors);
    }
    return isValid;
}

module.exports = {
  validateSchema
};
