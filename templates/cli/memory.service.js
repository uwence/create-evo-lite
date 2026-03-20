const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { execSync } = require('child_process');
const { getDb, initDB } = require('./db');
const {
    getActiveModelInfo,
    getExtractor,
    getModelConstants,
    getReranker,
    initEmbeddingModel,
    setActiveModel,
} = require('./models');
const {
    ensureDir,
    getActiveContextPath,
    getDbPath,
    getLogPath,
    getOfflineMemoriesPath,
    getRawMemoryDir,
    getTemplateCliDir,
    getVectMemoryDir,
} = require('./runtime');

const ACTIVE_CONTEXT_PATH = getActiveContextPath();
const DB_PATH = getDbPath();
const LOG_PATH = getLogPath();
const OFFLINE_MEMORIES_PATH = getOfflineMemoriesPath();

function appendLog(action, content) {
    try {
        fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${action}: ${content}\n`, 'utf8');
    } catch (_) {}
}

function chunkText(text, chunkSize = 512) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
}

function readSection(markdown, anchor) {
    const regex = new RegExp(`<!-- BEGIN_${anchor} -->([\\s\\S]*?)<!-- END_${anchor} -->`);
    const match = markdown.match(regex);
    return match ? match[1] : null;
}

function writeSection(markdown, anchor, newContent) {
    const regex = new RegExp(`(<!-- BEGIN_${anchor} -->)[\\s\\S]*?(<!-- END_${anchor} -->)`);
    return markdown.replace(regex, `$1\n${newContent}\n$2`);
}

function ensureContextFile() {
    if (!fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        throw new Error(`未找到 active_context.md: ${ACTIVE_CONTEXT_PATH}`);
    }
}

function getCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (_) {
        return 'No-Git';
    }
}

function ensureCleanWorktree() {
    if (process.env.EVO_LITE_SKIP_GIT_GUARD === '1') {
        return;
    }
    try {
        const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' })
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => {
                const filePath = line.slice(3).replace(/\\/g, '/');
                return !filePath.startsWith('.evo-lite/');
            });
        if (gitStatus.length > 0) {
            throw new Error('dirty');
        }
    } catch (_) {
        throw new Error('工作区有未提交的代码变更！请先执行 git commit 保存代码，再执行 track 记录轨迹。');
    }
}

async function getEmbedding(text) {
    try {
        const extractor = await getExtractor();
        if (!extractor) {
            return null;
        }
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error) {
        console.warn(`\x1b[33m⚠️ 本地 Embedding 推理失败: ${error.message}\x1b[0m`);
        return null;
    }
}

async function rememberOffline(content, source) {
    let offlineData = [];
    if (fs.existsSync(OFFLINE_MEMORIES_PATH)) {
        try {
            offlineData = JSON.parse(fs.readFileSync(OFFLINE_MEMORIES_PATH, 'utf8'));
        } catch (_) {
            offlineData = [];
        }
    }

    offlineData.push({
        content,
        created_at: new Date().toISOString(),
        source,
    });
    fs.writeFileSync(OFFLINE_MEMORIES_PATH, JSON.stringify(offlineData, null, 2), 'utf8');
    console.log('🛡️ [脱机降级模式激活]: 正在将记忆降级暂存到 offline_memories.json...');
    console.log(`✅ 暂存离线记忆成功！(当前积压: ${offlineData.length} 条)`);
    console.log('💡 网络恢复后，使用 `node .evo-lite/cli/memory.js import .evo-lite/offline_memories.json` 即可补齐向量。');
    appendLog('REMEMBER_OFFLINE', `Saved offline - ${content.substring(0, 60)}...`);
}

function buildRichContent(content, options = {}) {
    if (options.skipTraceability === true) {
        return content;
    }
    if (content.startsWith('[Time:') && content.includes('[Commit:')) {
        return content;
    }

    const timestamp = options.timestamp || new Date().toISOString();
    const commitHash = options.commitHash || getCommitHash();
    return `[Time: ${timestamp}] [Commit: ${commitHash}]\n${content}`;
}

async function memorize(text, options = {}) {
    const source = options.source || 'cli';
    if (!options.skipQualityGuard && text.length < 40) {
        throw new Error(`记忆体字符数 (${text.length}) 过短。必须提供前因后果、架构原因或具体的绕过解法。`);
    }

    const db = getDb();
    const embedding = await getEmbedding(text);
    if (!embedding) {
        await rememberOffline(text, source);
        return { id: null, offline: true };
    }

    const richContent = buildRichContent(text, options);
    const rawMemoryId = db.prepare('INSERT INTO raw_memory (content, timestamp) VALUES (?, ?)').run(
        richContent,
        options.timestamp || new Date().toISOString()
    ).lastInsertRowid;

    const chunks = chunkText(richContent);
    for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const chunkEmbedding = await getEmbedding(chunk);
        if (!chunkEmbedding) {
            continue;
        }
        const vectorId = db.prepare('INSERT INTO vectors (embedding) VALUES (json(?))').run(JSON.stringify(chunkEmbedding)).lastInsertRowid;
        db.prepare('INSERT INTO chunks (raw_memory_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?)').run(
            rawMemoryId,
            i,
            chunk,
            vectorId
        );
    }

    console.log(`✅ Remembered! (ID: ${rawMemoryId})`);
    console.log('💡 [交接规约监控]: 记忆已打入隐性碎片池！请确保你同时同步 active_context.md，并按需要执行 git commit。');
    appendLog('REMEMBER', `ID ${rawMemoryId} - ${richContent.substring(0, 60)}...`);
    return { id: Number(rawMemoryId), offline: false };
}

async function recall(query, topK = 3) {
    const db = getDb();
    const queryEmbedding = await getEmbedding(query);

    if (!queryEmbedding) {
        console.warn('\n⚠️ 提示：无法连接 Embedding 模型，正在降级到原生 SQLite LIKE 模糊匹配...');
        const results = db.prepare('SELECT id, content FROM raw_memory WHERE content LIKE ? LIMIT ?').all(`%${query}%`, topK);
        if (fs.existsSync(OFFLINE_MEMORIES_PATH)) {
            console.log('💡 提示: sandbox 中还有未导入的离线记忆碎片 (offline_memories.json)。');
        }
        appendLog('RECALL_FALLBACK', `Text queried "${query}"`);
        return results;
    }

    const queryVector = JSON.stringify(queryEmbedding);
    const results = db.prepare(`
        SELECT
            r.id,
            r.content,
            v.distance
        FROM vectors v
        JOIN chunks c ON v.rowid = c.vector_id
        JOIN raw_memory r ON r.id = c.raw_memory_id
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance
    `).all(queryVector, Math.max(topK * 3, 10));

    if (results.length === 0) {
        return [];
    }

    const deduped = [];
    const seen = new Set();
    for (const result of results) {
        if (!seen.has(result.id)) {
            seen.add(result.id);
            deduped.push(result);
        }
    }

    const reranker = await getReranker();
    if (!reranker) {
        appendLog('RECALL', `Queried "${query}", returned vector-distance results.`);
        return deduped.slice(0, topK);
    }

    const scored = await Promise.all(
        deduped.map(async item => {
            const rerankResult = await reranker(query, item.content);
            const scoreObject = Array.isArray(rerankResult) ? rerankResult[0] : rerankResult;
            return { ...item, score: scoreObject && scoreObject.score !== undefined ? scoreObject.score : 0 };
        })
    );

    appendLog('RECALL', `Queried "${query}", reranked ${scored.length} candidates.`);
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

function forget(id) {
    if (!id || Number.isNaN(Number(id))) {
        throw new Error('Usage: node memory.js forget <id>');
    }

    const db = getDb();
    const chunks = db.prepare('SELECT vector_id FROM chunks WHERE raw_memory_id = ?').all(id);
    for (const chunk of chunks) {
        db.prepare('DELETE FROM vectors WHERE rowid = ?').run(chunk.vector_id);
    }
    db.prepare('DELETE FROM chunks WHERE raw_memory_id = ?').run(id);
    const info = db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);

    if (info.changes === 0) {
        throw new Error(`未找到 ID 为 ${id} 的记忆碎片。`);
    }

    appendLog('FORGET', `Deleted ID ${id}`);
    console.log(`✅ 成功忘却记忆碎片 (ID: ${id})`);
}

function list() {
    return getDb().prepare('SELECT id, content, timestamp FROM raw_memory ORDER BY id ASC').all();
}

function stats() {
    const db = getDb();
    return {
        chunks: db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count,
        count: db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count,
        ...db.prepare('SELECT MIN(timestamp) AS first, MAX(timestamp) AS last FROM raw_memory').get(),
    };
}

function exportMemories(filePath) {
    if (!filePath) {
        throw new Error('Usage: node memory.js export <filename.json>');
    }
    const records = getDb().prepare('SELECT id, content, timestamp FROM raw_memory ORDER BY id ASC').all();
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
    appendLog('EXPORT', `Exported ${records.length} records to ${filePath}`);
    console.log(`✅ ${records.length} 条记忆已导出至: ${filePath}`);
    return records.length;
}

async function importMemories(filePath) {
    if (!filePath) {
        throw new Error('Usage: node memory.js import <filename.json>');
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(records)) {
        throw new Error('JSON 格式错误，预期为数组。');
    }

    let successCount = 0;
    for (const record of records) {
        if (record && record.content) {
            await memorize(record.content, {
                skipQualityGuard: true,
                skipTraceability: record.content.startsWith('[Time:') && record.content.includes('[Commit:'),
                source: 'import',
                timestamp: record.timestamp,
            });
            successCount += 1;
        }
    }

    if (successCount > 0 && filePath.includes('offline_memories.json')) {
        try {
            fs.unlinkSync(filePath);
        } catch (_) {}
    }

    appendLog('IMPORT', `Imported ${successCount} records from ${filePath}`);
    console.log(`✅ 导入完毕！成功注入 ${successCount} 条记忆。`);
    return successCount;
}

function extractChunksFromMd(markdown, type) {
    const chunks = [];
    const extract = pattern => {
        const match = markdown.match(new RegExp(pattern));
        return match && match[1] ? match[1].trim() : null;
    };

    if (type === 'bug') {
        const symptom = extract('## 现象 \\(Symptom\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        const solution = extract('## 解决方案 \\(Solution\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        if (symptom && symptom !== '未记录') chunks.push(symptom);
        if (solution && solution !== '未记录') chunks.push(solution);
    } else {
        const implementation = extract('## 实现细节 \\(Implementation\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        const architecture = extract('## 架构决策 \\(Architecture\\)\\n+([\\s\\S]*?)(?:\\n+##|$)');
        const summary = extract('## Summary\\n+([\\s\\S]*?)(?:\\n+##|\\n+---|$)');
        if (implementation && implementation !== '未记录') chunks.push(implementation);
        if (architecture && architecture !== '未记录') chunks.push(architecture);
        if (summary && summary !== '未记录') chunks.push(summary);
    }

    return chunks.filter(Boolean);
}

function validateArchiveMarkdown(markdown, type) {
    const errors = [];
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(markdown)) {
        errors.push('检测到控制字符污染');
    }
    if (!/^---\s*$/m.test(markdown)) {
        errors.push('缺少 frontmatter 起始锚点');
    }
    if (!/^id:\s*"([^"]+)"/m.test(markdown)) {
        errors.push('缺少 id 字段');
    }
    if (!/^timestamp:\s*"([^"]+)"/m.test(markdown)) {
        errors.push('缺少 timestamp 字段');
    }
    if (!/^type:\s*"([^"]+)"/m.test(markdown)) {
        errors.push('缺少 type 字段');
    }

    const chunks = extractChunksFromMd(markdown, type);
    if (chunks.length === 0) {
        errors.push('未提取到有效语义片段');
    }

    return {
        chunks,
        errors,
        valid: errors.length === 0,
    };
}

function normalizeTemplateComparableContent(file, content) {
    if (file !== 'models.js') {
        return content;
    }
    return content
        .replace(/let ACTIVE_MODEL = '.*?';/, "let ACTIVE_MODEL = '__DYNAMIC_MODEL__';")
        .replace(/let ACTIVE_DIMS = \d+;/, 'let ACTIVE_DIMS = __DYNAMIC_DIMS__;');
}

function summarizeArchiveHealth() {
    const rawDir = getRawMemoryDir();
    const vectDir = getVectMemoryDir();
    const summary = {
        invalid: [],
        pending: [],
        rawFiles: [],
        vectFiles: new Set(),
    };

    if (!fs.existsSync(rawDir)) {
        return summary;
    }

    summary.rawFiles = fs.readdirSync(rawDir).filter(file => file.endsWith('.md'));
    if (fs.existsSync(vectDir)) {
        summary.vectFiles = new Set(fs.readdirSync(vectDir).filter(file => file.endsWith('.md')));
    }

    for (const file of summary.rawFiles) {
        const filePath = path.join(rawDir, file);
        const markdown = fs.readFileSync(filePath, 'utf8');
        const typeMatch = markdown.match(/^type:\s*"([^"]+)"/m);
        const validation = validateArchiveMarkdown(markdown, typeMatch ? typeMatch[1] : 'task');
        if (!validation.valid) {
            summary.invalid.push({ file, reason: validation.errors.join('；') });
        }
        if (!summary.vectFiles.has(file)) {
            summary.pending.push(file);
        }
    }

    return summary;
}

async function ingestArchiveFile(filePath, type, sourceId, timestamp) {
    const markdown = fs.readFileSync(filePath, 'utf8');
    const validation = validateArchiveMarkdown(markdown, type);
    if (!validation.valid) {
        const reason = validation.errors.join('；');
        appendLog('ARCHIVE_INVALID', `${path.basename(filePath)} - ${reason}`);
        return {
            inserted: 0,
            invalidReason: reason,
            marked: false,
        };
    }

    const chunks = validation.chunks;
    let inserted = 0;

    for (const chunk of chunks) {
        await memorize(chunk, {
            commitHash: sourceId,
            skipQualityGuard: true,
            source: `archive:${sourceId}`,
            timestamp,
        });
        inserted += 1;
    }

    ensureDir(getVectMemoryDir());
    fs.writeFileSync(path.join(getVectMemoryDir(), path.basename(filePath)), '', 'utf8');
    return {
        inserted,
        invalidReason: null,
        marked: true,
    };
}

async function archive(content, type = 'task', options = {}) {
    if (!content) {
        throw new Error('Usage: node memory.js archive "<text>" [--type=task|bug|note]');
    }

    ensureDir(getRawMemoryDir());
    ensureDir(getVectMemoryDir());

    const id = options.id || Math.random().toString(16).slice(2, 10);
    const timestamp = options.timestamp || new Date().toISOString();
    const filename = options.filename || `${timestamp.replace(/[:.]/g, '-')}-${id}.md`;
    const filePath = path.join(getRawMemoryDir(), filename);

    const markdownBody = type === 'bug'
        ? `## 现象 (Symptom)\n${content}\n\n## 原因 (Root Cause)\n未记录\n\n## 解决方案 (Solution)\n未记录\n`
        : `## 实现细节 (Implementation)\n${content}\n\n## 架构决策 (Architecture)\n未记录\n`;

    const fileContent = `---\nid: "${id}"\ntimestamp: "${timestamp}"\ntype: "${type}"\ntags: []\n---\n\n${markdownBody}`;
    fs.writeFileSync(filePath, fileContent, 'utf8');

    const ingestion = await ingestArchiveFile(filePath, type, id, timestamp);
    if (!ingestion.marked) {
        throw new Error(`归档生成后校验失败: ${ingestion.invalidReason}`);
    }
    appendLog('ARCHIVE', `Archived ${filePath} into ${ingestion.inserted} chunks.`);
    return { chunkCount: ingestion.inserted, filePath };
}

async function syncVectorMemory() {
    const rawDir = getRawMemoryDir();
    const vectDir = getVectMemoryDir();

    if (!fs.existsSync(rawDir)) {
        return { files: 0, chunks: 0 };
    }

    ensureDir(vectDir);
    const rawFiles = fs.readdirSync(rawDir).filter(file => file.endsWith('.md'));
    const vectFiles = new Set(fs.readdirSync(vectDir).filter(file => file.endsWith('.md')));
    let fileCount = 0;
    let chunkCount = 0;
    const invalid = [];
    const processed = [];
    const skipped = [];

    for (const file of rawFiles) {
        if (vectFiles.has(file)) {
            skipped.push(file);
            continue;
        }

        const filePath = path.join(rawDir, file);
        const markdown = fs.readFileSync(filePath, 'utf8');
        const idMatch = markdown.match(/^id:\s*"([^"]+)"/m);
        const tsMatch = markdown.match(/^timestamp:\s*"([^"]+)"/m);
        const typeMatch = markdown.match(/^type:\s*"([^"]+)"/m);

        const ingestion = await ingestArchiveFile(
            filePath,
            typeMatch ? typeMatch[1] : 'task',
            idMatch ? idMatch[1] : path.basename(file, '.md'),
            tsMatch ? tsMatch[1] : new Date().toISOString()
        );
        if (!ingestion.marked) {
            console.warn(`⚠️ 跳过损坏档案 ${file}: ${ingestion.invalidReason}`);
            invalid.push({ file, reason: ingestion.invalidReason });
            continue;
        }

        chunkCount += ingestion.inserted;
        fileCount += 1;
        processed.push(file);
    }

    appendLog('SYNC', `Synced ${fileCount} files / ${chunkCount} chunks / invalid ${invalid.length}.`);
    return { files: fileCount, chunks: chunkCount, invalid, processed, skipped };
}

function addTask(task) {
    ensureContextFile();
    const markdown = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8');
    let backlog = readSection(markdown, 'BACKLOG') || '';
    const tasks = backlog.split('\n').map(line => line.trim()).filter(line => line.startsWith('- [ ]'));
    if (tasks.length >= 5) {
        throw new Error('BACKLOG 任务数已达硬上限 (5条)。请先完成任务或移入搁置区。');
    }

    const hash = Math.random().toString(16).slice(2, 6);
    const newTaskLine = `- [ ] [${hash}] ${task}`;
    backlog = backlog.trim() ? `${backlog.trim()}\n${newTaskLine}` : newTaskLine;
    fs.writeFileSync(ACTIVE_CONTEXT_PATH, writeSection(markdown, 'BACKLOG', backlog), 'utf8');
    appendLog('CONTEXT_ADD', newTaskLine);
    return { hash, line: newTaskLine };
}

function setFocus(focus) {
    ensureContextFile();
    const markdown = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8');
    fs.writeFileSync(ACTIVE_CONTEXT_PATH, writeSection(markdown, 'FOCUS', focus), 'utf8');
    appendLog('CONTEXT_FOCUS', focus);
    return focus;
}

function updateTrajectory(markdown, mechanism, details) {
    const trajectory = readSection(markdown, 'TRAJECTORY') || '';
    const entries = trajectory.split('\n').map(line => line.trim()).filter(line => line.startsWith('-'));
    entries.unshift(`- [${mechanism}] ${new Date().toISOString().split('T')[0]} ${details.substring(0, 100)}`);
    while (entries.length > 10) {
        entries.pop();
    }
    return writeSection(markdown, 'TRAJECTORY', entries.join('\n'));
}

function resolveBacklog(markdown, resolveHash) {
    const backlog = readSection(markdown, 'BACKLOG') || '';
    const lines = backlog.split('\n').filter(Boolean);
    let removed = null;
    const remaining = lines.filter(line => {
        const match = line.match(/\[([a-f0-9]{4})\]/i);
        if (match && match[1].toLowerCase() === resolveHash.toLowerCase()) {
            removed = line;
            return false;
        }
        return true;
    });

    if (!removed) {
        throw new Error(`未找到待 resolve 的 backlog hash: ${resolveHash}`);
    }

    return {
        markdown: writeSection(markdown, 'BACKLOG', remaining.length > 0 ? remaining.join('\n') : '- [ ] 暂无活跃任务。'),
        removed,
    };
}

async function track(mechanism, details, options = {}) {
    if (!mechanism || !details) {
        throw new Error('Usage: node .evo-lite/cli/memory.js context track --mechanism="机制名" --details="长文本经验" [--resolve="4-char-hash"]');
    }

    ensureContextFile();
    ensureCleanWorktree();

    const type = options.type || 'task';
    const commitHash = getCommitHash();
    const archiveId = `${commitHash}_${Math.random().toString(16).slice(2, 10)}`;
    const archiveResult = await archive(`[${mechanism}]\n${details}`, type, {
        filename: `${archiveId}.md`,
        id: archiveId,
        timestamp: new Date().toISOString(),
    });

    let markdown = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8');
    markdown = updateTrajectory(markdown, mechanism, details);

    let resolvedLine = null;
    if (options.resolve) {
        const resolved = resolveBacklog(markdown, options.resolve);
        markdown = resolved.markdown;
        resolvedLine = resolved.removed;
    }

    fs.writeFileSync(ACTIVE_CONTEXT_PATH, markdown, 'utf8');
    appendLog('TRACK', `${mechanism} | resolve=${options.resolve || 'none'}`);
    return {
        archivePath: archiveResult.filePath,
        chunkCount: archiveResult.chunkCount,
        mechanism,
        resolvedLine,
        status: {
            archive: 'written',
            context: 'updated',
            resolve: options.resolve ? 'resolved' : 'not_requested',
        },
        summary: {
            archiveWritten: true,
            contextUpdated: true,
            resolvedBacklog: Boolean(resolvedLine),
        },
    };
}

async function vectorize() {
    const rawDir = getRawMemoryDir();
    if (!fs.existsSync(rawDir)) {
        console.log('⚠️ 未找到 raw_memory 目录。');
        return false;
    }

    const files = fs.readdirSync(rawDir).filter(file => file.endsWith('.md'));
    if (files.length === 0) {
        console.log('⚠️ raw_memory 目录为空。');
        return false;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n🧠 交互式模型升维管线 (Interactive Vectorize Pipeline) 🧠');
    console.log(`此操作将会重新计算 ${files.length} 个原始记忆档案的向量。`);
    console.log('1. Xenova/jina-embeddings-v2-base-zh (768维, 推荐)');
    console.log('2. Xenova/bge-small-zh-v1.5 (512维, 离线兜底)');
    console.log('0. 取消操作');

    const answer = (await rl.question('👉 请输入数字 [1, 2, 0]: ')).trim();
    rl.close();

    const { FALLBACK_DIMS, FALLBACK_MODEL } = getModelConstants();
    if (answer === '0' || answer === '') {
        console.log('🛑 操作已取消。');
        return false;
    }
    if (answer === '1') {
        setActiveModel('Xenova/jina-embeddings-v2-base-zh', 768);
    } else if (answer === '2') {
        setActiveModel(FALLBACK_MODEL, FALLBACK_DIMS);
    } else {
        console.log('🛑 无效选项，操作已取消。');
        return false;
    }

    if (fs.existsSync(DB_PATH)) {
        const backupPath = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        fs.copyFileSync(DB_PATH, backupPath);
        fs.unlinkSync(DB_PATH);
        console.log(`📦 旧记忆脑区已备份至: ${path.basename(backupPath)}`);
    }

    await initEmbeddingModel(true);
    const { model, dims } = getActiveModelInfo();
    initDB(model, dims);

    ensureDir(getVectMemoryDir());
    for (const file of files) {
        const markerPath = path.join(getVectMemoryDir(), file);
        if (fs.existsSync(markerPath)) {
            fs.unlinkSync(markerPath);
        }
    }

    const result = await syncVectorMemory();
    console.log(`✅ 重铸完成！共处理 ${result.files} 个档案 / ${result.chunks} 个语义碎片。`);
    appendLog('VECTORIZE', `Rebuilt ${result.files} files / ${result.chunks} chunks.`);
    return true;
}

function wash() {
    console.log('🛁 请使用 `rebuild` 或 `/wash` 工作流完成记忆清洗。本命令保留为兼容入口。');
}

async function verify() {
    const report = { hasAlerts: false, templateSyncChecked: false };
    console.log('🧪 Verifying Evo-Lite runtime...');

    const templateCliPath = getTemplateCliDir();
    if (templateCliPath) {
        report.templateSyncChecked = true;
        const files = ['memory.js', 'db.js', 'models.js', 'memory.service.js', 'runtime.js'];
        let outOfSync = false;

        for (const file of files) {
            const activeFile = path.join(__dirname, file);
            const templateFile = path.join(templateCliPath, file);
            if (!fs.existsSync(templateFile)) {
                console.warn(`⚠️ 模板缺少 ${file}，无法完成该文件的同步校验。`);
                outOfSync = true;
                report.hasAlerts = true;
                continue;
            }
            const activeContent = normalizeTemplateComparableContent(file, fs.readFileSync(activeFile, 'utf8'));
            const templateContent = normalizeTemplateComparableContent(file, fs.readFileSync(templateFile, 'utf8'));
            if (activeContent !== templateContent) {
                console.warn(`⚠️ Warning: ${file} is out of sync between active CLI and templates.`);
                outOfSync = true;
                report.hasAlerts = true;
            }
        }

        if (!outOfSync) {
            console.log('✅ CLI files are synced with templates.');
        }
    } else {
        console.log('ℹ️ 模板同步检查已跳过：当前运行环境没有可对比的 templates/cli 目录。');
    }

    if (process.env.EVO_LITE_SKIP_GIT_STATUS === '1') {
        console.log('ℹ️ Git 状态检查已按测试/显式配置跳过。');
    } else if (process.env.EVO_LITE_FORCE_GIT_DIRTY === '1') {
        console.log('\n⚠️ [前朝遗留告警] 发现未提交的 Git 状态！');
        report.hasAlerts = true;
    } else {
        try {
            const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' }).trim();
            if (gitStatus.length > 0) {
                console.log('\n⚠️ [前朝遗留告警] 发现未提交的 Git 状态！');
                report.hasAlerts = true;
            }
        } catch (_) {
            console.log('ℹ️ Git 状态检查未执行：当前目录不是可用的 Git 工作区。');
        }
    }

    if (fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        const contextStats = fs.statSync(ACTIVE_CONTEXT_PATH);
        const hoursDiff = (Date.now() - contextStats.mtimeMs) / (1000 * 60 * 60);
        if (hoursDiff > 24) {
            console.log('\n⚠️ [交接失约告警] active_context.md 已超过 24 小时未更新！');
            report.hasAlerts = true;
        }
    } else {
        console.log('⚠️ active_context.md 不存在，状态机检查未通过。');
        report.hasAlerts = true;
    }

    if (fs.existsSync(OFFLINE_MEMORIES_PATH)) {
        console.log('⚠️ 检测到 offline_memories.json，说明仍有离线记忆尚未补齐向量。');
        report.hasAlerts = true;
    }

    if (fs.existsSync(DB_PATH)) {
        console.log('✅ Evo-Lite 实体库状态: 已就绪');
    } else {
        console.log('ℹ️ Evo-Lite 实体库状态: 尚未生成 (首次 remember 后自动创建)');
    }

    const archiveHealth = summarizeArchiveHealth();
    if (archiveHealth.invalid.length > 0) {
        console.log(`⚠️ 检测到 ${archiveHealth.invalid.length} 个损坏的 raw archive，需先修复后再进行完整重建。`);
        for (const item of archiveHealth.invalid.slice(0, 3)) {
            console.log(`   - ${item.file}: ${item.reason}`);
        }
        report.hasAlerts = true;
    }
    if (archiveHealth.pending.length > 0) {
        console.log(`⚠️ 检测到 ${archiveHealth.pending.length} 个 raw archive 尚未生成 vect 标记，建议尽快执行 sync / rebuild。`);
        report.hasAlerts = true;
    }

    const trajectory = fs.existsSync(ACTIVE_CONTEXT_PATH) ? readSection(fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8'), 'TRAJECTORY') || '' : '';
    const trajectoryEntries = trajectory.split('\n').map(line => line.trim()).filter(line => line.startsWith('-'));
    if (trajectoryEntries.length > 1 && archiveHealth.rawFiles.length === 0) {
        console.log('⚠️ 检测到 active_context 已有多条轨迹，但尚无任何结构化 archive，状态流动可能失效。');
        report.hasAlerts = true;
    }

    const { model, dims } = getActiveModelInfo();
    const { RERANKER_MODEL } = getModelConstants();
    console.log(`📡 [配置/向量]: ${model} (${dims}d)`);
    console.log(`📡 [配置/精排]: ${RERANKER_MODEL}`);
    console.log('\n📡 正在校验 Embedding / Reranker 引擎...');

    const embedding = await getEmbedding('health_check');
    if (embedding) {
        console.log('✅ Embedding 引擎状态: 就绪');
    } else {
        console.log('❌ Embedding 引擎状态: 异常');
        report.hasAlerts = true;
    }

    const reranker = await getReranker();
    if (reranker) {
        console.log('✅ Reranker 引擎状态: 就绪');
    } else {
        console.log('⚠️ Reranker 引擎状态: 异常 (当前将降级为纯向量检索)');
        report.hasAlerts = true;
    }

    const db = getDb();
    const rawMemoryCount = db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count;
    const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count;
    if (rawMemoryCount > 0 && chunkCount === 0) {
        console.log('⚠️ 检测到 raw_memory 已有数据但 chunks 为空，建议尽快执行显式重建命令 `node .evo-lite/cli/memory.js rebuild`。当前 import / sync 无法直接修复仅存于数据库表中的残留原文。');
        report.hasAlerts = true;
    }

    if (!report.hasAlerts) {
        console.log('✅ Verify completed with no active alerts.');
    }
    return report;
}

function inject(text) {
    console.log(`⚠️ context inject 仍为内部/实验能力，当前未启用。收到内容长度: ${(text || '').length}`);
}

module.exports = {
    addTask,
    archive,
    exportMemories,
    extractChunksFromMd,
    forget,
    importMemories,
    inject,
    list,
    memorize,
    recall,
    summarizeArchiveHealth,
    setFocus,
    stats,
    syncVectorMemory,
    track,
    vectorize,
    verify,
    wash,
};
