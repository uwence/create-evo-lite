const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI_DIR = __dirname;
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_CONTEXT_PATH = path.join(WORKSPACE_ROOT, 'templates', 'active_context.md');
const SHARED_CACHE_DIR = path.join(WORKSPACE_ROOT, '.evo-lite', '.cache');
const TEMPLATE_CLI_DIR = path.join(WORKSPACE_ROOT, 'templates', 'cli');
const TEMPLATE_ROOT_DIR = path.join(WORKSPACE_ROOT, 'templates');
const INIT_ENTRY = path.join(WORKSPACE_ROOT, 'index.js');
process.env.NODE_PATH = path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules');
require('module').Module._initPaths();

function createTempRuntimeRoot(name) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-${name}-`));
    const runtimeRoot = path.join(workspaceRoot, '.evo-lite');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const template = fs
        .readFileSync(TEMPLATE_CONTEXT_PATH, 'utf8')
        .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
    fs.writeFileSync(path.join(runtimeRoot, 'active_context.md'), template, 'utf8');
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
        fs.copyFileSync(path.join(TEMPLATE_ROOT_DIR, file), path.join(workspaceRoot, file));
    }
    copyRecursive(path.join(TEMPLATE_ROOT_DIR, '.claude'), path.join(workspaceRoot, '.claude'));
    return { runtimeRoot, workspaceRoot };
}

function createTempTemplateCli(name, mutate) {
    const templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-template-${name}-`));
    for (const file of fs.readdirSync(TEMPLATE_CLI_DIR)) {
        fs.copyFileSync(path.join(TEMPLATE_CLI_DIR, file), path.join(templateRoot, file));
    }
    if (mutate) {
        mutate(templateRoot);
    }
    return templateRoot;
}

function copyRecursive(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyRecursive(sourcePath, targetPath);
            continue;
        }
        fs.copyFileSync(sourcePath, targetPath);
    }
}

function createTempTemplateRoot(name, mutate) {
    const templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-template-root-${name}-`));
    copyRecursive(TEMPLATE_ROOT_DIR, templateRoot);
    if (mutate) {
        mutate(templateRoot);
    }
    return templateRoot;
}

function ensureParent(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeText(filePath, content) {
    ensureParent(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
}

function createLegacyInitProject(name) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-init-legacy-${name}-`));
    writeText(path.join(projectRoot, '.evo-lite', 'active_context.md'), '# legacy active context');
    writeText(path.join(projectRoot, '.evo-lite', 'cli', 'memory.js'), 'console.log("legacy runtime");');
    return projectRoot;
}

function createModernInitProject(name) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-init-modern-${name}-`));
    const template = fs
        .readFileSync(TEMPLATE_CONTEXT_PATH, 'utf8')
        .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
    writeText(path.join(projectRoot, '.evo-lite', 'active_context.md'), template);
    writeText(path.join(projectRoot, '.evo-lite', 'cli', 'memory.js'), 'console.log("modern runtime");');
    writeText(path.join(projectRoot, '.evo-lite', 'cli', 'db.js'), 'module.exports = {};');
    writeText(path.join(projectRoot, '.evo-lite', 'cli', 'models.js'), 'module.exports = {};');
    return projectRoot;
}

async function runInitializer(projectRoot, options = {}) {
    const originalArgv = process.argv.slice();
    const originalExit = process.exit;
    const originalExecSync = childProcess.execSync;
    const originalCwd = process.cwd();
    const stdout = [];
    const stderr = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const indexModulePath = require.resolve(INIT_ENTRY);
    let uncaughtInitializerError = null;
    const uncaughtHandler = caught => {
        if (caught && caught.code === 'TEST_EXIT') {
            status = typeof caught.exitCode === 'number' ? caught.exitCode : 1;
            uncaughtInitializerError = caught;
            return;
        }
        throw caught;
    };

    delete require.cache[indexModulePath];
    process.argv = ['node', INIT_ENTRY, projectRoot, '--yes'];
    console.log = (...args) => stdout.push(args.join(' '));
    console.warn = (...args) => stderr.push(args.join(' '));
    console.error = (...args) => stderr.push(args.join(' '));
    process.prependListener('uncaughtException', uncaughtHandler);

    let status = 0;
    let error = null;

    try {
        process.chdir(WORKSPACE_ROOT);
        process.exit = code => {
            status = typeof code === 'number' ? code : 0;
            const exitError = new Error(`EXIT_${status}`);
            exitError.code = 'TEST_EXIT';
            exitError.exitCode = status;
            throw exitError;
        };
        if (options.stubExecSync) {
            childProcess.execSync = () => {
                throw new Error('STOP_AFTER_CHECK');
            };
        }
        require(indexModulePath);
        await new Promise(resolve => setImmediate(resolve));
        if (uncaughtInitializerError) {
            error = uncaughtInitializerError;
        }
    } catch (caught) {
        error = caught;
        if (caught && caught.code === 'TEST_EXIT') {
            status = typeof caught.exitCode === 'number' ? caught.exitCode : 1;
        } else if (caught && caught.message === 'STOP_AFTER_CHECK') {
            status = 0;
        } else {
            status = 1;
        }
    } finally {
        delete require.cache[indexModulePath];
        process.argv = originalArgv;
        process.exit = originalExit;
        childProcess.execSync = originalExecSync;
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        process.removeListener('uncaughtException', uncaughtHandler);
        process.chdir(originalCwd);
    }

    return {
        status,
        error,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
    };
}

function resetCliModuleCache() {
    for (const file of ['runtime.js', 'db.js', 'models.js', 'memory.service.js', 'memory.js']) {
        delete require.cache[path.join(CLI_DIR, file)];
        delete require.cache[require.resolve(path.join(CLI_DIR, file))];
    }
}

function loadCli(runtimeRoot, extraEnv = {}) {
    process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
    process.env.EVO_LITE_ROOT = runtimeRoot;
    process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
    process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;

    for (const key of ['EVO_LITE_FORCE_GIT_DIRTY', 'EVO_LITE_SKIP_GIT_STATUS', 'EVO_LITE_FORCE_RERANKER_FAILURE', 'EVO_LITE_FORCE_RERANKER_SUCCESS']) {
        delete process.env[key];
    }
    Object.assign(process.env, extraEnv);

    resetCliModuleCache();
    const db = require(path.join(CLI_DIR, 'db.js'));
    const models = require(path.join(CLI_DIR, 'models.js'));
    const service = require(path.join(CLI_DIR, 'memory.service.js'));
    return { db, models, service };
}

async function bootstrapRuntime(runtimeRoot, extraEnv = {}) {
    const loaded = loadCli(runtimeRoot, extraEnv);
    await loaded.models.initEmbeddingModel(true);
    const { model, dims } = loaded.models.getActiveModelInfo();
    loaded.db.initDB(model, dims);
    return loaded;
}

function captureConsole(fn) {
    const logs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    return Promise.resolve()
        .then(fn)
        .finally(() => {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
        })
        .then(() => logs.join('\n'));
}

async function withPatchedExecFileSync(impl, fn) {
    const original = childProcess.execFileSync;
    childProcess.execFileSync = impl;
    try {
        return await fn();
    } finally {
        childProcess.execFileSync = original;
    }
}

async function runTests() {
    console.log('--- Starting CLI integration tests ---');

    try {
        console.log('1. Testing remember/recall/export...');
        const primary = createTempRuntimeRoot('memory');
        let primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);
        const testContent = 'This is a unique test memory fragment that is deliberately long enough to satisfy the quality guard and semantic search path.';
        await primaryLoaded.service.memorize(testContent);
        const recallResults = await primaryLoaded.service.recall('unique semantic fragment');
        assert.ok(recallResults.length > 0, 'Recall returned no results');
        assert.ok(recallResults[0].content.includes('unique test memory fragment'), 'Recall did not surface the remembered content');
        assert.ok(recallResults.length <= 5, 'Recall default topK should cap results at 5');
        const exportPath = path.join(primary.workspaceRoot, 'memories.json');
        primaryLoaded.service.exportMemories(exportPath);
        assert.ok(fs.existsSync(exportPath), 'Export JSON was not created');

        console.log('1a. Testing P0 namespace isolation ...');
        // Default writes go to prose namespace; code/symbol tables exist but stay empty.
        const nsDb = primaryLoaded.db.getDb();
        assert.ok(primaryLoaded.db.tableExists(nsDb, 'chunks_prose'), 'chunks_prose table should exist after first remember');
        const proseRowCount = nsDb.prepare('SELECT COUNT(*) AS c FROM chunks_prose').get().c;
        assert.ok(proseRowCount > 0, 'prose namespace should contain the remembered chunk');
        // Initialize a second namespace and confirm prose data survives.
        primaryLoaded.db.ensureNamespaceTables(nsDb, 'code', primaryLoaded.models.getActiveModelInfo().model, primaryLoaded.models.getActiveModelInfo().dims);
        assert.ok(primaryLoaded.db.tableExists(nsDb, 'chunks_code'), 'chunks_code table should exist after ensureNamespaceTables');
        const codeRowCount = nsDb.prepare('SELECT COUNT(*) AS c FROM chunks_code').get().c;
        assert.strictEqual(codeRowCount, 0, 'code namespace should start empty');
        const proseRowCountAfter = nsDb.prepare('SELECT COUNT(*) AS c FROM chunks_prose').get().c;
        assert.strictEqual(proseRowCountAfter, proseRowCount, 'creating code ns must not disturb prose ns');
        // Drift on the code ns alone must not touch the prose ns.
        primaryLoaded.db.ensureNamespaceTables(nsDb, 'code', 'Xenova/some-other-model', 999);
        const proseRowCountFinal = nsDb.prepare('SELECT COUNT(*) AS c FROM chunks_prose').get().c;
        assert.strictEqual(proseRowCountFinal, proseRowCount, 'drift on code ns must not reset prose ns');

        console.log('1b. Testing P1 safety scanner blocks well-known secret prefixes ...');        const safety = require(path.join(CLI_DIR, 'safety.js'));
        const blockScan = safety.scanForSecrets('GitHub token: ghp_abcdefghij1234567890abcdefghij123456 here');
        assert.strictEqual(blockScan.severity, 'block', 'GitHub token should be classified as block');
        assert.ok(blockScan.hits.some(h => h.kind === 'github_token'), 'GitHub token kind should appear in hits');
        const akiaScan = safety.scanForSecrets('config = AKIAIOSFODNN7EXAMPLE');
        assert.strictEqual(akiaScan.severity, 'block', 'AWS access key should be classified as block');
        // Memorize must reject content with secrets unless allowSecrets is set.
        await assert.rejects(
            primaryLoaded.service.memorize('My ssh key looks like ghp_abcdefghij1234567890abcdefghij123456 in this trace, which is long enough.'),
            /安全红线拦截/,
            'memorize must throw when content contains a known secret prefix'
        );
        // archive() also must reject the same content.
        await assert.rejects(
            primaryLoaded.service.archive('Here is my ssh key ghp_abcdefghij1234567890abcdefghij123456 captured during debugging the deploy step.'),
            /安全红线拦截/,
            'archive must throw when content contains a known secret prefix'
        );
        // No new raw archive file should have been written for the rejected payload.
        const rawDirAfterReject = fs.existsSync(path.join(primary.runtimeRoot, 'raw_memory'))
            ? fs.readdirSync(path.join(primary.runtimeRoot, 'raw_memory'))
            : [];
        assert.ok(!rawDirAfterReject.some(f => f.includes('ghp_')), 'rejected secrets must never produce a raw archive file');
        // The summarizeHits helper must not include the matched bytes (privacy).
        const summary = safety.summarizeHits(blockScan.hits);
        assert.ok(!summary.includes('ghp_'), 'safety summary must not leak the matched secret bytes');
        // Warn-tier (email PII) is redacted but written.
        const beforeId = primaryLoaded.service.list().length;
        await primaryLoaded.service.memorize('Contact me at alice@example.com for follow-up; this trace is long enough to satisfy the quality guard rules.');
        const afterRows = primaryLoaded.service.list();
        assert.ok(afterRows.length > beforeId, 'warn-tier content should be persisted (redacted)');
        const lastRow = afterRows[afterRows.length - 1];
        assert.ok(!lastRow.content.includes('alice@example.com'), 'warn-tier email should have been redacted in stored content');
        assert.ok(lastRow.content.includes('<REDACTED:email>'), 'warn-tier email should be replaced with a redaction marker');

        console.log('1c. Testing P4 inspector HTTP API returns 200 + JSON shapes ...');
        const inspector = require(path.join(CLI_DIR, 'inspector.js'));
        const handle = await inspector.startServer({ port: 0 });
        try {
            const fetchJson = async (apiPath) => {
                const res = await fetch(`${handle.url.replace(/\/$/, '')}${apiPath}`);
                assert.strictEqual(res.status, 200, `${apiPath} should return 200`);
                return res.json();
            };
            const verify = await fetchJson('/api/verify');
            assert.ok(verify.namespaces, '/api/verify must include namespaces map');
            assert.ok('prose' in verify.namespaces, '/api/verify namespaces must include prose');
            assert.ok(verify.safety, '/api/verify must include safety state');
            const archiveApi = await fetchJson('/api/archive');
            assert.ok(Array.isArray(archiveApi.files), '/api/archive must return a files array');
            const timeline = await fetchJson('/api/timeline');
            assert.ok(Array.isArray(timeline.entries), '/api/timeline must return an entries array');
            // Index page should serve HTML.
            const indexRes = await fetch(handle.url);
            assert.strictEqual(indexRes.status, 200, 'inspector index must return 200');
            assert.ok((await indexRes.text()).includes('Evo-Lite Inspector'), 'inspector HTML must include the title');
        } finally {
            await handle.close();
        }

        console.log('2. Testing context add / track --resolve ...');
        const addResult = primaryLoaded.service.addTask('Finish the protocol restore follow-up task');
        assert.ok(/^[a-f0-9]{4}$/i.test(addResult.hash), 'context add did not create a 4-char hash');
        const trackResult = await primaryLoaded.service.track('ProtocolRestore', 'Restored the protocol-oriented CLI commands and synchronized active context behavior with the actual implementation.', {
            resolve: addResult.hash,
        });
        assert.ok(
            /^mem_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(?:[a-f0-9]{7}|No-Git)_[a-f0-9]{8}\.md$/i.test(path.basename(trackResult.archivePath)),
            'track archive filename did not match the planned mem_<timestamp>_<commit>_<random>.md format (or No-Git fallback)'
        );
        assert.strictEqual(trackResult.status.archive, 'written', 'track did not report archive success');
        assert.strictEqual(trackResult.status.context, 'updated', 'track did not report context update success');
        assert.strictEqual(trackResult.status.resolve, 'resolved', 'track did not report backlog resolution success');
        assert.strictEqual(trackResult.summary.archiveWritten, true, 'track summary lost archive state');
        assert.strictEqual(trackResult.summary.contextUpdated, true, 'track summary lost context state');
        assert.strictEqual(trackResult.summary.resolvedBacklog, true, 'track summary lost resolve state');
        const contextAfterTrack = fs.readFileSync(path.join(primary.runtimeRoot, 'active_context.md'), 'utf8');
        assert.ok(!contextAfterTrack.includes(`[${addResult.hash}]`), 'Resolved backlog hash still exists after track --resolve');
        assert.ok(/\n- \[(?:[a-f0-9]{7}|No-Git)\] \d{4}-\d{2}-\d{2} ProtocolRestore: /.test(contextAfterTrack), 'Trajectory did not record the new track entry with a short hash label');

        console.log('2a. Testing context track bootstraps a fresh init runtime ...');
        const freshTrackRuntime = createTempRuntimeRoot('fresh-track');
        const freshTrackLoaded = loadCli(freshTrackRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_FORCE_RERANKER_SUCCESS: '1',
        });
        const freshTrackResult = await freshTrackLoaded.service.track(
            'InitBootstrap',
            'Confirmed that the very first context track in a freshly initialized project can archive and update context without requiring a manual rebuild first.'
        );
        assert.strictEqual(freshTrackResult.status.archive, 'written', 'fresh init track did not self-bootstrap archive ingestion');
        const rawTable = freshTrackLoaded.db.getDb()
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_memory'")
            .get();
        assert.ok(rawTable, 'fresh init track did not initialize the raw_memory table before archiving');
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);

        console.log('3. Testing CLI command-surface parsing for context add / focus ...');
        resetCliModuleCache();
        const cliModule = require(path.join(CLI_DIR, 'memory.js'));
        const formattedTrack = cliModule.formatTrackResult(trackResult);
        assert.ok(formattedTrack.includes('Context track completed'), 'track formatter missed completion header');
        assert.ok(formattedTrack.includes('- closure: complete'), 'track formatter missed closure summary');
        assert.ok(formattedTrack.includes('- archive: written'), 'track formatter missed archive status');
        assert.ok(formattedTrack.includes('- context: updated'), 'track formatter missed context status');
        assert.ok(formattedTrack.includes('- resolve: resolved'), 'track formatter missed resolve status');
        assert.ok(formattedTrack.includes('代码提交已固化，轨迹与 archive 已完成闭环'), 'track formatter missed next-step guidance');
        assert.strictEqual(
            cliModule.getCliText(['node', 'memory.js', 'context', 'add', 'Queue protocol audit']),
            'Queue protocol audit',
            'context add parsed the subcommand instead of the payload'
        );
        assert.strictEqual(
            cliModule.getCliText(['node', 'memory.js', 'context', 'focus', 'Tighten protocol consistency']),
            'Tighten protocol consistency',
            'context focus parsed the subcommand instead of the payload'
        );
        assert.strictEqual(
            cliModule.getCliText(['node', 'memory.js', 'add', 'Alias task payload']),
            'Alias task payload',
            'top-level add alias no longer parses correctly'
        );

        console.log('3a. Testing initializer blocks 1.4.9-era runtime but allows 2.x hot update ...');
        const legacyInitRoot = createLegacyInitProject('blocked');
        const legacyInitResult = await runInitializer(legacyInitRoot);
        assert.notStrictEqual(legacyInitResult.status, 0, 'initializer should block legacy 1.4.9-era runtime directories');
        assert.ok(
            `${legacyInitResult.stdout}\n${legacyInitResult.stderr}`.includes('不支持在 npm 发布的 1.4.9 旧项目上原地升级'),
            'initializer did not explain the legacy upgrade block'
        );

        const modernInitRoot = createModernInitProject('allowed');
        const modernInitResult = await runInitializer(modernInitRoot, { stubExecSync: true });
        assert.strictEqual(modernInitResult.status, 0, 'initializer should continue for 2.x-shaped runtime directories');
        assert.ok(
            !`${modernInitResult.stdout}\n${modernInitResult.stderr}`.includes('不支持在 npm 发布的 1.4.9 旧项目上原地升级'),
            'initializer incorrectly blocked a 2.x-shaped runtime directory'
        );
        assert.ok(
            modernInitResult.stdout.includes('📄 复制并配置记忆外挂模板文件'),
            'initializer did not proceed past the legacy-runtime gate for a 2.x-shaped directory'
        );

        console.log('4. Testing archive / sync ...');
        const archiveResult = await primaryLoaded.service.archive('A structured implementation summary that should become a raw archive and be vectorized immediately for later retrieval.');
        assert.ok(archiveResult.filePath.includes('raw_memory'), 'Archive did not write to raw_memory');
        assert.ok(
            /^mem_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(?:[a-f0-9]{7}|No-Git)_[a-f0-9]{8}\.md$/i.test(path.basename(archiveResult.filePath)),
            'Archive filename did not match the planned mem_<timestamp>_<commit>_<random>.md format (or No-Git fallback)'
        );

        const rawDir = path.join(primary.runtimeRoot, 'raw_memory');
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(
            path.join(rawDir, 'manual-sync.md'),
            `---\nid: "manual_sync_case"\ntimestamp: "${new Date().toISOString()}"\ntype: "task"\ntags: []\n---\n\n## 实现细节 (Implementation)\nA manually injected archive file that should be discovered by sync and converted into vectorized memory chunks.\n\n## 架构决策 (Architecture)\nKeep sync focused on files missing their vect marker.\n`,
            'utf8'
        );
        const syncResult = await primaryLoaded.service.syncVectorMemory();
        assert.ok(syncResult.files >= 1, 'Sync did not process any pending raw archive');
        assert.ok(fs.existsSync(path.join(primary.runtimeRoot, 'vect_memory', 'manual-sync.md')), 'Sync did not create vect marker');

        console.log('5. Testing sync invalid-archive guard ...');
        fs.writeFileSync(
            path.join(rawDir, 'broken-sync.md'),
            '---\nid: "broken_sync_case"\ntimestamp: "2026-03-20T00:00:00.000Z"\ntype: "bug"\ntags: []\n---\n\n## 现象 (Symptom)\nBad control char here: \u000bvectorize()\n\n## 原因 (Root Cause)\n未记录\n\n## 解决方案 (Solution)\n未记录\n',
            'utf8'
        );
        const invalidSyncResult = await primaryLoaded.service.syncVectorMemory();
        assert.ok(invalidSyncResult.invalid.some(item => item.file === 'broken-sync.md'), 'sync did not report the invalid archive');
        assert.ok(!fs.existsSync(path.join(primary.runtimeRoot, 'vect_memory', 'broken-sync.md')), 'sync incorrectly marked the invalid archive as vectorized');

        console.log('6. Testing verify flow alerts ...');
        const flowVerifyLoaded = await bootstrapRuntime(primary.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
        const flowVerifyOutput = await captureConsole(async () => {
            await flowVerifyLoaded.service.verify();
        });
        assert.ok(flowVerifyOutput.includes('损坏的 raw archive'), 'verify did not report invalid archive health');
        assert.ok(flowVerifyOutput.includes('尚未生成 vect 标记'), 'verify did not report pending archive vectorization');
        assert.ok(flowVerifyOutput.includes('📋 建议下一步:'), 'verify did not print a next-step summary for alert states');

        console.log('6a. Testing verify treats empty database files as fresh init state ...');
        const emptyDbRuntime = createTempRuntimeRoot('empty-db');
        fs.writeFileSync(path.join(emptyDbRuntime.runtimeRoot, 'memory.db'), '', 'utf8');
        const emptyDbLoaded = loadCli(emptyDbRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_FORCE_RERANKER_SUCCESS: '1',
        });
        const emptyDbVerifyOutput = await captureConsole(async () => {
            await emptyDbLoaded.service.verify();
        });
        assert.ok(emptyDbVerifyOutput.includes('初始化空库态'), 'verify should describe empty database files as fresh init state');
        assert.ok(!emptyDbVerifyOutput.includes('数据库读取失败'), 'verify should not report empty init databases as corruption');

        console.log('7. Testing verify rebuild alert for preserved raw_memory without chunks ...');
        const rebuildRuntime = createTempRuntimeRoot('rebuild');
        const rebuildLoaded = await bootstrapRuntime(rebuildRuntime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
        await rebuildLoaded.service.memorize('This preserved raw memory record should survive a model reset so verify can warn that chunks must be rebuilt explicitly afterwards.');
        rebuildLoaded.db.initDB('Xenova/bge-small-zh-v1.5', 512);
        const rebuildVerifyOutput = await captureConsole(async () => {
            await rebuildLoaded.service.verify();
        });
        assert.ok(rebuildVerifyOutput.includes('raw_memory 已有数据但 chunks 为空'), 'verify did not report preserved raw_memory without chunks');
        assert.ok(rebuildVerifyOutput.includes('显式重建命令'), 'verify did not describe the explicit rebuild path');
        assert.ok(rebuildVerifyOutput.includes('node .evo-lite/cli/memory.js rebuild'), 'verify did not point to the rebuild command');
        assert.ok(rebuildVerifyOutput.includes('📋 建议下一步:'), 'verify did not summarize rebuild guidance');

        console.log('8. Testing verify alerts ...');
        const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
        fs.utimesSync(path.join(primary.runtimeRoot, 'active_context.md'), staleDate, staleDate);
        const verifyLoaded = await bootstrapRuntime(primary.runtimeRoot, { EVO_LITE_FORCE_GIT_DIRTY: '1' });
        const verifyOutput = await captureConsole(async () => {
            await verifyLoaded.service.verify();
        });
        assert.ok(verifyOutput.includes('[前朝遗留告警]'), 'verify did not report dirty git state');
        assert.ok(verifyOutput.includes('[交接失约告警]'), 'verify did not report stale active_context.md');

        console.log('8a. Testing verify ignores .evo-lite-only git noise ...');
        const evoOnlyDirtyRuntime = createTempRuntimeRoot('verify-evo-only');
        const evoOnlyDirtyLoaded = await bootstrapRuntime(evoOnlyDirtyRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: ' M .evo-lite/active_context.md\n?? .evo-lite/raw_memory/mem_2026-03-20_00-00-00_deadbee_feedface.md',
        });
        const evoOnlyDirtyVerifyOutput = await captureConsole(async () => {
            await evoOnlyDirtyLoaded.service.verify();
        });
        assert.ok(!evoOnlyDirtyVerifyOutput.includes('[前朝遗留告警]'), 'verify should ignore .evo-lite-only git noise');
        assert.ok(evoOnlyDirtyVerifyOutput.includes('Verify completed with no active alerts.'), 'verify should stay healthy for .evo-lite-only git noise');

        console.log('8aa. Testing verify honors injected clean git status without falling back ...');
        const cleanInjectedRuntime = createTempRuntimeRoot('verify-clean-injected');
        const cleanInjectedOriginalExecFileSync = childProcess.execFileSync;
        const cleanInjectedOutput = await withPatchedExecFileSync((command, args, options) => {
            if (command === 'git') {
                const error = new Error('spawnSync git EPERM');
                error.code = 'EPERM';
                error.errno = -4048;
                throw error;
            }
            return cleanInjectedOriginalExecFileSync(command, args, options);
        }, async () => {
            const cleanInjectedLoaded = await bootstrapRuntime(cleanInjectedRuntime.runtimeRoot, {
                EVO_LITE_GIT_STATUS: '',
            });
            return captureConsole(async () => {
                await cleanInjectedLoaded.service.verify();
            });
        });
        assert.ok(!cleanInjectedOutput.includes('Git 状态检查已降级'), 'verify should trust injected clean git status instead of falling back to Node git');
        assert.ok(cleanInjectedOutput.includes('Verify completed with no active alerts.'), 'verify should stay healthy with injected clean git status');

        console.log('8ab. Testing reranker failure is cached until explicit retry ...');
        const rerankerRuntime = createTempRuntimeRoot('reranker-state');
        const rerankerLoaded = loadCli(rerankerRuntime.runtimeRoot, {
            EVO_LITE_FORCE_RERANKER_FAILURE: '1',
            EVO_LITE_SKIP_GIT_STATUS: '1',
        });
        const firstReranker = await rerankerLoaded.models.getReranker();
        assert.strictEqual(firstReranker, null, 'reranker failure hook should produce a null reranker');
        assert.ok(fs.existsSync(path.join(rerankerRuntime.runtimeRoot, 'reranker_state.json')), 'reranker failure should persist a disabled-state marker');

        const rerankerRetryBlockedLoaded = loadCli(rerankerRuntime.runtimeRoot, {
            EVO_LITE_FORCE_RERANKER_SUCCESS: '1',
            EVO_LITE_SKIP_GIT_STATUS: '1',
        });
        const blockedReranker = await rerankerRetryBlockedLoaded.models.getReranker();
        assert.strictEqual(blockedReranker, null, 'reranker should stay disabled until an explicit retry is requested');
        const retriedReranker = await rerankerRetryBlockedLoaded.models.getReranker({ allowRetry: true });
        assert.ok(retriedReranker, 'explicit reranker retry should clear the disabled-state marker and restore reranking');

        console.log('8b. Testing git guard ignores .evo-lite-only deletions with leading status padding ...');
        process.env.EVO_LITE_SKIP_GIT_GUARD = '';
        process.env.EVO_LITE_GIT_STATUS = ' D .evo-lite/vect_memory/legacy-marker.md';
        await assert.doesNotReject(async () => {
            await primaryLoaded.service.track('GuardRegression', 'Confirmed the git clean-worktree guard ignores .evo-lite-only delete markers even when porcelain status lines start with a single-column deletion flag.');
        }, 'track should ignore .evo-lite-only delete markers');
        process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
        delete process.env.EVO_LITE_GIT_STATUS;

        console.log('9. Testing verify downgrade when Node cannot spawn git ...');
        const blockedGitRuntime = createTempRuntimeRoot('blocked-git');
        const originalExecFileSync = childProcess.execFileSync;
        const blockedGitOutput = await withPatchedExecFileSync((command, args, options) => {
            if (command === 'git') {
                const error = new Error('spawnSync git EPERM');
                error.code = 'EPERM';
                error.errno = -4048;
                throw error;
            }
            return originalExecFileSync(command, args, options);
        }, async () => {
            const blockedGitLoaded = await bootstrapRuntime(blockedGitRuntime.runtimeRoot);
            return captureConsole(async () => {
                await blockedGitLoaded.service.verify();
            });
        });
        assert.ok(blockedGitOutput.includes('Git 状态检查已降级'), 'verify did not downgrade blocked git invocation');
        assert.ok(blockedGitOutput.includes('Verify completed with no active alerts.'), 'verify should stay healthy when git invocation is blocked by the environment');

        console.log('10. Testing verify template-sync semantics ...');
        const verifyRuntime = createTempRuntimeRoot('verify');
        const healthyTemplateRoot = createTempTemplateRoot('healthy-model-drift', templateRoot => {
            const modelsPath = path.join(templateRoot, 'cli', 'models.js');
            const mutated = fs.readFileSync(modelsPath, 'utf8')
                .replace(/let ACTIVE_MODEL = '.*?';/, "let ACTIVE_MODEL = 'Xenova/bge-small-zh-v1.5';")
                .replace(/let ACTIVE_DIMS = \d+;/, 'let ACTIVE_DIMS = 512;');
            fs.writeFileSync(modelsPath, mutated, 'utf8');
        });
        const verifyHealthyLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(healthyTemplateRoot, 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: healthyTemplateRoot,
        });
        const healthyVerifyOutput = await captureConsole(async () => {
            await verifyHealthyLoaded.service.verify();
        });
        assert.ok(healthyVerifyOutput.includes('CLI and host adapter files are synced with templates.'), 'verify should treat dynamic model defaults and host adapters as a healthy sync state');
        assert.ok(!healthyVerifyOutput.includes('out of sync'), 'verify incorrectly flagged models.js dynamic defaults as drift');
        assert.ok(healthyVerifyOutput.includes('可以继续 `/evo` / `/commit` 工作流'), 'verify healthy output did not include a clear next step');

        const driftTemplateRoot = createTempTemplateRoot('actual-drift', templateRoot => {
            const claudePath = path.join(templateRoot, 'CLAUDE.md');
            fs.writeFileSync(claudePath, `${fs.readFileSync(claudePath, 'utf8')}\n<!-- drift -->`, 'utf8');
        });
        const verifyDriftLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(driftTemplateRoot, 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: driftTemplateRoot,
        });
        const driftVerifyOutput = await captureConsole(async () => {
            await verifyDriftLoaded.service.verify();
        });
        assert.ok(driftVerifyOutput.includes('CLAUDE.md is out of sync'), 'verify did not report actual host adapter drift');
        assert.ok(!driftVerifyOutput.includes('Verify completed with no active alerts.'), 'verify still reported a clean bill of health after drift');

        console.log('11. Testing import...');
        const imported = createTempRuntimeRoot('import');
        const importedLoaded = await bootstrapRuntime(imported.runtimeRoot);
        await importedLoaded.service.importMemories(exportPath);
        const importedList = importedLoaded.service.list();
        assert.ok(importedList.some(item => item.content.includes('unique test memory fragment')), 'Imported runtime did not contain exported memory');

        console.log('--- All CLI integration tests passed! ---');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

runTests();
