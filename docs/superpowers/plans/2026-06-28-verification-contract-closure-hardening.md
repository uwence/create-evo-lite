# Verification Contract — Closure Hardening (PR3-scoped + PR4-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two real `mem close --apply` gaps (staging outside the rollback; no concurrency guard) and surface unimplemented tasks as a preview warning — while explicitly NOT building the redundant transaction-dir machinery.

**Architecture:** Three contained edits: (1) `previewClose` gains a `warnings[]` (task-completeness, never affects readiness); (2) `applyClose` moves `git add` inside the try so a staging failure rolls back; (3) `applyClose` wraps its body in a minimal advisory file lock (`close.lock`, atomic `wx` create, 10-min stale-tolerant). No on-disk priorBytes journal, no recover/abort (clean-tree + git + rescan already are the crash backstop).

**Tech Stack:** Node.js (CommonJS, built-in `fs`/`crypto`), the `node ./.evo-lite/cli/test.js governance` harness, the `templates/cli → .evo-lite/cli` mirror.

## Global Constraints

- No new npm dependencies.
- `warnings` MUST NOT change `readiness` — criteria-all-PASS stays the only hard gate (PR4-A).
- `close.lock` MUST be gitignored — it is NOT a `.json` file, so the existing `!verification/**/*.json` un-ignore does NOT cover it; left un-ignored it would be tracked and dirty the tree, breaking Gate 1. Add an explicit ignore in BOTH `.gitignore` and `templates/gitignore`.
- Lock acquisition uses `fs.writeFileSync(lockPath, content, { flag: 'wx' })` (atomic exclusive create) — NOT existsSync-then-write (TOCTOU).
- `opts.now` (already injectable for journal timestamps) is the lock `startedAt` and the stale-age reference, so tests stay deterministic.
- Governance tests run via `node ./.evo-lite/cli/test.js governance`, added inside `runGovernanceTests()` after the existing last verification block (T52). `npm test` runs the `.evo-lite/cli` MIRROR — `sync-runtime` before `npm test`.
- Do NOT touch the redundant non-goals: no on-disk priorBytes journal, no `mem close recover/abort`, no task-gating hard gate, no rename.

---

### Task 1: Task-completeness warning in previewClose

**Files:**
- Modify: `templates/cli/verification/close-preview.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Produces: `previewClose(specPath, opts)` return objects all gain `warnings: [{ kind, message }]`. `tasks-incomplete` warning fires when `planState.found && planState.tasksImplemented < planState.tasksTotal`. `readiness` is unchanged.

- [x] **Step 1: Write the failing test (T53)**

Add after the T52 block inside `runGovernanceTests()` in `templates/cli/test.js`:

```javascript
console.log('T53. Testing previewClose task-incomplete warning (advisory, not a blocker) ...');
{
    const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-warn-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, [
            '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
            '# T', '', '## Acceptance Criteria', '',
            '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
        ].join('\n'));
        const allPass = () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }];
        // tasks incomplete + all criteria PASS → READY (not blocked) + a warning.
        const incomplete = previewClose(specPath, {
            root, statusFn: allPass,
            planStateFn: () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', tasksTotal: 3, tasksImplemented: 1, uncheckedBoxes: 4 }) });
        assert.strictEqual(incomplete.readiness, 'READY', 'task incompleteness must NOT block READY');
        assert.ok(Array.isArray(incomplete.warnings), 'preview returns a warnings array');
        assert.ok(incomplete.warnings.some(w => w.kind === 'tasks-incomplete' && /2 of 3/.test(w.message)), 'warns 2 of 3 tasks not implemented');
        // tasks complete → no warning.
        const complete = previewClose(specPath, {
            root, statusFn: allPass,
            planStateFn: () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', tasksTotal: 3, tasksImplemented: 3, uncheckedBoxes: 0 }) });
        assert.strictEqual(complete.readiness, 'READY', 'complete tasks still READY');
        assert.deepStrictEqual(complete.warnings, [], 'no warning when tasks complete');
        console.log('✅ T53 previewClose task warning');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T53 — `preview returns a warnings array` (`warnings` is undefined).

- [x] **Step 3: Implement the warning**

In `templates/cli/verification/close-preview.js`, inside `previewClose`, right after the `const planState = ...` line (currently line 51), add:

```javascript
    const warnings = [];
    if (planState.found && planState.tasksImplemented < planState.tasksTotal) {
        warnings.push({ kind: 'tasks-incomplete',
            message: `${planState.tasksTotal - planState.tasksImplemented} of ${planState.tasksTotal} linked tasks are not implemented — closing will mark the spec done anyway` });
    }
```

Then add `warnings` to EACH of the three return objects in `previewClose`:
- the malformed-contract `return { readiness: 'BLOCKED', ... }` — add `warnings,`
- the `noContract` `return { readiness: 'NO-CONTRACT', ... }` — add `warnings,`
- the final `return { readiness: blockers.length ? 'BLOCKED' : 'READY', criteria: verdicts, plan: planState, blockers, actions };` — change to `return { readiness: blockers.length ? 'BLOCKED' : 'READY', criteria: verdicts, plan: planState, blockers, actions, warnings };`

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T53 previewClose task warning`.

- [x] **Step 5: Surface warnings in the CLI**

In `templates/cli/verification/close-commands.js`, the `printPreview(r)` helper prints readiness/blockers/actions. After it prints the blockers loop and before/after actions, add a warnings loop. Locate `function printPreview(r) {` and add, right before its closing `}`:

```javascript
    for (const w of (r.warnings || [])) console.log(`  ⚠ ${w.message}`);
```

(The `--json` path already serializes the whole result object, so `warnings` is included automatically.)

- [x] **Step 6: Run governance again; confirm still green**

Run: `node templates/cli/test.js governance`
Expected: `--- Governance-focused CLI tests passed! ---`.

- [x] **Step 7: Commit**

```bash
git add templates/cli/verification/close-preview.js templates/cli/verification/close-commands.js templates/cli/test.js
git commit -m "feat(verification): preview surfaces unimplemented-task warning (advisory, not a gate)"
```

---

### Task 2: Move staging inside the transaction (rollback on git-add failure)

**Files:**
- Modify: `templates/cli/verification/close-apply.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `applyClose` stages (`git add`) inside the try block; a staging failure now returns `{ applied: false, aborted: true, error, journalPath }` with every target restored, identical to a mutation failure. Success return shape unchanged (`{ applied: true, ..., staged }`).

- [x] **Step 1: Write the failing test (T54)**

Add after T53 in `templates/cli/test.js`:

```javascript
console.log('T54. Testing applyClose rolls back when git add fails (staging inside the txn) ...');
{
    const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-stage-fail-'));
    try {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        const specPath = path.join(root, 'spec.md');
        const specBefore = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
        fs.writeFileSync(specPath, specBefore);
        const planRel = 'docs/p.md';
        const planAbs = path.join(root, planRel);
        const planBefore = '# P\n\n- [x] Step one\n- [x] Step two\n';
        fs.writeFileSync(planAbs, planBefore);

        // status clean → passes Gate 1; `add` throws → must roll back.
        const result = applyClose(specPath, {
            root, now: '2026-06-28T00:00:00.000Z',
            exec: (args) => { if (args[0] === 'add') throw new Error('git add boom'); return ''; },
            previewFn: () => ({ readiness: 'READY', blockers: [],
                plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
            backfillFn: () => {}, scanFn: () => {},
        });
        assert.strictEqual(result.applied, false, 'staging failure is not applied');
        assert.strictEqual(result.aborted, true, 'staging failure rolls back (aborted)');
        assert.ok(/git add boom/.test(result.error), 'staging error surfaced');
        assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planBefore, 'plan restored after staging failure');
        assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specBefore, 'spec restored after staging failure');
        const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
        assert.strictEqual(journal.status, 'aborted', 'journal marked aborted on staging failure');
        console.log('✅ T54 staging-failure rollback');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T54 — currently staging is AFTER the catch, so the `git add` throw escapes uncaught (the test sees an exception, not an `aborted` result). The plan + spec are left mutated.

- [x] **Step 3: Move staging into the try**

In `templates/cli/verification/close-apply.js`, change the `const actions = [];` line to also declare staged:

```javascript
    const actions = [];
    let staged = [];
```

Move the staging block from AFTER the catch to the END of the `try` (right after `actions.push('backfill R008 archive evidence + rescan plan IR');`). The try's tail becomes:

```javascript
        backfillFn(root);
        scanFn(root);
        actions.push('backfill R008 archive evidence + rescan plan IR');
        // Stage tracked source (plan + spec) INSIDE the txn so a git-add failure rolls back.
        const sourceTargets = [planAbs, willSetStatus ? specPath : null].filter(Boolean);
        staged = sourceTargets.filter(p => fs.existsSync(p)).map(p => path.relative(root, p).replace(/\\/g, '/'));
        if (staged.length) exec(['add', ...staged]);
    } catch (err) {
        for (const e of entries) {
            if (e.priorBytes === null) { if (fs.existsSync(e.path)) fs.unlinkSync(e.path); }
            else fs.writeFileSync(e.path, e.priorBytes);
        }
        writeJournal(journalPath, Object.assign({}, journal, { status: 'aborted', error: err.message }));
        return { applied: false, aborted: true, error: err.message, journalPath };
    }
```

Delete the OLD staging lines that were after the catch (the `// Stage only the git-tracked source mutations...` comment block, the `const sourceTargets = ...`, `const staged = ...`, and `if (staged.length) exec(['add', ...staged]);`). The success-journal write and final return stay as-is (they reference the now-outer `staged`):

```javascript
    writeJournal(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));
    return { applied: true, readiness: 'READY', actions, journalPath, staged };
```

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T54 staging-failure rollback`; T41 (happy-path apply) still green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/test.js
git commit -m "fix(verification): stage inside the close txn so a git-add failure rolls back"
```

---

### Task 3: Advisory lock + close.lock gitignore

**Files:**
- Modify: `templates/cli/verification/close-apply.js`
- Modify: `.gitignore`, `templates/gitignore`
- Test: `templates/cli/test.js`

**Interfaces:**
- Produces: `applyClose` acquires `.evo-lite/verification/close.lock` (atomic `wx`) before its gates and removes it in a `finally`. A FRESH lock → `{ applied: false, refused: 'locked', message }`. A lock older than 10 min (by `opts.now`) → overwritten and run proceeds. Module also exports `LOCK_STALE_MS`.

- [x] **Step 1: Write the failing test (T55)**

Add after T54 in `templates/cli/test.js`:

```javascript
console.log('T55. Testing applyClose advisory lock (fresh refuses, stale proceeds, removed after) ...');
{
    const mod = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
    const { applyClose } = mod;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-'));
    try {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        fs.mkdirSync(path.join(root, '.evo-lite', 'verification'), { recursive: true });
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
        const planRel = 'docs/p.md';
        fs.writeFileSync(path.join(root, planRel), '# P\n\n- [x] One\n');
        const lockPath = path.join(root, '.evo-lite', 'verification', 'close.lock');
        const now = '2026-06-28T12:00:00.000Z';
        const okOpts = {
            root, now,
            exec: (args) => (args[0] === 'add' ? '' : ''),
            previewFn: () => ({ readiness: 'READY', blockers: [], plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 1, uncheckedBoxes: 1 } }),
            backfillFn: () => {}, scanFn: () => {},
        };

        // Fresh lock present → refuse.
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, startedAt: now }) + '\n');
        const refused = applyClose(specPath, okOpts);
        assert.strictEqual(refused.applied, false, 'fresh lock → not applied');
        assert.strictEqual(refused.refused, 'locked', 'fresh lock → refused:locked');

        // Stale lock (11 min before now) → proceeds and applies.
        const stale = new Date(Date.parse(now) - (11 * 60 * 1000)).toISOString();
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, startedAt: stale }) + '\n');
        const applied = applyClose(specPath, okOpts);
        assert.strictEqual(applied.applied, true, 'stale lock → proceeds and applies');
        assert.ok(!fs.existsSync(lockPath), 'lock removed after a successful apply');
        console.log('✅ T55 advisory lock');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T55 — `fresh lock → refused:locked` (no lock logic yet; the run ignores the lock and applies).

- [x] **Step 3: Implement the lock**

In `templates/cli/verification/close-apply.js`, add near the top (after the `writeJournal` helper):

```javascript
const LOCK_STALE_MS = 10 * 60 * 1000;

// Minimal advisory lock — guards the single-user local case against two concurrent
// `--apply` runs racing on the regenerated plan-ir.json. Atomic `wx` create; a lock
// older than LOCK_STALE_MS (by the caller's `now`) is treated as a crashed run and
// overwritten so a dead lock can't brick the command forever.
function acquireCloseLock(root, now) {
    const lockPath = path.join(root, '.evo-lite', 'verification', 'close.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const content = JSON.stringify({ pid: process.pid, startedAt: now }) + '\n';
    try {
        fs.writeFileSync(lockPath, content, { flag: 'wx' });
        return lockPath;
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let startedAt = null;
        try { startedAt = JSON.parse(fs.readFileSync(lockPath, 'utf8')).startedAt; } catch (_) { /* unparseable → stale */ }
        const age = startedAt ? (Date.parse(now) - Date.parse(startedAt)) : Infinity;
        if (!(age >= 0) || age > LOCK_STALE_MS) {
            fs.writeFileSync(lockPath, content);
            return lockPath;
        }
        return null;
    }
}
```

Wrap the `applyClose` body in lock acquire + `finally` release. Right after `const now = opts.now || new Date().toISOString();`, insert:

```javascript
    const lockPath = acquireCloseLock(root, now);
    if (!lockPath) {
        return { applied: false, refused: 'locked',
            message: 'another mem close --apply is in progress (close.lock) — wait or remove .evo-lite/verification/close.lock' };
    }
    try {
```

Then indent the rest of the existing body (from `// Gate 1` through the final `return { applied: true, ... };`) one level, and before the function's closing `}` add:

```javascript
    } finally {
        try { fs.unlinkSync(lockPath); } catch (_) { /* already gone */ }
    }
}
```

Add `LOCK_STALE_MS` to `module.exports`.

- [x] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T55 advisory lock`; T40/T41/T54 still green (all return paths now flow through the finally).

- [x] **Step 5: Gitignore close.lock (both trees)**

In `.gitignore`, after the `.evo-lite/verification/close-journal-*.json` line, add:

```
.evo-lite/verification/close.lock
```

In `templates/gitignore`, after its matching `close-journal-*.json` line, add the same line.

- [x] **Step 6: Verify close.lock is now ignored**

Run: `printf '' > .evo-lite/verification/close.lock && git check-ignore .evo-lite/verification/close.lock && rm -f .evo-lite/verification/close.lock`
Expected: prints `.evo-lite/verification/close.lock` (ignored). If it prints nothing, the ignore line is wrong.

- [x] **Step 7: Commit**

```bash
git add templates/cli/verification/close-apply.js .gitignore templates/gitignore templates/cli/test.js
git commit -m "feat(verification): advisory close.lock (stale-tolerant) + gitignore it"
```

---

### Task 4: Sync mirror, full suite, dogfood close

**Files:**
- Modify: `.evo-lite/cli/**` (mirror, via sync)
- Modify: `docs/superpowers/specs/2026-06-28-verification-contract-closure-hardening.md` (status → done)
- Modify: `docs/superpowers/plans/2026-06-28-verification-contract-closure-hardening.md` (checkboxes)

- [x] **Step 1: Sync the runtime mirror**

Run: `node ./.evo-lite/cli/memory.js sync-runtime` (repeat once; expect 2nd run `copied: 0`). Confirm the three modified files match the mirror:

```bash
node -e "['close-preview.js','close-apply.js','close-commands.js'].forEach(f=>{const a=require('fs').readFileSync('templates/cli/verification/'+f,'utf8');const b=require('fs').readFileSync('.evo-lite/cli/verification/'+f,'utf8');console.log(f, a===b?'OK':'DRIFT')})"
```
Expected: all three `OK`.

- [x] **Step 2: Full suite both scopes**

Run: `npm test`
Expected: TWO `passed!` lines (governance incl. T53–T55, then integration), exit 0.

- [x] **Step 3: Dogfood — bind evidence and close this spec**

Commit Tasks 1–3 first so the tree is clean. Then:

```bash
git status --porcelain   # must be empty
node ./.evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-06-28-verification-contract-closure-hardening.md
git add .evo-lite/verification/evidence-verification-contract-closure-hardening.json
git commit -m "test(verification): bind closure-hardening spec evidence (3 PASS)"
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-closure-hardening.md --preview --strict
```
Expected: 3 PASS records; `close --preview --strict` prints `readiness: READY`, exits 0. (It may also print a `⚠` task-incomplete warning — that is expected and does NOT change READY.)

- [x] **Step 4: Apply, archive, confirm clean tree**

```bash
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-closure-hardening.md --apply
git status --porcelain   # MUST show only staged plan+spec — NO close.lock (proves the gitignore)
node ./.evo-lite/cli/memory.js archive --type task "Closure-hardening closure: task:verification-contract-closure-hardening-t1 task warning, task:verification-contract-closure-hardening-t2 staging-in-txn rollback, task:verification-contract-closure-hardening-t3 advisory lock + gitignore, task:verification-contract-closure-hardening-t4 dogfood."
git add -A
git commit -m "feat(verification): closure-hardening shipped + self-closed via --apply"
```
Expected: `--apply` prints `READY — closed`; `git status` shows NO `close.lock` (it self-removed AND is gitignored). Drift check:

```bash
node ./.evo-lite/cli/memory.js plan gaps
```
Expected: `No planning drift findings`.

---

## Self-Review

**1. Spec coverage:**
- ac-staging-inside-try → Task 2 (T54: git-add throw → aborted + restored).
- ac-advisory-lock → Task 3 (T55: fresh refuses, stale proceeds, removed after).
- ac-task-warning-not-blocker → Task 1 (T53: warning present, READY unchanged; [] when complete).
- "close.lock gitignored" → Task 3 Step 5-6 (both trees + verified) — this was the load-bearing subtlety (close.lock is not `.json` so not auto-un-ignored; tracked → dirties tree → breaks Gate 1).
- PR4-B scope note → folded into the warning UX; no rename/expand (Non-Goals honored).

**2. Placeholder scan:** none — every step carries concrete code/commands.

**3. Type consistency:** `previewClose` adds `warnings: [{kind,message}]` to all returns; `applyClose` adds `refused: 'locked'` return + a `finally` release + exported `LOCK_STALE_MS`; `acquireCloseLock(root, now) -> lockPath|null`; `staged` promoted to outer-scope `let`. The happy-path `applyClose` return (`{applied,readiness,actions,journalPath,staged}`) and the aborted return (`{applied:false,aborted,error,journalPath}`) are unchanged. `opts.now` reused for both journal + lock timestamps.
