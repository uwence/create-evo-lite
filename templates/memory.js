const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const axios = require('axios');

const DB_PATH = path.join(__dirname, '..', 'memory.db');
const LOG_PATH = path.join(__dirname, '..', 'memory.log');
const LM_STUDIO_URL = 'http://localhost:12342/v1/embeddings';
const LM_STUDIO_RERANK_URL = 'http://localhost:12342/v1/rerank';
const LM_STUDIO_CHAT_URL = 'http://localhost:12342/v1/chat/completions';
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
    try { fs.appendFileSync(LOG_PATH, logEntry, 'utf8'); } catch (e) { }
}

async function fetchWithRetry(requestFn, maxRetries, delayMs) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await requestFn();
        } catch (error) {
            retries++;
            if (retries >= maxRetries) throw error;
            console.log(`   ⏳ 等待模型加载或服务预热中，稍后重试 (${retries}/${maxRetries})...`);
            await new Promise(res => setTimeout(res, delayMs));
        }
    }
}

async function getEmbedding(text) {
    try {
        const response = await fetchWithRetry(() => axios.post(LM_STUDIO_URL, {
            model: MODEL_NAME,
            input: text
        }, { proxy: false }), 3, 2000);

        return response.data.data[0].embedding;
    } catch (error) {
        return null;
    }
}

async function getRerankedScores(query, texts) {
    try {
        const response = await fetchWithRetry(() => axios.post(LM_STUDIO_RERANK_URL, {
            model: RERANKER_MODEL,
            query: query,
            documents: texts,
            top_n: texts.length
        }, { proxy: false }), 3, 2000);

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

    if (!vector) {
        console.warn(`\\n⚠️ 无法提取向量特征 (LM Studio 连接失败或未开启)。`);
        console.log('🛡️ [脱机降级模式激活]: 正在将记忆降级暂存为 Daily Note (离线包)...');
        const offlinePath = path.join(__dirname, '..', 'offline_memories.json');
        let offlineData = [];
        if (fs.existsSync(offlinePath)) {
            try { offlineData = JSON.parse(fs.readFileSync(offlinePath, 'utf8')); } catch (e) { }
        }
        offlineData.push({ content, source: source + '_offline', created_at: new Date().toISOString() });
        fs.writeFileSync(offlinePath, JSON.stringify(offlineData, null, 2), 'utf8');
        console.log(`✅ 暂存离线日记成功！(当前积压: ${offlineData.length} 条)`);
        console.log(`💡 网络恢复后，使用 \`node .evo-lite/cli/memory.js import .evo-lite/offline_memories.json\` 即可将它们补齐为向量。\\n`);
        appendLog('REMEMBER_OFFLINE', `Saved offline - ${content.substring(0, 50)}...`);
        return;
    }

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

    if (!queryVector) {
        console.warn(`\\n⚠️ 提示：无法连接 Embedding 模型。向量检索瘫痪。`);
        console.log('🛡️ [纯文本降级模式激活]: 正在使用原生 SQLite LIKE 进行基础模糊词匹配...');

        const stmt = db.prepare(`SELECT id, content FROM memory_contents WHERE content LIKE ? LIMIT ?`);
        const results = stmt.all(`%${query}%`, topK);

        console.log('\\n================ FOUND MEMORIES (TEXT FALLBACK) ================');
        if (results.length === 0) {
            console.log('没有查找到包含此关键词的纯文本记忆。');
        } else {
            results.forEach((r, i) => {
                console.log(`[${i + 1}] (Match Type: Text LIKE)\\n${r.content}\\n`);
            });
        }
        console.log('================================================================\\n');

        const offlinePath = path.join(__dirname, '..', 'offline_memories.json');
        if (fs.existsSync(offlinePath)) {
            console.log(`💡 提示: 您的沙盒中还有未导入的离线记忆碎片 (offline_memories.json)，它们没被搜到！\\n`);
        }

        appendLog('RECALL_FALLBACK', `Text queried "${query}"`);
        db.close();
        return;
    }

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

function forget(id) {
    if (!id || isNaN(id)) {
        return console.error('❌ Usage: node memory.js forget <id>');
    }
    const db = initDb();
    const info = db.prepare('DELETE FROM memory_contents WHERE id = ?').run(id);
    db.prepare('DELETE FROM memories WHERE rowid = ?').run(id);

    if (info.changes > 0) {
        console.log(`✅ 成功忘却记忆碎片 (ID: ${id})`);
        appendLog('FORGET', `Deleted ID ${id}`);
    } else {
        console.log(`⚠️ 未找到 ID 为 ${id} 的记忆碎片，或者已经被遗忘。`);
    }
    db.close();
}

function stats() {
    const db = initDb();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM memory_contents').get();
    const dateRow = db.prepare('SELECT MIN(created_at) as first, MAX(created_at) as last FROM memory_contents').get();

    console.log('\\n📊 Evo-Lite 记忆库健康面板 📊');
    console.log('-----------------------------------');
    console.log(`总记忆条数   : ${countRow.count} 条`);
    if (countRow.count > 0) {
        console.log(`最早记忆时间 : ${dateRow.first}`);
        console.log(`最近记忆时间 : ${dateRow.last}`);
    }
    try {
        const stats = fs.statSync(DB_PATH);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`数据库体积   : ${sizeMb} MB`);
    } catch (e) {
        console.log('数据库体积   : 未知');
    }
    console.log('-----------------------------------\\n');
    db.close();
}

function exportMemories(filePath) {
    if (!filePath) {
        return console.error('❌ Usage: node memory.js export <filename.json>');
    }
    const db = initDb();
    const records = db.prepare('SELECT id, content, created_at, source FROM memory_contents ORDER BY id ASC').all();
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
    console.log(`✅ ${records.length} 条记忆已导出至: ${filePath}`);
    appendLog('EXPORT', `Exported ${records.length} records to ${filePath}`);
    db.close();
}

async function importMemories(filePath) {
    if (!filePath) {
        return console.error('❌ Usage: node memory.js import <filename.json>');
    }
    if (!fs.existsSync(filePath)) {
        return console.error(`❌ 文件不存在: ${filePath}`);
    }
    console.log(`📦 正在读取 JSON 文件...`);
    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(records)) {
        return console.error('❌ JSON 格式错误，预期为数组。');
    }
    console.log(`🚀 准备导入 ${records.length} 条记忆 (这可能需要一些时间，正在重新计算向量...)`);
    let successCount = 0;
    for (const record of records) {
        if (record.content) {
            await remember(record.content, record.source || 'import');
            successCount++;
        }
    }
    console.log(`✅ 导入完毕！成功注入 ${successCount} 条记忆。`);

    // 如果是我们的脱机日记本，且有真实数据导入成功，则自动“阅后即焚”
    if (successCount > 0 && filePath.includes('offline_memories.json')) {
        try {
            fs.unlinkSync(filePath);
            console.log(`🗑️ 已自动清理已消耗的脱机包: ${path.basename(filePath)}`);
        } catch (e) { /* ignore cleanup errors */ }
    }
}

async function compact() {
    console.log('\\n💤 记忆库进入深度睡眠 (Compacting...) 💤');
    console.log('1. 正在抽取当前所有记忆碎片...');

    const db = initDb();
    const records = db.prepare('SELECT content FROM memory_contents ORDER BY id ASC').all();
    db.close();

    if (records.length === 0) {
        return console.log('⚠️ 当前记忆库为空，不需要整理。');
    }

    const allContexts = records.map((r, i) => `[ID:${i}] ${r.content}`).join('\\n');

    console.log('2. 正在呼叫大语言模型进行去重、合并与摘要 (等待 LM Studio 响应...)');

    // 动态嗅探当前可用的对话模型 (避免把 embed/rerank 误用来跑 chat)
    let chatModel = "local-model";
    try {
        const modelsRes = await fetchWithRetry(() => axios.get(LM_STUDIO_URL.replace('/embeddings', '/models'), { proxy: false }), 3, 2000);
        // 排除掉所有含 embed / rerank 字眼的模型
        const candidates = modelsRes.data.data.filter(m => !m.id.toLowerCase().includes('embed') && !m.id.toLowerCase().includes('rerank'));
        if (candidates.length > 0) {
            chatModel = candidates[0].id;
            console.log(`🤖 探测到当前对话大模型: ${chatModel}`);
        }
    } catch (e) {
        console.warn('⚠️ 无法动态探测对话模型，将尝试使用本地通用默认标识。');
    }

    const prompt = `你是一个高级的知识图谱整理员。下面是我们项目中随时记录的零散“记忆碎片”。\n\n请你把它们去重、分类、合并，总结成提纲挈领的“几条核心架构知识与踩坑教训”。\n\n规则：\n1. 每条经验必须独立成行，且不要太长。\n2. 直接输出这几条精简后的话，不要输出“好的”、“没问题”等其他废话文本。\n3. 保留技术名词和关键代码细节。\n\n记忆碎片列表：\n${allContexts}`;

    try {
        const response = await fetchWithRetry(() => axios.post(LM_STUDIO_CHAT_URL, {
            model: chatModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1, // 越低越稳定
            stream: false
        }, { proxy: false }), 3, 5000);

        const compactedText = response.data.choices[0].message.content.trim();
        const newThoughts = compactedText.split('\\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('好的') && l !== '```' && l !== '```markdown' && l !== '```json');

        console.log(`🧠 AI 整理完毕，提炼成 ${newThoughts.length} 条精华记忆。\\n`);

        console.log('3. 正在抹除旧记忆库 (危险操作)...');
        // Rename old file as backup
        const backupPath = DB_PATH + '.backup.' + Date.now();
        fs.renameSync(DB_PATH, backupPath);
        console.log(`   (旧文件已备份为: ${backupPath})`);

        console.log('4. 正在注入高价值凝练记忆...');
        for (const thought of newThoughts) {
            console.log(`✍️ 写入: ${thought}`);
            await remember(thought, 'compact');
        }

        console.log('✅ 记忆深度睡眠 (Compact) 完成！系统已焕发新生。\\n');
        appendLog('COMPACT', `Compacted ${records.length} records into ${newThoughts.length} core memories.`);
    } catch (e) {
        console.warn(`\\n⚠️ 本地对话大模型未响应 (${e.message})。`);
        console.log('🤖 [降级模式激活]: 正在呼叫当前 IDE 宿主智能体 (如 Antigravity / Cursor) 介入处理...');
        console.log('--------------------------------------------------');
        console.log('🚨 宿主 AI 助手请注意：');
        console.log('请你立刻阅读下方打印的【原始碎片】，在脑内为其进行去重与架构总结。');
        console.log('然后，使用 `node .evo-lite/cli/memory.js remember "你的精华总结"` 命令将结果写回系统。');
        console.log('最后，向用户报告总结完毕，并建议用户使用 `node .evo-lite/cli/memory.js forget <id>` 清除旧废料。');
        console.log('\\n【待精炼的原始记忆碎片】:');
        console.log(allContexts);
        console.log('--------------------------------------------------\\n');
    }
}

const action = process.argv[2];
const text = process.argv[3];
if (action === 'remember') {
    if (!text) return console.log('Usage: node memory.js remember <"text message">');
    remember(text);
} else if (action === 'recall') {
    if (!text) return console.log('Usage: node memory.js recall <"text message">');
    recall(text);
} else if (action === 'forget') {
    forget(text);
} else if (action === 'stats') {
    stats();
} else if (action === 'export') {
    exportMemories(text);
} else if (action === 'import') {
    importMemories(text);
} else if (action === 'compact') {
    compact();
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
    console.log('Unknown action. Use "remember", "recall", "forget", "stats", "export", "import", "compact", or "verify".');
}
