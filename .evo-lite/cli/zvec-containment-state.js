'use strict';
// The containment trust marker — a machine-local record that this project once
// degraded away from Zvec and has not yet earned its way back.
//
// Frozen contract: docs/specs/zvec-win-unicode-containment.md §7.3 / §7.3.1 / §7.4.
//
// WHY A MARKER EXISTS AT ALL
// A path that stops being dangerous does not make the collection on it
// trustworthy. That collection may have been created but never inserted into,
// may hold unoptimized segments, may disagree with raw_memory, or may come from
// before containment existed at all. So "the path is SAFE again" must not mean
// "reopen what is lying there" — it means "rebuild from raw_memory and prove it".
// The marker is what carries that debt across processes.
//
// WHY NOT memory-engine.json
// That file is the user's explicit engine intent — the docs literally tell
// people to hand-edit it — and .gitignore un-ignores it, so it travels with the
// repository. System-written trust state in there would follow a clone onto a
// machine that never degraded, and clearing the marker could delete a user's
// pin. This file is deliberately plain-ignored under `.evo-lite/*`, so the debt
// stays on the machine that incurred it.
//
// WHY EXCLUSIVE CREATE RATHER THAN tmp+rename
// The contract is "the first evidence is never overwritten". rename REPLACES an
// existing target on several platforms, so two processes that both observe an
// absent marker can have the later one win — and checking first only moves the
// race. wx/O_EXCL gives the property directly: whoever loses gets EEXIST and
// keeps their hands off. A half-written file from a killed process is read back
// as `invalid`, which is fail-closed exactly like `present`, so atomicity buys
// nothing the contract actually needs.
//
// READING NEVER THROWS. Every failure mode is a status, because the caller is a
// decision that must fail closed rather than crash: a marker that cannot be read
// is treated as a marker that is there.

const fs = require('fs');
const path = require('path');

const MARKER_FILE = 'zvec-containment-state.json';
const SCHEMA_VERSION = 1;
const STATE_RECOVERY_REQUIRED = 'recovery-required';

// Only the verdicts that can actually cause a degradation. SAFE never writes a
// marker, and UNSAFE is reserved (§5.2) but accepted here so enabling it later
// does not need a schema change.
const ACCEPTED_VERDICTS = ['UNKNOWN', 'UNSAFE'];

const ERR_READ = 'EVO_ZVEC_CONTAINMENT_STATE_READ';
const ERR_WRITE = 'EVO_ZVEC_CONTAINMENT_STATE_WRITE';
const ERR_CLEAR = 'EVO_ZVEC_CONTAINMENT_STATE_CLEAR';

function codedError(message, code, detail) {
    const err = new Error(message);
    err.code = code;
    if (detail) err.detail = detail;
    return err;
}

function markerPathFor(dir) {
    // A marker whose location cannot be named is a debt that cannot be recorded,
    // and §7.4 M6.1 says that must be a coded failure rather than a quiet
    // "successful" degradation.
    if (typeof dir !== 'string' || dir.trim() === '') {
        throw codedError('containment marker directory is unresolvable', ERR_WRITE,
            { reason: 'collection-path-unresolvable' });
    }
    return path.join(dir, MARKER_FILE);
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

/**
 * Pure schema check, shared by the read path and the tests so neither can drift
 * into accepting something the other rejects.
 */
function validateContainmentState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, reason: 'not-an-object' };
    }
    if (value.version !== SCHEMA_VERSION) return { valid: false, reason: 'version-mismatch' };
    if (value.state !== STATE_RECOVERY_REQUIRED) return { valid: false, reason: 'state-unknown' };
    if (!nonEmptyString(value.createdAt)) return { valid: false, reason: 'createdAt-missing' };
    if (!nonEmptyString(value.collectionPath)) return { valid: false, reason: 'collectionPath-missing' };
    const c = value.containment;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { valid: false, reason: 'containment-missing' };
    if (!ACCEPTED_VERDICTS.includes(c.verdict)) return { valid: false, reason: 'verdict-unaccepted' };
    if (!nonEmptyString(c.layer)) return { valid: false, reason: 'layer-missing' };
    if (!nonEmptyString(c.reason)) return { valid: false, reason: 'reason-missing' };
    return { valid: true, reason: null };
}

/**
 * @returns {{status: 'absent'|'present'|'invalid'|'unreadable',
 *            markerPath: string|null, state: object|null, errorCode: string|null,
 *            detail: string|null}}
 *
 * absent      the file is not there (ENOENT and nothing else)
 * present     parsed and schema-valid
 * invalid     readable but not valid JSON, or valid JSON that fails the schema
 * unreadable  the read itself failed (EACCES/EPERM/EIO/...)
 *
 * The distinction between `invalid` and `unreadable` is not cosmetic: both block
 * normal Zvec selection, but only `invalid` may enter recovery. Under
 * `unreadable` we can prove neither that the marker will survive a failed
 * rebuild nor that we could clear it afterwards — so nothing destructive starts.
 */
function readContainmentState(dir, seams = {}) {
    const ops = seams.fsOps || fs;
    let markerPath;
    try {
        markerPath = markerPathFor(dir);
    } catch (err) {
        return { status: 'unreadable', markerPath: null, state: null, errorCode: ERR_READ, detail: (err.detail && err.detail.reason) || 'unresolvable' };
    }

    let raw;
    try {
        raw = ops.readFileSync(markerPath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { status: 'absent', markerPath, state: null, errorCode: null, detail: null };
        }
        return { status: 'unreadable', markerPath, state: null, errorCode: ERR_READ, detail: (err && err.code) || 'ERROR' };
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        // A JSON error is NOT absence. Collapsing it to absent is exactly the
        // fail-open this marker exists to prevent.
        return { status: 'invalid', markerPath, state: null, errorCode: null, detail: 'json-parse-failed' };
    }

    const verdict = validateContainmentState(parsed);
    if (!verdict.valid) {
        return { status: 'invalid', markerPath, state: null, errorCode: null, detail: verdict.reason };
    }
    return { status: 'present', markerPath, state: parsed, errorCode: null, detail: null };
}

/**
 * Record the debt. First writer wins, permanently.
 *
 * @returns {{written: boolean, alreadyPresent: boolean, markerPath: string}}
 * @throws  coded EVO_ZVEC_CONTAINMENT_STATE_WRITE
 */
function writeContainmentState(dir, payload = {}, seams = {}) {
    const ops = seams.fsOps || fs;
    const markerPath = markerPathFor(dir);
    const { collectionPath, containment } = payload;

    if (!nonEmptyString(collectionPath)) {
        throw codedError('containment marker needs a collection path', ERR_WRITE,
            { reason: 'collection-path-unresolvable', markerPath });
    }
    const state = {
        version: SCHEMA_VERSION,
        state: STATE_RECOVERY_REQUIRED,
        createdAt: (seams.now ? seams.now() : new Date()).toISOString(),
        collectionPath,
        containment: {
            verdict: containment && containment.verdict,
            layer: containment && containment.layer,
            reason: containment && containment.reason,
        },
    };
    const check = validateContainmentState(state);
    if (!check.valid) {
        throw codedError(`containment marker payload is invalid: ${check.reason}`, ERR_WRITE,
            { reason: check.reason, markerPath });
    }

    try {
        // 'wx' — create, fail if it exists. No stat-then-write, no retry.
        ops.writeFileSync(markerPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return { written: true, alreadyPresent: false, markerPath };
    } catch (err) {
        if (err && err.code === 'EEXIST') {
            return { written: false, alreadyPresent: true, markerPath };
        }
        throw codedError(`containment marker could not be written: ${(err && err.code) || 'ERROR'}`, ERR_WRITE,
            { reason: (err && err.code) || 'ERROR', markerPath });
    }
}

/**
 * Clear the debt. Only the recovery path may call this, and only after the
 * fresh validator has proved the rebuilt collection reopens (§7.4 M5.1/M5.3).
 *
 * @throws coded EVO_ZVEC_CONTAINMENT_STATE_CLEAR
 */
function clearContainmentState(dir, seams = {}) {
    const ops = seams.fsOps || fs;
    const markerPath = markerPathFor(dir);
    try {
        ops.unlinkSync(markerPath);
        return { cleared: true, markerPath };
    } catch (err) {
        if (err && err.code === 'ENOENT') return { cleared: false, markerPath };
        throw codedError(`containment marker could not be cleared: ${(err && err.code) || 'ERROR'}`, ERR_CLEAR,
            { reason: (err && err.code) || 'ERROR', markerPath });
    }
}

module.exports = {
    MARKER_FILE,
    SCHEMA_VERSION,
    STATE_RECOVERY_REQUIRED,
    ACCEPTED_VERDICTS,
    ERR_READ,
    ERR_WRITE,
    ERR_CLEAR,
    markerPathFor,
    validateContainmentState,
    readContainmentState,
    writeContainmentState,
    clearContainmentState,
};
