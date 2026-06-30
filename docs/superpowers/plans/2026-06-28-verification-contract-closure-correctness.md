# Verification Contract — Closure Correctness (PR-CC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six confirmed correctness/safety bugs in the closure path (NO-CONTRACT strict parity, spec/plan identity validation, apply-warning propagation, plan-status closure, safe journal slug, journal write inside the rollback transaction) — each independently tested.

**Architecture:** Six small, independent fixes across four modules. `engine.js` gains a synthetic NO-CONTRACT verdict. `validate-contract.js` (the single fail-closed loader) gains spec/plan identity regex validation, checked before the NO-CONTRACT opt-out. `close-apply.js` propagates preview warnings, closes the linked plan's frontmatter status independent of its checkbox count, derives the journal filename via the already-validated `evidenceSlug`, and moves the success-journal write inside the rollback `try` (unstaging the git index on rollback). `close-commands.js` prints the propagated warnings.

**Tech Stack:** Node.js (CommonJS), the `node ./.evo-lite/cli/test.js governance` harness (monolithic `templates/cli/test.js`, tests `Txx`), `templates/cli → .evo-lite/cli` mirror.

## Global Constraints

- No new npm dependencies.
- PR-CC only MODIFIES existing managed files (no new `templates/cli/**` files), so no manifest registration is needed. After all edits, run `node ./.evo-lite/cli/memory.js sync-runtime` (2–3× if a partial sync warns) before `npm test` — `npm test` runs the `.evo-lite/cli` MIRROR, not `templates/cli`.
- Dev iteration tests run via `node templates/cli/test.js governance` (templates, fast). The contract verifier (and `npm test`) run the mirror.
- New governance tests are added inside `runGovernanceTests()` in `templates/cli/test.js`, immediately after the existing T55 block (close-apply.js:1661 region — the block that ends the verification cluster, right before the `T19` architecture block). Test numbers are T56–T61.
- The test harness exposes `TEMPLATE_CLI_DIR`, `path`, `fs`, `os`, `assert` in scope already (used by the surrounding tests).
- Spec id regex: `/^spec:[a-z0-9][a-z0-9._-]*$/`. Plan id regex: `/^plan:[a-z0-9][a-z0-9._-]*$/`.
- Identity validation is checked BEFORE the NO-CONTRACT opt-out: a spec with no criteria block is still legal but must carry a valid `spec:<slug>` id.
- Warnings are advisory and NEVER block `--apply`; criteria-all-PASS remains the sole hard gate.

---

### Task 1: NO-CONTRACT strict parity in statusSpec

**Files:**
- Modify: `templates/cli/verification/engine.js` (statusSpec, after the `!contract.ok` INVALID branch, ~line 61-63)
- Test: `templates/cli/test.js` (new T56)

**Interfaces:**
- Consumes: `statusSpec(specPath, opts)` (unchanged signature).
- Produces: `statusSpec` returns `[{ criterionId: '<contract>', verdict: 'NO-CONTRACT', detail: '...' }]` for a NO-CONTRACT spec (previously `[]`). The CLI strict check `verdicts.some(v => v.verdict !== 'PASS')` is unchanged and now exits non-zero.

- [x] **Step 1: Write the failing test (T56)**

Insert immediately after the T55 block (after its closing `}` near `templates/cli/test.js:1661`), before the `console.log('T19. ...')` line:

```javascript
console.log('T56. Testing statusSpec emits a NO-CONTRACT verdict so --strict fails ...');
{
    const { statusSpec } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-nocontract-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', '---', '', '# T', 'no criteria block here', ''].join('\n'));
        const verdicts = statusSpec(specPath, { root, exec: () => 'abc123\n' });
        assert.strictEqual(verdicts.length, 1, 'exactly one synthetic verdict for NO-CONTRACT');
        assert.strictEqual(verdicts[0].verdict, 'NO-CONTRACT', 'verdict is NO-CONTRACT');
        assert.ok(verdicts[0].verdict !== 'PASS', 'NO-CONTRACT is not PASS → --strict exits non-zero');
        console.log('✅ T56 statusSpec NO-CONTRACT verdict');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T56 — `verdicts.length` is `0` (statusSpec returns `[]` for noContract).

- [x] **Step 3: Implement the synthetic verdict**

In `templates/cli/verification/engine.js`, in `statusSpec`, right after the `if (!contract.ok) { return contract.findings.map(...); }` block, add:

```javascript
    if (contract.noContract) {
        return [{ criterionId: '<contract>', verdict: 'NO-CONTRACT',
            detail: 'no machine-readable acceptance criteria' }];
    }
```

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T56 statusSpec NO-CONTRACT verdict`. All prior tests still green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/engine.js templates/cli/test.js
git commit -m "fix(verification): statusSpec emits NO-CONTRACT verdict so --strict fails closed"
```

---

### Task 2: Spec/plan identity validation in the single loader

**Files:**
- Modify: `templates/cli/verification/validate-contract.js` (`loadValidatedContract`, add the two regexes + checks before the opt-out; expose `linkedPlan`)
- Modify: `templates/cli/verification/engine.js` (remove the now-redundant `if (!specId)` guard in `runSpec`, ~line 23)
- Test: `templates/cli/test.js` (new T57)

**Interfaces:**
- Produces: `loadValidatedContract(specText)` now returns `ok: false` with a `findings: [{ id: 'id', ... }]` when the spec id is missing or not `spec:*`, or `findings: [{ id: 'linkedPlan', ... }]` when `linkedPlan` is present but not `plan:*`. The returned object also carries `linkedPlan`. A valid id with no criteria block still returns `ok: true, noContract: true`.

- [x] **Step 1: Write the failing test (T57)**

Insert after the T56 block:

```javascript
console.log('T57. Testing loadValidatedContract identity validation (id + linkedPlan) ...');
{
    const { loadValidatedContract } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const mk = (fm) => ['---', ...fm, '---', '', '# T', 'no criteria', ''].join('\n');
    const noId = loadValidatedContract(mk(['status: draft']));
    assert.strictEqual(noId.ok, false, 'missing id → ok:false');
    assert.strictEqual(noId.findings[0].id, 'id', 'finding is about id');
    assert.strictEqual(loadValidatedContract(mk(['id: nope'])).ok, false, 'bad id prefix → ok:false');
    const badPlan = loadValidatedContract(mk(['id: spec:ok', 'linkedPlan: bad']));
    assert.strictEqual(badPlan.ok, false, 'bad linkedPlan → ok:false');
    assert.strictEqual(badPlan.findings[0].id, 'linkedPlan', 'finding is about linkedPlan');
    const ok = loadValidatedContract(mk(['id: spec:ok', 'linkedPlan: plan:ok']));
    assert.strictEqual(ok.ok, true, 'valid id, no criteria → ok:true');
    assert.strictEqual(ok.noContract, true, 'no criteria block → noContract');
    assert.strictEqual(ok.linkedPlan, 'plan:ok', 'linkedPlan exposed on the result');
    console.log('✅ T57 identity validation');
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T57 — `noId.ok` is `true` today (the loader does not validate the id).

- [x] **Step 3: Implement identity validation**

In `templates/cli/verification/validate-contract.js`, add the two regexes just above `function loadValidatedContract` (after `parseSpecCriteria`):

```javascript
const SPEC_ID_RE = /^spec:[a-z0-9][a-z0-9._-]*$/;
const PLAN_ID_RE = /^plan:[a-z0-9][a-z0-9._-]*$/;
```

Then replace the body of `loadValidatedContract` with:

```javascript
function loadValidatedContract(specText) {
    const fm = parseFrontmatter(specText).frontmatter || {};
    const specId = fm.id;
    const linkedPlan = fm.linkedPlan;
    // Identity is checked BEFORE the NO-CONTRACT opt-out: a spec with no criteria
    // block is still legal, but it must carry a valid spec:<slug> id to be one.
    if (typeof specId !== 'string' || !SPEC_ID_RE.test(specId)) {
        return { ok: false, noContract: false, specId, linkedPlan, criteria: [],
            findings: [finding('id', `spec frontmatter id must match spec:<slug> (got ${JSON.stringify(specId)})`)] };
    }
    if (linkedPlan != null && !PLAN_ID_RE.test(String(linkedPlan))) {
        return { ok: false, noContract: false, specId, linkedPlan, criteria: [],
            findings: [finding('linkedPlan', `linkedPlan must match plan:<slug> (got ${JSON.stringify(linkedPlan)})`)] };
    }
    const parsed = parseSpecCriteria(specText);
    if (parsed.error) {
        const optedOut = /no "## Acceptance Criteria"|no ```json criteria block/.test(parsed.error);
        if (optedOut) {
            return { ok: true, noContract: true, specId, linkedPlan, criteria: [], findings: [] };
        }
        return { ok: false, noContract: false, specId, linkedPlan, criteria: [], findings: [finding('contract', parsed.error)] };
    }
    const findings = validateCriteria(parsed.criteria);
    return { ok: findings.length === 0, noContract: parsed.criteria.length === 0, specId, linkedPlan, criteria: parsed.criteria, findings };
}
```

Then in `templates/cli/verification/engine.js`, in `runSpec`, delete the now-redundant guard line:

```javascript
    if (!specId) return { ok: false, error: 'spec has no id frontmatter', written: [] };
```

(`runSpec` already calls `loadValidatedContract`, which now fail-closes a bad id before any `writeRecord`. Verified: no test asserts the old `'spec has no id frontmatter'` string.)

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T57 identity validation`. T36/T37/T38/T47 (which use valid `id: spec:t`, `linkedPlan: plan:t` fixtures) stay green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/validate-contract.js templates/cli/verification/engine.js templates/cli/test.js
git commit -m "fix(verification): loadValidatedContract validates spec:/plan: identity before NO-CONTRACT opt-out"
```

---

### Task 3: applyClose propagates + printApply prints warnings

**Files:**
- Modify: `templates/cli/verification/close-apply.js` (success return — add `warnings`)
- Modify: `templates/cli/verification/close-commands.js` (`printApply` — print `⚠` lines)
- Test: `templates/cli/test.js` (new T58)

**Interfaces:**
- Consumes: `preview.warnings` (already produced by `previewClose`).
- Produces: `applyClose(...)` success result gains `warnings: preview.warnings || []`. `printApply(r)` iterates `r.warnings` and prints `  ⚠ ${w.message}`.

- [x] **Step 1: Write the failing test (T58)**

Insert after the T57 block:

```javascript
console.log('T58. Testing applyClose propagates preview warnings on a direct --apply ...');
{
    const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-applywarn-'));
    try {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
        const planRel = 'docs/p.md';
        fs.writeFileSync(path.join(root, planRel), '---\nid: plan:t\nstatus: draft\n---\n\n# P\n\n- [x] One\n');
        const warning = { kind: 'tasks-incomplete', message: '1 of 2 linked tasks are not implemented — closing will mark the spec done anyway' };
        const r = applyClose(specPath, {
            root, now: '2026-06-28T12:00:00.000Z',
            exec: () => '',
            previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [warning],
                plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 2, tasksImplemented: 1, uncheckedBoxes: 1 } }),
            backfillFn: () => {}, scanFn: () => {},
        });
        assert.strictEqual(r.applied, true, 'applies (warning is advisory, never blocks)');
        assert.deepStrictEqual(r.warnings, [warning], 'warnings propagated to the apply result');
        const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands.js'), 'utf8');
        assert.ok(/r\.warnings/.test(src) && /⚠/.test(src), 'printApply prints warnings with ⚠');
        console.log('✅ T58 apply propagates warnings');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T58 — `r.warnings` is `undefined` (success return omits it).

- [x] **Step 3: Implement propagation + printing**

In `templates/cli/verification/close-apply.js`, change the success return (currently `return { applied: true, readiness: 'READY', actions, journalPath, staged };`) to:

```javascript
    return { applied: true, readiness: 'READY', actions, journalPath, staged,
        warnings: preview.warnings || [] };
```

In `templates/cli/verification/close-commands.js`, in `printApply`, after the `for (const a of r.actions)` loop and before the `journal:` line, add:

```javascript
    for (const w of (r.warnings || [])) console.log(`  ⚠ ${w.message}`);
```

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T58 apply propagates warnings`.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/verification/close-commands.js templates/cli/test.js
git commit -m "fix(verification): applyClose propagates + printApply prints tasks-incomplete warning"
```

---

### Task 4: Plan frontmatter status: done, independent of checkbox count

**Files:**
- Modify: `templates/cli/verification/close-apply.js` (`planAbs` resolution ~line 108; plan mutation block ~line 127-131)
- Test: `templates/cli/test.js` (new T59)

**Interfaces:**
- Consumes: `plan.planStatus` (already exposed by `defaultPlanState`, close-preview.js:36).
- Produces: `applyClose` resolves `planAbs` when the plan exists AND (`uncheckedBoxes > 0` OR `planStatus !== 'done'`); it always writes `setStatusDone` to the plan, flipping checkboxes only when there are any. A `planStatus === 'done'` plan with zero unchecked boxes is a clean no-op (not staged).

- [x] **Step 1: Write the failing test (T59)**

Insert after the T58 block:

```javascript
console.log('T59. Testing applyClose sets plan status: done independent of unchecked boxes ...');
{
    const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-planstatus-'));
    try {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: done', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
        const planRel = 'docs/p.md';
        const planAbs = path.join(root, planRel);
        // Case A: plan already fully checked but still draft → status must reach done.
        fs.writeFileSync(planAbs, ['---', 'id: plan:t', 'status: draft', '---', '', '# P', '', '- [x] One', ''].join('\n'));
        let added = false;
        const rA = applyClose(specPath, {
            root, now: '2026-06-28T12:00:00.000Z',
            exec: (args) => { if (args[0] === 'add') added = true; return ''; },
            previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 0 } }),
            backfillFn: () => {}, scanFn: () => {},
        });
        assert.strictEqual(rA.applied, true, 'A: applies');
        assert.ok(/^status: done$/m.test(fs.readFileSync(planAbs, 'utf8')), 'A: plan rewritten to status: done even with 0 unchecked boxes');
        assert.ok(added, 'A: plan was staged');
        // Case B: plan already done + 0 boxes → no-op (file untouched, not staged).
        fs.writeFileSync(planAbs, ['---', 'id: plan:t', 'status: done', '---', '', '# P', '', '- [x] One', ''].join('\n'));
        const before = fs.readFileSync(planAbs, 'utf8');
        const rB = applyClose(specPath, {
            root, now: '2026-06-28T12:00:00.000Z',
            exec: () => '',
            previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'done', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 0 } }),
            backfillFn: () => {}, scanFn: () => {},
        });
        assert.strictEqual(rB.applied, true, 'B: applies (spec already done, plan no-op)');
        assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), before, 'B: fully-closed plan untouched');
        assert.ok(!(rB.staged || []).includes(planRel), 'B: plan not staged when it is a no-op');
        console.log('✅ T59 plan status done box-count-independent');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T59 case A — with `uncheckedBoxes: 0` the current `planAbs` is `null`, so the plan is never rewritten to `status: done`.

- [x] **Step 3: Implement box-count-independent plan closure**

In `templates/cli/verification/close-apply.js`, replace the `planAbs` line (currently `const planAbs = (plan.uncheckedBoxes > 0 && plan.planPath) ? path.join(root, plan.planPath) : null;`) with:

```javascript
    const planNeedsMutation = !!plan.planPath &&
        (plan.uncheckedBoxes > 0 || (plan.planStatus && plan.planStatus !== 'done'));
    const planAbs = planNeedsMutation ? path.join(root, plan.planPath) : null;
```

Then replace the plan mutation block inside the `try` (currently flips checkboxes only):

```javascript
        if (planAbs) {
            const txt = fs.readFileSync(planAbs, 'utf8');
            fs.writeFileSync(planAbs, txt.replace(/- \[ \] /g, '- [x] '));
            actions.push(`flip ${plan.uncheckedBoxes} checkbox(es) in ${plan.planPath}`);
        }
```

with:

```javascript
        if (planAbs) {
            let txt = fs.readFileSync(planAbs, 'utf8');
            if (plan.uncheckedBoxes > 0) txt = txt.replace(/- \[ \] /g, '- [x] ');
            fs.writeFileSync(planAbs, setStatusDone(txt));
            actions.push(plan.uncheckedBoxes > 0
                ? `flip ${plan.uncheckedBoxes} checkbox(es) + set plan status: done in ${plan.planPath}`
                : `set plan status: done in ${plan.planPath}`);
        }
```

(`setStatusDone` is already defined and exported in this file.)

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T59 plan status done box-count-independent`. T41/T55 (which use `uncheckedBoxes: 1`) stay green since the `box > 0` path is unchanged.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/test.js
git commit -m "fix(verification): close --apply sets plan status:done regardless of checkbox count"
```

---

### Task 5: Safe journal slug via evidenceSlug

**Files:**
- Modify: `templates/cli/verification/close-apply.js` (require `evidenceSlug`; journal filename; `slugFor` delegates)
- Test: `templates/cli/test.js` (new T60)

**Interfaces:**
- Consumes: `evidenceSlug(specId)` from `evidence-store.js` (throws on a path separator).
- Produces: the journal filename is `close-journal-${evidenceSlug(fm.id)}.json`. `slugFor(fm)` stays exported but delegates to `evidenceSlug(fm.id)` (the basename fallback is dropped — a valid `spec:*` id is mandatory). A traversal id fail-closes at preview (Task 2) before any journal is written.

- [x] **Step 1: Write the failing test (T60)**

Insert after the T59 block:

```javascript
console.log('T60. Testing closure journal slug uses evidenceSlug (no path traversal) ...');
{
    const closeApply = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const { evidenceSlug } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
    assert.throws(() => evidenceSlug('spec:a/b'), /invalid spec id/, 'separator id rejected by evidenceSlug');
    assert.strictEqual(closeApply.slugFor({ id: 'spec:t' }), 't', 'slugFor returns the validated slug');
    assert.throws(() => closeApply.slugFor({ id: 'spec:../evil' }), /invalid spec id/, 'slugFor rejects traversal');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-slug-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, ['---', 'id: spec:../../evil', 'status: draft', '---', '', '# T', ''].join('\n'));
        const r = closeApply.applyClose(specPath, { root, now: '2026-06-28T12:00:00.000Z', exec: () => '', backfillFn: () => {}, scanFn: () => {} });
        assert.strictEqual(r.applied, false, 'traversal id → not applied (fail-closed at preview)');
        const vdir = path.join(root, '.evo-lite', 'verification');
        const journals = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(f => f.startsWith('close-journal')) : [];
        assert.strictEqual(journals.length, 0, 'no journal written for a fail-closed traversal id');
        console.log('✅ T60 safe journal slug');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T60 — `closeApply.slugFor({ id: 'spec:../evil' })` returns `'../evil'` today (basename fallback never validates).

- [x] **Step 3: Implement the safe slug**

In `templates/cli/verification/close-apply.js`, add to the top requires:

```javascript
const { evidenceSlug } = require('./evidence-store');
```

Replace the `slugFor` function:

```javascript
function slugFor(fm, specPath) {
    const id = String(fm.id || '').replace(/^spec:/, '').trim();
    return id || path.basename(specPath).replace(/\.md$/, '');
}
```

with:

```javascript
function slugFor(fm) {
    return evidenceSlug(fm && fm.id);
}
```

Change the journal-path line (currently `` `close-journal-${slugFor(fm, specPath)}.json` ``) to:

```javascript
    const journalPath = path.join(root, '.evo-lite', 'verification',
        `close-journal-${evidenceSlug(fm.id)}.json`);
```

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T60 safe journal slug`. The valid-id close tests (T41/T55) keep working (`evidenceSlug('spec:t') === 't'`).

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/test.js
git commit -m "fix(verification): closure journal filename uses validated evidenceSlug (no path traversal)"
```

---

### Task 6: Success-journal write inside the rollback transaction

**Files:**
- Modify: `templates/cli/verification/close-apply.js` (make `writeJournal` injectable; move the success write inside `try`; unstage on rollback)
- Test: `templates/cli/test.js` (new T61)

**Interfaces:**
- Produces: `applyClose` accepts `opts.writeJournalFn` (defaults to the module `writeJournal`). The success-journal write (`status: 'applied'`) runs as the last statement inside the `try`; if it throws, the existing `catch` restores every journaled target, best-effort `git reset -- <staged>` to unstage the index, writes `status: 'aborted'`, and returns `{ applied: false, aborted: true }`.

- [x] **Step 1: Write the failing test (T61)**

Insert after the T60 block:

```javascript
console.log('T61. Testing success-journal write failure rolls back + unstages (write inside txn) ...');
{
    const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-jtxn-'));
    try {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        const specPath = path.join(root, 'spec.md');
        const specPrior = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
        fs.writeFileSync(specPath, specPrior);
        const planRel = 'docs/p.md';
        const planAbs = path.join(root, planRel);
        const planPrior = ['---', 'id: plan:t', 'status: draft', '---', '', '# P', '', '- [x] One', ''].join('\n');
        fs.writeFileSync(planAbs, planPrior);
        const resetCalls = [];
        const r = applyClose(specPath, {
            root, now: '2026-06-28T12:00:00.000Z',
            exec: (args) => { if (args[0] === 'reset') resetCalls.push(args); return ''; },
            previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 1 } }),
            backfillFn: () => {}, scanFn: () => {},
            writeJournalFn: (p, payload) => {
                if (payload.status === 'applied') throw new Error('disk full on success journal');
                fs.mkdirSync(path.dirname(p), { recursive: true });
                fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n');
            },
        });
        assert.strictEqual(r.applied, false, 'not applied');
        assert.strictEqual(r.aborted, true, 'aborted');
        assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specPrior, 'spec restored to prior bytes');
        assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planPrior, 'plan restored to prior bytes');
        assert.ok(resetCalls.length >= 1, 'rollback unstaged via git reset');
        const journal = JSON.parse(fs.readFileSync(r.journalPath, 'utf8'));
        assert.strictEqual(journal.status, 'aborted', 'journal records aborted');
        console.log('✅ T61 success-journal failure rolls back + unstages');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T61 — today the success-journal write is OUTSIDE the `try`, so its throw is uncaught (the test throws rather than getting `aborted`), and the catch never unstages.

- [x] **Step 3: Implement the injectable + in-transaction write + unstage**

In `templates/cli/verification/close-apply.js`, inside `applyClose`, after `const now = opts.now || new Date().toISOString();`, add:

```javascript
    const writeJournalFn = opts.writeJournalFn || writeJournal;
```

Replace the three `writeJournal(` call sites inside `applyClose` with `writeJournalFn(` (the initial `applying` write, the `aborted` write in the catch, and the `applied` write).

Move the success-journal write to be the LAST statement inside the `try` block (immediately after `if (staged.length) exec(['add', ...staged]);`):

```javascript
        if (staged.length) exec(['add', ...staged]);
        writeJournalFn(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));
    } catch (err) {
        for (const e of entries) {
            if (e.priorBytes === null) { if (fs.existsSync(e.path)) fs.unlinkSync(e.path); }
            else fs.writeFileSync(e.path, e.priorBytes);
        }
        // Unstage anything we git-add-ed so a rollback leaves the index clean too.
        try { if (staged.length) exec(['reset', '--', ...staged]); } catch (_) { /* best-effort */ }
        writeJournalFn(journalPath, Object.assign({}, journal, { status: 'aborted', error: err.message }));
        return { applied: false, aborted: true, error: err.message, journalPath };
    }
```

Delete the old success-journal write that sat AFTER the `try` (the standalone `writeJournal(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));` line), leaving the success `return { applied: true, ... }` after the `try`.

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T61 success-journal failure rolls back + unstages`. T41/T42/T55 (happy-path + existing rollback) stay green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/test.js
git commit -m "fix(verification): success-journal write inside the rollback try + unstage index on abort"
```

---

### Task 7: Sync mirror, mirror-test, dogfood self-closure

**Files:**
- Modify (generated, via CLI): `.evo-lite/cli/**` (mirror), `.evo-lite/generated/**`, `docs/superpowers/specs/2026-06-28-verification-contract-closure-correctness.md` (spec status), the linked plan checkboxes/status

**Interfaces:**
- Consumes: all six fixes (Tasks 1-6) on a clean tree.
- Produces: green mirror suite, a PASS verification record for this spec's `ac-*` criteria, the spec closed (`status: done`), drift 0/0/0.

- [x] **Step 1: Sync the runtime mirror**

```bash
node ./.evo-lite/cli/memory.js sync-runtime
```
Run it 2–3× if it reports a partial sync. Expected: the six modified `templates/cli/**` files are mirrored into `.evo-lite/cli/**`.

- [x] **Step 2: Run the mirror suite**

```bash
npm test
```
Expected: all governance tests PASS via the mirror (T56–T61 included).

- [x] **Step 3: Run the contract verifier on this spec (clean HEAD)**

Ensure the tree is clean (all task commits landed), then:

```bash
node ./.evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-06-28-verification-contract-closure-correctness.md
node ./.evo-lite/cli/memory.js verify-contract status docs/superpowers/specs/2026-06-28-verification-contract-closure-correctness.md
```
Expected: all six `ac-*` criteria PASS (each runs `node ./.evo-lite/cli/test.js governance`).

- [x] **Step 4: Preview + apply closure**

```bash
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-closure-correctness.md --preview
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-closure-correctness.md --apply
```
Expected preview: `readiness: READY`. Apply: spec `status: done`, the linked plan's checkboxes flipped + plan `status: done`, R008 archive evidence backfilled, journal `applied`.

- [x] **Step 5: Commit the closure + verify drift**

```bash
git add -A
git commit -m "feat(verification): closure-correctness shipped + self-closed via --apply"
node ./.evo-lite/cli/memory.js context track
```
Expected: drift report 0 errors / 0 warnings / 0 info (R006 for the spec clears now that the plan exists and is linked; R008 cleared by backfill).

---

## Self-Review

**Spec coverage:** All six spec design sections map to Tasks 1-6; the two self-review refinements (Task 4 box-count-independent `planAbs`; Task 6 catch unstages the index) are folded into Tasks 4 and 6. The six acceptance criteria map 1:1 to Tasks 1-6 and are verified end-to-end in Task 7.

**Placeholder scan:** No TBD/TODO; every code step shows full code and exact run commands with expected output.

**Type consistency:** `loadValidatedContract` returns `{ ok, noContract, specId, linkedPlan, criteria, findings }` consistently across all branches (Task 2). `applyClose` opts use `writeJournalFn`, `previewFn`, `backfillFn`, `scanFn`, `exec`, `now`, `root` consistently. `plan.planStatus`/`plan.uncheckedBoxes`/`plan.planPath` field names match `defaultPlanState`'s output. `slugFor(fm)` single-arg signature is used by both the test and (via `evidenceSlug`) the call site. Test numbers T56–T61 are unique and sequential after T55.
