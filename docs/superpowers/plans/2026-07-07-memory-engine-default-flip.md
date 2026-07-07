---
id: plan:memory-engine-default-flip
status: draft
created: 2026-07-07
linkedSpec: spec:memory-engine-default-flip
---

# Memory Engine Default-Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a content-level recall rubric, gate a human GO/NO-GO on it, and — only on GO — flip the default memory engine from `sqlite-fts5-trigram` to `zvec` with a reindex path, a `list()` seam fix, and config-only rollback.

**Architecture:** One spec, two phases separated by a human decision gate. Phase B (Tasks 1–2) extends the existing offline `mem memory-ab` command into a graded (hit/precision) comparison and writes an evidence artifact. The gate (Task 3) is a hard human checkpoint: NO-GO closes on the reduced criteria set; GO proceeds. Phase A (Tasks 4–6) routes `list()` through the seam, makes `rebuild` engine-aware, and flips `DEFAULT_ENGINE_CHOICE` with the existing `selectEngine` fallback intact.

**Tech Stack:** Node.js (CommonJS), `better-sqlite3`, `@zvec/zvec` (optionalDependency, jieba FTS), Node `assert` governance tests, Evo-Lite `mem` CLI (`sync-runtime` mirror, `verify-contract` closure).

## Global Constraints

- **Author in `templates/cli/**`; mirror to `.evo-lite/cli/**` byte-identical via `node .evo-lite/cli/memory.js sync-runtime`.** All touched files already exist in both trees — no new-file self-brick this plan.
- **`@zvec/zvec` is an `optionalDependency`, never `dependencies`.** Every Zvec-touching test skips cleanly when `require.resolve('@zvec/zvec')` throws.
- **Test scopes are `governance` and `all` only** (`node ./.evo-lite/cli/test.js <scope>`). There is no `integration` scope.
- **`verify-contract` run/close is fail-closed on a dirty git tree.** Commit hook churn (`active_context.md`) before any dogfood/closure step.
- **Ground truth for grading = literal case-insensitive substring containment** over raw archive bodies — engine-independent, reproducible, and matched to this project's literal recall targets (paths, code symbols, `task:`-ids, hashes, verbatim Chinese words).
- **`BUILTIN_QUERIES` stays a `string[]`** (the existing T-AB test asserts `.includes('R008')`); grading attaches alongside, it does not reshape the array.
- **No embeddings, no mother/child discriminator, no dedup index, no auto-flip, no removal of the SQLite engine** (spec Non-Goals).

---

### Task 1: Graded rubric in `memory-ab` (Phase B)

Turn the id-divergence table into a graded (hit/precision) comparison. Ground truth = docs whose raw content literally contains the query. Grade both engines per query; print aggregate hit-rate + mean precision; return a `graded` block for tests and the evidence artifact.

**Files:**
- Modify: `templates/cli/memory-ab.js`
- Modify: `templates/cli/test/governance.js` (T-AB block, ~line 2002)
- Mirror: `.evo-lite/cli/memory-ab.js`, `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Consumes: `SqliteFtsIndex` / `ZvecMemoryIndex` `searchText(query, {topK})` → `[{id, content, namespace, timestamp, score, snippet, match_source}]`; `getRawMemoryDir()`.
- Produces: `runMemoryAb({fromLogs})` → `{ rows, agreement, graded }` where `graded` is `null` when `@zvec/zvec` is absent, else `{ rows: [{query, ground, sqlite:{hit,precision,returned,onTopic}, zvec:{hit,precision,returned,onTopic}}], sqliteHitRate, zvecHitRate, sqliteMeanPrec, zvecMeanPrec }`. Also exports `loadArchiveCorpus()`, `gradeHits(results, query)`.

- [x] **Step 1: Write the failing test** — extend the T-AB block in `templates/cli/test/governance.js`. Replace the existing T-AB block (currently ~lines 2002–2011) with:

```js
        console.log('T-AB. Testing memory-ab wiring + graded rubric ...');
        {
            const ab = require(path.join(CLI_DIR, 'memory-ab.js'));
            assert.ok(Array.isArray(ab.BUILTIN_QUERIES) && ab.BUILTIN_QUERIES.includes('R008'), 'builtin query set present');
            assert.strictEqual(typeof ab.runMemoryAb, 'function', 'runMemoryAb exported');
            assert.strictEqual(typeof ab.gradeHits, 'function', 'gradeHits exported');

            // gradeHits: ground truth = literal substring containment on r.content.
            const g = ab.gradeHits(
                [{ content: 'about memory.service.js recall' }, { content: 'unrelated doc' }],
                'memory.service'
            );
            assert.strictEqual(g.hit, true, 'gradeHits reports a hit when a returned doc contains the query');
            assert.strictEqual(g.onTopic, 1, 'gradeHits counts on-topic docs');
            assert.ok(Math.abs(g.precision - 0.5) < 1e-9, 'gradeHits precision = onTopic / returned');
            const gMiss = ab.gradeHits([{ content: 'nothing here' }], 'R008');
            assert.strictEqual(gMiss.hit, false, 'gradeHits reports a miss when no returned doc contains the query');

            // With @zvec present this rebuilds + compares + grades; without it returns { rows: [], graded: null }.
            const res = await ab.runMemoryAb({ fromLogs: false });
            assert.ok(res && Array.isArray(res.rows), 'runMemoryAb returns rows array');
            if (res.graded) {
                assert.ok(Array.isArray(res.graded.rows), 'graded.rows is an array');
                for (const r of res.graded.rows) {
                    for (const key of ['hit', 'precision', 'returned', 'onTopic']) {
                        assert.ok(key in r.sqlite && key in r.zvec, `graded row missing ${key}`);
                    }
                }
                assert.ok(res.graded.zvecHitRate === null || (res.graded.zvecHitRate >= 0 && res.graded.zvecHitRate <= 1), 'zvecHitRate in [0,1] or null');
            }
        }
        console.log('✅ T-AB memory-ab passed');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/test.js all`
Expected: FAIL — `gradeHits exported` assertion trips (`ab.gradeHits` is `undefined`).

- [x] **Step 3: Implement the graded rubric** — edit `templates/cli/memory-ab.js`. Add the corpus loader + grader and wire them into `runMemoryAb`. Replace the file body from the `buildZvecFromArchive` function through the end with:

```js
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

// Every raw_memory archive body, verbatim — the ground-truth corpus for grading.
function loadArchiveCorpus() {
    const dir = getRawMemoryDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
}

// Ground truth = literal, case-insensitive substring containment. Engine-independent
// and reproducible; matches this project's literal recall targets (paths, code
// symbols, task:-ids, hashes, verbatim Chinese words).
function contains(content, q) {
    return String(content || '').toLowerCase().includes(String(q).toLowerCase());
}

// Grade one engine's result list for one query: was any returned doc on-topic
// (hit), and what fraction were on-topic (precision@K)?
function gradeHits(results, query) {
    const onTopic = results.filter(r => contains(r.content, query)).length;
    return {
        hit: onTopic > 0,
        precision: results.length ? onTopic / results.length : 0,
        returned: results.length,
        onTopic,
    };
}

function mean(nums) {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

async function runMemoryAb(opts = {}) {
    let ZvecMemoryIndex;
    try {
        require('@zvec/zvec');
        ZvecMemoryIndex = require('./memory-index-zvec').ZvecMemoryIndex;
    } catch (_) {
        console.log('⏭️  @zvec/zvec is not installed — run `npm i @zvec/zvec` to enable the A/B. Nothing to compare.');
        return { rows: [], agreement: null, graded: null };
    }

    // Force the SQLite engine directly (NOT recall(), which honours memory-engine.json
    // and could otherwise make this a zvec-vs-zvec comparison).
    const { SqliteFtsIndex } = require('./memory-index');
    const sqlite = new SqliteFtsIndex();
    sqlite.initialize();
    const zvec = buildZvecFromArchive(ZvecMemoryIndex);
    const corpus = loadArchiveCorpus();

    const queries = BUILTIN_QUERIES.concat(opts.fromLogs ? sampleLogQueries() : []);
    const rows = [];
    const gradeRows = [];
    for (const q of queries) {
        const sqliteRes = sqlite.searchText(q, { topK: 5 });
        const zvecRes = zvec.searchText(q, { topK: 5 });
        const sqliteHits = sqliteRes.map(r => Number(r.id)).sort((a, b) => a - b);
        const zvecHits = zvecRes.map(r => Number(r.id)).sort((a, b) => a - b);
        rows.push({ query: q, sqlite: sqliteHits, zvec: zvecHits, agree: JSON.stringify(sqliteHits) === JSON.stringify(zvecHits) });
        gradeRows.push({
            query: q,
            ground: corpus.filter(c => contains(c, q)).length,
            sqlite: gradeHits(sqliteRes, q),
            zvec: gradeHits(zvecRes, q),
        });
    }
    zvec.close();

    // Aggregate only over queries whose ground truth is non-empty — a query no
    // archived doc contains cannot fairly be scored as a hit or a miss.
    const scorable = gradeRows.filter(r => r.ground > 0);
    const graded = {
        rows: gradeRows,
        sqliteHitRate: scorable.length ? scorable.filter(r => r.sqlite.hit).length / scorable.length : null,
        zvecHitRate: scorable.length ? scorable.filter(r => r.zvec.hit).length / scorable.length : null,
        sqliteMeanPrec: mean(scorable.map(r => r.sqlite.precision)),
        zvecMeanPrec: mean(scorable.map(r => r.zvec.precision)),
    };

    const agreement = rows.length ? rows.filter(r => r.agree).length / rows.length : null;
    console.log('\n🔬 Memory engine A/B — SQLite (default) vs Zvec (jieba FTS)\n');
    console.log('query'.padEnd(38), 'grnd', 'sqlite hit/prec', 'zvec hit/prec');
    for (const r of gradeRows) {
        const fmt = e => `${e.hit ? 'HIT' : 'miss'} ${(e.precision * 100).toFixed(0)}%`;
        console.log(r.query.slice(0, 37).padEnd(38), String(r.ground).padEnd(4),
            fmt(r.sqlite).padEnd(15), fmt(r.zvec));
    }
    const pct = v => (v === null ? 'n/a' : (v * 100).toFixed(0) + '%');
    console.log(`\nscorable queries: ${scorable.length}/${gradeRows.length}`);
    console.log(`hit-rate   sqlite ${pct(graded.sqliteHitRate)}   zvec ${pct(graded.zvecHitRate)}`);
    console.log(`mean prec  sqlite ${pct(graded.sqliteMeanPrec)}   zvec ${pct(graded.zvecMeanPrec)}`);
    console.log(`id-set agreement: ${pct(agreement)} (${rows.length} queries)`);
    console.log('Note: ids are engine-independent; grading is by content substring, not id equality.');
    return { rows, agreement, graded };
}

module.exports = { runMemoryAb, BUILTIN_QUERIES, sampleLogQueries, loadArchiveCorpus, gradeHits };
```

- [x] **Step 4: Run test to verify it passes**

Run: `node ./.evo-lite/cli/test.js all`
Expected: PASS — `✅ T-AB memory-ab passed` and the full suite green.

- [x] **Step 5: Mirror to runtime**

Run: `node .evo-lite/cli/memory.js sync-runtime`
Expected: reports the two changed files copied; a second run reports 0 (parity).

- [x] **Step 6: Commit**

```bash
git add templates/cli/memory-ab.js templates/cli/test/governance.js .evo-lite/cli/memory-ab.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory-ab): graded hit/precision rubric over archive ground truth"
```

---

### Task 2: Evidence artifact (Phase B)

Run the graded rubric for real against the mother's archive and author the decision-gate document: quantitative table, a judged from-logs sample, and a verdict paragraph.

**Files:**
- Create: `docs/memory-engine-flip-evidence.md`

**Interfaces:**
- Consumes: `node .evo-lite/cli/memory.js memory-ab --from-logs` output (graded table + aggregate + id table) from Task 1.
- Produces: `docs/memory-engine-flip-evidence.md` — the file `ac-flip-evidence-artifact` depends on and the gate (Task 3) reads.

- [x] **Step 1: Capture the graded run**

Run: `node .evo-lite/cli/memory.js memory-ab --from-logs`
Expected: the graded table (per-query HIT/miss + precision for both engines), `hit-rate` and `mean prec` aggregate lines, and the id-set agreement line. Copy this output verbatim for the artifact.

- [x] **Step 2: Judge a from-logs disagreement sample** — from the `--from-logs` rows where the engines disagree, pick 5–8 and for each open the returned docs' content (via `node .evo-lite/cli/memory.js list` or reading `raw_memory/*.md`) and assign a verdict: `zvec-better` / `sqlite-better` / `tie`. `tie` = both returned on-topic docs and the id difference is cosmetic.

- [x] **Step 3: Write the evidence artifact** — create `docs/memory-engine-flip-evidence.md`:

```markdown
# Memory Engine Flip — Evidence (2026-07-07)

Decision-gate evidence for `spec:memory-engine-default-flip`: is Zvec (jieba FTS)
good enough to become the default over `sqlite-fts5-trigram`? Ground truth =
literal case-insensitive substring containment over `raw_memory/*.md` bodies.

## Quantitative basis (`mem memory-ab`, graded)

<!-- paste the graded table + aggregate lines from Step 1 verbatim -->

- **sqlite hit-rate:** <fill> · **zvec hit-rate:** <fill>
- **sqlite mean precision:** <fill> · **zvec mean precision:** <fill>
- **Per-query regressions (SQLite HIT → Zvec miss):** <list any, or "none">

## Qualitative corroboration (from-logs judged sample)

| query | sqlite returned (on-topic?) | zvec returned (on-topic?) | verdict |
|---|---|---|---|
<!-- 5-8 judged rows from Step 2 -->

## Verdict

<!-- GO or NO-GO, per the spec threshold: Zvec per-query hit >= SQLite on every
scorable query (no regression), mean precision not materially worse, and no
sqlite-better qualitative counterexample. State GO/NO-GO explicitly with the
one-line reason. -->
```

Fill every `<...>` and the pasted table from the real Step 1/Step 2 data. No placeholders may remain.

- [x] **Step 4: Commit**

```bash
git add docs/memory-engine-flip-evidence.md
git commit -m "docs(evidence): graded SQLite-vs-Zvec recall + flip verdict"
```

---

### Task 3: Decision gate — human GO/NO-GO

A hard checkpoint. Present the evidence; the user decides. This task writes no product code; its deliverable is a recorded decision and a criteria set that matches it.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-memory-engine-default-flip.md` (NO-GO branch only — delete the 3 GO-only criteria from the JSON block)

**Interfaces:**
- Consumes: `docs/memory-engine-flip-evidence.md` (Task 2).
- Produces: a GO or NO-GO decision that gates Tasks 4–6.

- [x] **Step 1: Present the evidence and ask** — summarize `docs/memory-engine-flip-evidence.md` (aggregate hit-rate/precision, any per-query regression, the judged sample) to the user and ask for an explicit **GO** or **NO-GO** against the spec threshold (no per-query regression, precision not materially worse, no `sqlite-better` counterexample).

- [ ] **Step 2a (NO-GO only): Amend the spec and stop** — in the spec's Acceptance Criteria JSON block, delete the `ac-engine-aware-rebuild`, `ac-list-through-seam`, and `ac-default-flip-fallback` objects, leaving `ac-graded-rubric`, `ac-flip-evidence-artifact`, `ac-mirror-parity`. Confirm the evidence artifact's Verdict section records NO-GO. Commit:

```bash
git add docs/superpowers/specs/2026-07-07-memory-engine-default-flip.md
git commit -m "chore(spec): NO-GO — reduce default-flip criteria to Phase B set"
```

Then STOP — do not execute Tasks 4–6. Close the spec on the reduced set; the flip work moves to a follow-up spec.

- [x] **Step 2b (GO only): Proceed** — confirm the evidence artifact's Verdict records GO, then continue to Task 4. No commit needed for this branch (the decision is captured in the artifact from Task 2).

---

### Task 4: Route `list()` through the seam (Phase A — GO only)

Add a `list()` method to the `MemoryIndex` contract so inspection reflects the active engine instead of the frozen SQLite table.

**Files:**
- Modify: `templates/cli/memory-index.js` (add `SqliteFtsIndex.list()`)
- Modify: `templates/cli/memory-index-zvec.js` (add `ZvecMemoryIndex.list()`)
- Modify: `templates/cli/memory.service.js:690-692` (route service `list()` through the seam)
- Modify: `templates/cli/test/governance.js` (new T-LIST block)
- Mirror: the three `.evo-lite/cli/**` counterparts

**Interfaces:**
- Consumes: `SqliteFtsIndex` `getDb()`; `ZvecMemoryIndex._allDocs()` → `[{id, fields:{content,namespace,timestamp}}]`.
- Produces: `MemoryIndex.list()` → `[{id:number, content, namespace, timestamp}]` sorted by ascending id, on both implementations; service `list()` delegates to `getMemoryIndex().list()`.

- [ ] **Step 1: Write the failing test** — add a T-LIST block immediately after the `✅ T-ENGINE selection passed` line in `templates/cli/test/governance.js`:

```js
        console.log('T-LIST. Testing list() routes through the seam ...');
        {
            const { SqliteFtsIndex } = require(path.join(CLI_DIR, 'memory-index.js'));
            const runtime = createTempRuntimeRoot('list-seam');
            await bootstrapRuntime(runtime.runtimeRoot);
            const sq = new SqliteFtsIndex();
            sq.initialize();
            sq.upsert({ content: 'list seam sqlite doc', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
            const sqList = sq.list();
            assert.ok(Array.isArray(sqList) && sqList.length >= 1, 'SqliteFtsIndex.list() returns rows');
            for (const key of ['id', 'content', 'namespace', 'timestamp']) {
                assert.ok(key in sqList[0], `sqlite list row missing ${key}`);
            }
            assert.strictEqual(typeof sqList[0].id, 'number', 'sqlite list id is a number');

            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (zvecAvailable) {
                const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                const zi = new ZvecMemoryIndex();
                zi.initialize();
                zi.upsert({ content: 'list seam zvec doc', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
                const zList = zi.list();
                assert.ok(Array.isArray(zList) && zList.length >= 1, 'ZvecMemoryIndex.list() returns rows');
                for (const key of ['id', 'content', 'namespace', 'timestamp']) {
                    assert.ok(key in zList[0], `zvec list row missing ${key}`);
                }
                assert.strictEqual(typeof zList[0].id, 'number', 'zvec list id is a number');
                zi.close();
            } else {
                console.log('   ⏭️ zvec list() subtest skipped — @zvec/zvec not installed');
            }
        }
        console.log('✅ T-LIST passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `sq.list is not a function`.

- [ ] **Step 3a: Add `SqliteFtsIndex.list()`** — in `templates/cli/memory-index.js`, add a `list()` method to the `SqliteFtsIndex` class, immediately after `stats()` (before `close()`):

```js
    list() {
        return getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
    }
```

- [ ] **Step 3b: Add `ZvecMemoryIndex.list()`** — in `templates/cli/memory-index-zvec.js`, add a `list()` method to the `ZvecMemoryIndex` class, immediately after `stats()` (before `close()`):

```js
    list() {
        return this._allDocs()
            .map(d => ({
                id: Number(d.id),
                content: d.fields.content,
                namespace: d.fields.namespace,
                timestamp: d.fields.timestamp,
            }))
            .sort((a, b) => a.id - b.id);
    }
```

- [ ] **Step 3c: Route the service `list()`** — in `templates/cli/memory.service.js`, replace the current `list()` (line ~690–692):

```js
function list() {
    return getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
}
```

with:

```js
function list() {
    return getMemoryIndex().list();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./.evo-lite/cli/test.js all`
Expected: PASS — `✅ T-LIST passed` and full suite green.

- [ ] **Step 5: Mirror to runtime**

Run: `node .evo-lite/cli/memory.js sync-runtime`
Expected: three files copied; a second run reports 0 (parity).

- [ ] **Step 6: Commit**

```bash
git add templates/cli/memory-index.js templates/cli/memory-index-zvec.js templates/cli/memory.service.js templates/cli/test/governance.js .evo-lite/cli/memory-index.js .evo-lite/cli/memory-index-zvec.js .evo-lite/cli/memory.service.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): route list() through the MemoryIndex seam"
```

---

### Task 5: Engine-aware `rebuild` (Phase A — GO only)

Generalize `rebuildLocalIndex()`'s SQLite-hardcoded wipe preamble so, under `engine=zvec`, it wipes and rebuilds the Zvec collection from `raw_memory/*.md` via the seam. Idempotent by full rebuild.

**Files:**
- Modify: `templates/cli/memory-index.js` (add `resetMemoryIndex()`, export it)
- Modify: `templates/cli/memory.service.js` (imports at ~line 33; `rebuildLocalIndex()` at ~line 1630)
- Modify: `templates/cli/test/governance.js` (new T-REBUILD-ZVEC block)
- Mirror: the three `.evo-lite/cli/**` counterparts

**Interfaces:**
- Consumes: `resolveEngine()` → engine string; `getMemoryIndex().close()`; `getRawMemoryDir()`, `syncIndexMemory()`, `DB_PATH`.
- Produces: `resetMemoryIndex()` (memory-index.js) clears the module `active` singleton so the next `getMemoryIndex()` re-initializes against a freshly-wiped collection; `rebuildLocalIndex()` becomes engine-aware.

- [ ] **Step 1: Write the failing test** — add a T-REBUILD-ZVEC block immediately after `✅ T-LIST passed` in `templates/cli/test/governance.js`:

```js
        console.log('T-REBUILD-ZVEC. Testing engine-aware rebuild (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const runtime = createTempRuntimeRoot('rebuild-zvec');
                await bootstrapRuntime(runtime.runtimeRoot);
                const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                try {
                    // Fresh service module bound to this runtime + engine.
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory-index.js'))];
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory.service.js'))];
                    const svc = require(path.join(CLI_DIR, 'memory.service.js'));
                    const mi = require(path.join(CLI_DIR, 'memory-index.js'));

                    // Archive a doc — writes raw_memory/*.md AND upserts into the zvec engine.
                    await svc.archive('rebuild probe doc mentioning memory.service recall', 'task');
                    assert.ok(mi.getMemoryIndex().searchText('rebuild probe', { topK: 5 }).length > 0, 'doc recallable pre-rebuild');

                    // Engine-aware rebuild: wipes .evo-lite/zvec, repopulates from raw_memory/*.md.
                    await svc.rebuildLocalIndex();

                    const after = mi.getMemoryIndex().searchText('rebuild probe', { topK: 5 });
                    assert.ok(after.length > 0, 'doc still recallable after zvec rebuild (repopulated from archive)');
                } finally {
                    if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE; else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory-index.js'))];
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory.service.js'))];
                }
            }
        }
        console.log('✅ T-REBUILD-ZVEC passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: FAIL — after `rebuildLocalIndex()` the SQLite-only wipe leaves the zvec collection handle pointing at a stale dir (or the doc is not repopulated into zvec), so `after.length > 0` fails. (If `@zvec/zvec` is absent the block skips — run on a box where it is installed to see the red.)

- [ ] **Step 3a: Add `resetMemoryIndex()`** — in `templates/cli/memory-index.js`, add after `getMemoryIndex()` and update the exports:

```js
function resetMemoryIndex() {
    active = null;
}

module.exports = { SqliteFtsIndex, getMemoryIndex, resetMemoryIndex, resolveEngine, selectEngine, DEFAULT_ENGINE_CHOICE };
```

(Replace the existing `module.exports = { SqliteFtsIndex, getMemoryIndex, resolveEngine, selectEngine };` line. `DEFAULT_ENGINE_CHOICE` is exported now so Task 6 can assert on it.)

- [ ] **Step 3b: Import the new helpers in the service** — in `templates/cli/memory.service.js`, replace the seam import at line 33:

```js
const { getMemoryIndex } = require('./memory-index');
```

with:

```js
const { getMemoryIndex, resolveEngine, resetMemoryIndex } = require('./memory-index');
```

- [ ] **Step 3c: Make the wipe engine-aware** — in `templates/cli/memory.service.js`, replace the wipe preamble inside `rebuildLocalIndex()` (the block from `let backupName = null;` through `initDB();`, currently ~lines 1646–1656):

```js
    let backupName = null;
    if (fs.existsSync(DB_PATH)) {
        closeDb();
        const backupPath = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        fs.copyFileSync(DB_PATH, backupPath);
        fs.unlinkSync(DB_PATH);
        backupName = path.basename(backupPath);
        console.log(`📦 旧记忆脑区已备份至: ${backupName}`);
    }

    initDB();
```

with:

```js
    const engine = resolveEngine();
    let backupName = null;
    if (engine === 'zvec') {
        // Zvec branch: close any open collection, drop the singleton, then wipe the
        // derived collection dir. syncIndexMemory() below repopulates it from the
        // raw_memory/*.md source of truth via the seam. Full-rebuild idempotent.
        try { getMemoryIndex().close(); } catch (_) {}
        resetMemoryIndex();
        const zvecDir = path.join(path.dirname(DB_PATH), 'zvec');
        if (fs.existsSync(zvecDir)) {
            fs.rmSync(zvecDir, { recursive: true, force: true });
            console.log('📦 旧 Zvec collection 已清除，将从 raw_memory 全量重建。');
        }
    } else if (fs.existsSync(DB_PATH)) {
        closeDb();
        const backupPath = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        fs.copyFileSync(DB_PATH, backupPath);
        fs.unlinkSync(DB_PATH);
        backupName = path.basename(backupPath);
        console.log(`📦 旧记忆脑区已备份至: ${backupName}`);
    }

    initDB();
```

(`initDB()` stays unconditional — it only ensures the SQLite schema for non-memory tables; under zvec the memory docs live in the collection, not `raw_memory`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./.evo-lite/cli/test.js all`
Expected: PASS — `✅ T-REBUILD-ZVEC passed` and full suite green.

- [ ] **Step 5: Mirror to runtime**

Run: `node .evo-lite/cli/memory.js sync-runtime`
Expected: three files copied; a second run reports 0 (parity).

- [ ] **Step 6: Commit**

```bash
git add templates/cli/memory-index.js templates/cli/memory.service.js templates/cli/test/governance.js .evo-lite/cli/memory-index.js .evo-lite/cli/memory.service.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): engine-aware rebuild wipes+repopulates zvec from archive"
```

---

### Task 6: Flip the default + migrate + docs (Phase A — GO only)

Flip `DEFAULT_ENGINE_CHOICE` to `'zvec'`, update the T-ENGINE default assertion, migrate the mother's live memory into the zvec collection, and update the engine docs.

**Files:**
- Modify: `templates/cli/memory-index.js:166` (`DEFAULT_ENGINE_CHOICE`)
- Modify: `templates/cli/test/governance.js` (T-ENGINE block, ~line 1978)
- Modify: `docs/zvec-spike-findings.md` ("Choosing the memory engine" section)
- Mirror: `.evo-lite/cli/memory-index.js`, `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Consumes: `DEFAULT_ENGINE_CHOICE` export (added in Task 5); `selectEngine`, `resolveEngine`.
- Produces: default (no env, no `memory-engine.json`) resolves to `'zvec'`; the depless fallback to `SqliteFtsIndex` is now the default-experience guarantee for children without the prebuild.

- [ ] **Step 1: Write the failing test** — in `templates/cli/test/governance.js`, extend the T-ENGINE block. Add these assertions inside it (after the existing `class FakeZvec ...` / env-override assertions, before the closing brace):

```js
            // default flipped: the module constant is now zvec
            const { DEFAULT_ENGINE_CHOICE } = require(path.join(CLI_DIR, 'memory-index.js'));
            assert.strictEqual(DEFAULT_ENGINE_CHOICE, 'zvec', 'default engine flipped to zvec');

            // a depless instance still degrades to SqliteFtsIndex (children-not-forced holds under the flip)
            const deplessDefault = selectEngine(DEFAULT_ENGINE_CHOICE, () => null);
            assert.ok(deplessDefault instanceof SqliteFtsIndex, 'depless default falls back to SqliteFtsIndex');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `default engine flipped to zvec` (constant is still `'sqlite-fts5-trigram'`).

- [ ] **Step 3: Flip the constant** — in `templates/cli/memory-index.js` line 166:

```js
const DEFAULT_ENGINE_CHOICE = 'sqlite-fts5-trigram';
```

→

```js
const DEFAULT_ENGINE_CHOICE = 'zvec';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./.evo-lite/cli/test.js all`
Expected: PASS — T-ENGINE green, full suite green. (T-ZV/T-REBUILD-ZVEC still skip cleanly if `@zvec/zvec` is absent; T-ENGINE's new assertions do not require the native dep.)

- [ ] **Step 5: Mirror to runtime**

Run: `node .evo-lite/cli/memory.js sync-runtime`
Expected: two files copied; a second run reports 0 (parity).

- [ ] **Step 6: Migrate the mother's memory into zvec** — the mother now defaults to zvec but its docs live in the frozen SQLite `raw_memory` table; repopulate the zvec collection from the archive:

Run: `node .evo-lite/cli/memory.js rebuild`
Expected: "旧 Zvec collection 已清除，将从 raw_memory 全量重建" then a rebuild summary with `rebuilt_archives`/`rebuilt_chunks` > 0.

Then smoke-test recall against the live (now default = zvec) engine:

Run: `node .evo-lite/cli/memory.js recall "task:zvec-memory-index-t5"`
Expected: non-empty results (the colon-query matchString path over the freshly-built zvec collection).

- [ ] **Step 7: Update the engine docs** — in `docs/zvec-spike-findings.md`, "Choosing the memory engine" section, change the opening line `The default engine is \`sqlite-fts5-trigram\`. To try Zvec:` to state Zvec is now the default with SQLite as the config-only opt-out / rollback. Replace that paragraph with:

```markdown
The default engine is now **`zvec`** (flipped in `spec:memory-engine-default-flip`,
gated on `docs/memory-engine-flip-evidence.md`). An instance without the `@zvec/zvec`
prebuild degrades to `SqliteFtsIndex` with a warning — no child is broken by lacking
the optional dep. To pin SQLite (the rollback path):

1. write `.evo-lite/memory-engine.json` → `{ "engine": "sqlite-fts5-trigram" }`
   (committable, inspectable; nurture never overwrites a child's choice), or
2. set `EVO_LITE_MEMORY_ENGINE=sqlite-fts5-trigram` (env overrides the file).

After a fresh clone or an engine change, run `node .evo-lite/cli/memory.js rebuild`
to (re)build the active engine's index from `raw_memory/*.md` — the single source of
truth. Rollback is config-only and lossless: the SQLite index is never deleted by
adopting Zvec (each engine owns its own derived store).
```

- [ ] **Step 8: Commit**

```bash
git add templates/cli/memory-index.js templates/cli/test/governance.js docs/zvec-spike-findings.md .evo-lite/cli/memory-index.js .evo-lite/cli/test/governance.js
git commit -m "feat(memory): flip default engine to zvec (fallback + config rollback intact)"
```

---

## Self-Review

**1. Spec coverage:**
- B1 graded quantitative basis → Task 1 (`gradeHits`, per-query hit/precision, aggregate). ✓
- B2 qualitative from-logs sample → Task 2 Step 2 + evidence table. ✓
- B3 evidence artifact → Task 2. ✓ (`ac-flip-evidence-artifact` dependsOn `docs/memory-engine-flip-evidence.md`)
- Decision gate (human GO/NO-GO, NO-GO amends criteria) → Task 3. ✓
- A1 engine-aware reindex via existing `rebuild` → Task 5. ✓ (`ac-engine-aware-rebuild`)
- A2 `list()` through the seam → Task 4. ✓ (`ac-list-through-seam`)
- A3 flip `DEFAULT_ENGINE_CHOICE` + fallback → Task 6. ✓ (`ac-default-flip-fallback`)
- A4 rollback safety → Task 6 Step 7 docs (SQLite index never deleted; config-only rollback). ✓
- A5 tests + docs → T-AB (T1), T-LIST (T4), T-REBUILD-ZVEC (T5), T-ENGINE update (T6), docs (T6). ✓
- `ac-graded-rubric` (test.js all) → T-AB in Task 1. ✓
- `ac-mirror-parity` → sync-runtime Step in every Phase-A task. ✓

**2. Placeholder scan:** The only `<...>` placeholders are inside the *evidence artifact template* (Task 2 Step 3), which Step 3 explicitly requires filling from real Step 1/Step 2 data before commit. No placeholder code steps.

**3. Type consistency:** `list()` returns `[{id:number, content, namespace, timestamp}]` in both engines and the service delegator (Tasks 4). `resetMemoryIndex()` / `DEFAULT_ENGINE_CHOICE` are defined+exported in Task 5 Step 3a and consumed in Task 5 Step 3b–c and Task 6 Step 1/3. `gradeHits(results, query)` shape (`{hit, precision, returned, onTopic}`) defined in Task 1 Step 3 and asserted in Task 1 Step 1. `resolveEngine()` return string consumed in Task 5 Step 3c. Consistent.

**Gate honesty:** On NO-GO, Task 3 Step 2a deletes exactly the three GO-only criteria, leaving a set (`ac-graded-rubric`, `ac-flip-evidence-artifact`, `ac-mirror-parity`) all satisfied by Phase B — closure stays honest in both branches.
