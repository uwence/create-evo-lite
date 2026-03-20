const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { getDbPath } = require('./runtime');

let db;

function getDb() {
    if (!db) {
        db = new Database(getDbPath());
        sqliteVec.load(db);
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = NORMAL');
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

module.exports = { getDb, initDB };
