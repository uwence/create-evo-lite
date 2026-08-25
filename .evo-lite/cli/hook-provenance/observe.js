'use strict';
// Class 1 (ask the system that owns the fact) and Class 2 (read, parse,
// syntax-check) only. Nothing here executes the managed body or any substitute:
// the body runs plan progress, disposition sync and dashboard build, so running
// it would be a governance write, and a stand-in would only prove things about
// the stand-in.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathIdentity } = require('./path-identity');
const { aggregateRunnability } = require('./schema');
const { defaultGitQuery } = require('./topology');

// Preserving the errno is necessary but not sufficient — an implementation can
// see EACCES and still write `unrealized`. The mapping itself is frozen.
function observeHooksDir(hooksDir, fsOps = fs) {
    let st;
    try {
        st = fsOps.statSync(hooksDir);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { outcome: 'unrealized', reason: 'hooks-dir-missing' };
        return { outcome: 'indeterminate', reason: 'hooks-dir-unobservable' };
    }
    if (!st.isDirectory()) return { outcome: 'unrealized', reason: 'hooks-dir-not-directory' };
    return { outcome: null };
}

function observeLocator({ targetDir, targetPath, gitQuery = defaultGitQuery, fsOps = fs }) {
    let res;
    try {
        res = gitQuery(targetDir, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
    } catch (_) {
        return { verdict: 'indeterminate', reason: 'authority-query-unavailable' };
    }
    if (res.status !== 0 || !res.stdout) {
        return { verdict: 'indeterminate', reason: 'authority-query-failed' };
    }
    // The authority answers with a DIRECTORY; targetPath is a FILE. Comparing
    // them directly would report not-satisfied for an ordinary installation.
    switch (pathIdentity(res.stdout, path.dirname(targetPath), fsOps)) {
        case 'SAME': return { verdict: 'satisfied', reason: null };
        case 'DISTINCT': return { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' };
        default: return { verdict: 'indeterminate', reason: 'path-comparison-ambiguous' };
    }
}

// A predicate qualifies only when positive and negative controllers with
// independent ground truth both exist and it separates them. v1 ships no such
// controller: minting fixtures at observation time would leave Class 2, and the
// two obvious candidates are disqualified by measurement — statSync().mode
// reports 666 on Windows for a hook Git Bash shows as -rwxr-xr-x, and the
// accessSync execute-bit check also passes README.md, so it has no
// discriminating power at all. The honest answer is indeterminate, and it is
// expected to stand.
function observeExecutable(_hookPath, _fsOps = fs) {
    return { verdict: 'indeterminate', reason: 'no-qualified-predicate',
        predicate: null, qualification: 'unavailable' };
}

// v1 qualifies an interpreter by its EXACT declared path, never by basename.
// A file named `bash` is not thereby a Bash. Measured: a stub at
// <tmp>/fake/bash that ignores its arguments and exits 0 passes a basename
// check, passes stat, and passes a `-n` spawn — yielding `satisfied` for a hook
// no shell ever validated. Worse, reaching that verdict means having EXECUTED an
// unidentified program, which is outside Class 2's grant of read, parse and
// syntax-check.
//
// So the qualification is an allowlist of paths whose identity this contract is
// willing to assume, and it holds exactly the two the managed hook itself uses
// or could plausibly be written with. Everything else — `/tmp/bash`,
// `/opt/custom/bash`, `/usr/bin/python3` — is unqualified, and unqualified is
// ambiguous, not a verdict.
const SUPPORTED_ENTRIES = ['/bin/sh', '/bin/bash'];

// Resolve what the shebang ACTUALLY declares. `entry` is the program the kernel
// starts, and in v1 it is also the program consulted for the aligned `-n` check —
// one binary answering for itself, never a stand-in.
//
// v1 recognises exactly ONE positive form, and it is deliberately the narrowest
// one that can be proved end to end:
//
//   a single token, absolute → { entry: t0 }
//   anything else            → null → ambiguous-interpreter → indeterminate
//
// The entry is then qualified against SUPPORTED_ENTRIES below, so `#!/bin/sh`
// and `#!/bin/bash` are provable while `#!bash`, `#!env bash`,
// `#!/usr/bin/env bash`, `#!/usr/bin/env -S bash -e`,
// `#!/bin/bash --definitely-invalid-option` and `#!/tmp/tools/bash` are all
// ambiguous.
//
// Both restrictions are load-bearing, and each has a measured counterexample.
// Dropping trailing tokens turns `#!/bin/bash --definitely-invalid-option` into a
// plain `-n` check that exits 0 while the hook as declared cannot start (running
// it exits 2). Accepting a relative entry lets `#!env bash` be answered by
// whatever `bash` is on PATH, while the hook itself exits 127, "required file not
// found". There is one rule underneath both: the only program that can answer
// whether the declared interpreter works is that exact declared program.
//
// The `env` wrapper is therefore NOT supported in v1. Supporting it honestly
// would mean proving the whole entry chain — that /usr/bin/env exists AND is
// executable AND resolves `bash` the way the kernel will — and stat'ing env only
// to then run a PATH bash proves none of it: a /tmp/env that exists without the
// executable bit passes stat, `bash -n` succeeds, and the real hook exits 126.
// The frozen design never required env support; it only forbids manufacturing a
// positive verdict out of a state we cannot establish.
function parseShebang(line) {
    const words = line.slice(2).trim().split(/\s+/).filter(Boolean);
    if (words.length !== 1) return null;
    if (!path.isAbsolute(words[0])) return null;
    return { entry: words[0] };
}

function observeInterpreter(hookPath, fsOps = fs) {
    let first;
    try {
        first = fsOps.readFileSync(hookPath, 'utf8').split('\n', 1)[0] || '';
    } catch (_) {
        return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: null };
    }
    if (!first.startsWith('#!')) {
        return { verdict: 'indeterminate', reason: 'missing-shebang', shebang: null };
    }
    const parsed = parseShebang(first);
    if (!parsed) return { verdict: 'indeterminate', reason: 'ambiguous-interpreter', shebang: first };

    if (!SUPPORTED_ENTRIES.includes(parsed.entry)) {
        // Includes `#!/usr/bin/python3`. v1 does NOT report that as
        // incompatible-interpreter: a path named python3 is no more proof of
        // Python than one named bash is proof of Bash, and "positively
        // incompatible" is a claim, not an absence. `incompatible-interpreter`
        // is therefore unreachable in v1 — the same shape as `executable`, which
        // stands at indeterminate because no qualified predicate exists yet.
        // `not-satisfied` stays reachable through `syntax-rejected`.
        return { verdict: 'indeterminate', reason: 'ambiguous-interpreter', shebang: first };
    }

    // The declared entry is the program the kernel will start; establish that it
    // is there before asking it anything.
    try { fsOps.statSync(parsed.entry); }
    catch (_) { return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: first }; }

    // Interpreter-ALIGNED syntax check, run through the SAME declared entry: a
    // bash hook is checked by that bash, so bash-legal syntax is not reported as
    // a defect. The spawn goes through fsOps.__execFileSync when present so a test
    // can observe WHICH binary was consulted — on hosts where sh and bash are the
    // same file a grammar difference cannot distinguish them, but the argv always
    // can.
    const spawn = fsOps.__execFileSync || execFileSync;
    try {
        spawn(parsed.entry, ['-n', hookPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        return { verdict: 'satisfied', reason: null, shebang: first };
    } catch (err) {
        // The parser could not be run at all (absent, not spawnable) — that is a
        // failure to observe, not a syntax defect.
        if (typeof err.status !== 'number') {
            return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: first };
        }
        return { verdict: 'not-satisfied', reason: 'syntax-rejected', shebang: first };
    }
}

function observeRunnability(args) {
    const locator = observeLocator(args);
    const executable = observeExecutable(args.targetPath, args.fsOps);
    const interpreter = observeInterpreter(args.targetPath, args.fsOps);
    const strip = c => ({ verdict: c.verdict, reason: c.reason });
    const components = { locator: strip(locator), executable: strip(executable), interpreter: strip(interpreter) };
    return {
        runnability: { verdict: aggregateRunnability(components), ...components },
        diagnostic: {
            executablePredicate: executable.predicate,
            predicateQualification: executable.qualification,
            shebang: interpreter.shebang,
        },
    };
}

module.exports = {
    observeHooksDir, observeLocator, observeExecutable, observeInterpreter, observeRunnability,
};
