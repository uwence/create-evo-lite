'use strict';
// Step 2C — the bridge cell. Two pieces of evidence sit next to each other and
// have never been joined:
//
//     non-ASCII path : 0.6.0 crashes, 0.7.0 did not reproduce the trigger set
//     ASCII path     : 0.7.0 satisfies the real adapter contract, 19/19
//
// The intersection is untested: does the REAL adapter contract still hold on a
// non-ASCII collection path under 0.7.0? This runs exactly that, changing only
// the runtime root so zvecPaths() yields a non-ASCII collectionPath.
//
// Nothing about the workload is reinvented: same adapter, same A/B/C
// transaction, same frozen 19-check set (imported, not copied), same identity
// gates. The path is the only variable — the lesson the Step 2A rerun had to
// learn when moving the runner silently moved the path prefix too.
//
// A SAME-CELL 0.6.0 CONTROL IS REQUIRED. Without it, a green 0.7.0 result could
// simply mean a harmless path was chosen; the control proves the path is a real
// trigger. If 0.6.0 survives here, the bridge is not built and the verdict is
// NOT_SATISFIED — a control that fails to reproduce invalidates the experiment
// rather than flattering it.
//
// Usage:
//   node bridge-runner.js --cell <label> --root-base <abs> --zvec-entry <abs>
//        --control-entry <abs> --adapter <abs> --expect-blob <sha1> --out <abs>

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { EXPECTED_CHECKS } = require('./expected-checks');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const CELL = argOf('--cell', 'unknown-cell');
const ROOT_BASE = argOf('--root-base', null);
const ZVEC_ENTRY = argOf('--zvec-entry', null);
const CONTROL_ENTRY = argOf('--control-entry', null);
const ADAPTER = argOf('--adapter', null);
const EXPECT_BLOB = argOf('--expect-blob', null);
const OUT = argOf('--out', null);
const PHASE_TIMEOUT_MS = 180000;

for (const [flag, v] of [['--root-base', ROOT_BASE], ['--zvec-entry', ZVEC_ENTRY],
    ['--control-entry', CONTROL_ENTRY], ['--adapter', ADAPTER], ['--out', OUT]]) {
    if (!v) { console.error(`${flag} is required`); process.exit(2); }
    if (!path.isAbsolute(v)) { console.error(`${flag} must be an absolute path (got: ${v})`); process.exit(2); }
}
if (!EXPECT_BLOB || !/^[0-9a-f]{40}$/.test(EXPECT_BLOB)) {
    console.error(`--expect-blob is required and must be a 40-hex git blob sha1 (got: ${EXPECT_BLOB})`);
    process.exit(2);
}

// Built from code points so no shell, YAML or file-encoding layer can mangle it
// on the way in. `日本語-한국어` is corpus sample o2-kana-hangul-dash, recorded
// FAIL_FAST against 0.6.0 in both runs of the trigger-boundary matrix — a
// segment already proven to kill this binding, not a fresh guess.
const SEGMENT_ID = 'o2-kana-hangul-dash';
const SEGMENT = String.fromCodePoint(0x65E5, 0x672C, 0x8A9E, 0x2D, 0xD55C, 0xAD6D, 0xC5B4);

const blobOf = (file) => {
    const b = fs.readFileSync(file);
    return crypto.createHash('sha1')
        .update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
};
const canon = (p) => {
    if (!p) return null;
    let real = p;
    try { real = fs.realpathSync.native(p); } catch (_) { /* keep the raw value */ }
    return process.platform === 'win32' ? real.toLowerCase() : real;
};

const child = path.join(__dirname, 'adapter-txn.js');
const versionOf = (entry) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version;
    } catch (_) { return null; }
};

const record = {
    cell: CELL,
    env: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    pathUnderTest: {
        segmentId: SEGMENT_ID,
        segmentCodePoints: [...SEGMENT].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()),
        segmentByteLength: Buffer.byteLength(SEGMENT, 'utf8'),
    },
    subject: { adapter: ADAPTER, adapterBlob: blobOf(ADAPTER), expectedBlob: EXPECT_BLOB },
    control: { entry: CONTROL_ENTRY, version: versionOf(CONTROL_ENTRY) },
    zvec: { entry: ZVEC_ENTRY, installedVersion: versionOf(ZVEC_ENTRY) },
    phases: [],
    verdict: 'NOT_SATISFIED',
};
record.subject.blobMatchesExpected = record.subject.adapterBlob === EXPECT_BLOB;
record.zvec.versionMatchesRequested = record.zvec.installedVersion === '0.7.0';
record.control.versionIs060 = record.control.version === '0.6.0';

function runPhase(phase, root, entry) {
    fs.mkdirSync(root, { recursive: true });
    const out = path.join(root, `phase-${phase}.json`);
    const res = spawnSync(process.execPath, [child, phase, root, entry, ADAPTER, out], {
        encoding: 'utf8', timeout: PHASE_TIMEOUT_MS, windowsHide: true,
    });
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    let ev = null;
    try { ev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { /* the child may have died first */ }
    return { res, ev, timedOut };
}

// ---- control: 0.6.0 on this very path MUST die ---------------------------
{
    // 'ctl' and 'tst' are the same length on purpose: this investigation has
    // already measured the crash point moving with path length, so letting the
    // two roots differ in size would reintroduce the very confound Step 2A's
    // rerun existed to remove. The binding must be the only difference.
    const root = path.join(ROOT_BASE, SEGMENT, 'ctl');
    const { res, ev, timedOut } = runPhase('A', root, CONTROL_ENTRY);
    const jsError = String(res.stderr || '').includes('"jsError":true');
    const completed = Boolean(ev && !ev.error && ev.allPassed && res.status === 0);
    record.control.collectionPathLen = path.join(root, 'zvec', 'collection').length;
    record.control.outcome = timedOut ? 'timeout'
        : (completed ? 'completed'
            : (!ev && !jsError ? 'process-death' : (jsError ? 'js-error' : 'failed')));
    record.control.exitCode = res.status;
    record.control.signal = res.signal;
    record.control.stages = ev ? (ev.checks || []).map(c => c.name) : [];
    // The trigger must actually reproduce. A control that survives means the path
    // is not a trigger path and this cell proves nothing about the bridge.
    record.control.triggerReproduced = record.control.outcome === 'process-death'
        || record.control.outcome === 'timeout';
}

// ---- test: 0.7.0, the full A/B/C contract, on the same shape --------------
if (record.control.triggerReproduced) {
    const root = path.join(ROOT_BASE, SEGMENT, 'tst');
    for (const phase of ['A', 'B', 'C']) {
        const { res, ev, timedOut } = runPhase(phase, root, ZVEC_ENTRY);
        const names = (ev && ev.checks || []).map(c => c.name);
        const expected = EXPECTED_CHECKS[phase];
        const missing = expected.filter(n => !names.includes(n));
        const unexpected = names.filter(n => !expected.includes(n));
        const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
        const setOk = !missing.length && !unexpected.length && !duplicated.length;
        const exitClean = res.status === 0 && !res.signal && !timedOut;
        const status = timedOut ? 'timeout'
            : (!ev ? 'process-death'
                : (ev.error ? 'error'
                    : (!exitClean ? 'dirty-exit'
                        : (!setOk ? 'check-set-mismatch'
                            : (ev.allPassed ? 'passed' : 'failed')))));
        record.phases.push({
            phase, status, exitCode: res.status, signal: res.signal, timedOut,
            collectionPathLen: path.join(root, 'zvec', 'collection').length,
            adapterBlob: ev && ev.adapterBlob, seam: ev && ev.seam, checks: ev && ev.checks,
            checkSet: { expected: expected.length, seen: names.length, missing, unexpected, duplicated, ok: setOk },
            error: ev && ev.error,
            stderr: String(res.stderr || '').slice(0, 600) || null,
        });
        if (status !== 'passed') break;
    }
}

const canonAdapter = canon(ADAPTER);
const allPhases = record.phases.length === 3 && record.phases.every(p => p.status === 'passed');
const seamProven = record.phases.length === 3 && record.phases.every(p => Array.isArray(p.seam) && p.seam.length > 0
    && p.seam.every(s => s.redirectedTo === ZVEC_ENTRY && canon(s.requestedBy) === canonAdapter));
const blobOk = record.subject.blobMatchesExpected === true
    && record.phases.length === 3 && record.phases.every(p => p.adapterBlob === record.subject.adapterBlob);
const checkSetOk = record.phases.length === 3 && record.phases.every(p => p.checkSet && p.checkSet.ok);

record.summary = {
    triggerReproduced: record.control.triggerReproduced,
    phasesPassed: record.phases.filter(p => p.status === 'passed').length,
    checksExpected: Object.values(EXPECTED_CHECKS).reduce((n, a) => n + a.length, 0),
    checksTotal: record.phases.reduce((n, p) => n + ((p.checks || []).length), 0),
    checksFailed: record.phases.reduce((n, p) => n + ((p.checks || []).filter(c => !c.pass).length), 0),
    seamProven, blobOk, checkSetOk,
};

record.verdict = (record.control.triggerReproduced === true
    && record.control.versionIs060 === true
    && allPhases && seamProven && blobOk && checkSetOk
    && record.zvec.versionMatchesRequested === true) ? 'SATISFIED' : 'NOT_SATISFIED';

fs.writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
console.log(JSON.stringify({ cell: CELL, verdict: record.verdict, control: record.control.outcome, summary: record.summary }, null, 2));
process.exit(record.verdict === 'SATISFIED' ? 0 : 1);
