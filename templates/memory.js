const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const axios = require('axios');

const DB_PATH = path.join(__dirname, '..', 'memory.db');
const LOG_PATH = path.join(__dirname, '..', 'memory.log');
const LM_STUDIO_URL = 'http://localhost:12342/v1/embeddings';
const LM_STUDIO_RERANK_URL = 'http://localhost:12342/v1/rerank';
const MODEL_NAME = 'jina-embeddings-v2-base-zh';
const RERANKER_MODEL = 'text-embedding-bge-reranker-base';

function initDb() {
    const db = new Database(DB_PATH);
    sqliteVec.load(db);

    // Virtual tables must be created carefully
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories USING vec0(
            vector float[768]
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // Verify embedding model fingerprint
    const modelRow = db.prepare('SELECT value FROM _meta WHERE key = ?').get('embedding_model');
    const rerankRow = db.prepare('SELECT value FROM _meta WHERE key = ?').get('reranker_model');

    if (!modelRow) {
        db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('embedding_model', MODEL_NAME);
    } else if (modelRow.value !== MODEL_NAME) {
        console.error(`\n❌ 致命错误: 向量库模型指纹不匹配！`);
        console.error(`⚠️ 当前脚手架配置模型: ${MODEL_NAME}`);
        console.error(`⚠️ 数据库内已绑定模型: ${modelRow.value}`);
        console.error(`👉 由于更换了模型，向量维度或语义空间已无法对齐。`);
        console.error(`✅ 解决办法 1 (推荐): 请在 LM Studio 中重新加载之前绑定的模型 (${modelRow.value})，并修改此处的 MODEL_NAME 配置。`);
        console.error(`✅ 解决办法 2 (危险): 如果你确定要开新坑并抛弃过去的记忆，请手动删除 .evo-lite/memory.db 文件后重试。\n`);
        process.exit(1);
    }

    if (!rerankRow) {
        db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('reranker_model', RERANKER_MODEL);
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_contents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            source TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    return db;
}

function appendLog(action, content) {
    const logEntry = `[${new Date().toISOString()}] ${action}: ${content}\n`;
    fs.appendFileSync(LOG_PATH, logEntry, 'utf8');
}

async function getEmbedding(text) {
    try {
        const response = await axios.post(LM_STUDIO_URL, {
            model: MODEL_NAME,
            input: text
        }, { proxy: false });

        return response.data.data[0].embedding;
    } catch (error) {
        console.error('❌ Embedding API Error:', error.message);
        process.exit(1);
    }
}

async function getRerankedScores(query, texts) {
    try {
        const response = await axios.post(LM_STUDIO_RERANK_URL, {
            model: RERANKER_MODEL,
            query: query,
            documents: texts,
            top_n: texts.length
        }, { proxy: false });

        // Return sorted results based on relevance score
        return response.data.results;
    } catch (error) {
        console.error('⚠️ Rerank API Error or Not Available:', error.message);
        console.log('Falling back to vector distance only...');
        return null; // Fallback to raw distances
    }
}

async function remember(content, source = 'cli') {
    console.log(`🧠 Embedding thought...`);
    const vector = await getEmbedding(content);

    const db = initDb();

    const insertContent = db.prepare('INSERT INTO memory_contents (content, source) VALUES (?, ?)');
    const insertVector = db.prepare('INSERT INTO memories (rowid, vector) VALUES (?, ?)');

    const transaction = db.transaction(() => {
        const info = insertContent.run(content, source);
        const lastId = BigInt(info.lastInsertRowid);
        const vecBuffer = new Float32Array(vector);
        insertVector.run(lastId, vecBuffer);
        return lastId;
    });

    const id = transaction();
    console.log(`✅ Remembered! (ID: ${id})`);
    appendLog('REMEMBER', `ID ${id} - ${content.substring(0, 50)}...`);
    db.close();
}

async function recall(query, topK = 3) {
    console.log(`🔍 Searching memory for: "${query}"...`);
    const queryVector = await getEmbedding(query);
    const db = initDb();

    const vecBuffer = new Float32Array(queryVector);

    const stmt = db.prepare(`
        SELECT 
            m.rowid as id, 
            mc.content, 
            distance
        FROM memories m
        JOIN memory_contents mc ON m.rowid = mc.id
        WHERE vector MATCH ? AND k = ?
        ORDER BY distance
    `);

    // Fetch a broader set (e.g., top 10) for reranking
    const results = stmt.all(vecBuffer, Math.max(topK * 3, 10));

    console.log('\\n================ FOUND MEMORIES ================');
    if (results.length === 0) {
        console.log('No relevant memories found.');
        console.log('================================================\\n');
        return;
    }

    const documents = results.map(r => r.content);
    console.log(`⏳ Reranking ${documents.length} candidates using ${RERANKER_MODEL}...`);

    const reranked = await getRerankedScores(query, documents);

    if (reranked) {
        // Reranking successful, display topK according to reranker
        const finalResults = reranked.slice(0, topK);
        finalResults.forEach((r, i) => {
            const originalDoc = documents[r.index];
            console.log(`[${i + 1}] (Relevance Score: ${r.relevance_score.toFixed(4)})\\n${originalDoc}\\n`);
        });
    } else {
        // Fallback: display topK from original vector search
        const finalResults = results.slice(0, topK);
        finalResults.forEach((r, i) => {
            console.log(`[${i + 1}] (Vec Distance: ${r.distance.toFixed(4)})\\n${r.content}\\n`);
        });
    }

    console.log('================================================\\n');
    appendLog('RECALL', `Queried "${query}", found and reranked results.`);
    db.close();
}

const action = process.argv[2];
const text = process.argv[3];
if (action === 'remember') {
    if (!text) return console.log('Usage: node memory.js remember <"text message">');
    remember(text);
} else if (action === 'recall') {
    if (!text) return console.log('Usage: node memory.js recall <"text message">');
    recall(text);
} else if (action === 'verify') {
    // Just trigger initDb to check meta fingerprint
    if (fs.existsSync(DB_PATH)) {
        const db = initDb();
        console.log(`✅ Evo-Lite 记忆库自检通过！`);
        console.log(`📡 [粗排/向量]: ${MODEL_NAME}`);
        console.log(`📡 [精排/语义]: ${RERANKER_MODEL}`);
        db.close();
    } else {
        console.log(`✅ Evo-Lite 尚未生成实体库。`);
        console.log(`📡 [待定/向量]: ${MODEL_NAME}`);
        console.log(`📡 [待定/语义]: ${RERANKER_MODEL}`);
    }
} else {
    console.log('Unknown action. Use "remember", "recall" or "verify".');
}
