'use strict';

const fs = require('fs');
const path = require('path');
const { loadValidatedContract } = require('./validate-contract');
const { parseFrontmatter } = require('../planning/parse-markdown');

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
                uncheckedBoxes = (txt.match(/^- \[ \] /gm) || []).length;
            } catch (_) { /* plan file unreadable */ }
        }
        return { planId: linkedPlanId, found: true, planPath: plan.sourcePath, planStatus: plan.status,
            tasksTotal: taskIds.length, tasksImplemented, uncheckedBoxes };
    } catch (_) {
        return empty;
    }
}

function previewClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const specText = fs.readFileSync(specPath, 'utf8');
    const fm = parseFrontmatter(specText).frontmatter || {};
    const contract = loadValidatedContract(specText);
    const typeById = {};
    for (const c of contract.criteria) typeById[c.id] = c.verifier && c.verifier.type;

    const planState = (opts.planStateFn || defaultPlanState)(root, fm.linkedPlan);

    // Advisory only — NEVER affects readiness. criteria-all-PASS stays the sole hard gate.
    const warnings = [];
    if (planState.found && planState.tasksImplemented < planState.tasksTotal) {
        warnings.push({ kind: 'tasks-incomplete',
            message: `${planState.tasksTotal - planState.tasksImplemented} of ${planState.tasksTotal} linked tasks are not implemented — closing will mark the spec done anyway` });
    }

    const actions = [];
    if (planState.uncheckedBoxes > 0) {
        actions.push(`flip ${planState.uncheckedBoxes} unchecked checkbox(es) in ${planState.planPath || fm.linkedPlan}`);
    }
    if (fm.status !== 'done') actions.push('set spec status: done');
    if (planState.tasksTotal > 0) actions.push(`backfill R008 evidence for ${planState.tasksTotal} task(s)`);

    // Malformed contract (present but invalid) → fail-closed, never READY.
    if (!contract.ok) {
        return {
            readiness: 'BLOCKED', criteria: [], plan: planState, actions, warnings,
            blockers: contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', remedy: f.message })),
            note: 'contract is invalid — fix the criteria block (mem verify-contract lint <spec>)',
        };
    }

    if (contract.noContract) {
        return {
            readiness: 'NO-CONTRACT', criteria: [], plan: planState, blockers: [], actions: [], warnings,
            note: 'no machine-readable acceptance criteria — add a criteria block for a real gate, or close manually',
        };
    }

    const statusFn = opts.statusFn || function (sp) { return require('./engine').statusSpec(sp, { root }); };
    const verdicts = statusFn(specPath);
    const blockers = verdicts.filter(v => v.verdict !== 'PASS').map(v => ({
        criterionId: v.criterionId, verdict: v.verdict, remedy: remedyFor(v.verdict, typeById[v.criterionId]),
    }));
    return { readiness: blockers.length ? 'BLOCKED' : 'READY', criteria: verdicts, plan: planState, blockers, actions, warnings };
}

module.exports = { previewClose, remedyFor, defaultPlanState };
