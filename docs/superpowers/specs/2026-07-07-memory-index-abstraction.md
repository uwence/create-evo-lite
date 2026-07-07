---
id: spec:memory-index-abstraction
status: draft
created: 2026-07-07
linkedPlan: plan:memory-index-abstraction
---

# Memory Index Abstraction — Spec

## Context

Evo-Lite's local recall runs on one engine: SQLite FTS5 with a `trigram`
tokenizer (`DEFAULT_ENGINE = 'sqlite-fts5-trigram'`, [`db.js`](../../../templates/cli/db.js)).
Every memory-document read/write reaches into SQLite directly and inline inside
[`memory.service.js`](../../../templates/cli/memory.service.js):

- `recallViaText(query, topK, options)` — builds a trigram MATCH query, ranks by
  `bm25`, falls back to `LIKE` (lines 657–709).
- `memorize(...)` — `INSERT INTO raw_memory ...` (line ~772).
- `forget(id)` — `DELETE FROM raw_memory WHERE id = ?` (line ~798).
- `stats()` — `getNamespaceCounts` + `COUNT(*)`/`MIN`/`MAX` over `raw_memory`.
- `rebuildLocalIndex()` — backup + `initDB()` + `syncIndexMemory()` ingest.

There is **no seam** between "how we search/store memory documents" and "we use
SQLite FTS5 trigram to do it." The engine label exists for *reporting*
(`getActiveEngineInfo`, verify output) but there is no pluggable implementation
behind it.

A separate analysis (Zvec as a candidate next-gen local memory engine — jieba
FTS + BM25 + future embeddings/hybrid recall) concluded: the strategic direction
is sound, but at today's scale (prose=99, code=1, symbol=0 records) a migration
buys nothing, and the trigram→jieba change carries a real code-symbol/path recall
regression risk. The correct, cheap, reversible first step — valuable regardless
of whether Zvec ever lands — is to extract the seam.

## Root Cause

The memory-document persistence concern is not isolated. SQLite/FTS specifics are
interleaved with orchestration concerns (secrets scanning, namespace selection,
CLI printing, log appends, DB backup) in the same functions. This blocks:

1. **Testing** the lexical layer without a live SQLite file.
2. **Swapping** the engine (e.g. a future `ZvecMemoryIndex`) without touching
   every consumer.
3. **Children choosing** their own engine during nurture.

## Goal

Introduce a `MemoryIndex` interface and a default `SqliteFtsIndex` implementation
that owns **all direct SQLite/FTS access for memory documents**. Refactor
`memory.service.js` so `recall`/`memorize`/`forget`/`stats` keep their **public
signatures and orchestration** and delegate only the DB/FTS specifics to the
index. `rebuildLocalIndex`/`syncIndexMemory` stay put — their writes already
funnel through `memorize`, which now writes via the index.

This is a **pure behavior-preserving refactor**. No new user-facing capability,
no engine swap, no schema change. Success = every existing recall/memorize/
forget/stats/rebuild test stays green and both runtime mirrors stay byte-identical.

## Non-Goals

- **Vector / hybrid / exact-token search** — rejected for this spec. `searchVector`
  / `searchExact` are exactly the methods a Zvec spike needs and nothing today
  uses them. Adding dead throwing stubs now is YAGNI. The interface covers only
  what the SQLite path does today; a later spec widens it when a real engine
  needs it.
- **Zvec implementation** — out of scope. This spec only creates the seam a
  future `ZvecMemoryIndex` would plug into.
- **Rewriting `initDB` / splitting the schema** — rejected. `initDB` also creates
  relational tables (`session_events`, `_meta`) that are *not* memory-document
  concerns. `MemoryIndex.initialize()` **delegates to the existing `initDB`**
  rather than duplicating or carving up the schema code. Lowest-risk path.
- **Moving relational access** (`session_events`, `_meta`, governance state,
  namespace fingerprints) behind the index — they stay direct SQLite. The index
  owns memory *documents* (`raw_memory` + `raw_memory_fts`) only.
- **Changing the engine label or `_meta` storage keys** — the on-disk fingerprint
  keys stay stable (no DB migration).

## Design

### The interface (documentation contract, not TypeScript)

`MemoryIndex` — every method that touches `raw_memory` / `raw_memory_fts`:

```
initialize()
    Ensure schema exists. Delegates to db.initDB(). Idempotent.

searchText(query, { topK = 5, scope = 'all' })
    Lexical recall. Returns [{ id, content, namespace, timestamp, score?,
    snippet, match_source }]. match_source ∈ { 'fts', 'like' }.
    Exactly the current recallViaText behavior: trigram MATCH + bm25 ORDER,
    LIKE fallback when FTS misses or errors.

upsert({ content, namespace, timestamp })
    Insert a memory document. Returns { id }. The fts5 shadow table is
    maintained by the existing AFTER INSERT trigger — no explicit fts write.

delete(id)
    DELETE FROM raw_memory WHERE id = ?. Returns { changes }. Throws nothing
    itself; the caller decides how to treat changes === 0 (forget keeps its
    "not found" error + CLI print).

stats()
    { chunks, count, namespaces, first, last } — the current stats() shape.

close()
    Release the DB handle. Delegates to db.closeDb().
```

Scope/namespace validation and trigram-query construction
(`generateTrigramQuery`) move **into** `SqliteFtsIndex` — they are
SQLite-FTS-specific.

### New module: `templates/cli/memory-index.js`

```js
'use strict';
const db = require('./db');

// SqliteFtsIndex — the default (and today only) MemoryIndex implementation.
// Owns all direct raw_memory / raw_memory_fts access. Engine label:
// db.DEFAULT_ENGINE ('sqlite-fts5-trigram').
class SqliteFtsIndex {
    initialize() { db.initDB(); }
    searchText(query, opts) { /* moved recallViaText body */ }
    upsert(doc) { /* moved INSERT, returns { id } */ }
    delete(id) { /* moved DELETE, returns { changes } */ }
    stats() { /* moved stats body */ }
    close() { db.closeDb(); }
    get engine() { return db.DEFAULT_ENGINE; }
}

let active = null;
function getMemoryIndex() {
    if (!active) active = new SqliteFtsIndex();
    return active;
}

module.exports = { SqliteFtsIndex, getMemoryIndex };
```

The factory is a seam only — no engine-selection config in this spec. A later
spec teaches `getMemoryIndex()` to read an engine choice.

### Wiring: `memory.service.js` becomes orchestration

Public functions keep their exact signatures; only the DB/FTS specifics move:

```js
const { getMemoryIndex } = require('./memory-index');

async function recall(query, topK = 5, options = {}) {
    const results = getMemoryIndex().searchText(query, { topK, scope: options.scope });
    appendLog('RECALL', ...);           // orchestration stays
    return results;
}

async function memorize(text, options = {}) {
    /* prepareForWrite secrets/namespace guard stays here */
    const { id } = getMemoryIndex().upsert({ content: richContent, namespace, timestamp });
    /* CLI print + appendLog stay here */
    return { id, offline: false, namespace };
}

function forget(id) {
    /* arg validation stays */
    const { changes } = getMemoryIndex().delete(id);
    if (changes === 0) throw new Error(`未找到 ID 为 ${id} 的记忆碎片。`);
    /* appendLog + CLI print stay */
}

function stats() { return getMemoryIndex().stats(); }
```

`rebuildLocalIndex` and `syncIndexMemory` stay in `memory.service.js` unchanged.
They are archive-ingest **orchestration** (file read, chunking, DB backup, marker
management), not index primitives. Their only write into `raw_memory` is via
`ingestArchiveFile → memorize(chunk)`, and `memorize` now writes through
`getMemoryIndex().upsert()`. So the rebuild path funnels through the same single
write chokepoint the index owns — no separate `rebuild()` method needed.

`recallViaText`, `generateTrigramQuery`, and the inline `stats` SQL are removed
from `memory.service.js` (their logic now lives in `SqliteFtsIndex`). If any
in-repo caller imports `recallViaText` directly, it is repointed to
`getMemoryIndex().searchText`; grep confirms consumers use the public
`recall`/`memorize`/`forget` surface, so no external signature changes.

### Consumers unaffected

`memory.js` (CLI), `mcp-server.js` (MCP tools), `inspector.js`,
`architecture/infer-modules.js`, and `test/integration.js` all call the public
`recall`/`memorize`/`forget`/`stats` surface. None change.

## Testing

Behavior-preservation is the whole game. The existing integration suite already
exercises recall (trigram + LIKE fallback), memorize, forget, and stats; it must
stay green unchanged — that is the primary proof the refactor preserved behavior.

New governance/unit coverage for the seam itself (`test/governance.js` or a
`memory-index` scope):

1. `searchText` returns FTS matches with `match_source: 'fts'` for a trigram hit.
2. `searchText` falls back to `match_source: 'like'` when FTS yields nothing.
3. `searchText` honors `scope` namespace filtering.
4. `upsert` returns a numeric `id` and the document is immediately recallable
   (trigger maintained the fts shadow).
5. `delete` returns `{ changes: 1 }` for an existing id, `{ changes: 0 }` for a
   missing id (and does not throw — the throw is the service's).
6. `stats` shape matches the pre-refactor `stats()` output on the same data.
7. `getMemoryIndex()` is a singleton (same instance on repeated calls) and its
   `engine` getter equals `db.DEFAULT_ENGINE`.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-index-seam-exists",
      "description": "memory-index.js exports SqliteFtsIndex + getMemoryIndex; memory.service.js delegates recall/memorize/forget/stats/rebuild to it and no longer accesses raw_memory/raw_memory_fts SQL inline.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/memory.service.js"]
    },
    {
      "id": "ac-behavior-preserved",
      "description": "The existing recall/memorize/forget/stats integration suite stays green after the refactor — behavior is byte-preserved.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/memory.service.js", "templates/cli/test/integration.js"]
    },
    {
      "id": "ac-index-unit-coverage",
      "description": "SqliteFtsIndex has direct unit coverage: searchText fts+like, upsert returns id, delete returns changes, stats shape, singleton + engine label.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-gene-registered",
      "description": "memory-index.js is registered in MANAGED_TEMPLATE_FAMILIES (it is a gene — engine code is mother-owned), so nurture propagates it to children.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/template-manifest.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-mirror-parity",
      "description": "templates/cli/** and .evo-lite/cli/** mirrors are byte-identical; mem sync-runtime verifies parity.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", ".evo-lite/cli/memory-index.js"]
    }
  ]
}
```

## Manifest & Mirror

- Register `memory-index.js` in `MANAGED_TEMPLATE_FAMILIES.core-cli.files`
  (it IS a gene — the engine implementation is mother-owned and nurtured to
  children).
- Author in `templates/cli/memory-index.js`; run `mem sync-runtime` to mirror to
  `.evo-lite/cli/memory-index.js` byte-identical. **Never edit `.evo-lite/cli/`
  directly.**
- `mem sync-runtime` parity check + `npm test` (mirror) both green before close.

## Execution Model

Per `.agents/rules/execution-model.md` (added alongside this spec): this plan is
**decomposed by opus/fable and executed by the openai-codex plugin**, with
opus/fable reviewing codex's output before close. The plan's tasks are written
to be codex-executable — each names exact files, exact functions to move, and a
verifiable done-check.

## Follow-up (not this spec)

- `ZvecMemoryIndex` FTS-only spike behind the new seam, gated on a real
  code-symbol/path recall A/B vs trigram (jieba + `content_exact` dual-field
  preprocessing) and Zvec native-binding maturity review.
- Engine-selection config so `getMemoryIndex()` can return a non-default engine
  (and children can choose one during nurture).
