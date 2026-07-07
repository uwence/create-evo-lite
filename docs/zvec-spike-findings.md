# Zvec Local-FTS Spike — Findings (2026-07-07)

Maturity + code-symbol-recall A/B for `@zvec/zvec` as a candidate next-gen local
memory engine behind the `MemoryIndex` seam (`spec:memory-index-abstraction`,
shipped). This is the gate that spec's follow-up required before committing to a
`ZvecMemoryIndex`.

**Verdict: GO for a `ZvecMemoryIndex` FTS-only spike behind the seam** — with one
hard design constraint discovered (colon-token queries must use `matchString`,
not `queryString`).

## Environment / maturity

- `@zvec/zvec@0.5.0`, installed clean on Windows x64 / Node v22.22.2. **This is the
  latest npm release** — the npm `latest` dist-tag is 0.5.0 and `@zvec/zvec@0.5.1`
  returns E404. The "0.5.1 (2026-06-24)" figure is the **core C++ project's GitHub
  release** (`alibaba/zvec`), which versions independently of the Node binding. The
  binding lags the core release — an adoption-risk data point (young dep, binding
  publish cadence trails the core).
- Native binding `@zvec/bindings-win32-x64` resolved and **`require()` loaded fine**
  — unlike the codex CLI's broken win32 binary; Zvec's own binding is healthy here.
- In-process, WAL-durable, single-writer / multi-reader. jieba dict ships bundled
  (`ZVecGetDefaultJiebaDictDir()` resolves inside the package).
- FTS is a scalar STRING field with `indexParams: { indexType: FTS(11), tokenizerName }`.
  Query via `collection.querySync({ fieldName, topk, fts: { queryString | matchString } })`.

## A/B: tokenizer × evo-lite hard recall targets

Hit = true doc returned. Targets are the code-symbol / path / hash / task-id /
Chinese cases trigram was originally chosen for.

| query | standard | jieba | whitespace | trigram (today) |
|---|---|---|---|---|
| `memory.service` (path substring) | HIT | HIT | **miss** | HIT |
| `recallViaText` (camelCase) | HIT | HIT | HIT | HIT |
| `R008` (rule token) | HIT | HIT | HIT | HIT |
| `94d57c05` (commit hash) | HIT | HIT | HIT | HIT |
| `DV800` (device prefix) | HIT | HIT | **miss** | HIT |
| `2198-D012-ERS3` (serial) | HIT | HIT | HIT | HIT |
| `机器学习` (Chinese word) | **miss** | HIT | **miss** | HIT |
| `语义检索` (Chinese word) | **miss** | HIT | **miss** | HIT |
| `task:release-2.2.0-hardening-t5` | **ERR** | **ERR** | **ERR** | HIT |

- **jieba is the only tokenizer covering both Chinese NL and code/symbol/path/hash.**
  standard misses Chinese words; whitespace misses paths + Chinese + device models.
- jieba adds mild precision noise (`memory.service` → `[d1, d2]`) but the true hit
  ranks first; acceptable for a recall-biased memory store (BM25 orders correctly).

## The colon blocker (decisive design constraint)

`queryString` runs through Zvec's query **parser**, which treats `:` as a
field-prefix operator. Every evo-lite identifier — `task:…`, `spec:…`, `plan:…` —
therefore throws `FTS query parse failed: field-prefixed queries are not supported`.
Backslash-escaping (`task\:…`) does **not** help.

**Workaround confirmed working:** `matchString` (literal, unparsed) returns the
right docs for `task:release-2.2.0-hardening-t5`, `memory.service.js`, `R008` on
both jieba and standard. So a `ZvecMemoryIndex` must:

- route queries containing parser-hostile chars (`:` etc.) through `matchString`, and
- use `queryString` (+ jieba, default OR) for clean multi-term natural-language recall.

## Implications for a `ZvecMemoryIndex` design

1. Single **jieba** FTS field is enough to cover today's trigram recall surface —
   the memo's dual-field (content_text + content_exact) scheme is **not required**
   for parity; it becomes an optimization, not a prerequisite.
2. Query router: `queryString` for NL, `matchString` fallback when the query has
   `:` / operator chars. This replaces `generateTrigramQuery`.
3. Keep it FTS-only (no embeddings) for the first cut — same as the seam's scope.
4. Still gated behind the seam: implement `ZvecMemoryIndex` with the same
   `searchText / upsert / delete / stats / initialize / close` contract, dual-write
   + dual-query A/B against `SqliteFtsIndex` on the real archive before making it
   default. Native-binding dependency review (bundle size, per-platform prebuilds,
   children self-hosting during nurture) is the remaining adoption risk, not recall.

Probe scripts: `scratchpad/zvec-probe/ab.js`, `ab2.js` (throwaway, not committed).
