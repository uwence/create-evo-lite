---
id: spec:dogfood-operator-experience-phase1
status: draft
created: 2026-06-16
linkedPlan: plan:dogfood-operator-experience-phase1
---

# Dogfood Operator Experience Phase 1 — Spec

## Goal

Make Evo-Lite guide a real operator from `/evo` takeover through implementation and governance verification without hidden commands, silent failures, or false health signals.

## Session Evidence

This spec is grounded in a real dogfood session inside `create-evo-lite`, not a hypothetical workflow.

### Capabilities that were actually used

- `/evo` wrapper flow: `.claude/commands/evo.md` + `.agents/workflows/evo.md`
- `.evo-lite/active_context.md`
- `mem verify`
- bounded `mem recall`
- architecture rules in `.agents/rules/architecture.md`
- governance runtime pieces: `plan scan`, `plan progress`, `plan gaps`, `dashboard build`, `hook install/status`
- dashboard freshness, lint, and post-commit hook code paths

### Capabilities that existed but were not naturally used

- `/commit` and `/mem` workflow closure
- inspector as the default operator console
- traceability / plan trace as a first-class navigation tool
- `mem hook status`, `mem plan progress`, `mem plan lint --fix` as discoverable operator actions

### Capabilities that existed but were misleading or fragile

- post-commit governance looked installed but originally missed `code-only` commits
- hook execution on Windows could fail silently when the resolved `node` path contained spaces
- full-suite verification was blocked by unrelated runtime/test drift before new governance tests ran
- `/api/timeline` contract did not match the existing test expectation, reducing trust in the inspector/test surface

## Problem

Evo-Lite already has governance primitives and a usable takeover flow, but the operator experience is still maintenance-heavy.

Four gaps stood out in this dogfood session:

1. **Takeover is informative but not action-driving.**
   `/evo` and `verify` tell the operator what state exists, but not which 2-3 commands matter most right now or which governance features are present but dormant.

2. **Governance runtime can fail without visible audit evidence.**
   Hooks and background refresh flows are allowed to be quiet on success, but today they are also too quiet on partial execution or platform-specific failure.

3. **Operator health is not summarized as a first-class runtime surface.**
   Template sync, FTS readiness, and archive health are checked, but governance-operational health is not summarized with equal clarity.

4. **Governance verification is not isolated enough from unrelated suite drift.**
   A developer can fix the governance runtime correctly and still fail to prove it quickly because unrelated inspector/API drift blocks the main test runner first.

## Non-Goals

- No redesign of the durable archive chain (`active_context -> context track -> archive`)
- No new memory engine or external service
- No GitHub/PR integration
- No blocking pre-commit governance gate
- No attempt to solve every inspector UI problem in one pass

## Requirements

### R1 — `/evo` MUST surface operator actions, not just status

The `/evo` experience MUST continue to report health truthfully, but it MUST also recommend the smallest relevant next actions based on current state.

At minimum, when applicable, the operator MUST see explicit guidance for:

- `mem hook status`
- `mem plan scan`
- `mem plan progress`
- `mem plan gaps`
- `mem dashboard build`

The guidance MUST be conditional and context-aware, not a static boilerplate list.

### R2 — post-commit governance MUST leave an inspectable run report

The post-commit governance path MUST write a lightweight machine-readable run report under `.evo-lite/generated/` or `.evo-lite/provenance/`.

The report MUST capture:

- timestamp
- commit reference (or root-commit marker)
- changed files seen by the hook
- derived categories (`plan`, `architecture`, `code`)
- commands attempted
- command-level success/failure

This report is operational telemetry only, not a durable archive artifact.

### R3 — `verify` MUST summarize governance-operational health

`mem verify` MUST continue checking template sync and memory/index health, and it MUST additionally summarize operator-governance health:

- whether the Evo-Lite post-commit hook is installed
- whether the latest governance run report exists
- whether the latest governance run had failures
- whether plan / architecture / dashboard freshness data indicates stale governance outputs

The output MUST distinguish:

- healthy
- missing
- stale
- failed-last-run

### R4 — dashboard / inspector MUST expose operator-readiness data consistently

Dashboard and inspector surfaces MUST expose a consistent operator-facing health view.

At minimum:

- dashboard data MUST contain governance-operational status alongside freshness
- inspector API shapes MUST be internally consistent with their consumers/tests
- `/api/timeline` MUST return a payload shape that can be consumed without guesswork

### R5 — governance-critical verification MUST be runnable independently

The repo MUST provide a targeted governance verification path that runs without requiring the entire broad CLI suite to pass first.

This slice MUST cover:

- `/evo` / `verify` operator guidance
- hook install body
- post-commit code-only detection
- plan-commit refresh path
- root-commit changed-file detection
- dashboard freshness rules
- inspector timeline API contract

### R6 — dormant-but-important capabilities MUST become discoverable

Capabilities that matter during normal dogfood operation, but were not naturally discovered in this session, MUST be surfaced through runtime guidance instead of only existing in docs or source code.

Priority commands:

- `mem hook status`
- `mem plan progress`
- `mem plan lint --fix`
- `mem dashboard build`

## Architecture

Phase 1 should stay incremental and reuse existing runtime surfaces.

1. **Operator guidance layer**
   Extend the existing `/evo` + `verify` text/report path rather than inventing a new command.

2. **Hook provenance layer**
   Add a lightweight generated sidecar for the last governance run. This is operational evidence, not durable project memory.

3. **Surface integration layer**
   Feed governance health into dashboard JSON and inspector API responses so both CLI and browser-facing operator surfaces agree.

4. **Verification isolation layer**
   Add a governance-focused test slice/script so dogfood fixes can be proven even when unrelated tests drift.

## Acceptance Criteria

- `/evo` output recommends context-relevant governance commands instead of only restating state
- a post-commit governance run produces an inspectable JSON report with changed files, categories, commands, and per-command status
- `mem verify` reports governance-operational health in addition to template/index/archive health
- dashboard / inspector expose the new governance-operational status without contract ambiguity
- `/api/timeline` has a stable payload shape that matches the current consumer/test expectation
- the repo exposes a targeted governance verification entrypoint that proves hook + verify + freshness behavior without requiring unrelated suite areas to pass first
