'use strict';

const crypto = require('crypto');

// factInputs keys whose arrays are sets, not sequences. Order must not matter.
// Frozen ARRAY (not a Set): Object.freeze(new Set()) does NOT block .add(),
// so the exported list is an array and the lookup structure stays module-private below.
const SET_KEYS = Object.freeze([
    'linkedFiles', 'notDonePlans', 'taskStatuses', 'linkedPlans',
]);
const SET_KEYS_LOOKUP = new Set(SET_KEYS);

// Only these keys are treated as paths. Blanket `\ -> /` on every string would
// silently rewrite prose, ids and shas that merely contain a backslash.
// Frozen ARRAY (not a Set): Object.freeze(new Set()) does NOT block .add(),
// so the exported list is an array and the lookup structure stays module-private below.
const PATH_KEYS = Object.freeze(['path', 'file', 'linkedFiles']);
const PATH_KEYS_LOOKUP = new Set(PATH_KEYS);

// Only these are normalized to UTC. `lastTouchedAt` arrives from
// `git log --format=%cI`, which keeps the committer's local offset — two
// machines would otherwise fingerprint the same instant differently.
// Frozen ARRAY (not a Set): Object.freeze(new Set()) does NOT block .add(),
// so the exported list is an array and the lookup structure stays module-private below.
const TIMESTAMP_KEYS = Object.freeze(['lastTouchedAt', 'at', 'orphanedAt']);
const TIMESTAMP_KEYS_LOOKUP = new Set(TIMESTAMP_KEYS);

function normalizeScalar(value, key) {
    if (typeof value !== 'string') return value;
    if (PATH_KEYS_LOOKUP.has(key)) return value.replace(/\\/g, '/');
    if (TIMESTAMP_KEYS_LOOKUP.has(key)) {
        const t = Date.parse(value);
        return Number.isNaN(t) ? value : new Date(t).toISOString();
    }
    return value;
}

function canonicalize(value, key) {
    if (Array.isArray(value)) {
        const items = value.map(v => canonicalize(v, key));
        if (SET_KEYS_LOOKUP.has(key)) items.sort();
        return items;
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k], k);
        return out;
    }
    return normalizeScalar(value, key);
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value, null));
}

function computeFingerprint({ ruleId, ruleVersion, factInputs }) {
    if (!ruleId) throw new Error('computeFingerprint: ruleId is required');
    if (!Number.isInteger(ruleVersion)) throw new Error('computeFingerprint: ruleVersion must be an integer');
    const payload = canonicalJson({ ruleId, ruleVersion, factInputs: factInputs || {} });
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

module.exports = { canonicalJson, computeFingerprint, SET_KEYS };
