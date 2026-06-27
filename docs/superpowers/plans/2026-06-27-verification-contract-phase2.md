---
id: plan:verification-contract-phase2
linkedSpec: spec:verification-contract-phase2
---

# Verification Contract Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mem close --preview <spec>` — a read-only closure-readiness report
(READY / BLOCKED / NO-CONTRACT) gated on the spec's acceptance criteria all being
PASS at HEAD, with per-blocker remedies and the action list `--apply` would run.

**Architecture:** One pure judgment module `close-preview.js` (`previewClose`,
reusing Phase 1 `statusSpec` + the planning IR via injectable seams) and a thin
`close-commands.js` Commander surface mounted in `memory.js`. Read-only: mutates
no files. `--apply` is Phase 3.

**Tech Stack:** Node.js (CommonJS), reuses `statusSpec`/`parseSpecCriteria`/
`parseFrontmatter` + `plan-ir.json`, the `node ./.evo-lite/cli/test.js governance`
runner, the `templates/cli → .evo-lite/cli` mirror flow.

## Global Constraints

- No new npm dependencies (RUNTIME_DEPENDENCIES unchanged).
- Reuse unchanged: `statusSpec` (`engine.js`), `parseSpecCriteria`/`parseFrontmatter`, `plan-ir.json`. Do NOT modify Phase 0/1 modules or the drift engine.
- **Read-only:** `previewClose` and `mem close --preview` MUST NOT write or mutate any file.
- **Three readiness states:** `NO-CONTRACT` (zero criteria), `BLOCKED` (≥1 criteria, not all PASS), `READY` (≥1 criteria, all PASS). The criteria gate is the only hard gate; plan checkboxes / spec status / R008 are reported as the action list, never preconditions.
- New `templates/cli/**` files MUST be registered in `template-manifest.js`. After registering, run `node ./.evo-lite/cli/memory.js sync-runtime` 2–3×; if a CLI call dies with `Cannot find module`, hand-copy: `cp templates/cli/verification/<f> .evo-lite/cli/verification/<f>`.
- Governance tests (T38+) run via `node ./.evo-lite/cli/test.js governance`, use fixture specs, and inject `statusFn`/`planStateFn` so no real verifiers or git run.

---

### Task 1: close-preview.js — previewClose readiness judgment

**Files:**
- Create: `templates/cli/verification/close-preview.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `parseSpecCriteria`/`parseFrontmatter` (Phase 0), `statusSpec` (Phase 1, default `statusFn`), `plan-ir.json` (default `planStateFn`).
- Produces: `previewClose(specPath, opts) -> { readiness, criteria, plan, blockers, actions, note? }`. `opts`: `{ root?, statusFn?(specPath)->verdicts[], planStateFn?(root, linkedPlanId)->planState }`. `blockers`: `[{ criterionId, verdict, remedy }]`. `actions`: `string[]`. Also exports `remedyFor(verdict, verifierType)`.

- [ ] **Step 1: Write the failing test (T38)**

Add after the T37 block in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T38. Testing previewClose readiness (READY/BLOCKED/NO-CONTRACT) ...');
{
    const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-close-'));
    try {
        const writeSpec = (name, criteriaJson, status) => {
            const p = path.join(root, name);
            fs.writeFileSync(p, [
                '---', 'id: spec:t', `status: ${status || 'draft'}`, 'linkedPlan: plan:t', '---', '',
                '# T', '', '## Acceptance Criteria', '', '```json', criteriaJson, '```', '',
            ].join('\n'));
            return p;
        };
        const oneCmd = '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }';
        const oneManual = '{ "criteria": [ { "id": "ac-m", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "r" } } } ] }';
        const planStateFn = () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', planStatus: 'draft', tasksTotal: 2, tasksImplemented: 0, uncheckedBoxes: 4 });

        // READY: one criterion, PASS.
        const ready = previewClose(writeSpec('ready.md', oneCmd), {
            root, planStateFn, statusFn: () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }] });
        assert.strictEqual(ready.readiness, 'READY', 'all PASS → READY');
        assert.strictEqual(ready.blockers.length, 0, 'no blockers when READY');
        assert.ok(ready.actions.some(a => /flip 4 unchecked/.test(a)), 'action list reports flips');
        assert.ok(ready.actions.some(a => /status: done/.test(a)), 'action list sets spec done');

        // BLOCKED: STALE machine criterion → remedy mentions re-run.
        const blocked = previewClose(writeSpec('blocked.md', oneCmd), {
            root, planStateFn, statusFn: () => [{ criterionId: 'ac-1', verdict: 'STALE', detail: 'd' }] });
        assert.strictEqual(blocked.readiness, 'BLOCKED', 'non-PASS → BLOCKED');
        assert.strictEqual(blocked.blockers[0].criterionId, 'ac-1', 'blocker names the criterion');
        assert.ok(/re-run|verify-contract run/.test(blocked.blockers[0].remedy), 'STALE machine remedy says re-run');

        // BLOCKED: manual UNVERIFIED → remedy mentions attest.
        const manual = previewClose(writeSpec('manual.md', oneManual), {
            root, planStateFn, statusFn: () => [{ criterionId: 'ac-m', verdict: 'UNVERIFIED', detail: 'd' }] });
        assert.ok(/attest/.test(manual.blockers[0].remedy), 'manual UNVERIFIED remedy says attest');

        // NO-CONTRACT: zero criteria.
        const none = previewClose(writeSpec('none.md', '{ "criteria": [] }'), { root, planStateFn, statusFn: () => [] });
        assert.strictEqual(none.readiness, 'NO-CONTRACT', 'zero criteria → NO-CONTRACT');
        assert.strictEqual(none.blockers.length, 0, 'NO-CONTRACT has no blockers');

        console.log('✅ T38 previewClose readiness');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T38 — `Cannot find module ... close-preview`.

- [ ] **Step 3: Implement close-preview.js**

Create [templates/cli/verification/close-preview.js](../../cli/verification/close-preview.js):

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { parseSpecCriteria } = require('./validate-contract');
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
    const parsed = parseSpecCriteria(specText);
    const typeById = {};
    for (const c of parsed.criteria) typeById[c.id] = c.verifier && c.verifier.type;

    const planState = (opts.planStateFn || defaultPlanState)(root, fm.linkedPlan);

    const actions = [];
    if (planState.uncheckedBoxes > 0) {
        actions.push(`flip ${planState.uncheckedBoxes} unchecked checkbox(es) in ${planState.planPath || fm.linkedPlan}`);
    }
    if (fm.status !== 'done') actions.push('set spec status: done');
    if (planState.tasksTotal > 0) actions.push(`backfill R008 evidence for ${planState.tasksTotal} task(s)`);

    if (parsed.criteria.length === 0) {
        return {
            readiness: 'NO-CONTRACT', criteria: [], plan: planState, blockers: [], actions: [],
            note: 'no machine-readable acceptance criteria — add a criteria block for a real gate, or close manually',
        };
    }

    const statusFn = opts.statusFn || function (sp) { return require('./engine').statusSpec(sp, { root }); };
    const verdicts = statusFn(specPath);
    const blockers = verdicts.filter(v => v.verdict !== 'PASS').map(v => ({
        criterionId: v.criterionId, verdict: v.verdict, remedy: remedyFor(v.verdict, typeById[v.criterionId]),
    }));
    return { readiness: blockers.length ? 'BLOCKED' : 'READY', criteria: verdicts, plan: planState, blockers, actions };
}

module.exports = { previewClose, remedyFor, defaultPlanState };
```

- [ ] **Step 4: Register in the manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/engine.js'` line:

```javascript
            'verification/close-preview.js',
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T38 previewClose readiness`.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/close-preview.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): previewClose — three-state closure readiness judgment"
```

---

### Task 2: mem close --preview CLI (read-only) + mount

**Files:**
- Create: `templates/cli/verification/close-commands.js`
- Modify: `templates/cli/memory.js`, `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `previewClose` (Task 1).
- Produces: `registerCloseCommands(program)` exported from `close-commands.js`; `mem close <spec> --preview [--strict] [--json]`. Without `--preview` → errors "--apply not yet implemented (Phase 3)". `--strict` exits non-zero unless READY. Read-only.

- [ ] **Step 1: Write the failing test (T39)**

Add after T38 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T39. Testing close-commands export + previewClose is read-only ...');
{
    const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands'));
    const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
    assert.strictEqual(typeof commands.registerCloseCommands, 'function', 'close-commands must export registerCloseCommands');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-close-ro-'));
    try {
        const specPath = path.join(root, 'spec.md');
        const body = [
            '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
            '# T', '', '## Acceptance Criteria', '',
            '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
        ].join('\n');
        fs.writeFileSync(specPath, body);
        const before = fs.readdirSync(root).sort();
        previewClose(specPath, { root, planStateFn: () => ({ planId: 'plan:t', found: false, tasksTotal: 0, tasksImplemented: 0, uncheckedBoxes: 0 }), statusFn: () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }] });
        assert.deepStrictEqual(fs.readdirSync(root).sort(), before, 'previewClose must not create/remove files');
        assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'previewClose must not modify the spec');
        console.log('✅ T39 close-commands + read-only');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T39 — `Cannot find module ... close-commands`.

- [ ] **Step 3: Implement close-commands.js**

Create [templates/cli/verification/close-commands.js](../../cli/verification/close-commands.js):

```javascript
'use strict';

const { previewClose } = require('./close-preview');

function registerCloseCommands(program) {
    program.command('close <spec>')
        .description('Closure readiness for a spec (Phase 2: --preview only, read-only).')
        .option('--preview', 'Read-only readiness report (required in Phase 2)')
        .option('--strict', 'Exit non-zero unless READY')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            if (!options.preview) {
                console.error('--apply not yet implemented (Phase 3); use --preview');
                process.exitCode = 1;
                return;
            }
            const r = previewClose(specPath);
            if (options.json) {
                console.log(JSON.stringify(r, null, 2));
            } else {
                console.log(`readiness: ${r.readiness}`);
                if (r.note) console.log(`  ${r.note}`);
                for (const b of r.blockers) console.log(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
                if (r.actions.length) {
                    console.log('actions --apply would run:');
                    for (const a of r.actions) console.log(`  • ${a}`);
                }
            }
            if (options.strict && r.readiness !== 'READY') process.exitCode = 1;
        });
}

module.exports = { registerCloseCommands };
```

- [ ] **Step 4: Mount in memory.js + register in the manifest**

In [templates/cli/memory.js](../../cli/memory.js), after the `require('./verification/commands').registerVerificationCommands(program);` line, add:

```javascript
    require('./verification/close-commands').registerCloseCommands(program);
```

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/close-preview.js'` line:

```javascript
            'verification/close-commands.js',
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T39 close-commands + read-only`. If a `Cannot find module './close-commands'` error appears (mirror half-synced), run `cp templates/cli/verification/close-commands.js .evo-lite/cli/verification/close-commands.js` then re-run.

- [ ] **Step 6: Verify the CLI end-to-end (dogfood)**

Run:

```bash
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-27-verification-contract-phase2.md --preview
```
Expected: `readiness: BLOCKED` (its own command criteria are UNVERIFIED until run) with per-criterion remedies, plus an action list. Exit 0 (no `--strict`).

- [ ] **Step 7: Run the full suite both scopes; confirm green**

Run: `node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js`
Expected: both `--- ... passed! ---`; process exits 0.

- [ ] **Step 8: Commit**

```bash
git add templates/cli/verification/close-commands.js templates/cli/memory.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): mem close --preview — read-only closure readiness CLI"
```

---

## Self-Review

**1. Spec coverage:**
- ac-ready-when-all-pass → Task 1 (T38 READY case).
- ac-blocked-lists-remedies → Task 1 (T38 STALE + manual remedy cases).
- ac-no-contract-state → Task 1 (T38 zero-criteria case).
- ac-action-list-and-plan-state → Task 1 (planState + actions in every return).
- ac-cli-read-only → Task 2 (T39 read-only snapshot + CLI export; Step 6 dogfood).
- Three states / criteria-only hard gate / read-only → Global Constraints + Task 1 logic.

**2. Placeholder scan:** none — every step has concrete code/commands.

**3. Type consistency:** `previewClose(specPath, opts)->{readiness, criteria, plan, blockers, actions, note?}`, `remedyFor(verdict, verifierType)`, `defaultPlanState(root, linkedPlanId)`, `registerCloseCommands(program)` consistent across tasks. Blocker shape `{criterionId, verdict, remedy}`; readiness ∈ {READY, BLOCKED, NO-CONTRACT}. `statusFn`/`planStateFn` injection seams match between Task 1 impl and T38/T39 tests.

**Note (deferred, per spec):** `mem close --apply` (mutation + rollback journal), drift/dashboard wiring, and batch close are out of Phase 2.
