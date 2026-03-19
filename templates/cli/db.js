const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const DB_PATH = path.join(__dirname, '..', 'memory.db');
let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        // Load sqlite-vss/vec extension
        sqliteVec.load(db);

        // Critical SQLite Pragmas for concurrency and performance
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = NORMAL');
    }
    return db;
}

function initDB(activeModel, activeDims) {
    const db = getDb();

    // Create _meta table for storing metadata
    db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // Fingerprint verification
    let resetRequired = false;
    const modelRow = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get();
    const dimsRow = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_dims'").get();

    if (modelRow && dimsRow) {
        if (modelRow.value !== activeModel || parseInt(dimsRow.value) !== activeDims) {
            console.warn(`⚠️ Model fingerprint mismatch! Expected ${activeModel} (${activeDims}d), but found ${modelRow.value} (${dimsRow.value}d). Re-initializing vector tables...`);
            resetRequired = true;
        }
    } else {
        // First run or missing metadata
        resetRequired = true;
    }

    if (resetRequired) {
        // Drop existing tables to avoid schema dimension conflicts
        db.exec(`DROP TABLE IF EXISTS vectors;`);
        db.exec(`DROP TABLE IF EXISTS chunks;`);
        db.exec(`DROP TABLE IF EXISTS raw_memory;`);

        // Update metadata
        db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('embedding_model', ?)").run(activeModel);
        db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('embedding_dims', ?)").run(activeDims.toString());
    }

    // Create vectors table for storing embeddings using sqlite-vec syntax
    // Only create it if it doesn't exist, which handles both fresh starts and dimension changes
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            embedding float[${activeDims}]
        );
    `);

    // Create chunks table for storing text chunks
    db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_memory_id INTEGER,
            chunk_index INTEGER,
            content TEXT,
            vector_id INTEGER
        );
    `);

    // Create raw_memory table for storing raw text
    db.exec(`
        CREATE TABLE IF NOT EXISTS raw_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

module.exports = { getDb, initDB };
