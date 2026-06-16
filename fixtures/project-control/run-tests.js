'use strict';

// Fixture test runner for planning scanner + drift rules.
// Usage: node fixtures/project-control/run-tests.js

const path = require('path');
const { scanPlanning } = require('../../templates/cli/planning/scan');
const { runPlanningDrift } = require('../../templates/cli/planning/gaps');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
        failed++;
    }
}

function suite(name, fn) {
    console.log(`\n[${name}]`);
    fn();
}

// ── simple-plans ──────────────────────────────────────────────────────────────
suite('simple-plans', () => {
    const root = path.join(__dirname, 'simple-plans');
    const ir = scanPlanning(root);

    assert('finds 1 spec', ir.specs.length === 1, `got ${ir.specs.length}`);
    assert('spec id correct', ir.specs[0].id === 'spec:widget');
    assert('spec has 1 linked plan', ir.specs[0].linkedPlans.length === 1);
    assert('finds 1 plan', ir.plans.length === 1, `got ${ir.plans.length}`);
    assert('plan id correct', ir.plans[0].id === 'plan:widget-mvp');
    assert('plan linkedSpec correct', ir.plans[0].linkedSpec === 'spec:widget');
    assert('finds 2 tasks', ir.tasks.length === 2, `got ${ir.tasks.length}`);

    const scaffold = ir.tasks.find(t => t.id === 'task:widget-scaffold');
    assert('scaffold task exists', !!scaffold);
    assert('scaffold status implemented', scaffold && scaffold.status === 'implemented');
    assert('scaffold linkedFiles', scaffold && scaffold.linkedFiles.includes('src/widget.js'));
    assert('scaffold evidence', scaffold && scaffold.evidence.includes('git:abc1234'));

    const tests = ir.tasks.find(t => t.id === 'task:widget-tests');
    assert('tests task exists', !!tests);
    assert('tests status todo', tests && tests.status === 'todo');
});

// ── superpowers-layout ────────────────────────────────────────────────────────
suite('superpowers-layout', () => {
    const root = path.join(__dirname, 'superpowers-layout');
    const ir = scanPlanning(root);

    assert('finds 1 spec', ir.specs.length === 1, `got ${ir.specs.length}`);
    assert('spec id correct', ir.specs[0].id === 'spec:feature');
    assert('spec links to plan via frontmatter', ir.specs[0].linkedPlans.includes('plan:feature'));

    assert('finds 1 plan', ir.plans.length === 1, `got ${ir.plans.length}`);
    assert('plan id derived from filename', ir.plans[0].id === 'plan:feature');

    assert('finds 2 tasks', ir.tasks.length === 2, `got ${ir.tasks.length}`);

    const t1 = ir.tasks.find(t => t.id === 'task:feature-t1');
    assert('task 1 exists', !!t1);
    assert('task 1 status implemented (all steps done)', t1 && t1.status === 'implemented');
    assert('task 1 linkedFiles', t1 && t1.linkedFiles.includes('src/feature.js'));

    const t2 = ir.tasks.find(t => t.id === 'task:feature-t2');
    assert('task 2 exists', !!t2);
    assert('task 2 status todo (steps not done)', t2 && t2.status === 'todo');
});

// ── no-plan ───────────────────────────────────────────────────────────────────
suite('no-plan', () => {
    const root = path.join(__dirname, 'no-plan');
    const ir = scanPlanning(root);

    assert('finds 1 spec', ir.specs.length === 1, `got ${ir.specs.length}`);
    assert('finds 0 plans', ir.plans.length === 0, `got ${ir.plans.length}`);
    assert('finds 0 tasks', ir.tasks.length === 0, `got ${ir.tasks.length}`);

    // no-plan should not trigger R004 (docs/plans dir exists but has no files)
    // but R003/R004 checks dirs; since no plans dir exists at all, R004 fires
    const findings = runPlanningDrift(root, ir);
    const r004 = findings.find(f => f.rule === 'R004');
    assert('R004 fires (no plans dir)', !!r004);
});

// ── with-drift ────────────────────────────────────────────────────────────────
suite('with-drift', () => {
    const root = path.join(__dirname, 'with-drift');
    const ir = scanPlanning(root);

    assert('finds 1 spec', ir.specs.length === 1);
    assert('finds 1 plan', ir.plans.length === 1);
    assert('finds 2 tasks', ir.tasks.length === 2, `got ${ir.tasks.length}`);

    const findings = runPlanningDrift(root, ir);

    const r005 = findings.filter(f => f.rule === 'R005');
    assert('R005 fires for no-files-task', r005.some(f => f.id.includes('no-files-task')));

    const r008 = findings.filter(f => f.rule === 'R008');
    assert('R008 fires for no-evidence-task', r008.some(f => f.id.includes('no-evidence-task')));

    const r011 = findings.filter(f => f.rule === 'R011');
    assert('R011 fires (all tasks implemented but spec not done)', r011.length > 0);
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
