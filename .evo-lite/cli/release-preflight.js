'use strict';
// [zvec-win-unicode-containment] Task 8 / AC7 — the release enforcement point.
//
// This is the thing that actually stops `npm publish`. `release-gate.yml` is
// standing contract evidence and nothing more: whether it is a required check is
// a repository-admin setting the CLI cannot reach, so treating CI as the gate
// would mean the gate can be turned off from a settings page. `prepublishOnly`
// runs inside the publish itself and a non-zero exit aborts it, which is the
// only place the CLI can enforce anything (spec §8.1 / §8.2).
//
// Two rules make this file load-bearing rather than decorative:
//
//   1. The registry is rebuilt HERE, from disk, every time. The generated
//      .evo-lite/generated/spec-registry.json is never consulted — it is
//      gitignored, absent from the published tarball, and free to be stale, and
//      a stale registry always fails in the "release" direction (§8.2.3).
//
//   2. Passing means the registry says so, not that this process avoided
//      throwing. buildSpecRegistry's own contract is to degrade quietly rather
//      than raise, so `try { build() } catch {}` would let a project whose specs
//      could not be read publish cleanly (§8.2.3.1).
const path = require('path');

const { buildSpecRegistry } = require('./spec-portfolio');

const TAG = '[release-preflight]';

// The verdict is spoken, not inferred. A caller that only reads the exit code
// cannot tell "blocked by a release blocker" apart from "crashed before it
// decided anything" — and both are non-zero. Tests key on this line, so a
// preflight that dies early fails them instead of passing for the wrong reason.
function emit(verdict, lines) {
    for (const line of lines) process.stdout.write(`${TAG} ${line}\n`);
    process.stdout.write(`${TAG} VERDICT=${verdict}\n`);
}

function evaluate(projectRoot) {
    const registry = buildSpecRegistry(projectRoot, { write: false });
    const errors = Array.isArray(registry.errors) ? registry.errors : [];
    const blockers = Array.isArray(registry.blockers) ? registry.blockers : [];
    const source = registry.source || {};
    const discovered = Number(source.discoveredFileCount);
    const parsed = Number(source.parsedSpecCount);

    const reasons = [];

    // A registry that predates Task 8 has no errors/blockers/source at all.
    // Accepting it would mean an older runtime silently publishes without a
    // gate, so an unrecognised shape is itself a blocking condition.
    if (!Array.isArray(registry.errors) || !Array.isArray(registry.blockers) || !registry.source) {
        reasons.push(`registry shape is not release-aware (version=${registry.version}); refusing to guess`);
    }

    for (const e of errors) {
        reasons.push(`registry error: ${e && e.path ? `${e.path} — ` : ''}${e && e.reason ? e.reason : String(e)}`);
    }
    for (const b of blockers) {
        reasons.push(`release blocker: ${b.id} [${b.state}] (${b.file}) — ${b.reason}`);
    }

    // Count conservation is the last line of defence: even a degradation path
    // that forgets to record an error still shows up as a file that was
    // discovered and never became a spec.
    if (!Number.isInteger(discovered) || !Number.isInteger(parsed)) {
        reasons.push('registry.source is missing discoveredFileCount/parsedSpecCount');
    } else if (discovered !== parsed) {
        reasons.push(`spec count not conserved: discovered ${discovered}, parsed ${parsed} — some file under docs/specs was swallowed`);
    }

    return { registry, reasons };
}

function main() {
    // npm runs lifecycle scripts with cwd set to the package root.
    const projectRoot = process.cwd();
    let result;
    try {
        result = evaluate(projectRoot);
    } catch (err) {
        emit('BLOCKED', [
            `could not evaluate the spec portfolio: ${err && err.message ? err.message : String(err)}`,
            'refusing to publish on an unevaluated portfolio',
        ]);
        process.exit(1);
        return;
    }

    const { registry, reasons } = result;
    const source = registry.source || {};

    if (reasons.length > 0) {
        emit('BLOCKED', [
            `publish refused for ${reasons.length} reason(s):`,
            ...reasons.map(r => `  - ${r}`),
            '',
            'Clear a blocker by shipping the spec (status: done), or by parking it',
            'with a complete waiver — all three fields, unquoted:',
            '  releaseBlockDisposition: waived',
            '  releaseBlockReason: <why this risk is accepted>',
            '  releaseBlockReviewedAt: YYYY-MM-DD',
            'A waiver applies to parked specs only; adopted/active must be finished',
            'or deliberately parked first (spec §8.2.2.1).',
        ]);
        process.exit(1);
        return;
    }

    emit('CLEAR', [
        `${path.basename(projectRoot)}: no release blockers`,
        `specs discovered=${source.discoveredFileCount} parsed=${source.parsedSpecCount}, errors=0, blockers=0`,
    ]);
}

if (require.main === module) {
    main();
}

module.exports = { evaluate };
