'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    WORKSPACE_ROOT, TEMPLATE_CLI_DIR, CLI_DIR, INIT_ENTRY,
    createTempRuntimeRoot, writeText, runGit, runPostCommitHook,
    createHookTestRepo, readNdjson, bootstrapRuntime, captureConsole,
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
                const passCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
                    { repoRoot: tmp, exec: () => 'ok' });
                assert.strictEqual(passCmd.verdict, 'PASS', 'command exit 0 → PASS');
                const failCmd = runVerifier({ verifier: { type: 'command', params: { cmd: 'x' } } },
                    { repoRoot: tmp, exec: () => { const e = new Error('boom'); e.status = 2; throw e; } });
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
                    '{ "criteria": [ { "id": "ac-ok", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "true" } } } ] }',
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
                    ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "true" } } },' +
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
                    ' { "id": "ac-cmd", "description": "x", "dependsOn": ["index.js"], "verifier": { "type": "command", "params": { "cmd": "x" } } },' +
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
    }
    console.log('✅ T-hive-status passed');
}

module.exports = { runGovernanceTests };
