---
id: spec:governance-observation-budget
status: draft
linkedPlan: plan:governance-observation-budget
releaseBlocking: false
---

# Governance Observation & Work Budget — Design Spec

## Purpose

Close the CodePLC child-hive feedback items `child-self-observe` and
`governance-work-budget` without turning Evo-Lite into a background GitHub
monitor or collecting raw conversations.

The existing `[pr-state-sync]` and post-merge correction are already durable in
the mother runtime. This scope consumes their normalized PR/CI observation;
the later child-runtime deployment closes the separate CodePLC
`pr-state-sync` feedback item without reimplementing that validator.

## Boundary

The runtime observes governance facts at Evo-Lite command/hook boundaries. It
does not promise instantaneous reaction to an external GitHub event while no
Evo-Lite process is running.

Accepted observation boundaries:

```text
sessionstart
posttooluse
precompact
stop
context track/focus/edit/auto-refresh
plan freeze/ledger/lint/scan/gaps/progress/trace
pr-state validate
verify
```

Rejected boundary:

```text
permanent background polling of GitHub or raw conversation capture
```

## Snapshot artifact

The latest derived snapshot is written to:

```text
.evo-lite/generated/governance/snapshot.json
```

It contains only structured governance facts:

```text
schema/version and observedAt
git head, branch, upstream, ahead/behind, dirty
active-context META baseline, focus digest, backlog IDs, trajectory head
planning spec/plan/task counts and stable finding codes
freeze-ledger within/exceeded counts
PR number/base/head/phase/checks/runId when supplied by pr-state validate
transition from the previous snapshot
recommendation codes
```

It must not contain prompts, chat text, command stdout/stderr, secrets, PR body
free text, source code, or raw review comments.

Writes are best-effort and must never change `active_context.md`. A snapshot
write failure becomes an explicit warning but does not change the result of the
underlying command.

## Semantic staleness

The old 24-hour mtime warning remains diagnostic, but semantic findings are
more important:

```text
CONTEXT_HEAD_NOT_ANCESTOR
CONTEXT_SYNC_COUNT_DRIFT
TRAJECTORY_HEAD_DRIFT
FOCUS_PLAN_DRIFT
PORTFOLIO_SOURCE_DRIFT
REMEDIATION_BUDGET_EXCEEDED
```

No finding is emitted merely because HEAD is a governance merge whose parent is
the recorded durable baseline. Existing R013 ancestor semantics remain intact.

## Transition detection

Comparing the new snapshot with the previous snapshot detects:

```text
branch-changed
head-advanced
merge-observed
pr-phase-changed
ci-state-changed
freeze-added
budget-crossed
```

Transitions produce recommendation codes. They do not mutate focus, backlog,
PR bodies, review threads, or branches.

## Work-budget report

`mem governance budget [--since <ref>] [--json]` classifies commits by their
changed-file surface:

```text
delivery    any product/runtime file outside governance-only roots
governance  all files are docs, .agents, .evo-lite governance state, or tests
mixed       both delivery and governance-only files
```

The report includes commit counts, elapsed wall-clock span, remediation commits
from the freeze ledger, and ratios. Merge commits are reported separately and
not double-counted in the primary ratio.

Configurable warning thresholds live under:

```json
{
  "governance": {
    "budget": {
      "windowCommits": 100,
      "maxGovernanceRatio": 0.7,
      "maxRemediationRatio": 0.5
    }
  }
}
```

Invalid config fails closed for the budget command. `mem verify` degrades to a
warning and reports a remediation choice set rather than becoming a product
release blocker.

## CLI

```text
mem governance snapshot [--json] [--write]
mem governance budget [--since <ref>] [--json]
```

`snapshot` defaults to read-only output. Internal command/hook integration uses
the same builder with `write: true`.

## Acceptance criteria

1. Snapshot schema contains only the allowlisted governance fields.
2. Raw command output, PR body prose, review text, and environment secrets are
   absent even when injected into test fixtures.
3. Branch/head/PR/CI/freeze/budget transitions are deterministic.
4. Ancestor-baseline META remains valid after a governance merge.
5. A stale CodePLC-style focus/head produces semantic recommendation codes.
6. `pr-state validate` supplies normalized PR/CI facts and never supplies raw
   body text.
7. Budget classification covers delivery, governance, mixed, and merge commits.
8. Threshold crossing emits all three choices and never chooses automatically.
9. Snapshot write failure is visible and does not alter the primary command
   result.
10. Existing context, plan, verify, and pr-state behavior remains compatible.
11. Live/template parity and runtime manifest coverage are preserved.
12. Full governance/integration/scaffold tests pass on Linux and Windows.

## Feedback disposition

```text
child-self-observe       accepted as event-boundary structured snapshots;
                         continuous background monitoring rejected
governance-work-budget   accepted as measured report + warning circuit breaker;
                         automatic authorization choice rejected
```
