'use strict';

const { computeFingerprint } = require('./fingerprint');

function findEntry(ledger, findingId) {
    return (ledger && ledger.entries || []).find(e => e.findingId === findingId) || null;
}

// Presence, not truthiness. A present-but-falsy `orphanedAt` (e.g. from a
// hand-built fixture or an in-memory entry that never passed through
// readLedger's own validation) must still read as tombstoned — fail closed,
// never revive on a technicality.
function isTombstoned(entry) {
    return Object.prototype.hasOwnProperty.call(entry, 'orphanedAt');
}

// The ONE place fingerprint matching happens. Consumers must never reimplement
// this: `if (ledger.has(id)) suppress()` would honour stale and tombstoned
// entries alike, the exact inverse of the intended behaviour.
function effectiveDisposition(finding, ledger) {
    const entry = findEntry(ledger, finding.id);
    if (!entry) return null;
    if (isTombstoned(entry)) return null;           // tombstone is terminal
    const current = computeFingerprint({
        ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, factInputs: finding.factInputs,
    });
    return entry.fingerprint === current ? entry : null;
}

function annotate(finding, ledger) {
    const entry = findEntry(ledger, finding.id);
    const live = effectiveDisposition(finding, ledger);
    if (live) {
        return { ...finding, disposition: { status: 'current', choice: live.choice,
            reason: live.reason, until: live.until || null, at: live.at } };
    }
    // A lapsed decision is reported as lapsed, never silently dropped —
    // except a tombstone, which is a closed chapter rather than a live lapse.
    if (entry && !isTombstoned(entry)) {
        return { ...finding, disposition: { status: 'stale', choice: entry.choice,
            reason: entry.reason, fingerprint: entry.fingerprint } };
    }
    return { ...finding, disposition: null };
}

function classifyEntry(entry, emittedIds) {
    if (!emittedIds.has(entry.findingId)) return 'orphaned';
    return isTombstoned(entry) ? 'orphaned' : 'current';
}

module.exports = { isTombstoned, effectiveDisposition, annotate, classifyEntry };
