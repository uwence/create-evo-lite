# Verification Contract Phase 3 — Closure Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mem close --apply <spec>` — atomically perform the closure action list (flip plan checkboxes, set spec `status: done`, backfill R008 evidence) only when `previewClose` is READY at a clean HEAD, with a rollback journal.

**Architecture:** New pure-ish engine `close-apply.js` exposing `applyClose(specPath, opts)`. It reuses `previewClose` (gate + action list), `backfillArchiveEvidence` (R008), and `scanPlanning`/`writePlanIR` (IR rescan). Two fail-closed gates (dirty tree, not-READY) run before any write. A journal snapshots every target file's prior bytes; mutations apply in sequence; any throw triggers byte-restore from the journal. On success the mutated files are `git add`-ed (staged, not committed). CLI `--apply` is wired into the existing `close-commands.js`.

**Tech Stack:** Node.js (CommonJS), `commander` (CLI), `child_process` (git), node `assert` governance test harness (`templates/cli/test.js`, scope `governance`).

## Global Constraints

- Runtime has NO YAML parser — spec frontmatter is read via `parseFrontmatter` from `../planning/parse-markdown`; criteria are a fenced ```json block.
- No `Date.now()`/`new Date()` inside pure engine logic — the CLI passes `now`; the engine accepts it via `opts.now`.
- Governance tests `require` modules from `TEMPLATE_CLI_DIR` (`templates/cli`), NOT the `.evo-lite/cli` mirror — unit tests pass without a sync. The live `mem close` CLI runs from the mirror, so the runtime sync + `template-manifest.js` registration are required only for the dogfood/CLI leg.
- `mem close --preview` (Phase 2) behavior is unchanged; exactly one of `--preview`/`--apply` is required.
- Criteria `dependsOn` point at code files (`close-apply.js`, `test.js`), never the plan/spec `.md` — so closure mutations do not STALE the spec's own criteria.

---

### Task 1: `applyClose` skeleton + fail-closed gates

**Files:**
- Create: `templates/cli/verification/close-apply.js`
- Test: `templates/cli/test.js` (governance suite, new block `T40`)

**Interfaces:**
- Consumes: `previewClose(specPath, opts)` from `./close-preview` (Phase 2) returning `{ readiness, blockers, note, plan, actions }`.
- Produces: `applyClose(specPath, opts) -> { applied, refused?, readiness, blockers?, note?, message? }`. `opts`: `{ root, exec, previewFn, now, backfillFn, scanFn }`. `exec(argsArray) -> string` is a git runner (default: `git` via `execFileSync` in `root`). `previewFn(specPath) -> previewResult` (default: `previewClose(specPath, { root })`).

- [x] **Step 1: Write the failing test**

Add this block immediately after the `T39` block (before the `T19.` block) in the `runGovernanceTests()` function in `templates/cli/test.js`:

```js
        console.log('T40. Testing applyClose fail-closed gates (dirty tree / not READY) ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-gate-'));
            try {
                const specPath = path.join(root, 'spec.md');
                const body = [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
                ].join('\n');
                fs.writeFileSync(specPath, body);

                // dirty tree → refuse before any preview/mutation
                let previewCalled = false;
                const dirty = applyClose(specPath, {
                    root,
                    exec: () => 'M some/file.js\n',
                    previewFn: () => { previewCalled = true; return { readiness: 'READY' }; },
                });
                assert.strictEqual(dirty.applied, false, 'dirty tree must refuse');
                assert.strictEqual(dirty.refused, 'dirty-tree', 'refusal reason names dirty tree');
                assert.strictEqual(previewCalled, false, 'dirty-tree gate runs before previewClose');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'dirty refusal mutates nothing');

                // clean tree but BLOCKED → refuse, surface blockers
                const blocked = applyClose(specPath, {
                    root,
                    exec: () => '',
                    previewFn: () => ({ readiness: 'BLOCKED', blockers: [{ criterionId: 'ac-1', verdict: 'STALE', remedy: 're-run' }] }),
                });
                assert.strictEqual(blocked.applied, false, 'BLOCKED must refuse');
                assert.strictEqual(blocked.refused, 'BLOCKED', 'refusal reason is the readiness');
                assert.strictEqual(blocked.blockers[0].criterionId, 'ac-1', 'blockers passed through');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'BLOCKED refusal mutates nothing');

                // NO-CONTRACT → refuse with note
                const none = applyClose(specPath, {
                    root,
                    exec: () => '',
                    previewFn: () => ({ readiness: 'NO-CONTRACT', note: 'no machine-readable acceptance criteria' }),
                });
                assert.strictEqual(none.applied, false, 'NO-CONTRACT must refuse');
                assert.strictEqual(none.refused, 'NO-CONTRACT', 'refusal reason is NO-CONTRACT');
                assert.ok(/no machine-readable/.test(none.note), 'NO-CONTRACT note passed through');

                console.log('✅ T40 applyClose gates');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
```

- [x] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../verification/close-apply'`.

- [x] **Step 3: Write minimal implementation**

Create `templates/cli/verification/close-apply.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');

function defaultExec(root) {
    return (args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function applyClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec(root);
    const previewFn = opts.previewFn || ((sp) => previewClose(sp, { root }));

    // Gate 1: clean tree — evidence/closure must bind a real committed state.
    const porcelain = String(exec(['status', '--porcelain']) || '').trim();
    if (porcelain) {
        return { applied: false, refused: 'dirty-tree', readiness: null,
            message: 'working tree is dirty — commit or stash first' };
    }

    // Gate 2: READY only — the criteria gate is the sole hard gate.
    const preview = previewFn(specPath);
    if (preview.readiness !== 'READY') {
        return { applied: false, refused: preview.readiness, readiness: preview.readiness,
            blockers: preview.blockers || [], note: preview.note };
    }

    // Mutation engine arrives in Task 2.
    return { applied: false, refused: 'not-implemented', readiness: 'READY' };
}

module.exports = { applyClose };
```

- [x] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T40 applyClose gates`.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/test.js
git commit -m "feat(verification): applyClose fail-closed gates (dirty-tree / not-READY)"
```

---

### Task 2: Journaled mutations + staging on READY

**Files:**
- Modify: `templates/cli/verification/close-apply.js`
- Modify: `templates/cli/template-manifest.js:38` (register the new managed file)
- Test: `templates/cli/test.js` (governance suite, new block `T41`)

**Interfaces:**
- Consumes: `backfillArchiveEvidence(root)` from `../planning/backfill-evidence`; `scanPlanning(root)` + `writePlanIR(root, ir)` from `../planning/scan`; `parseFrontmatter` from `../planning/parse-markdown`.
- Produces: on READY, `applyClose` returns `{ applied: true, readiness: 'READY', actions: string[], journalPath: string, staged: string[] }` and writes `.evo-lite/verification/close-journal-<slug>.json` with `status: 'applied'`. `opts.backfillFn(root)` and `opts.scanFn(root)` are injectable (defaults call the planning modules); `opts.now` is the journal `createdAt` string.

- [x] **Step 1: Write the failing test**

Add this block immediately after the `T40` block in `runGovernanceTests()`:

```js
        console.log('T41. Testing applyClose performs all three mutations on READY ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-do-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', '',
                ].join('\n'));
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                fs.writeFileSync(planAbs, '# P\n\n- [x] Step one\n- [x] Step two\n');

                const staged = [];
                const result = applyClose(specPath, {
                    root,
                    now: '2026-06-27T00:00:00.000Z',
                    exec: (args) => { if (args[0] === 'status') return ''; if (args[0] === 'add') { staged.push(...args.slice(1)); return ''; } return ''; },
                    previewFn: () => ({ readiness: 'READY', blockers: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
                    backfillFn: (r) => { fs.mkdirSync(path.join(r, '.evo-lite', 'generated', 'planning'), { recursive: true }); fs.writeFileSync(path.join(r, '.evo-lite', 'generated', 'planning', 'archive-evidence.json'), '{"backfilled":true}\n'); },
                    scanFn: (r) => { fs.writeFileSync(path.join(r, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), '{"rescanned":true}\n'); },
                });

                assert.strictEqual(result.applied, true, 'READY → applied');
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), '# P\n\n- [x] Step one\n- [x] Step two\n', 'all checkboxes flipped');
                assert.ok(/^status: done$/m.test(fs.readFileSync(specPath, 'utf8')), 'spec status set to done');
                assert.ok(fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json')), 'R008 backfill ran');
                assert.ok(fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json')), 'IR rescan ran');
                assert.ok(result.journalPath && fs.existsSync(result.journalPath), 'journal written');
                const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'applied', 'journal marked applied on success');
                assert.strictEqual(journal.createdAt, '2026-06-27T00:00:00.000Z', 'journal records supplied now');
                assert.ok(staged.includes(planRel), 'plan file staged');
                assert.ok(result.actions.some(a => /flip/.test(a)) && result.actions.some(a => /status: done/.test(a)) && result.actions.some(a => /R008/.test(a)), 'actions describe all three mutations');

                console.log('✅ T41 applyClose mutations');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
```

- [x] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `READY → applied` (`applied` is `false`, returns `not-implemented`).

- [x] **Step 3: Write minimal implementation**

Replace the entire `close-apply.js` body with the full engine. Note the added requires, the `slugFor`/`setStatusDone`/`defaultBackfill`/`defaultScan`/`writeJournal` helpers, and the journal-then-apply block that replaces the Task-1 `not-implemented` stub:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');
const { parseFrontmatter } = require('../planning/parse-markdown');

function defaultExec(root) {
    return (args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function defaultBackfill(root) {
    return require('../planning/backfill-evidence').backfillArchiveEvidence(root);
}

function defaultScan(root) {
    const { scanPlanning, writePlanIR } = require('../planning/scan');
    return writePlanIR(root, scanPlanning(root));
}

function slugFor(fm, specPath) {
    const id = String(fm.id || '').replace(/^spec:/, '').trim();
    return id || path.basename(specPath).replace(/\.md$/, '');
}

// Set frontmatter `status:` to done (rewrite the key, or insert if absent).
function setStatusDone(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return text;
    let block = m[1];
    if (/^status:.*$/m.test(block)) {
        block = block.replace(/^status:.*$/m, 'status: done');
    } else {
        block = block + '\nstatus: done';
    }
    return text.replace(m[0], `---\n${block}\n---`);
}

function writeJournal(journalPath, payload) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.writeFileSync(journalPath, JSON.stringify(payload, null, 2) + '\n');
}

function applyClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec(root);
    const previewFn = opts.previewFn || ((sp) => previewClose(sp, { root }));
    const backfillFn = opts.backfillFn || defaultBackfill;
    const scanFn = opts.scanFn || defaultScan;
    const now = opts.now || new Date().toISOString();

    // Gate 1: clean tree.
    const porcelain = String(exec(['status', '--porcelain']) || '').trim();
    if (porcelain) {
        return { applied: false, refused: 'dirty-tree', readiness: null,
            message: 'working tree is dirty — commit or stash first' };
    }

    // Gate 2: READY only.
    const preview = previewFn(specPath);
    if (preview.readiness !== 'READY') {
        return { applied: false, refused: preview.readiness, readiness: preview.readiness,
            blockers: preview.blockers || [], note: preview.note };
    }

    const specText = fs.readFileSync(specPath, 'utf8');
    const fm = parseFrontmatter(specText).frontmatter || {};
    const plan = preview.plan || {};

    // Build target list (every file --apply may overwrite).
    const planAbs = (plan.uncheckedBoxes > 0 && plan.planPath) ? path.join(root, plan.planPath) : null;
    const willSetStatus = fm.status !== 'done';
    const archPath = path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json');
    const irPath = path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const targets = [];
    if (planAbs) targets.push(planAbs);
    if (willSetStatus) targets.push(specPath);
    targets.push(archPath, irPath);

    // Journal: snapshot prior bytes (null = file absent).
    const entries = targets.map(p => ({ path: p, priorBytes: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }));
    const journalPath = path.join(root, '.evo-lite', 'verification', `close-journal-${slugFor(fm, specPath)}.json`);
    const journal = { version: 'evo-close-journal@1', spec: specPath, createdAt: now, status: 'applying',
        entries: entries.map(e => ({ path: path.relative(root, e.path).replace(/\\/g, '/'), existed: e.priorBytes !== null })) };
    writeJournal(journalPath, journal);

    const actions = [];
    try {
        if (planAbs) {
            const txt = fs.readFileSync(planAbs, 'utf8');
            fs.writeFileSync(planAbs, txt.replace(/- \[ \] /g, '- [x] '));
            actions.push(`flip ${plan.uncheckedBoxes} checkbox(es) in ${plan.planPath}`);
        }
        if (willSetStatus) {
            fs.writeFileSync(specPath, setStatusDone(specText));
            actions.push('set spec status: done');
        }
        backfillFn(root);
        scanFn(root);
        actions.push('backfill R008 archive evidence + rescan plan IR');
    } catch (err) {
        for (const e of entries) {
            if (e.priorBytes === null) { if (fs.existsSync(e.path)) fs.unlinkSync(e.path); }
            else fs.writeFileSync(e.path, e.priorBytes);
        }
        writeJournal(journalPath, Object.assign({}, journal, { status: 'aborted', error: err.message }));
        return { applied: false, aborted: true, error: err.message, journalPath };
    }

    const staged = targets.filter(p => fs.existsSync(p)).map(p => path.relative(root, p).replace(/\\/g, '/'));
    if (staged.length) exec(['add', ...staged]);
    writeJournal(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));

    return { applied: true, readiness: 'READY', actions, journalPath, staged };
}

module.exports = { applyClose, setStatusDone, slugFor };
```

- [x] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T41 applyClose mutations` (and `T40` still green).

- [x] **Step 5: Register the managed file**

In `templates/cli/template-manifest.js`, add `'verification/close-apply.js',` to the `core-cli` family `files` array, immediately after the `'verification/close-commands.js',` line (currently line 39):

```js
            'verification/close-commands.js',
            'verification/close-apply.js',
```

- [x] **Step 6: Commit**

```bash
git add templates/cli/verification/close-apply.js templates/cli/template-manifest.js templates/cli/test.js
git commit -m "feat(verification): applyClose journaled mutations + staging on READY"
```

---

### Task 3: Rollback on mid-apply failure

**Files:**
- Test: `templates/cli/test.js` (governance suite, new block `T42`)

**Interfaces:**
- Consumes: `applyClose` from Task 2 (the `try/catch` rollback path is already implemented; this task proves it). No production code change expected — if the test fails, fix the rollback block in `close-apply.js`.

- [x] **Step 1: Write the failing test**

Add this block immediately after the `T41` block in `runGovernanceTests()`:

```js
        console.log('T42. Testing applyClose rolls back every file on mid-apply failure ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-rb-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                const specBefore = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
                fs.writeFileSync(specPath, specBefore);
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                const planBefore = '# P\n\n- [x] Step one\n- [x] Step two\n';
                fs.writeFileSync(planAbs, planBefore);

                const result = applyClose(specPath, {
                    root,
                    now: '2026-06-27T00:00:00.000Z',
                    exec: (args) => (args[0] === 'status' ? '' : ''),
                    previewFn: () => ({ readiness: 'READY', blockers: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
                    backfillFn: () => { throw new Error('boom in backfill'); },
                    scanFn: () => { throw new Error('should not reach scan'); },
                });

                assert.strictEqual(result.applied, false, 'failed apply is not applied');
                assert.strictEqual(result.aborted, true, 'result flags aborted');
                assert.ok(/boom/.test(result.error), 'error surfaced');
                // Files restored byte-for-byte (mutations before the throw are undone).
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planBefore, 'plan restored to prior bytes');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specBefore, 'spec restored to prior bytes');
                const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'aborted', 'journal marked aborted');

                console.log('✅ T42 applyClose rollback');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
```

- [x] **Step 2: Run test to verify it passes (rollback already implemented in Task 2)**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T42 applyClose rollback`. The checkbox flip and spec-status write happen before `backfillFn` throws, so this proves both are reverted.

If it FAILS (files not restored), the bug is in the `catch` block of `close-apply.js`: ensure it iterates `entries` and rewrites `priorBytes` (or `unlinkSync` when `priorBytes === null`) before returning.

- [x] **Step 3: Commit**

```bash
git add templates/cli/test.js
git commit -m "test(verification): applyClose rollback restores prior bytes on failure"
```

---

### Task 4: CLI `mem close --apply` wiring

**Files:**
- Modify: `templates/cli/verification/close-commands.js`
- Test: `templates/cli/test.js` (governance suite, new block `T43`)

**Interfaces:**
- Consumes: `applyClose` from `./close-apply`.
- Produces: `mem close <spec> --apply [--json]` calls `applyClose` and prints actions/journal/staged; `--json` emits the result object; passing neither `--preview` nor `--apply` errors `specify --preview or --apply` with exit 1.

- [x] **Step 1: Write the failing test**

Add this block immediately after the `T42` block in `runGovernanceTests()`:

```js
        console.log('T43. Testing close-commands wires --apply and requires a mode flag ...');
        {
            const { registerCloseCommands } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands'));
            // Capture the action handler by faking a minimal commander program.
            let handler = null; const opts = [];
            const fakeCmd = {
                description() { return this; },
                option(flag) { opts.push(flag); return this; },
                action(fn) { handler = fn; return this; },
            };
            const program = { command() { return fakeCmd; } };
            registerCloseCommands(program);
            assert.ok(typeof handler === 'function', 'close command registers an action handler');
            assert.ok(opts.some(o => /--apply/.test(o)), 'an --apply option is declared');

            const logs = []; const errs = [];
            const origLog = console.log; const origErr = console.error;
            console.log = (...a) => logs.push(a.join(' '));
            console.error = (...a) => errs.push(a.join(' '));
            try {
                process.exitCode = 0;
                handler('some-spec.md', { /* neither flag */ });
                assert.ok(errs.some(e => /specify --preview or --apply/.test(e)), 'neither flag errors');
                assert.strictEqual(process.exitCode, 1, 'neither flag exits non-zero');
            } finally {
                console.log = origLog; console.error = origErr; process.exitCode = 0;
            }
            console.log('✅ T43 close-commands --apply wiring');
        }
```

- [x] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `an --apply option is declared` (the option exists but the neither-flag message is still `--apply not yet implemented (Phase 3); use --preview`, so `specify --preview or --apply` is not found / exit logic differs).

- [x] **Step 3: Write minimal implementation**

Replace the body of `templates/cli/verification/close-commands.js` with:

```js
'use strict';

const { previewClose } = require('./close-preview');
const { applyClose } = require('./close-apply');

function printPreview(r) {
    console.log(`readiness: ${r.readiness}`);
    if (r.note) console.log(`  ${r.note}`);
    for (const b of r.blockers) console.log(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
    if (r.actions.length) {
        console.log('actions --apply would run:');
        for (const a of r.actions) console.log(`  • ${a}`);
    }
}

function printApply(r) {
    if (!r.applied) {
        if (r.refused === 'dirty-tree') { console.error(r.message); return; }
        console.error(`refused: ${r.readiness || r.refused}`);
        if (r.note) console.error(`  ${r.note}`);
        for (const b of (r.blockers || [])) console.error(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
        if (r.aborted) console.error(`  aborted (rolled back): ${r.error}`);
        return;
    }
    console.log('readiness: READY — closed (staged, not committed)');
    for (const a of r.actions) console.log(`  • ${a}`);
    console.log(`journal: ${r.journalPath}`);
    if (r.staged.length) console.log(`staged: ${r.staged.join(', ')}`);
}

function registerCloseCommands(program) {
    program.command('close <spec>')
        .description('Closure for a spec: --preview (read-only) or --apply (journaled mutation).')
        .option('--preview', 'Read-only readiness report')
        .option('--apply', 'Perform the closure (only when READY); staged, not committed')
        .option('--strict', 'With --preview: exit non-zero unless READY')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            if (!options.preview && !options.apply) {
                console.error('specify --preview or --apply');
                process.exitCode = 1;
                return;
            }
            if (options.apply) {
                const r = applyClose(specPath);
                if (options.json) console.log(JSON.stringify(r, null, 2));
                else printApply(r);
                if (!r.applied) process.exitCode = 1;
                return;
            }
            const r = previewClose(specPath);
            if (options.json) console.log(JSON.stringify(r, null, 2));
            else printPreview(r);
            if (options.strict && r.readiness !== 'READY') process.exitCode = 1;
        });
}

module.exports = { registerCloseCommands };
```

- [x] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T43 close-commands --apply wiring`.

- [x] **Step 5: Commit**

```bash
git add templates/cli/verification/close-commands.js templates/cli/test.js
git commit -m "feat(verification): mem close --apply CLI wiring (preview|apply required)"
```

---

### Task 5: Full-suite verification, runtime sync, and capstone dogfood

**Files:**
- Modify: `.evo-lite/cli/verification/*` (runtime mirror, via sync)
- Modify: `docs/superpowers/specs/2026-06-27-verification-contract-phase3.md` (frontmatter `status: done`)
- Modify: `docs/superpowers/plans/2026-06-27-verification-contract-phase3.md` (checkboxes)

**Interfaces:**
- Consumes: the `mem` CLI from the synced `.evo-lite/cli` mirror; `mem verify-contract run|status`, `mem close --preview|--apply`.

- [x] **Step 1: Run the full test suite (both scopes)**

Run: `npm test`
Expected: TWO `passed!` lines (governance T13–T43 then integration), exit 0. If governance modules can't be found via the mirror, that is expected here — `npm test` runs against `templates/cli`. Fix any real failure before continuing.

- [x] **Step 2: Sync the runtime mirror so the live CLI sees `close-apply.js`**

Run (PowerShell): `.\.evo-lite\mem.cmd sync-runtime` — repeat 2–3× if the report shows a partial `copied:` count (known partial-mirror self-brick; see memory). Then hand-verify the new file mirrored:

Run (bash): `ls .evo-lite/cli/verification/close-apply.js`
Expected: the file exists. If sync refuses to copy it, hand-copy: `cp templates/cli/verification/close-apply.js .evo-lite/cli/verification/close-apply.js` and re-run sync once to update the lock.

- [x] **Step 3: Bind contract evidence at a clean HEAD, then dogfood the closure**

The Phase-3 spec declares 5 criteria whose verifier is `node ./.evo-lite/cli/test.js governance`. With the working tree committed clean:

```bash
git status --porcelain   # must be empty
.\.evo-lite\mem.cmd verify-contract run docs/superpowers/specs/2026-06-27-verification-contract-phase3.md
.\.evo-lite\mem.cmd close docs/superpowers/specs/2026-06-27-verification-contract-phase3.md --preview --strict
```
Expected: `run` writes 5 PASS records (all `dependsOn` files exist, governance suite exits 0); `close --preview --strict` prints `readiness: READY` and exits 0. If BLOCKED, read the blocker remedy, resolve, re-run.

- [x] **Step 4: Capstone — actually close the spec with `--apply`**

```bash
.\.evo-lite\mem.cmd close docs/superpowers/specs/2026-06-27-verification-contract-phase3.md --apply
```
Expected: prints `readiness: READY — closed`, the three actions, the journal path, and the staged files (the plan `.md`, the spec, and the regenerated planning JSON). Verify:

```bash
git diff --cached --name-only   # the staged closure files
```
Expected: plan + spec + `archive-evidence.json` + `plan-ir.json`. The plan's checkboxes are all `- [x]`, the spec frontmatter is `status: done`, and `.evo-lite/verification/close-journal-verification-contract-phase3.json` has `status: "applied"`.

- [x] **Step 5: Confirm drift is clean and commit the closure**

```bash
.\.evo-lite\mem.cmd plan scan
git add -A
git commit -m "feat(verification): Phase 3 mem close --apply shipped + self-closed via --apply"
```
Expected: `plan scan` reports `No planning drift findings` (drift 0) — the Phase-3 spec is now `done`, its plan 5/5, and R008 evidence backfilled. The capstone proves the full loop: a spec is auto-closed ONLY through a READY contract verdict.

## Self-Review

**1. Spec coverage:** All 5 acceptance criteria mapped — `ac-dirty-tree-fail-closed` + `ac-refuse-when-not-ready` → Task 1 (T40); `ac-apply-when-ready` → Task 2 (T41); `ac-rollback-on-failure` → Task 3 (T42); `ac-cli-apply-wiring` → Task 4 (T43). Spec's journal/staging/idempotency/STALE-non-interaction → Task 2 engine. Runtime sync + dogfood → Task 5. No gaps.

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output.

**3. Type consistency:** `applyClose(specPath, opts)` and its result keys (`applied`, `refused`, `readiness`, `blockers`, `note`, `aborted`, `error`, `actions`, `journalPath`, `staged`) are identical across Tasks 1–4. `previewFn`/`exec`/`backfillFn`/`scanFn`/`now` opts consistent. Journal shape (`version`/`spec`/`createdAt`/`status`/`entries`) stable. CLI consumes the same result keys the engine produces.
