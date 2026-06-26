---
id: plan:verification-contract-phase0
linkedSpec: spec:verification-contract-phase0
---

# Verification Contract Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the machine-readable verification data contract — a schema asset,
a dependency-free validator for acceptance criteria + evidence records, and a
`mem verify-contract lint` CLI — with no verifier execution and no `mem close`.

**Architecture:** A single shipped JSON asset (`contract-schema.json`) is the
source of truth for the closed verifier-type enum, the four verdict states, and
per-type required params. A pure validator module reads that asset and validates
(a) a spec's `criteria` block (authored as a fenced ```json block under
`## Acceptance Criteria`) and (b) evidence records. A thin Commander subcommand
exposes `lint`. All proven through the existing governance test slice; new files
ship via `template-manifest.js` and mirror via `sync-runtime`.

**Tech Stack:** Node.js (CommonJS), no new dependencies (JSON.parse only — the
runtime has no YAML parser), the home-grown `node ./.evo-lite/cli/test.js
governance` runner, the `templates/cli → .evo-lite/cli` mirror flow.

## Global Constraints

- No new npm dependencies — `dependencies` MUST stay `{ better-sqlite3, tar, commander, @modelcontextprotocol/sdk }` (RUNTIME_DEPENDENCIES, [index.js:31](../../../index.js)).
- Criteria and evidence are authored/stored as JSON, never YAML (no YAML parser ships).
- Phase 0 is data contract only: NO verifier execution, NO verdict derivation, NO `mem close`, NO change to R008 / planning IR / drift rules.
- New `templates/cli/**` files MUST be registered in `template-manifest.js` so they ship in the tarball and mirror to `.evo-lite/cli/`.
- Governance tests live in `runGovernanceTests()` and only run under scope `governance` or `all`; run them with `node ./.evo-lite/cli/test.js governance`.

---

### Task 1: Ship the contract-schema.json asset (verifier enum + verdict states + per-type params)

**Files:**
- Create: `templates/cli/verification/contract-schema.json`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Produces: a JSON asset with `verifierTypes` (object: type → `{ requiredParams: string[], optionalParams: string[] }`), `verdictStates: string[]`, consumed by Task 2/3 validators and the dogfood file-exists criterion.

- [ ] **Step 1: Write the failing test (T28)**

Add after the T18h block in [templates/cli/test.js](../../cli/test.js) (inside `runGovernanceTests`):

```javascript
console.log('T28. Testing verification contract-schema asset shape ...');
{
    const schema = JSON.parse(fs.readFileSync(
        path.join(TEMPLATE_CLI_DIR, 'verification', 'contract-schema.json'), 'utf8'));
    assert.deepStrictEqual(
        Object.keys(schema.verifierTypes).sort(),
        ['command', 'file-absent', 'file-exists', 'json-path-equals', 'manual'],
        'verifierTypes must be exactly the closed Phase-0 enum');
    assert.deepStrictEqual(
        schema.verdictStates.slice().sort(),
        ['FAIL', 'PASS', 'STALE', 'UNVERIFIED'],
        'verdictStates must be the four-state model');
    assert.deepStrictEqual(schema.verifierTypes['command'].requiredParams, ['cmd'],
        'command requires cmd');
    assert.deepStrictEqual(schema.verifierTypes['json-path-equals'].requiredParams, ['file', 'path'],
        'json-path-equals requires file + path');
    assert.deepStrictEqual(schema.verifierTypes['manual'].requiredParams, ['reason'],
        'manual requires reason');
    console.log('✅ T28 contract-schema asset shape');
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T28 — `ENOENT ... contract-schema.json`.

- [ ] **Step 3: Create the schema asset**

Create [templates/cli/verification/contract-schema.json](../../cli/verification/contract-schema.json):

```json
{
  "version": "evo-verification-contract@1",
  "verdictStates": ["PASS", "FAIL", "UNVERIFIED", "STALE"],
  "verifierTypes": {
    "command":          { "requiredParams": ["cmd"],          "optionalParams": ["cwd", "scope"] },
    "file-exists":      { "requiredParams": ["path"],         "optionalParams": [] },
    "file-absent":      { "requiredParams": ["path"],         "optionalParams": [] },
    "json-path-equals": { "requiredParams": ["file", "path"], "optionalParams": ["equals", "equalsJsonPath"] },
    "manual":           { "requiredParams": ["reason"],       "optionalParams": [] }
  }
}
```

- [ ] **Step 4: Register the asset in the template manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add to the managed files array (after the `'planning/backfill-evidence.js'` line):

```javascript
            'verification/contract-schema.json',
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T28 contract-schema asset shape`.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/contract-schema.json templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): ship contract-schema asset (verifier enum + verdict states)"
```

---

### Task 2: validateCriteria — per-type params + dependsOn + dup-id checks

**Files:**
- Create: `templates/cli/verification/validate-contract.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `contract-schema.json` (Task 1) for the type enum + required params.
- Produces: `validateCriteria(criteria: object[]) -> { id, level, message }[]` (empty array = valid). A finding has `level: 'error'`. Exported from `validate-contract.js`.

- [ ] **Step 1: Write the failing test (T29)**

Add after T28 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T29. Testing validateCriteria rejects malformed criteria ...');
{
    const { validateCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    // Valid criterion → no findings.
    const ok = validateCriteria([{
        id: 'ac-1', description: 'x', dependsOn: ['index.js'],
        verifier: { type: 'file-exists', params: { path: 'a' } },
    }]);
    assert.deepStrictEqual(ok, [], 'a well-formed criterion must produce no findings');
    // Unknown verifier type.
    const badType = validateCriteria([{
        id: 'ac-2', description: 'x', dependsOn: ['a'],
        verifier: { type: 'sniff', params: {} },
    }]);
    assert.ok(badType.some(f => /unknown verifier type/i.test(f.message)), 'unknown type must be flagged');
    // Missing required param (command without cmd).
    const badParam = validateCriteria([{
        id: 'ac-3', description: 'x', dependsOn: ['a'],
        verifier: { type: 'command', params: { scope: 'governance' } },
    }]);
    assert.ok(badParam.some(f => /missing required param.*cmd/i.test(f.message)), 'missing cmd must be flagged');
    // Empty dependsOn.
    const noDeps = validateCriteria([{
        id: 'ac-4', description: 'x', dependsOn: [],
        verifier: { type: 'file-exists', params: { path: 'a' } },
    }]);
    assert.ok(noDeps.some(f => /dependsOn/i.test(f.message)), 'empty dependsOn must be flagged');
    // Duplicate ids.
    const dup = validateCriteria([
        { id: 'ac-5', description: 'x', dependsOn: ['a'], verifier: { type: 'file-exists', params: { path: 'a' } } },
        { id: 'ac-5', description: 'y', dependsOn: ['b'], verifier: { type: 'file-exists', params: { path: 'b' } } },
    ]);
    assert.ok(dup.some(f => /duplicate criterion id/i.test(f.message)), 'duplicate ids must be flagged');
    console.log('✅ T29 validateCriteria');
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T29 — `Cannot find module ... validate-contract`.

- [ ] **Step 3: Implement validateCriteria**

Create [templates/cli/verification/validate-contract.js](../../cli/verification/validate-contract.js):

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'contract-schema.json'), 'utf8'));

function finding(id, message) {
    return { id, level: 'error', message };
}

function validateCriteria(criteria) {
    const findings = [];
    if (!Array.isArray(criteria)) {
        return [finding('criteria', 'criteria must be an array')];
    }
    const seen = new Set();
    criteria.forEach((c, i) => {
        const id = (c && typeof c.id === 'string') ? c.id : `#${i}`;
        if (!c || typeof c.id !== 'string' || !c.id) {
            findings.push(finding(id, 'criterion is missing a string id'));
        } else if (seen.has(c.id)) {
            findings.push(finding(id, `duplicate criterion id: ${c.id}`));
        } else {
            seen.add(c.id);
        }
        if (!c || typeof c.description !== 'string' || !c.description) {
            findings.push(finding(id, 'criterion is missing a string description'));
        }
        if (!c || !Array.isArray(c.dependsOn) || c.dependsOn.length === 0) {
            findings.push(finding(id, 'criterion needs a non-empty dependsOn array'));
        }
        const v = c && c.verifier;
        if (!v || typeof v.type !== 'string') {
            findings.push(finding(id, 'criterion is missing verifier.type'));
            return;
        }
        const typeSpec = SCHEMA.verifierTypes[v.type];
        if (!typeSpec) {
            findings.push(finding(id, `unknown verifier type: ${v.type}`));
            return;
        }
        const params = (v.params && typeof v.params === 'object') ? v.params : {};
        for (const req of typeSpec.requiredParams) {
            if (!(req in params)) {
                findings.push(finding(id, `missing required param "${req}" for type ${v.type}`));
            }
        }
        const allowed = new Set([...typeSpec.requiredParams, ...typeSpec.optionalParams]);
        for (const key of Object.keys(params)) {
            if (!allowed.has(key)) {
                findings.push(finding(id, `unknown param "${key}" for type ${v.type}`));
            }
        }
    });
    return findings;
}

module.exports = { validateCriteria, SCHEMA };
```

- [ ] **Step 4: Register the module in the template manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/contract-schema.json'` line:

```javascript
            'verification/validate-contract.js',
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T29 validateCriteria`.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/validate-contract.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): validateCriteria — per-type params, dependsOn, dup-id checks"
```

---

### Task 3: validateEvidenceRecord + parseSpecCriteria

**Files:**
- Modify: `templates/cli/verification/validate-contract.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `SCHEMA` (Task 2).
- Produces: `validateEvidenceRecord(rec) -> finding[]` and `parseSpecCriteria(specText) -> { criteria: object[], error: string|null }`. Both exported from `validate-contract.js`.

- [ ] **Step 1: Write the failing test (T30)**

Add after T29 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T30. Testing validateEvidenceRecord + parseSpecCriteria ...');
{
    const { validateEvidenceRecord, parseSpecCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    // Valid machine record.
    assert.deepStrictEqual(validateEvidenceRecord({
        criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc123',
        verifierType: 'file-exists', attestedBy: null,
    }), [], 'a well-formed machine record must produce no findings');
    // Bad verdict.
    assert.ok(validateEvidenceRecord({
        criterionId: 'ac-1', verdict: 'GREENISH', commitSha: 'abc', verifierType: 'file-exists',
    }).some(f => /verdict/i.test(f.message)), 'invalid verdict must be flagged');
    // manual without attestedBy → rejected.
    assert.ok(validateEvidenceRecord({
        criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'manual', attestedBy: null,
    }).some(f => /attestedBy/i.test(f.message)), 'manual evidence must require attestedBy');
    // non-manual with attestedBy → rejected (no human masquerading as machine).
    assert.ok(validateEvidenceRecord({
        criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'file-exists', attestedBy: 'alice',
    }).some(f => /attestedBy/i.test(f.message)), 'machine evidence must not carry attestedBy');
    // parseSpecCriteria pulls the json block under ## Acceptance Criteria.
    const specText = [
        '# Spec', '', '## Acceptance Criteria', '',
        '```json', '{ "criteria": [ { "id": "ac-x" } ] }', '```', '',
    ].join('\n');
    const parsed = parseSpecCriteria(specText);
    assert.strictEqual(parsed.error, null, 'parse must succeed');
    assert.strictEqual(parsed.criteria.length, 1, 'one criterion extracted');
    assert.strictEqual(parsed.criteria[0].id, 'ac-x', 'criterion id extracted');
    console.log('✅ T30 validateEvidenceRecord + parseSpecCriteria');
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T30 — `validateEvidenceRecord is not a function`.

- [ ] **Step 3: Implement both functions**

Append to [templates/cli/verification/validate-contract.js](../../cli/verification/validate-contract.js), before `module.exports`:

```javascript
function validateEvidenceRecord(rec) {
    const findings = [];
    const id = (rec && typeof rec.criterionId === 'string') ? rec.criterionId : '<record>';
    if (!rec || typeof rec.criterionId !== 'string' || !rec.criterionId) {
        findings.push(finding(id, 'evidence record needs a string criterionId'));
    }
    if (!rec || !SCHEMA.verdictStates.includes(rec.verdict)) {
        findings.push(finding(id, `verdict must be one of ${SCHEMA.verdictStates.join(', ')}`));
    }
    if (!rec || typeof rec.commitSha !== 'string' || !rec.commitSha) {
        findings.push(finding(id, 'evidence record needs a commitSha'));
    }
    if (!rec || !SCHEMA.verifierTypes[rec.verifierType]) {
        findings.push(finding(id, `verifierType must be a known type`));
    }
    const attested = rec && rec.attestedBy != null && rec.attestedBy !== '';
    if (rec && rec.verifierType === 'manual' && !attested) {
        findings.push(finding(id, 'manual evidence requires a non-null attestedBy'));
    }
    if (rec && rec.verifierType !== 'manual' && attested) {
        findings.push(finding(id, 'machine evidence must not carry attestedBy'));
    }
    return findings;
}

function parseSpecCriteria(specText) {
    const lines = String(specText).split(/\r?\n/);
    const headIdx = lines.findIndex(l => /^##\s+Acceptance Criteria\s*$/.test(l));
    if (headIdx === -1) {
        return { criteria: [], error: 'no "## Acceptance Criteria" heading found' };
    }
    let start = -1;
    for (let i = headIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;            // next section, no block
        if (/^```json\s*$/.test(lines[i])) { start = i + 1; break; }
    }
    if (start === -1) {
        return { criteria: [], error: 'no ```json criteria block under Acceptance Criteria' };
    }
    const end = lines.findIndex((l, i) => i >= start && /^```\s*$/.test(l));
    if (end === -1) {
        return { criteria: [], error: 'unterminated ```json block' };
    }
    try {
        const parsed = JSON.parse(lines.slice(start, end).join('\n'));
        return { criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [], error: null };
    } catch (e) {
        return { criteria: [], error: `invalid JSON in criteria block: ${e.message}` };
    }
}
```

And update the exports line:

```javascript
module.exports = { validateCriteria, validateEvidenceRecord, parseSpecCriteria, SCHEMA };
```

- [ ] **Step 4: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T30 validateEvidenceRecord + parseSpecCriteria`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/verification/validate-contract.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): validateEvidenceRecord + parseSpecCriteria"
```

---

### Task 4: `mem verify-contract lint <spec>` CLI + dogfood the phase-0 spec

**Files:**
- Create: `templates/cli/verification/commands.js`
- Modify: `templates/cli/memory.js:687-688`, `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: `parseSpecCriteria`, `validateCriteria` (Tasks 2-3).
- Produces: `registerVerificationCommands(program)` exported from `commands.js`; a `verify-contract lint <specPath>` subcommand printing findings and exiting non-zero on any error-level finding.

- [ ] **Step 1: Confirm the spec's criteria block is authored as JSON**

The phase-0 spec already carries its `## Acceptance Criteria` as a fenced ```json
`{ "criteria": [...] }` block (3 criteria). No edit needed — this step is a
precondition check: `parseSpecCriteria` (Task 3) must extract exactly those 3.

- [ ] **Step 2: Write the failing test (T31)**

Add after T30 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T31. Testing verify-contract lint validates the phase-0 spec (dogfood) ...');
{
    const { parseSpecCriteria, validateCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
    const specPath = path.join(WORKSPACE_ROOT, 'docs', 'superpowers', 'specs', '2026-06-26-verification-contract-phase0.md');
    const parsed = parseSpecCriteria(fs.readFileSync(specPath, 'utf8'));
    assert.strictEqual(parsed.error, null, 'phase-0 spec criteria block must parse');
    assert.ok(parsed.criteria.length >= 3, 'phase-0 spec must declare its own criteria');
    assert.deepStrictEqual(validateCriteria(parsed.criteria), [],
        'the phase-0 spec must satisfy its own contract (dogfood)');
    const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'commands'));
    assert.strictEqual(typeof commands.registerVerificationCommands, 'function',
        'commands.js must export registerVerificationCommands');
    console.log('✅ T31 verify-contract lint dogfood');
}
```

- [ ] **Step 3: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T31 — `Cannot find module ... verification/commands`.

- [ ] **Step 4: Implement the CLI command module**

Create [templates/cli/verification/commands.js](../../cli/verification/commands.js):

```javascript
'use strict';

const fs = require('fs');
const { parseSpecCriteria, validateCriteria } = require('./validate-contract');

function registerVerificationCommands(program) {
    const vc = program.command('verify-contract').description('Verification contract (criteria/evidence) tools.');
    vc.command('lint <spec>')
        .description('Validate a spec\'s machine-readable acceptance criteria block.')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            let text;
            try {
                text = fs.readFileSync(specPath, 'utf8');
            } catch (e) {
                console.error(`Cannot read spec: ${specPath}`);
                process.exitCode = 1;
                return;
            }
            const parsed = parseSpecCriteria(text);
            const findings = parsed.error
                ? [{ id: specPath, level: 'error', message: parsed.error }]
                : validateCriteria(parsed.criteria);
            if (options.json) {
                console.log(JSON.stringify({ criteria: parsed.criteria, findings }, null, 2));
            } else if (findings.length === 0) {
                console.log(`✅ ${parsed.criteria.length} criteria valid in ${specPath}`);
            } else {
                for (const f of findings) console.error(`[${f.level}] ${f.id}: ${f.message}`);
            }
            if (findings.some(f => f.level === 'error')) process.exitCode = 1;
        });
}

module.exports = { registerVerificationCommands };
```

- [ ] **Step 5: Mount the command + register both new files in the manifest**

In [templates/cli/memory.js:687](../../cli/memory.js) add after the architecture registration:

```javascript
    require('./verification/commands').registerVerificationCommands(program);
```

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/validate-contract.js'` line:

```javascript
            'verification/commands.js',
```

- [ ] **Step 6: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T31 verify-contract lint dogfood`.

- [ ] **Step 7: Verify the CLI end-to-end**

Run: `node ./.evo-lite/cli/memory.js verify-contract lint docs/superpowers/specs/2026-06-26-verification-contract-phase0.md`
Expected: `✅ 5 criteria valid in ...`.

- [ ] **Step 8: Run the full suite both scopes; confirm green**

Run: `node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js`
Expected: both `--- ... passed! ---`; process exits 0.

- [ ] **Step 9: Commit**

```bash
git add templates/cli/verification/commands.js templates/cli/memory.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): mem verify-contract lint + dogfood the phase-0 spec"
```

---

### Task 5: deriveVerdicts — pure four-state verdict derivation

**Files:**
- Create: `templates/cli/verification/derive-verdicts.js`
- Modify: `templates/cli/template-manifest.js`
- Test: `templates/cli/test.js`

**Interfaces:**
- Consumes: nothing (pure; caller supplies `headSha` + `changedFiles`).
- Produces: `deriveVerdicts(criteria, records, headSha, changedFiles) -> [{ criterionId, verdict, detail }]`, exported from `derive-verdicts.js`. `changedFiles` may be `null` (strict `commitSha !== headSha` fallback) or an array of repo-relative paths.

- [ ] **Step 1: Write the failing test (T32)**

Add after T31 in [templates/cli/test.js](../../cli/test.js):

```javascript
console.log('T32. Testing deriveVerdicts four-state model ...');
{
    const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
    const crit = (id, deps) => ({ id, description: 'x', dependsOn: deps, verifier: { type: 'command', params: { cmd: 'x' } } });
    const criteria = [
        crit('a', ['index.js']),                       // no record → UNVERIFIED
        crit('b', ['index.js']),                       // FAIL
        crit('c', ['index.js']),                       // machine PASS, deps untouched → PASS
        crit('d', ['templates/runtime/**']),           // machine PASS, deps changed → STALE
        { id: 'e', description: 'x', dependsOn: ['index.js'], verifier: { type: 'manual', params: { reason: 'x' } } },
    ];
    const records = [
        { criterionId: 'b', verdict: 'FAIL', commitSha: 'h', verifierType: 'command' },
        { criterionId: 'c', verdict: 'PASS', commitSha: 'h', verifierType: 'command' },
        { criterionId: 'd', verdict: 'PASS', commitSha: 'old', verifierType: 'command' },
        { criterionId: 'e', verdict: 'PASS', commitSha: 'old', verifierType: 'manual', attestedBy: 'alice' },
    ];
    const changed = ['templates/runtime/package.json'];   // matches d's glob, not c's
    const byId = Object.fromEntries(deriveVerdicts(criteria, records, 'h', changed).map(x => [x.criterionId, x.verdict]));
    assert.strictEqual(byId.a, 'UNVERIFIED', 'no record → UNVERIFIED');
    assert.strictEqual(byId.b, 'FAIL', 'recorded FAIL → FAIL');
    assert.strictEqual(byId.c, 'PASS', 'machine PASS, deps untouched → PASS');
    assert.strictEqual(byId.d, 'STALE', 'machine PASS, deps in changedFiles → STALE');
    assert.strictEqual(byId.e, 'PASS', 'manual PASS is STALE-exempt');
    // Strict fallback when changedFiles is omitted (null).
    const strict = deriveVerdicts([crit('c', ['index.js'])],
        [{ criterionId: 'c', verdict: 'PASS', commitSha: 'old', verifierType: 'command' }], 'h', null);
    assert.strictEqual(strict[0].verdict, 'STALE', 'no changedFiles + commit!=HEAD → strict STALE');
    console.log('✅ T32 deriveVerdicts');
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL at T32 — `Cannot find module ... derive-verdicts`.

- [ ] **Step 3: Implement deriveVerdicts**

Create [templates/cli/verification/derive-verdicts.js](../../cli/verification/derive-verdicts.js):

```javascript
'use strict';

// Minimal glob → RegExp: ** spans path segments, * stays within a segment.
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { re += '.*'; i++; }
            else re += '[^/]*';
        } else if ('\\^$+?.()|[]{}'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp('^' + re + '$');
}

function dependsMatches(dependsOn, changedFiles) {
    const regexes = (dependsOn || []).map(globToRegExp);
    return changedFiles.some(f => regexes.some(r => r.test(f)));
}

// Pure: no git, no verifier execution. headSha + changedFiles are supplied by the
// caller (a later phase computes changedFiles from `git diff record.commitSha..HEAD`).
function deriveVerdicts(criteria, records, headSha, changedFiles) {
    const byId = new Map();
    for (const r of (records || [])) byId.set(r.criterionId, r); // last record wins
    return (criteria || []).map(c => {
        const rec = byId.get(c.id);
        if (!rec) return { criterionId: c.id, verdict: 'UNVERIFIED', detail: 'no evidence record' };
        if (rec.verdict === 'FAIL') return { criterionId: c.id, verdict: 'FAIL', detail: rec.detail || 'recorded FAIL' };
        if (rec.verdict !== 'PASS') return { criterionId: c.id, verdict: 'UNVERIFIED', detail: `raw verdict ${rec.verdict}` };
        if (rec.verifierType === 'manual') {
            return { criterionId: c.id, verdict: 'PASS', detail: 'manual attestation (STALE-exempt)' };
        }
        if (changedFiles == null) {
            return rec.commitSha !== headSha
                ? { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} != HEAD ${headSha}` }
                : { criterionId: c.id, verdict: 'PASS', detail: 'commit matches HEAD' };
        }
        return dependsMatches(c.dependsOn, changedFiles)
            ? { criterionId: c.id, verdict: 'STALE', detail: 'dependsOn changed since evidence' }
            : { criterionId: c.id, verdict: 'PASS', detail: 'dependsOn unchanged' };
    });
}

module.exports = { deriveVerdicts, globToRegExp };
```

- [ ] **Step 4: Register the module in the template manifest**

In [templates/cli/template-manifest.js](../../cli/template-manifest.js), add after the `'verification/commands.js'` line:

```javascript
            'verification/derive-verdicts.js',
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T32 deriveVerdicts`.

- [ ] **Step 6: Run the full suite both scopes; confirm green**

Run: `node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js`
Expected: both `--- ... passed! ---`; process exits 0.

- [ ] **Step 7: Commit**

```bash
git add templates/cli/verification/derive-verdicts.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/
git commit -m "feat(verification): deriveVerdicts — pure four-state verdict derivation"
```

---

## Self-Review

**1. Spec coverage:**
- Deliverable 1 `contract-schema.json` (closed enum + verdict states + per-type params) → Task 1.
- Deliverable 2 validators (`validateCriteria`, `validateEvidenceRecord`, `parseSpecCriteria`; ids unique, type in enum, required params, `dependsOn` non-empty, verdict enum, `manual`⇔`attestedBy`) → Tasks 2-3.
- Deliverable 3 pure `deriveVerdicts` (UNVERIFIED/FAIL/PASS/STALE, dependsOn∩changedFiles, manual STALE-exempt, strict fallback) → Task 5.
- Deliverable 4 `mem verify-contract lint` + dogfood (spec validates against its own 5-criteria block) → Task 4.
- `command|file-exists|file-absent|json-path-equals|manual` closed enum → Task 1 asset, enforced in Task 2.
- Orthogonality / "no verifier execution / no git inside / no mem close" → Global Constraints; `deriveVerdicts` takes `headSha`+`changedFiles` as inputs (no git call).

**2. Placeholder scan:** none — every step has concrete code/commands.

**3. Type consistency:** `validateCriteria`, `validateEvidenceRecord`, `parseSpecCriteria`, `deriveVerdicts`, `registerVerificationCommands`, `SCHEMA.verifierTypes`/`verdictStates` are consistent across Tasks 1-5. Finding shape `{ id, level, message }` and verdict shape `{ criterionId, verdict, detail }` are uniform. The schema asset's `requiredParams`/`optionalParams` keys match the validator's reads. `command` params use `cmd`, `manual` uses `reason` — matching the asset in Task 1.

**Note (deferred to later phase, per spec scope):** computing `changedFiles` from `git diff`, *writing* evidence records by running verifiers, and `mem close` are intentionally NOT in this plan — Phase 0 ships shape validation + pure derivation only.
