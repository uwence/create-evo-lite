---
id: spec:memory-engine-default-flip
status: done
created: 2026-07-07
linkedPlan: plan:memory-engine-default-flip
---

# Spec: Memory Engine Default-Flip (Evidence → Decision → Execution)

**Date:** 2026-07-07
**Depends on:** `spec:memory-index-abstraction` (seam), `spec:zvec-memory-index`
(`ZvecMemoryIndex`, engine selection, `mem memory-ab`), `docs/zvec-spike-findings.md`.

## Problem

`spec:zvec-memory-index` shipped `ZvecMemoryIndex` as a selectable **non-default**
engine and deliberately deferred the default-flip decision, gating it on "more
`mem memory-ab` parity data." The initial `mem memory-ab --from-logs` run over the
mother's real archive shows Zvec recalling documents SQLite trigram completely
misses (`task:`-ids via `matchString`, Chinese-semantic queries via jieba), but the
raw agreement number (22%) is dominated by **independent id assignment**, not recall
correctness — id-set divergence is expected and says nothing about who recalls
*better*. We lack a content-level judgment of whether Zvec is genuinely superior on
the cases SQLite currently passes, and we lack a runtime reindex path to populate a
real Zvec collection from history if we do flip.

## Approach: One Spec, Two Phases, One Decision Gate

```
Phase B (evidence)  ──►  DECISION GATE (user GO/NO-GO)  ──►  Phase A (execution, GO only)
build content-level      threshold guidance + human call     reindex + flip + list() fix
rubric, run it
```

Phase A tasks are **conditional**: the plan's decision-gate task presents Phase B
evidence and asks the user GO/NO-GO. On NO-GO the spec closes having delivered the
rubric + evidence only (default untouched); on GO, Phase A executes.

## Decision (2026-07-07): GO

The gate returned **GO**. Evidence: `docs/memory-engine-flip-evidence.md`
(`mem memory-ab --from-logs`, 12 scorable queries). Aggregate clearly favors Zvec:
**mean precision 72% vs SQLite 63%, hit parity on 11/12**, and **per-row precision
≥ SQLite on every scorable query except one**. Zvec wins precision on 5 rows, ties
6, and loses exactly 1 (`dogfood cycle`).

The spec's original threshold ("zero per-query regression") was applied first and
would have vetoed on that single row, but a precision-weighted read of the actual
data does not support NO-GO: the one regression is a **ranking miss, not data loss**
(the doc is still indexed; jieba-OR BM25 ranked the exact phrase out of top-5), it
is an **outlier not a pattern** (the other five multi-word English queries all
*improved* under Zvec), and it is **fixable** via a phrase-aware router. The
remaining caveat — 15/27 queries are unscorable because the archive has no doc
literally containing them, so Zvec's Chinese/colon advantages are not yet exercised
— argues the test is incomplete, not that Zvec is worse.

**Outcome:** flip the default to `zvec`. SQLite stays a first-class,
config-selectable engine and the config-only rollback target; `@zvec/zvec` stays an
optional dependency with `selectEngine` fallback (children not forced). Phase A
(Tasks 4–6) executes. The `dogfood cycle` short-phrase ranking regression is a
tracked follow-up (phrase-aware / exact-boost router), not a blocker.

## Phase B — Content-Level Recall Rubric

`mem memory-ab` today prints an id-divergence table. Phase B extends it into a
**graded** comparison so "who recalls better" is answerable, not just "the id sets
differ."

### B1. Quantitative basis (precision / recall on labeled intents)

Attach an **expected-hit label** to each `BUILTIN_QUERIES` entry — the doc(s) a
correct engine *should* surface, identified by a stable content fingerprint (a
substring guaranteed unique in the archive, e.g. the task-id token or a distinctive
phrase), NOT by id (ids differ per engine). For each query and each engine compute:

- **hit** — did the expected doc appear in top-K (K=5)?
- **precision@K** — fraction of returned docs that are on-topic per the label.
- **recall** — did every expected doc for that intent appear?

Print a per-query table (query · expected · sqlite hit/prec · zvec hit/prec) plus
aggregate hit-rate and mean precision per engine. Labels live in the doc/code as
committed constants so the measurement is reproducible, not vibes.

### B2. Qualitative corroboration (from-logs sampling)

From the existing `--from-logs` run (27 real spec/plan/commit-derived queries), take
a **judged sample of 5–8** of the *disagreement* rows and record, per row, a verdict:
`zvec-better` / `sqlite-better` / `tie` (both returned on-topic docs, id difference
is cosmetic). Goal is direction-of-travel corroboration, not coverage — it exists to
catch a qualitative counterexample the quantitative basis might miss.

### B3. Evidence artifact

Write the graded rubric output + the judged sample + a one-paragraph verdict to
`docs/memory-engine-flip-evidence.md`. This is the document the decision gate reads.

## Decision Gate (threshold guidance)

The GO decision is the **user's call** after reading B3 — not an automated flip. The
spec provides threshold *guidance* to frame that call:

- **GO** when, on the quantitative basis, Zvec's per-query hit-rate is **≥ SQLite's
  on every labeled query** (no regression on any case SQLite currently passes) AND
  mean precision does not materially regress AND the qualitative sample surfaces **no
  `sqlite-better` counterexample**.
- **NO-GO** otherwise → close having delivered B1–B3; default stays
  `sqlite-fts5-trigram`; the rubric remains as a reusable gate for a later attempt.

"No per-query regression" is the load-bearing criterion: the spike already proved
Zvec wins the cases SQLite *misses* — the only real risk is Zvec *losing* a case
SQLite handles (precision noise from jieba on clean code-symbol queries). The gate
must catch that, so it is per-query, not merely aggregate ≥.

## Phase A — Execution (GO only)

### A1. Engine-aware reindex (extend `rebuild`, do not add a parallel command)

`rebuildLocalIndex()` (`memory.service.js`) already reads `raw_memory/*.md` — the
**authoritative source** — clears index-memory markers, and funnels every archive
through `ingestArchiveFile → memorize → getMemoryIndex().upsert()`, which already
routes to the active engine. Only its **wipe preamble** is SQLite-hardcoded
(backup + delete `DB_PATH` + `initDB`). Make the wipe **engine-aware**:

- engine=`sqlite-fts5-trigram` → today's behavior (backup + wipe the SQLite DB).
- engine=`zvec` → close any open collection, delete `.evo-lite/zvec/collection` and
  `.evo-lite/zvec/nextid.json`, then let `syncIndexMemory()` repopulate via the seam.

This makes reindex **idempotent by full rebuild** (the confirmed strategy: every run
is a clean rebuild from the `.md` source, no dedup needed at the ~100-doc scale).
Surface it as `node .evo-lite/cli/memory.js rebuild` honoring the selected engine
(env or `memory-engine.json`); a flip is "set engine=zvec → `rebuild`."

### A2. Route `list()` through the seam (close the leak)

`list()` (`memory.service.js:691`) hardcodes `SELECT ... FROM raw_memory`, bypassing
the seam. After a flip, `memorize` writes to Zvec while `list` still reads the frozen
SQLite table → stale/misleading output. Fix: add a `list()` (a.k.a. `all()`) method
to the `MemoryIndex` contract; `SqliteFtsIndex.list()` runs today's query,
`ZvecMemoryIndex.list()` enumerates the collection (reuse `_allDocs()`). Route the
service `list()` through `getMemoryIndex().list()` so inspection always reflects the
active engine.

### A3. Flip the default

`DEFAULT_ENGINE_CHOICE` in `memory-index.js`: `'sqlite-fts5-trigram'` → `'zvec'`.
**Scope = global flip with fallback.** A hive child with the `@zvec/zvec` platform
prebuild adopts Zvec; a child lacking it hits the existing `selectEngine` fallback →
`SqliteFtsIndex` + one warning. No child is *broken* by lacking the optional dep, so
the "children-not-forced" guarantee holds; any instance can still pin
`memory-engine.json → { "engine": "sqlite-fts5-trigram" }` to opt out.

### A4. Rollback safety (state it explicitly)

`raw_memory/*.md` is the single source of truth; both engines' indexes are derived
and rebuildable from it. The SQLite index/table is **not deleted** by adopting Zvec
(Zvec lives under its own `.evo-lite/zvec/` dir). Rollback = set
`memory-engine.json → { "engine": "sqlite-fts5-trigram" }` (or unset to inherit the
new default — which is why an explicit pin is the rollback), with **zero data risk**.
Document this in the spec and the evidence artifact so the flip is reversible by
config alone.

### A5. Tests + docs

- `T-ENGINE` governance test: update the default-selection assertion — no config now
  resolves to Zvec **when `@zvec/zvec` is available**, and to `SqliteFtsIndex`
  (with warning) **when it is mocked unavailable** (the fallback path is now the
  default-experience guarantee for depless children).
- New `list()` contract test: `SqliteFtsIndex.list()` and `ZvecMemoryIndex.list()`
  return the same shape; the service `list()` reflects the active engine.
- New engine-aware `rebuild` test: with engine=zvec, `rebuild` wipes+repopulates the
  Zvec collection from `raw_memory/*.md` (skip-if-`@zvec/zvec`-unavailable).
- Update `docs/zvec-spike-findings.md` "Choosing the memory engine" section and any
  README/CLAUDE-facing note to say Zvec is now the default (with the fallback).

## Non-Goals

- **No embeddings / hybrid recall.** FTS-only, same as the seam's scope.
- **No mother/child default discriminator.** The flip is a single global constant +
  fallback; per-role defaults are explicitly out of scope (rejected in brainstorming).
- **No dedup index on the Zvec collection.** Reindex idempotency is by full rebuild,
  not content-hash dedup.
- **No change to the write pipeline** (`prepareForWrite`, secrets scan, namespace
  selection) — it already funnels through the seam correctly.
- **No auto-flip.** The GO decision is a human call at the gate; the threshold is
  guidance, not an automated trigger.
- **No removal of the SQLite engine.** It stays a first-class, config-selectable
  engine and the rollback target.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-graded-rubric",
      "description": "mem memory-ab computes per-query hit/precision against committed expected-hit labels for BUILTIN_QUERIES and prints aggregate hit-rate + mean precision per engine; degrades cleanly when @zvec/zvec is absent.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory-ab.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-flip-evidence-artifact",
      "description": "docs/memory-engine-flip-evidence.md exists with the graded quantitative table, the judged from-logs sample (5-8 rows with zvec-better/sqlite-better/tie verdicts), and a GO/NO-GO verdict paragraph.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["docs/memory-engine-flip-evidence.md"]
    },
    {
      "id": "ac-engine-aware-rebuild",
      "description": "rebuild is engine-aware: with engine=zvec it wipes .evo-lite/zvec/collection + nextid.json and repopulates from raw_memory/*.md via the seam; with engine=sqlite it keeps today's behavior. Full-rebuild idempotent. Skips cleanly when @zvec/zvec is absent.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory.service.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-list-through-seam",
      "description": "MemoryIndex contract has a list()/all() method; SqliteFtsIndex and ZvecMemoryIndex both implement it with the same shape; service list() routes through getMemoryIndex().list() so inspection reflects the active engine.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/memory-index-zvec.js", "templates/cli/memory.service.js"]
    },
    {
      "id": "ac-default-flip-fallback",
      "description": "DEFAULT_ENGINE_CHOICE is 'zvec'; no-config selection resolves to ZvecMemoryIndex when @zvec/zvec is available and falls back to SqliteFtsIndex with a warning when it is mocked unavailable; an explicit memory-engine.json pin to sqlite-fts5-trigram overrides (rollback path).",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-mirror-parity",
      "description": "templates/cli/** and .evo-lite/cli/** mirrors are byte-identical after the changes; mem sync-runtime verifies parity.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": [".evo-lite/cli/memory.service.js", ".evo-lite/cli/memory-index.js"]
    }
  ]
}
```

Note on the gate and `verify-contract` (which is strict PASS/FAIL, no
"out-of-scope" state): `ac-engine-aware-rebuild`, `ac-list-through-seam`, and
`ac-default-flip-fallback` presuppose GO. On **NO-GO**, the plan's decision-gate task
**amends this spec** — deleting those three flip criteria from the JSON block so the
retained set is `ac-graded-rubric` + `ac-flip-evidence-artifact` + `ac-mirror-parity`
— and the spec closes on that reduced set with the evidence artifact recording
verdict = NO-GO. The deleted flip work moves to a follow-up spec. `ac-mirror-parity`
holds in both branches (Phase B still edits `memory-ab.js`). This keeps closure
honest: every criterion that remains at close time is genuinely PASS.

## Manifest & Mirror

- No new gene files. Changes land in existing genes (`memory-index.js`,
  `memory-index-zvec.js`, `memory-ab.js`, `memory.service.js`, `test/governance.js`)
  already registered in `MANAGED_TEMPLATE_FAMILIES`.
- `docs/memory-engine-flip-evidence.md` is a doc artifact, not a gene.
- Author in `templates/cli/**`; `mem sync-runtime` mirrors byte-identical. No
  new-file self-brick risk this spec (all touched files already exist in both trees).

## Execution Model

Per `.agents/rules/execution-model.md`: decomposed by opus/fable. Intended executor
is the openai-codex plugin; while codex is down (0.142.5 OOM on Windows) opus runs
inline per the rule's Fallback clause, with the same review discipline.

## Follow-up (not this spec)

- `content_exact` second FTS field if the graded rubric reveals a code-symbol
  precision gap Zvec's single jieba field cannot close.
- Embeddings → hybrid recall.
- Fix the codex win32 binary to restore delegated execution.
