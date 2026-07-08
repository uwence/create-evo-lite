---
id: plan:hive-nurture-engine-migration
status: draft
created: 2026-07-08
linkedSpec: spec:hive-nurture-engine-migration
---

# Hive Nurture — Engine-Migration Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the engine-migration hole exposed when the mother nurtured the zvec memory genes into child **CodePLC** on 2026-07-08. Nurture pushed new engine _code_ but the child's engine _state_ and _runtime dep_ did not follow, so a routine `rebuild` silently degraded and **duplicated the child's records (12 → 24)** while leaving the engine tagged `sqlite-fts5-trigram`. Make the engine-choice / engine-impl divergence safe, observable, and non-destructive across the nurture boundary.

## Field Evidence (CodePLC, 2026-07-08)

Reproduced end-to-end on the real child before this plan was written:

1. `resolveEngine()` returns `'zvec'` (nurtured `DEFAULT_ENGINE_CHOICE`), but `@zvec/zvec` is **not installed** in the child, so `getMemoryIndex()` silently falls back to `SqliteFtsIndex`.
2. `rebuildLocalIndex()` (`memory.service.js:1645-1665`) branches on the engine **choice** (`engine === 'zvec'`). Choice `zvec` skips the `fs.unlinkSync(DB_PATH)` drop that the sqlite branch performs. The sqlite table is never cleared, then the fallback impl appends 12 fresh rows → **24 duplicates**, all tagged trigram.
3. Nothing warned that the resolved engine (`zvec`) and the actual index impl (`sqlite`) diverged. Verify reported a healthy engine while the store was silently degraded.

Restoration applied manually (not part of this plan): forced clean sqlite rebuild → 12 rows, then pinned `.evo-lite/memory-engine.json` `{ "engine": "sqlite-fts5-trigram" }`. This plan replaces those manual steps with mechanism.

## Architecture

Three surgical changes, all inside the already-nurtured `memory-index` / `memory.service` / `hive` gene families — no new module family:

- **Impl-keyed drop:** `rebuildLocalIndex` decides drop-vs-wipe on the engine that will **actually be used** (`getMemoryIndex().engineId` / a `resolveActiveImpl()` helper), not the abstract choice. A sqlite-backed rebuild always drops the sqlite table first, whether the choice was `zvec` or `sqlite`.
- **Divergence signal:** `resolveEngine()` gains a companion that reports `{ choice, impl, degraded }`. `verify` and `rebuild` print an explicit WARN when `choice==='zvec'` but `impl==='sqlite'` (dep absent), naming the fix (`npm i @zvec/zvec` or pin sqlite).
- **Nurture engine-readiness preflight:** `hive nurture` extends its existing dependency report to flag, per child, when the pushed engine genes will resolve to a choice the child cannot run (zvec default + `@zvec/zvec` absent). Report + recommend only — **no state writes into the child** (genes-only constraint holds).

## Tech Stack

Node.js >=20, CommonJS, commander, hand-rolled governance suite (`cli/test/governance.js`). No new dependencies. `@zvec/zvec` stays an optional dep.

## Global Constraints

- **Double mirror:** every `cli/` change lands byte-identical in BOTH `templates/cli/**` (source) and `.evo-lite/cli/**` (live mirror). `npm test` runs `node ./.evo-lite/cli/test.js`.
- **Genes only, never state:** nurture must still never write `memory-engine.json`, `memory.db`, `raw_memory/`, or `index_memory/` into a child. The preflight reports; it does not pin.
- **Non-destructive migration:** a rebuild must never leave more records than the raw_memory archive count. Duplication is a hard failure the tests must catch.
- **Fallback stays silent-safe, loud-visible:** the zvec→sqlite fallback keeps working (no crash when dep absent) but must be surfaced by verify/rebuild, never hidden.
- **Behavior preservation:** `node ./.evo-lite/cli/test.js governance` and full `node ./.evo-lite/cli/test.js` stay green after every task.
- **Node floor:** `>=20.0.0`, CommonJS only.
- **Timestamps:** `new Date().toISOString()`; accept optional `now` injection in library fns for pinned-time tests.

---

### Task 1: Expose the actual engine impl (`resolveActiveImpl`)

Add a resolver that reports the engine that will actually be used, distinct from the configured choice, so callers can detect degradation.

**Files:**
- Modify: `templates/cli/memory-index.js` + `.evo-lite/cli/memory-index.js` (identical)
- Test: `templates/cli/test/governance.js` + `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: `resolveActiveImpl()` → `{ choice: string, impl: 'zvec'|'sqlite', degraded: boolean }`. `impl` is `'zvec'` only when `choice==='zvec'` AND the zvec index loads (`loadZvecIndex()` non-null); otherwise `'sqlite'`. `degraded` is `choice==='zvec' && impl==='sqlite'`. Uses the existing injected `loadZvecIndex` seam so tests simulate dep-absent without touching `node_modules`.

- [ ] **Step 1:** Write failing governance test `T-engine-impl`: inject `loadZvecIndex: () => null`, set choice `zvec` via env, assert `resolveActiveImpl()` returns `{ impl:'sqlite', degraded:true }`; with a truthy fake loader assert `{ impl:'zvec', degraded:false }`.
- [ ] **Step 2:** Run, confirm it fails (function absent).
- [ ] **Step 3:** Implement `resolveActiveImpl`; export it.
- [ ] **Step 4:** Run governance + full suite green.

### Task 2: Impl-keyed drop in `rebuildLocalIndex` (the duplication fix)

Make the rebuild drop the sqlite store whenever the **actual impl** is sqlite, closing the choice=zvec / impl=sqlite duplication path.

**Files:**
- Modify: `templates/cli/memory.service.js` + `.evo-lite/cli/memory.service.js` (`rebuildLocalIndex`, ~1645-1665)
- Test: `templates/cli/test/integration.js` + `.evo-lite/cli/test/integration.js`

**Interfaces:**
- Changes: the branch at `memory.service.js:1647` keys off `resolveActiveImpl().impl` instead of `resolveEngine() === 'zvec'`. `impl==='zvec'` → wipe zvec collection dir; `impl==='sqlite'` → backup + `unlinkSync(DB_PATH)` before `initDB()`. No signature change.

- [ ] **Step 1:** Write failing integration test: seed a temp workspace with N raw_memory archives + a pre-populated sqlite memory.db (N rows), inject `loadZvecIndex: () => null`, set choice `zvec`, run `rebuildLocalIndex`, assert final prose record count `=== N` (not `2N`) and engine tag `sqlite-fts5-trigram`.
- [ ] **Step 2:** Run, confirm it fails (count `2N`, reproducing the CodePLC bug).
- [ ] **Step 3:** Switch the branch to `resolveActiveImpl().impl`.
- [ ] **Step 4:** Run integration + governance + full suite green.

### Task 3: Surface engine degradation in `verify` and `rebuild`

Emit an explicit, actionable WARN when the resolved choice is `zvec` but the impl fell back to sqlite.

**Files:**
- Modify: `templates/cli/memory.service.js` + `.evo-lite/cli/memory.service.js` (verify engine section + rebuild preamble)
- Test: `templates/cli/test/governance.js` + `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: when `resolveActiveImpl().degraded`, verify prints a `⚠️ [引擎降级]` line naming the cause (`@zvec/zvec` absent) and the two fixes (install dep, or pin `memory-engine.json` to sqlite). Non-fatal (verify still exits 0 on an otherwise-healthy runtime). `rebuild` prints the same WARN before writing.

- [ ] **Step 1:** Write failing governance test capturing verify stdout with injected dep-absent + choice zvec; assert the degraded WARN string is present, and absent when impl matches choice.
- [ ] **Step 2:** Run, confirm it fails.
- [ ] **Step 3:** Add the WARN emit in both verify and rebuild paths.
- [ ] **Step 4:** Run governance + full suite green.

### Task 4: Nurture engine-readiness preflight (report-only)

Extend `hive nurture`'s dependency report so a child that will resolve to an unrunnable engine choice is flagged before/after the gene copy — without writing child state.

**Files:**
- Modify: `templates/cli/hive/nurture.js` (or the current nurture module) + `.evo-lite/cli/hive/nurture.js`
- Test: `templates/cli/test/governance.js` + `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces: after a nurture that ships the memory-engine genes, the receipt/report includes an `engineReadiness` entry: `{ childChoice: 'zvec', depPresent: false, recommendation: 'install @zvec/zvec in child, or pin memory-engine.json to sqlite-fts5-trigram then rebuild' }`. Detection reads the child's resolvable state read-only (probe `node_modules/@zvec/zvec` presence + child `memory-engine.json`); it MUST NOT create or modify any child file. `--json` surfaces the same object.

- [ ] **Step 1:** Write failing governance test with a synthetic child dir (no `@zvec/zvec`, no `memory-engine.json`); assert nurture report yields `engineReadiness.depPresent === false` and a non-empty recommendation; and that no file is written under the child (assert dir listing unchanged except the copied genes).
- [ ] **Step 2:** Run, confirm it fails.
- [ ] **Step 3:** Implement the read-only probe + report field.
- [ ] **Step 4:** Run governance + full suite green.

### Task 5: Capstone — real-child regression against CodePLC

Prove the three fixes hold on the real child that exposed the bug, with the dep still absent.

**Files:**
- Test: `templates/cli/test/integration.js` + `.evo-lite/cli/test/integration.js` (capstone block, synthetic mirror of the CodePLC shape — 12 archives, dep absent, choice zvec)

**Interfaces:**
- Verifies: full pipeline `nurture(report) → rebuild → verify` on the CodePLC-shaped fixture yields exactly 12 records (no duplication), a visible degradation WARN, and a nurture report flagging `depPresent:false`. No `@zvec/zvec` install, no child-state write.

- [ ] **Step 1:** Author the capstone integration block over the 12-archive fixture.
- [ ] **Step 2:** Run; confirm green end-to-end.
- [ ] **Step 3:** Run full `node ./.evo-lite/cli/test.js`; confirm the whole suite green.
- [ ] **Step 4:** Manual real-child check: `mem hive nurture CodePLC --dry-run` shows the engineReadiness flag; a forced sqlite rebuild in CodePLC stays at 12 records.

---

## Rollback

All changes are code-only (genes). Config-only rollback: revert the five gene files in both mirrors; no data migration is destructive because Task 2 preserves the sqlite `.bak` backup on every drop. The child's pinned `memory-engine.json` stays valid regardless.
