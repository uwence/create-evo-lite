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
const { getLogPath, getDbPath } = require('./runtime');
const { generateSnippet } = require('./memory-index-util');
// Both are zvec-free by construction — requiring them here must not pull in the
// native binding, or the containment decision would happen after the hazard.
const { zvecCollectionPath } = require('./zvec-collection-path');
const { classifyCollectionPath } = require('./zvec-path-containment');

const fs = require('fs');
const path = require('path');

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

    list() {
        return getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
    }

    close() {
        closeDb();
    }
}

const DEFAULT_ENGINE_CHOICE = 'zvec';

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

// [zvec-win-unicode-containment] AC3 — ONE decision, consumed twice.
//
// Diagnosis (resolveActiveImpl) and instantiation (getMemoryIndex → selectEngine)
// used to reach loadZvecIndex() independently, and defaultLoadZvecIndex()'s first
// statement is require('@zvec/zvec'). On Windows, some non-ASCII collection paths
// make the native side terminate the process with 0xC0000409, which no try/catch
// can contain — so the load itself is what must not happen (spec I1). Guarding
// only one of the two consumers would have left the runtime unprotected.
//
// resolveEngineDecision() therefore classifies the collection path BEFORE any
// load and, when the verdict is not SAFE, returns a sqlite decision without ever
// calling loadZvecIndex. The zero-load property is the single most important
// executable guarantee in this spec (§6.2) and is asserted by T-zwuc-T6.
//
// Nothing here opens or creates a collection: on a non-SAFE path ZvecIndex stays
// null, so ZvecMemoryIndex — which is what mkdirs the directory and calls
// ZVecOpen/ZVecCreateAndOpen in initialize() — is never constructed.
function resolveEngineDecision(options = {}) {
    const loadZvecIndex = options.loadZvecIndex || defaultLoadZvecIndex;
    const choice = options.choice === undefined ? resolveEngine() : options.choice;

    if (choice !== 'zvec') {
        return {
            choice, impl: 'sqlite', degraded: false, ZvecIndex: null,
            containment: null, collectionPath: null, reason: 'engine-choice',
        };
    }

    let collectionPath;
    try {
        collectionPath = options.collectionPath === undefined
            ? zvecCollectionPath()
            : options.collectionPath;
    } catch (err) {
        // Cannot even name the path, so it cannot be classified. Fail closed.
        return {
            choice, impl: 'sqlite', degraded: true, ZvecIndex: null, collectionPath: null,
            containment: {
                verdict: 'UNKNOWN',
                layer: 'path',
                reason: `path:collection-path-unresolvable:${(err && err.code) || 'ERROR'}`,
            },
            reason: 'containment',
        };
    }

    const containment = classifyCollectionPath(collectionPath, {
        platform: options.platform,
        fsOps: options.fsOps,
    });
    if (containment.verdict !== 'SAFE') {
        // loadZvecIndex is deliberately NOT called on this branch.
        return {
            choice, impl: 'sqlite', degraded: true, ZvecIndex: null,
            containment, collectionPath, reason: 'containment',
        };
    }

    const ZvecIndex = loadZvecIndex();
    return {
        choice,
        impl: ZvecIndex ? 'zvec' : 'sqlite',
        degraded: !ZvecIndex,
        ZvecIndex: ZvecIndex || null,
        containment,
        collectionPath,
        reason: ZvecIndex ? 'zvec' : 'dependency-unavailable',
    };
}

let active = null;
let decision = null;

// THE shared decision. Both consumers below read this same object, which is what
// makes "one decision, two consumers" observable rather than merely intended.
function sharedEngineDecision() {
    if (!decision) decision = resolveEngineDecision();
    return decision;
}

// Read-only access to the decision already taken; null when none has been.
// Diagnostics (Task 7) consume this rather than recomputing.
function peekEngineDecision() {
    return decision;
}

function instantiateFromDecision(d) {
    if (d && d.ZvecIndex) return new d.ZvecIndex();
    if (d && d.reason === 'dependency-unavailable') {
        console.warn('⚠️ memory engine "zvec" selected but @zvec/zvec is unavailable — falling back to SqliteFtsIndex.');
    } else if (d && d.reason === 'containment') {
        // Deliberately worded as containment, not as a fix: the upstream native
        // fault is untouched, this process simply refuses to enter it.
        console.warn(`⚠️ memory engine "zvec" is contained on this path (${d.containment && d.containment.reason}) — using SqliteFtsIndex.`);
    }
    return new SqliteFtsIndex();
}

// Return shape is pinned to {choice, impl, degraded}: memory.service consumes it
// as `engineImpl` and T-ENGINE deep-compares it. Containment detail is reached
// through peekEngineDecision()/resolveEngineDecision() instead of widening this.
function resolveActiveImpl(loadZvecIndex) {
    const d = loadZvecIndex === undefined
        ? sharedEngineDecision()
        : resolveEngineDecision({ loadZvecIndex });
    return { choice: d.choice, impl: d.impl, degraded: d.degraded };
}

// Legacy positional form (engine, loader) is preserved for existing callers; an
// options object may be passed instead when a test needs to pin platform,
// collection path or probe behaviour deterministically.
function selectEngine(engine, loadZvecIndex) {
    if (engine === undefined && loadZvecIndex === undefined) {
        return instantiateFromDecision(sharedEngineDecision());
    }
    const options = (engine && typeof engine === 'object')
        ? engine
        : { choice: engine, loadZvecIndex };
    return instantiateFromDecision(resolveEngineDecision(options));
}

function getMemoryIndex() {
    if (!active) {
        active = instantiateFromDecision(sharedEngineDecision());
    }
    return active;
}

// Drop the cached engine so the next getMemoryIndex() re-initializes. Used by
// rebuild after wiping a derived store so no stale handle points at a removed dir.
// The decision is dropped with it: the collection path or its topology may have
// changed, and a stale SAFE verdict would be exactly the wrong thing to keep.
function resetMemoryIndex() {
    active = null;
    decision = null;
}

// 只读访问当前活动索引(不创建实例)。MCP shutdown 用它收尾:实例从未创建时
// 不应因收尾反而去打开一次索引。
function peekMemoryIndex() {
    return active;
}

module.exports = {
    SqliteFtsIndex, getMemoryIndex, resetMemoryIndex, peekMemoryIndex,
    resolveEngine, resolveActiveImpl, selectEngine, DEFAULT_ENGINE_CHOICE,
    resolveEngineDecision, peekEngineDecision, instantiateFromDecision,
};
