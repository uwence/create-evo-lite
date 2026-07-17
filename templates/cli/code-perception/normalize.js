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

// ── M1/M2 adapter↔linker seam (spec §2.4) ─────────────────────────────────────
// The SINGLE conversion from flat CodeReference[] (① search output) to the
// wrapper shape ② governance-linker consumes as `symbolReferences`. Owning it
// here (shared with ①) guarantees no other module reshapes references for the
// linker. Pure, total: never throws, never drops a match. An unresolvable
// match keeps its slot with a floored confidence so a downstream derived link
// can never be silently born at 0 (M2).

const DERIVED_LINK_CONFIDENCE_FLOOR = 0.15;

function toSymbolReferences(matches, opts) {
    const focusId = typeof opts === 'string' ? opts : (isPlainObject(opts) ? opts.focusId : undefined);
    void focusId; // reserved for future focus-scoped resolution; linker binds by name today.
    const list = Array.isArray(matches) ? matches : [];
    const out = [];
    for (const raw of list) {
        // Accept an already-normalized CodeReference or a best-effort normalize.
        const reference = isPlainObject(raw) && typeof raw.id === 'string' && raw.id
            ? raw
            : normalizeReference(isPlainObject(raw) ? raw.providerId : undefined, raw);
        const provConf = clampConfidence(reference.provenance && reference.provenance.confidence);
        const resolutionConfidence = provConf > 0 ? provConf : DERIVED_LINK_CONFIDENCE_FLOOR;
        const symRef = { reference, resolutionConfidence };
        if (reference.filePath !== undefined) symRef.filePath = reference.filePath;
        if (reference.lineRange !== undefined) symRef.lineRange = reference.lineRange;
        out.push(symRef);
    }
    return out;
}

// M2 defensive floor pass: run AFTER buildGovernanceLinks, BEFORE ranking /
// projection / any consumer filter. A rule-gated derived link whose confidence
// is missing/0/non-finite is raised to the floor so recommended-reading and
// Wiki/Inspector never drop it merely for a missing score. Confirmed stays 1.0;
// proposed keeps its <=0.5 value. Pure — returns a new array.
function normalizeDerivedLinkConfidence(links) {
    const list = Array.isArray(links) ? links : [];
    return list.map(link => {
        if (!isPlainObject(link)) return link;
        if (link.status === 'derived') {
            const c = link.confidence;
            if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) {
                return Object.assign({}, link, { confidence: DERIVED_LINK_CONFIDENCE_FLOOR });
            }
        }
        return link;
    });
}

module.exports = {
    makeReferenceId,
    normalizeReference,
    normalizeSearchResult,
    normalizeRelationship,
    normalizeImpactResult,
    toSymbolReferences,
    normalizeDerivedLinkConfidence,
    DERIVED_LINK_CONFIDENCE_FLOOR,
};
