'use strict';

const fs = require('fs');
const path = require('path');
const { getRawMemoryDir, getLogPath } = require('./runtime');
// [zvec-win-unicode-containment] Task 5 — the A/B goes through the same
// containment decision as every other engine consumer. This module loads no
// native code by itself; memory-index only reaches the binding after a SAFE
// verdict, and this file never requires @zvec/zvec or ./memory-index-zvec.
const { resolveEngineDecision, SqliteFtsIndex } = require('./memory-index');

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
// `paths` is the snapshot the containment decision actually judged — the engine
// must open the path that was cleared, not one it re-derives afterwards.
function buildZvecFromArchive(ZvecMemoryIndex, paths) {
    const idx = new ZvecMemoryIndex(paths ? { paths } : undefined);
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

// Refusal, not degradation. Falling back to "SQLite vs SQLite" would print a
// comparison table showing near-perfect agreement while measuring nothing — a
// false green is worse than a missing result. memory.js turns a thrown error
// into exit code 1, so the refusal is observable to a script, not just a human.
function buildContainedError(decision) {
    const containment = decision.containment
        || { verdict: 'UNKNOWN', reason: 'containment:decision-carried-no-verdict' };
    const err = new Error(
        'A/B comparison refused: the Zvec collection path is contained on this host.\n'
        + `containment: ${containment.verdict} (${containment.reason})\n`
        + `collection: ${decision.collectionPath || '<unresolvable>'}\n`
        + 'No sqlite-vs-sqlite comparison was run — comparing SQLite against itself '
        + 'would report agreement while comparing nothing.\n'
        + 'The existing collection, if any, was neither opened nor modified.');
    err.code = 'EVO_ZVEC_CONTAINED';
    err.verdict = containment.verdict;
    err.containment = containment;
    err.collectionPath = decision.collectionPath || null;
    return err;
}

// [zvec-win-unicode-containment] Task 5 — this used to be the last selector
// bypass: its first statement resolved the native binding directly, so the
// offline A/B reached it before anything classified the collection path. On a
// contained path that is exactly the load the spec forbids (I1), and no
// try/catch can contain the fault it triggers.
//
// opts.decisionInputs forwards the same options memory-index already accepts
// (platform / paths / fsOps / loadZvecIndex). Production passes nothing and
// inherits the ambient decision; the seam exists so a test can pin a verdict
// without a real native binding, not to give this call different semantics
// under test.
async function runMemoryAb(opts = {}) {
    const decision = resolveEngineDecision({ choice: 'zvec', ...(opts.decisionInputs || {}) });
    if (!decision.containment || decision.containment.verdict !== 'SAFE') {
        // Thrown BEFORE the SQLite comparison instance exists: a refused run
        // must not leave half a comparison behind.
        throw buildContainedError(decision);
    }
    if (!decision.ZvecIndex) {
        console.log('⏭️  @zvec/zvec is not installed — run `npm i @zvec/zvec` to enable the A/B. Nothing to compare.');
        return { rows: [], agreement: null, graded: null };
    }

    // Force the SQLite engine directly (NOT recall(), which honours memory-engine.json
    // and could otherwise make this a zvec-vs-zvec comparison).
    const sqlite = new SqliteFtsIndex();
    sqlite.initialize();
    const zvec = buildZvecFromArchive(decision.ZvecIndex, decision.paths);
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

module.exports = { runMemoryAb, buildContainedError, BUILTIN_QUERIES, sampleLogQueries, loadArchiveCorpus, gradeHits };
