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
const TEST_SCOPE = process.argv[2] || 'all';
function shouldRun(scope) {
    return TEST_SCOPE === 'all' || TEST_SCOPE === scope;
}
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
        const src = path.join(TEMPLATE_ROOT_DIR, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(workspaceRoot, file));
        }
    }
    const managedWorkflowDir = path.join(TEMPLATE_ROOT_DIR, '.agents', 'workflows');
    if (fs.existsSync(managedWorkflowDir)) {
        copyRecursive(managedWorkflowDir, path.join(workspaceRoot, '.agents', 'workflows'));
    }
    const claudeTemplateDir = path.join(TEMPLATE_ROOT_DIR, '.claude');
    if (fs.existsSync(claudeTemplateDir)) {
        copyRecursive(claudeTemplateDir, path.join(workspaceRoot, '.claude'));
    }
    if (fs.existsSync(path.join(TEMPLATE_ROOT_DIR, '.github'))) {
        copyRecursive(path.join(TEMPLATE_ROOT_DIR, '.github'), path.join(workspaceRoot, '.github'));
    }
    if (fs.existsSync(path.join(TEMPLATE_ROOT_DIR, '.vscode'))) {
        copyRecursive(path.join(TEMPLATE_ROOT_DIR, '.vscode'), path.join(workspaceRoot, '.vscode'));
    }
    if (fs.existsSync(path.join(TEMPLATE_ROOT_DIR, '.codex'))) {
        copyRecursive(path.join(TEMPLATE_ROOT_DIR, '.codex'), path.join(workspaceRoot, '.codex'));
    }
    return { runtimeRoot, workspaceRoot };
}

function createTempTemplateCli(name, mutate) {
    const templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-template-${name}-`));
    copyRecursive(TEMPLATE_CLI_DIR, templateRoot);
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

function runGit(cwd, args, extraEnv = {}) {
    return childProcess.execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...extraEnv },
    }).trim();
}

function getGitShell() {
    const candidates = [
        path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'sh.exe'),
        path.join(process.env.ProgramFiles || '', 'Git', 'usr', 'bin', 'sh.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'sh.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'usr', 'bin', 'sh.exe'),
        'bash',
        'sh',
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (!candidate.includes(path.sep) || fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('No shell executable found for running git hook script');
}

function runPostCommitHook(cwd) {
    return childProcess.execFileSync(getGitShell(), ['.git/hooks/post-commit'], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env },
    }).trim();
}

function createHookTestRepo(name, options = {}) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-hook-test-${name}-`));
    const hookLogPath = path.join(projectRoot, '.evo-lite', 'hook-log.ndjson');
    const findingsPath = path.join(projectRoot, '.evo-lite', 'hook-findings.json');
    const dashboardPath = path.join(projectRoot, '.evo-lite', 'dashboard-built.json');
    const planIR = options.planIR || { version: 'evo-plan-ir@1', tasks: [] };
    const gapsModulePath = JSON.stringify(path.join(WORKSPACE_ROOT, 'templates', 'cli', 'planning', 'gaps.js'));

    writeText(path.join(projectRoot, '.evo-lite', 'cli', 'memory.js'), `
'use strict';
const fs = require('fs');
const path = require('path');

const logPath = ${JSON.stringify(hookLogPath)};
const findingsPath = ${JSON.stringify(findingsPath)};
const dashboardPath = ${JSON.stringify(dashboardPath)};
const entry = { argv: process.argv.slice(2), changed: process.env.EVO_LITE_CHANGED_FILES || null };
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n');

if (entry.argv[0] === 'plan' && entry.argv[1] === 'gaps') {
    const { runPlanningDrift } = require(${gapsModulePath});
    const irPath = path.join(process.cwd(), '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const planIR = fs.existsSync(irPath) ? JSON.parse(fs.readFileSync(irPath, 'utf8')) : null;
    const findings = runPlanningDrift(process.cwd(), planIR, {
        lastCommit: entry.argv.includes('--last-commit'),
        changedFilesFromEnv: entry.argv.includes('--changed-files-from-env'),
    });
    fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2), 'utf8');
}

if (entry.argv[0] === 'dashboard' && entry.argv[1] === 'build') {
    fs.writeFileSync(dashboardPath, JSON.stringify({ built: true, argv: entry.argv }, null, 2), 'utf8');
}
`.trim() + '\n');
    writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify(planIR, null, 2));

    runGit(projectRoot, ['init']);
    runGit(projectRoot, ['config', 'user.name', 'Evo Test']);
    runGit(projectRoot, ['config', 'user.email', 'evo@example.com']);

    const { installPostCommitHook } = require(INIT_ENTRY);
    if (options.installHookBeforeInitialCommit) {
        installPostCommitHook(projectRoot);
        return { projectRoot, hookLogPath, findingsPath, dashboardPath };
    }

    runGit(projectRoot, ['add', '.']);
    runGit(projectRoot, ['commit', '-m', 'chore: baseline']);
    installPostCommitHook(projectRoot);
    return { projectRoot, hookLogPath, findingsPath, dashboardPath };
}

function readNdjson(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
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
        if (typeof options.execSyncImpl === 'function') {
            childProcess.execSync = options.execSyncImpl;
        } else if (options.stubExecSync) {
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
    for (const file of ['runtime.js', 'db.js', 'models.js', 'memory.service.js', 'mcp-detect.js', 'memory.js']) {
        const fullPath = path.join(CLI_DIR, file);
        delete require.cache[fullPath];
        if (fs.existsSync(fullPath)) {
            delete require.cache[require.resolve(fullPath)];
        }
    }
}

function loadCli(runtimeRoot, extraEnv = {}) {
    process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
    process.env.EVO_LITE_ROOT = runtimeRoot;
    process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
    process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;

    for (const key of ['EVO_LITE_FORCE_GIT_DIRTY', 'EVO_LITE_SKIP_GIT_STATUS', 'EVO_LITE_GIT_STATUS', 'EVO_LITE_GIT_STATUS_FILE', 'EVO_LITE_GIT_COMMIT']) {
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
    await loaded.models.initLocalIndexEngine(true);
    const { model, dims } = loaded.models.getActiveEngineInfo();
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

async function runGovernanceTests() {
    console.log('--- Starting governance-focused CLI tests ---');

    try {
        console.log('T13. Testing verify reports governance-operational next steps ...');
        {
            const runtime = createTempRuntimeRoot('verify-governance-guidance');
            const planningDir = path.join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planningDir, { recursive: true });
            fs.writeFileSync(path.join(planningDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1',
                specs: [],
                plans: [],
                tasks: [],
                warnings: [],
            }, null, 2), 'utf8');
            const loaded = await bootstrapRuntime(runtime.runtimeRoot, {
                EVO_LITE_SKIP_GIT_STATUS: '1',
            });
            const output = await captureConsole(async () => {
                await loaded.service.verify();
            });
            assert.ok(output.includes('plan progress'), 'verify should recommend `plan progress` when plan IR exists but progress has not been refreshed');
            assert.ok(output.includes('dashboard build'), 'verify should recommend `dashboard build` when dashboard data has not been built');
            console.log('✅ T13 governance verify guidance passed');
        }

        console.log('T14. Testing post-commit hook writes governance run report ...');
        {
            const repo = createHookTestRepo('hook-report');
            try {
                writeText(path.join(repo.projectRoot, 'src', 'report.js'), 'module.exports = 1;\n');
                runGit(repo.projectRoot, ['add', 'src/report.js']);
                runGit(repo.projectRoot, ['commit', '-m', 'feat: report']);
                runPostCommitHook(repo.projectRoot);
                const reportPath = path.join(repo.projectRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json');
                assert.ok(fs.existsSync(reportPath), 'hook must write last-run governance report');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T14 governance hook telemetry passed');
        }

        console.log('T14a. Testing governance slice covers dashboard freshness relevance rules ...');
        {
            const dashPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'dashboard-data'));
            delete require.cache[dashPath];
            const dashModule = require(dashPath);
            const tmpDashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-governance-fresh-'));
            try {
                const data = dashModule.buildDashboardData(tmpDashRoot);
                assert.ok('freshness' in data, 'dashboard data must have freshness field');
                assert.strictEqual(data.freshness.planStale, false, 'planStale should be false when plan IR is missing');

                const planSource = path.join(tmpDashRoot, 'docs', 'specs', 'feature.md');
                const readme = path.join(tmpDashRoot, 'README.md');
                const planIrPath = path.join(tmpDashRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
                writeText(planSource, '---\nid: spec:feature\n---\n# Feature\n');
                writeText(readme, '# Notes\n');
                writeText(planIrPath, JSON.stringify({ version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [], warnings: [] }, null, 2));

                const oldTime = new Date(Date.now() - 60000);
                const irTime = new Date(Date.now() - 30000);
                const readmeTime = new Date(Date.now() - 5000);
                fs.utimesSync(planSource, oldTime, oldTime);
                fs.utimesSync(planIrPath, irTime, irTime);
                fs.utimesSync(readme, readmeTime, readmeTime);

                const readmeOnlyData = dashModule.buildDashboardData(tmpDashRoot);
                assert.strictEqual(readmeOnlyData.freshness.planStale, false, 'README-only changes must not mark planStale');

                const newerPlanSource = new Date(Date.now() - 1000);
                fs.utimesSync(planSource, newerPlanSource, newerPlanSource);
                const staleData = dashModule.buildDashboardData(tmpDashRoot);
                assert.strictEqual(staleData.freshness.planStale, true, 'newer planning source must mark planStale');
            } finally {
                fs.rmSync(tmpDashRoot, { recursive: true, force: true });
            }
            console.log('✅ T14a dashboard freshness relevance passed');
        }

        console.log('T15. Testing dashboard data surfaces governance runtime status ...');
        {
            const dashPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'dashboard-data'));
            delete require.cache[dashPath];
            const dashModule = require(dashPath);
            const tmpDashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-governance-dash-'));
            try {
                writeText(
                    path.join(tmpDashRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json'),
                    JSON.stringify({
                        event: 'post-commit',
                        commit: 'abc1234',
                        changedFiles: ['src/foo.js'],
                        categories: ['code'],
                        commands: [
                            { name: 'plan progress', ok: true },
                            { name: 'plan gaps', ok: true },
                            { name: 'dashboard build', ok: true },
                        ],
                        ok: true,
                    }, null, 2)
                );
                const data = dashModule.buildDashboardData(tmpDashRoot);
                assert.ok(data.governance, 'dashboard data must include governance runtime status');
                assert.strictEqual(data.governance.status, 'healthy', 'dashboard governance status should classify a clean last run as healthy');
                assert.strictEqual(data.governance.lastRun.exists, true, 'dashboard governance summary should note existing last-run telemetry');
                assert.strictEqual(data.governance.lastRun.ok, true, 'dashboard governance summary should preserve hook success state');
            } finally {
                fs.rmSync(tmpDashRoot, { recursive: true, force: true });
            }
            console.log('✅ T15 dashboard governance summary passed');
        }

        console.log('T15a. Testing installPostCommitHook keeps governance body intact ...');
        {
            const { installPostCommitHook } = require(INIT_ENTRY);
            const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-governance-hook1-'));
            try {
                fs.mkdirSync(path.join(dir1, '.git', 'hooks'), { recursive: true });
                installPostCommitHook(dir1);
                const hook = fs.readFileSync(path.join(dir1, '.git', 'hooks', 'post-commit'), 'utf8');
                assert.ok(hook.includes('# BEGIN evo-lite-hook'), 'hook must contain BEGIN sentinel');
                assert.ok(hook.includes('plan progress'), 'hook must reference plan progress');
                assert.ok(hook.includes('plan gaps --last-commit --changed-files-from-env'), 'hook must evaluate last-commit gaps');
                assert.ok(hook.includes('dashboard build'), 'hook must reference dashboard build');
                const reportWriteIdx = hook.indexOf('HOOK_REPORT_PATH');
                const dashboardBuildIdx = hook.indexOf('run_and_record "dashboard build"');
                assert.ok(reportWriteIdx > 0 && dashboardBuildIdx > 0, 'hook must contain both report write and dashboard build');
                assert.ok(reportWriteIdx < dashboardBuildIdx, 'hook must write post-commit-last-run.json BEFORE dashboard build so the dashboard reflects this commit\'s governance status');
            } finally {
                fs.rmSync(dir1, { recursive: true, force: true });
            }
            console.log('✅ T15a governance hook body passed');
        }

        console.log('T15b. Testing governance slice catches code-only commit gaps ...');
        {
            const repo = createHookTestRepo('governance-code-only', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
            });
            try {
                writeText(path.join(repo.projectRoot, 'src', 'foo.js'), 'module.exports = 1;\n');
                runGit(repo.projectRoot, ['add', 'src/foo.js']);
                runGit(repo.projectRoot, ['commit', '-m', 'feat: add foo']);
                runPostCommitHook(repo.projectRoot);

                const findings = JSON.parse(fs.readFileSync(repo.findingsPath, 'utf8'));
                assert.ok(findings.some(f => f.id === 'R006:src/foo.js'), 'code-only commit should produce an R006 finding for src/foo.js');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T15b code-only commit governance gap passed');
        }

        console.log('T15c. Testing governance slice refreshes plan/progress/dashboard on plan commits ...');
        {
            const repo = createHookTestRepo('governance-plan-refresh', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
            });
            try {
                writeText(
                    path.join(repo.projectRoot, 'docs', 'superpowers', 'plans', '2026-06-16-refresh.md'),
                    '---\nid: plan:refresh\nlinkedSpec: spec:refresh\n---\n# Refresh\n### Task 1: Refresh\n- [x] **Step 1:** done\n'
                );
                runGit(repo.projectRoot, ['add', 'docs/superpowers/plans/2026-06-16-refresh.md']);
                runGit(repo.projectRoot, ['commit', '-m', 'docs: add refresh plan']);
                runPostCommitHook(repo.projectRoot);

                const entries = readNdjson(repo.hookLogPath);
                const commands = entries.map(entry => entry.argv.join(' '));
                assert.ok(commands.includes('plan scan'), 'plan commit should trigger plan scan');
                assert.ok(commands.includes('plan progress'), 'plan commit should trigger plan progress');
                assert.ok(commands.includes('plan gaps --last-commit --changed-files-from-env'), 'plan commit should trigger last-commit gaps');
                assert.ok(commands.includes('dashboard build'), 'plan commit should trigger dashboard build');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T15c plan commit refresh sequence passed');
        }

        console.log('T15d. Testing governance slice sees files in the root commit ...');
        {
            const repo = createHookTestRepo('governance-root-commit', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
                installHookBeforeInitialCommit: true,
            });
            try {
                writeText(path.join(repo.projectRoot, 'src', 'root.js'), 'module.exports = "root";\n');
                runGit(repo.projectRoot, ['add', '.']);
                runGit(repo.projectRoot, ['commit', '-m', 'feat: root commit']);
                runPostCommitHook(repo.projectRoot);

                const findings = JSON.parse(fs.readFileSync(repo.findingsPath, 'utf8'));
                assert.ok(findings.some(f => f.id === 'R006:src/root.js'), 'root commit should still surface src/root.js in R006 findings');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T15d root-commit file detection passed');
        }

        console.log('T16. Testing inspector timeline payload stays stable for operators ...');
        {
            const runtime = createTempRuntimeRoot('timeline-contract');
            const originalRoot = process.env.EVO_LITE_ROOT;
            process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
            const inspectorPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'inspector'));
            delete require.cache[inspectorPath];
            const inspector = require(inspectorPath);
            const handle = await inspector.startServer({ port: 0 });
            try {
                const res = await fetch(`${handle.url.replace(/\/$/, '')}/api/timeline`);
                assert.strictEqual(res.status, 200, '/api/timeline should return 200');
                const timeline = await res.json();
                assert.ok(Array.isArray(timeline.entries), '/api/timeline must return an entries array');
                assert.ok(Array.isArray(timeline.backlog), '/api/timeline must return a backlog array');
                assert.ok(timeline.context && Array.isArray(timeline.context.trajectory), '/api/timeline must embed parsed context payload');
                assert.deepStrictEqual(timeline.entries, timeline.context.trajectory, 'timeline entries should mirror parsed trajectory data');
            } finally {
                await handle.close();
                if (originalRoot == null) {
                    delete process.env.EVO_LITE_ROOT;
                } else {
                    process.env.EVO_LITE_ROOT = originalRoot;
                }
            }
            console.log('✅ T16 inspector timeline contract passed');
        }

        console.log('T17. Testing sync-runtime + lock detects template/runtime drift ...');
        {
            const { syncRuntime, verifyRuntimeLock } = require(path.join(TEMPLATE_CLI_DIR, 'sync-runtime'));
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sync-runtime-'));
            try {
                fs.mkdirSync(path.join(tmpRoot, 'templates', 'cli'), { recursive: true });
                writeText(path.join(tmpRoot, 'templates', 'cli', 'memory.js'), '// template-canonical-v1\n');
                writeText(path.join(tmpRoot, 'templates', 'cli', 'db.js'), '// template-canonical-db\n');

                process.env.EVO_LITE_TEMPLATE_CLI_DIR = path.join(tmpRoot, 'templates', 'cli');
                process.env.EVO_LITE_TEMPLATE_ROOT_DIR = path.join(tmpRoot, 'templates');

                const syncResult = syncRuntime(tmpRoot);
                assert.ok(syncResult.copied.includes('memory.js'), 'sync-runtime should copy memory.js to .evo-lite/cli/');
                assert.ok(syncResult.lockPath, 'sync-runtime should write a lock file');
                assert.ok(fs.existsSync(path.join(tmpRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json')), 'lock file must exist');

                const checkOk = verifyRuntimeLock(tmpRoot);
                assert.strictEqual(checkOk.status, 'ok', 'lock should report ok immediately after sync');

                writeText(path.join(tmpRoot, '.evo-lite', 'cli', 'memory.js'), '// drifted-by-hand\n');
                const checkDrifted = verifyRuntimeLock(tmpRoot);
                assert.strictEqual(checkDrifted.status, 'drifted', 'lock should detect drift after manual edit');
                assert.ok(checkDrifted.mismatches.some(m => m.path.endsWith('memory.js')), 'lock drift report should name memory.js');

                const syncResult2 = syncRuntime(tmpRoot);
                assert.ok(syncResult2.copied.includes('memory.js'), 'second sync should re-copy drifted memory.js');
                const checkAfter = verifyRuntimeLock(tmpRoot);
                assert.strictEqual(checkAfter.status, 'ok', 'lock should return to ok after sync re-runs');
            } finally {
                delete process.env.EVO_LITE_TEMPLATE_CLI_DIR;
                delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T17 sync-runtime + lock drift detection passed');
        }

        console.log('T18. Testing mcp-server freshRequire mtime-invalidates source modules ...');
        {
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mcp-fresh-'));
            try {
                const modPath = path.join(tmpRoot, 'arch-stub.js');
                writeText(modPath, 'module.exports = { moduleCount: 10 };\n');

                const mcpPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'mcp-server'));
                delete require.cache[mcpPath];
                const mcpModule = require(mcpPath);
                const fresh = mcpModule.__freshRequire || null;
                assert.ok(fresh, 'mcp-server must export __freshRequire helper for testing');

                const first = fresh(modPath);
                assert.strictEqual(first.moduleCount, 10, 'first load returns 10');

                const oldMtime = fs.statSync(modPath).mtimeMs;
                writeText(modPath, 'module.exports = { moduleCount: 11 };\n');
                let attempts = 0;
                while (fs.statSync(modPath).mtimeMs <= oldMtime && attempts < 20) {
                    fs.utimesSync(modPath, new Date(), new Date(Date.now() + (++attempts) * 50));
                }

                const second = fresh(modPath);
                assert.strictEqual(second.moduleCount, 11, 'freshRequire must reload after mtime bump (saw stale ' + second.moduleCount + ')');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T18 mcp-server freshRequire passed');
        }

        console.log('T19. Testing architecture where <file> reverse lookup ...');
        {
            const { lookupFile } = require(path.join(TEMPLATE_CLI_DIR, 'architecture'));
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-arch-where-'));
            try {
                const archPath = path.join(tmpRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json');
                writeText(archPath, JSON.stringify({
                    version: 'evo-arch-ir@1',
                    modules: [
                        { id: 'module:cli-entry', name: 'CLI Entry', role: 'entry', fileCount: 1, confidence: 1.0 },
                    ],
                    files: [
                        { path: 'index.js', module: 'module:cli-entry', role: 'entry', confidence: 1.0 },
                        { path: 'foo.txt', module: null, role: 'unknown', confidence: 0 },
                    ],
                    warnings: [],
                }, null, 2));
                const planPath = path.join(tmpRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
                writeText(planPath, JSON.stringify({
                    version: 'evo-plan-ir@1',
                    specs: [], plans: [],
                    tasks: [
                        { id: 'task:foo-1', linkedFiles: ['index.js'], status: 'todo' },
                        { id: 'task:bar-1', linkedFiles: ['unrelated.js'], status: 'todo' },
                    ],
                    warnings: [],
                }, null, 2));

                const hit = lookupFile(tmpRoot, 'index.js');
                assert.strictEqual(hit.status, 'ok');
                assert.strictEqual(hit.module.id, 'module:cli-entry');
                assert.deepStrictEqual(hit.linkedTasks, ['task:foo-1']);

                const unclassified = lookupFile(tmpRoot, 'foo.txt');
                assert.strictEqual(unclassified.status, 'unclassified');

                const missing = lookupFile(tmpRoot, 'no-such-file.js');
                assert.strictEqual(missing.status, 'not-found');

                fs.rmSync(archPath);
                const noIR = lookupFile(tmpRoot, 'index.js');
                assert.strictEqual(noIR.status, 'no-arch-ir');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T19 architecture where reverse lookup passed');
        }

        console.log('T20. Testing context auto-refresh re-derives focus + prunes backlog ...');
        {
            const runtime = createTempRuntimeRoot('autorefresh');
            const planningDir = path.join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planningDir, { recursive: true });
            writeText(path.join(planningDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1',
                specs: [], warnings: [],
                plans: [
                    { id: 'plan:demo', title: 'Demo Plan', status: 'draft', taskIds: ['task:demo-1', 'task:demo-2'] },
                ],
                tasks: [
                    { id: 'task:demo-1', title: 'First task', status: 'todo', linkedPlan: 'plan:demo' },
                    { id: 'task:demo-2', title: 'Second task', status: 'implemented', linkedPlan: 'plan:demo' },
                ],
            }, null, 2));

            // Pre-populate backlog with one stale entry referencing implemented task:demo-2
            writeText(
                path.join(runtime.runtimeRoot, 'active_context.md'),
                '# Active Context\n<!-- BEGIN_META -->\n<!-- END_META -->\n## Focus\n<!-- BEGIN_FOCUS -->\nold focus\n<!-- END_FOCUS -->\n## Backlog\n<!-- BEGIN_BACKLOG -->\n- [ ] [aaaa] task:demo-1 still active\n- [ ] [bbbb] task:demo-2 finished but still listed\n<!-- END_BACKLOG -->\n## Trajectory\n<!-- BEGIN_TRAJECTORY -->\n<!-- END_TRAJECTORY -->\n'
            );

            const loaded = await bootstrapRuntime(runtime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
            const result1 = loaded.service.autoRefreshContext();
            assert.strictEqual(result1.status, 'ok', 'auto-refresh should succeed');
            assert.strictEqual(result1.focusChanged, true, 'focus should change away from "old focus"');
            assert.ok(result1.focusAfter.startsWith('Demo Plan:'), 'focus should be derived from plan title (saw: ' + result1.focusAfter + ')');
            assert.strictEqual(result1.backlogPruned.length, 1, 'should prune exactly one stale backlog item');
            assert.ok(result1.backlogPruned[0].includes('task:demo-2'), 'pruned item should reference task:demo-2');

            const result2 = loaded.service.autoRefreshContext();
            assert.strictEqual(result2.focusChanged, false, 'second call must be idempotent (focus)');
            assert.strictEqual(result2.backlogPruned.length, 0, 'second call must be idempotent (backlog)');

            console.log('✅ T20 context auto-refresh passed');
        }

        console.log('T21. Testing R008 amnesty (r008Exempt frontmatter) + backfill evidence ...');
        {
            const { backfillArchiveEvidence, loadArchiveEvidenceMap } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'backfill-evidence'));
            const { checkR008 } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));

            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-r008-'));
            try {
                // Fixture archives — one references task:foo, one nothing.
                writeText(
                    path.join(tmpRoot, '.evo-lite', 'raw_memory', 'mem_2026-06-16_10-00-00_aaa_111.md'),
                    '---\nid: "aaa_111"\n---\n\nBody mentions task:foo doing things.\n'
                );
                writeText(
                    path.join(tmpRoot, '.evo-lite', 'raw_memory', 'mem_2026-06-16_10-05-00_bbb_222.md'),
                    '---\nid: "bbb_222"\nlinkedTask: task:bar\n---\n\nUnrelated body.\n'
                );
                writeText(
                    path.join(tmpRoot, '.evo-lite', 'raw_memory', 'mem_2026-06-16_10-10-00_ccc_333.md'),
                    '---\nid: "ccc_333"\n---\n\nNo task references.\n'
                );

                const result = backfillArchiveEvidence(tmpRoot);
                assert.strictEqual(result.archivesScanned, 3, 'should scan 3 archives');
                assert.strictEqual(result.archivesMatched, 2, 'should match 2 archives to task ids');
                assert.ok(result.taskIdToArchives['task:foo'], 'task:foo must be in the map');
                assert.ok(result.taskIdToArchives['task:bar'], 'task:bar (from linkedTask frontmatter) must be in the map');

                const map = loadArchiveEvidenceMap(tmpRoot);
                assert.deepStrictEqual(Object.keys(map).sort(), ['task:bar', 'task:foo']);

                // R008 amnesty: planR008Exempt flag suppresses warnings
                const findingsExempt = checkR008({
                    tasks: [
                        { id: 'task:old', status: 'implemented', evidence: [], readOnly: false, planR008Exempt: true },
                    ],
                });
                assert.strictEqual(findingsExempt.length, 0, 'planR008Exempt should suppress R008 finding');

                // R008 fires normally when not exempt and no evidence
                const findingsNormal = checkR008({
                    tasks: [
                        { id: 'task:new', status: 'implemented', evidence: [], readOnly: false, planR008Exempt: false },
                    ],
                });
                assert.strictEqual(findingsNormal.length, 1, 'R008 should still fire on non-exempt tasks without evidence');

                // R008 also satisfied by backfilled archive evidence
                const findingsBackfilled = checkR008({
                    tasks: [
                        { id: 'task:foo', status: 'implemented', evidence: ['archive:mem_2026-06-16_10-00-00_aaa_111.md'], readOnly: false, planR008Exempt: false },
                    ],
                });
                assert.strictEqual(findingsBackfilled.length, 0, 'backfilled archive evidence should satisfy R008');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T21 R008 amnesty + archive backfill passed');
        }

        console.log('T22. Testing hook diff detects drift + hook last parses report ...');
        {
            const { installPostCommitHook, diffInstalledHook } = require(INIT_ENTRY);
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook-diff-'));
            try {
                fs.mkdirSync(path.join(tmpRoot, '.git', 'hooks'), { recursive: true });
                installPostCommitHook(tmpRoot);

                const fresh = diffInstalledHook(tmpRoot);
                assert.strictEqual(fresh.status, 'in-sync', 'freshly installed hook should be in-sync');

                const hookPath = path.join(tmpRoot, '.git', 'hooks', 'post-commit');
                const mutated = fs.readFileSync(hookPath, 'utf8').replace('dashboard build', 'dashboard build  # operator manual drift');
                fs.writeFileSync(hookPath, mutated);
                const drifted = diffInstalledHook(tmpRoot);
                assert.strictEqual(drifted.status, 'drifted', 'manual edit should be detected as drift');
                assert.ok(drifted.text.includes('expected') && drifted.text.includes('installed'), 'diff text should label both sides');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T22 hook diff drift detection passed');
        }

        console.log('T23. Testing plan new scaffolds spec + plan stubs ...');
        {
            const { scaffoldPlanStubs } = require(path.join(TEMPLATE_CLI_DIR, 'planning'));
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-plan-new-'));
            try {
                const result = scaffoldPlanStubs(tmpRoot, 'My Test-Feature!', false);
                assert.ok(result.specPath.endsWith('-my-test-feature.md'), 'spec path should use sanitized slug');
                assert.ok(result.planPath.endsWith('-my-test-feature.md'), 'plan path should use sanitized slug');
                const planAbs = path.join(tmpRoot, result.planPath);
                const specAbs = path.join(tmpRoot, result.specPath);
                assert.ok(fs.existsSync(planAbs), 'plan file written');
                assert.ok(fs.existsSync(specAbs), 'spec file written');
                const planContent = fs.readFileSync(planAbs, 'utf8');
                assert.ok(planContent.includes('### Task 1: TODO'), 'plan stub contains a Task 1 heading the parser will pick up');
                assert.ok(planContent.includes('id: plan:my-test-feature'), 'plan frontmatter has id satisfying lint');
                assert.ok(planContent.includes('linkedSpec: spec:my-test-feature'), 'plan frontmatter links spec');
                const specContent = fs.readFileSync(specAbs, 'utf8');
                assert.ok(specContent.includes('id: spec:my-test-feature'), 'spec frontmatter has id');

                // Calling again should be no-op (files already exist)
                const before = fs.readFileSync(planAbs, 'utf8');
                scaffoldPlanStubs(tmpRoot, 'My Test-Feature!', false);
                const after = fs.readFileSync(planAbs, 'utf8');
                assert.strictEqual(before, after, 'plan new should not overwrite existing files');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T23 plan new scaffold passed');
        }

        console.log('--- Governance-focused CLI tests passed! ---');
    } catch (error) {
        console.error('❌ Governance test failed:', error);
        process.exit(1);
    }
}

async function runTests() {
    if (!shouldRun('governance')) {
        console.error(`Unknown test scope: ${TEST_SCOPE}`);
        process.exit(1);
    }

    if (TEST_SCOPE === 'governance') {
        await runGovernanceTests();
        return;
    }

    console.log('--- Starting CLI integration tests ---');

    try {
        console.log('T8. Testing archiveHits finds task ID in file content ...');
        {
            const progressPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'progress.js');
            delete require.cache[require.resolve(progressPath)];
            const progress = require(progressPath);
            assert.strictEqual(typeof progress.checkArchiveHits, 'function', 'checkArchiveHits not exported from progress.js');

            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-archivehit-'));
            try {
                const rawDir = path.join(tmpRoot, '.evo-lite', 'raw_memory');
                fs.mkdirSync(rawDir, { recursive: true });

                // File with task ID in content — should be counted
                fs.writeFileSync(
                    path.join(rawDir, 'mem_20260616_abc123_xyz.md'),
                    'Completed work on task:dashboard-builder. Evidence: all tests pass.'
                );
                // File with slug (without prefix) — should also be counted
                fs.writeFileSync(
                    path.join(rawDir, 'mem_20260616_def456_uvw.md'),
                    'Finished dashboard-builder implementation.'
                );
                // Unrelated file — should NOT be counted
                fs.writeFileSync(
                    path.join(rawDir, 'mem_20260616_ghi789_rst.md'),
                    'Completed some other work on task:other-feature.'
                );

                const hits = progress.checkArchiveHits('task:dashboard-builder', tmpRoot);
                assert.strictEqual(hits, 2, `Expected 2 hits, got ${hits}`);
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T8 archiveHits finds content matches passed');
        }

        console.log('T2. Testing createTempTemplateCli copies cli subdirs ...');
        {
            let tempCliRoot;
            try {
                tempCliRoot = createTempTemplateCli('subdir-check');
            } catch (e) {
                assert.fail(`createTempTemplateCli threw: ${e.message}`);
            }
            assert.ok(fs.existsSync(path.join(tempCliRoot, 'planning')), 'planning/ missing in temp template cli');
            assert.ok(fs.existsSync(path.join(tempCliRoot, 'architecture')), 'architecture/ missing in temp template cli');
            fs.rmSync(tempCliRoot, { recursive: true, force: true });
            console.log('✅ T2 createTempTemplateCli copies subdirs passed');
        }

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

        console.log('1aa. Testing FTS fallback can recover raw_memory rows without index markers ...');
        const fallbackRuntime = createTempRuntimeRoot('fts-fallback');
        const fallbackLoaded = await bootstrapRuntime(fallbackRuntime.runtimeRoot);
        const fallbackOnlyContent = 'FTS fallback should surface this raw-only memory fragment even if no index marker exists for it.';
        const fallbackInsert = fallbackLoaded.db.getDb()
            .prepare('INSERT INTO raw_memory (content, namespace, timestamp) VALUES (?, ?, ?)')
            .run(fallbackOnlyContent, 'prose', new Date().toISOString());
        const fallbackResults = await fallbackLoaded.service.recall('raw-only memory fragment');
        assert.ok(fallbackResults.some(item => item.id === Number(fallbackInsert.lastInsertRowid)), 'FTS fallback did not surface the raw-only memory row');
        assert.ok(fallbackResults.some(item => item.match_source === 'fts'), 'FTS fallback should label trigram-based matches');

        console.log('1a. Testing P0 namespace isolation ...');
        const nsDb = primaryLoaded.db.getDb();
        assert.ok(primaryLoaded.db.tableExists(nsDb, 'raw_memory_fts'), 'raw_memory_fts table should exist after first remember');
        const proseRowCount = nsDb.prepare("SELECT COUNT(*) AS c FROM raw_memory WHERE namespace = 'prose'").get().c;
        assert.ok(proseRowCount > 0, 'prose namespace should contain the remembered record');
        primaryLoaded.db.ensureNamespaceTables(nsDb, 'code', primaryLoaded.models.getActiveEngineInfo().model, primaryLoaded.models.getActiveEngineInfo().dims);
        const namespaceCounts = primaryLoaded.db.getNamespaceCounts(nsDb);
        assert.ok(namespaceCounts.code.present, 'code namespace should be registered after ensureNamespaceTables');
        const codeRowCount = nsDb.prepare("SELECT COUNT(*) AS c FROM raw_memory WHERE namespace = 'code'").get().c;
        assert.strictEqual(codeRowCount, 0, 'code namespace should start empty');
        const proseRowCountAfter = nsDb.prepare("SELECT COUNT(*) AS c FROM raw_memory WHERE namespace = 'prose'").get().c;
        assert.strictEqual(proseRowCountAfter, proseRowCount, 'creating code ns must not disturb prose ns');

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

        console.log('T6. Testing R008 fires on verified tasks with no evidence ...');
        {
            const gapsPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps.js');
            delete require.cache[require.resolve(gapsPath)];
            const gaps = require(gapsPath);
            assert.strictEqual(typeof gaps.checkR008, 'function', 'checkR008 not exported from gaps.js');

            const planIR = {
                tasks: [
                    { id: 'task:foo', title: 'Foo', status: 'verified', readOnly: false, evidence: [], linkedFiles: [] },
                    { id: 'task:bar', title: 'Bar', status: 'implemented', readOnly: false, evidence: ['git:abc123'], linkedFiles: ['src/bar.js'] },
                    { id: 'task:baz', title: 'Baz', status: 'in-progress', readOnly: false, evidence: [], linkedFiles: [] },
                    { id: 'task:qux', title: 'Qux', status: 'implemented', readOnly: false, evidence: ['archive:2026-06-16T10-00-00Z'], linkedFiles: [] },
                ],
            };

            const findings = gaps.checkR008(planIR);
            const ids = findings.map(f => f.id);
            assert.ok(ids.some(id => id.includes('task:foo')), 'R008 did not fire on verified task:foo');
            assert.ok(ids.some(id => id.includes('task:bar')), 'R008 did not fire on implemented task:bar');
            assert.ok(!ids.some(id => id.includes('task:baz')), 'R008 should NOT fire on in-progress task:baz');
            assert.ok(!ids.some(id => id.includes('task:qux')), 'R008 should NOT fire when archive evidence exists');
            console.log('✅ T6 R008 fires on verified tasks passed');
        }

        console.log('T7. Testing R009 detects nested source file changes ...');
        {
            const gapsPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps.js');
            delete require.cache[require.resolve(gapsPath)];
            const gaps = require(gapsPath);
            assert.strictEqual(typeof gaps.checkR009, 'function', 'checkR009 not exported from gaps.js');

            // Set up a minimal temp project structure
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-r009-'));
            try {
                // Create architecture IR (old timestamp)
                const genDir = path.join(tmpRoot, '.evo-lite', 'generated', 'architecture');
                fs.mkdirSync(genDir, { recursive: true });
                const irPath = path.join(genDir, 'architecture-ir.json');
                fs.writeFileSync(irPath, '{}');

                // Make the IR appear OLD
                const oldTime = new Date(Date.now() - 10000);
                fs.utimesSync(irPath, oldTime, oldTime);

                // Create a nested source file NEWER than the IR
                const nestedSource = path.join(tmpRoot, 'templates', 'cli', 'planning', 'scan.js');
                fs.mkdirSync(path.dirname(nestedSource), { recursive: true });
                fs.writeFileSync(nestedSource, '// updated');
                // nestedSource mtime is now (newer than IR)

                const findings = gaps.checkR009(tmpRoot);
                const r009Arch = findings.filter(f => f.id && f.id.startsWith('R009:architecture'));
                assert.ok(r009Arch.length > 0, 'R009 did not fire — nested templates/cli/planning/scan.js change not detected');
            } finally {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T7 R009 detects nested source changes passed');
        }

        console.log('T4. Testing template manifest covers all cli modules ...');
        {
            const manifestPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            delete require.cache[manifestPath];
            const { MANAGED_TEMPLATE_FAMILIES } = require(manifestPath);
            const coreCliFamily = MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
            assert.ok(coreCliFamily, 'core-cli family not found in manifest');

            const required = [
                'planning.js', 'architecture.js', 'dashboard-data.js',
                'mcp-server.js', 'mcp-validate.js', 'test.js',
                'planning/gaps.js', 'planning/parse-markdown.js', 'planning/progress.js',
                'planning/scan.js', 'planning/traceability.js',
                'architecture/diff.js', 'architecture/infer-modules.js',
                'architecture/provider-contract.js', 'architecture/scan-native.js',
            ];

            for (const f of required) {
                assert.ok(coreCliFamily.files.includes(f), `core-cli manifest missing: ${f}`);
            }
            console.log('✅ T4 manifest covers all cli modules passed');
        }

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
        const contextAfterAdd = fs.readFileSync(path.join(primary.runtimeRoot, 'active_context.md'), 'utf8');
        assert.ok(!contextAfterAdd.includes('- [ ] 暂无活跃任务。'), 'context add should replace the empty backlog placeholder');
        assert.ok(contextAfterAdd.includes(`[${addResult.hash}] Finish the protocol restore follow-up task`), 'context add did not persist the new backlog task');
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

        console.log('2a. Testing context read / summary / validate ...');
        const contextSnapshot = primaryLoaded.service.readActiveContext();
        assert.strictEqual(contextSnapshot.path, path.join(primary.runtimeRoot, 'active_context.md'), 'context read returned the wrong active_context path');
        assert.strictEqual(contextSnapshot.validation.valid, true, 'fresh template context should validate structurally');
        assert.ok(contextSnapshot.validation.anchors.includes('META'), 'context validation missed META anchor');
        assert.ok(contextSnapshot.sections.focus.includes('尚未确定当前焦点'), 'context read did not expose the FOCUS section');
        assert.ok(contextSnapshot.summary.latestTrajectory.line.includes('ProtocolRestore'), 'context read did not parse the latest trajectory entry');
        assert.ok(contextSnapshot.tasks.some(task => task.hash === 'a1b2'), 'context read did not parse backlog task hashes');

        const contextSummary = primaryLoaded.service.summarizeActiveContext();
        assert.strictEqual(contextSummary.validation.valid, true, 'context summary should include validation state');
        assert.ok(contextSummary.activeTasks.length >= 1, 'context summary did not include active backlog tasks');
        assert.ok(contextSummary.latestTrajectory.line.includes('ProtocolRestore'), 'context summary did not include latest trajectory');

        const contextValidation = primaryLoaded.service.validateActiveContextFile();
        assert.strictEqual(contextValidation.valid, true, 'context validate should pass for the template-shaped context');
        assert.ok(
            contextValidation.warnings.some(warning => warning.includes('initialization placeholder')),
            'context validate should warn about initialization placeholders without failing structure validation'
        );

        console.log('2b. Testing MCP detection ...');
        writeText(path.join(primary.workspaceRoot, '.vscode', 'mcp.json'), JSON.stringify({
            servers: {
                gitnexus: { command: 'docker', args: ['run', 'gitnexus:local'] },
                contextModeCreateEvoLite: { command: 'docker', args: ['run', 'mcp-context-mode:local'] },
            },
        }, null, 2));
        const mcpDetect = require(path.join(CLI_DIR, 'mcp-detect.js'));
        const mcpReport = mcpDetect.detectMcpCapabilities({ workspaceRoot: primary.workspaceRoot });
        assert.strictEqual(mcpReport.serverCount, 2, 'mcp detect did not find configured workspace MCP servers');
        assert.ok(mcpReport.servers.some(server => server.category === 'code-intelligence'), 'mcp detect did not classify GitNexus');
        assert.ok(mcpReport.servers.some(server => server.category === 'context-tools'), 'mcp detect did not classify context-mode');
        assert.ok(mcpDetect.formatMcpReport(mcpReport, { explain: true }).includes('代码图谱'), 'mcp explain report missed recommended usage text');

        console.log('2ba. Testing hook scaffold inspection ...');
        const hookReport = primaryLoaded.service.inspectHookScaffold();
        assert.strictEqual(hookReport.valid, true, 'hook scaffold inspection should pass for the template-shaped workspace');
        assert.strictEqual(hookReport.missing.length, 0, 'hook scaffold inspection should not report missing assets for the template-shaped workspace');
        assert.ok(hookReport.assets.some(asset => asset.label === '.github/copilot-instructions.md' && asset.exists), 'hook scaffold inspection did not include the Copilot bootstrap instructions asset');
        assert.ok(hookReport.assets.some(asset => asset.label === '.github/hooks/evo-lite.json' && asset.exists), 'hook scaffold inspection did not include the GitHub hook registry asset');
        assert.ok(hookReport.assets.some(asset => asset.label === '.github/hooks/evo-lite-hook.js' && asset.exists), 'hook scaffold inspection did not include the lifecycle advice hook wrapper');
        assert.ok(hookReport.assets.some(asset => asset.label === '.github/hooks/evo-lite-codex-stop-hook.js' && asset.exists), 'hook scaffold inspection did not include the Codex stop hook wrapper');
        assert.ok(hookReport.assets.some(asset => asset.label === '.github/hooks/dogfood-commit-hook.js' && asset.exists), 'hook scaffold inspection did not include the dogfood guard hook wrapper');
        assert.ok(hookReport.assets.some(asset => asset.label === '.codex/hooks.json' && asset.exists), 'hook scaffold inspection did not include the Evo-Lite Codex hook manifest');
        assert.ok(!hookReport.assets.some(asset => asset.label === '.vscode/mcp.json'), 'hook scaffold inspection should not treat workspace MCP config as an Evo-Lite-managed asset');
        const missingHookRuntime = createTempRuntimeRoot('hook-missing');
        const missingHookLoaded = loadCli(missingHookRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
        });
        fs.unlinkSync(path.join(missingHookRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js'));
        const missingHookReport = missingHookLoaded.service.inspectHookScaffold();
        assert.strictEqual(missingHookReport.valid, false, 'hook scaffold inspection should fail when a required hook asset is missing');
        assert.ok(missingHookReport.missing.includes('.github/hooks/evo-lite-hook.js'), 'hook scaffold inspection did not report the missing lifecycle advice hook wrapper');

        console.log('2bb. Testing hook scaffold install ...');
        const installHookRuntime = createTempRuntimeRoot('hook-install');
        const installHookLoaded = loadCli(installHookRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
        });
        fs.unlinkSync(path.join(installHookRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js'));
        const installHookResult = installHookLoaded.service.installHookScaffold();
        assert.ok(installHookResult.installed.includes('.github/hooks/evo-lite-hook.js'), 'hook scaffold install did not restore a missing lifecycle advice hook wrapper');
        assert.ok(fs.existsSync(path.join(installHookRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js')), 'hook scaffold install did not recreate the missing lifecycle advice hook wrapper');
        const installInstructionsPath = path.join(installHookRuntime.workspaceRoot, '.github', 'copilot-instructions.md');
        const externalMcpConfigPath = path.join(installHookRuntime.workspaceRoot, '.vscode', 'mcp.json');
        fs.writeFileSync(installInstructionsPath, '# mutated\n', 'utf8');
        fs.writeFileSync(externalMcpConfigPath, '{"mutated":true}\n', 'utf8');
        const forceInstallResult = installHookLoaded.service.installHookScaffold({ force: true });
        assert.ok(forceInstallResult.overwritten.includes('.github/copilot-instructions.md'), 'hook scaffold install --force did not overwrite an existing managed asset');
        assert.ok(fs.existsSync(`${installInstructionsPath}.bak`), 'hook scaffold install --force did not create a backup before overwriting');
        assert.ok(!forceInstallResult.overwritten.includes('.vscode/mcp.json'), 'hook scaffold install --force should not overwrite unmanaged MCP config assets');
        assert.strictEqual(fs.readFileSync(externalMcpConfigPath, 'utf8'), '{"mutated":true}\n', 'hook scaffold install unexpectedly rewrote an unmanaged MCP config asset');

        console.log('2bc. Testing hook lifecycle advice ...');
        const lifecycleRuntime = createTempRuntimeRoot('hook-lifecycle');
        const lifecycleLoaded = await bootstrapRuntime(lifecycleRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_GIT_COMMIT: 'aaa1111',
        });
        await lifecycleLoaded.service.track('LifecycleBaseline', 'Baseline track entry before simulating a newer commit.');
        const postCommitLoaded = loadCli(lifecycleRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
            EVO_LITE_GIT_COMMIT: 'bbb2222',
        });
        const postCommitAdvice = postCommitLoaded.service.inspectHookLifecycle('posttooluse', { tool: 'git.commit' });
        assert.strictEqual(postCommitAdvice.trackNeedsUpdate, true, 'hook lifecycle advice should detect when the latest commit has not been tracked yet');
        assert.ok(postCommitAdvice.reminders.some(reminder => reminder.includes('context track')), 'hook lifecycle advice did not remind about running context track after a commit');
        const partialClosureAdvice = postCommitLoaded.service.inspectHookLifecycle('posttooluse', {
            command: 'git commit -m "test" && node .evo-lite/cli/memory.js context track --mechanism="Lifecycle" --details="Attempted closure"',
            output: 'context track failed after commit',
            tool: 'terminal.run',
        });
        assert.ok(partialClosureAdvice.reminders.some(reminder => reminder.includes('返回失败')), 'hook lifecycle advice did not surface a failed closure command');
        assert.ok(partialClosureAdvice.reminders.some(reminder => reminder.includes('尝试执行 context track')), 'hook lifecycle advice did not detect an attempted-but-incomplete context track step');
        writeText(
            path.join(lifecycleRuntime.workspaceRoot, '.agents', 'rules', 'architecture.md'),
            fs.readFileSync(path.join(TEMPLATE_ROOT_DIR, '.agents', 'rules', 'architecture.md'), 'utf8')
        );
        const blockedPretoolAdvice = postCommitLoaded.service.inspectHookLifecycle('pretooluse', { tool: 'apply_patch' });
        assert.strictEqual(blockedPretoolAdvice.blocked, true, 'pretooluse should block implementation work when architecture.md is still placeholder content');
        assert.ok(blockedPretoolAdvice.reminders.some(reminder => reminder.includes('架构尚未锁定')), 'pretooluse did not explain the architecture lock blocker');
        const architectureBootstrapAdvice = postCommitLoaded.service.inspectHookLifecycle('pretooluse', {
            tool: 'apply_patch',
            targets: ['.agents/rules/architecture.md'],
        });
        assert.strictEqual(architectureBootstrapAdvice.blocked, false, 'pretooluse should allow editing architecture.md while architecture.md is still placeholder content');
        const architectureDirAdvice = postCommitLoaded.service.inspectHookLifecycle('pretooluse', {
            tool: 'create_directory',
            targets: ['.agents/rules'],
        });
        assert.strictEqual(architectureDirAdvice.blocked, false, 'pretooluse should allow creating the architecture rules directory before architecture is locked');
        const readOnlyPretoolAdvice = postCommitLoaded.service.inspectHookLifecycle('pretooluse', { tool: 'read_file' });
        assert.strictEqual(readOnlyPretoolAdvice.blocked, false, 'pretooluse should not block read-only work when architecture is unlocked');
        copyRecursive(TEMPLATE_CLI_DIR, path.join(lifecycleRuntime.runtimeRoot, 'cli'));
        const blockedPretoolWrapperResult = childProcess.spawnSync(
            process.execPath,
            [path.join(lifecycleRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js'), 'pretooluse'],
            {
                cwd: lifecycleRuntime.workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    EVO_LITE_GIT_COMMIT: 'bbb2222',
                    EVO_LITE_GIT_STATUS: '',
                    EVO_LITE_ROOT: lifecycleRuntime.runtimeRoot,
                    EVO_LITE_TEMPLATE_ROOT_DIR: TEMPLATE_ROOT_DIR,
                    NODE_PATH: [path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
                },
                input: JSON.stringify({
                    hookEventName: 'PreToolUse',
                    tool_name: 'apply_patch',
                    tool_input: {
                        filePath: 'index.js',
                    },
                    tool_use_id: 'tool-pre-1',
                }),
            }
        );
        assert.strictEqual(blockedPretoolWrapperResult.status, 2, `official PreToolUse payload wrapper should block implementation before architecture lock: ${blockedPretoolWrapperResult.stderr}`);
        const blockedPretoolWrapperOutput = `${blockedPretoolWrapperResult.stdout || ''}${blockedPretoolWrapperResult.stderr || ''}`;
        assert.ok(blockedPretoolWrapperOutput.includes('blocked: yes'), `wrapper did not surface the blocked state: ${blockedPretoolWrapperOutput}`);
        assert.ok(blockedPretoolWrapperOutput.includes('架构尚未锁定'), `wrapper did not surface the architecture blocker: ${blockedPretoolWrapperOutput}`);
        const architecturePretoolWrapperResult = childProcess.spawnSync(
            process.execPath,
            [path.join(lifecycleRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js'), 'pretooluse'],
            {
                cwd: lifecycleRuntime.workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    EVO_LITE_GIT_COMMIT: 'bbb2222',
                    EVO_LITE_GIT_STATUS: '',
                    EVO_LITE_ROOT: lifecycleRuntime.runtimeRoot,
                    EVO_LITE_TEMPLATE_ROOT_DIR: TEMPLATE_ROOT_DIR,
                    NODE_PATH: [path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
                },
                input: JSON.stringify({
                    hookEventName: 'PreToolUse',
                    tool_name: 'apply_patch',
                    tool_input: {
                        input: '*** Begin Patch\n*** Update File: .agents/rules/architecture.md\n*** End Patch',
                    },
                    tool_use_id: 'tool-pre-architecture',
                }),
            }
        );
        assert.strictEqual(architecturePretoolWrapperResult.status, 0, `official PreToolUse payload wrapper should allow architecture bootstrap edits before architecture lock: ${architecturePretoolWrapperResult.stderr}`);
        const architecturePretoolWrapperOutput = `${architecturePretoolWrapperResult.stdout || ''}${architecturePretoolWrapperResult.stderr || ''}`;
        assert.ok(architecturePretoolWrapperOutput.includes('blocked: no'), `wrapper did not allow the architecture bootstrap edit: ${architecturePretoolWrapperOutput}`);
        const wrapperResult = childProcess.spawnSync(
            process.execPath,
            [path.join(lifecycleRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-hook.js'), 'posttooluse'],
            {
                cwd: lifecycleRuntime.workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    EVO_LITE_GIT_COMMIT: 'bbb2222',
                    EVO_LITE_GIT_STATUS: '',
                    EVO_LITE_ROOT: lifecycleRuntime.runtimeRoot,
                    EVO_LITE_TEMPLATE_ROOT_DIR: TEMPLATE_ROOT_DIR,
                    NODE_PATH: [path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
                },
                input: JSON.stringify({
                    hookEventName: 'PostToolUse',
                    tool_name: 'runTerminalCommand',
                    tool_input: {
                        command: 'git commit -m "test" && node .evo-lite/cli/memory.js context track --mechanism="Lifecycle" --details="Attempted closure"',
                    },
                    tool_response: 'context track failed after commit',
                    tool_use_id: 'tool-123',
                }),
            }
        );
        assert.strictEqual(wrapperResult.status, 0, `official PostToolUse payload wrapper exited with ${wrapperResult.status}: ${wrapperResult.stderr}`);
        const wrapperOutput = `${wrapperResult.stdout || ''}${wrapperResult.stderr || ''}`;
        assert.ok(wrapperOutput.includes('tool: runTerminalCommand'), `wrapper did not parse the official tool_name field: ${wrapperOutput}`);
        assert.ok(wrapperOutput.includes('command: git commit -m') && wrapperOutput.includes('context track'), `wrapper did not parse the official tool_input.command field: ${wrapperOutput}`);
        assert.ok(wrapperOutput.includes('返回失败'), `wrapper did not surface failure based on official tool_response text: ${wrapperOutput}`);
        const lifecycleProvenance = readNdjson(path.join(lifecycleRuntime.runtimeRoot, 'provenance', 'steps.ndjson'));
        assert.ok(lifecycleProvenance.some(entry =>
            entry.event === 'posttooluse'
            && entry.transport === 'shared-hook'
            && entry.tool === 'runTerminalCommand'
            && typeof entry.command === 'string'
            && entry.command.includes('context track')
        ), `shared hook did not append a provenance record for posttooluse: ${JSON.stringify(lifecycleProvenance, null, 2)}`);

        const configuredPretoolRuntime = createTempRuntimeRoot('hook-pretool-configured');
        writeText(
            path.join(configuredPretoolRuntime.workspaceRoot, '.agents', 'rules', 'architecture.md'),
            '# PROJECT ARCHITECTURE & STANDARDS\n\n- Language: Node.js\n- Framework/runtime: CLI + templates\n- Package manager: npm\n- Storage/retrieval: sqlite-fts5-trigram\n'
        );
        const configuredPretoolLoaded = loadCli(configuredPretoolRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
            EVO_LITE_GIT_COMMIT: 'ddd4444',
        });
        const configuredPretoolAdvice = configuredPretoolLoaded.service.inspectHookLifecycle('pretooluse', { tool: 'apply_patch' });
        assert.strictEqual(configuredPretoolAdvice.blocked, false, 'pretooluse should allow implementation after architecture.md is configured');

        const stopRuntime = createTempRuntimeRoot('hook-stop');
        const stopLoaded = loadCli(stopRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: ' M package.json',
            EVO_LITE_GIT_COMMIT: 'ccc3333',
        });
        const stopStaleDate = new Date(Date.now() - (48 * 60 * 60 * 1000));
        fs.utimesSync(path.join(stopRuntime.runtimeRoot, 'active_context.md'), stopStaleDate, stopStaleDate);
        const stopAdvice = stopLoaded.service.inspectHookLifecycle('stop');
        assert.ok(stopAdvice.reminders.some(reminder => reminder.includes('未提交')), 'hook lifecycle stop advice did not warn about dirty git state');
        assert.ok(stopAdvice.reminders.some(reminder => reminder.includes('24 小时')), 'hook lifecycle stop advice did not warn about stale active_context');
        assert.ok(stopAdvice.reminders.some(reminder => reminder.includes('release/tag/CHANGELOG')), 'hook lifecycle stop advice did not warn about release closure after version-file changes');
        writeText(
            path.join(stopRuntime.runtimeRoot, 'cli', 'memory.js'),
            `process.stdout.write(JSON.stringify({
                reminders: [
                    '检测到最新 commit 尚未写入 TRAJECTORY；请执行 context track 完成闭环。',
                    '工作区仍有未提交的非 .evo-lite 改动；结束前请确认是否需要提交。'
                ],
                warnings: ['git status unavailable in the current Node environment']
            }));`
        );
        const stopWrapperResult = childProcess.spawnSync(
            process.execPath,
            [path.join(stopRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-codex-stop-hook.js')],
            {
                cwd: stopRuntime.workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    EVO_LITE_GIT_COMMIT: 'ccc3333',
                    EVO_LITE_GIT_STATUS: ' M package.json',
                },
            }
        );
        assert.strictEqual(stopWrapperResult.status, 0, `Codex stop wrapper exited with ${stopWrapperResult.status}: ${stopWrapperResult.stderr}`);
        assert.strictEqual(
            (stopWrapperResult.stdout || '').trim(),
            '{"decision":"accept"}',
            `Codex stop wrapper stdout should contain only the compact decision JSON: ${stopWrapperResult.stdout}`
        );
        assert.deepStrictEqual(
            JSON.parse((stopWrapperResult.stdout || '').trim()),
            { decision: 'accept' },
            `Codex stop wrapper did not return valid decision JSON: ${stopWrapperResult.stdout}`
        );
        assert.ok(
            (stopWrapperResult.stderr || '').includes('[evo-lite stop]'),
            `Codex stop wrapper did not surface stop reminders on stderr: ${stopWrapperResult.stderr}`
        );
        assert.ok(
            (stopWrapperResult.stderr || '').includes('未提交'),
            `Codex stop wrapper stderr did not include dirty-worktree reminder: ${stopWrapperResult.stderr}`
        );
        const stopProvenance = readNdjson(path.join(stopRuntime.runtimeRoot, 'provenance', 'steps.ndjson'));
        assert.ok(stopProvenance.some(entry =>
            entry.event === 'stop'
            && entry.transport === 'codex-stop'
            && entry.decision === 'accept'
            && Array.isArray(entry.reminders)
            && entry.reminders.some(reminder => reminder.includes('TRAJECTORY'))
        ), `Codex stop wrapper did not append a provenance record: ${JSON.stringify(stopProvenance, null, 2)}`);

        const stopBrokenRuntime = createTempRuntimeRoot('hook-stop-bad-json');
        writeText(
            path.join(stopBrokenRuntime.runtimeRoot, 'cli', 'memory.js'),
            'process.stdout.write("not-json"); process.stderr.write("broken stderr");'
        );
        const stopBrokenResult = childProcess.spawnSync(
            process.execPath,
            [path.join(stopBrokenRuntime.workspaceRoot, '.github', 'hooks', 'evo-lite-codex-stop-hook.js')],
            {
                cwd: stopBrokenRuntime.workspaceRoot,
                encoding: 'utf8',
            }
        );
        assert.strictEqual(stopBrokenResult.status, 0, `Codex stop wrapper should accept malformed stop advice output: ${stopBrokenResult.stderr}`);
        assert.strictEqual(
            (stopBrokenResult.stdout || '').trim(),
            '{"decision":"accept"}',
            `Codex stop wrapper should fall back to clean accept JSON when stop advice stdout is malformed: ${stopBrokenResult.stdout}`
        );
        assert.strictEqual(
            (stopBrokenResult.stderr || '').trim(),
            '',
            `Codex stop wrapper should not leak malformed stop advice to stderr without debug mode: ${stopBrokenResult.stderr}`
        );

        console.log('2c. Testing context track bootstraps a fresh init runtime ...');
        const freshTrackRuntime = createTempRuntimeRoot('fresh-track');
        const freshTrackLoaded = loadCli(freshTrackRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
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

        console.log('2d. Testing commit fast path ...');
        const commitFlowRuntime = createTempRuntimeRoot('commit-flow');
        writeText(path.join(commitFlowRuntime.workspaceRoot, 'src', 'feature.js'), 'module.exports = true;\n');
        const commitFastPathCommands = [];
        let commitFastPathPhase = 'staged';
        const commitFlowExecFileSync = childProcess.execFileSync;
        await withPatchedExecFileSync((command, args, options) => {
            if (command !== 'git') {
                return commitFlowExecFileSync(command, args, options);
            }
            commitFastPathCommands.push(args.join(' '));
            if (args[0] === 'status' && args[1] === '--porcelain') {
                return commitFastPathPhase === 'staged' ? 'M  src/feature.js\n' : '';
            }
            if (args[0] === 'commit' && args[1] === '-m' && args[2] === 'feat(runtime): add commit fast path') {
                commitFastPathPhase = 'code';
                return '[main abc1111] feat(runtime): add commit fast path\n';
            }
            if (args[0] === 'rev-parse' && args[1] === '--short' && args[2] === 'HEAD') {
                return commitFastPathPhase === 'meta' ? 'def2222' : 'abc1111';
            }
            if (args[0] === 'add' && args[1] === '--') {
                return '';
            }
            if (args[0] === 'commit' && args[1] === '-m' && args[2] === 'chore(meta): snapshot evo-lite runtime state') {
                commitFastPathPhase = 'meta';
                return '[main def2222] chore(meta): snapshot evo-lite runtime state\n';
            }
            throw new Error(`UNEXPECTED_GIT:${args.join(' ')}`);
        }, async () => {
            const commitFlowLoaded = await bootstrapRuntime(commitFlowRuntime.runtimeRoot, {
                EVO_LITE_GIT_COMMIT: 'base0001',
                EVO_LITE_GIT_STATUS: 'M  src/feature.js\n',
            });
            const backlogTask = commitFlowLoaded.service.addTask('Close the commit fast path follow-up');
            const commitCliModule = require(path.join(CLI_DIR, 'memory.js'));
            const commitOutput = await captureConsole(async () => {
                await commitCliModule.run([
                    'node',
                    'memory.js',
                    'commit',
                    'Bundled the code snapshot, context track, and runtime state meta-commit into one explicit flow.',
                    '--code-message',
                    'feat(runtime): add commit fast path',
                    '--mechanism',
                    'CommitFastPath',
                    '--resolve',
                    backlogTask.hash,
                ]);
            });
            assert.ok(commitOutput.includes('code_snapshot: written'), 'commit fast path did not report code snapshot success');
            assert.ok(commitOutput.includes('context_closure: complete'), 'commit fast path did not report context closure success');
            assert.ok(commitOutput.includes('runtime_meta: written'), 'commit fast path did not report runtime meta-commit success');
            assert.ok(commitOutput.includes('code_commit: abc1111'), 'commit fast path did not report the code commit hash');
            assert.ok(!commitOutput.includes('base0001'), 'commit fast path leaked the wrapper-injected git hash into the user-facing report');
            assert.ok(commitOutput.includes('runtime_commit: def2222'), 'commit fast path did not report the runtime meta-commit hash');
        });
        const commitFlowContext = fs.readFileSync(path.join(commitFlowRuntime.runtimeRoot, 'active_context.md'), 'utf8');
        assert.ok(/\n- \[abc1111\] \d{4}-\d{2}-\d{2} CommitFastPath: /.test(commitFlowContext), 'commit fast path did not anchor trajectory updates to the code snapshot commit');
        assert.ok(!commitFlowContext.includes('Close the commit fast path follow-up'), 'commit fast path did not resolve the backlog item');
        assert.ok(commitFastPathCommands.some(command => command === 'commit -m feat(runtime): add commit fast path'), 'commit fast path did not create the code snapshot commit');
        assert.ok(commitFastPathCommands.some(command => command === 'commit -m chore(meta): snapshot evo-lite runtime state'), 'commit fast path did not create the runtime state meta-commit');
        assert.ok(commitFastPathCommands.some(command => /^add -- \.evo-lite\/active_context\.md \.evo-lite\/raw_memory\/mem_/.test(command)), 'commit fast path did not stage the runtime state files explicitly');

        console.log('2dd. Testing commit fast path JSON output stays machine-readable ...');
        const commitJsonRuntime = createTempRuntimeRoot('commit-flow-json');
        writeText(path.join(commitJsonRuntime.workspaceRoot, 'src', 'feature.js'), 'module.exports = true;\n');
        let commitJsonPhase = 'staged';
        await withPatchedExecFileSync((command, args, options) => {
            if (command !== 'git') {
                return commitFlowExecFileSync(command, args, options);
            }
            if (args[0] === 'status' && args[1] === '--porcelain') {
                return commitJsonPhase === 'staged' ? 'M  src/feature.js\n' : '';
            }
            if (args[0] === 'commit' && args[1] === '-m' && args[2] === 'feat(runtime): add commit fast path json') {
                commitJsonPhase = 'code';
                return '[main abc3333] feat(runtime): add commit fast path json\n';
            }
            if (args[0] === 'rev-parse' && args[1] === '--short' && args[2] === 'HEAD') {
                return commitJsonPhase === 'meta' ? 'def4444' : 'abc3333';
            }
            if (args[0] === 'add' && args[1] === '--') {
                return '';
            }
            if (args[0] === 'commit' && args[1] === '-m' && args[2] === 'chore(meta): snapshot evo-lite runtime state') {
                commitJsonPhase = 'meta';
                return '[main def4444] chore(meta): snapshot evo-lite runtime state\n';
            }
            throw new Error(`UNEXPECTED_GIT:${args.join(' ')}`);
        }, async () => {
            await bootstrapRuntime(commitJsonRuntime.runtimeRoot, {
                EVO_LITE_GIT_COMMIT: 'basejson',
                EVO_LITE_GIT_STATUS: 'M  src/feature.js\n',
            });
            const commitCliModule = require(path.join(CLI_DIR, 'memory.js'));
            const jsonOutput = await captureConsole(async () => {
                await commitCliModule.run([
                    'node',
                    'memory.js',
                    'commit',
                    'Bundled a machine-readable commit flow output.',
                    '--code-message',
                    'feat(runtime): add commit fast path json',
                    '--mechanism',
                    'CommitFastPath',
                    '--json',
                ]);
            });
            assert.ok(jsonOutput.trim().startsWith('{'), 'commit fast path JSON output should not be prefixed by human-facing remember logs');
            const parsed = JSON.parse(jsonOutput);
            assert.strictEqual(parsed.track.status, 'complete', 'commit fast path JSON output did not report a complete context closure');
            assert.strictEqual(parsed.runtime.status, 'written', 'commit fast path JSON output did not report the runtime meta-commit');
        });

        console.log('2e. Testing commit fast path enforces staged-only snapshots by default ...');
        const commitGuardRuntime = createTempRuntimeRoot('commit-stage-guard');
        let commitAttempted = false;
        await withPatchedExecFileSync((command, args, options) => {
            if (command !== 'git') {
                return commitFlowExecFileSync(command, args, options);
            }
            if (args[0] === 'status' && args[1] === '--porcelain') {
                return ' M src/feature.js\n';
            }
            if (args[0] === 'commit') {
                commitAttempted = true;
            }
            throw new Error(`UNEXPECTED_GIT:${args.join(' ')}`);
        }, async () => {
            await bootstrapRuntime(commitGuardRuntime.runtimeRoot, {
                EVO_LITE_GIT_STATUS: '',
            });
            const commitCliModule = require(path.join(CLI_DIR, 'memory.js'));
            await assert.rejects(
                async () => {
                    await commitCliModule.run([
                        'node',
                        'memory.js',
                        'commit',
                        'Attempted commit flow without staging the code snapshot first.',
                        '--code-message',
                        'feat(runtime): should fail staged guard',
                        '--mechanism',
                        'CommitFastPath',
                    ]);
                },
                /--stage=all/,
                'commit fast path did not explain how to proceed when the code snapshot was not fully staged'
            );
        });
        assert.strictEqual(commitAttempted, false, 'commit fast path should fail before attempting git commit when the code snapshot is not staged');

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
        const modernInitCommands = [];
        const modernInitResult = await runInitializer(modernInitRoot, {
            execSyncImpl: (command, execOptions = {}) => {
                modernInitCommands.push({ command, cwd: execOptions.cwd || null });
                if (command === 'git rev-parse --is-inside-work-tree') {
                    const error = new Error('fatal: not a git repository');
                    error.stderr = Buffer.from('fatal: not a git repository');
                    throw error;
                }
                if (command === 'git init') {
                    fs.mkdirSync(path.join(modernInitRoot, '.git'), { recursive: true });
                    return Buffer.from('Initialized empty Git repository\n');
                }
                if (command === 'npm install better-sqlite3 tar commander') {
                    return Buffer.from('');
                }
                if (command.startsWith('git ')) {
                    throw new Error(`UNEXPECTED_GIT_COMMAND:${command}`);
                }
                throw new Error('STOP_AFTER_CHECK');
            },
        });
        assert.strictEqual(modernInitResult.status, 0, 'initializer should continue for 2.x-shaped runtime directories');
        assert.ok(
            !`${modernInitResult.stdout}\n${modernInitResult.stderr}`.includes('不支持在 npm 发布的 1.4.9 旧项目上原地升级'),
            'initializer incorrectly blocked a 2.x-shaped runtime directory'
        );
        assert.ok(
            modernInitResult.stdout.includes('📄 复制并配置记忆外挂模板文件'),
            'initializer did not proceed past the legacy-runtime gate for a 2.x-shaped directory'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.github', 'copilot-instructions.md')),
            'initializer did not scaffold .github/copilot-instructions.md into the target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'evo-lite.json')),
            'initializer did not scaffold .github/hooks/evo-lite.json into the target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'dogfood-commit-hook.js')),
            'initializer did not scaffold .github/hooks/dogfood-commit-hook.js into the target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'evo-lite-hook.js')),
            'initializer did not scaffold .github/hooks/evo-lite-hook.js into the target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'evo-lite-codex-stop-hook.js')),
            'initializer did not scaffold .github/hooks/evo-lite-codex-stop-hook.js into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'context-mode.sh')),
            'initializer should not scaffold external context-mode shell hooks into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'git-bash.cmd')),
            'initializer should not scaffold Git Bash launcher assets into the target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.codex', 'hooks.json')),
            'initializer did not scaffold .codex/hooks.json into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.github', 'hooks', 'rtk-rewrite.json')),
            'initializer should not scaffold RTK rewrite hook config into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.codex', 'hooks', 'context-mode-hook.js')),
            'initializer should not scaffold context-mode Codex hooks into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.codex', 'hooks', 'gitnexus-hook.js')),
            'initializer should not scaffold GitNexus Codex hooks into the target project'
        );
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.codex', 'hooks', 'rtk-codex-hook.js')),
            'initializer should not scaffold RTK Codex hooks into the target project'
        );
        const modernHookConfig = JSON.parse(fs.readFileSync(path.join(modernInitRoot, '.github', 'hooks', 'evo-lite.json'), 'utf8'));
        assert.ok(modernHookConfig.hooks.SessionStart.some(entry => entry.command.includes('evo-lite-hook.js sessionstart')), 'initializer did not scaffold SessionStart lifecycle advice hook');
        assert.ok(modernHookConfig.hooks.PreToolUse.some(entry => entry.command.includes('evo-lite-hook.js pretooluse')), 'initializer did not scaffold PreToolUse architecture guard hook');
        assert.ok(modernHookConfig.hooks.PreToolUse.some(entry => entry.command.includes('dogfood-commit-hook.js pretooluse')), 'initializer did not scaffold the dogfood guard hook');
        assert.ok(modernHookConfig.hooks.PreCompact.some(entry => entry.command.includes('evo-lite-hook.js precompact')), 'initializer did not scaffold PreCompact lifecycle advice hook');
        assert.ok(Array.isArray(modernHookConfig.hooks.Stop) && modernHookConfig.hooks.Stop.some(entry => entry.command.includes('evo-lite-hook.js stop')), 'initializer did not scaffold Stop lifecycle advice hook');
        assert.ok(!JSON.stringify(modernHookConfig).includes('context-mode.sh'), 'initializer should no longer wire external context-mode shell hooks through the managed GitHub hook registry');
        const codexHookConfig = JSON.parse(fs.readFileSync(path.join(modernInitRoot, '.codex', 'hooks.json'), 'utf8'));
        assert.ok(codexHookConfig.hooks.SessionStart.some(entry => entry.hooks.some(hook => hook.command.includes('evo-lite-hook.js sessionstart'))), 'initializer did not scaffold Codex SessionStart Evo-Lite hook');
        assert.ok(codexHookConfig.hooks.PreToolUse.some(entry => entry.matcher === 'Bash' && entry.hooks.some(hook => hook.command.includes('evo-lite-hook.js pretooluse'))), 'initializer did not scaffold Codex PreToolUse Evo-Lite architecture hook');
        assert.ok(codexHookConfig.hooks.PreToolUse.some(entry => entry.matcher === 'Bash' && entry.hooks.some(hook => hook.command.includes('dogfood-commit-hook.js pretooluse'))), 'initializer did not scaffold Codex PreToolUse dogfood hook');
        assert.ok(codexHookConfig.hooks.PostToolUse.some(entry => entry.hooks.some(hook => hook.command.includes('evo-lite-hook.js posttooluse'))), 'initializer did not scaffold Codex PostToolUse Evo-Lite closure hook');
        assert.ok(codexHookConfig.hooks.Stop.some(entry => entry.hooks.some(hook => hook.command.includes('evo-lite-codex-stop-hook.js'))), 'initializer did not scaffold the Codex stop JSON wrapper');
        assert.ok(!JSON.stringify(codexHookConfig).includes('context-mode-hook.js'), 'initializer should no longer wire context-mode through the managed Codex hook manifest');
        assert.ok(!JSON.stringify(codexHookConfig).includes('rtk-codex-hook.js'), 'initializer should no longer wire RTK through the managed Codex hook manifest');
        assert.ok(!JSON.stringify(codexHookConfig).includes('gitnexus-hook.js'), 'initializer should no longer wire GitNexus through the managed Codex hook manifest');
        assert.ok(
            !fs.existsSync(path.join(modernInitRoot, '.vscode', 'mcp.json')),
            'initializer should not scaffold external MCP config into the target project'
        );
        assert.ok(
            modernInitCommands.some(entry => entry.command === 'git init' && entry.cwd === modernInitRoot),
            'initializer did not attempt to initialize a Git repository for a fresh target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.git')),
            'initializer did not leave behind a Git repository marker for a fresh target project'
        );
        assert.ok(
            fs.existsSync(path.join(modernInitRoot, '.gitignore')),
            'initializer did not scaffold .gitignore into the target project'
        );
        assert.ok(
            !modernInitCommands.some(entry => entry.command === 'git commit -m "chore: initialize Evo-Lite workspace"'),
            'initializer should not auto-commit when scaffolding into a non-empty existing directory'
        );

        console.log('3aa. Testing initializer copies cli subdirs (planning/, architecture/) ...');
        const subdirsInitRoot = createModernInitProject('subdirs');
        const subdirsInitResult = await runInitializer(subdirsInitRoot, { stubExecSync: true });
        const planningDir = path.join(subdirsInitRoot, '.evo-lite', 'cli', 'planning');
        const archDir = path.join(subdirsInitRoot, '.evo-lite', 'cli', 'architecture');
        assert.strictEqual(subdirsInitResult.status, 0, `Init failed: ${subdirsInitResult.stderr}`);
        assert.ok(fs.existsSync(planningDir), 'planning/ subdir not copied to .evo-lite/cli/');
        assert.ok(fs.existsSync(archDir), 'architecture/ subdir not copied to .evo-lite/cli/');
        console.log('✅ testInitializerCopiesCliSubdirs passed');

        console.log('3ab. Testing initializer auto-creates a baseline commit for a fresh target ...');
        const freshInitParent = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lite-init-fresh-'));
        const freshInitRoot = path.join(freshInitParent, 'workspace');
        const freshInitCommands = [];
        const freshInitResult = await runInitializer(freshInitRoot, {
            execSyncImpl: (command, execOptions = {}) => {
                freshInitCommands.push({ command, cwd: execOptions.cwd || null });
                if (command === 'git rev-parse --is-inside-work-tree') {
                    const error = new Error('fatal: not a git repository');
                    error.stderr = Buffer.from('fatal: not a git repository');
                    throw error;
                }
                if (command === 'git init') {
                    fs.mkdirSync(path.join(freshInitRoot, '.git'), { recursive: true });
                    return Buffer.from('Initialized empty Git repository\n');
                }
                if (command === 'npm install better-sqlite3 tar commander') {
                    return Buffer.from('');
                }
                if (command === 'git status --short') {
                    return Buffer.from('?? .gitignore\n?? .evo-lite/\n?? AGENTS.md\n?? CLAUDE.md\n');
                }
                if (command === 'git add --all') {
                    return Buffer.from('');
                }
                if (command === 'git commit -m "chore: initialize Evo-Lite workspace"') {
                    return Buffer.from('[main (root-commit) abc1234] chore: initialize Evo-Lite workspace\n');
                }
                throw new Error(`UNEXPECTED_COMMAND:${command}`);
            },
        });
        assert.strictEqual(freshInitResult.status, 0, 'initializer should succeed for a fresh target directory');
        assert.ok(
            freshInitCommands.some(entry => entry.command === 'git add --all' && entry.cwd === freshInitRoot),
            'initializer did not stage the scaffolded files before creating the baseline commit'
        );
        assert.ok(
            freshInitCommands.some(entry => entry.command === 'git commit -m "chore: initialize Evo-Lite workspace"' && entry.cwd === freshInitRoot),
            'initializer did not create the baseline scaffold commit for a fresh target project'
        );
        assert.ok(
            freshInitResult.stdout.includes('✅ 已创建 Evo-Lite 初始化基线提交'),
            'initializer did not report baseline commit creation for a fresh target project'
        );
        const freshGitignore = fs.readFileSync(path.join(freshInitRoot, '.gitignore'), 'utf8');
        assert.ok(freshGitignore.includes('.evo-lite/*'), 'scaffolded .gitignore did not ignore Evo-Lite runtime artifacts');
        assert.ok(freshGitignore.includes('!.evo-lite/cli/**'), 'scaffolded .gitignore did not preserve tracked Evo-Lite CLI assets');

        console.log('3b. Testing bootstrap command condenses init-state guidance ...');
        const bootstrapCommandRuntime = createTempRuntimeRoot('bootstrap-command');
        loadCli(bootstrapCommandRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapOutput = await captureConsole(async () => {
            await bootstrapCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapOutput.includes('takeover: bootstrap-pending'),
            'bootstrap command did not classify placeholder initialization state as bootstrap-pending'
        );
        assert.ok(
            bootstrapOutput.includes('context_status: placeholder'),
            'bootstrap command did not expose placeholder active_context state'
        );
        assert.ok(
            bootstrapOutput.includes('architecture_status: missing'),
            'bootstrap command did not expose missing architecture status'
        );
        assert.ok(
            bootstrapOutput.includes('memory_status: no-match'),
            'bootstrap command did not surface no-match recall status'
        );
        assert.ok(
            bootstrapOutput.includes('memory_effect: fresh-takeover'),
            'bootstrap command did not surface fresh-takeover recall fallback'
        );
        assert.ok(
            bootstrapOutput.includes('next_step:'),
            'bootstrap command did not emit compressed next-step guidance'
        );

        console.log('3c. Testing bootstrap command surfaces actionable recall hits ...');
        const bootstrapRecallRuntime = createTempRuntimeRoot('bootstrap-recall-match');
        const bootstrapRecallLoaded = await bootstrapRuntime(bootstrapRecallRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        await bootstrapRecallLoaded.service.memorize(
            'HookRuntimeDogfood template-only edits do not count as live runtime dogfood; inspect live .evo-lite hook path before syncing templates. This note is deliberately long enough to satisfy the quality guard.'
        );
        console.log(bootstrapRecallLoaded.service.setFocus('完成 live runtime hook dogfood 收口，并确认 runtime hook 路径一致'));
        await bootstrapRecallLoaded.service.track(
            'HookRuntimeDogfood',
            'Completed live runtime hook dogfood and clarified that live runtime path verification must happen before template sync.'
        );
        loadCli(bootstrapRecallRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapRecallCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapRecallOutput = await captureConsole(async () => {
            await bootstrapRecallCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapRecallOutput.includes('memory_status: matched'),
            'bootstrap command did not surface matched recall status'
        );
        assert.ok(
            bootstrapRecallOutput.includes('memory_hit: HookRuntimeDogfood'),
            'bootstrap command did not surface actionable recall hit in takeover summary'
        );
        assert.ok(
            bootstrapRecallOutput.includes('memory_effect: inspect live .evo-lite hook path before syncing templates'),
            'bootstrap command did not surface the recall-driven next-step effect'
        );

        console.log('3ca. Testing bootstrap command surfaces workflow-template recall hits ...');
        const bootstrapWorkflowRuntime = createTempRuntimeRoot('bootstrap-recall-workflow-sync');
        const bootstrapWorkflowLoaded = await bootstrapRuntime(bootstrapWorkflowRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        await bootstrapWorkflowLoaded.service.memorize(
            'WorkflowTemplateSync managed workflow drift should be handled by diffing managed workflow files before mirroring live and template changes. This note is deliberately long enough to satisfy the quality guard.'
        );
        console.log(bootstrapWorkflowLoaded.service.setFocus('收口 template sync 漂移，并确认 managed workflow 对齐'));
        loadCli(bootstrapWorkflowRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapWorkflowCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapWorkflowOutput = await captureConsole(async () => {
            await bootstrapWorkflowCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapWorkflowOutput.includes('memory_status: matched'),
            'bootstrap command did not surface matched workflow-template recall status'
        );
        assert.ok(
            bootstrapWorkflowOutput.includes('memory_hit: WorkflowTemplateSync'),
            'bootstrap command did not surface workflow-template recall hit in takeover summary'
        );
        assert.ok(
            bootstrapWorkflowOutput.includes('memory_effect: diff managed workflow files before mirroring live and template changes'),
            'bootstrap command did not surface workflow-template recall effect'
        );

        console.log('3cb. Testing bootstrap command surfaces context-track closure recall hits ...');
        const bootstrapClosureRuntime = createTempRuntimeRoot('bootstrap-recall-closure');
        const bootstrapClosureLoaded = await bootstrapRuntime(bootstrapClosureRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        await bootstrapClosureLoaded.service.memorize(
            'ContextTrackClosure requires pairing context track with a dedicated runtime state meta-commit such as chore(meta): snapshot evo-lite runtime state. This note is deliberately long enough to satisfy the quality guard.'
        );
        console.log(bootstrapClosureLoaded.service.setFocus('收口 context track 与 runtime state meta-commit 流程'));
        loadCli(bootstrapClosureRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapClosureCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapClosureOutput = await captureConsole(async () => {
            await bootstrapClosureCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapClosureOutput.includes('memory_status: matched'),
            'bootstrap command did not surface matched context-track closure recall status'
        );
        assert.ok(
            bootstrapClosureOutput.includes('memory_hit: ContextTrackClosure'),
            'bootstrap command did not surface context-track closure recall hit in takeover summary'
        );
        assert.ok(
            bootstrapClosureOutput.includes('memory_effect: pair context track with a dedicated runtime state snapshot commit'),
            'bootstrap command did not surface context-track closure recall effect'
        );

        console.log('3d. Testing bootstrap recall ignores non-actionable noise ...');
        const bootstrapNoiseRuntime = createTempRuntimeRoot('bootstrap-recall-noise');
        const bootstrapNoiseLoaded = await bootstrapRuntime(bootstrapNoiseRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        await bootstrapNoiseLoaded.service.memorize(
            'This note mentions runtime hook in passing but does not constrain any next step. It is intentionally long enough to satisfy the quality guard.'
        );
        console.log(bootstrapNoiseLoaded.service.setFocus('确认 runtime hook 路径一致'));
        loadCli(bootstrapNoiseRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapNoiseCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapNoiseOutput = await captureConsole(async () => {
            await bootstrapNoiseCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapNoiseOutput.includes('memory_status: no-match'),
            'bootstrap command did not downgrade non-actionable recall noise to no-match'
        );
        assert.ok(
            bootstrapNoiseOutput.includes('memory_effect: fresh-takeover'),
            'bootstrap command did not preserve fresh-takeover fallback for non-actionable noise'
        );
        assert.ok(
            !bootstrapNoiseOutput.includes('memory_hit:'),
            'bootstrap command surfaced a non-actionable recall result as a primary hit'
        );
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);

        console.log('4. Testing archive / sync ...');
        const archiveResult = await primaryLoaded.service.archive('A structured implementation summary that should become a raw archive and be indexed immediately for later retrieval.');
        assert.ok(archiveResult.filePath.includes('raw_memory'), 'Archive did not write to raw_memory');
        assert.ok(
            /^mem_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(?:[a-f0-9]{7}|No-Git)_[a-f0-9]{8}\.md$/i.test(path.basename(archiveResult.filePath)),
            'Archive filename did not match the planned mem_<timestamp>_<commit>_<random>.md format (or No-Git fallback)'
        );

        const rawDir = path.join(primary.runtimeRoot, 'raw_memory');
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(
            path.join(rawDir, 'manual-sync.md'),
            `---\nid: "manual_sync_case"\ntimestamp: "${new Date().toISOString()}"\ntype: "task"\ntags: []\n---\n\n## 实现细节 (Implementation)\nA manually injected archive file that should be discovered by sync and converted into indexed memory records.\n\n## 架构决策 (Architecture)\nKeep sync focused on files missing their index marker.\n`,
            'utf8'
        );
        const syncResult = await primaryLoaded.service.syncIndexMemory();
        assert.ok(syncResult.files >= 1, 'Sync did not process any pending raw archive');
        assert.ok(fs.existsSync(path.join(primary.runtimeRoot, 'index_memory', 'manual-sync.md')), 'Sync did not create index marker');

        console.log('4a. Testing legacy vect_memory marker migration ...');
        const legacyIndexRuntime = createTempRuntimeRoot('legacy-index');
        const legacyIndexDir = path.join(legacyIndexRuntime.runtimeRoot, 'vect_memory');
        fs.mkdirSync(legacyIndexDir, { recursive: true });
        fs.writeFileSync(path.join(legacyIndexDir, 'legacy-marker.md'), '', 'utf8');
        loadCli(legacyIndexRuntime.runtimeRoot);
        const legacyRuntimePaths = require(path.join(CLI_DIR, 'runtime.js'));
        const migratedIndexDir = legacyRuntimePaths.getIndexMemoryDir();
        assert.strictEqual(
            migratedIndexDir,
            path.join(legacyIndexRuntime.runtimeRoot, 'index_memory'),
            'runtime did not resolve the migrated index_memory directory'
        );
        assert.ok(
            fs.existsSync(path.join(legacyIndexRuntime.runtimeRoot, 'index_memory', 'legacy-marker.md')),
            'legacy vect_memory marker file was not migrated into index_memory'
        );
        assert.ok(!fs.existsSync(legacyIndexDir), 'legacy vect_memory directory should be renamed when no index_memory exists');
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);

        console.log('5. Testing sync invalid-archive guard ...');
        fs.writeFileSync(
            path.join(rawDir, 'broken-sync.md'),
            '---\nid: "broken_sync_case"\ntimestamp: "2026-03-20T00:00:00.000Z"\ntype: "bug"\ntags: []\n---\n\n## 现象 (Symptom)\nBad control char here: \u000bindex()\n\n## 原因 (Root Cause)\n未记录\n\n## 解决方案 (Solution)\n未记录\n',
            'utf8'
        );
        const invalidSyncResult = await primaryLoaded.service.syncIndexMemory();
        assert.ok(invalidSyncResult.invalid.some(item => item.file === 'broken-sync.md'), 'sync did not report the invalid archive');
        assert.ok(!fs.existsSync(path.join(primary.runtimeRoot, 'index_memory', 'broken-sync.md')), 'sync incorrectly marked the invalid archive as indexed');

        console.log('6. Testing verify flow alerts ...');
        const flowVerifyLoaded = await bootstrapRuntime(primary.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
        const flowVerifyOutput = await captureConsole(async () => {
            await flowVerifyLoaded.service.verify();
        });
        assert.ok(flowVerifyOutput.includes('损坏的 raw archive'), 'verify did not report invalid archive health');
        assert.ok(flowVerifyOutput.includes('尚未生成 index 标记'), 'verify did not report pending archive indexing');
        assert.ok(flowVerifyOutput.includes('📋 建议下一步:'), 'verify did not print a next-step summary for alert states');

        console.log('6a. Testing verify treats empty database files as fresh init state ...');
        const emptyDbRuntime = createTempRuntimeRoot('empty-db');
        fs.writeFileSync(path.join(emptyDbRuntime.runtimeRoot, 'memory.db'), '', 'utf8');
        const emptyDbLoaded = loadCli(emptyDbRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
        });
        const emptyDbVerifyOutput = await captureConsole(async () => {
            await emptyDbLoaded.service.verify();
        });
        assert.ok(emptyDbVerifyOutput.includes('本地记忆引擎状态: 就绪'), 'verify should bring empty database files up as a healthy local engine');
        assert.ok(!emptyDbVerifyOutput.includes('数据库读取失败'), 'verify should not report empty init databases as corruption');

        console.log('7. Testing verify reports healthy local engine for populated memory db ...');
        const rebuildRuntime = createTempRuntimeRoot('rebuild');
        const rebuildLoaded = await bootstrapRuntime(rebuildRuntime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
        await rebuildLoaded.service.memorize('This preserved raw memory record should survive a model reset so verify can warn that chunks must be rebuilt explicitly afterwards.');
        const rebuildVerifyOutput = await captureConsole(async () => {
            await rebuildLoaded.service.verify();
        });
        assert.ok(rebuildVerifyOutput.includes('本地记忆引擎状态: 就绪'), 'verify did not report healthy local engine state');
        assert.ok(rebuildVerifyOutput.includes('[记忆空间分布]'), 'verify did not report namespace distribution for populated memory db');

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

        console.log('8ab. Testing verify surfaces bootstrap guidance for placeholder init state ...');
        const initGuidanceRuntime = createTempRuntimeRoot('verify-init-guidance');
        const initGuidanceLoaded = await bootstrapRuntime(initGuidanceRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const initGuidanceOutput = await captureConsole(async () => {
            await initGuidanceLoaded.service.verify();
        });
        assert.ok(initGuidanceOutput.includes('[初始化引导] 当前 active_context.md 仍是初始化占位态。'), 'verify did not surface placeholder active_context guidance');
        assert.ok(initGuidanceOutput.includes('📌 初始化引导:'), 'verify did not print a dedicated bootstrap guidance section');
        assert.ok(initGuidanceOutput.includes('.agents/rules/architecture.md'), 'verify did not mention missing or placeholder architecture rules during init guidance');

        console.log('8b. Testing git guard ignores .evo-lite-only deletions with leading status padding ...');
        process.env.EVO_LITE_SKIP_GIT_GUARD = '';
        process.env.EVO_LITE_GIT_STATUS = ' D .evo-lite/index_memory/legacy-marker.md';
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
        const healthyTemplateRoot = createTempTemplateRoot('healthy-sync');
        const verifyHealthyLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(healthyTemplateRoot, 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: healthyTemplateRoot,
        });
        const healthyVerifyOutput = await captureConsole(async () => {
            await verifyHealthyLoaded.service.verify();
        });
        assert.ok(healthyVerifyOutput.includes('CLI and host adapter files are synced with templates.'), 'verify should treat dynamic model defaults and host adapters as a healthy sync state');
        assert.ok(!healthyVerifyOutput.includes('out of sync'), 'verify incorrectly flagged healthy template files as drift');
        assert.ok(!healthyVerifyOutput.includes('.agents/workflows/evo.md is out of sync'), 'verify incorrectly flagged the managed /evo workflow as drift');
        assert.ok(!healthyVerifyOutput.includes('.agents/workflows/commit.md is out of sync'), 'verify incorrectly flagged the managed /commit workflow as drift');
        assert.ok(!healthyVerifyOutput.includes('.agents/workflows/mem.md is out of sync'), 'verify incorrectly flagged the managed /mem workflow as drift');
        assert.ok(!healthyVerifyOutput.includes('.agents/workflows/walkthrough.md is out of sync'), 'verify incorrectly flagged the managed /walkthrough workflow as drift');
        assert.ok(!healthyVerifyOutput.includes('.github/hooks/evo-lite.json is out of sync'), 'verify incorrectly flagged the managed GitHub hook registry as drift');
        assert.ok(!healthyVerifyOutput.includes('.codex/hooks.json is out of sync'), 'verify incorrectly flagged the Codex hook manifest as drift');
        assert.ok(!healthyVerifyOutput.includes('.github/hooks/dogfood-commit-hook.js is out of sync'), 'verify incorrectly flagged the dogfood guard hook as drift');
        assert.ok(healthyVerifyOutput.includes('可以继续 `/evo` / `/commit` 工作流'), 'verify healthy output did not include a clear next step');

        const localExtensionRuntime = createTempRuntimeRoot('verify-local-extension');
        const localExtensionLoaded = await bootstrapRuntime(localExtensionRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(healthyTemplateRoot, 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: healthyTemplateRoot,
        });
        const localInstructionsPath = path.join(localExtensionRuntime.workspaceRoot, '.github', 'copilot-instructions.md');
        fs.writeFileSync(
            localInstructionsPath,
            fs.readFileSync(localInstructionsPath, 'utf8').replace(
                '<!-- evo-lite:local-extensions:start -->\n<!-- evo-lite:local-extensions:end -->',
                '<!-- evo-lite:local-extensions:start -->\n# Local Tooling\n\nUse `rtk` when shell output would be noisy.\n<!-- evo-lite:local-extensions:end -->'
            ),
            'utf8'
        );
        const localExtensionVerifyOutput = await captureConsole(async () => {
            await localExtensionLoaded.service.verify();
        });
        assert.ok(localExtensionVerifyOutput.includes('CLI and host adapter files are synced with templates.'), 'verify should ignore local extension blocks in managed markdown files');
        assert.ok(!localExtensionVerifyOutput.includes('.github/copilot-instructions.md is out of sync'), 'verify incorrectly flagged a local extension block as template drift');

        const driftTemplateRoot = createTempTemplateRoot('actual-drift', templateRoot => {
            const evoWorkflowPath = path.join(templateRoot, '.agents', 'workflows', 'evo.md');
            fs.writeFileSync(evoWorkflowPath, `${fs.readFileSync(evoWorkflowPath, 'utf8')}\n<!-- drift -->\n`, 'utf8');
            const commitWorkflowPath = path.join(templateRoot, '.agents', 'workflows', 'commit.md');
            fs.writeFileSync(commitWorkflowPath, `${fs.readFileSync(commitWorkflowPath, 'utf8')}\n<!-- drift -->\n`, 'utf8');
            const dogfoodHookPath = path.join(templateRoot, '.github', 'hooks', 'dogfood-commit-hook.js');
            fs.writeFileSync(dogfoodHookPath, `${fs.readFileSync(dogfoodHookPath, 'utf8')}\n// drift\n`, 'utf8');
            const githubHookRegistryPath = path.join(templateRoot, '.github', 'hooks', 'evo-lite.json');
            const githubHookRegistry = JSON.parse(fs.readFileSync(githubHookRegistryPath, 'utf8'));
            githubHookRegistry.hooks.SessionStart[0].command = 'node ./.github/hooks/evo-lite-hook.js altered-sessionstart';
            fs.writeFileSync(githubHookRegistryPath, JSON.stringify(githubHookRegistry, null, 2), 'utf8');
            const codexHookPath = path.join(templateRoot, '.codex', 'hooks.json');
            const codexHookConfig = JSON.parse(fs.readFileSync(codexHookPath, 'utf8'));
            codexHookConfig.hooks.PostToolUse[0].hooks[0].command = 'node ./.github/hooks/evo-lite-hook.js altered-posttooluse';
            fs.writeFileSync(codexHookPath, JSON.stringify(codexHookConfig, null, 2), 'utf8');
        });
        const verifyDriftLoaded = await bootstrapRuntime(verifyRuntime.runtimeRoot, {
            EVO_LITE_SKIP_GIT_STATUS: '1',
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(driftTemplateRoot, 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: driftTemplateRoot,
        });
        const driftVerifyOutput = await captureConsole(async () => {
            await verifyDriftLoaded.service.verify();
        });
        assert.ok(driftVerifyOutput.includes('.agents/workflows/evo.md is out of sync'), 'verify did not report managed /evo workflow drift');
        assert.ok(driftVerifyOutput.includes('.agents/workflows/commit.md is out of sync'), 'verify did not report managed /commit workflow drift');
        assert.ok(driftVerifyOutput.includes('.github/hooks/evo-lite.json is out of sync'), 'verify did not report managed GitHub hook registry drift');
        assert.ok(driftVerifyOutput.includes('.github/hooks/dogfood-commit-hook.js is out of sync'), 'verify did not report actual Evo-Lite hook asset drift');
        assert.ok(driftVerifyOutput.includes('.codex/hooks.json is out of sync'), 'verify did not report Codex hook manifest drift');
        assert.ok(!driftVerifyOutput.includes('Verify completed with no active alerts.'), 'verify still reported a clean bill of health after drift');

        console.log('10a. Testing sessionstart architecture guidance ...');
        const missingArchitectureRuntime = createTempRuntimeRoot('hook-architecture-missing');
        const missingArchitectureLoaded = await bootstrapRuntime(missingArchitectureRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const missingArchitectureReport = missingArchitectureLoaded.service.inspectHookLifecycle('sessionstart');
        assert.strictEqual(missingArchitectureReport.architectureStatus, 'missing', 'sessionstart should report missing architecture rules');
        assert.ok(
            missingArchitectureReport.reminders.some(reminder => reminder.includes('architecture.md') && reminder.includes('候选架构/语言方案')),
            'sessionstart did not remind the agent to propose architecture options when architecture.md is missing'
        );

        const placeholderArchitectureRuntime = createTempRuntimeRoot('hook-architecture-placeholder');
        writeText(
            path.join(placeholderArchitectureRuntime.workspaceRoot, '.agents', 'rules', 'architecture.md'),
            fs.readFileSync(path.join(TEMPLATE_ROOT_DIR, '.agents', 'rules', 'architecture.md'), 'utf8')
        );
        const placeholderArchitectureLoaded = await bootstrapRuntime(placeholderArchitectureRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const placeholderArchitectureReport = placeholderArchitectureLoaded.service.inspectHookLifecycle('sessionstart');
        assert.strictEqual(placeholderArchitectureReport.architectureStatus, 'placeholder', 'sessionstart should report placeholder architecture rules');
        assert.ok(
            placeholderArchitectureReport.reminders.some(reminder => reminder.includes('模板占位态')),
            'sessionstart did not remind the agent that architecture.md is still placeholder content'
        );

        const configuredArchitectureRuntime = createTempRuntimeRoot('hook-architecture-configured');
        writeText(
            path.join(configuredArchitectureRuntime.workspaceRoot, '.agents', 'rules', 'architecture.md'),
            '# PROJECT ARCHITECTURE & STANDARDS\n\n- Language: Node.js\n- Framework/runtime: CLI + templates\n- Package manager: npm\n- Storage/retrieval: sqlite-fts5-trigram\n'
        );
        const configuredArchitectureLoaded = await bootstrapRuntime(configuredArchitectureRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const configuredArchitectureReport = configuredArchitectureLoaded.service.inspectHookLifecycle('sessionstart');
        assert.strictEqual(configuredArchitectureReport.architectureStatus, 'configured', 'sessionstart should report configured architecture rules');
        assert.ok(
            !configuredArchitectureReport.reminders.some(reminder => reminder.includes('architecture.md')),
            'sessionstart should not emit architecture reminders after architecture.md is configured'
        );

        console.log('10b. Testing recall-first takeover guidance is documented ...');
        const evoWorkflow = fs.readFileSync(path.join(WORKSPACE_ROOT, '.agents', 'workflows', 'evo.md'), 'utf8');
        assert.ok(
            evoWorkflow.includes('有界 recall') && evoWorkflow.includes('fresh takeover'),
            '/evo workflow did not document recall-first takeover guidance'
        );
        const readme = fs.readFileSync(path.join(WORKSPACE_ROOT, 'README.md'), 'utf8');
        assert.ok(
            readme.includes('recall-first takeover') && readme.includes('按 fresh takeover 继续'),
            'README did not document recall-first takeover behavior'
        );
        const readmeEn = fs.readFileSync(path.join(WORKSPACE_ROOT, 'README_EN.md'), 'utf8');
        assert.ok(
            readmeEn.includes('recall-first takeover') && readmeEn.includes('fresh takeover'),
            'README_EN did not document recall-first takeover behavior'
        );

        console.log('11. Testing import...');
        const imported = createTempRuntimeRoot('import');
        const importedLoaded = await bootstrapRuntime(imported.runtimeRoot);
        await importedLoaded.service.importMemories(exportPath);
        const importedList = importedLoaded.service.list();
        assert.ok(importedList.some(item => item.content.includes('unique test memory fragment')), 'Imported runtime did not contain exported memory');

        console.log('T9. Testing plan lint detects missing frontmatter and --fix injects it ...');
        {
            const { lintPlans } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'lint'));
            const { scanPlanning } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'scan'));
            const tmpLintRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lint-'));
            try {
                const plansDir = path.join(tmpLintRoot, 'docs', 'superpowers', 'plans');
                fs.mkdirSync(plansDir, { recursive: true });

                // Plan with no frontmatter
                fs.writeFileSync(path.join(plansDir, '2026-01-01-my-feature.md'),
                    '### Task 1: Do something\n- [ ] **Step 1:** do it\n');
                // Plan with valid frontmatter — should not be reported
                fs.writeFileSync(path.join(plansDir, '2026-01-02-good-plan.md'),
                    '---\nid: plan:good-plan\nlinkedSpec: spec:good-plan\n---\n# Good Plan\n');
                // Plan with frontmatter but missing linkedSpec
                fs.writeFileSync(path.join(plansDir, '2026-01-03-partial.md'),
                    '---\nid: plan:partial\n---\n# Partial Plan\n');

                const result = lintPlans(tmpLintRoot, false);
                assert.strictEqual(result.issues.length, 2, 'should find 2 issues');
                assert.ok(result.issues.some(i => i.message.includes('no frontmatter')), 'should report no-frontmatter issue');
                assert.ok(result.issues.some(i => i.message.includes('no linkedSpec')), 'should report no-linkedSpec issue');
                assert.strictEqual(result.fixed, 0, 'fix=false should not modify files');

                // --fix injects frontmatter for no-frontmatter case only
                const fixResult = lintPlans(tmpLintRoot, true);
                assert.strictEqual(fixResult.fixed, 1, '--fix should fix exactly the no-frontmatter file');
                const fixedContent = fs.readFileSync(path.join(plansDir, '2026-01-01-my-feature.md'), 'utf8');
                assert.ok(fixedContent.startsWith('---\n'), 'fixed file should start with frontmatter');
                assert.ok(fixedContent.includes('id: plan:my-feature'), 'fixed frontmatter should have id: plan:my-feature');
                assert.ok(fixedContent.includes('linkedSpec: TODO'), 'fixed frontmatter should use TODO when matching spec is absent');

                // Idempotency: second --fix on already-fixed file should not re-inject
                const fixAgain = lintPlans(tmpLintRoot, true);
                assert.strictEqual(fixAgain.fixed, 0, '--fix is idempotent — no double-inject');

                fs.writeFileSync(path.join(plansDir, '2026-01-04-bad-heading.md'),
                    '---\nlinkedSpec: spec:bad-heading\n---\n# Bad Heading Plan\n## Task 1: Wrong level\n- [ ] **Step 1:** do thing\n');
                const scanResult = scanPlanning(tmpLintRoot);
                assert.ok(
                    scanResult.warnings.some(w => w.message.includes('expected "### Task N:"')),
                    'scanPlanning should diagnose malformed Superpowers task headings'
                );
            } finally {
                fs.rmSync(tmpLintRoot, { recursive: true, force: true });
            }
            console.log('✅ T9 plan lint passed');
        }

        console.log('T10. Testing dashboard buildDashboardData includes freshness field ...');
        {
            // Clear require cache so we get the updated module
            const dashPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'dashboard-data'));
            delete require.cache[dashPath];
            const dashModule = require(dashPath);
            const tmpDashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-fresh-'));
            try {
                // No IR files — ages should be null, stale flags false
                const data = dashModule.buildDashboardData(tmpDashRoot);
                assert.ok('freshness' in data, 'dashboard data must have freshness field');
                assert.ok('planIrAge' in data.freshness, 'freshness must have planIrAge');
                assert.ok('archIrAge' in data.freshness, 'freshness must have archIrAge');
                assert.ok('lastCommitAge' in data.freshness, 'freshness must have lastCommitAge');
                assert.ok('planStale' in data.freshness, 'freshness must have planStale');
                assert.ok('archStale' in data.freshness, 'freshness must have archStale');
                assert.strictEqual(data.freshness.planIrAge, null, 'planIrAge should be null when IR missing');
                assert.strictEqual(data.freshness.planStale, false, 'planStale should be false when IR missing');
                assert.strictEqual(data.freshness.archStale, false, 'archStale should be false when IR missing');

                const planSource = path.join(tmpDashRoot, 'docs', 'specs', 'feature.md');
                const readme = path.join(tmpDashRoot, 'README.md');
                const planIrPath = path.join(tmpDashRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
                writeText(planSource, '---\nid: spec:feature\n---\n# Feature\n');
                writeText(readme, '# Notes\n');
                writeText(planIrPath, JSON.stringify({ version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [], warnings: [] }, null, 2));

                const oldTime = new Date(Date.now() - 60000);
                const irTime = new Date(Date.now() - 30000);
                const readmeTime = new Date(Date.now() - 5000);
                fs.utimesSync(planSource, oldTime, oldTime);
                fs.utimesSync(planIrPath, irTime, irTime);
                fs.utimesSync(readme, readmeTime, readmeTime);

                const readmeOnlyData = dashModule.buildDashboardData(tmpDashRoot);
                assert.strictEqual(readmeOnlyData.freshness.planStale, false, 'README-only changes must not mark planStale');

                const newerPlanSource = new Date(Date.now() - 1000);
                fs.utimesSync(planSource, newerPlanSource, newerPlanSource);
                const staleData = dashModule.buildDashboardData(tmpDashRoot);
                assert.strictEqual(staleData.freshness.planStale, true, 'newer planning source must mark planStale');
            } finally {
                fs.rmSync(tmpDashRoot, { recursive: true, force: true });
            }
            console.log('✅ T10 dashboard freshness passed');
        }

        console.log('T11. Testing installPostCommitHook creates hook with sentinel, idempotent ...');
        {
            const { installPostCommitHook } = require(INIT_ENTRY);

            // T11a: fresh install creates hook with sentinel
            const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook1-'));
            try {
                fs.mkdirSync(path.join(dir1, '.git', 'hooks'), { recursive: true });
                installPostCommitHook(dir1);
                const hook = fs.readFileSync(path.join(dir1, '.git', 'hooks', 'post-commit'), 'utf8');
                assert.ok(hook.includes('# BEGIN evo-lite-hook'), 'hook must contain BEGIN sentinel');
                assert.ok(hook.includes('# END evo-lite-hook'), 'hook must contain END sentinel');
                assert.ok(hook.includes('plan scan'), 'hook must reference plan scan');
                assert.ok(hook.includes('plan progress'), 'hook must reference plan progress');
                assert.ok(hook.includes('plan gaps --last-commit --changed-files-from-env'), 'hook must evaluate last-commit gaps');
                assert.ok(hook.includes('dashboard build'), 'hook must reference dashboard build');

                // T11b: idempotent — second install does not duplicate sentinel
                installPostCommitHook(dir1);
                const hook2 = fs.readFileSync(path.join(dir1, '.git', 'hooks', 'post-commit'), 'utf8');
                const sentinelCount = (hook2.match(/# BEGIN evo-lite-hook/g) || []).length;
                assert.strictEqual(sentinelCount, 1, 'sentinel must appear exactly once after second install');
            } finally {
                fs.rmSync(dir1, { recursive: true, force: true });
            }

            // T11c: pre-existing hook — evo-lite section appended, original content preserved
            const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook2-'));
            try {
                fs.mkdirSync(path.join(dir2, '.git', 'hooks'), { recursive: true });
                fs.writeFileSync(path.join(dir2, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho "custom hook"\n');
                installPostCommitHook(dir2);
                const hook3 = fs.readFileSync(path.join(dir2, '.git', 'hooks', 'post-commit'), 'utf8');
                assert.ok(hook3.includes('custom hook'), 'pre-existing hook content must be preserved');
                assert.ok(hook3.includes('# BEGIN evo-lite-hook'), 'evo-lite sentinel must be appended');
            } finally {
                fs.rmSync(dir2, { recursive: true, force: true });
            }

            // T11d: no .git/hooks dir — must not throw
            const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook3-'));
            try {
                installPostCommitHook(dir3);
            } finally {
                fs.rmSync(dir3, { recursive: true, force: true });
            }

            console.log('✅ T11 post-commit hook installer passed');
        }

        console.log('T11a. Testing post-commit hook catches code-only commit governance gaps ...');
        {
            const repo = createHookTestRepo('code-only', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
            });
            try {
                writeText(path.join(repo.projectRoot, 'src', 'foo.js'), 'module.exports = 1;\n');
                runGit(repo.projectRoot, ['add', 'src/foo.js']);
                runGit(repo.projectRoot, ['commit', '-m', 'feat: add foo']);
                runPostCommitHook(repo.projectRoot);

                const findings = JSON.parse(fs.readFileSync(repo.findingsPath, 'utf8'));
                assert.ok(findings.some(f => f.id === 'R006:src/foo.js'), 'code-only commit should produce an R006 finding for src/foo.js');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T11a code-only commit governance gap passed');
        }

        console.log('T11b. Testing post-commit hook refreshes plan/progress/dashboard on plan commits ...');
        {
            const repo = createHookTestRepo('plan-refresh', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
            });
            try {
                writeText(
                    path.join(repo.projectRoot, 'docs', 'superpowers', 'plans', '2026-06-16-refresh.md'),
                    '---\nid: plan:refresh\nlinkedSpec: spec:refresh\n---\n# Refresh\n### Task 1: Refresh\n- [x] **Step 1:** done\n'
                );
                runGit(repo.projectRoot, ['add', 'docs/superpowers/plans/2026-06-16-refresh.md']);
                runGit(repo.projectRoot, ['commit', '-m', 'docs: add refresh plan']);
                runPostCommitHook(repo.projectRoot);

                const entries = readNdjson(repo.hookLogPath);
                const commands = entries.map(entry => entry.argv.join(' '));
                assert.ok(commands.includes('plan scan'), 'plan commit should trigger plan scan');
                assert.ok(commands.includes('plan progress'), 'plan commit should trigger plan progress');
                assert.ok(commands.includes('plan gaps --last-commit --changed-files-from-env'), 'plan commit should trigger last-commit gaps');
                assert.ok(commands.includes('dashboard build'), 'plan commit should trigger dashboard build');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T11b plan commit refresh sequence passed');
        }

        console.log('T11c. Testing post-commit hook sees files in the root commit ...');
        {
            const repo = createHookTestRepo('root-commit', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
                installHookBeforeInitialCommit: true,
            });
            try {
                writeText(path.join(repo.projectRoot, 'src', 'root.js'), 'module.exports = "root";\n');
                runGit(repo.projectRoot, ['add', '.']);
                runGit(repo.projectRoot, ['commit', '-m', 'feat: root commit']);
                runPostCommitHook(repo.projectRoot);

                const findings = JSON.parse(fs.readFileSync(repo.findingsPath, 'utf8'));
                assert.ok(findings.some(f => f.id === 'R006:src/root.js'), 'root commit should still surface src/root.js in R006 findings');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T11c root-commit file detection passed');
        }

        console.log('T12. Testing parseFrontmatter and extractSuperPowersTasks handle CRLF line endings ...');
        {
            const { parseFrontmatter, parsePlanFile } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown'));

            // T12a: parseFrontmatter with CRLF — all fields must be parsed
            const crlfFm = '---\r\nid: spec:test\r\nstatus: done\r\ncreated: 2026-01-01\r\nlinkedPlan: plan:test\r\n---\r\n\r\n# Body\r\n';
            const { frontmatter } = parseFrontmatter(crlfFm);
            assert.strictEqual(frontmatter.id, 'spec:test', 'CRLF frontmatter: id must parse');
            assert.strictEqual(frontmatter.status, 'done', 'CRLF frontmatter: status must parse');
            assert.strictEqual(frontmatter.created, '2026-01-01', 'CRLF frontmatter: created must parse');
            assert.strictEqual(frontmatter.linkedPlan, 'plan:test', 'CRLF frontmatter: linkedPlan must parse');

            // T12b: parsePlanFile (superpowers format) with CRLF — tasks must be extracted
            const tmpCrlfPlan = path.join(os.tmpdir(), 'evo-crlf-plan.md');
            const crlfPlanContent = [
                '---\r\nlinkedSpec: spec:crlf-test\r\n---\r\n',
                '# CRLF Test Plan\r\n',
                '### Task 1: Do something\r\n',
                '- [x] **Step 1: Write test**\r\n',
                '- [x] **Step 2: Run test**\r\n',
                '- [x] **Step 3: Commit**\r\n',
                '### Task 2: Do more\r\n',
                '- [x] **Step 1: Implement**\r\n',
                '- [x] **Step 2: Commit**\r\n',
            ].join('');
            fs.writeFileSync(tmpCrlfPlan, crlfPlanContent, 'utf8');
            try {
                const plan = parsePlanFile(tmpCrlfPlan);
                assert.ok(plan, 'CRLF plan file must parse successfully');
                assert.strictEqual(plan.tasks.length, 2, 'CRLF plan must have 2 tasks');
                assert.strictEqual(plan.tasks[0].status, 'implemented', 'CRLF task 1 must be implemented');
                assert.strictEqual(plan.tasks[1].status, 'implemented', 'CRLF task 2 must be implemented');
                assert.strictEqual(plan.status, 'done', 'CRLF plan status must be done when all tasks implemented');
                assert.strictEqual(plan.linkedSpec, 'spec:crlf-test', 'CRLF plan linkedSpec must parse from frontmatter');
            } finally {
                fs.rmSync(tmpCrlfPlan, { force: true });
            }

            console.log('✅ T12 CRLF line-ending handling passed');
        }

        console.log('--- All CLI integration tests passed! ---');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

runTests();
