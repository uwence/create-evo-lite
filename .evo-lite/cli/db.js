const Database = require('better-sqlite3');
const { getDbPath } = require('./runtime');

let db;

const NAMESPACES = ['prose', 'code', 'symbol'];
const DEFAULT_NAMESPACE = 'prose';
const DEFAULT_ENGINE = 'sqlite-fts5-trigram';
const DEFAULT_ENGINE_VERSION = '1';

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
        try {
            db.pragma('journal_mode = WAL');
            db.pragma('busy_timeout = 5000');
            db.pragma('synchronous = NORMAL');
        } catch (error) {
            console.warn(`⚠️ 数据库增强模式启用失败，已回退到兼容模式: ${error.message}`);
            try {
                db.close();
            } catch (_) {}
            db = new Database(dbPath);
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

function getModelMetaKey(namespace) {
    // Keep the on-disk key names stable so existing databases do not need a
    // metadata migration after the engine wording cleanup.
    return namespace === DEFAULT_NAMESPACE
        ? 'memory_engine'
        : `memory_engine:${namespace}`;
}

function getDimsMetaKey(namespace) {
    // Same compatibility rule as getModelMetaKey(): storage stays stable even
    // though user-facing semantics now say "local index engine".
    return namespace === DEFAULT_NAMESPACE
        ? 'memory_engine_version'
        : `memory_engine_version:${namespace}`;
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
        dims: dimsRow ? dimsRow.value : null,
    };
}

function writeNamespaceFingerprint(database, namespace, model = DEFAULT_ENGINE, dims = DEFAULT_ENGINE_VERSION) {
    database
        .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
        .run(getModelMetaKey(namespace), model);
    database
        .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
        .run(getDimsMetaKey(namespace), String(dims));
}

function ensureNamespaceTables(database, namespace, model = DEFAULT_ENGINE, dims = DEFAULT_ENGINE_VERSION) {
    if (!isValidNamespace(namespace)) {
        throw new Error(`Unknown memory namespace: ${namespace}`);
    }
    writeNamespaceFingerprint(database, namespace, model, dims);
    return { indexReset: false };
}

function initDB(activeModel = DEFAULT_ENGINE, activeDims = DEFAULT_ENGINE_VERSION, options = {}) {
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
            content TEXT NOT NULL,
            namespace TEXT DEFAULT '${DEFAULT_NAMESPACE}',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS session_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            tool TEXT,
            command TEXT,
            success INTEGER,
            payload TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    try {
        const cols = database.prepare("PRAGMA table_info(raw_memory)").all();
        if (!cols.some(c => c.name === 'namespace')) {
            database.exec("ALTER TABLE raw_memory ADD COLUMN namespace TEXT DEFAULT 'prose';");
        }
    } catch (_) {}

    database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS raw_memory_fts USING fts5(
            content,
            namespace UNINDEXED,
            content='raw_memory',
            content_rowid='id',
            tokenize='trigram',
            detail='none'
        );

        CREATE TRIGGER IF NOT EXISTS raw_memory_ai AFTER INSERT ON raw_memory BEGIN
            INSERT INTO raw_memory_fts(rowid, content, namespace)
            VALUES (new.id, new.content, COALESCE(new.namespace, '${DEFAULT_NAMESPACE}'));
        END;

        CREATE TRIGGER IF NOT EXISTS raw_memory_ad AFTER DELETE ON raw_memory BEGIN
            INSERT INTO raw_memory_fts(raw_memory_fts, rowid, content, namespace)
            VALUES ('delete', old.id, old.content, COALESCE(old.namespace, '${DEFAULT_NAMESPACE}'));
        END;

        CREATE TRIGGER IF NOT EXISTS raw_memory_au AFTER UPDATE OF content, namespace ON raw_memory BEGIN
            INSERT INTO raw_memory_fts(raw_memory_fts, rowid, content, namespace)
            VALUES ('delete', old.id, old.content, COALESCE(old.namespace, '${DEFAULT_NAMESPACE}'));
            INSERT INTO raw_memory_fts(rowid, content, namespace)
            VALUES (new.id, new.content, COALESCE(new.namespace, '${DEFAULT_NAMESPACE}'));
        END;
    `);

    try {
        database.prepare("INSERT INTO raw_memory_fts(raw_memory_fts) VALUES ('rebuild')").run();
    } catch (_) {}

    const namespace = options.namespace || DEFAULT_NAMESPACE;
    ensureNamespaceTables(database, namespace, activeModel, activeDims);
    for (const knownNamespace of NAMESPACES) {
        ensureNamespaceTables(database, knownNamespace, activeModel, activeDims);
    }

    return { indexReset: false };
}

function insertSessionEvent(database = getDb(), entry = {}) {
    const event = typeof entry.event === 'string' ? entry.event.trim() : '';
    if (!event) {
        throw new Error('session event requires a non-empty event name');
    }
    const success = entry.success === null || entry.success === undefined
        ? null
        : entry.success
            ? 1
            : 0;
    const payload = entry.payload === null || entry.payload === undefined
        ? null
        : JSON.stringify(entry.payload);
    const info = database.prepare(`
        INSERT INTO session_events (event, tool, command, success, payload, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        event,
        entry.tool || null,
        entry.command || null,
        success,
        payload,
        entry.timestamp || new Date().toISOString()
    );
    return Number(info.lastInsertRowid);
}

function listSessionEvents(database = getDb(), options = {}) {
    const limit = Number.isInteger(options.limit) ? options.limit : 20;
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const eventFilter = typeof options.event === 'string' && options.event.trim()
        ? options.event.trim()
        : null;
    let sql = `
        SELECT id, event, tool, command, success, payload, timestamp
        FROM session_events
    `;
    const params = [];
    if (eventFilter) {
        sql += ' WHERE event = ?';
        params.push(eventFilter);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(safeLimit);
    const rows = database.prepare(sql).all(...params);
    return rows.map(row => ({
        ...row,
        payload: row.payload ? safeJsonParse(row.payload) : null,
        success: row.success === null ? null : Boolean(row.success),
    }));
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

function getNamespaceCounts(database = getDb()) {
    const rows = database.prepare(`
        SELECT namespace, COUNT(*) AS count
        FROM raw_memory
        GROUP BY namespace
    `).all();
    const countsByNamespace = new Map(rows.map(row => [row.namespace || DEFAULT_NAMESPACE, row.count]));
    const counts = {};
    for (const ns of NAMESPACES) {
        const fp = readNamespaceFingerprint(database, ns);
        const count = countsByNamespace.get(ns) || 0;
        counts[ns] = {
            chunks: count,
            present: Boolean(fp.model || count > 0),
            model: fp.model || DEFAULT_ENGINE,
            dims: fp.dims || DEFAULT_ENGINE_VERSION,
        };
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
    insertSessionEvent,
    isValidNamespace,
    listSessionEvents,
    readNamespaceFingerprint,
    tableExists,
};
