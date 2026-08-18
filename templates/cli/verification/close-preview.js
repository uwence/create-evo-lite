'use strict';

const fs = require('fs');
const path = require('path');
const { loadValidatedContract, validationIdentityOf } = require('./validate-contract');
const { parseFrontmatter, parseSpecFile, resolveLinkedPlanIds, countTrackedUncheckedBoxes } = require('../planning/parse-markdown');

function remedyFor(verdict, verifierType) {
    if (verdict === 'FAIL') return 'verifier failed — fix the underlying issue, then re-run';
    const machine = verifierType !== 'manual';
    if (verdict === 'STALE') return 'dependsOn changed — re-run `mem verify-contract run <spec>`';
    if (verdict === 'UNVERIFIED') {
        return machine
            ? 'run `mem verify-contract run <spec>` on a clean HEAD'
            : 'attest: `mem verify-contract attest <spec> <criterionId> --by <name>`';
    }
    return 'resolve the criterion';
}

function defaultPlanState(root, linkedPlanId) {
    const empty = { planId: linkedPlanId, found: false, tasksTotal: 0, tasksImplemented: 0, uncheckedBoxes: 0 };
    try {
        const ir = JSON.parse(fs.readFileSync(
            path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), 'utf8'));
        const plan = (ir.plans || []).find(p => p.id === linkedPlanId);
        if (!plan) return empty;
        const taskIds = plan.taskIds || [];
        const tasksImplemented = (ir.tasks || []).filter(t => taskIds.includes(t.id) && t.status === 'implemented').length;
        let uncheckedBoxes = 0;
        if (plan.sourcePath) {
            try {
                const txt = fs.readFileSync(path.join(root, plan.sourcePath), 'utf8');
                // Tracked unchecked count from the shared scanner — the same
                // question apply asks when it rewrites. Counting raw `- [ ] `
                // matches promised flips for prose and fenced examples.
                uncheckedBoxes = countTrackedUncheckedBoxes(txt);
            } catch (_) { /* plan file unreadable */ }
        }
        return { planId: linkedPlanId, found: true, planPath: plan.sourcePath, planStatus: plan.status,
            tasksTotal: taskIds.length, tasksImplemented, uncheckedBoxes };
    } catch (_) {
        return empty;
    }
}

function loadPlanIr(root) {
    try {
        return JSON.parse(fs.readFileSync(
            path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), 'utf8'));
    } catch (_) {
        return { plans: [] };
    }
}

// Collection-level resolution. previewClose used to pass a single
// frontmatter.linkedPlan into defaultPlanState, which meant closure could not see
// body-declared links or plan-ir back-references at all — six of fifteen specs
// here are linked only by one of those. It also cannot represent a spec with more
// than one plan, and this repository has one.
//
// The singular defaultPlanState stays as the per-plan lookup primitive.
function defaultPlanStates(root, specPath) {
    const planIr = loadPlanIr(root);
    let parsed = null;
    try { parsed = parseSpecFile(specPath); } catch (_) { parsed = null; }
    const planIds = resolveLinkedPlanIds(parsed, planIr);

    const plans = planIds.map(id => defaultPlanState(root, id));
    // A linked plan the transaction cannot act on is not the same as a spec with
    // no plans: apply must refuse rather than close a spec whose linked plans it
    // could not all resolve. Readiness is untouched — that stays criteria-only.
    //
    // Two ways to be unactionable, and `found` alone only catches the first:
    //   - no record in the planning IR
    //   - a record with no sourcePath, so there is no file to mutate
    // The second is the dangerous one. `found: true` made it look resolved while
    // apply's `!!p.planPath` filter silently dropped it, producing exactly the
    // half-closed state this guards against: spec done, that plan untouched.
    const unresolvedPlanIds = plans.filter(p => !p.found || !p.planPath).map(p => p.planId);
    return { planIds, plans, unresolvedPlanIds };
}

// The authoritative closure readiness, and nothing else. Split out of
// previewClose so a consumer that only needs the verdict — R011 — does not
// have to touch plan state or the mutation action list to get it.
//
// It returns contractStatus rather than prose: an authority accessor states
// what is true, and leaves how to phrase the next step to its caller.
//
// It deliberately does NOT catch. An unreadable evidence store must reach the
// caller: this function cannot know whether its caller wants to fail a
// command or degrade a census, and guessing would turn "I could not look"
// into "there is nothing there" — the exact impersonation this project
// forbids.
function readinessOf(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const specText = fs.readFileSync(specPath, 'utf8');
    const contract = loadValidatedContract(specText);
    const typeById = {};
    for (const c of contract.criteria) typeById[c.id] = c.verifier && c.verifier.type;

    if (!contract.ok) {
        return {
            readiness: 'BLOCKED', contractStatus: 'invalid', contractPresent: true, criteria: [],
            validationIdentity: validationIdentityOf(contract),
            blockers: contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', remedy: f.message })),
        };
    }
    if (contract.noContract) {
        return {
            readiness: 'NO-CONTRACT', contractStatus: 'absent', contractPresent: false,
            criteria: [], blockers: [],
        };
    }

    const statusFn = opts.statusFn || function (sp) { return require('./engine').statusSpec(sp, { root }); };
    const verdicts = statusFn(specPath);
    const blockers = verdicts.filter(v => v.verdict !== 'PASS').map(v => ({
        criterionId: v.criterionId, verdict: v.verdict, remedy: remedyFor(v.verdict, typeById[v.criterionId]),
    }));
    return {
        readiness: blockers.length ? 'BLOCKED' : 'READY',
        contractStatus: 'valid', contractPresent: true, criteria: verdicts, blockers,
    };
}

function previewClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const specText = fs.readFileSync(specPath, 'utf8');
    const fm = parseFrontmatter(specText).frontmatter || {};

    // planStateFn stays supported for the singular injection existing tests use;
    // it is wrapped into the collection shape so every consumer sees one shape.
    const planState = opts.planStatesFn
        ? opts.planStatesFn(root, specPath)
        : (opts.planStateFn
            ? (() => {
                const one = opts.planStateFn(root, fm.linkedPlan);
                return {
                    planIds: one && one.planId ? [one.planId] : [],
                    plans: one ? [one] : [],
                    unresolvedPlanIds: one && one.planId && !one.found ? [one.planId] : [],
                };
            })()
            : defaultPlanStates(root, specPath));

    // Advisory only — NEVER affects readiness. criteria-all-PASS stays the sole
    // hard gate. Warnings are per plan so two incomplete plans cannot collapse
    // into one line and hide each other.
    const warnings = [];
    for (const p of planState.plans) {
        if (p.found && p.tasksImplemented < p.tasksTotal) {
            warnings.push({ kind: 'tasks-incomplete', planId: p.planId,
                message: `${p.planId} — ${p.tasksTotal - p.tasksImplemented} of ${p.tasksTotal} linked tasks are not implemented — closing will mark the spec done anyway` });
        }
    }
    // One wording for both routes to unresolvable — a missing IR record and a
    // record without a sourcePath. Naming only the first would be false for the
    // second, and a refusal that misstates its own cause sends the operator
    // looking in the wrong place.
    for (const id of planState.unresolvedPlanIds) {
        warnings.push({ kind: 'linked-plan-unresolved', planId: id,
            message: `${id} — linked plan cannot be resolved to an actionable source file; apply cannot execute an atomic closure` });
    }

    // Every file apply would touch is named. An aggregate count would leave a
    // reviewer unable to tell which plans are about to be rewritten.
    const actions = [];
    let totalTasks = 0;
    for (const p of planState.plans) {
        totalTasks += p.tasksTotal || 0;
        if (!p.found) continue;
        const target = p.planPath || p.planId;
        if (p.uncheckedBoxes > 0) {
            actions.push(`flip ${p.uncheckedBoxes} unchecked checkbox(es) + set ${p.planId} status: done in ${target}`);
        } else if (p.planStatus && p.planStatus !== 'done') {
            actions.push(`set ${p.planId} status: done in ${target}`);
        }
    }
    if (fm.status !== 'done') actions.push('set spec status: done');
    if (totalTasks > 0) actions.push(`backfill R008 evidence for ${totalTasks} task(s)`);

    const r = readinessOf(specPath, { root, statusFn: opts.statusFn });

    // The note is previewClose's own voice, kept verbatim. readinessOf reports
    // contractStatus; phrasing the operator's next step is not an authority's job.
    // NO-CONTRACT also keeps its historical empty action list while the invalid
    // branch keeps its populated one — preserved deliberately, T38 pins it.
    if (r.contractStatus === 'absent') {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions: [], warnings,
            note: 'no machine-readable acceptance criteria — add a criteria block for a real gate, or close manually' };
    }
    if (r.contractStatus === 'invalid') {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions, warnings,
            note: 'contract is invalid — fix the criteria block (mem verify-contract lint <spec>)' };
    }
    return { readiness: r.readiness, criteria: r.criteria, plan: planState,
        blockers: r.blockers, actions, warnings };
}

module.exports = { previewClose, readinessOf, remedyFor, defaultPlanState, defaultPlanStates };
