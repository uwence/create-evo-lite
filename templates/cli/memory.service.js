const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { getExtractor, getReranker, getActiveModelInfo } = require('./models');

const LOG_PATH = path.join(__dirname, '..', 'memory.log');
const ACTIVE_CONTEXT_PATH = path.join(__dirname, '..', 'active_context.md');

function chunkText(text, chunkSize = 512) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
}

async function memorize(text) {
    const db = getDb();
    const extractor = await getExtractor();
    const { model, dims } = getActiveModelInfo();

    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            embedding float[${dims}]
        );
    `);

    const rawMemoryId = db.prepare('INSERT INTO raw_memory (content) VALUES (?)').run(text).lastInsertRowid;
    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await extractor(chunk, { pooling: 'mean', normalize: true });
        const vectorId = db.prepare('INSERT INTO vectors (embedding) VALUES (json(?))').run(JSON.stringify(Array.from(embedding.data))).lastInsertRowid;
        db.prepare('INSERT INTO chunks (raw_memory_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?)').run(rawMemoryId, i, chunk, vectorId);
    }
    console.log(`Memorized ${chunks.length} chunks.`);
}

async function recall(query, top_k = 10) {
    const db = getDb();
    const extractor = await getExtractor();
    const reranker = await getReranker();

    const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });
    const queryVector = JSON.stringify(Array.from(queryEmbedding.data));

    const results = db.prepare(`
        SELECT chunks.content, vectors.distance
        FROM vectors
        JOIN chunks ON chunks.vector_id = vectors.rowid
        WHERE vectors.distance < 0.8
        ORDER BY vectors.distance
        LIMIT ?
    `).all(queryVector, top_k);

    if (reranker && results.length > 0) {
        const scores = await reranker(results.map(r => [query, r.content]));
        const sortedResults = results.map((r, i) => ({ ...r, score: scores[i].score })).sort((a, b) => b.score - a.score);
        return sortedResults;
    }

    return results;
}

function forget(id) {
    const db = getDb();
    const chunks = db.prepare('SELECT vector_id FROM chunks WHERE raw_memory_id = ?').all(id);
    chunks.forEach(chunk => {
        db.prepare('DELETE FROM vectors WHERE rowid = ?').run(chunk.vector_id);
    });
    db.prepare('DELETE FROM chunks WHERE raw_memory_id = ?').run(id);
    db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);
    console.log(`Forgot memory with id ${id}.`);
}

function list() {
    const db = getDb();
    return db.prepare('SELECT id, content, timestamp FROM raw_memory').all();
}

function wash() {
    // This is a placeholder for a more complex memory washing strategy
    console.log('Washing memory... (not implemented)');
}

function track(mechanism, details) {
    if (!fs.existsSync(ACTIVE_CONTEXT_PATH)) return;

    let content = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf-8');
    const trajectoryMarker = '<!-- BEGIN_TRAJECTORY -->';
    const endTrajectoryMarker = '<!-- END_TRAJECTORY -->';
    const trajectoryStart = content.indexOf(trajectoryMarker);
    const trajectoryEnd = content.indexOf(endTrajectoryMarker);

    if (trajectoryStart !== -1 && trajectoryEnd !== -1) {
        const newEntry = `- [${mechanism}] ${new Date().toISOString().split('T')[0]} ${details.substring(0, 100)}`;
        const trajectorySection = content.substring(trajectoryStart + trajectoryMarker.length, trajectoryEnd);
        const entries = trajectorySection.split('\\n').filter(line => line.trim().startsWith('-'));

        while (entries.length >= 10) {
            entries.pop();
        }

        entries.unshift(newEntry);
        const newTrajectorySection = '\\n' + entries.join('\\n') + '\\n';
        content = content.substring(0, trajectoryStart + trajectoryMarker.length) + newTrajectorySection + content.substring(trajectoryEnd);
        fs.writeFileSync(ACTIVE_CONTEXT_PATH, content, 'utf-8');
    }
}

function verify() {
    console.log('Verifying system...');
    // This is a placeholder for a more complex verification process
    console.log('System OK.');
}

function inject(text) {
    if (!fs.existsSync(ACTIVE_CONTEXT_PATH)) return;
    // This function needs a more robust implementation to inject text into specific sections
    console.log(`Injecting text... (not implemented)`);
}

module.exports = {
    memorize,
    recall,
    forget,
    list,
    wash,
    track,
    verify,
    inject,
};
