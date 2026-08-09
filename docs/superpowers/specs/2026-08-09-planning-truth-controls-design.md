---
id: spec:planning-truth-controls
status: draft
linkedPlan: plan:planning-truth-controls
releaseBlocking: false
---

# Planning Truth Controls — Design Spec

## Purpose

Close the CodePLC child-hive feedback items `contract-lint`,
`freeze-trace-ledger`, `review-convergence`, `plan-spec-drift`, and
`spec-portfolio-sync` at the mother-runtime level.

The feature adds a machine-readable governance contract for high-risk
artifacts, validates stage/layer/blocking semantics, derives portfolio state
from both canonical spec locations, and records freeze identity outside the
frozen artifact itself.

## Non-goals

- No semantic proof that arbitrary prose is correct.
- No automatic reviewer authorization, Ready transition, or merge.
- No rewrite of frozen spec or plan prose.
- No provider/runtime evidence fabrication.
- No release blocking merely because a legacy artifact has not opted into the
  new governance contract.
- No attempt to infer an exact freeze commit by guessing from commit messages.

## Governed artifact locations

The planning scanner already reads both trees and remains authoritative:

```text
docs/specs/**/*.md
docs/plans/**/*.md
docs/superpowers/specs/**/*.md
docs/superpowers/plans/**/*.md
```

Spec Portfolio discovery expands from `docs/specs/**/*.md` to both spec trees.
Only files with a unique valid `spec:<slug>` frontmatter ID become portfolio
entities. Missing IDs remain planning warnings. Duplicate IDs are fail-closed
registry errors and must never be silently deduplicated.

## Governance Contract block

An artifact opts in by containing exactly one block:

````markdown
## Governance Contract

```json
{
  "schema": 1,
  "artifactStage": "plan",
  "proofLayer": "A",
  "requiredCapabilities": [],
  "blockScope": "artifact",
  "remediationBudget": 5,
  "requiredInvariants": [
    "attempt-binding",
    "identity-domain-separation",
    "event-uniqueness",
    "causal-ordering"
  ]
}
```
````

The parser is strict:

- missing block means legacy opt-out, not failure;
- a present malformed block fails closed;
- exactly one JSON fence and one JSON object;
- unknown keys, missing keys, duplicate JSON keys, non-canonical scalar types,
  and unknown enum values fail closed;
- `requiredInvariants` is a unique non-empty array for `proofLayer: A` and may
  be empty for Layer B/C;
- invariant names match `[a-z0-9][a-z0-9-]{0,63}`.

Enums:

```text
artifactStage  design | plan | spike | implementation | closure
proofLayer     A | B | C
blockScope     artifact | admission | implementation | none
```

Cross-field rules:

```text
Layer A  may use artifact/admission/implementation/none
Layer B  must not use artifact; requiredCapabilities must be non-empty
Layer C  must use implementation or none; requiredCapabilities must be non-empty

artifactStage design   must live under a specs tree
artifactStage plan     must live under a plans tree
artifactStage spike    must live under a plans tree
artifactStage closure  may live in either tree

artifactStage spike
  requires at least one parsed task with a verify command or evidence field
```

This is the provider-agnostic convergence boundary: a Layer A blocker declares
finite invariants that can be decided without unavailable runtime capability.
Layer B/C gaps remain fail-closed at admission/implementation but cannot keep
the design artifact itself in an unbounded remediation loop.

## Configurable contract lint

`.evo-lite/config.json` may declare:

```json
{
  "planning": {
    "contractLint": {
      "required": false,
      "paths": ["docs/superpowers/plans/**"],
      "requiredInvariants": ["attempt-binding"]
    }
  }
}
```

Rules:

- absent configuration preserves legacy behavior;
- `required: true` makes a missing Governance Contract a lint error only for
  matching paths;
- configured invariant IDs must appear in the artifact contract;
- invalid config fails closed with a configuration finding;
- path matching is repository-relative, slash-normalized, and supports only
  `*` and `**`; path traversal and absolute patterns are rejected.

`mem plan lint` remains the single CLI surface. It reports stable finding codes
and exits non-zero for errors:

```text
PLAN_CONTRACT_MISSING
PLAN_CONTRACT_INVALID
PLAN_CONTRACT_INVARIANT_MISSING
ARTIFACT_STAGE_PATH_MISMATCH
PROOF_LAYER_BLOCK_SCOPE_INVALID
REQUIRED_CAPABILITY_MISSING
SPIKE_EXECUTION_EVIDENCE_MISSING
CONTRACT_LINT_CONFIG_INVALID
```

## Independent freeze ledger

The ledger lives at:

```text
.evo-lite/governance/freeze-ledger.json
```

It is not embedded in the frozen artifact. `mem plan freeze <path>`:

1. requires a clean tracked artifact;
2. parses and validates its governance contract;
3. requires `git rev-parse HEAD` and verifies the artifact exists at HEAD;
4. records repository-relative path, artifact ID, SHA-256 of exact bytes,
   freeze commit, contract digest, and timestamp;
5. refuses an existing artifact entry with a different content digest unless
   `--replace` is explicitly provided;
6. writes the ledger once after all validation.

The freeze commit is the already-existing commit whose tree contains the frozen
bytes. The ledger commit may therefore occur later without self-reference.

`mem plan ledger [--json]` is read-only. For each entry it reports:

- current byte digest match/mismatch/missing;
- whether the freeze commit is an ancestor of HEAD;
- the first reachable merge commit on the configured upstream history that
  contains the freeze commit, or `null` when not merged;
- linked verification evidence already present in Planning IR;
- remediation commits touching the artifact after the freeze commit.

No guessed merge or evidence identity is persisted. Observed values are derived
on every read.

## Remediation budget and convergence

`remediationBudget` is compared with the number of commits after the recorded
freeze commit that touch the artifact before its observed mainline merge (or
HEAD when not merged). The freeze commit itself is not counted.

```text
used <= budget  within-budget
used > budget   budget-exceeded
```

A budget exceedance is a warning, not an automatic authorization decision. It
must present three explicit human/agent choices:

```text
continue-governance
downgrade-nonblocking-debt
resume-authorized-execution
```

The command never chooses on behalf of the reviewer. Layer B/C capability gaps
remain admission/implementation blockers even when governance debt is
downgraded.

## Traceability v2

`mem plan trace` continues to produce spec → plan → task → file chains and adds
a `freezeLedger` section. The report version advances to `evo-trace@2`.
Generated trace output is derived and does not rewrite source artifacts.

## Portfolio synchronization

`buildSpecRegistry()` discovers valid spec entities in both spec trees. The
registry source section reports per-root readability and discovered file counts.

If zero valid portfolio specs are found while Planning IR contains one or more
specs, `mem verify` emits a stable `portfolio-source-drift` warning. This is a
governance alert, not a release blocker unless an actual release-blocking spec
or registry error independently requires refusal.

## Acceptance criteria

1. Both spec roots are discovered; duplicates fail closed.
2. CodePLC-style `docs/superpowers/specs` yields non-zero portfolio state.
3. Legacy artifacts without Governance Contract remain valid unless config opts
   their path into required mode.
4. Strict parser and every cross-field rule have positive and negative tests.
5. A spike contract in a specs directory fails; the same artifact in plans with
   executable evidence passes.
6. Configured required invariant omissions fail with a stable code.
7. Freeze writes exact byte/content and commit identity without self-reference.
8. Ledger read reports content drift, ancestry, merge identity, evidence, and
   remediation usage without mutation.
9. Budget exceedance remains warning-only and emits all three choices.
10. Traceability v2 includes ledger data while preserving existing chains.
11. Live/template files remain byte-identical and managed by the runtime
    manifest.
12. Full governance, integration, scaffold, and Windows-compatible tests pass.

## Feedback disposition

```text
contract-lint          accepted by configurable Governance Contract lint
freeze-trace-ledger    accepted by independent freeze ledger + trace v2
review-convergence     accepted by proof-layer/block-scope + measured budget
plan-spec-drift        accepted by artifact-stage/path/evidence rules
spec-portfolio-sync    accepted by dual-root discovery + source-drift warning
```

