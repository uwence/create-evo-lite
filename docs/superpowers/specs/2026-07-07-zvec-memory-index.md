---
id: spec:zvec-memory-index
status: draft
created: 2026-07-07
linkedPlan: plan:zvec-memory-index
---

# Zvec Memory Index — Spec

## Context

`spec:memory-index-abstraction` (shipped) extracted a `MemoryIndex` seam:
`SqliteFtsIndex` behind `getMemoryIndex()`, with `memory.service.js` delegating
`recall`/`memorize`/`forget`/`stats`. The seam's follow-up was a `ZvecMemoryIndex`
gated on a maturity + code-symbol-recall review.

That review ran (`docs/zvec-spike-findings.md`, 2026-07-07) and returned **GO**:

- `@zvec/zvec@0.5.0` (latest npm) loads clean on Windows x64 / Node 22; jieba dict
  bundled; in-process, WAL-durable.
- **jieba is the only tokenizer covering both Chinese NL and code/symbol/path/hash
  recall** — the surface trigram was chosen for.
- **Decisive constraint:** identifiers containing `:` (`task:…`, `spec:…`, `plan:…`)
  throw `field-prefixed queries are not supported` through Zvec's `queryString`
  parser; escaping does not help. `matchString` (literal, unparsed) is the confirmed
  workaround.

## Goal

Ship `ZvecMemoryIndex` as a **selectable, non-default** memory engine behind the
existing seam, plus the tooling to validate it against `SqliteFtsIndex` on the real
archive. SQLite stays the default everywhere; the eventual default-flip is a
separate later spec, gated on the A/B evidence this spec makes collectable.

## Non-Goals

- **Flipping the default to Zvec** — rejected for this spec (user decision). SQLite
  remains the default for the mother and all children. A future spec flips it after
  A/B data on a real archive justifies it.
- **Forcing Zvec on hive children** — rejected (user decision). `@zvec/zvec` is an
  **optionalDependency**, not a hard dependency. Children that lack it (or a
  platform prebuild) fall back to `SqliteFtsIndex`. Nurture does not push a native
  dependency onto children.
- **Embeddings / hybrid / vector recall** — out of scope. FTS-only, same as the
  seam. `searchVector` stays absent from the interface.
- **Runtime dual-write** — rejected. Writing every memory to both engines on the hot
  path is heavy and needless. Validation is an **offline** A/B command that rebuilds
  a Zvec index from the archive and compares recall.
- **Reusing the SQLite `raw_memory` table for Zvec ids** — rejected. `ZvecMemoryIndex`
  owns its store fully (its own collection + id counter); the seam contract is
  engine-agnostic and each engine is self-contained.

## Design

### `ZvecMemoryIndex` (new gene: `templates/cli/memory-index-zvec.js`)

Implements the **same contract** as `SqliteFtsIndex`:
`initialize() / searchText(query, {topK, scope}) / upsert({content, namespace,
timestamp}) / delete(id) / stats() / close()` + `engine` getter (`'zvec-jieba-fts'`).

- **Store:** a Zvec collection under `.evo-lite/zvec/` (derived, git-ignored,
  rebuildable from `raw_memory/*.md`). Schema:
  - `content` — `STRING`, FTS index, `tokenizerName: 'jieba'`.
  - `namespace` — `STRING`, invert index (for scope filtering).
  - `timestamp` — `STRING`.
  - doc `id` — the string form of a monotonic numeric id.
- **Id management:** a sidecar counter file `.evo-lite/zvec/nextid.json`
  (`{ next: <int> }`). `upsert` reads-increments-writes it (single-writer CLI, no
  race) and returns `{ id: <number> }` — matching `SqliteFtsIndex.upsert`'s shape so
  `memorize` is unchanged. `initialize()` seeds the counter to
  `max(existing doc ids)+1` if the sidecar is missing (e.g. after a hand-copied
  collection).
- **searchText query router** (replaces `generateTrigramQuery`):
  1. Try `queryString` (jieba, `defaultOperator: 'OR'`) — full NL recall power.
  2. On a Zvec parse error (the `:`/operator case), retry the same query as
     `matchString` (literal). This try/catch router is more robust than enumerating
     hostile characters and future-proofs new parser syntax.
  Returns `[{ id, content, namespace, timestamp, score, snippet, match_source }]`
  with `match_source ∈ { 'zvec-fts', 'zvec-match' }`. `snippet` reuses the same
  snippet helper shape as the SQLite path (extract to a shared `memory-index-util.js`
  so both engines share `generateSnippet`; `generateTrigramQuery`/`bm25RankToScore`
  stay SQLite-only).
  Scope filtering uses a Zvec scalar `filter` on `namespace`.
- **delete(id):** delete the doc by string id; return `{ changes: 0|1 }`.
- **stats():** `{ chunks, count, namespaces, first, last }` — same shape; counts +
  per-namespace tallies from the collection.

### Engine selection (`getMemoryIndex()` in `memory-index.js`)

```
resolveEngine():
  env EVO_LITE_MEMORY_ENGINE
  || read .evo-lite/memory-engine.json { "engine": "zvec" | "sqlite-fts5-trigram" }
  || default 'sqlite-fts5-trigram'

getMemoryIndex():
  if resolved === 'zvec':
     try { require('@zvec/zvec'); return new ZvecMemoryIndex(); }
     catch { warn("Zvec engine selected but @zvec/zvec unavailable — falling back
                   to SqliteFtsIndex"); return new SqliteFtsIndex(); }
  return new SqliteFtsIndex();     // default
  (memoized — singleton, same as today)
```

- `.evo-lite/memory-engine.json` is **project-state, not a gene** (absent from
  `MANAGED_TEMPLATE_FAMILIES`) — nurture never overwrites a child's engine choice,
  exactly like `command-policy.json`.
- The lazy `require` + fallback is the mechanism that keeps children who lack the
  optional dependency working: they simply run SQLite regardless of config.

### `@zvec/zvec` as an optional dependency

Added to `package.json` `optionalDependencies` (`"^0.5.0"`), never `dependencies`.
`npm install` on a platform without a prebuild skips it without failing the install;
`getMemoryIndex()` then falls back. Document that opting into Zvec is
`npm i @zvec/zvec` + setting the engine config.

### Offline A/B command: `mem memory-ab`

`node .evo-lite/cli/memory.js memory-ab`:

1. Rebuild a throwaway `ZvecMemoryIndex` from every `raw_memory/*.md` archive
   (reuse the existing archive parse the SQLite rebuild uses).
2. Run a query set — a built-in list of the spike's hard cases (code path, camelCase
   symbol, rule token, commit hash, full `task:` id, Chinese words, device/serial),
   plus, with `--from-logs`, queries sampled from `RECALL*` log lines.
3. Print a per-query divergence table: SQLite hit ids vs Zvec hit ids, agreement %,
   and the queries where they differ. This is the evidence a later default-flip spec
   consumes. Read-only; writes no memory. If `@zvec/zvec` is unavailable the command
   prints a clear "install @zvec/zvec to run the A/B" notice and exits 0.

### Data flow

`memorize`/`recall`/`forget`/`stats` are unchanged — they call `getMemoryIndex()`,
which now may return `ZvecMemoryIndex`. The rebuild path
(`ingestArchiveFile → memorize → upsert`) already funnels through the seam, so
rebuilding under the Zvec engine populates the Zvec collection with no service change.

## Testing

Governance suite (`test/governance.js`), all **skip-if-`@zvec/zvec`-unavailable** so
CI without the optional dep still passes:

1. `ZvecMemoryIndex` round-trips: `upsert` returns a numeric id; the doc is
   immediately recallable via `searchText`; `match_source: 'zvec-fts'`.
2. Query router: a `task:foo-t5` query (colon) returns the doc via the `matchString`
   fallback with `match_source: 'zvec-match'` and does not throw.
3. jieba Chinese recall: a Chinese-word query hits a Chinese doc.
4. `scope` filtering restricts to one namespace.
5. `delete` returns `{ changes: 1 }` for a hit, `{ changes: 0 }` for a miss.
6. `stats` shape equals the `SqliteFtsIndex.stats` shape on the same docs.

Engine-selection tests (run always, no Zvec needed):

7. Default (no config) → `getMemoryIndex()` is a `SqliteFtsIndex`.
8. Config `engine: 'zvec'` **with `@zvec/zvec` mocked as unavailable** → falls back to
   `SqliteFtsIndex` and warns (this is the child-without-dep guarantee).
9. `EVO_LITE_MEMORY_ENGINE` overrides the JSON config.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-zvec-index-contract",
      "description": "ZvecMemoryIndex implements the MemoryIndex contract (searchText/upsert/delete/stats/initialize/close/engine) and round-trips; the colon-query matchString fallback works. Skips cleanly when @zvec/zvec is absent.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index-zvec.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-engine-selection-fallback",
      "description": "getMemoryIndex() returns SqliteFtsIndex by default; when engine=zvec is configured but @zvec/zvec is unavailable, it falls back to SqliteFtsIndex with a warning (children-not-forced guarantee).",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-memory-ab-command",
      "description": "mem memory-ab rebuilds a Zvec index from the archive and prints a SQLite-vs-Zvec recall divergence table; read-only; degrades cleanly when @zvec/zvec is absent.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory.js", "templates/cli/memory-index-zvec.js"]
    },
    {
      "id": "ac-zvec-optional-not-gene-config",
      "description": "@zvec/zvec is an optionalDependency (not dependencies); memory-engine.json is project-state (absent from MANAGED_TEMPLATE_FAMILIES) so nurture never overwrites a child's engine choice; .evo-lite/zvec/ is git-ignored.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["package.json", "templates/cli/template-manifest.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-mirror-parity",
      "description": "templates/cli/** and .evo-lite/cli/** mirrors are byte-identical after adding the new modules; mem sync-runtime verifies parity.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index-zvec.js", ".evo-lite/cli/memory-index-zvec.js"]
    }
  ]
}
```

## Manifest & Mirror

- Register `memory-index-zvec.js` and `memory-index-util.js` in
  `MANAGED_TEMPLATE_FAMILIES.core-cli.files` (genes — engine code is mother-owned).
- Do **not** register `.evo-lite/memory-engine.json` (project state).
- `.evo-lite/zvec/` needs **no** gitignore change — the existing `.evo-lite/*`
  ignore already covers it (it is a derived, rebuildable index, correctly untracked).
- Un-ignore `.evo-lite/memory-engine.json` (add `!.evo-lite/memory-engine.json` to
  root `.gitignore` and `templates/gitignore`, same as `command-policy` is
  un-ignored) so an opted-in engine choice is a committable, inspectable artifact.
- Author in `templates/cli/**`; `mem sync-runtime` mirrors byte-identical; a new
  managed file must be registered in the manifest **before** sync-runtime will mirror
  it (two-pass sync — the `sync-runtime` self-brick pattern).

## Execution Model

Per `.agents/rules/execution-model.md`: decomposed by opus/fable. Intended executor
is the openai-codex plugin; while codex is down (0.142.5 OOM on Windows) opus runs
inline per the rule's Fallback clause, with the same review discipline.

## Follow-up (not this spec)

- Default-flip spec: after `mem memory-ab` shows acceptable recall parity on a real
  archive, flip the default engine to Zvec (mother first, children opt-in).
- `content_exact` second field / preprocessing if the A/B reveals code-symbol misses
  the jieba+matchString router doesn't cover.
- Embeddings → hybrid recall once a local embedding model is chosen.
