---
linkedSpec: spec:code-review-fixes
r008Exempt: true
---

# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 confirmed bugs from the June 2026 code review: 2 P0 EISDIR crashes on init, plus 6 P1 issues covering manifest coverage, MCP deps, drift rule accuracy, and npm publish hygiene.

**Architecture:** All fixes are local surgical edits — no new files, no new abstractions. Template files in `templates/cli/` are canonical; the dogfood runtime copies in `.evo-lite/cli/` must be re-synced after each template edit via `verify --sync` or manual copy. The test harness in `.evo-lite/cli/test.js` tests both the initializer (`index.js`) and the runtime CLI (`templates/cli/memory.js` loaded via `EVO_LITE_ROOT`).

**Tech Stack:** Node.js, better-sqlite3, commander, @modelcontextprotocol/sdk (optional runtime dep)

---

## File Map

| File | Change |
|------|--------|
| `index.js:356-359` | Replace flat `cliFiles.forEach` loop with `copyRecursiveSync(cliTemplatesDir, cliDir)` |
| `.evo-lite/cli/test.js:54-58` | Replace flat `copyFileSync` loop in `createTempTemplateCli` with `copyRecursive` |
| `package.json` | Add `files` whitelist; add `"test"` script |
| `templates/cli/template-manifest.js` | Extend `core-cli` to include `planning/`, `architecture/`, `dashboard-data.js`, `mcp-server.js`, `mcp-validate.js` |
| `index.js:417` | Add `@modelcontextprotocol/sdk` to runtime install command |
| `templates/cli/planning/gaps.js:89-101` | R008: add `status === 'verified'` to condition |
| `templates/cli/planning/gaps.js:104-136` | R009: make `check()` inner loop recursive |
| `templates/cli/planning/gaps.js:137-148` | R009 architecture sourceDirs: add `.agents/rules`, `.agents/workflows`, root `index.js`, `bin/cli.js` |
| `templates/cli/planning/progress.js:30-37` | `checkArchiveHits`: scan file content instead of filename |
| `.evo-lite/cli/` | After each template edit: copy changed file(s) to sync dogfood runtime |

---

### Task 1: Fix P0 — Initializer EISDIR crash on nested cli dirs

**Context:** `index.js:291-293` reads `templates/cli` with `readdirSync`, then `index.js:356-359` iterates and does `readFileSync` on each entry. Now that `templates/cli/planning/` and `templates/cli/architecture/` are directories, `readFileSync(directory)` throws `EISDIR`. The fix is to replace the flat loop with the `copyRecursiveSync` function that's already defined in the same file (lines 296-316).

**Files:**
- Modify: `index.js:356-359`

- [x] **Step 1: Write failing test**

Add this test case inside `.evo-lite/cli/test.js` in the initializer test section (find "runInitializer" tests):

```js
async function testInitializerCopiesCliSubdirs() {
    // If templates/cli has subdirs (planning/, architecture/), they must be
    // copied recursively — not crash with EISDIR.
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-init-subdirs-'));
    const result = await runInitializer(projectRoot, { stubExecSync: true });
    const planningDir = path.join(projectRoot, '.evo-lite', 'cli', 'planning');
    const archDir = path.join(projectRoot, '.evo-lite', 'cli', 'architecture');
    assert.strictEqual(result.status, 0, `Init failed: ${result.stderr}`);
    assert.ok(fs.existsSync(planningDir), 'planning/ subdir not copied');
    assert.ok(fs.existsSync(archDir), 'architecture/ subdir not copied');
    fs.rmSync(projectRoot, { recursive: true, force: true });
    console.log('✅ testInitializerCopiesCliSubdirs passed');
}
```

Register it in the test runner at bottom of the file where other async tests are called.

- [x] **Step 2: Run test to verify it fails**

```bash
node .evo-lite/cli/test.js 2>&1 | grep -A3 "testInitializerCopiesCliSubdirs"
```

Expected: test fails with EISDIR or `planning/ subdir not copied`.

- [x] **Step 3: Replace flat loop with copyRecursiveSync**

In `index.js`, replace lines 356-359 (the `cliFiles.forEach` block):

```js
// 写入 cli 文件
cliFiles.forEach(file => {
    const content = fs.readFileSync(path.join(cliTemplatesDir, file), 'utf8');
    fs.writeFileSync(path.join(cliDir, file), content);
});
```

With:

```js
// 写入 cli 文件（递归支持 planning/ architecture/ 等子目录）
copyRecursiveSync(cliTemplatesDir, cliDir);
```

Also delete the now-unused `cliFiles` variable declaration (line 292):
```js
const cliFiles = fs.existsSync(cliTemplatesDir) ? fs.readdirSync(cliTemplatesDir) : [];
```

- [x] **Step 4: Run test to verify it passes**

```bash
node .evo-lite/cli/test.js 2>&1 | grep -A3 "testInitializerCopiesCliSubdirs"
```

Expected: `✅ testInitializerCopiesCliSubdirs passed`

- [x] **Step 5: Commit**

```bash
git add index.js .evo-lite/cli/test.js
git commit -m "fix(init): use copyRecursiveSync for cli dir — flat loop crashed on planning/ architecture/ subdirs"
```

---

### Task 2: Fix P0 — Test helper EISDIR in createTempTemplateCli

**Context:** `test.js:54-58`, `createTempTemplateCli` flat-copies `TEMPLATE_CLI_DIR` entries with `fs.copyFileSync`. This also hits `planning/` and `architecture/` directories → EISDIR. The `copyRecursive` helper is already defined in the same file (around line 67). Use it.

**Files:**
- Modify: `.evo-lite/cli/test.js:54-58`

- [x] **Step 1: Write failing test**

Add to test.js:

```js
function testCreateTempTemplateCliHandlesSubdirs() {
    // createTempTemplateCli must copy planning/ and architecture/ subdirs without crashing
    let templateRoot;
    try {
        templateRoot = createTempTemplateCli('subdir-test');
    } catch (e) {
        assert.fail(`createTempTemplateCli threw: ${e.message}`);
    }
    assert.ok(fs.existsSync(path.join(templateRoot, 'planning')), 'planning subdir missing in temp template');
    assert.ok(fs.existsSync(path.join(templateRoot, 'architecture')), 'architecture subdir missing in temp template');
    fs.rmSync(templateRoot, { recursive: true, force: true });
    console.log('✅ testCreateTempTemplateCliHandlesSubdirs passed');
}
```

Call it in the sync test section.

- [x] **Step 2: Run to verify failure**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testCreateTempTemplateCli"
```

Expected: EISDIR or assertion failure.

- [x] **Step 3: Replace flat loop in createTempTemplateCli**

In `test.js`, replace the loop inside `createTempTemplateCli` (currently lines 54-58 approx):

```js
for (const file of fs.readdirSync(TEMPLATE_CLI_DIR)) {
    fs.copyFileSync(path.join(TEMPLATE_CLI_DIR, file), path.join(templateRoot, file));
}
```

With:

```js
copyRecursive(TEMPLATE_CLI_DIR, templateRoot);
```

(`copyRecursive` is already defined earlier in the same file and handles directories recursively.)

- [x] **Step 4: Run to verify pass**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testCreateTempTemplateCli"
```

Expected: `✅ testCreateTempTemplateCliHandlesSubdirs passed`

- [x] **Step 5: Sync dogfood copy and commit**

```bash
cp .evo-lite/cli/test.js templates/cli/test.js
git add .evo-lite/cli/test.js templates/cli/test.js
git commit -m "fix(test): use copyRecursive in createTempTemplateCli — flat copyFileSync crashed on subdirs"
```

---

### Task 3: Fix package.json — add `files` whitelist and `test` script

**Context:** Without a `files` field, `npm publish` includes everything in the repo — including `.evo-lite/raw_memory/` dogfood archive files. The `test` script is missing; callers have no standard way to run the test suite.

**Files:**
- Modify: `package.json`

- [x] **Step 1: Verify what npm pack currently includes**

```bash
npm pack --dry-run 2>&1 | head -40
```

Expected: output includes `.evo-lite/` and `raw_memory/` entries (confirming the problem).

- [x] **Step 2: Add `files` whitelist and `test` script to package.json**

Edit `package.json` — add `files` array and `"test"` to scripts:

```json
{
    "name": "create-evo-lite",
    "version": "2.0.9",
    "description": "Project-local governance runtime for AI agents with durable workflow state and local archive tooling.",
    "main": "index.js",
    "bin": {
        "create-evo-lite": "bin/cli.js"
    },
    "files": [
        "bin/",
        "index.js",
        "templates/",
        "docs/",
        "README.md",
        "README_EN.md",
        "LICENSE",
        "package.json"
    ],
    "dependencies": {
        "commander": "^14.0.2",
        "@modelcontextprotocol/sdk": "^1.29.0"
    },
    "scripts": {
        "start": "node ./bin/cli.js",
        "test": "node ./.evo-lite/cli/test.js"
    }
}
```

- [x] **Step 3: Verify pack output is clean**

```bash
npm pack --dry-run 2>&1 | head -40
```

Expected: no `.evo-lite/` entries in the tarball listing.

- [x] **Step 4: Verify test script runs**

```bash
npm test 2>&1 | tail -5
```

Expected: test output ending without unhandled errors.

- [x] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(pkg): add files whitelist (exclude dogfood runtime) and test script"
```

---

### Task 4: Fix template manifest — include planning/ architecture/ and new modules

**Context:** `template-manifest.js` `core-cli` family only lists 9 flat `.js` files. `planning/`, `architecture/`, `dashboard-data.js`, `mcp-server.js`, `mcp-validate.js` are not included. This means `verify --sync` has no awareness of these files — template drift goes undetected.

The manifest's `files` array uses `file.split('/')` to reconstruct relative paths, so `'planning/gaps.js'` correctly resolves to `templates/cli/planning/gaps.js`. No structural change needed, just add entries.

**Files:**
- Modify: `templates/cli/template-manifest.js`

- [x] **Step 1: Write failing test**

Add to test.js:

```js
function testManifestCoversAllCliModules() {
    const { MANAGED_TEMPLATE_FAMILIES } = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
    const coreCliFamily = MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
    assert.ok(coreCliFamily, 'core-cli family not found in manifest');

    const expectedFiles = [
        'planning.js',
        'planning/gaps.js',
        'planning/progress.js',
        'planning/scan.js',
        'planning/trace.js',
        'architecture.js',
        'architecture/scan-native.js',
        'dashboard-data.js',
        'mcp-server.js',
        'mcp-validate.js',
    ];

    for (const f of expectedFiles) {
        assert.ok(
            coreCliFamily.files.includes(f),
            `core-cli manifest missing: ${f}`
        );
    }
    console.log('✅ testManifestCoversAllCliModules passed');
}
```

Check what files actually exist in `templates/cli/planning/` and `templates/cli/architecture/` to complete the expected list before running:

```bash
find templates/cli/planning templates/cli/architecture -name "*.js" | sort
```

Add any missing entries to `expectedFiles`.

- [x] **Step 2: Run to verify failure**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testManifestCovers"
```

Expected: fails listing missing entries.

- [x] **Step 3: Extend core-cli files list**

In `templates/cli/template-manifest.js`, replace the `core-cli` `files` array with:

```js
files: [
    'memory.js',
    'db.js',
    'models.js',
    'memory.service.js',
    'runtime.js',
    'safety.js',
    'inspector.js',
    'recall-rules.js',
    'template-manifest.js',
    'planning.js',
    'planning/gaps.js',
    'planning/progress.js',
    'planning/scan.js',
    'planning/trace.js',
    'architecture.js',
    'architecture/scan-native.js',
    'architecture/infer-modules.js',
    'architecture/provider-contract.js',
    'dashboard-data.js',
    'mcp-server.js',
    'mcp-validate.js',
],
```

Confirm each path by running `find templates/cli/planning templates/cli/architecture -name "*.js"` first and adjust the list to match exactly.

- [x] **Step 4: Run test to verify pass**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testManifestCovers"
```

Expected: `✅ testManifestCoversAllCliModules passed`

- [x] **Step 5: Sync dogfood copy and commit**

```bash
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
git add templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
git commit -m "fix(manifest): add planning/ architecture/ and new cli modules to core-cli sync manifest"
```

---

### Task 5: Fix MCP runtime dependency

**Context:** `index.js:417` installs `better-sqlite3 tar commander` but not `@modelcontextprotocol/sdk`. When a user runs `mem mcp` in a target project, `mcp-server.js` does a top-level `require('@modelcontextprotocol/sdk/...')` which fails. The root `package.json` has the SDK listed (for the dogfood/publish use), but the target project's `.evo-lite/node_modules` doesn't get it.

Fix: add `@modelcontextprotocol/sdk` to the runtime install command.

**Files:**
- Modify: `index.js:417`

- [x] **Step 1: Confirm SDK missing from target projects**

The install command is in `index.js` around line 407-422. Find the line:

```bash
grep -n "npm install better-sqlite3" index.js
```

- [x] **Step 2: Add SDK to runtime install**

Change the install command from:

```js
execSync('npm install better-sqlite3 tar commander', { cwd: evoLiteDir, stdio: 'inherit' });
```

To:

```js
execSync('npm install better-sqlite3 tar commander @modelcontextprotocol/sdk', { cwd: evoLiteDir, stdio: 'inherit' });
```

Also update the log line above it (line ~407) if it lists specific packages, so it mentions the MCP SDK:

```js
console.log('📦 正在从 npm 抓取并编译本地记忆引擎依赖 (better-sqlite3, tar, commander, @modelcontextprotocol/sdk)...');
```

- [x] **Step 3: Verify in a fresh init (smoke test)**

If you can't run a full fresh init, at minimum grep for the SDK in the `.evo-lite/node_modules` of this dogfood project to confirm it's installed, and confirm `mem mcp detect` doesn't throw import errors:

```bash
node .evo-lite/cli/memory.js mcp detect 2>&1 | head -5
```

Expected: output from MCP detect (not a `Cannot find module` error).

- [x] **Step 4: Commit**

```bash
git add index.js
git commit -m "fix(init): add @modelcontextprotocol/sdk to runtime install so mem mcp works in target projects"
```

---

### Task 6: Fix R008 — missing `verified` status check

**Context:** `planning/gaps.js:checkR008` only fires when `status === 'implemented'`. Per spec, tasks with `status === 'verified'` also need the archive evidence check. The current condition also lets through tasks that have `linkedFiles` but no actual archive/evidence, treating `linkedFiles` as sufficient proof of closure.

The reviewer's suggested fix (require archive-specific evidence) is a stronger governance choice. For now, fix only the `verified` gap — the `linkedFiles` gate stays as a deliberate permissive default. Add `status === 'verified'` to the filter.

**Files:**
- Modify: `templates/cli/planning/gaps.js:89-101`

- [x] **Step 1: Write failing test**

Add to test.js (find the planning/gaps tests section, or add a new one):

```js
function testR008FiresOnVerifiedTaskWithNoEvidence() {
    const { MANAGED_TEMPLATE_FAMILIES } = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
    // Load gaps module from template
    const gapsPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps.js');
    delete require.cache[require.resolve(gapsPath)];
    const gaps = require(gapsPath);

    const planIR = {
        tasks: [
            { id: 'task:foo', title: 'Foo', status: 'verified', readOnly: false, evidence: [], linkedFiles: [] },
            { id: 'task:bar', title: 'Bar', status: 'implemented', readOnly: false, evidence: [], linkedFiles: [] },
        ],
    };
    const findings = gaps.checkR008 ? gaps.checkR008(planIR) : [];
    // Both implemented and verified tasks with no evidence should produce R008
    const ids = findings.map(f => f.id);
    assert.ok(ids.some(id => id.includes('task:foo')), 'R008 did not fire on verified task:foo');
    assert.ok(ids.some(id => id.includes('task:bar')), 'R008 did not fire on implemented task:bar');
    console.log('✅ testR008FiresOnVerifiedTaskWithNoEvidence passed');
}
```

Note: `checkR008` must be exported from `gaps.js` for this test to work. Check if it's currently exported; if not, add it to `module.exports` in Step 3.

- [x] **Step 2: Run to verify failure**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testR008"
```

Expected: fails because `verified` task not caught, or `checkR008` not exported.

- [x] **Step 3: Fix checkR008 in gaps.js**

In `templates/cli/planning/gaps.js`, change the `checkR008` filter from:

```js
.filter(t => !t.readOnly &&
    t.status === 'implemented' &&
    (!t.evidence || t.evidence.length === 0) &&
    (!t.linkedFiles || t.linkedFiles.length === 0))
```

To:

```js
.filter(t => !t.readOnly &&
    (t.status === 'implemented' || t.status === 'verified') &&
    (!t.evidence || t.evidence.length === 0) &&
    (!t.linkedFiles || t.linkedFiles.length === 0))
```

If `checkR008` is not in `module.exports` at the bottom of the file, add it:

```js
module.exports = {
    // ... existing exports ...
    checkR008,
};
```

- [x] **Step 4: Run test to verify pass**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testR008"
```

Expected: `✅ testR008FiresOnVerifiedTaskWithNoEvidence passed`

- [x] **Step 5: Sync dogfood copy and commit**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
git commit -m "fix(R008): also fire on verified tasks with no evidence — not just implemented"
```

---

### Task 7: Fix R009 — shallow stale scan misses subdirectory changes

**Context:** `planning/gaps.js:checkR009` calls `check(irPath, sourceDirs, label)`. The inner `check()` function does a shallow `readdirSync` — it reads entries from each source dir and checks mtime, but only at one level deep. Changes in `templates/cli/planning/scan.js` or `templates/cli/architecture/scan-native.js` will not trigger the architecture IR stale warning.

Additionally, the architecture `sourceDirs` is just `['templates/cli']` — missing `.agents/rules`, `.agents/workflows`, `index.js`, `bin/cli.js`.

**Files:**
- Modify: `templates/cli/planning/gaps.js` (R009 function, ~lines 104-148)

- [x] **Step 1: Write failing test**

```js
function testR009DetectsSubdirChanges() {
    const os = require('os');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-r009-'));

    // Set up minimal structure: architecture IR + a nested source file
    const genDir = path.join(tmpRoot, '.evo-lite', 'generated', 'architecture');
    fs.mkdirSync(genDir, { recursive: true });
    const irPath = path.join(genDir, 'architecture-ir.json');
    fs.writeFileSync(irPath, '{}');

    // Put a nested file with a future mtime
    const nestedSource = path.join(tmpRoot, 'templates', 'cli', 'planning', 'scan.js');
    fs.mkdirSync(path.dirname(nestedSource), { recursive: true });
    fs.writeFileSync(nestedSource, '// new');

    // Force irPath to be older than nestedSource
    const oldTime = new Date(Date.now() - 10000);
    fs.utimesSync(irPath, oldTime, oldTime);

    const gapsPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps.js');
    delete require.cache[require.resolve(gapsPath)];
    const gaps = require(gapsPath);
    const findings = gaps.checkR009 ? gaps.checkR009(tmpRoot) : [];

    fs.rmSync(tmpRoot, { recursive: true, force: true });

    const r009Arch = findings.filter(f => f.id && f.id.startsWith('R009:architecture'));
    assert.ok(r009Arch.length > 0, 'R009 did not fire — nested templates/cli/planning/scan.js change not detected');
    console.log('✅ testR009DetectsSubdirChanges passed');
}
```

Export `checkR009` from `gaps.js` for this test.

- [x] **Step 2: Run to verify failure**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testR009"
```

Expected: R009 not detected (shallow scan misses subdirs).

- [x] **Step 3: Make R009 check() recursive; expand architecture sourceDirs**

In `templates/cli/planning/gaps.js`, replace `checkR009` with:

```js
function checkR009(projectRoot) {
    const findings = [];

    function newerFileIn(absDir, recursive) {
        if (!fs.existsSync(absDir)) return null;
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
            const abs = path.join(absDir, entry.name);
            if (entry.isDirectory()) {
                if (recursive) {
                    const inner = newerFileIn(abs, true);
                    if (inner) return inner;
                }
            } else {
                return abs; // return path — caller will check mtime
            }
        }
        return null;
    }

    function checkNewerThan(irMtime, absPath) {
        if (!fs.existsSync(absPath)) return false;
        const stat = fs.statSync(absPath);
        if (stat.isFile()) return stat.mtimeMs > irMtime;
        // directory: check all files recursively
        for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
            const child = path.join(absPath, entry.name);
            if (checkNewerThan(irMtime, child)) return true;
        }
        return false;
    }

    function check(irPath, sourcePaths, label) {
        if (!fs.existsSync(irPath)) return;
        const irMtime = fs.statSync(irPath).mtimeMs;
        for (const src of sourcePaths) {
            const abs = path.resolve(projectRoot, src);
            if (checkNewerThan(irMtime, abs)) {
                findings.push({
                    id: `R009:${label}`, rule: 'R009', scope: 'planning', level: 'info',
                    type: 'stale-ir',
                    message: `${label} IR is stale — ${src} is newer`,
                    evidence: [path.relative(projectRoot, irPath).replace(/\\/g, '/')],
                    suggestedAction: label === 'plan' ? 'Run: mem plan scan' : 'Run: mem architecture scan',
                });
                return;
            }
        }
    }

    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
        ['docs/specs', 'docs/plans', 'docs/superpowers/specs', 'docs/superpowers/plans'],
        'plan'
    );
    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json'),
        ['templates/cli', '.agents/rules', '.agents/workflows', 'index.js', 'bin/cli.js'],
        'architecture'
    );
    return findings;
}
```

If `checkR009` is not in `module.exports`, add it.

- [x] **Step 4: Run test to verify pass**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testR009"
```

Expected: `✅ testR009DetectsSubdirChanges passed`

- [x] **Step 5: Sync dogfood copy and commit**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
git commit -m "fix(R009): recursive stale scan + expand architecture sourcePaths to cover subdirs and root entry"
```

---

### Task 8: Fix archiveHits — scan file content instead of filename

**Context:** `planning/progress.js:checkArchiveHits` matches `taskId` against raw_memory **filenames**. Archive filenames are `mem_<timestamp>_<commit>_<random>.md` — no task slug ever appears in them, so `archiveHits` is always 0.

Fix: scan file **content** for the task ID or slug. This doesn't require a write-path change — any archive entry that mentions the task ID in its text will count as a hit. Performance is fine: raw_memory files are small markdown documents.

**Files:**
- Modify: `templates/cli/planning/progress.js:30-37`

- [x] **Step 1: Write failing test**

```js
function testArchiveHitsFindsContentMatch() {
    const os = require('os');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-archivehit-'));
    const rawDir = path.join(tmpRoot, '.evo-lite', 'raw_memory');
    fs.mkdirSync(rawDir, { recursive: true });

    // Write a raw_memory file that MENTIONS the task ID in its content
    fs.writeFileSync(
        path.join(rawDir, 'mem_20260616_abc123_xyz.md'),
        'Completed work on task:dashboard-builder. All done.'
    );

    const progressPath = path.join(TEMPLATE_CLI_DIR, 'planning', 'progress.js');
    delete require.cache[require.resolve(progressPath)];
    // We need checkArchiveHits — export it or test indirectly
    const { checkArchiveHits } = require(progressPath);
    assert.ok(typeof checkArchiveHits === 'function', 'checkArchiveHits not exported');

    const hits = checkArchiveHits('task:dashboard-builder', tmpRoot);
    assert.strictEqual(hits, 1, `Expected 1 hit, got ${hits}`);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log('✅ testArchiveHitsFindsContentMatch passed');
}
```

- [x] **Step 2: Run to verify failure**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testArchiveHits"
```

Expected: fails (hits = 0, because current code only checks filenames).

- [x] **Step 3: Fix checkArchiveHits to scan content**

In `templates/cli/planning/progress.js`, replace `checkArchiveHits`:

```js
function checkArchiveHits(taskId, projectRoot) {
    const rawDir = path.join(projectRoot, '.evo-lite', 'raw_memory');
    if (!fs.existsSync(rawDir)) return 0;
    const slug = taskId.replace(/^task:/, '');
    if (!slug) return 0;

    let hits = 0;
    for (const fname of fs.readdirSync(rawDir)) {
        if (!fname.endsWith('.md')) continue;
        try {
            const content = fs.readFileSync(path.join(rawDir, fname), 'utf8');
            if (content.includes(taskId) || content.includes(slug)) {
                hits++;
            }
        } catch (_) { /* skip unreadable files */ }
    }
    return hits;
}
```

Export `checkArchiveHits` from `progress.js` for testability:

```js
module.exports = {
    // ... existing exports ...
    checkArchiveHits,
};
```

- [x] **Step 4: Run test to verify pass**

```bash
node .evo-lite/cli/test.js 2>&1 | grep "testArchiveHits"
```

Expected: `✅ testArchiveHitsFindsContentMatch passed`

- [x] **Step 5: Sync dogfood copy and commit**

```bash
cp templates/cli/planning/progress.js .evo-lite/cli/planning/progress.js
git add templates/cli/planning/progress.js .evo-lite/cli/planning/progress.js
git commit -m "fix(archiveHits): scan raw_memory file content not filenames — filename has no task slug"
```

---

## Self-Review

**Spec coverage check:**
- ✅ P0 EISDIR initializer → Task 1
- ✅ P0 test helper EISDIR → Task 2
- ✅ npm files + test script → Task 3
- ✅ Manifest coverage → Task 4
- ✅ MCP runtime dep → Task 5
- ✅ R008 verified gap → Task 6
- ✅ R009 shallow scan → Task 7
- ✅ archiveHits filename → Task 8
- ⚠️ Architecture scanner WALK_TARGETS root files (`index.js`, `bin/cli.js`) — not a separate task because Task 7's R009 fix adds these paths to the stale-check sourcePaths. The `scan-native.js` WALK_TARGETS is separate (used for IR content generation, not stale detection). Reviewer flagged it — but its impact is that architecture-ir.json misses the scaffold entry in the generated symbol list, which is a completeness issue, not a correctness bug. Deferring to a follow-on task to keep this PR bounded.

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:** `checkR008`, `checkR009`, `checkArchiveHits` — export names are consistent across task descriptions.

**Dogfood sync reminder:** Every template edit requires a copy to `.evo-lite/cli/`. Each task's Step 5 includes the copy command explicitly.
