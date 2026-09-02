'use strict';
// Unified runner for the Windows non-ASCII zvec path probe.
//
// ⚠️ OPT-IN ONLY. This runner spawns child processes that are EXPECTED to be
// killed by the OS (0xC0000409). It refuses to start without an explicit
// environment opt-in so it can never be picked up by a test sweep or CI job by
// accident:
//
//     ZVEC_UNICODE_PROBE=1 node probe-runner.js [--round R2] [--repeats 3]
//
// It is NOT part of the test suite and NOT registered in template-manifest.js.
// It lives under docs/validation/fixtures/ as reproducible evidence, not as
// shipped runtime code.
//
// Samples come from corpus.json so the tested corpus is data, reviewable
// without reading this file. Expected verdicts for the R2 block are the
// original evidence from docs/validation/zvec-06-phase0b-verdict.md section 8;
// a mismatch there means the harness or the environment differs from the
// original run and nothing downstream may be concluded.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.ZVEC_UNICODE_PROBE !== '1') {
    console.error('refusing to run: set ZVEC_UNICODE_PROBE=1 to opt in.');
    console.error('this probe intentionally crashes child processes (0xC0000409).');
    process.exit(2);
}

const HERE = __dirname;
const CHILD = path.join(HERE, 'probe-child.js');
const BASE = path.join(HERE, '.runs');          // scratch; safe to delete
const CORPUS = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const ROUND = argOf('--round', null);
const REPEATS = Number(argOf('--repeats', 3));
const TIMEOUT_MS = 90000;

// Resolved ONCE here and injected as an absolute path. See probe-child.js for
// why a bare require in the child would invalidate the measurement.
//
// `--binding <abs path>` exists so a VERSION comparison can hold the runner
// location fixed. BASE — and therefore every collection path under test — is
// derived from __dirname, so running a copy of this file from another directory
// changes the absolute path prefix as well as the binding. Against a
// path-sensitive native fail-fast that is a confound, not a detail: the two
// variables become inseparable and no difference can be attributed to the
// binding alone. Point this flag at another install instead of moving the file.
// Fail closed on a relative override rather than path.resolve()-ing it. Resolving
// it would silently repair a caller that violated the measurement contract and
// let the run continue; the whole point of absolute injection is that the
// binding's identity must not depend on anyone's cwd or file location.
const bindingOverride = argOf('--binding', null);
if (bindingOverride !== null && !path.isAbsolute(bindingOverride)) {
    console.error(`--binding must be an absolute path (got: ${bindingOverride})`);
    process.exit(2);
}
const BINDING = bindingOverride || require.resolve('@zvec/zvec');
const { classifyNativeOutcome } = require('../shared/fail-fast-classifier');

// The classification vocabulary moved to ../shared/fail-fast-classifier.js so
// that later layers inherit it instead of reinventing it. Behaviour here is
// unchanged - `completed` is this runner's own `child_done` stage test.
function classify(run) {
    return classifyNativeOutcome({
        timedOut: run.timedOut,
        jsError: run.jsError,
        status: run.status,
        signal: run.signal,
        completed: run.stages.includes('child_done'),
    });
}

function runOnce(sample, attempt, position) {
    const stem = path.join(BASE, `${sample.round}-${sample.id}-${position}-r${attempt}`);
    const colPath = position === 'leaf'
        ? path.join(stem, '.evo-lite', 'zvec', sample.segment)
        : path.join(stem, sample.segment, '.evo-lite', 'zvec', 'collection');
    const out = { position, attempt, colPathLen: colPath.length };
    try {
        fs.mkdirSync(path.dirname(colPath), { recursive: true });
    } catch (e) {
        return { ...out, verdict: 'NORMAL_JS_ERROR', stages: [], lastStage: '(mkdir failed)' };
    }
    const res = spawnSync(process.execPath, [CHILD, BINDING, colPath], {
        encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true,
    });
    out.status = res.status;
    out.signal = res.signal;
    out.timedOut = res.error && res.error.code === 'ETIMEDOUT';
    out.stages = String(res.stdout || '').split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l).stage; } catch { return null; } }).filter(Boolean);
    out.lastStage = out.stages[out.stages.length - 1] || '(none)';
    out.jsError = String(res.stderr || '').includes('"jsError"');
    out.verdict = classify(out);
    return out;
}

const samples = CORPUS.samples.filter(s => !ROUND || s.round === ROUND);
console.log(`binding: ${BINDING}`);
console.log(`samples: ${samples.length}  repeats: ${REPEATS}\n`);

let mismatches = 0;
const results = [];
for (const sample of samples) {
    const runs = [];
    for (let i = 1; i <= REPEATS; i++) runs.push(runOnce(sample, i, 'root'));
    const verdicts = [...new Set(runs.map(r => r.verdict))];
    // A single non-crash is not evidence of safety, and disagreement across
    // repeats is reported as UNSTABLE rather than smoothed to a majority.
    const verdict = verdicts.length === 1 ? verdicts[0] : 'UNSTABLE';

    let agreement = null;
    if (sample.expected === 'CRASH') agreement = verdict === 'FAIL_FAST_REPRODUCED' ? 'MATCH' : 'MISMATCH';
    if (sample.expected === 'OK') agreement = verdict === 'COMPLETED_NO_FAILFAST' ? 'MATCH' : 'MISMATCH';
    if (agreement === 'MISMATCH') mismatches++;

    // Per-run detail is persisted, not just the aggregate verdict. Without
    // status / stages / colPathLen on disk, a report that says "0.6.0 died at
    // create_or_open while 0.7.0 reached child_done at the same path length"
    // cannot be rebuilt from the committed artifact — it would rest on the
    // author's transcript rather than on evidence.
    results.push({
        round: sample.round, id: sample.id, verdict, observed: verdicts, agreement,
        runs: runs.map(r => ({
            position: r.position, attempt: r.attempt, colPathLen: r.colPathLen,
            status: r.status, signal: r.signal, timedOut: r.timedOut || false,
            lastStage: r.lastStage, stages: r.stages, verdict: r.verdict,
        })),
    });
    const flag = agreement === 'MISMATCH' ? '  <<< MISMATCH vs original evidence' : '';
    console.log(`${verdict.padEnd(24)} ${sample.round} ${sample.id}${flag}`);
}

console.log(`\nmismatches vs original evidence: ${mismatches}`);
fs.writeFileSync(path.join(HERE, 'last-run.json'),
    JSON.stringify({
        binding: BINDING, repeats: REPEATS, round: ROUND,
        // The apparatus calls runOnce(..., 'root') only; the 'leaf' branch in
        // runOnce has never been invoked. Recorded so a reader takes the layout
        // from the artifact rather than from any prose.
        positionsExercised: ['root'],
        base: BASE, node: process.version, platform: process.platform,
        results,
    }, null, 2), 'utf8');
console.log('wrote last-run.json (untracked scratch output)');
