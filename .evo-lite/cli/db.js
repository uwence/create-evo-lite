const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { getDbPath } = require('./runtime');

let db;

// Allowed namespaces. Adding a new ns is intentionally explicit so that no
// caller silently sprays vectors into a fresh table.
const NAMESPACES = ['prose', 'code', 'symbol'];
const DEFAULT_NAMESPACE = 'prose';

function isValidNamespace(ns) {
    return NAMESPACES.includes(ns);
}

function getNamespaces() {
    return NAMESPACES.slice();
}

function getDb() {
    if (!db) {
        const dbPath = getDbPath();
        db = new Database(dbPath);
        sqliteVec.load(db);
        try {
            db.pragma('journal_mode = WAL');
            db.pragma('busy_timeout = 5000');
            db.pragma('synchronous = NORMAL');
        } catch (error) {
            // Some long-lived dogfooding databases become unstable after pragma changes.
            // Reopen the connection in a conservative compatibility mode instead of failing hard.
            console.warn(`⚠️ 数据库增强模式启用失败，已回退到兼容模式: ${error.message}`);
            try {
                db.close();
            } catch (_) {}
            db = new Database(dbPath);
            sqliteVec.load(db);
        }
    }
    return db;
}

function tableExists(database, name) {
    const row = database
        .prepare("SELECT name, type FROM sqlite_master WHERE name = ?")
        .get(name);
    return Boolean(row && row.type === 'table');
}

// One-time migration: legacy `vectors` / `chunks` tables become the prose
// namespace tables. This preserves data for users coming from earlier versions.
function migrateLegacyTablesToProse(database) {
    const hasLegacyVectors = tableExists(database, 'vectors');
    const hasLegacyChunks = tableExists(database, 'chunks');
    const hasProseVectors = tableExists(database, 'vectors_prose');
    const hasProseChunks = tableExists(database, 'chunks_prose');

    if (hasLegacyVectors && !hasProseVectors) {
        database.exec('ALTER TABLE vectors RENAME TO vectors_prose;');
    }
    if (hasLegacyChunks && !hasProseChunks) {
        database.exec('ALTER TABLE chunks RENAME TO chunks_prose;');
    }
}

function getModelMetaKey(namespace) {
    return namespace === DEFAULT_NAMESPACE
        ? 'embedding_model'
        : `embedding_model:${namespace}`;
}

function getDimsMetaKey(namespace) {
    return namespace === DEFAULT_NAMESPACE
        ? 'embedding_dims'
        : `embedding_dims:${namespace}`;
}

function readNamespaceFingerprint(database, namespace) {
    const modelRow = database
        .prepare('SELECT value FROM _meta WHERE key = ?')
        .get(getModelMetaKey(namespace));
    const dimsRow = database
        .prepare('SELECT value FROM _meta WHERE key = ?')
        .get(getDimsMetaKey(namespace));
    return {
        model: modelRow ? modelRow.value : null,
        dims: dimsRow ? parseInt(dimsRow.value, 10) : null,
    };
}

function writeNamespaceFingerprint(database, namespace, model, dims) {
    database
        .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
        .run(getModelMetaKey(namespace), model);
    database
        .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
        .run(getDimsMetaKey(namespace), String(dims));
}

function ensureNamespaceTables(database, namespace, model, dims) {
    if (!isValidNamespace(namespace)) {
        throw new Error(`Unknown vector namespace: ${namespace}`);
    }

    const vectorsTable = `vectors_${namespace}`;
    const chunksTable = `chunks_${namespace}`;
    const fp = readNamespaceFingerprint(database, namespace);
    let vectorsReset = false;

    if (
        fp.model !== null &&
        fp.dims !== null &&
        (fp.model !== model || fp.dims !== dims)
    ) {
        console.warn(
            `⚠️ Namespace '${namespace}' fingerprint mismatch! Expected ${model} (${dims}d), found ${fp.model} (${fp.dims}d). Re-initializing only this namespace's vector tables.`
        );
        database.exec(`DROP TABLE IF EXISTS ${vectorsTable};`);
        database.exec(`DROP TABLE IF EXISTS ${chunksTable};`);
        vectorsReset = true;
    }

    writeNamespaceFingerprint(database, namespace, model, dims);

    database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorsTable} USING vec0(
            embedding float[${dims}]
        );
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS ${chunksTable} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_memory_id INTEGER,
            chunk_index INTEGER,
            content TEXT,
            vector_id INTEGER
        );
    `);

    return { vectorsReset };
}

function initDB(activeModel, activeDims, options = {}) {
    const database = getDb();

    database.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS raw_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            namespace TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Backfill `namespace` column for databases created before P0.
    try {
        const cols = database.prepare("PRAGMA table_info(raw_memory)").all();
        if (!cols.some(c => c.name === 'namespace')) {
            database.exec("ALTER TABLE raw_memory ADD COLUMN namespace TEXT;");
        }
    } catch (_) {}

    migrateLegacyTablesToProse(database);

    const namespace = options.namespace || DEFAULT_NAMESPACE;
    const result = ensureNamespaceTables(database, namespace, activeModel, activeDims);

    return { vectorsReset: result.vectorsReset };
}

function getNamespaceCounts(database = getDb()) {
    const counts = {};
    for (const ns of NAMESPACES) {
        const chunksTable = `chunks_${ns}`;
        if (!tableExists(database, chunksTable)) {
            counts[ns] = { chunks: 0, present: false };
            continue;
        }
        try {
            const row = database
                .prepare(`SELECT COUNT(*) AS count FROM ${chunksTable}`)
                .get();
            const fp = readNamespaceFingerprint(database, ns);
            counts[ns] = {
                chunks: row.count,
                present: true,
                model: fp.model,
                dims: fp.dims,
            };
        } catch (_) {
            counts[ns] = { chunks: 0, present: false };
        }
    }
    return counts;
}

function closeDb() {
    if (!db) {
        return;
    }
    try {
        db.close();
    } catch (_) {}
    db = null;
}

module.exports = {
    DEFAULT_NAMESPACE,
    NAMESPACES,
    closeDb,
    ensureNamespaceTables,
    getDb,
    getNamespaces,
    getNamespaceCounts,
    initDB,
    isValidNamespace,
    readNamespaceFingerprint,
    tableExists,
};
