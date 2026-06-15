'use strict';

// Provider interface spec and validator.
// Each provider module must export an object matching this contract.

const PROVIDER_INTERFACE = {
    required: ['id', 'name', 'version', 'check', 'scan'],
    description: {
        id: 'unique provider id, e.g. "provider:gitnexus"',
        name: 'human-readable display name',
        version: 'string version',
        check: 'function() → boolean — true if provider is available in this environment',
        scan: 'function(root, nativeIR) → { modules?, files?, edges?, flows?, confidence? }',
    },
};

function validateProvider(p) {
    if (!p || typeof p !== 'object') return { valid: false, error: 'not an object' };
    for (const key of PROVIDER_INTERFACE.required) {
        if (!(key in p)) return { valid: false, error: `missing required field: ${key}` };
    }
    if (typeof p.check !== 'function') return { valid: false, error: 'check must be a function' };
    if (typeof p.scan !== 'function') return { valid: false, error: 'scan must be a function' };
    return { valid: true };
}

module.exports = { PROVIDER_INTERFACE, validateProvider };
