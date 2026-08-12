'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, runCli, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
    quiesceSharedResources,
    readNdjson, createLegacyInitProject, createModernInitProject,
    resetCliModuleCache, loadCli, bootstrapRuntime, captureConsole, withPatchedExecFileSync,
} = require('./harness');

function removePrStateRuntimeRoot(root, rmSync = fs.rmSync) {
    return rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    });
}

async function runIntegrationTests() {
    console.log('--- Starting CLI integration tests ---');

    // This suite validates the SQLite reference implementation and memory flows
    // against SQLite storage (it inserts into / reads from raw_memory directly and
    // asserts trigram match_source='fts'). The default engine flipped to zvec
    // (spec:memory-engine-default-flip); the Zvec engine has its own governance
    // coverage (T-ZV, T-REBUILD-ZVEC, T-AB, T-LIST). Pin SQLite here so this suite
    // keeps testing what it was written to test. Each bootstrapRuntime reloads the
    // seam singleton, so this pin takes effect for every runtime built below.
    process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';

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

        console.log('T-EXACT. Testing rerankByExact boosts literal-phrase docs above jieba-OR noise ...');
        {
            const utilPath = path.join(CLI_DIR, 'memory-index-util.js');
            delete require.cache[require.resolve(utilPath)];
            const { rerankByExact } = require(utilPath);
            assert.strictEqual(typeof rerankByExact, 'function', 'rerankByExact not exported from memory-index-util.js');

            // Engine (BM25-OR) order: OR-noise doc first, exact-phrase doc last.
            const rows = [
                { content: 'dogfood dogfood dogfood then a full cycle later on' }, // all tokens, no phrase -> tier1
                { content: 'this doc mentions cycle repeatedly, cycle cycle' },    // partial tokens -> tier2
                { content: 'we ran a dogfood cycle to validate the flip' },        // literal phrase -> tier0
            ];
            const ranked = rerankByExact(rows, 'dogfood cycle', r => r.content);
            assert.ok(ranked[0].content.includes('dogfood cycle'), 'exact phrase doc must rank first');
            assert.ok(ranked[1].content.includes('dogfood') && ranked[1].content.includes('cycle') && !ranked[1].content.includes('dogfood cycle'), 'all-tokens (AND) doc must rank second');
            assert.strictEqual(ranked.length, 3, 'rerank must not drop rows');

            // Single-token query: engine order preserved untouched.
            const single = [{ content: 'b' }, { content: 'a' }];
            const singleRanked = rerankByExact(single, 'token', r => r.content);
            assert.strictEqual(singleRanked[0].content, 'b', 'single-token query must not reorder engine results');
            console.log('✅ T-EXACT rerankByExact tier ordering passed');
        }

        console.log('T-REBUILD-DEGRADED-SQLITE. Testing zvec choice with sqlite fallback rebuild does not duplicate records ...');
        {
            const runtime = createTempRuntimeRoot('rebuild-degraded-sqlite');
            const fixtureCount = 3;
            const prevEngine = process.env.EVO_LITE_MEMORY_ENGINE;
            try {
                const seeded = await bootstrapRuntime(runtime.runtimeRoot, {
                    EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
                    EVO_LITE_SKIP_GIT_STATUS: '1',
                });
                for (let i = 0; i < fixtureCount; i++) {
                    await seeded.service.archive(
                        `degraded rebuild fixture ${i} must remain exactly once after rebuild`,
                        'task',
                        {
                            id: `degraded-rebuild-${i}`,
                            timestamp: `2026-07-08T00:00:0${i}Z`,
                            silent: true,
                        }
                    );
                }
                assert.strictEqual(seeded.db.getDb().prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count, fixtureCount, 'fixture sqlite seed count');
                try { require(path.join(CLI_DIR, 'memory-index.js')).getMemoryIndex().close(); } catch (_) {}
                seeded.db.closeDb();
                fs.rmSync(path.join(runtime.runtimeRoot, 'index_memory'), { recursive: true, force: true });

                resetCliModuleCache();
                process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
                process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
                process.env.EVO_LITE_SKIP_GIT_GUARD = '1';
                process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;
                process.env.EVO_LITE_MEMORY_ENGINE = 'zvec';
                process.env.EVO_LITE_SKIP_GIT_STATUS = '1';

                const memoryIndexPath = path.join(CLI_DIR, 'memory-index.js');
                const memoryIndex = require(memoryIndexPath);
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
                const rebuildOutput = await captureConsole(async () => {
                    await service.rebuildLocalIndex();
                });
                assert.ok(/引擎降级/.test(rebuildOutput), 'rebuild emits engine-degradation WARN when zvec choice falls back to sqlite');
                const verifyOutput = await captureConsole(async () => {
                    await service.verify();
                });
                assert.ok(/引擎降级/.test(verifyOutput), 'verify emits engine-degradation WARN under zvec-choice sqlite-fallback');
                const activeIndex = memoryIndex.getMemoryIndex();
                const finalCount = activeIndex.stats().count;
                assert.strictEqual(finalCount, fixtureCount, `degraded sqlite rebuild must leave exactly ${fixtureCount} prose records, got ${finalCount}`);
                const engineTag = require(path.join(CLI_DIR, 'db.js')).getDb()
                    .prepare("SELECT value FROM _meta WHERE key = 'memory_engine'")
                    .get().value;
                assert.strictEqual(engineTag, 'sqlite-fts5-trigram', 'degraded fallback must keep sqlite engine tag');
            } finally {
                if (prevEngine === undefined) delete process.env.EVO_LITE_MEMORY_ENGINE;
                else process.env.EVO_LITE_MEMORY_ENGINE = prevEngine;
                delete process.env.EVO_LITE_SKIP_GIT_STATUS;
                resetCliModuleCache();
            }
            console.log('✅ T-REBUILD-DEGRADED-SQLITE no-duplication passed');
        }

        console.log('T-CODEPLC-CAPSTONE. Testing CodePLC-shaped zvec-depless nurture/rebuild/verify pipeline ...');
        {
            const { nurtureChild } = require(path.join(CLI_DIR, 'hive', 'nurture.js'));
            const { sha256 } = require(path.join(CLI_DIR, 'hive', 'status.js'));
            const noGit = () => { throw new Error('not a git repo'); };
            const mother = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-codeplc-mother-'));
            fs.writeFileSync(path.join(mother, 'package.json'), '{"version":"9.9.9"}');
            fs.mkdirSync(path.join(mother, 'templates', 'cli'), { recursive: true });
            fs.mkdirSync(path.join(mother, 'templates', 'runtime'), { recursive: true });
            fs.writeFileSync(path.join(mother, 'templates', 'cli', 'engine-gene.js'), 'module.exports = "engine gene";\n');
            fs.writeFileSync(path.join(mother, 'templates', 'runtime', 'package.json'),
                '{"dependencies":{"commander":"15.0.0","@zvec/zvec":"1.0.0"}}');
            const child = createTempRuntimeRoot('codeplc-capstone');
            fs.mkdirSync(path.join(child.runtimeRoot, 'cli'), { recursive: true });
            fs.writeFileSync(path.join(child.runtimeRoot, 'cli', 'engine-gene.js'), 'module.exports = "old engine gene";\n');
            fs.writeFileSync(path.join(child.runtimeRoot, 'package.json'), '{"version":"2.1.0","dependencies":{"commander":"15.0.0"}}');
            const FAM = [
                { key: 'core-cli', scope: 'sync-always', activeRoot: 'cli', templateRoot: 'cli', relativeDir: [], files: ['engine-gene.js'] },
            ];

            const fixtureCount = 12;
            const seeded = await bootstrapRuntime(child.runtimeRoot, {
                EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
                EVO_LITE_SKIP_GIT_STATUS: '1',
            });
            for (let i = 0; i < fixtureCount; i++) {
                await seeded.service.archive(
                    `CodePLC capstone archive ${i} must stay exactly once after degraded rebuild`,
                    'task',
                    {
                        id: `codeplc-capstone-${String(i).padStart(2, '0')}`,
                        timestamp: `2026-07-08T00:20:${String(i).padStart(2, '0')}Z`,
                        silent: true,
                    }
                );
            }
            assert.strictEqual(seeded.db.getDb().prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count, fixtureCount, 'capstone seed count');
            try { require(path.join(CLI_DIR, 'memory-index.js')).getMemoryIndex().close(); } catch (_) {}
            seeded.db.closeDb();
            fs.rmSync(path.join(child.runtimeRoot, 'index_memory'), { recursive: true, force: true });

            const stateFiles = [
                path.join(child.runtimeRoot, 'memory-engine.json'),
                path.join(child.runtimeRoot, 'memory.db'),
                path.join(child.runtimeRoot, 'raw_memory'),
                path.join(child.runtimeRoot, 'index_memory'),
            ];
            const beforeState = stateFiles.map(target => fs.existsSync(target) ? sha256(fs.statSync(target).isDirectory() ? Buffer.from('dir') : fs.readFileSync(target)) : null);
            const report = nurtureChild(mother, { id: 'CodePLC', path: child.workspaceRoot }, {
                dryRun: true,
                exec: noGit,
                force: true,
                familiesOverride: FAM,
            });
            assert.strictEqual(report.status, 'dry-run', 'capstone nurture should be report-only');
            assert.strictEqual(report.engineReadiness.depPresent, false, 'capstone reports missing zvec dep');
            assert.ok(report.engineReadiness.recommendation.includes('@zvec/zvec'), 'capstone recommendation names zvec dep');
            const afterState = stateFiles.map(target => fs.existsSync(target) ? sha256(fs.statSync(target).isDirectory() ? Buffer.from('dir') : fs.readFileSync(target)) : null);
            assert.deepStrictEqual(afterState, beforeState, 'nurture report must not write child engine state');
            assert.ok(!fs.existsSync(path.join(child.runtimeRoot, 'node_modules', '@zvec', 'zvec')), 'capstone child remains zvec-depless');

            resetCliModuleCache();
            process.env.EVO_LITE_CACHE_DIR = SHARED_CACHE_DIR;
            process.env.EVO_LITE_ROOT = child.runtimeRoot;
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
            const rebuildOutput = await captureConsole(async () => {
                await service.rebuildLocalIndex();
            });
            assert.ok(rebuildOutput.includes('⚠️ [引擎降级]'), 'capstone rebuild emits degradation warning');
            const finalCount = memoryIndex.getMemoryIndex().stats().count;
            assert.strictEqual(finalCount, fixtureCount, `capstone rebuild must leave exactly ${fixtureCount} records, got ${finalCount}`);
            const verifyOutput = await captureConsole(async () => {
                await service.verify();
            });
            assert.ok(verifyOutput.includes('⚠️ [引擎降级]'), 'capstone verify emits degradation warning');

            delete process.env.EVO_LITE_SKIP_GIT_STATUS;
            process.env.EVO_LITE_MEMORY_ENGINE = 'sqlite-fts5-trigram';
            resetCliModuleCache();
            console.log(`✅ T-CODEPLC-CAPSTONE passed with records=${finalCount}`);
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
        // This test owns what it opened; suite cleanup cannot reach a handle held
        // by an instance this test still references. Index first, then the db.
        // Owner-local cleanup: the instance that opened this connection closes it.
        fallbackLoaded.db.closeDb();

        // bootstrapRuntime above reset the module cache, so the handle captured
        // before it is now from a discarded generation. Re-bootstrap explicitly
        // rather than calling through the stale one: that would open a
        // connection against whatever EVO_LITE_ROOT this test left behind —
        // which is how the following tests were operating on the fts-fallback
        // database while believing they were using primary's.
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);

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
                'planning/governance-contract.js', 'planning/freeze-ledger.js',
                'architecture/diff.js', 'architecture/infer-modules.js',
                'architecture/provider-contract.js', 'architecture/scan-native.js',
                'memory-index-lock.js',
                'pr-state.js', 'pr-state.service.js',
                'takeover-payload.js', 'takeover-receipt.js', 'takeover-session.js',
                'takeover-adapter.js', 'takeover-install.js',
            ];

            for (const f of required) {
                assert.ok(coreCliFamily.files.includes(f), `core-cli manifest missing: ${f}`);
            }
            console.log('✅ T4 manifest covers all cli modules passed');
        }


        console.log('PS4. Testing pr-state managed runtime mirror coverage ...');
        {
            const runtime = createTempRuntimeRoot('pr-state-managed-runtime');
            const previousCliDir = process.env.EVO_LITE_TEMPLATE_CLI_DIR;
            const previousRootDir = process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
            try {
                process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;
                process.env.EVO_LITE_TEMPLATE_ROOT_DIR = TEMPLATE_ROOT_DIR;
                const syncPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'sync-runtime.js'));
                delete require.cache[syncPath];
                const { syncRuntime, verifyRuntimeLock } = require(syncPath);
                const synced = syncRuntime(runtime.workspaceRoot);
                assert.strictEqual(synced.status, 'ok');
                assert.deepStrictEqual(synced.missingTemplates, []);

                for (const file of [
                    'pr-state.js', 'pr-state.service.js',
                    'planning/governance-contract.js', 'planning/freeze-ledger.js',
                ]) {
                    const activeFile = path.join(runtime.runtimeRoot, 'cli', file);
                    const templateFile = path.join(TEMPLATE_CLI_DIR, file);
                    assert.ok(fs.existsSync(activeFile), `${file} must be copied into the managed runtime`);
                    assert.deepStrictEqual(fs.readFileSync(activeFile), fs.readFileSync(templateFile));
                }

                const lockPath = path.join(runtime.runtimeRoot, 'generated', 'runtime-mirror.lock.json');
                const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                for (const file of [
                    'pr-state.js', 'pr-state.service.js',
                    'planning/governance-contract.js', 'planning/freeze-ledger.js',
                ]) assert.ok(lock.entries[`.evo-lite/cli/${file}`], `runtime lock missing ${file}`);
                const verified = verifyRuntimeLock(runtime.workspaceRoot);
                assert.strictEqual(verified.status, 'ok');
                assert.deepStrictEqual(verified.mismatches, []);
                assert.deepStrictEqual(verified.missing, []);
            } finally {
                if (previousCliDir === undefined) delete process.env.EVO_LITE_TEMPLATE_CLI_DIR;
                else process.env.EVO_LITE_TEMPLATE_CLI_DIR = previousCliDir;
                if (previousRootDir === undefined) delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
                else process.env.EVO_LITE_TEMPLATE_ROOT_DIR = previousRootDir;
                fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
            }
            console.log('✅ PS4 pr-state managed runtime mirror coverage passed');
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

        console.log('2r. Testing context add --label + resolve by human label ...');
        {
            // Isolated runtime: this block runs its own track(), which would
            // otherwise pollute the shared primary trajectory that 2a asserts on.
            const labelRuntime = createTempRuntimeRoot('backlog-label');
            const labelLoaded = await bootstrapRuntime(labelRuntime.runtimeRoot);
            const svc = labelLoaded.service;

            const labelAdd = svc.addTask('Real CODESYS smoke gate follow-up', { label: 'verify1' });
            assert.strictEqual(labelAdd.hash, 'verify1', 'add --label must use the given label as the backlog id');
            const ctxLabel = fs.readFileSync(path.join(labelRuntime.runtimeRoot, 'active_context.md'), 'utf8');
            assert.ok(ctxLabel.includes('[verify1] Real CODESYS smoke gate follow-up'), 'labelled backlog line not persisted');

            // Id extraction anchors past the checkbox: a completed `- [x]` line must
            // not have its `[x]` mistaken for an id, and the placeholder has no id.
            assert.strictEqual(svc.extractBacklogId('- [x] [done1] finished item'), 'done1', 'id must be read past a checked checkbox');
            assert.strictEqual(svc.extractBacklogId('- [ ] 暂无活跃任务。'), null, 'placeholder line has no id');

            // Invalid and duplicate labels are rejected so `--resolve` stays unambiguous.
            assert.throws(() => svc.addTask('bad', { label: 'has space' }), /无效的 backlog label/, 'label with a space must be rejected');
            assert.throws(() => svc.addTask('dup', { label: 'verify1' }), /已存在/, 'duplicate label must be rejected');

            // Ambiguous id (e.g. a legacy hand-written collision) is rejected, not first-wins.
            const dupMd = ctxLabel.replace(
                '- [ ] [verify1] Real CODESYS smoke gate follow-up',
                '- [ ] [verify1] Real CODESYS smoke gate follow-up\n- [ ] [verify1] duplicate legacy line'
            );
            assert.throws(() => svc.resolveBacklog(dupMd, 'verify1'), /多条 id/, 'ambiguous id must be rejected');

            // A bare checkbox token like "x" must not resolve to anything.
            assert.throws(() => svc.resolveBacklog(ctxLabel, 'x'), /未找到待 resolve/, 'a bare checkbox token must not resolve');

            // Resolve by the human label end-to-end via track.
            const resTrack = await svc.track('SmokeGateClosed', 'Closed the CODESYS smoke gate follow-up, resolved by its human label instead of a hash.', { resolve: 'verify1' });
            assert.strictEqual(resTrack.status.resolve, 'resolved', 'track --resolve <label> did not resolve');
            const ctxAfter = fs.readFileSync(path.join(labelRuntime.runtimeRoot, 'active_context.md'), 'utf8');
            assert.ok(!ctxAfter.includes('[verify1]'), 'resolved label still present in backlog after track');
            console.log('✅ 2r context add --label + resolve-by-label passed');
        }

        console.log('2e. Testing context edit service contract ...');
        {
            const editRuntime = createTempRuntimeRoot('backlog-edit-service');
            const editLoaded = await bootstrapRuntime(editRuntime.runtimeRoot);
            const svc = editLoaded.service;
            const contextPath = path.join(editRuntime.runtimeRoot, 'active_context.md');
            const logPath = path.join(editRuntime.runtimeRoot, 'memory.log');
            const template = fs.readFileSync(contextPath, 'utf8');
            const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
            const editLogCount = () => {
                if (!fs.existsSync(logPath)) return 0;
                return (fs.readFileSync(logPath, 'utf8').match(/CONTEXT_EDIT:/g) || []).length;
            };
            const withBacklog = (lines, eol = '\n') => {
                const begin = '<!-- BEGIN_BACKLOG -->';
                const end = '<!-- END_BACKLOG -->';
                const beginIndex = template.indexOf(begin);
                const endIndex = template.indexOf(end);
                return template.slice(0, beginIndex + begin.length)
                    + eol + lines.join(eol) + eol
                    + template.slice(endIndex);
            };
            const assertRejected = (markdown, id, newText, pattern, message) => {
                fs.writeFileSync(contextPath, markdown, 'utf8');
                const beforeBytes = fs.readFileSync(contextPath);
                const beforeLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
                assert.throws(() => svc.editBacklogTask(id, newText), pattern, message);
                const afterBytes = fs.readFileSync(contextPath);
                const afterLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
                assert.strictEqual(sha256(afterBytes), sha256(beforeBytes), `${message}: active_context SHA-256 changed`);
                assert.strictEqual(afterLog, beforeLog, `${message}: CONTEXT_EDIT log changed`);
            };
            const captureEditIo = fn => {
                const operations = [];
                const originalWriteFileSync = fs.writeFileSync;
                const originalAppendFileSync = fs.appendFileSync;
                fs.writeFileSync = (filePath, ...args) => {
                    if (path.resolve(filePath) === path.resolve(contextPath)) operations.push('write');
                    return originalWriteFileSync(filePath, ...args);
                };
                fs.appendFileSync = (filePath, content, ...args) => {
                    if (path.resolve(filePath) === path.resolve(logPath) && String(content).includes('CONTEXT_EDIT:')) {
                        operations.push('audit');
                    }
                    return originalAppendFileSync(filePath, content, ...args);
                };
                try {
                    return { result: fn(), operations };
                } finally {
                    fs.writeFileSync = originalWriteFileSync;
                    fs.appendFileSync = originalAppendFileSync;
                }
            };

            const seeded = withBacklog([
                '- [ ] [AbC]\t  old text',
                '- [x] [done1] completed text',
            ], '\r\n');
            fs.writeFileSync(contextPath, seeded, 'utf8');
            const expected = seeded.replace('- [ ] [AbC]\t  old text', '- [ ] [AbC]\t  [BLOCKED] 新文本，"quoted"');
            const logBeforeChange = editLogCount();
            const changedIo = captureEditIo(() => svc.editBacklogTask('abc', '  [BLOCKED] 新文本，"quoted"  '));
            const changed = changedIo.result;
            assert.deepStrictEqual(changed, {
                id: 'AbC',
                line: '- [ ] [AbC]\t  [BLOCKED] 新文本，"quoted"',
            });
            assert.deepStrictEqual(changedIo.operations, ['write', 'audit'], 'changed edit must write once before auditing');
            assert.strictEqual(fs.readFileSync(contextPath, 'utf8'), expected, 'edit changed bytes outside the payload');
            assert.strictEqual(editLogCount(), logBeforeChange + 1, 'changed edit must append one CONTEXT_EDIT');

            const noOpBefore = fs.readFileSync(contextPath);
            const noOpLogBefore = editLogCount();
            const noOpIo = captureEditIo(() => svc.editBacklogTask('ABC', '  [BLOCKED] 新文本，"quoted"  '));
            const noOp = noOpIo.result;
            assert.deepStrictEqual(noOp, changed, 'same-text no-op should return the stored target identity');
            assert.deepStrictEqual(noOpIo.operations, [], 'same-text no-op must not write or audit');
            assert.strictEqual(sha256(fs.readFileSync(contextPath)), sha256(noOpBefore), 'same-text no-op rewrote active_context');
            assert.strictEqual(editLogCount(), noOpLogBefore, 'same-text no-op appended CONTEXT_EDIT');

            const lfSeeded = withBacklog(['- [ ] [lf1] old LF text'], '\n');
            fs.writeFileSync(contextPath, lfSeeded, 'utf8');
            svc.editBacklogTask('LF1', 'new LF text');
            assert.strictEqual(
                fs.readFileSync(contextPath, 'utf8'),
                lfSeeded.replace('- [ ] [lf1] old LF text', '- [ ] [lf1] new LF text'),
                'LF edit changed bytes outside the payload'
            );

            // This is a write-ordering fault test, not a crash-atomicity proof. The
            // injected write throws before touching the file; the contract under test
            // is exception propagation plus zero audit attempt after that throw.
            fs.writeFileSync(contextPath, seeded, 'utf8');
            const writeFailureLogBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
            const writeFailureOperations = [];
            const originalWrite = fs.writeFileSync;
            const originalAppend = fs.appendFileSync;
            fs.writeFileSync = (filePath, ...args) => {
                if (path.resolve(filePath) === path.resolve(contextPath)) {
                    writeFailureOperations.push('write');
                    throw new Error('INJECTED_CONTEXT_WRITE_FAILURE');
                }
                return originalWrite(filePath, ...args);
            };
            fs.appendFileSync = (filePath, content, ...args) => {
                if (path.resolve(filePath) === path.resolve(logPath) && String(content).includes('CONTEXT_EDIT:')) {
                    writeFailureOperations.push('audit');
                }
                return originalAppend(filePath, content, ...args);
            };
            try {
                assert.throws(
                    () => svc.editBacklogTask('abc', 'write failure probe'),
                    /INJECTED_CONTEXT_WRITE_FAILURE/,
                    'context write error must propagate'
                );
                assert.deepStrictEqual(
                    writeFailureOperations,
                    ['write'],
                    'failed context write must not attempt CONTEXT_EDIT'
                );
            } finally {
                fs.writeFileSync = originalWrite;
                fs.appendFileSync = originalAppend;
            }
            const writeFailureLogAfter = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
            assert.strictEqual(writeFailureLogAfter, writeFailureLogBefore, 'failed context write changed the edit audit log');

            assertRejected(seeded, 'bad id', 'valid', /invalid backlog id/, 'invalid id');
            assertRejected(seeded, 'missing', 'valid', /not found/, 'missing id');
            assertRejected(seeded, 'bad id', 'line1\nline2', /single-line/, 'raw newline must win before id validation');
            assertRejected(seeded, 'bad id', 'line1\rline2', /single-line/, 'raw CR must win before id validation');
            assertRejected(seeded, 'bad id', 'line1\r\nline2', /single-line/, 'raw CRLF must win before id validation');
            assertRejected(seeded, 'bad id', '', /new-text.*empty|empty.*new-text/, 'empty string must win before id validation');
            assertRejected(seeded, 'bad id', '   ', /new-text.*empty|empty.*new-text/, 'empty text must win before id validation');
            assertRejected(
                withBacklog(['- [ ] [abc] first', '- [ ] [ABC] second']),
                'aBc',
                'replacement',
                /ambiguous|multiple IDs/,
                'pending duplicate id'
            );
            assertRejected(
                withBacklog(['- [ ] [abc] pending', '- [x] [ABC] checked']),
                'aBc',
                'replacement',
                /ambiguous|multiple IDs/,
                'mixed-status duplicate id'
            );
            assertRejected(
                withBacklog(['- [x] [abc] checked']),
                'ABC',
                'replacement',
                /not pending/,
                'checked-only target'
            );
            assertRejected(
                seeded.replace('<!-- END_BACKLOG -->', '<!-- END_BACKLOG -->\n<!-- END_BACKLOG -->'),
                'bad id',
                'line1\nline2',
                /active_context.*invalid/,
                'invalid original structure must win before input validation'
            );
            assertRejected(seeded, 'abc', 'waiting <!-- END_BACKLOG -->', /active_context.*invalid/, 'BACKLOG anchor injection');
            assertRejected(seeded, 'abc', 'waiting <!-- BEGIN_META -->', /active_context.*invalid/, 'cross-section anchor injection');
            console.log('✅ 2e context edit service contract passed');
        }

        console.log('PS1. Testing pr-state expected-block primitives ...');
        {
            const servicePath = path.join(TEMPLATE_CLI_DIR, 'pr-state.service.js');
            delete require.cache[require.resolve(servicePath)];
            const {
                PrStateError,
                validatePrNumber,
                parseExpectedBlock,
                normalizePhase,
                normalizeChecks,
                compareExpectedObserved,
                createReport,
            } = require(servicePath);

            const SHA_A = '0123456789abcdef0123456789abcdef01234567';
            const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';
            const BEGIN_MARKER = '<!-- EVO-LITE:PR-STATE:BEGIN -->';
            const END_MARKER = '<!-- EVO-LITE:PR-STATE:END -->';
            const block = (overrides = {}, eol = '\n') => {
                const values = {
                    schema: '1', base: 'main', baseSha: SHA_A,
                    head: 'codex/feature', headSha: SHA_B,
                    commits: '3', changedFiles: '4', phase: 'draft', checks: 'success',
                    ...overrides,
                };
                return [
                    'narrative before', BEGIN_MARKER,
                    `schema: ${values.schema}`, `base: ${values.base}`, `baseSha: ${values.baseSha}`,
                    `head: ${values.head}`, `headSha: ${values.headSha}`,
                    `commits: ${values.commits}`, `changedFiles: ${values.changedFiles}`,
                    `phase: ${values.phase}`, `checks: ${values.checks}`,
                    END_MARKER, 'narrative after',
                ].join(eol);
            };
            const parse = body => parseExpectedBlock(body, { checkRefName: () => true });
            const expectedParsed = {
                schema: 1, base: 'main', baseSha: SHA_A,
                head: 'codex/feature', headSha: SHA_B,
                commits: 3, changedFiles: 4, phase: 'draft', checks: 'success',
            };

            assert.deepStrictEqual(parse(block()), expectedParsed);
            assert.deepStrictEqual(parse(block({}, '\r\n')), expectedParsed, 'CRLF must parse identically');
            assert.strictEqual(validatePrNumber('31'), 31);
            for (const raw of ['', '0', '03', '+3', '-1', '3.0', '3e2', '9007199254740992']) {
                assert.throws(
                    () => validatePrNumber(raw),
                    error => error instanceof PrStateError && error.code === 'PR_NUMBER_INVALID',
                    `invalid PR number ${raw}`
                );
            }

            assert.strictEqual(normalizePhase({ state: 'open', draft: true, merged: false, merged_at: null }), 'draft');
            assert.strictEqual(normalizePhase({ state: 'open', draft: false, merged: false, merged_at: null }), 'ready');
            assert.strictEqual(
                normalizePhase({ state: 'closed', draft: false, merged: true, merged_at: '2026-08-08T00:00:00Z' }),
                'merged'
            );
            assert.strictEqual(
                normalizePhase({ state: 'closed', draft: true, merged: true, merged_at: '2026-08-08T00:00:00Z' }),
                'merged',
                'CLOSED merged phase must not depend on the draft flag'
            );
            assert.strictEqual(normalizePhase({ state: 'closed', draft: false, merged: false, merged_at: null }), 'closed');
            assert.strictEqual(
                normalizePhase({ state: 'closed', draft: true, merged: false, merged_at: null }),
                'closed',
                'CLOSED unmerged phase must not depend on the draft flag'
            );
            assert.throws(
                () => normalizePhase({ state: 'open', draft: false, merged: true, merged_at: null }),
                error => error instanceof PrStateError && error.code === 'OBSERVED_PHASE_INVALID'
            );

            assert.strictEqual(normalizeChecks({ status: 'queued', conclusion: null }), 'pending');
            assert.strictEqual(normalizeChecks({ status: 'in_progress', conclusion: null }), 'pending');
            assert.strictEqual(normalizeChecks({ status: 'completed', conclusion: 'success' }), 'success');
            assert.strictEqual(normalizeChecks({ status: 'completed', conclusion: 'failure' }), 'failed');
            assert.throws(
                () => normalizeChecks({ status: 'completed', conclusion: null }),
                error => error instanceof PrStateError && error.code === 'WORKFLOW_RUN_RESPONSE_INVALID'
            );

            const expected = parse(block());
            const coreCases = [
                ['base', 'Main', 'BASE_REF_DRIFT'],
                ['baseSha', SHA_B, 'BASE_SHA_DRIFT'],
                ['head', 'Codex/feature', 'HEAD_REF_DRIFT'],
                ['headSha', SHA_A, 'HEAD_SHA_DRIFT'],
                ['commits', 4, 'COMMIT_COUNT_DRIFT'],
                ['changedFiles', 5, 'CHANGED_FILE_COUNT_DRIFT'],
                ['phase', 'ready', 'PHASE_DRIFT'],
            ];
            for (const [field, value, code] of coreCases) {
                assert.deepStrictEqual(
                    compareExpectedObserved(expected, { ...expected, [field]: value }).map(item => item.code),
                    [code], field
                );
            }
            const closedPhase = normalizePhase({ state: 'closed', draft: true, merged: false, merged_at: null });
            assert.deepStrictEqual(
                compareExpectedObserved(expected, { ...expected, phase: closedPhase }).map(item => item.code),
                ['PHASE_DRIFT']
            );
            const allCoreDrift = {
                ...expected,
                base: 'Main', baseSha: SHA_B,
                head: 'Codex/feature', headSha: SHA_A,
                commits: 4, changedFiles: 5, phase: 'ready',
            };
            assert.deepStrictEqual(
                compareExpectedObserved(expected, allCoreDrift).map(item => item.code),
                [
                    'BASE_REF_DRIFT', 'BASE_SHA_DRIFT', 'HEAD_REF_DRIFT', 'HEAD_SHA_DRIFT',
                    'COMMIT_COUNT_DRIFT', 'CHANGED_FILE_COUNT_DRIFT', 'PHASE_DRIFT',
                ]
            );

            const checksCases = [
                ['success', 'pending', ['CHECKS_PENDING']],
                ['pending', 'failed', ['CHECKS_FAILED']],
                ['success', 'failed', ['CHECKS_FAILED']],
                ['pending', 'success', ['CHECKS_EXPECTATION_DRIFT']],
                ['pending', 'pending', []],
                ['success', 'success', []],
                ['success', 'missing', ['CHECKS_MISSING']],
            ];
            for (const [expectedChecks, observedChecks, codes] of checksCases) {
                const wanted = { ...expected, checks: expectedChecks };
                const actual = { ...wanted, checks: observedChecks };
                assert.deepStrictEqual(
                    compareExpectedObserved(wanted, actual).map(item => item.code),
                    codes, `${expectedChecks}/${observedChecks}`
                );
            }
            assert.deepStrictEqual(
                Object.keys(createReport()),
                ['schema', 'result', 'pr', 'expected', 'observed', 'findings', 'errors']
            );

            const reversed = block()
                .replace(BEGIN_MARKER, '__BEGIN__')
                .replace(END_MARKER, BEGIN_MARKER)
                .replace('__BEGIN__', END_MARKER);
            const markerLikeProse = block().replace(
                'narrative before',
                `narrative ${BEGIN_MARKER} remains opaque`
            );
            assert.deepStrictEqual(parse(markerLikeProse), expectedParsed);
            const rejectedBodies = [
                ['missing BEGIN', block().replace(`${BEGIN_MARKER}\n`, '')],
                ['missing END', block().replace(`\n${END_MARKER}`, '')],
                ['duplicate BEGIN', block() + `\n${BEGIN_MARKER}`],
                ['duplicate END', block() + `\n${END_MARKER}`],
                ['reversed markers', reversed],
                ['leading marker whitespace', block().replace(BEGIN_MARKER, ` ${BEGIN_MARKER}`)],
                ['trailing marker whitespace', block().replace(END_MARKER, `${END_MARKER} `)],
                ['unknown key', block().replace('checks: success', 'extra: value\nchecks: success')],
                ['duplicate key', block().replace('checks: success', 'head: other\nchecks: success')],
                ['missing key', block().replace('commits: 3\n', '')],
                ['reordered key', block().replace('commits: 3\nchangedFiles: 4', 'changedFiles: 4\ncommits: 3')],
                ['malformed delimiter', block().replace('base: main', 'base:main')],
                ['blank line', block().replace('head: codex/feature', 'head: codex/feature\n')],
                ['tab', block().replace('base: main', 'base:\tmain')],
                ['comment line', block().replace('checks: success', '# comment\nchecks: success')],
                ['quoted scalar', block().replace('base: main', 'base: "main"')],
                ['generic extra content', block().replace('checks: success', 'unstructured extra content\nchecks: success')],
                ['abbreviated SHA', block({ headSha: 'abc1234' })],
                ['uppercase SHA', block({ headSha: SHA_B.toUpperCase() })],
                ['commits overflow', block({ commits: '2147483648' })],
                ['changedFiles overflow', block({ changedFiles: '2147483648' })],
                ['invalid expected checks', block({ checks: 'failed' })],
                ['merged pending', block({ phase: 'merged', checks: 'pending' })],
            ];
            for (const field of ['commits', 'changedFiles']) {
                for (const raw of ['03', '+3', '-1', '3.0', '3e2']) {
                    rejectedBodies.push([`${field} noncanonical ${raw}`, block({ [field]: raw })]);
                }
            }
            for (const [label, body] of rejectedBodies) {
                assert.throws(() => parse(body), error => error instanceof PrStateError, label);
            }

            for (const [commits, changedFiles] of [['1', '0'], ['2147483647', '2147483647']]) {
                const parsed = parse(block({ commits, changedFiles }));
                assert.strictEqual(parsed.commits, Number(commits));
                assert.strictEqual(parsed.changedFiles, Number(changedFiles));
            }
            for (const [phase, checks] of [
                ['draft', 'pending'], ['draft', 'success'],
                ['ready', 'pending'], ['ready', 'success'],
                ['merged', 'success'],
            ]) {
                const parsed = parse(block({ phase, checks }));
                assert.strictEqual(parsed.phase, phase);
                assert.strictEqual(parsed.checks, checks);
            }

            const refCalls = [];
            parseExpectedBlock(block(), {
                checkRefName(value) {
                    refCalls.push(value);
                    return true;
                },
            });
            assert.deepStrictEqual(refCalls, ['main', 'codex/feature']);
            assert.throws(
                () => parseExpectedBlock(block({ head: 'bad ref' }), {
                    checkRefName: value => value !== 'bad ref',
                }),
                error => error instanceof PrStateError && error.code === 'PR_STATE_REF_INVALID'
            );
            assert.throws(
                () => parseExpectedBlock(block({ base: 'bad ref', commits: '03' }), {
                    checkRefName: value => value !== 'bad ref',
                }),
                error => error instanceof PrStateError && error.code === 'PR_STATE_BLOCK_INVALID',
                'scalar validation must precede ref validation'
            );
            assert.throws(
                () => parseExpectedBlock(block({ base: 'bad ref', phase: 'merged', checks: 'pending' }), {
                    checkRefName: value => value !== 'bad ref',
                }),
                error => error instanceof PrStateError && error.code === 'PR_STATE_REF_INVALID',
                'ref validation must precede cross-field semantic validation'
            );
            console.log('✅ PS1 pr-state expected-block primitives passed');
        }

        console.log('PS2. Testing pr-state read-only acquisition ...');
        {
            const servicePath = path.join(TEMPLATE_CLI_DIR, 'pr-state.service.js');
            delete require.cache[require.resolve(servicePath)];
            const service = require(servicePath);
            const SHA_BASE = '1111111111111111111111111111111111111111';
            const SHA_HEAD = '2222222222222222222222222222222222222222';
            const SHA_STALE = '3333333333333333333333333333333333333333';
            const WORKFLOW_PATH = '.github/workflows/release-gate.yml';

            const expectedBody = (overrides = {}) => {
                const values = {
                    schema: '1', base: 'main', baseSha: SHA_BASE,
                    head: 'codex/feature', headSha: SHA_HEAD,
                    commits: '3', changedFiles: '4', phase: 'draft', checks: 'success',
                    ...overrides,
                };
                return [
                    '<!-- EVO-LITE:PR-STATE:BEGIN -->',
                    `schema: ${values.schema}`, `base: ${values.base}`, `baseSha: ${values.baseSha}`,
                    `head: ${values.head}`, `headSha: ${values.headSha}`,
                    `commits: ${values.commits}`, `changedFiles: ${values.changedFiles}`,
                    `phase: ${values.phase}`, `checks: ${values.checks}`,
                    '<!-- EVO-LITE:PR-STATE:END -->',
                ].join('\n');
            };
            const makePr = (overrides = {}) => ({
                number: 31,
                html_url: 'https://github.com/uwence/create-evo-lite/pull/31',
                body: expectedBody(),
                state: 'open',
                draft: true,
                merged: false,
                merged_at: null,
                base: { ref: 'main', sha: SHA_BASE },
                head: { ref: 'codex/feature', sha: SHA_HEAD },
                commits: 3,
                changed_files: 4,
                mergeable: true,
                ...overrides,
            });
            const makeRun = (id, status, conclusion, overrides = {}) => ({
                id,
                event: 'pull_request',
                head_sha: SHA_HEAD,
                status,
                conclusion,
                pull_requests: [{ number: 31 }],
                html_url: `https://github.com/uwence/create-evo-lite/actions/runs/${id}`,
                created_at: '2026-08-08T00:00:00Z',
                updated_at: '2026-08-08T00:01:00Z',
                ...overrides,
            });
            const makeCheckRow = (runId, overrides = {}) => ({
                bucket: 'pass',
                event: 'pull_request',
                link: `https://github.com/uwence/create-evo-lite/actions/runs/${runId}/job/${runId + 1000}`,
                name: 'pack + consume on windows-latest / node 24',
                state: 'SUCCESS',
                workflow: 'release-gate',
                ...overrides,
            });
            const okJson = value => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
            const okText = value => ({ status: 0, stdout: value, stderr: '' });
            const failed = message => ({ status: 1, stdout: '', stderr: message });

            function runValidation(options = {}) {
                const calls = [];
                const pr = options.pr || makePr();
                const workflow = options.workflow || { id: 77, path: WORKFLOW_PATH, name: 'release-gate' };
                const pages = options.pages || [{
                    total_count: 1,
                    workflow_runs: [makeRun(100, 'completed', 'success')],
                }];
                const checkRows = options.checkRows || [makeCheckRow(100)];
                const checkStatus = options.checkStatus === undefined ? 0 : options.checkStatus;
                const expectedRepositoryArg = options.expectedRepositoryArg
                    || 'github.com/uwence/create-evo-lite';
                const handlers = options.handlers || {};
                const runCommand = (executable, args) => {
                    calls.push({ executable, args: [...args] });
                    const use = (name, fallback) => handlers[name]
                        ? handlers[name]({ executable, args: [...args], calls })
                        : fallback;
                    if (executable === 'git' && args.join(' ') === 'rev-parse --show-toplevel') {
                        return use('gitRoot', okText('C:/tmp/repo\n'));
                    }
                    if (executable === 'git' && args.join(' ') === 'symbolic-ref --quiet --short HEAD') {
                        return use('symbolicRef', okText('codex/feature\n'));
                    }
                    if (executable === 'git' && args[0] === 'check-ref-format') {
                        return use('checkRef', okText(`${args[2]}\n`));
                    }
                    if (executable === 'gh' && args.join(' ') === 'repo view --json nameWithOwner') {
                        return use('repository', okJson({ nameWithOwner: 'uwence/create-evo-lite' }));
                    }
                    if (executable === 'gh' && args[0] === 'pr' && args[1] === 'view') {
                        return use('prResolution', okJson({ number: 31 }));
                    }
                    if (executable === 'gh' && args[0] === 'api' && args.includes('repos/uwence/create-evo-lite/pulls/31')) {
                        return use('prQuery', okJson(pr));
                    }
                    if (executable === 'gh' && args[0] === 'api' && args.includes(`repos/uwence/create-evo-lite/actions/workflows/release-gate.yml`)) {
                        return use('workflow', okJson(workflow));
                    }
                    if (executable === 'gh' && args[0] === 'api' && args.includes('repos/uwence/create-evo-lite/actions/workflows/77/runs')) {
                        const pageArg = args.find(value => /^page=/.test(value));
                        const page = Number(pageArg.split('=')[1]);
                        return use('runs', okJson(pages[page - 1] || { total_count: 0, workflow_runs: [] }));
                    }
                    if (executable === 'gh' && args[0] === 'pr' && args[1] === 'checks') {
                        assert.deepStrictEqual(args, [
                            'pr', 'checks', '31',
                            '--repo', expectedRepositoryArg,
                            '--json', 'bucket,event,link,name,state,workflow',
                        ]);
                        return use('prChecks', {
                            status: checkStatus,
                            stdout: JSON.stringify(checkRows),
                            stderr: '',
                        });
                    }
                    throw new Error(`unexpected command: ${executable} ${args.join(' ')}`);
                };
                const report = service.validatePrState(options.prArg === undefined ? '31' : options.prArg, {
                    cwd: 'C:/tmp/repo',
                    runCommand,
                });
                return { report, calls };
            }

            const pass = runValidation();
            assert.strictEqual(pass.report.result, 'pass');
            assert.deepStrictEqual(pass.report.findings, []);
            assert.deepStrictEqual(pass.report.errors, []);
            assert.ok(pass.calls.every(call => ['git', 'gh'].includes(call.executable)));
            assert.ok(pass.calls.every(call => !/\b(edit|ready|merge|POST|PATCH|PUT|DELETE)\b/.test(call.args.join(' '))));

            const omitted = runValidation({ prArg: null });
            assert.strictEqual(omitted.report.result, 'pass');
            assert.ok(omitted.calls.some(call => call.executable === 'git' && call.args[0] === 'symbolic-ref'));
            assert.ok(omitted.calls.some(call => call.executable === 'gh' && call.args.slice(0, 3).join(' ') === 'pr view codex/feature'));
            assert.ok(!omitted.calls.some(call => call.executable === 'gh' && call.args[0] === 'pr' && call.args[1] === 'list'));

            for (const [label, handler] of [
                ['detached', () => failed('detached HEAD')],
                ['no PR', () => failed('no pull requests found')],
                ['ambiguous', () => okJson([{ number: 31 }, { number: 32 }])],
            ]) {
                const handlers = label === 'detached'
                    ? { symbolicRef: handler }
                    : { prResolution: handler };
                const result = runValidation({ prArg: null, handlers });
                assert.strictEqual(result.report.result, 'error', label);
                assert.ok(result.report.errors.some(error => error.code === 'PR_RESOLUTION_FAILED'), label);
            }

            const stale = runValidation({ pr: makePr({ body: expectedBody({ headSha: SHA_STALE }) }) });
            assert.strictEqual(stale.report.result, 'drift');
            assert.ok(stale.report.findings.some(item => item.code === 'HEAD_SHA_DRIFT'));
            const staleRunCalls = stale.calls.filter(call => call.args.some(value => /actions\/workflows\/77\/runs/.test(value)));
            assert.ok(staleRunCalls.every(call => call.args.includes(`head_sha=${SHA_HEAD}`)));
            assert.ok(staleRunCalls.every(call => !call.args.includes(`head_sha=${SHA_STALE}`)));

            const identityFiltered = runValidation({
                pages: [{
                    total_count: 4,
                    workflow_runs: [
                        makeRun(120, 'completed', 'success', { pull_requests: [{ number: 99 }] }),
                        makeRun(121, 'completed', 'success', { event: 'push' }),
                        makeRun(122, 'completed', 'success', { head_sha: SHA_STALE }),
                        makeRun(123, 'completed', 'success'),
                    ],
                }],
                checkRows: [120, 121, 122, 123].map(id => makeCheckRow(id)),
            });
            assert.strictEqual(identityFiltered.report.result, 'pass');
            assert.strictEqual(identityFiltered.report.observed.diagnostics.runId, 123);

            const sameTimestamp = '2026-08-08T00:00:00Z';
            const newerPending = runValidation({
                pages: [{
                    total_count: 2,
                    workflow_runs: [
                        makeRun(200, 'completed', 'success', { created_at: sameTimestamp, updated_at: sameTimestamp }),
                        makeRun(201, 'in_progress', null, { created_at: sameTimestamp, updated_at: sameTimestamp }),
                    ],
                }],
                checkRows: [makeCheckRow(200), makeCheckRow(201)],
            });
            assert.strictEqual(newerPending.report.result, 'drift');
            assert.deepStrictEqual(newerPending.report.findings.map(item => item.code), ['CHECKS_PENDING']);
            assert.strictEqual(newerPending.report.observed.diagnostics.runId, 201);

            const newerFailed = runValidation({
                pages: [{
                    total_count: 2,
                    workflow_runs: [
                        makeRun(301, 'completed', 'failure'),
                        makeRun(300, 'completed', 'success'),
                    ],
                }],
                checkRows: [makeCheckRow(300), makeCheckRow(301)],
            });
            assert.deepStrictEqual(newerFailed.report.findings.map(item => item.code), ['CHECKS_FAILED']);
            assert.strictEqual(newerFailed.report.observed.diagnostics.runId, 301);

            const firstPage = Array.from({ length: 100 }, (_, index) =>
                makeRun(400 + index, 'completed', 'success', { pull_requests: [{ number: 99 }] })
            );
            const paginated = runValidation({
                pages: [
                    { total_count: 101, workflow_runs: firstPage },
                    { total_count: 101, workflow_runs: [makeRun(999, 'completed', 'success')] },
                ],
                checkRows: [makeCheckRow(999)],
            });
            assert.strictEqual(paginated.report.result, 'pass');
            assert.strictEqual(paginated.report.observed.diagnostics.runId, 999);
            assert.strictEqual(
                paginated.calls.filter(call => call.args.some(value => /actions\/workflows\/77\/runs/.test(value))).length,
                2
            );
            const pageCallIndices = paginated.calls
                .map((call, index) => ({ call, index }))
                .filter(({ call }) => call.args.some(value => /actions\/workflows\/77\/runs/.test(value)))
                .map(({ index }) => index);
            const paginatedChecksIndex = paginated.calls.findIndex(
                call => call.args.slice(0, 2).join(' ') === 'pr checks'
            );
            assert.ok(pageCallIndices.every(index => index < paginatedChecksIndex));

            const missing = runValidation({
                pages: [{ total_count: 1, workflow_runs: [makeRun(500, 'completed', 'success', { event: 'push' })] }],
            });
            assert.strictEqual(missing.report.result, 'drift');
            assert.deepStrictEqual(missing.report.findings.map(item => item.code), ['CHECKS_MISSING']);

            const omittedRun = makeRun(100, 'completed', 'success');
            delete omittedRun.pull_requests;
            const omittedPullRequests = runValidation({
                pages: [{ total_count: 1, workflow_runs: [omittedRun] }],
            });
            assert.strictEqual(omittedPullRequests.report.result, 'pass');

            for (const pullRequests of [[], [{ number: 99 }], 'ignored-shape']) {
                const ignored = runValidation({
                    pages: [{
                        total_count: 1,
                        workflow_runs: [
                            makeRun(100, 'completed', 'success', { pull_requests: pullRequests }),
                        ],
                    }],
                });
                assert.strictEqual(ignored.report.result, 'pass', JSON.stringify(pullRequests));
            }

            const zeroCandidates = runValidation({
                pages: [{ total_count: 0, workflow_runs: [] }],
                handlers: { prChecks: () => { throw new Error('must not run'); } },
            });
            assert.deepStrictEqual(
                zeroCandidates.report.findings.map(item => item.code),
                ['CHECKS_MISSING']
            );
            assert.ok(!zeroCandidates.calls.some(
                call => call.args.slice(0, 2).join(' ') === 'pr checks'
            ));

            const exitOne = runValidation({ checkStatus: 1 });
            assert.strictEqual(exitOne.report.result, 'error');
            assert.ok(exitOne.report.errors.some(error => error.code === 'PR_CHECKS_QUERY_FAILED'));

            const exitEight = runValidation({ checkStatus: 8 });
            assert.strictEqual(exitEight.report.result, 'pass');

            for (const status of [2, 4, 9]) {
                const invalidExit = runValidation({ checkStatus: status });
                assert.strictEqual(invalidExit.report.result, 'error', String(status));
                assert.ok(invalidExit.report.errors.some(
                    error => error.code === 'PR_CHECKS_QUERY_FAILED'
                ), String(status));
            }

            for (const status of [0, 8]) {
                const malformedChecksJson = runValidation({
                    handlers: {
                        prChecks: () => ({ status, stdout: '{bad', stderr: '' }),
                    },
                });
                assert.strictEqual(malformedChecksJson.report.result, 'error', String(status));
                assert.ok(malformedChecksJson.report.errors.some(
                    error => error.code === 'PR_CHECKS_QUERY_FAILED'
                ), String(status));
            }

            const malformedCheckRow = runValidation({
                checkRows: [{ ...makeCheckRow(100), link: 1 }],
            });
            assert.strictEqual(malformedCheckRow.report.result, 'error');
            assert.ok(malformedCheckRow.report.errors.some(
                error => error.code === 'PR_CHECKS_RESPONSE_INVALID'
            ));

            const invalidBlockAndUrl = runValidation({
                pr: makePr({ body: 'not a state block', html_url: 'not a URL' }),
            });
            assert.deepStrictEqual(
                invalidBlockAndUrl.report.errors.map(error => error.code),
                ['PR_STATE_BLOCK_INVALID']
            );

            const invalidLifecycleAndUrl = runValidation({
                pr: makePr({
                    state: 'open', draft: false, merged: true,
                    merged_at: '2026-08-08T00:00:00Z',
                    html_url: 'not a URL',
                }),
            });
            assert.deepStrictEqual(
                invalidLifecycleAndUrl.report.errors.map(error => error.code),
                ['OBSERVED_PHASE_INVALID']
            );

            const coreDriftAndInvalidUrl = runValidation({
                pr: makePr({
                    body: expectedBody({ headSha: SHA_STALE }),
                    html_url: 'not a URL',
                }),
            });
            assert.strictEqual(coreDriftAndInvalidUrl.report.result, 'error');
            assert.deepStrictEqual(
                coreDriftAndInvalidUrl.report.findings.map(item => item.code),
                ['HEAD_SHA_DRIFT']
            );
            assert.deepStrictEqual(
                coreDriftAndInvalidUrl.report.errors.map(error => error.code),
                ['PR_RESPONSE_INVALID']
            );

            for (const html_url of [
                'not a URL',
                'http://github.com/uwence/create-evo-lite/pull/31',
                'https://user@github.com/uwence/create-evo-lite/pull/31',
                'https://github.com/other/create-evo-lite/pull/31',
                'https://github.com/uwence/create-evo-lite/pull/32',
                'https://github.com/uwence/create-evo-lite/pull/31?x=1',
                'https://github.com/uwence/create-evo-lite/pull/31#x',
            ]) {
                const invalid = runValidation({ pr: makePr({ html_url }) });
                assert.strictEqual(invalid.report.result, 'error', html_url);
                assert.ok(invalid.report.errors.some(
                    error => error.code === 'PR_RESPONSE_INVALID'
                ), html_url);
            }

            for (const link of [
                'https://github.com/uwence/create-evo-lite/actions/runs/100',
                'https://github.com/uwence/create-evo-lite/actions/runs/100/job/1100',
            ]) {
                const accepted = runValidation({
                    checkRows: [makeCheckRow(100, { link })],
                });
                assert.strictEqual(accepted.report.result, 'pass', link);
                assert.strictEqual(accepted.report.observed.diagnostics.runId, 100, link);
            }

            const customPort = runValidation({
                pr: makePr({
                    html_url: 'https://ghe.example.com:8443/uwence/create-evo-lite/pull/31',
                }),
                checkRows: [makeCheckRow(100, {
                    link: 'https://ghe.example.com:8443/uwence/create-evo-lite/actions/runs/100',
                })],
                expectedRepositoryArg: 'ghe.example.com:8443/uwence/create-evo-lite',
            });
            assert.strictEqual(customPort.report.result, 'pass');
            assert.strictEqual(customPort.report.observed.diagnostics.runId, 100);

            const wrongCustomPort = runValidation({
                pr: makePr({
                    html_url: 'https://ghe.example.com:8443/uwence/create-evo-lite/pull/31',
                }),
                checkRows: [makeCheckRow(100, {
                    link: 'https://ghe.example.com:9443/uwence/create-evo-lite/actions/runs/100',
                })],
                expectedRepositoryArg: 'ghe.example.com:8443/uwence/create-evo-lite',
            });
            assert.deepStrictEqual(
                wrongCustomPort.report.findings.map(item => item.code),
                ['CHECKS_MISSING']
            );

            for (const link of [
                'not a URL',
                'https://example.com/uwence/create-evo-lite/actions/runs/100/job/1100',
                'https://github.com/uwence/other/actions/runs/100/job/1100',
                'https://github.com/uwence/create-evo-lite/actions/runs/100?x=1',
                'https://github.com/uwence/create-evo-lite/actions/runs/100#x',
                'https://github.com/uwence/create-evo-lite/actions/runs/0100',
                'https://github.com/uwence/create-evo-lite/actions/runs/100/job/01100',
                'https://github.com/uwence/create-evo-lite/actions/runs/9007199254740992',
            ]) {
                const ignored = runValidation({
                    checkRows: [makeCheckRow(100, { link })],
                });
                assert.deepStrictEqual(
                    ignored.report.findings.map(item => item.code),
                    ['CHECKS_MISSING'],
                    link
                );
            }

            const sameHeadUnassociated = runValidation({
                pages: [{ total_count: 2, workflow_runs: [
                    makeRun(100, 'completed', 'success'),
                    makeRun(101, 'completed', 'failure'),
                ] }],
                checkRows: [makeCheckRow(100), makeCheckRow(100)],
            });
            assert.strictEqual(sameHeadUnassociated.report.result, 'pass');
            assert.strictEqual(sameHeadUnassociated.report.observed.diagnostics.runId, 100);

            const rowCannotHideFailure = runValidation({
                pages: [{ total_count: 1, workflow_runs: [
                    makeRun(100, 'completed', 'failure'),
                ] }],
                checkRows: [makeCheckRow(100, {
                    bucket: 'pass',
                    state: 'SUCCESS',
                    event: 'push',
                    workflow: 'other-name',
                })],
            });
            assert.deepStrictEqual(
                rowCannotHideFailure.report.findings.map(item => item.code),
                ['CHECKS_FAILED']
            );

            const mergedPr = overrides => makePr({
                state: 'closed',
                draft: false,
                merged: true,
                merged_at: '2026-08-08T16:37:22Z',
                ...overrides,
            });
            const mergedRun = makeRun(100, 'completed', 'success');
            delete mergedRun.pull_requests;
            const mergedReady = runValidation({
                pr: mergedPr({ body: expectedBody({ phase: 'ready' }) }),
                pages: [{ total_count: 1, workflow_runs: [mergedRun] }],
            });
            assert.deepStrictEqual(
                mergedReady.report.findings.map(item => item.code),
                ['PHASE_DRIFT']
            );
            assert.strictEqual(mergedReady.report.observed.checks, 'success');

            const mergedPass = runValidation({
                pr: mergedPr({ body: expectedBody({ phase: 'merged' }) }),
                pages: [{ total_count: 1, workflow_runs: [mergedRun] }],
            });
            assert.strictEqual(mergedPass.report.result, 'pass');

            const badWorkflow = runValidation({ workflow: { id: 77, path: '.github/workflows/other.yml' } });
            assert.strictEqual(badWorkflow.report.result, 'error');
            assert.ok(badWorkflow.report.errors.some(error => error.code === 'WORKFLOW_IDENTITY_INVALID'));

            const prFailure = runValidation({ handlers: { prQuery: () => failed('HTTP 403') } });
            assert.strictEqual(prFailure.report.result, 'error');
            assert.ok(prFailure.report.errors.some(error => error.code === 'PR_QUERY_FAILED'));
            assert.ok(!prFailure.report.findings.some(item => item.code === 'CHECKS_MISSING'));

            const lateFailure = runValidation({
                pr: makePr({ body: expectedBody({ headSha: SHA_STALE }) }),
                handlers: { runs: () => failed('network timeout') },
            });
            assert.strictEqual(lateFailure.report.result, 'error');
            assert.ok(lateFailure.report.findings.some(item => item.code === 'HEAD_SHA_DRIFT'));
            assert.ok(lateFailure.report.errors.some(error => error.code === 'WORKFLOW_RUN_QUERY_FAILED'));
            assert.ok(!lateFailure.report.findings.some(item => item.code === 'CHECKS_MISSING'));

            for (const status of ['requested', 'queued', 'waiting', 'pending', 'in_progress']) {
                assert.strictEqual(service.normalizeChecks({ status, conclusion: null }), 'pending', status);
            }
           console.log('✅ PS2 pr-state read-only acquisition passed');
       }

        console.log('PS3. Testing pr-state CLI registration and rendering ...');
        {
            const modulePath = path.join(TEMPLATE_CLI_DIR, 'pr-state.js');
            delete require.cache[require.resolve(modulePath)];
            const { Command } = require('commander');
            const {
                registerPrStateCommands,
                resultExitCode,
                renderText,
            } = require(modulePath);
            const envelope = (result, overrides = {}) => ({
                schema: 1,
                result,
                pr: { repository: 'uwence/create-evo-lite', number: 31 },
                expected: {},
                observed: {},
                findings: [],
                errors: [],
                ...overrides,
            });
            const cases = [
                [envelope('pass'), 0],
                [envelope('drift', {
                    findings: [{
                        code: 'HEAD_SHA_DRIFT', field: 'headSha',
                        expected: 'a', observed: 'b',
                    }],
                }), 1],
                [envelope('error', {
                    errors: [{ code: 'PR_QUERY_FAILED', message: 'query failed' }],
                }), 2],
            ];

            assert.strictEqual(resultExitCode('pass'), 0);
            assert.strictEqual(resultExitCode('drift'), 1);
            assert.strictEqual(resultExitCode('error'), 2);
            assert.match(renderText(cases[1][0]), /HEAD_SHA_DRIFT/);
            assert.match(renderText(cases[2][0]), /PR_QUERY_FAILED/);

            for (const [report, expectedExit] of cases) {
                const program = new Command();
                program.name('memory').exitOverride();
                registerPrStateCommands(program, { validatePrState: () => report });
                const output = [];
                const originalLog = console.log;
                const originalExitCode = process.exitCode;
                try {
                    console.log = value => output.push(String(value));
                    process.exitCode = undefined;
                    await program.parseAsync(
                        ['node', 'memory.js', 'pr-state', 'validate', '31', '--json'],
                        { from: 'node' }
                    );
                    assert.strictEqual(process.exitCode || 0, expectedExit);
                    assert.deepStrictEqual(JSON.parse(output.join('\n')), report);
                } finally {
                    console.log = originalLog;
                    process.exitCode = originalExitCode;
                }
            }

            const observationReport = envelope('pass', {
                expected: {
                    base: 'main',
                    head: 'codex/pr-state',
                    phase: 'draft',
                    checks: 'success',
                    secret: 'must-not-cross-boundary',
                },
                observed: {
                    base: 'main',
                    head: 'codex/pr-state',
                    phase: 'draft',
                    checks: 'success',
                    diagnostics: { runId: 31295610538 },
                    body: 'raw-pr-body-must-not-cross-boundary',
                    reviews: [{ body: 'raw-review-must-not-cross-boundary' }],
                },
            });
            const observations = [];
            {
                const program = new Command();
                program.name('memory').exitOverride();
                registerPrStateCommands(program, {
                    cwd: () => 'C:/safe-workspace',
                    validatePrState: () => observationReport,
                    recordGovernanceSnapshot: (root, options) => {
                        observations.push({ root, options });
                        return { snapshot: {}, write: { ok: true } };
                    },
                });
                const originalLog = console.log;
                const originalExitCode = process.exitCode;
                try {
                    console.log = () => {};
                    process.exitCode = undefined;
                    await program.parseAsync(
                        ['node', 'memory.js', 'pr-state', 'validate', '31', '--json'],
                        { from: 'node' }
                    );
                    assert.strictEqual(process.exitCode || 0, 0);
                } finally {
                    console.log = originalLog;
                    process.exitCode = originalExitCode;
                }
            }
            assert.deepStrictEqual(observations, [{
                root: 'C:/safe-workspace',
                options: {
                    prState: {
                        number: 31,
                        base: 'main',
                        head: 'codex/pr-state',
                        phase: 'draft',
                        checks: 'success',
                        runId: 31295610538,
                        result: 'pass',
                    },
                },
            }], 'pr-state observation passes only normalized allowlisted fields');
            assert.doesNotMatch(JSON.stringify(observations), /must-not-cross-boundary|raw-pr-body|raw-review/);

            {
                const program = new Command();
                program.name('memory').exitOverride();
                registerPrStateCommands(program, {
                    validatePrState: () => cases[1][0],
                    recordGovernanceSnapshot: () => { throw new Error('snapshot writer unavailable'); },
                });
                const output = [];
                const originalLog = console.log;
                const originalWarn = console.warn;
                const originalExitCode = process.exitCode;
                try {
                    console.log = value => output.push(String(value));
                    console.warn = () => {};
                    process.exitCode = undefined;
                    await program.parseAsync(
                        ['node', 'memory.js', 'pr-state', 'validate', '31', '--json'],
                        { from: 'node' }
                    );
                    assert.strictEqual(process.exitCode, 1,
                        'snapshot failure must preserve the original pr-state drift exit');
                    assert.deepStrictEqual(JSON.parse(output.join('\n')), cases[1][0],
                        'snapshot failure must preserve the original pr-state result');
                } finally {
                    console.log = originalLog;
                    console.warn = originalWarn;
                    process.exitCode = originalExitCode;
                }
            }

            const cliPath = path.join(CLI_DIR, 'memory.js');
            const spawnCli = (args, input) => childProcess.spawnSync(
                process.execPath,
                [cliPath, ...args],
                {
                    cwd: WORKSPACE_ROOT,
                    env: {
                        ...process.env,
                        NODE_PATH: [
                            path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'),
                            process.env.NODE_PATH,
                        ].filter(Boolean).join(path.delimiter),
                    },
                    encoding: 'utf8',
                    input,
                }
            );
            const help = spawnCli(['pr-state', '--help']);
            assert.strictEqual(help.status, 0, help.stderr || help.stdout);
            assert.match(help.stdout, /validate \[options\] \[pr\]/);
            assert.doesNotMatch(help.stdout, /--repo|--file|--content/);

            for (const [label, args, input] of [
                ['nested alias', ['context', 'pr-state']],
                ['URL input', ['pr-state', 'validate', 'https://github.com/uwence/create-evo-lite/pull/31']],
                ['repo option', ['pr-state', 'validate', '31', '--repo', 'uwence/create-evo-lite']],
                ['file option', ['pr-state', 'validate', '31', '--file', 'state.md']],
                ['extra argument', ['pr-state', 'validate', '31', 'extra']],
                ['stdin body', ['pr-state', 'validate', 'bad id'], 'schema: 1\n'],
            ]) {
                const rejected = spawnCli(args, input);
                assert.notStrictEqual(rejected.status, 0, `${label} must be rejected`);
            }
           console.log('✅ PS3 pr-state CLI registration and rendering passed');
       }

        console.log('PS5. Testing pr-state fail-closed CLI acceptance ...');
        {
            const servicePath = path.join(TEMPLATE_CLI_DIR, 'pr-state.service.js');
            delete require.cache[require.resolve(servicePath)];
            const service = require(servicePath);
            const SHA_BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
            const SHA_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
            const SHA_STALE = 'cccccccccccccccccccccccccccccccccccccccc';
            const stateBody = (overrides = {}) => {
                const values = {
                    schema: '1', base: 'main', baseSha: SHA_BASE,
                    head: 'codex/pr-state', headSha: SHA_HEAD,
                    commits: '2', changedFiles: '8', phase: 'draft', checks: 'success',
                    ...overrides,
                };
                return [
                    '<!-- EVO-LITE:PR-STATE:BEGIN -->',
                    `schema: ${values.schema}`, `base: ${values.base}`, `baseSha: ${values.baseSha}`,
                    `head: ${values.head}`, `headSha: ${values.headSha}`,
                    `commits: ${values.commits}`, `changedFiles: ${values.changedFiles}`,
                    `phase: ${values.phase}`, `checks: ${values.checks}`,
                    '<!-- EVO-LITE:PR-STATE:END -->',
                ].join('\n');
            };
            const basePr = (overrides = {}) => ({
                number: 31,
                html_url: 'https://github.com/uwence/create-evo-lite/pull/31',
                body: stateBody(),
                state: 'open', draft: true, merged: false, merged_at: null,
                base: { ref: 'main', sha: SHA_BASE },
                head: { ref: 'codex/pr-state', sha: SHA_HEAD },
                commits: 2, changed_files: 8,
                ...overrides,
            });
            const baseRun = (overrides = {}) => ({
                id: 900,
                event: 'pull_request',
                head_sha: SHA_HEAD,
                status: 'completed',
                conclusion: 'success',
                pull_requests: [{ number: 31 }],
                html_url: 'https://github.com/run/900',
                created_at: '2026-08-08T00:00:00Z',
                updated_at: '2026-08-08T00:01:00Z',
                ...overrides,
            });
            const baseCheckRow = (overrides = {}) => ({
                bucket: 'pass',
                event: 'pull_request',
                link: 'https://github.com/uwence/create-evo-lite/actions/runs/900',
                name: 'release-gate',
                state: 'SUCCESS',
                workflow: 'release-gate',
                ...overrides,
            });
            const response = (value, status = 0, stderr = '') => ({
                status,
                stdout: typeof value === 'string' ? value : JSON.stringify(value),
                stderr,
            });
            function directValidate(options = {}) {
                const pr = options.pr || basePr();
                const workflow = options.workflow || {
                    id: 77,
                    path: '.github/workflows/release-gate.yml',
                };
                const pages = options.pages || [{ total_count: 1, workflow_runs: [baseRun()] }];
                const checkRows = options.checkRows || [baseCheckRow()];
                const checkStatus = options.checkStatus === undefined ? 0 : options.checkStatus;
                const handlers = options.handlers || {};
                const calls = [];
                const runCommand = (executable, args) => {
                    calls.push({ executable, args: [...args] });
                    const custom = (name, fallback) => handlers[name]
                        ? handlers[name]({ executable, args: [...args] })
                        : fallback;
                    if (executable === 'git' && args.join(' ') === 'rev-parse --show-toplevel') {
                        return custom('gitRoot', response('C:/tmp/repo\n'));
                    }
                    if (executable === 'git' && args[0] === 'check-ref-format') {
                        return custom('checkRef', response(`${args[2]}\n`));
                    }
                    if (executable === 'gh' && args.join(' ') === 'repo view --json nameWithOwner') {
                        return custom('repository', response({ nameWithOwner: 'uwence/create-evo-lite' }));
                    }
                    if (executable === 'gh' && args.includes('repos/uwence/create-evo-lite/pulls/31')) {
                        return custom('prQuery', response(pr));
                    }
                    if (executable === 'gh' && args.includes('repos/uwence/create-evo-lite/actions/workflows/release-gate.yml')) {
                        return custom('workflow', response(workflow));
                    }
                    if (executable === 'gh' && args.includes('repos/uwence/create-evo-lite/actions/workflows/77/runs')) {
                        const page = Number(args.find(value => /^page=/.test(value)).split('=')[1]);
                        return custom('runs', response(pages[page - 1] || { total_count: 0, workflow_runs: [] }));
                    }
                    if (executable === 'gh' && args[0] === 'pr' && args[1] === 'checks') {
                        return custom('checks', response(checkRows, checkStatus));
                    }
                    throw new Error(`unexpected command: ${executable} ${args.join(' ')}`);
                };
                return {
                    report: service.validatePrState('31', { cwd: 'C:/tmp/repo', runCommand }),
                    calls,
                };
            }

            assert.throws(
                () => service.normalizeChecks({ status: 'completed', conclusion: 'banana' }),
                error => error.code === 'WORKFLOW_RUN_RESPONSE_INVALID',
                'unknown completed conclusion must fail closed'
            );

            const missingGh = directValidate({
                handlers: {
                    repository: () => ({
                        status: null, stdout: '', stderr: '',
                        error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }),
                    }),
                },
            });
            assert.strictEqual(missingGh.report.result, 'error');
            assert.ok(missingGh.report.errors.some(error => error.code === 'GIT_REPOSITORY_REQUIRED'));

            for (const [label, handler] of [
                ['HTTP 401', () => response('', 1, 'HTTP 401 authentication required')],
                ['HTTP 403', () => response('', 1, 'HTTP 403 forbidden')],
                ['network throw', () => { throw new Error('network unavailable'); }],
                ['signal', () => ({ status: null, stdout: '', stderr: '', signal: 'SIGTERM' })],
                ['timeout', () => ({
                    status: null, stdout: '', stderr: '',
                    error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
                })],
            ]) {
                const result = directValidate({ handlers: { prQuery: handler } });
                assert.strictEqual(result.report.result, 'error', label);
                assert.ok(result.report.errors.some(error => error.code === 'PR_QUERY_FAILED'), label);
                assert.ok(!result.report.findings.some(item => item.code === 'CHECKS_MISSING'), label);
            }

            const malformedRepo = directValidate({
                handlers: { repository: () => response('{not-json') },
            });
            assert.ok(malformedRepo.report.errors.some(error => error.code === 'GIT_REPOSITORY_REQUIRED'));

            const malformedPr = directValidate({
                pr: basePr({ head: { ref: 'codex/pr-state' } }),
            });
            assert.ok(malformedPr.report.errors.some(error => error.code === 'PR_RESPONSE_INVALID'));

            const contradictory = directValidate({
                pr: basePr({ state: 'open', draft: false, merged: true, merged_at: '2026-08-08T00:00:00Z' }),
            });
            assert.ok(contradictory.report.errors.some(error => error.code === 'OBSERVED_PHASE_INVALID'));

            for (const workflow of [
                { id: '77', path: '.github/workflows/release-gate.yml' },
                { id: 77, path: '.github/workflows/other.yml' },
            ]) {
                const invalid = directValidate({ workflow });
                assert.ok(invalid.report.errors.some(error => error.code === 'WORKFLOW_IDENTITY_INVALID'));
            }

            for (const run of [
                baseRun({ status: 'mystery', conclusion: null }),
                baseRun({ status: 'completed', conclusion: null }),
                baseRun({ status: 'completed', conclusion: 'banana' }),
            ]) {
                const invalid = directValidate({ pages: [{ total_count: 1, workflow_runs: [run] }] });
                assert.ok(invalid.report.errors.some(error => error.code === 'WORKFLOW_RUN_RESPONSE_INVALID'));
            }

            const inconsistentPages = directValidate({
                pages: [
                    { total_count: 2, workflow_runs: [baseRun({ id: 901, pull_requests: [] })] },
                    { total_count: 3, workflow_runs: [baseRun({ id: 902 })] },
                ],
            });
            assert.ok(inconsistentPages.report.errors.some(error => error.code === 'WORKFLOW_RUN_RESPONSE_INVALID'));
            assert.ok(!inconsistentPages.report.findings.some(item => item.code === 'CHECKS_MISSING'));

            const retained = directValidate({
                pr: basePr({ body: stateBody({ headSha: SHA_STALE }) }),
                handlers: { runs: () => response('', 1, 'network failure') },
            });
            assert.strictEqual(retained.report.result, 'error');
            assert.ok(retained.report.findings.some(item => item.code === 'HEAD_SHA_DRIFT'));
            assert.ok(retained.report.errors.some(error => error.code === 'WORKFLOW_RUN_QUERY_FAILED'));

            const cleanupCalls = [];
            removePrStateRuntimeRoot('C:/tmp/pr-state-runtime', (root, options) => {
                cleanupCalls.push({ root, options });
            });
            assert.deepStrictEqual(cleanupCalls, [{
                root: 'C:/tmp/pr-state-runtime',
                options: {
                    recursive: true,
                    force: true,
                    maxRetries: 5,
                    retryDelay: 100,
                },
            }]);

            const cleanupFailure = new Error('persistent EPERM');
            assert.throws(
                () => removePrStateRuntimeRoot('C:/tmp/pr-state-runtime', () => { throw cleanupFailure; }),
                error => error === cleanupFailure
            );

            const runtime = createTempRuntimeRoot('pr-state-real-cli');
            const originalRmSync = fs.rmSync;
            const ps5CleanupOptions = [];
            fs.rmSync = (root, options) => {
                if (root === runtime.workspaceRoot) ps5CleanupOptions.push({ ...options });
                return originalRmSync(root, options);
            };
            const fakeBin = path.join(runtime.workspaceRoot, 'fake-gh-bin');
            const fixturePath = path.join(fakeBin, 'fixture.json');
            const callLogPath = path.join(fakeBin, 'calls.ndjson');
            try {
                copyRecursive(TEMPLATE_CLI_DIR, path.join(runtime.runtimeRoot, 'cli'));
                fs.mkdirSync(fakeBin, { recursive: true });
                const init = childProcess.spawnSync('git', ['init'], {
                    cwd: runtime.workspaceRoot, encoding: 'utf8', windowsHide: true,
                });
                assert.strictEqual(init.status, 0, init.stderr);

                const fakeScript = path.join(fakeBin, 'fake-gh.js');
                const fakeSource = [
                    "'use strict';",
                    "const fs = require('fs');",
                    "const path = require('path');",
                    "const isWindowsShim = path.basename(process.execPath).toLowerCase() === 'gh.exe';",
                    "if (process.platform === 'win32' && !isWindowsShim) return;",
                    "const args = isWindowsShim ? [path.basename(process.argv[1]), ...process.argv.slice(2)] : process.argv.slice(2);",
                    "fs.appendFileSync(process.env.PR_STATE_FAKE_GH_LOG, JSON.stringify(args) + '\\n');",
                    "const fixture = JSON.parse(fs.readFileSync(process.env.PR_STATE_FAKE_GH_FIXTURE, 'utf8'));",
                    "let value; let exitStatus = 0;",
                    "if (args[0] === 'repo' && args[1] === 'view') value = { nameWithOwner: fixture.repository };",
                    "else if (args[0] === 'pr' && args[1] === 'checks') { value = fixture.checks; exitStatus = fixture.checkStatus || 0; }",
                    "else if (args[0] === 'api') {",
                    "  const endpoint = args[args.indexOf('GET') + 1];",
                    "  if (/\\/pulls\\/31$/.test(endpoint)) value = fixture.pr;",
                    "  else if (/\\/actions\\/workflows\\/release-gate\\.yml$/.test(endpoint)) value = fixture.workflow;",
                    "  else if (/\\/actions\\/workflows\\/77\\/runs$/.test(endpoint)) {",
                    "    const pageArg = args.find(item => /^page=/.test(item));",
                    "    value = fixture.pages[Number(pageArg.split('=')[1]) - 1] || { total_count: 0, workflow_runs: [] };",
                    "  } else { console.error('unexpected endpoint: ' + endpoint); process.exit(3); }",
                    "} else { console.error('unexpected args: ' + args.join(' ')); process.exit(3); }",
                    "process.stdout.write(JSON.stringify(value));",
                    "if (isWindowsShim) process.exit(exitStatus); else process.exitCode = exitStatus;",
                ].join('\n');
                fs.writeFileSync(fakeScript, fakeSource, 'utf8');
                if (process.platform === 'win32') {
                    const ghPath = path.join(fakeBin, 'gh.exe');
                    try {
                        fs.linkSync(process.execPath, ghPath);
                    } catch {
                        fs.copyFileSync(process.execPath, ghPath);
                    }
                } else {
                    const ghPath = path.join(fakeBin, 'gh');
                    fs.writeFileSync(ghPath, `#!/usr/bin/env node\n${fakeSource}`, 'utf8');
                    fs.chmodSync(ghPath, 0o755);
                }

                const fixture = (body, workflowPath = '.github/workflows/release-gate.yml', prOverrides = {}) => ({
                    repository: 'uwence/create-evo-lite',
                    pr: basePr({ body, ...prOverrides }),
                    workflow: { id: 77, path: workflowPath },
                    pages: [{ total_count: 1, workflow_runs: [baseRun()] }],
                    checks: [baseCheckRow()],
                    checkStatus: 0,
                });
                const childEnv = {
                    ...process.env,
                    EVO_LITE_ROOT: runtime.runtimeRoot,
                    NODE_PATH: [
                        path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'),
                        process.env.NODE_PATH,
                    ].filter(Boolean).join(path.delimiter),
                    PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
                    NODE_OPTIONS: [
                        process.platform === 'win32' ? `--require=${fakeScript.replace(/\\/g, '/')}` : '',
                        process.env.NODE_OPTIONS,
                    ].filter(Boolean).join(' '),
                    PR_STATE_FAKE_GH_FIXTURE: fixturePath,
                    PR_STATE_FAKE_GH_LOG: callLogPath,
                };
                const snapshot = root => {
                    const result = {};
                    const walk = dir => {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            const full = path.join(dir, entry.name);
                            const rel = path.relative(root, full).replace(/\\/g, '/');
                            if (rel === '.git' || rel.startsWith('.git/')
                                || rel === 'fake-gh-bin' || rel.startsWith('fake-gh-bin/')) continue;
                            if (entry.isDirectory()) walk(full);
                            else result[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
                        }
                    };
                    walk(root);
                    return result;
                };
                const before = snapshot(runtime.workspaceRoot);
                const runCli = data => {
                    fs.writeFileSync(fixturePath, JSON.stringify(data), 'utf8');
                    fs.writeFileSync(callLogPath, '', 'utf8');
                    const result = childProcess.spawnSync(
                        process.execPath,
                        [path.join(runtime.runtimeRoot, 'cli', 'memory.js'), 'pr-state', 'validate', '31', '--json'],
                        { cwd: runtime.workspaceRoot, env: childEnv, encoding: 'utf8', windowsHide: true }
                    );
                    assert.ok(result.stdout.trim(), result.stderr || `pr-state CLI produced no JSON (exit ${result.status})`);
                    const report = JSON.parse(result.stdout);
                    const calls = fs.readFileSync(callLogPath, 'utf8')
                        .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
                    return { result, report, calls };
                };

                const realPass = runCli(fixture(stateBody()));
                assert.strictEqual(realPass.result.status, 0, realPass.result.stderr || realPass.result.stdout);
                assert.strictEqual(realPass.report.result, 'pass');
                assert.deepStrictEqual(
                    Object.keys(realPass.report),
                    ['schema', 'result', 'pr', 'expected', 'observed', 'findings', 'errors']
                );
                const realPassChecksCall = realPass.calls.find(args => args[0] === 'pr' && args[1] === 'checks');
                assert.ok(realPassChecksCall, 'real CLI must query PR-scoped checks after finding workflow candidates');
                assert.ok(realPassChecksCall.includes('--repo'));
                assert.ok(realPassChecksCall.includes('github.com/uwence/create-evo-lite'));

                const realDrift = runCli(fixture(stateBody({ headSha: SHA_STALE })));
                assert.strictEqual(realDrift.result.status, 1, realDrift.result.stderr);
                assert.ok(realDrift.report.findings.some(item => item.code === 'HEAD_SHA_DRIFT'));
                const runCalls = realDrift.calls.filter(args => args.some(value => /actions\/workflows\/77\/runs/.test(value)));
                assert.ok(runCalls.every(args => args.includes(`head_sha=${SHA_HEAD}`)));
                assert.ok(runCalls.every(args => !args.includes(`head_sha=${SHA_STALE}`)));

                const realError = runCli(fixture(stateBody(), '.github/workflows/other.yml'));
                assert.strictEqual(realError.result.status, 2, realError.result.stderr);
                assert.strictEqual(realError.report.result, 'error');

                const mergedFixture = {
                    state: 'closed', draft: true, merged: true,
                    merged_at: '2026-08-09T00:00:00Z',
                };
                const realMergedDrift = runCli(fixture(stateBody({ phase: 'ready' }), undefined, mergedFixture));
                assert.strictEqual(realMergedDrift.result.status, 1, realMergedDrift.result.stderr);
                assert.strictEqual(realMergedDrift.report.result, 'drift');
                assert.deepStrictEqual(realMergedDrift.report.findings.map(item => item.code), ['PHASE_DRIFT']);
                assert.strictEqual(realMergedDrift.report.observed.phase, 'merged');
                assert.strictEqual(realMergedDrift.report.observed.checks, 'success');
                assert.strictEqual(realMergedDrift.report.observed.diagnostics.runId, 900);

                const realMergedPass = runCli(fixture(stateBody({ phase: 'merged' }), undefined, mergedFixture));
                assert.strictEqual(realMergedPass.result.status, 0, realMergedPass.result.stderr || realMergedPass.result.stdout);
                assert.strictEqual(realMergedPass.report.result, 'pass');
                assert.deepStrictEqual(realMergedPass.report.findings, []);

                for (const args of [...realPass.calls, ...realDrift.calls, ...realError.calls]) {
                    assert.ok(!/\b(edit|ready|merge|POST|PATCH|PUT|DELETE)\b/.test(args.join(' ')));
                }
                assert.deepStrictEqual(snapshot(runtime.workspaceRoot), before);
            } finally {
                try {
                    removePrStateRuntimeRoot(runtime.workspaceRoot);
                } finally {
                    fs.rmSync = originalRmSync;
                }
            }
            assert.deepStrictEqual(ps5CleanupOptions, [{
                recursive: true,
                force: true,
                maxRetries: 5,
                retryDelay: 100,
            }]);
            console.log('✅ PS5 pr-state fail-closed CLI acceptance passed');
        }

       console.log('2s. Testing trajectory summary folds whitespace before truncating ...');
        {
            // A trajectory entry is a single anchor line. Truncating the archive body by
            // character count without folding newlines first splits one entry across
            // physical lines: the tail is dropped on the next write (permanent loss), and
            // a continuation line that happens to start with "-" is promoted to a ghost
            // entry that consumes one of the 10 slots.
            const trajRuntime = createTempRuntimeRoot('traj-fold');
            const trajLoaded = await bootstrapRuntime(trajRuntime.runtimeRoot, {
                EVO_LITE_SKIP_GIT_STATUS: '1',
                EVO_LITE_GIT_COMMIT: 'ccc3333',
            });
            const trajSvc = trajLoaded.service;

            const trajContextPath = path.join(trajRuntime.runtimeRoot, 'active_context.md');
            const trajArchiveDir = path.join(trajRuntime.runtimeRoot, 'raw_memory');
            const countArchives = () => (fs.existsSync(trajArchiveDir) ? fs.readdirSync(trajArchiveDir).length : 0);

            await trajSvc.track('MultiLineDetails', 'Line one of the closure note.\nLine two continues after a newline and must stay on one trajectory line.');
            await trajSvc.track('ListDetails', 'Closure summary head.\n- ghost bullet must not become its own entry\n- second bullet');
            // mechanism is user input too, and is interpolated ahead of the summary.
            await trajSvc.track('Mechanism\n- ghost mechanism', 'Ordinary details with no newline.');

            // A whitespace-only mechanism must fail BEFORE any archive is written, so the
            // rejection cannot leave an orphan archive or a half-updated active context.
            const archivesBeforeReject = countArchives();
            const contextBeforeReject = fs.readFileSync(trajContextPath, 'utf8');
            await assert.rejects(
                () => trajSvc.track(' \n\t ', 'details for a blank mechanism'),
                /mechanism|机制名/i,
                'a whitespace-only mechanism must be rejected'
            );
            assert.strictEqual(countArchives(), archivesBeforeReject, 'rejected track still wrote an archive');
            assert.strictEqual(fs.readFileSync(trajContextPath, 'utf8'), contextBeforeReject, 'rejected track still mutated active_context');

            const trajMd = fs.readFileSync(trajContextPath, 'utf8');
            const trajSection = trajMd.match(/<!-- BEGIN_TRAJECTORY -->([\s\S]*?)<!-- END_TRAJECTORY -->/)[1];
            const trajLines = trajSection.split('\n').map(line => line.trim()).filter(Boolean);

            // Three tracked entries plus the seeded "- [init]" template entry.
            assert.strictEqual(
                trajLines.length,
                4,
                `trajectory must hold exactly one physical line per entry, got ${trajLines.length}:\n${trajSection}`
            );
            for (const line of trajLines.slice(0, 3)) {
                assert.ok(
                    /^- \[[^\]]+\] \d{4}-\d{2}-\d{2} [^:]+: /.test(line),
                    `trajectory entry lost its anchor shape: ${line}`
                );
            }
            assert.ok(trajLines[3].startsWith('- [init]'), `seeded template entry was displaced: ${trajLines[3]}`);
            assert.ok(trajLines[0].includes('Mechanism - ghost mechanism: Ordinary details with no newline.'), `mechanism was not folded to one line: ${trajLines[0]}`);
            assert.ok(!trajLines.some(line => line.startsWith('- ghost mechanism')), 'a folded mechanism must not leave a ghost entry');
            assert.ok(trajLines[1].includes('ghost bullet must not become its own entry'), 'folded summary dropped the text after the first newline');
            assert.ok(trajLines[2].includes('Line two continues after a newline'), 'folded summary dropped the text after the first newline');

            // Downstream parsing must see four well-formed entries, not ghosts.
            const trajParsed = trajLoaded.service.splitTrajectoryEntries(trajSection);
            assert.strictEqual(trajParsed.length, 4, 'splitTrajectoryEntries saw a ghost entry');
            // The returned payload must carry the same normalized mechanism the entry shows.
            const normalizedTrack = await trajSvc.track('Payload\tMechanism', 'Payload mechanism must be normalized in the return value too.');
            assert.strictEqual(normalizedTrack.mechanism, 'Payload Mechanism', 'track payload reported a non-normalized mechanism');
            console.log('✅ 2s trajectory whitespace folding passed');
        }

        console.log('2a. Testing context read / summary / validate ...');
        // A runtime switch happened above; take a fresh handle rather than
        // calling through the discarded generation.
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);
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

        console.log('3e. Testing context edit CLI surface ...');
        {
            const cliRuntime = createTempRuntimeRoot('backlog-edit-cli');
            const contextPath = path.join(cliRuntime.runtimeRoot, 'active_context.md');
            const initial = fs.readFileSync(contextPath, 'utf8').replace(
                /<!-- BEGIN_BACKLOG -->[\s\S]*?<!-- END_BACKLOG -->/,
                '<!-- BEGIN_BACKLOG -->\n- [ ] [Cli1] before CLI edit\n<!-- END_BACKLOG -->'
            );
            fs.writeFileSync(contextPath, initial, 'utf8');
            const cliEnv = {
                ...process.env,
                EVO_LITE_ROOT: cliRuntime.runtimeRoot,
                EVO_LITE_CACHE_DIR: SHARED_CACHE_DIR,
                EVO_LITE_SKIP_GIT_GUARD: '1',
                EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
            };
            const spawnCli = (args, input) => childProcess.spawnSync(
                process.execPath,
                [path.join(CLI_DIR, 'memory.js'), ...args],
                { cwd: cliRuntime.workspaceRoot, env: cliEnv, encoding: 'utf8', input }
            );

            const success = spawnCli(['context', 'edit', 'cli1', '[BLOCKED] CLI replacement']);
            assert.strictEqual(success.status, 0, `${success.stdout}\n${success.stderr}`);
            assert.ok(
                fs.readFileSync(contextPath, 'utf8').includes('- [ ] [Cli1] [BLOCKED] CLI replacement'),
                'nested context edit did not persist the replacement'
            );

            const unchanged = fs.readFileSync(contextPath);
            const rejected = [
                { args: ['edit', 'cli1', 'alias'], label: 'top-level alias' },
                { args: ['context', 'edit', 'cli1', 'value', '--content', 'other'], label: '--content' },
                { args: ['context', 'edit', 'cli1', 'value', '--file', 'task.md'], label: '--file' },
                { args: ['context', 'edit', 'cli1', 'one', 'two'], label: 'extra/batch argument' },
            ];
            for (const testCase of rejected) {
                const result = spawnCli(testCase.args);
                assert.notStrictEqual(result.status, 0, `${testCase.label} must be rejected`);
                assert.deepStrictEqual(fs.readFileSync(contextPath), unchanged, `${testCase.label} mutated active_context`);
            }
            const stdinOnly = spawnCli(['context', 'edit', 'cli1'], 'stdin replacement');
            assert.notStrictEqual(stdinOnly.status, 0, 'stdin must not satisfy missing <new-text>');
            assert.deepStrictEqual(fs.readFileSync(contextPath), unchanged, 'stdin rejection mutated active_context');
            console.log('✅ 3e context edit CLI surface passed');
        }

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
                if (command === 'npm ci') {
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
                if (command === 'npm ci') {
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

        console.log('3e. Testing bootstrap recall surfaces a reflections-only match without the fresh-takeover fallback ...');
        const bootstrapReflectionRuntime = createTempRuntimeRoot('bootstrap-recall-reflection-only');
        const bootstrapReflectionLoaded = await bootstrapRuntime(bootstrapReflectionRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        await bootstrapReflectionLoaded.service.memorize(
            'ReflectionOnlyProbe 避坑与教训：必须先运行完整回归测试，防止连锁故障扩散到其他模块，这是团队反复踩坑后的核心决策。This note is deliberately long enough to satisfy the quality guard.'
        );
        console.log(bootstrapReflectionLoaded.service.setFocus('收口 ReflectionOnlyProbe 经验总结，避免同类问题重复出现'));
        loadCli(bootstrapReflectionRuntime.runtimeRoot, {
            EVO_LITE_GIT_STATUS: '',
        });
        const bootstrapReflectionCliModule = require(path.join(CLI_DIR, 'memory.js'));
        const bootstrapReflectionOutput = await captureConsole(async () => {
            await bootstrapReflectionCliModule.run(['node', 'memory.js', 'bootstrap']);
        });
        assert.ok(
            bootstrapReflectionOutput.includes('memory_status: matched'),
            'bootstrap command did not surface matched status for a reflections-only recall'
        );
        assert.ok(
            !bootstrapReflectionOutput.includes('memory_effect: fresh-takeover'),
            'bootstrap command printed the self-contradictory fresh-takeover fallback alongside a reflections-only match'
        );
        assert.ok(
            bootstrapReflectionOutput.includes('reflection:'),
            'bootstrap command did not surface the reflections-only recall hit'
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
        // [zvec-win-unicode-containment] §7.4 M5.5g — this used to assert that a
        // bare getIndexMemoryDir() performed the rename. Renaming the ledger is a
        // WRITE to the global archive-marker set, so it belongs to the
        // publication-lock owner alone: an unlocked reader that migrated it could
        // do so in the middle of someone else's locked transaction. The two
        // halves are now asserted separately — the getter only resolves, and a
        // lock-taking command is what migrates.
        const legacyLoaded = await bootstrapRuntime(legacyIndexRuntime.runtimeRoot);
        const legacyRuntimePaths = require(path.join(CLI_DIR, 'runtime.js'));

        assert.strictEqual(
            legacyRuntimePaths.getIndexMemoryDir(),
            legacyIndexDir,
            'resolving the ledger must be pure'
        );
        assert.ok(
            !fs.existsSync(path.join(legacyIndexRuntime.runtimeRoot, 'index_memory')),
            'a pure resolution must not create the modern directory'
        );

        await legacyLoaded.service.syncIndexMemory();

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
        // verify() opens the entity store as well as the database; both must be
        // released before suite cleanup removes this root.
        // Owner-local cleanup: the instance that opened this connection closes it.
        initGuidanceLoaded.db.closeDb();
        assert.ok(initGuidanceOutput.includes('.agents/rules/architecture.md'), 'verify did not mention missing or placeholder architecture rules during init guidance');

        console.log('8b. Testing git guard ignores .evo-lite-only deletions with leading status padding ...');
        // Seven runtime switches happened since primaryLoaded was taken; without
        // a fresh handle this track() would run against another test's database.
        primaryLoaded = await bootstrapRuntime(primary.runtimeRoot);
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

                const configDir = path.join(tmpLintRoot, '.evo-lite');
                fs.mkdirSync(configDir, { recursive: true });
                fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
                    planning: { contractLint: {
                        required: true,
                        paths: ['docs/superpowers/plans/contracted-*.md'],
                        requiredInvariants: ['attempt-binding'],
                    } },
                }));
                fs.writeFileSync(path.join(plansDir, 'contracted-missing.md'), [
                    '---', 'id: plan:contracted-missing', 'linkedSpec: spec:good-plan', '---',
                    '# Contract Missing', '',
                ].join('\n'));
                fs.writeFileSync(path.join(plansDir, 'contracted-invariant.md'), [
                    '---', 'id: plan:contracted-invariant', 'linkedSpec: spec:good-plan', '---',
                    '# Contract Invariant', '', '## Governance Contract', '', '```json',
                    JSON.stringify({
                        schema: 1, artifactStage: 'plan', proofLayer: 'A',
                        requiredCapabilities: [], blockScope: 'artifact', remediationBudget: 3,
                        requiredInvariants: ['causal-ordering'],
                    }, null, 2),
                    '```', '',
                ].join('\n'));
                const contractResult = lintPlans(tmpLintRoot, false);
                assert.ok(contractResult.issues.some(i => i.code === 'PLAN_CONTRACT_MISSING'
                    && i.file.endsWith('contracted-missing.md')),
                'configured paths must fail when their Governance Contract is missing');
                assert.ok(contractResult.issues.some(i => i.code === 'PLAN_CONTRACT_INVARIANT_MISSING'
                    && i.file.endsWith('contracted-invariant.md')),
                'configured invariant IDs must be present in an otherwise-valid contract');
                assert.strictEqual(contractResult.issues.some(i => i.code === 'PLAN_CONTRACT_MISSING'
                    && i.file.endsWith('good-plan.md')), false,
                'non-matching legacy plans must remain valid opt-outs');
                const lintHelp = childProcess.spawnSync(process.execPath, [
                    path.join(TEMPLATE_CLI_DIR, 'memory.js'), 'plan', 'lint', '--help',
                ], { cwd: tmpLintRoot, encoding: 'utf8' });
                assert.strictEqual(lintHelp.status, 0, lintHelp.stderr);
                assert.match(lintHelp.stdout, /--json/);
                assert.match(lintHelp.stdout, /--strict/);

                const warningRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-plan-lint-warning-'));
                try {
                    writeText(path.join(warningRoot, 'docs', 'superpowers', 'plans', 'warning.md'), [
                        '---', 'id: plan:warning-only', '---', '', '# Warning only', '',
                    ].join('\n'));
                    const warningEnv = {
                        ...process.env,
                        EVO_LITE_WORKSPACE_ROOT: warningRoot,
                        EVO_LITE_ROOT: path.join(warningRoot, '.evo-lite'),
                        EVO_LITE_SKIP_GIT_GUARD: '1',
                        EVO_LITE_SKIP_GIT_STATUS: '1',
                        NODE_PATH: [path.join(WORKSPACE_ROOT, 'node_modules'), path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules')].join(path.delimiter),
                    };
                    const runLint = () => childProcess.spawnSync(process.execPath, [
                        path.join(TEMPLATE_CLI_DIR, 'memory.js'), 'plan', 'lint', '--strict',
                    ], { cwd: warningRoot, env: warningEnv, encoding: 'utf8' });
                    const warningOnly = runLint();
                    assert.strictEqual(warningOnly.status, 0,
                        `strict lint must remain successful for warnings-only legacy debt: ${warningOnly.stdout}${warningOnly.stderr}`);
                    writeText(path.join(warningRoot, '.evo-lite', 'config.json'), JSON.stringify({
                        planning: { contractLint: {
                            required: true, paths: ['docs/superpowers/plans/**'], requiredInvariants: [],
                        } },
                    }));
                    const withError = runLint();
                    assert.notStrictEqual(withError.status, 0,
                        'strict lint must exit non-zero when a configured contract error exists');
                    assert.match(`${withError.stdout}${withError.stderr}`, /PLAN_CONTRACT_MISSING/);
                } finally {
                    fs.rmSync(warningRoot, { recursive: true, force: true });
                }

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
                assert.ok(findings.some(f => f.id === 'R006:file:src/foo.js'), 'code-only commit should produce an R006 finding for src/foo.js');
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
                assert.ok(findings.some(f => f.id === 'R006:file:src/root.js'), 'root commit should still surface src/root.js in R006 findings');
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

        console.log('T12c. Testing extractSuperPowersFiles recognizes the "Add:" Files verb ...');
        {
            const { parsePlanFile } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown'));
            const tmpAddPlan = path.join(os.tmpdir(), 'evo-add-verb-plan.md');
            const addPlanContent = [
                '---\nid: plan:add-verb-test\n---\n',
                '# Add Verb Test Plan\n',
                '### Task 1: Create a workflow\n',
                '**Files:**\n',
                '- Add: `.github/workflows/x.yml`\n',
                '- [x] **Step 1: Author it**\n',
                '- [x] **Step 2: Commit**\n',
            ].join('');
            fs.writeFileSync(tmpAddPlan, addPlanContent, 'utf8');
            try {
                const plan = parsePlanFile(tmpAddPlan);
                assert.ok(plan, 'Add-verb plan must parse');
                assert.deepStrictEqual(plan.tasks[0].linkedFiles, ['.github/workflows/x.yml'],
                    '"- Add:" in a **Files:** block must register as a linkedFile');
            } finally {
                fs.rmSync(tmpAddPlan, { force: true });
            }
            console.log('✅ T12c Add: Files verb recognized');
        }

        console.log('SB. Testing self-brick regression: hard-brick (entry recovers) + feature-brick (guard degrades) ...');
        {
            const { syncRuntime } = require(path.join(TEMPLATE_CLI_DIR, 'sync-runtime'));
            const { spawnSync } = require('child_process');
            const mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-selfbrick-'));
            // Save/restore any caller-set template overrides (do not clobber them).
            const savedCli = process.env.EVO_LITE_TEMPLATE_CLI_DIR;
            const savedRoot = process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
            process.env.EVO_LITE_TEMPLATE_CLI_DIR = TEMPLATE_CLI_DIR;
            process.env.EVO_LITE_TEMPLATE_ROOT_DIR = TEMPLATE_ROOT_DIR;
            // Pin the child's workspace to the tmp mirror deterministically. The standalone
            // entry honors EVO_LITE_WORKSPACE_ROOT, but the `mem sync-runtime` command resolves
            // via getWorkspaceRoot() → EVO_LITE_ROOT. Earlier integration tests leak
            // EVO_LITE_ROOT into process.env (e.g. lines ~133/242), so without pinning it here
            // the guarded memory.js child would sync the leaked workspace instead of the mirror.
            // Setting EVO_LITE_ROOT = <mirror>/.evo-lite makes BOTH child paths target the mirror.
            const childEnv = {
                ...process.env,
                EVO_LITE_WORKSPACE_ROOT: mirrorRoot,
                EVO_LITE_ROOT: path.join(mirrorRoot, '.evo-lite'),
            };
            const cliDir = path.join(mirrorRoot, '.evo-lite', 'cli');
            const help = () => spawnSync(process.execPath, [path.join(cliDir, 'memory.js'), '--help'], { env: childEnv, encoding: 'utf8' });
            const runEntry = () => spawnSync(process.execPath, [path.join(cliDir, 'sync-runtime-entry.js'), '--json'], { env: childEnv, encoding: 'utf8' });
            try {
                // Build a full faithful mirror of the real templates into the tmp workspace.
                const first = syncRuntime(mirrorRoot, {});
                assert.strictEqual(first.status, 'ok', 'initial mirror build should succeed');
                const entry = path.join(cliDir, 'sync-runtime-entry.js');
                const hardDep = path.join(cliDir, 'memory-index-util.js');
                const feature = path.join(cliDir, 'code-perception', 'post-commit-code-perception.js');
                assert.ok(fs.existsSync(entry), 'mirror must contain sync-runtime-entry.js (declared in Task 1 manifest)');
                assert.ok(fs.existsSync(hardDep), 'mirror must contain memory-index-util.js');
                assert.ok(fs.existsSync(feature), 'mirror must contain the code-perception module');

                // ---- Scenario A: HARD BRICK — a top-level require dep is missing. ----
                // memory.js cannot load at all; safeRegister never runs; only the standalone
                // entry recovers.
                fs.rmSync(hardDep);
                const hardHelp = help();
                assert.notStrictEqual(hardHelp.status, 0, 'hard-bricked memory.js --help must exit non-zero');
                assert.ok(/MODULE_NOT_FOUND/.test(hardHelp.stderr || ''), 'hard-brick stderr must show MODULE_NOT_FOUND');
                assert.ok(/memory-index-util/.test(hardHelp.stderr || ''), 'hard-brick stderr must name memory-index-util');
                const hardEntry = runEntry();
                assert.strictEqual(hardEntry.status, 0, 'standalone entry must run despite the hard brick');
                assert.ok(fs.existsSync(hardDep), 'standalone entry must re-copy memory-index-util.js');
                assert.strictEqual(help().status, 0, 'memory.js --help must recover after the entry heals the hard brick');

                // ---- Scenario B: FEATURE BRICK — a feature registrar module is missing. ----
                // memory.js survives via the guard; the failed feature is NOT presented as
                // registered; mem sync-runtime heals; the command reappears.
                fs.rmSync(feature);
                const featHelp = help();
                assert.strictEqual(featHelp.status, 0, 'guarded memory.js --help must exit 0 with a feature module missing');
                assert.ok(/sync-runtime/.test(featHelp.stdout || ''), 'feature-brick --help must still list sync-runtime');
                assert.ok(!/(^|\s)code-perception(\s|$)/m.test(featHelp.stdout || ''), 'feature-brick --help must NOT list the failed code-perception command');
                assert.ok(/warning: command group code-perception failed to register/.test(featHelp.stderr || ''), 'guard must warn naming the failed feature');
                assert.ok(/MODULE_NOT_FOUND/.test(featHelp.stderr || ''), 'guard warning must carry the MODULE_NOT_FOUND cause');
                // Heal via the guarded memory.js sync-runtime itself (proves it stayed usable).
                const viaMemory = spawnSync(process.execPath, [path.join(cliDir, 'memory.js'), 'sync-runtime'], { env: childEnv, encoding: 'utf8' });
                assert.strictEqual(viaMemory.status, 0, 'guarded memory.js sync-runtime must exit 0 and heal');
                assert.ok(fs.existsSync(feature), 'sync-runtime must re-copy the deleted feature module');
                const healedHelp = help();
                assert.strictEqual(healedHelp.status, 0, 'memory.js --help must exit 0 after healing');
                assert.ok(/(^|\s)code-perception(\s|$)/m.test(healedHelp.stdout || ''), 'code-perception command must reappear after healing');

                // Convergence: a clean re-run via the entry copies nothing.
                const converged = runEntry();
                assert.strictEqual(JSON.parse(converged.stdout).copied.length, 0, 'converged entry run copies nothing');
            } finally {
                if (savedCli === undefined) delete process.env.EVO_LITE_TEMPLATE_CLI_DIR; else process.env.EVO_LITE_TEMPLATE_CLI_DIR = savedCli;
                if (savedRoot === undefined) delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR; else process.env.EVO_LITE_TEMPLATE_ROOT_DIR = savedRoot;
                fs.rmSync(mirrorRoot, { recursive: true, force: true });
            }
            console.log('✅ SB self-brick regression (hard-brick + feature-brick) passed');
        }

        // [zvec-win-unicode-containment] Task 7 / AC6 — T12⑥ through the REAL CLI.
        //
        // governance's T12 drives service.verify() in-process. This drives the
        // published entry the way an operator does, because the thing AC6 promises
        // is that `mem verify` stays usable on a machine where containment has
        // engaged — and an operator never calls service.verify().
        console.log('T-zwuc-T12-cli. Testing verify containment diagnostics survive the real CLI entry ...');
        {
            // A non-ASCII runtime root is the whole point on win32; elsewhere the
            // classifier reports every path eligible, so the case degenerates into
            // "verify still runs", which is still worth asserting.
            const base = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-t12cli-诊断-'));
            try {
                const runtimeRoot = path.join(base, '.evo-lite');
                fs.mkdirSync(runtimeRoot, { recursive: true });
                fs.copyFileSync(TEMPLATE_CONTEXT_PATH, path.join(runtimeRoot, 'active_context.md'));
                const run = childProcess.spawnSync(
                    process.execPath,
                    [path.join(CLI_DIR, 'memory.js'), 'verify'],
                    {
                        encoding: 'utf8',
                        cwd: WORKSPACE_ROOT,
                        env: {
                            ...process.env,
                            EVO_LITE_ROOT: runtimeRoot,
                            EVO_LITE_DB_PATH: path.join(base, 'memory.db'),
                            EVO_LITE_MEMORY_ENGINE: 'zvec',
                            EVO_LITE_CACHE_DIR: SHARED_CACHE_DIR,
                            EVO_LITE_SKIP_GIT_GUARD: '1',
                            EVO_LITE_SKIP_GIT_STATUS: '1',
                            NODE_PATH: [
                                path.join(WORKSPACE_ROOT, 'node_modules'),
                                path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'),
                            ].join(path.delimiter),
                        },
                    });
                const out = `${run.stdout || ''}${run.stderr || ''}`;
                assert.strictEqual(run.status, 0,
                    `verify must exit 0 on a containment-engaged runtime — a diagnostic that crashes on the machine it exists to diagnose is worthless — got ${run.status}: ${out.slice(-600)}`);
                assert.ok(out.includes('[Containment]'),
                    `verify must always emit the containment section, including when there is no debt — got: ${out.slice(-600)}`);
                for (const banned of ['从未被读取', '内容确认完整', '上游缺陷已修复', '已自动恢复',
                    '当前引擎按正常判定运行']) {
                    assert.ok(!out.includes(banned),
                        `CLI verify output must not contain the banned claim "${banned}" (spec §7.5 D6)`);
                }
                if (process.platform === 'win32') {
                    assert.ok(/containment|Containment/.test(out),
                        'on win32 a non-ASCII runtime must produce a containment diagnosis');
                }
            } finally {
                try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
            }
            console.log('✅ T-zwuc-T12-cli verify containment diagnostics via CLI passed');
        }

        console.log('T-freeze-ledger-cli. Testing plan freeze/ledger deterministic JSON and warning-only budget output ...');
        {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-freeze-ledger-cli-'));
            const artifactRel = 'docs/superpowers/plans/cli.md';
            const artifactPath = path.join(root, ...artifactRel.split('/'));
            const git = args => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
            const contractValue = {
                schema: 1, artifactStage: 'plan', proofLayer: 'A',
                requiredCapabilities: [], blockScope: 'artifact', remediationBudget: 0,
                requiredInvariants: ['attempt-binding'],
            };
            const artifact = title => [
                '---', 'id: plan:cli-freeze', 'linkedSpec: spec:cli-freeze', 'status: active', '---', '',
                `# ${title}`, '', '## Governance Contract', '', '```json',
                JSON.stringify(contractValue, null, 2), '```', '',
            ].join('\n');
            const env = {
                ...process.env,
                EVO_LITE_WORKSPACE_ROOT: root,
                EVO_LITE_ROOT: path.join(root, '.evo-lite'),
                EVO_LITE_SKIP_GIT_GUARD: '1',
                EVO_LITE_SKIP_GIT_STATUS: '1',
                NODE_PATH: [path.join(WORKSPACE_ROOT, 'node_modules'), path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules')].join(path.delimiter),
            };
            const run = args => childProcess.spawnSync(process.execPath, [path.join(CLI_DIR, 'memory.js'), ...args], {
                cwd: root, env, encoding: 'utf8',
            });
            try {
                fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
                git(['init', '-b', 'main']);
                git(['config', 'user.name', 'Evo Test']);
                git(['config', 'user.email', 'evo@example.com']);
                git(['config', 'core.autocrlf', 'false']);
                writeText(artifactPath, artifact('CLI Freeze'));
                git(['add', artifactRel]);
                git(['commit', '-m', 'add artifact']);

                const frozen = run(['plan', 'freeze', artifactRel, '--json']);
                assert.strictEqual(frozen.status, 0, `plan freeze --json failed: ${frozen.stderr}`);
                const entry = JSON.parse(frozen.stdout);
                assert.strictEqual(entry.path, artifactRel);
                assert.strictEqual(entry.artifactId, 'plan:cli-freeze');

                writeText(artifactPath, artifact('CLI Remediation'));
                git(['add', artifactRel]);
                git(['commit', '-m', 'remediate artifact']);
                const jsonRun = run(['plan', 'ledger', '--json']);
                assert.strictEqual(jsonRun.status, 0, `plan ledger --json failed: ${jsonRun.stderr}`);
                const report = JSON.parse(jsonRun.stdout);
                assert.strictEqual(report.entries[0].remediation.status, 'budget-exceeded');
                assert.strictEqual(report.entries[0].remediation.used, 1);

                const textRun = run(['plan', 'ledger']);
                assert.strictEqual(textRun.status, 0, 'budget exceedance is warning-only, never an automatic refusal');
                for (const choice of ['continue-governance', 'downgrade-nonblocking-debt', 'resume-authorized-execution']) {
                    assert.ok(textRun.stdout.includes(choice), `ledger text must render reviewer choice ${choice}`);
                }
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
            console.log('✅ T-freeze-ledger-cli passed');
        }

        console.log('T-governance-cli. Nested snapshot/budget commands stay read-only, bounded, and manifest-managed ...');
        {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-governance-cli-'));
            const activePath = path.join(root, '.evo-lite', 'active_context.md');
            const snapshotPath = path.join(root, '.evo-lite', 'generated', 'governance', 'snapshot.json');
            const git = args => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
            const env = {
                ...process.env,
                EVO_LITE_WORKSPACE_ROOT: root,
                EVO_LITE_ROOT: path.join(root, '.evo-lite'),
                EVO_LITE_SKIP_GIT_GUARD: '1',
                EVO_LITE_SKIP_GIT_STATUS: '1',
                NODE_PATH: [path.join(WORKSPACE_ROOT, 'node_modules'), path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules')].join(path.delimiter),
            };
            const run = args => childProcess.spawnSync(process.execPath, [path.join(CLI_DIR, 'memory.js'), ...args], {
                cwd: root, env, encoding: 'utf8',
            });
            try {
                git(['init', '-b', 'main']);
                git(['config', 'user.name', 'Evo Test']);
                git(['config', 'user.email', 'evo@example.com']);
                git(['config', 'core.autocrlf', 'false']);
                writeText(activePath, [
                    '<!-- BEGIN_META -->',
                    'headSha: 0000000000000000000000000000000000000000',
                    'upstreamSha: 0000000000000000000000000000000000000000',
                    'ahead: 0',
                    'behind: 0',
                    '<!-- END_META -->',
                    '<!-- BEGIN_FOCUS -->',
                    '[governance-cli] active',
                    '<!-- END_FOCUS -->',
                    '<!-- BEGIN_BACKLOG -->',
                    '- [ ] [alpha] queued',
                    '<!-- END_BACKLOG -->',
                    '<!-- BEGIN_TRAJECTORY -->',
                    '[0000000] baseline',
                    '<!-- END_TRAJECTORY -->',
                    '',
                ].join('\n'));
                writeText(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                    version: 'evo-plan-ir@1',
                    specs: [],
                    plans: [],
                    tasks: [],
                    findings: [],
                    warnings: [],
                }, null, 2));
                writeText(path.join(root, 'README.md'), 'base\n');
                git(['add', '.']);
                git(['commit', '-m', 'base']);
                const base = git(['rev-parse', 'HEAD']);
                writeText(path.join(root, 'docs', 'superpowers', 'plans', 'governance.md'), [
                    '---',
                    'id: plan:governance-cli',
                    'linkedSpec: spec:governance-cli',
                    'status: active',
                    '---',
                    '# Governance',
                    '',
                    '## Governance Contract',
                    '',
                    '```json',
                    JSON.stringify({
                        schema: 1,
                        artifactStage: 'plan',
                        proofLayer: 'A',
                        requiredCapabilities: [],
                        blockScope: 'artifact',
                        remediationBudget: 0,
                        requiredInvariants: ['attempt-binding'],
                    }, null, 2),
                    '```',
                    '',
                ].join('\n'));
                git(['add', '.']);
                git(['commit', '-m', 'governance']);

                const beforeContext = fs.readFileSync(activePath);
                const jsonSnapshot = run(['governance', 'snapshot', '--json']);
                assert.strictEqual(jsonSnapshot.status, 0, jsonSnapshot.stderr);
                assert.strictEqual(JSON.parse(jsonSnapshot.stdout).version, 'evo-governance-snapshot@1');
                assert.strictEqual(fs.existsSync(snapshotPath), false, 'snapshot defaults to read-only');

                const textSnapshot = run(['governance', 'snapshot']);
                assert.strictEqual(textSnapshot.status, 0, textSnapshot.stderr);
                assert.match(textSnapshot.stdout, /Governance snapshot/);

                const written = run(['governance', 'snapshot', '--write', '--json']);
                assert.strictEqual(written.status, 0, written.stderr);
                assert.strictEqual(JSON.parse(written.stdout).write.path, snapshotPath);
                assert.strictEqual(fs.existsSync(snapshotPath), true, '--write uses the exact generated target');

                fs.unlinkSync(snapshotPath);
                writeText(path.join(root, 'head-advance-1.txt'), 'one\n');
                git(['add', '.']);
                git(['commit', '-m', 'head advance one']);
                const sessionStart = run([
                    'hook', 'advise', 'sessionstart', '--json',
                    '--command', 'secret-command-must-not-persist',
                    '--output', 'secret-output-must-not-persist',
                ]);
                assert.strictEqual(sessionStart.status, 0, sessionStart.stderr);
                assert.strictEqual(fs.existsSync(snapshotPath), true,
                    'sessionstart records a governance snapshot');
                let boundarySnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
                assert.doesNotMatch(JSON.stringify(boundarySnapshot), /secret-command|secret-output/,
                    'lifecycle observations never persist raw command/output text');

                writeText(path.join(root, 'head-advance-2.txt'), 'two\n');
                git(['add', '.']);
                git(['commit', '-m', 'head advance two']);
                const stop = run(['hook', 'advise', 'stop', '--json']);
                assert.strictEqual(stop.status, 0, stop.stderr);
                boundarySnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
                assert.ok(boundarySnapshot.transitions.some(item => item.code === 'head-advanced'),
                    'stop observes the new HEAD transition');

                fs.unlinkSync(snapshotPath);
                const planStatus = run(['plan', 'freeze', 'docs/superpowers/plans/governance.md', '--json']);
                assert.strictEqual(planStatus.status, 0, planStatus.stderr);
                assert.strictEqual(fs.existsSync(snapshotPath), true,
                    'plan freeze completion records a governance snapshot');
                boundarySnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
                assert.strictEqual(boundarySnapshot.freeze.withinBudget + boundarySnapshot.freeze.exceeded, 1,
                    'plan freeze snapshot observes the new ledger entry');

                fs.unlinkSync(snapshotPath);
                writeText(path.join(root, '.evo-lite', 'config.json'), JSON.stringify({
                    governance: { budget: { windowCommits: 0 } },
                }, null, 2));
                const verify = run(['verify']);
                assert.strictEqual(verify.status, 0, verify.stderr);
                assert.match(verify.stderr, /governance\.budget\.windowCommits|治理观察/,
                    'invalid governance budget config is warning-only during verify');
                assert.strictEqual(fs.existsSync(snapshotPath), true,
                    'verify records a governance snapshot without changing its exit semantics');

                fs.unlinkSync(path.join(root, '.evo-lite', 'config.json'));
                const budgetJson = run(['governance', 'budget', '--since', base, '--json']);
                assert.strictEqual(budgetJson.status, 0, budgetJson.stderr);
                assert.strictEqual(JSON.parse(budgetJson.stdout).version, 'evo-governance-budget@1');
                const budgetText = run(['governance', 'budget', '--since', base]);
                assert.strictEqual(budgetText.status, 0, budgetText.stderr);
                assert.match(budgetText.stdout, /Governance work budget/);

                for (const alias of [['snapshot'], ['budget']]) {
                    const rejected = run(alias);
                    assert.notStrictEqual(rejected.status, 0, `top-level ${alias[0]} alias must not exist`);
                }
                const invalidRef = run(['governance', 'budget', '--since', 'bad ref', '--json']);
                assert.notStrictEqual(invalidRef.status, 0, 'invalid ref must fail safely through argv-based Git');
                assert.deepStrictEqual(fs.readFileSync(activePath), beforeContext,
                    'all governance commands preserve active context byte-for-byte');

                fs.unlinkSync(snapshotPath);
                const contextFocus = run(['context', 'focus', '[governance-cli] refreshed']);
                assert.strictEqual(contextFocus.status, 0, contextFocus.stderr);
                assert.strictEqual(fs.existsSync(snapshotPath), true,
                    'successful context mutation records a governance snapshot');

                const manifest = require(path.join(CLI_DIR, 'template-manifest.js'));
                const core = manifest.MANAGED_TEMPLATE_FAMILIES.find(family => family.key === 'core-cli');
                assert.ok(core.files.includes('governance-observer.js'));
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
            console.log('✅ T-governance-cli passed');
        }

        console.log('T-disposition-cli. set validates its inputs and never trusts the caller ...');
        {
            const root = createTempRuntimeRoot('disposition-cli').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: closed-experimental', '---', '', '# S', ''].join('\n'));
            const run = (args) => runCli(root, ['disposition', ...args]);

            let r = run(['set', 'unknown-status:spec:does-not-exist', '--choice', 'wont-fix', '--reason', 'x']);
            assert.notStrictEqual(r.status, 0, 'refuses to disposition a finding that is not emitted');

            r = run(['set', 'unknown-status:spec:u', '--choice', 'invented', '--reason', 'x']);
            assert.notStrictEqual(r.status, 0, 'choice is a closed vocabulary');

            r = run(['set', 'unknown-status:spec:u', '--choice', 'accepted-debt', '--reason', '']);
            assert.notStrictEqual(r.status, 0, 'reason is mandatory');

            r = run(['set', 'unknown-status:spec:u', '--choice', 'deferred', '--reason', 'later']);
            assert.notStrictEqual(r.status, 0, 'deferred without until is rejected — no bare deferral');

            r = run(['set', 'unknown-status:spec:u', '--choice', 'deferred', '--reason', 'later',
                     '--until', '2026-09-01']);
            assert.strictEqual(r.status, 0, 'deferred with until is accepted');

            const led = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'ledger'));
            const entry = led.readLedger(root).entries[0];
            assert.match(entry.fingerprint, /^[0-9a-f]{64}$/, 'the system derived the fingerprint');
            assert.strictEqual(entry.until, '2026-09-01');
            assert.ok('head' in entry, 'provenance head is recorded (never part of the fingerprint)');

            // MERGED-CENSUS COMPLETENESS. Task 8's `sync` tombstones orphaned
            // ledger entries only when the round that observed their absence was
            // COMPLETE. `collectAllFindings` merges two independent producers
            // (spec-portfolio + planning), so completeness must come from BOTH —
            // a merged census that only reflects one producer would let sync
            // tombstone from an incomplete round. At this point the spec census
            // is clean (one well-formed spec, no parse failures) but no
            // plan-ir.json has been written yet, so the planning producer is
            // degraded; the merge must surface that.
            const { collectAllFindings } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'commands'));
            assert.strictEqual(collectAllFindings(root).complete, false,
                'merged census is incomplete while the planning producer has not run, ' +
                'even though the spec census alone is clean');

            // POSITIVE CONTROL: the four refusal assertions above only prove
            // something if `disposition` actually registered as a command group.
            // safeRegister() swallows a require-time throw and continues without
            // it — every `mem disposition ...` call would then exit non-zero with
            // "unknown command", making all four `notStrictEqual(status, 0)`
            // checks pass vacuously. The 'deferred with until is accepted' assertion
            // just above (status === 0, plus the ledger entry it produced) is that
            // positive control: it can only pass if the real `set` handler ran.

            // SHADOW AMBIGUITY. The reachable case is not "an uncommitted file" —
            // that one is simply absent from the committed census and would be
            // rejected by the `no such finding` branch, making the guard
            // unreachable and the mutation dead. The real case is the SAME path
            // carrying a committed R006 AND a further uncommitted change: one
            // findingId, two occurrences.
            // harness exports runGit(cwd, args); there is no gitInit/gitCommitAll.
            runGit(root, ['init']);
            runGit(root, ['config', 'user.name', 'Evo Test']);
            runGit(root, ['config', 'user.email', 'evo@example.com']);
            ensureParent(path.join(root, 'src', 'shadow.js'));
            fs.writeFileSync(path.join(root, 'src', 'shadow.js'), 'v1');
            runGit(root, ['add', '.']);
            runGit(root, ['commit', '-m', 'add unlinked file']);           // committed R006 now exists

            // checkR006 short-circuits to [] when planIR is null (planning/gaps.js),
            // so a plan-ir.json must exist for R006 to emit anything at all. Written
            // AFTER the commit, not before: isGovernanceInfraFile() filters
            // `.evo-lite/**` out of the changed-file set, so an uncommitted IR does
            // not itself produce an R006 finding.
            writeText(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [],
                tasks: [{ id: 'task:t1', linkedPlan: 'plan:p1', linkedFiles: [], status: 'implemented' }],
                warnings: [],
            }, null, 2));

            fs.writeFileSync(path.join(root, 'src', 'shadow.js'), 'v2');   // worktree R006 too

            const committed = collectAllFindings(root).findings.find(f => f.id === 'R006:file:src/shadow.js');
            assert.ok(committed, 'the committed occurrence IS in the disposition id space');
            const shadowed = run(['set', 'R006:file:src/shadow.js', '--choice', 'accepted-debt', '--reason', 'x']);
            assert.notStrictEqual(shadowed.status, 0,
                'one findingId with two live occurrences must be refused, not silently bound to the committed one');
            assert.match(shadowed.stderr + shadowed.stdout, /working tree/,
                'the refusal explains which ambiguity to resolve');

            const listed = run(['list', '--json']);
            assert.ok(listed.stdout.includes('2026-09-01'),
                'until is shown by default so a lapsed deferral cannot sit unseen');

            assert.strictEqual(run(['revoke', 'unknown-status:spec:u']).status, 0);
            assert.strictEqual(led.readLedger(root).entries.length, 0, 'revoke removes the entry');
            console.log('✅ T-disposition-cli passed');
        }

        console.log('T-disposition-cli-spec-half. merged census honors the SPEC producer\'s completeness too ...');
        {
            const specHalfRoot = createTempRuntimeRoot('disposition-cli-spec-half').workspaceRoot;
            // A docs/specs file with no usable `id: spec:...` frontmatter is a real
            // parse failure — buildSpecRegistry pushes it to `errors` (docs/specs is
            // the strict root, unlike docs/superpowers/specs), degrading
            // `census.complete`. The planning producer stays fully complete (a
            // valid, empty plan-ir.json, no fatal warnings), isolating the SPEC
            // half specifically — the fix-round-1 gap was that nothing exercised
            // this half at all.
            writeText(path.join(specHalfRoot, 'docs', 'specs', 'broken.md'),
                ['---', 'title: not a spec', '---', '', '# no id here', ''].join('\n'));
            writeText(path.join(specHalfRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [], warnings: [],
            }, null, 2));
            const { collectAllFindings: collectSpecHalf } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'commands'));
            assert.strictEqual(collectSpecHalf(specHalfRoot).complete, false,
                'merged census is incomplete when only the SPEC producer is degraded, even though planning is complete');
            console.log('✅ T-disposition-cli-spec-half passed');
        }

        console.log('T-disposition-cli-planir-fatal. merged census honors plan-ir.json\'s own fatal scan warnings ...');
        {
            const planIrFatalRoot = createTempRuntimeRoot('disposition-cli-planir-fatal').workspaceRoot;
            // A syntactically valid evo-plan-ir@1 (proper specs/plans/tasks arrays,
            // so runPlanningDriftCensus's OWN `!planIR` check never fires) whose
            // `warnings` carries a level:'error' entry is safeLoadPlanIR's Mode B:
            // planIR comes back non-null but `error` is set. Mode A (missing/
            // corrupt/wrong-version plan-ir.json, planIR: null) is already
            // double-covered by runPlanningDriftCensus's own `!planIR` check, so it
            // cannot isolate the `if (error) {...}` line in collectAllFindings —
            // Mode B is the only fixture where that line is the SOLE thing
            // degrading the merged census. A clean, well-formed spec keeps the
            // SPEC half complete so this isolates Mode B specifically.
            writeText(path.join(planIrFatalRoot, 'docs', 'specs', 'ok.md'),
                ['---', 'id: spec:ok', 'status: active', '---', '', '# OK', ''].join('\n'));
            writeText(path.join(planIrFatalRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [],
                warnings: [{ level: 'error', message: 'spec scan blew up mid-parse' }],
            }, null, 2));
            const { collectAllFindings: collectPlanIrFatal } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'commands'));
            assert.strictEqual(collectPlanIrFatal(planIrFatalRoot).complete, false,
                'merged census is incomplete when plan-ir.json carries a fatal scan warning, even though it parses cleanly');
            console.log('✅ T-disposition-cli-planir-fatal passed');
        }

        console.log('T-disposition-cli-shadow-failclosed. R006 shadow guard fails CLOSED when the second read cannot complete ...');
        {
            const shadowFailRoot = createTempRuntimeRoot('disposition-cli-shadow-failclosed').workspaceRoot;
            ensureParent(path.join(shadowFailRoot, 'src', 'shadow2.js'));
            fs.writeFileSync(path.join(shadowFailRoot, 'src', 'shadow2.js'), 'v1');
            runGit(shadowFailRoot, ['init']);
            runGit(shadowFailRoot, ['config', 'user.name', 'Evo Test']);
            runGit(shadowFailRoot, ['config', 'user.email', 'evo@example.com']);
            runGit(shadowFailRoot, ['add', '.']);
            runGit(shadowFailRoot, ['commit', '-m', 'add unlinked file']);
            const shadowIrPath = path.join(shadowFailRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            writeText(shadowIrPath, JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [],
                tasks: [{ id: 'task:t1', linkedPlan: 'plan:p1', linkedFiles: [], status: 'implemented' }],
                warnings: [],
            }, null, 2));

            // TOCTOU simulation. `set` reads plan-ir.json (via safeLoadPlanIR) TWICE:
            // once through collectAllFindings to discover the committed R006
            // finding, and again inside the R006 shadow guard to check the working
            // tree. Both read the same on-disk file, so within one synchronous
            // command they normally agree — the failure mode this guard defends is
            // exactly the case where they don't (the file vanishes or corrupts
            // between the two reads). That is reproduced with a call-counted
            // `fs.existsSync` stub: calls #1 and #2 to this exact path
            // (collectAllFindings's own safeLoadPlanIR, then checkR009's staleness
            // check inside that same runPlanningDriftCensus call) are left
            // untouched — committed discovery must still succeed — and only call
            // #3 (the shadow guard's own, independent safeLoadPlanIR read) is made
            // to report the file missing. This sequence was verified empirically
            // (a throwaway calibration script, logging each call) before being
            // locked in here — it is not a guess, and this sanity-checks itself
            // below via `existsCallCount`.
            //
            // Must run in-process (not through runCli's spawned subprocess):
            // only an in-process caller can install this stub before invoking the
            // real `set` action and remove it immediately after.
            const { registerDispositionCommands } = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'commands'));
            const { Command } = require('commander');
            const origExistsSync = fs.existsSync;
            const previousEvoLiteRoot = process.env.EVO_LITE_ROOT;
            let existsCallCount = 0;
            let caught = null;
            try {
                fs.existsSync = (p) => {
                    if (String(p) === shadowIrPath) {
                        existsCallCount++;
                        if (existsCallCount === 3) return false;
                    }
                    return origExistsSync(p);
                };
                process.env.EVO_LITE_ROOT = path.join(shadowFailRoot, '.evo-lite');
                const program = new Command();
                program.exitOverride();
                registerDispositionCommands(program);
                try {
                    await program.parseAsync(
                        ['disposition', 'set', 'R006:file:src/shadow2.js', '--choice', 'accepted-debt', '--reason', 'x'],
                        { from: 'user' }
                    );
                } catch (err) {
                    caught = err;
                }
            } finally {
                fs.existsSync = origExistsSync;
                if (previousEvoLiteRoot === undefined) delete process.env.EVO_LITE_ROOT;
                else process.env.EVO_LITE_ROOT = previousEvoLiteRoot;
            }
            assert.strictEqual(existsCallCount >= 3, true,
                "calibration sanity: the shadow guard's own safeLoadPlanIR read must have been reached");
            assert.ok(caught, 'set must refuse when the working-tree shadow check cannot be completed, not silently pass');
            assert.match(String(caught && caught.message), /working tree shadow check could not be completed/,
                'the refusal explains that the check itself failed, not that a shadow was found');
            console.log('✅ T-disposition-cli-shadow-failclosed passed');
        }

        console.log('--- All CLI integration tests passed! ---');
    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

module.exports = { runIntegrationTests };
