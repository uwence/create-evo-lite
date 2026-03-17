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

const EMBEDDING_MODEL = 'Xenova/bge-small-zh-v1.5';
const RERANKER_MODEL = 'Xenova/bge-reranker-base';

// Singleton pipeline instances to avoid reloading models into memory
let extractorPipeline = null;
let classifierPipeline = null;

function initDb(ignoreFingerprint = false) {
    const db = new Database(DB_PATH);

    // Setup pragma for concurrent access and timeout
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    sqliteVec.load(db);

    // Virtual tables must be created carefully
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories USING vec0(
            vector float[512]
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
        db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('embedding_model', EMBEDDING_MODEL);
    } else if (modelRow.value !== EMBEDDING_MODEL && !ignoreFingerprint) {
        console.error(`\n❌ 致命错误: 向量库模型指纹不匹配！`);
        console.error(`⚠️ 当前脚手架配置模型: ${EMBEDDING_MODEL}`);
        console.error(`⚠️ 数据库内已绑定模型: ${modelRow.value}`);
        console.error(`👉 由于更换了模型，向量维度或语义空间已无法对齐。`);
        console.error(`✅ 解决办法 1 (推荐): 请在 index.js 初始化向导中输入之前绑定的模型 (${modelRow.value})，或者修改 cli/memory.js 的 EMBEDDING_MODEL 配置。`);
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
            // Lazy load the pipeline
            extractorPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL, {
                quantized: true, // Use Q8 quantized versions by default for massive memory savings
            });
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

    // 4. 记忆库水位线拦截 (Capacity Lock) - import 时也跳过
    const capacityDb = initDb();
    const countRow = capacityDb.prepare('SELECT COUNT(*) as count FROM memory_contents').get();
    if (countRow.count >= 30 && !isImport) {
        capacityDb.close();
        console.error(`\n❌ [致命约束被触发] 记忆碎片池已满载熔断 (当前: ${countRow.count}/30)！`);
        console.error(`系统的碎片垃圾已经堆积如山，强行挤入会导致 RAG 寻址雪崩。`);
        console.error(`🛑 【强制动作】你必须立即执行 \`node .evo-lite/cli/memory.js compact\` 进入深度清理流程！清理完成后方可存入新记忆。`);
        process.exit(1);
    }
    capacityDb.close();

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

async function compact() {
    console.log('\\n💤 记忆库进入深度睡眠 (Compacting...) 💤');
    console.log('1. 正在抽取当前所有记忆碎片...');

    const db = initDb();
    const records = db.prepare('SELECT id, content FROM memory_contents ORDER BY id ASC').all();
    db.close();

    if (records.length === 0) {
        return console.log('⚠️ 当前记忆库为空，不需要整理。');
    }

    console.log('2. 正在生成 IDE 智能体交接清单 (Handover Document)...');

    const compactFilePath = path.join(__dirname, '..', 'MEMORIES_TO_COMPACT.md');
    let markdownContent = `# 🧠 Evo-Lite 待压缩记忆池 (Records to Compact)\\n\\n`;
    markdownContent += `> **[To IDE Agent 宿主智能体]**:\\n`;
    markdownContent += `> 人类或系统刚发起了 \`compact\` 指令。由于本地端侧模型能力孱弱，现在将这 **${records.length}** 条凌乱的经验碎片托付给你（拥有完整推理能力的超大语言模型）。\\n`;
    markdownContent += `> \\n`;
    markdownContent += `> **你的任务 (Your Mission)**:\\n`;
    markdownContent += `> 1. 阅读下方所有的无序记忆碎片。\\n`;
    markdownContent += `> 2. 去重、合并、并使用**极度高维的中文架构术语**总结出 3-5 条本项目最核心的“跨文件契约”或“踩坑教训”。\\n`;
    markdownContent += `> 3. 写好总结后，请你主动新建一个临时文件并调用 \`node .evo-lite/cli/memory.js remember --file=你的临时文件路径\` 把新结晶存入。\\n`;
    markdownContent += `> ⚠️ **强制格式护航**: 总结必须遵守格式 \`[最高维标题] + 1. **核心词**: 原由与解法 (溯源历史点: [Commit: aaa, bbb])\`，否则底层抛出致命异常拒绝入库！\\n`;
    markdownContent += `> 4. 存入成功后，调用 \`node .evo-lite/cli/memory.js forget [下方所有旧 ID 带空格分隔]\` 把下方的旧垃圾彻底物理摧毁。\\n\\n---\\n\\n`;

    let allIds = [];
    records.forEach(r => {
        allIds.push(r.id);
        markdownContent += `### [ID: ${r.id}]\\n${r.content}\\n\\n`;
    });

    markdownContent += `\\n---\\n`;
    markdownContent += `**待销毁 ID 快捷复制区**: \`${allIds.join(' ')}\``;

    fs.writeFileSync(compactFilePath, markdownContent, 'utf8');

    console.log(`\\n================ [唤醒协议执行完毕] ================`);
    console.log(`🚨 \x1b[33m宿主智能体 (IDE Agent) 请立即接管控制权！\x1b[0m`);
    console.log(`这 ${records.length} 条记忆的明文已经全量导出至：\\n   📄 \x1b[36m.evo-lite/MEMORIES_TO_COMPACT.md\x1b[0m`);
    console.log(`\\n请你静默读取该文件，并按照文件头部的要求，执行高维中文摘要压缩，最后把旧数据 forget 掉！`);
    console.log(`====================================================\\n`);
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
    const id = 'mem_' + crypto.randomBytes(4).toString('hex');
    const timestamp = new Date().toISOString();
    
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
    
    console.log(`🔍 扫描到 ${files.length} 个本地原始档案，开始校验和 1:N 语义向量化...`);
    
    const db = initDb();
    let successCount = 0;
    
    for (const file of files) {
        const filePath = path.join(rawDir, file);
        const md = fs.readFileSync(filePath, 'utf8');
        
        const idMatch = md.match(/^id:\s*"([^"]+)"/m);
        if (!idMatch) {
            console.log(`⚠️ 文件 ${file} 缺少有效的 id 字段，跳过。`);
            continue;
        }
        const sourceId = idMatch[1];
        
        const typeMatch = md.match(/^type:\s*"([^"]+)"/m);
        const type = typeMatch ? typeMatch[1] : 'task';
        
        const existRow = db.prepare('SELECT id FROM memory_contents WHERE source = ?').get(sourceId);
        if (existRow) {
            console.log(`⏭️ [已存在] 跳过: ${sourceId}`);
            continue;
        }
        
        const chunks = extractChunksFromMd(md, type);
        if (chunks.length === 0) {
            console.log(`⚠️ 文件 ${file} 没有提取到有效的语义块，跳过。`);
            continue;
        }
        
        console.log(`📥 [入库中] 向量化 ${sourceId} (${chunks.length} 个语义块)...`);
        for (const chunk of chunks) {
            await remember(chunk, sourceId);
            successCount++;
        }
    }
    
    db.close();
    console.log(`✅ 批量重建完毕，共新增 ${successCount} 条向量记录。`);
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
    } else if (action === 'compact') {
        await compact();
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

        console.log(`📡 [配置/向量]: ${EMBEDDING_MODEL}`);
        console.log(`📡 [配置/精排]: ${RERANKER_MODEL}`);

        // 执行模型探活
        console.log(`\\n📡 正在启动 ONNX Runtime 引擎预热并校验本地缓存...`);
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
  \x1b[32mforget\x1b[0m            Permanently purge all memory databases and vectors.
  \x1b[32mstats\x1b[0m             Display current database capacity and statistics.
  \x1b[32mexport\x1b[0m            Export all memories to a JSON file (stdout).
  \x1b[32mimport\x1b[0m            Import memories from a JSON file path.
  \x1b[32mcompact\x1b[0m           Extract all raw fragments into MEMORIES_TO_COMPACT.md
                      and prepare the database for a compressed state.
  \x1b[32mcontext\x1b[0m <op>...   Modify active_context.md anchors (complete, add, focus).
  \x1b[32marchive\x1b[0m <text>    Save a summary to raw_memory/ and auto-vectorize it.
  \x1b[32mvectorize\x1b[0m         Rebuild vector index from raw_memory/ directory.
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
