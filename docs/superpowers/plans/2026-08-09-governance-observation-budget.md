---
id: plan:governance-observation-budget
status: active
linkedSpec: spec:governance-observation-budget
---

# Governance Observation & Work Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce privacy-bounded governance snapshots and an evidence-based delivery/governance budget report at Evo-Lite command boundaries.

**Architecture:** A focused `governance-observer.js` builds allowlisted snapshots and budget reports from injected/read-only providers. Existing hooks, verify, planning freeze, and pr-state validation call a best-effort snapshot writer. No background process or raw text capture is introduced.

**Tech Stack:** Node.js CommonJS, Commander, built-in `fs/path/child_process/crypto`, existing active-context/planning/pr-state services.

## Global Constraints

- No background GitHub polling.
- No raw conversation, command output, PR body prose, review text, source, or secrets in snapshots.
- Snapshot failure never changes the primary command result.
- Active context, PR bodies, reviews, branches, and authorizations remain read-only.
- Threshold crossings warn and present choices; they never select a choice.
- Live/template files remain byte-identical and manifest-managed.
- Append-only ordinary commits only.

---

### Task 1: Snapshot Builder and Semantic Findings

**Files:**
- Create: `templates/cli/governance-observer.js`
- Create: `.evo-lite/cli/governance-observer.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: `buildGovernanceSnapshot(projectRoot, options) -> snapshot`
- Produces: `compareGovernanceSnapshots(previous, current) -> transition[]`
- Produces: `writeGovernanceSnapshot(projectRoot, snapshot, options) -> { ok, path|error }`
- Produces: `recordGovernanceSnapshot(projectRoot, options) -> { snapshot, write }`

- [ ] **Step 1: Add RED allowlist and transition tests**

```js
const snapshot = observer.buildGovernanceSnapshot(root, {
  prState: normalizedPr,
  forbiddenProbe: { body: 'secret', output: 'raw' }
});
assert.strictEqual(JSON.stringify(snapshot).includes('secret'), false);
assert.deepStrictEqual(
  observer.compareGovernanceSnapshots(before, after).map(x => x.code),
  ['branch-changed', 'head-advanced', 'pr-phase-changed']
);
```

Cover ancestor-valid META, non-ancestor head, sync counts, trajectory drift,
portfolio source drift, freeze/budget crossings, deterministic ordering, and
write failure.

- [ ] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js governance`

- [ ] **Step 3: Implement pure builder and best-effort writer**

All Git calls use argv arrays and injectable providers. The writer uses the
existing generated directory and never touches active context.

- [ ] **Step 4: Run GREEN**

Run: `node ./.evo-lite/cli/test.js governance`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/governance-observer.js .evo-lite/cli/governance-observer.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(governance): build privacy-bounded state snapshots"
```

### Task 2: Work-budget Classification and Circuit Breaker

**Files:**
- Modify: `templates/cli/governance-observer.js`
- Modify: `.evo-lite/cli/governance-observer.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: `buildGovernanceBudget(projectRoot, options) -> report`
- Produces: `loadGovernanceBudgetConfig(projectRoot) -> validated config`

- [ ] **Step 1: Add RED temporary-Git classification tests**

Create delivery-only, governance-only, mixed, and merge commits. Assert primary
ratios exclude merge commits, elapsed span is deterministic with injected
timestamps, remediation ratio consumes freeze-ledger observations, and invalid
config fails closed.

- [ ] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js governance`

- [ ] **Step 3: Implement report and thresholds**

Return stable status `within-budget | budget-exceeded` and all three disposition
choices on threshold crossing.

- [ ] **Step 4: Run GREEN**

Run: `node ./.evo-lite/cli/test.js governance`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/governance-observer.js .evo-lite/cli/governance-observer.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(governance): report bounded work ratios"
```

### Task 3: Governance CLI and Runtime Manifest

**Files:**
- Modify: `templates/cli/memory.js`
- Modify: `.evo-lite/cli/memory.js`
- Modify: `templates/cli/template-manifest.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Modify: `templates/cli/test/integration.js`
- Modify: `.evo-lite/cli/test/integration.js`

**Interfaces:**
- CLI: `mem governance snapshot [--json] [--write]`
- CLI: `mem governance budget [--since <ref>] [--json]`

- [ ] **Step 1: Add RED nested-only CLI tests**

Assert JSON schema, text summary, safe invalid ref rejection, no top-level
aliases, snapshot default read-only, `--write` exact target, and manifest entry.

- [ ] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js`

- [ ] **Step 3: Register commands and manifest**

Do not add dependencies or alternate input surfaces.

- [ ] **Step 4: Run GREEN**

Run: `node ./.evo-lite/cli/test.js`

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory.js .evo-lite/cli/memory.js templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(governance): expose snapshot and budget commands"
```

### Task 4: Event-boundary Integration

**Files:**
- Modify: `templates/cli/memory.service.js`
- Modify: `.evo-lite/cli/memory.service.js`
- Modify: `templates/cli/pr-state.js`
- Modify: `.evo-lite/cli/pr-state.js`
- Modify: `templates/cli/planning.js`
- Modify: `.evo-lite/cli/planning.js`
- Modify: `templates/cli/test/governance.js`
- Modify: `.evo-lite/cli/test/governance.js`
- Modify: `templates/cli/test/integration.js`
- Modify: `.evo-lite/cli/test/integration.js`

**Interfaces:**
- Consumes: Task 1 `recordGovernanceSnapshot()`.
- `inspectLocalState()` adds semantic recommendation codes without changing its
  existing blocking rules.
- `pr-state validate` passes only normalized expected/observed/result fields.

- [ ] **Step 1: Add RED hook/verify/pr-state integration tests**

Prove sessionstart/stop head changes, plan freeze, verify, and pr-state validate
write allowlisted snapshots; inject raw body/review/output/secrets and assert
absence. Inject writer failure and assert original exit/result is unchanged.

- [ ] **Step 2: Run RED**

Run: `node ./.evo-lite/cli/test.js`

- [ ] **Step 3: Add best-effort integrations**

Keep network acquisition inside pr-state. Observer receives normalized data and
does not call GitHub itself.

- [ ] **Step 4: Run GREEN and CodePLC semantic fixture**

Run: `node ./.evo-lite/cli/test.js`

Run a read-only observer probe against `D:/Data/ProjectAgent/CodePLC`; expect
stale focus/head recommendation codes and no mutation unless `write` is
explicitly requested.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/pr-state.js .evo-lite/cli/pr-state.js templates/cli/planning.js .evo-lite/cli/planning.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
git commit -m "feat(governance): record snapshots at lifecycle gates"
```

### Task 5: Final Observation Verification

**Files:**
- Modify only checkbox completion metadata in this plan after evidence passes.

- [ ] **Step 1: Run full gates**

```text
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
node ./.evo-lite/cli/memory.js governance snapshot --json
node ./.evo-lite/cli/memory.js governance budget --json
node ./.evo-lite/cli/memory.js context validate
git diff --check IMPLEMENTATION_BASE..HEAD
```

- [ ] **Step 2: Prove live/template parity and manifest coverage**

Compare all changed pairs by Git blob hash and run runtime-lock/scaffold tests.

- [ ] **Step 3: Run GitNexus compare review**

Use `detect_changes(scope="compare", base_ref=IMPLEMENTATION_BASE)` and review
all affected execution flows.

- [ ] **Step 4: Mark completed checkboxes and commit**

```bash
git add docs/superpowers/plans/2026-08-09-governance-observation-budget.md
git commit -m "docs(plan): close governance observation budget"
```

