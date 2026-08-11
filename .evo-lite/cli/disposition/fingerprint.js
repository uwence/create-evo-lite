'use strict';

const crypto = require('crypto');

// factInputs keys whose arrays are sets, not sequences. Order must not matter.
const SET_KEYS = Object.freeze(new Set([
    'linkedFiles', 'notDonePlans', 'taskStatuses', 'linkedPlans',
]));

// Only these keys are treated as paths. Blanket `\ -> /` on every string would
// silently rewrite prose, ids and shas that merely contain a backslash.
const PATH_KEYS = Object.freeze(new Set(['path', 'file', 'linkedFiles']));

// Only these are normalized to UTC. `lastTouchedAt` arrives from
// `git log --format=%cI`, which keeps the committer's local offset — two
// machines would otherwise fingerprint the same instant differently.
const TIMESTAMP_KEYS = Object.freeze(new Set(['lastTouchedAt', 'at', 'orphanedAt']));

function normalizeScalar(value, key) {
    if (typeof value !== 'string') return value;
    if (PATH_KEYS.has(key)) return value.replace(/\\/g, '/');
    if (TIMESTAMP_KEYS.has(key)) {
        const t = Date.parse(value);
        return Number.isNaN(t) ? value : new Date(t).toISOString();
    }
    return value;
}

function canonicalize(value, key) {
    if (Array.isArray(value)) {
        const items = value.map(v => canonicalize(v, key));
        if (SET_KEYS.has(key)) items.sort();
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
