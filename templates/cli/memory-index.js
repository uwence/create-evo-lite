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
