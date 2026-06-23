---
id: spec:dogfood-operator-experience-phase2
status: done
created: 2026-06-23
linkedPlan: plan:dogfood-operator-experience-phase2
---

# Dogfood Operator Experience Phase 2 — Spec

## Goal

Reduce operator toil so that a non-expert operator can run a normal `/evo → edit
→ commit → push` cycle without manually nursing governance state. Phase 1 makes
governance **visible**; Phase 2 makes the common, mechanical governance chores
**self-healing** so the operator is not punished for ordinary actions
(snapshots, hot-fixes, config edits, `git pull`/`rebase`).

## Session Evidence

This spec is grounded in a real dogfood session inside `create-evo-lite` on
2026-06-23 (the `/evo` takeover that produced commits `41ee5f5`, `3d26dc1`), not
a hypothetical workflow. Every problem below was observed live in that session.

### What the operator actually had to do by hand

- Manually run `mem focus --content "…"` because focus had frozen on a stale
  plan for >24h while real delivery advanced through `rc-closure-phase2/phase3`.
- Manually run `mem sync-runtime` after a `git rebase` because the runtime-mirror
  lock reported a hard `ERROR` even though `sync-runtime` then copied **0** files
  (mirror content already matched templates; only the lock snapshot was stale).
- Mentally filter recurring `R006` warnings on `.claude/settings.local.json` and
  `.evo-lite/active_context.md` — files that are governance/host-adapter
  infrastructure, not product code that should be linked to a plan task.

### Root cause (three layers, all confirmed in source)

1. **Focus only advances on explicit `mem focus`.** Snapshot commits refresh
   `BEGIN_TRAJECTORY` but never `BEGIN_FOCUS` (by design); hot-fixes that skip
   the spec/plan flow never call `mem focus`. Result: `verify` correctly detects
   ">24h stale" but offers no advance — the operator must hand-write the focus.

2. **The R006 traceability exemption is too narrow.** `isGovernanceRuntimeFile()`
   in `templates/cli/planning/gaps.js` exempts only `.evo-lite/**`. Host-adapter
   config under `.claude/**` and root meta files are equally non-product, yet
   still fire `R006` on every commit that touches them.

3. **The runtime-mirror lock check cannot tell "stale lock" from "real drift".**
   `verifyRuntimeLock()` in `templates/cli/sync-runtime.js` compares the mirror
   against the **lock-recorded hashes** only. After a `git pull`/`rebase` updates
   both `templates/cli/**` and the `.evo-lite/cli/**` mirror together, the mirror
   still matches templates but no longer matches the old lock → hard `ERROR`,
   even though nothing is actually wrong.

## Problem

Evo-Lite's governance is detection-strong but remediation-weak. Detection without
self-healing turns ordinary operator actions into an alert treadmill, which is
especially costly for the non-expert operator this project is meant to assist.

## Non-Goals

- No change to the durable archive chain (`active_context → context track → archive`).
- No new memory engine, external service, or GitHub/PR integration.
- No blocking pre-commit governance gate.
- No automatic mutation of anchored `BEGIN_FOCUS` **content** without a clear,
  evidence-derived trigger and an opt-out — auto-advance must be conservative,
  never silently overwrite an intentional manual focus.

## Requirements

### R1 — Focus MUST be able to auto-advance from commit evidence

When a commit's message references a known `plan:<slug>` or `spec:<slug>` (e.g.
via Conventional-Commit scope, a `plan:`/`spec:` token, or an explicit trailer),
the post-commit governance path MUST be able to advance `BEGIN_FOCUS` to a
summary derived from that plan/spec.

Constraints:

- Auto-advance MUST be conservative: it only fires on an explicit, machine-detectable
  plan/spec reference, never on a bare snapshot or meta commit.
- It MUST be opt-out via config or env (`EVO_LITE_NO_FOCUS_AUTOADVANCE=1`).
- `verify` MUST, on a detected focus-staleness, recommend the concrete advance
  command (or report that auto-advance is enabled and will run on next commit)
  instead of only reporting ">24h stale".

### R2 — Governance traceability MUST exempt host-adapter and meta infrastructure

`isGovernanceRuntimeFile()` MUST treat host-adapter and project-meta files as
governance infrastructure, not unlinked product code. At minimum the exemption
MUST cover:

- `.evo-lite/**` (existing)
- `.claude/**` (host adapter: commands, settings, skills)
- root meta files that are not product code: `CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`, `README*.md`, `.gitignore`, `.gitattributes`, and lockfiles

The exemption MUST be a single, named, testable predicate so future additions
are one-line changes, not new ad-hoc filter rules.

### R3 — The runtime-mirror lock check MUST distinguish stale-lock from real drift

`verify` MUST NOT raise a hard `ERROR` when the mirror content already matches
the canonical `templates/cli/**`. Required behavior:

- If mirror == templates but the lock is stale → treat as healthy, auto-refresh
  the lock (or downgrade to an `info` that names the self-heal command). No `ERROR`.
- If mirror != templates (someone edited `.evo-lite/cli/**` directly, or a
  template changed without a sync) → keep the existing hard `ERROR`.
- A `git merge`/`rebase`/`pull` that updates both trees together MUST NOT leave
  the operator facing a red `ERROR` for byte-identical content. A post-merge
  self-heal (hook or verify-time auto-refresh) SHOULD close this automatically.

### R4 — `verify` MUST flag a focus that points at an unstarted plan

`verify` MUST report when `BEGIN_FOCUS` points at a `plan:<slug>` whose IR status
is `draft` or whose task completion is `0/N`. This is the "phantom focus" signal
that the >24h staleness check only caught indirectly. The finding MUST be
`warning` level and name the plan plus its `done/total` task count.

## Architecture

Phase 2 stays incremental and reuses existing runtime surfaces:

1. **Focus self-advance layer** — extend the post-commit path (`hooks.js` +
   `memory.service.js`) to derive a focus summary from a referenced plan/spec,
   gated by a conservative detector and an opt-out flag.
2. **Exemption predicate layer** — generalize `isGovernanceRuntimeFile()` in
   `gaps.js` into one host-aware predicate covering `.evo-lite/`, `.claude/`, and
   named root meta files.
3. **Lock self-heal layer** — make `verifyRuntimeLock()`/verify content-aware
   (mirror vs live templates) and add a post-merge self-heal so ordinary git
   integration never surfaces a false `ERROR`.
4. **Focus-health rule layer** — add a planning drift rule that fires when focus
   targets a draft / 0-done plan, surfaced through `verify` and the dashboard.

## Acceptance Criteria

- A hot-fix commit whose message references a known plan advances `BEGIN_FOCUS`
  to that plan's summary; a bare snapshot/meta commit does not. Opt-out env
  disables it.
- Committing only `.claude/settings.local.json` (or `CLAUDE.md`) produces no
  `R006` finding.
- After a `git rebase`/`pull` that updates both `templates/cli/**` and the mirror
  together, `mem verify` reports healthy (no `ERROR`) when content is identical,
  and still errors when `.evo-lite/cli/**` is edited directly.
- `mem verify` emits a `warning` when focus points at a `draft`/`0-done` plan,
  naming the plan and its task count.
- All four behaviors are provable through the focused governance test slice
  without requiring the full broad suite to pass first.
