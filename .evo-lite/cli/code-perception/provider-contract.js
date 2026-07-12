'use strict';

// Pure validation + constants for the CodePerceptionProvider contract.
// NO external tools, NO CodeGraph, NO fs, NO process spawn, NO CLI registration.
// The three validate* functions never throw: bad/missing/wrong-type input
// always produces a structured diagnostic instead.

const FRESHNESS = Object.freeze({ FRESH: 'fresh', STALE: 'stale', UNKNOWN: 'unknown' });
const DIRTY = Object.freeze({ CLEAN: 'clean', DIRTY: 'dirty', UNKNOWN: 'unknown' });
const COMPAT = Object.freeze({ SUPPORTED: 'supported', UNTESTED: 'untested', UNSUPPORTED: 'unsupported', UNKNOWN: 'unknown' });
const INDEX = Object.freeze({ READY: 'ready', MISSING: 'missing', STALE: 'stale', NOT_REQUIRED: 'not-required', UNKNOWN: 'unknown' });

const CAPABILITY_KEYS = Object.freeze([
    'files', 'symbols', 'source', 'callers', 'callees', 'trace', 'impact',
    'affectedTests', 'modules', 'flows', 'summaries', 'layers', 'tours',
    'semanticSearch', 'incrementalIndex',
]);

const CAPABILITY_METHOD = Object.freeze({
    files: 'getFiles', modules: 'getFiles',
    symbols: 'search', semanticSearch: 'search',
    source: 'getEntity',
    callers: 'getCallers', callees: 'getCallees',
    impact: 'impact', affectedTests: 'getAffectedTests',
    trace: 'explore', flows: 'explore', summaries: 'explore', layers: 'explore', tours: 'explore',
});

const STATUS_ONLY_CAPABILITIES = Object.freeze(['incrementalIndex']);

const OPTIONAL_METHODS = Object.freeze([
    'search', 'getEntity', 'getFiles', 'getCallers', 'getCallees',
    'impact', 'getAffectedTests', 'explore',
]);

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diag(code, message) {
    return { code, message: message || code };
}

function validateCapabilitiesShape(capabilities, diagnostics) {
    if (!isPlainObject(capabilities)) {
        diagnostics.push(diag('missing-capabilities', 'capabilities must be an object'));
        return;
    }
    for (const key of CAPABILITY_KEYS) {
        if (!(key in capabilities)) {
            diagnostics.push(diag(`capability-missing:${key}`, `capabilities.${key} is missing`));
            continue;
        }
        if (typeof capabilities[key] !== 'boolean') {
            diagnostics.push(diag(`capability-not-boolean:${key}`, `capabilities.${key} must be a boolean`));
        }
    }
}

function validateProvider(provider) {
    const diagnostics = [];

    if (!isPlainObject(provider)) {
        diagnostics.push(diag('not-object', 'provider must be a non-null object'));
        return { valid: false, diagnostics };
    }

    for (const field of ['id', 'name', 'adapterVersion']) {
        if (typeof provider[field] !== 'string' || provider[field].length === 0) {
            diagnostics.push(diag(`missing-${field}`, `provider.${field} must be a non-empty string`));
        }
    }

    validateCapabilitiesShape(provider.capabilities, diagnostics);

    for (const method of ['check', 'getStatus']) {
        if (typeof provider[method] !== 'function') {
            diagnostics.push(diag(`missing-method:${method}`, `provider.${method} must be a function`));
        }
    }

    const capabilities = isPlainObject(provider.capabilities) ? provider.capabilities : {};
    for (const cap of Object.keys(CAPABILITY_METHOD)) {
        if (capabilities[cap] === true) {
            const method = CAPABILITY_METHOD[cap];
            if (typeof provider[method] !== 'function') {
                diagnostics.push(diag(`capability-method-missing:${cap}->:${method}`, `capabilities.${cap} is true but provider.${method} is not a function`));
            }
        }
    }

    for (const method of OPTIONAL_METHODS) {
        if (method in provider && typeof provider[method] !== 'function') {
            diagnostics.push(diag(`method-not-function:${method}`, `provider.${method} must be a function if present`));
        }
    }

    return { valid: diagnostics.length === 0, diagnostics };
}

function validateAvailability(a) {
    const diagnostics = [];

    if (!isPlainObject(a)) {
        diagnostics.push(diag('avail-not-object', 'availability must be a non-null object'));
        return { valid: false, diagnostics };
    }

    if (typeof a.available !== 'boolean') {
        diagnostics.push(diag('avail-invalid:available', 'available must be a boolean'));
    }
    if (typeof a.ready !== 'boolean') {
        diagnostics.push(diag('avail-invalid:ready', 'ready must be a boolean'));
    }
    if (!Object.values(INDEX).includes(a.indexState)) {
        diagnostics.push(diag('avail-invalid:indexState', 'indexState must be one of the INDEX values'));
    }
    if ('installed' in a && typeof a.installed !== 'boolean') {
        diagnostics.push(diag('avail-invalid:installed', 'installed must be a boolean if present'));
    }

    return { valid: diagnostics.length === 0, diagnostics };
}

function validateStatus(s) {
    const diagnostics = [];

    if (!isPlainObject(s)) {
        diagnostics.push(diag('status-not-object', 'status must be a non-null object'));
        return { valid: false, diagnostics };
    }

    if (typeof s.ready !== 'boolean') {
        diagnostics.push(diag('status-invalid:ready', 'ready must be a boolean'));
    }
    if (typeof s.available !== 'boolean') {
        diagnostics.push(diag('status-invalid:available', 'available must be a boolean'));
    }
    if (!Object.values(INDEX).includes(s.indexState)) {
        diagnostics.push(diag('status-invalid:indexState', 'indexState must be one of the INDEX values'));
    }
    if (!Object.values(FRESHNESS).includes(s.freshness)) {
        diagnostics.push(diag('status-invalid:freshness', 'freshness must be one of the FRESHNESS values'));
    }
    if (!Object.values(DIRTY).includes(s.dirty)) {
        diagnostics.push(diag('status-invalid:dirty', 'dirty must be one of the DIRTY values'));
    }
    if (!Object.values(COMPAT).includes(s.compatibility)) {
        diagnostics.push(diag('status-invalid:compatibility', 'compatibility must be one of the COMPAT values'));
    }
    validateCapabilitiesShape(s.capabilities, diagnostics);

    return { valid: diagnostics.length === 0, diagnostics };
}

module.exports = {
    FRESHNESS,
    DIRTY,
    COMPAT,
    INDEX,
    CAPABILITY_KEYS,
    CAPABILITY_METHOD,
    STATUS_ONLY_CAPABILITIES,
    validateProvider,
    validateAvailability,
    validateStatus,
};
