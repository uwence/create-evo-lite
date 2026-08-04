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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARKER_FILE = 'zvec-containment-state.json';
const LEASE_PREFIX = 'zvec-containment-recovery.';
const LEASE_SUFFIX = '.lease.json';
const ARCHIVE_LOCK_SUFFIX = '.publication.lock';
// §7.4 M5.5f — a FIXED filename beside the index directory, never the index
// directory's own name plus a suffix. See archiveLockPathFor().
const ARCHIVE_LOCK_FILE = `index-memory${ARCHIVE_LOCK_SUFFIX}`;
const SCHEMA_VERSION = 1;
const STATE_RECOVERY_REQUIRED = 'recovery-required';

// Only the verdicts that can actually cause a degradation. SAFE never writes a
// marker, and UNSAFE is reserved (§5.2) but accepted here so enabling it later
// does not need a schema change.
const ACCEPTED_VERDICTS = ['UNKNOWN', 'UNSAFE'];

const ERR_READ = 'EVO_ZVEC_CONTAINMENT_STATE_READ';
const ERR_WRITE = 'EVO_ZVEC_CONTAINMENT_STATE_WRITE';
const ERR_CLEAR = 'EVO_ZVEC_CONTAINMENT_STATE_CLEAR';
const ERR_RECOVERY_LEASE = 'EVO_ZVEC_RECOVERY_LEASE';
const ERR_ARCHIVE_LOCK = 'EVO_ZVEC_ARCHIVE_MARKER_LOCK';

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
        // The marker lives beside the db, in our own runtime directory — which
        // may not exist yet on a project that degrades before its first init.
        // Creating it is plain Node fs on an ordinary directory; it is not the
        // native path that crashes, so this is safe even on a contained path.
        if (ops.mkdirSync) ops.mkdirSync(dir, { recursive: true });
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

// ─── recovery lease (§7.4 M5.4) ────────────────────────────────────────────
//
// M5.1–M5.3 describe how ONE recovery must be ordered. They say nothing about
// two. Without a lease, both can hold an `eligible` snapshot, and the loser of
// the race wakes up to delete the collection the winner just verified — after
// the winner already cleared the marker. What is left is a half-built directory
// with no debt recorded, which is precisely the state the marker exists to
// prevent. Zvec's own coordination cannot help: the constructor only stores
// paths, openWithCoordination happens in initialize(), and the rmSync lands
// before either.
//
// The lease is bound to the marker GENERATION, not to a clock. Time is not
// evidence of ownership, so a lease is never reclaimed for being old. It is
// reclaimed only when it names a DIFFERENT generation — which can only happen
// after some recovery cleared that marker, and a recovery that completed
// released its lease. A mismatched lease is therefore the residue of a dead
// process, not a live claim.

/** SHA-256 of the marker bytes: "which degradation", not "which moment". */
function computeMarkerFingerprint(dir, seams = {}) {
    const ops = seams.fsOps || fs;
    let markerPath;
    try {
        markerPath = markerPathFor(dir);
    } catch (_) {
        return null;
    }
    try {
        return crypto.createHash('sha256').update(ops.readFileSync(markerPath)).digest('hex');
    } catch (_) {
        return null;
    }
}

// One lease file PER GENERATION (§7.4 M5.4a).
//
// A single shared path forced the acquire path into read → unlink → write, which
// is not atomic across processes: two acquirers of a new generation each read the
// old lease, each judge it reclaimable, and each unlink what the other just
// wrote. The release path was worse, because the ORDINARY success path produced
// it — an old owner clears the marker, a new degradation writes a new one, a new
// owner takes the lease, and the old owner's trailing unlink deletes it.
//
// Putting the fingerprint in the filename removes the reclaim step altogether.
// Different generations are different files, so they cannot block each other and
// nothing ever has to be deleted to make room. Ownership then rests on O_EXCL
// and a name, not on the ordering of a read and an unlink.
function leasePathFor(dir, markerFingerprint) {
    if (typeof dir !== 'string' || dir.trim() === '') {
        throw codedError('recovery lease directory is unresolvable', ERR_RECOVERY_LEASE,
            { reason: 'collection-path-unresolvable' });
    }
    if (!nonEmptyString(markerFingerprint)) {
        throw codedError('recovery lease needs a marker fingerprint', ERR_RECOVERY_LEASE,
            { reason: 'lease-payload-invalid' });
    }
    return path.join(dir, `${LEASE_PREFIX}${markerFingerprint}${LEASE_SUFFIX}`);
}

function readRecoveryLease(dir, markerFingerprint, seams = {}) {
    const ops = seams.fsOps || fs;
    let leasePath;
    try { leasePath = leasePathFor(dir, markerFingerprint); } catch (_) { return { status: 'unreadable', lease: null, leasePath: null }; }
    let raw;
    try {
        raw = ops.readFileSync(leasePath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { status: 'absent', lease: null, leasePath };
        return { status: 'unreadable', lease: null, leasePath };
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !nonEmptyString(parsed.leaseId)) {
            return { status: 'invalid', lease: null, leasePath };
        }
        return { status: 'present', lease: parsed, leasePath };
    } catch (_) {
        return { status: 'invalid', lease: null, leasePath };
    }
}

/**
 * @returns {{acquired: boolean, reason: string|null, leasePath: string,
 *            lease: object|null, replacedGeneration: boolean}}
 */
function acquireRecoveryLease(dir, payload = {}, seams = {}) {
    const ops = seams.fsOps || fs;
    const { leaseId, markerFingerprint } = payload;
    if (!nonEmptyString(leaseId)) {
        throw codedError('recovery lease needs a leaseId', ERR_RECOVERY_LEASE, { reason: 'lease-payload-invalid' });
    }
    const leasePath = leasePathFor(dir, markerFingerprint);
    const lease = {
        version: SCHEMA_VERSION,
        leaseId,
        pid: process.pid,
        createdAt: (seams.now ? seams.now() : new Date()).toISOString(),
        markerFingerprint,
    };

    // ONE exclusive create. No stat, no unlink, no retry — every one of those
    // reintroduces the window this design exists to close.
    try {
        ops.writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return { acquired: true, reason: null, leasePath, lease };
    } catch (err) {
        if (err && err.code === 'EEXIST') {
            // The file name already scopes this to the same generation, so EEXIST
            // can only mean a live claim on THIS debt. A corrupt one is still a
            // claim: fail closed rather than delete something we cannot read.
            const existing = readRecoveryLease(dir, markerFingerprint, seams);
            return {
                acquired: false,
                reason: existing.status === 'present' ? 'recovery-in-progress' : 'lease-unreadable',
                leasePath,
                lease: existing.lease,
            };
        }
        throw codedError(`recovery lease could not be acquired: ${(err && err.code) || 'ERROR'}`, ERR_RECOVERY_LEASE,
            { reason: (err && err.code) || 'ERROR', leasePath });
    }
}

/**
 * Scoped to BOTH the generation (the filename) and the leaseId. An owner of an
 * older generation therefore cannot reach a newer generation's lease at all —
 * that deletion is not prevented by a check, it is unreachable by construction.
 */
function releaseRecoveryLease(dir, markerFingerprint, leaseId, seams = {}) {
    const ops = seams.fsOps || fs;
    const current = readRecoveryLease(dir, markerFingerprint, seams);
    if (current.status === 'absent') return { released: false, reason: 'absent' };
    if (current.status !== 'present' || current.lease.leaseId !== leaseId) {
        return { released: false, reason: 'not-owner' };
    }
    try {
        ops.unlinkSync(current.leasePath);
        return { released: true, reason: null };
    } catch (err) {
        if (err && err.code === 'ENOENT') return { released: false, reason: 'absent' };
        throw codedError(`recovery lease could not be released: ${(err && err.code) || 'ERROR'}`, ERR_RECOVERY_LEASE,
            { reason: (err && err.code) || 'ERROR', leasePath: current.leasePath });
    }
}

// ─── global archive-marker publication lock (§7.4 M5.5b) ───────────────────
//
// The recovery lease separates recovery from recovery. It does nothing about a
// NORMAL sync walking into the directory swap: the index directory vanishes for
// an instant, the sync recreates it, and the swap, the sync and the original set
// are all broken together. This lock is what the normal paths and the final swap
// share. Staging deliberately does not take it — staging touches nothing global.
//
// §7.4 M5.5f — the path is built from the index directory's PARENT plus a fixed
// filename. Deriving it from the directory's own name looked equivalent and was
// not: the caller resolves that name through getIndexMemoryDir(), which renames
// vect_memory to index_memory in place and returns the LEGACY path when that
// rename fails. During a first upgrade two processes therefore lock two
// different files and both believe they hold the global lock — and the loser
// re-resolves the directory inside its callback, so it mutates the modern
// marker set while holding the legacy lock. One ledger, one lock file.
function archiveLockPathFor(indexDir) {
    if (typeof indexDir !== 'string' || indexDir.trim() === '') {
        throw codedError('archive marker lock directory is unresolvable', ERR_ARCHIVE_LOCK,
            { reason: 'archive-marker-lock-failed' });
    }
    return path.join(path.dirname(indexDir), ARCHIVE_LOCK_FILE);
}

function acquireArchiveMarkerLock(indexDir, holderId, seams = {}) {
    const ops = seams.fsOps || fs;
    const lockPath = archiveLockPathFor(indexDir);
    if (!nonEmptyString(holderId)) {
        throw codedError('archive marker lock needs a holder id', ERR_ARCHIVE_LOCK,
            { reason: 'archive-marker-lock-failed', lockPath });
    }
    const body = { version: SCHEMA_VERSION, holderId, pid: process.pid, createdAt: new Date().toISOString() };
    try {
        ops.writeFileSync(lockPath, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return { acquired: true, reason: null, lockPath, holderId };
    } catch (err) {
        if (err && err.code === 'EEXIST') {
            // Never reclaimed on a timer. A lock whose owner cannot be confirmed
            // is a lock that is held.
            return { acquired: false, reason: 'archive-marker-busy', lockPath, holderId: null };
        }
        throw codedError(`archive marker lock could not be acquired: ${(err && err.code) || 'ERROR'}`, ERR_ARCHIVE_LOCK,
            { reason: 'archive-marker-lock-failed', lockPath });
    }
}

function releaseArchiveMarkerLock(indexDir, holderId, seams = {}) {
    const ops = seams.fsOps || fs;
    const lockPath = archiveLockPathFor(indexDir);
    let parsed = null;
    try {
        parsed = JSON.parse(ops.readFileSync(lockPath, 'utf8'));
    } catch (err) {
        if (err && err.code === 'ENOENT') return { released: false, reason: 'absent', lockPath };
        return { released: false, reason: 'unreadable', lockPath };
    }
    if (!parsed || parsed.holderId !== holderId) return { released: false, reason: 'not-owner', lockPath };
    try {
        ops.unlinkSync(lockPath);
        return { released: true, reason: null, lockPath };
    } catch (err) {
        if (err && err.code === 'ENOENT') return { released: false, reason: 'absent', lockPath };
        throw codedError(`archive marker lock could not be released: ${(err && err.code) || 'ERROR'}`, ERR_ARCHIVE_LOCK,
            { reason: 'archive-marker-lock-failed', lockPath });
    }
}

module.exports = {
    MARKER_FILE,
    LEASE_PREFIX,
    LEASE_SUFFIX,
    ARCHIVE_LOCK_SUFFIX,
    ARCHIVE_LOCK_FILE,
    ERR_RECOVERY_LEASE,
    ERR_ARCHIVE_LOCK,
    archiveLockPathFor,
    acquireArchiveMarkerLock,
    releaseArchiveMarkerLock,
    computeMarkerFingerprint,
    leasePathFor,
    readRecoveryLease,
    acquireRecoveryLease,
    releaseRecoveryLease,
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
