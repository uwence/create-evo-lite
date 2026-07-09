# Hive Child Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the mother↔child hive loop: children report evo-lite friction via a genes-defined outbox that nurture/status collects, and nurture detects committed child gene mutations (via `runtime-mirror.lock.json` checksums) and refuses to silently overwrite them.

**Architecture:** A new small pure module `hive/feedback.js` owns outbox grammar (backlog-style checkbox lines) and marking. `nurtureChild()` gains a feedback-collection read (report + transactional mark-as-collected) and a mutation preflight (child-active-hash vs lock-hash on non-anchored planned entries → `refused` unless `--force`). `childStatus()` gains a read-only feedback report. A new managed genes rule documents the protocol for child agents; `create-evo-lite` scaffolds the empty outbox.

**Tech Stack:** Node.js (CommonJS), zero new deps. Tests in `templates/cli/test/governance.js` (assert + temp dirs, same pattern as T-hive-nurture).

**Spec:** `docs/superpowers/specs/2026-07-09-hive-child-feedback-loop.md` (`spec:hive-child-feedback-loop`)

## Global Constraints

- Genes-only holds: nurture never writes child *state*; the outbox file and its check-marks are hive protocol files (same class as `nurture-received.json`), written only inside the existing transaction.
- Outbox grammar = backlog grammar: `- [ ] [label] text` / `- [x] ...`, label `[A-Za-z0-9_-]{1,32}`. Do NOT require `memory.service.js` from hive modules (it drags db deps); `hive/feedback.js` re-implements the 2 regexes standalone.
- Lock keys are child-relative paths with forward slashes: `path.relative(childRoot, activeFile).replace(/\\/g, '/')` — must match `nurture.js` checksum-writing exactly.
- Mutation detection: only entries in the *planned* (to-be-overwritten) set, only non-anchored (`mergeAnchors.length === 0`), only when the lock has a hash for that key. Missing lock file entirely → `report.lockMissing = true` WARN, never refuse.
- Dry-run / `--check` must stay pure reads and must include `feedback` and `mutations` in the report.
- All mother template edits go to `templates/cli/...`; after each task run `node ./.evo-lite/cli/sync-runtime.js` (known gotcha: when a new managed file is introduced, sync may need to run 2–3× or the mirror hand-copied — verify `.evo-lite/cli/hive/feedback.js` exists after sync).
- Tests run in BOTH mother and child runtime modes; new hive tests must build their own temp mother/child (follow T-hive-nurture at `templates/cli/test/governance.js:2425`).
- Plan task headings MUST be `###` (h3) — parser requirement.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `hive/feedback.js` — outbox grammar module

**Files:**
- Create: `templates/cli/hive/feedback.js`
- Modify: `templates/cli/template-manifest.js` (add `'hive/feedback.js'` to `core-cli` files, after `'hive/commands.js'`)
- Test: `templates/cli/test/governance.js` (new block `T-hive-feedback`, insert right before the `T-hive-registry` block near line 2350)

**Interfaces:**
- Produces:
  - `FEEDBACK_REL: string` = `'.evo-lite/hive/feedback.md'`
  - `FEEDBACK_TEMPLATE: string` (file header for scaffolding)
  - `feedbackPath(childRoot: string): string` (absolute path)
  - `parseFeedback(text: string): Array<{checked: boolean, label: string|null, text: string, line: string}>` — checkbox lines only
  - `markCollected(text: string, lines: string[]): string` — returns text with exactly those trimmed lines re-written `- [x]`
  - `readOutbox(childRoot: string): {exists: boolean, text: string, pending: Array<{label, text, line}>}` — `pending` = unchecked items only

- [x] **Step 1: Write the failing test**

Append to `templates/cli/test/governance.js` immediately before the `console.log('T-hive-registry. ...')` line (these tests are pure — safe in child mode):

```js
    console.log('T-hive-feedback. Testing outbox grammar parse/mark ...');
    {
        const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
        const text = '# Outbox\n\n- [ ] [stderr-eaten] context track errors invisible\n- [x] [old1] already collected\n- [ ] no label line\nnot a checkbox\n';
        const items = fb.parseFeedback(text);
        assert.strictEqual(items.length, 3, 'three checkbox lines parsed');
        assert.deepStrictEqual(
            items.map(i => [i.checked, i.label]),
            [[false, 'stderr-eaten'], [true, 'old1'], [false, null]],
            'checked state and labels extracted');
        assert.strictEqual(items[0].text, 'context track errors invisible');

        const marked = fb.markCollected(text, [items[0].line]);
        assert.ok(marked.includes('- [x] [stderr-eaten]'), 'collected line checked');
        assert.ok(marked.includes('- [ ] no label line'), 'unlisted line untouched');
        assert.ok(marked.includes('# Outbox'), 'non-checkbox content preserved');

        const tmpChild = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-fb-'));
        const missing = fb.readOutbox(tmpChild);
        assert.strictEqual(missing.exists, false);
        assert.deepStrictEqual(missing.pending, [], 'missing outbox → zero pending');
        fs.mkdirSync(path.dirname(fb.feedbackPath(tmpChild)), { recursive: true });
        fs.writeFileSync(fb.feedbackPath(tmpChild), text);
        const box = fb.readOutbox(tmpChild);
        assert.strictEqual(box.exists, true);
        assert.strictEqual(box.pending.length, 2, 'only unchecked items pending');
        assert.strictEqual(box.pending[0].label, 'stderr-eaten');
    }
    console.log('✅ T-hive-feedback passed');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/test.js governance` — NOTE: tests run from the `.evo-lite` mirror; either run `node ./.evo-lite/cli/sync-runtime.js` first, or run `node ./templates/cli/test.js governance` is NOT a thing — sync then run.
Expected: FAIL with `Cannot find module ... hive/feedback.js`

- [x] **Step 3: Write the implementation**

Create `templates/cli/hive/feedback.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

// Same grammar as active_context backlog (memory.service.js BACKLOG_ID_RE).
// Re-declared here so hive modules stay free of memory.service's db deps.
const CHECKBOX_RE = /^- \[([ xX])\]\s*(.*)$/;
const LABEL_RE = /^\[([A-Za-z0-9_-]{1,32})\]\s*/;

const FEEDBACK_REL = '.evo-lite/hive/feedback.md';
const FEEDBACK_TEMPLATE = [
    '# 🐝 Hive Feedback Outbox',
    '',
    '> 子巢 agent: 撞到 evo-lite 本身的摩擦(非本项目问题)时, 追加一行:',
    '> `- [ ] [short-label] 现象 + 复现条件`。母巢 nurture 时收集并勾选。',
    '',
    '',
].join('\n');

function feedbackPath(childRoot) {
    return path.join(childRoot, ...FEEDBACK_REL.split('/'));
}

function parseFeedback(text) {
    return String(text).split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- ['))
        .map(line => {
            const m = line.match(CHECKBOX_RE);
            if (!m) return null;
            const body = m[2].trim();
            const labelMatch = body.match(LABEL_RE);
            return {
                checked: m[1].toLowerCase() === 'x',
                label: labelMatch ? labelMatch[1] : null,
                text: labelMatch ? body.slice(labelMatch[0].length).trim() : body,
                line,
            };
        })
        .filter(Boolean);
}

function markCollected(text, lines) {
    const targets = new Set(lines);
    return String(text).split('\n')
        .map(raw => targets.has(raw.trim()) ? raw.replace('- [ ]', '- [x]') : raw)
        .join('\n');
}

function readOutbox(childRoot) {
    const fp = feedbackPath(childRoot);
    if (!fs.existsSync(fp)) return { exists: false, text: '', pending: [] };
    const text = fs.readFileSync(fp, 'utf8');
    const pending = parseFeedback(text)
        .filter(i => !i.checked)
        .map(({ label, text: t, line }) => ({ label, text: t, line }));
    return { exists: true, text, pending };
}

module.exports = { FEEDBACK_REL, FEEDBACK_TEMPLATE, feedbackPath, parseFeedback, markCollected, readOutbox };
```

In `templates/cli/template-manifest.js`, in the `core-cli` `files` array, after `'hive/nurture.js',` / `'hive/commands.js',` add:

```js
            'hive/feedback.js',
```

- [x] **Step 4: Sync mirror and run test to verify it passes**

Run: `node ./.evo-lite/cli/sync-runtime.js` (repeat if it reports a missing managed file — new-file self-brick gotcha), then `node ./.evo-lite/cli/test.js governance`
Expected: `✅ T-hive-feedback passed`, full suite green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/hive/feedback.js templates/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "feat(hive): feedback outbox grammar module (parse/mark/read)"
```

---

### Task 2: nurture collects the outbox (report + transactional mark)

**Files:**
- Modify: `templates/cli/hive/nurture.js`
- Test: `templates/cli/test/governance.js` (new block `T-hive-outbox`, insert right after the `✅ T-hive-nurture passed` line)

**Interfaces:**
- Consumes: `readOutbox`, `markCollected`, `feedbackPath`, `FEEDBACK_TEMPLATE` from Task 1.
- Produces on the nurture report:
  - `report.feedback: Array<{label: string|null, text: string}>` — pending child items, populated in ALL modes incl. dry-run/check.
  - Applied nurture rewrites the child outbox with collected lines checked (or scaffolds `FEEDBACK_TEMPLATE` when the file is absent), inside the existing transaction.

- [x] **Step 1: Write the failing test**

```js
    console.log('T-hive-outbox. Testing feedback collection: report, exactly-once, dry-run purity, scaffold ...');
    {
        const { nurtureChild } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
        const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
        const noGit = () => { throw new Error('not a git repo'); };
        const FAM = [{ key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] }];
        const mkMother = () => {
            const m = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ob-mother-'));
            fs.writeFileSync(path.join(m, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(m, 'templates', 'cli'), { recursive: true });
            fs.writeFileSync(path.join(m, 'templates', 'cli', 'gene.js'), 'module.exports = 2;\n');
            return m;
        };
        const mkChild = () => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ob-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            return c;
        };

        // (a) outbox with 2 pending items: reported + marked checked on apply
        const m = mkMother(); const c = mkChild();
        fs.mkdirSync(path.dirname(fb.feedbackPath(c)), { recursive: true });
        fs.writeFileSync(fb.feedbackPath(c),
            '# Outbox\n- [ ] [fb1] first friction\n- [ ] [fb2] second friction\n- [x] [done] old\n');
        const dry = nurtureChild(m, { id: 'k', path: c }, { dryRun: true, exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(dry.feedback.map(f => f.label), ['fb1', 'fb2'], 'dry-run reports pending feedback');
        assert.ok(fs.readFileSync(fb.feedbackPath(c), 'utf8').includes('- [ ] [fb1]'), 'dry-run does not mark');

        const applied = nurtureChild(m, { id: 'k', path: c }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.strictEqual(applied.status, 'applied');
        assert.deepStrictEqual(applied.feedback.map(f => f.label), ['fb1', 'fb2'], 'apply reports pending feedback');
        const after = fs.readFileSync(fb.feedbackPath(c), 'utf8');
        assert.ok(after.includes('- [x] [fb1]') && after.includes('- [x] [fb2]'), 'collected items checked in child');

        // (b) exactly-once: second nurture reports zero
        const again = nurtureChild(m, { id: 'k', path: c }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(again.feedback, [], 'second nurture collects nothing');

        // (c) child without outbox: zero feedback + scaffolded on apply
        const c2 = mkChild();
        const applied2 = nurtureChild(m, { id: 'k2', path: c2 }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(applied2.feedback, [], 'missing outbox → no feedback');
        assert.ok(fs.existsSync(fb.feedbackPath(c2)), 'outbox scaffolded on apply');
        assert.ok(fs.readFileSync(fb.feedbackPath(c2), 'utf8').includes('Hive Feedback Outbox'), 'scaffold uses template');
    }
    console.log('✅ T-hive-outbox passed');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `dry.feedback` is `undefined`.

- [x] **Step 3: Implement collection in `nurture.js`**

At top of `templates/cli/hive/nurture.js`, add to requires:

```js
const feedback = require('./feedback');
```

In `nurtureChild()`, extend the initial `report` literal with `feedback: [],`.

After the "Plan the copy set" loop (right after `report.upToDate = ...`), add the pure read:

```js
    // --- Feedback outbox: pure read; marking happens inside the transaction ---
    const outbox = feedback.readOutbox(childRoot);
    report.feedback = outbox.pending.map(({ label, text }) => ({ label, text }));
```

Add the outbox to the transaction. Before the `targets` array:

```js
    const outboxPath = feedback.feedbackPath(childRoot);
```

Append `outboxPath` to `targets`. Inside the `apply:` callback, after the receipt write:

```js
            fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
            if (!outbox.exists) {
                fs.writeFileSync(outboxPath, feedback.FEEDBACK_TEMPLATE);
            } else if (outbox.pending.length) {
                fs.writeFileSync(outboxPath, feedback.markCollected(outbox.text, outbox.pending.map(p => p.line)));
            }
```

- [x] **Step 4: Sync + run test to verify it passes**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: `✅ T-hive-outbox passed`; T-hive-nurture still green (its report gains an empty `feedback` array — no assertion conflicts).

- [x] **Step 5: Commit**

```bash
git add templates/cli/hive/nurture.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "feat(hive): nurture collects child feedback outbox exactly-once"
```

---

### Task 3: nurture mutation preflight (lock-checksum divergence → refuse)

**Files:**
- Modify: `templates/cli/hive/nurture.js`
- Test: `templates/cli/test/governance.js` (new block `T-hive-mutation`, after `T-hive-outbox`)

**Interfaces:**
- Produces on the nurture report:
  - `report.mutations: string[]` — labels of planned, non-anchored entries whose child bytes differ from the child's `runtime-mirror.lock.json` hash.
  - `report.lockMissing: boolean` — child has no lock file; detection skipped (WARN, still nurturable).
  - `mutations.length > 0 && !force` → `status: 'refused'` before any write/tag; `--force` proceeds and overwrites.

- [x] **Step 1: Write the failing test**

```js
    console.log('T-hive-mutation. Testing lock-checksum mutation detection: refuse, force, anchored exempt, lockless WARN ...');
    {
        const { nurtureChild } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
        const noGit = () => { throw new Error('not a git repo'); };
        const cleanGit = () => '';
        const FAM = [
            { key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] },
            { key: 'agents-workflows', scope: 'sync-always', activeRoot: 'workspace', templateRoot: 'root', relativeDir: ['.agents', 'workflows'],
              files: [{ path: 'evo.md', mergeAnchors: [['BEGIN_LOCAL', 'END_LOCAL']] }] },
        ];
        const mkMother = (geneBody) => {
            const m = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mu-mother-'));
            fs.writeFileSync(path.join(m, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(m, 'templates', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(m, 'templates', '.agents', 'workflows'), { recursive: true });
            fs.writeFileSync(path.join(m, 'templates', 'cli', 'gene.js'), geneBody);
            fs.writeFileSync(path.join(m, 'templates', '.agents', 'workflows', 'evo.md'),
                '<!-- BEGIN_LOCAL -->\nmother default\n<!-- END_LOCAL -->\nbody v2\n');
            return m;
        };
        const mkChild = () => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mu-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(c, '.agents', 'workflows'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            fs.writeFileSync(path.join(c, '.agents', 'workflows', 'evo.md'),
                '<!-- BEGIN_LOCAL -->\nchild custom\n<!-- END_LOCAL -->\nbody v1\n');
            return c;
        };

        // (a) lockless legacy child: WARN flag, still applies
        const m1 = mkMother('module.exports = 2;\n'); const c1 = mkChild();
        const first = nurtureChild(m1, { id: 'k', path: c1 }, { exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(first.status, 'applied');
        assert.strictEqual(first.lockMissing, true, 'no lock yet → lockMissing WARN flag');
        assert.deepStrictEqual(first.mutations, [], 'no mutation verdict without a lock');

        // (b) committed child edit (clean porcelain) after a locked nurture → refused, child untouched
        const m2 = mkMother('module.exports = 3;\n');
        fs.writeFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 99; // child patch\n');
        const refused = nurtureChild(m2, { id: 'k', path: c1 }, { exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(refused.status, 'refused');
        assert.deepStrictEqual(refused.mutations, ['gene.js'], 'mutated gene named');
        assert.strictEqual(refused.lockMissing, false);
        assert.ok(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'utf8').includes('99'), 'child file untouched on refuse');

        // (c) dry-run reports the mutation without refusing semantics mattering (status dry-run)
        const dry = nurtureChild(m2, { id: 'k', path: c1 }, { dryRun: true, exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(dry.status, 'dry-run');
        assert.deepStrictEqual(dry.mutations, ['gene.js'], 'dry-run surfaces mutations');

        // (d) --force overwrites the mutation
        const forced = nurtureChild(m2, { id: 'k', path: c1 }, { exec: cleanGit, force: true, familiesOverride: FAM });
        assert.strictEqual(forced.status, 'applied');
        assert.strictEqual(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'utf8'), 'module.exports = 3;\n', 'force overwrites');

        // (e) anchored-merge divergence is NEVER a mutation
        const m3 = mkMother('module.exports = 3;\n');
        fs.writeFileSync(path.join(c1, '.agents', 'workflows', 'evo.md'),
            '<!-- BEGIN_LOCAL -->\nchild rewrote everything here\n<!-- END_LOCAL -->\nbody v1\n');
        const anch = nurtureChild(m3, { id: 'k', path: c1 }, { dryRun: true, exec: cleanGit, familiesOverride: FAM });
        assert.deepStrictEqual(anch.mutations, [], 'anchored entries exempt from mutation detection');
    }
    console.log('✅ T-hive-mutation passed');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `first.lockMissing` is `undefined`.

- [x] **Step 3: Implement the preflight in `nurture.js`**

Extend the `report` literal with `mutations: [], lockMissing: false,`.

In the planning loop, capture child bytes once (replace the two `fs.readFileSync(e.activeFile)` reads):

```js
        const childBytes = childExists ? fs.readFileSync(e.activeFile) : null;
```

(use `childBytes` for both the anchor-merge source and the skip-check hash).

Before the planning loop, load the child's existing lock:

```js
    const childLockPath = path.join(childRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json');
    let childLock = null;
    try {
        if (fs.existsSync(childLockPath)) childLock = readJson(childLockPath).entries || {};
    } catch (_) { childLock = null; }
    report.lockMissing = childLock === null;
```

Inside the loop's `else` branch (entry is planned for copy), add the mutation check:

```js
            if (childLock && childExists && (!e.mergeAnchors || e.mergeAnchors.length === 0)) {
                const lockHash = childLock[relActive];
                if (lockHash && sha256(childBytes) !== lockHash) report.mutations.push(e.label);
            }
```

After the dry-run gate (`if (opts.dryRun || opts.check) { ... }`), add the refuse gate BEFORE the git dirty check:

```js
    // --- Preflight 3: committed child gene mutations (lock-hash divergence) ---
    if (report.mutations.length && !opts.force) {
        report.status = 'refused';
        return report;
    }
```

Note: `lockPath` (write target) already exists later in the function with the same value as `childLockPath` — reuse `childLockPath` for the write target and delete the duplicate `const lockPath` declaration, adjusting references.

- [x] **Step 4: Sync + run full suite**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: `✅ T-hive-mutation passed`; T-hive-nurture green (its children never had a lock before first nurture → `lockMissing` WARN path, no refuse; the `m4/c4` re-nurture writes a lock, then pushes identical bytes → skipped set, no mutations).

- [x] **Step 5: Commit**

```bash
git add templates/cli/hive/nurture.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "feat(hive): nurture mutation preflight — lock-hash divergence refuses before overwrite"
```

---

### Task 4: read-only feedback in `hive status` + CLI report surfaces

**Files:**
- Modify: `templates/cli/hive/status.js`
- Modify: `templates/cli/hive/commands.js`
- Test: `templates/cli/test/governance.js` (extend `T-hive-status` block)

**Interfaces:**
- Consumes: `readOutbox` from Task 1; `report.feedback` / `report.mutations` / `report.lockMissing` from Tasks 2–3.
- Produces: `childStatus()` result gains `feedback: Array<{label, text}>` (pending only). Human-mode CLI output prints feedback and mutation lines.

- [x] **Step 1: Write the failing test**

Inside the existing `T-hive-status` block (after its current asserts), add:

```js
        // feedback surfaces read-only in status
        {
            const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
            const motherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-st-mother-'));
            fs.writeFileSync(path.join(motherRoot, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(motherRoot, 'templates', 'cli'), { recursive: true });
            const childRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-st-child-'));
            fs.mkdirSync(path.join(childRoot, '.evo-lite'), { recursive: true });
            fs.writeFileSync(path.join(childRoot, '.evo-lite', 'evo-lite-version.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.dirname(fb.feedbackPath(childRoot)), { recursive: true });
            const outboxText = '- [ ] [st1] status sees me\n- [x] [st0] collected already\n';
            fs.writeFileSync(fb.feedbackPath(childRoot), outboxText);
            const st = childStatus(motherRoot, { id: 'sk', path: childRoot }, { familiesOverride: [] });
            assert.deepStrictEqual(st.feedback, [{ label: 'st1', text: 'status sees me' }], 'status reports pending feedback');
            assert.strictEqual(fs.readFileSync(fb.feedbackPath(childRoot), 'utf8'), outboxText, 'status never writes the outbox');
        }
```

(If `childStatus` in that block is imported without options support for `familiesOverride: []`, check the existing T-hive-status setup and reuse its mother/child fixtures instead — the assertions above are what matter.)

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `st.feedback` is `undefined`.

- [x] **Step 3: Implement**

`templates/cli/hive/status.js` — require the module and extend `childStatus`:

```js
const { readOutbox } = require('./feedback');
```

In `childStatus()`, before the final `return`, add:

```js
    const feedback = readOutbox(entry.path).pending.map(({ label, text }) => ({ label, text }));
```

and include `feedback` in BOTH return objects (the `unreachable` early return gets `feedback: []`).

`templates/cli/hive/commands.js` — human-mode output:

In the `hive status` action loop, after the existing `console.log`:

```js
                if (r.feedback && r.feedback.length) {
                    for (const f of r.feedback) console.log(`   📬 [${f.label || '-'}] ${f.text}`);
                }
```

In the `hive nurture` action's non-JSON branch, after the dirty-files line:

```js
                if (report.lockMissing) console.log('⚠️ child has no runtime-mirror.lock.json — mutation detection skipped (legacy child)');
                if (report.mutations && report.mutations.length) console.log(`🧬 child gene mutations (vs last nurture lock): ${report.mutations.join(', ')} — absorb into mother or re-run with --force to overwrite`);
                if (report.feedback && report.feedback.length) {
                    console.log(`📬 collected child feedback (${report.feedback.length}):`);
                    for (const f of report.feedback) console.log(`   - [${f.label || '-'}] ${f.text}`);
                }
```

- [x] **Step 4: Sync + run test to verify it passes**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: extended `T-hive-status` green.

- [x] **Step 5: Commit**

```bash
git add templates/cli/hive/status.js templates/cli/hive/commands.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "feat(hive): status reports child feedback read-only; CLI prints feedback/mutations"
```

---

### Task 5: genes rule + scaffold + managed-family registration

**Files:**
- Create: `templates/.agents/rules/hive-feedback.md`
- Modify: `templates/cli/template-manifest.js` (new `agents-rules` family)
- Modify: `index.js` (scaffold empty outbox at init)
- Test: `templates/cli/test/governance.js` (extend the `T-hive-manifest` block — note it is mother-bound)

**Interfaces:**
- Consumes: `FEEDBACK_TEMPLATE`, `FEEDBACK_REL` from Task 1.
- Produces: nurture now syncs `.agents/rules/hive-feedback.md` into every child; `npx create-evo-lite` scaffolds `.evo-lite/hive/feedback.md`.

- [x] **Step 1: Write the failing test**

In the mother-bound `T-hive-manifest` block (`templates/cli/test/governance.js:1852` area), add:

```js
        // hive-feedback genes: rule template exists and is a managed sync-always entry
        const manifest = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
        const rulesFam = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'agents-rules');
        assert.ok(rulesFam, 'agents-rules managed family exists');
        assert.strictEqual(rulesFam.scope, 'sync-always');
        assert.deepStrictEqual(rulesFam.files, ['hive-feedback.md']);
        assert.ok(fs.existsSync(path.join(WORKSPACE_ROOT, 'templates', '.agents', 'rules', 'hive-feedback.md')),
            'rule template file present');
        assert.ok(manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli').files.includes('hive/feedback.js'),
            'feedback module is a managed core-cli gene');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `agents-rules managed family exists`.

- [x] **Step 3: Implement**

Create `templates/.agents/rules/hive-feedback.md`:

```markdown
# Hive Feedback Outbox 协议

本项目是母巢 (create-evo-lite) 的子巢。evo-lite 基因 (`.evo-lite/cli/`, `.agents/` 受管文件) 由母巢 nurture 单向下发，子巢不自行修改。

## 何时上报

当你在工作中撞到 **evo-lite 本身** 的摩擦 — CLI 报错误导、治理规则误判、文档与行为不符 — 而不是本项目代码的问题时：

1. 打开 `.evo-lite/hive/feedback.md`（不存在则以任意内容创建）。
2. 追加一行，格式与 backlog 相同：

   `- [ ] [short-label] 现象 + 复现条件 + 期望行为`

   label 限 `[A-Za-z0-9_-]{1,32}`。

3. 正常提交。母巢下次 nurture 会收集这些条目（并勾选为 `- [x]`），转为母巢 backlog 候选。

## 禁止

- 不要直接修改 `.evo-lite/cli/` 下的受管基因文件来"顺手修掉"摩擦 — nurture 会检测到变异并拒绝推送；真正的修复应经由上报流入母巢。
- 不要把本项目自身的 bug 写进 outbox — 那属于本项目的 backlog。
```

In `templates/cli/template-manifest.js`, after the `agents-workflows` family object, add:

```js
    {
        key: 'agents-rules',
        scope: 'sync-always',
        activeRoot: 'workspace',
        templateRoot: 'root',
        relativeDir: ['.agents', 'rules'],
        files: ['hive-feedback.md'],
    },
```

(Only this one rule is managed — the other `.agents/rules/*` files stay child-customizable, copied once at init.)

In `index.js`, after the `copyRecursiveSync(cliTemplatesDir, cliDir);` block (~line 440), add:

```js
    // Hive feedback outbox：子巢上报 evo-lite 摩擦的协议文件（内容归子巢，只在缺失时创建）
    const hiveFeedbackPath = path.join(evoLiteDir, 'hive', 'feedback.md');
    if (!fs.existsSync(hiveFeedbackPath)) {
        fs.mkdirSync(path.dirname(hiveFeedbackPath), { recursive: true });
        fs.writeFileSync(hiveFeedbackPath, require(path.join(cliTemplatesDir, 'hive', 'feedback.js')).FEEDBACK_TEMPLATE);
    }
```

(NOTE: `index.js` requires from `templates/cli` — verify the actual variable names at the insertion point; `cliTemplatesDir` is in scope there.)

- [x] **Step 4: Sync + run FULL suite + scaffold smoke test**

Run: `node ./.evo-lite/cli/sync-runtime.js && node ./.evo-lite/cli/test.js all`
Expected: all green, incl. extended T-hive-manifest.

Scaffold smoke (scratch dir, non-interactive flags as supported — check `node index.js --help`):

```powershell
node index.js "$env:TEMP\evo-scaffold-smoke" --yes 2>&1 | Select-Object -Last 5
Test-Path "$env:TEMP\evo-scaffold-smoke\.evo-lite\hive\feedback.md"
Test-Path "$env:TEMP\evo-scaffold-smoke\.agents\rules\hive-feedback.md"
```

Expected: both `True`. (If `--yes` isn't a flag, pipe `echo y |` or check index.js arg handling first.)

- [x] **Step 5: Commit**

```bash
git add templates/.agents/rules/hive-feedback.md templates/cli/template-manifest.js index.js templates/cli/test/governance.js .evo-lite/cli/ .agents/rules/hive-feedback.md
git commit -m "feat(hive): managed hive-feedback rule gene + outbox scaffold at init"
```

---

### Task 6: closure — full verify, CHANGELOG, runtime-state closure

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section)
- Runtime state via CLI only (no direct `active_context.md` edits)

- [x] **Step 1: Full suite + verify**

Run: `node ./.evo-lite/cli/test.js all` then `.\.evo-lite\mem.cmd verify`
Expected: all tests green; verify healthy.

- [x] **Step 2: CHANGELOG entry**

Under `Unreleased` (create the section if absent), add:

```markdown
### Added
- Hive child feedback loop (`spec:hive-child-feedback-loop`): child outbox `.evo-lite/hive/feedback.md` collected exactly-once by `hive nurture` (read-only in `hive status`); managed genes rule `.agents/rules/hive-feedback.md`; scaffolded at init.
- Nurture mutation preflight: committed child edits to non-anchored managed genes (detected vs `runtime-mirror.lock.json` hashes) now `refused` with a 🧬 report instead of silently overwritten; `--force` overwrites; lockless legacy children WARN and proceed.
```

- [x] **Step 3: Resolve the backlog item + closure commit**

Use the mem commit fast path (closure semantics live in the CLI):

```powershell
.\.evo-lite\mem.cmd commit --resolve child-feedback-loop "hive-child-feedback-loop: outbox collection + mutation preflight shipped (spec:hive-child-feedback-loop, all ACs test-backed)"
```

(Check `mem commit --help` for the exact resolve flag first; fall back to `context track` + manual resolve if the fast path lacks it.)

- [x] **Step 4: detect_changes regression gate**

Per CLAUDE.md, run GitNexus `detect_changes()` (MCP) and confirm affected symbols are only: `nurtureChild`, `childStatus`, `registerHiveCommands`, manifest constants, new `hive/feedback.js` exports, `index.js` scaffold block. Report blast radius to the user.

---

## Self-Review Notes

- Spec AC coverage: ac-outbox-collected-once → Task 2 tests (a)(b); ac-status-reports-without-marking → Task 4 test; ac-mutation-refuses-before-overwrite → Task 3 (b)(d); ac-mutation-skips-anchored-and-lockless → Task 3 (a)(e); ac-outbox-scaffolded-and-ruled → Task 5 test + smoke.
- Type consistency: `report.feedback` items are `{label, text}` everywhere; outbox internal items carry `line` only inside `feedback.js`/nurture marking. `mutations` is `string[]` of labels (mirrors `dirtyFiles`).
- Known risk: T-hive-nurture's existing `m4` clean-git re-nurture — after Task 3 the second nurture reads the lock written by... nothing (first call was `refused`, wrote no lock) → `lockMissing=true`, no refuse. Safe.
- Known risk: sync-runtime self-brick on new managed file (`hive/feedback.js`) — Global Constraints tells implementer to re-run sync and verify the mirror file exists before running tests.
