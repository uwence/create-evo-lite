---
id: plan:memory-index-abstraction
linkedSpec: spec:memory-index-abstraction
format: superpowers
status: draft
---

# Memory Index Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution model (per `.agents/rules/execution-model.md`):** opus/fable decompose + review; the openai-codex plugin executes each task. Each task below names exact files, exact functions to move, complete code, and a verifiable done-check so codex can run it without further context.

**Goal:** Extract a `MemoryIndex` seam (`SqliteFtsIndex` + `getMemoryIndex()`) that owns all direct `raw_memory`/`raw_memory_fts` access, so `memory.service.js` becomes orchestration that delegates — a pure behavior-preserving refactor.

**Architecture:** New gene module `templates/cli/memory-index.js` holds `SqliteFtsIndex` (moved `recallViaText`, the `INSERT`/`DELETE`, `stats`, and the recall-only helpers `generateTrigramQuery`/`bm25RankToScore`/`generateSnippet`, plus a private `appendLog`). `memory.service.js` public functions `recall`/`memorize`/`forget`/`stats` keep their signatures and delegate. `rebuildLocalIndex`/`syncIndexMemory` stay put — their only write funnels through `memorize` → `upsert`.

**Tech Stack:** Node.js (CommonJS), `better-sqlite3`, SQLite FTS5 (trigram), evo-lite governance test harness.

## Global Constraints

- **Author only in `templates/cli/**`.** Never edit `.evo-lite/cli/` directly. After each `templates/cli` change run `node .evo-lite/cli/memory.js sync-runtime` to mirror byte-identical, then run tests against `.evo-lite/cli`.
- **Behavior-preserving.** The existing `recall`/`memorize`/`forget`/`stats` integration suite must stay green unchanged. No schema change, no engine-label change, no `_meta` key change.
- **No new capability.** No `searchVector`/`searchExact`/`rebuild()` on the interface (YAGNI — deferred to a later Zvec spec).
- **Engine label stays** `db.DEFAULT_ENGINE` = `'sqlite-fts5-trigram'`.
- **Verifier command** is always `node ./.evo-lite/cli/test.js <scope>` (the only allowlisted command per `command-policy.json`). Valid scopes are `governance` (governance suite only) and `all` (governance + integration); there is no standalone `integration` scope — use `all` to exercise integration.
- **No circular require:** `memory-index.js` may require `./db` and `./runtime` only — never `./memory.service`.

---

### Task 1: Create the `SqliteFtsIndex` gene module with unit coverage

**Files:**
- Create: `templates/cli/memory-index.js`
- Modify: `templates/cli/test/governance.js` (append new cases)
- Mirror after edit: `.evo-lite/cli/memory-index.js`, `.evo-lite/cli/test/governance.js` (via `sync-runtime`)

**Interfaces:**
- Consumes (from `./db`): `getDb`, `tableExists`, `getNamespaces`, `isValidNamespace`, `getNamespaceCounts`, `initDB`, `closeDb`, `DEFAULT_NAMESPACE`, `DEFAULT_ENGINE`. From `./runtime`: `getLogPath`.
- Produces (later tasks rely on these exact names):
  - `getMemoryIndex()` → singleton `SqliteFtsIndex`.
  - `SqliteFtsIndex#searchText(query, { topK = 5, scope = 'all' })` → `Array<{ id, content, namespace, timestamp, score?, snippet, match_source }>`, `match_source ∈ {'fts','like'}`.
  - `SqliteFtsIndex#upsert({ content, namespace, timestamp })` → `{ id: number }`.
  - `SqliteFtsIndex#delete(id)` → `{ changes: number }`.
  - `SqliteFtsIndex#stats()` → `{ chunks, count, namespaces, first, last }`.
  - `SqliteFtsIndex#initialize()` → void (delegates `db.initDB()`).
  - `SqliteFtsIndex#close()` → void (delegates `db.closeDb()`).
  - `SqliteFtsIndex#engine` (getter) → `db.DEFAULT_ENGINE`.

- [x] **Step 1: Write the new module.** Create `templates/cli/memory-index.js` with exactly:

```js
'use strict';

const {
    DEFAULT_ENGINE,
    DEFAULT_NAMESPACE,
    closeDb,
    getDb,
    getNamespaceCounts,
    getNamespaces,
    initDB,
    isValidNamespace,
    tableExists,
} = require('./db');
const { getLogPath } = require('./runtime');

const fs = require('fs');

const LOG_PATH = getLogPath();

// Private logger — identical shape to memory.service.js appendLog. Kept local
// (not imported from the service) to avoid a memory-index ↔ memory.service
// circular require. Both resolve the same path via runtime.getLogPath().
function appendLog(action, content) {
    try {
        fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${action}: ${content}\n`, 'utf8');
    } catch (_) {}
}

// Recall-only helpers, moved verbatim from memory.service.js.
function generateTrigramQuery(query) {
    if (!query) {
        return query;
    }

    const tokens = query
        .replace(/[^\w\s一-龥]/gi, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return query;
    }

    return tokens.map(token => {
        if (token.length <= 3) {
            return token;
        }
        const chars = Array.from(token);
        const parts = [];
        for (let i = 0; i < chars.length - 2; i += 1) {
            parts.push(chars[i] + chars[i + 1] + chars[i + 2]);
        }
        return parts.length > 0 ? `(${parts.join(' AND ')})` : token;
    }).join(' AND ');
}

function bm25RankToScore(rank) {
    return 1 / (1 + Math.exp(rank));
}

function generateSnippet(content, query, maxChars = 200) {
    const keywords = query.replace(/[^\w\s一-龥]/gi, ' ').split(/\s+/).filter(Boolean);
    if (keywords.length === 0) {
        return content.slice(0, maxChars);
    }

    const lowerContent = content.toLowerCase();
    let matchIndex = -1;
    for (const keyword of keywords) {
        const index = lowerContent.indexOf(keyword.toLowerCase());
        if (index !== -1) {
            matchIndex = index;
            break;
        }
    }

    if (matchIndex === -1) {
        return content.slice(0, maxChars);
    }

    const start = Math.max(0, matchIndex - Math.floor(maxChars / 2));
    let snippet = content.slice(start, start + maxChars);
    if (start > 0) {
        snippet = `...${snippet}`;
    }
    if (start + maxChars < content.length) {
        snippet = `${snippet}...`;
    }
    return snippet;
}

// SqliteFtsIndex — default (and today only) MemoryIndex implementation.
// Owns all direct raw_memory / raw_memory_fts access for memory documents.
class SqliteFtsIndex {
    initialize() {
        initDB();
    }

    get engine() {
        return DEFAULT_ENGINE;
    }

    searchText(query, options = {}) {
        const topK = options.topK || 5;
        const db = getDb();
        const scope = options.scope || 'all';
        const namespaces = scope === 'all'
            ? getNamespaces()
            : [scope].filter(namespace => isValidNamespace(namespace));

        if (tableExists(db, 'raw_memory_fts')) {
            const params = [generateTrigramQuery(query)];
            let sql = `
            SELECT
                f.rowid AS id,
                r.content,
                r.namespace,
                r.timestamp,
                bm25(raw_memory_fts, 1.0, 0.0) AS bm25_rank
            FROM raw_memory_fts f
            JOIN raw_memory r ON f.rowid = r.id
            WHERE raw_memory_fts MATCH ?
        `;

            if (scope !== 'all' && namespaces.length > 0) {
                sql += ` AND r.namespace IN (${namespaces.map(() => '?').join(',')})`;
                params.push(...namespaces);
            }

            sql += ' ORDER BY bm25_rank ASC LIMIT ?';
            params.push(topK);

            try {
                const rows = db.prepare(sql).all(...params);
                if (rows.length > 0) {
                    appendLog('RECALL_FTS', `Queried "${query}" scope=${scope}, returned ${rows.length} trigram matches.`);
                    return rows.map(row => ({
                        ...row,
                        score: bm25RankToScore(row.bm25_rank),
                        snippet: generateSnippet(row.content, query),
                        match_source: 'fts',
                    }));
                }
            } catch (error) {
                appendLog('RECALL_FTS_ERROR', `${query} | ${error.message}`);
            }
        }

        const likeResults = db.prepare('SELECT id, content, namespace, timestamp FROM raw_memory WHERE content LIKE ? LIMIT ?').all(`%${query}%`, topK);
        appendLog('RECALL_FALLBACK', `Queried "${query}" scope=${scope}, returned ${likeResults.length} LIKE matches.`);
        return likeResults.map(row => ({
            ...row,
            snippet: generateSnippet(row.content, query),
            match_source: 'like',
        }));
    }

    upsert(doc = {}) {
        const db = getDb();
        const rawMemoryId = db.prepare('INSERT INTO raw_memory (content, namespace, timestamp) VALUES (?, ?, ?)').run(
            doc.content,
            doc.namespace,
            doc.timestamp
        ).lastInsertRowid;
        return { id: Number(rawMemoryId) };
    }

    delete(id) {
        const db = getDb();
        const info = db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);
        return { changes: info.changes };
    }

    stats() {
        const db = getDb();
        const namespaceCounts = getNamespaceCounts(db);
        let totalChunks = 0;
        for (const ns of Object.keys(namespaceCounts)) {
            totalChunks += namespaceCounts[ns].chunks || 0;
        }
        return {
            chunks: totalChunks,
            count: db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count,
            namespaces: namespaceCounts,
            ...db.prepare('SELECT MIN(timestamp) AS first, MAX(timestamp) AS last FROM raw_memory').get(),
        };
    }

    close() {
        closeDb();
    }
}

let active = null;

function getMemoryIndex() {
    if (!active) {
        active = new SqliteFtsIndex();
    }
    return active;
}

module.exports = { SqliteFtsIndex, getMemoryIndex };
```

- [x] **Step 2: Add unit tests to `templates/cli/test/governance.js`.** Open the file, find the pattern the existing governance cases follow (each is a `test('...', () => { ... })`-style entry or a numbered `T##` block — match the surrounding style exactly). Add cases that require `../memory-index` and `../db`, seed a temp DB via `initDB()`, and assert:

```js
// --- MemoryIndex seam (spec:memory-index-abstraction) ---
const { getMemoryIndex, SqliteFtsIndex } = require('../memory-index');

// T-MI-1: singleton + engine label
{
    const a = getMemoryIndex();
    const b = getMemoryIndex();
    assert.strictEqual(a, b, 'getMemoryIndex must be a singleton');
    assert.ok(a instanceof SqliteFtsIndex);
    assert.strictEqual(a.engine, require('../db').DEFAULT_ENGINE);
}

// T-MI-2: upsert returns numeric id, doc is immediately recallable via fts
{
    const idx = getMemoryIndex();
    idx.initialize();
    const { id } = idx.upsert({
        content: 'memory-index seam trigram probe zzqqxx',
        namespace: 'prose',
        timestamp: new Date().toISOString(),
    });
    assert.strictEqual(typeof id, 'number');
    const hits = idx.searchText('zzqqxx', { topK: 5 });
    assert.ok(hits.length > 0, 'upserted doc must be recallable');
    assert.strictEqual(hits[0].match_source, 'fts');
}

// T-MI-3: searchText scope filtering
{
    const idx = getMemoryIndex();
    const scoped = idx.searchText('zzqqxx', { topK: 5, scope: 'prose' });
    assert.ok(scoped.every(r => r.namespace === 'prose'));
}

// T-MI-4: delete returns { changes } and does not throw on miss
{
    const idx = getMemoryIndex();
    const missing = idx.delete(99999999);
    assert.strictEqual(missing.changes, 0);
}

// T-MI-5: stats shape
{
    const s = getMemoryIndex().stats();
    for (const key of ['chunks', 'count', 'namespaces', 'first', 'last']) {
        assert.ok(key in s, `stats missing ${key}`);
    }
}
```

> Note: if `governance.js` uses a shared temp-DB fixture/`beforeEach`, reuse it instead of calling `initDB()` inline. Adapt the seed/teardown to the file's existing convention; keep the assertions identical.

- [x] **Step 3: Mirror to runtime.** Run:

```bash
node .evo-lite/cli/memory.js sync-runtime
```

Expected: reports `memory-index.js` copied and mirror lock refreshed, no parity error.
(Executed inline: the new gene required registering in template-manifest.js first — see T3 Step 2 — then a two-pass sync per the self-brick note; final sync = 0 copied, parity confirmed.)

- [x] **Step 4: Run the governance suite — expect PASS.** Run:

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: exit 0, the five `T-MI-*` assertions pass. (The module is standalone; `memory.service.js` is untouched, so nothing else changes yet.)

- [x] **Step 5: Commit.**

```bash
git add templates/cli/memory-index.js .evo-lite/cli/memory-index.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): add SqliteFtsIndex seam + unit coverage (spec:memory-index-abstraction T1)"
```

Committed as `fb4176a` (bundle also carried the T3 gene registration + harness reset-list change, pulled forward for self-brick avoidance).

---

### Task 2: Rewire `memory.service.js` to delegate, remove moved code

**Files:**
- Modify: `templates/cli/memory.service.js`
- Mirror after edit: `.evo-lite/cli/memory.service.js` (via `sync-runtime`)

**Interfaces:**
- Consumes (from `./memory-index`, produced by Task 1): `getMemoryIndex`.
- Produces: unchanged public signatures — `recall(query, topK, options)`, `memorize(text, options)`, `forget(id)`, `stats()`. Consumers (`memory.js`, `mcp-server.js`, `inspector.js`, `architecture/infer-modules.js`, `test/integration.js`) require no change.

- [x] **Step 1: Confirm the integration suite is green BEFORE changes** (baseline). Run:

```bash
node ./.evo-lite/cli/test.js all
```

Expected: exit 0. Record the pass — Step 6 must reproduce it.

- [x] **Step 2: Add the require.** Near the top of `templates/cli/memory.service.js`, after the existing `require('./db')` block, add:

```js
const { getMemoryIndex } = require('./memory-index');
```

- [x] **Step 3: Delegate the four public functions.**

Replace the body of `recall` (currently `const results = recallViaText(query, topK, options); ...`) with:

```js
async function recall(query, topK = 5, options = {}) {
    const results = getMemoryIndex().searchText(query, { topK, scope: options.scope });
    appendLog('RECALL', `Queried "${query}" scope=${options.scope || 'all'}, returned ${results.length} local matches.`);
    return results;
}
```

In `memorize`, replace the direct insert:

```js
    const rawMemoryId = db.prepare('INSERT INTO raw_memory (content, namespace, timestamp) VALUES (?, ?, ?)').run(
        richContent,
        namespace,
        options.timestamp || new Date().toISOString()
    ).lastInsertRowid;
```

with:

```js
    const { id: rawMemoryId } = getMemoryIndex().upsert({
        content: richContent,
        namespace,
        timestamp: options.timestamp || new Date().toISOString(),
    });
```

(Leave the surrounding `getDb()`, `prepareForWrite`, CLI print, and `appendLog('REMEMBER', ...)` exactly as-is. `rawMemoryId` is already a Number from `upsert`; the existing `Number(rawMemoryId)` in the return stays correct.)

In `forget`, replace:

```js
    const db = getDb();
    const info = db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);

    if (info.changes === 0) {
```

with:

```js
    const { changes } = getMemoryIndex().delete(id);

    if (changes === 0) {
```

Replace the whole `stats` function body with a delegation:

```js
function stats() {
    return getMemoryIndex().stats();
}
```

- [x] **Step 4: Delete the now-dead code from `memory.service.js`.** Remove these functions entirely (their logic now lives in `memory-index.js`): `recallViaText`, `generateTrigramQuery`, `bm25RankToScore`, `generateSnippet`. Before deleting, grep to confirm none is used elsewhere or exported:

```bash
grep -nE "recallViaText|generateTrigramQuery|bm25RankToScore|generateSnippet" templates/cli/memory.service.js
```

Expected after deletion: zero matches. If any match remains outside the four definitions (e.g. an entry in `module.exports`), remove that reference too. Keep `appendLog` in `memory.service.js` — it is still used by many other functions in the file.

- [x] **Step 5: Mirror to runtime.** Run:

```bash
node .evo-lite/cli/memory.js sync-runtime
```

Expected: `memory.service.js` copied, no parity error.

- [x] **Step 6: Run integration + governance — expect PASS (behavior preserved).** Run:

```bash
node ./.evo-lite/cli/test.js all && node ./.evo-lite/cli/test.js governance
```

Expected: both exit 0. Integration proves `recall`/`memorize`/`forget`/`stats` behave identically through the seam; governance re-proves the `T-MI-*` cases.

- [x] **Step 7: Commit.**

```bash
git add templates/cli/memory.service.js .evo-lite/cli/memory.service.js
git commit -m "refactor(memory): delegate recall/memorize/forget/stats to SqliteFtsIndex (spec:memory-index-abstraction T2)"
```

---

### Task 3: Register the gene + prove mirror parity

**Files:**
- Modify: `templates/cli/template-manifest.js`
- Mirror after edit: `.evo-lite/cli/template-manifest.js` (via `sync-runtime`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `memory-index.js` registered under `MANAGED_TEMPLATE_FAMILIES.core-cli.files`, so nurture propagates the engine gene to children.

- [x] **Step 1: Inspect the manifest structure.** Run:

```bash
grep -nE "core-cli|memory\.service\.js|files:\s*\[" templates/cli/template-manifest.js
```

Expected: shows the `core-cli` family and its `files` array containing `memory.service.js` and sibling cli modules.

- [x] **Step 2: Add the gene.** In `templates/cli/template-manifest.js`, add `'memory-index.js'` to the `core-cli` family `files` array, adjacent to the existing `'memory.service.js'` entry, matching the surrounding quote/indent/trailing-comma style exactly. (Done in T1 bundle `fb4176a` — had to precede sync-runtime.)

- [x] **Step 3: Mirror to runtime.** Run:

```bash
node .evo-lite/cli/memory.js sync-runtime
```

Expected: `template-manifest.js` copied; the runtime-mirror lock now includes `memory-index.js`; no parity error.

> ⚠️ **Known self-brick hazard (new managed file).** Registering `memory-index.js`
> as a NEW managed gene while the *currently loaded* runtime doesn't yet know it
> can produce a confusing partial-sync / T13-style failure — the running
> `sync-runtime` loads the old manifest, which lacks the new file. If the first
> `sync-runtime` errors or under-copies, **re-run it 2–3×** until it converges
> (each run reloads the freshly-mirrored manifest), or hand-copy
> `templates/cli/memory-index.js` → `.evo-lite/cli/memory-index.js` once and
> re-run. This is expected for new-file registration, not a code bug.

- [x] **Step 4: Prove full-suite green + mirror parity.** Run:

```bash
node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js all && node .evo-lite/cli/memory.js sync-runtime
```

Expected: both scopes exit 0; the final `sync-runtime` reports the mirror already in parity (no files copied on the second run) — this is the byte-identical proof for `ac-mirror-parity`.

- [x] **Step 5: Verify the contract criteria (dogfood the spec).** Run:

```bash
node .evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-07-07-memory-index-abstraction.md
```

Expected: all five criteria (`ac-index-seam-exists`, `ac-behavior-preserved`, `ac-index-unit-coverage`, `ac-gene-registered`, `ac-mirror-parity`) PASS. Note: `verify-contract` takes the spec **file path**, not the `spec:<id>` — and it is fail-closed on a dirty tree, so commit pending state first. All five PASS; evidence written to `.evo-lite/verification/evidence-memory-index-abstraction.json`.

- [x] **Step 6: Commit.** (Gene registration itself landed in the T1 bundle `fb4176a` for self-brick avoidance; T3 here is the verification + evidence commit.)

```bash
git add .evo-lite/verification/evidence-memory-index-abstraction.json docs/superpowers/plans/2026-07-07-memory-index-abstraction.md
git commit -m "test(memory): dogfood spec:memory-index-abstraction — 5/5 criteria PASS (T3)"
```

---

## Closure (after all tasks green)

Not a task — the mother-side closure, run by opus/fable after reviewing codex's output:

- `node .evo-lite/cli/memory.js plan scan` then `plan gaps` — confirm no R00x drift on the new spec/plan.
- `mem close spec:memory-index-abstraction --preview` → `--apply` once criteria attest.
- Update `active_context` focus via `mem focus` (not hand-edit) to point at the Zvec follow-up candidate now that the seam exists.

## Self-Review

- **Spec coverage:** interface (T1), `SqliteFtsIndex` impl (T1), service delegation (T2), moved helpers removed (T2), gene registration (T3), mirror parity (T3), unit + integration verification (T1/T2/T3), acceptance criteria dogfood (T3). All spec sections mapped.
- **No vector/exact/rebuild** on the interface — matches spec Non-Goals.
- **Type consistency:** `upsert` returns `{ id }`, consumed as `{ id: rawMemoryId }` in T2; `delete` returns `{ changes }`, consumed as `{ changes }` in T2; `searchText(query, { topK, scope })` signature identical in T1 def and T2 call. Consistent.
- **No circular require:** `memory-index.js` requires only `./db` + `./runtime`; `appendLog` duplicated locally by design.
