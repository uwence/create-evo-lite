'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KIND, SCHEMA_VERSION, eventId, currentDigest, validateHookProvenanceV1 } = require('./schema');

// Only a positive ENOENT may make the document ABSENT. A permission error or an
// unreadable mount is a failure to observe — and this is the one place where
// that collapse would manufacture UNKNOWN, the state the whole design exists to
// stop from being fabricated. A presence-only probe is therefore never used
// here: the errno is the whole answer, and collapsing "not there" into
// "could not look" is precisely the fabrication this state exists to prevent.
function readProvenance(provenancePath, fsOps = fs) {
    let raw;
    try {
        raw = fsOps.readFileSync(provenancePath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { state: 'ABSENT' };
        return { state: 'UNOBSERVABLE', errors: [`read failed: ${err && err.code}`] };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { state: 'UNOBSERVABLE', errors: [`unparseable: ${err.message}`] };
    }
    const result = validateHookProvenanceV1(parsed);
    if (!result.ok) return { state: 'UNOBSERVABLE', errors: result.errors };
    return { state: 'VALID', doc: parsed };
}

function commit(provenancePath, doc, fsOps) {
    const tmpPath = `${provenancePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.mkdirSync(path.dirname(provenancePath), { recursive: true });
        fsOps.writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
        const back = JSON.parse(fsOps.readFileSync(tmpPath, 'utf8'));
        const check = validateHookProvenanceV1(back);
        if (!check.ok) throw new Error(`read-back failed validation: ${check.errors.join('; ')}`);
        if (JSON.stringify(back) !== JSON.stringify(doc)) throw new Error('read-back mismatch');
        fsOps.renameSync(tmpPath, provenancePath);  // atomic replace; no failable business operation after this point
    } catch (e) {
        let cleanupError = null;
        try { fsOps.unlinkSync(tmpPath); } catch (e2) { if (e2 && e2.code !== 'ENOENT') cleanupError = e2; }
        if (cleanupError) {
            throw new AggregateError([e, cleanupError],
                `hook provenance not committed; orphaned temp may remain at ${tmpPath}`);
        }
        throw new Error(`hook provenance not committed (${e.message})`);
    }
    return doc;
}

// `prior` is the result of readProvenance. An UNOBSERVABLE document stops the
// run: treating it as empty history would convert "I could not read it" into
// "there was never any history" — this debt's original defect, reproduced
// inside its own remedy.
function appendEvent(provenancePath, prior, draft, fsOps = fs) {
    if (prior.state === 'UNOBSERVABLE') {
        throw new Error('hook provenance is unobservable; refusing to overwrite it');
    }
    const events = prior.state === 'VALID' ? prior.doc.events.slice() : [];
    const seq = events.length === 0 ? 1 : events[events.length - 1].seq + 1;
    const participation = draft.intent.participation;

    const event = { seq, recordedAt: draft.recordedAt, intent: draft.intent };
    if (draft.install) event.install = draft.install;
    if (draft.runnability) event.runnability = draft.runnability;
    event.resultingCurrentDigest = currentDigest(participation);
    event.id = eventId(event);
    if (draft.diagnostic) event.diagnostic = draft.diagnostic;

    events.push(event);
    return commit(provenancePath, {
        kind: KIND, schemaVersion: SCHEMA_VERSION,
        current: { participation, derivedFrom: event.id },
        events,
    }, fsOps);
}

module.exports = { readProvenance, appendEvent };
