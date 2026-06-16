const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync } = require('child_process');
const {
    closeDb,
    DEFAULT_NAMESPACE,
    getDb,
    getNamespaceCounts,
    getNamespaces,
    initDB,
    insertSessionEvent,
    isValidNamespace,
    listSessionEvents,
    tableExists,
} = require('./db');
const safety = require('./safety');
const { getActiveEngineInfo } = require('./models');
const { TAKEOVER_FOCUS_QUERY_ALIASES, TAKEOVER_VERIFY_QUERY_ALIASES, TAKEOVER_HIT_RULES } = require('./recall-rules');
const { buildManagedTemplateEntries } = require('./template-manifest');
const {
    ensureDir,
    getActiveContextPath,
    getDbPath,
    getLogPath,
    getOfflineMemoriesPath,
    getRawMemoryDir,
    getIndexMemoryDir,
    getTemplateCliDir,
    getTemplateRootDir,
    getWorkspaceRoot,
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

function generateTrigramQuery(query) {
    if (!query) {
        return query;
    }

    const tokens = query
        .replace(/[^\w\s\u4e00-\u9fa5]/gi, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return query;
    }

    return tokens.map(token => {
        if (token.length <= 3) {
            return token;
        }
        const chars = Array.from(token);
        const parts = [];
        for (let i = 0; i < chars.length - 2; i += 1) {
            parts.push(chars[i] + chars[i + 1] + chars[i + 2]);
        }
        return parts.length > 0 ? `(${parts.join(' AND ')})` : token;
    }).join(' AND ');
}

function bm25RankToScore(rank) {
    return 1 / (1 + Math.exp(rank));
}

function generateSnippet(content, query, maxChars = 200) {
    const keywords = query.replace(/[^\w\s\u4e00-\u9fa5]/gi, ' ').split(/\s+/).filter(Boolean);
    if (keywords.length === 0) {
        return content.slice(0, maxChars);
    }

    const lowerContent = content.toLowerCase();
    let matchIndex = -1;
    for (const keyword of keywords) {
        const index = lowerContent.indexOf(keyword.toLowerCase());
        if (index !== -1) {
            matchIndex = index;
            break;
        }
    }

    if (matchIndex === -1) {
        return content.slice(0, maxChars);
    }

    const start = Math.max(0, matchIndex - Math.floor(maxChars / 2));
    let snippet = content.slice(start, start + maxChars);
    if (start > 0) {
        snippet = `...${snippet}`;
    }
    if (start + maxChars < content.length) {
        snippet = `${snippet}...`;
    }
    return snippet;
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

const ACTIVE_CONTEXT_ANCHORS = ['META', 'FOCUS', 'BACKLOG', 'TRAJECTORY'];

function countMatches(markdown, pattern) {
    return (markdown.match(pattern) || []).length;
}

function parseBacklogTasks(backlog) {
    return backlog
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- ['))
        .map(line => {
            const checkboxMatch = line.match(/^- \[([ xX])\]\s*(.*)$/);
            const body = checkboxMatch ? checkboxMatch[2].trim() : line;
            const hashMatch = body.match(/^\[([a-f0-9]{4})\]\s*(.*)$/i);
            return {
                checked: checkboxMatch ? checkboxMatch[1].toLowerCase() === 'x' : false,
                hash: hashMatch ? hashMatch[1] : null,
                line,
                text: hashMatch ? hashMatch[2].trim() : body,
            };
        });
}

function parseTrajectoryEntries(trajectory) {
    return splitTrajectoryEntries(trajectory).map(line => {
        const match = line.match(/^- \[([^\]]+)\]\s+(\d{4}-\d{2}-\d{2})\s+([^:]+):\s*(.*)$/);
        return {
            date: match ? match[2] : null,
            id: match ? match[1] : null,
            line,
            mechanism: match ? match[3].trim() : null,
            summary: match ? match[4].trim() : line,
        };
    });
}

function validateActiveContextMarkdown(markdown) {
    const errors = [];
    const warnings = [];
    const sectionRanges = [];

    for (const anchor of ACTIVE_CONTEXT_ANCHORS) {
        const beginPattern = new RegExp(`<!-- BEGIN_${anchor} -->`, 'g');
        const endPattern = new RegExp(`<!-- END_${anchor} -->`, 'g');
        const beginCount = countMatches(markdown, beginPattern);
        const endCount = countMatches(markdown, endPattern);
        if (beginCount !== 1 || endCount !== 1) {
            errors.push(`${anchor} anchor count mismatch: begin=${beginCount}, end=${endCount}`);
            continue;
        }
        const beginIndex = markdown.indexOf(`<!-- BEGIN_${anchor} -->`);
        const endIndex = markdown.indexOf(`<!-- END_${anchor} -->`);
        if (beginIndex > endIndex) {
            errors.push(`${anchor} anchor order is invalid`);
            continue;
        }
        sectionRanges.push({ anchor, beginIndex, endIndex });
    }

    for (let index = 1; index < sectionRanges.length; index += 1) {
        const previous = sectionRanges[index - 1];
        const current = sectionRanges[index];
        if (previous.endIndex > current.beginIndex) {
            errors.push(`${previous.anchor} overlaps ${current.anchor}`);
        }
    }

    const sections = Object.fromEntries(ACTIVE_CONTEXT_ANCHORS.map(anchor => [anchor.toLowerCase(), (readSection(markdown, anchor) || '').trim()]));
    const backlogTasks = parseBacklogTasks(sections.backlog || '');
    const pendingTasks = backlogTasks.filter(task => !task.checked && !task.line.includes('暂无活跃任务'));
    const trajectoryEntries = parseTrajectoryEntries(sections.trajectory || '');

    if (pendingTasks.length > 5) {
        errors.push(`BACKLOG pending task count exceeds 5: ${pendingTasks.length}`);
    }
    if (trajectoryEntries.length > 20) {
        warnings.push(`TRAJECTORY has ${trajectoryEntries.length} entries; recommended maximum is 20`);
    }
    if (!sections.focus) {
        warnings.push('FOCUS section is empty');
    }
    if (/请手动填写|尚未确定当前焦点|阅读此文件，完成上下文接管/.test(markdown)) {
        warnings.push('active_context still contains initialization placeholder text');
    }

    return {
        anchors: sectionRanges.map(range => range.anchor),
        checkedAt: new Date().toISOString(),
        errors,
        valid: errors.length === 0,
        warnings,
    };
}

function buildActiveContextSnapshot(markdown) {
    const sections = Object.fromEntries(ACTIVE_CONTEXT_ANCHORS.map(anchor => [anchor.toLowerCase(), (readSection(markdown, anchor) || '').trim()]));
    const backlogTasks = parseBacklogTasks(sections.backlog || '');
    const trajectoryEntries = parseTrajectoryEntries(sections.trajectory || '');
    return {
        path: ACTIVE_CONTEXT_PATH,
        sections,
        summary: {
            activeTaskCount: backlogTasks.filter(task => !task.checked && !task.line.includes('暂无活跃任务')).length,
            focus: sections.focus,
            latestTrajectory: trajectoryEntries[0] || null,
            trajectoryCount: trajectoryEntries.length,
        },
        tasks: backlogTasks,
        trajectory: trajectoryEntries,
        validation: validateActiveContextMarkdown(markdown),
    };
}

function readActiveContext() {
    ensureContextFile();
    return buildActiveContextSnapshot(fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8'));
}

function summarizeActiveContext() {
    const snapshot = readActiveContext();
    return {
        path: snapshot.path,
        focus: snapshot.summary.focus,
        activeTasks: snapshot.tasks.filter(task => !task.checked && !task.line.includes('暂无活跃任务')),
        latestTrajectory: snapshot.summary.latestTrajectory,
        trajectoryCount: snapshot.summary.trajectoryCount,
        validation: snapshot.validation,
    };
}

function inspectActiveContextState() {
    if (!fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        return {
            exists: false,
            path: ACTIVE_CONTEXT_PATH,
            placeholder: false,
            status: 'missing',
        };
    }

    const snapshot = readActiveContext();
    const haystacks = [snapshot.sections.meta || '', snapshot.sections.focus || '', snapshot.sections.backlog || ''];
    const placeholder = [
        '请手动填写项目的最终目标',
        '尚未确定当前焦点',
        '阅读此文件，完成上下文接管',
    ].some(token => haystacks.some(text => text.includes(token)));

    return {
        exists: true,
        path: snapshot.path,
        placeholder,
        status: placeholder ? 'placeholder' : 'configured',
    };
}

function getArchitectureRulesPath() {
    return path.join(getWorkspaceRoot(), '.agents', 'rules', 'architecture.md');
}

function normalizeHookTarget(target) {
    if (typeof target !== 'string') {
        return null;
    }

    const normalized = target.replace(/\\/g, '/').trim();
    if (!normalized) {
        return null;
    }

    return normalized.replace(/^[A-Za-z]:/, '');
}

function isArchitectureBootstrapTarget(target) {
    const normalized = normalizeHookTarget(target);
    if (!normalized) {
        return false;
    }

    return [
        '.agents',
        '.agents/rules',
        '.agents/rules/architecture.md',
        '/.agents',
        '/.agents/rules',
        '/.agents/rules/architecture.md',
    ].some(suffix => normalized === suffix || normalized.endsWith(suffix));
}

function onlyTargetsArchitectureBootstrap(targets) {
    const normalizedTargets = Array.isArray(targets)
        ? targets.map(normalizeHookTarget).filter(Boolean)
        : [];
    return normalizedTargets.length > 0 && normalizedTargets.every(isArchitectureBootstrapTarget);
}

function inspectArchitectureRules() {
    const architecturePath = getArchitectureRulesPath();
    if (!fs.existsSync(architecturePath)) {
        return {
            exists: false,
            path: architecturePath,
            placeholder: false,
            status: 'missing',
        };
    }

    const content = fs.readFileSync(architecturePath, 'utf8');
    const placeholder = [
        /\[填写/i,
        /填写主语言|填写核心框架|填写包管理器|填写数据库或检索栈/,
        /填写脚手架或主入口职责|填写模板层职责|填写实例运行时目录/,
        /填写代码风格|填写不能绕过的状态机|填写目录纪律/,
    ].some(pattern => pattern.test(content));

    return {
        exists: true,
        path: architecturePath,
        placeholder,
        status: placeholder ? 'placeholder' : 'configured',
    };
}

function isCommitLikeActivity(command, tool) {
    const toolLower = String(tool || '').toLowerCase();
    const commandLower = String(command || '').toLowerCase();
    return /commit|release|ship|version/.test(toolLower)
        || /(git\s+commit\b|npm\s+version\b|pnpm\s+version\b|yarn\s+version\b|changeset\b|\brelease\b|\bship\b)/.test(commandLower);
}

function isImplementationLikeActivity(command, tool) {
    const toolLower = String(tool || '').toLowerCase();
    const normalizedTool = toolLower.replace(/[^a-z0-9]/g, '');
    const commandLower = String(command || '').toLowerCase();
    const fileMutationTool = [
        'applypatch',
        'createfile',
        'createdirectory',
        'editfile',
        'replace',
        'rename',
        'delete',
        'move',
        'writefile',
        'inserteditintofile',
        'editnotebookfile',
    ].some(token => normalizedTool.includes(token));
    const terminalTool = ['runterminalcommand', 'terminalrun', 'runinterminal'].some(token => normalizedTool.includes(token));
    const terminalMutation = terminalTool && (
        />\s*\S/.test(commandLower)
        || /(^|[\s;|&])(git\s+(?:apply|add|commit|mv|rm)\b|npm\s+version\b|pnpm\s+version\b|yarn\s+version\b|changeset\b|\brelease\b|\bship\b|mkdir\b|touch\b|mv\b|cp\b|rm\b|del\b|copy\b|move\b|new-item\b|set-content\b|add-content\b|out-file\b|tee\b|sed\s+-i\b|perl\s+-pi\b)/.test(commandLower)
    );

    return fileMutationTool || terminalMutation;
}

function validateActiveContextFile() {
    ensureContextFile();
    return validateActiveContextMarkdown(fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8'));
}

function ensureContextFile() {
    if (!fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        throw new Error(`未找到 active_context.md: ${ACTIVE_CONTEXT_PATH}`);
    }
}

async function ensureMemoryStoreReady() {
    initDB();
}

function runGit(args) {
    const output = execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return String(output).replace(/[\r\n]+$/, '');
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
    if (Object.prototype.hasOwnProperty.call(process.env, 'EVO_LITE_GIT_STATUS')) {
        return process.env.EVO_LITE_GIT_STATUS || '';
    }
    return null;
}

async function withLiveGitState(callback) {
    const keys = ['EVO_LITE_GIT_COMMIT', 'EVO_LITE_GIT_STATUS', 'EVO_LITE_GIT_STATUS_FILE'];
    const previous = new Map();

    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(process.env, key)) {
            previous.set(key, process.env[key]);
        }
        delete process.env[key];
    }

    try {
        return await callback();
    } finally {
        for (const key of keys) {
            if (previous.has(key)) {
                process.env[key] = previous.get(key);
            } else {
                delete process.env[key];
            }
        }
    }
}

function parseGitStatusLines(rawStatus) {
    return rawStatus
        .split(/\r?\n/)
        .map(line => line.replace(/\r$/, ''))
        .filter(line => line.trim().length > 0);
}

function parseGitStatusEntry(line) {
    return {
        staged: line[0] || ' ',
        unstaged: line[1] || ' ',
        filePath: line.slice(3).trim().replace(/\\/g, '/'),
        raw: line,
    };
}

function filterNonEvoLiteGitStatusLines(rawStatus) {
    return parseGitStatusLines(rawStatus).filter(line => {
        const filePath = line.slice(3).trim().replace(/\\/g, '/');
        return !filePath.startsWith('.evo-lite/');
    });
}

function getNonEvoLiteGitStatusEntries(rawStatus) {
    return parseGitStatusLines(rawStatus)
        .map(parseGitStatusEntry)
        .filter(entry => entry.filePath && !entry.filePath.startsWith('.evo-lite/'));
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
        const injectedGitStatus = getInjectedGitStatus();
        const gitStatus = filterNonEvoLiteGitStatusLines(
            injectedGitStatus !== null ? injectedGitStatus : runGit(['status', '--porcelain'])
        );
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

function validateCommitStageMode(stageMode) {
    const normalized = String(stageMode || 'staged').trim().toLowerCase();
    if (!['staged', 'all'].includes(normalized)) {
        throw new Error('mem commit 只支持 `--stage=staged` 或 `--stage=all`。');
    }
    return normalized;
}

function ensureCodeSnapshotReady(stageMode) {
    if (stageMode === 'all') {
        runGit(['add', '--all']);
    }

    const entries = getNonEvoLiteGitStatusEntries(runGit(['status', '--porcelain']));
    if (entries.length === 0) {
        throw new Error('未发现待提交的非 .evo-lite 代码变更。');
    }

    if (stageMode === 'staged') {
        const unstagedEntries = entries.filter(entry => entry.staged === ' ' || entry.unstaged !== ' ');
        if (unstagedEntries.length > 0) {
            throw new Error('mem commit 默认只消费已 staged 的代码快照；请先 git add 目标文件，或改用 `--stage=all`。');
        }
    }

    return entries;
}

function toWorkspaceGitPath(filePath) {
    return path.relative(getWorkspaceRoot(), filePath).replace(/\\/g, '/');
}

// ----------------------------------------------------------------------------
// prepareForWrite (P0): single chokepoint for every long-term write.
// Invoked by memorize / archive / rememberOffline so that secrets scanning
// (P1) and namespace selection (P0/P2) live in exactly one place.
// ----------------------------------------------------------------------------

const SAFETY_STATE = {
    lastBlock: null,
    blockCount: 0,
    redactionCount: 0,
};

function getSafetyState() {
    return { ...SAFETY_STATE };
}

function detectKindHeuristic(text) {
    if (!text || typeof text !== 'string') return 'prose';
    if (/```[\s\S]+```/.test(text)) return 'code';
    if (/\b(function|class|def|import|const|let|var|interface)\b/.test(text) && /[{}();]/.test(text)) {
        return 'code';
    }
    if (/\.(?:js|ts|tsx|jsx|py|go|rs|java|cpp|c|h)\b/.test(text)) return 'code';
    return 'prose';
}

function prepareForWrite(content, ctx = {}) {
    const allowSecrets = ctx.allowSecrets === true;
    const requestedNs = ctx.namespace;
    const kind = ctx.kind || (requestedNs === 'code' ? 'code' : null);
    let namespace = requestedNs;
    if (!namespace) {
        if (kind === 'code') namespace = 'code';
        else if (kind === 'symbol') namespace = 'symbol';
        else namespace = DEFAULT_NAMESPACE;
    }
    if (!isValidNamespace(namespace)) {
        return {
            rejected: true,
            reason: `unknown namespace: ${namespace}`,
            namespace,
            content,
            redacted: content,
            hits: [],
            severity: 'block',
        };
    }

    const scan = safety.scanForSecrets(content || '');
    if (scan.severity === 'block' && !allowSecrets) {
        SAFETY_STATE.blockCount += 1;
        SAFETY_STATE.lastBlock = {
            timestamp: new Date().toISOString(),
            summary: safety.summarizeHits(scan.hits),
            source: ctx.source || 'unknown',
        };
        appendLog('SAFETY_BLOCK', `${ctx.source || 'unknown'} | ${safety.summarizeHits(scan.hits)}`);
        return {
            rejected: true,
            reason: 'secret_detected',
            namespace,
            content,
            redacted: scan.redacted,
            hits: scan.hits.map(h => ({ kind: h.kind, severity: h.severity, start: h.start, length: h.length })),
            severity: 'block',
        };
    }

    let finalContent = content;
    if (scan.severity === 'warn' && !allowSecrets) {
        finalContent = scan.redacted;
        SAFETY_STATE.redactionCount += 1;
        appendLog('SAFETY_REDACT', `${ctx.source || 'unknown'} | ${safety.summarizeHits(scan.hits)}`);
    }

    return {
        rejected: false,
        reason: null,
        namespace,
        content: finalContent,
        redacted: scan.redacted,
        hits: scan.hits.map(h => ({ kind: h.kind, severity: h.severity, start: h.start, length: h.length })),
        severity: scan.severity,
    };
}

function recallViaText(query, topK = 5, options = {}) {
    const db = getDb();
    const scope = options.scope || 'all';
    const namespaces = scope === 'all'
        ? getNamespaces()
        : [scope].filter(namespace => isValidNamespace(namespace));

    if (tableExists(db, 'raw_memory_fts')) {
        const params = [generateTrigramQuery(query)];
        let sql = `
            SELECT
                f.rowid AS id,
                r.content,
                r.namespace,
                r.timestamp,
                bm25(raw_memory_fts, 1.0, 0.0) AS bm25_rank
            FROM raw_memory_fts f
            JOIN raw_memory r ON f.rowid = r.id
            WHERE raw_memory_fts MATCH ?
        `;

        if (scope !== 'all' && namespaces.length > 0) {
            sql += ` AND r.namespace IN (${namespaces.map(() => '?').join(',')})`;
            params.push(...namespaces);
        }

        sql += ' ORDER BY bm25_rank ASC LIMIT ?';
        params.push(topK);

        try {
            const rows = db.prepare(sql).all(...params);
            if (rows.length > 0) {
                appendLog('RECALL_FTS', `Queried "${query}" scope=${scope}, returned ${rows.length} trigram matches.`);
                return rows.map(row => ({
                    ...row,
                    score: bm25RankToScore(row.bm25_rank),
                    snippet: generateSnippet(row.content, query),
                    match_source: 'fts',
                }));
            }
        } catch (error) {
            appendLog('RECALL_FTS_ERROR', `${query} | ${error.message}`);
        }
    }

    const likeResults = db.prepare('SELECT id, content, namespace, timestamp FROM raw_memory WHERE content LIKE ? LIMIT ?').all(`%${query}%`, topK);
    appendLog('RECALL_FALLBACK', `Queried "${query}" scope=${scope}, returned ${likeResults.length} LIKE matches.`);
    return likeResults.map(row => ({
        ...row,
        snippet: generateSnippet(row.content, query),
        match_source: 'like',
    }));
}

async function rememberOffline(content, source, options = {}) {
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
        namespace: options.namespace || DEFAULT_NAMESPACE,
        source,
    });
    fs.writeFileSync(OFFLINE_MEMORIES_PATH, JSON.stringify(offlineData, null, 2), 'utf8');
    if (!options.silent) {
        console.log('🛡️ [脱机降级模式激活]: 正在将记忆降级暂存到 offline_memories.json...');
        console.log(`✅ 暂存离线记忆成功！(当前积压: ${offlineData.length} 条)`);
        console.log('💡 可用时执行 `node .evo-lite/cli/memory.js import .evo-lite/offline_memories.json` 即可补齐本地索引。');
    }
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

    // P0 + P1: every long-term write goes through the central pipeline so that
    // namespace selection and secrets scanning live in exactly one place.
    const prepared = prepareForWrite(text, {
        allowSecrets: options.allowSecrets,
        kind: options.kind,
        namespace: options.namespace,
        source,
    });
    if (prepared.rejected) {
        const summary = prepared.hits.map(h => h.kind).join(',');
        throw new Error(`写入被安全红线拦截 (severity=${prepared.severity}): ${summary || prepared.reason}. 如确属误判，可显式传入 --allow-secrets 重试。`);
    }
    const safeText = prepared.content;
    const namespace = prepared.namespace;

    const db = getDb();
    const richContent = buildRichContent(safeText, options);
    const rawMemoryId = db.prepare('INSERT INTO raw_memory (content, namespace, timestamp) VALUES (?, ?, ?)').run(
        richContent,
        namespace,
        options.timestamp || new Date().toISOString()
    ).lastInsertRowid;

    if (!options.silent) {
        console.log(`✅ Remembered! (ID: ${rawMemoryId}, ns: ${namespace})`);
        console.log('💡 [交接规约监控]: 记忆已打入隐性碎片池！请确保你同时同步 active_context.md，并按需要执行 git commit。');
    }
    appendLog('REMEMBER', `ID ${rawMemoryId} ns=${namespace} - ${richContent.substring(0, 60)}...`);
    return { id: Number(rawMemoryId), offline: false, namespace };
}

async function recall(query, topK = 5, options = {}) {
    const results = recallViaText(query, topK, options);
    appendLog('RECALL', `Queried "${query}" scope=${options.scope || 'all'}, returned ${results.length} local matches.`);
    return results;
}

function forget(id) {
    if (!id || Number.isNaN(Number(id))) {
        throw new Error('Usage: node memory.js forget <id>');
    }

    const db = getDb();
    const info = db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);

    if (info.changes === 0) {
        throw new Error(`未找到 ID 为 ${id} 的记忆碎片。`);
    }

    appendLog('FORGET', `Deleted ID ${id}`);
    console.log(`✅ 成功忘却记忆碎片 (ID: ${id})`);
}

function list() {
    return getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
}

function stats() {
    const db = getDb();
    const namespaceCounts = getNamespaceCounts(db);
    let totalChunks = 0;
    for (const ns of Object.keys(namespaceCounts)) {
        totalChunks += namespaceCounts[ns].chunks || 0;
    }
    return {
        chunks: totalChunks,
        count: db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count,
        namespaces: namespaceCounts,
        ...db.prepare('SELECT MIN(timestamp) AS first, MAX(timestamp) AS last FROM raw_memory').get(),
    };
}

function recordSessionEvent(event, options = {}) {
    if (!event || typeof event !== 'string') {
        throw new Error('recordSessionEvent requires a non-empty event string.');
    }
    initDB();
    const payload = {
        activeTaskCount: options.activeTaskCount ?? null,
        blocked: options.blocked ?? null,
        dirty: options.dirty ?? null,
        reminders: Array.isArray(options.reminders) ? options.reminders : [],
        trackNeedsUpdate: options.trackNeedsUpdate ?? null,
        warnings: Array.isArray(options.warnings) ? options.warnings : [],
    };
    const id = insertSessionEvent(getDb(), {
        command: options.command || null,
        event,
        payload,
        success: options.success ?? null,
        timestamp: options.timestamp || new Date().toISOString(),
        tool: options.tool || null,
    });
    appendLog('SESSION_EVENT', `id=${id} event=${event} tool=${options.tool || 'n/a'}`);
    return id;
}

function readSessionEvents(options = {}) {
    initDB();
    return listSessionEvents(getDb(), options);
}

function exportMemories(filePath) {
    if (!filePath) {
        throw new Error('Usage: node memory.js export <filename.json>');
    }
    const records = getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
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
                allowSecrets: true, // imported records are user-controlled; trust the source
                namespace: record.namespace,
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
    const normalized = content.replace(/\r\n/g, '\n');
    if (file !== 'models.js') {
        return normalized.trimEnd();
    }
    return normalized
        .replace(/let ACTIVE_MODEL = '.*?';/, "let ACTIVE_MODEL = '__DYNAMIC_MODEL__';")
        .replace(/let ACTIVE_DIMS = \d+;/, 'let ACTIVE_DIMS = __DYNAMIC_DIMS__;')
        .trimEnd();
}

function buildTemplateSyncEntries(templateCliPath, templateRootPath) {
    return buildManagedTemplateEntries({
        workspaceRoot: getWorkspaceRoot(),
        activeCliDir: __dirname,
        templateRootPath,
        templateCliPath,
        scopes: ['sync-always'],
    });
}



function inspectLocalState(event = 'sessionstart', options = {}) {
    const allowedEvents = ['sessionstart', 'pretooluse', 'posttooluse', 'precompact', 'stop'];
    if (!allowedEvents.includes(event)) {
        throw new Error(`Unsupported hook lifecycle event: ${event}`);
    }

    const warnings = [];
    const reminders = [];
    const command = String(options.command || '').trim();
    const output = String(options.output || '').trim();
    const success = typeof options.success === 'boolean' ? options.success : null;
    const tool = String(options.tool || '').trim();
    const commandLower = command.toLowerCase();
    const outputLower = output.toLowerCase();
    const toolLower = tool.toLowerCase();
    const responseLooksFailed = /(^|\s|:)(error|failed|failure|exception|non-zero|exit code [1-9])/i.test(output);
    const targets = Array.isArray(options.targets) ? options.targets : [];
    const contextState = inspectActiveContextState();
    const contextExists = contextState.exists;
    const contextSummary = contextExists ? summarizeActiveContext() : null;
    const contextStats = contextExists ? fs.statSync(ACTIVE_CONTEXT_PATH) : null;
    const staleHours = contextStats ? (Date.now() - contextStats.mtimeMs) / (1000 * 60 * 60) : null;
    const contextStale = typeof staleHours === 'number' && staleHours > 24;
    const architectureRules = inspectArchitectureRules();
    const currentCommit = getCommitHash();
    const latestTrajectoryId = contextSummary && contextSummary.latestTrajectory ? contextSummary.latestTrajectory.id : null;
    const trackNeedsUpdate = Boolean(currentCommit && currentCommit !== 'No-Git' && latestTrajectoryId && latestTrajectoryId !== currentCommit);

    let gitStatus = null;
    let dirty = null;
    try {
        const injectedGitStatus = getInjectedGitStatus();
        gitStatus = filterNonEvoLiteGitStatusLines(
            injectedGitStatus !== null ? injectedGitStatus : runGit(['status', '--porcelain'])
        );
        dirty = gitStatus.length > 0;
    } catch (error) {
        if (isGitInvocationBlocked(error)) {
            warnings.push('git status unavailable in the current Node environment; prefer ./.evo-lite/mem or .evo-lite\\mem.cmd for full hook checks.');
        } else {
            warnings.push(`git status check failed: ${String(error.message || '').trim()}`);
        }
    }

    const changedFiles = (gitStatus || []).map(line => line.slice(3).trim().replace(/\\/g, '/'));
    const releaseFiles = changedFiles.filter(filePath => /(^|\/)(package\.json|CHANGELOG\.md|VERSION)$/i.test(filePath));
    const attemptedTrackCommand = /(context\s+track\b|memory\.js\s+context\s+track\b|mem(?:\.cmd)?\s+track\b)/.test(commandLower);
    const commitLikeActivity = isCommitLikeActivity(command, tool);
    const implementationLikeActivity = isImplementationLikeActivity(command, tool);
    const architectureUnlocked = architectureRules.status === 'missing' || architectureRules.status === 'placeholder';
    const architectureBootstrapEdit = onlyTargetsArchitectureBootstrap(targets);
    const blocked = event === 'pretooluse'
        && architectureUnlocked
        && (implementationLikeActivity || commitLikeActivity || attemptedTrackCommand)
        && !architectureBootstrapEdit;

    if (!contextExists) {
        reminders.push('active_context.md 缺失；先恢复或重新初始化状态机文件，再继续使用 hooks 自动提醒。');
    } else {
        if (contextSummary.validation && !contextSummary.validation.valid) {
            reminders.push('active_context 结构校验失败；先执行 `node .evo-lite/cli/memory.js context validate --json` 并修复锚点问题。');
        }
        if (contextStale && ['sessionstart', 'precompact', 'stop'].includes(event)) {
            reminders.push('active_context.md 已超过 24 小时未更新；先执行 `/evo` 或人工确认当前 focus/backlog 是否仍然可信。');
        }
        if (contextSummary.validation) {
            for (const warning of contextSummary.validation.warnings) {
                warnings.push(warning);
            }
        }
    }

    if (event === 'sessionstart') {
        if (contextState.status === 'placeholder') {
            reminders.push('`.evo-lite/active_context.md` 仍是初始化占位态；先把核心目标、当前 focus 与 backlog 改成真实项目状态，再继续正式实现。');
        }
        if (architectureRules.status === 'missing') {
            reminders.push('`.agents/rules/architecture.md` 缺失；执行 `/evo` 接管时请先根据现有项目痕迹或项目名提出 2-3 个候选架构/语言方案，并让用户明确选择“采纳建议”还是“自定义”。');
        } else if (architectureRules.status === 'placeholder') {
            reminders.push('`.agents/rules/architecture.md` 仍是模板占位态；执行 `/evo` 接管时不要把架构当既定事实，先基于现有项目痕迹或项目名提出候选方案，并让用户确认是沿用建议还是自定义。');
        }
    }

    if (blocked) {
        reminders.push(`架构尚未锁定（architecture.md: ${architectureRules.status}）；当前操作属于正式实现或提交闭环。先执行 \/evo 完成架构确认，并把 .agents/rules/architecture.md 从缺失/占位态更新为已配置后再继续。`);
    }

    if (event === 'posttooluse' && (success === false || responseLooksFailed) && (commitLikeActivity || attemptedTrackCommand)) {
        reminders.push('检测到闭环相关命令返回失败；不要报告完成，先检查 commit/track/release 的实际输出。');
    }

    if (event === 'posttooluse' && trackNeedsUpdate && attemptedTrackCommand) {
        const failureHint = success === false || responseLooksFailed
            ? '；当前输出显示闭环命令未完成，优先检查 context track 步骤。'
            : '；请确认命令串中的 context track 是否真正执行成功。';
        reminders.push(`检测到命令已尝试执行 context track，但 TRAJECTORY 仍未更新${failureHint}`);
    } else if (((event === 'posttooluse' && commitLikeActivity) || ['precompact', 'stop'].includes(event)) && trackNeedsUpdate) {
        reminders.push('检测到最新 commit 尚未写入 TRAJECTORY；请执行 `node .evo-lite/cli/memory.js context track --mechanism="..." --details="..."` 完成闭环。');
    }

    if (['precompact', 'stop'].includes(event) && dirty === true) {
        reminders.push('工作区仍有未提交的非 .evo-lite 改动；结束前请确认是否需要提交、暂存或明确保留现场。');
    }

    if (['posttooluse', 'precompact', 'stop'].includes(event) && releaseFiles.length > 0) {
        reminders.push(`检测到版本相关文件改动 (${releaseFiles.join(', ')})；请确认 release/tag/CHANGELOG 闭环是否完成。`);
    }

    const report = {
        activeTaskCount: contextSummary ? contextSummary.activeTasks.length : 0,
        checkedAt: new Date().toISOString(),
        architectureStatus: architectureRules.status,
        blocked,
        contextExists,
        contextStatus: contextState.status,
        contextStale,
        currentCommit,
        dirty,
        event,
        focus: contextSummary ? contextSummary.focus : null,
        command: command || null,
        latestTrajectory: contextSummary ? contextSummary.latestTrajectory : null,
        releaseFiles,
        reminders,
        success,
        tool: tool || null,
        trackNeedsUpdate,
        valid: !blocked && reminders.length === 0,
        warnings,
        output: output || null,
        workspaceRoot: getWorkspaceRoot(),
    };
    try {
        recordSessionEvent(report.event, {
            activeTaskCount: report.activeTaskCount,
            blocked: report.blocked,
            command: report.command,
            dirty: report.dirty,
            reminders: report.reminders,
            success: report.success,
            timestamp: report.checkedAt,
            tool: report.tool,
            trackNeedsUpdate: report.trackNeedsUpdate,
            warnings: report.warnings,
        });
    } catch (error) {
        appendLog('SESSION_EVENT_ERROR', `${report.event} | ${error.message}`);
    }
    return report;
}

function inspectHookLifecycle(event = 'sessionstart', options = {}) {
    return inspectLocalState(event, options);
}

function isMissingMemorySchemaError(error) {
    const message = String(error && error.message ? error.message : '').toLowerCase();
    return (
        message.includes('no such table: raw_memory') ||
        message.includes('no such table: chunks') ||
        message.includes('no such table: chunks_prose') ||
        message.includes('no such table: _meta')
    );
}

function summarizeArchiveHealth() {
    const rawDir = getRawMemoryDir();
    const vectDir = getIndexMemoryDir();
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

async function ingestArchiveFile(filePath, type, sourceId, timestamp, options = {}) {
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
            allowSecrets: options.allowSecrets,
            commitHash: sourceId,
            namespace: options.namespace,
            silent: options.silent,
            skipQualityGuard: true,
            source: `archive:${sourceId}`,
            timestamp,
        });
        inserted += 1;
    }

    ensureDir(getIndexMemoryDir());
    fs.writeFileSync(path.join(getIndexMemoryDir(), path.basename(filePath)), '', 'utf8');
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

    // P1: pre-flight safety scan on the raw archive payload BEFORE we write a file.
    // This blocks secrets from ever landing on disk, not just in the local index.
    const preflightCheck = prepareForWrite(content, {
        allowSecrets: options.allowSecrets,
        kind: options.kind,
        namespace: options.namespace,
        source: 'archive',
    });
    if (preflightCheck.rejected) {
        throw new Error(`归档被安全红线拦截 (severity=${preflightCheck.severity}): ${preflightCheck.hits.map(h => h.kind).join(',') || preflightCheck.reason}`);
    }
    const safeContent = preflightCheck.content;

    ensureDir(getRawMemoryDir());
    ensureDir(getIndexMemoryDir());

    const id = options.id || buildArchiveId();
    const timestamp = options.timestamp || new Date().toISOString();
    const filename = options.filename || buildArchiveFilename(timestamp, id);
    const filePath = path.join(getRawMemoryDir(), filename);

    const markdownBody = type === 'bug'
        ? `## 现象 (Symptom)\n${safeContent}\n\n## 原因 (Root Cause)\n未记录\n\n## 解决方案 (Solution)\n未记录\n`
        : `## 实现细节 (Implementation)\n${safeContent}\n\n## 架构决策 (Architecture)\n未记录\n`;

    const fileContent = `---\nid: "${id}"\ntimestamp: "${timestamp}"\ntype: "${type}"\nnamespace: "${preflightCheck.namespace ?? DEFAULT_NAMESPACE}"\ntags: []\n---\n\n${markdownBody}`;
    fs.writeFileSync(filePath, fileContent, 'utf8');

    const ingestion = await ingestArchiveFile(filePath, type, id, timestamp, {
        allowSecrets: true, // we already scanned upstream; archive body is safe by construction
        namespace: preflightCheck.namespace,
        silent: options.silent,
    });
    if (!ingestion.marked) {
        throw new Error(`归档生成后校验失败: ${ingestion.invalidReason}`);
    }
    appendLog('ARCHIVE', `Archived ${filePath} into ${ingestion.inserted} chunks.`);
    return { chunkCount: ingestion.inserted, filePath, namespace: preflightCheck.namespace };
}

async function syncIndexMemory() {
    const rawDir = getRawMemoryDir();
    const vectDir = getIndexMemoryDir();

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
        const nsMatch = markdown.match(/^namespace:\s*"([^"]+)"/m);

        const ingestion = await ingestArchiveFile(
            filePath,
            typeMatch ? typeMatch[1] : 'task',
            idMatch ? idMatch[1] : path.basename(file, '.md'),
            tsMatch ? tsMatch[1] : new Date().toISOString(),
            { namespace: nsMatch ? nsMatch[1] : DEFAULT_NAMESPACE }
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
    const backlogLines = (readSection(markdown, 'BACKLOG') || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const isPlaceholderLine = line => /^-\s*\[\s\]\s*暂无活跃任务。?$/.test(line);
    const tasks = backlogLines.filter(line => line.startsWith('- [ ]') && !isPlaceholderLine(line));
    if (tasks.length >= 5) {
        throw new Error('BACKLOG 任务数已达硬上限 (5条)。请先完成任务或移入搁置区。');
    }

    const hash = Math.random().toString(16).slice(2, 6);
    const newTaskLine = `- [ ] [${hash}] ${task}`;
    const backlog = [...backlogLines.filter(line => !isPlaceholderLine(line)), newTaskLine].join('\n');
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
    await ensureMemoryStoreReady();

    const type = options.type || 'task';
    const archiveId = buildArchiveId();
    const archiveResult = await archive(`[${mechanism}]\n${details}`, type, {
        id: archiveId,
        silent: options.silent,
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

async function commitWithContext(codeMessage, mechanism, details, options = {}) {
    if (!codeMessage || !mechanism || !details) {
        throw new Error('Usage: node .evo-lite/cli/memory.js commit "闭环详情" --code-message="feat(...): ..." --mechanism="机制名" [--resolve="4-char-hash"] [--stage=staged|all]');
    }

    ensureContextFile();
    await ensureMemoryStoreReady();

    const stageMode = validateCommitStageMode(options.stage || 'staged');
    ensureCodeSnapshotReady(stageMode);

    runGit(['commit', '-m', codeMessage]);
    const codeCommitHash = runGit(['rev-parse', '--short', 'HEAD']);
    const runtimeMessage = options.metaMessage || 'chore(meta): snapshot evo-lite runtime state';
    const result = {
        stageMode,
        code: {
            status: 'written',
            commitHash: codeCommitHash,
            message: codeMessage,
        },
        track: {
            status: 'skipped',
            result: null,
        },
        runtime: {
            status: 'skipped',
            commitHash: null,
            message: runtimeMessage,
            files: [],
        },
        errorStage: null,
        errorMessage: null,
    };

    try {
        const trackResult = await withLiveGitState(() => track(mechanism, details, {
            resolve: options.resolve || null,
            silent: options.silent,
            type: options.type || 'task',
        }));
        result.track = {
            status: 'complete',
            result: trackResult,
        };
        result.runtime.files = [
            toWorkspaceGitPath(ACTIVE_CONTEXT_PATH),
            toWorkspaceGitPath(trackResult.archivePath),
        ];
    } catch (error) {
        result.track.status = 'failed';
        result.errorStage = 'track';
        result.errorMessage = error.message;
        return result;
    }

    try {
        runGit(['add', '--', ...result.runtime.files]);
        runGit(['commit', '-m', runtimeMessage]);
        result.runtime.status = 'written';
        result.runtime.commitHash = runGit(['rev-parse', '--short', 'HEAD']);
    } catch (error) {
        result.runtime.status = 'failed';
        result.errorStage = 'meta-commit';
        result.errorMessage = error.message;
    }

    return result;
}

async function rebuildLocalIndex() {
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

    console.log('\n🧠 本地记忆索引重建管线 (Local Rebuild Pipeline) 🧠');
    console.log(`此操作将会从 ${files.length} 个原始记忆档案重建本地 FTS 索引。`);

    let backupName = null;
    if (fs.existsSync(DB_PATH)) {
        closeDb();
        const backupPath = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
        fs.copyFileSync(DB_PATH, backupPath);
        fs.unlinkSync(DB_PATH);
        backupName = path.basename(backupPath);
        console.log(`📦 旧记忆脑区已备份至: ${backupName}`);
    }

    initDB();

    ensureDir(getIndexMemoryDir());
    for (const file of files) {
        const markerPath = path.join(getIndexMemoryDir(), file);
        if (fs.existsSync(markerPath)) {
            fs.unlinkSync(markerPath);
        }
    }

    const result = await syncIndexMemory();
    console.log(`✅ 重建完成！共处理 ${result.files} 个档案 / ${result.chunks} 个语义碎片。`);
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
    appendLog('REBUILD_INDEX', `Rebuilt ${result.files} files / ${result.chunks} chunks.`);
    return true;
}

function wash() {
    console.log('🛁 请使用 `rebuild` 或 `/wash` 工作流完成记忆清洗。本命令保留为兼容入口。');
}

async function verify(options = {}) {
    const silent = options.silent === true;
    const log = (...args) => {
        if (!silent) {
            console.log(...args);
        }
    };
    const warn = (...args) => {
        if (!silent) {
            console.warn(...args);
        }
    };
    const report = {
        activeContext: 'unknown',
        architectureStatus: 'unknown',
        archives: { invalid: 0, pending: 0, raw: 0 },
        bootstrapPending: false,
        bootstrapSteps: [],
        configuration: null,
        contextStatus: 'unknown',
        entityStore: 'unknown',
        git: 'unknown',
        hasAlerts: false,
        localEngine: 'unknown',
        nextSteps: [],
        project_control: 'unknown',
        safety: null,
        templateSync: 'skipped',
        templateSyncChecked: false,
    };
    const pushNextStep = step => {
        if (!report.nextSteps.includes(step)) {
            report.nextSteps.push(step);
        }
    };
    const pushBootstrapStep = step => {
        if (!report.bootstrapSteps.includes(step)) {
            report.bootstrapSteps.push(step);
        }
    };
    log('🧪 Verifying Evo-Lite runtime...');

    const templateCliPath = getTemplateCliDir();
    const templateRootPath = getTemplateRootDir();
    if (templateCliPath && templateRootPath) {
        report.templateSyncChecked = true;
        report.templateSync = 'synced';
        const entries = buildTemplateSyncEntries(templateCliPath, templateRootPath);
        let outOfSync = false;

        for (const entry of entries) {
            const { activeFile, label, templateFile } = entry;
            if (!fs.existsSync(templateFile)) {
                warn(`⚠️ 模板缺少 ${label}，无法完成该文件的同步校验。`);
                outOfSync = true;
                report.hasAlerts = true;
                report.templateSync = 'out-of-sync';
                pushNextStep('重新运行 `npx create-evo-lite@latest ./ --yes` 补齐模板文件。');
                continue;
            }
            if (!fs.existsSync(activeFile)) {
                warn(`⚠️ Warning: ${label} is missing from the active workspace.`);
                outOfSync = true;
                report.hasAlerts = true;
                report.templateSync = 'out-of-sync';
                pushNextStep('重新运行 `npx create-evo-lite@latest ./ --yes`，补齐缺失的 host adapter 或模板生成资产。');
                continue;
            }
            const activeContent = normalizeTemplateComparableContent(path.basename(label), fs.readFileSync(activeFile, 'utf8'));
            const templateContent = normalizeTemplateComparableContent(path.basename(label), fs.readFileSync(templateFile, 'utf8'));
            if (activeContent !== templateContent) {
                warn(`⚠️ Warning: ${label} is out of sync between active workspace and templates.`);
                outOfSync = true;
                report.hasAlerts = true;
                report.templateSync = 'out-of-sync';
                pushNextStep('重新运行 `npx create-evo-lite@latest ./ --yes`，然后再次执行 `node .evo-lite/cli/memory.js verify`。');
            }
        }

        if (!outOfSync) {
            log('✅ CLI and host adapter files are synced with templates.');
        }
    } else {
        log('ℹ️ 模板同步检查已跳过：当前运行环境没有可对比的 templates/cli 目录。');
    }

    if (process.env.EVO_LITE_SKIP_GIT_STATUS === '1') {
        log('ℹ️ Git 状态检查已按测试/显式配置跳过。');
        report.git = 'skipped';
    } else if (process.env.EVO_LITE_FORCE_GIT_DIRTY === '1') {
        log('\n⚠️ [前朝遗留告警] 发现未提交的 Git 状态！');
        report.hasAlerts = true;
        report.git = 'dirty';
        pushNextStep('先整理当前 Git 工作区，再继续执行 `/commit` 或新的开发动作。');
    } else {
        try {
            const injectedGitStatus = getInjectedGitStatus();
            const gitStatus = filterNonEvoLiteGitStatusLines(
                injectedGitStatus !== null ? injectedGitStatus : runGit(['status', '--porcelain'])
            );
            if (gitStatus.length > 0) {
                log('\n⚠️ [前朝遗留告警] 发现未提交的 Git 状态！');
                report.hasAlerts = true;
                report.git = 'dirty';
                pushNextStep('先整理当前 Git 工作区，再继续执行 `/commit` 或新的开发动作。');
            } else {
                report.git = 'clean';
            }
        } catch (error) {
            const gitError = `${error.message || ''}\n${error.stderr || ''}`;
            if (/not a git repository/i.test(gitError)) {
                log('ℹ️ Git 状态检查未执行：当前目录不是可用的 Git 工作区。');
                report.git = 'not-a-repo';
            } else if (isGitInvocationBlocked(error)) {
                log('ℹ️ Git 状态检查已降级：当前 Node 运行环境禁止直接拉起 Git；若需完整校验，请使用 `./.evo-lite/mem verify` 或 `.evo-lite\\mem.cmd verify`。');
                report.git = 'degraded';
            } else {
                log(`⚠️ Git 状态检查失败: ${String(error.message || '').trim()}`);
                report.hasAlerts = true;
                report.git = 'error';
                pushNextStep('当前环境无法可靠执行 Git 状态检查；请先手工运行 `git status --short` 确认工作区。');
            }
        }
    }

    if (fs.existsSync(ACTIVE_CONTEXT_PATH)) {
        const contextStats = fs.statSync(ACTIVE_CONTEXT_PATH);
        const hoursDiff = (Date.now() - contextStats.mtimeMs) / (1000 * 60 * 60);
        if (hoursDiff > 24) {
            log('\n⚠️ [交接失约告警] active_context.md 已超过 24 小时未更新！');
            report.hasAlerts = true;
            report.activeContext = 'stale';
            pushNextStep('先执行 `/evo` 或人工检查 `active_context.md`，确认当前项目焦点和 backlog 仍然可信。');
        } else {
            report.activeContext = 'fresh';
        }
    } else {
        log('⚠️ active_context.md 不存在，状态机检查未通过。');
        report.hasAlerts = true;
        report.activeContext = 'missing';
        pushNextStep('先恢复或重新初始化 `.evo-lite/active_context.md`，再继续开发。');
    }

    const contextState = inspectActiveContextState();
    report.contextStatus = contextState.status;
    if (contextState.status === 'placeholder') {
        report.bootstrapPending = true;
        log('ℹ️ [初始化引导] 当前 active_context.md 仍是初始化占位态。');
        pushBootstrapStep('先用 `node .evo-lite/cli/memory.js context focus "..."` 写入真实当前焦点，再按需要补齐 backlog。');
        pushBootstrapStep('完成首个最小切片前，不要把模板里的默认目标和初始化任务继续当成真实项目状态。');
    }

    const architectureRules = inspectArchitectureRules();
    report.architectureStatus = architectureRules.status;
    if (architectureRules.status === 'missing') {
        report.bootstrapPending = true;
        log('ℹ️ [初始化引导] 尚未检测到 `.agents/rules/architecture.md`。');
        pushBootstrapStep('补齐 `.agents/rules/architecture.md`，至少锁定语言、包管理器、检索/存储栈与模块边界。');
    } else if (architectureRules.status === 'placeholder') {
        report.bootstrapPending = true;
        log('ℹ️ [初始化引导] `.agents/rules/architecture.md` 仍是模板占位态。');
        pushBootstrapStep('先把架构候选方案落成已配置规则，再进入正式实现或提交闭环。');
    }

    if (report.git === 'not-a-repo') {
        report.bootstrapPending = true;
        pushBootstrapStep('如果当前项目还不是 Git 仓库，先执行 `git init`，或重新运行 create-evo-lite 让脚手架自动完成初始化。');
    }

    if (fs.existsSync(OFFLINE_MEMORIES_PATH)) {
        log('⚠️ 检测到 offline_memories.json，说明仍有离线记忆尚未补齐本地索引。');
        report.hasAlerts = true;
        pushNextStep('执行 `node .evo-lite/cli/memory.js import .evo-lite/offline_memories.json` 补齐离线记忆与本地索引。');
    }

    if (!fs.existsSync(DB_PATH)) {
        log('ℹ️ Evo-Lite 实体库状态: 尚未生成 (首次 remember 后自动创建)');
    }

    const archiveHealth = summarizeArchiveHealth();
    report.archives = {
        invalid: archiveHealth.invalid.length,
        pending: archiveHealth.pending.length,
        raw: archiveHealth.rawFiles.length,
    };
    if (archiveHealth.invalid.length > 0) {
        log(`⚠️ 检测到 ${archiveHealth.invalid.length} 个损坏的 raw archive，需先修复后再进行完整重建。`);
        for (const item of archiveHealth.invalid.slice(0, 3)) {
            log(`   - ${item.file}: ${item.reason}`);
        }
        report.hasAlerts = true;
        pushNextStep('先修复损坏的 raw archive，再执行 `node .evo-lite/cli/memory.js rebuild`。');
    }
    if (archiveHealth.pending.length > 0) {
        log(`⚠️ 检测到 ${archiveHealth.pending.length} 个 raw archive 尚未生成 index 标记，建议尽快执行 sync / rebuild。`);
        report.hasAlerts = true;
        pushNextStep('若只是补齐 archive 标记，执行 `node .evo-lite/cli/memory.js sync`；若需要整体重建，执行 `node .evo-lite/cli/memory.js rebuild`。');
    }

    const trajectory = fs.existsSync(ACTIVE_CONTEXT_PATH) ? readSection(fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8'), 'TRAJECTORY') || '' : '';
    const trajectoryEntries = trajectory.split('\n').map(line => line.trim()).filter(line => line.startsWith('-'));
    if (trajectoryEntries.length > 1 && archiveHealth.rawFiles.length === 0) {
        log('⚠️ 检测到 active_context 已有多条轨迹，但尚无任何结构化 archive，状态流动可能失效。');
        report.hasAlerts = true;
        pushNextStep('检查最近的闭环是否漏掉了 `context track`，避免只有状态机更新而没有长期归档。');
    }

    const { model, dims } = getActiveEngineInfo();
    report.configuration = { model, dims };
    log(`📡 [配置/检索]: ${model}`);
    log(`📡 [配置/版本]: ${dims}`);
    log('\n📡 正在校验本地 FTS 记忆引擎...');

    try {
        initDB(model, dims);
        const db = getDb();
        const hasRawTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_memory'").get();
        const hasFtsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_memory_fts'").get();
        if (hasRawTable && hasFtsTable) {
            log('✅ 本地记忆引擎状态: 就绪');
            report.localEngine = 'ready';
        } else {
            log('❌ 本地记忆引擎状态: 异常');
            report.hasAlerts = true;
            report.localEngine = 'error';
            pushNextStep('重新执行 `node .evo-lite/cli/memory.js rebuild`，重建本地 FTS 索引与 archive 标记。');
        }
    } catch (error) {
        log(`❌ 本地记忆引擎状态: 异常 (${error.message})`);
        report.hasAlerts = true;
        report.localEngine = 'error';
        pushNextStep('检查 `.evo-lite/memory.db` 是否损坏；必要时先备份，再执行 `node .evo-lite/cli/memory.js rebuild`。');
    }

    const safetyState = getSafetyState();
    const lastBlockSummary = safetyState.lastBlock
        ? `${safetyState.lastBlock.timestamp} (${safetyState.lastBlock.summary})`
        : 'never';
    report.safety = {
        blockCount: safetyState.blockCount,
        lastBlock: safetyState.lastBlock || null,
        redactionCount: safetyState.redactionCount,
        ruleCount: safety.getRuleCount(),
    };
    log(`🛡️ [安全/红线]: rules=${safety.getRuleCount()}, blocks=${safetyState.blockCount}, redactions=${safetyState.redactionCount}, last_block=${lastBlockSummary}`);

    try {
        const db = getDb();
        const hasRawTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_memory'").get();
        const hasFtsTable = tableExists(db, 'raw_memory_fts');
        if (!hasRawTable || !hasFtsTable) {
            log('ℹ️ Evo-Lite 实体库状态: 当前仍是初始化空库态，首次 remember / import / rebuild 后会自动补齐表结构。');
            report.entityStore = 'init-empty';
        } else {
            log('✅ Evo-Lite 实体库状态: 已就绪');
            report.entityStore = 'ready';
            const namespaceCounts = getNamespaceCounts(db);
            const rawMemoryCount = db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count;
            let recordCount = 0;
            const nsLines = [];
            for (const ns of Object.keys(namespaceCounts)) {
                const info = namespaceCounts[ns];
                if (!info.present) continue;
                recordCount += info.chunks || 0;
                nsLines.push(`   - ns=${ns} engine=${info.model || 'unset'} version=${info.dims || '?'} records=${info.chunks}`);
            }
            if (nsLines.length > 0) {
                log('📚 [记忆空间分布]:');
                for (const line of nsLines) log(line);
            }
            if (rawMemoryCount > 0 && recordCount === 0) {
                log('⚠️ 检测到 raw_memory 已有数据但本地索引未生效，建议尽快执行显式重建命令 `node .evo-lite/cli/memory.js rebuild`。');
                report.hasAlerts = true;
                pushNextStep('执行 `node .evo-lite/cli/memory.js rebuild`，用结构化归档重新生成本地 FTS 索引。');
            }
            const hasSessionEventsTable = tableExists(db, 'session_events');
            if (hasSessionEventsTable) {
                const sessionEventCount = db.prepare('SELECT COUNT(*) AS count FROM session_events').get().count;
                if (sessionEventCount > 0 && rawMemoryCount === 0 && archiveHealth.rawFiles.length === 0) {
                    log('⚠️ 检测到 session_events 已有记录，但 durable archive 仍为空；请确认没有把事件日志当作长期归档主链。');
                    report.hasAlerts = true;
                    pushNextStep('保持 `active_context -> context track -> archive` 为唯一 durable 主链；不要把 session_events/remember 升格为并行归档。');
                }
            }
        }
    } catch (error) {
        if (isMissingMemorySchemaError(error)) {
            log('ℹ️ Evo-Lite 实体库状态: 当前仍是初始化空库态，首次 remember / import / rebuild 后会自动补齐表结构。');
            report.entityStore = 'init-empty';
        } else {
            log(`⚠️ 数据库读取失败: ${error.message}`);
            report.hasAlerts = true;
            report.entityStore = 'error';
            pushNextStep('数据库当前不可读；先备份 `.evo-lite/memory.db`，再执行 `node .evo-lite/cli/memory.js rebuild` 或人工排查数据库文件状态。');
        }
    }

    if (report.hasAlerts) {
        log('📋 建议下一步:');
        for (const step of report.nextSteps) {
            log(`- ${step}`);
        }
    }

    if (report.bootstrapPending) {
        log('📌 初始化引导:');
        for (const step of report.bootstrapSteps) {
            log(`- ${step}`);
        }
    }

    // project_control: read dashboard-data.json for a quick status without running scans
    try {
        const dashPath = path.join(getWorkspaceRoot(), '.evo-lite', 'generated', 'dashboard', 'dashboard-data.json');
        if (fs.existsSync(dashPath)) {
            const dash = JSON.parse(fs.readFileSync(dashPath, 'utf8'));
            const planData = dash.planning && !dash.planning.missing ? dash.planning : null;
            const archData = dash.architecture && !dash.architecture.missing ? dash.architecture : null;
            const driftData = dash.drift && !dash.drift.missing ? dash.drift : null;
            const r009 = driftData ? (driftData.findings || []).filter(f => f.rule === 'R009') : [];
            report.project_control = {
                planning: planData ? {
                    planIrExists: true,
                    stale: r009.some(f => f.message.startsWith('plan ')),
                    taskCount: planData.summary.tasks,
                    implemented: planData.summary.implemented,
                } : { planIrExists: false },
                architecture: archData ? {
                    architectureIrExists: true,
                    stale: r009.some(f => f.message.startsWith('architecture ')),
                    moduleCount: archData.summary.modules,
                } : { architectureIrExists: false },
                drift: driftData ? {
                    critical: driftData.summary.errors || 0,
                    warning: driftData.summary.warnings || 0,
                    info: driftData.summary.info || 0,
                } : null,
            };
        } else {
            report.project_control = { planning: { planIrExists: false }, architecture: { architectureIrExists: false }, drift: null };
        }
    } catch (_) {
        report.project_control = { error: true };
    }

    if (!report.hasAlerts) {
        log('✅ Verify completed with no active alerts.');
        log('💡 建议下一步: 可以继续 `/evo` / `/commit` 工作流，或直接开始新的开发任务。');
    }
    return report;
}

function inject(text) {
    console.log(`⚠️ context inject 仍为内部/实验能力，当前未启用。收到内容长度: ${(text || '').length}`);
}

function splitCamelCaseWords(text) {
    return String(text || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .toLowerCase();
}

function extractTrajectoryMechanism(line) {
    const match = String(line || '').match(/^\-\s+\[[^\]]+\]\s+\d{4}-\d{2}-\d{2}\s+([^:]+):/);
    return match ? match[1].trim() : null;
}

function buildTakeoverQueries(contextSummary, verifyReport) {
    const queries = [];
    const latestLine = contextSummary && contextSummary.latestTrajectory ? contextSummary.latestTrajectory.line : '';
    const mechanism = extractTrajectoryMechanism(latestLine);
    if (mechanism) {
        queries.push({ source: 'trajectory-tag', text: mechanism });
        const expanded = splitCamelCaseWords(mechanism);
        if (expanded && expanded !== mechanism.toLowerCase()) {
            queries.push({ source: 'trajectory-phrase', text: expanded });
        }
    }

    const focus = String((contextSummary && contextSummary.focus) || '');
    for (const alias of TAKEOVER_FOCUS_QUERY_ALIASES) {
        if (!alias.match.test(focus)) {
            continue;
        }
        for (const text of alias.queries) {
            queries.push({ source: alias.source, text });
        }
    }

    const verifyText = (verifyReport.nextSteps || []).join('\n');
    for (const alias of TAKEOVER_VERIFY_QUERY_ALIASES) {
        if (!alias.match.test(verifyText)) {
            continue;
        }
        for (const text of alias.queries) {
            queries.push({ source: alias.source, text });
        }
    }

    return queries.filter((query, index, list) => query.text && list.findIndex(item => item.text === query.text) === index).slice(0, 5);
}

function summarizeTakeoverHit(result) {
    const content = String((result && result.content) || '');
    for (const rule of TAKEOVER_HIT_RULES) {
        if (!rule.pattern.test(content)) {
            continue;
        }
        return {
            label: rule.label,
            effect: rule.effect,
        };
    }
    return null;
}

function extractKeywordsFromContext(focusText, backlogArray) {
    const stopwords = new Set([
        'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
        'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
        'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
        'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here', 'heres',
        'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in', 'into',
        'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor', 'not',
        'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
        'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that',
        'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd',
        'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
        'wasnt', 'we', 'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres',
        'which', 'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd',
        'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves',
        'todo', 'task', 'fix', 'bug', 'issue', 'feat', 'feature', 'refactor', 'test', 'run', 'work', 'project', 'code',
        'file', 'files', 'directory', 'folder', 'update', 'modify', 'add', 'remove', 'delete', 'clean', 'change',
        '的', '了', '和', '是', '就', '都', '而', '及', '与', '着', '或', '以', '在', '对', '于', '自', '之', '所', '去', '进行', '完成', '实现', '保留'
    ]);

    const keywords = new Set();
    const processText = (text) => {
        if (!text) return;
        const matches = text.match(/[a-zA-Z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/g);
        if (matches) {
            for (const m of matches) {
                const lower = m.toLowerCase();
                if (!stopwords.has(lower) && !/^\d+$/.test(lower)) {
                    keywords.add(lower);
                }
            }
        }
    };

    processText(focusText);
    if (Array.isArray(backlogArray)) {
        for (const item of backlogArray) {
            processText(item);
        }
    }

    return Array.from(keywords);
}

function extractReflectionBlock(content) {
    if (!content) return null;
    const regex = /##\s+(避坑与教训|解决方案\s*\(Solution\)|核心决策|架构决策\s*\(Architecture\)|现象\s*\(Symptom\))[\s\S]*?(?=(?:\n##|$))/i;
    const match = content.match(regex);
    if (match) {
        return match[0].trim();
    }
    // Fallback: If no markdown headings but contains avoidance/decision-making keywords, return the entire content
    const lower = content.toLowerCase();
    const hasReflectionKeyword = /避坑|教训|决策|解决|防止|必须|注意|symptom|solution|architecture|avoid/i.test(lower);
    if (hasReflectionKeyword) {
        return content.trim();
    }
    return null;
}

async function buildTakeoverRecall(contextSummary, verifyReport) {
    const queries = buildTakeoverQueries(contextSummary, verifyReport);
    const hits = [];

    // 1. Legacy Query Alias Rules
    for (const query of queries) {
        const results = await recall(query.text, 5);
        const topResult = Array.isArray(results)
            ? results.find(candidate => summarizeTakeoverHit(candidate))
            : null;
        if (!topResult) {
            continue;
        }
        const summary = summarizeTakeoverHit(topResult);
        if (!summary) {
            continue;
        }
        hits.push({
            query: query.text,
            memoryId: topResult.id,
            ...summary,
        });
        break;
    }

    // 2. Keyword-based SQLite Walkthrough FTS5/LIKE deep recall
    const reflections = [];
    const focusText = String((contextSummary && contextSummary.focus) || '');
    const backlog = (contextSummary && contextSummary.backlog) || [];
    const keywords = extractKeywordsFromContext(focusText, backlog);

    for (const keyword of keywords) {
        const results = await recall(keyword, 3);
        if (!Array.isArray(results)) continue;
        for (const candidate of results) {
            const block = extractReflectionBlock(candidate.content);
            if (block) {
                if (reflections.some(r => r.memoryId === candidate.id)) continue;
                reflections.push({
                    keyword,
                    memoryId: candidate.id,
                    namespace: candidate.namespace,
                    timestamp: candidate.timestamp,
                    reflection: block,
                    content: candidate.content
                });
            }
        }
    }

    return {
        status: (hits.length > 0 || reflections.length > 0) ? 'matched' : 'no-match',
        effect: (hits.length > 0 || reflections.length > 0) ? null : 'fresh-takeover',
        queries,
        hits,
        reflections: reflections.slice(0, 3)
    };
}

module.exports = {
    addTask,
    archive,
    buildArchiveFilename,
    buildArchiveId,
    buildTakeoverRecall,
    commitWithContext,
    detectKindHeuristic,
    exportMemories,
    extractChunksFromMd,
    formatArchiveTimestamp,
    forget,
    getSafetyState,
    importMemories,
    inject,
    inspectActiveContextState,
    inspectHookLifecycle,
    inspectLocalState,
    list,
    memorize,
    parseGitStatusEntry,
    parseGitStatusLines,
    readActiveContext,
    filterNonEvoLiteGitStatusLines,
    getNonEvoLiteGitStatusEntries,
    prepareForWrite,
    recall,
    readSessionEvents,
    recordSessionEvent,
    rebuildLocalIndex,
    splitTrajectoryEntries,
    summarizeActiveContext,
    summarizeArchiveHealth,
    setFocus,
    syncIndexMemory,
    stats,
    track,
    verify,
    validateActiveContextFile,
    validateActiveContextMarkdown,
    wash,
};

module.exports.syncVectorMemory = syncIndexMemory;
module.exports.vectorize = rebuildLocalIndex;
