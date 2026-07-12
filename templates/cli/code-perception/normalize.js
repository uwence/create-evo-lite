'use strict';

// Pure normalization layer for the CodePerceptionProvider contract.
// Turns a provider's raw entity/result data into Evo-Lite's unified
// CodeReference / result shapes. NO external tools, NO CodeGraph, NO fs,
// NO process spawn, NO network, NO CLI registration.
// None of the exported functions ever throw: bad/missing/wrong-type input
// always produces a best-effort normalized shape instead.

const crypto = require('node:crypto');
const { FRESHNESS, DIRTY } = require('./provider-contract');

const REFERENCE_KINDS = Object.freeze([
    'file', 'module', 'class', 'interface', 'function', 'method',
    'route', 'command', 'flow', 'test', 'unknown',
]);

const PROVENANCE_METHODS = Object.freeze([
    'provider-structural', 'provider-enrichment', 'native-file',
    'git', 'declared-link', 'heuristic',
]);

const PROVENANCE_AUTHORITIES = Object.freeze(['structural', 'enrichment', 'governance']);

const RELATIONSHIP_KINDS = Object.freeze([
    'calls', 'called_by', 'imports', 'imported_by', 'references', 'tests', 'affected_by',
]);

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'unknown']);

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Returns `value` if it is one of `enumObj`'s values, else `fallback`.
function coerceEnum(value, enumObj, fallback) {
    return Object.values(enumObj).includes(value) ? value : fallback;
}

function clampConfidence(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function makeReferenceId(providerId, providerEntityId) {
    const pid = providerId === undefined || providerId === null ? '' : String(providerId);
    const eid = providerEntityId === undefined || providerEntityId === null ? '' : String(providerEntityId);
    const tail = crypto.createHash('sha256').update(eid).digest('hex').slice(0, 12);
    return `code-ref:${pid}:${tail}`;
}

function normalizeReference(providerId, raw) {
    const r = isPlainObject(raw) ? raw : {};
    const providerEntityId = r.providerEntityId ?? r.id ?? r.name ?? '';
    const id = makeReferenceId(providerId, providerEntityId);

    const ref = {
        id,
        providerId,
        providerEntityId,
        kind: coerceEnum(r.kind, REFERENCE_KINDS, 'unknown'),
        name: r.name !== undefined ? r.name : '',
    };

    if (r.qualifiedName !== undefined) ref.qualifiedName = r.qualifiedName;
    if (r.filePath !== undefined) ref.filePath = r.filePath;
    if (r.lineRange !== undefined) ref.lineRange = r.lineRange;
    if (r.signature !== undefined) ref.signature = r.signature;

    const rawSnapshot = isPlainObject(r.snapshot) ? r.snapshot : {};
    const snapshot = {
        dirty: coerceEnum(rawSnapshot.dirty, DIRTY, DIRTY.UNKNOWN),
        freshness: coerceEnum(rawSnapshot.freshness, FRESHNESS, FRESHNESS.UNKNOWN),
    };
    if (rawSnapshot.contentHash !== undefined) snapshot.contentHash = rawSnapshot.contentHash;
    if (rawSnapshot.indexedCommit !== undefined) snapshot.indexedCommit = rawSnapshot.indexedCommit;
    if (rawSnapshot.currentCommit !== undefined) snapshot.currentCommit = rawSnapshot.currentCommit;
    if (rawSnapshot.providerSnapshot !== undefined) snapshot.providerSnapshot = rawSnapshot.providerSnapshot;
    ref.snapshot = snapshot;

    const rawProvenance = isPlainObject(r.provenance) ? r.provenance : {};
    ref.provenance = {
        providerId,
        method: coerceEnum(rawProvenance.method, PROVENANCE_METHODS, 'heuristic'),
        authority: coerceEnum(rawProvenance.authority, PROVENANCE_AUTHORITIES, 'enrichment'),
        confidence: clampConfidence(rawProvenance.confidence),
    };

    return ref;
}

function normalizeSearchResult(providerStatus, rawMatches) {
    let query = '';
    let matchList = [];
    let diagnostics = [];

    if (Array.isArray(rawMatches)) {
        matchList = rawMatches;
    } else if (isPlainObject(rawMatches)) {
        query = typeof rawMatches.query === 'string' ? rawMatches.query : '';
        matchList = Array.isArray(rawMatches.matches) ? rawMatches.matches : [];
        diagnostics = Array.isArray(rawMatches.diagnostics) ? rawMatches.diagnostics : [];
    }

    const providerId = isPlainObject(providerStatus) ? providerStatus.providerId : undefined;
    const matches = matchList.map(m => normalizeReference(providerId, m));

    return {
        query,
        provider: providerStatus,
        matches,
        diagnostics,
    };
}

function normalizeRelationship(providerId, src, tgt, kind, confidence) {
    return {
        source: normalizeReference(providerId, src),
        target: normalizeReference(providerId, tgt),
        // Invalid kinds are coerced to 'references' — the safe generic
        // relationship kind — rather than throwing (never-throw contract).
        kind: coerceEnum(kind, RELATIONSHIP_KINDS, 'references'),
        providerId,
        confidence: clampConfidence(confidence),
    };
}

function normalizeImpactResult(providerStatus, raw) {
    const r = isPlainObject(raw) ? raw : {};
    const providerId = isPlainObject(providerStatus) ? providerStatus.providerId : undefined;

    const result = {
        target: normalizeReference(providerId, r.target),
        provider: providerStatus,
        upstream: Array.isArray(r.upstream) ? r.upstream.map(x => normalizeReference(providerId, x)) : [],
        downstream: Array.isArray(r.downstream) ? r.downstream.map(x => normalizeReference(providerId, x)) : [],
        affectedTests: Array.isArray(r.affectedTests) ? r.affectedTests.map(x => normalizeReference(providerId, x)) : [],
        diagnostics: Array.isArray(r.diagnostics) ? r.diagnostics : [],
    };

    if (typeof r.depth === 'number' && Number.isFinite(r.depth)) result.depth = r.depth;
    result.risk = coerceEnum(r.risk, RISK_LEVELS, 'unknown');

    return result;
}

module.exports = {
    makeReferenceId,
    normalizeReference,
    normalizeSearchResult,
    normalizeRelationship,
    normalizeImpactResult,
};
