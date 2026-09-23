---
id: plan:record-only-closure-terminal-state
status: draft
created: 2026-09-08
linkedSpec: spec:record-only-closure-terminal-state
---

# Record-Only Closure Terminal State + Portfolio Finding Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third terminal spec state, `closed-record-only`, for work that is genuinely finished but has no machine-executable acceptance contract — and fix the two portfolio finding-layer defects (`zombie-plan` deadlock, `size-exceeded` state blindness) that share the same file.

**Architecture:** All production change lands in `templates/cli/spec-portfolio.js` plus four narrowly-scoped edits elsewhere: `disposition/fingerprint.js` (set canonicalization vocabulary), `memory.service.js` (portfolio bucket counts), `release-preflight.js` (remediation text only), and an import of `verification/validate-contract.js` (never modified). Pure predicates are built and tested first, then wired into registry derivation, so no task ever leaves a half-derived state.

**Tech Stack:** Node.js (CommonJS), zero new dependencies. Tests in `templates/cli/test/governance.js` (`assert` + `createTempRuntimeRoot` + `writeText`, same pattern as the existing `T-spec-portfolio` family).

**Specs:** This plan implements **two** specs and is declared as `linkedPlan` by both:
- `docs/superpowers/specs/2026-09-08-record-only-closure-terminal-state-design.md` (`spec:record-only-closure-terminal-state`) — Tasks 1–6
- `docs/superpowers/specs/2026-09-08-portfolio-finding-correctness-design.md` (`spec:portfolio-finding-correctness`) — Task 7

Task 8 completes integrated implementation **verification** for both specs. **Actual spec closure happens only after independent implementation review — no task in this plan may set either spec to `done`.** Read both specs before starting; the ownership boundary between them is normative, and a change made in the wrong file is a review failure even when the behaviour is right.

## Global Constraints

- **Never edit `.evo-lite/cli/**` directly.** It is a mirror. Edit `templates/cli/**` and refresh with `node .evo-lite/cli/memory.js sync-runtime` (Task 8).
- **`verification/validate-contract.js` is imported, never modified.** It is the canonical contract parser and validator. Re-implementing structural validity inside `spec-portfolio.js` is prohibited.
- **`validateCriteria(criteria)` judges contract validity as a whole. `validateCriteria([c])` is a DENY-only probe** — a singleton PASS may refuse eligibility; a singleton FAIL may never grant it. Never derive per-criterion executability by matching whole-array findings back to criterion identity: `validateCriteria` reports a duplicate id against the id itself with no positional component, so that mapping tars both criteria sharing an id, including the valid one.
- **Set canonicalization belongs to `disposition/fingerprint.js`.** Every set-valued `factInputs` key must be added to its `SET_KEYS`. Sorting locally in `spec-portfolio.js` is prohibited.
- **Rule versions are fixed by `spec:disposition-ledger` §2.3, not by the implementer:** `invalid-record-only-closure@1`, `zombie-plan@2`, `size-exceeded@2`.
- **Ownership boundary:** size actionability for *every* state — including `closed-record-only` — is decided only by `SIZE_ACTIONABLE_STATES` in Task 7. Do not restate it in the record-only tasks.
- **Existing thresholds are unchanged:** `SIZE_THRESHOLDS = { acCount: 8, phaseCount: 3, dependsOnCount: 12, chars: 40000 }`, `DEFAULT_AGING_DAYS = 14`.
- **Test command for Tasks 1–7: `node ./templates/cli/test.js governance`.** Not the
  `.evo-lite/cli/` one. Both runners load `./test/governance` *relative to
  themselves*, so `.evo-lite/cli/test.js` runs the MIRROR copy — and the mirror is
  not refreshed until Task 8. Running it would execute stale tests against stale
  code, and every RED/GREEN step in Tasks 1–7 would be meaningless. Verified: the
  canonical runner resolves `commander` and `@zvec/zvec` from the repository-root
  `node_modules`, so it runs standalone.
- The suite takes 3–5 minutes. It is not hanging.
- **Exit code still decides, with exactly one narrow amnesty.** Measured on this
  Windows worktree: a fully green run (3940 lines, 399 `✅`, zero
  `AssertionError`, `--- Governance-focused CLI tests passed! ---`) still exited
  **1**, because the temp-cleanup epilogue hits `EBUSY` unlinking a fixture's
  `memory.db` whose sqlite handle was left open. So:
  - `exit 0` → GREEN under the normal conditions.
  - `exit != 0` → **FAIL**, unless *all four* hold: (1) the step's own
    `✅ T-... passed` line is present, (2) the suite banner
    `--- Governance-focused CLI tests passed! ---` is present, (3) there is no
    test error or stack trace of any kind — not just no `AssertionError`, since a
    `TypeError` in a later test also exits non-zero without one, and (4) the sole
    non-zero cause matches the known epilogue, `temp cleanup failed ... EBUSY ...
    memory.db`. Any other non-zero exit is a real failure.
  This is an amnesty for one identified cleanup defect, not a licence to stop
  reading the exit code.

---

### Task 1: `contractVisibilityDigest` + the eligibility predicate

**Files:**
- Modify: `templates/cli/spec-portfolio.js` (new exported pure functions, near `extractLastCriteriaArray` at ~line 340)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `parseSpecCriteria`, `validateCriteria` from `./verification/validate-contract` (already exported there).
- Produces:
  - `contractVisibilityDigest(criterion) -> string` — `'sha256:' + hex`
  - `visibilityProjection(criteria) -> string[]` — sorted digests
  - `evaluateRecordOnlyEligibility(specText) -> { eligible, visibilityAgrees, authority, corroboration, locallyExecutable, aggregateFindings }`

- [ ] **Step 1: Write the failing test**

Add inside `runGovernanceTests()` in `templates/cli/test/governance.js`, after the `T-spec-portfolio-size` block:

```js
console.log('T-record-only-eligibility. Testing the record-only eligibility hard gate ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    assert.strictEqual(typeof sp.evaluateRecordOnlyEligibility, 'function',
        'evaluateRecordOnlyEligibility must be exported');
    assert.strictEqual(typeof sp.contractVisibilityDigest, 'function',
        'contractVisibilityDigest must be exported');

    const VALID = { id: 'V', description: 'd', dependsOn: ['x.js'], verifier: { type: 'file-exists', params: { path: 'x.js' } } };
    const INVALID = { id: 'I' };
    const spec = (heading, first, extra) => [
        '---', 'id: spec:t', 'status: draft', '---', '', '# T', '',
        heading, '', '```json', JSON.stringify({ criteria: first }, null, 2), '```', '',
    ].concat(extra ? ['## Appendix', '', '```json', JSON.stringify({ criteria: extra }, null, 2), '```', ''] : []).join('\n');

    // (e) genuinely contractless, and all-criteria-invalid: both ELIGIBLE
    assert.strictEqual(sp.evaluateRecordOnlyEligibility(
        ['---', 'id: spec:t', 'status: draft', '---', '', '# T', ''].join('\n')).eligible, true,
        'NO-CONTRACT must be eligible');
    assert.strictEqual(sp.evaluateRecordOnlyEligibility(
        spec('## Acceptance Criteria', [INVALID])).eligible, true,
        'all-criteria-invalid must be eligible');

    // (a) a valid contract is INELIGIBLE regardless of evidence
    assert.strictEqual(sp.evaluateRecordOnlyEligibility(
        spec('## Acceptance Criteria', [VALID])).eligible, false,
        'a valid contract must never be eligible');

    // (a2) structural evidence-independence: the gate is a pure function of the
    // spec text and has no project root to read an evidence store from. Writing
    // evidence here and asserting against this function would prove nothing —
    // there is no path between them. The real five-state matrix runs end-to-end
    // through buildSpecRegistry in Task 4.
    assert.strictEqual(sp.evaluateRecordOnlyEligibility.length, 1,
        'eligibility takes spec text only — no project root, so no evidence path');

    // (b) duplicate-id inverse escape: two VALID criteria sharing one id
    const dup = sp.evaluateRecordOnlyEligibility(
        spec('## Acceptance Criteria', [VALID, Object.assign({}, VALID)]));
    assert.strictEqual(dup.locallyExecutable.length, 2,
        'both duplicated criteria are independently executable');
    assert.strictEqual(dup.eligible, false,
        'duplicate-id must NOT unlock record-only closure');

    // (c) appending one broken criterion to a valid contract
    assert.strictEqual(sp.evaluateRecordOnlyEligibility(
        spec('## Acceptance Criteria', [VALID, INVALID])).eligible, false,
        'appending a broken criterion must not unlock eligibility');

    // (d1) visibility, unequal: numbered heading hides the contract from the authority
    const numbered = sp.evaluateRecordOnlyEligibility(spec('## 10. Acceptance Criteria', [VALID]));
    assert.strictEqual(numbered.authority.length, 0, 'authority sees nothing under a numbered heading');
    assert.strictEqual(numbered.corroboration.length, 1, 'corroborator still sees the block');
    assert.strictEqual(numbered.visibilityAgrees, false, 'unequal visibility must disagree');
    assert.strictEqual(numbered.eligible, false, 'visibility discrepancy must deny');

    // (d2) visibility, EQUAL COUNT, different content
    const equalCount = sp.evaluateRecordOnlyEligibility(
        spec('## Acceptance Criteria', [INVALID], [VALID]));
    assert.strictEqual(equalCount.authority.length, 1, 'authority sees the heading block');
    assert.strictEqual(equalCount.corroboration.length, 1, 'corroborator sees the later block');
    assert.strictEqual(equalCount.visibilityAgrees, false,
        'equal count with different content must still disagree — emptiness parity is not enough');
    assert.strictEqual(equalCount.eligible, false, 'equal-count discrepancy must deny');

    // (d1) against the REAL corpus, scanned dynamically rather than hard-coded.
    // Expected to be deliberately removed when the numbered-heading parser defect
    // is fixed; until then the containment must hold on every divergent spec.
    let divergent = 0;
    for (const dir of [path.join(WORKSPACE_ROOT, 'docs', 'specs'),
                       path.join(WORKSPACE_ROOT, 'docs', 'superpowers', 'specs')]) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.md'))) {
            const r = sp.evaluateRecordOnlyEligibility(fs.readFileSync(path.join(dir, name), 'utf8'));
            if (!r.visibilityAgrees) {
                divergent += 1;
                assert.strictEqual(r.eligible, false, `${name}: visibility discrepancy must deny`);
            }
        }
    }
    assert.ok(divergent > 0,
        'the corpus still carries the known parser divergence this gate contains');

    // description is part of visibility even though criterionDigest excludes it
    const a = Object.assign({}, VALID, { description: '' });
    assert.notStrictEqual(sp.contractVisibilityDigest(a), sp.contractVisibilityDigest(VALID),
        'contractVisibilityDigest must see description');
    // authored payloads that a truthiness default would collapse must stay distinct
    assert.notStrictEqual(sp.contractVisibilityDigest(null), sp.contractVisibilityDigest({}),
        'null and {} are different authored payloads');
    for (const v of [false, 0, '']) {
        assert.notStrictEqual(sp.contractVisibilityDigest(v), sp.contractVisibilityDigest({}),
            `${JSON.stringify(v)} must not collapse into {}`);
    }
    // order-insensitive projection
    assert.deepStrictEqual(sp.visibilityProjection([VALID, INVALID]),
        sp.visibilityProjection([INVALID, VALID]),
        'visibilityProjection must be order-insensitive');
}
console.log('✅ T-record-only-eligibility passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `evaluateRecordOnlyEligibility must be exported`

- [ ] **Step 3: Write the implementation**

In `templates/cli/spec-portfolio.js`, add `crypto` to the requires at the top and the canonical validator import:

```js
const crypto = require('crypto');
const { parseSpecCriteria, validateCriteria } = require('./verification/validate-contract');
```

Then, immediately after `extractLastCriteriaArray`:

```js
// Visibility identity. Deliberately NOT criterionDigest: that digest covers
// verification semantics only (id, verifier, dependsOn) and excludes
// `description` on purpose, yet validateCriteria REQUIRES a non-empty
// description — so two criteria differing only there are one valid and one
// invalid under an identical criterionDigest. For this gate that difference is
// the whole question, so visibility hashes the complete authored payload.
function canonicalizeCriterion(value) {
    if (Array.isArray(value)) return value.map(canonicalizeCriterion);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = canonicalizeCriterion(value[k]);
        return out;
    }
    return value;
}

function contractVisibilityDigest(criterion) {
    // NO `criterion || {}`. JSON can legitimately produce null, false, 0 and "",
    // and a truthiness default collapses all four into `{}` — two parsers that
    // observed DIFFERENT authored payloads would then project identically, which
    // is exactly the disagreement this gate must fail closed on. `undefined`
    // needs no handling: a JSON parser cannot produce it.
    const payload = JSON.stringify(canonicalizeCriterion(criterion));
    return 'sha256:' + crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function visibilityProjection(criteria) {
    return (criteria || []).map(contractVisibilityDigest).sort();
}

// The first hard gate. Protects the verification system itself, not the release
// gate: only NO-CONTRACT and INVALID may enter record-only closure.
// UNVERIFIED / STALE / FAIL / PASS all mean "criteria present AND structurally
// valid" and differ only in evidence, which is never consulted here.
function evaluateRecordOnlyEligibility(specText) {
    const authority = (parseSpecCriteria(specText) || {}).criteria || [];
    const corroboration = extractLastCriteriaArray(specText);

    const aggregateFindings = validateCriteria(authority);
    // DENY-only probe. A singleton PASS proves a self-contained executable
    // acceptance assertion exists and refuses eligibility. A singleton FAIL
    // proves nothing alone and defers to the aggregate. Singleton constraints
    // are a strict subset of whole-array constraints, so this can only ever
    // deny, never grant.
    const locallyExecutable = authority.filter(c => validateCriteria([c]).length === 0);

    const visibilityAgrees =
        JSON.stringify(visibilityProjection(authority)) ===
        JSON.stringify(visibilityProjection(corroboration));

    // The CONTRACT-side violation, computed independently of visibility so that
    // both can be reported at once. A spec is ineligible when it has an
    // independently executable criterion, or a non-empty contract the authority
    // considers wholly valid.
    const ineligible = locallyExecutable.length > 0
        || (authority.length > 0 && aggregateFindings.length === 0);

    const eligible = visibilityAgrees && !ineligible;

    return { eligible, ineligible, visibilityAgrees, authority, corroboration, locallyExecutable, aggregateFindings };
}
```

Add all three to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-record-only-eligibility passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): record-only eligibility gate with visibility containment"
```

---

### Task 2: Closure record parser

**Files:**
- Modify: `templates/cli/spec-portfolio.js` (next to `parseReleaseWaiver`, ~line 1070)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Produces: `parseClosureRecord(frontmatter) -> { present: boolean, valid: boolean, errors: string[], invalidFields: string[] }`
- `invalidFields` is the sorted list of offending field names, used as `factInputs` in Task 4.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-closure-record. Testing the record-only closure credential parser ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    assert.strictEqual(typeof sp.parseClosureRecord, 'function', 'parseClosureRecord must be exported');

    const good = { closureBasis: 'record-only', closureReason: 'merged pre-contract', closureRecordedAt: '2026-09-08' };
    assert.strictEqual(sp.parseClosureRecord(good).valid, true, 'a complete record is valid');
    assert.deepStrictEqual(sp.parseClosureRecord(good).invalidFields, [], 'a complete record has no invalid fields');

    assert.strictEqual(sp.parseClosureRecord({}).present, false, 'absent record is not present');
    assert.strictEqual(sp.parseClosureRecord({}).valid, false, 'absent record is not valid');

    for (const field of ['closureBasis', 'closureReason', 'closureRecordedAt']) {
        const partial = Object.assign({}, good);
        delete partial[field];
        const r = sp.parseClosureRecord(partial);
        assert.strictEqual(r.valid, false, `omitting ${field} alone must invalidate`);
        assert.ok(r.invalidFields.includes(field), `invalidFields must name ${field}`);
    }

    assert.strictEqual(sp.parseClosureRecord(Object.assign({}, good, { closureBasis: 'waived' })).valid, false,
        'closureBasis is a closed enum');
    assert.strictEqual(sp.parseClosureRecord(Object.assign({}, good, { closureReason: '   ' })).valid, false,
        'closureReason must be non-empty after trim');
    assert.strictEqual(sp.parseClosureRecord(Object.assign({}, good, { closureRecordedAt: '2026-99-99' })).valid, false,
        'closureRecordedAt must round-trip as a real date');

    // A closure record is NOT a release waiver, and vice versa.
    assert.strictEqual(sp.parseClosureRecord({
        releaseBlockDisposition: 'waived', releaseBlockReason: 'r', releaseBlockReviewedAt: '2026-09-08',
    }).present, false, 'a release waiver does not satisfy the closure record');
}
console.log('✅ T-closure-record passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `parseClosureRecord must be exported`

- [ ] **Step 3: Write the implementation**

Add next to `parseReleaseWaiver` in `templates/cli/spec-portfolio.js`. It reuses the *validation pattern* of the waiver — closed enum, non-empty text, round-trippable date — with its own field names, parser and errors. Neither credential implies the other.

```js
const CLOSURE_FIELDS = Object.freeze(['closureBasis', 'closureReason', 'closureRecordedAt']);

function parseClosureRecord(frontmatter) {
    const fm = frontmatter || {};
    const present = CLOSURE_FIELDS.some(f => fm[f] !== undefined && fm[f] !== null);
    const errors = [];
    const invalidFields = [];

    if (fm.closureBasis !== 'record-only') {
        invalidFields.push('closureBasis');
        errors.push(`closureBasis must be exactly \`record-only\`, unquoted (closed enum); got ${fm.closureBasis === undefined ? '<missing>' : `\`${fm.closureBasis}\``}`);
    }
    if (fm.closureReason === undefined || fm.closureReason === null || String(fm.closureReason).trim() === '') {
        invalidFields.push('closureReason');
        errors.push('closureReason must be present and non-empty after trim');
    }
    if (fm.closureRecordedAt === undefined || fm.closureRecordedAt === null || !isRoundTripDate(String(fm.closureRecordedAt))) {
        invalidFields.push('closureRecordedAt');
        errors.push(`closureRecordedAt must be a real YYYY-MM-DD date that survives a round-trip; got ${fm.closureRecordedAt === undefined ? '<missing>' : `\`${fm.closureRecordedAt}\``}`);
    }

    return { present, valid: errors.length === 0, errors, invalidFields: invalidFields.sort() };
}
```

Add `parseClosureRecord` and `CLOSURE_FIELDS` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-closure-record passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): closure record credential, independent of the release waiver"
```

---

### Task 3: State vocabulary, `baseState`, counts, registry `@3`

**Files:**
- Modify: `templates/cli/spec-portfolio.js` — `RECOGNIZED_SPEC_STATUSES` (~line 20), state derivation (~line 528), registry version (~line 638), `formatPortfolioReport` counts (~line 1109)
- Modify: `templates/cli/memory.service.js:3376-3382` (portfolio buckets)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `evaluateRecordOnlyEligibility` (Task 1), `parseClosureRecord` (Task 2)
- Produces: `state === 'closed-record-only'`; registry entry fields `recordOnly: { declared, eligible, visibilityAgrees, recordValid, locallyExecutableDigests, invalidClosureFields, authorityDigests, corroborationDigests }` — digest projections, never counts; `registry.version === 'evo-spec-registry@3'`

- [ ] **Step 1: Write the failing test**

```js
console.log('T-record-only-state. Testing closed-record-only derivation, counts and schema version ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const runtime = createTempRuntimeRoot('record-only-state');
    const projectRoot = runtime.workspaceRoot;
    const REC = ['closureBasis: record-only', 'closureReason: merged before contracts existed', 'closureRecordedAt: 2026-09-08'];

    // valid: NO-CONTRACT + complete record, with a linked plan (so baseState would be `active`)
    writeText(path.join(projectRoot, 'docs', 'specs', 'ok-nocontract.md'),
        ['---', 'id: spec:ok1', 'status: closed-record-only', 'linkedPlan: plan:p1'].concat(REC, ['---', '', '# OK1', '']).join('\n'));

    // valid: INVALID contract + complete record
    writeText(path.join(projectRoot, 'docs', 'specs', 'ok-invalid.md'),
        ['---', 'id: spec:ok2', 'status: closed-record-only'].concat(REC, ['---', '', '# OK2', '',
            '## Acceptance Criteria', '', '```json', '{ "criteria": [ { "id": "x" } ] }', '```', '']).join('\n'));

    // rejected: ineligible (valid contract), with linked plan -> baseState active
    writeText(path.join(projectRoot, 'docs', 'specs', 'bad-eligible.md'),
        ['---', 'id: spec:bad1', 'status: closed-record-only', 'linkedPlan: plan:p2'].concat(REC, ['---', '', '# BAD1', '',
            '## Acceptance Criteria', '', '```json',
            JSON.stringify({ criteria: [{ id: 'V', description: 'd', dependsOn: ['x.js'], verifier: { type: 'file-exists', params: { path: 'x.js' } } }] }),
            '```', '']).join('\n'));

    // rejected: record incomplete, no linked plan -> baseState adopted
    writeText(path.join(projectRoot, 'docs', 'specs', 'bad-record.md'),
        ['---', 'id: spec:bad2', 'status: closed-record-only', 'closureBasis: record-only', '---', '', '# BAD2', ''].join('\n'));

    writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
        version: 'evo-plan-ir@1', specs: [], tasks: [], warnings: [],
        plans: [
            { id: 'plan:p1', status: 'active', linkedSpec: 'spec:ok1', sourcePath: 'docs/plans/p1.md' },
            { id: 'plan:p2', status: 'active', linkedSpec: 'spec:bad1', sourcePath: 'docs/plans/p2.md' },
        ],
    }, null, 2));

    const reg = sp.buildSpecRegistry(projectRoot, { write: false });
    const by = id => reg.specs.find(s => s.id === id);

    assert.strictEqual(reg.version, 'evo-spec-registry@3', 'registry schema version must bump to @3');
    assert.strictEqual(by('spec:ok1').state, 'closed-record-only', 'NO-CONTRACT + valid record is terminal');
    assert.strictEqual(by('spec:ok2').state, 'closed-record-only', 'INVALID contract + valid record is terminal');
    assert.strictEqual(by('spec:bad1').state, 'active', 'ineligible declaration derives baseState (linkedPlans present)');
    assert.strictEqual(by('spec:bad2').state, 'adopted', 'record-incomplete declaration derives baseState (no linkedPlans)');
    for (const id of ['spec:bad1', 'spec:bad2']) {
        assert.notStrictEqual(by(id).state, 'closed-record-only', `${id} must not reach the terminal state`);
        assert.notStrictEqual(by(id).state, 'shipped', `${id} must not be counted as shipped`);
    }

    // recognized vocabulary: no unknown-status on a correctly spelled declaration
    for (const id of ['spec:ok1', 'spec:ok2', 'spec:bad1', 'spec:bad2']) {
        assert.ok(!by(id).warnings.includes('unknown-status'), `${id} must not raise unknown-status`);
    }
    // terminal privileges: neither open nor parked, so no aging and no zombie branch
    for (const w of ['aging-no-plan', 'aging-inactive', 'zombie-plan']) {
        assert.ok(!by('spec:ok1').warnings.includes(w), `a valid record-only spec must not emit ${w}`);
    }

    const lines = sp.formatPortfolioReport(reg);
    assert.ok(lines[0].includes('recordClosed=2'), 'counts must report recordClosed as its own column');
    assert.ok(/shipped=0/.test(lines[0]), 'recordClosed must never be folded into shipped');

    // memory.service must expose the bucket in its report OBJECT, not only in prose:
    // a closed-record-only spec previously fell into none of the four hard-coded
    // filters and vanished from the report entirely.
    const memoryService = require(path.join(TEMPLATE_CLI_DIR, 'memory.service'));
    const prevRoot = process.env.EVO_LITE_ROOT;
    process.env.EVO_LITE_ROOT = path.join(projectRoot, '.evo-lite');
    try {
        const report = await memoryService.verify({ silent: true });
        assert.ok(report.specPortfolio && 'recordClosed' in report.specPortfolio,
            'report.specPortfolio must expose recordClosed');
        assert.strictEqual(report.specPortfolio.recordClosed, 2, 'both valid specs are counted');
        assert.strictEqual(report.specPortfolio.shipped, 0, 'never folded into shipped');
    } finally {
        if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT;
        else process.env.EVO_LITE_ROOT = prevRoot;
    }
}
console.log('✅ T-record-only-state passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `registry schema version must bump to @3`

- [ ] **Step 3: Write the implementation**

In `templates/cli/spec-portfolio.js`:

```js
const RECOGNIZED_SPEC_STATUSES = Object.freeze(new Set([
    'done', 'parked', 'adopted', 'active', 'draft', 'closed-record-only',
]));
```

Replace the state-derivation block in `buildSpecRegistry` (currently `if (status === 'done') { ... } else if (status === 'parked') { ... } else if (linkedPlans.length === 0) { ... } else { ... }`) with an explicit helper plus derivation. `baseState` MUST be a named function, never the residue of an if/else chain — the failure mode designed against is a future branch reorder quietly turning an invalid declaration into a terminal one.

```js
// baseState never consults any terminal declaration.
const baseState = () => (linkedPlans.length > 0 ? 'active' : 'adopted');

const recordOnlyDeclared = status === 'closed-record-only';
const eligibility = recordOnlyDeclared
    ? evaluateRecordOnlyEligibility(content)
    : null;
const closureRecord = recordOnlyDeclared ? parseClosureRecord(frontmatter) : null;
const recordOnlyValid = recordOnlyDeclared && eligibility.eligible && closureRecord.valid;

let state;
if (status === 'done') {
    state = 'shipped';
} else if (status === 'parked') {
    state = 'parked';
    if (linkedPlans.length > 0 && zombieRelevantPlans.length > 0) warnings.push('zombie-plan');
} else if (recordOnlyDeclared && recordOnlyValid) {
    state = 'closed-record-only';
} else {
    state = baseState();
    if (linkedPlans.length === 0) {
        if (idleDays > agingDays) warnings.push('aging-no-plan');
    } else if (anyPlanNotDone && idleDays > agingDays) {
        warnings.push('aging-inactive');
    }
}
```

> Until Task 7 lands, `zombieRelevantPlans` does not exist. For this task only, keep the parked branch reading `anyPlanNotDone` exactly as it does today and change it in Task 7. Do not anticipate Task 7 here — the two changes are owned by different specs and must be reviewable apart.

Add the derived record to the pushed spec entry:

```js
recordOnly: recordOnlyDeclared ? {
    declared: true,
    eligible: eligibility.eligible,
    visibilityAgrees: eligibility.visibilityAgrees,
    recordValid: closureRecord.valid,
    locallyExecutableDigests: eligibility.locallyExecutable.map(criterionDigest).sort(),
    invalidClosureFields: closureRecord.invalidFields,
    authorityDigests: visibilityProjection(eligibility.authority),
    corroborationDigests: visibilityProjection(eligibility.corroboration),
} : null,
```

Import `criterionDigest` alongside the other validator functions. Bump the registry version:

```js
const registry = {
    // Bumped from @2: the `state` enum gained `closed-record-only` and entries
    // gained record-only derived fields. A consumer that keys on the version
    // must be told the difference; fixing every KNOWN internal consumer does
    // not make the machine contract unchanged.
    version: 'evo-spec-registry@3',
```

In `formatPortfolioReport`, add the column:

```js
const counts = { adopted: 0, active: 0, parked: 0, shipped: 0, recordClosed: 0 };
...
if (spec.state === 'closed-record-only') counts.recordClosed += 1;
else if (counts[spec.state] !== undefined) counts[spec.state] += 1;
...
`📋 [Spec Portfolio]: adopted=${counts.adopted} active=${counts.active} parked=${counts.parked} shipped=${counts.shipped} recordClosed=${counts.recordClosed}`,
```

In `templates/cli/memory.service.js`, extend the four hard-coded buckets at lines 3376–3382 — a `closed-record-only` spec currently falls into none and vanishes from the report:

```js
report.specPortfolio = {
    adopted: registry.specs.filter(s => s.state === 'adopted').length,
    active: registry.specs.filter(s => s.state === 'active').length,
    parked: registry.specs.filter(s => s.state === 'parked').length,
    shipped: registry.specs.filter(s => s.state === 'shipped').length,
    recordClosed: registry.specs.filter(s => s.state === 'closed-record-only').length,
    warnings: registry.specs.reduce((n, s) => n + (s.warnings ? s.warnings.length : 0), 0),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-record-only-state passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/memory.service.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): closed-record-only state, recordClosed counts, registry @3"
```

---

### Task 4: Violation findings, `factInputs`, set canonicalization

**Files:**
- Modify: `templates/cli/spec-portfolio.js` — `SPEC_RULE_VERSIONS` (~line 24), `buildSpecFindings` (~line 33), warnings push in `buildSpecRegistry`
- Modify: `templates/cli/disposition/fingerprint.js` — `SET_KEYS`
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: the `recordOnly` entry field from Task 3.
- Produces: findings `invalid-record-only-closure:<ineligible|contract-visibility-discrepancy|record-incomplete>` at `ruleVersion` 1.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-record-only-findings. Testing violation findings, factInputs and canonicalization ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const { SET_KEYS, computeFingerprint } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));

    for (const k of ['locallyExecutableCriterionDigests', 'invalidClosureFields',
                     'authorityContractDigests', 'corroborationContractDigests']) {
        assert.ok(SET_KEYS.includes(k), `${k} must be a canonical SET_KEY, not sorted locally`);
    }
    assert.strictEqual(sp.SPEC_RULE_VERSIONS['invalid-record-only-closure'], 1,
        'invalid-record-only-closure is a new rule at version 1');

    // order-insensitivity through the real fingerprint authority
    const fp = arr => computeFingerprint({
        ruleId: 'invalid-record-only-closure', ruleVersion: 1,
        factInputs: { locallyExecutableCriterionDigests: arr },
    });
    assert.strictEqual(fp(['a', 'b']), fp(['b', 'a']),
        'set-valued factInputs must be order-insensitive');
    assert.notStrictEqual(fp(['a', 'b']), fp(['a', 'c']),
        'changing which criteria are executable must move the fingerprint');

    const runtime = createTempRuntimeRoot('record-only-findings');
    const projectRoot = runtime.workspaceRoot;
    const VALID = { id: 'V', description: 'd', dependsOn: ['x.js'], verifier: { type: 'file-exists', params: { path: 'x.js' } } };

    // A genuine TRIPLE violation. A numbered heading would NOT produce one: it
    // empties the authority, so locallyExecutable is 0 and `ineligible` is never
    // established. Instead give the authority a valid contract (=> ineligible),
    // put a DIFFERENT contract in a later block so the two parsers disagree
    // (=> visibility discrepancy), and omit the closure record entirely.
    const OTHER = { id: 'W', description: 'other', dependsOn: ['y.js'], verifier: { type: 'file-exists', params: { path: 'y.js' } } };
    writeText(path.join(projectRoot, 'docs', 'specs', 'triple.md'),
        ['---', 'id: spec:triple', 'status: closed-record-only', '---', '', '# T', '',
         '## Acceptance Criteria', '', '```json', JSON.stringify({ criteria: [VALID] }), '```', '',
         '## Appendix', '', '```json', JSON.stringify({ criteria: [OTHER] }), '```', ''].join('\n'));

    const reg = sp.buildSpecRegistry(projectRoot, { write: false });
    const entry = reg.specs.find(s => s.id === 'spec:triple');
    const ids = (entry.findings || []).map(f => f.id);

    for (const key of ['ineligible', 'contract-visibility-discrepancy', 'record-incomplete']) {
        assert.ok(ids.includes(`invalid-record-only-closure:spec:triple:${key}`),
            `must emit ${key}; got ${ids.join(', ')}`);
    }
    assert.strictEqual(ids.length, 3,
        'all three violations report independently — none short-circuits another');
    assert.notStrictEqual(entry.state, 'closed-record-only', 'a rejected declaration is not terminal');

    const vis = entry.findings.find(f => f.id.endsWith(':contract-visibility-discrepancy'));
    assert.ok(Array.isArray(vis.factInputs.authorityContractDigests),
        'visibility factInputs carry digests');
    assert.ok(Array.isArray(vis.factInputs.corroborationContractDigests),
        'visibility factInputs carry both sides');
    assert.ok(!('authorityCriterionCount' in vis.factInputs),
        'counts must NOT be the visibility identity — equal-size different-content would stay CURRENT');

    const rec = entry.findings.find(f => f.id.endsWith(':record-incomplete'));
    assert.deepStrictEqual(rec.factInputs.invalidClosureFields,
        ['closureBasis', 'closureReason', 'closureRecordedAt'],
        'record-incomplete names the offending fields, sorted');

    // Sensitivity, all three directions the frozen AC names.
    const fpOf = f => computeFingerprint({ ruleId: f.ruleId, ruleVersion: f.ruleVersion, factInputs: f.factInputs });

    // (i) equal-count authored change moves the discrepancy fingerprint
    const before = fpOf(vis);
    writeText(path.join(projectRoot, 'docs', 'specs', 'triple.md'),
        ['---', 'id: spec:triple', 'status: closed-record-only', '---', '', '# T', '',
         '## Acceptance Criteria', '', '```json', JSON.stringify({ criteria: [VALID] }), '```', '',
         '## Appendix', '', '```json',
         JSON.stringify({ criteria: [Object.assign({}, OTHER, { description: 'changed' })] }),
         '```', ''].join('\n'));
    const after = fpOf(sp.buildSpecRegistry(projectRoot, { write: false })
        .specs.find(x => x.id === 'spec:triple').findings
        .find(f => f.id.endsWith(':contract-visibility-discrepancy')));
    assert.notStrictEqual(before, after,
        'equal-count authored content change must move the discrepancy fingerprint');

    // (ii) fixing one closure field while another stays bad moves record-incomplete
    const recFp = fm => {
        writeText(path.join(projectRoot, 'docs', 'specs', 'partial.md'),
            ['---', 'id: spec:partial', 'status: closed-record-only'].concat(fm, ['---', '', '# P', '']).join('\n'));
        return fpOf(sp.buildSpecRegistry(projectRoot, { write: false })
            .specs.find(x => x.id === 'spec:partial').findings
            .find(f => f.id.endsWith(':record-incomplete')));
    };
    assert.notStrictEqual(
        recFp(['closureReason: r']),
        recFp(['closureReason: r', 'closureBasis: record-only']),
        'fixing one field while another stays invalid must move the fingerprint');

    // Evidence-independence, END TO END through the registry, which is where the
    // frozen AC lives. Same project, same spec, same complete closure record;
    // only the evidence store changes. A valid contract stays INELIGIBLE in all
    // five conditions, so :ineligible is emitted every time and the state never
    // becomes terminal.
    const { writeRecord } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
    writeText(path.join(projectRoot, 'docs', 'specs', 'ev.md'),
        ['---', 'id: spec:ev', 'status: closed-record-only',
         'closureBasis: record-only', 'closureReason: r', 'closureRecordedAt: 2026-09-08',
         '---', '', '# EV', '',
         '## Acceptance Criteria', '', '```json', JSON.stringify({ criteria: [VALID] }), '```', ''].join('\n'));

    const evVerdict = () => {
        const e = sp.buildSpecRegistry(projectRoot, { write: false }).specs.find(x => x.id === 'spec:ev');
        return { state: e.state, ids: (e.findings || []).map(f => f.id) };
    };
    for (const verdict of [null, 'PASS', 'FAIL', 'UNVERIFIED', 'STALE']) {
        if (verdict) {
            writeRecord(projectRoot, 'spec:ev',
                { criterionId: 'V', verdict, commitSha: 'deadbeef', verifierType: 'file-exists' });
        }
        const r = evVerdict();
        const label = verdict || 'no evidence';
        assert.notStrictEqual(r.state, 'closed-record-only', `${label}: must not become terminal`);
        assert.ok(r.ids.includes('invalid-record-only-closure:spec:ev:ineligible'),
            `${label}: must emit :ineligible; got ${r.ids.join(', ')}`);
    }

    // (iii) prose never enters identity: factInputs carry exactly the frozen keys
    assert.deepStrictEqual(Object.keys(vis.factInputs).sort(),
        ['authorityContractDigests', 'corroborationContractDigests'],
        'discrepancy identity is exactly the two digest projections — no message, no counts');
    assert.deepStrictEqual(Object.keys(rec.factInputs), ['invalidClosureFields'],
        'record-incomplete identity is exactly the offending field names');
}
console.log('✅ T-record-only-findings passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `locallyExecutableCriterionDigests must be a canonical SET_KEY`

- [ ] **Step 3: Write the implementation**

In `templates/cli/disposition/fingerprint.js`:

```js
const SET_KEYS = Object.freeze([
    'linkedFiles', 'notDonePlans', 'taskStatuses', 'linkedPlans',
    'locallyExecutableCriterionDigests', 'invalidClosureFields',
    'authorityContractDigests', 'corroborationContractDigests',
]);
```

In `templates/cli/spec-portfolio.js`, extend the rule-version table:

```js
const SPEC_RULE_VERSIONS = Object.freeze({
    'unknown-status': 1, 'zombie-plan': 1, 'size-exceeded': 1,
    'aging-no-plan': 1, 'aging-inactive': 1,
    'invalid-record-only-closure': 1,
});
```

Push the warnings in `buildSpecRegistry`, immediately after the state derivation of Task 3. Every applicable violation reports; short-circuiting to the first is prohibited:

```js
if (recordOnlyDeclared && !recordOnlyValid) {
    // Every applicable violation reports. None suppresses another: they are
    // separately actionable and separately dispositionable.
    if (eligibility.ineligible) warnings.push('invalid-record-only-closure:ineligible');
    if (!eligibility.visibilityAgrees) warnings.push('invalid-record-only-closure:contract-visibility-discrepancy');
    if (!closureRecord.valid) warnings.push('invalid-record-only-closure:record-incomplete');
}
```

> These three conditions are read from independent facts, which is why `ineligible` is computed in Task 1 rather than derived from `eligible` here. Deriving it would make visibility disagreement mask the contract violation, and the frozen AC requires all applicable violations to be emitted together.

In `buildSpecFindings`, map the composite warnings to per-instance findings:

```js
else if (w.startsWith('invalid-record-only-closure:')) {
    const instanceKey = w.slice('invalid-record-only-closure:'.length);
    const ro = spec.recordOnly || {};
    const factInputs =
        instanceKey === 'ineligible'
            ? { locallyExecutableCriterionDigests: ro.locallyExecutableDigests || [] }
        : instanceKey === 'contract-visibility-discrepancy'
            ? { authorityContractDigests: ro.authorityDigests || [],
                corroborationContractDigests: ro.corroborationDigests || [] }
            : { invalidClosureFields: ro.invalidClosureFields || [] };
    f('invalid-record-only-closure', factInputs, instanceKey);
}
```

Add a message branch in `formatWarningLine`:

```js
if (warning.startsWith('invalid-record-only-closure:')) {
    const key = warning.slice('invalid-record-only-closure:'.length);
    const detail = key === 'ineligible'
        ? '该 spec 有可执行的验收合同,不得走 record-only 收口'
        : key === 'contract-visibility-discrepancy'
            ? '两个提取器对该 spec 的合同判读不一致 — 收口入口 fail-closed'
            : 'closure record 不完整 (closureBasis / closureReason / closureRecordedAt)';
    return `⚠️ ${spec.id} record-only 收口被驳回: ${detail}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-record-only-findings passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/disposition/fingerprint.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): record-only violation findings with frozen disposition identity"
```

---

### Task 5: `deriveBlocker`, `waiverIsLoadBearing`, release-preflight text

**Files:**
- Modify: `templates/cli/spec-portfolio.js` — `deriveBlocker` (~line 241), `waiverIsLoadBearing` (~line 565)
- Modify: `templates/cli/release-preflight.js:101-102` (remediation text only)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Produces: `REQUIRES_RELEASE_WAIVER` (exported `Set`), consumed by both `deriveBlocker` and `waiverIsLoadBearing`.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-record-only-release. Testing credential independence at the release gate ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    assert.ok(sp.REQUIRES_RELEASE_WAIVER.has('parked'), 'parked is waiver-gated');
    assert.ok(sp.REQUIRES_RELEASE_WAIVER.has('closed-record-only'), 'closed-record-only is waiver-gated');

    const runtime = createTempRuntimeRoot('record-only-release');
    const projectRoot = runtime.workspaceRoot;
    const REC = ['closureBasis: record-only', 'closureReason: r', 'closureRecordedAt: 2026-09-08'];
    const WAIVER = ['releaseBlockDisposition: waived', 'releaseBlockReason: accepted', 'releaseBlockReviewedAt: 2026-09-08'];

    // closure record alone does NOT clear a release blocker
    writeText(path.join(projectRoot, 'docs', 'specs', 'r1.md'),
        ['---', 'id: spec:r1', 'status: closed-record-only', 'releaseBlocking: true'].concat(REC, ['---', '', '# R1', '']).join('\n'));
    // closure record + valid waiver clears it
    writeText(path.join(projectRoot, 'docs', 'specs', 'r2.md'),
        ['---', 'id: spec:r2', 'status: closed-record-only', 'releaseBlocking: true'].concat(REC, WAIVER, ['---', '', '# R2', '']).join('\n'));
    // waiver WITHOUT a closure record does not buy a terminal state
    writeText(path.join(projectRoot, 'docs', 'specs', 'r3.md'),
        ['---', 'id: spec:r3', 'status: closed-record-only', 'releaseBlocking: true'].concat(WAIVER, ['---', '', '# R3', '']).join('\n'));
    // malformed waiver on a valid record-only spec must surface its schema errors
    writeText(path.join(projectRoot, 'docs', 'specs', 'r4.md'),
        ['---', 'id: spec:r4', 'status: closed-record-only', 'releaseBlocking: true',
         'releaseBlockDisposition: waived', 'releaseBlockReviewedAt: 2026-99-99'].concat(REC, ['---', '', '# R4', '']).join('\n'));

    // a REJECTED declaration is release-blocked through the in-flight branch,
    // as a consequence of deriving baseState — not via a waiver-gated reason
    writeText(path.join(projectRoot, 'docs', 'specs', 'r5.md'),
        ['---', 'id: spec:r5', 'status: closed-record-only', 'releaseBlocking: true',
         'linkedPlan: plan:r5p', '---', '', '# R5', '',
         '## Acceptance Criteria', '', '```json',
         JSON.stringify({ criteria: [{ id: 'V', description: 'd', dependsOn: ['x.js'], verifier: { type: 'file-exists', params: { path: 'x.js' } } }] }),
         '```', ''].join('\n'));

    const reg = sp.buildSpecRegistry(projectRoot, { write: false });
    const blocker = id => (reg.blockers || []).find(b => b.id === id);

    const r5 = blocker('spec:r5');
    assert.ok(r5, 'a rejected record-only declaration that is releaseBlocking must still block');
    assert.strictEqual(r5.state, 'active', 'the blocker carries the derived baseState');
    assert.ok(/in-flight release-blocking spec/.test(r5.reason),
        'a rejected declaration takes the in-flight reason, never a waiver-gated one');
    assert.ok(!/record-only-closed/.test(r5.reason),
        'it never borrows the terminal-state message it failed to earn');

    assert.ok(blocker('spec:r1'), 'a closure record is not a waiver — still BLOCKED');
    assert.ok(/record-only-closed/.test(blocker('spec:r1').reason),
        'the reason must be record-only specific, distinct from the parked text');
    assert.ok(!/^parked release-blocking/.test(blocker('spec:r1').reason),
        'parked and record-only must not share a message');
    assert.ok(!blocker('spec:r2'), 'an independent valid waiver clears it');
    assert.notStrictEqual(reg.specs.find(s => s.id === 'spec:r3').state, 'closed-record-only',
        'a waiver does not substitute for a closure record');
    assert.ok((reg.errors || []).some(e => /closureRecordedAt|releaseBlockReviewedAt|releaseBlockReason/.test(e.reason)),
        'waiverIsLoadBearing must surface waiver schema errors on closed-record-only too');

    const preflight = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'release-preflight.js'), 'utf8');
    assert.ok(!/A waiver applies to parked specs only/.test(preflight),
        'remediation text must stop asserting something the gate no longer does');
}
console.log('✅ T-record-only-release passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `sp.REQUIRES_RELEASE_WAIVER is undefined`

- [ ] **Step 3: Write the implementation**

In `templates/cli/spec-portfolio.js`, above `deriveBlocker`:

```js
// Shared POLICY predicate, never a shared lifecycle branch and never a shared
// message. `parked` = the work is not finished / deliberately deferred.
// `closed-record-only` = the work is claimed finished, with no verifiable
// closure. An audit must separate them at a glance.
const REQUIRES_RELEASE_WAIVER = Object.freeze(new Set(['parked', 'closed-record-only']));

const WAIVER_GATED_REASON = Object.freeze({
    'parked': {
        invalidWaiver: 'parked release-blocking spec whose waiver is incomplete or invalid',
        noWaiver: 'parked release-blocking spec with no waiver',
    },
    'closed-record-only': {
        invalidWaiver: 'record-only-closed release-blocking spec whose waiver is incomplete or invalid',
        noWaiver: 'record-only-closed release-blocking spec with no waiver — '
                + 'a closure record is not a waiver; the risk was never verified',
    },
});
```

Rewrite `deriveBlocker`'s middle branch:

```js
function deriveBlocker(spec) {
    if (!spec.releaseBlocking) return null;
    if (spec.state === 'shipped') return null;
    if (REQUIRES_RELEASE_WAIVER.has(spec.state)) {
        if (spec.releaseBlockWaiver && spec.releaseBlockWaiver.valid) return null;
        const reasons = WAIVER_GATED_REASON[spec.state];
        return {
            id: spec.id,
            file: spec.file,
            state: spec.state,
            reason: spec.releaseBlockWaiver && spec.releaseBlockWaiver.present
                ? reasons.invalidWaiver : reasons.noWaiver,
        };
    }
    return {
        id: spec.id, file: spec.file, state: spec.state,
        reason: 'in-flight release-blocking spec; a waiver cannot release adopted/active — finish it or park it deliberately',
    };
}
```

Route the second call site through the same predicate, so it is a real authority rather than a private helper of `deriveBlocker`:

```js
const waiverIsLoadBearing = blocking.value && REQUIRES_RELEASE_WAIVER.has(state);
```

In `templates/cli/release-preflight.js`, replace the two remediation lines. Enforcement is untouched — it still consumes `registry.blockers` and gates on field presence, never on the version string:

```js
'A waiver applies to parked and record-only-closed specs; adopted/active must be',
'finished, parked, or record-only closed first (spec §8.2.2.1).',
```

Export `REQUIRES_RELEASE_WAIVER`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-record-only-release passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/release-preflight.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): waiver-gated policy predicate covers closed-record-only"
```

---

### Task 6: Credential lifecycle — leaving the state invalidates the record

**Files:**
- Modify: `templates/cli/spec-portfolio.js` — `parkSpec` (~line 1033), `reactivateSpec` (~line 1057)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `CLOSURE_FIELDS` (Task 2).
- Produces: no new exports; both transitions strip the three closure fields.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-record-only-credential-lifecycle. Testing that leaving the state invalidates the credential ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const runtime = createTempRuntimeRoot('record-only-lifecycle');
    const projectRoot = runtime.workspaceRoot;
    const REC = ['closureBasis: record-only', 'closureReason: r', 'closureRecordedAt: 2026-09-08'];

    const valid = path.join(projectRoot, 'docs', 'specs', 'v.md');
    writeText(valid, ['---', 'id: spec:v', 'status: closed-record-only'].concat(REC, ['---', '', '# V', '']).join('\n'));
    // REJECTED declaration: derives baseState, never terminal — must still be cleaned
    const rejected = path.join(projectRoot, 'docs', 'specs', 'j.md');
    writeText(rejected, ['---', 'id: spec:j', 'status: closed-record-only', 'closureBasis: record-only',
        'closureReason: r', '---', '', '# J', ''].join('\n'));
    // never record-only closed: park must not invent fields
    const plain = path.join(projectRoot, 'docs', 'specs', 'p.md');
    writeText(plain, ['---', 'id: spec:p', 'status: draft', '---', '', '# P', ''].join('\n'));

    sp.reactivateSpec(projectRoot, 'spec:v');
    for (const f of ['closureBasis', 'closureReason', 'closureRecordedAt']) {
        assert.ok(!new RegExp(`^${f}:`, 'm').test(fs.readFileSync(valid, 'utf8')),
            `reactivate must remove ${f}`);
    }

    sp.parkSpec(projectRoot, 'spec:j');
    for (const f of ['closureBasis', 'closureReason']) {
        assert.ok(!new RegExp(`^${f}:`, 'm').test(fs.readFileSync(rejected, 'utf8')),
            `park must remove ${f} even from a REJECTED declaration (keyed on declaredStatus, not state)`);
    }

    sp.parkSpec(projectRoot, 'spec:p');
    assert.ok(!/closureBasis/.test(fs.readFileSync(plain, 'utf8')),
        'park must not invent closure fields on a spec that never had them');

    // credential replay: re-declaring without a fresh record must be rejected
    writeText(valid, ['---', 'id: spec:v', 'status: closed-record-only', '---', '', '# V', ''].join('\n'));
    const reg = sp.buildSpecRegistry(projectRoot, { write: false });
    const v = reg.specs.find(s => s.id === 'spec:v');
    assert.notStrictEqual(v.state, 'closed-record-only', 're-entry needs a fresh credential');
    assert.ok(v.warnings.includes('invalid-record-only-closure:record-incomplete'),
        're-entry without a record is record-incomplete');
}
console.log('✅ T-record-only-credential-lifecycle passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `reactivate must remove closureBasis`

- [ ] **Step 3: Write the implementation**

In `templates/cli/spec-portfolio.js`, add a shared helper and use it in both transitions. It keys on the **pre-transition `declaredStatus`**, never on the derived `state`: a rejected declaration derives to `baseState`, so a `state`-keyed condition would skip exactly the case that leaves reusable credential fragments behind.

```js
// The pre-transition declaration is ALREADY in `entries`: rewriteSpecFrontmatter
// has read the file and parsed the frontmatter before calling us. Re-reading the
// file here would be a second, independent observation whose failure path
// (`catch -> null`) would silently skip credential cleanup while the rewrite
// still succeeded from the first read — an anti-replay guard that quietly opens
// a replay seam. One observation, no seam.
function declaredStatusOf(entries) {
    const row = entries.find(([key]) => key === 'status');
    return row ? row[1] : null;
}

function stripClosureRecordIfLeavingRecordOnly(entries) {
    if (declaredStatusOf(entries) !== 'closed-record-only') return entries;
    let out = entries;
    for (const field of CLOSURE_FIELDS) out = removeEntry(out, field);
    return out;
}
```

In `parkSpec`, inside the `rewriteSpecFrontmatter` callback:

```js
rewriteSpecFrontmatter(absPath, (entries) => {
    let out = stripClosureRecordIfLeavingRecordOnly(entries);
    out = setEntry(out, 'status', 'parked');
    out = removeEntry(out, 'parkedUntil');
    if (until) out = setEntry(out, 'parkedUntil', until);
    return out;
});
```

In `reactivateSpec`:

```js
rewriteSpecFrontmatter(absPath, (entries) => {
    let out = stripClosureRecordIfLeavingRecordOnly(entries);
    out = setEntry(out, 'status', 'adopted');
    out = removeEntry(out, 'parkedUntil');
    return out;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-record-only-credential-lifecycle passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/test/governance.js
git commit -m "feat(spec-portfolio): leaving closed-record-only invalidates the closure credential"
```

---

### Task 7: W5 — two plan predicates, size actionability, `@2` bumps

> **This task implements `spec:portfolio-finding-correctness`, a different spec.** Read it before starting. Nothing in it may restate a record-only rule, and nothing in Tasks 1–6 may restate a rule from here.

**Files:**
- Modify: `templates/cli/spec-portfolio.js` — `notDonePlans` derivation (~line 484), parked branch, size warning push (~line 545), `SPEC_RULE_VERSIONS`, `buildSpecFindings` zombie factInputs (~line 43)
- Modify: `templates/cli/disposition/fingerprint.js` — `SET_KEYS`
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `state === 'closed-record-only'` (Task 3), only as a `SIZE_ACTIONABLE_STATES` non-member.
- Produces: registry entry field `zombieRelevantPlans: string[]`; `notDonePlans` unchanged in meaning.

- [ ] **Step 1: Write the failing test**

```js
console.log('T-portfolio-finding-correctness. Testing distinct plan predicates and size actionability ...');
{
    const sp = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
    const { SET_KEYS, computeFingerprint } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
    assert.ok(SET_KEYS.includes('zombieRelevantPlans'), 'zombieRelevantPlans must be a canonical SET_KEY');
    assert.strictEqual(sp.SPEC_RULE_VERSIONS['zombie-plan'], 2, 'zombie-plan bumps to 2');
    assert.strictEqual(sp.SPEC_RULE_VERSIONS['size-exceeded'], 2, 'size-exceeded bumps to 2');

    const fp = arr => computeFingerprint({ ruleId: 'zombie-plan', ruleVersion: 2, factInputs: { zombieRelevantPlans: arr } });
    assert.strictEqual(fp(['a', 'b']), fp(['b', 'a']), 'zombieRelevantPlans must be order-insensitive');

    const runtime = createTempRuntimeRoot('portfolio-finding-correctness');
    const projectRoot = runtime.workspaceRoot;
    const oversized = ['## Acceptance Criteria', '', '```json', '{', '  "criteria": [',
        [1,2,3,4,5,6,7,8,9].map(n => `    { "id": "c${n}" }`).join(',\n'), '  ]', '}', '```', ''].join('\n');

    // Z1: parked spec x parked plan -> settled
    writeText(path.join(projectRoot, 'docs', 'specs', 'z1.md'),
        ['---', 'id: spec:z1', 'status: parked', 'linkedPlan: plan:zp', '---', '', '# Z1', ''].join('\n'));
    // Z1b: parked spec x draft plan -> still zombie
    writeText(path.join(projectRoot, 'docs', 'specs', 'z2.md'),
        ['---', 'id: spec:z2', 'status: parked', 'linkedPlan: plan:zd', '---', '', '# Z2', ''].join('\n'));
    // Z2 / W5-c: ACTIVE spec x PARKED plan -> aging-inactive MUST still fire
    const agingPath = path.join(projectRoot, 'docs', 'specs', 'z3.md');
    writeText(agingPath, ['---', 'id: spec:z3', 'status: draft', 'linkedPlan: plan:zp2', '---', '', '# Z3', ''].join('\n'));
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(agingPath, old, old);
    // Z1c/Z1d: parked spec x ACTIVE plan, and x plan MISSING from the IR
    writeText(path.join(projectRoot, 'docs', 'specs', 'z4.md'),
        ['---', 'id: spec:z4', 'status: parked', 'linkedPlan: plan:za', '---', '', '# Z4', ''].join('\n'));
    writeText(path.join(projectRoot, 'docs', 'specs', 'z5.md'),
        ['---', 'id: spec:z5', 'status: parked', 'linkedPlan: plan:ghost', '---', '', '# Z5', ''].join('\n'));
    // size: oversized ADOPTED (no plan) — the cheapest place to edit, so still actionable
    writeText(path.join(projectRoot, 'docs', 'specs', 's-adopted.md'),
        ['---', 'id: spec:sd', 'status: draft', '---', '', '# SD', '', oversized].join('\n'));
    // size: oversized in each state
    writeText(path.join(projectRoot, 'docs', 'specs', 's-active.md'),
        ['---', 'id: spec:sa', 'status: draft', 'linkedPlan: plan:sp', '---', '', '# SA', '', oversized].join('\n'));
    writeText(path.join(projectRoot, 'docs', 'specs', 's-parked.md'),
        ['---', 'id: spec:spk', 'status: parked', '---', '', '# SPK', '', oversized].join('\n'));
    writeText(path.join(projectRoot, 'docs', 'specs', 's-shipped.md'),
        ['---', 'id: spec:ss', 'status: done', '---', '', '# SS', '', oversized].join('\n'));
    writeText(path.join(projectRoot, 'docs', 'specs', 's-record.md'),
        ['---', 'id: spec:sr', 'status: closed-record-only', 'closureBasis: record-only',
         'closureReason: r', 'closureRecordedAt: 2026-09-08', '---', '', '# SR', '', oversized].join('\n'));

    writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
        version: 'evo-plan-ir@1', specs: [], tasks: [], warnings: [],
        plans: [
            { id: 'plan:zp', status: 'parked', linkedSpec: 'spec:z1', sourcePath: 'docs/plans/zp.md' },
            { id: 'plan:zd', status: 'draft', linkedSpec: 'spec:z2', sourcePath: 'docs/plans/zd.md' },
            { id: 'plan:zp2', status: 'parked', linkedSpec: 'spec:z3', sourcePath: 'docs/plans/zp2.md' },
            { id: 'plan:za', status: 'active', linkedSpec: 'spec:z4', sourcePath: 'docs/plans/za.md' },
            { id: 'plan:sp', status: 'active', linkedSpec: 'spec:sa', sourcePath: 'docs/plans/sp.md' },
        ],
    }, null, 2));

    const reg = sp.buildSpecRegistry(projectRoot, { write: false });
    const by = id => reg.specs.find(s => s.id === id);

    assert.ok(!by('spec:z1').warnings.includes('zombie-plan'), 'Z1: parked spec x parked plan must be settled');
    assert.ok(by('spec:z2').warnings.includes('zombie-plan'), 'a draft plan under a parked spec is still zombie');
    assert.ok(by('spec:z4').warnings.includes('zombie-plan'), 'an ACTIVE plan under a parked spec is still zombie');
    assert.ok(by('spec:z5').warnings.includes('zombie-plan'),
        'a plan missing from the IR stays conservatively unsettled');
    // Z2 / W5-c anti-merge control
    assert.ok(by('spec:z3').warnings.includes('aging-inactive'),
        'Z2: aging-inactive must NOT be suppressed merely because the plan is parked');
    assert.deepStrictEqual(by('spec:z3').notDonePlans, ['plan:zp2'],
        'notDonePlans keeps the unchanged status !== done rule');
    assert.deepStrictEqual(by('spec:z1').zombieRelevantPlans, [],
        'zombieRelevantPlans is the zombie rule\'s own set');

    const zf = by('spec:z2').findings.find(f => f.ruleId === 'zombie-plan');
    assert.ok(Array.isArray(zf.factInputs.zombieRelevantPlans),
        'zombie-plan factInputs name zombieRelevantPlans');
    assert.ok(!('notDonePlans' in zf.factInputs),
        'zombie-plan must not fingerprint a set its rule no longer consults');

    assert.ok(by('spec:sd').warnings.includes('size-exceeded'), 'adopted oversized warns — editing is cheapest there');
    assert.ok(by('spec:sa').warnings.includes('size-exceeded'), 'active oversized still warns');
    // A real adopted -> active transition on ONE unchanged document. Comparing two
    // different specs would not test this: the property is that gaining a linked
    // plan, and nothing else, must not move the actionable verdict.
    assert.strictEqual(by('spec:sd').state, 'adopted', 'spec:sd starts adopted');
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
    ir.plans.push({ id: 'plan:sdp', status: 'active', linkedSpec: 'spec:sd', sourcePath: 'docs/plans/sdp.md' });
    writeText(irPath, JSON.stringify(ir, null, 2));

    const sd2 = sp.buildSpecRegistry(projectRoot, { write: false }).specs.find(x => x.id === 'spec:sd');
    assert.strictEqual(sd2.state, 'active', 'linking a plan moves the same document to active');
    assert.ok(sd2.warnings.includes('size-exceeded'),
        'the unchanged document keeps its actionable size finding across adopted -> active');
    for (const id of ['spec:spk', 'spec:ss', 'spec:sr']) {
        assert.strictEqual(by(id).sizeExceeded, true, `${id} measurement is preserved`);
        assert.ok(!by(id).warnings.includes('size-exceeded'), `${id} raises no actionable finding`);
    }
}
console.log('✅ T-portfolio-finding-correctness passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `zombieRelevantPlans must be a canonical SET_KEY`

- [ ] **Step 3: Write the implementation**

In `templates/cli/disposition/fingerprint.js`, add `'zombieRelevantPlans'` to `SET_KEYS`.

In `templates/cli/spec-portfolio.js`, bump both rule versions:

```js
const SPEC_RULE_VERSIONS = Object.freeze({
    'unknown-status': 1, 'zombie-plan': 2, 'size-exceeded': 2,
    'aging-no-plan': 1, 'aging-inactive': 1,
    'invalid-record-only-closure': 1,
});
```

Replace the single predicate with two. They are intentionally distinct and must not be merged: `notDonePlans` is read by **two** rules, and widening it would silently import a governance judgement no design has argued.

```js
// zombie-plan only: "does this parked spec still have unsettled plans?"
// For THIS RULE ONLY, {done, parked} are settled.
const ZOMBIE_SETTLED_PLAN_STATUSES = Object.freeze(new Set(['done', 'parked']));
const zombieRelevantPlans = linkedPlans.filter(planId => {
    const plan = plansById.get(planId);
    return !plan || !ZOMBIE_SETTLED_PLAN_STATUSES.has(plan.status);
});

// aging-inactive: UNCHANGED pre-existing semantics. Do not merge with the above.
// This design does NOT adjudicate whether an active spec backed only by parked
// plans is lifecycle-inconsistent; that needs its own finding, not a silent
// change here.
const notDonePlans = linkedPlans.filter(planId => {
    const plan = plansById.get(planId);
    return !plan || plan.status !== 'done';
});
const anyPlanNotDone = notDonePlans.length > 0;
```

Change the parked branch to consume the zombie predicate:

```js
} else if (status === 'parked') {
    state = 'parked';
    if (linkedPlans.length > 0 && zombieRelevantPlans.length > 0) warnings.push('zombie-plan');
}
```

Separate size measurement from actionability:

```js
// Measurement: every state; `size` / `sizeExceeded` stay in the registry output.
const sizeExceeded = isSizeExceeded(size);
// Actionable finding: only where the spec can still cheaply change.
const SIZE_ACTIONABLE_STATES = Object.freeze(new Set(['adopted', 'active']));
...
if (sizeExceeded && !sizeWaiver && SIZE_ACTIONABLE_STATES.has(state)) warnings.push('size-exceeded');
```

Add `zombieRelevantPlans` to the pushed spec entry, alongside — never in place of — `notDonePlans`. In `buildSpecFindings`, change the zombie mapping:

```js
else if (w === 'zombie-plan') f(w, { zombieRelevantPlans: spec.zombieRelevantPlans });
```

Point the message at the same set:

```js
const plans = (spec.zombieRelevantPlans || spec.linkedPlans || []).join(', ');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: PASS — `✅ T-portfolio-finding-correctness passed`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js templates/cli/disposition/fingerprint.js templates/cli/test/governance.js
git commit -m "fix(spec-portfolio): distinct zombie/aging predicates and state-aware size actionability"
```

---

### Task 8: Integrated regression, runtime mirror, CHANGELOG

**Files:**
- Modify: `.evo-lite/cli/**` (via `sync-runtime`, never by hand)
- Modify: `CHANGELOG.md`
- Test: full suite

**Interfaces:**
- Consumes: everything from Tasks 1–7.

- [ ] **Step 1: Write the failing test**

Negative controls proving this change did not disturb the repository's other two plan-status predicates:

```js
console.log('T-plan-predicate-negative-controls. Testing the other two predicates by BEHAVIOUR ...');
{
    // These assert what the other two rules DO, not that a word still appears in
    // their source. A grep for /parked/ passes on any comment and proves nothing.
    const memoryService = require(path.join(TEMPLATE_CLI_DIR, 'memory.service'));
    const runtime = createTempRuntimeRoot('predicate-negative-controls');
    const projectRoot = runtime.workspaceRoot;

    writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
        version: 'evo-plan-ir@1', specs: [], tasks: [], warnings: [],
        plans: [{ id: 'plan:shelved', status: 'parked', title: 'Shelved', linkedSpec: 'spec:shelved', sourcePath: 'docs/plans/shelved.md' }],
    }, null, 2));

    const prevRoot = process.env.EVO_LITE_ROOT;
    process.env.EVO_LITE_ROOT = path.join(projectRoot, '.evo-lite');
    try {
        // memory.service: a parked plan is still NOT a focus target.
        const advanced = memoryService.advanceFocusFromCommit({
            commitMessage: 'chore: note something\n\nEvo-Focus: plan:shelved\n',
        });
        assert.strictEqual(advanced.status, 'plan-not-startable',
            'a parked plan must remain not-startable for focus');
        assert.strictEqual(advanced.focusChanged, false, 'focus must not advance onto a parked plan');
    } finally {
        if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT;
        else process.env.EVO_LITE_ROOT = prevRoot;
    }

    // planning/gaps: a parked or draft sibling with open tasks still keeps the
    // spec OPEN — the opposite of settled, and deliberately not aligned with the
    // zombie predicate.
    const { runPlanningDriftCensus } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
    const planIR = {
        version: 'evo-plan-ir@1', warnings: [],
        specs: [{ id: 'spec:two', status: 'draft', sourcePath: 'docs/specs/two.md', linkedPlan: 'plan:done' }],
        plans: [
            { id: 'plan:done', status: 'done', linkedSpec: 'spec:two', sourcePath: 'docs/plans/done.md' },
            { id: 'plan:open', status: 'parked', linkedSpec: 'spec:two', sourcePath: 'docs/plans/open.md' },
        ],
        tasks: [
            { id: 'task:a', linkedPlan: 'plan:done', status: 'implemented', title: 'a' },
            { id: 'task:b', linkedPlan: 'plan:open', status: 'todo', title: 'b' },
        ],
    };
    const census = runPlanningDriftCensus(projectRoot, planIR, {});
    const r011 = (census.findings || []).filter(f => (f.ruleId || f.rule || f.id) === 'R011'
        && JSON.stringify(f).includes('spec:two'));
    assert.strictEqual(r011.length, 0,
        'a parked sibling with open tasks must keep the spec open — no R011 closure recommendation');

    // the mirror must match the canonical tree
    const canonical = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio.js'), 'utf8');
    const mirror = fs.readFileSync(path.join(CLI_DIR, 'spec-portfolio.js'), 'utf8');
    assert.strictEqual(mirror, canonical, 'run `mem sync-runtime` — the mirror is stale');
}
console.log('✅ T-plan-predicate-negative-controls passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL — `run mem sync-runtime — the mirror is stale`

- [ ] **Step 3: Refresh the mirror, then prove it on the RUNTIME runner**

```bash
node .evo-lite/cli/memory.js sync-runtime
node ./.evo-lite/cli/test.js all
```

This is the one place `.evo-lite/cli/test.js` is correct: after `sync-runtime` the
mirror carries every change from Tasks 1–7, so running it proves the deployed
runtime — not just the canonical tree — is green. Expected: the whole suite
passes, including both new test families and the behavioural negative controls.

- [ ] **Step 4: Verify the governance surfaces on real data**

```bash
node .evo-lite/cli/memory.js spec status
node .evo-lite/cli/memory.js verify
```

Expected: `📋 [Spec Portfolio]` now prints a `recordClosed=` column; no `size-exceeded` finding on `spec:record-only-closure-terminal-state` or `spec:portfolio-finding-correctness`; the previously deadlocked `spec:unified-code-explore-wiki-projection` × `plan:code-wiki-inspector-projection` zombie warning is gone.

- [ ] **Step 5: CHANGELOG and commit**

Add under a new `## [Unreleased]` heading in `CHANGELOG.md`:

```markdown
### Added
- `closed-record-only`: a third terminal spec state for finished work that has no
  machine-executable acceptance contract. Entry is gated on NO-CONTRACT/INVALID
  only, requires its own closure record, and does **not** clear a release blocker —
  a closure record is not a waiver.
- `recordClosed` as an independent portfolio count, never folded into `shipped`.

### Fixed
- `zombie-plan` no longer deadlocks a parked spec whose plan is also parked;
  `aging-inactive` semantics are deliberately unchanged.
- `size-exceeded` is raised only for `adopted`/`active` specs. Measurement is
  preserved for every state.

### Changed
- Registry schema `evo-spec-registry@2` → `@3` (state enum + record-only fields).
- Rule versions: `zombie-plan@2`, `size-exceeded@2`; both invalidate existing
  dispositions on those rules by design.
```

```bash
git add -A
git commit -m "chore: sync runtime mirror, CHANGELOG, and integrated regression for record-only closure"
```

---

## Self-Review Notes

**Spec coverage.** A §1 → Task 3. A §2 → Task 1. A §3 → Tasks 2, 6. A §4 → Task 5. A §5 → Tasks 3, 4. A §6 (production surface) → Tasks 3, 4, 5, 8. A §7 (parser divergence containment) → Task 1's visibility assertions. B §1 → Task 7. B §2 → Task 7. B §3 → Task 7. B §4 → Tasks 7, 8. B §5 → this plan's dual `linkedSpec` relationship.

**Type consistency.** `evaluateRecordOnlyEligibility` returns the same field names in Task 1's implementation, Task 3's consumption, and Task 4's `factInputs` mapping (`locallyExecutable`, `authority`, `corroboration`, `visibilityAgrees`, `eligible`). `parseClosureRecord` returns `invalidFields`, stored as `recordOnly.invalidClosureFields` and emitted as the `invalidClosureFields` fact key.

**Known ordering constraint.** Task 3 writes the parked branch using today's `anyPlanNotDone`; Task 7 changes it to `zombieRelevantPlans`. This is deliberate — the two belong to different specs and must be reviewable apart. An executor running Task 7 before Task 3 will find the parked branch already correct and should skip that edit rather than duplicate it.

**Not in scope.** Applying record-only closure to any actual spec; a `mem spec` subcommand for it; parser convergence; the numbered-heading regex defect; a disposition migration for the two `@2` bumps. All are registered as follow-ups in the two specs.
