# Verification Contract — Criterion Digest (PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind evidence to the criterion's verification semantics via a `criterionDigest`, so editing a verifier (cmd/params/type/dependsOn) STALEs the old PASS — including for `manual`.

**Architecture:** Add a pure `criterionDigest(criterion)` to `validate-contract.js` (SHA-256 of canonical `{id, verifier:{type,params}, dependsOn}`). `deriveVerdicts` recomputes it from the live criterion and STALEs any PASS whose record digest is absent or mismatched (machine and manual). `runSpec`/`attestSpec` stamp the digest at write time.

**Tech Stack:** Node.js (CommonJS), `crypto` (built-in, no new dep), the `node ./.evo-lite/cli/test.js governance` harness, `templates/cli → .evo-lite/cli` mirror.

## Global Constraints

- No new npm dependencies — `crypto` is built-in.
- Digest covers ONLY `{id, verifier:{type,params}, dependsOn}`; `description` is excluded. Object keys sorted recursively for stability; `dependsOn` order preserved.
- Digest string format: `"sha256:" + hex`.
- `validateEvidenceRecord` keeps `criterionDigest` OPTIONAL (schema stays backward-tolerant); the STALE rule enforces presence.
- Records with no `criterionDigest` (pre-PR2) → STALE.
- manual PASS: STALE on digest absent/mismatch, but still exempt from the dependsOn/commit STALE rules.
- New `templates/cli/**` files would need manifest registration, but PR2 only MODIFIES existing managed files. After edits run `node ./.evo-lite/cli/memory.js sync-runtime` (2–3× if partial) before `npm test` (npm test runs the `.evo-lite/cli` MIRROR, not `templates/cli`).
- Governance tests run via `node ./.evo-lite/cli/test.js governance`, added inside `runGovernanceTests()` after the existing last verification block (currently T48).

---

### Task 1: criterionDigest in validate-contract.js

**Files:**
- Modify: `templates/cli/verification/validate-contract.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Produces: `criterionDigest(criterion) -> "sha256:<hex>"` — pure; canonical JSON of `{ id, verifier:{type,params}, dependsOn }` with recursively sorted keys. Exported from `validate-contract.js`.

- [ ] **Step 1: Write the failing test (T49)**

Add after the T48 block inside `runGovernanceTests()` in `templates/cli/test.js`:

```javascript
console.log('T49. Testing criterionDigest is stable + semantic ...');
{
    const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const base = { id: 'ac-1', description: 'hello', dependsOn: ['a', 'b'],
        verifier: { type: 'command', params: { cmd: 'x', scope: 'governance' } } };
    const d = criterionDigest(base);
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(d), 'digest is sha256:<64 hex>');
    // Stable across params key reordering.
    const reordered = { id: 'ac-1', description: 'hello', dependsOn: ['a', 'b'],
        verifier: { type: 'command', params: { scope: 'governance', cmd: 'x' } } };
    assert.strictEqual(criterionDigest(reordered), d, 'param key order must not change digest');
    // description is excluded.
    assert.strictEqual(criterionDigest({ ...base, description: 'totally different prose' }), d, 'description must not change digest');
    // verifier param change DOES change it.
    assert.notStrictEqual(criterionDigest({ ...base, verifier: { type: 'command', params: { cmd: 'y' } } }), d, 'cmd change must change digest');
    // dependsOn change DOES change it.
    assert.notStrictEqual(criterionDigest({ ...base, dependsOn: ['a'] }), d, 'dependsOn change must change digest');
    // dependsOn reorder is a change.
    assert.notStrictEqual(criterionDigest({ ...base, dependsOn: ['b', 'a'] }), d, 'dependsOn reorder changes digest');
    console.log('✅ T49 criterionDigest stable + semantic');
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T49 — `criterionDigest is not a function`.

- [ ] **Step 3: Implement criterionDigest**

In `templates/cli/verification/validate-contract.js`, add `const crypto = require('crypto');` to the top requires, then add before `module.exports`:

```javascript
// Recursively sort object keys so the JSON is canonical regardless of author key order.
function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
        return out;
    }
    return value;
}

// Fingerprint of a criterion's VERIFICATION SEMANTICS only (id + verifier + dependsOn).
// description is excluded (prose). Used to STALE evidence when the criterion is redefined.
function criterionDigest(criterion) {
    const c = criterion || {};
    const v = c.verifier || {};
    const norm = canonicalize({
        id: c.id,
        verifier: { type: v.type, params: v.params || {} },
        dependsOn: c.dependsOn || [],
    });
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
```

Add `criterionDigest` to the `module.exports` object.

- [ ] **Step 4: Run it; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T49 criterionDigest stable + semantic`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/verification/validate-contract.js templates/cli/test.js
git commit -m "feat(verification): criterionDigest — fingerprint verifier+dependsOn semantics"
```

---

### Task 2: deriveVerdicts STALEs on digest absent/mismatch (machine + manual)

**Files:**
- Modify: `templates/cli/verification/derive-verdicts.js`
- Modify: `templates/cli/test.js` (new T50/T51; update T35 records to carry digests)
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `criterionDigest` (Task 1).
- Produces: `deriveVerdicts(criteria, records, headSha, changedFiles)` unchanged signature; PASS now requires `record.criterionDigest === criterionDigest(currentCriterion)` for both machine and manual.

- [ ] **Step 1: Write the failing tests (T50 machine, T51 manual)**

Add after T49 in `templates/cli/test.js`:

```javascript
console.log('T50. Testing deriveVerdicts STALEs a machine PASS on digest change/absent ...');
{
    const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
    const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const crit = { id: 'm', description: 'x', dependsOn: ['index.js'], verifier: { type: 'command', params: { cmd: 'x' } } };
    const baseRec = { criterionId: 'm', verdict: 'PASS', commitSha: 'h', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null };
    // Matching digest + deps untouched → PASS.
    const okRec = { ...baseRec, criterionDigest: criterionDigest(crit) };
    assert.strictEqual(deriveVerdicts([crit], [okRec], 'h', [])[0].verdict, 'PASS', 'matching digest, deps untouched → PASS');
    // Absent digest → STALE (legacy evidence).
    assert.strictEqual(deriveVerdicts([crit], [baseRec], 'h', [])[0].verdict, 'STALE', 'absent digest → STALE');
    // Stale digest (criterion redefined) → STALE even though deps unchanged.
    const redefined = { ...crit, verifier: { type: 'command', params: { cmd: 'DIFFERENT' } } };
    assert.strictEqual(deriveVerdicts([redefined], [okRec], 'h', [])[0].verdict, 'STALE', 'digest mismatch → STALE');
    console.log('✅ T50 machine digest STALE');
}

console.log('T51. Testing deriveVerdicts manual: STALE on digest change, exempt from deps/commit ...');
{
    const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
    const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const crit = { id: 'man', description: 'x', dependsOn: ['index.js'], verifier: { type: 'manual', params: { reason: 'r' } } };
    const rec = { criterionId: 'man', verdict: 'PASS', commitSha: 'old', verifierType: 'manual', ranAt: 't', detail: 'd', attestedBy: 'alice', criterionDigest: criterionDigest(crit) };
    // Deps changed + HEAD moved, but digest matches → manual stays PASS (out-of-band).
    assert.strictEqual(deriveVerdicts([crit], [rec], 'newhead', ['index.js'])[0].verdict, 'PASS', 'manual PASS survives deps/commit change when digest matches');
    // Criterion redefined → manual STALE.
    const redefined = { ...crit, verifier: { type: 'manual', params: { reason: 'DIFFERENT' } } };
    assert.strictEqual(deriveVerdicts([redefined], [rec], 'newhead', ['index.js'])[0].verdict, 'STALE', 'manual STALEs on digest change');
    // Absent digest → manual STALE.
    const legacy = { ...rec }; delete legacy.criterionDigest;
    assert.strictEqual(deriveVerdicts([crit], [legacy], 'h', [])[0].verdict, 'STALE', 'manual absent digest → STALE');
    console.log('✅ T51 manual digest STALE');
}
```

- [ ] **Step 2: Run; verify the new tests fail**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T50 — absent-digest record currently returns PASS (digest rule not implemented yet).

- [ ] **Step 3: Implement the digest STALE rule**

Replace the PASS-path block in `templates/cli/verification/derive-verdicts.js`. Add the require at the top (after the file's opening `'use strict';`):

```javascript
const { criterionDigest } = require('./validate-contract');
```

Then replace the body of `deriveVerdicts`'s `.map` callback from the `if (rec.verifierType === 'manual')` line through the final `dependsMatches` return with:

```javascript
        if (rec.verdict !== 'PASS') return { criterionId: c.id, verdict: 'UNVERIFIED', detail: `raw verdict ${rec.verdict}` };
        // Evidence must match the criterion it claims to verify. Absent or mismatched
        // digest → STALE (covers both machine and manual; legacy records have none).
        if (!rec.criterionDigest) {
            return { criterionId: c.id, verdict: 'STALE', detail: 'evidence predates criterion digest' };
        }
        if (rec.criterionDigest !== criterionDigest(c)) {
            return { criterionId: c.id, verdict: 'STALE', detail: 'criterion definition changed since evidence' };
        }
        if (rec.verifierType === 'manual') {
            return { criterionId: c.id, verdict: 'PASS', detail: 'manual attestation (digest matches)' };
        }
        if (changedFiles == null) {
            return rec.commitSha !== headSha
                ? { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} != HEAD ${headSha}` }
                : { criterionId: c.id, verdict: 'PASS', detail: 'commit matches HEAD' };
        }
        return dependsMatches(c.dependsOn, changedFiles)
            ? { criterionId: c.id, verdict: 'STALE', detail: 'dependsOn changed since evidence' }
            : { criterionId: c.id, verdict: 'PASS', detail: 'dependsOn unchanged' };
```

(The lines above `if (rec.verdict !== 'PASS')` — the `if (!rec)` and `if (rec.verdict === 'FAIL')` guards — stay unchanged.)

- [ ] **Step 4: Update T35 records to carry matching digests**

T35 ("computeLiveVerdicts per-criterion changedFiles") builds records with no digest, which now STALE. Make the PASS/STALE intents explicit. In the T35 block in `templates/cli/test.js`, add after the `const { computeLiveVerdicts } = require(...)` line:

```javascript
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
```

Then in the same block, for each of the three records (`b`, `c`, `d`) add a `criterionDigest` field computed from its matching criterion. The criteria are created by `crit('b', ['index.js'])` etc.; capture them so the digest matches:

```javascript
            const critA = crit('a', ['index.js']);
            const critB = crit('b', ['index.js']);
            const critC = crit('c', ['src/**']);
            const critD = crit('d', ['index.js']);
            const criteria = [critA, critB, critC, critD];
            const records = {
                b: { criterionId: 'b', verdict: 'PASS', commitSha: 'sha-b', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critB) },
                c: { criterionId: 'c', verdict: 'PASS', commitSha: 'sha-c', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critC) },
                d: { criterionId: 'd', verdict: 'PASS', commitSha: 'gone', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critD) },
            };
```

This REPLACES the existing `const criteria = [...]` and `const records = {...}` lines in T35 (the `crit`, `gitDiff`, and assertions below stay as-is). Result: `a` UNVERIFIED (no record), `b` PASS (digest matches, deps untouched), `c` STALE (deps changed), `d` STALE (unreachable commit) — same intents as before, now digest-clean.

- [ ] **Step 5: Run; verify all pass**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T50`, `✅ T51`, and `✅ T35` (updated) all green; no other governance regressions.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/derive-verdicts.js templates/cli/test.js
git commit -m "feat(verification): deriveVerdicts STALEs PASS on criterion-digest mismatch/absent"
```

---

### Task 3: runSpec + attestSpec stamp criterionDigest

**Files:**
- Modify: `templates/cli/verification/engine.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `criterionDigest` (Task 1).
- Produces: evidence records written by `runSpec` (per machine criterion) and `attestSpec` (the manual criterion) now include `criterionDigest`.

- [ ] **Step 1: Write the failing test (T52)**

Add after T51 in `templates/cli/test.js`:

```javascript
console.log('T52. Testing runSpec + attestSpec stamp criterionDigest ...');
{
    const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
    const { readEvidence } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
    const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-digest-write-'));
    try {
        const specPath = path.join(root, 'spec.md');
        fs.writeFileSync(specPath, [
            '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
            '# T', '', '## Acceptance Criteria', '',
            '```json',
            '{ "criteria": [' +
            ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } },' +
            ' { "id": "ac-man", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "r" } } } ] }',
            '```', '',
        ].join('\n'));
        const cleanExec = (cmd) => (/status --porcelain/.test(cmd) ? '' : 'sha1');

        engine.runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
        const cmdRec = readEvidence(root, 'spec:t').records['ac-cmd'];
        assert.ok(cmdRec.criterionDigest && /^sha256:/.test(cmdRec.criterionDigest), 'runSpec stamps criterionDigest');

        engine.attestSpec(specPath, 'ac-man', { root, headSha: 'sha1', ranAt: 't', by: 'alice', exec: cleanExec });
        const manRec = readEvidence(root, 'spec:t').records['ac-man'];
        assert.ok(manRec.criterionDigest && /^sha256:/.test(manRec.criterionDigest), 'attestSpec stamps criterionDigest');

        // The stamped digest matches what deriveVerdicts will recompute → live PASS.
        const parsed = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract')).loadValidatedContract(fs.readFileSync(specPath, 'utf8'));
        const cmdCrit = parsed.criteria.find(c => c.id === 'ac-cmd');
        assert.strictEqual(cmdRec.criterionDigest, criterionDigest(cmdCrit), 'stamped digest equals recomputed digest');
        console.log('✅ T52 writers stamp criterionDigest');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
```

- [ ] **Step 2: Run; verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at T52 — `runSpec stamps criterionDigest` (field is undefined).

- [ ] **Step 3: Implement digest stamping**

In `templates/cli/verification/engine.js`, add `criterionDigest` to the validate-contract require (it currently imports `loadValidatedContract`):

```javascript
const { loadValidatedContract, criterionDigest } = require('./validate-contract');
```

In `runSpec`, the record written in the loop currently is:

```javascript
        writeRecord(root, specId, {
            criterionId: c.id, verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail, attestedBy: null,
        });
```

Add `criterionDigest: criterionDigest(c),`:

```javascript
        writeRecord(root, specId, {
            criterionId: c.id, verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail, attestedBy: null,
            criterionDigest: criterionDigest(c),
        });
```

In `attestSpec`, the record currently is built from the found `crit`:

```javascript
    const record = {
        criterionId, verdict: 'PASS', commitSha: headSha, verifierType: 'manual',
        ranAt, detail: opts.note || 'manual attestation', attestedBy: opts.by,
    };
```

Add `criterionDigest: criterionDigest(crit),`:

```javascript
    const record = {
        criterionId, verdict: 'PASS', commitSha: headSha, verifierType: 'manual',
        ranAt, detail: opts.note || 'manual attestation', attestedBy: opts.by,
        criterionDigest: criterionDigest(crit),
    };
```

- [ ] **Step 4: Run; verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T52 writers stamp criterionDigest`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/verification/engine.js templates/cli/test.js
git commit -m "feat(verification): runSpec + attestSpec stamp criterionDigest into evidence"
```

---

### Task 4: Sync mirror, full suite, governance close

**Files:**
- Modify: `.evo-lite/cli/**` (mirror, via sync)
- Modify: `docs/superpowers/specs/2026-06-28-verification-contract-criterion-digest.md` (status → done)
- Modify: `docs/superpowers/plans/2026-06-28-verification-contract-criterion-digest.md` (checkboxes)

- [ ] **Step 1: Sync the runtime mirror**

Run: `node ./.evo-lite/cli/memory.js sync-runtime` (repeat once; expect a 2nd run to report `copied: 0`). Confirm the three modified files mirrored:

```bash
node -e "['validate-contract.js','derive-verdicts.js','engine.js'].forEach(f=>{const a=require('fs').readFileSync('templates/cli/verification/'+f,'utf8');const b=require('fs').readFileSync('.evo-lite/cli/verification/'+f,'utf8');console.log(f, a===b?'OK':'DRIFT')})"
```
Expected: all three `OK`.

- [ ] **Step 2: Full suite both scopes**

Run: `npm test`
Expected: TWO `passed!` lines (governance incl. T49–T52, then integration), exit 0. Investigate any failure before continuing.

- [ ] **Step 3: Dogfood — rebind this spec's evidence and close it**

The working tree must be clean (commit Tasks 1–3 first). Then:

```bash
git status --porcelain   # must be empty
node ./.evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-06-28-verification-contract-criterion-digest.md
git add .evo-lite/verification/evidence-verification-contract-criterion-digest.json
git commit -m "test(verification): bind PR2 criterion-digest spec evidence (4 PASS)"
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-criterion-digest.md --preview --strict
```
Expected: 4 PASS records written (each criterion's command runs the governance suite, exit 0); `close --preview --strict` prints `readiness: READY` and exits 0.

- [ ] **Step 4: Apply the closure**

```bash
node ./.evo-lite/cli/memory.js close docs/superpowers/specs/2026-06-28-verification-contract-criterion-digest.md --apply
```
Expected: `readiness: READY — closed`; plan checkboxes flipped, spec `status: done`, staged source files. Then create the R008 archive evidence so drift clears (the plan's tasks need archive snapshots):

```bash
node ./.evo-lite/cli/memory.js archive --type task "PR2 criterion-digest closure: task:verification-contract-criterion-digest-t1 criterionDigest helper, task:verification-contract-criterion-digest-t2 deriveVerdicts digest STALE, task:verification-contract-criterion-digest-t3 writers stamp digest, task:verification-contract-criterion-digest-t4 dogfood close."
git add -A
git commit -m "feat(verification): PR2 criterion-digest shipped + self-closed; archive evidence"
```

- [ ] **Step 5: Confirm drift clean**

Run: `node ./.evo-lite/cli/memory.js plan gaps`
Expected: `No planning drift findings` (drift 0). The PR2 spec is `done`, its plan tasks all implemented with archive evidence.

---

## Self-Review

**1. Spec coverage:**
- ac-digest-stable-semantic → Task 1 (T49: sha256 format, param-reorder stable, description-excluded, verifier/dependsOn-sensitive).
- ac-machine-stale-on-redef → Task 2 (T50: matching→PASS, absent→STALE, mismatch→STALE).
- ac-manual-stale-on-redef → Task 2 (T51: deps/commit-exempt when digest matches, STALE on mismatch/absent).
- ac-writers-set-digest → Task 3 (T52: runSpec + attestSpec stamp; equals recomputed).
- Backward-compat (absent digest → STALE) → Task 2 T50/T51 absent cases.
- No contractDigest, description excluded, manual deps-exempt → Global Constraints + Task 1/2 code.

**2. Placeholder scan:** none — every step carries concrete code/commands.

**3. Type consistency:** `criterionDigest(criterion) -> "sha256:<hex>"` defined in Task 1, consumed identically in Tasks 2 (derive-verdicts) and 3 (engine) and the tests. Evidence record shape extends the existing keys with one optional `criterionDigest` string; `deriveVerdicts`/`writeRecord` signatures unchanged. `loadValidatedContract` (PR1) reused in T52.
