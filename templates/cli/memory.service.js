const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync } = require('child_process');
const { closeDb, getDb, initDB } = require('./db');
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

function formatArchiveTimestamp(timestamp) {
    return timestamp
        .replace('T', '_')
        .replace(/\.\d+Z$/, '')
        .replace(/:/g, '-');
}

function buildArchiveId() {
    return `${getCommitHash()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildArchiveFilename(timestamp, id) {
    return `mem_${formatArchiveTimestamp(timestamp)}_${id}.md`;
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

function runGit(args) {
    return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function isGitInvocationBlocked(error) {
    const message = String(error && error.message ? error.message : '').toLowerCase();
    const stderr = String(error && error.stderr ? error.stderr : '').toLowerCase();
    return (
        error && (
            error.code === 'EPERM' ||
            error.code === 'EACCES' ||
            message.includes('spawnsync git eperm') ||
            message.includes('spawn git eperm') ||
            stderr.includes('access is denied')
        )
    );
}

function getInjectedCommitHash() {
    const commitHash = process.env.EVO_LITE_GIT_COMMIT;
    return commitHash ? commitHash.trim() : '';
}

function getInjectedGitStatus() {
    const gitStatusFile = process.env.EVO_LITE_GIT_STATUS_FILE;
    if (gitStatusFile && fs.existsSync(gitStatusFile)) {
        try {
            return fs.readFileSync(gitStatusFile, 'utf8');
        } catch (_) {}
    }
    return process.env.EVO_LITE_GIT_STATUS || '';
}

function parseGitStatusLines(rawStatus) {
    return rawStatus
        .split(/\r?\n/)
        .map(line => line.replace(/\r$/, ''))
        .filter(line => line.trim().length > 0);
}

function filterNonEvoLiteGitStatusLines(rawStatus) {
    return parseGitStatusLines(rawStatus).filter(line => {
        const filePath = line.slice(3).trim().replace(/\\/g, '/');
        return !filePath.startsWith('.evo-lite/');
    });
}

function getCommitHash() {
    const injectedCommitHash = getInjectedCommitHash();
    if (injectedCommitHash) {
        return injectedCommitHash;
    }
    try {
        return runGit(['rev-parse', '--short', 'HEAD']);
    } catch (_) {
        return 'No-Git';
    }
}

function ensureCleanWorktree() {
    if (process.env.EVO_LITE_SKIP_GIT_GUARD === '1') {
        return;
    }
    try {
        const gitStatus = filterNonEvoLiteGitStatusLines(getInjectedGitStatus() || runGit(['status', '--porcelain']));
        if (gitStatus.length > 0) {
            throw new Error('dirty');
        }
    } catch (error) {
        if (isGitInvocationBlocked(error)) {
            throw new Error('当前环境禁止 Node 直接调用 Git。请优先使用 `./.evo-lite/mem` 或 `.evo-lite\\mem.cmd` 执行命令，或先手工确认 `git status --short` 后再继续 track。');
        }
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
    const normalizedMarkdown = markdown.replace(/\r\n/g, '\n');
    const chunks = [];
    const extract = pattern => {
        const match = normalizedMarkdown.match(new RegExp(pattern));
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

function splitTrajectoryEntries(trajectory) {
    return trajectory
        .replace(/\\n(?=- \[)/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'));
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

    const id = options.id || buildArchiveId();
    const timestamp = options.timestamp || new Date().toISOString();
    const filename = options.filename || buildArchiveFilename(timestamp, id);
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

function updateTrajectory(markdown, mechanism, details, trajectoryId = getCommitHash()) {
    const trajectory = readSection(markdown, 'TRAJECTORY') || '';
    const entries = splitTrajectoryEntries(trajectory);
    entries.unshift(`- [${trajectoryId}] ${new Date().toISOString().split('T')[0]} ${mechanism}: ${details.substring(0, 100)}`);
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
    const archiveId = buildArchiveId();
    const archiveResult = await archive(`[${mechanism}]\n${details}`, type, {
        id: archiveId,
        timestamp: new Date().toISOString(),
    });

    let markdown = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8');
    markdown = updateTrajectory(markdown, mechanism, details, getCommitHash());

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

    let backupName = null;
    if (fs.existsSync(DB_PATH)) {
        closeDb();
        const backupPath = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        fs.copyFileSync(DB_PATH, backupPath);
        fs.unlinkSync(DB_PATH);
        backupName = path.basename(backupPath);
        console.log(`📦 旧记忆脑区已备份至: ${backupName}`);
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
    console.log('📋 Rebuild Summary:');
    console.log(`- source_archives: ${files.length}`);
    console.log(`- rebuilt_archives: ${result.files}`);
    console.log(`- rebuilt_chunks: ${result.chunks}`);
    console.log(`- invalid_archives: ${result.invalid.length}`);
    if (backupName) {
        console.log(`- db_backup: ${backupName}`);
    }
    if (result.invalid.length > 0) {
        console.log('💡 建议下一步: 先修复损坏的 raw archive，再重新执行 `node .evo-lite/cli/memory.js rebuild`。');
    } else {
        console.log('💡 建议下一步: 执行 `node .evo-lite/cli/memory.js verify` 确认当前实例已恢复到可继续接管状态。');
    }
    appendLog('VECTORIZE', `Rebuilt ${result.files} files / ${result.chunks} chunks.`);
    return true;
}

function wash() {
    console.log('🛁 请使用 `rebuild` 或 `/wash` 工作流完成记忆清洗。本命令保留为兼容入口。');
}

async function verify() {
    const report = { hasAlerts: false, templateSyncChecked: false, nextSteps: [] };
    const pushNextStep = step => {
        if (!report.nextSteps.includes(step)) {
            report.nextSteps.push(step);
        }
    };
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
                pushNextStep('重新运行 `npx create-evo-lite@latest ./ --yes` 补齐模板文件。');
                continue;
            }
            const activeContent = normalizeTemplateComparableContent(file, fs.readFileSync(activeFile, 'utf8'));
            const templateContent = normalizeTemplateComparableContent(file, fs.readFileSync(templateFile, 'utf8'));
            if (activeContent !== templateContent) {
                console.warn(`⚠️ Warning: ${file} is out of sync between active CLI and templates.`);
                outOfSync = true;
                report.hasAlerts = true;
                pushNextStep('重新运行 `npx create-evo-lite@latest ./ --yes`，然后再次执行 `node .evo-lite/cli/memory.js verify`。');
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
        pushNextStep('先整理当前 Git 工作区，再继续执行 `/commit` 或新的开发动作。');
    } else {
        try {
            const gitStatus = filterNonEvoLiteGitStatusLines(getInjectedGitStatus() || runGit(['status', '--porcelain']));
            if (gitStatus.length > 0) {
                console.log('\n⚠️ [前朝遗留告警] 发现未提交的 Git 状态！');
                report.hasAlerts = true;
                pushNextStep('先整理当前 Git 工作区，再继续执行 `/commit` 或新的开发动作。');
            }
        } catch (error) {
            const gitError = `${error.message || ''}\n${error.stderr || ''}`;
            if (/not a git repository/i.test(gitError)) {
                console.log('ℹ️ Git 状态检查未执行：当前目录不是可用的 Git 工作区。');
            } else if (isGitInvocationBlocked(error)) {
                console.log('ℹ️ Git 状态检查已降级：当前 Node 运行环境禁止直接拉起 Git；若需完整校验，请使用 `./.evo-lite/mem verify` 或 `.evo-lite\\mem.cmd verify`。');
            } else {
                console.log(`⚠️ Git 状态检查失败: ${String(error.message || '').trim()}`);
                report.hasAlerts = true;
                pushNextStep('当前环境无法可靠执行 Git 状态检查；请先手工运行 `git status --short` 确认工作区。');
            }
        }
    }

    if (fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        const contextStats = fs.statSync(ACTIVE_CONTEXT_PATH);
        const hoursDiff = (Date.now() - contextStats.mtimeMs) / (1000 * 60 * 60);
        if (hoursDiff > 24) {
            console.log('\n⚠️ [交接失约告警] active_context.md 已超过 24 小时未更新！');
            report.hasAlerts = true;
            pushNextStep('先执行 `/evo` 或人工检查 `active_context.md`，确认当前项目焦点和 backlog 仍然可信。');
        }
    } else {
        console.log('⚠️ active_context.md 不存在，状态机检查未通过。');
        report.hasAlerts = true;
        pushNextStep('先恢复或重新初始化 `.evo-lite/active_context.md`，再继续开发。');
    }

    if (fs.existsSync(OFFLINE_MEMORIES_PATH)) {
        console.log('⚠️ 检测到 offline_memories.json，说明仍有离线记忆尚未补齐向量。');
        report.hasAlerts = true;
        pushNextStep('网络恢复后执行 `node .evo-lite/cli/memory.js import .evo-lite/offline_memories.json` 补齐离线记忆。');
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
        pushNextStep('先修复损坏的 raw archive，再执行 `node .evo-lite/cli/memory.js rebuild`。');
    }
    if (archiveHealth.pending.length > 0) {
        console.log(`⚠️ 检测到 ${archiveHealth.pending.length} 个 raw archive 尚未生成 vect 标记，建议尽快执行 sync / rebuild。`);
        report.hasAlerts = true;
        pushNextStep('若只是补齐 archive 标记，执行 `node .evo-lite/cli/memory.js sync`；若需要整体重建，执行 `node .evo-lite/cli/memory.js rebuild`。');
    }

    const trajectory = fs.existsSync(ACTIVE_CONTEXT_PATH) ? readSection(fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8'), 'TRAJECTORY') || '' : '';
    const trajectoryEntries = trajectory.split('\n').map(line => line.trim()).filter(line => line.startsWith('-'));
    if (trajectoryEntries.length > 1 && archiveHealth.rawFiles.length === 0) {
        console.log('⚠️ 检测到 active_context 已有多条轨迹，但尚无任何结构化 archive，状态流动可能失效。');
        report.hasAlerts = true;
        pushNextStep('检查最近的闭环是否漏掉了 `context track`，避免只有状态机更新而没有长期归档。');
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
        pushNextStep('若需要恢复精排能力，请检查模型缓存或重新执行初始化。');
    }

    try {
        const db = getDb();
        const rawMemoryCount = db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count;
        const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count;
        if (rawMemoryCount > 0 && chunkCount === 0) {
            console.log('⚠️ 检测到 raw_memory 已有数据但 chunks 为空，建议尽快执行显式重建命令 `node .evo-lite/cli/memory.js rebuild`。当前 import / sync 无法直接修复仅存于数据库表中的残留原文。');
            report.hasAlerts = true;
            pushNextStep('执行 `node .evo-lite/cli/memory.js rebuild`，用结构化归档重新生成 chunks。');
        }
    } catch (error) {
        console.log(`⚠️ 数据库读取失败: ${error.message}`);
        report.hasAlerts = true;
        pushNextStep('数据库当前不可读；先备份 `.evo-lite/memory.db`，再执行 `node .evo-lite/cli/memory.js rebuild` 或人工排查数据库文件状态。');
    }

    if (report.hasAlerts) {
        console.log('📋 建议下一步:');
        for (const step of report.nextSteps) {
            console.log(`- ${step}`);
        }
    }

    if (!report.hasAlerts) {
        console.log('✅ Verify completed with no active alerts.');
        console.log('💡 建议下一步: 可以继续 `/evo` / `/commit` 工作流，或直接开始新的开发任务。');
    }
    return report;
}

function inject(text) {
    console.log(`⚠️ context inject 仍为内部/实验能力，当前未启用。收到内容长度: ${(text || '').length}`);
}

module.exports = {
    addTask,
    archive,
    buildArchiveFilename,
    buildArchiveId,
    exportMemories,
    extractChunksFromMd,
    formatArchiveTimestamp,
    forget,
    importMemories,
    inject,
    list,
    memorize,
    parseGitStatusLines,
    filterNonEvoLiteGitStatusLines,
    recall,
    splitTrajectoryEntries,
    summarizeArchiveHealth,
    setFocus,
    stats,
    syncVectorMemory,
    track,
    vectorize,
    verify,
    wash,
};
