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
const { classifyNativeOutcome, REPRODUCED } = require('../shared/fail-fast-classifier');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const CELL = argOf('--cell', 'unknown-cell');
const ROOT_BASE = argOf('--root-base', null);
const ZVEC_ENTRY = argOf('--zvec-entry', null);
const CONTROL_ENTRY = argOf('--control-entry', null);
const ADAPTER = argOf('--adapter', null);
const EXPECT_BLOB = argOf('--expect-blob', null);
const OUT = argOf('--out', null);
// Which apparatus produced this record. On CI the Actions run binds result to
// harness commit; a record produced on a developer host has no such chain, and
// this work line has already run THREE different bridge apparatus versions
// (colPathLen 76, the hand-counted 150, the final 149). Without this, the last
// link is the author's say-so.
const EXPECT_APPARATUS = {
    'bridge-runner.js': argOf('--expect-bridge-runner', null),
    'adapter-txn.js': argOf('--expect-adapter-txn', null),
    'expected-checks.js': argOf('--expect-expected-checks', null),
    '../shared/fail-fast-classifier.js': argOf('--expect-classifier', null),
};
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
// Same fail-closed rule as --expect-blob, for the same reason: an optional
// identity is not an identity. Absent, the gate would degrade from "this
// apparatus produced this record" to "no apparatus was shown to differ".
for (const [file, want] of Object.entries(EXPECT_APPARATUS)) {
    if (!want || !/^[0-9a-f]{40}$/.test(want)) {
        console.error(`apparatus expectation for ${file} is required and must be a 40-hex git blob `
            + `sha1 (got: ${want}). Flags: --expect-bridge-runner --expect-adapter-txn `
            + `--expect-expected-checks --expect-classifier`);
        process.exit(2);
    }
}

// Built from code points so no shell, YAML or file-encoding layer can mangle it
// on the way in. `日本語-한국어` is corpus sample o2-kana-hangul-dash, recorded
// FAIL_FAST against 0.6.0 in both runs of the trigger-boundary matrix — a
// segment already proven to kill this binding, not a fresh guess.
const SEGMENT_ID = 'o2-kana-hangul-dash';
const SEGMENT = String.fromCodePoint(0x65E5, 0x672C, 0x8A9E, 0x2D, 0xD55C, 0xAD6D, 0xC5B4);

// The trigger is NOT a property of the segment alone. The merged evidence
// records it as this segment AT A MEASURED PATH LENGTH, and the same document
// (zvec-070-win-unicode-recheck.md 1.1) measured the crash point MOVING when
// only the path prefix changed. A first CI run of this bridge landed at
// colPathLen 76 - outside the 135..160 band the whole corpus was ever collected
// in - and 0.6.0 completed there. That is the apparatus inheriting its length
// from wherever the host happened to put the root, not a fact about zvec.
//
// So the length is now targeted, and the number is READ OFF the merged
// artifact rather than tuned after seeing a result:
//
//   results-0.7.0-probe/control-0.6.0-R2.json
//     o2-kana-hangul-dash, position root, attempts 1-3
//     colPathLen 149 -> FAIL_FAST, lastStage schema_built, 3/3
//
// Length is reached by padding the PREFIX, which is the same variable 1.1
// identified, applied to control and subject identically.
const TARGET_COLLECTION_PATH_LEN = 149;
const TARGET_PROVENANCE = 'results-0.7.0-probe/control-0.6.0-R2.json :: o2-kana-hangul-dash :: colPathLen 149 :: FAIL_FAST 3/3';
// Derived by construction, not by hand-counting separators: measure the path
// with a one-character pad, then add the shortfall. Each extra pad character
// adds exactly one. Hand arithmetic got this off by one on the first attempt -
// and the gate below caught it, which is the whole reason the gate exists.
const LEN_WITH_ONE_PAD = path.join(ROOT_BASE, 'p', SEGMENT, 'ctl', 'zvec', 'collection').length;
const PAD_LEN = 1 + (TARGET_COLLECTION_PATH_LEN - LEN_WITH_ONE_PAD);

// Fail closed. A base too long to reach the pre-registered length cannot be
// silently run anyway - that is exactly how the first run produced an
// out-of-regime measurement and called it a control.
if (PAD_LEN < 1) {
    console.error(`--root-base is too long to reach the pre-registered collection path length `
        + `${TARGET_COLLECTION_PATH_LEN}: with a single pad character the path is already `
        + `${LEN_WITH_ONE_PAD} chars. Pass a shorter --root-base.`);
    process.exit(2);
}
const PAD = 'p'.repeat(PAD_LEN);

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
        targetCollectionPathLen: TARGET_COLLECTION_PATH_LEN,
        targetProvenance: TARGET_PROVENANCE,
        prefixPadLength: PAD_LEN,
    },
    subject: { adapter: ADAPTER, adapterBlob: blobOf(ADAPTER), expectedBlob: EXPECT_BLOB },
    apparatus: {},
    control: { entry: CONTROL_ENTRY, version: versionOf(CONTROL_ENTRY) },
    zvec: { entry: ZVEC_ENTRY, installedVersion: versionOf(ZVEC_ENTRY) },
    phases: [],
    verdict: 'NOT_SATISFIED',
};
record.subject.blobMatchesExpected = record.subject.adapterBlob === EXPECT_BLOB;
record.apparatusRunnerFile = path.basename(__filename);
for (const [file, want] of Object.entries(EXPECT_APPARATUS)) {
    // The runner hashes ITSELF, not the fixed name: hashing 'bridge-runner.js'
    // by name would let a renamed, modified copy hash the pristine original and
    // pass. Found by the timeout negative control, which is a renamed copy.
    const actual = blobOf(file === 'bridge-runner.js' ? __filename : path.join(__dirname, file));
    record.apparatus[file] = { blob: actual, expected: want, matches: actual === want };
}
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
    const root = path.join(ROOT_BASE, PAD, SEGMENT, 'ctl');
    const { res, ev, timedOut } = runPhase('A', root, CONTROL_ENTRY);
    // What is SHARED with Step 1 is the classification vocabulary. The child
    // TRANSPORT is not shared, and mapping this child's observations into that
    // vocabulary is this caller's job.
    //
    // `"jsError":true` on stderr is probe-child.js's protocol. adapter-txn.js
    // never writes it: its JS-error channel is `error` in the evidence file,
    // written before it exits 1. Reading stderr here made every catchable 0.6.0
    // failure - a lock error, a missing native binding, an API shape 0.6.0 does
    // not have - arrive as "status 1, no jsError", which the classifier then
    // correctly reads as a native fail-fast. An ordinary exception would have
    // been counted as the trigger reproducing.
    //
    // adapter-txn.js has three terminal states; this maps two of them. The third
    // - reaching the end and reporting allPassed:false, which also exits 1 - is
    // not reachable for the control, which runs only phase A, whose two checks
    // assert over ids from the adapter's OWN file counter (_nextId) rather than
    // anything zvec returns. If the control is ever given another phase, that
    // state becomes reachable and this mapping must be revisited.
    const jsError = Boolean(ev && ev.error);
    record.control.collectionPathLen = path.join(root, 'zvec', 'collection').length;
    // Step 1 froze this vocabulary; the bridge inherits it rather than writing
    // its own. See ../shared/fail-fast-classifier.js for what the first version
    // of this line got wrong.
    //
    // Built once, fed once, recorded once: the record carries the exact object
    // that was classified, not a re-derivation of it. The old record carried only
    // the outcome, so a wrong mapping was invisible to anyone reading the
    // evidence - which is how the stderr-marker bug survived a review OF THE
    // RESULTS and had to be found by reading the apparatus.
    const classifierInput = {
        timedOut, jsError, status: res.status, signal: res.signal || null,
        completed: Boolean(ev && !ev.error && ev.allPassed),
    };
    record.control.outcome = classifyNativeOutcome(classifierInput);
    record.control.classifierInput = classifierInput;
    record.control.exitCode = res.status;
    record.control.signal = res.signal;
    record.control.error = (ev && ev.error) || null;
    record.control.stages = ev ? (ev.checks || []).map(c => c.name) : [];
    // The trigger must actually reproduce. A control that survives means the path
    // is not a trigger path and this cell proves nothing about the bridge. A
    // TIMEOUT IS NOT A REPRODUCTION: it is the absence of an observation, and
    // Step 1 classifies it INCONCLUSIVE.
    record.control.triggerReproduced = record.control.outcome === REPRODUCED;
}

// ---- test: 0.7.0, the full A/B/C contract, on the same shape --------------
if (record.control.triggerReproduced) {
    const root = path.join(ROOT_BASE, PAD, SEGMENT, 'tst');
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

// Which apparatus produced this record. Strict === true, like every other
// identity gate here: an unstated expectation must not pass.
const apparatusValues = Object.values(record.apparatus);
const apparatusOk = apparatusValues.length === Object.keys(EXPECT_APPARATUS).length
    && apparatusValues.every(a => a.matches === true);

// The targeted length is only worth targeting if reaching it is a gate. Recorded
// but unjudged is the failure shape this work line has already hit three times:
// a fact written into JSON is not yet a premise of the verdict.
const lengthOnTarget = record.control.collectionPathLen === TARGET_COLLECTION_PATH_LEN
    && record.phases.length === 3
    && record.phases.every(p => p.collectionPathLen === TARGET_COLLECTION_PATH_LEN);

record.summary = {
    triggerReproduced: record.control.triggerReproduced,
    phasesPassed: record.phases.filter(p => p.status === 'passed').length,
    checksExpected: Object.values(EXPECTED_CHECKS).reduce((n, a) => n + a.length, 0),
    checksTotal: record.phases.reduce((n, p) => n + ((p.checks || []).length), 0),
    checksFailed: record.phases.reduce((n, p) => n + ((p.checks || []).filter(c => !c.pass).length), 0),
    seamProven, blobOk, checkSetOk, lengthOnTarget, apparatusOk,
    collectionPathLen: record.control.collectionPathLen,
};

record.verdict = (record.control.triggerReproduced === true
    && record.control.versionIs060 === true
    && allPhases && seamProven && blobOk && checkSetOk && lengthOnTarget && apparatusOk
    && record.zvec.versionMatchesRequested === true) ? 'SATISFIED' : 'NOT_SATISFIED';

fs.writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
console.log(JSON.stringify({ cell: CELL, verdict: record.verdict, control: record.control.outcome, summary: record.summary }, null, 2));
process.exit(record.verdict === 'SATISFIED' ? 0 : 1);
