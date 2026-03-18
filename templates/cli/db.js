const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const DB_PATH = path.join(__dirname, '..', 'memory.db');
let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        sqliteVec.load(db);
    }
    return db;
}

function initDB() {
    const db = getDb();

    // Create _meta table for storing metadata
    db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // Create vectors table for storing embeddings
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            embedding_model TEXT,
            embedding_dims INTEGER,
            embedding(embedding_dims)
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

    console.log('Database initialized successfully.');
}

module.exports = { getDb, initDB };
