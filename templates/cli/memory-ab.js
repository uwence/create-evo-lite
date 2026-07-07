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
