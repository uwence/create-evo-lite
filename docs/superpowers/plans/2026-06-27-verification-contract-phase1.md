---
id: plan:verification-contract-phase1
linkedSpec: spec:verification-contract-phase1
---

# Verification Contract Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 0 contract live — run machine verifiers, write
commit-bound evidence records, and surface live four-state verdicts via
`mem verify-contract run|status|attest`.

**Architecture:** Five focused modules under `templates/cli/verification/`:
`run-verifiers.js` (execute one verifier), `evidence-store.js` (latest-per-criterion
git-tracked JSON), `compute-status.js` (per-criterion changedFiles → pure
`deriveVerdicts`), `engine.js` (runSpec/statusSpec/attestSpec orchestration with
injectable deps), and `commands.js` (Commander wiring). All reuse Phase 0's
validators/derivation unchanged; the only impurities (execSync, git) live behind
injectable `exec`/`gitDiff` seams so the logic is unit-testable.

**Tech Stack:** Node.js (CommonJS), `child_process.execSync`, the home-grown
`node ./.evo-lite/cli/test.js governance` runner, the `templates/cli → .evo-lite/cli`
mirror flow.

## Global Constraints

- No new npm dependencies (RUNTIME_DEPENDENCIES unchanged: `{ better-sqlite3, tar, commander, @modelcontextprotocol/sdk }`).
- Reuse Phase 0 modules unchanged: `validate-contract.js` (`parseSpecCriteria`, `validateEvidenceRecord`), `derive-verdicts.js` (`deriveVerdicts`), `contract-schema.json`. Do NOT modify them.
- **Dirty-tree fail-closed:** `runSpec` MUST refuse to write evidence when `git status --porcelain` is non-empty.
- **Raw verdict ∈ {PASS, FAIL} only** — `STALE`/`UNVERIFIED` are derived-only and never stored. Every written record MUST pass `validateEvidenceRecord`.
- **`json-path-equals` `path` is an array of keys** (e.g. `["packages", "", "version"]`), supporting empty-string keys.
- New `templates/cli/**` files MUST be registered in `template-manifest.js` to ship + mirror.
- **sync-runtime quirk:** after registering new files, run `node ./.evo-lite/cli/memory.js sync-runtime` 2–3× (it copies a subset per pass); if a CLI call dies with `Cannot find module`, hand-copy the missing file: `cp templates/cli/verification/<f> .evo-lite/cli/verification/<f>`. Governance tests run via `node ./.evo-lite/cli/test.js governance`.
- Tests use **fixture specs with cheap commands** (`node -e "process.exit(0)"`), never the self-referential dogfood spec, and inject `exec`/`gitDiff` rather than touching a real repo.

---

### Task 1: run-verifiers.js — execute the four machine verifier types

**Files:**
- Create: `templates/cli/verification/run-verifiers.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: nothing (pure; `exec`/`fs` via opts/defaults).
- Produces: `runVerifier(criterion, opts) -> { verdict: 'PASS'|'FAIL', detail: string }`. `opts`: `{ repoRoot?, exec? }`. `exec(cmd, options)` returns stdout (throws with `.status`/`.stdout` on non-zero, like `execSync`).

- [x] **Step 1: Write the failing test (T33)**

Add after the T32 block in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T33. Testing runVerifier for the four machine verifier types ...');
{
    const { runVerifier } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'run-verifiers'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-verify-'));
    try {
        // command PASS / FAIL via injected exec.
        const passCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
            { repoRoot: tmp, exec: () => 'ok' });
        assert.strictEqual(passCmd.verdict, 'PASS', 'command exit 0 → PASS');
        const failCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
            { repoRoot: tmp, exec: () => { const e = new Error('boom'); e.status = 2; throw e; } });
        assert.strictEqual(failCmd.verdict, 'FAIL', 'command non-zero → FAIL');
        // file-exists / file-absent.
        fs.writeFileSync(path.join(tmp, 'here.txt'), 'x');
        assert.strictEqual(runVerifier({ verifier: { type: 'file-exists', params: { path: 'here.txt' } } }, { repoRoot: tmp }).verdict, 'PASS');
        assert.strictEqual(runVerifier({ verifier: { type: 'file-exists', params: { path: 'nope.txt' } } }, { repoRoot: tmp }).verdict, 'FAIL');
        assert.strictEqual(runVerifier({ verifier: { type: 'file-absent', params: { path: 'nope.txt' } } }, { repoRoot: tmp }).verdict, 'PASS');
        // json-path-equals with an empty-string key (packages[""].version).
        fs.writeFileSync(path.join(tmp, 'lock.json'), JSON.stringify({ packages: { '': { version: '2.0.10' } } }));
        fs.writeFileSync(path.join(tmp, 'pkg.json'), JSON.stringify({ version: '2.0.10' }));
        const jeq = runVerifier({ verifier: { type: 'json-path-equals', params: {
            file: 'lock.json', path: ['packages', '', 'version'],
            equalsJsonPath: { file: 'pkg.json', path: ['version'] } } } }, { repoRoot: tmp });
        assert.strictEqual(jeq.verdict, 'PASS', 'matching json paths (incl empty key) → PASS');
        const jne = runVerifier({ verifier: { type: 'json-path-equals', params: {
            file: 'lock.json', path: ['packages', '', 'version'], equals: '9.9.9' } } }, { repoRoot: tmp });
        assert.strictEqual(jne.verdict, 'FAIL', 'mismatching literal → FAIL');
        console.log('✅ T33 runVerifier');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T33 — `Cannot find module ... run-verifiers`.

- [x] **Step 3: Implement run-verifiers.js**

Create [templates/cli/verification/run-verifiers.js](../../cli/verification/run-verifiers.js):

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function truncate(s, n = 500) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function getByKeyPath(obj, keys) {
    let cur = obj;
    for (const k of keys) {
        if (cur == null || typeof cur !== 'object' || !(k in cur)) return { found: false };
        cur = cur[k];
    }
    return { found: true, value: cur };
}

function runJsonPathEquals(repoRoot, p) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(path.resolve(repoRoot, p.file), 'utf8'));
    } catch (e) {
        return { verdict: 'FAIL', detail: `cannot read ${p.file}: ${e.message}` };
    }
    const got = getByKeyPath(data, p.path || []);
    if (!got.found) return { verdict: 'FAIL', detail: `path ${JSON.stringify(p.path)} not found in ${p.file}` };
    let expected;
    if ('equals' in p) {
        expected = p.equals;
    } else if (p.equalsJsonPath) {
        let d2;
        try {
            d2 = JSON.parse(fs.readFileSync(path.resolve(repoRoot, p.equalsJsonPath.file), 'utf8'));
        } catch (e) {
            return { verdict: 'FAIL', detail: `cannot read ${p.equalsJsonPath.file}: ${e.message}` };
        }
        const g2 = getByKeyPath(d2, p.equalsJsonPath.path || []);
        if (!g2.found) return { verdict: 'FAIL', detail: `equalsJsonPath ${JSON.stringify(p.equalsJsonPath.path)} not found` };
        expected = g2.value;
    } else {
        return { verdict: 'FAIL', detail: 'json-path-equals needs equals or equalsJsonPath' };
    }
    const ok = JSON.stringify(got.value) === JSON.stringify(expected);
    return ok
        ? { verdict: 'PASS', detail: `${JSON.stringify(got.value)} == expected` }
        : { verdict: 'FAIL', detail: `${JSON.stringify(got.value)} != ${JSON.stringify(expected)}` };
}

function runVerifier(criterion, opts = {}) {
    const repoRoot = opts.repoRoot || process.cwd();
    const exec = opts.exec || ((cmd, o) => execSync(cmd, o));
    const v = (criterion && criterion.verifier) || {};
    const p = v.params || {};
    try {
        switch (v.type) {
            case 'command': {
                try {
                    const out = exec(p.cmd, { cwd: repoRoot, timeout: 120000 });
                    return { verdict: 'PASS', detail: `exit=0 ${truncate(out)}`.trim() };
                } catch (e) {
                    return { verdict: 'FAIL', detail: `exit=${e.status != null ? e.status : '?'} ${truncate(e.stdout || e.message)}`.trim() };
                }
            }
            case 'file-exists':
                return fs.existsSync(path.resolve(repoRoot, p.path))
                    ? { verdict: 'PASS', detail: `${p.path} exists` }
                    : { verdict: 'FAIL', detail: `${p.path} missing` };
            case 'file-absent':
                return !fs.existsSync(path.resolve(repoRoot, p.path))
                    ? { verdict: 'PASS', detail: `${p.path} absent` }
                    : { verdict: 'FAIL', detail: `${p.path} present` };
            case 'json-path-equals':
                return runJsonPathEquals(repoRoot, p);
            default:
                return { verdict: 'FAIL', detail: `non-runnable verifier type: ${v.type}` };
        }
    } catch (e) {
        return { verdict: 'FAIL', detail: `verifier error: ${e.message}` };
    }
}

module.exports = { runVerifier, getByKeyPath };
```

- [x] **Step 4: Register in the manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/derive-verdicts.js'` line:

```javascript
            'verification/run-verifiers.js',
```

- [x] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T33 runVerifier`.

- [x] **Step 6: Commit**

```bash
git add templates/cli/verification/run-verifiers.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): runVerifier — execute the four machine verifier types"
```

---

### Task 2: evidence-store.js — latest-per-criterion git-tracked store

**Files:**
- Create: `templates/cli/verification/evidence-store.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `validateEvidenceRecord` (Phase 0).
- Produces: `evidencePath(root, specId)`, `readEvidence(root, specId) -> { version, specId, records }`, `writeRecord(root, specId, record) -> store` (throws on an invalid record). Slug strips the `spec:` prefix.

- [x] **Step 1: Write the failing test (T34)**

Add after T33 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T34. Testing evidence-store read/write (latest-per-criterion, validated) ...');
{
    const store = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-evi-'));
    try {
        assert.deepStrictEqual(store.readEvidence(root, 'spec:x').records, {}, 'missing store reads as empty');
        const rec = { criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'file-exists', ranAt: 't', detail: 'd', attestedBy: null };
        store.writeRecord(root, 'spec:x', rec);
        // overwrite same criterion → latest wins.
        store.writeRecord(root, 'spec:x', { ...rec, commitSha: 'def', detail: 'd2' });
        const back = store.readEvidence(root, 'spec:x');
        assert.strictEqual(Object.keys(back.records).length, 1, 'latest-per-criterion: one record');
        assert.strictEqual(back.records['ac-1'].commitSha, 'def', 'latest record wins');
        assert.ok(store.evidencePath(root, 'spec:x').endsWith(path.join('verification', 'evidence-x.json')), 'slug strips spec: prefix');
        // invalid record (manual without attestedBy) is rejected.
        assert.throws(() => store.writeRecord(root, 'spec:x', {
            criterionId: 'ac-2', verdict: 'PASS', commitSha: 'abc', verifierType: 'manual', ranAt: 't', detail: 'd', attestedBy: null,
        }), /attestedBy|invalid evidence/i, 'invalid record must throw');
        console.log('✅ T34 evidence-store');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T34 — `Cannot find module ... evidence-store`.

- [x] **Step 3: Implement evidence-store.js**

Create [templates/cli/verification/evidence-store.js](../../cli/verification/evidence-store.js):

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { validateEvidenceRecord } = require('./validate-contract');

function evidenceSlug(specId) {
    return String(specId).replace(/^spec:/, '');
}

function evidencePath(root, specId) {
    return path.join(root, '.evo-lite', 'verification', `evidence-${evidenceSlug(specId)}.json`);
}

function readEvidence(root, specId) {
    const fp = evidencePath(root, specId);
    if (!fs.existsSync(fp)) {
        return { version: 'evo-verification-evidence@1', specId, records: {} };
    }
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeRecord(root, specId, record) {
    const findings = validateEvidenceRecord(record);
    if (findings.length) {
        throw new Error('invalid evidence record: ' + findings.map(f => f.message).join('; '));
    }
    const store = readEvidence(root, specId);
    store.records[record.criterionId] = record;
    const fp = evidencePath(root, specId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(store, null, 2) + '\n');
    return store;
}

module.exports = { evidenceSlug, evidencePath, readEvidence, writeRecord };
```

- [x] **Step 4: Register in the manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/run-verifiers.js'` line:

```javascript
            'verification/evidence-store.js',
```

- [x] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T34 evidence-store`.

- [x] **Step 6: Commit**

```bash
git add templates/cli/verification/evidence-store.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): evidence-store — latest-per-criterion validated store"
```

---

### Task 3: compute-status.js — per-criterion changedFiles → live verdicts

**Files:**
- Create: `templates/cli/verification/compute-status.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `deriveVerdicts` (Phase 0).
- Produces: `computeLiveVerdicts(criteria, records, headSha, gitDiff) -> [{ criterionId, verdict, detail }]`. `records` is the `{ criterionId: record }` map. `gitDiff(commitSha) -> string[] | null` (null = unreachable commit → STALE).

- [x] **Step 1: Write the failing test (T35)**

Add after T34 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T35. Testing computeLiveVerdicts per-criterion changedFiles ...');
{
    const { computeLiveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'compute-status'));
    const crit = (id, deps) => ({ id, description: 'x', dependsOn: deps, verifier: { type: 'command', params: { cmd: 'x' } } });
    const criteria = [crit('a', ['index.js']), crit('b', ['index.js']), crit('c', ['src/**']), crit('d', ['index.js'])];
    const records = {
        b: { criterionId: 'b', verdict: 'PASS', commitSha: 'sha-b', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null },
        c: { criterionId: 'c', verdict: 'PASS', commitSha: 'sha-c', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null },
        d: { criterionId: 'd', verdict: 'PASS', commitSha: 'gone', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null },
    };
    // Per-criterion git diff: b's commit untouched index.js, c's commit changed src/app.js, d's commit is unreachable.
    const gitDiff = (sha) => {
        if (sha === 'sha-b') return [];                 // nothing changed → PASS
        if (sha === 'sha-c') return ['src/app.js'];     // dependsOn src/** changed → STALE
        return null;                                    // unreachable → STALE
    };
    const byId = Object.fromEntries(computeLiveVerdicts(criteria, records, 'HEAD', gitDiff).map(v => [v.criterionId, v.verdict]));
    assert.strictEqual(byId.a, 'UNVERIFIED', 'no record → UNVERIFIED');
    assert.strictEqual(byId.b, 'PASS', 'record, deps untouched → PASS');
    assert.strictEqual(byId.c, 'STALE', 'record, deps changed since its commit → STALE');
    assert.strictEqual(byId.d, 'STALE', 'unreachable commit → STALE');
    console.log('✅ T35 computeLiveVerdicts');
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T35 — `Cannot find module ... compute-status`.

- [x] **Step 3: Implement compute-status.js**

Create [templates/cli/verification/compute-status.js](../../cli/verification/compute-status.js):

```javascript
'use strict';

const { deriveVerdicts } = require('./derive-verdicts');

// Computes the live verdict per criterion using that criterion's own changedFiles
// (git diff <its record's commitSha>..HEAD). gitDiff returns null for an
// unreachable commit, which is reported conservatively as STALE.
function computeLiveVerdicts(criteria, records, headSha, gitDiff) {
    return (criteria || []).map(c => {
        const rec = records ? records[c.id] : undefined;
        if (!rec) {
            return deriveVerdicts([c], [], headSha, [])[0];   // UNVERIFIED
        }
        if (rec.verifierType !== 'manual') {
            const changed = gitDiff(rec.commitSha);
            if (changed === null) {
                return { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} unreachable` };
            }
            return deriveVerdicts([c], [rec], headSha, changed)[0];
        }
        // manual: STALE-exempt, no git needed.
        return deriveVerdicts([c], [rec], headSha, [])[0];
    });
}

module.exports = { computeLiveVerdicts };
```

- [x] **Step 4: Register in the manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/evidence-store.js'` line:

```javascript
            'verification/compute-status.js',
```

- [x] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T35 computeLiveVerdicts`.

- [x] **Step 6: Commit**

```bash
git add templates/cli/verification/compute-status.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): computeLiveVerdicts — per-criterion changedFiles → verdicts"
```

---

### Task 4: engine.js runSpec — dirty-tree fail-closed evidence writing

**Files:**
- Create: `templates/cli/verification/engine.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `parseSpecCriteria` (Phase 0), `parseFrontmatter` (`../planning/parse-markdown`), `runVerifier` (Task 1), `writeRecord` (Task 2).
- Produces: `runSpec(specPath, opts) -> { ok, error?, written: [{ criterionId, verdict }] }`. `opts`: `{ root?, exec?, headSha?, ranAt?, porcelain? }`. `porcelain` (test seam) overrides the `git status --porcelain` read; non-empty → `{ ok:false, error:'dirty-tree' }`.

- [x] **Step 1: Write the failing test (T36)**

Add after T35 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T36. Testing runSpec writes evidence and is dirty-tree fail-closed ...');
{
    const { runSpec } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
    const { readEvidence } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-engine-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, [
            '---', 'id: spec:fix', 'status: draft', 'linkedPlan: plan:fix', '---', '',
            '# Fix', '', '## Acceptance Criteria', '',
            '```json',
            '{ "criteria": [ { "id": "ac-ok", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "true" } } } ] }',
            '```', '',
        ].join('\n'));
        // Dirty tree → fail-closed, nothing written.
        const dirty = runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: ' M index.js', exec: () => '' });
        assert.strictEqual(dirty.ok, false, 'dirty tree must fail-closed');
        assert.strictEqual(dirty.error, 'dirty-tree', 'error names the dirty tree');
        assert.deepStrictEqual(readEvidence(root, 'spec:fix').records, {}, 'no evidence written on dirty tree');
        // Clean tree → runs verifier, writes a PASS record bound to headSha.
        const clean = runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
        assert.strictEqual(clean.ok, true, 'clean tree runs');
        const rec = readEvidence(root, 'spec:fix').records['ac-ok'];
        assert.strictEqual(rec.verdict, 'PASS', 'command exit 0 → PASS record');
        assert.strictEqual(rec.commitSha, 'sha1', 'record bound to HEAD sha');
        assert.strictEqual(rec.verifierType, 'command', 'record carries verifierType');
        console.log('✅ T36 runSpec dirty-tree fail-closed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T36 — `Cannot find module ... engine`.

- [x] **Step 3: Implement engine.js (runSpec)**

Create [templates/cli/verification/engine.js](../../cli/verification/engine.js):

```javascript
'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { parseSpecCriteria } = require('./validate-contract');
const { parseFrontmatter } = require('../planning/parse-markdown');
const { runVerifier } = require('./run-verifiers');
const { writeRecord } = require('./evidence-store');

function defaultExec(cmd, o) { return execSync(cmd, o); }

function specIdOf(specText) {
    const fm = parseFrontmatter(specText).frontmatter || {};
    return fm.id;
}

function runSpec(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    const specText = fs.readFileSync(specPath, 'utf8');
    const specId = specIdOf(specText);
    if (!specId) return { ok: false, error: 'spec has no id frontmatter', written: [] };
    // Dirty-tree fail-closed: evidence must bind to a real, committed state.
    const porcelain = String(
        opts.porcelain != null ? opts.porcelain : exec('git status --porcelain', { cwd: root })
    ).trim();
    if (porcelain) {
        return { ok: false, error: 'dirty-tree', written: [] };
    }
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();
    const parsed = parseSpecCriteria(specText);
    if (parsed.error) return { ok: false, error: parsed.error, written: [] };
    const written = [];
    for (const c of parsed.criteria) {
        if (c.verifier && c.verifier.type === 'manual') continue;
        const { verdict, detail } = runVerifier(c, { repoRoot: root, exec });
        writeRecord(root, specId, {
            criterionId: c.id, verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail, attestedBy: null,
        });
        written.push({ criterionId: c.id, verdict });
    }
    return { ok: true, written };
}

module.exports = { runSpec, specIdOf };
```

- [x] **Step 4: Register in the manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/compute-status.js'` line:

```javascript
            'verification/engine.js',
```

- [x] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T36 runSpec dirty-tree fail-closed`.

- [x] **Step 6: Commit**

```bash
git add templates/cli/verification/engine.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): runSpec — dirty-tree fail-closed evidence writing"
```

---

### Task 5: engine statusSpec + attestSpec + CLI wiring (run/status/attest)

**Files:**
- Modify: `templates/cli/verification/engine.js`, `templates/cli/verification/commands.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `computeLiveVerdicts` (Task 3), `readEvidence`/`writeRecord` (Task 2), `parseSpecCriteria`/`specIdOf` (Task 4).
- Produces: `statusSpec(specPath, opts) -> [{ criterionId, verdict, detail }]` (opts: `{ root?, exec?, headSha?, gitDiff? }`); `attestSpec(specPath, criterionId, opts) -> record` (opts: `{ root?, exec?, headSha?, ranAt?, by, note? }`). `commands.js` gains `verify-contract run|status|attest`; `status --strict` exits non-zero on any non-PASS.

- [x] **Step 1: Write the failing test (T37)**

Add after T36 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T37. Testing statusSpec + attestSpec (run→status→attest closed loop) ...');
{
    const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
    const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'commands'));
    assert.strictEqual(typeof engine.statusSpec, 'function', 'engine must export statusSpec');
    assert.strictEqual(typeof engine.attestSpec, 'function', 'engine must export attestSpec');
    assert.strictEqual(typeof commands.registerVerificationCommands, 'function', 'commands still exports registration');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-status-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, [
            '---', 'id: spec:s', 'status: draft', 'linkedPlan: plan:s', '---', '',
            '# S', '', '## Acceptance Criteria', '',
            '```json',
            '{ "criteria": [' +
            ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "true" } } },' +
            ' { "id": "ac-man", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "branch protection" } } } ] }',
            '```', '',
        ].join('\n'));
        // run (clean) writes the machine record; manual stays unverified.
        engine.runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
        const noDiff = () => [];                              // nothing changed since sha1
        let v = Object.fromEntries(engine.statusSpec(specPath, { root, headSha: 'sha1', gitDiff: noDiff, exec: () => 'sha1' }).map(x => [x.criterionId, x.verdict]));
        assert.strictEqual(v['ac-cmd'], 'PASS', 'machine criterion PASS after run');
        assert.strictEqual(v['ac-man'], 'UNVERIFIED', 'manual criterion UNVERIFIED until attested');
        // attest the manual criterion → PASS, STALE-exempt.
        engine.attestSpec(specPath, 'ac-man', { root, headSha: 'sha1', ranAt: 't', by: 'alice', note: 'enabled in repo settings' });
        v = Object.fromEntries(engine.statusSpec(specPath, { root, headSha: 'sha9', gitDiff: () => ['index.js'], exec: () => 'sha9' }).map(x => [x.criterionId, x.verdict]));
        assert.strictEqual(v['ac-man'], 'PASS', 'attested manual stays PASS even when deps changed (STALE-exempt)');
        assert.strictEqual(v['ac-cmd'], 'STALE', 'machine criterion STALE once its deps changed');
        console.log('✅ T37 statusSpec + attestSpec');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [x] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T37 — `engine.statusSpec is not a function`.

- [x] **Step 3: Add statusSpec + attestSpec to engine.js**

In [templates/cli/verification/engine.js](../../cli/verification/engine.js), add the requires at the top (after the existing requires):

```javascript
const { readEvidence } = require('./evidence-store');
const { computeLiveVerdicts } = require('./compute-status');
```

Then add before `module.exports`:

```javascript
function statusSpec(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    const specText = fs.readFileSync(specPath, 'utf8');
    const specId = specIdOf(specText);
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const parsed = parseSpecCriteria(specText);
    const store = readEvidence(root, specId);
    const gitDiff = opts.gitDiff || function (sha) {
        try {
            const out = String(exec(`git diff ${sha}..HEAD --name-only`, { cwd: root }));
            return out.split(/\r?\n/).filter(Boolean);
        } catch (_) {
            return null;   // unreachable commit → STALE
        }
    };
    return computeLiveVerdicts(parsed.criteria, store.records, headSha, gitDiff);
}

function attestSpec(specPath, criterionId, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    const specText = fs.readFileSync(specPath, 'utf8');
    const specId = specIdOf(specText);
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();
    if (!opts.by) throw new Error('attest requires --by <name>');
    const record = {
        criterionId, verdict: 'PASS', commitSha: headSha, verifierType: 'manual',
        ranAt, detail: opts.note || 'manual attestation', attestedBy: opts.by,
    };
    writeRecord(root, specId, record);
    return record;
}
```

And update the exports line:

```javascript
module.exports = { runSpec, statusSpec, attestSpec, specIdOf };
```

- [x] **Step 4: Wire the CLI subcommands in commands.js**

In [templates/cli/verification/commands.js](../../cli/verification/commands.js), add the engine require after the existing require:

```javascript
const engine = require('./engine');
```

Then, inside `registerVerificationCommands`, after the existing `vc.command('lint <spec>')...` block, add:

```javascript
    vc.command('run <spec>')
        .description('Run machine verifiers and write commit-bound evidence (fail-closed on a dirty tree).')
        .action((specPath) => {
            const res = engine.runSpec(specPath);
            if (!res.ok) {
                console.error(res.error === 'dirty-tree'
                    ? '❌ working tree is dirty — commit changes first; evidence must bind to a real commit'
                    : `❌ ${res.error}`);
                process.exitCode = 1;
                return;
            }
            for (const w of res.written) console.log(`${w.verdict === 'PASS' ? '✅' : '❌'} ${w.criterionId} ${w.verdict}`);
            console.log(`ran ${res.written.length} machine verifier(s)`);
        });

    vc.command('status <spec>')
        .description('Show live four-state verdicts for a spec.')
        .option('--strict', 'Exit non-zero if any criterion is not PASS')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            const verdicts = engine.statusSpec(specPath);
            if (options.json) {
                console.log(JSON.stringify(verdicts, null, 2));
            } else {
                for (const v of verdicts) console.log(`${v.verdict.padEnd(11)} ${v.criterionId}  ${v.detail || ''}`);
            }
            if (options.strict && verdicts.some(v => v.verdict !== 'PASS')) process.exitCode = 1;
        });

    vc.command('attest <spec> <criterionId>')
        .description('Record a manual attestation (PASS) for a manual criterion.')
        .requiredOption('--by <name>', 'Who is attesting')
        .option('--note <text>', 'Attestation note')
        .action((specPath, criterionId, options) => {
            engine.attestSpec(specPath, criterionId, { by: options.by, note: options.note });
            console.log(`✅ attested ${criterionId} by ${options.by}`);
        });
```

- [x] **Step 5: Run the governance suite; verify T37 passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/memory.js sync-runtime; node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T37 statusSpec + attestSpec`. If a `Cannot find module './engine'` error appears (mirror half-synced), run `cp templates/cli/verification/engine.js .evo-lite/cli/verification/engine.js` then re-run.

- [x] **Step 6: Verify the CLI end-to-end on a real fixture**

Run:

```bash
node ./.evo-lite/cli/memory.js verify-contract status docs/superpowers/specs/2026-06-27-verification-contract-phase1.md
```
Expected: a table of 5 criteria, each `UNVERIFIED` (no evidence written yet). Exit 0 (no `--strict`).

- [x] **Step 7: Run the full suite both scopes; confirm green**

Run: `node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js`
Expected: both `--- ... passed! ---`; process exits 0.

- [x] **Step 8: Commit**

```bash
git add templates/cli/verification/engine.js templates/cli/verification/commands.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): run/status/attest CLI — Phase 1 execution loop closed"
```

---

## Self-Review

**1. Spec coverage:**
- run executes 4 machine verifiers + writes commit-bound PASS/FAIL evidence → Task 1 (runVerifier) + Task 4 (runSpec).
- Dirty-tree fail-closed → Task 4 (T36).
- status derives 4 states per-criterion changedFiles, unreachable→STALE, `--strict` → Task 3 (computeLiveVerdicts) + Task 5 (statusSpec + CLI).
- attest manual (PASS + attestedBy, STALE-exempt) → Task 5 (T37).
- json-path-equals array-of-keys incl empty key → Task 1 (T33).
- evidence git-tracked latest-per-criterion, validated → Task 2 (T34).
- Raw verdict ∈ {PASS,FAIL}; manual only via attest → Tasks 4-5.

**2. Placeholder scan:** none — every step has concrete code/commands.

**3. Type consistency:** `runVerifier(criterion, opts)→{verdict,detail}`, `writeRecord(root,specId,record)`, `readEvidence(root,specId)→{records}`, `computeLiveVerdicts(criteria,records,headSha,gitDiff)`, `runSpec/statusSpec/attestSpec(specPath,...)`, `specIdOf(specText)` are consistent across tasks. Records always carry `{criterionId,verdict,commitSha,verifierType,ranAt,detail,attestedBy}` and pass Phase 0 `validateEvidenceRecord`. `gitDiff(sha)→string[]|null` uniform. `json-path-equals.path` is an array of keys everywhere.

**Note (deferred, per spec):** `mem close`, drift/dashboard wiring, command sandboxing, and manual-attestation expiry are out of Phase 1.
