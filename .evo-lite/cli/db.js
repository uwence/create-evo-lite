const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { getDbPath } = require('./runtime');

let db;

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

function initDB(activeModel, activeDims) {
    const database = getDb();

    database.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    const modelRow = database.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get();
    const dimsRow = database.prepare("SELECT value FROM _meta WHERE key = 'embedding_dims'").get();

    let vectorsReset = false;
    if (
        !modelRow ||
        !dimsRow ||
        modelRow.value !== activeModel ||
        parseInt(dimsRow.value, 10) !== activeDims
    ) {
        if (modelRow && dimsRow) {
            console.warn(`⚠️ Model fingerprint mismatch! Expected ${activeModel} (${activeDims}d), but found ${modelRow.value} (${dimsRow.value}d). Re-initializing vector tables while preserving raw memories...`);
        }
        database.exec('DROP TABLE IF EXISTS vectors;');
        database.exec('DROP TABLE IF EXISTS chunks;');
        vectorsReset = true;
    }

    database.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('embedding_model', ?)").run(activeModel);
    database.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('embedding_dims', ?)").run(activeDims.toString());

    database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            embedding float[${activeDims}]
        );
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_memory_id INTEGER,
            chunk_index INTEGER,
            content TEXT,
            vector_id INTEGER
        );
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS raw_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    return { vectorsReset };
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

module.exports = { closeDb, getDb, initDB };
