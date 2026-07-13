'use strict';

// Test-only fake CodeGraph CLI. Driven as `node fake-codegraph.js <subcommand> [args]`.
// It prints the committed pinned-upstream fixture matching <subcommand> to stdout
// and exits 0; an unknown subcommand exits 2 (mirrors the real CLI's commander
// "unknown command" exit code). Fixtures are resolved via __dirname, NEVER cwd, so
// the exec/router tests can run it from any working directory and still get bytes.
//
// This is NOT the real CodeGraph. It exists only to drive the adapter's exec,
// timeout, failure-isolation, and network-boundary tests against static fixtures.
// Node builtins only; no dependencies; no network; no fs writes.

const fs = require('node:fs');
const path = require('node:path');

// Subcommand -> committed fixture file (resolved relative to THIS script's dir).
const FIXTURES = Object.freeze({
    status: 'codegraph-status.json',
    files: 'codegraph-files.json',
    query: 'codegraph-query.json',
    callers: 'codegraph-callers.json',
    callees: 'codegraph-callees.json',
    impact: 'codegraph-impact.json',
    affected: 'codegraph-affected.json',
    node: 'codegraph-node.txt',
    explore: 'codegraph-explore.txt',
    version: 'codegraph-version.txt',
    help: 'codegraph-help.txt',
});

function hasFlag(argv, name) {
    return argv.indexOf(name) !== -1;
}

// Blocking sleep that keeps the child process alive without spinning the CPU.
function sleepMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return;
    }
    const shared = new Int32Array(new SharedArrayBuffer(4));
    // No other thread will ever notify index 0, so this blocks for the full ms.
    Atomics.wait(shared, 0, 0, ms);
}

function main() {
    const argv = process.argv.slice(2);
    const subcommand = argv[0];

    const fixtureName = Object.prototype.hasOwnProperty.call(FIXTURES, subcommand)
        ? FIXTURES[subcommand]
        : undefined;

    // Unknown (or missing) subcommand: refuse, exit 2 — matches the real CLI's
    // rejection of an unrecognized command before any work happens.
    if (fixtureName === undefined) {
        process.stderr.write(`fake-codegraph: unknown command '${subcommand === undefined ? '' : subcommand}'\n`);
        process.exit(2);
    }

    // --fake-echo-env: drive the network-boundary env test. Print the child's own
    // environment (as the real spawn would receive it) instead of the fixture, so
    // the caller can assert which env vars crossed the process boundary. It rides
    // an ALLOWED subcommand (e.g. `status`) — there is deliberately no `env`
    // subcommand, because the runner allowlist has none and would reject it.
    if (hasFlag(argv, '--fake-echo-env')) {
        process.stdout.write(JSON.stringify(process.env));
        process.exit(0);
    }

    // --fake-sleep <ms>: delay output to drive the exec timeout test. The child
    // stays alive for the full duration, then prints normally.
    const sleepIdx = argv.indexOf('--fake-sleep');
    if (sleepIdx !== -1) {
        sleepMs(parseInt(argv[sleepIdx + 1], 10));
    }

    // Emit the fixture bytes verbatim (Buffer write — no added newline), so stdout
    // is byte-identical to the committed fixture file.
    const raw = fs.readFileSync(path.join(__dirname, fixtureName));
    process.stdout.write(raw);
    process.exit(0);
}

main();
