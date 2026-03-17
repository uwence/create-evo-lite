const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

// Transformers.js configuration
const { pipeline, env } = require('@xenova/transformers');

// Configure environment to resolve network fetch failures
env.allowLocalModels = true;
env.cacheDir = path.join(__dirname, '..', '.cache');

// 🔥 IMPORTANT: Force HuggingFace to use a mirror if the user is in a restricted network
// This prevents 'fetch failed' errors when downloading the ONNX weights.
env.remoteHost = 'https://hf-mirror.com';
env.remotePathTemplate = '{model}/resolve/{revision}/';

const DB_PATH = path.join(__dirname, '..', 'memory.db');
const LOG_PATH = path.join(__dirname, '..', 'memory.log');

let ACTIVE_MODEL = 'Xenova/jina-embeddings-v2-base-zh';
let ACTIVE_DIMS = 768;
const FALLBACK_MODEL = 'Xenova/bge-small-zh-v1.5';
const FALLBACK_DIMS = 512;

const RERANKER_MODEL = 'Xenova/bge-reranker-base';

// Singleton pipeline instances to avoid reloading models into memory
let extractorPipeline = null;
let classifierPipeline = null;

async function initEmbeddingModel() {
    // 1. Detect Bound Fingerprint first
    if (fs.existsSync(DB_PATH)) {
        try {
            const tempDb = new Database(DB_PATH, { fileMustExist: true });
            const row = tempDb.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get();
            if (row && row.value) {
                ACTIVE_MODEL = row.value;
                ACTIVE_DIMS = (ACTIVE_MODEL === FALLBACK_MODEL) ? FALLBACK_DIMS : 768;
            }
            tempDb.close();
        } catch(e) { /* ignore */ }
    }

    try {
        if (!extractorPipeline) {
            extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL, { quantized: true });
        }
    } catch (e) {
        if (ACTIVE_MODEL !== FALLBACK_MODEL) {
            console.warn(`\\n⚠️ \x1b[33m网络加载模型 ${ACTIVE_MODEL} 失败: ${e.message}\\n🔄 正在降级至本地小模型 ${FALLBACK_MODEL} (1/2)...\x1b[0m`);
            ACTIVE_MODEL = FALLBACK_MODEL;
            ACTIVE_DIMS = FALLBACK_DIMS;
            extractTarFallback();
            try {
                extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL, { quantized: true });
                console.log(`✅ \x1b[32m成功降级！已加载提取了本地压缩包的小型权重。\x1b[0m`);
            } catch (err) {
                console.warn(`\x1b[31m❌ 本地降级模型加载也失败了: ${err.message}\x1b[0m`);
            }
        } else {
            console.warn(`\\n⚠️ \x1b[33m本地小模型 ${ACTIVE_MODEL} 加载失败: ${e.message} (尝试解压备用包)\x1b[0m`);
            extractTarFallback();
            try {
                extractorPipeline = await pipeline('feature-extraction', ACTIVE_MODEL, { quantized: true });
            } catch(err) {}
        }
    }
}

function extractTarFallback() {
    const cacheDir = path.join(__dirname, '..', '.cache');
    const bgePath = path.join(cacheDir, 'Xenova', 'bge-small-zh-v1.5');
    if (fs.existsSync(bgePath)) return; // Already extracted

    const tarPath = path.join(__dirname, '..', 'templates', 'embedding-model.tar.gz');
    if (fs.existsSync(tarPath)) {
        console.log(`📦 \x1b[36m正在从 templates 解压内置的 embedding-model.tar.gz...\x1b[0m`);
        try {
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
            require('child_process').execSync(`tar -xzf "${tarPath}" -C "${cacheDir}"`);
        } catch (e) {
            console.log(`⚠️ 解压失败: ${e.message}`);
        }
    }
}

function initDb(ignoreFingerprint = false) {
    const db = new Database(DB_PATH);

    // Setup pragma for concurrent access and timeout
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    sqliteVec.load(db);

    // Virtual tables must be created carefully
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories USING vec0(
            vector float[${ACTIVE_DIMS}]
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
        db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('embedding_model', ACTIVE_MODEL);
    } else if (modelRow.value !== ACTIVE_MODEL && !ignoreFingerprint) {
        console.error(`\n❌ 致命错误: 向量库模型指纹不匹配！`);
        console.error(`⚠️ 当前脚手架配置模型: ${ACTIVE_MODEL}`);
        console.error(`⚠️ 数据库内已绑定模型: ${modelRow.value}`);
        console.error(`👉 由于更换了模型，向量维度或语义空间已无法对齐。`);
        console.error(`✅ 解决办法 1 (推荐): 请在 index.js 初始化向导中输入之前绑定的模型 (${modelRow.value})，或者修改 cli/memory.js 的 ACTIVE_MODEL 配置。`);
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

async function getEmbedding(text) {
    try {
        if (!extractorPipeline) {
            // initEmbeddingModel has failed to load anything
            return null;
        }
        
        // Output pooling 'mean' is common for sequence embeddings, and normalize for cosine similarity
        const output = await extractorPipeline(text, { pooling: 'mean', normalize: true });
        
        // Extract the raw float array from the Tensor
        return Array.from(output.data);
    } catch (error) {
        console.warn(`\x1b[33m⚠️ 本地 Embedding 推理失败: ${error.message}\x1b[0m`);
        return null;
    }
}

async function getRerankedScores(query, texts) {
    if (!texts || texts.length === 0) return [];
    
    try {
        if (!classifierPipeline) {
            // Lazy load the cross-encoder pipeline
            classifierPipeline = await pipeline('text-classification', RERANKER_MODEL, {
                quantized: true,
            });
        }

        // Transformers.js text-classification pipeline supports Cross-Encoder format 
        // We will process them one by one to ensure compatibility with all model architectures
        const results = [];
        for (let i = 0; i < texts.length; i++) {
            // Note: Some models expect a string, some expect (string, string).
            // Usually, for cross-encoders in transformers.js, we pass the query and document as separate arguments.
            // Wait for the result: [ { label: 'LABEL_0', score: 0.99 } ]
            const res = await classifierPipeline(query, texts[i]);
            
            // Depending on the model, it might return an array of objects or a single object.
            // e.g., [{ label: 'LABEL_1', score: 0.8 }] or just { label: ... }
            const scoreObj = Array.isArray(res) ? res[0] : res;
            const score = scoreObj && scoreObj.score !== undefined ? scoreObj.score : 0;
            
            results.push({
                index: i,
                relevance_score: score
            });
        }
        
        return results.sort((a, b) => b.relevance_score - a.relevance_score);

    } catch (error) {
        console.error('⚠️ 本地 Rerank 计算失败:', error.message);
        console.log('Falling back to vector distance only...');
        return null; // Fallback to raw distances
    }
}

async function remember(content, source = 'cli') {
    const isImport = source === 'import';

    // 以下守卫仅对常规写入生效，import 迁移时全部跳过
    if (!isImport) {
        // 3. 拦截毫无意义的流水账 (Quality Lock)
        if (content.length < 40) {
            console.error(`\n❌ [致命约束被触发] 记忆质量校验失败！`);
            console.error(`记忆体字符数 (${content.length}) 过短。必须提供前因后果、架构原因或具体的绕过解法。`);
            console.error(`请拒绝流水账式的日志记录。`);
            process.exit(1);
        }

        // [程序化守卫] 记忆蒸馏规范校验
        // 1. 拦截使用区间省略号的偷懒行为
        if (/\[Commit:.*?\.\.\..*?\]/.test(content)) {
            console.error(`\n❌ [致命约束被触发] 记忆规范校验失败！`);
            console.error(`严禁在记忆体中使用区间省略号 (如 aaa...bbb) 引用 Commit。`);
            console.error(`请精确提取并分别列出本条记忆直接关联的所有独立 Commit Hash。`);
            process.exit(1);
        }

        // 2. 拦截长篇提炼但不带精确溯源点的行为
        if (/\d+\.\s+\*\*/.test(content) && !/\(溯源历史点: \[Commit:.*?\]\)/.test(content)) {
            console.error(`\n❌ [致命约束被触发] 记忆规范校验失败！`);
            console.error(`发现结构化的提炼文本，但缺失精确的 \`(溯源历史点: [Commit: xxx])\` 声明。`);
            console.error(`请严格遵守排版规范，为每一个条目附带溯源依据！`);
            process.exit(1);
        }
    }



    console.log(`🧠 Embedding thought...`);
    const vector = await getEmbedding(content);

    if (!vector) {
        console.warn(`\\n⚠️ 无法提取向量特征 (ONNX 引擎加载失败)。`);
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

    // v1.3.0 Traceability: Inject Space-Time Anchors
    let commitHash = 'No-Git';
    try {
        commitHash = require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
        // Silently ignore if not a git repo or no commits yet
    }
    const timestamp = new Date().toISOString();
    content = `[Time: ${timestamp}] [Commit: ${commitHash}]\\n${content}`;

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
    console.log(`💡 [交接规约监控]: 记忆已打入隐性碎片池！请确保你同时修改了 \`.evo-lite/active_context.md\` 推进任务状态，并执行了 \`git commit\`！`);
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
    const db = initDb(true); // Bypass fingerprint mismatch for export since we only extract text
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
            await remember(record.content, 'import'); // Always use 'import' source to bypass capacity lock
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

// --- v1.5.2 Section: raw_memory 三层流水线 (1:N 语义切块) ---

function readSection(md, anchor) {
    const regex = new RegExp(`<!-- BEGIN_${anchor} -->([\\s\\S]*?)<!-- END_${anchor} -->`);
    const match = md.match(regex);
    return match ? match[1] : null;
}

function writeSection(md, anchor, newContent) {
    const regex = new RegExp(`(<!-- BEGIN_${anchor} -->)[\\s\\S]*?(<!-- END_${anchor} -->)`);
    return md.replace(regex, `$1\n${newContent}\n$2`);
}

async function contextCommand(op, arg, details) {
    const contextPath = path.join(__dirname, '..', 'active_context.md');
    if (!fs.existsSync(contextPath)) {
        return console.error(`❌ 未找到 active_context.md`);
    }
    let md = fs.readFileSync(contextPath, 'utf8');

    if (op === 'focus') {
        if (!arg) return console.error(`❌ Usage: node .evo-lite/cli/memory.js context focus "新焦点内容"`);
        md = writeSection(md, 'FOCUS', arg);
        console.log(`✅ FOCUS 已更新为: ${arg}`);
    } else if (op === 'add') {
        if (!arg) return console.error(`❌ Usage: node .evo-lite/cli/memory.js context add "新任务描述"`);
        let backlog = readSection(md, 'BACKLOG');
        if (!backlog) backlog = '';
        
        const tasks = backlog.split('\n').filter(line => line.trim().startsWith('- [ ]'));
        if (tasks.length >= 5) {
            console.error(`❌ [拒绝操作] BACKLOG 任务数已达硬上限 (5条)。请先 complete 任务或移入搁置区。`);
            process.exit(1);
        }
        
        backlog = backlog.trim();
        if (backlog === '') {
            backlog = `- [ ] ${arg}`;
        } else {
            backlog += `\n- [ ] ${arg}`;
        }
        md = writeSection(md, 'BACKLOG', backlog);
        console.log(`✅ 新任务已加入 BACKLOG: ${arg}`);
    } else if (op === 'complete') {
        if (!arg) return console.error(`❌ Usage: node .evo-lite/cli/memory.js context complete "提取词" [--details="详细说明..."]`);
        
        let backlog = readSection(md, 'BACKLOG');
        let matchedTask = arg;
        if (backlog) {
            let lines = backlog.split('\n');
            let foundIndex = lines.findIndex(line => line.trim().startsWith('- [ ]') && line.includes(arg));
            if (foundIndex !== -1) {
                matchedTask = lines[foundIndex].replace('- [ ]', '').trim();
                console.log(`🗑️ 从 BACKLOG 移除: ${lines[foundIndex].trim()}`);
                lines.splice(foundIndex, 1);
                md = writeSection(md, 'BACKLOG', lines.join('\n').trim() === '' ? '' : lines.join('\n'));
            } else {
                console.log(`⚠️ 在 BACKLOG 中未找到包含 "${arg}" 的任务，继续执行归档流程。`);
            }
        }
        
        let trajectory = readSection(md, 'TRAJECTORY');
        if (!trajectory) trajectory = '';
        const today = new Date().toISOString().split('T')[0];
        const newTrajLine = `- [${today}] ${matchedTask}`;
        
        let trajLines = trajectory.split('\n').filter(line => line.trim().startsWith('- ['));
        trajLines.unshift(newTrajLine);
        
        if (trajLines.length > 10) {
            const removed = trajLines.pop();
            console.log(`🗑️ TRAJECTORY 超限，移除最旧条目: ${removed.trim()}`);
        }
        
        md = writeSection(md, 'TRAJECTORY', trajLines.join('\n'));
        console.log(`✅ 任务已移入 TRAJECTORY: ${newTrajLine}`);
        
        console.log(`📦 正在触发溢出归档流程...`);
        const fileArg = process.argv.find(a => a.startsWith('--file='));
        let archiveContent = details ? details : arg;
        if (fileArg) {
            const filePath = fileArg.split('=')[1];
            if (fs.existsSync(filePath)) {
                archiveContent = fs.readFileSync(filePath, 'utf8').trim();
            }
        }
        const typeArg = process.argv.find(a => a.startsWith('--type='));
        const archiveType = typeArg ? typeArg.split('=')[1] : 'task';
        await archive(archiveContent, archiveType);
    } else {
        console.error(`❌ 未知的 context 操作: ${op}`);
        return;
    }
    
    fs.writeFileSync(contextPath, md, 'utf8');
}

function extractChunksFromMd(md, type) {
    const chunks = [];
    const extract = RegExpStr => {
        const match = md.match(new RegExp(RegExpStr));
        return match && match[1] ? match[1].trim() : null;
    };
    
    if (type === 'bug') {
        const symptom = extract('## 现象 \\(Symptom\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        const solution = extract('## 解决方案 \\(Solution\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        if (symptom && symptom !== '未记录') chunks.push(symptom);
        if (solution && solution !== '未记录') chunks.push(solution);
    } else {
        const impl = extract('## 实现细节 \\(Implementation\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        const arch = extract('## 架构决策 \\(Architecture\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        if (impl && impl !== '未记录') chunks.push(impl);
        if (arch && arch !== '未记录') chunks.push(arch);
        
        // Backward compatibility
        const summary = extract('## Summary\\n+([\\s\\S]*?)(?:\\n+##|\\n+---|$)');
        if (summary && summary !== '未记录') chunks.push(summary);
    }
    return chunks.filter(c => c.length > 0);
}

async function archive(content, type = 'task') {
    if (!content) return console.error(`❌ Usage: node .evo-lite/cli/memory.js archive "<text>" [--type=task|bug|note]`);
    
    const rawDir = path.join(__dirname, '..', 'raw_memory');
    if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
    }
    
    const crypto = require('crypto');
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const timeStr = timestamp.split('T')[1].substring(0, 8).replace(/:/g, '-');
    const id = `mem_${dateStr}_${timeStr}_${crypto.randomBytes(4).toString('hex')}`;
    
    let mdBody = '';
    if (type === 'bug') {
        mdBody = `## 现象 (Symptom)\n${content}\n\n## 原因 (Root Cause)\n未记录\n\n## 解决方案 (Solution)\n未记录\n`;
    } else {
        mdBody = `## 实现细节 (Implementation)\n${content}\n\n## 架构决策 (Architecture)\n未记录\n`;
    }
    
    const fileContent = `---
id: "${id}"
timestamp: "${timestamp}"
type: "${type}"
tags: []
---

${mdBody}`;
    const filePath = path.join(rawDir, `${id}.md`);
    fs.writeFileSync(filePath, fileContent, 'utf8');
    console.log(`📄 原始结构化档案已写入: ${filePath}`);
    
    console.log(`🚀 触发 1:N 向量重组归档...`);
    const chunks = extractChunksFromMd(fileContent, type);
    for (const chunk of chunks) {
        await remember(chunk, id);
    }
}

async function vectorize() {
    const rawDir = path.join(__dirname, '..', 'raw_memory');
    if (!fs.existsSync(rawDir)) {
        console.log(`⚠️ 未找到 raw_memory 目录。`);
        return;
    }
    
    const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
        console.log(`⚠️ raw_memory 目录为空。`);
        return;
    }
    
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log(`\n🧠 \x1b[1m交互式模型升维管线 (Interactive Vectorize Pipeline)\x1b[0m 🧠`);
    console.log(`================================================================`);
    console.log(`此操作将会重新计算所有的 ${files.length} 个本地原始记忆条目，并构建新的脑区！`);
    if (fs.existsSync(DB_PATH)) {
        console.log(`⚠️ 检测到现有的记忆库。系统将为您自动备份后抹除其指纹锁！`);
    }
    console.log(`\n请选择接下来要使用的核心注意力模型:`);
    console.log(`  \x1b[36m1.\x1b[0m Xenova/jina-embeddings-v2-base-zh (768维, 需联网拉取或已存在本地缓存, \x1b[32m推荐\x1b[0m)`);
    console.log(`  \x1b[36m2.\x1b[0m Xenova/bge-small-zh-v1.5      (512维, 支持完全断网本地 tar.gz 解压兜底)`);
    console.log(`  \x1b[36m0.\x1b[0m 取消操作并退出\n`);

    readline.question(`👉 请输入数字 [1, 2, 0]: `, async (answer) => {
        readline.close();
        
        let newModel = '';
        let newDims = 0;
        
        if (answer.trim() === '1') {
            newModel = 'Xenova/jina-embeddings-v2-base-zh';
            newDims = 768;
        } else if (answer.trim() === '2') {
            newModel = FALLBACK_MODEL;
            newDims = FALLBACK_DIMS;
        } else {
            console.log('🛑 操作已取消。');
            return;
        }

        console.log(`\n🔥 正在挂载新模型: ${newModel} (${newDims}维)...`);

        // 安全备份防呆机制
        if (fs.existsSync(DB_PATH)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${DB_PATH}.${timestamp}.bak`;
            try {
                fs.copyFileSync(DB_PATH, backupPath);
                console.log(`📦 [安全护航] 旧记忆脑区已备份至: \x1b[32m${path.basename(backupPath)}\x1b[0m`);
                fs.unlinkSync(DB_PATH); // 物理删除以解除 SQLite 对旧模型指纹的锁死
            } catch (e) {
                console.error(`❌ 备份或释放旧数据库失败，出于安全考虑，终止操作: ${e.message}`);
                return;
            }
        }

        // 强行覆盖上下文环境
        ACTIVE_MODEL = newModel;
        ACTIVE_DIMS = newDims;
        
        // 斩断过去的 ONNX Pipeline 引擎
        extractorPipeline = null; 
        
        console.log(`\n📡 正在启动 ONNX Runtime 引擎预热并校验缓存 / 下载...`);
        await initEmbeddingModel();

        if (!extractorPipeline) {
            console.error(`\n❌ 模型引擎挂载失败，请检查网络或配置后重试。备份的数据库仍可用。`);
            return;
        }

        console.log(`\n🔍 开始进行 1:N 语义向量化重铸...`);
        const db = initDb(); // 将以新的模型指纹建立空库
        let successCount = 0;
        
        for (const file of files) {
            const filePath = path.join(rawDir, file);
            const md = fs.readFileSync(filePath, 'utf8');
            
            const idMatch = md.match(/^id:\s*"([^"]+)"/m);
            if (!idMatch) continue;
            const sourceId = idMatch[1];
            
            const typeMatch = md.match(/^type:\s*"([^"]+)"/m);
            const type = typeMatch ? typeMatch[1] : 'task';
            
            const chunks = extractChunksFromMd(md, type);
            if (chunks.length === 0) continue;
            
            process.stdout.write(`📥 向量化 ${sourceId} (${chunks.length} 个语义块)... `);
            for (const chunk of chunks) {
                try {
                    const vector = await getEmbedding(chunk);
                    if (vector) {
                        let timestamp = new Date().toISOString();
                        const tsMatch = md.match(/^timestamp:\s*"([^"]+)"/m);
                        if (tsMatch) timestamp = tsMatch[1];
                        
                        const richContent = `[Time: ${timestamp}] [Archive-Rebuild]\n${chunk}`;

                        const insertContent = db.prepare('INSERT INTO memory_contents (content, source) VALUES (?, ?)');
                        const insertVector = db.prepare('INSERT INTO memories (rowid, vector) VALUES (?, ?)');
                        
                        const transaction = db.transaction(() => {
                            const info = insertContent.run(richContent, sourceId);
                            const lastId = BigInt(info.lastInsertRowid);
                            const vecBuffer = new Float32Array(vector);
                            insertVector.run(lastId, vecBuffer);
                            return lastId;
                        });
                        
                        transaction();
                        successCount++;
                    }
                } catch (e) {
                    console.error(`\n❌ 处理分块失败: ${e.message}`);
                }
            }
            console.log(`\x1b[32mOK\x1b[0m`);
        }
        
        db.close();
        console.log(`\n✅ 重铸完成！共成功重新向量化了 ${successCount} 个语义碎片。`);
    });
}

const action = process.argv[2];
let text = process.argv[3];
const typeArg = process.argv.find(arg => arg.startsWith('--type='));
const archiveType = typeArg ? typeArg.split('=')[1] : 'task';

// Support reading long/complex inputs from file to prevent shell truncation
const fileArg = process.argv.find(arg => arg.startsWith('--file='));
if (fileArg) {
    const filePath = fileArg.split('=')[1];
    if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf8').trim();
    } else {
        console.error(`❌ 指定的文件未找到: ${filePath}`);
        process.exit(1);
    }
}

async function run() {
    await initEmbeddingModel();

    if (action === 'remember') {
        if (!text) return console.log('Usage: node memory.js remember <"text message"> OR node memory.js remember --file=<path>');
        await remember(text);
    } else if (action === 'recall') {
        if (!text) return console.log('Usage: node memory.js recall <"text message"> OR node memory.js recall --file=<path>');
        await recall(text);
    } else if (action === 'forget') {
        forget(text);
    } else if (action === 'stats') {
        stats();
    } else if (action === 'export') {
        exportMemories(text);
    } else if (action === 'import') {
        await importMemories(text);

    } else if (action === 'context') {
        const op = process.argv[3];
        const argParams = process.argv.slice(4).filter(a => !a.startsWith('--'));
        const detailsArg = process.argv.find(arg => arg.startsWith('--details='));
        const details = detailsArg ? detailsArg.substring('--details='.length) : null;
        await contextCommand(op, argParams.length > 0 ? argParams[0] : '', details);
    } else if (action === 'archive') {
        let textArg = text;
        if (textArg && textArg.startsWith('--')) {
            textArg = '';
        }
        if (!textArg) return console.log('Usage: node memory.js archive <"text message"> [--type=task|bug|note]');
        await archive(textArg, archiveType);
    } else if (action === 'vectorize') {
        await vectorize();
    } else if (action === 'verify') {
        let hasAlert = false;

        // Check 1: Unstaged Git states
        try {
            const gitStatus = require('child_process').execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
            if (gitStatus.length > 0) {
                console.log(`\n⚠️ \x1b[33m[前朝遗留告警] 发现上一任智能体遗留了未提交的 Git 状态！\x1b[0m`);
                console.log(`如果你是刚被唤醒的 AI，请优先审视目前的代码区并决定是否进行 commit 闭环。\n`);
                hasAlert = true;
            }
        } catch (e) { }

        // Check 2: Stale Context
        const contextPath = path.join(__dirname, '..', 'active_context.md');
        try {
            if (fs.existsSync(contextPath)) {
                const stats = fs.statSync(contextPath);
                const hoursDiff = (new Date() - stats.mtime) / (1000 * 60 * 60);
                if (hoursDiff > 24) {
                    console.log(`\n⚠️ \x1b[33m[交接失约告警] active_context.md 已超过 24 小时未更新！\x1b[0m`);
                    console.log(`上一次的交接协议极有可能被违背，请务必优先阅读该文件并梳理当前真实进度。\n`);
                    hasAlert = true;
                }
            }
        } catch (e) { }

        if (hasAlert) {
            console.log(`====================================================\n`);
        }

        if (fs.existsSync(DB_PATH)) {
            const db = initDb();
            console.log(`✅ Evo-Lite 实体库状态: \x1b[32m已就绪\x1b[0m`);
            db.close();
        } else {
            console.log(`✅ Evo-Lite 实体库状态: \x1b[33m尚未生成 (首次 remember 后自动创建)\x1b[0m`);
        }

        console.log(`📡 [配置/向量]: ${ACTIVE_MODEL}`);
        console.log(`📡 [配置/精排]: ${RERANKER_MODEL}`);

        // 执行模型探活
        console.log(`\n📡 正在启动 ONNX Runtime 引擎预热并校验本地缓存...`);
        console.log(`   (首次运行可能需要下载模型分片至 .evo-lite/.cache，约 1-2 分钟，请耐心等待)`);
        
        try {
            const testVec = await getEmbedding("health_check");
            if (testVec) {
                console.log(`✅ \x1b[32mEmbedding 引擎状态: 就绪 (本地 ONNX 加载成功)\x1b[0m`);
            } else {
                console.log(`❌ \x1b[31mEmbedding 引擎状态: 异常 (模型下载失败或环境不支持)\x1b[0m`);
            }
        } catch (e) {
            console.log(`❌ \x1b[31mEmbedding 引擎崩溃: ${e.message}\x1b[0m`);
        }

        try {
            const testRerank = await getRerankedScores("health_check", ["test"]);
            if (testRerank) {
                console.log(`✅ \x1b[32mReranker 引擎状态: 就绪 (交叉注意力精排可用)\x1b[0m`);
            } else {
                console.log(`⚠️ \x1b[33mReranker 引擎状态: 异常 (降级至纯向量检索)\x1b[0m`);
                console.log(`💡 Reranker 体积较大 (~280MB)，需联网首次下载。核心功能不受影响。`);
                console.log(`   下次执行 recall 时将自动尝试下载，或手动触发: node -e "const{pipeline}=require('@xenova/transformers');pipeline('text-classification','${RERANKER_MODEL}',{quantized:true})"`);
            }
        } catch (e) {
             console.log(`⚠️ \x1b[33mReranker 引擎异常: ${e.message}\x1b[0m`);
             console.log(`💡 Reranker 为可选增强组件 (~280MB)，不影响核心 remember/recall 功能。`);
        }
    } else if (!action || action === 'help') {
        console.log(`
🧠 \x1b[1mEvo-Lite Memory CLI\x1b[0m 🧠
=========================================
\x1b[36mUsage:\x1b[0m node .evo-lite/cli/memory.js <command> [arguments]

\x1b[36mCommands:\x1b[0m
  \x1b[32mremember\x1b[0m <text>     Write a new memory fragment into the database.
                      (Must be >40 chars and formatted correctly)
  \x1b[32mrecall\x1b[0m <query>      Semantic search against the memory database.
  \x1b[32mforget\x1b[0m <id>       Permanently purge specific memory by ID.
  \x1b[32mstats\x1b[0m             Display current database capacity and statistics.
  \x1b[32mexport\x1b[0m <file>     Export all memories to a JSON file (stdout).
  \x1b[32mimport\x1b[0m <file>     Import memories from a JSON file path.

  \x1b[32mcontext\x1b[0m <op>...   Modify active_context.md anchors (complete, add, focus).
  \x1b[32marchive\x1b[0m <text>    Save a summary to raw_memory/ and auto-vectorize it.
  \x1b[32mvectorize\x1b[0m         Rebuild vector index interactively.
  \x1b[32mverify\x1b[0m            Run initialization checks, git state scans, and 
                      database connection verifications.
  \x1b[32mhelp\x1b[0m              Show this help menu.
=========================================
`);
    } else {
        console.log(`❌ Unknown action: '${action}'. Run 'node .evo-lite/cli/memory.js help' for usage.`);
    }
}

run().catch(error => {
    console.error("❌ CLI 执行出错:", error);
    process.exit(1);
});
