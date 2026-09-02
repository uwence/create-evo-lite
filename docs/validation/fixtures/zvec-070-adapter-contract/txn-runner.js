'use strict';
// Step 2B apparatus — one runtime cell of the real-adapter contract matrix.
//
// Measurement only. No production code is modified, no pin moves, no default
// flips, no containment relaxes, and a SATISFIED cell authorizes none of them.
//
// The recorder stays OUTSIDE every native boundary it records, the lesson Step
// 2A had to learn twice: each phase runs in its own child process, and this
// process never loads @zvec/zvec or the adapter. What dies must be the process
// under test, never the evidence owner.
//
// Usage:
//   node txn-runner.js --cell <label> --runtime-root <abs> --zvec-entry <abs>
//                      --adapter <abs> --out <abs> [--expect-blob <sha1>]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const CELL = argOf('--cell', 'unknown-cell');
const RUNTIME_ROOT = argOf('--runtime-root', null);
const ZVEC_ENTRY = argOf('--zvec-entry', null);
const ADAPTER = argOf('--adapter', null);
const OUT = argOf('--out', null);
const EXPECT_BLOB = argOf('--expect-blob', null);
const PHASE_TIMEOUT_MS = 180000;

// Absolute-only, fail closed — a relative path would let the identity of the
// thing under test depend on this process's cwd.
for (const [flag, v] of [['--runtime-root', RUNTIME_ROOT], ['--zvec-entry', ZVEC_ENTRY],
    ['--adapter', ADAPTER], ['--out', OUT]]) {
    if (!v) { console.error(`${flag} is required`); process.exit(2); }
    if (!path.isAbsolute(v)) { console.error(`${flag} must be an absolute path (got: ${v})`); process.exit(2); }
}
// --expect-blob is REQUIRED. Optional identity is not identity: with it absent
// the subject gate degrades from "the blob matches" to "the blob was not shown
// to differ", and a run with no declared expectation could still be SATISFIED.
if (!EXPECT_BLOB || !/^[0-9a-f]{40}$/.test(EXPECT_BLOB)) {
    console.error(`--expect-blob is required and must be a 40-hex git blob sha1 (got: ${EXPECT_BLOB})`);
    process.exit(2);
}

// The exact contract this apparatus claims to check. Frozen as a SET, not a
// count: a count still passes if one check is duplicated and another deleted.
// "every existing check is green" is not "every check that should exist ran" —
// the same evidence-completeness hole as `every()` over an empty array.
const EXPECTED_CHECKS = {
    A: [
        'upsert returns numeric id',
        'ids are distinct and ascending',
    ],
    B: [
        'write survives close + reopen in a new process',
        'list is ordered by numeric id',
        'list carries content/namespace/timestamp',
        'fts query returns the expected row',
        'fts match_source is zvec-fts',
        'fts row has score and snippet',
        'colon query returns the expected row',
        'colon query falls back to zvec-match',
        'scope filter excludes the out-of-scope row',
        'scope filter keeps the in-scope row (positive control)',
        'stats counts both docs',
        'stats first/last timestamps',
        'stats namespaces reports per-namespace chunks',
        'delete reports changes = 1',
    ],
    C: [
        'deletion survives reopen',
        'survivor still present',
        'survivor still queryable after reopen',
    ],
};

// Windows records paths with whatever casing the caller used, and a symlinked
// checkout resolves differently again; compare physical identity, not spelling.
const canon = (p) => {
    if (!p) return null;
    let real = p;
    try { real = fs.realpathSync.native(p); } catch (_) { /* keep the raw value */ }
    return process.platform === 'win32' ? real.toLowerCase() : real;
};

const blobOf = (file) => {
    const b = fs.readFileSync(file);
    return crypto.createHash('sha1')
        .update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
};

const record = {
    cell: CELL,
    env: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    subject: { adapter: ADAPTER, adapterBlob: blobOf(ADAPTER), expectedBlob: EXPECT_BLOB },
    zvec: { entry: ZVEC_ENTRY, installedVersion: null, versionMatchesRequested: null },
    phases: [],
    verdict: 'NOT_SATISFIED',
};

// Declared version read off disk — no native load in this process.
try {
    record.zvec.installedVersion = JSON.parse(fs.readFileSync(
        path.join(path.dirname(ZVEC_ENTRY), '..', 'package.json'), 'utf8')).version;
} catch (e) {
    record.zvec.readError = String(e && e.message);
}
record.zvec.versionMatchesRequested = record.zvec.installedVersion === '0.7.0';
record.subject.blobMatchesExpected = EXPECT_BLOB ? record.subject.adapterBlob === EXPECT_BLOB : null;

const child = path.join(__dirname, 'adapter-txn.js');
fs.mkdirSync(RUNTIME_ROOT, { recursive: true });

for (const phase of ['A', 'B', 'C']) {
    const out = path.join(RUNTIME_ROOT, `phase-${phase}.json`);
    const res = spawnSync(process.execPath, [child, phase, RUNTIME_ROOT, ZVEC_ENTRY, ADAPTER, out], {
        encoding: 'utf8', timeout: PHASE_TIMEOUT_MS, windowsHide: true,
    });
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    let ev = null;
    try { ev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { /* the child may have died first */ }

    // The check SET must match, not just be green. A phase that ran 18 of 19 —
    // or ran one twice and dropped another — has not exercised the contract.
    const names = (ev && ev.checks || []).map(c => c.name);
    const expected = EXPECTED_CHECKS[phase];
    const missing = expected.filter(n => !names.includes(n));
    const unexpected = names.filter(n => !expected.includes(n));
    const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
    const setOk = missing.length === 0 && unexpected.length === 0 && duplicated.length === 0;

    // Process lifecycle is part of the contract, not decoration. A child that
    // wrote green evidence and then died still failed the phase: "three
    // processes, not three calls" means each process must also END correctly.
    const exitClean = res.status === 0 && !res.signal && !timedOut;

    // No evidence file and an abnormal teardown means JavaScript never regained
    // control — the uncatchable native class, recorded rather than inferred.
    const status = timedOut ? 'timeout'
        : (!ev ? 'process-death'
            : (ev.error ? 'error'
                : (!exitClean ? 'dirty-exit'
                    : (!setOk ? 'check-set-mismatch'
                        : (ev.allPassed ? 'passed' : 'failed')))));

    record.phases.push({
        phase, status, exitCode: res.status, signal: res.signal, timedOut,
        adapterBlob: ev && ev.adapterBlob,
        seam: ev && ev.seam,
        checks: ev && ev.checks,
        checkSet: { expected: expected.length, seen: names.length, missing, unexpected, duplicated, ok: setOk },
        error: ev && ev.error,
        stderr: String(res.stderr || '').slice(0, 600) || null,
    });
    if (status !== 'passed') break;   // fail closed: later phases assume earlier state
}

// ---- verdict -------------------------------------------------------------
// Behaviour, not survival. "Every function existed" and "the process exited 0"
// are both weaker than the contract this adapter actually depends on, so the
// verdict requires the identity facts AND every behavioural check.
const allPhases = record.phases.length === 3 && record.phases.every(p => p.status === 'passed');

// `redirectedTo` is written by the interceptor itself, so on its own it proves
// only that the harness redirected SOMETHING. The load-bearing half is
// `requestedBy`: the binding must have been asked for by the adapter under test,
// through its own production require, not by the harness or a neighbour module.
const canonAdapter = canon(ADAPTER);
const seamProven = record.phases.every(p => Array.isArray(p.seam) && p.seam.length > 0
    && p.seam.every(s => s.redirectedTo === ZVEC_ENTRY && canon(s.requestedBy) === canonAdapter));

// Strictly true. `!== false` would let a run with no declared expectation pass.
const blobOk = record.subject.blobMatchesExpected === true
    && record.phases.every(p => p.adapterBlob === record.subject.adapterBlob);

const checkSetOk = record.phases.length === 3 && record.phases.every(p => p.checkSet && p.checkSet.ok);

record.summary = {
    phasesPassed: record.phases.filter(p => p.status === 'passed').length,
    checksExpected: Object.values(EXPECTED_CHECKS).reduce((n, a) => n + a.length, 0),
    checksTotal: record.phases.reduce((n, p) => n + ((p.checks || []).length), 0),
    checksFailed: record.phases.reduce((n, p) => n + ((p.checks || []).filter(c => !c.pass).length), 0),
    seamProven, blobOk, checkSetOk,
};

record.verdict = (allPhases && seamProven && blobOk && checkSetOk
    && record.zvec.versionMatchesRequested === true) ? 'SATISFIED' : 'NOT_SATISFIED';

fs.writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
console.log(JSON.stringify({ cell: CELL, verdict: record.verdict, summary: record.summary }, null, 2));
process.exit(record.verdict === 'SATISFIED' ? 0 : 1);
