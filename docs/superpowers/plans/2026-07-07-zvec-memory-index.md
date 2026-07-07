---
id: plan:zvec-memory-index
linkedSpec: spec:zvec-memory-index
format: superpowers
status: draft
---

# Zvec Memory Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution model (per `.agents/rules/execution-model.md`):** opus/fable decompose + review; openai-codex executes. While codex is down (0.142.5 OOM on Windows), opus runs inline per the Fallback clause — same review discipline.

**Goal:** Ship `ZvecMemoryIndex` as a selectable, non-default memory engine behind the existing `MemoryIndex` seam, plus a `mem memory-ab` command that compares its recall to `SqliteFtsIndex` on the real archive. SQLite stays default; children are never forced onto the native dependency.

**Architecture:** New gene `memory-index-zvec.js` (`ZvecMemoryIndex`, self-contained Zvec collection + sidecar id counter). Shared `memory-index-util.js` holds `generateSnippet` (used by both engines). `getMemoryIndex()` gains `resolveEngine()` + `selectEngine()` that pick Zvec only when configured AND `@zvec/zvec` loads, else fall back to SQLite. `@zvec/zvec` is an optionalDependency.

**Tech Stack:** Node.js (CommonJS), `@zvec/zvec@^0.5.0` (jieba FTS, in-process), `better-sqlite3`, evo-lite governance harness.

## Global Constraints

- **Author only in `templates/cli/**`.** After each change run `node .evo-lite/cli/memory.js sync-runtime`; a **new managed file must be registered in `template-manifest.js` before sync-runtime will mirror it** (two-pass sync — self-brick pattern). Tests run against `.evo-lite/cli`.
- **SQLite stays the default engine.** No default flip in this plan.
- **`@zvec/zvec` is an `optionalDependency`, never `dependencies`.** Children without it must keep working (SQLite fallback).
- **Verifier scopes:** `governance` (governance only) or `all` (governance + integration). There is no `integration` scope.
- **Zvec engine label:** `'zvec-jieba-fts'`. Collection dir: `.evo-lite/zvec/` (derived, already git-ignored by `.evo-lite/*`).
- **Verified Zvec API (from the spike):** schema field `{name, dataType: STRING, indexParams:{indexType: FTS(11), tokenizerName:'jieba'}}`; `ZVecCreateAndOpen(dir, schema)` / `ZVecOpen(dir)`; `col.insertSync([{id:String, fields:{...}}])` → `{ok, code}`; `col.querySync({fieldName, topk, fts:{queryString|matchString}, filter?})` → `[{id, score, fields}]`; `col.deleteSync(String(id))` → `{ok:true}` hit / `{ok:false, code:'ZVEC_NOT_FOUND'}` miss; `col.closeSync()`. Filter equality is single `=` with quotes (`namespace = "prose"`); membership is lowercase `in (...)`; `==` and `IN [...]` are invalid. `queryString` throws on `:`-bearing tokens → catch and retry as `matchString`.

---

### Task 1: Extract `generateSnippet` into a shared `memory-index-util.js`

Both engines need `generateSnippet`; it currently lives private inside `memory-index.js`. Extract it so `ZvecMemoryIndex` can reuse it without duplicating. Behavior-preserving.

**Files:**
- Create: `templates/cli/memory-index-util.js`
- Modify: `templates/cli/memory-index.js` (import the helper, drop the local copy)
- Modify: `templates/cli/template-manifest.js` (register the new gene)
- Mirror: `.evo-lite/cli/**` via `sync-runtime`

**Interfaces:**
- Produces: `memory-index-util.js` exports `generateSnippet(content, query, maxChars = 200) → string`.

- [x] **Step 1: Create the util module.** Create `templates/cli/memory-index-util.js`:

```js
'use strict';

// Shared memory-index helper. generateSnippet is engine-agnostic (pure string
// work), so both SqliteFtsIndex and ZvecMemoryIndex use this one copy.
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

module.exports = { generateSnippet };
```

- [x] **Step 2: Rewire `memory-index.js` to import it.** In `templates/cli/memory-index.js`, add near the top (after the `./runtime` require):

```js
const { generateSnippet } = require('./memory-index-util');
```

Then **delete** the local `function generateSnippet(content, query, maxChars = 200) { … }` definition (the whole function). Leave `generateTrigramQuery` and `bm25RankToScore` in place — they are SQLite-only.

- [x] **Step 3: Register the gene + mirror (two-pass).** In `templates/cli/template-manifest.js`, add `'memory-index-util.js'` to the `core-cli` family `files` array next to `'memory-index.js'`. Then:

```bash
node .evo-lite/cli/memory.js sync-runtime && node .evo-lite/cli/memory.js sync-runtime
```

Expected: first pass copies `template-manifest.js`; second pass copies `memory-index-util.js`; `ls .evo-lite/cli/memory-index-util.js` exists.

- [x] **Step 4: Prove behavior preserved.** Run:

```bash
node ./.evo-lite/cli/test.js all
```

Expected: exit 0, "All CLI integration tests passed!" (recall/snippet unchanged).

- [x] **Step 5: Commit.**

```bash
git add templates/cli/memory-index-util.js .evo-lite/cli/memory-index-util.js templates/cli/memory-index.js .evo-lite/cli/memory-index.js templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
git commit -m "refactor(memory): extract generateSnippet to shared memory-index-util (spec:zvec-memory-index T1)"
```

---

### Task 2: `ZvecMemoryIndex` module + optional dependency + unit tests

**Files:**
- Create: `templates/cli/memory-index-zvec.js`
- Modify: `package.json` (optionalDependencies)
- Modify: `templates/cli/template-manifest.js` (register gene)
- Modify: `templates/cli/test/governance.js` (skip-if-unavailable unit tests)
- Modify: `templates/cli/test/harness.js` (reset-cache list)
- Mirror: `.evo-lite/cli/**`

**Interfaces:**
- Consumes: `./memory-index-util` `generateSnippet`; `./db` `getNamespaces`; `./runtime` `getDbPath`.
- Produces: `memory-index-zvec.js` exports `{ ZvecMemoryIndex }`. `ZvecMemoryIndex` implements `initialize() / searchText(query,{topK,scope}) / upsert({content,namespace,timestamp})→{id} / delete(id)→{changes} / stats() / close()` + `engine` getter (`'zvec-jieba-fts'`).

- [ ] **Step 1: Add the optional dependency.** In `package.json`, add:

```json
  "optionalDependencies": {
    "@zvec/zvec": "^0.5.0"
  }
```

Then install it into the repo so the mother's tests can exercise it:

```bash
npm install
```

Expected: `@zvec/zvec` + `@zvec/bindings-win32-x64` appear under `node_modules/@zvec/`. (On a platform without a prebuild, npm skips it silently — that is the intended optional behavior.)

- [ ] **Step 2: Write `templates/cli/memory-index-zvec.js`:**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { getNamespaces } = require('./db');
const { getDbPath } = require('./runtime');
const { generateSnippet } = require('./memory-index-util');

const ENGINE = 'zvec-jieba-fts';
const COLLECTION_NAME = 'evomemory';

let Z = null;
function loadZvec() {
    if (!Z) Z = require('@zvec/zvec'); // throws if the optional dep is absent
    return Z;
}

function zvecRoot() {
    return path.join(path.dirname(getDbPath()), 'zvec');
}

// ZvecMemoryIndex — MemoryIndex implementation backed by a Zvec jieba-FTS
// collection. Self-contained: owns its collection dir + a sidecar id counter,
// with no dependency on the SQLite raw_memory table.
class ZvecMemoryIndex {
    constructor() {
        this._col = null;
        this._dir = zvecRoot();
        this._colPath = path.join(this._dir, 'collection');
        this._idFile = path.join(this._dir, 'nextid.json');
    }

    get engine() {
        return ENGINE;
    }

    _schema() {
        const z = loadZvec();
        return new z.ZVecCollectionSchema({
            name: COLLECTION_NAME,
            fields: [
                { name: 'content', dataType: z.ZVecDataType.STRING,
                  indexParams: { indexType: z.ZVecIndexType.FTS, tokenizerName: 'jieba' } },
                { name: 'namespace', dataType: z.ZVecDataType.STRING,
                  indexParams: { indexType: z.ZVecIndexType.INVERT } },
                { name: 'timestamp', dataType: z.ZVecDataType.STRING },
            ],
        });
    }

    initialize() {
        const z = loadZvec();
        fs.mkdirSync(this._dir, { recursive: true });
        this._col = fs.existsSync(this._colPath)
            ? z.ZVecOpen(this._colPath)
            : z.ZVecCreateAndOpen(this._colPath, this._schema());
        if (!fs.existsSync(this._idFile)) {
            fs.writeFileSync(this._idFile, JSON.stringify({ next: this._maxId() + 1 }), 'utf8');
        }
    }

    _col_() {
        if (!this._col) this.initialize();
        return this._col;
    }

    _allDocs() {
        try {
            return this._col_().querySync({ topk: 1000000, filter: 'namespace != ""' }) || [];
        } catch (_) {
            return [];
        }
    }

    _maxId() {
        return this._allDocs().reduce((m, d) => Math.max(m, Number(d.id) || 0), 0);
    }

    _nextId() {
        let state = { next: 1 };
        try { state = JSON.parse(fs.readFileSync(this._idFile, 'utf8')); } catch (_) {}
        const id = state.next || 1;
        fs.writeFileSync(this._idFile, JSON.stringify({ next: id + 1 }), 'utf8');
        return id;
    }

    upsert(doc = {}) {
        const col = this._col_();
        const id = this._nextId();
        col.insertSync([{ id: String(id), fields: {
            content: doc.content,
            namespace: doc.namespace,
            timestamp: doc.timestamp,
        } }]);
        return { id };
    }

    _scopeFilter(scope) {
        if (!scope || scope === 'all') return undefined;
        return `namespace = "${scope}"`;
    }

    searchText(query, options = {}) {
        const col = this._col_();
        const topK = options.topK || 5;
        const base = { fieldName: 'content', topk: topK };
        const filter = this._scopeFilter(options.scope);
        if (filter) base.filter = filter;

        let rows;
        let src;
        try {
            rows = col.querySync({ ...base, fts: { queryString: query } });
            src = 'zvec-fts';
        } catch (_) {
            // queryString parser rejects ':'-bearing tokens (task:/spec:/plan:);
            // matchString is the literal, unparsed fallback.
            rows = col.querySync({ ...base, fts: { matchString: query } });
            src = 'zvec-match';
        }

        return (rows || []).map(d => ({
            id: Number(d.id),
            content: d.fields.content,
            namespace: d.fields.namespace,
            timestamp: d.fields.timestamp,
            score: d.score,
            snippet: generateSnippet(d.fields.content, query),
            match_source: src,
        }));
    }

    delete(id) {
        const col = this._col_();
        const st = col.deleteSync(String(id));
        return { changes: st && st.ok ? 1 : 0 };
    }

    stats() {
        const all = this._allDocs();
        const nsCounts = {};
        let first = null;
        let last = null;
        for (const d of all) {
            const ns = d.fields.namespace;
            nsCounts[ns] = (nsCounts[ns] || 0) + 1;
            const ts = d.fields.timestamp;
            if (ts) {
                if (!first || ts < first) first = ts;
                if (!last || ts > last) last = ts;
            }
        }
        const namespaces = {};
        for (const ns of getNamespaces()) {
            const count = nsCounts[ns] || 0;
            namespaces[ns] = { chunks: count, present: count > 0, model: ENGINE, dims: '1' };
        }
        return { chunks: all.length, count: all.length, namespaces, first, last };
    }

    close() {
        if (this._col) {
            try { this._col.closeSync(); } catch (_) {}
            this._col = null;
        }
    }
}

module.exports = { ZvecMemoryIndex };
```

- [ ] **Step 3: Register gene + reset-cache + mirror (two-pass).** In `templates/cli/template-manifest.js` add `'memory-index-zvec.js'` to `core-cli` `files`. In `templates/cli/test/harness.js` `resetCliModuleCache`, add `'memory-index-zvec.js'` to the file list. Then:

```bash
node .evo-lite/cli/memory.js sync-runtime && node .evo-lite/cli/memory.js sync-runtime
```

Expected: `.evo-lite/cli/memory-index-zvec.js` exists.

- [ ] **Step 4: Add skip-if-unavailable unit tests to `templates/cli/test/governance.js`.** Add, before `await runChildRuntimeTests();`:

```js
console.log('T-ZV. Testing ZvecMemoryIndex (skips if @zvec/zvec absent) ...');
{
    let zvecAvailable = true;
    try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
    if (!zvecAvailable) {
        console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
    } else {
        const runtime = createTempRuntimeRoot('zvec-index');
        await bootstrapRuntime(runtime.runtimeRoot);
        const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
        const idx = new ZvecMemoryIndex();
        idx.initialize();

        // round-trip + engine label
        assert.strictEqual(idx.engine, 'zvec-jieba-fts');
        const { id } = idx.upsert({ content: 'zvec seam probe memory.service recall', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
        assert.strictEqual(typeof id, 'number');
        const hits = idx.searchText('recall', { topK: 5 });
        assert.ok(hits.some(h => h.id === id), 'upserted doc recallable');
        assert.strictEqual(hits[0].match_source, 'zvec-fts');

        // colon query -> matchString fallback, no throw
        idx.upsert({ content: 'closure for task:zvec-memory-index-t2 evidence', namespace: 'prose', timestamp: '2026-07-07T00:01:00Z' });
        const colon = idx.searchText('task:zvec-memory-index-t2', { topK: 5 });
        assert.ok(colon.length > 0, 'colon query returns via matchString');
        assert.strictEqual(colon[0].match_source, 'zvec-match');

        // jieba Chinese recall
        idx.upsert({ content: '向量数据库与机器学习结合用于语义检索', namespace: 'prose', timestamp: '2026-07-07T00:02:00Z' });
        const zh = idx.searchText('机器学习', { topK: 5 });
        assert.ok(zh.length > 0, 'jieba recalls Chinese word');

        // scope filter
        idx.upsert({ content: 'code namespace doc recall', namespace: 'code', timestamp: '2026-07-07T00:03:00Z' });
        const scoped = idx.searchText('recall', { topK: 10, scope: 'code' });
        assert.ok(scoped.every(r => r.namespace === 'code'), 'scope filters to code');

        // delete changes
        assert.strictEqual(idx.delete(id).changes, 1);
        assert.strictEqual(idx.delete(9999999).changes, 0);

        // stats shape parity with SqliteFtsIndex.stats
        const s = idx.stats();
        for (const key of ['chunks', 'count', 'namespaces', 'first', 'last']) {
            assert.ok(key in s, `stats missing ${key}`);
        }
        idx.close();
    }
}
console.log('✅ T-ZV ZvecMemoryIndex passed');
```

- [ ] **Step 5: Mirror + run governance.**

```bash
node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance
```

Expected: exit 0; `T-ZV` runs (this machine has `@zvec/zvec`) and passes.

- [ ] **Step 6: Commit.**

```bash
git add package.json package-lock.json templates/cli/memory-index-zvec.js .evo-lite/cli/memory-index-zvec.js templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js templates/cli/test/harness.js .evo-lite/cli/test/harness.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): ZvecMemoryIndex (jieba FTS) + optional dep + unit tests (spec:zvec-memory-index T2)"
```

---

### Task 3: Engine selection + fallback in `getMemoryIndex()`

**Files:**
- Modify: `templates/cli/memory-index.js` (add `resolveEngine` + `selectEngine`; rewire `getMemoryIndex`)
- Modify: `templates/cli/test/governance.js` (selection tests)
- Mirror: `.evo-lite/cli/**`

**Interfaces:**
- Produces (exported for tests): `resolveEngine() → 'zvec' | 'sqlite-fts5-trigram'`; `selectEngine(engine, loadZvecIndex) → MemoryIndex`. `loadZvecIndex()` returns the `ZvecMemoryIndex` **class** or `null` when unavailable.

- [ ] **Step 1: Add selection logic to `templates/cli/memory-index.js`.** Add these near the factory (they use `fs`/`path`/`getDbPath` — add `const fs = require('fs'); const path = require('path');` and `const { getDbPath } = require('./runtime');` if not already imported; check the existing requires first and only add what is missing):

```js
const DEFAULT_ENGINE_CHOICE = 'sqlite-fts5-trigram';

function resolveEngine() {
    const env = process.env.EVO_LITE_MEMORY_ENGINE;
    if (env) return env;
    try {
        const cfgPath = path.join(path.dirname(getDbPath()), 'memory-engine.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (cfg && typeof cfg.engine === 'string') return cfg.engine;
        }
    } catch (_) {}
    return DEFAULT_ENGINE_CHOICE;
}

// loadZvecIndex: () => ZvecMemoryIndex class | null. Injected so tests can
// simulate "@zvec/zvec unavailable" without touching the module system.
function defaultLoadZvecIndex() {
    try {
        require('@zvec/zvec');                       // fail fast if the optional dep is absent
        return require('./memory-index-zvec').ZvecMemoryIndex;
    } catch (_) {
        return null;
    }
}

function selectEngine(engine, loadZvecIndex = defaultLoadZvecIndex) {
    if (engine === 'zvec') {
        const ZvecIdx = loadZvecIndex();
        if (ZvecIdx) return new ZvecIdx();
        console.warn('⚠️ memory engine "zvec" selected but @zvec/zvec is unavailable — falling back to SqliteFtsIndex.');
    }
    return new SqliteFtsIndex();
}
```

Replace the existing `getMemoryIndex` body with:

```js
function getMemoryIndex() {
    if (!active) {
        active = selectEngine(resolveEngine());
    }
    return active;
}
```

Extend `module.exports` to add `resolveEngine` and `selectEngine`:

```js
module.exports = { SqliteFtsIndex, getMemoryIndex, resolveEngine, selectEngine };
```

- [ ] **Step 2: Add selection tests to `templates/cli/test/governance.js`** (run always — no Zvec needed), before `await runChildRuntimeTests();`:

```js
console.log('T-ENGINE. Testing engine selection + fallback ...');
{
    const { selectEngine, resolveEngine, SqliteFtsIndex } = require(path.join(CLI_DIR, 'memory-index.js'));

    // default: no zvec
    assert.ok(selectEngine('sqlite-fts5-trigram') instanceof SqliteFtsIndex, 'default is SqliteFtsIndex');

    // zvec configured but unavailable -> fall back to SqliteFtsIndex
    const fallback = selectEngine('zvec', () => null);
    assert.ok(fallback instanceof SqliteFtsIndex, 'zvec-unavailable falls back to SqliteFtsIndex');

    // zvec configured + available (fake class) -> uses it
    class FakeZvec { get engine() { return 'zvec-jieba-fts'; } }
    const picked = selectEngine('zvec', () => FakeZvec);
    assert.strictEqual(picked.engine, 'zvec-jieba-fts', 'zvec-available is used');

    // env overrides json config
    const prev = process.env.EVO_LITE_MEMORY_ENGINE;
    process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
    assert.strictEqual(resolveEngine(), 'zvec', 'env overrides config');
    if (prev === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE; else process.env.EVO_LITE_MEMORY_ENGINE = prev;
}
console.log('✅ T-ENGINE selection passed');
```

- [ ] **Step 3: Mirror + full suite.**

```bash
node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js all
```

Expected: exit 0; `T-ENGINE` passes; default behavior (SQLite) unchanged.

- [ ] **Step 4: Commit.**

```bash
git add templates/cli/memory-index.js .evo-lite/cli/memory-index.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): engine selection + zvec-unavailable fallback in getMemoryIndex (spec:zvec-memory-index T3)"
```

---

### Task 4: `mem memory-ab` offline A/B command

**Files:**
- Create: `templates/cli/memory-ab.js` (the comparison logic)
- Modify: `templates/cli/memory.js` (register the `memory-ab` command)
- Modify: `templates/cli/template-manifest.js` (register `memory-ab.js` gene)
- Modify: `templates/cli/test/governance.js` (smoke test)
- Mirror: `.evo-lite/cli/**`

**Interfaces:**
- Consumes: `./memory-index` `SqliteFtsIndex` (forced SQLite side); `./memory-index-zvec` `ZvecMemoryIndex`; the raw_memory dir from `./runtime` `getRawMemoryDir`.
- Produces: `memory-ab.js` exports `runMemoryAb({ fromLogs = false }) → { rows, agreement }` and prints a table. `rows[i] = { query, sqlite: number[], zvec: number[], agree: boolean }`.

- [ ] **Step 1: Write `templates/cli/memory-ab.js`:**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { getRawMemoryDir, getLogPath } = require('./runtime');

// The spike's hard recall targets — the cases trigram was chosen for.
const BUILTIN_QUERIES = [
    'memory.service', 'recallViaText', 'R008', 'task:release-2.2.0-hardening-t5',
    '机器学习', '语义检索', 'DV800',
];

function sampleLogQueries(limit = 20) {
    try {
        const text = fs.readFileSync(getLogPath(), 'utf8');
        const qs = [];
        for (const line of text.split('\n')) {
            const m = line.match(/RECALL[^:]*: Queried "([^"]+)"/);
            if (m) qs.push(m[1]);
        }
        return Array.from(new Set(qs)).slice(-limit);
    } catch (_) {
        return [];
    }
}

// Build a throwaway ZvecMemoryIndex from every raw_memory archive body.
function buildZvecFromArchive(ZvecMemoryIndex) {
    const idx = new ZvecMemoryIndex();
    idx.initialize();
    const dir = getRawMemoryDir();
    if (!fs.existsSync(dir)) return idx;
    let ts = 0;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const ns = (content.match(/^namespace:\s*"?([a-z]+)"?/m) || [])[1] || 'prose';
        idx.upsert({ content, namespace: ns, timestamp: new Date(++ts).toISOString() });
    }
    return idx;
}

async function runMemoryAb(opts = {}) {
    let ZvecMemoryIndex;
    try {
        require('@zvec/zvec');
        ZvecMemoryIndex = require('./memory-index-zvec').ZvecMemoryIndex;
    } catch (_) {
        console.log('⏭️  @zvec/zvec is not installed — run `npm i @zvec/zvec` to enable the A/B. Nothing to compare.');
        return { rows: [], agreement: null };
    }

    // Force the SQLite engine directly (NOT recall(), which honours memory-engine.json
    // and could otherwise make this a zvec-vs-zvec comparison).
    const { SqliteFtsIndex } = require('./memory-index');
    const sqlite = new SqliteFtsIndex();
    sqlite.initialize();
    const zvec = buildZvecFromArchive(ZvecMemoryIndex);

    const queries = BUILTIN_QUERIES.concat(opts.fromLogs ? sampleLogQueries() : []);
    const rows = [];
    for (const q of queries) {
        const sqliteHits = sqlite.searchText(q, { topK: 5 }).map(r => Number(r.id)).sort((a, b) => a - b);
        const zvecHits = zvec.searchText(q, { topK: 5 }).map(r => Number(r.id)).sort((a, b) => a - b);
        const agree = JSON.stringify(sqliteHits) === JSON.stringify(zvecHits);
        rows.push({ query: q, sqlite: sqliteHits, zvec: zvecHits, agree });
    }
    zvec.close();

    const agreement = rows.length ? rows.filter(r => r.agree).length / rows.length : null;
    console.log('\n🔬 Memory engine A/B — SQLite (default) vs Zvec (jieba FTS)\n');
    console.log('query'.padEnd(38), 'agree', 'sqlite → zvec');
    for (const r of rows) {
        console.log(r.query.slice(0, 37).padEnd(38), (r.agree ? ' ✓ ' : ' ✗ '),
            `${JSON.stringify(r.sqlite)} → ${JSON.stringify(r.zvec)}`.slice(0, 60));
    }
    console.log(`\nagreement: ${agreement === null ? 'n/a' : (agreement * 100).toFixed(0) + '%'} (${rows.length} queries)`);
    console.log('Note: SQLite and Zvec assign ids independently; id-set divergence is expected — read this as a recall-shape comparison, not id equality.');
    return { rows, agreement };
}

module.exports = { runMemoryAb, BUILTIN_QUERIES, sampleLogQueries };
```

> Note: because the two engines assign ids independently, id-set equality will usually be low. That is fine — the A/B's value is showing **which queries return hits at all** and relative hit counts per engine. The printed caveat says so. (A later default-flip spec can add content-hash-based matching if id-agnostic comparison is needed.)

- [ ] **Step 2: Register the `memory-ab` command in `templates/cli/memory.js`.** Find where other commands are registered (`program.command('archive')` etc.) and add, matching the surrounding style:

```js
program
    .command('memory-ab')
    .description('Offline A/B: compare SQLite vs Zvec recall over the raw_memory archive.')
    .option('--from-logs', 'also sample queries from RECALL log lines')
    .action(async (options) => {
        const { runMemoryAb } = require('./memory-ab');
        await runMemoryAb({ fromLogs: Boolean(options.fromLogs) });
    });
```

- [ ] **Step 3: Register gene + mirror (two-pass).** Add `'memory-ab.js'` to `core-cli` `files` in `template-manifest.js`, then:

```bash
node .evo-lite/cli/memory.js sync-runtime && node .evo-lite/cli/memory.js sync-runtime
```

Expected: `.evo-lite/cli/memory-ab.js` exists.

- [ ] **Step 4: Add a smoke test to `templates/cli/test/governance.js`** (before `await runChildRuntimeTests();`):

```js
console.log('T-AB. Testing memory-ab wiring ...');
{
    const ab = require(path.join(CLI_DIR, 'memory-ab.js'));
    assert.ok(Array.isArray(ab.BUILTIN_QUERIES) && ab.BUILTIN_QUERIES.includes('R008'), 'builtin query set present');
    assert.strictEqual(typeof ab.runMemoryAb, 'function', 'runMemoryAb exported');
    // With @zvec present this rebuilds + compares; without it returns { rows: [] }. Either way it must not throw.
    const res = await ab.runMemoryAb({ fromLogs: false });
    assert.ok(res && Array.isArray(res.rows), 'runMemoryAb returns rows array');
}
console.log('✅ T-AB memory-ab passed');
```

- [ ] **Step 5: Mirror + full suite + eyeball the command.**

```bash
node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js all && node .evo-lite/cli/memory.js memory-ab
```

Expected: tests exit 0; the `memory-ab` run prints the divergence table (real A/B on the mother's own archive).

- [ ] **Step 6: Commit.**

```bash
git add templates/cli/memory-ab.js .evo-lite/cli/memory-ab.js templates/cli/memory.js .evo-lite/cli/memory.js templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): mem memory-ab offline SQLite-vs-Zvec recall comparison (spec:zvec-memory-index T4)"
```

---

### Task 5: Gitignore, docs, parity + contract dogfood

**Files:**
- Modify: `.gitignore`, `templates/gitignore` (un-ignore `memory-engine.json`)
- Modify: `README.md` or `docs/` (document opting into Zvec) — a short note
- Mirror + verify

- [ ] **Step 1: Un-ignore `memory-engine.json`.** In both root `.gitignore` and `templates/gitignore`, after the existing `.evo-lite/` un-ignore block, add:

```
!.evo-lite/memory-engine.json
```

(`.evo-lite/zvec/` stays ignored — do not add an exception for it.)

- [ ] **Step 2: Document opting in.** Append a short "Choosing the memory engine" section to `docs/zvec-spike-findings.md` (or the project README) stating: default is `sqlite-fts5-trigram`; to try Zvec, `npm i @zvec/zvec` then write `.evo-lite/memory-engine.json` `{"engine":"zvec"}` (or set `EVO_LITE_MEMORY_ENGINE=zvec`); run `mem memory-ab` to compare recall; children fall back to SQLite automatically if the dep is absent.

- [ ] **Step 3: Mirror + prove parity + full green.**

```bash
node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance && node ./.evo-lite/cli/test.js all && node .evo-lite/cli/memory.js sync-runtime
```

Expected: both scopes exit 0; the trailing `sync-runtime` reports `copied: 0` (byte-identical mirror — proves `ac-mirror-parity`).

- [ ] **Step 4: Commit, then dogfood the contract.**

```bash
git add .gitignore templates/gitignore docs/zvec-spike-findings.md
git commit -m "chore(memory): un-ignore memory-engine.json + document Zvec opt-in (spec:zvec-memory-index T5)"
node .evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-07-07-zvec-memory-index.md
```

Expected: all five criteria PASS (`ac-zvec-index-contract`, `ac-engine-selection-fallback`, `ac-memory-ab-command`, `ac-zvec-optional-not-gene-config`, `ac-mirror-parity`). `verify-contract` takes the spec **file path** and is fail-closed on a dirty tree — commit pending state first.

- [ ] **Step 5: Commit the evidence.**

```bash
git add .evo-lite/verification/evidence-zvec-memory-index.json
git commit -m "test(memory): dogfood spec:zvec-memory-index — 5/5 criteria PASS (T5)"
```

---

## Closure (after all tasks green)

Not a task — mother-side closure, run after review:

- `mem plan scan` / `plan gaps` — confirm no drift on the new spec/plan.
- `mem close docs/superpowers/specs/2026-07-07-zvec-memory-index.md --preview` → `--apply`.
- Clear R008 for the tasks with a full-`task:`-id archive (`mem archive` → `plan archive-evidence` → `plan scan`), per `project-r008-evidence-backfill-recipe`.
- `mem focus` off the done plan to the default-flip follow-up.

## Self-Review

- **Spec coverage:** ZvecMemoryIndex module + contract (T2), shared snippet util (T1), engine selection + fallback (T3), optionalDependency (T2), memory-engine.json project-state + un-ignore (T3 config read / T5 gitignore), memory-ab offline A/B (T4), manifest genes + mirror parity (each task + T5), skip-if-unavailable tests (T2), acceptance dogfood (T5). All spec sections mapped.
- **No default flip, no embeddings, no runtime dual-write, no forced child dep** — matches Non-Goals.
- **Type consistency:** `upsert → {id:number}`, `delete → {changes}`, `searchText → [{id,content,namespace,timestamp,score,snippet,match_source}]`, `stats → {chunks,count,namespaces,first,last}` — identical to `SqliteFtsIndex` and used consistently in memory-ab (T4). `selectEngine(engine, loadZvecIndex)` / `resolveEngine()` signatures match between T3 definition and its tests.
- **Self-brick handled:** every new gene (util, zvec index, memory-ab) is registered in the manifest before its two-pass sync.
