'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { classifyTopology } = require('./hook-provenance/topology');
const { readProvenance, appendEvent } = require('./hook-provenance/store');
const { observeHooksDir, observeRunnability } = require('./hook-provenance/observe');

const SENTINEL_BEGIN = '# BEGIN evo-lite-hook';
const SENTINEL_END = '# END evo-lite-hook';

function buildHookBody() {
    const lines = [
        SENTINEL_BEGIN,
        '# Managed by create-evo-lite. Do not edit this block manually.',
        '[ -d ".evo-lite/cli" ] || exit 0',
        'CHANGED=$(git diff-tree --no-commit-id --name-only -r --root HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")',
        'PLAN_CHANGED="" ARCH_CHANGED="" CODE_CHANGED="" EVIDENCE_CHANGED=""',
        'for f in $CHANGED; do',
        '  case "$f" in',
        '    docs/specs/*|docs/plans/*|docs/superpowers/specs/*|docs/superpowers/plans/*) PLAN_CHANGED=1 ;;',
        '    templates/cli/*|templates/.github/*|templates/.codex/*|index.js|bin/*|package.json|.agents/rules/*|.agents/workflows/*|docs/contracts/*|docs/architecture/*) ARCH_CHANGED=1 ;;',
        '    .evo-lite/raw_memory/*.md) EVIDENCE_CHANGED=1 ;;',
        '    .evo-lite/generated/*|.evo-lite/raw_memory/*|.evo-lite/index_memory/*|.evo-lite/.cache/*) ;;',
        '    *) CODE_CHANGED=1 ;;',
        '  esac',
        'done',
        'NODE_BIN=$(command -v node 2>/dev/null)',
        '[ -z "$NODE_BIN" ] && exit 0',
        '[ -z "${PLAN_CHANGED}${ARCH_CHANGED}${CODE_CHANGED}${EVIDENCE_CHANGED}" ] && exit 0',
        'REPORT_DIR=".evo-lite/generated/governance"',
        'REPORT_PATH="$REPORT_DIR/post-commit-last-run.json"',
        'mkdir -p "$REPORT_DIR"',
        'COMMAND_RESULTS=""',
        'append_result() {',
        '  label="$1"',
        '  ok="$2"',
        '  COMMAND_RESULTS="${COMMAND_RESULTS}${label}\t${ok}\n"',
        '}',
        'run_mem() { "$NODE_BIN" .evo-lite/cli/memory.js "$@"; }',
        'run_and_record() {',
        '  label="$1"',
        '  shift',
        '  if run_mem "$@" 2>/dev/null; then',
        '    append_result "$label" true',
        '  else',
        '    append_result "$label" false',
        '  fi',
        '}',
        '[ -n "$EVIDENCE_CHANGED" ] && run_and_record "plan archive-evidence" plan archive-evidence --backfill',
        '[ -n "${PLAN_CHANGED}${EVIDENCE_CHANGED}" ] && run_and_record "plan scan" plan scan',
        '[ -n "$ARCH_CHANGED" ] && run_and_record "architecture scan" architecture scan',
        'run_and_record "plan progress" plan progress',
        'run_and_record "focus auto-advance" context advance-focus',
        '[ -n "$ARCH_CHANGED" ] && run_and_record "architecture diff" architecture diff',
        'EVO_LITE_CHANGED_FILES="$CHANGED" run_and_record "plan gaps" plan gaps --last-commit --changed-files-from-env',
        // Calls the explicit command and nothing else. The hook must never
        // reimplement tombstone logic, and never turn a degraded sync into a
        // "resolved" outcome — `disposition sync` alone decides whether the round
        // was entitled to write anything.
        'run_and_record "disposition sync" disposition sync',
        '[ -n "$CODE_CHANGED" ] && EVO_LITE_CHANGED_FILES="$CHANGED" run_and_record "code-perception post-commit" code-perception post-commit',
        'HOOK_CHANGED="$CHANGED" HOOK_PLAN_CHANGED="$PLAN_CHANGED" HOOK_ARCH_CHANGED="$ARCH_CHANGED" HOOK_CODE_CHANGED="$CODE_CHANGED" HOOK_EVIDENCE_CHANGED="$EVIDENCE_CHANGED" HOOK_COMMANDS="$COMMAND_RESULTS" HOOK_REPORT_PATH="$REPORT_PATH" "$NODE_BIN" -e "const fs=require(\'fs\'); const path=require(\'path\'); const execFileSync=require(\'child_process\').execFileSync; const changed=(process.env.HOOK_CHANGED||\'\').split(/\\s+/).filter(Boolean); const categories=[]; if(process.env.HOOK_PLAN_CHANGED) categories.push(\'plan\'); if(process.env.HOOK_ARCH_CHANGED) categories.push(\'architecture\'); if(process.env.HOOK_CODE_CHANGED) categories.push(\'code\'); if(process.env.HOOK_EVIDENCE_CHANGED) categories.push(\'evidence\'); const commands=(process.env.HOOK_COMMANDS||\'\').split(/\\n/).filter(Boolean).map(line=>{ const parts=line.split(/\\t/); return { name: parts[0], ok: parts[1]===\'true\' }; }); let commit=\'unknown\'; try { commit=execFileSync(\'git\', [\'rev-parse\', \'--short\', \'HEAD\'], { encoding: \'utf8\' }).trim() || \'unknown\'; } catch (_) {} const payload={ event:\'post-commit\', commit, changedFiles:changed, categories, commands, ok:commands.every(item=>item.ok), note:\'dashboard build runs after this report so the current dashboard reflects this report\' }; fs.mkdirSync(path.dirname(process.env.HOOK_REPORT_PATH), { recursive:true }); fs.writeFileSync(process.env.HOOK_REPORT_PATH, JSON.stringify(payload, null, 2), \'utf8\');"',
        'run_and_record "dashboard build" dashboard build',
        SENTINEL_END,
    ];
    return lines.join('\n');
}

// The artifact dimension of the two-dimension report. `null` means the file was
// absent — a fact — while `undefined` means the digest could not be taken.
function digestFile(p, fsOps) {
    try {
        return 'sha256:' + crypto.createHash('sha256').update(fsOps.readFileSync(p)).digest('hex');
    } catch (err) {
        return err && err.code === 'ENOENT' ? null : undefined;
    }
}

function compareArtifact(before, after) {
    if (before === undefined || after === undefined) return 'indeterminate';
    return before === after ? 'unchanged' : 'modified';
}

// Returns { reason, threw, phase } and never throws. `phase` distinguishes a
// failure BEFORE any write was issued from one during the write: the caller must
// not chmod, nor claim a write was attempted, for the former.
function writeManagedHook(hookPath, hookBody, fsOps) {
    let existing = null;
    try {
        existing = fsOps.readFileSync(hookPath, 'utf8');
    } catch (err) {
        if (!err || err.code !== 'ENOENT') return { reason: null, threw: true, phase: 'pre-write' };
    }

    // The reason is decided from what was FOUND, before the write is issued, so
    // it survives a write that throws. Deriving it afterwards would let an
    // exception rename a freshly created hook into an "updated" block.
    let reason;
    let content;
    if (existing === null) {
        reason = 'created-managed-hook';
        content = '#!/bin/sh\n' + hookBody + '\n';
    } else if (existing.includes(SENTINEL_BEGIN)) {
        reason = 'updated-managed-block';
        content = existing.replace(new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`), hookBody);
    } else {
        reason = 'appended-managed-block';
        content = existing.trimEnd() + '\n\n' + hookBody + '\n';
    }

    try {
        fsOps.writeFileSync(hookPath, content);
        return { reason, threw: false, phase: 'write' };
    } catch (_) {
        // Bytes may already be on disk. The exception is evidence about the
        // operation; observeInstalled decides the fact.
        return { reason, threw: true, phase: 'write' };
    }
}

// Positive proof that the EXPECTED managed body is established. A thrown write
// has no authority here: bytes can land and the call still throw, so the write's
// exception is evidence about the operation, and this is the fact.
// The provenance producer's OWN post-write observer. It deliberately does not
// call diffInstalledHook: that function opens with `if (!fs.existsSync(hookPath))
// return { status: 'no-hook' }`, and existsSync collapses absent, unreachable and
// wrong-type into one bit. Routing realization through it would let a hook that
// merely became unreadable after the write be recorded as `unrealized` — "I could
// not see it" wearing the clothes of "it is not there", at the single most
// load-bearing point in the contract.
//
// diffInstalledHook keeps its existing status/diff consumers unchanged; this is a
// second, errno-preserving reader for a different question.
function observeInstalled(hookPath, attemptedReason, fsOps = fs) {
    let content;
    try {
        content = fsOps.readFileSync(hookPath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            // Positively absent: the write did not establish the body.
            return { outcome: 'unrealized', reason: 'write-failed' };
        }
        // Every other errno is a failure to observe, never a fact about the file.
        return { outcome: 'indeterminate', reason: 'post-write-observation-failed' };
    }

    const match = content.match(new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`));
    if (match && match[0] === buildHookBody()) {
        return { outcome: 'realized', reason: attemptedReason };
    }
    // The file is readable and the expected body is positively not in it —
    // including a failed update that left an OLDER managed body in place, and a
    // concurrent overwrite between the write and this read.
    return { outcome: 'unrealized', reason: 'write-failed' };
}

// The implementation base's behaviour, character for character, for the one
// topology where the provenance layer declines to participate. It deliberately
// does NOT call writeManagedHook: that helper swallows read and write errors so
// the observation can decide, whereas the base propagates them. Reusing it here
// would quietly change the nested exception's failure semantics, and the frozen
// contract is that legacy behaviour is unchanged — including how it fails.
function legacyInstallPostCommitHook(targetDir) {
    const hooksDir = path.join(targetDir, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    const hookBody = buildHookBody();
    const hookPath = path.join(hooksDir, 'post-commit');

    if (fs.existsSync(hookPath)) {
        let content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes(SENTINEL_BEGIN)) {
            content = content.replace(
                new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`),
                hookBody
            );
        } else {
            content = content.trimEnd() + '\n\n' + hookBody + '\n';
        }
        fs.writeFileSync(hookPath, content);
    } else {
        fs.writeFileSync(hookPath, '#!/bin/sh\n' + hookBody + '\n');
    }
    try { fs.chmodSync(hookPath, '755'); } catch (_) {}
}

function installPostCommitHook(targetDir, options = {}) {
    const participation = options.participation || 'participating';
    const source = options.source || 'scaffold-default';
    const recordedAt = new Date().toISOString();
    const fsOps = options.fsOps || fs;

    // 1. Workspace scope, then owner. Both before any mutation.
    const topo = classifyTopology(targetDir, options.deps);
    if (topo.state === 'NESTED-TARGET') {
        // The sole deliberate out-of-v1-provenance exception. The contract is
        // that legacy installer behaviour is UNCHANGED — not that it becomes a
        // no-op. It usually is one (a nested child has no .git/hooks of its own),
        // but "usually no-op" is a result, not a policy, and turning the result
        // into the policy would silently change behaviour where the directory
        // does exist.
        //
        // The exception covers the loss of PROVENANCE, not the loss of the user's
        // explicit refusal. An opt-out is honoured for the run wherever it is
        // expressed; what nesting costs is only the durable record of it. So
        // participation is checked FIRST — running the installer here would let a
        // topology fact overrule an explicit instruction.
        if (participation === 'participating') legacyInstallPostCommitHook(targetDir);
        return { topology: topo.state, provenance: 'not-attempted', artifactContent: 'not-observed', chmodEvidence: null, event: null };
    }
    if (topo.state === 'NO-GIT-ADMIN-TOPOLOGY') {
        return { topology: topo.state, provenance: 'not-attempted', artifactContent: 'not-observed', chmodEvidence: null, event: null };
    }
    if (topo.state !== 'IN-SCOPE') {
        // SCOPE-UNRESOLVED / OWNER-UNRESOLVED fail closed: a failed observation
        // is not a licence to change the artifact.
        throw new Error(`hook provenance ${topo.state}: ${topo.detail || ''} — hook not modified`);
    }
    fsOps.mkdirSync(topo.ownerRoot, { recursive: true });

    // 2. Read before mutate. An unobservable document stops the run.
    const prior = readProvenance(topo.provenancePath, fsOps);
    if (prior.state === 'UNOBSERVABLE') {
        throw new Error('hook provenance is unobservable; hook not modified');
    }

    const draft = { recordedAt, intent: { participation, source } };
    const hooksDir = path.join(topo.worktreeTop, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'post-commit');
    let artifactContent = 'not-observed';
    let chmodEvidence = null;

    if (participation === 'participating') {
        const dir = observeHooksDir(hooksDir, fsOps);
        if (dir.outcome !== null) {
            draft.install = { outcome: dir.outcome, reason: dir.reason, targetPath: hookPath };
        } else {
            // Taken here, not at the top of the function: a non-participating run
            // must never read the artifact at all, or the code would contradict an
            // interface that says it does not look.
            const preImage = digestFile(hookPath, fsOps);
            const w = writeManagedHook(hookPath, buildHookBody(), fsOps);

            if (w.phase === 'pre-write') {
                // Reading the existing hook failed, so no write was ever issued.
                // Phase-1 outcome: no chmod, no digest, no runnability — and the
                // event is still committed, because the intent that reached this
                // point must not be swallowed by the observation that failed.
                draft.install = { outcome: 'indeterminate', reason: 'pre-write-observation-failed',
                    targetPath: hookPath };
            } else {
                // "A write was attempted" is not "the artifact changed". A write
                // can throw before altering a byte, and reporting `mutated` there
                // would put an unproven fact in the failure message — the same
                // inversion the outcome rules forbid. The artifact dimension is
                // decided by comparing the file before and after, and stays
                // `indeterminate` when either digest could not be taken.
                artifactContent = compareArtifact(preImage, digestFile(hookPath, fsOps));
                let chmodThrew = false;
                try { fsOps.chmodSync(hookPath, '755'); } catch (_) { chmodThrew = true; }
                // Reported on its own axis: chmod can change the artifact without
                // changing a byte, so folding it into artifactContent would make
                // that field claim more than the digests it was derived from.
                chmodEvidence = { issued: true, threw: chmodThrew };

                const observed = observeInstalled(hookPath, w.reason, fsOps);
                draft.install = {
                    outcome: observed.outcome,
                    reason: observed.reason,
                    targetPath: hookPath,
                    chmod: { attempted: true, threw: chmodThrew },
                };
                if (observed.outcome === 'realized') {
                    draft.install.expectedBodyDigest =
                        'sha256:' + crypto.createHash('sha256').update(buildHookBody()).digest('hex');
                    const r = observeRunnability({ targetDir, targetPath: hookPath, fsOps });
                    draft.runnability = r.runnability;
                    draft.diagnostic = r.diagnostic;
                }
            }
        }
    }

    // 3. The rename inside appendEvent is the commit point. Nothing fallible
    //    belonging to this invocation may follow it — including the construction
    //    of this return value. Every name used below is already bound.
    let doc;
    try {
        doc = appendEvent(topo.provenancePath, prior, draft, fsOps);
    } catch (err) {
        // Two orthogonal dimensions, never compressed into one: what the artifact
        // is, and whether the record of it committed.
        const e = new Error(
            `artifact content ${artifactContent}, provenance not committed: ${err.message}`);
        e.artifactContent = artifactContent;
        e.chmodEvidence = chmodEvidence;
        e.provenance = 'failed';
        throw e;
    }
    return {
        topology: topo.state,
        provenance: 'committed',
        artifactContent,
        chmodEvidence,
        event: doc.events[doc.events.length - 1],
    };
}

function parseBooleanOption(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
}

function registerHookCommands(program) {
    const { getWorkspaceRoot } = require('./runtime');
    const memoryService = require('./memory.service');
    const hook = program.command('hook').alias('hooks').description('Git hook management.');

    hook.command('install')
        .description('Install (or upgrade) the post-commit governance hook in .git/hooks/.')
        .option('--explain', 'Print a diff of any change before applying.')
        .action(options => {
            const projectRoot = getWorkspaceRoot();
            if (options.explain) {
                const diff = diffInstalledHook(projectRoot);
                if (diff.status === 'no-hook') {
                    console.log('post-commit: not installed yet; install will create a fresh file.');
                } else if (diff.status === 'in-sync') {
                    console.log('post-commit: already in-sync with templates — install is a no-op.');
                } else if (diff.status === 'no-block') {
                    console.log('post-commit: file exists but contains no evo-lite block; install will append.');
                } else {
                    console.log('post-commit: drift detected. Diff (expected → installed):');
                    console.log(diff.text);
                }
            }

            // The explicit command translates the producer's two dimensions —
            // topology and provenance — into exit semantics itself. It must never
            // let a core throw escape uncaught: SCOPE-UNRESOLVED, OWNER-UNRESOLVED
            // and a post-mutation provenance failure all arrive here as
            // exceptions, and each is a reported, non-zero exit rather than a
            // crash. The error message already carries both dimensions (the
            // artifact fact and the provenance fact) where both apply — see the
            // catch in installPostCommitHook — so no separate discrimination is
            // needed to surface them.
            let result;
            try {
                result = installPostCommitHook(projectRoot, { source: 'hook-install-command' });
            } catch (err) {
                console.error(`Hook install failed: ${err.message}`);
                process.exitCode = 1;
                return;
            }

            if (result.topology === 'NO-GIT-ADMIN-TOPOLOGY') {
                console.error('No .git/hooks/ directory found. Is this a git repository?');
                process.exitCode = 1;
                return;
            }

            const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
            console.log(`Post-commit hook installed: ${hookPath}`);
            console.log('Hook will auto-refresh governance data after commits, including code-only commits that need plan gap checks.');
        });

    hook.command('status')
        .description('Check whether the post-commit governance hook is installed.')
        .action(() => {
            const result = diffInstalledHook(getWorkspaceRoot());
            if (result.status === 'no-hook') {
                console.log('post-commit: not installed');
                console.log('  install: mem hook install');
                process.exitCode = 1;
                return;
            }
            if (result.status === 'no-block') {
                console.log('post-commit: exists (third-party, no evo-lite block)');
                console.log('  install: mem hook install  (will append without overwriting)');
                // Deliberate behavior change: unmanaged third-party hooks are not
                // healthy Evo-Lite status, even though install will append safely.
                process.exitCode = 1;
                return;
            }
            if (result.status === 'in-sync') {
                console.log('post-commit: evo-lite hook installed and current');
                return;
            }
            // diffInstalledHook intentionally uses exact artifact equality. A CRLF
            // rewrite of this shell hook is drift, not an ignorable text variant.
            console.log('post-commit: evo-lite hook installed but OUTDATED');
            console.log('  inspect: mem hook diff');
            console.log('  update: mem hook install');
            process.exitCode = 1;
        });

    hook.command('advise <event>')
        .description('Inspect Evo-Lite lifecycle advice for hook wrappers.')
        .option('--tool <name>', 'Tool name')
        .option('--command <text>', 'Command text')
        .option('--output <text>', 'Observed output text')
        .option('--success <boolean>', 'Whether the wrapped tool succeeded')
        .option('--target <path>', 'Touched target path', (value, previous) => {
            previous.push(value);
            return previous;
        }, [])
        .option('--json', 'Print JSON output')
        .action((event, options) => {
            const report = memoryService.inspectHookLifecycle(event, {
                command: options.command || '',
                output: options.output || '',
                success: parseBooleanOption(options.success),
                targets: options.target || [],
                tool: options.tool || '',
            });

            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(`event: ${event}`);
                console.log(`blocked: ${report.blocked ? 'yes' : 'no'}`);
                if (options.tool) {
                    console.log(`tool: ${options.tool}`);
                }
                if (options.command) {
                    console.log(`command: ${options.command}`);
                }
                for (const reminder of report.reminders || []) {
                    console.log(`reminder: ${reminder}`);
                }
                for (const warning of report.warnings || []) {
                    console.log(`warning: ${warning}`);
                }
            }

            if (report.blocked) {
                process.exitCode = 2;
            }
        });

    hook.command('diff')
        .description('Compare installed post-commit hook body to current templates expected body.')
        .option('--json', 'Print JSON output.')
        .action(options => {
            const result = diffInstalledHook(getWorkspaceRoot());
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else if (result.status === 'no-hook') {
                console.log('post-commit: not installed. Run `mem hook install`.');
                process.exitCode = 1;
            } else if (result.status === 'no-block') {
                console.log('post-commit: present but no evo-lite block. Run `mem hook install` to append.');
                process.exitCode = 1;
            } else if (result.status === 'in-sync') {
                console.log('post-commit: in-sync with templates.');
            } else {
                console.log('post-commit: drifted from templates.');
                console.log(result.text);
                process.exitCode = 1;
            }
        });

    hook.command('last')
        .description('Pretty-print the last post-commit-last-run.json (commit, categories, command results).')
        .option('--json', 'Emit raw JSON.')
        .action(options => {
            const projectRoot = getWorkspaceRoot();
            const reportPath = path.join(projectRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json');
            if (!fs.existsSync(reportPath)) {
                console.log('No post-commit-last-run.json yet. Make a commit to populate it.');
                process.exitCode = 1;
                return;
            }
            const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            if (options.json) {
                console.log(JSON.stringify(payload, null, 2));
                return;
            }
            console.log(`commit: ${payload.commit}`);
            console.log(`categories: ${(payload.categories || []).join(', ') || '<none>'}`);
            console.log(`ok: ${payload.ok}`);
            console.log(`changedFiles (${(payload.changedFiles || []).length}):`);
            for (const f of (payload.changedFiles || []).slice(0, 20)) console.log(`  ${f}`);
            if ((payload.changedFiles || []).length > 20) {
                console.log(`  …and ${(payload.changedFiles || []).length - 20} more`);
            }
            console.log('commands:');
            for (const cmd of payload.commands || []) {
                const mark = cmd.ok ? '✓' : '✗';
                console.log(`  ${mark} ${cmd.name}`);
            }
        });
}

function diffInstalledHook(projectRoot) {
    const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
    if (!fs.existsSync(hookPath)) {
        return { status: 'no-hook' };
    }
    const content = fs.readFileSync(hookPath, 'utf8');
    if (!content.includes(SENTINEL_BEGIN)) {
        return { status: 'no-block' };
    }
    const match = content.match(new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`));
    const installed = match ? match[0] : '';
    const expected = buildHookBody();
    if (installed === expected) {
        return { status: 'in-sync' };
    }
    const expectedLines = expected.split('\n');
    const installedLines = installed.split('\n');
    const text = [];
    const maxLines = Math.max(expectedLines.length, installedLines.length);
    for (let i = 0; i < maxLines; i += 1) {
        const e = expectedLines[i];
        const a = installedLines[i];
        if (e === a) continue;
        if (e !== undefined) text.push(`- expected[${i}]: ${e}`);
        if (a !== undefined) text.push(`+ installed[${i}]: ${a}`);
    }
    return { status: 'drifted', text: text.join('\n') };
}

module.exports = { installPostCommitHook, registerHookCommands, diffInstalledHook, buildHookBody };
