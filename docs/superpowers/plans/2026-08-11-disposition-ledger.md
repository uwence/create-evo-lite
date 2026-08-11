---
id: plan:disposition-ledger
status: draft
linkedSpec: spec:disposition-ledger
---

# Disposition Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "deliberately not acting on this finding" a persistent, machine-readable, git-tracked state that expires automatically when the facts behind the finding change.

**Architecture:** Four small modules under `templates/cli/disposition/` — `fingerprint.js` (canonical hashing), `ledger.js` (schema + atomic IO), `resolve.js` (CURRENT/STALE/ORPHANED), `commands.js` (CLI). Both finding producers gain stable ids, declared `factInputs`, and a completeness signal. The three consumers annotate findings through one shared resolver and never filter.

**Tech Stack:** Node.js >= 20, CommonJS, commander (already wired in `memory.js`), hand-rolled test suites under `templates/cli/test/`.

## Global Constraints

- **Double mirror:** every file under `cli/` exists in BOTH `templates/cli/` (source) and `.evo-lite/cli/` (live runtime mirror), byte-identical. Every create/modify happens in BOTH trees. `npm test` runs `node ./.evo-lite/cli/test.js`.
- **Node floor:** `>=20.0.0`. CommonJS only (`require`/`module.exports`), no ESM.
- **New files must be registered** in `templates/cli/template-manifest.js` or `sync-runtime` will not distribute them.
- **Detection rules are NOT changed.** `size-gate-state-blindness`, `zombie-plan-parked-deadlock` and `progress-empty-evidence-vacuous-pass` stay exactly as they are — this layer only annotates.
- **Acceptance criteria are frozen at 9.** Do not add AC10; new requirements extend the AC that owns their failure boundary.
- **Do not nurture child hives.** Distribution is a separate gated step.
- **Fail-closed on doubt.** A failure to observe must never be encoded as a change in fact.
- **Never `git add`/`git commit` from a hook.**

---

### Task 1: Canonical fingerprint

**Files:**
- Create: `templates/cli/disposition/fingerprint.js`
- Create: `.evo-lite/cli/disposition/fingerprint.js`
- Modify: `templates/cli/template-manifest.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/disposition/fingerprint.js, templates/cli/template-manifest.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac2

**Interfaces:**
- Produces: `canonicalJson(value) -> string`
- Produces: `computeFingerprint({ ruleId, ruleVersion, factInputs }) -> string` (64-char hex)
- Produces: `SET_KEYS` — the `factInputs` keys whose arrays carry set semantics and are sorted before hashing

- [ ] **Step 1: Write the failing test**

Add to `templates/cli/test/governance.js`, before `console.log('T-spec-status-vocabulary…`:

```js
console.log('T-disposition-fingerprint. Canonical hashing is stable across key and set order ...');
{
    const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
    const a = fp.computeFingerprint({ ruleId: 'R005', ruleVersion: 1,
        factInputs: { alpha: 1, linkedFiles: ['b', 'a'] } });
    const b = fp.computeFingerprint({ ruleId: 'R005', ruleVersion: 1,
        factInputs: { linkedFiles: ['a', 'b'], alpha: 1 } });
    assert.strictEqual(a, b, 'key order and set-array order must not change the fingerprint');
    assert.match(a, /^[0-9a-f]{64}$/, 'fingerprint is sha256 hex');

    const bumped = fp.computeFingerprint({ ruleId: 'R005', ruleVersion: 2,
        factInputs: { alpha: 1, linkedFiles: ['a', 'b'] } });
    assert.notStrictEqual(a, bumped, 'ruleVersion participates in the fingerprint');

    const other = fp.computeFingerprint({ ruleId: 'R008', ruleVersion: 1,
        factInputs: { alpha: 1, linkedFiles: ['a', 'b'] } });
    assert.notStrictEqual(a, other, 'ruleId participates in the fingerprint');

    assert.strictEqual(
        fp.canonicalJson({ path: 'a\\b\\c' }),
        fp.canonicalJson({ path: 'a/b/c' }),
        'PATH keys are normalized to forward slashes before hashing');
    assert.notStrictEqual(
        fp.canonicalJson({ reason: 'a\\b' }),
        fp.canonicalJson({ reason: 'a/b' }),
        'a non-path string is NOT path-normalized — blanket rewriting would corrupt prose and shas');
    assert.strictEqual(
        fp.canonicalJson({ lastTouchedAt: '2026-08-11T10:00:00+08:00' }),
        fp.canonicalJson({ lastTouchedAt: '2026-08-11T02:00:00Z' }),
        'timestamps normalize to UTC — git %cI keeps a local offset that differs per machine');
    console.log('✅ T-disposition-fingerprint passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `Cannot find module '…/disposition/fingerprint'`

- [ ] **Step 3: Write minimal implementation**

Create `templates/cli/disposition/fingerprint.js`:

```js
'use strict';

const crypto = require('crypto');

// factInputs keys whose arrays are sets, not sequences. Order must not matter.
const SET_KEYS = Object.freeze(new Set([
    'linkedFiles', 'notDonePlans', 'taskStatuses', 'linkedPlans',
]));

// Only these keys are treated as paths. Blanket `\ -> /` on every string would
// silently rewrite prose, ids and shas that merely contain a backslash.
const PATH_KEYS = Object.freeze(new Set(['path', 'file', 'linkedFiles']));

// Only these are normalized to UTC. `lastTouchedAt` arrives from
// `git log --format=%cI`, which keeps the committer's local offset — two
// machines would otherwise fingerprint the same instant differently.
const TIMESTAMP_KEYS = Object.freeze(new Set(['lastTouchedAt', 'at', 'orphanedAt']));

function normalizeScalar(value, key) {
    if (typeof value !== 'string') return value;
    if (PATH_KEYS.has(key)) return value.replace(/\\/g, '/');
    if (TIMESTAMP_KEYS.has(key)) {
        const t = Date.parse(value);
        return Number.isNaN(t) ? value : new Date(t).toISOString();
    }
    return value;
}

function canonicalize(value, key) {
    if (Array.isArray(value)) {
        const items = value.map(v => canonicalize(v, key));
        if (SET_KEYS.has(key)) items.sort();
        return items;
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k], k);
        return out;
    }
    return normalizeScalar(value, key);
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value, null));
}

function computeFingerprint({ ruleId, ruleVersion, factInputs }) {
    if (!ruleId) throw new Error('computeFingerprint: ruleId is required');
    if (!Number.isInteger(ruleVersion)) throw new Error('computeFingerprint: ruleVersion must be an integer');
    const payload = canonicalJson({ ruleId, ruleVersion, factInputs: factInputs || {} });
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

module.exports = { canonicalJson, computeFingerprint, SET_KEYS };
```

Register in `templates/cli/template-manifest.js` — add `'disposition/fingerprint.js',` to the same file list that already contains `'planning/freeze-ledger.js'`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/disposition/fingerprint.js .evo-lite/cli/disposition/fingerprint.js
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
node .evo-lite/cli/test.js governance
```

Expected: PASS — `✅ T-disposition-fingerprint passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/disposition/fingerprint.js .evo-lite/cli/disposition/fingerprint.js \
        templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): canonical fingerprint over ruleId, ruleVersion and factInputs"
```

---

### Task 2: Ledger storage

**Files:**
- Create: `templates/cli/disposition/ledger.js`
- Create: `.evo-lite/cli/disposition/ledger.js`
- Modify: `.gitignore:16`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/disposition/ledger.js, templates/cli/template-manifest.js, .gitignore, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac6

**Interfaces:**
- Consumes: nothing
- Produces: `LEDGER_VERSION = 'evo-disposition-ledger@1'`
- Produces: `CHOICES` — frozen Set of `not-applicable`, `accepted-debt`, `deferred`, `wont-fix`
- Produces: `readLedger(projectRoot) -> { version, entries }` (empty ledger when absent)
- Produces: `writeLedger(projectRoot, ledger) -> void` (sorted, 2-space, trailing newline, atomic)
- Produces: `upsertEntry(ledger, entry) -> ledger` (replaces any existing entry with the same `findingId`)
- Produces: `ledgerPath(projectRoot) -> string`

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-ledger. Ledger is sorted, single-entry-per-finding, atomic ...');
{
    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
    const root = createTempRuntimeRoot('disposition-ledger').workspaceRoot;

    assert.deepStrictEqual(led.readLedger(root), { version: led.LEDGER_VERSION, entries: [] },
        'a missing ledger reads as empty, never throws');

    let ledger = { version: led.LEDGER_VERSION, entries: [] };
    ledger = led.upsertEntry(ledger, { findingId: 'R008:task:z', ruleId: 'R008', ruleVersion: 1,
        fingerprint: 'f'.repeat(64), choice: 'accepted-debt', reason: 'r', at: '2026-08-11T00:00:00Z' });
    ledger = led.upsertEntry(ledger, { findingId: 'R005:task:a', ruleId: 'R005', ruleVersion: 1,
        fingerprint: 'a'.repeat(64), choice: 'wont-fix', reason: 'r', at: '2026-08-11T00:00:00Z' });
    led.writeLedger(root, ledger);

    const raw = fs.readFileSync(led.ledgerPath(root), 'utf8');
    assert.ok(raw.endsWith('\n'), 'ledger ends with a newline');
    assert.ok(raw.includes('\n  "version"'), 'ledger uses 2-space indent');
    const onDisk = JSON.parse(raw);
    assert.deepStrictEqual(onDisk.entries.map(e => e.findingId), ['R005:task:a', 'R008:task:z'],
        'entries are sorted by findingId so diffs and merges stay sane');

    let again = led.upsertEntry(led.readLedger(root), { findingId: 'R008:task:z', ruleId: 'R008',
        ruleVersion: 1, fingerprint: 'b'.repeat(64), choice: 'deferred', reason: 'r2',
        until: 'later', at: '2026-08-12T00:00:00Z' });
    assert.strictEqual(again.entries.filter(e => e.findingId === 'R008:task:z').length, 1,
        'set replaces rather than appends — a findingId can never hold two live decisions');
    assert.strictEqual(again.entries.find(e => e.findingId === 'R008:task:z').choice, 'deferred',
        'the replacement wins');

    assert.throws(() => led.readLedger.call(null, (() => {
        fs.writeFileSync(led.ledgerPath(root), '{"version":"wrong","entries":[]}\n');
        return root;
    })()), /evo-disposition-ledger@1/, 'a wrong schema version is rejected, not silently accepted');
    console.log('✅ T-disposition-ledger passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `Cannot find module '…/disposition/ledger'`

- [ ] **Step 3: Write minimal implementation**

Create `templates/cli/disposition/ledger.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 'evo-disposition-ledger@1';
const CHOICES = Object.freeze(new Set(['not-applicable', 'accepted-debt', 'deferred', 'wont-fix']));

function ledgerPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'dispositions.json');
}

function readLedger(projectRoot) {
    const file = ledgerPath(projectRoot);
    if (!fs.existsSync(file)) return { version: LEDGER_VERSION, entries: [] };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`disposition ledger is invalid JSON: ${err && err.message ? err.message : String(err)}`);
    }
    if (!parsed || parsed.version !== LEDGER_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error(`disposition ledger must use ${LEDGER_VERSION} with an entries array`);
    }
    const seen = new Set();
    for (const e of parsed.entries) {
        if (!e || typeof e.findingId !== 'string' || seen.has(e.findingId)
            || !/^[0-9a-f]{64}$/.test(e.fingerprint || '')
            || !CHOICES.has(e.choice)) {
            throw new Error('disposition ledger contains an invalid or duplicate entry');
        }
        seen.add(e.findingId);
    }
    return parsed;
}

function writeLedger(projectRoot, ledger) {
    const file = ledgerPath(projectRoot);
    const entries = [...(ledger.entries || [])]
        .sort((a, b) => String(a.findingId).localeCompare(String(b.findingId)));
    const body = `${JSON.stringify({ version: LEDGER_VERSION, entries }, null, 2)}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
}

function upsertEntry(ledger, entry) {
    const entries = (ledger.entries || []).filter(e => e.findingId !== entry.findingId);
    entries.push(entry);
    return { version: LEDGER_VERSION, entries };
}

module.exports = { LEDGER_VERSION, CHOICES, ledgerPath, readLedger, writeLedger, upsertEntry };
```

Add the gitignore exception immediately after line 16 (`!.evo-lite/memory-engine.json`):

```gitignore
!.evo-lite/dispositions.json
```

Register `'disposition/ledger.js',` in `templates/cli/template-manifest.js`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/disposition/ledger.js .evo-lite/cli/disposition/ledger.js
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
node .evo-lite/cli/test.js governance
git check-ignore -v .evo-lite/dispositions.json || echo "TRACKED (correct)"
```

Expected: PASS, and `git check-ignore` prints `TRACKED (correct)` — a gitignored decision record would defeat the whole layer.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/disposition/ledger.js .evo-lite/cli/disposition/ledger.js \
        templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js \
        .gitignore templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): git-tracked ledger with sorted atomic writes and single entry per finding"
```

---

### Task 3: Resolver — CURRENT / STALE / ORPHANED

**Files:**
- Create: `templates/cli/disposition/resolve.js`
- Create: `.evo-lite/cli/disposition/resolve.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/disposition/resolve.js, templates/cli/template-manifest.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac4, ac8

**Interfaces:**
- Consumes: `computeFingerprint` (Task 1), `readLedger` (Task 2)
- Produces: `effectiveDisposition(finding, ledger) -> entry | null`
- Produces: `annotate(finding, ledger) -> finding` — attaches `.disposition` = `{status:'current'|'stale', …}` or `null`
- Produces: `classifyEntry(entry, emittedIds) -> 'current'|'stale'|'orphaned'`

A finding is `{ id, ruleId, ruleVersion, factInputs }`. The `.disposition` field is written onto a shallow copy; the input is never mutated.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-resolve. CURRENT / STALE / ORPHANED, and tombstones are terminal ...');
{
    const res = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'resolve'));
    const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));

    const finding = { id: 'unknown-status:spec:x', ruleId: 'unknown-status', ruleVersion: 1,
        factInputs: { declaredStatus: 'closed-experimental' } };
    const print = fp.computeFingerprint(finding);
    const entry = { findingId: finding.id, ruleId: 'unknown-status', ruleVersion: 1,
        fingerprint: print, choice: 'not-applicable', reason: 'r', at: '2026-08-11T00:00:00Z' };
    let ledger = led.upsertEntry({ version: led.LEDGER_VERSION, entries: [] }, entry);

    assert.strictEqual(res.effectiveDisposition(finding, ledger).choice, 'not-applicable',
        'matching fingerprint resolves to CURRENT');
    assert.strictEqual(res.annotate(finding, ledger).disposition.status, 'current');

    const moved = { ...finding, factInputs: { declaredStatus: 'done' } };
    assert.strictEqual(res.effectiveDisposition(moved, ledger), null,
        'a changed fact voids the decision');
    assert.strictEqual(res.annotate(moved, ledger).disposition.status, 'stale',
        'stale is annotated, not erased — the reader must see a decision lapsed');

    const bumped = { ...finding, ruleVersion: 2 };
    assert.strictEqual(res.effectiveDisposition(bumped, ledger), null,
        'a ruleVersion bump voids every disposition for that rule');

    // NEGATIVE CONTROL — the regression path. Tombstone, then re-emit an
    // IDENTICAL finding with an IDENTICAL fingerprint.
    let tombstoned = led.upsertEntry(ledger, { ...entry, orphanedAt: '2026-09-01T00:00:00Z',
        orphanedHead: '1f2e3d4' });
    assert.strictEqual(res.effectiveDisposition(finding, tombstoned), null,
        'a tombstoned entry NEVER returns to CURRENT, even on an identical recurrence');
    assert.strictEqual(res.annotate(finding, tombstoned).disposition, null,
        'the recurrence is presented as undispositioned, demanding a fresh decision');

    assert.strictEqual(res.classifyEntry(entry, new Set([finding.id])), 'current');
    assert.strictEqual(res.classifyEntry(entry, new Set()), 'orphaned',
        'absent from the emitted set means orphaned');

    const untouched = { ...finding };
    res.annotate(untouched, ledger);
    assert.ok(!('disposition' in untouched), 'annotate must not mutate its input');
    console.log('✅ T-disposition-resolve passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `Cannot find module '…/disposition/resolve'`

- [ ] **Step 3: Write minimal implementation**

Create `templates/cli/disposition/resolve.js`:

```js
'use strict';

const { computeFingerprint } = require('./fingerprint');

function findEntry(ledger, findingId) {
    return (ledger && ledger.entries || []).find(e => e.findingId === findingId) || null;
}

// The ONE place fingerprint matching happens. Consumers must never reimplement
// this: `if (ledger.has(id)) suppress()` would honour stale and tombstoned
// entries alike, the exact inverse of the intended behaviour.
function effectiveDisposition(finding, ledger) {
    const entry = findEntry(ledger, finding.id);
    if (!entry) return null;
    if (entry.orphanedAt) return null;           // tombstone is terminal
    const current = computeFingerprint({
        ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, factInputs: finding.factInputs,
    });
    return entry.fingerprint === current ? entry : null;
}

function annotate(finding, ledger) {
    const entry = findEntry(ledger, finding.id);
    const live = effectiveDisposition(finding, ledger);
    if (live) {
        return { ...finding, disposition: { status: 'current', choice: live.choice,
            reason: live.reason, until: live.until || null, at: live.at } };
    }
    // A lapsed decision is reported as lapsed, never silently dropped —
    // except a tombstone, which is a closed chapter rather than a live lapse.
    if (entry && !entry.orphanedAt) {
        return { ...finding, disposition: { status: 'stale', choice: entry.choice,
            reason: entry.reason, fingerprint: entry.fingerprint } };
    }
    return { ...finding, disposition: null };
}

function classifyEntry(entry, emittedIds) {
    if (!emittedIds.has(entry.findingId)) return 'orphaned';
    return entry.orphanedAt ? 'orphaned' : 'current';
}

module.exports = { effectiveDisposition, annotate, classifyEntry };
```

Note: `classifyEntry` reports membership only; `annotate` owns the stale/current distinction, because only it has the live `factInputs` needed to recompute a fingerprint.

Register `'disposition/resolve.js',` in `templates/cli/template-manifest.js`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/disposition/resolve.js .evo-lite/cli/disposition/resolve.js
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
node .evo-lite/cli/test.js governance
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/disposition/resolve.js .evo-lite/cli/disposition/resolve.js \
        templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): single resolver with terminal tombstones"
```

---

### Task 4: Spec-portfolio findings gain ids, factInputs and completeness

**Files:**
- Modify: `templates/cli/spec-portfolio.js`
- Modify: `.evo-lite/cli/spec-portfolio.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/spec-portfolio.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac1, ac2

**Interfaces:**
- Produces: each registry entry gains `findings[]`, every element `{ id, ruleId, ruleVersion, factInputs }`
- Produces: `registry.census = { complete, errors }`
- Produces: `SPEC_RULE_VERSIONS` — `{ 'unknown-status': 1, 'zombie-plan': 1, 'size-exceeded': 1, 'aging-no-plan': 1, 'aging-inactive': 1 }`

`warnings[]` (bare strings) is retained unchanged so nothing downstream breaks.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-spec-findings. Spec warnings become identified findings ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const root = createTempRuntimeRoot('disposition-spec-findings').workspaceRoot;
    const w = (file, front) => writeText(path.join(root, 'docs', 'specs', file),
        ['---', ...front, '---', '', '# S', ''].join('\n'));

    w('u.md', ['id: spec:u', 'status: closed-experimental']);
    const big = [1,2,3,4,5,6,7,8,9].map(n => `    { "id": "c${n}" }`).join(',\n');
    w('big.md', ['id: spec:big', 'status: done', 'x: 1']);
    fs.appendFileSync(path.join(root, 'docs', 'specs', 'big.md'),
        ['## Acceptance Criteria', '', '```json', '{', '  "criteria": [', big, '  ]', '}', '```', ''].join('\n'));

    const reg = sp.buildSpecRegistry(root, { write: false });
    const by = Object.fromEntries(reg.specs.map(s => [s.id, s]));

    const uf = by['spec:u'].findings.find(f => f.ruleId === 'unknown-status');
    assert.ok(uf, 'unknown-status is emitted as a finding object');
    assert.strictEqual(uf.id, 'unknown-status:spec:u', 'canonical id shape');
    assert.strictEqual(uf.factInputs.declaredStatus, 'closed-experimental',
        'the fact that made the finding true is declared');
    assert.strictEqual(uf.ruleVersion, 1);

    const dims = by['spec:big'].findings.filter(f => f.ruleId === 'size-exceeded');
    assert.ok(dims.length >= 1, 'size-exceeded is emitted per dimension');
    assert.ok(dims.every(f => /^size-exceeded:spec:big:[a-zA-Z]+$/.test(f.id)),
        'each breached dimension gets its OWN id — one consent must not cover three decisions');
    assert.ok(dims.some(f => f.factInputs.dimension === 'acCount' && f.factInputs.value === 9),
        'the dimension, its value and its threshold are the facts');

    assert.strictEqual(reg.census.complete, true, 'a readable portfolio is a complete census');
    assert.deepStrictEqual(by['spec:u'].warnings.includes('unknown-status'), true,
        'the legacy string warnings are untouched');
    console.log('✅ T-disposition-spec-findings passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `unknown-status is emitted as a finding object` (`findings` is undefined)

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/spec-portfolio.js`, add near `RECOGNIZED_SPEC_STATUSES`:

```js
const SPEC_RULE_VERSIONS = Object.freeze({
    'unknown-status': 1, 'zombie-plan': 1, 'size-exceeded': 1,
    'aging-no-plan': 1, 'aging-inactive': 1,
});

function breachedDimensions(size) {
    return Object.keys(SIZE_THRESHOLDS).filter(k => size[k] > SIZE_THRESHOLDS[k]);
}

// One independently dispositionable fact = one finding id.
function buildSpecFindings(spec, size) {
    const out = [];
    const f = (ruleId, factInputs, instanceKey) => out.push({
        id: `${ruleId}:${spec.id}${instanceKey ? `:${instanceKey}` : ''}`,
        ruleId, ruleVersion: SPEC_RULE_VERSIONS[ruleId], factInputs,
    });
    for (const w of spec.warnings) {
        if (w === 'unknown-status') f(w, { declaredStatus: spec.declaredStatus });
        else if (w === 'zombie-plan') f(w, { notDonePlans: spec.notDonePlans });
        else if (w === 'aging-no-plan' || w === 'aging-inactive') f(w, { lastTouchedAt: spec.lastTouchedAt });
        else if (w === 'size-exceeded') {
            for (const dim of breachedDimensions(size)) {
                f('size-exceeded', { dimension: dim, value: size[dim],
                    threshold: SIZE_THRESHOLDS[dim], state: spec.state }, dim);
            }
        }
    }
    return out;
}
```

Immediately after the `specs.push({…})` call, attach findings and build the census before `return registry`:

```js
for (const s of specs) s.findings = buildSpecFindings(s, s.size);
```

`source` is currently built inline inside the `registry` object literal, so there
is no `source` variable to read. Hoist it first — immediately before the
`const registry = {` line — and have the literal reference it:

```js
const source = {
    directoryReadable: rootsReadable,
    discoveredFileCount,
    parsedSpecCount: specs.length,
    discoveredMarkdownFileCount: discovery.files.length,
    roots: discovery.roots,
    warnings: sourceWarnings,
    portfolioSourceDrift: specs.length === 0 && Array.isArray(ir.specs) && ir.specs.length > 0,
};
```

(Keep the existing expressions verbatim; only their location changes. `source:
source` then replaces the inline literal.)

Then add the census. **The predicate below is the result of reading how the two
roots actually behave — do not simplify it.**

```js
// `sourceWarnings` mixes two very different things:
//   'no usable id: spec:...'  — a design doc under docs/superpowers/specs/.
//                               Expected. There are 9 of them today, and they
//                               will never be specs.
//   'spec parse threw: ...'   — a file that WAS meant to be a spec and blew up.
//                               A spec silently vanished from the census.
// Gating on warnings.length === 0 (or on discoveredMarkdownFileCount) would
// therefore mark this repo permanently incomplete and sync would never
// tombstone anything. Gate on the second kind only.
const parseFailures = sourceWarnings.filter(w => /parse threw/.test(w.reason));

// discoveredFileCount counts every file under the strict root plus every file
// that parsed anywhere, so `=== specs.length` catches both a strict-root parse
// failure and a duplicate id (counted, then dropped).
census: {
    complete: errors.length === 0
        && source.directoryReadable
        && source.discoveredFileCount === source.parsedSpecCount
        && parseFailures.length === 0
        && !source.portfolioSourceDrift,
    errors: [...errors.map(e => e.reason), ...parseFailures.map(w => `${w.path}: ${w.reason}`)],
},
```

Export `SPEC_RULE_VERSIONS`.

Add to the Task 4 test, before the closing brace:

```js
    // The predicate must not be tripped by the design docs that legitimately
    // carry no spec id — otherwise the census is never complete and sync is
    // dead code in this repo.
    const realReg = sp.buildSpecRegistry(process.cwd(), { write: false });
    assert.strictEqual(realReg.census.complete, true,
        'the real repository, with its 9 id-less design docs, is a COMPLETE census');
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js
node .evo-lite/cli/test.js governance
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): identified findings and a conservative census for spec portfolio"
```

---

### Task 5: Planning findings gain ids, factInputs and a census result

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Modify: `templates/cli/planning.js`
- Modify: `.evo-lite/cli/planning.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/planning/gaps.js, templates/cli/planning.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac1, ac2

**Interfaces:**
- Produces: `runPlanningDriftCensus(projectRoot, planIR, options) -> { findings, complete, errors }`
- Produces: `PLANNING_RULE_VERSIONS` — all ten rules at 1
- Produces: `runPlanningDrift(...)` kept as a thin wrapper returning `census.findings`, so existing callers do not break

Six rules change id shape: R003, R004, R006, R009, R010, R013. R005/R008/R011/R012 already conform because their subject id is self-prefixed.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-planning-census. Ten rules, canonical ids, and absence is not silence ...');
{
    const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
    const root = createTempRuntimeRoot('disposition-planning-census').workspaceRoot;

    const degraded = gaps.runPlanningDriftCensus(root, null, {});
    assert.strictEqual(degraded.complete, false,
        'a null plan-ir means we could not look — that is NOT an empty finding set');
    assert.ok(degraded.errors.length > 0, 'the reason is reported, not swallowed');

    const ir = { specs: [], plans: [], tasks: [{ id: 'task:t1', linkedPlan: 'plan:p',
        linkedFiles: [], status: 'implemented' }] };
    const ok = gaps.runPlanningDriftCensus(root, ir, { changedFiles: [] });
    assert.strictEqual(ok.complete, true, 'a real IR yields a complete census');

    const r005 = ok.findings.find(f => f.ruleId === 'R005');
    assert.strictEqual(r005.id, 'R005:task:t1', 'R005 already conforms — id unchanged');
    assert.strictEqual(r005.ruleVersion, 1);

    const r003 = ok.findings.find(f => f.ruleId === 'R003');
    assert.strictEqual(r003.id, 'R003:repo:specs', 'bare R003 is migrated to the canonical shape');
    assert.deepStrictEqual(r003.factInputs, {},
        'R003 has no stable facts — it expires through ORPHANED, never through a fingerprint');

    const r009 = gaps.runPlanningDriftCensus(root, ir, { changedFiles: [] }).findings
        .filter(f => f.ruleId === 'R009');
    assert.ok(r009.every(f => /^R009:ir:(plan|architecture)$/.test(f.id)), 'R009 id shape');
    assert.ok(r009.every(f => !JSON.stringify(f.factInputs).includes('mtime')),
        'mtime must never enter a fingerprint — it does not survive a clone');

    // R013 — the premise is a git comparison, so the DECLARED value is a fact
    // input while the live one is ambient. Moving HEAD alone must not void a
    // disposition, or every commit would void every R013 decision.
    const meta = { headSha: 'a'.repeat(40), ahead: 1, behind: 0 };
    const gitA = { headSha: 'b'.repeat(40), ahead: 3, behind: 0, hasUpstream: true,
        isAncestorOfHead: () => false };
    const gitB = { ...gitA, headSha: 'c'.repeat(40) };
    const head = (g) => gaps.runPlanningDriftCensus(root, ir, { metaState: meta, gitState: g })
        .findings.find(f => f.id === 'R013:context:head');
    assert.ok(head(gitA), 'R013:context:head uses the canonical id');
    assert.deepStrictEqual(head(gitA).factInputs, { declaredHeadSha: meta.headSha });
    assert.deepStrictEqual(head(gitA).factInputs, head(gitB).factInputs,
        'live HEAD moving alone must NOT change the R013 fingerprint');

    // R006 — occurrence identity, not content. Without a commit there is no
    // stable occurrence, so the finding must refuse to be dispositioned.
    const wt = gaps.runPlanningDriftCensus(root, ir, { changedFiles: ['src/x.js'] })
        .findings.find(f => f.ruleId === 'R006');
    assert.strictEqual(wt.dispositionable, false,
        'a working-tree R006 has no stable occurrence and must be non-dispositionable');
    console.log('✅ T-disposition-planning-census passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `gaps.runPlanningDriftCensus is not a function`

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/planning/gaps.js` add:

```js
const PLANNING_RULE_VERSIONS = Object.freeze({
    R003: 1, R004: 1, R005: 1, R006: 1, R008: 1,
    R009: 1, R010: 1, R011: 1, R012: 1, R013: 1,
});

// Mechanical id migrations — only for rules whose new id is derivable from the
// old one. R006 and R010 are NOT here: their ids depend on facts that exist
// inside the check function and cannot be recovered from a display string.
// R005/R008/R011/R012 need no entry — their subject id is already self-prefixed.
const ID_MIGRATIONS = {
    R003: () => 'R003:repo:specs',
    R004: () => 'R004:repo:plans',
    R009: f => `R009:ir:${f.id.slice('R009:'.length)}`,
    R013: f => `R013:context:${f.id.slice('R013:'.length)}`,
};

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

// The statuses of every task belonging to the plans linked to a spec. Sorted by
// the fingerprint layer (taskStatuses is in SET_KEYS), so order is irrelevant.
function planTaskStatuses(planIR, plans) {
    const ids = new Set(plans.map(p => p.id));
    return (planIR.tasks || []).filter(t => ids.has(t.linkedPlan)).map(t => `${t.id}=${t.status}`);
}
```

Add `const crypto = require('crypto');` to the top of `gaps.js` if absent.

**R010 must build its own id and facts from the raw item**, inside `checkR010`,
where `item` is still the full backlog text:

```js
// The bracketed label is the item's identity. The old id used the first 40
// characters of prose, which fractures on any rewording and silently orphans
// the decision for what is the same item. The digest covers the FULL
// normalized text, never the truncated display message.
const normalizedItemText = String(item).replace(/\s+/g, ' ').trim();
const labelMatch = /^\s*\[([^\]]+)\]/.exec(normalizedItemText);
const backlogKey = labelMatch ? labelMatch[1] : sha256(normalizedItemText).slice(0, 16);
return {
    id: `R010:backlog:${backlogKey}`, rule: 'R010', scope: 'planning', level: 'info',
    type: 'untracked-backlog',
    message: `Backlog item not in Planning IR: "${normalizedItemText.slice(0, 80)}"`,
    evidence: ['.evo-lite/active_context.md'],
    suggestedAction: 'Add a task to docs/plans/ that covers this backlog item',
    factInputs: { itemTextDigest: sha256(normalizedItemText) },
};
```

Each `checkRxxx` gains a `factInputs` property on the objects it pushes:

```js
// R005 / R003 / R004 / R009 — the premise is "this absence exists". No stable
// facts, and mtime is banned because it does not survive a clone. They expire
// via ORPHANED + tombstone, which is exactly the behaviour we want.
factInputs: {},

// R006 — occurrence identity, not file bytes. See spec §2.
factInputs: { path: f, status: changeStatus, occurrence: occurrenceId },

// R008
factInputs: { taskStatus: t.status, archiveHits: t.archiveHits || 0 },

// R010
factInputs: { itemTextDigest: sha256(normalizedItemText) },

// R011
factInputs: { specStatus: spec.status, taskStatuses: planTaskStatuses(planIR, plans) },

// R012
factInputs: { planStatus: plan.status, doneCount: done, totalCount: total },

// R013:context:head
factInputs: { declaredHeadSha: meta.headSha },
// R013:context:sync
factInputs: { declaredAhead: meta.ahead, declaredBehind: meta.behind },
```

Then replace the exported driver:

```js
function runPlanningDriftCensus(projectRoot, planIR, options = {}) {
    const errors = [];
    if (!planIR) errors.push('plan-ir.json is missing or unreadable — run `mem plan scan`');

    const findings = [
        ...checkR003(projectRoot), ...checkR004(projectRoot), ...checkR005(planIR),
        ...checkR006(projectRoot, planIR, options), ...checkR008(planIR),
        ...checkR009(projectRoot), ...checkR010(projectRoot, planIR),
        ...checkR011(planIR), ...checkR012(projectRoot, planIR, options),
        ...checkR013(projectRoot, options),
    ].map(f => ({
        ...f,
        id: (ID_MIGRATIONS[f.rule] || (() => f.id))(f),
        ruleId: f.rule,
        ruleVersion: PLANNING_RULE_VERSIONS[f.rule],
        factInputs: f.factInputs || {},
    }));

    return { findings, complete: errors.length === 0, errors };
}

function runPlanningDrift(projectRoot, planIR, options = {}) {
    return runPlanningDriftCensus(projectRoot, planIR, options).findings;
}
```

Export `runPlanningDriftCensus` and `PLANNING_RULE_VERSIONS` alongside the existing exports.

R006 needs its occurrence identity resolved explicitly. Add above `checkR006`:

```js
// An occurrence identity, NOT the file's bytes. Hashing content — or even the
// (oldBlob,newBlob) pair — lets a lapsed disposition revive by rollback:
//   C1 A->B (dispositioned) / C2 B->A (stale) / C3 A->B  <- identical to C1.
// A working-tree diff has no such identity, so those findings are marked
// non-dispositionable rather than given a fingerprint that collides.
function changeOccurrence(projectRoot, options) {
    if (!options.lastCommit) return null;
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        }).trim();
    } catch (_) { return null; }
}

function changeStatusOf(projectRoot, file, options) {
    if (!options.lastCommit) return 'worktree';
    try {
        const out = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-status',
            '-r', '--root', 'HEAD', '--', file], { cwd: projectRoot, encoding: 'utf8', timeout: 5000 }).trim();
        return out ? out.split(/\s+/)[0] : 'M';
    } catch (_) { return 'M'; }
}
```

and inside `checkR006`'s `.map(f => ({…}))`, replace the pushed object with:

```js
const occurrence = changeOccurrence(projectRoot, options);
return changedFiles.filter(f => !linkedFiles.has(f)).map((f) => ({
    id: `R006:${f}`, rule: 'R006', scope: 'planning', level: 'warning',
    type: 'unlinked-file',
    message: `Changed file not linked to any task: ${f}`,
    evidence: [f],
    suggestedAction: `Link ${f} to a task in docs/plans/ or create a new task`,
    factInputs: { path: f, status: changeStatusOf(projectRoot, f, options), occurrence },
    dispositionable: occurrence != null,
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
cp templates/cli/planning.js .evo-lite/cli/planning.js
node .evo-lite/cli/test.js governance
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
        templates/cli/planning.js .evo-lite/cli/planning.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): canonical ids, declared facts and a census result for all ten planning rules"
```

---

### Task 6: Annotate, never filter

**Files:**
- Modify: `templates/cli/spec-portfolio.js`
- Modify: `templates/cli/planning.js`
- Modify: `templates/cli/memory.service.js:3112-3113`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/spec-portfolio.js, templates/cli/planning.js, templates/cli/memory.service.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac7, ac8

**Interfaces:**
- Consumes: `annotate` (Task 3), `readLedger` (Task 2), findings (Tasks 4-5)
- Produces: every emitted finding carries `.disposition` of `current` / `stale` / `null` in JSON output

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-annotation. Dispositioned findings stay in the collection ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
    const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
    const root = createTempRuntimeRoot('disposition-annotation').workspaceRoot;
    writeText(path.join(root, 'docs', 'specs', 'u.md'),
        ['---', 'id: spec:u', 'status: closed-experimental', '---', '', '# S', ''].join('\n'));

    const first = sp.buildSpecRegistry(root, { write: false });
    const target = first.specs[0].findings.find(f => f.ruleId === 'unknown-status');
    assert.strictEqual(target.disposition, null, 'undispositioned findings annotate as null');

    led.writeLedger(root, led.upsertEntry({ version: led.LEDGER_VERSION, entries: [] }, {
        findingId: target.id, ruleId: target.ruleId, ruleVersion: target.ruleVersion,
        fingerprint: fp.computeFingerprint(target), choice: 'not-applicable',
        reason: 'child convention', at: '2026-08-11T00:00:00Z',
    }));

    const second = sp.buildSpecRegistry(root, { write: false });
    const after = second.specs[0].findings.find(f => f.ruleId === 'unknown-status');

    // THE core invariant. If this ever fails, a downstream reader can conclude
    // a problem does not exist because somebody dispositioned it.
    assert.ok(after, 'a dispositioned finding MUST remain in the collection');
    assert.strictEqual(after.disposition.status, 'current');
    assert.strictEqual(after.disposition.choice, 'not-applicable');
    assert.strictEqual(second.specs[0].warnings.includes('unknown-status'), true,
        'the legacy warnings array is likewise not filtered');
    console.log('✅ T-disposition-annotation passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `after.disposition.status` is undefined (`disposition` still `null`)

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/spec-portfolio.js`, after findings are attached:

```js
const { readLedger } = require('./disposition/ledger');
const { annotate } = require('./disposition/resolve');

let ledger = { version: 'evo-disposition-ledger@1', entries: [] };
try { ledger = readLedger(projectRoot); } catch (_) { /* invalid ledger must not break reporting */ }
for (const s of specs) s.findings = s.findings.map(f => annotate(f, ledger));
```

In `templates/cli/planning.js`, apply the same mapping to `census.findings` before writing `drift-report.json`.

In `templates/cli/memory.service.js:3112-3113`, leave `buildSpecRegistry` as-is — the annotation now travels with the registry.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js
cp templates/cli/planning.js .evo-lite/cli/planning.js
node .evo-lite/cli/test.js governance
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js \
        templates/cli/planning.js .evo-lite/cli/planning.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): annotate findings without ever removing them"
```

---

### Task 7: CLI — list, set, revoke

**Files:**
- Create: `templates/cli/disposition/commands.js`
- Create: `.evo-lite/cli/disposition/commands.js`
- Modify: `templates/cli/memory.js:841-854`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test/integration.js`

- files: templates/cli/disposition/commands.js, templates/cli/memory.js, templates/cli/template-manifest.js, templates/cli/test/integration.js
- verify: node .evo-lite/cli/test.js integration
- acceptance: ac5

**Interfaces:**
- Consumes: ledger (Task 2), resolver (Task 3), both censuses (Tasks 4-5)
- Produces: `registerDispositionCommands(program) -> void`
- Produces: `collectAllFindings(projectRoot) -> { findings, complete, errors }` — the merged census used by both `set` and `sync`

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-cli. set validates its inputs and never trusts the caller ...');
{
    const root = createTempRuntimeRoot('disposition-cli').workspaceRoot;
    writeText(path.join(root, 'docs', 'specs', 'u.md'),
        ['---', 'id: spec:u', 'status: closed-experimental', '---', '', '# S', ''].join('\n'));
    const run = (args) => runCli(root, ['disposition', ...args]);

    let r = run(['set', 'unknown-status:spec:does-not-exist', '--choice', 'wont-fix', '--reason', 'x']);
    assert.notStrictEqual(r.status, 0, 'refuses to disposition a finding that is not emitted');

    r = run(['set', 'unknown-status:spec:u', '--choice', 'invented', '--reason', 'x']);
    assert.notStrictEqual(r.status, 0, 'choice is a closed vocabulary');

    r = run(['set', 'unknown-status:spec:u', '--choice', 'accepted-debt', '--reason', '']);
    assert.notStrictEqual(r.status, 0, 'reason is mandatory');

    r = run(['set', 'unknown-status:spec:u', '--choice', 'deferred', '--reason', 'later']);
    assert.notStrictEqual(r.status, 0, 'deferred without until is rejected — no bare deferral');

    r = run(['set', 'unknown-status:spec:u', '--choice', 'deferred', '--reason', 'later',
             '--until', '2026-09-01']);
    assert.strictEqual(r.status, 0, 'deferred with until is accepted');

    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
    const entry = led.readLedger(root).entries[0];
    assert.match(entry.fingerprint, /^[0-9a-f]{64}$/, 'the system derived the fingerprint');
    assert.strictEqual(entry.until, '2026-09-01');
    assert.ok('head' in entry, 'provenance head is recorded (never part of the fingerprint)');

    // A working-tree R006 has no stable occurrence identity. The committed
    // observation is the only id space disposition works in, so `set` must
    // refuse rather than silently store another event's fingerprint.
    fs.writeFileSync(path.join(root, 'src-unlinked.js'), 'x');
    const wtR006 = run(['set', 'R006:file:src-unlinked.js',
        '--choice', 'accepted-debt', '--reason', 'x']);
    assert.notStrictEqual(wtR006.status, 0,
        'an uncommitted R006 is not dispositionable and set must reject it');

    const listed = run(['list', '--json']);
    assert.ok(listed.stdout.includes('2026-09-01'),
        'until is shown by default so a lapsed deferral cannot sit unseen');

    assert.strictEqual(run(['revoke', 'unknown-status:spec:u']).status, 0);
    assert.strictEqual(led.readLedger(root).entries.length, 0, 'revoke removes the entry');
    console.log('✅ T-disposition-cli passed');
}
```

`runCli` is the existing integration helper that spawns `memory.js` with a project root.

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/integration.js .evo-lite/cli/test/integration.js
node .evo-lite/cli/test.js integration
```

Expected: FAIL — `unknown command 'disposition'`

- [ ] **Step 3: Write minimal implementation**

Create `templates/cli/disposition/commands.js`:

```js
'use strict';

const { readLedger, writeLedger, upsertEntry, CHOICES } = require('./ledger');
const { computeFingerprint } = require('./fingerprint');

// FROZEN OBSERVATION MODE: every disposition command reads the COMMITTED
// observation (`lastCommit: true`). set, sync and list must share one id space
// — otherwise a user dispositions the `R006:file:x` they can see in the working
// tree while the CLI resolves and stores the fingerprint of HEAD's occurrence,
// i.e. a decision about a different event. Working-tree findings stay visible
// in ordinary `plan gaps` output; they simply never enter governance decisions.
const OBSERVATION = Object.freeze({ lastCommit: true });

function safeLoadPlanIR(projectRoot) {
    const fs = require('fs'); const path = require('path');
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(irPath)) return { planIR: null, error: 'plan-ir.json is missing — run `mem plan scan`' };
    try {
        return { planIR: JSON.parse(fs.readFileSync(irPath, 'utf8')), error: null };
    } catch (err) {
        // A corrupt IR must degrade the census, never escape as an exception —
        // an unhandled throw here would skip the fail-closed guard entirely.
        return { planIR: null, error: `plan-ir.json is unreadable: ${err && err.message ? err.message : String(err)}` };
    }
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
            if (!CHOICES.has(opts.choice)) {
                throw new Error(`--choice must be one of: ${[...CHOICES].join(', ')}`);
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
        writeLedger(projectRoot, {
            version: ledger.version,
            entries: ledger.entries.filter(e => e.findingId !== findingId),
        });
        console.log(`✅ revoked ${findingId}`);
    });

    cmd.command('list').option('--stale').option('--json').action((opts) => {
        const projectRoot = root();
        // findings are already annotated by collectAllFindings — status is READ
        // from the shared resolver's verdict, never inferred here.
        const { findings } = collectAllFindings(projectRoot);
        const byId = new Map(findings.map(f => [f.id, f]));
        let rows = readLedger(projectRoot).entries.map((e) => {
            if (e.orphanedAt) return { ...e, status: 'orphaned' };
            const f = byId.get(e.findingId);
            if (!f) return { ...e, status: 'orphaned' };
            return { ...e, status: f.disposition ? f.disposition.status : 'stale' };
        });
        if (opts.stale) rows = rows.filter(r => r.status === 'stale');
        if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return; }
        for (const r of rows) {
            console.log(`${r.status.padEnd(8)} ${r.choice.padEnd(15)} ${r.findingId}`
                + (r.until ? `  — until ${r.until}` : ''));
        }
    });
}

module.exports = { registerDispositionCommands, collectAllFindings };
```

In `templates/cli/memory.js`, next to line 842:

```js
safeRegister('disposition', () => require('./disposition/commands').registerDispositionCommands(program));
```

Register `'disposition/commands.js',` in the manifest.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/disposition/commands.js .evo-lite/cli/disposition/commands.js
cp templates/cli/memory.js .evo-lite/cli/memory.js
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
node .evo-lite/cli/test.js integration
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/disposition/commands.js .evo-lite/cli/disposition/commands.js \
        templates/cli/memory.js .evo-lite/cli/memory.js \
        templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js \
        templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(disposition): set/list/revoke with closed vocabulary and no caller-supplied fingerprints"
```

---

### Task 8: Sync — tombstone only from a complete census

**Files:**
- Modify: `templates/cli/disposition/commands.js`
- Modify: `templates/cli/hooks.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/disposition/commands.js, templates/cli/hooks.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac9

**Interfaces:**
- Consumes: `collectAllFindings` (Task 7)
- Produces: `mem disposition sync` — tombstones absent entries, writes nothing when any producer is incomplete, never stages or commits

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-sync. A degraded census must never manufacture an ORPHANED ...');
{
    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
    const root = createTempRuntimeRoot('disposition-sync').workspaceRoot;
    writeText(path.join(root, 'docs', 'specs', 'u.md'),
        ['---', 'id: spec:u', 'status: closed-experimental', '---', '', '# S', ''].join('\n'));

    // A live disposition on a finding that exists right now.
    runCli(root, ['disposition', 'set', 'unknown-status:spec:u',
        '--choice', 'accepted-debt', '--reason', 'child convention']);
    const before = fs.readFileSync(led.ledgerPath(root), 'utf8');

    // Break the planning producer. The spec finding is still emitted, but the
    // ROUND is degraded — and v1 is fail-closed whole-round.
    const irPath = path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    fs.mkdirSync(path.dirname(irPath), { recursive: true });
    fs.writeFileSync(irPath, 'not json at all');

    const degraded = runCli(root, ['disposition', 'sync']);
    assert.strictEqual(fs.readFileSync(led.ledgerPath(root), 'utf8'), before,
        'a degraded round leaves the ledger BYTE-IDENTICAL — observation failure is not fact change');
    assert.ok(/degrad/i.test(degraded.stdout + degraded.stderr),
        'the degradation is reported, never silent');

    // Repair the producer AND genuinely resolve the finding.
    fs.rmSync(irPath, { force: true });
    fs.writeFileSync(path.join(root, 'docs', 'specs', 'u.md'),
        ['---', 'id: spec:u', 'status: done', '---', '', '# S', ''].join('\n'));
    runCli(root, ['plan', 'scan']);
    runCli(root, ['disposition', 'sync']);
    const entry = led.readLedger(root).entries.find(e => e.findingId === 'unknown-status:spec:u');
    assert.ok(entry.orphanedAt, 'only a complete census may tombstone');
    console.log('✅ T-disposition-sync passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `unknown command 'sync'`

- [ ] **Step 3: Write minimal implementation**

Add to `registerDispositionCommands` in `templates/cli/disposition/commands.js`:

```js
cmd.command('sync')
    .description('Tombstone entries proven absent from a complete census.')
    .action(() => {
        const projectRoot = root();
        const { findings, complete, errors } = collectAllFindings(projectRoot);

        // Fail-closed, WHOLE ROUND. Partial credit is indistinguishable from
        // partial evidence, and tombstoning is terminal: a wrong one destroys
        // a governance decision permanently.
        if (!complete) {
            console.log('⚠️ disposition sync degraded — no tombstone written this round');
            for (const e of errors) console.log(`   ${e}`);
            return;
        }

        const { classifyEntry } = require('./resolve');
        const emitted = new Set(findings.map(f => f.id));
        const ledger = readLedger(projectRoot);
        let head = null;
        try {
            head = require('child_process')
                .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
        } catch (_) { /* not a git repo — tombstone without a head reference */ }

        let n = 0;
        const entries = ledger.entries.map((e) => {
            // Membership is decided by the shared resolver, never re-derived here.
            if (e.orphanedAt || classifyEntry(e, emitted) !== 'orphaned') return e;
            n += 1;
            return { ...e, orphanedAt: new Date().toISOString(), orphanedHead: head };
        });
        if (n > 0) writeLedger(projectRoot, { version: ledger.version, entries });
        console.log(`✅ disposition sync: ${n} tombstoned`);
        // Deliberately no `git add` / `git commit`: implicit git mutation from a
        // hook is a worse defect than the window it would close.
    });
```

In `templates/cli/hooks.js`, add `mem disposition sync` to the post-commit governance command list next to `plan gaps`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/disposition/commands.js .evo-lite/cli/disposition/commands.js
cp templates/cli/hooks.js .evo-lite/cli/hooks.js
node .evo-lite/cli/test.js governance
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/cli/disposition/commands.js .evo-lite/cli/disposition/commands.js \
        templates/cli/hooks.js .evo-lite/cli/hooks.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): fail-closed sync that tombstones only from a complete census"
```

---

### Task 9: Presentation and durability visibility

**Files:**
- Modify: `templates/cli/spec-portfolio.js`
- Modify: `templates/cli/memory.service.js:3112-3113`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/spec-portfolio.js, templates/cli/memory.service.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js governance
- acceptance: ac7, ac9

**Interfaces:**
- Consumes: annotated findings (Task 6), ledger (Task 2)
- Produces: `formatPortfolioReport` emits the three-line projection
- Produces: `verify` reports uncommitted tombstones as pending

- [ ] **Step 1: Write the failing test**

```js
console.log('T-disposition-presentation. Actionable count leads; debt stays visible ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
    const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
    const root = createTempRuntimeRoot('disposition-presentation').workspaceRoot;
    for (const n of ['a', 'b']) {
        writeText(path.join(root, 'docs', 'specs', `${n}.md`),
            ['---', `id: spec:${n}`, 'status: closed-experimental', '---', '', '# S', ''].join('\n'));
    }
    const reg0 = sp.buildSpecRegistry(root, { write: false });
    const f0 = reg0.specs[0].findings[0];
    led.writeLedger(root, led.upsertEntry({ version: led.LEDGER_VERSION, entries: [] }, {
        findingId: f0.id, ruleId: f0.ruleId, ruleVersion: f0.ruleVersion,
        fingerprint: fp.computeFingerprint(f0), choice: 'not-applicable',
        reason: 'r', at: '2026-08-11T00:00:00Z',
    }));

    const lines = sp.formatPortfolioReport(sp.buildSpecRegistry(root, { write: false }));
    const text = lines.join('\n');
    assert.ok(/1 条待处理 finding/.test(text), 'the actionable count leads — that is the number a reader needs');
    assert.ok(/1 条 finding 已处置/.test(text), 'dispositioned debt stays permanently visible');
    assert.ok(/not-applicable 1/.test(text), 'the breakdown by choice is shown');
    assert.ok(!/spec:a .*unknown-status/.test(text) || /已处置/.test(text),
        'a dispositioned finding is collapsed out of the actionable list, not deleted from data');
    console.log('✅ T-disposition-presentation passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — `the actionable count leads`

- [ ] **Step 3: Write minimal implementation**

First add `formatFindingLine` next to `formatWarningLine`. It is needed because
`size-exceeded` is now one finding per breached dimension: calling the old
`formatWarningLine(spec, 'size-exceeded')` three times would print three
identical lines that name no dimension at all.

```js
// Per-finding line. Falls back to the legacy per-warning text for every rule
// whose finding maps 1:1 onto a warning; only size-exceeded needs the
// dimension, because it is the one rule that splits per instance.
function formatFindingLine(spec, finding) {
    if (finding.ruleId === 'size-exceeded') {
        const { dimension, value, threshold } = finding.factInputs;
        return `⚠️ ${spec.id} 体量超标 ${dimension}=${value} > ${threshold} (${spec.state}) — 建议拆分或声明 sizeWaiver`;
    }
    return formatWarningLine(spec, finding.ruleId);
}
```

Then in `formatPortfolioReport`, replace the per-warning emission with a projection over annotated findings:

```js
const all = specs.flatMap(s => (s.findings || []).map(f => ({ f, spec: s })));
const actionable = all.filter(x => !x.f.disposition || x.f.disposition.status === 'stale');
const handled = all.filter(x => x.f.disposition && x.f.disposition.status === 'current');
const reactivated = all.filter(x => x.f.disposition && x.f.disposition.status === 'stale');

lines.push(`⚠️ ${actionable.length} 条待处理 finding`);
for (const { f, spec } of actionable) lines.push(`   ${formatFindingLine(spec, f)}`);

if (handled.length) {
    const by = {};
    for (const { f } of handled) by[f.disposition.choice] = (by[f.disposition.choice] || 0) + 1;
    lines.push('');
    lines.push(`📋 ${handled.length} 条 finding 已处置`);
    lines.push(`   ${['not-applicable', 'accepted-debt', 'deferred', 'wont-fix']
        .map(c => `${c} ${by[c] || 0}`).join(' · ')}`);
    lines.push('   使用 mem disposition list 查看');
}
if (reactivated.length) {
    lines.push('');
    lines.push(`♻️ ${reactivated.length} 条 disposition 已失效，finding 已重新激活`);
    lines.push('   使用 mem disposition list --stale 查看');
}
```

In `templates/cli/memory.service.js` after line 3113, add the pending-tombstone check:

```js
const { execFileSync } = require('child_process');
function dispositionsDirty(root) {
    try {
        return execFileSync('git', ['status', '--porcelain', '--', '.evo-lite/dispositions.json'],
            { cwd: root, encoding: 'utf8' }).trim().length > 0;
    } catch (_) { return false; }   // not a git repo
}
// A tombstone written by post-commit is NOT in that commit. Until a later
// commit carries it, another machine will not see it — so say so.
if (dispositionsDirty(getWorkspaceRoot())) {
    lines.push('⚠️ dispositions.json 有未提交改动 — tombstone 尚未持久化，其他机器看不到');
}
```

**Reporting alone does not satisfy AC9 — the closure must actually close.**
`commitWithContext` currently stages exactly two files:

```js
result.runtime.files = [
    toWorkspaceGitPath(ACTIVE_CONTEXT_PATH),
    toWorkspaceGitPath(trackResult.archivePath),
];
```

so a tombstone stays dirty across any number of `mem commit` runs while the
command reports runtime state as written. Extend it at `memory.service.js:1981`:

```js
result.runtime.files = [
    toWorkspaceGitPath(ACTIVE_CONTEXT_PATH),
    toWorkspaceGitPath(trackResult.archivePath),
];
// A pending tombstone is part of the runtime state this commit closes.
// Excluding it lets `mem commit` claim durability while a decision that
// another machine cannot see is still sitting unstaged.
if (dispositionsDirty(getWorkspaceRoot())) {
    result.runtime.files.push(toWorkspaceGitPath(DISPOSITIONS_PATH));
}
```

with `const DISPOSITIONS_PATH = '.evo-lite/dispositions.json';` beside the
existing `ACTIVE_CONTEXT_PATH` constant. `context track` does not commit, so it
keeps reporting only — but the pending line above must appear in its output too,
so a partial closure is never mistaken for a complete one.

Add to the Task 9 test:

```js
    // AC9 durability closure — reporting is not closing.
    const svc = require(path.join(TEMPLATE_CLI_DIR, 'memory.service.js'));
    assert.ok(typeof svc.commitWithContext === 'function');
    const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'memory.service.js'), 'utf8');
    assert.ok(/runtime\.files\.push\([^)]*DISPOSITIONS_PATH/.test(src),
        'a dirty dispositions.json must join the runtime commit file set, not merely be warned about');
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js
cp templates/cli/memory.service.js .evo-lite/cli/memory.service.js
node .evo-lite/cli/test.js governance
node .evo-lite/cli/test.js integration
```

Expected: PASS on both scopes.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js \
        templates/cli/memory.service.js .evo-lite/cli/memory.service.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(disposition): three-line projection and pending-tombstone visibility"
```

---

### Task 10: Mutation controls

**Files:**
- Test: `templates/cli/test/governance.js`
- Create: `docs/validation/disposition-ledger-mutation-matrix.md`

- files: templates/cli/test/governance.js, docs/validation/disposition-ledger-mutation-matrix.md
- verify: node .evo-lite/cli/test.js
- acceptance: ac4, ac7, ac9

**Interfaces:**
- Consumes: everything above

Each mutation must produce a red **on the assertion that guards it**, on a green baseline. A red landing anywhere else means the guard is not actually load-bearing.

- [ ] **Step 1: Establish the green baseline**

```bash
npm test
```

Expected: all scopes green. A mutation control on a red baseline proves nothing.

- [ ] **Step 2: Run each mutation, record where the red lands**

For each row: apply the mutation to BOTH mirrors, run the scope, record the failing assertion, then restore and re-verify byte-identical via sha256.

| # | mutation | must turn red on |
|---|---|---|
| M1 | in `resolve.js`, delete `if (entry.orphanedAt) return null;` | `a tombstoned entry NEVER returns to CURRENT` |
| M2 | in `sync`, delete `if (!complete) { … return; }` | `a degraded round leaves the ledger BYTE-IDENTICAL` |
| M3 | in `annotate`, return `null` instead of the finding when a disposition is current | `a dispositioned finding MUST remain in the collection` |
| M4 | in `fingerprint.js`, stop sorting `SET_KEYS` arrays | `key order and set-array order must not change the fingerprint` |
| M5 | in `fingerprint.js`, drop `ruleVersion` from the payload | `ruleVersion participates in the fingerprint` |
| M6 | in `commands.js`, accept `deferred` without `--until` | `deferred without until is rejected` |
| M7 | in `ledger.js`, make `upsertEntry` push without filtering | `set replaces rather than appends` |
| M8 | in `sync`, add `git add` after `writeLedger` | index must stay clean — add an assertion if none catches it |
| M9 | in `gaps.js`, add the live `git.headSha` to R013's `factInputs` | `live HEAD moving alone must NOT change the R013 fingerprint` |
| M10 | in `gaps.js`, drop `occurrence` from R006's `factInputs` | `C3 fingerprint != C1` — apply `A→B`, `B→A`, `A→B` and compare the first and third |
| M11 | in `commands.js`, delete the `dispositionable === false` guard in `set` | `an uncommitted R006 is not dispositionable and set must reject it` |
| M12 | in `spec-portfolio.js`, relax `census.complete` to `errors.length === 0` | a `spec parse threw` warning must still block the round — add a fixture whose spec body throws |

- [ ] **Step 3: Record the matrix**

Write `docs/validation/disposition-ledger-mutation-matrix.md` with one row per mutation: mutation applied, scope run, exact failing assertion text, restored sha256, and whether the red landed on the guard (`effective`) or elsewhere (`INEFFECTIVE — guard is decorative`).

- [ ] **Step 4: Verify the tree is clean**

```bash
git status --porcelain
node .evo-lite/cli/test.js
```

Expected: no modifications outside the new doc, all tests green.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js \
        docs/validation/disposition-ledger-mutation-matrix.md
git commit -m "test(disposition): mutation matrix proving each invariant guard is load-bearing"
```

---

## Out of scope

- Repairing `size-gate-state-blindness`, `zombie-plan-parked-deadlock`, `progress-empty-evidence-vacuous-pass`
- Machine evaluation of `until`
- Per-rule census coverage (v1 is whole-round fail-closed)
- Nurturing to child hives
- Layer 3 deletion
