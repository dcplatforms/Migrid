const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Pre-load and compile schemas on startup for operational capacity
const schemaDir = path.join(__dirname, 'schemas');
let schemaFiles = [];
try {
    schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json'));
} catch (e) {
    console.warn('⚠️ [L7] Could not read schemas directory:', e.message);
}

const validators = {
    'ocpp2.1': {},
    'ocpp2.0.1': {} // Legacy fallbacks
};

console.log('🚀 [L7] Compiling OCPP 2.1 schemas...');
schemaFiles.forEach(file => {
    try {
        const action = path.basename(file, '.json');
        const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
        validators['ocpp2.1'][action] = ajv.compile(schema);
    } catch (e) {
        console.error(`❌ [L7] Failed to compile schema ${file}:`, e.message);
    }
});

// Mock legacy validators for 2.0.1 (simplified for this exercise)
const legacySchema = { type: 'object' };
const compileLegacy = () => ajv.compile(legacySchema);
validators['ocpp2.0.1'] = {
    'BootNotification': compileLegacy(),
    'MeterValues': compileLegacy(),
    'StatusNotification': compileLegacy(),
    'TransactionEvent': compileLegacy(),
    'SignCertificate': compileLegacy(),
    'Get15118EvCertificate': compileLegacy()
};

function validateSchema(protocol, action, payload) {
    const protocolValidators = validators[protocol] || validators['ocpp2.0.1'];
    if (!protocolValidators) {
        console.warn(`⚠️ [L7] No validators for protocol ${protocol}`);
        return true;
    }

    const validate = protocolValidators[action];
    if (!validate) {
        // If we don't have a specific validator, log warning but allow (don't block the field)
        console.warn(`⚠️ [L7] No specific validator for ${protocol}/${action}. Allowing by default.`);
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
