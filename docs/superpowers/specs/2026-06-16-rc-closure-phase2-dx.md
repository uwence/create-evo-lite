---
id: spec:rc-closure-phase2-dx
status: done
created: 2026-06-16
linkedPlan: plan:rc-closure-phase2-dx
---

# RC Closure Phase 2 — DX Spec

## Problem

Governance loop closed after Phase 1 (hook → IR → drift → dashboard). Phase 1.5 (this session) fixed hook order + ARCH source coverage. But **user-facing surface still leaks implementation detail**, observed during dogfood:

1. **Dual maintenance**: `templates/cli/` and `.evo-lite/cli/` are both git-tracked and editable. Every change → mirror twice. Drift (1 comment line) → template-sync check fails → verify suppresses governance recommendations. Burnt cycles in this session.
2. **Self-referential R006**: edits implementing governance fix flag themselves as `unlinked-file` because no plan task linked yet. No path from "I'm editing governance code" to "this is the linked task".
3. **R008 noise drowns signal**: 52 implemented tasks lack archive evidence (predates R008 enforcement). Every drift run scrolls past 52 lines. Real signal (R006 × 4, R010 × 1) buried.
4. **MCP cache staleness**: after `mem architecture scan` rewrites IR on disk, `mcp__evo-lite__evo_architecture_status` keeps returning previous IR. User sees inconsistent state across tools.
5. **Active context anchor never auto-updates**: focus + backlog stale across sessions until human edits. New session's `/evo` sees stale focus.
6. **No "where does this file live"**: forced to inline node scripts to map file → module. Reverse lookup missing.
7. **Hook reinstall silent on changes**: `mem hook install` prints same output whether upgrading or first install. No visibility into ordering/content drift.
8. **CRLF git warnings** on every hook-test invocation on Windows.

## Goal

Make Evo-Lite as good a product as it is a governance engine. Eliminate surface that requires internal-contract knowledge to operate safely.

## Requirements

### R1 — Single canonical CLI source

`templates/cli/**` and `.evo-lite/cli/**` MUST NOT both be editable git-tracked sources of the same file. Pick canonical:
- **Option A** (recommended): `templates/cli/` canonical. `.evo-lite/cli/` is auto-synced at install + `mem sync-runtime` time. `.evo-lite/cli/` added to `.gitignore` or treated as generated.
- **Option B**: `.evo-lite/cli/` canonical at dev time. CI/publish pipeline copies → `templates/cli/`.

Acceptance: editing one location and forgetting the other MUST produce a single, immediate, actionable error from `mem verify` (not silent template-sync warning).

### R2 — `/evo` prompts plan-for-in-flight work

When `mem verify` detects:
- uncommitted changes touching `ARCH_SOURCE_PATHS` or `PLAN_SOURCE_PATHS`
- AND no plan with status `draft` or `in_progress`
- AND backlog is the empty-placeholder sentinel

→ MUST emit guidance: `mem plan new --from-diff` (new command), which scaffolds spec + plan stubs with linked files prefilled from the diff.

### R3 — R008 amnesty + backfill

Two changes:
1. **Backfill command**: `mem plan archive-evidence --backfill` scans `.evo-lite/raw_memory/mem_*.md`, parses frontmatter / first-line content, and links archives to matching task IDs by heuristic (commit hash in filename, task id in body). Idempotent.
2. **Frontmatter grace**: plan frontmatter may declare `enforceR008From: "<ISO date>"`. Tasks completed before that date are exempt from R008.

Acceptance: after `--backfill` run, the 52 R008 warnings drop to a much smaller residual.

### R4 — MCP cache invalidation

evo-lite MCP server tools that read generated IR (`evo_plan_status`, `evo_architecture_status`, `evo_drift_status`, `evo_active_context`) MUST stat the underlying file on each request and reload when mtime newer than cached snapshot.

### R5 — `mem context auto-refresh`

New no-arg command:
- Reads active plan (highest-priority in_progress task's plan id)
- Re-derives focus string from plan title + current task subject
- Prunes backlog entries whose linked task is implemented/verified
- Idempotent; writes nothing if already consistent

Callable from hook (optional). Documented but not yet auto-fired.

### R6 — `mem architecture where <file>`

Reverse lookup. Output:
```
<file> → module:<id> (role: <role>, confidence: <n>)
linked plan tasks: <ids> | none
```

### R7 — Hook DX surface

- `mem hook diff` — compare installed `.git/hooks/post-commit` body vs current templates expected body; print unified diff or `in-sync`.
- `mem hook last` — pretty-print latest `post-commit-last-run.json` (commit, categories, command results, ok).
- `mem hook install --explain` — when upgrading, print what changed vs installed.

### R8 — CRLF noise

Project-level `.gitattributes` with `* text=auto eol=lf` (or appropriate per-pattern) so `git add` on the runtime mirror dirs stops printing CRLF warnings during tests on Windows.

## Non-Goals

- Renaming existing modules.
- Changing MCP tool surface signatures.
- Eliminating R006/R008 rules themselves (only their noise floor).
- Auto-firing `mem context auto-refresh` from hook (separate decision).

## Verification

- After R1: editing only one of `templates/cli/scan-native.js` or `.evo-lite/cli/scan-native.js` produces a hard error from `mem verify`. Editing the canonical one alone passes.
- After R2: `/evo` on a workspace with uncommitted governance edits AND no plan emits "create plan?" guidance with copy-pasteable command.
- After R3: drift report R008 count drops to < 10 on dogfood repo.
- After R4: `mem architecture scan` → immediate `mcp__evo-lite__evo_architecture_status` reflects new module count.
- After R5: `mem context auto-refresh` invoked twice in a row is no-op the second time.
- After R6: `mem architecture where templates/cli/hooks.js` returns `module:cli-entry` or successor.
- After R7: `mem hook diff` returns non-zero if hook drifted; `mem hook last` shows current commit hash; `mem hook install --explain` prints diff on upgrade.
- After R8: `git add .evo-lite/cli/hooks.js` produces no CRLF warning on Windows.

Full `node .evo-lite/cli/test.js` and `... governance` slices MUST pass.
