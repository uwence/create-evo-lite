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
