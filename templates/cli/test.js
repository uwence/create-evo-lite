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

    for (const key of ['EVO_LITE_FORCE_GIT_DIRTY', 'EVO_LITE_SKIP_GIT_STATUS']) {
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
        const primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);
        const testContent = 'This is a unique test memory fragment that is deliberately long enough to satisfy the quality guard and semantic search path.';
        await primaryLoaded.service.memorize(testContent);
        const recallResults = await primaryLoaded.service.recall('unique semantic fragment');
        assert.ok(recallResults.length > 0, 'Recall returned no results');
        assert.ok(recallResults[0].content.includes('unique test memory fragment'), 'Recall did not surface the remembered content');
        const exportPath = path.join(primary.workspaceRoot, 'memories.json');
        primaryLoaded.service.exportMemories(exportPath);
        assert.ok(fs.existsSync(exportPath), 'Export JSON was not created');

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
        const healthyTemplateDir = createTempTemplateCli('healthy-model-drift', templateRoot => {
            const modelsPath = path.join(templateRoot, 'models.js');
            const mutated = fs.readFileSync(modelsPath, 'utf8')
                .replace(/let ACTIVE_MODEL = '.*?';/, "let ACTIVE_MODEL = 'Xenova/bge-small-zh-v1.5';")
                .replace(/let ACTIVE_DIMS = \d+;/, 'let ACTIVE_DIMS = 512;');
            fs.writeFileSync(modelsPath, mutated, 'utf8');
        });
        const verifyHealthyLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: healthyTemplateDir,
        });
        const healthyVerifyOutput = await captureConsole(async () => {
            await verifyHealthyLoaded.service.verify();
        });
        assert.ok(healthyVerifyOutput.includes('CLI files are synced with templates.'), 'verify should treat dynamic model defaults as a healthy sync state');
        assert.ok(!healthyVerifyOutput.includes('out of sync'), 'verify incorrectly flagged models.js dynamic defaults as drift');
        assert.ok(healthyVerifyOutput.includes('可以继续 `/evo` / `/commit` 工作流'), 'verify healthy output did not include a clear next step');

        const driftTemplateDir = createTempTemplateCli('actual-drift', templateRoot => {
            const memoryPath = path.join(templateRoot, 'memory.js');
            fs.writeFileSync(memoryPath, `${fs.readFileSync(memoryPath, 'utf8')}\n// drift`, 'utf8');
        });
        const verifyDriftLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: driftTemplateDir,
        });
        const driftVerifyOutput = await captureConsole(async () => {
            await verifyDriftLoaded.service.verify();
        });
        assert.ok(driftVerifyOutput.includes('out of sync'), 'verify did not report actual template drift');
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
