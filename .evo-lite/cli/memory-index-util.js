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

// Exact-boost re-rank. jieba-FTS tokenizes a multi-word query into an OR of
// terms, so a doc matching *any* term (BM25) can out-rank the doc containing the
// literal phrase (spec:memory-engine-default-flip `dogfood cycle` regression).
// Re-rank the candidate rows into relevance tiers while preserving the engine's
// score order *within* each tier (stable). Only fires for multi-token queries —
// single-token queries keep the engine order untouched, so the cases Zvec
// already improved are never perturbed.
//   tier 0: content contains the literal phrase (normalized substring)
//   tier 1: content contains every query token (order-independent AND)
//   tier 2: everything else (engine OR order)
function rerankByExact(rows, query, getContent = r => r) {
    const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
    const nq = norm(query);
    const tokens = nq.split(' ').filter(Boolean);
    if (tokens.length < 2) return rows.slice();

    const tier = row => {
        const c = norm(getContent(row));
        if (c.includes(nq)) return 0;
        if (tokens.every(t => c.includes(t))) return 1;
        return 2;
    };
    // decorate-sort-undecorate keeps it stable across engines regardless of
    // Array.prototype.sort stability guarantees on older runtimes.
    return rows
        .map((row, i) => ({ row, i, t: tier(row) }))
        .sort((a, b) => (a.t - b.t) || (a.i - b.i))
        .map(x => x.row);
}

module.exports = { generateSnippet, rerankByExact };
