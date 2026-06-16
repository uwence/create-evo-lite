---
linkedSpec: spec:rc-closure-phase2-dx
r008Exempt: true
---

# RC Closure Phase 2 — DX Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Eliminate dogfood-observed DX friction across eight items (P0 dual-maintenance kill → P3 hook polish). Each task syncs runtime mirror until R1 lands, then the mirror becomes generated.

**Architecture:** Tasks ordered so R1 (kill dual maintenance) lands first — subsequent tasks edit only the canonical source. R3 (R008 backfill) and R4 (MCP cache) are fully independent and can parallel. R2 (plan-for-in-flight) depends on R6's reverse-lookup data shape. R7/R8 are polish, last.

**Tech Stack:** Node.js (fs, child_process, commander), MCP SDK, existing `parseFrontmatter`, raw_memory frontmatter parser.

---

## File Map

| File | Change |
|------|--------|
| `index.js` | MODIFY — `installCli(targetDir)` syncs runtime from templates |
| `templates/cli/runtime.js` | MODIFY — `mem sync-runtime` command + checksum check |
| `.gitignore` | MODIFY — ignore `.evo-lite/cli/` (or pinned by R1 decision) |
| `templates/cli/verify.js` (or memory.service.js section) | MODIFY — surface runtime-out-of-sync as hard error |
| `templates/cli/planning.js` | MODIFY — new `plan new --from-diff`, `plan archive-evidence --backfill` |
| `templates/cli/planning/backfill-evidence.js` | NEW — raw_memory frontmatter scan + heuristic match |
| `templates/cli/planning/gaps.js` | MODIFY — honor `enforceR008From` frontmatter |
| `templates/cli/planning/parse-markdown.js` | MODIFY — surface `enforceR008From` from plan frontmatter |
| `templates/cli/memory.service.js` | MODIFY — verify guidance for plan-for-in-flight |
| `templates/cli/mcp-server.js` | MODIFY — mtime-checked IR loaders |
| `templates/cli/context.js` (or memory.service section) | MODIFY — new `mem context auto-refresh` |
| `templates/cli/architecture.js` | MODIFY — new `mem architecture where <file>` |
| `templates/cli/hooks.js` | MODIFY — new `mem hook diff`, `mem hook last`, `--explain` flag |
| `.gitattributes` | NEW — eol normalization |
| `templates/cli/test.js` | MODIFY — T17..T24 covering each requirement |

---

### Task 1: R1 — Single canonical CLI source (P0)

**Files:**
- Modify: `index.js` (existing `installCli` flow)
- Modify: `templates/cli/runtime.js` (add `mem sync-runtime` subcommand)
- Modify: `templates/cli/memory.service.js` verify section (replace template-sync soft-warning with hard error path for cli mirror)
- Modify: `.gitignore` (add `.evo-lite/cli/` once R1 lands — see Step 6)
- Modify: `templates/cli/test.js` (T17)

- [x] **Step 1:** Write failing test T17 in `templates/cli/test.js`: edit `.evo-lite/cli/architecture/scan-native.js` to drift one line from `templates/cli/architecture/scan-native.js`; run `verify`; assert output includes a `runtime-out-of-sync` error and exit code non-zero.
- [x] **Step 2:** Add `mem sync-runtime` command: walks `templates/cli/` tree, copies every file under `.evo-lite/cli/` (overwriting), records SHA-256 of each file in `.evo-lite/generated/runtime-mirror.lock.json`.
- [x] **Step 3:** Extend `verify` to compare every `.evo-lite/cli/**` file's SHA-256 against the lock file. Mismatch → hard error with `Run mem sync-runtime to restore canonical templates/cli/ snapshot.`
- [x] **Step 4:** Run `mem sync-runtime` once in dogfood repo; commit the lock file.
- [x] **Step 5:** Update `installCli` (in `index.js`) to call `sync-runtime` on init.
- [x] **Step 6:** Add `.evo-lite/cli/` to `.gitignore`. Remove from index with `git rm --cached -r .evo-lite/cli/` in same commit. Lock file stays tracked.
- [x] **Step 7:** Verify T17 passes; run full + governance test slices.

**Status:** implemented
**Linked Files:** `index.js`, `templates/cli/runtime.js`, `templates/cli/memory.service.js`, `.gitignore`, `.gitattributes`

---

### Task 2: R4 — MCP cache invalidation (P2a)

**Files:**
- Modify: `templates/cli/mcp-server.js`
- Modify: `templates/cli/test.js` (T18)

- [x] **Step 1:** Write failing test T18: spawn MCP server in-process, call `evo_architecture_status`, capture moduleCount; rewrite `architecture-ir.json` with new moduleCount; call again; assert new value returned.
- [x] **Step 2:** Replace each IR-reading handler with `loadIrIfChanged(filePath, cachedSnapshot)` helper that compares `fs.statSync(filePath).mtimeMs` to cached snapshot's mtime; reload on miss.
- [x] **Step 3:** Apply to `evo_plan_status`, `evo_architecture_status`, `evo_drift_status`, `evo_active_context`.
- [x] **Step 4:** T18 passes.

**Status:** implemented
**Linked Files:** `templates/cli/mcp-server.js`

---

### Task 3: R3 — R008 amnesty + backfill (P1b)

**Files:**
- Create: `templates/cli/planning/backfill-evidence.js`
- Modify: `templates/cli/planning.js` (new subcommand `plan archive-evidence --backfill`)
- Modify: `templates/cli/planning/parse-markdown.js` (surface `enforceR008From`)
- Modify: `templates/cli/planning/gaps.js` (R008 honors `enforceR008From`)
- Modify: `templates/cli/test.js` (T19, T20)

- [x] **Step 1:** Write failing test T19: planIR with task implemented + 2026-06-15 completion date, plan frontmatter `enforceR008From: "2026-06-16"`; run `checkR008`; assert task NOT flagged.
- [x] **Step 2:** Modify `parseSuperPowersPlan` (or upstream) to read and expose `enforceR008From` per plan.
- [x] **Step 3:** Modify `checkR008` to skip tasks whose plan has `enforceR008From` newer than task's completion date / archive mtime.
- [x] **Step 4:** Write failing test T20: fixture raw_memory dir with archive whose frontmatter declares `linkedTask: task:foo`; planIR with `task:foo` implemented but no evidence; run `backfillArchiveEvidence`; assert `task:foo` now has `archive` field populated; second run is no-op.
- [x] **Step 5:** Implement `backfillArchiveEvidence(projectRoot)`: walk `.evo-lite/raw_memory/`, parse frontmatter for `linkedTask:` or scan body for task ids matching regex `task:[a-z0-9-]+`, mtime-rank if multiple match; write `archive:` field back to plan markdown (preserving formatting).
- [x] **Step 6:** Run on dogfood repo; verify R008 count drops below 10.

**Status:** implemented
**Linked Files:** `templates/cli/planning/backfill-evidence.js`, `templates/cli/planning.js`, `templates/cli/planning/parse-markdown.js`, `templates/cli/planning/gaps.js`

---

### Task 4: R6 — `mem architecture where <file>` (P2c)

**Files:**
- Modify: `templates/cli/architecture.js`
- Modify: `templates/cli/test.js` (T21)

- [x] **Step 1:** Write failing test T21: synth architecture-ir.json with one file; call `whereFile('foo.js')`; assert correct module id + role.
- [x] **Step 2:** Implement `whereFile(relPath)` reading architecture-ir.json `files[]` array; cross-reference plan-ir.json for linked tasks; format output.
- [x] **Step 3:** Wire as `mem architecture where <file>` subcommand.

**Status:** implemented
**Linked Files:** `templates/cli/architecture.js`

---

### Task 5: R5 — `mem context auto-refresh` (P2b)

**Files:**
- Modify: `templates/cli/memory.service.js` (or new `context.js`)
- Modify: `templates/cli/test.js` (T22)

- [x] **Step 1:** Write failing test T22: synth active_context with stale focus + a planIR with an in_progress task; call `contextAutoRefresh`; assert focus rewritten to plan title + task subject; call again; assert idempotent (no change).
- [x] **Step 2:** Implement: read planIR, pick highest-priority in_progress task (fallback: highest-priority draft plan), build focus string `<plan.title>: <task.subject>`, rewrite `<!-- BEGIN_FOCUS -->...<!-- END_FOCUS -->` slice atomically.
- [x] **Step 3:** Prune backlog entries whose `task:` link is implemented/verified.

**Status:** implemented
**Linked Files:** `templates/cli/memory.service.js`

---

### Task 6: R2 — `/evo` prompts plan-for-in-flight (P1a)

**Files:**
- Modify: `templates/cli/planning.js` (new subcommand `plan new --from-diff`)
- Modify: `templates/cli/memory.service.js` verify section
- Modify: `templates/cli/test.js` (T23)

- [x] **Step 1:** Write failing test T23: synth workspace with uncommitted ARCH file change, no plan in_progress, placeholder backlog; run `verify`; assert output contains `mem plan new --from-diff` guidance.
- [x] **Step 2:** Add detection logic to verify: query `git status --porcelain` + planIR + active_context backlog slice; emit guidance.
- [x] **Step 3:** Implement `plan new --from-diff`: scaffold spec stub + plan stub with frontmatter, prefill `linked files` block from `git diff --name-only`, slug from prompt or auto.

**Status:** implemented
**Linked Files:** `templates/cli/planning.js`, `templates/cli/memory.service.js`

---

### Task 7: R7 + R8 — Hook DX + CRLF noise (P3)

**Files:**
- Modify: `templates/cli/hooks.js` (new subcommands)
- Create: `.gitattributes`
- Modify: `templates/cli/test.js` (T24)

- [x] **Step 1:** Write failing test T24: install hook; assert `hook diff` returns `in-sync`; mutate installed hook by one line; assert `hook diff` exits non-zero with unified diff in output. Then write a fixture `post-commit-last-run.json`; assert `hook last` prints commit + categories + commands; finally drift-install and assert `hook install --explain` prints a diff before applying.
- [x] **Step 2:** Implement `mem hook diff` (read installed hook between sentinels; compare to `buildHookBody()`).
- [x] **Step 3:** Implement `mem hook last` (read `.evo-lite/generated/governance/post-commit-last-run.json`, render).
- [x] **Step 4:** Implement `--explain` flag on `hook install` that prints diff before write.
- [x] **Step 5:** Add `.gitattributes` at repo root: `* text=auto eol=lf` (or finer-grained per pattern).

**Status:** implemented
**Linked Files:** `templates/cli/hooks.js`, `.gitattributes`

---

## Verification After All Tasks

- `node .evo-lite/cli/test.js` — full suite pass
- `node .evo-lite/cli/test.js governance` — pass
- `mem plan gaps` — R008 < 10 on dogfood repo
- `mem verify` — no template-sync warnings; no runtime-out-of-sync errors
- `mem hook diff` — `in-sync`
- `mcp__evo-lite__evo_architecture_status` — reflects latest IR
- `git add .evo-lite/...` — no CRLF warnings on Windows
