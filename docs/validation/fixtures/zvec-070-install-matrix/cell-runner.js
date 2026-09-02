'use strict';
// Step 2A apparatus — one runtime cell of the @zvec/zvec@0.7.0
// install / load / minimal-native-smoke matrix.
//
// Measurement only. This fixture changes no pin, no default, no containment,
// and satisfying it authorizes none of them. It is not registered in
// template-manifest.js, does not ship with scaffold, and is not part of
// `npm test`.
//
// THE POINT IS THE BOUNDARY, NOT THE TICK. These are four different facts and
// the record must not collapse them into one green check:
//
//     cannot install
//         != installs but the native binding cannot load
//         != binding loads but a basic native operation fails
//         != basic native operation works but project API usage is incompatible
//
// The fourth is deliberately out of scope here.
//
// Usage:
//   node cell-runner.js --probe-dir <abs> --install-status <success|failure>
//                       --cell <label> --out <abs path to result json>

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const PROBE_DIR = argOf('--probe-dir', null);
const INSTALL_STATUS = argOf('--install-status', 'unknown');
const CELL = argOf('--cell', 'unknown-cell');
const OUT = argOf('--out', null);
const REQUESTED = argOf('--version', '0.7.0');
const SMOKE_TIMEOUT_MS = 120000;

// Absolute-only, fail closed. A relative --probe-dir would make the resolved
// binding depend on this process's cwd, and the whole point of resolving once
// and injecting absolutely is that the binding's identity must not.
for (const [flag, value] of [['--probe-dir', PROBE_DIR], ['--out', OUT]]) {
    if (!value) { console.error(`${flag} is required`); process.exit(2); }
    if (!path.isAbsolute(value)) {
        console.error(`${flag} must be an absolute path (got: ${value})`);
        process.exit(2);
    }
}

const record = {
    cell: CELL,
    requestedVersion: REQUESTED,
    env: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        cwd: process.cwd(),
        probeDir: PROBE_DIR,
    },
    install: { status: INSTALL_STATUS === 'success' ? 'ok' : 'failed', reported: INSTALL_STATUS },
    load: { status: 'skipped' },
    smoke: { status: 'skipped' },
    verdict: 'NOT_SATISFIED',
};

// ---- resolve + declared version (no native load in THIS process) ---------
// Resolved from the probe directory, never from this file's location: the
// package under test lives there, and resolving from here could walk up into an
// unrelated node_modules and silently measure a different install.
// require.resolve and reading package.json touch no native code.
let bindingPath = null;
let declaredVersion = null;
let resolveError = null;
if (record.install.status === 'ok') {
    try {
        const req = require('module').createRequire(path.join(PROBE_DIR, 'noop.js'));
        bindingPath = req.resolve('@zvec/zvec');
        declaredVersion = JSON.parse(fs.readFileSync(
            path.join(path.dirname(bindingPath), '..', 'package.json'), 'utf8')).version;
    } catch (e) {
        resolveError = String(e && e.message);
    }
}

// ---- B. LOAD and C. SMOKE, both observed from the child ------------------
// This process NEVER require()s the binding. An earlier version did, with a
// comment admitting a native crash at require time would kill it — which would
// have destroyed the record before it was written, and load-time death is
// exactly the boundary this matrix exists to distinguish. The recorder must
// outlive every phase it records.
//
// One child covers both phases; the stage markers separate them:
//
//     reached binding_loaded ? LOAD ok : LOAD failed/dead
//     reached child_done     ? SMOKE completed : SMOKE failed/dead
if (record.install.status === 'ok' && bindingPath) {
    const colPath = path.join(PROBE_DIR, 'smoke', 'collection');
    fs.mkdirSync(path.dirname(colPath), { recursive: true });
    const child = path.join(__dirname, 'smoke-child.js');
    const res = spawnSync(process.execPath, [child, bindingPath, colPath], {
        encoding: 'utf8', timeout: SMOKE_TIMEOUT_MS, windowsHide: true,
    });
    const stages = String(res.stdout || '').split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const stageNames = stages.map(s => s.stage);
    const stderr = String(res.stderr || '');
    const jsError = stderr.includes('"jsError":true');
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    const loaded = stageNames.includes('binding_loaded');
    const done = stageNames.includes('child_done');
    // No JS error and an abnormal teardown means JavaScript never regained
    // control: the uncatchable class this whole investigation is about.
    const deathKind = timedOut ? 'timeout' : (jsError ? 'js-error' : 'process-death');

    const shared = {
        exitCode: res.status, signal: res.signal, stages: stageNames,
        lastStage: stageNames[stageNames.length - 1] || null,
        loadedBinding: (stages.find(s => s.stage === 'child_start') || {}).binding || null,
        stderr: stderr.slice(0, 500) || null,
    };

    record.load = loaded
        ? { status: 'ok', resolvedBinding: bindingPath, installedVersion: declaredVersion,
            versionMatchesRequested: declaredVersion === REQUESTED }
        : { status: deathKind, resolvedBinding: bindingPath, installedVersion: declaredVersion,
            versionMatchesRequested: declaredVersion === REQUESTED, ...shared };

    record.smoke = loaded
        ? { status: done ? 'completed' : deathKind, collectionPathLen: colPath.length, ...shared }
        : { status: 'skipped', reason: 'binding never loaded' };
} else if (record.install.status === 'ok') {
    record.load = { status: 'failed', resolvedBinding: null, error: resolveError || 'resolve failed' };
}

// ---- verdict -------------------------------------------------------------
// Fail closed: every phase must have actually succeeded. A skipped phase is not
// a pass, and no cell is excluded to make the matrix green.
//
// versionMatchesRequested is verdict-bearing, not merely recorded. Writing an
// identity into the artifact does not make it a premise of the judgement — a
// cell that installed some other version could otherwise load, smoke and report
// SATISFIED for a version nobody asked about.
record.verdict = (record.install.status === 'ok'
    && record.load.status === 'ok'
    && record.load.versionMatchesRequested === true
    && record.smoke.status === 'completed') ? 'SATISFIED' : 'NOT_SATISFIED';

fs.writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
console.log(JSON.stringify(record, null, 2));

void execFileSync;
process.exit(record.verdict === 'SATISFIED' ? 0 : 1);
