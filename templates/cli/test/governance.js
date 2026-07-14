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
            assert.deepStrictEqual(rulesFam.files, ['hive-feedback.md', 'spec-intake.md', 'zvec-optin.md']);
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

        console.log('T-spec-portfolio. Testing spec portfolio registry derivation + report ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            assert.deepStrictEqual(specPortfolio.SIZE_THRESHOLDS,
                { acCount: 8, phaseCount: 3, dependsOnCount: 12, chars: 40000 },
                'SIZE_THRESHOLDS must match the plan-defined constants');
            assert.strictEqual(specPortfolio.DEFAULT_AGING_DAYS, 14, 'DEFAULT_AGING_DAYS must be 14');
            assert.strictEqual(typeof specPortfolio.buildSpecRegistry, 'function', 'buildSpecRegistry must be exported');
            assert.strictEqual(typeof specPortfolio.formatPortfolioReport, 'function', 'formatPortfolioReport must be exported');

            const runtime = createTempRuntimeRoot('spec-portfolio-core');
            const projectRoot = runtime.workspaceRoot;

            const oversizedCriteria = [1, 2, 3, 4, 5, 6, 7, 8, 9]
                .map(n => `    { "id": "c${n}" }`).join(',\n');
            const criteriaBlock = [
                '## Acceptance Criteria',
                '',
                '```json',
                '{',
                '  "criteria": [',
                oversizedCriteria,
                '  ]',
                '}',
                '```',
                '',
            ].join('\n');

            writeText(path.join(projectRoot, 'docs', 'specs', 'a-done.md'), [
                '---', 'id: spec:a', 'status: done', '---', '', '# Spec A', '',
            ].join('\n'));

            writeText(path.join(projectRoot, 'docs', 'specs', 'b-parked.md'), [
                '---', 'id: spec:b', 'status: parked', 'linkedPlan: plan:b1', '---', '', '# Spec B', '',
            ].join('\n'));

            const cPath = path.join(projectRoot, 'docs', 'specs', 'c-adopted-aging.md');
            writeText(cPath, [
                '---', 'id: spec:c', 'status: draft', '---', '', '# Spec C', '',
            ].join('\n'));
            const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
            fs.utimesSync(cPath, twentyDaysAgo, twentyDaysAgo);

            writeText(path.join(projectRoot, 'docs', 'specs', 'd-active.md'), [
                '---', 'id: spec:d', 'status: draft', 'linkedPlan: plan:d1', '---', '', '# Spec D', '',
            ].join('\n'));

            writeText(path.join(projectRoot, 'docs', 'specs', 'e-size-exceeded.md'), [
                '---', 'id: spec:e', 'status: draft', '---', '', '# Spec E', '',
                criteriaBlock,
            ].join('\n'));

            writeText(path.join(projectRoot, 'docs', 'specs', 'f-size-waiver.md'), [
                '---', 'id: spec:f', 'status: draft', 'sizeWaiver: true', '---', '', '# Spec F', '',
                criteriaBlock,
            ].join('\n'));

            writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1',
                specs: [],
                plans: [
                    { id: 'plan:b1', status: 'active', linkedSpec: 'spec:b', sourcePath: 'docs/plans/b1.md' },
                    { id: 'plan:d1', status: 'active', linkedSpec: 'spec:d', sourcePath: 'docs/plans/d1.md' },
                ],
                tasks: [],
                warnings: [],
            }, null, 2));

            const registry = specPortfolio.buildSpecRegistry(projectRoot);
            assert.strictEqual(registry.version, 'evo-spec-registry@1', 'registry version stamp');
            assert.strictEqual(registry.agingDays, 14, 'agingDays defaults to 14 with no config override');
            assert.strictEqual(registry.specs.length, 6, 'all six fixture specs enumerated');

            const byId = Object.fromEntries(registry.specs.map(s => [s.id, s]));

            assert.strictEqual(byId['spec:a'].state, 'shipped', 'status: done -> shipped');
            assert.deepStrictEqual(byId['spec:a'].warnings, [], 'shipped specs carry no aging warnings');

            assert.strictEqual(byId['spec:b'].state, 'parked', 'status: parked -> parked');
            assert.ok(byId['spec:b'].warnings.includes('zombie-plan'), 'parked spec with active linked plan gets zombie-plan warning');

            assert.strictEqual(byId['spec:c'].state, 'adopted', 'no linked plans -> adopted');
            assert.ok(byId['spec:c'].idleDays >= 15, `spec:c idleDays should reflect ~20 day old mtime, got ${byId['spec:c'].idleDays}`);
            assert.ok(byId['spec:c'].warnings.includes('aging-no-plan'), 'adopted spec idle past agingDays gets aging-no-plan warning');

            assert.strictEqual(byId['spec:d'].state, 'active', 'has linked plan not done -> active');
            assert.ok(!byId['spec:d'].warnings.includes('aging-inactive'), 'recently touched active spec has no aging warning');

            assert.strictEqual(byId['spec:e'].size.acCount, 9, 'acCount parsed from last criteria json block');
            assert.strictEqual(byId['spec:e'].sizeExceeded, true, 'acCount 9 > threshold 8 -> sizeExceeded');
            assert.ok(byId['spec:e'].warnings.includes('size-exceeded'), 'size-exceeded spec without sizeWaiver gets warning');

            assert.strictEqual(byId['spec:f'].sizeExceeded, true, 'spec:f is also oversized');
            assert.ok(!byId['spec:f'].warnings.includes('size-exceeded'), 'sizeWaiver in frontmatter suppresses size-exceeded warning');
            assert.strictEqual(byId['spec:f'].sizeWaiver, 'true', 'sizeWaiver value surfaced on the registry entry');

            const registryPath = path.join(projectRoot, '.evo-lite', 'generated', 'spec-registry.json');
            assert.ok(fs.existsSync(registryPath), 'buildSpecRegistry writes the registry JSON by default');
            const onDisk = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
            assert.strictEqual(onDisk.specs.length, 6, 'on-disk registry matches in-memory registry');

            fs.rmSync(registryPath, { force: true });
            assert.ok(!fs.existsSync(registryPath), 'registry file removed before rebuild check');
            specPortfolio.buildSpecRegistry(projectRoot);
            assert.ok(fs.existsSync(registryPath), 'registry file is rebuildable after deletion (missing is not an error)');

            const noWrite = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
            assert.strictEqual(noWrite.specs.length, 6, 'write:false still returns a full registry');

            const report = specPortfolio.formatPortfolioReport(registry);
            assert.strictEqual(report[0], '📋 [Spec Portfolio]: adopted=3 active=1 parked=1 shipped=1',
                'first report line summarizes counts per state');
            const warnLines = report.slice(1);
            assert.strictEqual(warnLines.length, 3, 'one WARN line per warning across the fixture');
            assert.ok(warnLines.every(l => l.startsWith('⚠️')), 'every warning line is prefixed with the WARN glyph');
            assert.ok(warnLines.some(l => l.includes('spec:c') && l.includes('天无活动')), 'aging-no-plan line mentions spec:c and idle days');
            assert.ok(warnLines.some(l => l.includes('spec:b') && l.includes('zombie')), 'zombie-plan line mentions spec:b');
            assert.ok(warnLines.some(l => l.includes('spec:e') && l.includes('体量超标')), 'size-exceeded line mentions spec:e');

            assert.deepStrictEqual(specPortfolio.formatPortfolioReport(null), [], 'formatPortfolioReport([null/undefined]) returns []');
            assert.deepStrictEqual(specPortfolio.formatPortfolioReport(undefined), [], 'formatPortfolioReport(undefined) returns []');

            // Degradation: no docs/specs dir, no plan-ir, no git — must never throw.
            const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-portfolio-empty-'));
            let degraded;
            assert.doesNotThrow(() => {
                degraded = specPortfolio.buildSpecRegistry(emptyRoot);
            }, 'buildSpecRegistry must never throw on a project with no docs/specs, no plan-ir, no git');
            assert.deepStrictEqual(degraded.specs, [], 'degraded registry has empty specs array');
            fs.rmSync(emptyRoot, { recursive: true, force: true });
        }
        console.log('✅ T-spec-portfolio core derivation passed');

        console.log('T-spec-portfolio-git. Testing lastTouchedAt resolves from git log when available ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            const runtime = createTempRuntimeRoot('spec-portfolio-git');
            const projectRoot = runtime.workspaceRoot;

            writeText(path.join(projectRoot, 'docs', 'specs', 'g-git-tracked.md'), [
                '---', 'id: spec:g', 'status: draft', '---', '', '# Spec G', '',
            ].join('\n'));

            runGit(projectRoot, ['init']);
            runGit(projectRoot, ['config', 'user.name', 'Evo Test']);
            runGit(projectRoot, ['config', 'user.email', 'evo@example.com']);
            runGit(projectRoot, ['add', '.']);
            runGit(projectRoot, ['commit', '-m', 'chore: add spec g']);

            const commitDate = runGit(projectRoot, ['log', '-1', '--format=%cI', '--', 'docs/specs/g-git-tracked.md']);

            const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
            const specG = registry.specs.find(s => s.id === 'spec:g');
            assert.ok(specG, 'spec:g present in registry');
            assert.strictEqual(specG.lastTouchedAt, commitDate, 'lastTouchedAt resolves from git log commit date, not file mtime');
        }
        console.log('✅ T-spec-portfolio-git passed');

        console.log('T-spec-portfolio-tz. Testing resolveLastTouchedAt compares by epoch, not lexicographically ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            assert.strictEqual(typeof specPortfolio.resolveLastTouchedAt, 'function', 'resolveLastTouchedAt must be exported for unit testing');

            // Direct unit proof: candidate A is lexicographically GREATER as a
            // string ("+08:00" > "Z" character-wise past the time-of-day digits)
            // but chronologically EARLIER as an instant (23:00+08:00 = 15:00Z,
            // which is before 18:00Z). A naive `iso > max` string-max picks A;
            // an epoch-max must pick B.
            const runtime = createTempRuntimeRoot('spec-portfolio-tz');
            const projectRoot = runtime.workspaceRoot;
            runGit(projectRoot, ['init']);
            runGit(projectRoot, ['config', 'user.name', 'Evo Test']);
            runGit(projectRoot, ['config', 'user.email', 'evo@example.com']);

            const specRel = 'docs/specs/tz-spec.md';
            const planRel = 'docs/plans/tz-plan.md';
            writeText(path.join(projectRoot, specRel), '# TZ Spec\n');
            writeText(path.join(projectRoot, planRel), '# TZ Plan\n');

            // Spec committed first with a LOCAL +08:00 offset stamp that is
            // lexicographically greater but chronologically earlier.
            runGit(projectRoot, ['add', specRel], {});
            runGit(projectRoot, ['commit', '-m', 'chore: add tz spec'], {
                GIT_AUTHOR_DATE: '2026-07-10T23:00:00+08:00',
                GIT_COMMITTER_DATE: '2026-07-10T23:00:00+08:00',
            });
            // Plan committed with a UTC "Z" stamp that is lexicographically
            // smaller but chronologically LATER (the true max instant).
            runGit(projectRoot, ['add', planRel], {});
            runGit(projectRoot, ['commit', '-m', 'chore: add tz plan'], {
                GIT_AUTHOR_DATE: '2026-07-10T18:00:00Z',
                GIT_COMMITTER_DATE: '2026-07-10T18:00:00Z',
            });

            const specCommitDate = runGit(projectRoot, ['log', '-1', '--format=%cI', '--', specRel]);
            const planCommitDate = runGit(projectRoot, ['log', '-1', '--format=%cI', '--', planRel]);
            assert.ok(specCommitDate > planCommitDate,
                `fixture sanity: spec stamp must be the lexicographically GREATER string (got spec=${specCommitDate} plan=${planCommitDate})`);
            assert.ok(Date.parse(planCommitDate) > Date.parse(specCommitDate),
                `fixture sanity: plan stamp must be the chronologically LATER instant (got spec=${specCommitDate} plan=${planCommitDate})`);

            const result = specPortfolio.resolveLastTouchedAt(projectRoot, [specRel, planRel]);
            assert.strictEqual(result, planCommitDate,
                'resolveLastTouchedAt must return the plan stamp (true-later instant via epoch compare), not the spec stamp (lexicographically-greater string)');

            // End-to-end proof through the real registry path (spec linked to plan via plan-ir).
            writeText(path.join(projectRoot, 'docs', 'specs', 'tz-spec.md'), [
                '---', 'id: spec:tz-spec', 'status: draft', 'linkedPlan: plan:tz1', '---', '', '# TZ Spec', '',
            ].join('\n'));
            writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [],
                plans: [{ id: 'plan:tz1', status: 'active', linkedSpec: 'spec:tz-spec', sourcePath: planRel }],
                tasks: [], warnings: [],
            }, null, 2));
            const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
            const tzSpec = registry.specs.find(s => s.id === 'spec:tz-spec');
            assert.ok(tzSpec, 'spec:tz-spec present in registry');
            assert.strictEqual(tzSpec.lastTouchedAt, planCommitDate,
                'registry-derived lastTouchedAt picks the true-later linked-plan instant, not the lexicographically-greater spec stamp');

            // Guard clause: an unparseable candidate must not win over a valid one.
            const guarded = specPortfolio.resolveLastTouchedAt(projectRoot, ['docs/specs/tz-spec.md', 'does/not/exist.md']);
            assert.ok(guarded && !Number.isNaN(Date.parse(guarded)), 'unparseable/missing candidate never wins over a valid parseable one');
        }
        console.log('✅ T-spec-portfolio-tz passed');

        console.log('T-spec-portfolio-size. Testing phase/dependsOn size metrics, zombie subset, aging override ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            const runtime = createTempRuntimeRoot('spec-portfolio-size');
            const projectRoot = runtime.workspaceRoot;

            writeText(path.join(projectRoot, '.evo-lite', 'config.json'), JSON.stringify({
                specPortfolio: { agingDays: 5 },
            }, null, 2));

            // (a) phaseCount via `### Phase ` headings: 4 phases > threshold 3.
            writeText(path.join(projectRoot, 'docs', 'specs', 'h-phase.md'), [
                '---', 'id: spec:h', 'status: draft', '---', '', '# Spec H', '',
                '### Phase 1: scaffold', 'work', '',
                '### Phase 2: core', 'work', '',
                '### Phase 3: polish', 'work', '',
                '### Phase 4: extra', 'work', '',
            ].join('\n'));

            // (b) dependsOnCount with duplicates across criteria: 16 raw entries, 13 unique > 12.
            const dependsOnCriteria = JSON.stringify({
                criteria: [
                    { id: 'c1', dependsOn: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] },
                    { id: 'c2', dependsOn: ['f5', 'f6', 'f7', 'f8', 'f9', 'f10'] },
                    { id: 'c3', dependsOn: ['f10', 'f11', 'f12', 'f13'] },
                ],
            }, null, 2);
            writeText(path.join(projectRoot, 'docs', 'specs', 'i-dependson.md'), [
                '---', 'id: spec:i', 'status: draft', '---', '', '# Spec I', '',
                '## Acceptance Criteria', '', '```json', dependsOnCriteria, '```', '',
            ].join('\n'));

            // (c) fallback regex path: no `### Phase `, but `## Phase N` style headings.
            writeText(path.join(projectRoot, 'docs', 'specs', 'j-fallback.md'), [
                '---', 'id: spec:j', 'status: draft', '---', '', '# Spec J', '',
                '## Phase 1', 'work', '',
                '## Phase 2', 'work', '',
            ].join('\n'));

            // Multi-plan parked spec: one linked plan done, one active -> zombie names ONLY the active one.
            writeText(path.join(projectRoot, 'docs', 'specs', 'k-parked-multi.md'), [
                '---', 'id: spec:k', 'status: parked', '---', '', '# Spec K', '',
                '## Linked Plans', '', '- plan:k1', '- plan:k2', '',
            ].join('\n'));

            // Aging override: 7 idle days > overridden agingDays 5 (but < default 14).
            const lPath = path.join(projectRoot, 'docs', 'specs', 'l-aging.md');
            writeText(lPath, [
                '---', 'id: spec:l', 'status: draft', '---', '', '# Spec L', '',
            ].join('\n'));
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            fs.utimesSync(lPath, sevenDaysAgo, sevenDaysAgo);

            writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1',
                specs: [],
                plans: [
                    { id: 'plan:k1', status: 'done', linkedSpec: 'spec:k', sourcePath: 'docs/plans/k1.md' },
                    { id: 'plan:k2', status: 'active', linkedSpec: 'spec:k', sourcePath: 'docs/plans/k2.md' },
                ],
                tasks: [],
                warnings: [],
            }, null, 2));

            const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
            const byId = Object.fromEntries(registry.specs.map(s => [s.id, s]));

            assert.strictEqual(byId['spec:h'].size.phaseCount, 4, 'phaseCount counts `### Phase ` headings');
            assert.strictEqual(byId['spec:h'].sizeExceeded, true, 'phaseCount 4 > threshold 3 -> sizeExceeded');
            assert.ok(byId['spec:h'].warnings.includes('size-exceeded'), 'phase-driven overflow raises size-exceeded warning');

            assert.strictEqual(byId['spec:i'].size.acCount, 3, 'spec:i acCount stays under threshold');
            assert.strictEqual(byId['spec:i'].size.dependsOnCount, 13, 'dependsOnCount deduplicates across criteria (16 raw -> 13 unique)');
            assert.strictEqual(byId['spec:i'].sizeExceeded, true, 'dependsOnCount 13 > threshold 12 -> sizeExceeded');
            assert.ok(byId['spec:i'].warnings.includes('size-exceeded'), 'dependsOn-driven overflow raises size-exceeded warning');

            assert.strictEqual(byId['spec:j'].size.phaseCount, 2, 'fallback `#{2,3} .*Phase` regex counts `## Phase N` headings');
            assert.strictEqual(byId['spec:j'].sizeExceeded, false, 'fallback phase count under threshold -> not exceeded');

            assert.strictEqual(byId['spec:k'].state, 'parked', 'spec:k stays parked');
            assert.ok(byId['spec:k'].warnings.includes('zombie-plan'), 'parked spec with one active plan gets zombie-plan warning');

            assert.strictEqual(registry.agingDays, 5, 'config specPortfolio.agingDays overrides default 14');
            assert.strictEqual(byId['spec:l'].state, 'adopted', 'spec:l has no linked plans');
            assert.ok(byId['spec:l'].idleDays >= 6 && byId['spec:l'].idleDays <= 8,
                `spec:l idleDays ~7 expected, got ${byId['spec:l'].idleDays}`);
            assert.ok(byId['spec:l'].warnings.includes('aging-no-plan'), '7 idle days > overridden agingDays 5 -> aging-no-plan');

            const report = specPortfolio.formatPortfolioReport(registry);
            const zombieLine = report.find(l => l.includes('spec:k') && l.includes('zombie'));
            assert.ok(zombieLine, 'report contains a zombie-plan line for spec:k');
            assert.ok(zombieLine.includes('plan:k2'), 'zombie line names the not-done plan (plan:k2)');
            assert.ok(!zombieLine.includes('plan:k1'), 'zombie line must NOT name the done plan (plan:k1) as 仍活跃');
        }
        console.log('✅ T-spec-portfolio-size passed');

        console.log('T-verify-spec-portfolio. Testing verify() surfaces the Spec Portfolio report ...');
        {
            // (a) aging adopted spec (no linked plan, old mtime) -> 📋 line + ⚠️ aging line, hasAlerts true.
            {
                const runtime = createTempRuntimeRoot('verify-spec-portfolio-aging');
                const projectRoot = runtime.workspaceRoot;
                const specPath = path.join(projectRoot, 'docs', 'specs', 'm-aging.md');
                writeText(specPath, [
                    '---', 'id: spec:m', 'status: draft', '---', '', '# Spec M', '',
                ].join('\n'));
                const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
                fs.utimesSync(specPath, twentyDaysAgo, twentyDaysAgo);

                const loaded = await bootstrapRuntime(runtime.runtimeRoot, {
                    EVO_LITE_SKIP_GIT_STATUS: '1',
                });
                let report;
                const output = await captureConsole(async () => {
                    report = await loaded.service.verify();
                });
                const portfolioLine = output.split('\n').find(l => l.startsWith('📋 [Spec Portfolio]:'));
                assert.ok(portfolioLine, 'verify output must include a 📋 [Spec Portfolio]: line');
                assert.ok(output.split('\n').some(l => l.startsWith('⚠️') && l.includes('spec:m')),
                    'verify output must include a ⚠️ aging warning line for spec:m');
                assert.strictEqual(report.hasAlerts, true, 'report.hasAlerts must be true when a spec portfolio warning fires');
                assert.ok(report.specPortfolio, 'report.specPortfolio must be populated');
                assert.strictEqual(report.specPortfolio.adopted, 1, 'one adopted spec counted');
                assert.ok(report.specPortfolio.warnings >= 1, 'at least one warning counted');
            }

            // (b) degraded path: buildSpecRegistry throws -> single degraded 📋 line, verify does not throw.
            {
                const specPortfolioMod = require(path.join(CLI_DIR, 'spec-portfolio.js'));
                const realBuildSpecRegistry = specPortfolioMod.buildSpecRegistry;
                specPortfolioMod.buildSpecRegistry = () => { throw new Error('boom-spec-portfolio'); };
                try {
                    const runtime = createTempRuntimeRoot('verify-spec-portfolio-degraded');
                    const loaded = await bootstrapRuntime(runtime.runtimeRoot, {
                        EVO_LITE_SKIP_GIT_STATUS: '1',
                    });
                    let report;
                    let threw = null;
                    const output = await captureConsole(async () => {
                        try {
                            report = await loaded.service.verify();
                        } catch (err) {
                            threw = err;
                        }
                    });
                    assert.strictEqual(threw, null, 'verify() must not throw when spec-portfolio build fails');
                    const degradedLine = output.split('\n').find(l => l.startsWith('📋 [Spec Portfolio]: degraded'));
                    assert.ok(degradedLine, 'verify output must include a single degraded 📋 line on spec-portfolio failure');
                    assert.ok(degradedLine.includes('boom-spec-portfolio'), 'degraded line should surface the underlying error message');
                    assert.ok(report, 'verify() must still return its report on spec-portfolio degradation');
                } finally {
                    specPortfolioMod.buildSpecRegistry = realBuildSpecRegistry;
                }
            }

            // (c) clean workspace (no docs/specs) -> all-zero 📋 line, no ⚠️, verify exits normally.
            {
                const runtime = createTempRuntimeRoot('verify-spec-portfolio-clean');
                const loaded = await bootstrapRuntime(runtime.runtimeRoot, {
                    EVO_LITE_SKIP_GIT_STATUS: '1',
                });
                let report;
                const output = await captureConsole(async () => {
                    report = await loaded.service.verify();
                });
                const portfolioLine = output.split('\n').find(l => l.startsWith('📋 [Spec Portfolio]:'));
                assert.strictEqual(portfolioLine, '📋 [Spec Portfolio]: adopted=0 active=0 parked=0 shipped=0',
                    'clean workspace 📋 line reports all-zero counts');
                assert.ok(!output.split('\n').some(l => l.startsWith('⚠️') && l.includes('spec:')),
                    'clean workspace must not include any spec ⚠️ warning lines');
                assert.ok(report, 'verify() must return a report on a clean workspace');
            }
        }
        console.log('✅ T-verify-spec-portfolio passed');

        console.log('T-spec-adopt. Testing adoptSpec intake gate (normalize, size gate, relation enforcement) ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            assert.strictEqual(typeof specPortfolio.adoptSpec, 'function', 'adoptSpec must be exported');

            // (a) broken YAML frontmatter, filename-derived id (no H1 title in body).
            {
                const runtime = createTempRuntimeRoot('spec-adopt-broken-yaml');
                const projectRoot = runtime.workspaceRoot;
                const draftPath = path.join(projectRoot, 'docs', 'spec my thing.md');
                writeText(draftPath, [
                    '---',
                    'this is not valid yaml at all',
                    '   nested: 1',
                    '   nested2: 2',
                    '---',
                    'Some body text without heading.',
                    '',
                ].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, { now: new Date('2026-07-10T00:00:00Z') });
                assert.strictEqual(result.id, 'spec:my-thing', 'id derived from filename after stripping leading spec + kebab-casing');
                const expectedTarget = path.join(projectRoot, 'docs', 'specs', 'my-thing.md');
                assert.strictEqual(result.targetPath, expectedTarget, 'target path under docs/specs/');
                assert.ok(fs.existsSync(expectedTarget), 'draft moved to target path');
                assert.ok(!fs.existsSync(draftPath), 'original draft no longer exists at source path');

                const finalContent = fs.readFileSync(expectedTarget, 'utf8');
                const { frontmatter: finalFm, body: finalBody } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown')).parseFrontmatter(finalContent);
                assert.strictEqual(finalFm.id, 'spec:my-thing', 'final frontmatter carries derived id');
                assert.strictEqual(finalFm.status, 'adopted', 'final frontmatter status is adopted');
                assert.strictEqual(finalFm.created, '2026-07-10', 'final frontmatter created from injected now');
                assert.ok(finalBody.includes('original broken frontmatter preserved below'), 'broken block demoted into body as HTML comment');
                assert.ok(finalBody.includes('nested: 1'), 'original broken frontmatter content preserved in comment');
                assert.ok(finalBody.includes('Some body text without heading.'), 'original body content preserved');
                assert.deepStrictEqual(result.warnings, [], 'no size warnings for a small draft');
                assert.deepStrictEqual(result.relations, [], 'no relations when no other in-flight specs exist');
            }

            // (b) oversized draft -> adoption succeeds with size-exceeded warning.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-oversized');
                const projectRoot = runtime.workspaceRoot;
                const oversizedCriteria = [1, 2, 3, 4, 5, 6, 7, 8, 9]
                    .map(n => `    { "id": "c${n}" }`).join(',\n');
                const draftPath = path.join(projectRoot, 'inbox', 'big-idea.md');
                writeText(draftPath, [
                    '# Big Idea', '',
                    '## Acceptance Criteria', '',
                    '```json',
                    '{', '  "criteria": [', oversizedCriteria, '  ]', '}',
                    '```', '',
                ].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, { now: new Date('2026-07-10T00:00:00Z') });
                assert.strictEqual(result.id, 'spec:big-idea', 'id derived from H1 title');
                assert.ok(result.warnings.includes('size-exceeded'), 'oversized draft yields size-exceeded warning');
                assert.strictEqual(result.size.acCount, 9, 'size metrics reflect the oversized criteria block');
                assert.ok(fs.existsSync(result.targetPath), 'oversized draft still adopted (WARN does not block)');
            }

            // (c) in-flight spec exists -> relation declaration required; opts.relations satisfies it.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-relations');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));

                const draftPath1 = path.join(projectRoot, 'inbox', 'new-one.md');
                const draftBody1 = ['# New One', '', 'Some body.', ''].join('\n');
                writeText(draftPath1, draftBody1);
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath1, {}),
                    err => err.code === 'EUSAGE' && /spec:existing/.test(err.message),
                    'missing relation declaration with an in-flight spec present must throw EUSAGE naming it'
                );
                // Transactional: validation runs before any fs mutation, so a
                // failed adopt leaves the source draft untouched at its origin
                // and never creates the target. Re-adopt with the relation.
                assert.ok(fs.existsSync(draftPath1), 'source draft untouched at origin after EUSAGE');
                assert.strictEqual(fs.readFileSync(draftPath1, 'utf8'), draftBody1, 'source draft content unchanged after EUSAGE');
                assert.ok(!fs.existsSync(path.join(projectRoot, 'docs', 'specs', 'new-one.md')), 'target not created on failed adopt');

                const result = specPortfolio.adoptSpec(projectRoot, draftPath1, {
                    relations: [{ kind: 'spawned-from', target: 'spec:existing' }],
                });
                assert.strictEqual(result.id, 'spec:new-one', 'id derived from H1 title');
                assert.deepStrictEqual(result.relations, [{ kind: 'spawned-from', target: 'spec:existing' }],
                    'declared relation returned in result');
                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                assert.ok(/relations:.*spawned-from.*spec:existing/.test(finalContent), 'relation written to frontmatter');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === 'spec:new-one');
                assert.ok(entry, 'adopted spec appears in registry');
                assert.deepStrictEqual(entry.relations, [{ kind: 'spawned-from', target: 'spec:existing' }],
                    'registry reader parses the relation written by adoptSpec');

                // opts.independent === true bypasses the requirement with no relations written.
                const draftPath2 = path.join(projectRoot, 'inbox', 'standalone.md');
                writeText(draftPath2, ['# Standalone', '', 'Some body.', ''].join('\n'));
                const resultIndependent = specPortfolio.adoptSpec(projectRoot, draftPath2, { independent: true });
                assert.deepStrictEqual(resultIndependent.relations, [], 'independent adoption returns empty relations');
                const independentContent = fs.readFileSync(resultIndependent.targetPath, 'utf8');
                assert.ok(!/relations:/.test(independentContent), 'independent adoption omits relations from frontmatter');
            }

            // (d) unknown relation target / invalid kind -> EUSAGE.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-bad-relations');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));

                const draftUnknown = path.join(projectRoot, 'inbox', 'unknown-target.md');
                writeText(draftUnknown, ['# Unknown Target', '', 'body', ''].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftUnknown, {
                        relations: [{ kind: 'spawned-from', target: 'spec:does-not-exist' }],
                    }),
                    err => err.code === 'EUSAGE' && /spec:does-not-exist/.test(err.message),
                    'unknown relation target must throw EUSAGE listing known ids'
                );

                const draftBadKind = path.join(projectRoot, 'inbox', 'bad-kind.md');
                writeText(draftBadKind, ['# Bad Kind', '', 'body', ''].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftBadKind, {
                        relations: [{ kind: 'nonsense-kind', target: 'spec:existing' }],
                    }),
                    err => err.code === 'EUSAGE',
                    'invalid relation kind must throw EUSAGE'
                );
            }

            // (e) empty file / target collision -> EUSAGE.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-empty-collision');
                const projectRoot = runtime.workspaceRoot;

                const emptyDraft = path.join(projectRoot, 'inbox', 'empty.md');
                writeText(emptyDraft, '   \n\n  ');
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, emptyDraft, {}),
                    err => err.code === 'EUSAGE',
                    'empty/whitespace-only draft must throw EUSAGE'
                );

                writeText(path.join(projectRoot, 'docs', 'specs', 'taken.md'), [
                    '---', 'id: spec:taken', 'status: adopted', '---', '', '# Taken', '',
                ].join('\n'));
                const collidingDraft = path.join(projectRoot, 'inbox', 'taken.md');
                writeText(collidingDraft, ['# Taken', '', 'body', ''].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, collidingDraft, {}),
                    err => err.code === 'EUSAGE',
                    'target path collision must throw EUSAGE'
                );
            }

            // (f) git repo: tracked draft adopted via git mv (rename, not delete+untracked).
            {
                const runtime = createTempRuntimeRoot('spec-adopt-git-mv');
                const projectRoot = runtime.workspaceRoot;
                runGit(projectRoot, ['init']);
                runGit(projectRoot, ['config', 'user.name', 'Evo Test']);
                runGit(projectRoot, ['config', 'user.email', 'evo@example.com']);

                const draftPath = path.join(projectRoot, 'inbox', 'tracked-draft.md');
                writeText(draftPath, ['# Tracked Draft', '', 'body content', ''].join('\n'));
                runGit(projectRoot, ['add', '.']);
                runGit(projectRoot, ['commit', '-m', 'chore: add tracked draft']);

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, {});
                assert.strictEqual(result.id, 'spec:tracked-draft', 'id derived from H1 title');

                const porcelain = runGit(projectRoot, ['status', '--porcelain']);
                assert.ok(/^R/m.test(porcelain), 'git status --porcelain shows a rename entry for the git-mv path');
                assert.ok(!/^\?\? inbox\/tracked-draft\.md/m.test(porcelain), 'old path must not appear as untracked');
                assert.ok(!/^D  inbox\/tracked-draft\.md/m.test(porcelain), 'old path must not appear as a bare stage delete (would indicate delete+untracked instead of rename)');
            }

            // (g) transactional guarantee: EUSAGE leaves source untouched, target uncreated.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-transactional');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'inflight.md'), [
                    '---', 'id: spec:inflight', 'status: adopted', '---', '', '# In Flight', '',
                ].join('\n'));

                const draftPath = path.join(projectRoot, 'inbox', 'blocked.md');
                const draftContent = ['# Blocked Draft', '', 'original body content.', ''].join('\n');
                writeText(draftPath, draftContent);

                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath, {}),
                    err => err.code === 'EUSAGE',
                    'missing relation declaration must throw EUSAGE'
                );
                assert.ok(fs.existsSync(draftPath), 'source draft still exists at its original path after EUSAGE');
                assert.strictEqual(fs.readFileSync(draftPath, 'utf8'), draftContent,
                    'source draft content is byte-for-byte unchanged after EUSAGE');
                assert.ok(!fs.existsSync(path.join(projectRoot, 'docs', 'specs', 'blocked-draft.md')),
                    'docs/specs/<kebab>.md was NOT created on the failed adopt');
            }

            // (h) explicit frontmatter id with a path-traversal suffix must be
            // kebab-sanitized like the derived-id branch — never used verbatim
            // as the target filename. Proves the escape is closed, not just warned.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-explicit-id-traversal');
                const projectRoot = runtime.workspaceRoot;
                const specsDir = path.join(projectRoot, 'docs', 'specs');

                const draftPath = path.join(projectRoot, 'inbox', 'escape.md');
                writeText(draftPath, [
                    '---', 'id: spec:../../escape', 'status: draft', '---', '', '# Escape', '',
                ].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true });
                const resolvedTarget = path.resolve(result.targetPath);
                assert.ok(resolvedTarget.startsWith(path.resolve(specsDir) + path.sep),
                    `target must resolve UNDER docs/specs/, got ${resolvedTarget}`);
                assert.ok(!fs.existsSync(path.join(projectRoot, 'pwned.md')),
                    'no file written outside docs/specs/ (repo-root escape closed)');
                assert.ok(!fs.existsSync(path.resolve(projectRoot, '..', 'pwned.md')),
                    'no file written above the project root (parent-dir escape closed)');
                assert.strictEqual(result.id, 'spec:escape', 'explicit path-traversal id is normalized to spec:escape');

                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                const { frontmatter: finalFm } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown')).parseFrontmatter(finalContent);
                assert.strictEqual(finalFm.id, 'spec:escape', 'stored frontmatter id normalized, not the raw traversal string');
            }

            // (i) explicit frontmatter id with spaces must be kebab-cased, not
            // written verbatim (the exact thing the gate exists to prevent).
            {
                const runtime = createTempRuntimeRoot('spec-adopt-explicit-id-spaces');
                const projectRoot = runtime.workspaceRoot;

                const draftPath = path.join(projectRoot, 'inbox', 'spaced.md');
                writeText(draftPath, [
                    '---', 'id: spec:My Spec Id', 'status: draft', '---', '', '# Spaced', '',
                ].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true });
                assert.strictEqual(result.id, 'spec:my-spec-id', 'explicit id with spaces normalized via kebabCase');
                const expectedTarget = path.join(projectRoot, 'docs', 'specs', 'my-spec-id.md');
                assert.strictEqual(result.targetPath, expectedTarget, 'target filename is kebab-cased, no spaces');
                assert.ok(fs.existsSync(expectedTarget), 'kebab-cased target exists');
            }

            // (j) explicit frontmatter id with an empty/unusable suffix -> EUSAGE.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-explicit-id-empty');
                const projectRoot = runtime.workspaceRoot;

                const draftPath = path.join(projectRoot, 'inbox', 'empty-id.md');
                writeText(draftPath, [
                    '---', 'id: spec:', 'status: draft', '---', '', '# Empty Id', '',
                ].join('\n'));

                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true }),
                    err => err.code === 'EUSAGE' && /unusable spec id/.test(err.message),
                    'id: spec: (empty suffix) must throw EUSAGE, not silently produce a bad target'
                );

                const draftPath2 = path.join(projectRoot, 'inbox', 'slashes-id.md');
                writeText(draftPath2, [
                    '---', 'id: spec:///', 'status: draft', '---', '', '# Slashes Id', '',
                ].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath2, { independent: true }),
                    err => err.code === 'EUSAGE' && /unusable spec id/.test(err.message),
                    'id: spec:/// (kebab-cases to empty) must throw EUSAGE'
                );
            }

            // (k) P0 SECURITY: source-path containment — adopt must refuse a draft
            // that lives OUTSIDE the workspace (absolute path to a sibling temp dir).
            // The file must be left untouched at its origin, and no target created.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-outside-abs');
                const projectRoot = runtime.workspaceRoot;
                const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-adopt-outside-'));
                const outsidePath = path.join(outsideDir, 'outside.md');
                const outsideContent = ['# Outside', '', 'body', ''].join('\n');
                writeText(outsidePath, outsideContent);

                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, outsidePath, { independent: true }),
                    err => err.code === 'EUSAGE' && /workspace/.test(err.message),
                    'absolute external path must throw EUSAGE naming the workspace containment'
                );
                assert.ok(fs.existsSync(outsidePath), 'external source file untouched at origin');
                assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), outsideContent,
                    'external source content byte-for-byte unchanged');
                assert.ok(!fs.existsSync(path.join(projectRoot, 'docs', 'specs', 'outside.md')),
                    'no target created inside the workspace from an external source');

                fs.rmSync(outsideDir, { recursive: true, force: true });
            }

            // (l) P0 SECURITY: relative traversal (`../escape.md`) resolving outside
            // the workspace must also be refused by the containment gate.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-outside-rel');
                const projectRoot = runtime.workspaceRoot;
                const parentDir = path.dirname(projectRoot);
                const escapePath = path.join(parentDir, `escape-${path.basename(projectRoot)}.md`);
                const escapeContent = ['# Escape Rel', '', 'body', ''].join('\n');
                writeText(escapePath, escapeContent);

                const relTraversal = path.relative(projectRoot, escapePath);
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, relTraversal, { independent: true }),
                    err => err.code === 'EUSAGE' && /workspace/.test(err.message),
                    'relative traversal resolving outside the workspace must throw EUSAGE'
                );
                assert.ok(fs.existsSync(escapePath), 'traversal-target source file untouched at origin');
                assert.strictEqual(fs.readFileSync(escapePath, 'utf8'), escapeContent,
                    'traversal-target source content byte-for-byte unchanged');

                fs.rmSync(escapePath, { force: true });
            }

            // (m) P0 SECURITY: a symlink INSIDE the workspace pointing at an external
            // file must be refused (symlink source, regardless of where it points).
            {
                const runtime = createTempRuntimeRoot('spec-adopt-symlink-source');
                const projectRoot = runtime.workspaceRoot;
                const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-adopt-symlink-target-'));
                const outsideTarget = path.join(outsideDir, 'target.md');
                const outsideContent = ['# Symlink Target', '', 'body', ''].join('\n');
                writeText(outsideTarget, outsideContent);

                const linkPath = path.join(projectRoot, 'inbox', 'link.md');
                fs.mkdirSync(path.dirname(linkPath), { recursive: true });
                let symlinked = true;
                try {
                    fs.symlinkSync(outsideTarget, linkPath, 'file');
                } catch (_) { symlinked = false; }

                if (symlinked) {
                    assert.throws(
                        () => specPortfolio.adoptSpec(projectRoot, linkPath, { independent: true }),
                        err => err.code === 'EUSAGE' && /symlink/.test(err.message),
                        'symlink source must throw EUSAGE refusing the symlink'
                    );
                    assert.ok(fs.existsSync(outsideTarget), 'external symlink target untouched');
                    assert.strictEqual(fs.readFileSync(outsideTarget, 'utf8'), outsideContent,
                        'external symlink target content byte-for-byte unchanged');
                } else {
                    console.log('   (symlink unavailable on this FS — skipped)');
                }

                fs.rmSync(outsideDir, { recursive: true, force: true });
            }

            // (n) P0: non-.md source file (inside the workspace, otherwise legit) -> EUSAGE.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-non-md');
                const projectRoot = runtime.workspaceRoot;
                const draftPath = path.join(projectRoot, 'inbox', 'note.txt');
                writeText(draftPath, ['# Note', '', 'body', ''].join('\n'));

                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true }),
                    err => err.code === 'EUSAGE' && /\.md/.test(err.message),
                    'non-.md source file must throw EUSAGE'
                );
                assert.ok(fs.existsSync(draftPath), 'non-.md source untouched at origin');
            }

            // (o) P1.3: opts.independent === true persists a relationMode marker,
            // with NO relations: line, and buildSpecRegistry surfaces it.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-relationmode-independent');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));

                const draftPath = path.join(projectRoot, 'inbox', 'declared-independent.md');
                writeText(draftPath, ['# Declared Independent', '', 'body', ''].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true });
                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                assert.ok(/relationMode:\s*independent/.test(finalContent),
                    'independent adoption writes relationMode: independent to frontmatter');
                assert.ok(!/^relations:/m.test(finalContent),
                    'independent adoption still omits a relations: line');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === result.id);
                assert.ok(entry, 'adopted spec appears in registry');
                assert.strictEqual(entry.relationMode, 'independent',
                    'registry surfaces relationMode === "independent" for a declared-independent spec');
            }

            // (p) P1.3: explicit --relation adoption writes relations:, no relationMode,
            // and the registry entry's relationMode is null/absent.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-relationmode-relations');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));

                const draftPath = path.join(projectRoot, 'inbox', 'declared-relation.md');
                writeText(draftPath, ['# Declared Relation', '', 'body', ''].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, {
                    relations: [{ kind: 'spawned-from', target: 'spec:existing' }],
                });
                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                assert.ok(/^relations:/m.test(finalContent), 'explicit relation adoption writes relations:');
                assert.ok(!/relationMode:/.test(finalContent),
                    'explicit relation adoption does NOT write a relationMode key');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === result.id);
                assert.ok(entry, 'adopted spec appears in registry');
                assert.ok(entry.relationMode === null || entry.relationMode === undefined,
                    'registry relationMode is null/absent for an explicit-relation spec');
            }

            // (q) P1.3: neither independent nor relations declared, no in-flight specs
            // exist -> succeeds, neither relations: nor relationMode: written, and the
            // registry entry's relationMode is null/absent.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-relationmode-neither');
                const projectRoot = runtime.workspaceRoot;

                const draftPath = path.join(projectRoot, 'inbox', 'declared-neither.md');
                writeText(draftPath, ['# Declared Neither', '', 'body', ''].join('\n'));

                const result = specPortfolio.adoptSpec(projectRoot, draftPath, {});
                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                assert.ok(!/^relations:/m.test(finalContent), 'no in-flight specs: no relations: line written');
                assert.ok(!/relationMode:/.test(finalContent), 'no in-flight specs: no relationMode: line written');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === result.id);
                assert.ok(entry, 'adopted spec appears in registry');
                assert.ok(entry.relationMode === null || entry.relationMode === undefined,
                    'registry relationMode is null/absent when neither was declared');
            }

            // (r) P0 SECURITY (output side): docs/specs is a symlink to an
            // external dir. A legit in-workspace draft must NOT be moved/written
            // through the symlink out of the workspace.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-target-specs-symlink');
                const projectRoot = runtime.workspaceRoot;
                const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-adopt-target-outside-'));
                fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
                let symlinked = true;
                try {
                    fs.symlinkSync(outsideDir, path.join(projectRoot, 'docs', 'specs'), 'dir');
                } catch (_) { symlinked = false; }
                if (symlinked) {
                    const draftPath = path.join(projectRoot, 'inbox', 'legit.md');
                    writeText(draftPath, ['# Legit', '', 'body', ''].join('\n'));
                    assert.throws(
                        () => specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true }),
                        err => err.code === 'EUSAGE' && /symlink|workspace|escape/i.test(err.message),
                        'symlinked docs/specs target dir must throw EUSAGE'
                    );
                    assert.ok(fs.existsSync(draftPath), 'source draft not moved when target dir is a symlink');
                    assert.strictEqual(fs.readdirSync(outsideDir).length, 0,
                        'no file written into the external symlink target dir');
                } else {
                    console.log('   (r: symlink unavailable on this FS — skipped)');
                }
            }

            // (s) P0 SECURITY: docs itself is a symlink to an external dir.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-target-docs-symlink');
                const projectRoot = runtime.workspaceRoot;
                const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-adopt-docs-outside-'));
                let symlinked = true;
                try {
                    fs.symlinkSync(outsideDir, path.join(projectRoot, 'docs'), 'dir');
                } catch (_) { symlinked = false; }
                if (symlinked) {
                    const draftPath = path.join(projectRoot, 'inbox', 'legit2.md');
                    writeText(draftPath, ['# Legit2', '', 'body', ''].join('\n'));
                    assert.throws(
                        () => specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true }),
                        err => err.code === 'EUSAGE' && /symlink|workspace|escape/i.test(err.message),
                        'symlinked docs/ parent dir must throw EUSAGE'
                    );
                    assert.ok(fs.existsSync(draftPath), 'source draft not moved when docs/ is a symlink');
                    assert.ok(!fs.existsSync(path.join(outsideDir, 'specs', 'legit2.md')),
                        'no file written through the docs/ symlink into the external dir');
                } else {
                    console.log('   (s: symlink unavailable on this FS — skipped)');
                }
            }

            // (t) P1: --independent and --relation are mutually exclusive; passing
            // both must be an explicit EUSAGE, not a silent precedence pick.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-mutex');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));
                const draftPath = path.join(projectRoot, 'inbox', 'both.md');
                writeText(draftPath, ['# Both', '', 'body', ''].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath, {
                        independent: true,
                        relations: [{ kind: 'spawned-from', target: 'spec:existing' }],
                    }),
                    err => err.code === 'EUSAGE' && /mutually exclusive|independent/i.test(err.message),
                    '--independent + --relation together must throw EUSAGE'
                );
                assert.ok(fs.existsSync(draftPath), 'source draft not moved on mutex EUSAGE');
            }

            // (u) P1: a draft carrying a stale relationMode: is canonically rebuilt
            // from CLI args only — no duplicate/stale relationMode when --relation wins.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-relationmode-reserved');
                const projectRoot = runtime.workspaceRoot;
                writeText(path.join(projectRoot, 'docs', 'specs', 'existing.md'), [
                    '---', 'id: spec:existing', 'status: adopted', '---', '', '# Existing', '',
                ].join('\n'));
                const draftPath = path.join(projectRoot, 'inbox', 'stale-mode.md');
                writeText(draftPath, [
                    '---', 'id: spec:stale-mode', 'status: draft', 'relationMode: independent', '---',
                    '', '# Stale Mode', '', 'body', '',
                ].join('\n'));
                const result = specPortfolio.adoptSpec(projectRoot, draftPath, {
                    relations: [{ kind: 'spawned-from', target: 'spec:existing' }],
                });
                const finalContent = fs.readFileSync(result.targetPath, 'utf8');
                assert.ok(/^relations:/m.test(finalContent), 'relation adoption writes relations:');
                assert.ok(!/relationMode:/.test(finalContent),
                    'stale relationMode: is dropped when --relation wins (reserved key, canonical rebuild)');
                assert.strictEqual((finalContent.match(/relationMode:/g) || []).length, 0,
                    'no duplicate/stale relationMode key survives');
            }

            // (v) P0 target-dir gate, symlink-free proof (runs on every FS incl.
            // Windows without symlink privilege): docs/specs existing as a regular
            // FILE (not a dir) must be rejected before any move/write.
            {
                const runtime = createTempRuntimeRoot('spec-adopt-target-nondir');
                const projectRoot = runtime.workspaceRoot;
                fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
                fs.writeFileSync(path.join(projectRoot, 'docs', 'specs'), 'not a dir', 'utf8');
                const draftPath = path.join(projectRoot, 'inbox', 'blocked.md');
                writeText(draftPath, ['# Blocked', '', 'body', ''].join('\n'));
                assert.throws(
                    () => specPortfolio.adoptSpec(projectRoot, draftPath, { independent: true }),
                    err => err.code === 'EUSAGE' && /non-directory|symlink|workspace/i.test(err.message),
                    'docs/specs as a regular file must throw EUSAGE (target-dir gate runs)'
                );
                assert.ok(fs.existsSync(draftPath), 'source draft not moved when target dir is blocked');
            }
        }
        console.log('✅ T-spec-adopt passed');

        console.log('T-spec-park-reactivate. Testing parkSpec/reactivateSpec status transitions + cascade ...');
        {
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            assert.strictEqual(typeof specPortfolio.parkSpec, 'function', 'parkSpec must be exported');
            assert.strictEqual(typeof specPortfolio.reactivateSpec, 'function', 'reactivateSpec must be exported');

            const runtime = createTempRuntimeRoot('spec-park-reactivate');
            const projectRoot = runtime.workspaceRoot;

            // p-active: adopted status, has a non-done linked plan -> derived state 'active'.
            writeText(path.join(projectRoot, 'docs', 'specs', 'p-active.md'), [
                '---', 'id: spec:p-active', 'status: adopted', '---', '', '# P Active', '',
            ].join('\n'));

            // p-adopted: adopted status, no linked plan -> derived state 'adopted'.
            writeText(path.join(projectRoot, 'docs', 'specs', 'p-adopted.md'), [
                '---', 'id: spec:p-adopted', 'status: adopted', '---', '', '# P Adopted', '',
            ].join('\n'));

            // r-active-parked: starts parked, has a non-done linked plan -> reactivate should surface 'active'.
            writeText(path.join(projectRoot, 'docs', 'specs', 'r-active-parked.md'), [
                '---', 'id: spec:r-active-parked', 'status: parked', 'parkedUntil: some old reason', '---', '', '# R Active Parked', '',
            ].join('\n'));

            // r-adopted-parked: starts parked, no linked plan -> reactivate should surface 'adopted'.
            writeText(path.join(projectRoot, 'docs', 'specs', 'r-adopted-parked.md'), [
                '---', 'id: spec:r-adopted-parked', 'status: parked', '---', '', '# R Adopted Parked', '',
            ].join('\n'));

            writeText(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1',
                specs: [],
                plans: [
                    { id: 'plan:p1', status: 'active', linkedSpec: 'spec:p-active', sourcePath: 'docs/plans/p1.md' },
                    { id: 'plan:r1', status: 'active', linkedSpec: 'spec:r-active-parked', sourcePath: 'docs/plans/r1.md' },
                ],
                tasks: [],
                warnings: [],
            }, null, 2));

            // (a) park an active spec with opts.until -> frontmatter status:
            // parked + parkedUntil verbatim; registry state 'parked' AND
            // zombie-plan cascade warning (its linked plan is not done).
            {
                const result = specPortfolio.parkSpec(projectRoot, 'spec:p-active', { until: 'after v3 ships' });
                assert.deepStrictEqual(result, { id: 'spec:p-active', state: 'parked', parkedUntil: 'after v3 ships' },
                    'parkSpec return contract');

                const filePath = path.join(projectRoot, 'docs', 'specs', 'p-active.md');
                const { frontmatter } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown')).parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
                assert.strictEqual(frontmatter.status, 'parked', 'frontmatter status rewritten to parked');
                assert.strictEqual(frontmatter.parkedUntil, 'after v3 ships', 'parkedUntil written verbatim');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === 'spec:p-active');
                assert.strictEqual(entry.state, 'parked', 'registry entry state is parked after park');
                assert.ok(entry.warnings.includes('zombie-plan'), 'zombie-plan cascade warning surfaces for a parked spec with an active linked plan');
            }

            // (b) park an adopted spec (no linked plan) with no `until` ->
            // status: parked, NO parkedUntil key; registry state 'parked',
            // no zombie-plan warning.
            {
                const result = specPortfolio.parkSpec(projectRoot, 'spec:p-adopted', {});
                assert.deepStrictEqual(result, { id: 'spec:p-adopted', state: 'parked', parkedUntil: null },
                    'parkSpec with no until returns parkedUntil: null');

                const filePath = path.join(projectRoot, 'docs', 'specs', 'p-adopted.md');
                const finalContent = fs.readFileSync(filePath, 'utf8');
                const { frontmatter } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown')).parseFrontmatter(finalContent);
                assert.strictEqual(frontmatter.status, 'parked', 'frontmatter status rewritten to parked');
                assert.ok(!('parkedUntil' in frontmatter), 'parkedUntil key omitted when opts.until is not set');
                assert.ok(!/parkedUntil/.test(finalContent), 'parkedUntil never written to disk when omitted');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === 'spec:p-adopted');
                assert.strictEqual(entry.state, 'parked', 'registry entry state is parked');
                assert.ok(!entry.warnings.includes('zombie-plan'), 'no zombie-plan warning for a parked spec with no linked plan');
            }

            // (c) reactivate a parked spec that HAS a non-done linked plan ->
            // returns state 'active'; frontmatter status adopted, parkedUntil
            // removed; registry entry state 'active'.
            {
                const result = specPortfolio.reactivateSpec(projectRoot, 'spec:r-active-parked');
                assert.deepStrictEqual(result, { id: 'spec:r-active-parked', state: 'active' },
                    'reactivateSpec returns derived state active when a non-done linked plan exists');

                const filePath = path.join(projectRoot, 'docs', 'specs', 'r-active-parked.md');
                const finalContent = fs.readFileSync(filePath, 'utf8');
                const { frontmatter } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown')).parseFrontmatter(finalContent);
                assert.strictEqual(frontmatter.status, 'adopted', 'frontmatter status rewritten to adopted on reactivate');
                assert.ok(!('parkedUntil' in frontmatter), 'parkedUntil key removed on reactivate');
                assert.ok(!/parkedUntil/.test(finalContent), 'parkedUntil never present on disk after reactivate');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === 'spec:r-active-parked');
                assert.strictEqual(entry.state, 'active', 'registry entry state is active after reactivate');
            }

            // (d) reactivate a parked spec with NO linked plan -> returns
            // state 'adopted'.
            {
                const result = specPortfolio.reactivateSpec(projectRoot, 'spec:r-adopted-parked');
                assert.deepStrictEqual(result, { id: 'spec:r-adopted-parked', state: 'adopted' },
                    'reactivateSpec returns derived state adopted when no linked plan exists');

                const registry = specPortfolio.buildSpecRegistry(projectRoot, { write: false });
                const entry = registry.specs.find(s => s.id === 'spec:r-adopted-parked');
                assert.strictEqual(entry.state, 'adopted', 'registry entry state is adopted after reactivate');
            }

            // (e) parkSpec / reactivateSpec on unknown id -> EUSAGE.
            {
                assert.throws(
                    () => specPortfolio.parkSpec(projectRoot, 'spec:does-not-exist', {}),
                    err => err.code === 'EUSAGE',
                    'parkSpec on unknown id must throw EUSAGE'
                );
                assert.throws(
                    () => specPortfolio.reactivateSpec(projectRoot, 'spec:does-not-exist'),
                    err => err.code === 'EUSAGE',
                    'reactivateSpec on unknown id must throw EUSAGE'
                );
            }
        }
        console.log('✅ T-spec-park-reactivate passed');

        console.log('T-cp-contract. Testing code-perception provider contract validation ...');
        {
            const contract = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-contract'));
            const {
                FRESHNESS, DIRTY, COMPAT, INDEX,
                CAPABILITY_KEYS, CAPABILITY_METHOD, STATUS_ONLY_CAPABILITIES,
                validateProvider, validateAvailability, validateStatus,
            } = contract;

            assert.deepStrictEqual(CAPABILITY_KEYS, [
                'files', 'symbols', 'source', 'callers', 'callees', 'trace', 'impact',
                'affectedTests', 'modules', 'flows', 'summaries', 'layers', 'tours',
                'semanticSearch', 'incrementalIndex',
            ], 'CAPABILITY_KEYS must be exactly the 15 capability names in order');
            assert.deepStrictEqual(STATUS_ONLY_CAPABILITIES, ['incrementalIndex'], 'STATUS_ONLY_CAPABILITIES must be [\'incrementalIndex\']');
            assert.ok(Object.isFrozen(CAPABILITY_KEYS), 'CAPABILITY_KEYS must be frozen');
            assert.ok(Object.isFrozen(CAPABILITY_METHOD), 'CAPABILITY_METHOD must be frozen');
            assert.ok(Object.isFrozen(STATUS_ONLY_CAPABILITIES), 'STATUS_ONLY_CAPABILITIES must be frozen');
            assert.ok(Object.isFrozen(FRESHNESS), 'FRESHNESS must be frozen');
            assert.ok(Object.isFrozen(DIRTY), 'DIRTY must be frozen');
            assert.ok(Object.isFrozen(COMPAT), 'COMPAT must be frozen');
            assert.ok(Object.isFrozen(INDEX), 'INDEX must be frozen');

            function goodProvider() {
                const capabilities = {};
                for (const key of CAPABILITY_KEYS) capabilities[key] = false;
                return {
                    id: 'demo-provider',
                    name: 'Demo Provider',
                    adapterVersion: '1.0.0',
                    capabilities,
                    check: () => ({}),
                    getStatus: () => ({}),
                };
            }

            function goodStatus() {
                const capabilities = {};
                for (const key of CAPABILITY_KEYS) capabilities[key] = false;
                return {
                    ready: true,
                    available: true,
                    indexState: INDEX.READY,
                    freshness: FRESHNESS.FRESH,
                    dirty: DIRTY.CLEAN,
                    compatibility: COMPAT.SUPPORTED,
                    capabilities,
                };
            }

            // 1. fully-valid provider -> valid:true, no diagnostics.
            {
                const result = validateProvider(goodProvider());
                assert.strictEqual(result.valid, true, 'goodProvider() must be valid');
                assert.deepStrictEqual(result.diagnostics, [], 'goodProvider() must have no diagnostics');
            }

            // 2. missing id -> diagnostic code includes missing-id.
            {
                const p = goodProvider();
                delete p.id;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'provider missing id must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'missing-id'), 'diagnostics must include missing-id');
            }

            // 3. capability non-boolean -> capability-not-boolean.
            {
                const p = goodProvider();
                p.capabilities.files = 'yes';
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'non-boolean capability must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'capability-not-boolean:files'), 'diagnostics must include capability-not-boolean:files');
            }

            // 4. impact:true with no impact method -> invalid, diagnostic mentions impact.
            {
                const p = goodProvider();
                p.capabilities.impact = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'impact capability without impact method must be invalid');
                assert.ok(result.diagnostics.some(d => d.code.includes('impact')), 'diagnostics must mention impact');
            }

            // 5. source:true with no getEntity -> invalid.
            {
                const p = goodProvider();
                p.capabilities.source = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'source capability without getEntity method must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'capability-method-missing:source->:getEntity'), 'diagnostics must include capability-method-missing:source->:getEntity');
            }

            // 6. symbols:true with no search -> invalid.
            {
                const p = goodProvider();
                p.capabilities.symbols = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'symbols capability without search method must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'capability-method-missing:symbols->:search'), 'diagnostics must include capability-method-missing:symbols->:search');
            }

            // 7. affectedTests:true with no getAffectedTests -> invalid.
            {
                const p = goodProvider();
                p.capabilities.affectedTests = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'affectedTests capability without getAffectedTests method must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'capability-method-missing:affectedTests->:getAffectedTests'), 'diagnostics must include capability-method-missing:affectedTests->:getAffectedTests');
            }

            // 8. trace:true with no explore -> invalid.
            {
                const p = goodProvider();
                p.capabilities.trace = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, false, 'trace capability without explore method must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'capability-method-missing:trace->:explore'), 'diagnostics must include capability-method-missing:trace->:explore');
            }

            // 9. incrementalIndex:true with no extra method -> valid:TRUE (status-only).
            {
                const p = goodProvider();
                p.capabilities.incrementalIndex = true;
                const result = validateProvider(p);
                assert.strictEqual(result.valid, true, 'incrementalIndex capability requires no method (status-only)');
                assert.deepStrictEqual(result.diagnostics, [], 'incrementalIndex-only provider must have no diagnostics');
            }

            // 10. validateStatus with freshness:false -> status-invalid:freshness.
            {
                const s = goodStatus();
                s.freshness = false;
                const result = validateStatus(s);
                assert.strictEqual(result.valid, false, 'status with freshness:false must be invalid');
                assert.ok(result.diagnostics.some(d => d.code === 'status-invalid:freshness'), 'diagnostics must include status-invalid:freshness');
            }

            // 11. validateStatus on fully-valid status -> valid:true.
            {
                const result = validateStatus(goodStatus());
                assert.strictEqual(result.valid, true, 'goodStatus() must be valid');
                assert.deepStrictEqual(result.diagnostics, [], 'goodStatus() must have no diagnostics');
            }

            // 12. All three validators on null/undefined -> valid:false, never throw.
            {
                for (const validator of [validateProvider, validateAvailability, validateStatus]) {
                    for (const badInput of [null, undefined]) {
                        let result;
                        assert.doesNotThrow(() => { result = validator(badInput); }, `${validator.name} must not throw on ${badInput}`);
                        assert.strictEqual(result.valid, false, `${validator.name}(${badInput}) must be valid:false`);
                        assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0, `${validator.name}(${badInput}) must return non-empty diagnostics`);
                    }
                }
            }

            // Bonus: validateAvailability sanity on a good/bad object.
            {
                const good = validateAvailability({ available: true, ready: true, indexState: INDEX.READY, installed: true });
                assert.strictEqual(good.valid, true, 'valid availability object must pass');

                const bad = validateAvailability({ available: 'yes', ready: true, indexState: 'bogus' });
                assert.strictEqual(bad.valid, false, 'invalid availability object must fail');
                assert.ok(bad.diagnostics.length > 0, 'invalid availability object must produce diagnostics');
            }
        }
        console.log('✅ T-cp-contract passed');

        console.log('T-cp-normalize. Testing code-perception normalized reference + result models ...');
        {
            const normalize = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'normalize'));
            const contract = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-contract'));
            const { FRESHNESS, DIRTY } = contract;
            const {
                makeReferenceId, normalizeReference, normalizeSearchResult,
                normalizeRelationship, normalizeImpactResult,
            } = normalize;

            // 1. makeReferenceId shape: prefix + 12-char lowercase hex tail.
            {
                const id = makeReferenceId('provider:a', 'ent-1');
                assert.ok(id.startsWith('code-ref:provider:a:'), 'id must start with code-ref:provider:a:');
                const tail = id.slice('code-ref:provider:a:'.length);
                assert.strictEqual(tail.length, 12, 'tail must be 12 chars');
                assert.ok(/^[0-9a-f]{12}$/.test(tail), 'tail must be lowercase hex');
            }

            // 2. anti-name-merge invariant: same providerEntityId, different providerId -> different ids.
            {
                assert.notStrictEqual(makeReferenceId('p1', 'x'), makeReferenceId('p2', 'x'), 'different providerId must yield different ids for the same providerEntityId');
            }

            // 3. deterministic: same args -> identical id.
            {
                assert.strictEqual(makeReferenceId('p1', 'x'), makeReferenceId('p1', 'x'), 'makeReferenceId must be deterministic');
            }

            // 4. normalizeReference happy path.
            {
                const ref = normalizeReference('prov', {
                    providerEntityId: 'E', name: 'foo', kind: 'function',
                    snapshot: { freshness: 'stale', dirty: 'clean' },
                });
                assert.strictEqual(ref.providerEntityId, 'E', 'providerEntityId must be preserved');
                assert.ok(ref.id.startsWith('code-ref:prov:'), 'id must embed providerId');
                assert.strictEqual(ref.kind, 'function', 'kind must pass through when legal');
                assert.strictEqual(ref.snapshot.freshness, 'stale', 'freshness must pass through when legal');
                assert.strictEqual(ref.snapshot.dirty, 'clean', 'dirty must pass through when legal');
            }

            // 5. illegal kind/freshness/dirty coerce to safe fallbacks.
            {
                const ref = normalizeReference('prov', {
                    providerEntityId: 'E2', name: 'bar', kind: 'weird',
                    snapshot: { freshness: false, dirty: 'nope' },
                });
                assert.strictEqual(ref.kind, 'unknown', 'illegal kind must coerce to unknown');
                assert.strictEqual(ref.snapshot.freshness, FRESHNESS.UNKNOWN, 'illegal freshness must coerce to FRESHNESS.UNKNOWN');
                assert.strictEqual(ref.snapshot.dirty, DIRTY.UNKNOWN, 'illegal dirty must coerce to DIRTY.UNKNOWN');
            }

            // 6. normalizeRelationship happy path + invalid kind coercion + distinct source/target ids.
            {
                const srcRaw = { providerEntityId: 'src-1', name: 'srcFn', kind: 'function' };
                const tgtRaw = { providerEntityId: 'tgt-1', name: 'tgtFn', kind: 'function' };
                const rel = normalizeRelationship('p', srcRaw, tgtRaw, 'calls', 0.9);
                assert.strictEqual(rel.kind, 'calls', 'legal kind must pass through');
                assert.ok(rel.source.id.startsWith('code-ref:p:'), 'source id must embed providerId');
                assert.ok(rel.target.id.startsWith('code-ref:p:'), 'target id must embed providerId');
                assert.notStrictEqual(rel.source.id, rel.target.id, 'source and target ids must differ for distinct raws');

                const badRel = normalizeRelationship('p', srcRaw, tgtRaw, 'frobnicate', 0.5);
                assert.strictEqual(badRel.kind, 'references', 'invalid relationship kind must coerce to references');
            }

            // 7. normalizeSearchResult: query, matches, provider identity passthrough.
            {
                const providerStatus = { providerId: 'p' };
                const rawA = { providerEntityId: 'a', name: 'A', kind: 'function' };
                const rawB = { providerEntityId: 'b', name: 'B', kind: 'function' };
                const result = normalizeSearchResult(providerStatus, { query: 'q', matches: [rawA, rawB] });
                assert.strictEqual(result.matches.length, 2, 'matches length must be 2');
                for (const m of result.matches) {
                    assert.ok(m.id, 'each match must have an id');
                    assert.strictEqual(m.providerId, 'p', 'each match providerId must be p');
                }
                assert.strictEqual(result.query, 'q', 'query must pass through');
                assert.strictEqual(result.provider, providerStatus, 'provider must be the passed status object (identity)');
            }

            // 8. normalizeImpactResult happy path.
            {
                const providerStatus = { providerId: 'p' };
                const rawA = { providerEntityId: 'a', name: 'A', kind: 'function' };
                const rawB = { providerEntityId: 'b', name: 'B', kind: 'function' };
                const rawC = { providerEntityId: 'c', name: 'C', kind: 'test' };
                const result = normalizeImpactResult(providerStatus, {
                    target: rawA, upstream: [rawB], downstream: [], affectedTests: [rawC], risk: 'high',
                });
                assert.ok(result.target.id, 'target id must be present');
                assert.strictEqual(result.upstream.length, 1, 'upstream length must be 1');
                assert.strictEqual(result.affectedTests.length, 1, 'affectedTests length must be 1');
                assert.strictEqual(result.risk, 'high', 'risk must pass through when legal');
                assert.strictEqual(result.provider.providerId, 'p', 'provider must pass through');
            }

            // 9. never throws on null/undefined/missing-field input; best-effort shape.
            {
                assert.doesNotThrow(() => makeReferenceId(undefined, undefined), 'makeReferenceId must not throw on undefined');
                assert.doesNotThrow(() => makeReferenceId(null, null), 'makeReferenceId must not throw on null');

                let ref;
                assert.doesNotThrow(() => { ref = normalizeReference('p', null); }, 'normalizeReference must not throw on null raw');
                assert.strictEqual(ref.kind, 'unknown', 'normalizeReference(p, null) must yield kind:unknown');
                assert.strictEqual(ref.snapshot.freshness, FRESHNESS.UNKNOWN, 'normalizeReference(p, null) must yield UNKNOWN freshness');
                assert.strictEqual(ref.snapshot.dirty, DIRTY.UNKNOWN, 'normalizeReference(p, null) must yield UNKNOWN dirty');

                assert.doesNotThrow(() => normalizeReference(undefined, undefined), 'normalizeReference must not throw on undefined/undefined');
                assert.doesNotThrow(() => normalizeSearchResult(undefined, undefined), 'normalizeSearchResult must not throw on undefined/undefined');
                assert.doesNotThrow(() => normalizeSearchResult(undefined, []), 'normalizeSearchResult must not throw on undefined status + array matches');
                assert.doesNotThrow(() => normalizeRelationship(undefined, undefined, undefined, undefined, undefined), 'normalizeRelationship must not throw on all-undefined');
                assert.doesNotThrow(() => normalizeImpactResult(undefined, undefined), 'normalizeImpactResult must not throw on undefined/undefined');
            }

            // Bonus: normalizeSearchResult accepts a bare array with query=''.
            {
                const rawA = { providerEntityId: 'a', name: 'A', kind: 'function' };
                const result = normalizeSearchResult({ providerId: 'p' }, [rawA]);
                assert.strictEqual(result.query, '', 'bare array input must yield query===\'\'');
                assert.strictEqual(result.matches.length, 1, 'bare array input must still normalize matches');
                assert.deepStrictEqual(result.diagnostics, [], 'diagnostics default to [] when absent');
            }
        }
        console.log('✅ T-cp-normalize passed');

        console.log('T-cp-fixture. Testing code-perception fixture provider (contract-conformant, subprocess-free) ...');
        {
            const contract = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-contract'));
            const fixture = require(path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception', 'fixture-provider'));

            const p = fixture.create();

            // 1. provider itself is contract-conformant.
            {
                const result = contract.validateProvider(p);
                assert.strictEqual(result.valid, true, 'fixture provider must be valid per validateProvider');
                assert.deepStrictEqual(result.diagnostics, [], 'fixture provider must have no diagnostics');
            }

            // 2. getStatus() passes validateStatus and reflects fixture-status.json's tri-state strings.
            {
                const status = p.getStatus({});
                const result = contract.validateStatus(status);
                assert.strictEqual(result.valid, true, 'fixture getStatus() must be valid per validateStatus');
                assert.strictEqual(status.freshness, contract.FRESHNESS.FRESH, 'freshness must be fresh');
                assert.strictEqual(status.dirty, contract.DIRTY.CLEAN, 'dirty must be clean');
                assert.strictEqual(status.indexState, contract.INDEX.READY, 'indexState must be ready');
            }

            // 3. check() passes validateAvailability.
            {
                const result = contract.validateAvailability(p.check({}));
                assert.strictEqual(result.valid, true, 'fixture check() must be valid per validateAvailability');
            }

            // 4. search() returns a normalized UnifiedSearchResult.
            {
                const result = p.search({}, 'parseConfig');
                assert.strictEqual(result.matches.length, 2, 'search must return 2 matches');
                assert.strictEqual(result.query, 'parseConfig', 'search query must pass through');
                for (const m of result.matches) {
                    assert.ok(m.id.startsWith('code-ref:provider:fixture:'), 'each match id must start with code-ref:provider:fixture:');
                }
            }

            // 5. getCallers() returns normalized relationships with provider-scoped ids.
            {
                const rels = p.getCallers({}, { providerEntityId: 'sym:parseConfig' });
                assert.strictEqual(rels.length, 1, 'getCallers must return 1 relationship');
                assert.strictEqual(rels[0].kind, 'calls', 'relationship kind must be calls');
                assert.notStrictEqual(rels[0].source.id, rels[0].target.id, 'source and target ids must differ');
                assert.ok(rels[0].source.id.startsWith('code-ref:provider:fixture:'), 'source id must start with code-ref:provider:fixture:');
                assert.ok(rels[0].target.id.startsWith('code-ref:provider:fixture:'), 'target id must start with code-ref:provider:fixture:');
            }

            // 6. impact() returns a normalized UnifiedImpactResult.
            {
                const result = p.impact({}, { providerEntityId: 'sym:parseConfig' });
                assert.ok(result.target.id, 'impact target id must be present');
                assert.strictEqual(result.upstream.length, 1, 'impact upstream length must be 1');
                assert.strictEqual(result.downstream.length, 1, 'impact downstream length must be 1');
                assert.strictEqual(result.affectedTests.length, 1, 'impact affectedTests length must be 1');
                assert.strictEqual(result.risk, 'medium', 'impact risk must be medium');
            }

            // 7. no subprocess: monkey-patch child_process to throw, prove the fixture never touches it.
            {
                const cp = require('child_process');
                const orig = {
                    execFile: cp.execFile, spawn: cp.spawn, execFileSync: cp.execFileSync,
                    spawnSync: cp.spawnSync, exec: cp.exec, execSync: cp.execSync,
                };
                for (const k of Object.keys(orig)) {
                    cp[k] = () => { throw new Error('fixture must not spawn: ' + k); };
                }
                try {
                    assert.doesNotThrow(() => {
                        p.search({}, 'x');
                        p.getCallers({}, {});
                        p.impact({}, {});
                    }, 'fixture provider methods must not touch child_process');
                } finally {
                    Object.assign(cp, orig);
                }
            }
        }
        console.log('✅ T-cp-fixture passed');

        console.log('T-cp-native-lite. Testing native-lite file-perception provider (git/IR + fs-safety + budgets) ...');
        {
            const childProcess = require('child_process');
            const contract = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-contract'));
            const nativeLite = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'native-lite'));

            function git(cwd, args) {
                childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env } });
            }

            const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-cp-native-'));
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-cp-native-outside-'));

            // A secret file OUTSIDE the workspace an escaping symlink must never expose.
            const secretPath = path.join(outsideDir, 'SECRET.txt');
            const secretContent = 'TOP-SECRET-OUTSIDE-WORKSPACE-CONTENT';
            fs.writeFileSync(secretPath, secretContent, 'utf8');

            // Two normal small text files.
            writeText(path.join(projectRoot, 'src', 'a.js'), 'export const a = 1;\nexport const b = 2;\nconsole.log(a, b);\n');
            writeText(path.join(projectRoot, 'src', 'b.js'), 'export const original = true;\n');

            // Unicode-named tracked file: git quotes non-ASCII paths unless enumerated
            // with -z, which must not cause it to be dropped from getFiles().
            const unicodeRel = 'src/café.js';
            writeText(path.join(projectRoot, 'src', 'café.js'), 'export const cafe = true;\n');

            // Oversized file (> MAX_FILE_BYTES = 1 MiB): 1.1 MiB of text.
            writeText(path.join(projectRoot, 'big.txt'), 'x'.repeat(Math.floor(1.1 * 1024 * 1024)));

            // Binary file: a 0x00 byte within the first 8 KiB.
            const binBuf = Buffer.from([0x41, 0x42, 0x00, 0x43, 0x44]);
            fs.writeFileSync(path.join(projectRoot, 'data.bin'), binBuf);

            // Architecture IR + Planning IR referencing src/a.js.
            writeText(
                path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json'),
                JSON.stringify({ version: 'evo-arch-ir@1', files: [{ path: 'src/a.js', module: 'core', role: 'lib', confidence: 1 }] }, null, 2),
            );
            writeText(
                path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
                JSON.stringify({ version: 'evo-plan-ir@1', tasks: [{ id: 'task:x', linkedFiles: ['src/a.js'] }] }, null, 2),
            );

            git(projectRoot, ['init']);
            git(projectRoot, ['config', 'user.email', 'evo@example.com']);
            git(projectRoot, ['config', 'user.name', 'Evo Test']);
            git(projectRoot, ['add', '.']);
            git(projectRoot, ['commit', '-m', 'chore: baseline']);

            // Modify src/b.js after the commit → git diff --name-only reports it.
            fs.writeFileSync(path.join(projectRoot, 'src', 'b.js'), 'export const original = false; // modified\n', 'utf8');

            // Escaping symlink → must be excluded, its outside content never read.
            // On Windows without privilege fs.symlinkSync throws EPERM → guard-skip.
            let symlinkCreated = false;
            const symlinkRel = 'escape-link';
            try {
                fs.symlinkSync(secretPath, path.join(projectRoot, symlinkRel));
                symlinkCreated = true;
            } catch (err) {
                console.log(`   ⏭️ symlink assertion skipped (symlink creation failed: ${err.code || err.message})`);
            }

            const ctx = { projectRoot };

            // 1. provider is contract-conformant (capability↔method self-consistent).
            assert.strictEqual(contract.validateProvider(nativeLite.create()).valid, true, 'native-lite provider must pass validateProvider');

            // 2. getStatus passes validateStatus with the fixed status shape.
            const status = nativeLite.create().getStatus(ctx);
            assert.strictEqual(contract.validateStatus(status).valid, true, 'getStatus must pass validateStatus');
            assert.strictEqual(status.indexState, 'not-required', 'indexState must be not-required');
            assert.strictEqual(status.ready, true, 'status.ready must be true');
            assert.strictEqual(status.freshness, 'fresh', 'freshness must be fresh (working tree is truth)');

            // 3. check passes validateAvailability.
            assert.strictEqual(contract.validateAvailability(nativeLite.create().check(ctx)).valid, true, 'check must pass validateAvailability');

            // 4. Normal committed file: id, provenance, sha256 hash, module + task links.
            const result = nativeLite.create().getFiles(ctx, {});
            const byPath = new Map(result.files.map(f => [f.reference.filePath, f]));
            const aEntry = byPath.get('src/a.js');
            assert.ok(aEntry, 'src/a.js must appear in files');
            assert.ok(aEntry.reference.id.startsWith('code-ref:provider:native-lite:'), 'reference.id must be namespaced to native-lite');
            assert.strictEqual(aEntry.reference.provenance.method, 'native-file', 'provenance.method must be native-file');
            assert.ok(/^[0-9a-f]{64}$/.test(aEntry.reference.snapshot.contentHash), 'contentHash must be a 64-hex sha256');
            assert.strictEqual(aEntry.moduleId, 'core', 'moduleId must come from architecture IR');
            assert.ok(aEntry.declaredByTaskIds.includes('task:x'), 'declaredByTaskIds must include task:x from planning IR');

            // 4b. Unicode-named tracked file must survive git enumeration (git quotes
            // non-ASCII paths by default; enumeration must use -z to avoid dropping it).
            const unicodeEntry = byPath.get(unicodeRel);
            assert.ok(unicodeEntry, `${unicodeRel} must appear in files (unicode path must not be dropped)`);
            assert.ok(unicodeEntry.reference.id.startsWith('code-ref:provider:native-lite:'), 'unicode file reference.id must be namespaced to native-lite');
            assert.ok(/^[0-9a-f]{64}$/.test(unicodeEntry.reference.snapshot.contentHash), 'unicode file contentHash must be a 64-hex sha256');
            assert.ok(
                !result.diagnostics.some(d => (d.code === 'path-unresolved' || d.code === 'symlink-escape') && d.message.includes('caf')),
                'no path-unresolved/symlink-escape diagnostic must exist for the unicode file',
            );

            // 5. Post-commit-modified file → changed:true and snapshot.dirty:'dirty'.
            const bEntry = byPath.get('src/b.js');
            assert.ok(bEntry, 'src/b.js must appear in files');
            assert.strictEqual(bEntry.changed, true, 'modified file must be changed:true');
            assert.strictEqual(bEntry.reference.snapshot.dirty, 'dirty', 'modified file snapshot.dirty must be dirty');

            // 6. Oversized file: listed, no contentHash, file-too-large diagnostic.
            const bigEntry = byPath.get('big.txt');
            assert.ok(bigEntry, 'oversized file must still be listed');
            assert.strictEqual(bigEntry.reference.snapshot.contentHash, undefined, 'oversized file must have no contentHash');
            assert.ok(result.diagnostics.some(d => d.code.startsWith('file-too-large')), 'a file-too-large diagnostic must exist');

            // 7. Binary file: excluded + binary-skipped diagnostic.
            assert.ok(!byPath.has('data.bin'), 'binary file must be excluded from files');
            assert.ok(result.diagnostics.some(d => d.code.startsWith('binary-skipped')), 'a binary-skipped diagnostic must exist');

            // 8. getEntity: full content + truncation.
            const ent = nativeLite.create().getEntity(ctx, { filePath: 'src/a.js' });
            assert.ok(typeof ent.content === 'string' && ent.content.length > 0, 'getEntity content must be non-null text');
            assert.strictEqual(ent.truncated, false, 'unbounded getEntity must not be truncated');
            const entCapped = nativeLite.create().getEntity(ctx, { filePath: 'src/a.js', maxChars: 5 });
            assert.ok(entCapped.content.length <= 5, 'maxChars must cap content length');
            assert.strictEqual(entCapped.truncated, true, 'capped getEntity must set truncated:true');

            // 9. Determinism: two calls yield identical order + ids.
            const result2 = nativeLite.create().getFiles(ctx, {});
            assert.deepStrictEqual(
                result.files.map(f => f.reference.filePath),
                result2.files.map(f => f.reference.filePath),
                'file order must be deterministic across calls',
            );
            assert.deepStrictEqual(
                result.files.map(f => f.reference.id),
                result2.files.map(f => f.reference.id),
                'reference ids must be deterministic across calls',
            );

            // 10. (guarded) escaping symlink excluded; its outside content never surfaces.
            if (symlinkCreated) {
                assert.ok(!byPath.has(symlinkRel), 'escaping symlink must be excluded from files');
                assert.ok(result.diagnostics.some(d => d.code.startsWith('symlink-escape')), 'a symlink-escape diagnostic must exist');
                const serialized = JSON.stringify(result);
                assert.ok(!serialized.includes(secretContent), 'outside symlink target content must never appear in any reference');
                // getEntity on the escaping symlink must also refuse + never read the secret.
                const linkEnt = nativeLite.create().getEntity(ctx, { filePath: symlinkRel });
                assert.strictEqual(linkEnt.content, null, 'getEntity on escaping symlink must return null content');
                assert.ok(linkEnt.diagnostics.some(d => d.code === 'path-unsafe'), 'getEntity on symlink must emit path-unsafe');
                assert.ok(!JSON.stringify(linkEnt).includes(secretContent), 'getEntity must never surface outside content');
            }

            // 11. Symbol-graph capabilities false + no symbol-graph methods present.
            const p = nativeLite.create();
            assert.strictEqual(p.capabilities.impact, false, 'impact capability must be false');
            assert.strictEqual(p.capabilities.symbols, false, 'symbols capability must be false');
            assert.strictEqual(p.capabilities.callers, false, 'callers capability must be false');
            assert.strictEqual(typeof p.impact, 'undefined', 'no impact method');
            assert.strictEqual(typeof p.search, 'undefined', 'no search method');
            assert.strictEqual(typeof p.getCallers, 'undefined', 'no getCallers method');

            fs.rmSync(projectRoot, { recursive: true, force: true });
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
        console.log('✅ T-cp-native-lite passed');

        console.log('T-cp-loader. Testing code-perception provider loader (allowlist-only instantiation) ...');
        {
            const loader = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader'));
            const nativeLite = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'native-lite'));
            const fixture = require(path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception', 'fixture-provider'));

            // 1. Default = native-lite only.
            {
                const { registrations, diagnostics } = loader.loadProviders();
                assert.strictEqual(registrations.length, 1, 'default registrations must contain exactly native-lite');
                assert.strictEqual(registrations[0].provider.id, 'provider:native-lite', 'default provider id must be native-lite');
                assert.strictEqual(registrations[0].role, 'fallback', 'native-lite role must be fallback');
                assert.strictEqual(registrations[0].source, 'builtin', 'native-lite source must be builtin');
                assert.deepStrictEqual(diagnostics, [], 'default loadProviders() must have no diagnostics');
            }

            // 2. Unknown id ignored + diagnostic + native-lite still present.
            {
                const { registrations, diagnostics } = loader.loadProviders({
                    codePerception: { providers: [{ id: 'provider:does-not-exist', enabled: true }] },
                });
                const unknown = diagnostics.filter(d => d.code === 'unknown-provider' && d.providerId === 'provider:does-not-exist');
                assert.strictEqual(unknown.length, 1, 'must emit exactly one unknown-provider diagnostic');
                assert.ok(registrations.some(r => r.provider.id === 'provider:native-lite'), 'native-lite must still be present');
                assert.ok(!registrations.some(r => r.provider.id === 'provider:does-not-exist'), 'unknown id must not be registered');
            }

            // 3. Arbitrary-module-path rejection (security assertion).
            {
                const evilPath = path.join(os.tmpdir(), `evil-cp-provider-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
                fs.writeFileSync(evilPath, "global.__EVIL_CP_LOADED__ = true;\nmodule.exports = { create: () => ({}) };\n");
                try {
                    const { registrations, diagnostics } = loader.loadProviders({
                        codePerception: { providers: [{ id: 'provider:evil', module: evilPath, path: evilPath }] },
                    });
                    assert.strictEqual(global.__EVIL_CP_LOADED__, undefined, 'evil module must never be required');
                    const unknown = diagnostics.filter(d => d.code === 'unknown-provider' && d.providerId === 'provider:evil');
                    assert.strictEqual(unknown.length, 1, 'must emit unknown-provider diagnostic for provider:evil');
                    assert.ok(registrations.some(r => r.provider.id === 'provider:native-lite'), 'native-lite must still be present');
                } finally {
                    fs.rmSync(evilPath, { force: true });
                    delete global.__EVIL_CP_LOADED__;
                }
            }

            // 4. Injected registry with a broken factory is isolated.
            {
                const injected = {
                    'provider:native-lite': { role: 'fallback', create: () => nativeLite.create() },
                    'provider:fixture': { role: 'structural-primary', create: () => fixture.create() },
                    'provider:broken': { role: 'enrichment', create: () => { throw new Error('boom'); } },
                };
                const { registrations, diagnostics } = loader.loadProviders(
                    { codePerception: { providers: [{ id: 'provider:fixture', role: 'structural-primary' }, { id: 'provider:broken' }] } },
                    { registry: injected }
                );
                const failed = diagnostics.filter(d => d.code === 'provider-load-failed' && d.providerId === 'provider:broken');
                assert.strictEqual(failed.length, 1, 'must emit provider-load-failed for provider:broken');
                const fixtureReg = registrations.find(r => r.provider.id === 'provider:fixture');
                assert.ok(fixtureReg, 'provider:fixture registration must be present');
                assert.strictEqual(fixtureReg.role, 'structural-primary', 'fixture role must be structural-primary');
                assert.strictEqual(fixtureReg.source, 'configured', 'fixture source must be configured');
                assert.ok(registrations.some(r => r.provider.id === 'provider:native-lite'), 'native-lite registration must be present');
                assert.ok(!registrations.some(r => r.provider.id === 'provider:broken'), 'no registration for provider:broken');
            }

            // 5. Options sanitized.
            {
                const injected = {
                    'provider:native-lite': { role: 'fallback', create: () => nativeLite.create() },
                    'provider:fixture': { role: 'structural-primary', create: () => fixture.create() },
                };
                const { registrations } = loader.loadProviders(
                    { codePerception: { providers: [{ id: 'provider:fixture', role: 'enrichment', timeoutMs: 15000, module: 'x', enabled: true }] } },
                    { registry: injected }
                );
                const fixtureReg = registrations.find(r => r.provider.id === 'provider:fixture');
                assert.ok(fixtureReg, 'provider:fixture registration must be present');
                assert.strictEqual(fixtureReg.options.timeoutMs, 15000, 'options.timeoutMs must be preserved');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(fixtureReg.options, 'id'), false, 'options must not contain id');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(fixtureReg.options, 'role'), false, 'options must not contain role');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(fixtureReg.options, 'module'), false, 'options must not contain module');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(fixtureReg.options, 'enabled'), false, 'options must not contain enabled');
                assert.strictEqual(fixtureReg.role, 'enrichment', 'role must be enrichment');
                assert.strictEqual(fixtureReg.source, 'configured', 'source must be configured');
            }
        }
        console.log('✅ T-cp-loader passed');

        console.log('T-cg-loader-register. Testing provider:codegraph registration (config-gated) + options reaching the adapter ...');
        {
            const loader = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader'));
            const fakePath = path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception', 'fake-codegraph.js');
            const ctx = { projectRoot: TEMPLATE_CLI_DIR, providerConfig: {} };

            // 1. ① default unchanged: no config still yields exactly native-lite.
            {
                const { registrations, diagnostics } = loader.loadProviders();
                assert.strictEqual(registrations.length, 1, 'default registrations must contain exactly native-lite');
                assert.strictEqual(registrations[0].provider.id, 'provider:native-lite', 'default provider id must be native-lite');
                assert.deepStrictEqual(diagnostics, [], 'default loadProviders() must have no diagnostics');
            }

            // 2. codegraph is registered + selectable in DEFAULT_REGISTRY.
            {
                const entry = loader.DEFAULT_REGISTRY['provider:codegraph'];
                assert.ok(entry, 'DEFAULT_REGISTRY must contain provider:codegraph');
                assert.strictEqual(entry.role, 'structural-primary', 'provider:codegraph role must be structural-primary');
            }

            // 3. Config selects codegraph + configured options REACH the adapter
            //    (proven via check() spawning the fake CLI, not merely stored options).
            {
                const { registrations, diagnostics } = loader.loadProviders({
                    codePerception: {
                        providers: [{
                            id: 'provider:codegraph', role: 'structural-primary',
                            executable: process.execPath, prefixArgs: [fakePath],
                        }],
                    },
                });
                const cg = registrations.find(r => r.provider.id === 'provider:codegraph');
                assert.ok(cg, 'provider:codegraph registration must be present');
                assert.strictEqual(cg.role, 'structural-primary', 'codegraph role must be structural-primary');
                assert.strictEqual(cg.source, 'configured', 'codegraph source must be configured');
                assert.ok(registrations.some(r => r.provider.id === 'provider:native-lite'), 'native-lite must still be present');
                assert.deepStrictEqual(
                    diagnostics.filter(d => d.providerId === 'provider:codegraph'), [],
                    'no diagnostics for provider:codegraph'
                );

                const avail = await cg.provider.check(ctx);
                assert.strictEqual(avail.ready, true, 'configured executable/prefixArgs must reach the adapter (check() ready)');
                assert.strictEqual(avail.available, true, 'configured executable/prefixArgs must reach the adapter (check() available)');
            }

            // 4. Dangerous fields stripped from the options that reach the adapter.
            {
                const { registrations } = loader.loadProviders({
                    codePerception: {
                        providers: [{
                            id: 'provider:codegraph', executable: process.execPath, prefixArgs: [fakePath],
                            module: '../../evil', create: 'x',
                        }],
                    },
                });
                const cg = registrations.find(r => r.provider.id === 'provider:codegraph');
                assert.ok(cg, 'provider:codegraph registration must be present');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(cg.options, 'module'), false, 'options must not contain module');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(cg.options, 'create'), false, 'options must not contain create');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(cg.options, 'id'), false, 'options must not contain id');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(cg.options, 'role'), false, 'options must not contain role');
            }

            // 5. Broken-factory isolation (unchanged ① contract) via an injected registry.
            {
                const injected = {
                    'provider:native-lite': loader.DEFAULT_REGISTRY['provider:native-lite'],
                    'provider:codegraph': { role: 'structural-primary', create: () => { throw new Error('boom'); } },
                };
                const { registrations, diagnostics } = loader.loadProviders(
                    { codePerception: { providers: [{ id: 'provider:codegraph' }] } },
                    { registry: injected }
                );
                const failed = diagnostics.filter(d => d.code === 'provider-load-failed' && d.providerId === 'provider:codegraph');
                assert.strictEqual(failed.length, 1, 'must emit provider-load-failed for provider:codegraph');
                assert.ok(registrations.some(r => r.provider.id === 'provider:native-lite'), 'native-lite registration must be present');
                assert.ok(!registrations.some(r => r.provider.id === 'provider:codegraph'), 'no registration for provider:codegraph');
            }
        }
        console.log('✅ T-cg-loader-register passed');

        console.log('T-cp-router. Testing code-perception provider router (async inspect + pure select) ...');
        {
            const router = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-router'));
            const loader = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader'));
            const nativeLite = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'native-lite'));
            const fixture = require(path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception', 'fixture-provider'));

            // A. inspectProviders integration (async).
            {
                const injected = {
                    'provider:native-lite': { role: 'fallback', create: () => nativeLite.create() },
                    'provider:fixture': { role: 'structural-primary', create: () => fixture.create() },
                    'provider:broken': {
                        role: 'enrichment',
                        create: () => ({
                            id: 'provider:broken',
                            name: 'Broken',
                            adapterVersion: '0.0.1',
                            capabilities: {},
                            check() { throw new Error('check exploded'); },
                            getStatus() { return { providerId: 'provider:broken', ready: false }; },
                        }),
                    },
                };
                const { registrations } = loader.loadProviders(
                    { codePerception: { providers: [{ id: 'provider:fixture', role: 'structural-primary' }, { id: 'provider:broken' }] } },
                    { registry: injected }
                );
                assert.strictEqual(registrations.length, 3, 'expected native-lite + fixture + broken registrations');

                const cands = await router.inspectProviders(registrations, { projectRoot: WORKSPACE_ROOT });
                assert.strictEqual(cands.length, registrations.length, 'every registration must yield a candidate');

                const brokenCand = cands.find(c => c.registration.provider.id === 'provider:broken');
                assert.ok(brokenCand, 'broken candidate must be present');
                assert.strictEqual(brokenCand.availability.ready, false, 'broken candidate must be not-ready');
                assert.ok(
                    brokenCand.diagnostics.some(d => d.code === 'check-failed' && d.providerId === 'provider:broken'),
                    'broken candidate must carry a check-failed diagnostic'
                );

                const fixtureCand = cands.find(c => c.registration.provider.id === 'provider:fixture');
                const nativeLiteCand = cands.find(c => c.registration.provider.id === 'provider:native-lite');
                assert.ok(fixtureCand && fixtureCand.status, 'fixture candidate must have a status object');
                assert.ok(nativeLiteCand && nativeLiteCand.status, 'native-lite candidate must have a status object');
            }

            // B. selectProvider pure branches (hand-built candidates).
            const makeCand = (id, role, ready, capabilities, freshness) => ({
                registration: { provider: { id } },
                role,
                availability: { ready },
                status: { capabilities, freshness },
            });

            // 1. Structural over enrichment.
            {
                const structural = makeCand('provider:s', 'structural-primary', true, { symbols: true }, 'fresh');
                const enrichment = makeCand('provider:e', 'enrichment', true, { symbols: true }, 'fresh');
                const result = router.selectProvider({ capability: 'symbols', allowFallback: true }, [enrichment, structural]);
                assert.strictEqual(result.candidate, structural, 'structural-primary must win over enrichment');
                assert.strictEqual(result.degraded, false, 'must not be degraded');
            }

            // 2. Freshness tiebreak among equal-role candidates.
            {
                const fresh = makeCand('provider:fresh', 'structural-primary', true, { symbols: true }, 'fresh');
                const stale = makeCand('provider:stale', 'structural-primary', true, { symbols: true }, 'stale');
                const result = router.selectProvider({ capability: 'symbols', allowFallback: true }, [stale, fresh]);
                assert.strictEqual(result.candidate, fresh, 'fresh candidate must win over stale');
            }

            // 3. preferredProvider ready+supports.
            {
                const preferred = makeCand('provider:pref', 'enrichment', true, { symbols: true }, 'fresh');
                const other = makeCand('provider:other', 'structural-primary', true, { symbols: true }, 'fresh');
                const result = router.selectProvider(
                    { capability: 'symbols', preferredProvider: 'provider:pref', allowFallback: true },
                    [other, preferred]
                );
                assert.strictEqual(result.candidate, preferred, 'preferred provider must be returned');
                assert.strictEqual(result.degraded, false, 'preferred selection must not be degraded');
            }

            // 4. preferredProvider present but not ready, allowFallback:false.
            {
                const preferred = makeCand('provider:pref', 'structural-primary', false, { symbols: true }, 'fresh');
                const result = router.selectProvider(
                    { capability: 'symbols', preferredProvider: 'provider:pref', allowFallback: false },
                    [preferred]
                );
                assert.strictEqual(result.candidate, null, 'candidate must be null when preferred is unusable and fallback disabled');
                assert.strictEqual(result.degraded, false, 'must not be degraded');
                assert.ok(
                    result.diagnostics.some(d => d.code === 'preferred-unusable' && d.providerId === 'provider:pref'),
                    'must carry a preferred-unusable diagnostic'
                );
            }

            // 5. preferredProvider not ready, allowFallback:true, another usable structural present.
            {
                const preferred = makeCand('provider:pref', 'structural-primary', false, { symbols: true }, 'fresh');
                const structural = makeCand('provider:s', 'structural-primary', true, { symbols: true }, 'fresh');
                const result = router.selectProvider(
                    { capability: 'symbols', preferredProvider: 'provider:pref', allowFallback: true },
                    [preferred, structural]
                );
                assert.strictEqual(result.candidate, structural, 'must fall through to the other usable structural candidate');
                assert.strictEqual(result.degraded, false, 'must not be degraded');
            }

            // 6. impact with only native-lite (fallback, ready, impact:false) — no silent substitution.
            {
                const nativeLiteCand = makeCand(
                    'provider:native-lite', 'fallback', true,
                    { impact: false, files: true, source: true, modules: true }, 'fresh'
                );
                const result = router.selectProvider({ capability: 'impact', allowFallback: true }, [nativeLiteCand]);
                assert.strictEqual(result.candidate, null, 'no candidate must be selected for impact');
                assert.strictEqual(result.degraded, true, 'must be degraded');
                assert.strictEqual(result.reason, 'No ready provider exposes impact analysis', 'reason must be exact ready-centric wording');
            }

            // 7. files with only native-lite (fallback, ready, files:true) — degraded fallback selection.
            {
                const nativeLiteCand = makeCand(
                    'provider:native-lite', 'fallback', true,
                    { files: true, impact: false }, 'fresh'
                );
                const result = router.selectProvider({ capability: 'files', allowFallback: true }, [nativeLiteCand]);
                assert.strictEqual(result.candidate, nativeLiteCand, 'native-lite must be selected as degraded fallback');
                assert.strictEqual(result.degraded, true, 'must be degraded');
                assert.ok(
                    result.diagnostics.some(d => d.code === 'degraded-fallback' && d.providerId === 'provider:native-lite'),
                    'must carry a degraded-fallback diagnostic'
                );
            }

            // 8. selectProvider never throws on empty candidates or missing status fields.
            {
                const result = router.selectProvider({ capability: 'symbols', allowFallback: true }, []);
                assert.strictEqual(result.candidate, null, 'empty candidates must yield null candidate');
                assert.strictEqual(result.reason, 'No ready provider exposes symbols analysis', 'reason must match step-5 wording');

                const bareCand = { registration: { provider: { id: 'provider:bare' } }, role: 'structural-primary', availability: { ready: true } };
                assert.doesNotThrow(() => {
                    const bareResult = router.selectProvider({ capability: 'symbols', allowFallback: true }, [bareCand]);
                    assert.strictEqual(bareResult.candidate, null, 'candidate missing status.capabilities must not be usable');
                }, 'selectProvider must never throw on missing status fields');
            }
        }
        console.log('✅ T-cp-router passed');

        console.log('T-cg-fixtures. Testing pinned-upstream CodeGraph fixtures + provenance manifest + fake CLI ...');
        {
            const crypto = require('crypto');
            const childProcess = require('child_process');
            const CG_DIR = path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception');
            const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

            // 1. Manifest parses and carries the provenance contract.
            const manifestPath = path.join(CG_DIR, 'codegraph-fixture-manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            assert.strictEqual(typeof manifest.upstream, 'string', 'manifest.upstream must be a string');
            assert.strictEqual(typeof manifest.package, 'string', 'manifest.package must be a string');
            assert.strictEqual(manifest.providerVersion, '1.4.1', 'manifest.providerVersion must be 1.4.1');
            assert.ok(manifest.captureMethod && typeof manifest.captureMethod === 'object',
                'manifest.captureMethod must be an object');
            assert.strictEqual(typeof manifest.supportsPositionalSeparator, 'boolean',
                'manifest.supportsPositionalSeparator must be a boolean');
            assert.ok(manifest.fixtureSha256 && typeof manifest.fixtureSha256 === 'object',
                'manifest.fixtureSha256 must be an object');

            // 2. Every fixtureSha256 entry matches the actual file bytes (proves the
            //    manifest describes the real committed fixtures — anti-fabrication).
            const shaEntries = Object.entries(manifest.fixtureSha256);
            assert.ok(shaEntries.length >= 10, 'manifest.fixtureSha256 must cover the fixture set');
            for (const [name, recorded] of shaEntries) {
                const bytes = fs.readFileSync(path.join(CG_DIR, name));
                const expected = 'sha256:' + sha256Hex(bytes);
                assert.strictEqual(recorded, expected, `fixtureSha256[${name}] must equal sha256 of the file bytes`);
            }

            // 3. Every JSON fixture parses; the malformed one is valid JSON too.
            const jsonFixtures = [
                'codegraph-status.json', 'codegraph-files.json', 'codegraph-query.json',
                'codegraph-callers.json', 'codegraph-callees.json', 'codegraph-impact.json',
                'codegraph-affected.json', 'codegraph-malformed.json',
            ];
            for (const jf of jsonFixtures) {
                assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(CG_DIR, jf), 'utf8')),
                    `${jf} must be valid JSON`);
            }

            // 4. help.txt carries all 9 command names of the read surface.
            const helpTxt = fs.readFileSync(path.join(CG_DIR, 'codegraph-help.txt'), 'utf8');
            for (const cmd of ['status', 'files', 'query', 'explore', 'node', 'callers', 'callees', 'impact', 'affected']) {
                assert.ok(helpTxt.includes(cmd), `help.txt must mention the "${cmd}" command`);
            }

            // 5. fake-codegraph.js resolves fixtures via __dirname (cwd-independent) and
            //    exits 2 on an unknown subcommand.
            const fakePath = path.join(CG_DIR, 'fake-codegraph.js');
            const statusRaw = fs.readFileSync(path.join(CG_DIR, 'codegraph-status.json'), 'utf8');
            const out = childProcess.execFileSync(process.execPath, [fakePath, 'status'],
                { cwd: os.tmpdir(), encoding: 'utf8' });
            assert.strictEqual(out, statusRaw,
                'fake-codegraph.js status output must equal codegraph-status.json bytes (proves __dirname resolution)');
            let threw = false;
            let code;
            try {
                childProcess.execFileSync(process.execPath, [fakePath, 'no-such-subcommand'],
                    { cwd: os.tmpdir(), encoding: 'utf8', stdio: 'pipe' });
            } catch (err) {
                threw = true;
                code = err.status;
            }
            assert.ok(threw, 'fake-codegraph.js must fail on an unknown subcommand');
            assert.strictEqual(code, 2, 'fake-codegraph.js unknown subcommand must exit 2');

            // 6. Dogfood validator fixtures: well-formed has all 9 sections + a
            //    fingerprint line; the bad copy is missing at least one section.
            //    (validateDogfoodArtifact is a LATER task — do NOT call it here.)
            const REQUIRED_SECTIONS = [
                'status', 'search', 'callers-callees', 'impact',
                'current-focus', 'Task-to-Code', 'stale-index', 'fallback', 'limitations',
            ];
            const good = fs.readFileSync(path.join(CG_DIR, 'dogfood-sample.md'), 'utf8');
            const bad = fs.readFileSync(path.join(CG_DIR, 'dogfood-bad.md'), 'utf8');
            const headingRe = (section) => new RegExp('^#+\\s.*' + section.replace(/[-]/g, '\\-'), 'm');
            for (const section of REQUIRED_SECTIONS) {
                assert.ok(headingRe(section).test(good), `dogfood-sample.md must have a "${section}" heading`);
            }
            assert.ok(/^fingerprint:\s*sha256:[0-9a-f]{64}$/m.test(good),
                'dogfood-sample.md must carry a fingerprint: sha256:<hex> line');
            const missing = REQUIRED_SECTIONS.filter((section) => !headingRe(section).test(bad));
            assert.ok(missing.length >= 1, 'dogfood-bad.md must be missing at least one required section');
        }
        console.log('✅ T-cg-fixtures passed');

        console.log('T-cg-exec. Testing CodeGraph secure exec runner (no-shell + timeout + Local-First env) ...');
        {
            const exec = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'providers', 'codegraph-exec'));
            const CG_DIR = path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception');
            const fakePath = path.join(CG_DIR, 'fake-codegraph.js');
            const manifest = require(path.join(CG_DIR, 'codegraph-fixture-manifest.json'));

            // 1. Fixture echo: a real execFile round-trip through node, stdout equals
            //    the committed codegraph-status.json bytes exactly.
            {
                const statusRaw = fs.readFileSync(path.join(CG_DIR, 'codegraph-status.json'), 'utf8');
                const result = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'status', args: [],
                });
                assert.strictEqual(result.ok, true, 'status fixture echo must succeed');
                assert.strictEqual(result.code, 0, 'status fixture echo must exit 0');
                assert.strictEqual(result.stdout, statusRaw, 'stdout must equal codegraph-status.json bytes');
                assert.strictEqual(result.timedOut, false, 'must not be timed out');
                assert.strictEqual(result.truncated, false, 'must not be truncated');
                assert.deepStrictEqual(result.diagnostics, [], 'success must have no diagnostics');
            }

            // 2. Disallowed subcommand: rejected before spawn, fake never runs.
            {
                const result = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'rm', args: ['-rf', '/'],
                });
                assert.strictEqual(result.ok, false, 'disallowed subcommand must fail');
                assert.strictEqual(result.stdout, '', 'disallowed subcommand must never spawn (empty stdout)');
                assert.ok(result.diagnostics.some((d) => d.code === 'disallowed-subcommand'),
                    'must carry a disallowed-subcommand diagnostic');
            }

            // 3. Timeout kill: the child is killed quickly, not awaited the full sleep.
            {
                const start = Date.now();
                const result = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'status',
                    args: ['--fake-sleep', '5000'], timeoutMs: 300,
                });
                const elapsed = Date.now() - start;
                assert.strictEqual(result.ok, false, 'timed-out run must not be ok');
                assert.strictEqual(result.timedOut, true, 'timedOut must be true');
                assert.ok(result.diagnostics.some((d) => d.code === 'command-timeout'),
                    'must carry a command-timeout diagnostic');
                assert.ok(elapsed < 4000, `must complete well before the 5000ms sleep (elapsed=${elapsed}ms)`);
            }

            // 4. Env override: Local-First wins over a caller's DO_NOT_TRACK='0' when
            //    allowNetwork is false; both forced vars land as '1'. When allowNetwork
            //    is true, neither is forced by this module.
            {
                const result = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'status',
                    args: ['--fake-echo-env'], env: { DO_NOT_TRACK: '0' }, allowNetwork: false,
                });
                assert.strictEqual(result.ok, true, 'env-echo run must succeed');
                const childEnvSeen = JSON.parse(result.stdout);
                assert.strictEqual(childEnvSeen.DO_NOT_TRACK, '1', 'Local-First must override caller DO_NOT_TRACK=0 back to 1');
                assert.strictEqual(childEnvSeen.CODEGRAPH_NO_UPDATE_CHECK, '1', 'CODEGRAPH_NO_UPDATE_CHECK must be forced to 1');

                const resultNet = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'status',
                    args: ['--fake-echo-env'], env: { DO_NOT_TRACK: '0' }, allowNetwork: true,
                });
                const childEnvSeenNet = JSON.parse(resultNet.stdout);
                assert.notStrictEqual(childEnvSeenNet.DO_NOT_TRACK, '1',
                    'with allowNetwork:true this module must not force DO_NOT_TRACK to 1');
            }

            // 5. No-shell literal args: a leading-dash operand after '--' and a
            //    shell-metachar operand are both passed literally, never interpreted.
            {
                const queryRaw = fs.readFileSync(path.join(CG_DIR, 'codegraph-query.json'), 'utf8');
                const result = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'query',
                    args: ['--json', '--', '--help'],
                });
                assert.strictEqual(result.ok, true, 'query with a literal --help operand must succeed');
                assert.strictEqual(result.stdout, queryRaw, 'stdout must equal codegraph-query.json (proves --help stayed literal)');

                const result2 = await exec.runCodegraph({
                    executable: process.execPath, prefixArgs: [fakePath], subcommand: 'query',
                    args: ['--json', '--', '; echo pwned'],
                });
                assert.strictEqual(result2.ok, true, 'query with a shell-metachar operand must succeed');
                assert.strictEqual(result2.stdout, queryRaw, 'stdout must equal codegraph-query.json (proves no shell interpretation)');
                assert.ok(!result2.stdout.includes('pwned'), 'stdout must never contain "pwned"');
            }

            // 6. safeOperand + frozen-constant-tracks-manifest.
            {
                assert.deepStrictEqual(exec.safeOperand('--help'), { ok: true, value: '--help' },
                    'safeOperand must allow a leading-dash operand when positional separator is supported');
                assert.strictEqual(exec.SUPPORTS_POSITIONAL_SEPARATOR, manifest.supportsPositionalSeparator,
                    'SUPPORTS_POSITIONAL_SEPARATOR must equal the fixture manifest value');
            }

            // 7. ALLOWED_SUBCOMMANDS is a frozen array; the lookup Set is not exported.
            {
                assert.ok(Array.isArray(exec.ALLOWED_SUBCOMMANDS), 'ALLOWED_SUBCOMMANDS must be an array');
                assert.strictEqual(Object.isFrozen(exec.ALLOWED_SUBCOMMANDS), true, 'ALLOWED_SUBCOMMANDS must be frozen');
                assert.strictEqual(exec.ALLOWED_SET, undefined, 'the lookup Set must not be exported');
            }
        }
        console.log('✅ T-cg-exec passed');

        console.log('T-cg-detect. Testing CodeGraph adapter skeleton + fingerprint-locked detection ...');
        {
            const cg = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'providers', 'codegraph'));
            const contract = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-contract'));
            const CG_DIR = path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception');
            const fakePath = path.join(CG_DIR, 'fake-codegraph.js');
            const ctx = { projectRoot: TEMPLATE_CLI_DIR, providerConfig: {} };
            const provider = cg.create({ executable: process.execPath, prefixArgs: [fakePath] });

            // 1+2. validateProvider passes; capability map is correct (modules=false).
            {
                const result = contract.validateProvider(provider);
                assert.strictEqual(result.valid, true, `provider must validate: ${JSON.stringify(result.diagnostics)}`);
                assert.strictEqual(provider.capabilities.modules, false, 'modules capability must be false');
                assert.strictEqual(provider.capabilities.impact, true, 'impact capability must be true');
                assert.strictEqual(provider.capabilities.symbols, true, 'symbols capability must be true');
            }

            // 3. check() against the real fixtures: available/ready/indexState/providerVersion.
            {
                const avail = await provider.check(ctx);
                const v = contract.validateAvailability(avail);
                assert.strictEqual(v.valid, true, `availability must validate: ${JSON.stringify(v.diagnostics)}`);
                assert.strictEqual(avail.available, true, 'must be available against valid fixtures');
                assert.strictEqual(avail.ready, true, 'must be ready against valid fixtures');
                assert.strictEqual(avail.indexState, 'ready', 'indexState must be ready');
                assert.strictEqual(avail.providerVersion, '1.4.1', 'providerVersion must be parsed from version fixture');
            }

            // 4. getStatus() STATUS translator against the real fixture.
            {
                const status = await provider.getStatus(ctx);
                const v = contract.validateStatus(status);
                assert.strictEqual(v.valid, true, `status must validate: ${JSON.stringify(v.diagnostics)}`);
                assert.strictEqual(status.providerVersion, '1.4.1', 'providerVersion must equal fixture version');
                assert.strictEqual(status.compatibility, 'supported', '1.4.1 is in TESTED_PROVIDER_VERSIONS');
                assert.strictEqual(status.ready, true, 'ready must be true for a complete index');
                assert.strictEqual(status.indexState, 'ready', 'indexState must be ready');
                assert.strictEqual(typeof status.observedSchemaFingerprint, 'string', 'observedSchemaFingerprint must be a string');
                assert.ok(status.observedSchemaFingerprint.length > 0, 'observedSchemaFingerprint must be non-empty');
            }

            // 5. Missing executable: never throws, reports installed:false / missing.
            {
                const missingExe = path.join(os.tmpdir(), 'definitely-not-codegraph-' + Date.now());
                const badProvider = cg.create({ executable: missingExe });
                const avail = await badProvider.check(ctx);
                assert.strictEqual(avail.installed, false, 'installed must be false for a missing executable');
                assert.strictEqual(avail.available, false, 'available must be false for a missing executable');
                assert.strictEqual(avail.indexState, 'missing', 'indexState must be missing for a missing executable');
                assert.ok(/install/i.test(avail.suggestedAction || ''), 'suggestedAction must mention install');
            }

            // 6. Fingerprint identity lock: real inline fakes with a bad version and
            //    an incomplete help command set — both must be rejected, NO adapt-guess.
            {
                const tmpDir = os.tmpdir();

                const lowVersionFake = path.join(tmpDir, 'cg-fake-lowver-' + Date.now() + '.js');
                fs.writeFileSync(lowVersionFake, [
                    "'use strict';",
                    "const sub = process.argv.slice(2)[0];",
                    "if (sub === 'version') { process.stdout.write('0.9.0'); }",
                    "process.exit(0);",
                    "",
                ].join('\n'), 'utf8');
                const lowVerProvider = cg.create({ executable: process.execPath, prefixArgs: [lowVersionFake] });
                const lowVerAvail = await lowVerProvider.check(ctx);
                assert.strictEqual(contract.validateAvailability(lowVerAvail).valid, true, 'low-version availability must validate');
                assert.strictEqual(lowVerAvail.available, false, '0.9.0 is below MIN_PROVIDER_VERSION, must be unavailable');
                assert.ok(/version|identity/i.test(lowVerAvail.reason || ''), 'reason must mention version/identity mismatch');

                const highVersionFake = path.join(tmpDir, 'cg-fake-highver-' + Date.now() + '.js');
                fs.writeFileSync(highVersionFake, [
                    "'use strict';",
                    "const sub = process.argv.slice(2)[0];",
                    "if (sub === 'version') { process.stdout.write('2.1.0'); }",
                    "process.exit(0);",
                    "",
                ].join('\n'), 'utf8');
                const highVerProvider = cg.create({ executable: process.execPath, prefixArgs: [highVersionFake] });
                const highVerAvail = await highVerProvider.check(ctx);
                assert.strictEqual(highVerAvail.available, false, '2.1.0 is >= maxExclusive, must be unavailable');
                assert.ok(/version|identity/i.test(highVerAvail.reason || ''), 'reason must mention version/identity mismatch');

                const badHelpFake = path.join(tmpDir, 'cg-fake-badhelp-' + Date.now() + '.js');
                fs.writeFileSync(badHelpFake, [
                    "'use strict';",
                    "const sub = process.argv.slice(2)[0];",
                    "if (sub === 'version') { process.stdout.write('1.4.1'); }",
                    "else if (sub === 'help') { process.stdout.write('status files query explore node callers callees'); }",
                    "process.exit(0);",
                    "",
                ].join('\n'), 'utf8');
                const badHelpProvider = cg.create({ executable: process.execPath, prefixArgs: [badHelpFake] });
                const badHelpAvail = await badHelpProvider.check(ctx);
                assert.strictEqual(badHelpAvail.available, false, 'incomplete help command set must be unavailable (identity mismatch)');
                assert.ok(/version|identity/i.test(badHelpAvail.reason || ''), 'reason must mention identity/version mismatch');
            }

            // 7. Never throws on a spawn failure — neither check() nor getStatus().
            {
                const missingExe = path.join(os.tmpdir(), 'definitely-not-codegraph-either-' + Date.now());
                const badProvider = cg.create({ executable: missingExe });
                let threw = false;
                try {
                    await badProvider.check(ctx);
                    await badProvider.getStatus(ctx);
                } catch (e) {
                    threw = true;
                }
                assert.strictEqual(threw, false, 'check()/getStatus() must never throw on a spawn failure');
                const status = await badProvider.getStatus(ctx);
                assert.strictEqual(contract.validateStatus(status).valid, true, 'safe UNKNOWN status must still validate');
                assert.strictEqual(status.available, false, 'safe status must report available:false on spawn failure');
            }
        }
        console.log('✅ T-cg-detect passed');

        console.log('T-cg-queries. Testing CodeGraph query methods — command mapping + translators + opaque explore/node + per-capability disable ...');
        {
            const cg = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'providers', 'codegraph'));
            const CG_DIR = path.join(TEMPLATE_CLI_DIR, 'test', 'fixtures', 'code-perception');
            const fakePath = path.join(CG_DIR, 'fake-codegraph.js');
            const ctx = { projectRoot: TEMPLATE_CLI_DIR, providerConfig: {} };
            const provider = cg.create({ executable: process.execPath, prefixArgs: [fakePath] });
            const modSource = fs.readFileSync(
                path.join(TEMPLATE_CLI_DIR, 'code-perception', 'providers', 'codegraph.js'), 'utf8',
            );

            // 1. getFiles — 4 files (fixture length), provider-scoped ids, kind:file,
            //    moduleId:null (modules=false), provenance.providerId set.
            {
                const result = await provider.getFiles(ctx);
                assert.strictEqual(result.files.length, 4, 'getFiles must return 4 files (fixture length)');
                for (const entry of result.files) {
                    assert.ok(entry.reference.id.startsWith('code-ref:provider:codegraph:'),
                        'reference.id must be provider-scoped');
                    assert.strictEqual(entry.reference.kind, 'file', 'kind must be file');
                    assert.strictEqual(entry.moduleId, null, 'moduleId must be null (modules=false)');
                    assert.strictEqual(entry.reference.provenance.providerId, 'provider:codegraph',
                        'provenance.providerId must be provider:codegraph');
                }
            }

            // 2. search('normalize') — 2 matches, first is normalizeReference/function,
            //    lineRange[0]===54, distinct upstream node ids -> distinct reference ids.
            {
                const result = await provider.search(ctx, 'normalize');
                assert.strictEqual(result.matches.length, 2, 'search must return 2 matches (fixture length)');
                const [first, second] = result.matches;
                assert.strictEqual(first.name, 'normalizeReference', 'first match name');
                assert.strictEqual(first.kind, 'function', 'first match kind');
                assert.strictEqual(first.lineRange[0], 54, 'first match startLine');
                assert.notStrictEqual(first.id, second.id, 'distinct upstream node ids must yield distinct reference ids');
            }

            // 3. getCallers/getCallees — object with a diagnostics channel;
            //    3 relationships each, correct kind, distinct synthesized
            //    target ids per row.
            {
                const callersResult = await provider.getCallers(ctx, 'normalizeReference');
                assert.deepStrictEqual(callersResult.diagnostics, [], 'getCallers diagnostics must be empty on success');
                assert.strictEqual(callersResult.relationships.length, 3, 'getCallers must return 3 relationships');
                const targetIds = new Set();
                for (const rel of callersResult.relationships) {
                    assert.strictEqual(rel.kind, 'called_by', 'getCallers relationship kind must be called_by');
                    assert.notStrictEqual(rel.source.id, rel.target.id, 'source/target ids must differ');
                    targetIds.add(rel.target.id);
                }
                assert.strictEqual(targetIds.size, 3, 'caller rows must synthesize distinct target ids');

                const calleesResult = await provider.getCallees(ctx, 'normalizeReference');
                assert.deepStrictEqual(calleesResult.diagnostics, [], 'getCallees diagnostics must be empty on success');
                assert.strictEqual(calleesResult.relationships.length, 3, 'getCallees must return 3 relationships');
                for (const rel of calleesResult.relationships) {
                    assert.strictEqual(rel.kind, 'calls', 'getCallees relationship kind must be calls');
                }
            }

            // 4. impact('normalizeReference') — downstream=affected(4), upstream empty
            //    (not provided by this command), depth from fixture, target has an id.
            {
                const result = await provider.impact(ctx, 'normalizeReference');
                assert.strictEqual(result.downstream.length, 4, 'impact downstream must have 4 entries');
                assert.strictEqual(result.upstream.length, 0, 'impact upstream must be empty (not provided by impact command)');
                assert.strictEqual(result.depth, 2, 'impact depth must equal fixture depth');
                assert.ok(result.target && result.target.id, 'impact target must have an id');
            }

            // 5. getAffectedTests — independent of impact: a logging fake CLI proves the
            //    `impact` subcommand is never invoked while resolving affected tests.
            {
                const logFile = path.join(os.tmpdir(), 'cg-affected-log-' + Date.now() + '.txt');
                const loggingFake = path.join(os.tmpdir(), 'cg-fake-logging-' + Date.now() + '.js');
                fs.writeFileSync(loggingFake, [
                    "'use strict';",
                    "const fs = require('fs');",
                    "const path = require('path');",
                    "const sub = process.argv[2];",
                    "fs.appendFileSync(process.env.CG_CALL_LOG, sub + '\\n');",
                    "const FIXTURES = { status: 'codegraph-status.json', affected: 'codegraph-affected.json', impact: 'codegraph-impact.json' };",
                    "const name = FIXTURES[sub];",
                    "if (!name) { process.exit(2); }",
                    `process.stdout.write(fs.readFileSync(path.join(${JSON.stringify(CG_DIR)}, name)));`,
                    'process.exit(0);',
                    '',
                ].join('\n'), 'utf8');
                fs.writeFileSync(logFile, '', 'utf8');
                const prevLog = process.env.CG_CALL_LOG;
                process.env.CG_CALL_LOG = logFile;
                try {
                    const loggingProvider = cg.create({ executable: process.execPath, prefixArgs: [loggingFake] });
                    const affectedResult = await loggingProvider.getAffectedTests(ctx, {
                        files: ['templates/cli/code-perception/normalize.js'],
                    });
                    assert.deepStrictEqual(affectedResult.diagnostics, [], 'getAffectedTests diagnostics must be empty on success');
                    assert.strictEqual(affectedResult.tests.length, 1, 'getAffectedTests must return 1 test reference');
                    assert.strictEqual(affectedResult.tests[0].kind, 'test', 'affected test kind must be test');
                    assert.ok(affectedResult.tests[0].filePath.endsWith('governance.js'), 'affected test filePath must end governance.js');
                    const log = fs.readFileSync(logFile, 'utf8');
                    assert.ok(!log.includes('impact'), 'getAffectedTests must not invoke the impact command (independent of impact())');
                } finally {
                    if (prevLog === undefined) { delete process.env.CG_CALL_LOG; } else { process.env.CG_CALL_LOG = prevLog; }
                    fs.rmSync(logFile, { force: true });
                    fs.rmSync(loggingFake, { force: true });
                }
            }

            // 6. getEntity/explore — OPAQUE: text + only explicitly-marked file:line
            //    tokens; no relationship/edge object; no synthesized structural edges.
            {
                const entity = await provider.getEntity(ctx, { entity: 'normalizeReference' });
                assert.ok(entity.content.includes('normalized CodeReference'), 'getEntity content must include the opaque prose');
                assert.ok(entity.reference.filePath.endsWith('normalize.js'), 'getEntity reference filePath must end normalize.js');
                assert.strictEqual(entity.reference.lineRange[0], 54, 'getEntity reference lineRange[0] must be 54');
                assert.strictEqual(entity.relationship, undefined, 'getEntity must not return a relationship');
                assert.strictEqual(entity.edge, undefined, 'getEntity must not return an edge');
                assert.strictEqual(entity.relationships, undefined, 'getEntity must not return relationships');

                const explore = await provider.explore(ctx, { query: 'normalizeReference' });
                assert.strictEqual(typeof explore.opaqueText, 'string', 'explore opaqueText must be a string');
                assert.ok(explore.opaqueText.length > 0, 'explore opaqueText must be non-empty');
                assert.ok(Array.isArray(explore.extracted) && explore.extracted.length >= 1,
                    'explore extracted must have at least one entry');
                assert.ok(explore.extracted[0].filePath, 'explore extracted entry must have a filePath');
                assert.ok(Array.isArray(explore.extracted[0].lineRange), 'explore extracted entry must have a lineRange');
                const exploreJson = JSON.stringify(explore);
                assert.ok(!/"kind"\s*:\s*"calls"/.test(exploreJson), 'explore must not synthesize a calls edge');
                assert.ok(!exploreJson.includes('"relationships"'), 'explore must not synthesize relationships');
            }

            // 7. Per-capability disable + re-enable: an inline fake returns the
            //    malformed (wrong-shaped) fixture for `query`/`callers` but a valid
            //    `status`; search()/getCallers() must degrade to empty
            //    matches/relationships + a schema-invalid diagnostic on the
            //    returned object's `.diagnostics` channel AND disable
            //    capabilities.symbols/capabilities.callers; a later VALID
            //    response re-enables each.
            {
                const malformedFake = path.join(os.tmpdir(), 'cg-fake-malformed-' + Date.now() + '.js');
                fs.writeFileSync(malformedFake, [
                    "'use strict';",
                    "const fs = require('fs');",
                    "const path = require('path');",
                    "const sub = process.argv[2];",
                    `const CG_DIR = ${JSON.stringify(CG_DIR)};`,
                    "if (sub === 'query') { process.stdout.write(fs.readFileSync(path.join(CG_DIR, 'codegraph-malformed.json'))); process.exit(0); }",
                    "if (sub === 'callers') { process.stdout.write(fs.readFileSync(path.join(CG_DIR, 'codegraph-malformed.json'))); process.exit(0); }",
                    "if (sub === 'status') { process.stdout.write(fs.readFileSync(path.join(CG_DIR, 'codegraph-status.json'))); process.exit(0); }",
                    'process.exit(2);',
                    '',
                ].join('\n'), 'utf8');

                const flexProvider = cg.create({ executable: process.execPath });
                const malformedCtx = { projectRoot: TEMPLATE_CLI_DIR, providerConfig: { prefixArgs: [malformedFake] } };
                const validCtx = { projectRoot: TEMPLATE_CLI_DIR, providerConfig: { prefixArgs: [fakePath] } };

                const badResult = await flexProvider.search(malformedCtx, 'normalize');
                assert.strictEqual(badResult.matches.length, 0, 'malformed query response must yield empty matches');
                assert.ok(badResult.diagnostics.some((d) => d.code === 'schema-invalid'),
                    'malformed query response must emit a schema-invalid diagnostic');
                const badStatus = await flexProvider.getStatus(malformedCtx);
                assert.strictEqual(badStatus.capabilities.symbols, false,
                    'capabilities.symbols must be disabled after a malformed query response');

                const goodResult = await flexProvider.search(validCtx, 'normalize');
                assert.strictEqual(goodResult.matches.length, 2, 'a subsequent valid query must parse normally');
                const goodStatus = await flexProvider.getStatus(validCtx);
                assert.strictEqual(goodStatus.capabilities.symbols, true,
                    'capabilities.symbols must re-enable after a subsequent valid query response');

                // getCallers previously had NO diagnostics channel at all (bare
                // array) — this is the channel that was missing.
                const badCallers = await flexProvider.getCallers(malformedCtx, 'normalizeReference');
                assert.strictEqual(badCallers.relationships.length, 0, 'malformed callers response must yield empty relationships');
                assert.ok(badCallers.diagnostics.some((d) => d.code === 'schema-invalid'),
                    'malformed callers response must emit a schema-invalid diagnostic');
                const badCallersStatus = await flexProvider.getStatus(malformedCtx);
                assert.strictEqual(badCallersStatus.capabilities.callers, false,
                    'capabilities.callers must be disabled after a malformed callers response');

                const goodCallers = await flexProvider.getCallers(validCtx, 'normalizeReference');
                assert.deepStrictEqual(goodCallers.diagnostics, [], 'a subsequent valid callers response must have no diagnostics');
                assert.strictEqual(goodCallers.relationships.length, 3, 'a subsequent valid callers response must parse normally');
                const goodCallersStatus = await flexProvider.getStatus(validCtx);
                assert.strictEqual(goodCallersStatus.capabilities.callers, true,
                    'capabilities.callers must re-enable after a subsequent valid callers response');

                fs.rmSync(malformedFake, { force: true });
            }

            // 8. No `.codegraph` path is ever opened by this module.
            {
                assert.ok(!modSource.includes('.codegraph'), 'codegraph.js must never reference a .codegraph path');
            }
        }
        console.log('✅ T-cg-queries passed');

        console.log('T-cg-cache. Testing file-based bounded cache — envelope + disk-safety + persistence whitelist + markStale ...');
        {
            const cachePath = path.join(TEMPLATE_CLI_DIR, 'code-perception', 'cache.js');
            const { makeCacheKey, createCache, CACHEABLE_KINDS } = require(cachePath);

            // 0. CACHEABLE_KINDS sanity (whitelist contract).
            assert.deepStrictEqual(
                CACHEABLE_KINDS,
                ['provider-status', 'search', 'relationship', 'impact', 'governance-links'],
                'CACHEABLE_KINDS must be the exact whitelist',
            );

            // 1. Key sensitivity: distinct parts -> distinct key; same parts ->
            //    same key (deterministic); result is 64-hex.
            {
                const kA = makeCacheKey({ providerId: 'p', query: 'a' });
                const kB = makeCacheKey({ providerId: 'p', query: 'b' });
                assert.notStrictEqual(kA, kB, 'different query must yield a different key');
                const kA2 = makeCacheKey({ providerId: 'p', query: 'a' });
                assert.strictEqual(kA, kA2, 'same parts must yield the same key (deterministic)');
                assert.ok(/^[0-9a-f]{64}$/.test(kA), 'makeCacheKey must return a 64-hex sha256');
            }

            // 2. File persistence across instances: a second createCache() over the
            //    same root must see what the first instance persisted to disk.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-persist');
                const now = () => 0;
                const key = makeCacheKey({ providerId: 'p', query: 'persist' });
                const cache1 = createCache({ projectRoot: workspaceRoot, now });
                assert.deepStrictEqual(
                    cache1.set(key, { x: 1 }, { kind: 'provider-status' }),
                    { stored: true },
                    'set must succeed for a whitelisted kind',
                );

                const cache2 = createCache({ projectRoot: workspaceRoot, now });
                const got = cache2.get(key);
                assert.strictEqual(got.hit, true, 'a second cache instance over the same root must see the persisted entry');
                assert.deepStrictEqual(got.value, { x: 1 }, 'persisted value must deep-equal the original (proves on-disk, not in-process)');
            }

            // 3. TTL expiry via injected clock.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-ttl');
                let fakeNow = 0;
                const now = () => fakeNow;
                const key = makeCacheKey({ providerId: 'p', query: 'ttl' });
                const cache = createCache({ projectRoot: workspaceRoot, ttlMs: 1000, now });
                fakeNow = 0;
                cache.set(key, { y: 1 }, { kind: 'search' });
                fakeNow = 500;
                assert.strictEqual(cache.get(key).hit, true, 'entry within ttlMs must hit');
                fakeNow = 2000;
                assert.strictEqual(cache.get(key).hit, false, 'entry beyond ttlMs must MISS');
            }

            // 4. Too-large + uncacheable-kind rejections.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-limits');
                const now = () => 0;
                const cache = createCache({ projectRoot: workspaceRoot, now });

                const bigKey = makeCacheKey({ providerId: 'p', query: 'big' });
                assert.deepStrictEqual(
                    cache.set(bigKey, { big: 'x'.repeat(2 * 1024 * 1024) }, { kind: 'search' }),
                    { stored: false, reason: 'cache-value-too-large' },
                    'an over-budget value must be rejected before writing',
                );

                const badKindKey = makeCacheKey({ providerId: 'p', query: 'badkind' });
                assert.deepStrictEqual(
                    cache.set(badKindKey, { x: 1 }, { kind: 'getEntity-content' }),
                    { stored: false, reason: 'uncacheable-kind' },
                    'a non-whitelisted kind must be rejected',
                );
            }

            // 5. markStale mutates the envelope only — the value stays byte-identical.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-stale');
                const now = () => 0;
                const cache = createCache({ projectRoot: workspaceRoot, now });
                const key = makeCacheKey({ providerId: 'p', query: 'stale' });
                cache.set(key, { provider: { freshness: 'fresh' } }, { kind: 'impact' });

                const marked = cache.markStale({ reason: 'head', currentCommit: 'abc' });
                assert.strictEqual(marked.marked, 1, 'markStale must mark exactly the one live entry');

                const got = cache.get(key);
                assert.strictEqual(got.hit, true, 'markStale must not evict the entry');
                assert.strictEqual(got.stale, true, 'get must surface stale:true as the effective freshness');
                assert.strictEqual(got.staleReason, 'head', 'get must surface the staleReason');
                assert.deepStrictEqual(
                    got.value, { provider: { freshness: 'fresh' } },
                    'value must stay byte-identical after markStale (only the envelope mutates)',
                );
            }

            // 6. invalidateOn clears all entries.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-invalidate');
                const now = () => 0;
                const cache = createCache({ projectRoot: workspaceRoot, now });
                const key1 = makeCacheKey({ providerId: 'p', query: 'i1' });
                const key2 = makeCacheKey({ providerId: 'p', query: 'i2' });
                cache.set(key1, { a: 1 }, { kind: 'provider-status' });
                cache.set(key2, { b: 1 }, { kind: 'provider-status' });
                assert.strictEqual(cache.size(), 2, 'both entries must be stored before invalidation');

                const result = cache.invalidateOn('config');
                assert.strictEqual(result.cleared, 2, 'invalidateOn must report the cleared count');
                assert.strictEqual(cache.size(), 0, 'size must be 0 after invalidateOn');
                assert.strictEqual(cache.get(key1).hit, false, 'entries must MISS after invalidateOn');
            }

            // 7. Disk safety.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-disksafety');
                const now = () => 0;
                const cache = createCache({ projectRoot: workspaceRoot, now });

                // (a) a non-64-hex key must MISS and never touch the filesystem.
                {
                    const cacheDir = path.join(workspaceRoot, '.evo-lite', '.cache', 'code-perception');
                    const existedBefore = fs.existsSync(cacheDir);
                    const badKeyResult = cache.get('not-a-valid-key');
                    assert.strictEqual(badKeyResult.hit, false, 'a non-64-hex key must MISS');
                    assert.strictEqual(fs.existsSync(cacheDir), existedBefore, 'an invalid key must never touch the filesystem');
                }

                // (b) GUARDED symlink test: a symlinked cache-root component
                //     pointing outside projectRoot must degrade to a safe no-op.
                {
                    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cache-outside-'));
                    const cacheParentDir = path.join(workspaceRoot, '.evo-lite', '.cache');
                    fs.mkdirSync(cacheParentDir, { recursive: true });
                    const symlinkedRoot = path.join(cacheParentDir, 'code-perception');
                    let symlinkCreated = false;
                    try {
                        fs.symlinkSync(outsideDir, symlinkedRoot, 'dir');
                        symlinkCreated = true;
                    } catch (err) {
                        console.log(`  (guard-skip: symlink creation not permitted on this platform: ${err.message})`);
                    }
                    if (symlinkCreated) {
                        const symlinkedCache = createCache({ projectRoot: workspaceRoot, now });
                        const key = makeCacheKey({ providerId: 'p', query: 'symlink' });
                        const result = symlinkedCache.set(key, { z: 1 }, { kind: 'provider-status' });
                        assert.deepStrictEqual(
                            result, { stored: false, reason: 'unsafe-cache-root' },
                            'a set() through a symlinked root must degrade to a safe no-op',
                        );
                        assert.deepStrictEqual(fs.readdirSync(outsideDir), [], 'no file may be written outside projectRoot via the symlink');
                        fs.rmSync(symlinkedRoot, { force: true });
                    }
                    fs.rmSync(outsideDir, { recursive: true, force: true });
                }

                // (c) a corrupted stored file must MISS with a diagnostic, never throw.
                {
                    const corruptKey = makeCacheKey({ providerId: 'p', query: 'corrupt' });
                    const setResult = cache.set(corruptKey, { ok: 1 }, { kind: 'provider-status' });
                    assert.strictEqual(setResult.stored, true, 'baseline set for the corruption test must succeed');
                    const corruptFile = path.join(workspaceRoot, '.evo-lite', '.cache', 'code-perception', `${corruptKey}.json`);
                    fs.writeFileSync(corruptFile, 'not valid json {{{', 'utf8');
                    const corruptResult = cache.get(corruptKey);
                    assert.strictEqual(corruptResult.hit, false, 'a corrupt file must MISS');
                    assert.ok(
                        corruptResult.diagnostics && corruptResult.diagnostics.some(d => d.code === 'cache-corrupt'),
                        'a corrupt file must surface a cache-corrupt diagnostic',
                    );
                }
            }

            // 8. maxEntries eviction: beyond the bound, the OLDEST entry (by
            //    storedAt via the injected clock) is evicted first.
            {
                const { workspaceRoot } = createTempRuntimeRoot('cg-cache-evict');
                let fakeNow = 0;
                const now = () => fakeNow;
                const cache = createCache({ projectRoot: workspaceRoot, maxEntries: 2, now });
                const k1 = makeCacheKey({ providerId: 'p', query: 'e1' });
                const k2 = makeCacheKey({ providerId: 'p', query: 'e2' });
                const k3 = makeCacheKey({ providerId: 'p', query: 'e3' });
                fakeNow = 0; cache.set(k1, { n: 1 }, { kind: 'provider-status' });
                fakeNow = 100; cache.set(k2, { n: 2 }, { kind: 'provider-status' });
                fakeNow = 200; cache.set(k3, { n: 3 }, { kind: 'provider-status' });
                assert.strictEqual(cache.size(), 2, 'size must be capped at maxEntries');
                assert.strictEqual(cache.get(k1).hit, false, 'the oldest entry (by storedAt) must be evicted');
                assert.strictEqual(cache.get(k2).hit, true, 'newer entries must remain');
                assert.strictEqual(cache.get(k3).hit, true, 'newer entries must remain');
            }
        }
        console.log('✅ T-cg-cache passed');

        console.log('T-cg-linker-exact. Testing governance linker — reference-resolved exact file links ...');
        {
            const { normalizeReference } = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'normalize'));
            const linker = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'governance-linker'));
            const refA = normalizeReference('provider:native-lite', { providerEntityId: 'src/a.js', name: 'a.js', kind: 'file', filePath: 'src/a.js' });
            const refB = normalizeReference('provider:native-lite', { providerEntityId: 'src/b.js', name: 'b.js', kind: 'file', filePath: 'src/b.js' });
            const fileReferences = [refA, refB];

            // 1. declares_file resolved.
            {
                const planIR = { tasks: [{ id: 'task:x', sourcePath: 'docs/plans/p.md', linkedFiles: ['src/a.js'] }] };
                const result = linker.buildGovernanceLinks({ planIR, fileReferences });
                const declares = result.links.filter(l => l.kind === 'declares_file');
                assert.strictEqual(declares.length, 1, 'exactly one declares_file link');
                const link = declares[0];
                assert.strictEqual(link.status, 'confirmed', 'declares_file status confirmed');
                assert.strictEqual(link.confidence, 1.0, 'declares_file confidence 1.0');
                assert.strictEqual(link.codeReferenceId, refA.id, 'declares_file resolves to refA.id');
                assert.strictEqual(link.governanceEntityId, 'task:x', 'declares_file governanceEntityId is task id');
                assert.strictEqual(link.evidence.sourcePath, 'docs/plans/p.md', 'declares_file evidence.sourcePath from task');
                assert.ok(link.id.startsWith('gov-link:'), 'link id starts with gov-link:');
            }

            // 2. depends_on_file from explicit acceptanceDependencies input.
            {
                const acceptanceDependencies = [{ governanceEntityId: 'task:x', filePath: 'src/b.js', sourcePath: 'docs/specs/s.md' }];
                const result = linker.buildGovernanceLinks({ acceptanceDependencies, fileReferences });
                const deps = result.links.filter(l => l.kind === 'depends_on_file');
                assert.strictEqual(deps.length, 1, 'exactly one depends_on_file link');
                assert.strictEqual(deps[0].codeReferenceId, refB.id, 'depends_on_file resolves to refB.id');
                assert.strictEqual(deps[0].confidence, 1.0, 'depends_on_file confidence 1.0');
                assert.strictEqual(deps[0].evidence.sourcePath, 'docs/specs/s.md', 'depends_on_file evidence.sourcePath from dep');
            }

            // 3. changed_by_commit.
            {
                const commits = [{ sha: 'abc123', changedFiles: ['src/a.js'] }];
                const result = linker.buildGovernanceLinks({ commits, fileReferences });
                const changed = result.links.filter(l => l.kind === 'changed_by_commit');
                assert.strictEqual(changed.length, 1, 'exactly one changed_by_commit link');
                assert.strictEqual(changed[0].governanceEntityId, 'commit:abc123', 'changed_by_commit governanceEntityId is commit:<sha>');
                assert.strictEqual(changed[0].evidence.commitSha, 'abc123', 'changed_by_commit evidence.commitSha');
                assert.strictEqual(changed[0].codeReferenceId, refA.id, 'changed_by_commit resolves to refA.id');
            }

            // 4. Unresolved -> diagnostic + NO dangling link.
            {
                const planIR = { tasks: [{ id: 'task:missing', sourcePath: 'docs/plans/p.md', linkedFiles: ['src/missing.js'] }] };
                const result = linker.buildGovernanceLinks({ planIR, fileReferences });
                assert.ok(
                    result.diagnostics.some(d => d.code === 'unresolved-code-reference'),
                    'unresolved linkedFile produces an unresolved-code-reference diagnostic',
                );
                assert.ok(
                    !result.links.some(l => l.governanceEntityId === 'task:missing'),
                    'no link is emitted for the unresolved file (anti-dangling)',
                );
            }

            // 5. No acceptanceDependencies -> no depends_on_file links (never invented from task).
            {
                const planIR = { tasks: [{ id: 'task:x', sourcePath: 'docs/plans/p.md', linkedFiles: ['src/a.js'] }] };
                const result = linker.buildGovernanceLinks({ planIR, fileReferences });
                assert.strictEqual(
                    result.links.filter(l => l.kind === 'depends_on_file').length, 0,
                    'no depends_on_file links when acceptanceDependencies is absent',
                );
            }

            // 6. Empty inputs -> empty result, no throw.
            {
                const result = linker.buildGovernanceLinks({});
                assert.deepStrictEqual(result, { links: [], diagnostics: [] }, 'empty inputs yield empty links/diagnostics');
            }
            assert.doesNotThrow(() => linker.buildGovernanceLinks(undefined), 'undefined inputs must never throw');

            // 7. Path normalization: './src/a.js' and 'src\\a.js' both resolve to refA.
            {
                const planIR = {
                    tasks: [
                        { id: 'task:dotslash', sourcePath: 'docs/plans/p.md', linkedFiles: ['./src/a.js'] },
                        { id: 'task:backslash', sourcePath: 'docs/plans/p.md', linkedFiles: ['src\\a.js'] },
                    ],
                };
                const result = linker.buildGovernanceLinks({ planIR, fileReferences });
                const declares = result.links.filter(l => l.kind === 'declares_file');
                assert.strictEqual(declares.length, 2, 'both normalized paths resolve to links');
                assert.ok(declares.every(l => l.codeReferenceId === refA.id), './src/a.js and src\\a.js both normalize to refA');
            }

            // 8. Dedupe: same (task, file) declared twice -> a single link (one id).
            {
                const planIR = {
                    tasks: [
                        { id: 'task:dup', sourcePath: 'docs/plans/p.md', linkedFiles: ['src/a.js', 'src/a.js'] },
                    ],
                };
                const result = linker.buildGovernanceLinks({ planIR, fileReferences });
                const declares = result.links.filter(l => l.kind === 'declares_file' && l.governanceEntityId === 'task:dup');
                assert.strictEqual(declares.length, 1, 'duplicate (task, file) declares_file collapses to one link');
            }
        }
        console.log('✅ T-cg-linker-exact passed');

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

        console.log('T-spec-cli. Testing registerSpecPortfolioCommands wiring + EUSAGE exit-code mapping ...');
        {
            const { Command } = require('commander');
            const specPortfolio = require(path.join(TEMPLATE_CLI_DIR, 'spec-portfolio'));
            assert.strictEqual(typeof specPortfolio.registerSpecPortfolioCommands, 'function',
                'registerSpecPortfolioCommands must be exported');

            const p = new Command();
            specPortfolio.registerSpecPortfolioCommands(p);
            const specCmd = p.commands.find(c => c.name() === 'spec');
            assert.ok(specCmd, 'program exposes a spec command group');
            const subNames = specCmd.commands.map(c => c.name()).sort();
            assert.deepStrictEqual(subNames, ['adopt', 'park', 'reactivate', 'status'],
                'spec command group exposes adopt/park/reactivate/status subcommands');

            // EUSAGE -> exit 2 (per plan; NOT the hive exitCode=1 convention).
            // Drive the real action handler against an unknown spec id via `park`.
            const runtime = createTempRuntimeRoot('spec-cli-eusage');
            const origEvoRoot = process.env.EVO_LITE_ROOT;
            process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
            const prevExit = process.exitCode;
            try {
                const cliProgram = new Command();
                specPortfolio.registerSpecPortfolioCommands(cliProgram);
                process.exitCode = undefined;
                const output = await captureConsole(async () => {
                    await cliProgram.parseAsync(['node', 'mem', 'spec', 'park', 'spec:does-not-exist']);
                });
                assert.strictEqual(process.exitCode, 2, 'park on unknown id maps EUSAGE to exit code 2');
                assert.ok(/unknown spec id/.test(output), 'error line names the unknown id');
                assert.ok(output.startsWith('❌'), 'error path prints only the ❌ line, no stdout');
            } finally {
                process.exitCode = prevExit;
                if (origEvoRoot === undefined) delete process.env.EVO_LITE_ROOT;
                else process.env.EVO_LITE_ROOT = origEvoRoot;
            }
            console.log('✅ T-spec-cli passed');
        }

        console.log('T-cg-status. Testing code-perception status surface (provider table + manual-sync stale hints + link summary) ...');
        {
            const statusModPath = path.join(TEMPLATE_CLI_DIR, 'code-perception', 'status');
            const statusMod = require(statusModPath);
            assert.strictEqual(typeof statusMod.buildCodePerceptionStatus, 'function',
                'buildCodePerceptionStatus must be exported');

            // 1. Degraded + stale hint: codegraph (stale, not degraded) + native-lite (fallback, degraded, never stale).
            {
                const codegraphCand = {
                    registration: { provider: { id: 'provider:codegraph' }, role: 'structural-primary' },
                    role: 'structural-primary',
                    availability: { available: true, ready: true, indexState: 'stale' },
                    status: {
                        providerId: 'provider:codegraph', indexState: 'stale',
                        indexedCommit: 'aaa', currentCommit: 'bbb', compatibility: 'supported',
                    },
                    diagnostics: [],
                };
                const nativeLiteCand = {
                    registration: { provider: { id: 'provider:native-lite' }, role: 'fallback' },
                    role: 'fallback',
                    availability: { available: true, ready: true, indexState: 'not-required' },
                    status: { providerId: 'provider:native-lite', indexState: 'not-required' },
                    diagnostics: [],
                };
                const report = statusMod.buildCodePerceptionStatus({}, { candidates: [codegraphCand, nativeLiteCand] });

                assert.strictEqual(report.providers.length, 2, 'must produce one row per candidate');
                const cgRow = report.providers.find(p => p.id === 'provider:codegraph');
                const nlRow = report.providers.find(p => p.id === 'provider:native-lite');
                assert.ok(cgRow, 'codegraph row must be present');
                assert.ok(nlRow, 'native-lite row must be present');
                assert.strictEqual(cgRow.indexState, 'stale', 'codegraph row must reflect stale indexState');
                assert.strictEqual(cgRow.degraded, false, 'codegraph row must not be degraded (ready + structural-primary)');
                assert.strictEqual(nlRow.degraded, true, 'native-lite row must be degraded (role fallback)');

                assert.strictEqual(report.staleHints.length, 1, 'exactly one stale hint (codegraph only)');
                const hint = report.staleHints[0];
                assert.strictEqual(hint.providerId, 'provider:codegraph', 'stale hint must name codegraph');
                assert.strictEqual(hint.indexedCommit, 'aaa', 'stale hint must carry indexedCommit');
                assert.strictEqual(hint.currentCommit, 'bbb', 'stale hint must carry currentCommit');
                assert.ok(hint.message.includes('codegraph sync'), 'stale hint message must advise manual codegraph sync');
                assert.ok(!report.staleHints.some(h => h.providerId === 'provider:native-lite'),
                    'native-lite (not-required) must never yield a stale hint');
            }

            // 2. No spawn: monkey-patch child_process to throw, prove the module never touches it; grep-assert source too.
            {
                const cp = require('child_process');
                const orig = {
                    execFile: cp.execFile, spawn: cp.spawn, execFileSync: cp.execFileSync,
                    spawnSync: cp.spawnSync, exec: cp.exec, execSync: cp.execSync,
                };
                for (const k of Object.keys(orig)) {
                    cp[k] = () => { throw new Error('status module must not spawn: ' + k); };
                }
                try {
                    assert.doesNotThrow(() => {
                        statusMod.buildCodePerceptionStatus({}, {
                            candidates: [{
                                registration: { provider: { id: 'provider:x' } }, role: 'structural-primary',
                                availability: { available: true, ready: true, indexState: 'ready' },
                                status: { providerId: 'provider:x', indexState: 'ready', compatibility: 'supported' },
                                diagnostics: [],
                            }],
                            links: [{ status: 'confirmed' }],
                        });
                    }, 'buildCodePerceptionStatus must not touch child_process');
                } finally {
                    Object.assign(cp, orig);
                }

                const source = fs.readFileSync(require.resolve(statusModPath), 'utf8');
                assert.ok(!/child_process/.test(source), 'status.js source must never reference child_process');
                assert.ok(!/\bspawn\b/.test(source), 'status.js source must never reference spawn');
                assert.ok(!/\bexecFile\b/.test(source), 'status.js source must never reference execFile');
            }

            // 3. Links summary: from array (counted by .status) and pre-summarized passthrough.
            {
                const fromArray = statusMod.buildCodePerceptionStatus({}, {
                    links: [{ status: 'confirmed' }, { status: 'confirmed' }, { status: 'derived' }, { status: 'proposed' }],
                });
                assert.deepStrictEqual(fromArray.links, { confirmed: 2, derived: 1, proposed: 1 },
                    'links array must be counted by status');

                const presummarized = statusMod.buildCodePerceptionStatus({}, {
                    links: { confirmed: 5, derived: 0, proposed: 2 },
                });
                assert.deepStrictEqual(presummarized.links, { confirmed: 5, derived: 0, proposed: 2 },
                    'pre-summarized links object must pass through unchanged');
            }

            // 4. Not-ready candidate must be degraded.
            {
                const notReadyCand = {
                    registration: { provider: { id: 'provider:notready' }, role: 'enrichment' },
                    role: 'enrichment',
                    availability: { available: true, ready: false, indexState: 'missing' },
                    status: null,
                    diagnostics: [],
                };
                const report = statusMod.buildCodePerceptionStatus({}, { candidates: [notReadyCand] });
                assert.strictEqual(report.providers.length, 1, 'must produce a row for the not-ready candidate');
                assert.strictEqual(report.providers[0].degraded, true, 'not-ready candidate must be degraded');
                assert.strictEqual(report.providers[0].ready, false, 'not-ready candidate row must report ready:false');
            }

            // 5. Empty/undefined inputs -> empty report, no throw.
            {
                const report = statusMod.buildCodePerceptionStatus({}, {});
                assert.deepStrictEqual(report, {
                    providers: [], staleHints: [], links: { confirmed: 0, derived: 0, proposed: 0 }, diagnostics: [],
                }, 'empty inputs must yield an empty report');

                assert.doesNotThrow(() => statusMod.buildCodePerceptionStatus(),
                    'buildCodePerceptionStatus must not throw when called with no arguments');
            }

            // 6. Malformed candidates (null / {}) must never throw and must degrade to a diagnostic/unknown row.
            {
                let report;
                assert.doesNotThrow(() => {
                    report = statusMod.buildCodePerceptionStatus({}, { candidates: [null, {}, undefined] });
                }, 'malformed candidates must never throw');
                assert.ok(Array.isArray(report.providers), 'providers must still be an array');
                assert.ok(Array.isArray(report.diagnostics), 'diagnostics must still be an array');
                assert.ok(report.diagnostics.some(d => d.code === 'malformed-candidate'),
                    'malformed candidates must contribute a malformed-candidate diagnostic');
            }
        }
        console.log('✅ T-cg-status passed');
}

module.exports = { runGovernanceTests };
