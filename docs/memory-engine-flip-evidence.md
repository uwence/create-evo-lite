# Memory Engine Flip — Evidence (2026-07-07)

Decision-gate evidence for `spec:memory-engine-default-flip`: is Zvec (jieba FTS)
good enough to become the default over `sqlite-fts5-trigram`? Ground truth =
literal case-insensitive substring containment over `raw_memory/*.md` bodies,
computed by `mem memory-ab` (graded). Run: `node .evo-lite/cli/memory.js memory-ab --from-logs`.

## Quantitative basis (`mem memory-ab`, graded)

27 queries (7 built-in hard cases + 20 sampled from `RECALL` logs). A query is
**scorable** only if some archived doc literally contains it (ground > 0); 15 of
27 are unscorable because the archive contains no doc with that literal string
(the synthetic hard cases `机器学习` / `语义检索` / `task:release-2.2.0-hardening-t5`
/ `DV800` / `recallViaText` are **not present in this archive**, so neither engine
can hit them — Zvec's jieba/colon advantages are simply not exercised by the
current corpus).

Scorable rows (ground > 0):

| query | ground | sqlite hit/prec | zvec hit/prec |
|---|---|---|---|
| memory.service | 4 | HIT 100% | HIT 100% |
| R008 | 7 | HIT 100% | HIT 100% |
| hook dogfood | 1 | HIT 20% | HIT 40% |
| context track | 4 | HIT 40% | HIT 60% |
| WorkflowClosureHardening | 1 | HIT 100% | HIT 100% |
| runtime hook | 1 | HIT 20% | HIT 60% |
| HookProvenanceSidecar | 1 | HIT 100% | HIT 100% |
| live runtime hook dogfood | 1 | HIT 33% | HIT 60% |
| template sync | 1 | HIT 20% | HIT 40% |
| **dogfood cycle** | 1 | **HIT 25%** | **miss 0%** |
| memory.service (dup from logs) | 4 | HIT 100% | HIT 100% |
| R008 (dup from logs) | 7 | HIT 100% | HIT 100% |

Aggregate over the 12 scorable queries:

- **sqlite hit-rate:** 100% · **zvec hit-rate:** 92%
- **sqlite mean precision:** 63% · **zvec mean precision:** 72%
- **Per-query regressions (SQLite HIT → Zvec miss):** **1** — `dogfood cycle`.

## The one regression, characterized

`dogfood cycle` (a two-word English query). The ground doc is "Two dogfood
**cycles** complete. Rollout Stage 5: default-on." — literal substring `dogfood
cycle` is contained. SQLite trigram surfaces it at rank 2. **Zvec does not** — its
jieba tokenization + BM25 OR-ranking pushes the exact-phrase doc out of top-5,
returning docs that match `cycle` / `dogfood` individually (and, cosmetically,
snippets that land in the archive front-matter rather than the matched body). This
is a genuine ranking difference for short multi-word English phrases, not a
grading artifact.

## Qualitative corroboration (from-logs judged sample)

| query | sqlite prec | zvec prec | verdict |
|---|---|---|---|
| runtime hook | 20% | 60% | zvec-better |
| context track | 40% | 60% | zvec-better |
| live runtime hook dogfood | 33% | 60% | zvec-better |
| hook dogfood | 20% | 40% | zvec-better |
| template sync | 20% | 40% | zvec-better |
| dogfood cycle | 25% (HIT) | 0% (miss) | **sqlite-better** |
| R008 / memory.service | 100% | 100% | tie |

5 zvec-better (higher precision), 1 sqlite-better (the regression), rest tie.

## Verdict

**NO-GO (for now).** The spec's GO threshold is "Zvec per-query hit ≥ SQLite on
**every** scorable query (no regression), precision not materially worse, and no
`sqlite-better` counterexample." This run fails it on two of the three clauses:
there is one per-query hit regression (`dogfood cycle`) and one `sqlite-better`
counterexample (the same query).

The aggregate favors Zvec on precision (+9 pts) and matches hit parity on 11 of 12
scorable queries, so Zvec is clearly *competitive* — but the evidence does **not**
show it decisively better on this real archive, and its headline advantages
(Chinese jieba recall, colon `task:`-id recall) are **not exercised** because the
current corpus has no docs literally containing those targets (15/27 unscorable).
Flipping the default on this evidence would trade a real, reproducible regression
on short English phrases for advantages the archive cannot yet demonstrate.

**Recommendation:** keep `sqlite-fts5-trigram` the default; retain Zvec as the
config-selectable engine (`memory-engine.json` / `EVO_LITE_MEMORY_ENGINE`) and
`mem memory-ab` as the reusable gate. Revisit the flip when either (a) the archive
accumulates Chinese / colon-id content that exercises Zvec's edge, or (b) the Zvec
query router gains a phrase-aware path (exact-phrase boost / `matchString` fallback
for multi-word queries) that closes the `dogfood cycle` class of regression.
