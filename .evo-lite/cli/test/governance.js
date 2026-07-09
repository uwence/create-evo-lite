'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    WORKSPACE_ROOT, TEMPLATE_CLI_DIR, CLI_DIR, INIT_ENTRY, SHARED_CACHE_DIR,
    createTempRuntimeRoot, writeText, runGit, runPostCommitHook,
    createHookTestRepo, readNdjson, bootstrapRuntime, captureConsole, resetCliModuleCache,
} = require('./harness');

async function runGovernanceTests() {
    const { IS_CHILD_RUNTIME } = require('./harness');
    if (IS_CHILD_RUNTIME) {
        console.log('⏭️ skipped (child runtime): T13–T27, T-precision, T-hive-manifest, T-hive-portable — mother-bound (need templates/ tree)');
        await runChildRuntimeTests();
        console.log('--- Governance-focused CLI tests passed! (child mode) ---');
        return;
    }
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

        console.log('T15e. Testing governance slice triggers archive-evidence backfill on raw_memory commits ...');
        {
            const repo = createHookTestRepo('governance-evidence-commit', {
                planIR: { version: 'evo-plan-ir@1', tasks: [] },
            });
            try {
                const archiveRel = '.evo-lite/raw_memory/mem_2026-06-17_t15e_evidence.md';
                writeText(
                    path.join(repo.projectRoot, archiveRel),
                    '---\nlinkedTask: task:t15e-demo\n---\n\n# Evidence snapshot\n\nWork on task:t15e-demo complete. Evidence captured.\n'
                );
                runGit(repo.projectRoot, ['add', archiveRel]);
                runGit(repo.projectRoot, ['commit', '-m', 'chore(meta): snapshot evo-lite runtime state']);
                runPostCommitHook(repo.projectRoot);

                const entries = readNdjson(repo.hookLogPath);
                const commands = entries.map(entry => entry.argv.join(' '));
                assert.ok(commands.includes('plan archive-evidence --backfill'), 'evidence commit should trigger plan archive-evidence backfill');
                assert.ok(commands.includes('plan scan'), 'evidence commit should trigger plan scan so backfilled evidence is merged into plan IR');
                assert.ok(commands.includes('plan progress'), 'evidence commit should refresh plan progress');
                assert.ok(commands.includes('plan gaps --last-commit --changed-files-from-env'), 'evidence commit should still run gap detection');
                assert.ok(commands.includes('dashboard build'), 'evidence commit should rebuild dashboard');
                assert.ok(!commands.includes('architecture scan'), 'pure evidence commit should NOT trigger architecture scan');

                const reportPath = path.join(repo.projectRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json');
                assert.ok(fs.existsSync(reportPath), 'post-commit-last-run.json should be written');
                const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                assert.ok((report.categories || []).includes('evidence'), 'report categories should include "evidence" for raw_memory-only commits');
                assert.ok(!(report.categories || []).includes('code'), 'evidence-only commit should not classify as code');
            } finally {
                fs.rmSync(repo.projectRoot, { recursive: true, force: true });
            }
            console.log('✅ T15e evidence commit archive-evidence backfill passed');
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

        console.log('T18a. Testing runtime.getRuntimeVersion reads runtime root, not host project ...');
        {
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ver-'));
            const prev = process.env.EVO_LITE_ROOT;
            try {
                const runtime = require(path.join(TEMPLATE_CLI_DIR, 'runtime'));
                assert.ok(typeof runtime.getRuntimeVersion === 'function', 'runtime must export getRuntimeVersion()');
                // Runtime root carries its own package.json (.evo-lite/package.json) — the version must come from there.
                fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'evo-lite-workspace', version: '9.9.9-test' }));
                process.env.EVO_LITE_ROOT = tmpRoot;
                assert.strictEqual(runtime.getRuntimeVersion(), '9.9.9-test', 'version must be read from the runtime root package.json');
                // Non-Node host: no package.json at runtime root → safe fallback, never throw.
                fs.rmSync(path.join(tmpRoot, 'package.json'));
                assert.strictEqual(runtime.getRuntimeVersion(), 'unknown', 'missing runtime package.json must fall back to "unknown", not throw');
            } finally {
                if (prev === undefined) delete process.env.EVO_LITE_ROOT; else process.env.EVO_LITE_ROOT = prev;
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T18a runtime version resolution passed');
        }

        console.log('T18b. Testing initializer enforces a Node.js engine floor ...');
        {
            const initializer = require(path.join(WORKSPACE_ROOT, 'index.js'));
            assert.ok(typeof initializer.assertNodeVersion === 'function', 'index must export assertNodeVersion()');
            assert.strictEqual(initializer.assertNodeVersion('18.20.4').ok, false, 'Node 18 must be rejected');
            assert.strictEqual(initializer.assertNodeVersion('20.0.0').ok, true, 'Node 20 must be accepted');
            assert.strictEqual(initializer.assertNodeVersion('22.5.1').ok, true, 'Node 22 must be accepted');
            assert.ok(initializer.assertNodeVersion('18.20.4').message.includes('20'), 'rejection message must name the floor');
            console.log('✅ T18b node engine floor passed');
        }

        console.log('T18c. Testing fail-closed runtime dependency install ...');
        {
            const initializer = require(path.join(WORKSPACE_ROOT, 'index.js'));
            assert.ok(typeof initializer.installRuntimeDependencies === 'function', 'index must export installRuntimeDependencies()');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-install-'));
            try {
                // Install failure must be fail-closed: not ready, no throw.
                const failed = initializer.installRuntimeDependencies(tmp, { exec: () => { throw new Error('boom'); } });
                assert.strictEqual(failed.ok, false, 'install failure must yield ok:false');
                assert.strictEqual(failed.state, 'runtime-not-ready', 'failure state must be runtime-not-ready');
                // --skip-install/--offline: not ready, marked skipped, npm never invoked.
                let called = false;
                const skipped = initializer.installRuntimeDependencies(tmp, { skipInstall: true, exec: () => { called = true; } });
                assert.strictEqual(skipped.ok, false, 'skip-install must not report ready');
                assert.strictEqual(skipped.skipped, true, 'skip-install must mark skipped');
                assert.strictEqual(called, false, 'skip-install must not run npm');
                // Success path reports ready.
                const ok = initializer.installRuntimeDependencies(tmp, { exec: () => {} });
                assert.strictEqual(ok.ok, true, 'successful install must report ready');
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
            console.log('✅ T18c fail-closed install passed');
        }

        console.log('T18d. Testing no template asset uses an npm-pack-stripped filename ...');
        {
            // npm pack silently drops files named .gitignore / .npmignore from the
            // tarball; such a template ships as a missing file and breaks scaffolding
            // (ENOENT in runInit). Template assets must use non-stripped names.
            const templatesRoot = path.join(WORKSPACE_ROOT, 'templates');
            const stripped = ['.gitignore', '.npmignore'];
            const offenders = [];
            (function walk(dir) {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name !== 'node_modules') walk(full);
                    } else if (stripped.includes(entry.name)) {
                        offenders.push(path.relative(WORKSPACE_ROOT, full));
                    }
                }
            })(templatesRoot);
            assert.deepStrictEqual(offenders, [], 'template assets must not use npm-pack-stripped names: ' + offenders.join(', '));
            console.log('✅ T18d no pack-stripped template names passed');
        }

        console.log('T18e. Testing shipped runtime manifest matches RUNTIME_DEPENDENCIES ...');
        {
            const initializer = require(path.join(WORKSPACE_ROOT, 'index.js'));
            const shipped = JSON.parse(fs.readFileSync(
                path.join(WORKSPACE_ROOT, 'templates', 'runtime', 'package.json'), 'utf8'));
            assert.ok(typeof initializer.RUNTIME_DEPENDENCIES === 'object',
                'index must export RUNTIME_DEPENDENCIES');
            assert.deepStrictEqual(shipped.dependencies, initializer.RUNTIME_DEPENDENCIES,
                'templates/runtime/package.json dependencies must equal RUNTIME_DEPENDENCIES');
            // The shipped lockfile must exist and agree on the root version.
            const lock = JSON.parse(fs.readFileSync(
                path.join(WORKSPACE_ROOT, 'templates', 'runtime', 'package-lock.json'), 'utf8'));
            assert.strictEqual(lock.packages[''].version, shipped.version,
                'lockfile root version must match shipped manifest version');
            console.log('✅ T18e shipped runtime manifest matches RUNTIME_DEPENDENCIES');
        }

        console.log('T18f. Testing --skip-install still restores runtime manifest + lockfile ...');
        {
            const initializer = require(path.join(WORKSPACE_ROOT, 'index.js'));
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-skip-manifest-'));
            try {
                // The fail path prints `cd .evo-lite && npm ci` as the recovery hint; that
                // command needs both manifest assets, so skip-install must still copy them.
                const skipped = initializer.installRuntimeDependencies(tmp, { skipInstall: true, exec: () => {} });
                assert.strictEqual(skipped.skipped, true, 'skip-install must mark skipped');
                assert.ok(fs.existsSync(path.join(tmp, 'package.json')),
                    'skip-install must still copy package.json so `npm ci` recovery works');
                assert.ok(fs.existsSync(path.join(tmp, 'package-lock.json')),
                    'skip-install must still copy package-lock.json so `npm ci` recovery works');
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
            console.log('✅ T18f skip-install restores manifest + lockfile');
        }

        console.log('T18g. Testing scaffold product version propagates to getRuntimeVersion (no 1.0.0 regression) ...');
        {
            const initializer = require(path.join(WORKSPACE_ROOT, 'index.js'));
            const runtime = require(path.join(TEMPLATE_CLI_DIR, 'runtime'));
            assert.ok(typeof initializer.writeRuntimeManifest === 'function', 'index must export writeRuntimeManifest()');
            assert.ok(typeof initializer.SELF_VERSION === 'string', 'index must export SELF_VERSION');
            const selfVersion = require(path.join(WORKSPACE_ROOT, 'package.json')).version;
            assert.strictEqual(initializer.SELF_VERSION, selfVersion,
                'SELF_VERSION must equal create-evo-lite package.json version');
            // The shipped runtime manifest is pinned (decoupled from product version) to keep the
            // lockfile stable, so the product version must travel via a separate scaffold artifact.
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ver-prop-'));
            const prev = process.env.EVO_LITE_ROOT;
            try {
                initializer.writeRuntimeManifest(tmp);
                process.env.EVO_LITE_ROOT = tmp;
                assert.strictEqual(runtime.getRuntimeVersion(), selfVersion,
                    'scaffolded runtime must advertise the product version, not the pinned 1.0.0 manifest');
            } finally {
                if (prev === undefined) delete process.env.EVO_LITE_ROOT; else process.env.EVO_LITE_ROOT = prev;
                fs.rmSync(tmp, { recursive: true, force: true });
            }
            console.log('✅ T18g product version propagation');
        }

        console.log('T18h. Testing root package-lock.json version matches package.json ...');
        {
            const pkg = require(path.join(WORKSPACE_ROOT, 'package.json'));
            const lock = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package-lock.json'), 'utf8'));
            assert.strictEqual(lock.version, pkg.version,
                'root lockfile .version must match package.json version');
            assert.strictEqual(lock.packages[''].version, pkg.version,
                'root lockfile packages[""].version must match package.json version');
            console.log('✅ T18h root lockfile version consistency');
        }

        console.log('T28. Testing verification contract-schema asset shape ...');
        {
            const schema = JSON.parse(fs.readFileSync(
                path.join(TEMPLATE_CLI_DIR, 'verification', 'contract-schema.json'), 'utf8'));
            assert.deepStrictEqual(
                Object.keys(schema.verifierTypes).sort(),
                ['command', 'file-absent', 'file-exists', 'json-path-equals', 'manual'],
                'verifierTypes must be exactly the closed Phase-0 enum');
            assert.deepStrictEqual(
                schema.verdictStates.slice().sort(),
                ['FAIL', 'PASS', 'STALE', 'UNVERIFIED'],
                'verdictStates must be the four-state model');
            assert.deepStrictEqual(schema.verifierTypes['command'].requiredParams, ['cmd'],
                'command requires cmd');
            assert.deepStrictEqual(schema.verifierTypes['json-path-equals'].requiredParams, ['file', 'path'],
                'json-path-equals requires file + path');
            assert.deepStrictEqual(schema.verifierTypes['manual'].requiredParams, ['reason'],
                'manual requires reason');
            console.log('✅ T28 contract-schema asset shape');
        }

        console.log('T29. Testing validateCriteria rejects malformed criteria ...');
        {
            const { validateCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const ok = validateCriteria([{
                id: 'ac-1', description: 'x', dependsOn: ['index.js'],
                verifier: { type: 'file-exists', params: { path: 'a' } },
            }]);
            assert.deepStrictEqual(ok, [], 'a well-formed criterion must produce no findings');
            const badType = validateCriteria([{
                id: 'ac-2', description: 'x', dependsOn: ['a'],
                verifier: { type: 'sniff', params: {} },
            }]);
            assert.ok(badType.some(f => /unknown verifier type/i.test(f.message)), 'unknown type must be flagged');
            const badParam = validateCriteria([{
                id: 'ac-3', description: 'x', dependsOn: ['a'],
                verifier: { type: 'command', params: { scope: 'governance' } },
            }]);
            assert.ok(badParam.some(f => /missing required param.*cmd/i.test(f.message)), 'missing cmd must be flagged');
            const noDeps = validateCriteria([{
                id: 'ac-4', description: 'x', dependsOn: [],
                verifier: { type: 'file-exists', params: { path: 'a' } },
            }]);
            assert.ok(noDeps.some(f => /dependsOn/i.test(f.message)), 'empty dependsOn must be flagged');
            const dup = validateCriteria([
                { id: 'ac-5', description: 'x', dependsOn: ['a'], verifier: { type: 'file-exists', params: { path: 'a' } } },
                { id: 'ac-5', description: 'y', dependsOn: ['b'], verifier: { type: 'file-exists', params: { path: 'b' } } },
            ]);
            assert.ok(dup.some(f => /duplicate criterion id/i.test(f.message)), 'duplicate ids must be flagged');
            console.log('✅ T29 validateCriteria');
        }

        console.log('T30. Testing validateEvidenceRecord + parseSpecCriteria ...');
        {
            const { validateEvidenceRecord, parseSpecCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            assert.deepStrictEqual(validateEvidenceRecord({
                criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc123',
                verifierType: 'file-exists', attestedBy: null,
            }), [], 'a well-formed machine record must produce no findings');
            assert.ok(validateEvidenceRecord({
                criterionId: 'ac-1', verdict: 'GREENISH', commitSha: 'abc', verifierType: 'file-exists',
            }).some(f => /verdict/i.test(f.message)), 'invalid verdict must be flagged');
            assert.ok(validateEvidenceRecord({
                criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'manual', attestedBy: null,
            }).some(f => /attestedBy/i.test(f.message)), 'manual evidence must require attestedBy');
            assert.ok(validateEvidenceRecord({
                criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'file-exists', attestedBy: 'alice',
            }).some(f => /attestedBy/i.test(f.message)), 'machine evidence must not carry attestedBy');
            const specText = [
                '# Spec', '', '## Acceptance Criteria', '',
                '```json', '{ "criteria": [ { "id": "ac-x" } ] }', '```', '',
            ].join('\n');
            const parsed = parseSpecCriteria(specText);
            assert.strictEqual(parsed.error, null, 'parse must succeed');
            assert.strictEqual(parsed.criteria.length, 1, 'one criterion extracted');
            assert.strictEqual(parsed.criteria[0].id, 'ac-x', 'criterion id extracted');
            console.log('✅ T30 validateEvidenceRecord + parseSpecCriteria');
        }

        console.log('T31. Testing verify-contract lint validates the phase-0 spec (dogfood) ...');
        {
            const { parseSpecCriteria, validateCriteria } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const specPath = path.join(WORKSPACE_ROOT, 'docs', 'superpowers', 'specs', '2026-06-26-verification-contract-phase0.md');
            const parsed = parseSpecCriteria(fs.readFileSync(specPath, 'utf8'));
            assert.strictEqual(parsed.error, null, 'phase-0 spec criteria block must parse');
            assert.ok(parsed.criteria.length >= 3, 'phase-0 spec must declare its own criteria');
            assert.deepStrictEqual(validateCriteria(parsed.criteria), [],
                'the phase-0 spec must satisfy its own contract (dogfood)');
            const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'commands'));
            assert.strictEqual(typeof commands.registerVerificationCommands, 'function',
                'commands.js must export registerVerificationCommands');
            console.log('✅ T31 verify-contract lint dogfood');
        }

        console.log('T32. Testing deriveVerdicts four-state model ...');
        {
            const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const crit = (id, deps) => ({ id, description: 'x', dependsOn: deps, verifier: { type: 'command', params: { cmd: 'x' } } });
            const cA = crit('a', ['index.js']);
            const cB = crit('b', ['index.js']);
            const cC = crit('c', ['index.js']);
            const cD = crit('d', ['templates/runtime/**']);
            const cE = { id: 'e', description: 'x', dependsOn: ['index.js'], verifier: { type: 'manual', params: { reason: 'x' } } };
            const criteria = [cA, cB, cC, cD, cE];
            const records = [
                { criterionId: 'b', verdict: 'FAIL', commitSha: 'h', verifierType: 'command' },
                { criterionId: 'c', verdict: 'PASS', commitSha: 'h', verifierType: 'command', criterionDigest: criterionDigest(cC) },
                { criterionId: 'd', verdict: 'PASS', commitSha: 'old', verifierType: 'command', criterionDigest: criterionDigest(cD) },
                { criterionId: 'e', verdict: 'PASS', commitSha: 'old', verifierType: 'manual', attestedBy: 'alice', criterionDigest: criterionDigest(cE) },
            ];
            const changed = ['templates/runtime/package.json'];
            const byId = Object.fromEntries(deriveVerdicts(criteria, records, 'h', changed).map(x => [x.criterionId, x.verdict]));
            assert.strictEqual(byId.a, 'UNVERIFIED', 'no record → UNVERIFIED');
            assert.strictEqual(byId.b, 'FAIL', 'recorded FAIL → FAIL');
            assert.strictEqual(byId.c, 'PASS', 'machine PASS, deps untouched → PASS');
            assert.strictEqual(byId.d, 'STALE', 'machine PASS, deps in changedFiles → STALE');
            assert.strictEqual(byId.e, 'PASS', 'manual PASS is STALE-exempt');
            const cS = crit('c', ['index.js']);
            const strict = deriveVerdicts([cS],
                [{ criterionId: 'c', verdict: 'PASS', commitSha: 'old', verifierType: 'command', criterionDigest: criterionDigest(cS) }], 'h', null);
            assert.strictEqual(strict[0].verdict, 'STALE', 'no changedFiles + commit!=HEAD → strict STALE');
            console.log('✅ T32 deriveVerdicts');
        }

        console.log('T33. Testing runVerifier for the four machine verifier types ...');
        {
            const { runVerifier } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'run-verifiers'));
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-verify-'));
            try {
                const cmdPolicy = { allow: [{ equals: 'x' }] };
                const passCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
                    { repoRoot: tmp, exec: () => 'ok', policy: cmdPolicy });
                assert.strictEqual(passCmd.verdict, 'PASS', 'command exit 0 → PASS');
                const failCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
                    { repoRoot: tmp, exec: () => { const e = new Error('boom'); e.status = 2; throw e; }, policy: cmdPolicy });
                assert.strictEqual(failCmd.verdict, 'FAIL', 'command non-zero → FAIL');
                fs.writeFileSync(path.join(tmp, 'here.txt'), 'x');
                assert.strictEqual(runVerifier({ verifier: { type: 'file-exists', params: { path: 'here.txt' } } }, { repoRoot: tmp }).verdict, 'PASS');
                assert.strictEqual(runVerifier({ verifier: { type: 'file-exists', params: { path: 'nope.txt' } } }, { repoRoot: tmp }).verdict, 'FAIL');
                assert.strictEqual(runVerifier({ verifier: { type: 'file-absent', params: { path: 'nope.txt' } } }, { repoRoot: tmp }).verdict, 'PASS');
                fs.writeFileSync(path.join(tmp, 'lock.json'), JSON.stringify({ packages: { '': { version: '2.0.10' } } }));
                fs.writeFileSync(path.join(tmp, 'pkg.json'), JSON.stringify({ version: '2.0.10' }));
                const jeq = runVerifier({ verifier: { type: 'json-path-equals', params: {
                    file: 'lock.json', path: ['packages', '', 'version'],
                    equalsJsonPath: { file: 'pkg.json', path: ['version'] } } } }, { repoRoot: tmp });
                assert.strictEqual(jeq.verdict, 'PASS', 'matching json paths (incl empty key) → PASS');
                const jne = runVerifier({ verifier: { type: 'json-path-equals', params: {
                    file: 'lock.json', path: ['packages', '', 'version'], equals: '9.9.9' } } }, { repoRoot: tmp });
                assert.strictEqual(jne.verdict, 'FAIL', 'mismatching literal → FAIL');
                console.log('✅ T33 runVerifier');
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        }

        console.log('T34. Testing evidence-store read/write (latest-per-criterion, validated) ...');
        {
            const store = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-evi-'));
            try {
                assert.deepStrictEqual(store.readEvidence(root, 'spec:x').records, {}, 'missing store reads as empty');
                const rec = { criterionId: 'ac-1', verdict: 'PASS', commitSha: 'abc', verifierType: 'file-exists', ranAt: 't', detail: 'd', attestedBy: null };
                store.writeRecord(root, 'spec:x', rec);
                store.writeRecord(root, 'spec:x', { ...rec, commitSha: 'def', detail: 'd2' });
                const back = store.readEvidence(root, 'spec:x');
                assert.strictEqual(Object.keys(back.records).length, 1, 'latest-per-criterion: one record');
                assert.strictEqual(back.records['ac-1'].commitSha, 'def', 'latest record wins');
                assert.ok(store.evidencePath(root, 'spec:x').endsWith(path.join('verification', 'evidence-x.json')), 'slug strips spec: prefix');
                assert.throws(() => store.writeRecord(root, 'spec:x', {
                    criterionId: 'ac-2', verdict: 'PASS', commitSha: 'abc', verifierType: 'manual', ranAt: 't', detail: 'd', attestedBy: null,
                }), /attestedBy|invalid evidence/i, 'invalid record must throw');
                console.log('✅ T34 evidence-store');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T35. Testing computeLiveVerdicts per-criterion changedFiles ...');
        {
            const { computeLiveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'compute-status'));
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const crit = (id, deps) => ({ id, description: 'x', dependsOn: deps, verifier: { type: 'command', params: { cmd: 'x' } } });
            const critA = crit('a', ['index.js']);
            const critB = crit('b', ['index.js']);
            const critC = crit('c', ['src/**']);
            const critD = crit('d', ['index.js']);
            const criteria = [critA, critB, critC, critD];
            const records = {
                b: { criterionId: 'b', verdict: 'PASS', commitSha: 'sha-b', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critB) },
                c: { criterionId: 'c', verdict: 'PASS', commitSha: 'sha-c', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critC) },
                d: { criterionId: 'd', verdict: 'PASS', commitSha: 'gone', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null, criterionDigest: criterionDigest(critD) },
            };
            const gitDiff = (sha) => {
                if (sha === 'sha-b') return [];
                if (sha === 'sha-c') return ['src/app.js'];
                return null;
            };
            const byId = Object.fromEntries(computeLiveVerdicts(criteria, records, 'HEAD', gitDiff).map(v => [v.criterionId, v.verdict]));
            assert.strictEqual(byId.a, 'UNVERIFIED', 'no record → UNVERIFIED');
            assert.strictEqual(byId.b, 'PASS', 'record, deps untouched → PASS');
            assert.strictEqual(byId.c, 'STALE', 'record, deps changed since its commit → STALE');
            assert.strictEqual(byId.d, 'STALE', 'unreachable commit → STALE');
            console.log('✅ T35 computeLiveVerdicts');
        }

        console.log('T36. Testing runSpec writes evidence and is dirty-tree fail-closed ...');
        {
            const { runSpec } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const { readEvidence } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-engine-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:fix', 'status: draft', 'linkedPlan: plan:fix', '---', '',
                    '# Fix', '', '## Acceptance Criteria', '',
                    '```json',
                    '{ "criteria": [ { "id": "ac-ok", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance" } } } ] }',
                    '```', '',
                ].join('\n'));
                const dirty = runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: ' M index.js', exec: () => '' });
                assert.strictEqual(dirty.ok, false, 'dirty tree must fail-closed');
                assert.strictEqual(dirty.error, 'dirty-tree', 'error names the dirty tree');
                assert.deepStrictEqual(readEvidence(root, 'spec:fix').records, {}, 'no evidence written on dirty tree');
                const clean = runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
                assert.strictEqual(clean.ok, true, 'clean tree runs');
                const rec = readEvidence(root, 'spec:fix').records['ac-ok'];
                assert.strictEqual(rec.verdict, 'PASS', 'command exit 0 → PASS record');
                assert.strictEqual(rec.commitSha, 'sha1', 'record bound to HEAD sha');
                assert.strictEqual(rec.verifierType, 'command', 'record carries verifierType');
                console.log('✅ T36 runSpec dirty-tree fail-closed');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T37. Testing statusSpec + attestSpec (run→status→attest closed loop) ...');
        {
            const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'commands'));
            assert.strictEqual(typeof engine.statusSpec, 'function', 'engine must export statusSpec');
            assert.strictEqual(typeof engine.attestSpec, 'function', 'engine must export attestSpec');
            assert.strictEqual(typeof commands.registerVerificationCommands, 'function', 'commands still exports registration');
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-status-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:s', 'status: draft', 'linkedPlan: plan:s', '---', '',
                    '# S', '', '## Acceptance Criteria', '',
                    '```json',
                    '{ "criteria": [' +
                    ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance" } } },' +
                    ' { "id": "ac-man", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "branch protection" } } } ] }',
                    '```', '',
                ].join('\n'));
                engine.runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
                const noDiff = () => [];
                let v = Object.fromEntries(engine.statusSpec(specPath, { root, headSha: 'sha1', gitDiff: noDiff, exec: () => 'sha1' }).map(x => [x.criterionId, x.verdict]));
                assert.strictEqual(v['ac-cmd'], 'PASS', 'machine criterion PASS after run');
                assert.strictEqual(v['ac-man'], 'UNVERIFIED', 'manual criterion UNVERIFIED until attested');
                engine.attestSpec(specPath, 'ac-man', { root, headSha: 'sha1', ranAt: 't', by: 'alice', note: 'enabled in repo settings', exec: (cmd) => (/status --porcelain/.test(cmd) ? '' : 'sha1') });
                v = Object.fromEntries(engine.statusSpec(specPath, { root, headSha: 'sha9', gitDiff: () => ['index.js'], exec: () => 'sha9' }).map(x => [x.criterionId, x.verdict]));
                assert.strictEqual(v['ac-man'], 'PASS', 'attested manual stays PASS even when deps changed (STALE-exempt)');
                assert.strictEqual(v['ac-cmd'], 'STALE', 'machine criterion STALE once its deps changed');
                console.log('✅ T37 statusSpec + attestSpec');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T38. Testing previewClose readiness (READY/BLOCKED/NO-CONTRACT) ...');
        {
            const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-close-'));
            try {
                const writeSpec = (name, criteriaJson, status) => {
                    const p = path.join(root, name);
                    fs.writeFileSync(p, [
                        '---', 'id: spec:t', `status: ${status || 'draft'}`, 'linkedPlan: plan:t', '---', '',
                        '# T', '', '## Acceptance Criteria', '', '```json', criteriaJson, '```', '',
                    ].join('\n'));
                    return p;
                };
                const oneCmd = '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }';
                const oneManual = '{ "criteria": [ { "id": "ac-m", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "r" } } } ] }';
                const planStateFn = () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', planStatus: 'draft', tasksTotal: 2, tasksImplemented: 0, uncheckedBoxes: 4 });

                const ready = previewClose(writeSpec('ready.md', oneCmd), {
                    root, planStateFn, statusFn: () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }] });
                assert.strictEqual(ready.readiness, 'READY', 'all PASS → READY');
                assert.strictEqual(ready.blockers.length, 0, 'no blockers when READY');
                assert.ok(ready.actions.some(a => /flip 4 unchecked/.test(a)), 'action list reports flips');
                assert.ok(ready.actions.some(a => /status: done/.test(a)), 'action list sets spec done');

                const blocked = previewClose(writeSpec('blocked.md', oneCmd), {
                    root, planStateFn, statusFn: () => [{ criterionId: 'ac-1', verdict: 'STALE', detail: 'd' }] });
                assert.strictEqual(blocked.readiness, 'BLOCKED', 'non-PASS → BLOCKED');
                assert.strictEqual(blocked.blockers[0].criterionId, 'ac-1', 'blocker names the criterion');
                assert.ok(/re-run|verify-contract run/.test(blocked.blockers[0].remedy), 'STALE machine remedy says re-run');

                const manual = previewClose(writeSpec('manual.md', oneManual), {
                    root, planStateFn, statusFn: () => [{ criterionId: 'ac-m', verdict: 'UNVERIFIED', detail: 'd' }] });
                assert.ok(/attest/.test(manual.blockers[0].remedy), 'manual UNVERIFIED remedy says attest');

                const none = previewClose(writeSpec('none.md', '{ "criteria": [] }'), { root, planStateFn, statusFn: () => [] });
                assert.strictEqual(none.readiness, 'NO-CONTRACT', 'zero criteria → NO-CONTRACT');
                assert.strictEqual(none.blockers.length, 0, 'NO-CONTRACT has no blockers');

                console.log('✅ T38 previewClose readiness');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T39. Testing close-commands export + previewClose is read-only ...');
        {
            const commands = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands'));
            const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
            assert.strictEqual(typeof commands.registerCloseCommands, 'function', 'close-commands must export registerCloseCommands');
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-close-ro-'));
            try {
                const specPath = path.join(root, 'spec.md');
                const body = [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
                ].join('\n');
                fs.writeFileSync(specPath, body);
                const before = fs.readdirSync(root).sort();
                previewClose(specPath, { root, planStateFn: () => ({ planId: 'plan:t', found: false, tasksTotal: 0, tasksImplemented: 0, uncheckedBoxes: 0 }), statusFn: () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }] });
                assert.deepStrictEqual(fs.readdirSync(root).sort(), before, 'previewClose must not create/remove files');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'previewClose must not modify the spec');
                console.log('✅ T39 close-commands + read-only');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T40. Testing applyClose fail-closed gates (dirty tree / not READY) ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-gate-'));
            try {
                const specPath = path.join(root, 'spec.md');
                const body = [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
                ].join('\n');
                fs.writeFileSync(specPath, body);

                // dirty tree → refuse before any preview/mutation
                let previewCalled = false;
                const dirty = applyClose(specPath, {
                    root,
                    exec: () => 'M some/file.js\n',
                    previewFn: () => { previewCalled = true; return { readiness: 'READY' }; },
                });
                assert.strictEqual(dirty.applied, false, 'dirty tree must refuse');
                assert.strictEqual(dirty.refused, 'dirty-tree', 'refusal reason names dirty tree');
                assert.strictEqual(previewCalled, false, 'dirty-tree gate runs before previewClose');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'dirty refusal mutates nothing');

                // clean tree but BLOCKED → refuse, surface blockers
                const blocked = applyClose(specPath, {
                    root,
                    exec: () => '',
                    previewFn: () => ({ readiness: 'BLOCKED', blockers: [{ criterionId: 'ac-1', verdict: 'STALE', remedy: 're-run' }] }),
                });
                assert.strictEqual(blocked.applied, false, 'BLOCKED must refuse');
                assert.strictEqual(blocked.refused, 'BLOCKED', 'refusal reason is the readiness');
                assert.strictEqual(blocked.blockers[0].criterionId, 'ac-1', 'blockers passed through');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), body, 'BLOCKED refusal mutates nothing');

                // NO-CONTRACT → refuse with note
                const none = applyClose(specPath, {
                    root,
                    exec: () => '',
                    previewFn: () => ({ readiness: 'NO-CONTRACT', note: 'no machine-readable acceptance criteria' }),
                });
                assert.strictEqual(none.applied, false, 'NO-CONTRACT must refuse');
                assert.strictEqual(none.refused, 'NO-CONTRACT', 'refusal reason is NO-CONTRACT');
                assert.ok(/no machine-readable/.test(none.note), 'NO-CONTRACT note passed through');

                console.log('✅ T40 applyClose gates');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T41. Testing applyClose performs all three mutations on READY ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-do-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', '',
                ].join('\n'));
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                fs.writeFileSync(planAbs, '# P\n\n- [ ] Step one\n- [ ] Step two\n');

                const staged = [];
                const result = applyClose(specPath, {
                    root,
                    now: '2026-06-27T00:00:00.000Z',
                    exec: (args) => { if (args[0] === 'status') return ''; if (args[0] === 'add') { staged.push(...args.slice(1)); return ''; } return ''; },
                    previewFn: () => ({ readiness: 'READY', blockers: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
                    backfillFn: (r) => { fs.mkdirSync(path.join(r, '.evo-lite', 'generated', 'planning'), { recursive: true }); fs.writeFileSync(path.join(r, '.evo-lite', 'generated', 'planning', 'archive-evidence.json'), '{"backfilled":true}\n'); },
                    scanFn: (r) => { fs.writeFileSync(path.join(r, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), '{"rescanned":true}\n'); },
                });

                assert.strictEqual(result.applied, true, 'READY → applied');
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), '# P\n\n- [x] Step one\n- [x] Step two\n', 'all checkboxes flipped');
                assert.ok(/^status: done$/m.test(fs.readFileSync(specPath, 'utf8')), 'spec status set to done');
                assert.ok(fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json')), 'R008 backfill ran');
                assert.ok(fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json')), 'IR rescan ran');
                assert.ok(result.journalPath && fs.existsSync(result.journalPath), 'journal written');
                const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'applied', 'journal marked applied on success');
                assert.strictEqual(journal.createdAt, '2026-06-27T00:00:00.000Z', 'journal records supplied now');
                assert.ok(staged.includes(planRel), 'plan file staged');
                // Only git-tracked source files are staged; gitignored generated artifacts are not.
                assert.ok(!staged.some(s => /plan-ir\.json|archive-evidence\.json/.test(s)), 'generated planning JSON is NOT staged (gitignored)');
                assert.ok(!result.staged.some(s => /plan-ir\.json|archive-evidence\.json/.test(s)), 'result.staged excludes generated artifacts');
                assert.ok(result.actions.some(a => /flip/.test(a)) && result.actions.some(a => /status: done/.test(a)) && result.actions.some(a => /R008/.test(a)), 'actions describe all three mutations');

                console.log('✅ T41 applyClose mutations');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T42. Testing applyClose rolls back every file on mid-apply failure ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-rb-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                const specBefore = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
                fs.writeFileSync(specPath, specBefore);
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                const planBefore = '# P\n\n- [ ] Step one\n- [ ] Step two\n';
                fs.writeFileSync(planAbs, planBefore);

                const result = applyClose(specPath, {
                    root,
                    now: '2026-06-27T00:00:00.000Z',
                    exec: (args) => (args[0] === 'status' ? '' : ''),
                    previewFn: () => ({ readiness: 'READY', blockers: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
                    backfillFn: () => { throw new Error('boom in backfill'); },
                    scanFn: () => { throw new Error('should not reach scan'); },
                });

                assert.strictEqual(result.applied, false, 'failed apply is not applied');
                assert.strictEqual(result.aborted, true, 'result flags aborted');
                assert.ok(/boom/.test(result.error), 'error surfaced');
                // Files restored byte-for-byte (mutations before the throw are undone).
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planBefore, 'plan restored to prior bytes');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specBefore, 'spec restored to prior bytes');
                const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'aborted', 'journal marked aborted');

                console.log('✅ T42 applyClose rollback');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T43. Testing close-commands wires --apply and requires a mode flag ...');
        {
            const { registerCloseCommands } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands'));
            // Capture the action handler by faking a minimal commander program.
            let handler = null; const opts = [];
            const fakeCmd = {
                description() { return this; },
                option(flag) { opts.push(flag); return this; },
                action(fn) { handler = fn; return this; },
            };
            const program = { command() { return fakeCmd; } };
            registerCloseCommands(program);
            assert.ok(typeof handler === 'function', 'close command registers an action handler');
            assert.ok(opts.some(o => /--apply/.test(o)), 'an --apply option is declared');

            const logs = []; const errs = [];
            const origLog = console.log; const origErr = console.error;
            console.log = (...a) => logs.push(a.join(' '));
            console.error = (...a) => errs.push(a.join(' '));
            try {
                process.exitCode = 0;
                handler('some-spec.md', { /* neither flag */ });
                assert.ok(errs.some(e => /specify --preview or --apply/.test(e)), 'neither flag errors');
                assert.strictEqual(process.exitCode, 1, 'neither flag exits non-zero');
            } finally {
                console.log = origLog; console.error = origErr; process.exitCode = 0;
            }
            console.log('✅ T43 close-commands --apply wiring');
        }

        console.log('T44. Testing applyClose defaultScan/defaultBackfill call planning with the real signature ...');
        {
            // Regression: T41 injects scanFn, masking the real defaultScan. The live --apply
            // dogfood caught writePlanIR(ir, root) being called as writePlanIR(root, ir).
            // Exercise the REAL defaultScan/defaultBackfill against a temp root.
            const { defaultScan, defaultBackfill } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-apply-scan-'));
            try {
                const irPath = defaultScan(root);
                assert.strictEqual(typeof irPath, 'string', 'defaultScan returns the plan-ir path (string), not a thrown Object-as-path');
                assert.ok(fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json')), 'defaultScan writes plan-ir.json');
                const bf = defaultBackfill(root);
                assert.ok(bf && typeof bf === 'object', 'defaultBackfill returns a result object');
                console.log('✅ T44 applyClose real planning signature');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T45. Testing attestSpec trust gate (manual-only, exists, clean tree) ...');
        {
            const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const { readEvidence } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-attest-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json',
                    '{ "criteria": [' +
                    ' { "id": "ac-machine", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } },' +
                    ' { "id": "ac-manual", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "r" } } } ] }',
                    '```', '',
                ].join('\n'));
                const cleanExec = (cmd) => (/(status --porcelain)/.test(cmd) ? '' : 'sha1');

                // Forge attempt: attesting a MACHINE criterion must throw and write nothing.
                assert.throws(() => engine.attestSpec(specPath, 'ac-machine', { root, by: 'alice', exec: cleanExec }),
                    /not manual|only manual/i, 'attesting a machine criterion must be refused');
                // Nonexistent criterion must throw.
                assert.throws(() => engine.attestSpec(specPath, 'ac-nope', { root, by: 'alice', exec: cleanExec }),
                    /not found/i, 'attesting an unknown criterion must be refused');
                // Dirty tree must throw.
                assert.throws(() => engine.attestSpec(specPath, 'ac-manual', { root, by: 'alice', exec: () => ' M f.js' }),
                    /dirty/i, 'attest must refuse on a dirty tree');
                assert.deepStrictEqual(readEvidence(root, 'spec:t').records, {}, 'no record written by any refused attest');

                // Legit: manual criterion, clean tree → writes a manual PASS.
                const rec = engine.attestSpec(specPath, 'ac-manual', { root, by: 'alice', ranAt: 't', headSha: 'sha1', exec: cleanExec });
                assert.strictEqual(rec.verifierType, 'manual', 'manual attestation recorded');
                assert.strictEqual(rec.attestedBy, 'alice', 'attestedBy set');
                assert.strictEqual(readEvidence(root, 'spec:t').records['ac-manual'].verdict, 'PASS', 'manual PASS persisted');
                console.log('✅ T45 attestSpec trust gate');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T46. Testing verifier path containment + evidence slug rejects traversal ...');
        {
            const { runVerifier } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'run-verifiers'));
            const store = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-contain-'));
            try {
                // A spec-supplied path that escapes the project root must never PASS.
                const esc = runVerifier({ verifier: { type: 'file-exists', params: { path: '../../../../../../etc/hosts' } } }, { repoRoot: root });
                assert.strictEqual(esc.verdict, 'FAIL', 'escaping file-exists path must not PASS');
                assert.ok(/escapes project root/.test(esc.detail), 'detail names the containment refusal');
                const escAbsent = runVerifier({ verifier: { type: 'file-absent', params: { path: '../../secret' } } }, { repoRoot: root });
                assert.strictEqual(escAbsent.verdict, 'FAIL', 'escaping file-absent path must not PASS');
                const escJson = runVerifier({ verifier: { type: 'json-path-equals', params: { file: '../../x.json', path: ['a'], equals: 1 } } }, { repoRoot: root });
                assert.strictEqual(escJson.verdict, 'FAIL', 'escaping json-path file must not PASS');

                // A malicious spec id must not let the evidence slug escape the verification dir.
                assert.throws(() => store.evidenceSlug('spec:../../evil'), /invalid spec id/i, 'traversal slug must be rejected');
                assert.throws(() => store.evidencePath(root, 'spec:a/b'), /invalid spec id/i, 'separator slug must be rejected');
                assert.strictEqual(store.evidenceSlug('spec:verification-contract-phase3'), 'verification-contract-phase3', 'normal slug passes');
                console.log('✅ T46 path + slug containment');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T47. Testing loadValidatedContract states + fail-closed wiring ...');
        {
            const { loadValidatedContract } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
            const mk = (block) => ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', '', '## Acceptance Criteria', '', '```json', block, '```', ''].join('\n');
            const good = '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "file-exists", "params": { "path": "a" } } } ] }';

            const okC = loadValidatedContract(mk(good));
            assert.ok(okC.ok && !okC.noContract, 'valid contract → ok, not noContract');
            const none = loadValidatedContract(['---', 'id: spec:t', '---', '', '# T', '', 'body'].join('\n'));
            assert.ok(none.ok && none.noContract, 'no criteria block → ok + noContract (opt-out)');
            assert.ok(!loadValidatedContract(mk('{ not json')).ok, 'malformed json block → not ok');
            assert.ok(!loadValidatedContract(mk('{ "criteria":[{"id":"a","description":"x","dependsOn":["i"],"verifier":{"type":"sniff","params":{}}}] }')).ok, 'unknown verifier type → not ok');

            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-loader-'));
            try {
                const sp = path.join(root, 'spec.md');
                fs.writeFileSync(sp, mk('{ not json'));
                const r = engine.runSpec(sp, { root, porcelain: '', headSha: 'h', ranAt: 't', exec: () => '' });
                assert.strictEqual(r.ok, false, 'runSpec refuses malformed contract');
                assert.ok(/contract invalid/.test(r.error), 'runSpec error names contract invalid');
                const v = engine.statusSpec(sp, { root, headSha: 'h', exec: () => '', gitDiff: () => [] });
                assert.ok(v.some(x => x.verdict === 'INVALID'), 'statusSpec returns INVALID for malformed contract');
                const pc = previewClose(sp, { root, planStateFn: () => ({ planId: 'plan:t', found: false, tasksTotal: 0, tasksImplemented: 0, uncheckedBoxes: 0 }) });
                assert.strictEqual(pc.readiness, 'BLOCKED', 'malformed contract → preview BLOCKED');
                assert.ok(pc.blockers.some(b => b.verdict === 'INVALID'), 'preview surfaces INVALID blocker');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
            console.log('✅ T47 loadValidatedContract + fail-closed wiring');
        }

        console.log('T48. Testing close-commands rejects both --preview and --apply ...');
        {
            const { registerCloseCommands } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands'));
            let handler = null;
            const fakeCmd = { description() { return this; }, option() { return this; }, action(fn) { handler = fn; return this; } };
            registerCloseCommands({ command() { return fakeCmd; } });
            const errs = []; const origErr = console.error;
            console.error = (...a) => errs.push(a.join(' '));
            try {
                process.exitCode = 0;
                handler('spec.md', { preview: true, apply: true });
                assert.ok(errs.some(e => /only one of --preview or --apply/.test(e)), 'both flags rejected');
                assert.strictEqual(process.exitCode, 1, 'both flags exits non-zero');
            } finally {
                console.error = origErr; process.exitCode = 0;
            }
            console.log('✅ T48 close-commands preview/apply XOR');
        }

        console.log('T49. Testing criterionDigest is stable + semantic ...');
        {
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const base = { id: 'ac-1', description: 'hello', dependsOn: ['a', 'b'],
                verifier: { type: 'command', params: { cmd: 'x', scope: 'governance' } } };
            const d = criterionDigest(base);
            assert.ok(/^sha256:[0-9a-f]{64}$/.test(d), 'digest is sha256:<64 hex>');
            const reordered = { id: 'ac-1', description: 'hello', dependsOn: ['a', 'b'],
                verifier: { type: 'command', params: { scope: 'governance', cmd: 'x' } } };
            assert.strictEqual(criterionDigest(reordered), d, 'param key order must not change digest');
            assert.strictEqual(criterionDigest({ ...base, description: 'totally different prose' }), d, 'description must not change digest');
            assert.notStrictEqual(criterionDigest({ ...base, verifier: { type: 'command', params: { cmd: 'y' } } }), d, 'cmd change must change digest');
            assert.notStrictEqual(criterionDigest({ ...base, dependsOn: ['a'] }), d, 'dependsOn change must change digest');
            assert.notStrictEqual(criterionDigest({ ...base, dependsOn: ['b', 'a'] }), d, 'dependsOn reorder changes digest');
            console.log('✅ T49 criterionDigest stable + semantic');
        }

        console.log('T50. Testing deriveVerdicts STALEs a machine PASS on digest change/absent ...');
        {
            const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const crit = { id: 'm', description: 'x', dependsOn: ['index.js'], verifier: { type: 'command', params: { cmd: 'x' } } };
            const baseRec = { criterionId: 'm', verdict: 'PASS', commitSha: 'h', verifierType: 'command', ranAt: 't', detail: 'd', attestedBy: null };
            const okRec = { ...baseRec, criterionDigest: criterionDigest(crit) };
            assert.strictEqual(deriveVerdicts([crit], [okRec], 'h', [])[0].verdict, 'PASS', 'matching digest, deps untouched → PASS');
            assert.strictEqual(deriveVerdicts([crit], [baseRec], 'h', [])[0].verdict, 'STALE', 'absent digest → STALE');
            const redefined = { ...crit, verifier: { type: 'command', params: { cmd: 'DIFFERENT' } } };
            assert.strictEqual(deriveVerdicts([redefined], [okRec], 'h', [])[0].verdict, 'STALE', 'digest mismatch → STALE');
            console.log('✅ T50 machine digest STALE');
        }

        console.log('T51. Testing deriveVerdicts manual: STALE on digest change, exempt from deps/commit ...');
        {
            const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts'));
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const crit = { id: 'man', description: 'x', dependsOn: ['index.js'], verifier: { type: 'manual', params: { reason: 'r' } } };
            const rec = { criterionId: 'man', verdict: 'PASS', commitSha: 'old', verifierType: 'manual', ranAt: 't', detail: 'd', attestedBy: 'alice', criterionDigest: criterionDigest(crit) };
            assert.strictEqual(deriveVerdicts([crit], [rec], 'newhead', ['index.js'])[0].verdict, 'PASS', 'manual PASS survives deps/commit change when digest matches');
            const redefined = { ...crit, verifier: { type: 'manual', params: { reason: 'DIFFERENT' } } };
            assert.strictEqual(deriveVerdicts([redefined], [rec], 'newhead', ['index.js'])[0].verdict, 'STALE', 'manual STALEs on digest change');
            const legacy = { ...rec }; delete legacy.criterionDigest;
            assert.strictEqual(deriveVerdicts([crit], [legacy], 'h', [])[0].verdict, 'STALE', 'manual absent digest → STALE');
            console.log('✅ T51 manual digest STALE');
        }

        console.log('T52. Testing runSpec + attestSpec stamp criterionDigest ...');
        {
            const engine = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const { readEvidence } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            const vc = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-digest-write-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json',
                    '{ "criteria": [' +
                    ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance" } } },' +
                    ' { "id": "ac-man", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "manual", "params": { "reason": "r" } } } ] }',
                    '```', '',
                ].join('\n'));
                const cleanExec = (cmd) => (/status --porcelain/.test(cmd) ? '' : 'sha1');

                engine.runSpec(specPath, { root, headSha: 'sha1', ranAt: 't', porcelain: '', exec: () => 'ok' });
                const cmdRec = readEvidence(root, 'spec:t').records['ac-cmd'];
                assert.ok(cmdRec.criterionDigest && /^sha256:/.test(cmdRec.criterionDigest), 'runSpec stamps criterionDigest');

                engine.attestSpec(specPath, 'ac-man', { root, headSha: 'sha1', ranAt: 't', by: 'alice', exec: cleanExec });
                const manRec = readEvidence(root, 'spec:t').records['ac-man'];
                assert.ok(manRec.criterionDigest && /^sha256:/.test(manRec.criterionDigest), 'attestSpec stamps criterionDigest');

                const parsed = vc.loadValidatedContract(fs.readFileSync(specPath, 'utf8'));
                const cmdCrit = parsed.criteria.find(c => c.id === 'ac-cmd');
                assert.strictEqual(cmdRec.criterionDigest, vc.criterionDigest(cmdCrit), 'stamped digest equals recomputed digest');
                console.log('✅ T52 writers stamp criterionDigest');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T53. Testing previewClose task-incomplete warning (advisory, not a blocker) ...');
        {
            const { previewClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-warn-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, [
                    '---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '',
                    '# T', '', '## Acceptance Criteria', '',
                    '```json', '{ "criteria": [ { "id": "ac-1", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } } ] }', '```', '',
                ].join('\n'));
                const allPass = () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }];
                const incomplete = previewClose(specPath, {
                    root, statusFn: allPass,
                    planStateFn: () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', tasksTotal: 3, tasksImplemented: 1, uncheckedBoxes: 4 }) });
                assert.strictEqual(incomplete.readiness, 'READY', 'task incompleteness must NOT block READY');
                assert.ok(Array.isArray(incomplete.warnings), 'preview returns a warnings array');
                assert.ok(incomplete.warnings.some(w => w.kind === 'tasks-incomplete' && /2 of 3/.test(w.message)), 'warns 2 of 3 tasks not implemented');
                const complete = previewClose(specPath, {
                    root, statusFn: allPass,
                    planStateFn: () => ({ planId: 'plan:t', found: true, planPath: 'docs/p.md', tasksTotal: 3, tasksImplemented: 3, uncheckedBoxes: 0 }) });
                assert.strictEqual(complete.readiness, 'READY', 'complete tasks still READY');
                assert.deepStrictEqual(complete.warnings, [], 'no warning when tasks complete');
                console.log('✅ T53 previewClose task warning');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T54. Testing applyClose rolls back when git add fails (staging inside the txn) ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-stage-fail-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                const specBefore = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
                fs.writeFileSync(specPath, specBefore);
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                const planBefore = '# P\n\n- [ ] Step one\n- [ ] Step two\n';
                fs.writeFileSync(planAbs, planBefore);
                const result = applyClose(specPath, {
                    root, now: '2026-06-28T00:00:00.000Z',
                    exec: (args) => { if (args[0] === 'add') throw new Error('git add boom'); return ''; },
                    previewFn: () => ({ readiness: 'READY', blockers: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 2, uncheckedBoxes: 2 } }),
                    backfillFn: () => {}, scanFn: () => {},
                });
                assert.strictEqual(result.applied, false, 'staging failure is not applied');
                assert.strictEqual(result.aborted, true, 'staging failure rolls back (aborted)');
                assert.ok(/git add boom/.test(result.error), 'staging error surfaced');
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planBefore, 'plan restored after staging failure');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specBefore, 'spec restored after staging failure');
                const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'aborted', 'journal marked aborted on staging failure');
                console.log('✅ T54 staging-failure rollback');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T55. Testing applyClose advisory lock (fresh refuses, stale proceeds, removed after) ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                fs.mkdirSync(path.join(root, '.evo-lite', 'verification'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
                const planRel = 'docs/p.md';
                fs.writeFileSync(path.join(root, planRel), '# P\n\n- [ ] One\n');
                const lockPath = path.join(root, '.evo-lite', 'verification', 'close.lock');
                const now = '2026-06-28T12:00:00.000Z';
                const okOpts = {
                    root, now,
                    exec: (args) => (args[0] === 'add' ? '' : ''),
                    previewFn: () => ({ readiness: 'READY', blockers: [], plan: { planId: 'plan:t', found: true, planPath: planRel, tasksTotal: 1, uncheckedBoxes: 1 } }),
                    backfillFn: () => {}, scanFn: () => {},
                };
                fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, startedAt: now }) + '\n');
                const refused = applyClose(specPath, okOpts);
                assert.strictEqual(refused.applied, false, 'fresh lock → not applied');
                assert.strictEqual(refused.refused, 'locked', 'fresh lock → refused:locked');
                const stale = new Date(Date.parse(now) - (11 * 60 * 1000)).toISOString();
                fs.writeFileSync(lockPath, JSON.stringify({ pid: 999, startedAt: stale }) + '\n');
                const applied = applyClose(specPath, okOpts);
                assert.strictEqual(applied.applied, true, 'stale lock → proceeds and applies');
                assert.ok(!fs.existsSync(lockPath), 'lock removed after a successful apply');
                console.log('✅ T55 advisory lock');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T56. Testing statusSpec emits a NO-CONTRACT verdict so --strict fails ...');
        {
            const { statusSpec } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'engine'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-nocontract-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', '---', '', '# T', 'no criteria block here', ''].join('\n'));
                const verdicts = statusSpec(specPath, { root, exec: () => 'abc123\n' });
                assert.strictEqual(verdicts.length, 1, 'exactly one synthetic verdict for NO-CONTRACT');
                assert.strictEqual(verdicts[0].verdict, 'NO-CONTRACT', 'verdict is NO-CONTRACT');
                assert.ok(verdicts[0].verdict !== 'PASS', 'NO-CONTRACT is not PASS → --strict exits non-zero');
                console.log('✅ T56 statusSpec NO-CONTRACT verdict');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T57. Testing loadValidatedContract identity validation (id + linkedPlan) ...');
        {
            const { loadValidatedContract } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract'));
            const mk = (fm) => ['---', ...fm, '---', '', '# T', 'no criteria', ''].join('\n');
            const noId = loadValidatedContract(mk(['status: draft']));
            assert.strictEqual(noId.ok, false, 'missing id → ok:false');
            assert.strictEqual(noId.findings[0].id, 'id', 'finding is about id');
            assert.strictEqual(loadValidatedContract(mk(['id: nope'])).ok, false, 'bad id prefix → ok:false');
            const badPlan = loadValidatedContract(mk(['id: spec:ok', 'linkedPlan: bad']));
            assert.strictEqual(badPlan.ok, false, 'bad linkedPlan → ok:false');
            assert.strictEqual(badPlan.findings[0].id, 'linkedPlan', 'finding is about linkedPlan');
            const ok = loadValidatedContract(mk(['id: spec:ok', 'linkedPlan: plan:ok']));
            assert.strictEqual(ok.ok, true, 'valid id, no criteria → ok:true');
            assert.strictEqual(ok.noContract, true, 'no criteria block → noContract');
            assert.strictEqual(ok.linkedPlan, 'plan:ok', 'linkedPlan exposed on the result');
            console.log('✅ T57 identity validation');
        }

        console.log('T58. Testing applyClose propagates preview warnings on a direct --apply ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-applywarn-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
                const planRel = 'docs/p.md';
                fs.writeFileSync(path.join(root, planRel), '---\nid: plan:t\nstatus: draft\n---\n\n# P\n\n- [ ] One\n');
                const warning = { kind: 'tasks-incomplete', message: '1 of 2 linked tasks are not implemented — closing will mark the spec done anyway' };
                const r = applyClose(specPath, {
                    root, now: '2026-06-28T12:00:00.000Z',
                    exec: () => '',
                    previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [warning],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 2, tasksImplemented: 1, uncheckedBoxes: 1 } }),
                    backfillFn: () => {}, scanFn: () => {},
                });
                assert.strictEqual(r.applied, true, 'applies (warning is advisory, never blocks)');
                assert.deepStrictEqual(r.warnings, [warning], 'warnings propagated to the apply result');
                const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-commands.js'), 'utf8');
                assert.ok(/r\.warnings/.test(src) && /⚠/.test(src), 'printApply prints warnings with ⚠');
                console.log('✅ T58 apply propagates warnings');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T59. Testing applyClose sets plan status: done independent of unchecked boxes ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-planstatus-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, ['---', 'id: spec:t', 'status: done', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n'));
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                // Case A: plan already fully checked but still draft → status must reach done.
                fs.writeFileSync(planAbs, ['---', 'id: plan:t', 'status: draft', '---', '', '# P', '', '- [x] One', ''].join('\n'));
                let added = false;
                const rA = applyClose(specPath, {
                    root, now: '2026-06-28T12:00:00.000Z',
                    exec: (args) => { if (args[0] === 'add') added = true; return ''; },
                    previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 0 } }),
                    backfillFn: () => {}, scanFn: () => {},
                });
                assert.strictEqual(rA.applied, true, 'A: applies');
                assert.ok(/^status: done$/m.test(fs.readFileSync(planAbs, 'utf8')), 'A: plan rewritten to status: done even with 0 unchecked boxes');
                assert.ok(added, 'A: plan was staged');
                // Case B: plan already done + 0 boxes → no-op (file untouched, not staged).
                fs.writeFileSync(planAbs, ['---', 'id: plan:t', 'status: done', '---', '', '# P', '', '- [x] One', ''].join('\n'));
                const before = fs.readFileSync(planAbs, 'utf8');
                const rB = applyClose(specPath, {
                    root, now: '2026-06-28T12:00:00.000Z',
                    exec: () => '',
                    previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'done', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 0 } }),
                    backfillFn: () => {}, scanFn: () => {},
                });
                assert.strictEqual(rB.applied, true, 'B: applies (spec already done, plan no-op)');
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), before, 'B: fully-closed plan untouched');
                assert.ok(!(rB.staged || []).includes(planRel), 'B: plan not staged when it is a no-op');
                console.log('✅ T59 plan status done box-count-independent');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T60. Testing closure journal slug uses evidenceSlug (no path traversal) ...');
        {
            const closeApply = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const { evidenceSlug } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'evidence-store'));
            assert.throws(() => evidenceSlug('spec:a/b'), /invalid spec id/, 'separator id rejected by evidenceSlug');
            assert.strictEqual(closeApply.slugFor({ id: 'spec:t' }), 't', 'slugFor returns the validated slug');
            assert.throws(() => closeApply.slugFor({ id: 'spec:../evil' }), /invalid spec id/, 'slugFor rejects traversal');
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-slug-'));
            try {
                const specPath = path.join(root, 'spec.md');
                fs.writeFileSync(specPath, ['---', 'id: spec:../../evil', 'status: draft', '---', '', '# T', ''].join('\n'));
                const r = closeApply.applyClose(specPath, { root, now: '2026-06-28T12:00:00.000Z', exec: () => '', backfillFn: () => {}, scanFn: () => {} });
                assert.strictEqual(r.applied, false, 'traversal id → not applied (fail-closed at preview)');
                const vdir = path.join(root, '.evo-lite', 'verification');
                const journals = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(f => f.startsWith('close-journal')) : [];
                assert.strictEqual(journals.length, 0, 'no journal written for a fail-closed traversal id');
                console.log('✅ T60 safe journal slug');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        console.log('T61. Testing success-journal write failure rolls back + unstages (write inside txn) ...');
        {
            const { applyClose } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-apply'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-jtxn-'));
            try {
                fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
                const specPath = path.join(root, 'spec.md');
                const specPrior = ['---', 'id: spec:t', 'status: draft', 'linkedPlan: plan:t', '---', '', '# T', ''].join('\n');
                fs.writeFileSync(specPath, specPrior);
                const planRel = 'docs/p.md';
                const planAbs = path.join(root, planRel);
                const planPrior = ['---', 'id: plan:t', 'status: draft', '---', '', '# P', '', '- [ ] One', ''].join('\n');
                fs.writeFileSync(planAbs, planPrior);
                const resetCalls = [];
                const r = applyClose(specPath, {
                    root, now: '2026-06-28T12:00:00.000Z',
                    exec: (args) => { if (args[0] === 'reset') resetCalls.push(args); return ''; },
                    previewFn: () => ({ readiness: 'READY', blockers: [], warnings: [],
                        plan: { planId: 'plan:t', found: true, planPath: planRel, planStatus: 'draft', tasksTotal: 1, tasksImplemented: 1, uncheckedBoxes: 1 } }),
                    backfillFn: () => {}, scanFn: () => {},
                    writeJournalFn: (p, payload) => {
                        if (payload.status === 'applied') throw new Error('disk full on success journal');
                        fs.mkdirSync(path.dirname(p), { recursive: true });
                        fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n');
                    },
                });
                assert.strictEqual(r.applied, false, 'not applied');
                assert.strictEqual(r.aborted, true, 'aborted');
                assert.strictEqual(fs.readFileSync(specPath, 'utf8'), specPrior, 'spec restored to prior bytes');
                assert.strictEqual(fs.readFileSync(planAbs, 'utf8'), planPrior, 'plan restored to prior bytes');
                assert.ok(resetCalls.length >= 1, 'rollback unstaged via git reset');
                const journal = JSON.parse(fs.readFileSync(r.journalPath, 'utf8'));
                assert.strictEqual(journal.status, 'aborted', 'journal records aborted');
                console.log('✅ T61 success-journal failure rolls back + unstages');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
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

        console.log('T24. Testing R006 exempts host-adapter and meta infrastructure ...');
        {
            const gapsPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            delete require.cache[gapsPath];
            const { checkR006 } = require(gapsPath);
            const planIR = { tasks: [] };

            const exempt = checkR006(WORKSPACE_ROOT, planIR, {
                changedFiles: [
                    '.claude/settings.local.json',
                    '.claude/commands/evo.md',
                    'CLAUDE.md',
                    'AGENTS.md',
                    'README.md',
                    '.gitignore',
                    '.gitattributes',
                    '.evo-lite/active_context.md',
                ],
            });
            assert.strictEqual(exempt.length, 0, 'R006 must exempt .claude/**, root meta, and .evo-lite/** files');

            const product = checkR006(WORKSPACE_ROOT, planIR, {
                changedFiles: ['src/feature.js'],
            });
            assert.ok(product.some(f => f.rule === 'R006'), 'R006 must still flag unlinked product code');
            console.log('✅ T24 R006 host-adapter/meta exemption passed');
        }

        console.log('T25. Testing stale lock with matching mirror content is not drift ...');
        {
            const { syncRuntime, verifyRuntimeLock } = require(path.join(TEMPLATE_CLI_DIR, 'sync-runtime'));
            const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-stale-'));
            try {
                fs.mkdirSync(path.join(tmpRoot, 'templates', 'cli'), { recursive: true });
                writeText(path.join(tmpRoot, 'templates', 'cli', 'memory.js'), '// canonical-v2\n');
                process.env.EVO_LITE_TEMPLATE_CLI_DIR = path.join(tmpRoot, 'templates', 'cli');
                process.env.EVO_LITE_TEMPLATE_ROOT_DIR = path.join(tmpRoot, 'templates');

                syncRuntime(tmpRoot); // mirror == template, lock fresh

                // Simulate a pull/rebase that updated BOTH template + mirror together
                // but left the lock stale: rewrite lock entries with a bogus old hash.
                const lockPath = path.join(tmpRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json');
                const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                for (const k of Object.keys(lock.entries)) lock.entries[k] = 'deadbeef-stale-hash';
                writeText(lockPath, JSON.stringify(lock, null, 2) + '\n');

                const verdict = verifyRuntimeLock(tmpRoot);
                assert.notStrictEqual(verdict.status, 'drifted', 'stale lock with matching mirror/template content must not be drift');
                assert.strictEqual(verdict.status, 'ok', 'content-identical mirror should verify ok despite stale lock');
                assert.strictEqual(verdict.lockStale, true, 'verdict should flag the lock as stale so the caller can refresh it');

                // Real drift (mirror diverges from template) must still be detected.
                writeText(path.join(tmpRoot, '.evo-lite', 'cli', 'memory.js'), '// hand-edited\n');
                const drift = verifyRuntimeLock(tmpRoot);
                assert.strictEqual(drift.status, 'drifted', 'a mirror edited away from its template must still drift');
                assert.ok(drift.mismatches.some(m => m.path.endsWith('memory.js')), 'drift report should name memory.js');
            } finally {
                delete process.env.EVO_LITE_TEMPLATE_CLI_DIR;
                delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            }
            console.log('✅ T25 stale-lock content-aware verdict passed');
        }

        console.log('T26. Testing R012 flags focus pointing at a draft/0-done plan ...');
        {
            const gapsPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            delete require.cache[gapsPath];
            const { checkR012 } = require(gapsPath);
            const planIR = {
                specs: [],
                plans: [
                    { id: 'plan:demo-feature', title: 'Demo Feature', status: 'draft', linkedSpec: 'spec:demo', sourcePath: 'docs/plans/demo.md' },
                    { id: 'plan:shipped-feature', title: 'Shipped Feature', status: 'done', linkedSpec: 'spec:ship', sourcePath: 'docs/plans/ship.md' },
                ],
                tasks: [
                    { id: 'plan:demo-feature/task-1', linkedPlan: 'plan:demo-feature', status: 'todo' },
                    { id: 'plan:shipped-feature/task-1', linkedPlan: 'plan:shipped-feature', status: 'verified' },
                ],
            };

            // focus references the draft/0-done plan by prose title → must warn
            const phantom = checkR012(WORKSPACE_ROOT, planIR, { focusText: 'Demo Feature: build the thing' });
            assert.ok(
                phantom.some(f => f.rule === 'R012' && f.id === 'R012:plan:demo-feature' && f.level === 'warning'),
                'R012 must flag focus on a draft/0-done plan',
            );

            // focus on a started/done plan → no warning
            const healthy = checkR012(WORKSPACE_ROOT, planIR, { focusText: 'Shipped Feature: done and verified' });
            assert.strictEqual(healthy.length, 0, 'R012 must not flag focus on a started/done plan');

            // focus with no plan reference → no warning
            const idle = checkR012(WORKSPACE_ROOT, planIR, { focusText: 'idle pending next initiative' });
            assert.strictEqual(idle.length, 0, 'R012 must not fire when focus references no plan');
            console.log('✅ T26 R012 focus-health passed');
        }

        console.log('T27. Testing commit-evidence focus auto-advance is conservative ...');
        {
            const runtime = createTempRuntimeRoot('focus-advance');
            const planningDir = path.join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planningDir, { recursive: true });
            writeText(path.join(planningDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], warnings: [],
                plans: [{ id: 'plan:demo', title: 'Demo Plan', status: 'draft', taskIds: ['task:demo-1'] }],
                tasks: [{ id: 'task:demo-1', title: 'First task', status: 'todo', linkedPlan: 'plan:demo' }],
            }, null, 2));
            writeText(
                path.join(runtime.runtimeRoot, 'active_context.md'),
                '# Active Context\n<!-- BEGIN_META -->\n<!-- END_META -->\n## Focus\n<!-- BEGIN_FOCUS -->\nold focus\n<!-- END_FOCUS -->\n## Backlog\n<!-- BEGIN_BACKLOG -->\n<!-- END_BACKLOG -->\n## Trajectory\n<!-- BEGIN_TRAJECTORY -->\n<!-- END_TRAJECTORY -->\n'
            );

            const loaded = await bootstrapRuntime(runtime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });

            // 1) commit referencing a known plan advances focus
            const advanced = loaded.service.advanceFocusFromCommit({ commitMessage: 'feat(plan:demo): land first task' });
            assert.strictEqual(advanced.status, 'ok', 'plan-referencing commit should advance focus');
            assert.strictEqual(advanced.focusChanged, true, 'focus should change');
            assert.ok(advanced.focusAfter.startsWith('Demo Plan:'), 'focus should derive from the referenced plan title (saw: ' + advanced.focusAfter + ')');

            // 2) bare snapshot/meta commit leaves focus untouched
            const bare = loaded.service.advanceFocusFromCommit({ commitMessage: 'chore(meta): snapshot runtime state' });
            assert.strictEqual(bare.status, 'no-reference', 'a commit with no plan/spec reference must not move focus');
            assert.strictEqual(bare.focusChanged, false, 'bare commit must not change focus');

            // 3) opt-out env disables it entirely
            process.env.EVO_LITE_NO_FOCUS_AUTOADVANCE = '1';
            try {
                const off = loaded.service.advanceFocusFromCommit({ commitMessage: 'feat(plan:demo): land first task' });
                assert.strictEqual(off.status, 'disabled', 'opt-out env must disable auto-advance');
                assert.strictEqual(off.focusChanged, false, 'disabled auto-advance must not change focus');
            } finally {
                delete process.env.EVO_LITE_NO_FOCUS_AUTOADVANCE;
            }

            // 4) the post-commit hook body wires the conservative advance in
            const { buildHookBody } = require(path.join(TEMPLATE_CLI_DIR, 'hooks'));
            assert.ok(buildHookBody().includes('context advance-focus'), 'post-commit hook must invoke context advance-focus');

            console.log('✅ T27 commit-evidence focus auto-advance passed');
        }

        console.log('T-precision. Testing per-suite dependsOn breaks the STALE cascade ...');
        {
            const { deriveVerdicts } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'derive-verdicts.js'));
            const { criterionDigest } = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'validate-contract.js'));
            const criterion = {
                id: 'ac-x',
                dependsOn: ['templates/cli/test/governance.js', 'templates/cli/test/harness.js'],
                verifier: { type: 'command', params: { cmd: 'node ./.evo-lite/cli/test.js governance', scope: 'governance' } },
            };
            const record = {
                criterionId: 'ac-x', verdict: 'PASS', verifierType: 'command',
                commitSha: 'abc123', criterionDigest: criterionDigest(criterion),
            };
            // A change confined to the integration suite must NOT stale a governance criterion.
            const clean = deriveVerdicts([criterion], [record], 'HEADSHA', ['templates/cli/test/integration.js']);
            assert.strictEqual(clean[0].verdict, 'PASS', 'integration-only change must not stale a governance criterion');
            // A change to the governance suite (or harness) MUST stale it.
            const staleGov = deriveVerdicts([criterion], [record], 'HEADSHA', ['templates/cli/test/governance.js']);
            assert.strictEqual(staleGov[0].verdict, 'STALE', 'governance-suite change must stale the governance criterion');
            const staleHarness = deriveVerdicts([criterion], [record], 'HEADSHA', ['templates/cli/test/harness.js']);
            assert.strictEqual(staleHarness[0].verdict, 'STALE', 'harness change must stale the governance criterion');
        }
        console.log('✅ T-precision per-suite dependsOn isolation passed');

        console.log('T-hive-manifest. Testing manifest object-form file entries with mergeAnchors ...');
        {
            const manifest = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            const family = {
                key: 'fixture', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [],
                files: ['plain.js', { path: 'docs/hybrid.md', mergeAnchors: [['BEGIN_LOCAL', 'END_LOCAL']] }],
            };
            const paths = { workspaceRoot: 'W', activeCliDir: 'A', templateRootPath: 'R', templateCliPath: 'C' };
            const entries = family.files.map(f => manifest.buildEntry ? manifest.buildEntry(family, f, paths) : null);
            assert.ok(manifest.buildEntry, 'buildEntry must be exported');
            assert.strictEqual(entries[0].label, 'plain.js', 'string entry label unchanged');
            assert.deepStrictEqual(entries[0].mergeAnchors, [], 'string entry has empty mergeAnchors');
            assert.strictEqual(entries[1].label, 'docs/hybrid.md', 'object entry label from path');
            assert.deepStrictEqual(entries[1].mergeAnchors, [['BEGIN_LOCAL', 'END_LOCAL']], 'anchors pass through');
            assert.ok(entries[1].activeFile.includes('docs'), 'object entry resolves subdir path');

            // hive-feedback genes: rule template exists and is a managed sync-always entry
            const rulesFam = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'agents-rules');
            assert.ok(rulesFam, 'agents-rules managed family exists');
            assert.strictEqual(rulesFam.scope, 'sync-always');
            assert.deepStrictEqual(rulesFam.files, ['hive-feedback.md', 'zvec-optin.md']);
            for (const rule of rulesFam.files) {
                assert.ok(fs.existsSync(path.join(WORKSPACE_ROOT, 'templates', '.agents', 'rules', rule)),
                    `rule template file present: ${rule}`);
            }
            assert.ok(manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli').files.includes('hive/feedback.js'),
                'feedback module is a managed core-cli gene');

            // copy-on-init rules: seeded once, never nurtured, template files must exist
            const initRulesFam = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'agents-rules-init');
            assert.ok(initRulesFam, 'agents-rules-init family exists');
            assert.strictEqual(initRulesFam.scope, 'copy-on-init', 'init rules are copy-on-init, not nurtured');
            for (const rule of initRulesFam.files) {
                assert.ok(fs.existsSync(path.join(WORKSPACE_ROOT, 'templates', '.agents', 'rules', rule)),
                    `init rule template file present: ${rule}`);
            }
            const overlap = initRulesFam.files.filter(f => rulesFam.files.includes(f));
            assert.deepStrictEqual(overlap, [], 'a rule must be either sync-always or copy-on-init, never both');
        }
        console.log('✅ T-hive-manifest object-form entries passed');

        console.log('T-hive-portable. Testing harness child-runtime fallback ...');
        {
            const harness = require('./harness');
            assert.strictEqual(typeof harness.IS_CHILD_RUNTIME, 'boolean', 'IS_CHILD_RUNTIME exported');
            assert.strictEqual(harness.IS_CHILD_RUNTIME, false, 'mother repo is not a child runtime');
            const fallback = harness.loadContextTemplate(path.join(os.tmpdir(), 'evo-nonexistent-' + Date.now(), 'active_context.md'));
            assert.ok(fallback.includes('BEGIN_FOCUS') && fallback.includes('END_TRAJECTORY'), 'fallback fixture has anchor markers');
            assert.ok(fallback.includes('{{DATE}}'), 'fallback fixture has DATE placeholder');
            const real = harness.loadContextTemplate(path.join(WORKSPACE_ROOT, 'templates', 'active_context.md'));
            assert.ok(real.includes('BEGIN_FOCUS'), 'real template still read when present');
        }
        console.log('✅ T-hive-portable harness fallback passed');

        console.log('T-MI. Testing MemoryIndex seam (SqliteFtsIndex) ...');
        {
            const runtime = createTempRuntimeRoot('memory-index-seam');
            const loaded = await bootstrapRuntime(runtime.runtimeRoot);
            const { getMemoryIndex, SqliteFtsIndex, resetMemoryIndex } = require(path.join(CLI_DIR, 'memory-index.js'));

            // Pin the SQLite engine — this suite exercises SqliteFtsIndex specifics
            // (trigram, match_source 'fts'), independent of the flipped default.
            const miPrevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
            process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';
            resetMemoryIndex();

            // T-MI-1: singleton + engine label
            const a = getMemoryIndex();
            const b = getMemoryIndex();
            assert.strictEqual(a, b, 'getMemoryIndex must be a singleton');
            assert.ok(a instanceof SqliteFtsIndex, 'getMemoryIndex returns SqliteFtsIndex');
            assert.strictEqual(a.engine, loaded.db.DEFAULT_ENGINE, 'engine label matches db.DEFAULT_ENGINE');
            // Assert the literal too — `undefined === undefined` would let a db.js
            // that forgot to export DEFAULT_ENGINE pass this vacuously (it did, and
            // surfaced as `[配置/检索]: undefined` on a sqlite-mode child).
            assert.strictEqual(a.engine, 'sqlite-fts5-trigram', 'SqliteFtsIndex.engine must be the concrete engine id, not undefined');

            // T-MI-2: upsert returns numeric id, doc is immediately recallable via fts
            const idx = getMemoryIndex();
            idx.initialize();
            const { id } = idx.upsert({
                content: 'memory-index seam trigram probe zzqqxx',
                namespace: 'prose',
                timestamp: new Date().toISOString(),
            });
            assert.strictEqual(typeof id, 'number', 'upsert returns numeric id');
            const hits = idx.searchText('zzqqxx', { topK: 5 });
            assert.ok(hits.length > 0, 'upserted doc must be recallable');
            assert.strictEqual(hits[0].match_source, 'fts', 'trigram hit reports fts source');

            // T-MI-3: searchText scope filtering
            const scoped = idx.searchText('zzqqxx', { topK: 5, scope: 'prose' });
            assert.ok(scoped.every(r => r.namespace === 'prose'), 'scope filters to prose namespace');

            // T-MI-4: delete returns { changes }; missing id does not throw
            const missing = idx.delete(99999999);
            assert.strictEqual(missing.changes, 0, 'delete of missing id returns changes: 0');
            const existing = idx.delete(id);
            assert.strictEqual(existing.changes, 1, 'delete of existing id returns changes: 1');

            // T-MI-5: stats shape
            const s = idx.stats();
            for (const key of ['chunks', 'count', 'namespaces', 'first', 'last']) {
                assert.ok(key in s, `stats missing ${key}`);
            }

            if (miPrevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE; else process.env.EVO_LITE_MEMORY_ENGINE = miPrevEngine;
            resetMemoryIndex();
        }
        console.log('✅ T-MI MemoryIndex seam passed');

        console.log('T-ZV. Testing ZvecMemoryIndex (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const runtime = createTempRuntimeRoot('zvec-index');
                await bootstrapRuntime(runtime.runtimeRoot);
                const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                const idx = new ZvecMemoryIndex();
                idx.initialize();

                // round-trip + engine label
                assert.strictEqual(idx.engine, 'zvec-jieba-fts');
                const { id } = idx.upsert({ content: 'zvec seam probe memory.service recall', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
                assert.strictEqual(typeof id, 'number');
                const hits = idx.searchText('recall', { topK: 5 });
                assert.ok(hits.some(h => h.id === id), 'upserted doc recallable');
                assert.strictEqual(hits[0].match_source, 'zvec-fts');

                // colon query -> matchString fallback, no throw
                idx.upsert({ content: 'closure for task:zvec-memory-index-t2 evidence', namespace: 'prose', timestamp: '2026-07-07T00:01:00Z' });
                const colon = idx.searchText('task:zvec-memory-index-t2', { topK: 5 });
                assert.ok(colon.length > 0, 'colon query returns via matchString');
                assert.strictEqual(colon[0].match_source, 'zvec-match');

                // jieba Chinese recall
                idx.upsert({ content: '向量数据库与机器学习结合用于语义检索', namespace: 'prose', timestamp: '2026-07-07T00:02:00Z' });
                const zh = idx.searchText('机器学习', { topK: 5 });
                assert.ok(zh.length > 0, 'jieba recalls Chinese word');

                // scope filter
                idx.upsert({ content: 'code namespace doc recall', namespace: 'code', timestamp: '2026-07-07T00:03:00Z' });
                const scoped = idx.searchText('recall', { topK: 10, scope: 'code' });
                assert.ok(scoped.every(r => r.namespace === 'code'), 'scope filters to code');

                // delete changes
                assert.strictEqual(idx.delete(id).changes, 1);
                assert.strictEqual(idx.delete(9999999).changes, 0);

                // stats shape parity with SqliteFtsIndex.stats
                const s = idx.stats();
                for (const key of ['chunks', 'count', 'namespaces', 'first', 'last']) {
                    assert.ok(key in s, `stats missing ${key}`);
                }
                idx.close();
            }
        }
        console.log('✅ T-ZV ZvecMemoryIndex passed');

        console.log('T-SPACE-ENGINE. Testing verify memory-space line reports the ACTIVE index engine (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                try {
                    const runtime = createTempRuntimeRoot('verify-space-engine');
                    const loaded = await bootstrapRuntime(runtime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
                    await loaded.service.memorize('active-engine display probe: the space line must name the live index.');
                    const output = await captureConsole(async () => {
                        await loaded.service.verify();
                    });
                    const spaceLines = output.split('\n').filter(l => l.includes('ns=') && l.includes('engine='));
                    assert.ok(spaceLines.length > 0, 'verify should emit a memory-space distribution line');
                    assert.ok(spaceLines.some(l => l.includes('engine=zvec-jieba-fts')),
                        'memory-space line must report the ACTIVE engine (zvec-jieba-fts), not the SQLite _meta model');
                    assert.ok(!spaceLines.some(l => l.includes('engine=sqlite-fts5-trigram')),
                        'memory-space line must NOT show the SQLite shadow engine when zvec is live');
                } finally {
                    if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                    else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
                }
            }
        }
        console.log('✅ T-SPACE-ENGINE verify active-engine display passed');

        console.log('T-CONFIG-RETRIEVAL. Testing verify [配置/检索] line names the ACTIVE retrieval engine (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                try {
                    const runtime = createTempRuntimeRoot('verify-config-retrieval');
                    const loaded = await bootstrapRuntime(runtime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
                    await loaded.service.memorize('config-retrieval display probe: the top line must name the live engine.');
                    const output = await captureConsole(async () => {
                        await loaded.service.verify();
                    });
                    const cfgLines = output.split('\n').filter(l => l.includes('[配置/检索]'));
                    assert.ok(cfgLines.length > 0, 'verify should emit a [配置/检索] line');
                    assert.ok(cfgLines.some(l => l.includes('zvec-jieba-fts')),
                        '[配置/检索] must name the ACTIVE retrieval engine (zvec-jieba-fts), not the stale models.js constant');
                    assert.ok(!cfgLines.some(l => l.includes('sqlite-fts5-trigram')),
                        '[配置/检索] must NOT show the SQLite shadow engine when zvec is the live retrieval engine');
                } finally {
                    if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                    else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
                }
            }
        }
        // sqlite-mode sub-case: ALWAYS runs (no zvec dep). Guards the concrete
        // engine id in the [配置/检索] line — a sqlite-mode or zvec-degraded child
        // showed `undefined` here when db.js failed to export DEFAULT_ENGINE.
        {
            const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
            process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';
            try {
                const runtime = createTempRuntimeRoot('verify-config-retrieval-sqlite');
                const loaded = await bootstrapRuntime(runtime.runtimeRoot, { EVO_LITE_SKIP_GIT_STATUS: '1' });
                await loaded.service.memorize('config-retrieval sqlite probe: the top line must name a concrete engine.');
                const output = await captureConsole(async () => {
                    await loaded.service.verify();
                });
                const cfgLines = output.split('\n').filter(l => l.includes('[配置/检索]'));
                assert.ok(cfgLines.length > 0, 'verify should emit a [配置/检索] line');
                assert.ok(cfgLines.some(l => l.includes('sqlite-fts5-trigram')),
                    '[配置/检索] must name the concrete sqlite engine when sqlite is active');
                assert.ok(!cfgLines.some(l => l.includes('undefined')),
                    '[配置/检索] must never render undefined (db.js must export DEFAULT_ENGINE)');
            } finally {
                if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
            }
        }
        console.log('✅ T-CONFIG-RETRIEVAL verify retrieval-engine display passed');

        console.log('T-ENGINE. Testing engine selection + fallback ...');
        {
            const { selectEngine, resolveEngine, resolveActiveImpl, SqliteFtsIndex } = require(path.join(CLI_DIR, 'memory-index.js'));

            // default: no zvec
            assert.ok(selectEngine('sqlite-fts5-trigram') instanceof SqliteFtsIndex, 'default is SqliteFtsIndex');

            // zvec configured but unavailable -> fall back to SqliteFtsIndex
            const fallback = selectEngine('zvec', () => null);
            assert.ok(fallback instanceof SqliteFtsIndex, 'zvec-unavailable falls back to SqliteFtsIndex');

            // zvec configured + available (fake class) -> uses it
            class FakeZvec { get engine() { return 'zvec-jieba-fts'; } }
            const picked = selectEngine('zvec', () => FakeZvec);
            assert.strictEqual(picked.engine, 'zvec-jieba-fts', 'zvec-available is used');

            // env overrides json config
            const prev = process.env.EVO_LITE_MEMORY_ENGINE;
            process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
            assert.strictEqual(resolveEngine(), 'zvec', 'env overrides config');
            if (prev === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE; else process.env.EVO_LITE_MEMORY_ENGINE = prev;

            // default flipped: the module constant is now zvec
            const { DEFAULT_ENGINE_CHOICE } = require(path.join(CLI_DIR, 'memory-index.js'));
            assert.strictEqual(DEFAULT_ENGINE_CHOICE, 'zvec', 'default engine flipped to zvec');
            // a depless instance still degrades to SqliteFtsIndex (children-not-forced holds under the flip)
            const deplessDefault = selectEngine(DEFAULT_ENGINE_CHOICE, () => null);
            assert.ok(deplessDefault instanceof SqliteFtsIndex, 'depless default falls back to SqliteFtsIndex');

            assert.strictEqual(typeof resolveActiveImpl, 'function', 'resolveActiveImpl must be exported');
            const activePrev = process.env.EVO_LITE_MEMORY_ENGINE;
            process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
            try {
                assert.deepStrictEqual(
                    resolveActiveImpl(() => null),
                    { choice: 'zvec', impl: 'sqlite', degraded: true },
                    'zvec choice with absent dep reports sqlite degradation'
                );
                class FakeActiveZvec {}
                assert.deepStrictEqual(
                    resolveActiveImpl(() => FakeActiveZvec),
                    { choice: 'zvec', impl: 'zvec', degraded: false },
                    'zvec choice with available dep reports active zvec impl'
                );
            } finally {
                if (activePrev === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                else process.env.EVO_LITE_MEMORY_ENGINE = activePrev;
            }
        }
        console.log('✅ T-ENGINE selection passed');

        console.log('T-ENGINE-DEGRADE-WARN. Testing verify surfaces zvec-to-sqlite degradation ...');
        {
            const warningNeedle = '⚠️ [引擎降级]';
            async function captureVerifyWithEngine(label, engine, patchMemoryIndex) {
                const runtime = createTempRuntimeRoot(label);
                await bootstrapRuntime(runtime.runtimeRoot, {
                    EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
                    EVO_LITE_SKIP_GIT_STATUS: '1',
                });
                try { require(path.join(CLI_DIR, 'memory-index.js')).getMemoryIndex().close(); } catch (_) {}
                try { require(path.join(CLI_DIR, 'db.js')).closeDb(); } catch (_) {}

                resetCliModuleCache();
                process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
                process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
                process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
                process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;
                process.env.EVO_LITE_MEMORY_ENGINE = engine;
                process.env.EVO_LITE_SKIP_GIT_STATUS = '1';

                const memoryIndex = require(path.join(CLI_DIR, 'memory-index.js'));
                if (patchMemoryIndex) patchMemoryIndex(memoryIndex);
                const service = require(path.join(CLI_DIR, 'memory.service.js'));
                return captureConsole(async () => {
                    await service.verify();
                });
            }

            const degradedOutput = await captureVerifyWithEngine('verify-engine-degraded', 'zvec', memoryIndex => {
                const realResolveActiveImpl = memoryIndex.resolveActiveImpl;
                const realSelectEngine = memoryIndex.selectEngine;
                let singleton = null;
                memoryIndex.resolveActiveImpl = () => realResolveActiveImpl(() => null);
                memoryIndex.getMemoryIndex = () => {
                    if (!singleton) singleton = realSelectEngine('zvec', () => null);
                    return singleton;
                };
                memoryIndex.resetMemoryIndex = () => {
                    try { if (singleton && typeof singleton.close === 'function') singleton.close(); } catch (_) {}
                    singleton = null;
                };
            });
            assert.ok(degradedOutput.includes(warningNeedle), 'verify must warn when zvec choice degrades to sqlite');
            assert.ok(degradedOutput.includes('@zvec/zvec'), 'degradation warning must name missing @zvec/zvec dependency');
            assert.ok(degradedOutput.includes('memory-engine.json') && degradedOutput.includes('sqlite-fts5-trigram'), 'degradation warning must name sqlite pin fix');
            assert.ok(degradedOutput.includes('npm i @zvec/zvec') && degradedOutput.includes('rebuild'),
                'degradation warning must give the concrete zvec enable steps (install + rebuild)');

            async function captureRebuildWithDegradedEngine() {
                const runtime = createTempRuntimeRoot('rebuild-engine-degraded-warn');
                const seeded = await bootstrapRuntime(runtime.runtimeRoot, {
                    EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
                    EVO_LITE_SKIP_GIT_STATUS: '1',
                });
                await seeded.service.archive('rebuild degradation warning fixture must be written once', 'task', {
                    id: 'rebuild-degraded-warn',
                    timestamp: '2026-07-08T00:10:00Z',
                    silent: true,
                });
                try { require(path.join(CLI_DIR, 'memory-index.js')).getMemoryIndex().close(); } catch (_) {}
                try { require(path.join(CLI_DIR, 'db.js')).closeDb(); } catch (_) {}
                fs.rmSync(path.join(runtime.runtimeRoot, 'index_memory'), { recursive: true, force: true });

                resetCliModuleCache();
                process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
                process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
                process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
                process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                process.env.EVO_LITE_SKIP_GIT_STATUS = '1';

                const memoryIndex = require(path.join(CLI_DIR, 'memory-index.js'));
                const realResolveActiveImpl = memoryIndex.resolveActiveImpl;
                const realSelectEngine = memoryIndex.selectEngine;
                let singleton = null;
                memoryIndex.resolveActiveImpl = () => realResolveActiveImpl(() => null);
                memoryIndex.getMemoryIndex = () => {
                    if (!singleton) singleton = realSelectEngine('zvec', () => null);
                    return singleton;
                };
                memoryIndex.resetMemoryIndex = () => {
                    try { if (singleton && typeof singleton.close === 'function') singleton.close(); } catch (_) {}
                    singleton = null;
                };

                const service = require(path.join(CLI_DIR, 'memory.service.js'));
                return captureConsole(async () => {
                    await service.rebuildLocalIndex();
                });
            }

            const rebuildOutput = await captureRebuildWithDegradedEngine();
            const verifyWarn = degradedOutput.split('\n').find(line => line.includes(warningNeedle));
            const rebuildWarn = rebuildOutput.split('\n').find(line => line.includes(warningNeedle));
            assert.ok(rebuildWarn, 'rebuild must warn when zvec choice degrades to sqlite');
            assert.strictEqual(rebuildWarn, verifyWarn, 'verify and rebuild must emit the same engine degradation warning');

            const matchedOutput = await captureVerifyWithEngine('verify-engine-matched', 'sqlite-fts5-trigram');
            assert.ok(!matchedOutput.includes(warningNeedle), 'verify must not warn when choice and impl match');

            delete process.env.EVO_LITE_SKIP_GIT_STATUS;
            process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';
            resetCliModuleCache();
        }
        console.log('✅ T-ENGINE-DEGRADE-WARN verify warning passed');

        console.log('T-LIST. Testing list() routes through the seam ...');
        {
            const { SqliteFtsIndex } = require(path.join(CLI_DIR, 'memory-index.js'));
            const runtime = createTempRuntimeRoot('list-seam');
            await bootstrapRuntime(runtime.runtimeRoot);
            const sq = new SqliteFtsIndex();
            sq.initialize();
            sq.upsert({ content: 'list seam sqlite doc', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
            const sqList = sq.list();
            assert.ok(Array.isArray(sqList) && sqList.length >= 1, 'SqliteFtsIndex.list() returns rows');
            for (const key of ['id', 'content', 'namespace', 'timestamp']) {
                assert.ok(key in sqList[0], `sqlite list row missing ${key}`);
            }
            assert.strictEqual(typeof sqList[0].id, 'number', 'sqlite list id is a number');

            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (zvecAvailable) {
                const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                const zi = new ZvecMemoryIndex();
                zi.initialize();
                zi.upsert({ content: 'list seam zvec doc', namespace: 'prose', timestamp: '2026-07-07T00:00:00Z' });
                const zList = zi.list();
                assert.ok(Array.isArray(zList) && zList.length >= 1, 'ZvecMemoryIndex.list() returns rows');
                for (const key of ['id', 'content', 'namespace', 'timestamp']) {
                    assert.ok(key in zList[0], `zvec list row missing ${key}`);
                }
                assert.strictEqual(typeof zList[0].id, 'number', 'zvec list id is a number');
                zi.close();
            } else {
                console.log('   ⏭️ zvec list() subtest skipped — @zvec/zvec not installed');
            }
        }
        console.log('✅ T-LIST passed');

        console.log('T-REBUILD-ZVEC. Testing engine-aware rebuild (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const runtime = createTempRuntimeRoot('rebuild-zvec');
                await bootstrapRuntime(runtime.runtimeRoot);
                const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                try {
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory-index.js'))];
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory.service.js'))];
                    const svc = require(path.join(CLI_DIR, 'memory.service.js'));
                    const mi = require(path.join(CLI_DIR, 'memory-index.js'));

                    // Archive a doc — writes raw_memory/*.md AND upserts into the zvec engine.
                    await svc.archive('rebuild probe doc mentioning memory.service recall', 'task');
                    assert.strictEqual(mi.getMemoryIndex().stats().count, 1, 'one doc in zvec pre-rebuild');
                    assert.ok(mi.getMemoryIndex().searchText('rebuild probe', { topK: 5 }).length > 0, 'doc recallable pre-rebuild');

                    // Engine-aware rebuild: wipes .evo-lite/zvec, repopulates from raw_memory/*.md.
                    await svc.rebuildLocalIndex();

                    // Wipe proof: still exactly one doc (a no-wipe rebuild would double it to 2).
                    assert.strictEqual(mi.getMemoryIndex().stats().count, 1, 'exactly one doc after wipe+rebuild (not doubled)');
                    const after = mi.getMemoryIndex().searchText('rebuild probe', { topK: 5 });
                    assert.ok(after.length > 0, 'doc still recallable after zvec rebuild (repopulated from archive)');
                } finally {
                    // Release the collection lock so later tests can open a zvec collection.
                    try { require(path.join(CLI_DIR, 'memory-index.js')).getMemoryIndex().close(); } catch (_) {}
                    if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE; else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory-index.js'))];
                    delete require.cache[require.resolve(path.join(CLI_DIR, 'memory.service.js'))];
                }
            }
        }
        console.log('✅ T-REBUILD-ZVEC passed');

        console.log('T-AB. Testing memory-ab wiring + graded rubric ...');
        {
            const ab = require(path.join(CLI_DIR, 'memory-ab.js'));
            assert.ok(Array.isArray(ab.BUILTIN_QUERIES) && ab.BUILTIN_QUERIES.includes('R008'), 'builtin query set present');
            assert.strictEqual(typeof ab.runMemoryAb, 'function', 'runMemoryAb exported');
            assert.strictEqual(typeof ab.gradeHits, 'function', 'gradeHits exported');

            // gradeHits: ground truth = literal substring containment on r.content.
            const g = ab.gradeHits(
                [{ content: 'about memory.service.js recall' }, { content: 'unrelated doc' }],
                'memory.service'
            );
            assert.strictEqual(g.hit, true, 'gradeHits reports a hit when a returned doc contains the query');
            assert.strictEqual(g.onTopic, 1, 'gradeHits counts on-topic docs');
            assert.ok(Math.abs(g.precision - 0.5) < 1e-9, 'gradeHits precision = onTopic / returned');
            const gMiss = ab.gradeHits([{ content: 'nothing here' }], 'R008');
            assert.strictEqual(gMiss.hit, false, 'gradeHits reports a miss when no returned doc contains the query');

            // With @zvec present this rebuilds + compares + grades; without it returns { rows: [], graded: null }.
            const res = await ab.runMemoryAb({ fromLogs: false });
            assert.ok(res && Array.isArray(res.rows), 'runMemoryAb returns rows array');
            if (res.graded) {
                assert.ok(Array.isArray(res.graded.rows), 'graded.rows is an array');
                for (const r of res.graded.rows) {
                    for (const key of ['hit', 'precision', 'returned', 'onTopic']) {
                        assert.ok(key in r.sqlite && key in r.zvec, `graded row missing ${key}`);
                    }
                }
                assert.ok(res.graded.zvecHitRate === null || (res.graded.zvecHitRate >= 0 && res.graded.zvecHitRate <= 1), 'zvecHitRate in [0,1] or null');
            }
        }
        console.log('✅ T-AB memory-ab passed');

        await runChildRuntimeTests();

        console.log('--- Governance-focused CLI tests passed! ---');
    } catch (error) {
        console.error('❌ Governance test failed:', error);
        throw error;
    }
}

// Tests safe to run inside a child hive: they build their own temp mother/child
// fixtures and never touch the repo's templates/ tree. Tasks 3-5 append here.
async function runChildRuntimeTests() {
    console.log('T-hive-feedback. Testing outbox grammar parse/mark ...');
    {
        const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
        const text = '# Outbox\n\n- [ ] [stderr-eaten] context track errors invisible\n- [x] [old1] already collected\n- [ ] no label line\nnot a checkbox\n';
        const items = fb.parseFeedback(text);
        assert.strictEqual(items.length, 3, 'three checkbox lines parsed');
        assert.deepStrictEqual(
            items.map(i => [i.checked, i.label]),
            [[false, 'stderr-eaten'], [true, 'old1'], [false, null]],
            'checked state and labels extracted');
        assert.strictEqual(items[0].text, 'context track errors invisible');

        const marked = fb.markCollected(text, [items[0].line]);
        assert.ok(marked.includes('- [x] [stderr-eaten]'), 'collected line checked');
        assert.ok(marked.includes('- [ ] no label line'), 'unlisted line untouched');
        assert.ok(marked.includes('# Outbox'), 'non-checkbox content preserved');

        const tmpChild = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-fb-'));
        const missing = fb.readOutbox(tmpChild);
        assert.strictEqual(missing.exists, false);
        assert.deepStrictEqual(missing.pending, [], 'missing outbox → zero pending');
        fs.mkdirSync(path.dirname(fb.feedbackPath(tmpChild)), { recursive: true });
        fs.writeFileSync(fb.feedbackPath(tmpChild), text);
        const box = fb.readOutbox(tmpChild);
        assert.strictEqual(box.exists, true);
        assert.strictEqual(box.pending.length, 2, 'only unchecked items pending');
        assert.strictEqual(box.pending[0].label, 'stderr-eaten');
    }
    console.log('✅ T-hive-feedback passed');

    console.log('T-hive-registry. Testing child registry round-trip + guards ...');
    {
        const reg = require(path.join(CLI_DIR, 'hive', 'registry.js'));
        assert.strictEqual(reg.validChildId('snake-game.v2'), true, 'normal id valid');
        assert.strictEqual(reg.validChildId('a/b'), false, 'path separator rejected');
        assert.strictEqual(reg.validChildId('a\\b'), false, 'backslash rejected');
        assert.strictEqual(reg.validChildId('a..b'), false, 'dotdot rejected');

        const mother = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hive-mother-'));
        const child = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hive-child-'));
        fs.mkdirSync(path.join(child, '.evo-lite', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(child, '.evo-lite', 'package.json'), '{"version":"2.0.8","dependencies":{}}');

        const e1 = reg.registerChild(mother, child, { id: 'kid-a', now: () => '2026-07-03T00:00:00.000Z' });
        assert.strictEqual(e1.id, 'kid-a');
        assert.strictEqual(e1.registeredAt, '2026-07-03T00:00:00.000Z');
        const stored = reg.readRegistry(mother);
        assert.strictEqual(stored.version, 'evo-hive-registry@1');
        assert.strictEqual(stored.children.length, 1);

        reg.registerChild(mother, child, { id: 'kid-a' }); // upsert, not duplicate
        assert.strictEqual(reg.readRegistry(mother).children.length, 1, 're-register updates in place');
        assert.ok(reg.findChild(mother, 'kid-a'), 'findChild resolves');

        assert.throws(() => reg.registerChild(mother, os.tmpdir(), { id: 'not-a-child' }), /\.evo-lite/, 'non-child path rejected');
        assert.throws(() => reg.registerChild(mother, child, { id: 'bad/id' }), /invalid/i, 'invalid id rejected');
    }
    console.log('✅ T-hive-registry passed');

    console.log('T-hive-guard. Testing hive commands are mother-only ...');
    {
        const { isMotherRoot } = require(path.join(CLI_DIR, 'hive', 'commands.js'));
        if (!require('./harness').IS_CHILD_RUNTIME) assert.strictEqual(isMotherRoot(WORKSPACE_ROOT), true, 'this repo is a mother');
        const notMother = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hive-notmother-'));
        assert.strictEqual(isMotherRoot(notMother), false, 'dir without templates/cli is not a mother');
    }
    console.log('✅ T-hive-guard passed');

    console.log('T-hive-status. Testing per-child status verdicts ...');
    {
        const reg = require(path.join(CLI_DIR, 'hive', 'registry.js'));
        const { childStatus } = require(path.join(CLI_DIR, 'hive', 'status.js'));
        const FAM = [{ key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] }];

        const mother = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hs-mother-'));
        fs.mkdirSync(path.join(mother, 'templates', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(mother, 'package.json'), '{"version":"9.9.9"}');
        fs.writeFileSync(path.join(mother, 'templates', 'cli', 'gene.js'), 'module.exports = 1;\n');

        const mkChild = version => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hs-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'package.json'), JSON.stringify({ version, dependencies: {} }));
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            return c;
        };

        const upToDate = childStatus(mother, { id: 'a', path: mkChild('9.9.9') }, { familiesOverride: FAM });
        assert.strictEqual(upToDate.status, 'up-to-date');

        const behind = childStatus(mother, { id: 'b', path: mkChild('9.0.0') }, { familiesOverride: FAM });
        assert.strictEqual(behind.status, 'behind');
        assert.strictEqual(behind.childVersion, '9.0.0');

        const driftedChild = mkChild('9.9.9');
        fs.writeFileSync(path.join(driftedChild, '.evo-lite', 'cli', 'gene.js'), '// hand-edited\n');
        const drifted = childStatus(mother, { id: 'c', path: driftedChild }, { familiesOverride: FAM });
        assert.strictEqual(drifted.status, 'drifted');
        assert.deepStrictEqual(drifted.driftedFiles, ['gene.js'], 'drift names the file');

        const gone = childStatus(mother, { id: 'd', path: path.join(os.tmpdir(), 'evo-hs-gone-' + Date.now()) }, { familiesOverride: FAM });
        assert.strictEqual(gone.status, 'unreachable');
        assert.deepStrictEqual(gone.feedback, [], 'unreachable child reports empty feedback');

        // feedback surfaces read-only in status
        const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
        const fbChild = mkChild('9.9.9');
        fs.mkdirSync(path.dirname(fb.feedbackPath(fbChild)), { recursive: true });
        const outboxText = '- [ ] [st1] status sees me\n- [x] [st0] collected already\n';
        fs.writeFileSync(fb.feedbackPath(fbChild), outboxText);
        const st = childStatus(mother, { id: 'e', path: fbChild }, { familiesOverride: FAM });
        assert.deepStrictEqual(st.feedback, [{ label: 'st1', text: 'status sees me' }], 'status reports pending feedback');
        assert.strictEqual(fs.readFileSync(fb.feedbackPath(fbChild), 'utf8'), outboxText, 'status never writes the outbox');
    }
    console.log('✅ T-hive-status passed');

    console.log('T-hive-nurture. Testing gene push: genes-only, dry-run, family, anchors, receipt, all-or-nothing ...');
    {
        const { nurtureChild, mergeAnchoredContent } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
        const { sha256 } = require(path.join(CLI_DIR, 'hive', 'status.js'));
        const noGit = () => { throw new Error('not a git repo'); };

        // anchor merge is pure — test first
        const motherDoc = '# Doc\n<!-- BEGIN_LOCAL -->\n(mother default)\n<!-- END_LOCAL -->\ntail v2\n';
        const childDoc = '# Doc\n<!-- BEGIN_LOCAL -->\nchild custom kept\n<!-- END_LOCAL -->\ntail v1\n';
        const merged = mergeAnchoredContent(motherDoc, childDoc, [['BEGIN_LOCAL', 'END_LOCAL']]);
        assert.ok(merged.includes('child custom kept'), 'child anchor content preserved');
        assert.ok(merged.includes('tail v2'), 'mother body outside anchors wins');

        const FAM = [
            { key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] },
            { key: 'agents-workflows', scope: 'sync-always', activeRoot: 'workspace', templateRoot: 'root', relativeDir: ['.agents', 'workflows'],
              files: [{ path: 'evo.md', mergeAnchors: [['BEGIN_LOCAL', 'END_LOCAL']] }] },
        ];

        const mkMother = () => {
            const m = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hn-mother-'));
            fs.writeFileSync(path.join(m, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(m, 'templates', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(m, 'templates', '.agents', 'workflows'), { recursive: true });
            fs.mkdirSync(path.join(m, 'templates', 'runtime'), { recursive: true });
            fs.writeFileSync(path.join(m, 'templates', 'cli', 'gene.js'), 'module.exports = 2;\n');
            fs.writeFileSync(path.join(m, 'templates', '.agents', 'workflows', 'evo.md'), motherDoc);
            fs.writeFileSync(path.join(m, 'templates', 'runtime', 'package.json'),
                '{"dependencies":{"commander":"15.0.0","@modelcontextprotocol/sdk":"1.29.0"}}');
            return m;
        };
        const mkChild = () => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hn-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(c, '.agents', 'workflows'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'package.json'), '{"version":"9.0.0","dependencies":{"commander":"^14.0.3"}}');
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            fs.writeFileSync(path.join(c, '.agents', 'workflows', 'evo.md'), childDoc);
            fs.writeFileSync(path.join(c, '.evo-lite', 'active_context.md'), 'CHILD STATE\n');
            return c;
        };

        const listChildFiles = root => {
            const out = [];
            const walk = dir => {
                for (const name of fs.readdirSync(dir)) {
                    const full = path.join(dir, name);
                    const rel = path.relative(root, full).replace(/\\/g, '/');
                    if (fs.statSync(full).isDirectory()) walk(full);
                    else out.push(rel);
                }
            };
            walk(root);
            return out.sort();
        };

        // engine-readiness preflight is report-only: no child state/deps/db writes
        {
            const m = mkMother(); const c = mkChild();
            const beforeFiles = listChildFiles(c);
            const dryReport = nurtureChild(m, { id: 'engine-kid', path: c }, { dryRun: true, exec: noGit, force: true, familiesOverride: FAM });
            assert.ok(dryReport.engineReadiness, 'nurture dry-run must report engineReadiness');
            assert.strictEqual(dryReport.engineReadiness.childChoice, 'zvec', 'default pushed child choice should be zvec');
            assert.strictEqual(dryReport.engineReadiness.depPresent, false, 'synthetic child has no @zvec/zvec dep');
            assert.ok(dryReport.engineReadiness.recommendation, 'engineReadiness should include a recommendation');
            assert.ok(dryReport.engineReadiness.recommendation.includes('@zvec/zvec'), 'recommendation names zvec dep install');
            assert.ok(dryReport.engineReadiness.recommendation.includes('memory-engine.json'), 'recommendation names sqlite pin');
            assert.deepStrictEqual(listChildFiles(c), beforeFiles, 'engine-readiness dry-run probe must not write child files');
            assert.ok(!fs.existsSync(path.join(c, '.evo-lite', 'memory-engine.json')), 'nurture probe must not write child memory-engine.json');
            assert.ok(!fs.existsSync(path.join(c, '.evo-lite', 'memory.db')), 'nurture probe must not write child memory.db');
            assert.ok(!fs.existsSync(path.join(c, '.evo-lite', 'raw_memory')), 'nurture probe must not write child raw_memory');
            assert.ok(!fs.existsSync(path.join(c, '.evo-lite', 'index_memory')), 'nurture probe must not write child index_memory');
        }

        // dry-run writes nothing
        const m1 = mkMother(); const c1 = mkChild(); const e1 = { id: 'kid', path: c1 };
        const before = sha256(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js')));
        const dry = nurtureChild(m1, e1, { dryRun: true, exec: noGit, force: true, familiesOverride: FAM });
        assert.strictEqual(dry.status, 'dry-run');
        assert.ok(dry.copied.includes('gene.js'), 'dry-run reports pending copy');
        assert.deepStrictEqual(dry.depGap.missing, ['@modelcontextprotocol/sdk'], 'dep gap named');
        assert.strictEqual(sha256(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'))), before, 'dry-run wrote nothing');

        // apply: genes copied, anchors merged, state untouched, receipt + lock + bump + registry
        const regMod = require(path.join(CLI_DIR, 'hive', 'registry.js'));
        fs.mkdirSync(path.join(m1, '.evo-lite', 'hive'), { recursive: true });
        regMod.writeRegistry(m1, { version: 'evo-hive-registry@1', children: [{ id: 'kid', path: c1.replace(/\\/g, '/'), registeredAt: 'x', lastNurturedAt: null, lastNurturedVersion: null }] });
        const applied = nurtureChild(m1, e1, { exec: noGit, force: true, familiesOverride: FAM, now: () => '2026-07-03T01:00:00.000Z' });
        assert.strictEqual(applied.status, 'applied');
        assert.strictEqual(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'utf8'), 'module.exports = 2;\n', 'gene updated');
        const mergedOut = fs.readFileSync(path.join(c1, '.agents', 'workflows', 'evo.md'), 'utf8');
        assert.ok(mergedOut.includes('child custom kept') && mergedOut.includes('tail v2'), 'anchor-merge applied on push');
        assert.strictEqual(fs.readFileSync(path.join(c1, '.evo-lite', 'active_context.md'), 'utf8'), 'CHILD STATE\n', 'project state untouched');
        const receipt = JSON.parse(fs.readFileSync(path.join(c1, '.evo-lite', 'hive', 'nurture-received.json'), 'utf8'));
        assert.strictEqual(receipt.motherVersion, '9.9.9');
        assert.ok(receipt.files.includes('gene.js'), 'receipt lists files');
        assert.ok(fs.existsSync(path.join(c1, '.evo-lite', 'generated', 'runtime-mirror.lock.json')), 'child lock written');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(c1, '.evo-lite', 'package.json'), 'utf8')).version, '9.0.0', 'runtime manifest version MUST be untouched by nurture');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(c1, '.evo-lite', 'evo-lite-version.json'), 'utf8')).version, '9.9.9', 'product version file bumped');
        assert.strictEqual(regMod.findChild(m1, 'kid').lastNurturedVersion, '9.9.9', 'mother registry updated');

        // family filter: only selected family written
        const m2 = mkMother(); const c2 = mkChild();
        nurtureChild(m2, { id: 'k2', path: c2 }, { exec: noGit, force: true, family: 'agents-workflows', familiesOverride: FAM });
        assert.strictEqual(fs.readFileSync(path.join(c2, '.evo-lite', 'cli', 'gene.js'), 'utf8'), 'module.exports = 1;\n', 'other family untouched');
        assert.ok(fs.readFileSync(path.join(c2, '.agents', 'workflows', 'evo.md'), 'utf8').includes('tail v2'), 'selected family pushed');

        // all-or-nothing: missing mother source → zero writes
        const m3 = mkMother(); const c3 = mkChild();
        fs.rmSync(path.join(m3, 'templates', 'cli', 'gene.js'));
        const aborted = nurtureChild(m3, { id: 'k3', path: c3 }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.strictEqual(aborted.status, 'aborted');
        assert.deepStrictEqual(aborted.missingSources, ['gene.js']);
        assert.strictEqual(fs.readFileSync(path.join(c3, '.agents', 'workflows', 'evo.md'), 'utf8'), childDoc, 'zero writes on abort');
        assert.ok(!fs.existsSync(path.join(c3, '.evo-lite', 'hive', 'nurture-received.json')), 'no receipt on abort');

        // dirty child without --force refused; rollback tag when clean git
        const m4 = mkMother(); const c4 = mkChild();
        const fakeGit = calls => (args, cwd) => {
            calls.push(args.join(' '));
            if (args[0] === 'status') return ' M .evo-lite/cli/gene.js\n';
            return '';
        };
        const dirtyCalls = [];
        const refused = nurtureChild(m4, { id: 'k4', path: c4 }, { exec: fakeGit(dirtyCalls), familiesOverride: FAM });
        assert.strictEqual(refused.status, 'refused');
        assert.ok(refused.dirtyFiles.length > 0, 'dirty files named');
        const cleanCalls = [];
        const cleanGit = (args, cwd) => { cleanCalls.push(args.join(' ')); return args[0] === 'status' ? '' : ''; };
        const tagged = nurtureChild(m4, { id: 'k4', path: c4 }, { exec: cleanGit, familiesOverride: FAM, now: () => '2026-07-03T01:00:00.000Z' });
        assert.strictEqual(tagged.status, 'applied');
        assert.strictEqual(tagged.tag, 'evo-nurture-pre-9.9.9-20260703T010000', 'rollback tag carries a timestamp');
        assert.ok(cleanCalls.some(c => c.startsWith('tag -a evo-nurture-pre-9.9.9-20260703T010000')), 'rollback tag created');

        // same-version re-nurture gets a DISTINCT rollback point (no tag collision)
        const cleanCalls2 = [];
        const cleanGit2 = (args, cwd) => { cleanCalls2.push(args.join(' ')); return ''; };
        const tagged2 = nurtureChild(m4, { id: 'k4', path: c4 }, { exec: cleanGit2, familiesOverride: FAM, now: () => '2026-07-03T02:00:00.000Z' });
        assert.strictEqual(tagged2.status, 'applied');
        assert.strictEqual(tagged2.tag, 'evo-nurture-pre-9.9.9-20260703T020000', 're-nurture at same mother version mints a fresh tag');
        assert.notStrictEqual(tagged2.tag, tagged.tag, 'same-version tags must not collide');
    }
    console.log('✅ T-hive-nurture passed');

    console.log('T-hive-outbox. Testing feedback collection: report, exactly-once, dry-run purity, scaffold ...');
    {
        const { nurtureChild } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
        const fb = require(path.join(CLI_DIR, 'hive', 'feedback.js'));
        const noGit = () => { throw new Error('not a git repo'); };
        const FAM = [{ key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] }];
        const mkMother = () => {
            const m = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ob-mother-'));
            fs.writeFileSync(path.join(m, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(m, 'templates', 'cli'), { recursive: true });
            fs.writeFileSync(path.join(m, 'templates', 'cli', 'gene.js'), 'module.exports = 2;\n');
            return m;
        };
        const mkChild = () => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-ob-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            return c;
        };

        // (a) outbox with 2 pending items: reported + marked checked on apply
        const m = mkMother(); const c = mkChild();
        fs.mkdirSync(path.dirname(fb.feedbackPath(c)), { recursive: true });
        fs.writeFileSync(fb.feedbackPath(c),
            '# Outbox\n- [ ] [fb1] first friction\n- [ ] [fb2] second friction\n- [x] [done] old\n');
        const dry = nurtureChild(m, { id: 'k', path: c }, { dryRun: true, exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(dry.feedback.map(f => f.label), ['fb1', 'fb2'], 'dry-run reports pending feedback');
        assert.ok(fs.readFileSync(fb.feedbackPath(c), 'utf8').includes('- [ ] [fb1]'), 'dry-run does not mark');

        const applied = nurtureChild(m, { id: 'k', path: c }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.strictEqual(applied.status, 'applied');
        assert.deepStrictEqual(applied.feedback.map(f => f.label), ['fb1', 'fb2'], 'apply reports pending feedback');
        const after = fs.readFileSync(fb.feedbackPath(c), 'utf8');
        assert.ok(after.includes('- [x] [fb1]') && after.includes('- [x] [fb2]'), 'collected items checked in child');

        // (b) exactly-once: second nurture reports zero
        const again = nurtureChild(m, { id: 'k', path: c }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(again.feedback, [], 'second nurture collects nothing');

        // (c) child without outbox: zero feedback + scaffolded on apply
        const c2 = mkChild();
        const applied2 = nurtureChild(m, { id: 'k2', path: c2 }, { exec: noGit, force: true, familiesOverride: FAM });
        assert.deepStrictEqual(applied2.feedback, [], 'missing outbox → no feedback');
        assert.ok(fs.existsSync(fb.feedbackPath(c2)), 'outbox scaffolded on apply');
        assert.ok(fs.readFileSync(fb.feedbackPath(c2), 'utf8').includes('Hive Feedback Outbox'), 'scaffold uses template');
    }
    console.log('✅ T-hive-outbox passed');

    console.log('T-hive-mutation. Testing lock-checksum mutation detection: refuse, force, anchored exempt, lockless WARN ...');
    {
        const { nurtureChild } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
        const cleanGit = () => '';
        const FAM = [
            { key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['gene.js'] },
            { key: 'agents-workflows', scope: 'sync-always', activeRoot: 'workspace', templateRoot: 'root', relativeDir: ['.agents', 'workflows'],
              files: [{ path: 'evo.md', mergeAnchors: [['BEGIN_LOCAL', 'END_LOCAL']] }] },
        ];
        const mkMother = (geneBody) => {
            const m = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mu-mother-'));
            fs.writeFileSync(path.join(m, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(m, 'templates', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(m, 'templates', '.agents', 'workflows'), { recursive: true });
            fs.writeFileSync(path.join(m, 'templates', 'cli', 'gene.js'), geneBody);
            fs.writeFileSync(path.join(m, 'templates', '.agents', 'workflows', 'evo.md'),
                '<!-- BEGIN_LOCAL -->\nmother default\n<!-- END_LOCAL -->\nbody v2\n');
            return m;
        };
        const mkChild = () => {
            const c = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mu-child-'));
            fs.mkdirSync(path.join(c, '.evo-lite', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(c, '.agents', 'workflows'), { recursive: true });
            fs.writeFileSync(path.join(c, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 1;\n');
            fs.writeFileSync(path.join(c, '.agents', 'workflows', 'evo.md'),
                '<!-- BEGIN_LOCAL -->\nchild custom\n<!-- END_LOCAL -->\nbody v1\n');
            return c;
        };

        // (a) lockless legacy child: WARN flag, still applies
        const m1 = mkMother('module.exports = 2;\n'); const c1 = mkChild();
        const first = nurtureChild(m1, { id: 'k', path: c1 }, { exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(first.status, 'applied');
        assert.strictEqual(first.lockMissing, true, 'no lock yet → lockMissing WARN flag');
        assert.deepStrictEqual(first.mutations, [], 'no mutation verdict without a lock');

        // (b) committed child edit (clean porcelain) after a locked nurture → refused, child untouched
        const m2 = mkMother('module.exports = 3;\n');
        fs.writeFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 99; // child patch\n');
        const refused = nurtureChild(m2, { id: 'k', path: c1 }, { exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(refused.status, 'refused');
        assert.deepStrictEqual(refused.mutations, ['gene.js'], 'mutated gene named');
        assert.strictEqual(refused.lockMissing, false);
        assert.ok(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'utf8').includes('99'), 'child file untouched on refuse');

        // (c) dry-run surfaces the mutation without applying
        const dry = nurtureChild(m2, { id: 'k', path: c1 }, { dryRun: true, exec: cleanGit, familiesOverride: FAM });
        assert.strictEqual(dry.status, 'dry-run');
        assert.deepStrictEqual(dry.mutations, ['gene.js'], 'dry-run surfaces mutations');

        // (d) --force overwrites the mutation
        const forced = nurtureChild(m2, { id: 'k', path: c1 }, { exec: cleanGit, force: true, familiesOverride: FAM });
        assert.strictEqual(forced.status, 'applied');
        assert.strictEqual(fs.readFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'utf8'), 'module.exports = 3;\n', 'force overwrites');

        // (e) anchored-merge divergence is NEVER a mutation
        const m3 = mkMother('module.exports = 3;\n');
        fs.writeFileSync(path.join(c1, '.agents', 'workflows', 'evo.md'),
            '<!-- BEGIN_LOCAL -->\nchild rewrote everything here\n<!-- END_LOCAL -->\nbody v1\n');
        const anch = nurtureChild(m3, { id: 'k', path: c1 }, { dryRun: true, exec: cleanGit, familiesOverride: FAM });
        assert.deepStrictEqual(anch.mutations, [], 'anchored entries exempt from mutation detection');

        // (f) CRLF-only drift is NOT a mutation (git autocrlf rewrites child worktrees;
        //     found live on CodePLC 2026-07-09)
        fs.writeFileSync(path.join(c1, '.evo-lite', 'cli', 'gene.js'), 'module.exports = 3;\r\n');
        const crlf = nurtureChild(m3, { id: 'k', path: c1 }, { dryRun: true, exec: cleanGit, familiesOverride: FAM });
        assert.deepStrictEqual(crlf.mutations, [], 'line-ending-only divergence must not read as a gene mutation');
    }
    console.log('✅ T-hive-mutation passed');

    console.log('T-command-policy. checkCommand / loadPolicy / matchesEntry ...');
    {
        const { checkCommand, matchesEntry, loadPolicy, BUILTIN_DEFAULT } =
            require('../verification/command-policy');
        const policy = { version: 'evo-command-policy@1', allow: [{ prefix: 'node ./.evo-lite/cli/test.js' }] };

        // (a) shell metacharacters rejected — before any allowlist check
        for (const bad of ['node x; rm -rf ~', 'a | b', '$(x)', '`x`', 'a && b', 'a > f', 'a\nb']) {
            const r = checkCommand(bad, policy);
            assert.strictEqual(r.allowed, false, `should block: ${bad}`);
            assert.ok(/metacharacter/.test(r.reason), `metachar reason for: ${bad}`);
        }
        // (b) not in allowlist
        const nope = checkCommand('curl evil', policy);
        assert.strictEqual(nope.allowed, false);
        assert.ok(/allowlist/.test(nope.reason), 'allowlist reason');
        // (c) allowlisted prefix, with and without a trailing arg
        assert.strictEqual(checkCommand('node ./.evo-lite/cli/test.js governance', policy).allowed, true);
        assert.strictEqual(checkCommand('node ./.evo-lite/cli/test.js', policy).allowed, true);
        // (d) prefix word boundary — no partial-token match
        assert.strictEqual(checkCommand('node ./.evo-lite/cli/test.jsEVIL', policy).allowed, false);
        // (e) equals form is exact
        const eqPolicy = { allow: [{ equals: 'npm run lint' }] };
        assert.strictEqual(checkCommand('npm run lint', eqPolicy).allowed, true);
        assert.strictEqual(checkCommand('npm run lint --fix', eqPolicy).allowed, false);
        // (f) empty / whitespace command
        assert.strictEqual(checkCommand('', policy).allowed, false);
        assert.strictEqual(checkCommand('   ', policy).allowed, false);
        // (g) matchesEntry unit
        assert.ok(matchesEntry('node ./.evo-lite/cli/test.js x', { prefix: 'node ./.evo-lite/cli/test.js' }));
        assert.ok(!matchesEntry('node ./.evo-lite/cli/test.jsX', { prefix: 'node ./.evo-lite/cli/test.js' }));
        assert.ok(matchesEntry('npm run lint', { equals: 'npm run lint' }));

        // (h) loadPolicy: absent file -> built-in default; self-test allowed
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdpol-'));
        assert.deepStrictEqual(loadPolicy(tmp), BUILTIN_DEFAULT);
        assert.strictEqual(checkCommand('node ./.evo-lite/cli/test.js governance', loadPolicy(tmp)).allowed, true);
        // (i) present-but-empty allow -> pure default-deny
        fs.mkdirSync(path.join(tmp, '.evo-lite', 'verification'), { recursive: true });
        const polPath = path.join(tmp, '.evo-lite', 'verification', 'command-policy.json');
        fs.writeFileSync(polPath, JSON.stringify({ version: 'evo-command-policy@1', allow: [] }));
        assert.strictEqual(checkCommand('node ./.evo-lite/cli/test.js governance', loadPolicy(tmp)).allowed, false);
        // (j) malformed -> throw
        fs.writeFileSync(polPath, '{ not json');
        assert.throws(() => loadPolicy(tmp), /not valid JSON/);
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log('✅ T-command-policy passed');
    }

        console.log('T-command-blocked. runVerifier honors policy, skips exec when blocked ...');
        {
            const { runVerifier } = require('../verification/run-verifiers');
            const policy = { allow: [{ prefix: 'node ./.evo-lite/cli/test.js' }] };
            let execCalls = 0;
            const blocked = runVerifier(
                { id: 'c1', verifier: { type: 'command', params: { cmd: 'curl evil' } } },
                { repoRoot: process.cwd(), exec: () => { execCalls++; return ''; }, policy }
            );
            assert.strictEqual(blocked.verdict, 'UNVERIFIED', 'blocked -> UNVERIFIED');
            assert.strictEqual(blocked.blocked, true, 'blocked flag set');
            assert.strictEqual(execCalls, 0, 'exec must NOT run for a blocked command');

            const ok = runVerifier(
                { id: 'c2', verifier: { type: 'command', params: { cmd: 'node ./.evo-lite/cli/test.js governance' } } },
                { repoRoot: process.cwd(), exec: () => { execCalls++; return 'out'; }, policy }
            );
            assert.strictEqual(ok.verdict, 'PASS', 'allowed -> exec runs -> PASS');
            assert.strictEqual(execCalls, 1, 'exec runs exactly once for the allowed command');
            console.log('✅ T-command-blocked passed');
        }

        console.log('T-command-blocked-runspec. runSpec writes no evidence for a blocked criterion ...');
        {
            const engine = require('../verification/engine');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdrun-'));
            fs.mkdirSync(path.join(tmp, '.evo-lite', 'verification'), { recursive: true });
            const specPath = path.join(tmp, 'spec.md');
            fs.writeFileSync(specPath, [
                '---', 'id: spec:blocktest', '---', '',
                '## Acceptance Criteria', '', '```json',
                JSON.stringify({ criteria: [{
                    id: 'ac-block', description: 'x',
                    verifier: { type: 'command', params: { cmd: 'curl evil.sh' } }, dependsOn: ['index.js'],
                }] }),
                '```', '',
            ].join('\n'));
            const res = engine.runSpec(specPath, {
                root: tmp, porcelain: '', headSha: 'abc123def', ranAt: '2026-07-06T00:00:00Z', exec: () => '',
            });
            assert.strictEqual(res.ok, true, 'runSpec ok');
            assert.strictEqual(res.written.length, 1);
            assert.strictEqual(res.written[0].blocked, true, 'written entry marked blocked');
            assert.strictEqual(res.written[0].verdict, 'UNVERIFIED');
            assert.ok(!fs.existsSync(path.join(tmp, '.evo-lite', 'verification', 'evidence-blocktest.json')),
                'no evidence file written for a blocked criterion');
            fs.rmSync(tmp, { recursive: true, force: true });
            console.log('✅ T-command-blocked-runspec passed');
        }

        console.log('T-command-policy-manifest. command-policy.js is a gene; the .json is not ...');
        {
            const { MANAGED_TEMPLATE_FAMILIES } = require('../template-manifest');
            const core = MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
            assert.ok(core, 'core-cli family exists');
            assert.ok(core.files.includes('verification/command-policy.js'),
                'command-policy.js must be a managed gene');
            const allFiles = MANAGED_TEMPLATE_FAMILIES.flatMap(
                f => f.files.map(x => typeof x === 'string' ? x : x.path));
            assert.ok(!allFiles.some(f => f.endsWith('command-policy.json')),
                'command-policy.json must NOT be a gene — it is per-repo project state');
            console.log('✅ T-command-policy-manifest passed');
        }

        console.log('T-evidence-no-shell. commitSha never reaches a shell; non-OID -> STALE ...');
        {
            const engine = require('../verification/engine');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evid-shell-'));
            fs.mkdirSync(path.join(tmp, 'docs', 'specs'), { recursive: true });
            const specPath = path.join(tmp, 'docs', 'specs', 's.md');
            fs.writeFileSync(specPath, [
                '---', 'id: spec:t', '---', '', '## Acceptance Criteria', '', '```json',
                JSON.stringify({ criteria: [{
                    id: 'ac-1', description: 'x',
                    verifier: { type: 'file-exists', params: { path: 'docs/specs/s.md' } },
                    dependsOn: ['docs/specs/s.md'],
                }] }),
                '```', '',
            ].join('\n'));
            // Plant an evidence record whose commitSha is a shell-injection payload.
            const evDir = path.join(tmp, '.evo-lite', 'verification');
            fs.mkdirSync(evDir, { recursive: true });
            fs.writeFileSync(path.join(evDir, 'evidence-t.json'), JSON.stringify({
                version: 'evo-verification-evidence@1', specId: 'spec:t',
                records: { 'ac-1': {
                    criterionId: 'ac-1', verdict: 'PASS', commitSha: 'HEAD; echo pwned #',
                    verifierType: 'file-exists', ranAt: 't', detail: 'd', attestedBy: null,
                } },
            }));
            // exec spy: if any git *diff* string were built with the payload, it would
            // appear here. We assert the spy is only ever called argv-form (array) and
            // never receives the payload substring.
            const seen = [];
            const execSpy = (cmd) => { seen.push(cmd); return 'sha-head'; };
            const verdicts = engine.statusSpec(specPath, { root: tmp, headSha: 'sha-head', exec: execSpy });
            const v = Object.fromEntries(verdicts.map(x => [x.criterionId, x.verdict]));
            assert.strictEqual(v['ac-1'], 'STALE', 'non-OID commitSha must derive STALE');
            assert.ok(!seen.some(c => typeof c === 'string' && c.includes('pwned')),
                'payload commitSha must never be interpolated into an exec string');
            fs.rmSync(tmp, { recursive: true, force: true });
            console.log('✅ T-evidence-no-shell passed');
        }

        console.log('T-evidence-validated-read. readEvidence validates file + records ...');
        {
            const store = require('../verification/evidence-store');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evid-read-'));
            const evDir = path.join(tmp, '.evo-lite', 'verification');
            fs.mkdirSync(evDir, { recursive: true });
            const fp = path.join(evDir, 'evidence-t.json');

            // (a) unparseable file -> throw (fail-closed)
            fs.writeFileSync(fp, '{ not json');
            assert.throws(() => store.readEvidence(tmp, 'spec:t'), /evidence.*(JSON|parse|malformed)/i);

            // (b) wrong top-level shape (records not an object) -> throw
            fs.writeFileSync(fp, JSON.stringify({ version: 'x', specId: 'spec:t', records: [] }));
            assert.throws(() => store.readEvidence(tmp, 'spec:t'), /records/i);

            // (c) one invalid record excluded loudly, valid one kept
            fs.writeFileSync(fp, JSON.stringify({
                version: 'evo-verification-evidence@1', specId: 'spec:t', records: {
                    good: { criterionId: 'good', verdict: 'PASS', commitSha: 'abc123', verifierType: 'file-exists', attestedBy: null },
                    bad:  { criterionId: 'bad', verdict: 'GREENISH', commitSha: 'abc', verifierType: 'file-exists' },
                },
            }));
            const warned = [];
            const origWarn = console.warn; console.warn = (m) => warned.push(String(m));
            let back;
            try { back = store.readEvidence(tmp, 'spec:t'); } finally { console.warn = origWarn; }
            assert.ok(back.records.good, 'valid record kept');
            assert.ok(!back.records.bad, 'invalid record excluded');
            assert.ok(warned.some(m => /bad/.test(m)), 'exclusion is loud (names the record)');

            // (d) absent file still reads as empty store (unchanged)
            fs.rmSync(fp);
            assert.deepStrictEqual(store.readEvidence(tmp, 'spec:t').records, {}, 'absent -> empty');
            fs.rmSync(tmp, { recursive: true, force: true });
            console.log('✅ T-evidence-validated-read passed');
        }

        console.log('T-hive-version-truth. hive reads evo-lite-version.json, package.json only as legacy ...');
        {
            const { childStatus } = require('../hive/status');
            const motherRoot = process.cwd(); // real templates/ tree for gene parity
            const motherVersion = require(path.join(motherRoot, 'package.json')).version;

            function makeChild(withVersionFile) {
                const c = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ver-'));
                const evo = path.join(c, '.evo-lite');
                fs.mkdirSync(path.join(evo, 'cli'), { recursive: true });
                // Real initializer shape: runtime manifest pinned to 1.0.0.
                fs.writeFileSync(path.join(evo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
                if (withVersionFile) {
                    fs.writeFileSync(path.join(evo, 'evo-lite-version.json'), JSON.stringify({ version: motherVersion }));
                }
                return c;
            }

            // (a) fresh scaffold: product version file present == mother -> up-to-date
            const fresh = makeChild(true);
            const s1 = childStatus(motherRoot, { id: 'c1', path: fresh },
                { familiesOverride: [] }); // no gene files to diff -> status hinges on version
            assert.strictEqual(s1.childVersion, motherVersion, 'reads product version from evo-lite-version.json');
            assert.strictEqual(s1.status, 'up-to-date', 'fresh child with matching product version is up-to-date');
            assert.ok(/evo-lite-version/.test(s1.versionSource), 'versionSource names the product file');

            // (b) legacy child: no version file -> package.json fallback, marked legacy
            const legacy = makeChild(false);
            const s2 = childStatus(motherRoot, { id: 'c2', path: legacy }, { familiesOverride: [] });
            assert.strictEqual(s2.childVersion, '1.0.0', 'legacy fallback reads package.json');
            assert.ok(/legacy/.test(s2.versionSource), 'legacy source is marked');

            fs.rmSync(fresh, { recursive: true, force: true });
            fs.rmSync(legacy, { recursive: true, force: true });
            console.log('✅ T-hive-version-truth passed');
        }

        console.log('T-nurture-preserves-manifest. nurture updates product file, not the manifest ...');
        {
            const { nurtureChild } = require('../hive/nurture');
            const motherRoot = process.cwd();
            const motherVersion = require(path.join(motherRoot, 'package.json')).version;
            const child = fs.mkdtempSync(path.join(os.tmpdir(), 'nurt-man-'));
            const evo = path.join(child, '.evo-lite');
            fs.mkdirSync(path.join(evo, 'cli'), { recursive: true });
            fs.writeFileSync(path.join(evo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }, null, 2));
            fs.writeFileSync(path.join(evo, 'evo-lite-version.json'), JSON.stringify({ version: '0.0.1' }, null, 2));
            // Empty family override -> no gene copy, but the version-file update still runs.
            const rep = nurtureChild(motherRoot, { id: 'cN', path: child },
                { familiesOverride: [], force: true, now: () => '2026-07-06T00:00:00Z' });
            // Fixture (non-repo tmpdir + force:true) is built to ALWAYS reach `applied`;
            // hard-require it so the assertions below can never be vacuously skipped.
            assert.strictEqual(rep.status, 'applied', 'nurture must reach applied in this fixture');
            assert.strictEqual(require(path.join(evo, 'package.json')).version, '1.0.0',
                'runtime manifest version MUST be untouched');
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(evo, 'evo-lite-version.json'), 'utf8')).version,
                motherVersion, 'product version file updated to mother version');
            fs.rmSync(child, { recursive: true, force: true });
            console.log('✅ T-nurture-preserves-manifest passed');
        }

        console.log('T-transaction. snapshot/rollback restores files on apply failure ...');
        {
            const txn = require('../transaction');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'txn-'));
            const a = path.join(tmp, 'a.txt'); const b = path.join(tmp, 'b.txt');
            fs.writeFileSync(a, 'A0');            // a exists before
            // b does not exist before
            const journalPath = path.join(tmp, 'j.json');
            const res = txn.runTransaction({
                root: tmp, targets: [a, b], journalPath, now: '2026-07-06T00:00:00Z',
                apply: () => {
                    fs.writeFileSync(a, 'A1');    // mutate existing
                    fs.writeFileSync(b, 'B1');    // create new
                    throw new Error('boom');      // force rollback
                },
            });
            assert.strictEqual(res.ok, false, 'transaction reports failure');
            assert.strictEqual(fs.readFileSync(a, 'utf8'), 'A0', 'existing file restored');
            assert.ok(!fs.existsSync(b), 'created file removed on rollback');
            assert.ok(JSON.parse(fs.readFileSync(journalPath, 'utf8')).status === 'aborted', 'journal marked aborted');
            fs.rmSync(tmp, { recursive: true, force: true });
            console.log('✅ T-transaction passed');
        }

        console.log('T-nurture-transactional. a mid-apply failure restores every snapshotted file ...');
        {
            const nurtureMod = require('../hive/nurture');
            const motherRoot = process.cwd();
            const child = fs.mkdtempSync(path.join(os.tmpdir(), 'nurt-txn-'));
            const evo = path.join(child, '.evo-lite');
            fs.mkdirSync(path.join(evo, 'cli'), { recursive: true });
            fs.writeFileSync(path.join(evo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }, null, 2));
            fs.writeFileSync(path.join(evo, 'evo-lite-version.json'), JSON.stringify({ version: '0.0.1' }, null, 2));
            // Inject a receipt-writer that throws, simulating a mid-apply failure AFTER
            // some files are written. Nurture must restore the product version file.
            const before = fs.readFileSync(path.join(evo, 'evo-lite-version.json'), 'utf8');
            const rep = nurtureMod.nurtureChild(motherRoot, { id: 'cT', path: child }, {
                familiesOverride: [], force: true, now: () => '2026-07-06T00:00:00Z',
                exec: (() => { const f = () => ''; f.__argv = true; return f; })(),
                failAfterWrites: true, // hook the impl reads to throw post-write (see Step 3)
            });
            assert.ok(rep.status === 'aborted' || rep.aborted, 'nurture reports aborted on mid-apply failure');
            assert.strictEqual(fs.readFileSync(path.join(evo, 'evo-lite-version.json'), 'utf8'), before,
                'product version file restored on rollback');
            // Real rollback proof: the mirror lock WAS written before the injected throw
            // and did NOT exist beforehand, so a correct rollback must unlink it. (The
            // product-version assertion above is necessary but not sufficient — with an
            // empty family override that file is only written AFTER the throw, so it stays
            // untouched whether or not rollback runs.)
            assert.ok(!fs.existsSync(path.join(evo, 'generated', 'runtime-mirror.lock.json')),
                'mirror lock written before the throw must be removed on rollback');
            fs.rmSync(child, { recursive: true, force: true });
            console.log('✅ T-nurture-transactional passed');
        }

        console.log('T-contract-honesty. command verifier: scope accepted, cwd rejected ...');
        {
            const { validateCriteria } = require('../verification/validate-contract');
            const base = (params) => ([{
                id: 'ac', description: 'd', dependsOn: ['x'],
                verifier: { type: 'command', params },
            }]);
            // scope still allowed (informational)
            assert.strictEqual(validateCriteria(base({ cmd: 'node ./.evo-lite/cli/test.js governance', scope: 'governance' })).length, 0,
                'scope is an accepted informational param');
            // cwd now rejected as unknown
            const withCwd = validateCriteria(base({ cmd: 'x', cwd: '..' }));
            assert.ok(withCwd.some(f => /unknown param "cwd"/.test(f.message)), 'cwd must be rejected');
            console.log('✅ T-contract-honesty passed');
        }

        console.log('T-symlink-containment. realpath-based containment rejects symlink escape ...');
        {
            const rv = require('../verification/run-verifiers');
            // run-verifiers does not export resolveWithin; assert via a file-exists
            // verifier pointed through a symlink that escapes the repo.
            const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
            fs.writeFileSync(path.join(outside, 'secret.txt'), 'S');
            const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
            let symlinked = true;
            try {
                fs.symlinkSync(outside, path.join(repo, 'link'), 'dir');
            } catch (_) { symlinked = false; }
            if (symlinked) {
                const res = rv.runVerifier(
                    { verifier: { type: 'file-exists', params: { path: 'link/secret.txt' } } },
                    { repoRoot: repo });
                // The escape must be refused (verifier error), NOT reported PASS.
                assert.strictEqual(res.verdict, 'FAIL', 'symlink escape must not resolve to PASS');
                assert.ok(/escapes project root/.test(res.detail), 'reason names the escape');
            } else {
                console.log('   (symlink unavailable on this FS — skipped)');
            }
            fs.rmSync(outside, { recursive: true, force: true });
            fs.rmSync(repo, { recursive: true, force: true });
            console.log('✅ T-symlink-containment passed');
        }

        console.log('T-r013-remote-drift. R013 fires on stale META git state, silent when matching ...');
        {
            const gaps = require('../planning/gaps');
            assert.strictEqual(typeof gaps.checkR013, 'function', 'gaps must export checkR013');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r013-'));
            fs.mkdirSync(path.join(tmp, '.evo-lite'), { recursive: true });
            function writeCtx(headSha) {
                fs.writeFileSync(path.join(tmp, '.evo-lite', 'active_context.md'),
                    ['# ctx', '<!-- BEGIN_META -->', `> headSha: ${headSha}`, '> ahead: 0', '> behind: 0', '<!-- END_META -->'].join('\n'));
            }
            // Injected git state: real HEAD is 'realhead', META claims 'stalehead'.
            const gitState = { headSha: 'realhead', isAncestorOfHead: (s) => s === 'realhead', ahead: 0, behind: 0, hasUpstream: true };

            writeCtx('stalehead');
            const stale = gaps.checkR013(tmp, { gitState });
            assert.ok(stale.some(f => f.rule === 'R013'), 'R013 fires when META headSha is not HEAD/ancestor');

            writeCtx('realhead');
            const fresh = gaps.checkR013(tmp, { gitState });
            assert.strictEqual(fresh.filter(f => f.rule === 'R013').length, 0, 'R013 silent when META matches reality');

            // no-upstream repo skips the ahead/behind arm
            writeCtx('realhead');
            const noUp = gaps.checkR013(tmp, { gitState: { ...gitState, hasUpstream: false, behind: 99 } });
            assert.strictEqual(noUp.filter(f => f.rule === 'R013').length, 0, 'no upstream -> ahead/behind not checked');

            fs.rmSync(tmp, { recursive: true, force: true });
            console.log('✅ T-r013-remote-drift passed');
        }

        console.log('T-engine-impl. resolveActiveImpl reports choice vs impl vs degraded ...');
        {
            const mi = require(path.join(CLI_DIR, 'memory-index.js'));
            assert.strictEqual(typeof mi.resolveActiveImpl, 'function', 'resolveActiveImpl must be exported');
            const prevEnv = process.env.EVO_LITE_MEMORY_ENGINE;
            process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
            try {
                const degraded = mi.resolveActiveImpl(() => null);
                assert.strictEqual(degraded.choice, 'zvec', 'choice reflects zvec selection');
                assert.strictEqual(degraded.impl, 'sqlite', 'impl falls back to sqlite when zvec loader returns null');
                assert.strictEqual(degraded.degraded, true, 'degraded true when choice zvec but impl sqlite');

                const healthy = mi.resolveActiveImpl(() => (class FakeZvec {}));
                assert.strictEqual(healthy.impl, 'zvec', 'impl zvec when loader returns a class');
                assert.strictEqual(healthy.degraded, false, 'not degraded when impl matches choice');

                process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';
                const sqliteChoice = mi.resolveActiveImpl(() => (class FakeZvec {}));
                assert.strictEqual(sqliteChoice.impl, 'sqlite', 'sqlite choice -> sqlite impl');
                assert.strictEqual(sqliteChoice.degraded, false, 'sqlite choice never degraded');
            } finally {
                if (prevEnv === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                else process.env.EVO_LITE_MEMORY_ENGINE = prevEnv;
            }
            console.log('✅ T-engine-impl passed');
        }
}

module.exports = { runGovernanceTests };
