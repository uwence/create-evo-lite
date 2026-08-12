'use strict';

const { readLedger, writeLedger, upsertEntry, CHOICES, dispositionsDirty } = require('./ledger');
const { computeFingerprint } = require('./fingerprint');

// FROZEN OBSERVATION MODE: every disposition command reads the COMMITTED
// observation (`lastCommit: true`). set, sync and list must share one id space
// — otherwise a user dispositions the `R006:file:x` they can see in the working
// tree while the CLI resolves and stores the fingerprint of HEAD's occurrence,
// i.e. a decision about a different event. Working-tree findings stay visible
// in ordinary `plan gaps` output; they simply never enter governance decisions.
const OBSERVATION = Object.freeze({ lastCommit: true });

// Parsing is not validating. `{}` is valid JSON and would sail through
// `!planIR`, and `scanPlanning()` emits a perfectly well-formed evo-plan-ir@1
// even when individual specs or plans FAILED to parse — it records those as
// `level:'error'` warnings. Either case would let sync tombstone from a census
// that never actually completed.
function safeLoadPlanIR(projectRoot) {
    const fs = require('fs'); const path = require('path');
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(irPath)) return { planIR: null, error: 'plan-ir.json is missing — run `mem plan scan`' };

    let ir;
    try {
        ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
    } catch (err) {
        // Must degrade the census, never escape — an unhandled throw here would
        // skip the fail-closed guard entirely.
        return { planIR: null, error: `plan-ir.json is unreadable: ${err && err.message ? err.message : String(err)}` };
    }
    if (!ir || ir.version !== 'evo-plan-ir@1') {
        return { planIR: null, error: `plan-ir.json version mismatch: ${ir && ir.version}` };
    }
    if (!Array.isArray(ir.specs) || !Array.isArray(ir.plans) || !Array.isArray(ir.tasks)) {
        return { planIR: null, error: 'plan-ir.json is missing its specs/plans/tasks arrays' };
    }
    // Same classification as the spec census (Task 4): `level:'error'` means a
    // spec or plan that was MEANT to parse blew up, so entries derived from it
    // are missing. `level:'warning'` covers the expected id-less compatibility
    // docs and must not block — gating on those would lock sync forever.
    const fatal = (ir.warnings || []).filter(w => w && w.level === 'error');
    if (fatal.length) {
        // The IR is still returned: its findings remain useful for reporting.
        // Only the ability to TOMBSTONE is withdrawn.
        return { planIR: ir, error: `plan-ir has ${fatal.length} fatal scan error(s): ${fatal[0].message}` };
    }
    return { planIR: ir, error: null };
}

function collectAllFindings(projectRoot) {
    const errors = [];
    let raw = [];
    let complete = true;

    const { buildSpecRegistry } = require('../spec-portfolio');
    const reg = buildSpecRegistry(projectRoot, { write: false });
    raw = raw.concat(reg.specs.flatMap(s => s.findings || []));
    if (!reg.census.complete) { complete = false; errors.push(...reg.census.errors); }

    const { runPlanningDriftCensus } = require('../planning/gaps');
    const { planIR, error } = safeLoadPlanIR(projectRoot);
    if (error) { complete = false; errors.push(error); }
    const census = runPlanningDriftCensus(projectRoot, planIR, OBSERVATION);
    raw = raw.concat(census.findings);
    if (!census.complete) { complete = false; errors.push(...census.errors); }

    // Annotate HERE, once, through the shared resolver. Spec findings arrive
    // already annotated by buildSpecRegistry; planning findings do not, and
    // letting the CLI infer status from "does .disposition exist?" would report
    // every CURRENT planning decision as stale.
    let ledger = { version: 'evo-disposition-ledger@1', entries: [] };
    try { ledger = readLedger(projectRoot); } catch (_) { /* reporting must survive a bad ledger */ }
    const { annotate } = require('./resolve');
    const findings = raw.map(f => ('disposition' in f ? f : annotate(f, ledger)));

    return { findings, complete, errors };
}

function registerDispositionCommands(program) {
    // getWorkspaceRoot lives in runtime.js; there is no paths.js in this repo.
    const root = () => require('../runtime').getWorkspaceRoot();
    const cmd = program.command('disposition').description('Governance decisions on findings.');

    cmd.command('set <findingId>')
        .requiredOption('--choice <choice>')
        .requiredOption('--reason <text>')
        .option('--until <text>')
        .action((findingId, opts) => {
            // CHOICES is a frozen ARRAY, not a Set — see Task 2's amendment note.
            // `.has()` here would be a TypeError.
            if (!CHOICES.includes(opts.choice)) {
                throw new Error(`--choice must be one of: ${CHOICES.join(', ')}`);
            }
            if (!String(opts.reason || '').trim()) throw new Error('--reason must not be empty');
            if (opts.choice === 'deferred' && !String(opts.until || '').trim()) {
                throw new Error('--until is required for deferred: a deferral without a reopening condition is an accepted debt wearing a nicer word');
            }
            const projectRoot = root();
            const { findings } = collectAllFindings(projectRoot);
            const finding = findings.find(f => f.id === findingId);
            if (!finding) throw new Error(`no such finding is currently emitted: ${findingId}`);
            if (finding.dispositionable === false) {
                throw new Error(`${findingId} has no stable occurrence identity and cannot be dispositioned`);
            }
            // WORKING-TREE SHADOW GUARD. The committed census is the id space,
            // but the SAME findingId can exist right now as a different
            // occurrence in the working tree — and `plan gaps` shows that one by
            // default. A user reading it would `set` this id and silently
            // disposition the committed event instead. Refuse until the
            // ambiguity is resolved; the fix is one commit away.
            if (finding.ruleId === 'R006') {
                const { runPlanningDriftCensus } = require('../planning/gaps');
                const { planIR } = safeLoadPlanIR(projectRoot);
                // Fail CLOSED, not open: if the working-tree check itself cannot be
                // performed (plan-ir.json vanished or became unreadable between the
                // committed-census read above and this one), that is not the same as
                // "no shadow" — checkR006 short-circuits to [] on a null planIR, which
                // would otherwise let this guard silently pass and bind the decision
                // to the committed occurrence, the exact failure it exists to prevent.
                if (!planIR) {
                    throw new Error(`${findingId} cannot be dispositioned — the working tree shadow `
                        + 'check could not be completed (plan-ir.json is missing or unreadable); '
                        + 'run `mem plan scan` and try again');
                }
                const shadow = runPlanningDriftCensus(projectRoot, planIR, {})   // worktree mode
                    .findings.find(f => f.id === findingId);
                if (shadow) {
                    throw new Error(`${findingId} also has an uncommitted change in the working tree — `
                        + 'commit or revert it first, so the decision binds to exactly one occurrence');
                }
            }
            let head = null;
            try {
                head = require('child_process').execFileSync('git', ['rev-parse', 'HEAD'],
                    { cwd: projectRoot, encoding: 'utf8' }).trim();
            } catch (_) { /* not a git repo */ }
            const ledger = upsertEntry(readLedger(projectRoot), {
                findingId, ruleId: finding.ruleId, ruleVersion: finding.ruleVersion,
                fingerprint: computeFingerprint(finding),   // never from the caller
                choice: opts.choice, reason: opts.reason,
                until: opts.until || null, at: new Date().toISOString(),
                head,   // provenance only — never part of the fingerprint
            });
            writeLedger(projectRoot, ledger);
            console.log(`✅ ${findingId} → ${opts.choice}`);
        });

    cmd.command('revoke <findingId>').action((findingId) => {
        const projectRoot = root();
        const ledger = readLedger(projectRoot);
        const entries = ledger.entries.filter(e => e.findingId !== findingId);
        if (entries.length === ledger.entries.length) {
            throw new Error(`no disposition entry exists: ${findingId}`);
        }
        writeLedger(projectRoot, { version: ledger.version, entries });
        console.log(`✅ revoked ${findingId}`);
    });

    cmd.command('sync')
        .description('Tombstone entries proven absent from a complete census.')
        .action(() => {
            const projectRoot = root();
            const { findings, complete, errors } = collectAllFindings(projectRoot);

            // Fail-closed, WHOLE ROUND. Partial credit is indistinguishable from
            // partial evidence, and tombstoning is terminal: a wrong one destroys
            // a governance decision permanently. Absence seen through a degraded
            // round is an OBSERVATION failure, not a fact change — the entry stays
            // exactly as it was and the round says so out loud.
            if (!complete) {
                console.log('⚠️ disposition sync degraded — no tombstone written this round');
                for (const e of errors) console.log(`   ${e}`);
                return;
            }

            const { classifyEntry } = require('./resolve');
            // A real Set, so `.has()` inside classifyEntry is correct — unlike
            // CHOICES, which is a frozen ARRAY.
            const emitted = new Set(findings.map(f => f.id));
            const ledger = readLedger(projectRoot);
            let head = null;
            try {
                head = require('child_process')
                    .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
            } catch (_) { /* not a git repo — tombstone without a head reference */ }

            let n = 0;
            const entries = ledger.entries.map((e) => {
                // Membership is decided by the shared resolver, never re-derived
                // here. The `e.orphanedAt` short-circuit is what makes a tombstone
                // TERMINAL and this command IDEMPOTENT: without it every later run
                // would re-stamp orphanedAt, overwriting the date a governance
                // decision actually closed with "whenever the hook last fired".
                if (e.orphanedAt || classifyEntry(e, emitted) !== 'orphaned') return e;
                n += 1;
                const tombstoned = { ...e, orphanedAt: new Date().toISOString() };
                // orphanedHead is ADDED only when there is a head to record.
                // readLedger fails closed on a present-but-non-string
                // orphanedHead, so writing `orphanedHead: null` outside a git repo
                // would produce a ledger the very next read refuses — the whole
                // governance file bricked by its own tombstone.
                if (head) tombstoned.orphanedHead = head;
                return tombstoned;
            });
            if (n > 0) writeLedger(projectRoot, { version: ledger.version, entries });
            console.log(`✅ disposition sync: ${n} tombstoned`);
            // Deliberately no `git add` / `git commit`: implicit git mutation from a
            // hook is a worse defect than the window it would close. `list` already
            // reports that window through dispositionsDirty().
        });

    cmd.command('list').option('--stale').option('--json').action((opts) => {
        const projectRoot = root();
        // findings are already annotated by collectAllFindings — status is READ
        // from the shared resolver's verdict, never inferred here.
        const { findings, complete, errors } = collectAllFindings(projectRoot);
        const byId = new Map(findings.map(f => [f.id, f]));
        let rows = readLedger(projectRoot).entries.map((e) => {
            if (e.orphanedAt) return { ...e, status: 'orphaned' };
            const f = byId.get(e.findingId);
            if (f) return { ...e, status: f.disposition ? f.disposition.status : 'stale' };
            // Not observed this round. Calling that `orphaned` would be the same
            // fail-open the whole B4 amendment exists to prevent: ORPHANED means
            // a COMPLETE census proved absence, not that a degraded one missed it.
            return { ...e, status: complete ? 'orphaned' : 'unobserved' };
        });
        if (opts.stale) rows = rows.filter(r => r.status === 'stale');
        if (opts.json) {
            console.log(JSON.stringify({ complete, errors, entries: rows }, null, 2));
            return;
        }
        if (!complete) {
            console.log('⚠️ census degraded — 未观察到的条目按 unobserved 处理，不判定为 orphaned');
            for (const e of errors) console.log(`   ${e}`);
        }
        if (dispositionsDirty(projectRoot)) {
            console.log('⚠️ dispositions.json 有未提交改动 — tombstone 尚未持久化，其他机器看不到');
        }
        for (const r of rows) {
            console.log(`${r.status.padEnd(10)} ${r.choice.padEnd(15)} ${r.findingId}`
                + (r.until ? `  — until ${r.until}` : ''));
        }
    });
}

module.exports = { registerDispositionCommands, collectAllFindings };
