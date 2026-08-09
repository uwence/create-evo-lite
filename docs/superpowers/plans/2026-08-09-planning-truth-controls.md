---
id: plan:planning-truth-controls
status: active
linkedSpec: spec:planning-truth-controls
---

# Planning Truth Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable governance-contract lint, dual-root portfolio discovery, an independent freeze ledger, and measured convergence evidence.

**Architecture:** A focused `planning/governance-contract.js` owns strict contract parsing/linting and `planning/freeze-ledger.js` owns freeze identity plus Git-derived observations. Existing planning CLI, traceability, and portfolio modules consume those focused services. All runtime changes remain byte-identical in live/template pairs.

**Tech Stack:** Node.js CommonJS, Commander, built-in `fs/path/crypto/child_process`, existing Evo-Lite planning parsers, dependency-free tests.

## Global Constraints

- Legacy artifacts opt out unless configuration requires a contract for their path.
- No provider/runtime evidence is inferred or fabricated.
- No automatic Ready, merge, authorization, or convergence disposition.
- Layer B cannot block the design artifact; Layer C can block only implementation.
- Every new runtime module is registered in `core-cli` and mirrored byte-for-byte.
- Implementation baseline is the plan commit SHA captured immediately before Task 1.
- Append-only ordinary commits; no amend, rebase, squash, or force-push.

---

### Task 1: Strict Governance Contract Parser

**Files:**
- Create: `templates/cli/planning/governance-contract.js`
- Create: `.evo-lite/cli/planning/governance-contract.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: `parseGovernanceContract(markdown) -> { present, contract, error }`
- Produces: `validateGovernanceContract(contract, context) -> Finding[]`
- Produces: `loadContractLintConfig(projectRoot) -> { ok, config, findings }`
- Produces: `lintGovernedArtifact({ projectRoot, filePath, markdown, parsedArtifact }) -> Finding[]`

- [x] **Step 1: Add RED parser and semantic matrix**

```js
const gc = require('../planning/governance-contract');
assert.strictEqual(gc.parseGovernanceContract('# legacy').present, false);
assert.strictEqual(gc.parseGovernanceContract(validBlock).contract.schema, 1);
assert.deepStrictEqual(
  gc.validateGovernanceContract(layerBArtifactBlock, ctx).map(x => x.code),
  ['PROOF_LAYER_BLOCK_SCOPE_INVALID']
);
assert.deepStrictEqual(
  gc.validateGovernanceContract(spikeInSpecs, ctx).map(x => x.code),
  ['ARTIFACT_STAGE_PATH_MISMATCH']
);
```

Cover malformed/multiple fences, duplicate JSON keys, unknown/missing keys,
all enums, invariant grammar/uniqueness, Layer A/B/C cross-fields, path stage,
and spike executable evidence.

- [x] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js governance`

Expected: failure because `planning/governance-contract.js` is absent.

- [x] **Step 3: Implement strict parser and validator**

Use a duplicate-key-aware JSON lexical pass before `JSON.parse`; return stable
finding objects `{ code, level: 'error', file, message }`. Validate scalars
before cross-field rules.

- [x] **Step 4: Mirror and run GREEN**

Run: `node ./.evo-lite/cli/test.js governance`

Expected: parser matrix passes.

- [x] **Step 5: Commit**

```bash
git add templates/cli/planning/governance-contract.js .evo-lite/cli/planning/governance-contract.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(planning): validate governance artifact contracts"
```

### Task 2: Configurable `plan lint` Integration

**Files:**
- Modify: `templates/cli/planning/lint.js`
- Modify: `.evo-lite/cli/planning/lint.js`
- Modify: `templates/cli/planning.js`
- Modify: `.evo-lite/cli/planning.js`
- Modify: `templates/cli/test/integration.js`
- Modify: `.evo-lite/cli/test/integration.js`

**Interfaces:**
- Consumes: Task 1 contract parser/validator.
- Produces: `lintPlans(projectRoot, options)` findings including `code`.
- CLI: `mem plan lint [--fix] [--json] [--strict]`; strict exits non-zero on contract errors.

- [x] **Step 1: Add RED config and CLI tests**

```js
const report = lintPlans(root, { contract: true });
assert.ok(report.findings.some(f => f.code === 'PLAN_CONTRACT_MISSING'));
assert.ok(report.findings.some(f => f.code === 'PLAN_CONTRACT_INVARIANT_MISSING'));
```

Test valid `*`/`**` patterns, traversal/absolute pattern rejection, non-matching
legacy files, JSON output, and unchanged existing `--fix` behavior.

- [x] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js`

Expected: integration phase fails on missing contract findings/CLI flags.

- [x] **Step 3: Integrate config and stable rendering**

Do not let `--fix` invent a Governance Contract. It may continue fixing only
existing frontmatter behavior.

- [x] **Step 4: Run GREEN**

Run: `node ./.evo-lite/cli/test.js`

Expected: governance and integration pass.

- [x] **Step 5: Commit**

```bash
git add templates/cli/planning/lint.js .evo-lite/cli/planning/lint.js templates/cli/planning.js .evo-lite/cli/planning.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(planning): lint configured contract invariants"
```

### Task 3: Dual-root Spec Portfolio Synchronization

**Files:**
- Modify: `templates/cli/spec-portfolio.js`
- Modify: `.evo-lite/cli/spec-portfolio.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: `discoverSpecFiles(projectRoot)` with per-root source diagnostics.
- Preserves: `buildSpecRegistry(projectRoot, { write })` public contract.

- [x] **Step 1: Add RED dual-root/duplicate/source-drift tests**

```js
writeSpec(root, 'docs/superpowers/specs/a.md', 'spec:a', 'done');
const registry = portfolio.buildSpecRegistry(root, { write: false });
assert.strictEqual(registry.specs[0].id, 'spec:a');
assert.strictEqual(registry.specs[0].state, 'shipped');
```

Also cover same ID in both roots, unreadable/missing roots, one readable root,
and Planning IR non-zero while portfolio valid count is zero.

- [x] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js governance`

Expected: superpowers-only fixture remains zero or lacks source warning.

- [x] **Step 3: Implement dual-root discovery**

Sort roots and files deterministically. Record duplicate-ID registry errors.
Make `formatPortfolioReport()` emit `portfolio-source-drift` without turning it
into a release blocker on its own.

- [x] **Step 4: Run GREEN and CodePLC fixture probe**

Run: `node ./.evo-lite/cli/test.js governance`

Run a read-only Node probe that calls the template `buildSpecRegistry()` with
`D:/Data/ProjectAgent/CodePLC` and `{ write: false }`.

Expected: valid spec count is non-zero.

- [x] **Step 5: Commit**

```bash
git add templates/cli/spec-portfolio.js .evo-lite/cli/spec-portfolio.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(portfolio): discover governed specs in both roots"
```

### Task 4: Independent Freeze Ledger and Convergence Budget

**Files:**
- Create: `templates/cli/planning/freeze-ledger.js`
- Create: `.evo-lite/cli/planning/freeze-ledger.js`
- Modify: `templates/cli/planning.js`
- Modify: `.evo-lite/cli/planning.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`
- Modify: `templates/cli/test/integration.js`
- Modify: `.evo-lite/cli/test/integration.js`

**Interfaces:**
- Produces: `freezeArtifact(projectRoot, artifactPath, options) -> entry`
- Produces: `readFreezeLedger(projectRoot) -> ledger`
- Produces: `inspectFreezeLedger(projectRoot, options) -> report`
- CLI: `mem plan freeze <path> [--replace] [--json]`
- CLI: `mem plan ledger [--json]`

- [x] **Step 1: Add RED service tests**

Use a temporary Git repository. Prove clean/tracked/HEAD-bound preconditions,
exact byte SHA-256, contract digest, existing-entry refusal, explicit replace,
content drift, ancestry, first reachable merge, evidence linkage, and commit
count after freeze excluding the freeze commit.

- [x] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js governance`

Expected: missing ledger module.

- [x] **Step 3: Implement ledger with validate-before-write ordering**

Use `execFileSync('git', argv)` only; no shell strings. Normalize all stored
paths and reject paths outside the workspace. Write one canonical JSON document
after validation.

- [x] **Step 4: Add CLI RED then GREEN**

Run: `node ./.evo-lite/cli/test.js`

Expected after implementation: freeze and ledger commands render deterministic
JSON/text; budget exceedance is warning-only and lists the three frozen choices.

- [x] **Step 5: Commit**

```bash
git add templates/cli/planning/freeze-ledger.js .evo-lite/cli/planning/freeze-ledger.js templates/cli/planning.js .evo-lite/cli/planning.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(planning): record independent freeze identity"
```

### Task 5: Traceability v2 and Runtime Management

**Files:**
- Modify: `templates/cli/planning/traceability.js`
- Modify: `.evo-lite/cli/planning/traceability.js`
- Modify: `templates/cli/template-manifest.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`
- Modify: `templates/cli/test/integration.js`
- Modify: `.evo-lite/cli/test/integration.js`

**Interfaces:**
- Consumes: Task 4 `inspectFreezeLedger()`.
- Produces: `evo-trace@2` with legacy fields plus `freezeLedger`.

- [x] **Step 1: Add RED trace/manifest tests**

```js
const trace = buildTraceability(root);
assert.strictEqual(trace.version, 'evo-trace@2');
assert.deepStrictEqual(trace.freezeLedger.entries[0].artifactId, 'plan:x');
```

Assert both new modules appear in the `core-cli` family and runtime-lock entry
set.

- [x] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js`

- [x] **Step 3: Implement trace v2 and manifest entries**

Preserve the exact v1 chain/unlinked-task shapes.

- [x] **Step 4: Run GREEN and parity**

Run: `node ./.evo-lite/cli/test.js governance`

Run: `node ./.evo-lite/cli/test.js`

Compare all changed live/template pairs by Git blob hash.

- [x] **Step 5: Commit**

```bash
git add templates/cli/planning/traceability.js .evo-lite/cli/planning/traceability.js templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(planning): link freeze evidence into traceability"
```

### Task 6: Final Planning Truth Verification

**Files:**
- Modify only checkbox completion metadata in this plan after evidence passes.

- [x] **Step 1: Run full gates**

```text
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
node ./.evo-lite/cli/memory.js context validate
node ./.evo-lite/cli/memory.js plan scan
node ./.evo-lite/cli/memory.js plan lint --strict
node ./.evo-lite/cli/memory.js plan trace
git diff --check IMPLEMENTATION_BASE..HEAD
```

- [x] **Step 2: Run GitNexus compare review**

Use `detect_changes(scope="compare", base_ref=IMPLEMENTATION_BASE)` and review
every affected process before committing closure metadata.

- [x] **Step 3: Mark completed checkboxes and commit**

```bash
git add docs/superpowers/plans/2026-08-09-planning-truth-controls.md
git commit -m "docs(plan): close planning truth controls"
```
