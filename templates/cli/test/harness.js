const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATE_CONTEXT_PATH = path.join(WORKSPACE_ROOT, 'templates', 'active_context.md');
const SHARED_CACHE_DIR = path.join(WORKSPACE_ROOT, '.evo-lite', '.cache');

// --- Temp-root lifecycle: the test process owns what it creates ---
//
// Measured before this existed: one full `npm test` left 162 directories behind,
// 105 from createTempRuntimeRoot and 57 from direct mkdtempSync calls. Statically
// 84 of 99 helper sites and 44 of 132 direct sites removed nothing. Handing every
// caller a cleanup() to remember was rejected for that reason — the call sites
// have already demonstrated they will not call it, and a helper-only fix cannot
// reach the direct sites at all.
//
// The tracker only OBSERVES: it records the exact path mkdtempSync returned and
// hands the same path back. Prefix, location, contents and caller API are
// untouched.
//
// Scope, deliberately narrower than "every mkdtempSync": only roots whose
// basename starts with TEMP_PREFIX are tracked. The wrapper is process-wide, so
// without that filter a third-party library's temp directory would be adopted
// and deleted along with ours.
const TEMP_PREFIX = 'evo';
const TEMP_REGISTRY_DIR = path.join(os.tmpdir(), '.evo-lite-test-owners');

function isInside(parent, child) {
    const p = path.resolve(parent);
    const c = path.resolve(child);
    return c === p || c.startsWith(p + path.sep);
}

function defaultPidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) {
        // EPERM means it exists and belongs to someone else — still alive.
        return e && e.code === 'EPERM';
    }
}

function createTempRootTracker(options = {}) {
    const tmpdir = options.tmpdir || os.tmpdir();
    const registryDir = options.registryDir || TEMP_REGISTRY_DIR;
    const pid = options.pid || process.pid;
    const nonce = options.nonce || Math.random().toString(36).slice(2, 10);
    const prefix = options.prefix || TEMP_PREFIX;
    const registryPath = path.join(registryDir, `evo-lite-test-temp-${pid}-${nonce}.json`);

    const roots = [];
    let original = null;

    const persist = () => {
        try {
            fs.mkdirSync(registryDir, { recursive: true });
            fs.writeFileSync(registryPath, JSON.stringify({ pid, roots }, null, 2));
        } catch (_) { /* the registry is a recovery aid, never a hard dependency */ }
    };

    const track = (dir) => {
        if (typeof dir !== 'string') return dir;
        if (!isInside(tmpdir, dir)) return dir;
        if (!path.basename(dir).startsWith(prefix)) return dir;
        if (roots.includes(dir)) return dir;
        roots.push(dir);
        // Written on every creation, not at exit: a crashed run must leave a
        // registry that already names its roots.
        persist();
        return dir;
    };

    return {
        registryPath,
        roots: () => roots.slice(),
        install() {
            if (original) return;
            original = fs.mkdtempSync;
            fs.mkdtempSync = (...args) => track(original.apply(fs, args));
        },
        restore() {
            if (!original) return;
            fs.mkdtempSync = original;
            original = null;
        },
        track,
        // quiesce runs BEFORE any removal: on Windows, rmSync of a directory
        // holding a live sqlite handle fails, and deletion is not a way to
        // release a resource. See Task 7's node24 exit 127.
        cleanupAll(opts = {}) {
            const rmFn = opts.rmFn || ((p) => fs.rmSync(p, {
                recursive: true, force: true, maxRetries: 5, retryDelay: 50,
            }));
            if (typeof opts.quiesce === 'function') {
                try { opts.quiesce(); } catch (err) { /* reported by the caller's own failure */ }
            }
            const result = { removed: 0, alreadyAbsent: 0, failed: [], skipped: [] };
            for (const root of roots) {
                if (!isInside(tmpdir, root)) {
                    result.skipped.push({ path: root, reason: 'outside the temp subtree' });
                    continue;
                }
                if (!fs.existsSync(root)) { result.alreadyAbsent++; continue; }
                try {
                    rmFn(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
                    result.removed++;
                } catch (err) {
                    // Collected, never thrown here: one locked root must not stop
                    // the others, and it must not disappear either.
                    result.failed.push({ path: root, error: err && err.message ? err.message : String(err) });
                }
            }
            roots.length = 0;
            try { fs.unlinkSync(registryPath); } catch (_) { /* already gone */ }
            return result;
        },
    };
}

// Reaps what a CRASHED run left behind, by exact recorded path.
//
// Never a wildcard sweep of %TEMP%\evo-*: that would delete a concurrent run's
// working directories mid-test. An owner that still looks alive is left entirely
// alone, and an unknown liveness answer is treated as alive — leaving a
// directory for one more run is recoverable, deleting a live run's is not.
function reapDeadOwners(options = {}) {
    const registryDir = options.registryDir || TEMP_REGISTRY_DIR;
    const tmpdir = options.tmpdir || os.tmpdir();
    const pidAliveFn = options.pidAliveFn || defaultPidAlive;
    const result = { reaped: [], skipped: [], failed: [] };

    let entries = [];
    try { entries = fs.readdirSync(registryDir); } catch (_) { return result; }

    for (const name of entries) {
        const file = path.join(registryDir, name);
        let payload = null;
        try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
            result.skipped.push({ path: file, reason: 'unreadable or malformed registry' });
            continue;
        }
        if (!payload || !Array.isArray(payload.roots) || typeof payload.pid !== 'number') {
            result.skipped.push({ path: file, reason: 'malformed registry' });
            continue;
        }
        let alive = true;
        try { alive = !!pidAliveFn(payload.pid); } catch (_) { alive = true; }
        if (alive) {
            result.skipped.push({ path: file, reason: 'owner still alive' });
            continue;
        }
        let allHandled = true;
        for (const root of payload.roots) {
            // A registry is not a general-purpose deleter. Anything outside the
            // temp subtree is refused and reported.
            if (typeof root !== 'string' || !isInside(tmpdir, root)) {
                result.skipped.push({ path: root, reason: 'outside the temp subtree' });
                allHandled = false;
                continue;
            }
            try {
                fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
                result.reaped.push(root);
            } catch (err) {
                result.failed.push({ path: root, error: err && err.message ? err.message : String(err) });
                allHandled = false;
            }
        }
        // Keep the registry when anything was refused or failed, so the next run
        // can try again rather than losing the record.
        if (allHandled) { try { fs.unlinkSync(file); } catch (_) { /* already gone */ } }
    }
    return result;
}

// Failure precedence: a cleanup failure must be reported, and must never
// overwrite the reason the suite was already failing.
function reportTempCleanup(summary, primaryError) {
    const failed = (summary && summary.failed) || [];
    const skipped = (summary && summary.skipped) || [];
    const parts = [];
    if (failed.length) {
        parts.push(`temp cleanup failed for ${failed.length} root(s): ` +
            failed.map(f => `${f.path} (${f.error})`).join('; '));
    }
    if (skipped.length) {
        parts.push(`temp cleanup skipped ${skipped.length} entry(ies): ` +
            skipped.map(s => `${s.path || s} (${s.reason || 'unspecified'})`).join('; '));
    }
    return {
        primary: primaryError || null,
        failed: failed.length,
        skipped: skipped.length,
        message: parts.join(' | '),
        ok: failed.length === 0,
    };
}

// Closes what the CURRENT module instances own, before anything is deleted.
//
// It cannot promise every handle is closed: resetCliModuleCache() discards the
// module instance that owned a connection, so a later closeDb() reaches a
// different one. Roots still locked by such an orphan therefore fail to delete —
// which is why cleanupAll reports failures instead of swallowing them.
function quiesceSharedResources() {
    const closed = [];
    // resetMemoryIndex() only drops the reference — it does not close anything.
    // The active index must be closed first or its native handle stays open; a
    // zvec collection keeps rocksdb's LOCK file, which is what survived the
    // first attempt at this cleanup. peekMemoryIndex() exists for exactly this:
    // it returns the instance without creating one, so teardown never opens an
    // index that was never used.
    try {
        const idx = require(path.join(CLI_DIR, 'memory-index.js'));
        if (typeof idx.peekMemoryIndex === 'function') {
            const active = idx.peekMemoryIndex();
            if (active && typeof active.close === 'function') { active.close(); closed.push('index'); }
        }
        if (typeof idx.resetMemoryIndex === 'function') { idx.resetMemoryIndex(); closed.push('resetMemoryIndex'); }
    } catch (_) { /* not loaded in this run, or already torn down */ }
    try {
        const db = require(path.join(CLI_DIR, 'db.js'));
        if (typeof db.closeDb === 'function') { db.closeDb(); closed.push('closeDb'); }
    } catch (_) { /* not loaded in this run, or already torn down */ }
    return closed;
}

// Installed at module load, which is before governance/integration are required
// by test.js — anything they create at load time is therefore already covered.
const tempTracker = createTempRootTracker();
tempTracker.install();
const TEMPLATE_CLI_DIR = path.join(WORKSPACE_ROOT, 'templates', 'cli');
const TEMPLATE_ROOT_DIR = path.join(WORKSPACE_ROOT, 'templates');
const INIT_ENTRY = path.join(WORKSPACE_ROOT, 'index.js');
const TEST_SCOPE = process.argv[2] || 'all';
function shouldRun(scope) {
    return TEST_SCOPE === 'all' || TEST_SCOPE === scope;
}
process.env.NODE_PATH = path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules');
require('module').Module._initPaths();

const IS_CHILD_RUNTIME = !fs.existsSync(TEMPLATE_CLI_DIR);

// Minimal stand-in for templates/active_context.md so createTempRuntimeRoot
// works inside a child hive (no templates/ tree). Same anchors, same {{DATE}}.
const EMBEDDED_CONTEXT_FIXTURE = [
    '# 🧠 Evo-Lite Active Context (EvoRouter)', '',
    '<!-- BEGIN_META -->', '> **核心目标**: (embedded child-runtime fixture)', '<!-- END_META -->', '',
    '## 🎯 当前焦点', '', '<!-- BEGIN_FOCUS -->', '暂无焦点。({{DATE}})', '<!-- END_FOCUS -->', '',
    '## 🚧 活跃任务 (≤ 5 条)', '', '<!-- BEGIN_BACKLOG -->', '- [ ] 暂无活跃任务。', '<!-- END_BACKLOG -->', '',
    '## 🔄 最近轨迹 (≤ 10 条)', '', '<!-- BEGIN_TRAJECTORY -->', '<!-- END_TRAJECTORY -->', '',
].join('\n');

function loadContextTemplate(contextPath) {
    if (fs.existsSync(contextPath)) {
        return fs.readFileSync(contextPath, 'utf8');
    }
    return EMBEDDED_CONTEXT_FIXTURE;
}

function createTempRuntimeRoot(name) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-lite-${name}-`));
    const runtimeRoot = path.join(workspaceRoot, '.evo-lite');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const template = loadContextTemplate(TEMPLATE_CONTEXT_PATH)
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
    // Only the sync-always rule genes (agents-rules family, derived from the
    // manifest so new rule genes stay covered) — verify's template-sync check
    // flags the workspace as diverged without them. The rest of .agents/rules
    // must stay absent: bootstrap derives architecture_status from architecture.md.
    const rulesFamily = require('../template-manifest').MANAGED_TEMPLATE_FAMILIES
        .find(f => f.key === 'agents-rules');
    for (const rule of (rulesFamily ? rulesFamily.files : [])) {
        const src = path.join(TEMPLATE_ROOT_DIR, '.agents', 'rules', rule);
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.join(workspaceRoot, '.agents', 'rules'), { recursive: true });
            fs.copyFileSync(src, path.join(workspaceRoot, '.agents', 'rules', rule));
        }
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
    const originalExitCode = process.exitCode;
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
        // The initializer may set process.exitCode (e.g. fail-closed runtime-not-ready)
        // to signal a non-zero exit without calling process.exit. That mutation must
        // not leak into the shared test process, or a fully-passing run exits non-zero.
        process.exitCode = originalExitCode;
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

// --- Test runtime identity isolation ---
//
// getDb() reopens through getDbPath(), which reads the ambient EVO_LITE_ROOT at
// call time. So a db.js instance that has been dropped from require.cache is
// still callable, and calling it opens a connection against whatever root the
// CURRENT test set — a connection nothing can close, because the instance that
// owns it is unreachable.
//
// That is not only a leak. A test holding a handle from a previous generation
// reads and writes ANOTHER test's database while believing it is using its own.
// Attribution proved both: the two roots that survived suite cleanup were opened
// by later tests through exactly such a stale reference.
//
// So handles carry the generation they were created in, and using one after the
// cache has been reset fails loudly instead of silently reopening.
let cliGeneration = 0;

function guardHandleGeneration(name, mod, generation) {
    return new Proxy(mod, {
        get(target, prop) {
            if (generation !== cliGeneration) {
                const err = new Error(
                    `STALE_TEST_RUNTIME_HANDLE: ${name}.${String(prop)} used after resetCliModuleCache — ` +
                    `handle is from generation ${generation}, current is ${cliGeneration}. ` +
                    'Re-bootstrap the runtime instead of reusing a handle from a discarded module generation: ' +
                    'calling through it opens a connection against whatever EVO_LITE_ROOT the current test set.');
                err.code = 'STALE_TEST_RUNTIME_HANDLE';
                throw err;
            }
            return target[prop];
        },
    });
}

function resetCliModuleCache() {
    // Close before discarding. Dropping the module instance does not release the
    // sqlite handle it owns — it only makes it unreachable, so a later closeDb()
    // reaches a different connection and the old one keeps the file locked until
    // the process exits. On Windows that turns into EBUSY when the temp root is
    // removed, which is how 15 roots survived suite cleanup on the first run of
    // this tracker.
    quiesceSharedResources();
    // Everything handed out before this point is now stale.
    cliGeneration++;
    for (const file of ['runtime.js', 'db.js', 'models.js', 'memory-index-util.js', 'memory-index.js', 'memory-index-zvec.js', 'memory-index-lock.js', 'memory.service.js', 'mcp-detect.js', 'memory.js']) {
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
    return {
        runtimeRoot,
        generation: cliGeneration,
        db: guardHandleGeneration('db', db, cliGeneration),
        models: guardHandleGeneration('models', models, cliGeneration),
        service: guardHandleGeneration('service', service, cliGeneration),
    };
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

module.exports = {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY, TEST_SCOPE, shouldRun,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
    readNdjson, createLegacyInitProject, createModernInitProject,
    resetCliModuleCache, loadCli, bootstrapRuntime, captureConsole, withPatchedExecFileSync,
    IS_CHILD_RUNTIME, loadContextTemplate, EMBEDDED_CONTEXT_FIXTURE,
    createTempRootTracker, reapDeadOwners, reportTempCleanup, tempTracker,
    currentCliGeneration: () => cliGeneration,
    quiesceSharedResources,
};
