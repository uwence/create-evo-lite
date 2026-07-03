# Mother-Child Hive — Registry + Nurture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mother hive a child registry and a `mem hive` command group (register / list / status / nurture) that pushes managed gene families into registered children safely — genes only, preflight all-or-nothing, family filter, anchor-merge, git-tag rollback, child receipt, dependency report — plus child-mode test-harness portability.

**Architecture:** New `cli/hive/` module family (registry / status / nurture / commands) mirrors the proven `verification/` layout. Nurture is `sync-runtime`'s copy loop with a **split root** (source = mother `templates/`, destination = child), reusing `buildManagedTemplateEntries` so the gene boundary has one source of truth. Git operations (dirty check, rollback tag) go through an injected `exec` like `engine.js`'s injected `gitDiff`. Unit tests inject synthetic families (`familiesOverride`) + fake exec; the real full-manifest path is exercised by the Task 6 capstone against the real child `hungersnakegame4`.

**Tech Stack:** Node.js >=20, CommonJS, commander (already wired in `memory.js`), hand-rolled governance test suite (`cli/test/governance.js`), no new dependencies.

## Global Constraints

- **Double mirror:** every `cli/` file exists in BOTH `templates/cli/` (source) and `.evo-lite/cli/` (live mirror), byte-identical. Every create/modify in this plan happens in BOTH trees. `npm test` runs `node ./.evo-lite/cli/test.js`.
- **Node floor:** `>=20.0.0`; CommonJS only (`require`/`module.exports`), no ESM.
- **Genes only, never state:** nurture may write only files produced from `MANAGED_TEMPLATE_FAMILIES`; `active_context.md`, `memory.db`, `raw_memory/`, `index_memory/` in a child must never be written.
- **All-or-nothing:** preflight verifies every selected source file exists BEFORE the first byte is written to the child; any missing source aborts with zero writes.
- **No interactive prompts:** the CLI runs headless (agent/hook/CI); never `readline`/prompt. Refusals are non-zero exits with clear messages.
- **Mother-only guard:** every `mem hive` subcommand refuses (non-zero, zero writes) when `templates/cli` is absent from the workspace root.
- **No auto-install:** dependency gaps are reported by name with an explicit `npm install` instruction; never run npm in the child.
- **Manifest registration order:** create new `hive/*.js` files in BOTH mirrors first; register them in `template-manifest.js` only in Task 6 (self-brick avoidance).
- **Timestamps:** use `new Date().toISOString()`; accept an optional `now` injection in library functions so tests can pin time.
- **Behavior preservation:** `node ./.evo-lite/cli/test.js governance` and full `node ./.evo-lite/cli/test.js` stay green after every task.

---

### Task 1: Manifest object-form entries (`mergeAnchors` passthrough)

Allow a family's `files` array entry to be either a plain string (pure gene, today's behavior) or an object `{ path, mergeAnchors }`. `buildEntry` normalizes; existing callers see identical output for string entries.

**Files:**
- Modify: `templates/cli/template-manifest.js` (buildEntry + no family changes)
- Modify: `.evo-lite/cli/template-manifest.js` (identical)
- Test: `templates/cli/test/governance.js` + `.evo-lite/cli/test/governance.js` (new T-hive-manifest block)

**Interfaces:**
- Produces: `buildEntry(family, file, paths)` accepts `file: string | { path: string, mergeAnchors?: [string,string][] }` and returns the existing entry shape plus `mergeAnchors: array` (empty array for string/plain entries). `buildManagedTemplateEntries` passes objects through unchanged.

- [ ] **Step 1: Write the failing test** — append to `runGovernanceTests` in `test/governance.js` (both mirrors), before the closing success log, following the T-precision block style:

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `buildEntry must be exported` (buildEntry is currently module-private).

- [ ] **Step 3: Implement** — in `template-manifest.js` (both mirrors) replace `buildEntry` and export it:

```javascript
function buildEntry(family, file, paths) {
    const spec = typeof file === 'string' ? { path: file } : file;
    const relativeParts = [...family.relativeDir, ...spec.path.split('/')];
    const label = path.posix.join(...relativeParts);
    const activeBase = family.activeRoot === 'cli' ? paths.activeCliDir : paths.workspaceRoot;
    const templateBase = family.templateRoot === 'cli' ? paths.templateCliPath : paths.templateRootPath;

    return {
        family: family.key,
        scope: family.scope,
        label,
        mergeAnchors: Array.isArray(spec.mergeAnchors) ? spec.mergeAnchors : [],
        activeFile: path.join(activeBase, ...relativeParts),
        templateFile: path.join(templateBase, ...relativeParts),
    };
}
```

and add `buildEntry` to `module.exports`. No family declares an object entry yet (mechanism ships dormant).

- [ ] **Step 4: Run to verify pass** — `node ./.evo-lite/cli/test.js governance` → all ✅ incl `✅ T-hive-manifest`, exit 0. Then full suite `node ./.evo-lite/cli/test.js` → green.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(manifest): object-form file entries with mergeAnchors passthrough"
```

---

### Task 2: Harness child-mode portability

Embedded context-fixture fallback + `IS_CHILD_RUNTIME` export + suite-entry child gate in `governance.js`.

**Files:**
- Modify: `templates/cli/test/harness.js` + `.evo-lite/cli/test/harness.js`
- Modify: `templates/cli/test/governance.js` + `.evo-lite/cli/test/governance.js`

**Interfaces:**
- Produces (harness exports, appended to the existing export list): `IS_CHILD_RUNTIME: boolean` (true when `templates/cli` is absent from `WORKSPACE_ROOT`), `loadContextTemplate(contextPath): string` (reads the file when present, else returns `EMBEDDED_CONTEXT_FIXTURE`), `EMBEDDED_CONTEXT_FIXTURE: string`.
- Consumes: Task 5's hive tests are child-safe (they build their own temp fixtures) and run inside the child-mode subset.

- [ ] **Step 1: Write the failing test** — append to `runGovernanceTests` (both mirrors):

```javascript
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
```

- [ ] **Step 2: Run to verify it fails** — `node ./.evo-lite/cli/test.js governance` → FAIL `IS_CHILD_RUNTIME exported`.

- [ ] **Step 3: Implement in `harness.js` (both mirrors)** — after the `INIT_ENTRY` const add:

```javascript
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
```

In `createTempRuntimeRoot`, replace the unconditional read:

```javascript
    const template = loadContextTemplate(TEMPLATE_CONTEXT_PATH)
        .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
```

Append `IS_CHILD_RUNTIME, loadContextTemplate, EMBEDDED_CONTEXT_FIXTURE` to `module.exports`.

- [ ] **Step 4: Add the suite-entry child gate in `governance.js` (both mirrors)** — at the very top of `runGovernanceTests`, before the first T13 block:

```javascript
    const { IS_CHILD_RUNTIME } = require('./harness');
    if (IS_CHILD_RUNTIME) {
        console.log('⏭️ skipped (child runtime): T13–T27, T-precision, T-hive-manifest, T-hive-portable — mother-bound (need templates/ tree)');
        await runChildRuntimeTests();
        console.log('--- Governance-focused CLI tests passed! (child mode) ---');
        return;
    }
```

and add (module level, below `runGovernanceTests`) the child-safe subset holder — this task ships it empty; Tasks 3–5 add their runtime-local hive tests to it:

```javascript
// Tests safe to run inside a child hive: they build their own temp mother/child
// fixtures and never touch the repo's templates/ tree. Tasks 3-5 append here.
async function runChildRuntimeTests() {
    console.log('(child-safe hive tests run here)');
}
```

Export nothing new from governance.js (`module.exports = { runGovernanceTests };` unchanged).

- [ ] **Step 5: Verify** — `node ./.evo-lite/cli/test.js governance` → all ✅ incl `✅ T-hive-portable` (mother path: gate not taken). Full suite green. Child-mode smoke: `cd $TMP && mkdir evo-child-smoke && cd evo-child-smoke && node D:/Data/ProjectAgent/create-evo-lite/.evo-lite/cli/test.js governance` is NOT valid (harness anchors WORKSPACE_ROOT to the mother by `__dirname`) — child-mode execution is exercised for real in Task 6's capstone from inside `hungersnakegame4`; here just assert the gate code path exists (mother run stays green).

- [ ] **Step 6: Commit**

```bash
git add templates/cli/test/harness.js .evo-lite/cli/test/harness.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(test): child-runtime portability — embedded context fixture + IS_CHILD_RUNTIME suite gate"
```

---

### Task 3: `hive/registry.js` + `hive/commands.js` (register / list, mother-only guard, wiring, gitignore)

**Files:**
- Create: `templates/cli/hive/registry.js` + `.evo-lite/cli/hive/registry.js`
- Create: `templates/cli/hive/commands.js` + `.evo-lite/cli/hive/commands.js`
- Modify: `templates/cli/memory.js` + `.evo-lite/cli/memory.js` (one require line)
- Modify: `.gitignore` (hive allowlist)
- Test: `test/governance.js` both mirrors (T-hive-registry inside `runChildRuntimeTests`, invoked from the mother path too)

**Interfaces:**
- Produces `registry.js`: `validChildId(id) → boolean` (`/^[a-z0-9._-]+$/i` and no `..` substring); `registryPath(root) → <root>/.evo-lite/hive/children.json`; `readRegistry(root) → { version:'evo-hive-registry@1', children:[] }` (default when absent); `writeRegistry(root, reg)`; `registerChild(root, childPath, { id, now } = {}) → entry` — validates `childPath/.evo-lite/cli` and `childPath/.evo-lite/package.json` exist, id defaults to `path.basename(childPath)`, upserts `{ id, path, registeredAt, lastNurturedAt: null, lastNurturedVersion: null }` (upsert preserves existing nurture fields, refreshes path), throws `Error` with a clear message on invalid id / non-child path; `findChild(root, id) → entry | null`.
- Produces `commands.js`: `isMotherRoot(root) → boolean` (`fs.existsSync(path.join(root, 'templates', 'cli'))`); `registerHiveCommands(program)` wiring `hive register <path> [--id <id>] [--json]`, `hive list [--json]`; each action resolves `getWorkspaceRoot()` (same import style as `planning.js`), and when `!isMotherRoot(root)` prints `this is a child hive — run hive commands from the mother` to stderr and sets `process.exitCode = 1` **before touching any file**.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test** — replace the body of `runChildRuntimeTests` (both mirrors) with the shared child-safe block, and call it from the mother path too by inserting `await runChildRuntimeTests();` immediately before the final success `console.log` of `runGovernanceTests`:

```javascript
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
        assert.strictEqual(isMotherRoot(WORKSPACE_ROOT), true, 'this repo is a mother');
        const notMother = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hive-notmother-'));
        assert.strictEqual(isMotherRoot(notMother), false, 'dir without templates/cli is not a mother');
    }
    console.log('✅ T-hive-guard passed');
}
```

Note: in child mode `isMotherRoot(WORKSPACE_ROOT)` is false — guard that first assertion with `if (!IS_CHILD_RUNTIME)` using the harness import already present at the top of the suite: `if (!require('./harness').IS_CHILD_RUNTIME) assert.strictEqual(isMotherRoot(WORKSPACE_ROOT), true, 'this repo is a mother');`.

- [ ] **Step 2: Run to verify it fails** — `node ./.evo-lite/cli/test.js governance` → FAIL `Cannot find module '...hive/registry.js'`.

- [ ] **Step 3: Implement `hive/registry.js` (both mirrors)**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

// Same shape of guard as evidence-store.evidenceSlug: the id lands in filenames
// and registry keys, so it must never carry a path separator or `..`.
function validChildId(id) {
    return typeof id === 'string' && /^[a-z0-9._-]+$/i.test(id) && !id.includes('..');
}

function hiveDir(root) {
    return path.join(root, '.evo-lite', 'hive');
}

function registryPath(root) {
    return path.join(hiveDir(root), 'children.json');
}

function readRegistry(root) {
    const fp = registryPath(root);
    if (!fs.existsSync(fp)) {
        return { version: 'evo-hive-registry@1', children: [] };
    }
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeRegistry(root, registry) {
    const fp = registryPath(root);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(registry, null, 2) + '\n');
    return fp;
}

function findChild(root, id) {
    return readRegistry(root).children.find(c => c.id === id) || null;
}

function registerChild(root, childPath, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const resolved = path.resolve(childPath);
    const id = options.id || path.basename(resolved);
    if (!validChildId(id)) {
        throw new Error(`invalid child id: ${id} (allowed: letters, digits, . _ -, no "..")`);
    }
    if (!fs.existsSync(path.join(resolved, '.evo-lite', 'cli')) ||
        !fs.existsSync(path.join(resolved, '.evo-lite', 'package.json'))) {
        throw new Error(`not an evo-lite child (needs .evo-lite/cli and .evo-lite/package.json): ${resolved}`);
    }
    const registry = readRegistry(root);
    const existing = registry.children.find(c => c.id === id);
    if (existing) {
        existing.path = resolved.replace(/\\/g, '/');
    } else {
        registry.children.push({
            id,
            path: resolved.replace(/\\/g, '/'),
            registeredAt: now(),
            lastNurturedAt: null,
            lastNurturedVersion: null,
        });
    }
    writeRegistry(root, registry);
    return registry.children.find(c => c.id === id);
}

module.exports = { validChildId, hiveDir, registryPath, readRegistry, writeRegistry, registerChild, findChild };
```

- [ ] **Step 4: Implement `hive/commands.js` (both mirrors)** — register/list only in this task (status/nurture subcommands added by Tasks 4/5):

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../runtime');
const registry = require('./registry');

function isMotherRoot(root) {
    return fs.existsSync(path.join(root, 'templates', 'cli'));
}

function requireMother(root) {
    if (!isMotherRoot(root)) {
        console.error('this is a child hive — run hive commands from the mother');
        process.exitCode = 1;
        return false;
    }
    return true;
}

function registerHiveCommands(program) {
    const hive = program.command('hive').description('Mother-child hive: registry, status, and gene nurture.');

    hive.command('register <childPath>')
        .description('Register an evo-lite child project into the mother registry.')
        .option('--id <id>', 'Child id (defaults to directory basename)')
        .option('--json', 'Print JSON output')
        .action((childPath, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            try {
                const entry = registry.registerChild(root, childPath, { id: options.id });
                if (options.json) console.log(JSON.stringify(entry, null, 2));
                else console.log(`✅ registered child: ${entry.id} → ${entry.path}`);
            } catch (error) {
                console.error(`❌ ${error.message}`);
                process.exitCode = 1;
            }
        });

    hive.command('list')
        .description('List registered children with version and last-nurture info.')
        .option('--json', 'Print JSON output')
        .action(options => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const reg = registry.readRegistry(root);
            if (options.json) { console.log(JSON.stringify(reg, null, 2)); return; }
            if (reg.children.length === 0) { console.log('no children registered'); return; }
            for (const c of reg.children) {
                console.log(`${c.id}  ${c.path}  nurtured=${c.lastNurturedVersion || 'never'} (${c.lastNurturedAt || '-'})`);
            }
        });

    return hive;
}

module.exports = { isMotherRoot, requireMother, registerHiveCommands };
```

- [ ] **Step 5: Wire into `memory.js` (both mirrors)** — next to the existing group registrations (`require('./verification/commands').registerVerificationCommands(program);` at ~line 689) add:

```javascript
    require('./hive/commands').registerHiveCommands(program);
```

- [ ] **Step 6: Gitignore allowlist** — in the mother root `.gitignore`, after the `!.evo-lite/verification/**/*.json` line add:

```
!.evo-lite/hive/
!.evo-lite/hive/**/*.json
```

- [ ] **Step 7: Verify** — `node ./.evo-lite/cli/test.js governance` → ✅ incl T-hive-registry + T-hive-guard. CLI smoke: `node ./.evo-lite/cli/memory.js hive list` → `no children registered`, exit 0. Full suite green.

- [ ] **Step 8: Commit**

```bash
git add templates/cli/hive .evo-lite/cli/hive templates/cli/memory.js .evo-lite/cli/memory.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js .gitignore
git commit -m "feat(hive): child registry + mem hive register/list with mother-only guard"
```

---

### Task 4: `hive/status.js` (up-to-date | behind | drifted | unreachable)

**Files:**
- Create: `templates/cli/hive/status.js` + `.evo-lite/cli/hive/status.js`
- Modify: `templates/cli/hive/commands.js` + `.evo-lite/cli/hive/commands.js` (add `hive status`)
- Test: `test/governance.js` both mirrors (extend `runChildRuntimeTests`)

**Interfaces:**
- Consumes: `registry.readRegistry/findChild` (Task 3), `template-manifest.buildManagedTemplateEntries` (Task 1 shape).
- Produces: `childEntries(motherRoot, childRoot, { family } = {}) → entry[]` — the split-root entry builder shared with nurture: filters `MANAGED_TEMPLATE_FAMILIES` by optional family key (unknown key throws), then `buildManagedTemplateEntries({ workspaceRoot: childRoot, activeCliDir: path.join(childRoot,'.evo-lite','cli'), templateRootPath: path.join(motherRoot,'templates'), templateCliPath: path.join(motherRoot,'templates','cli'), scopes: ['sync-always'] })` with the filtered families (accepts `familiesOverride` for tests). `childStatus(motherRoot, entry, { familiesOverride } = {}) → { id, status, motherVersion, childVersion, driftedFiles }` with precedence `unreachable > drifted > behind > up-to-date`; `hiveStatus(motherRoot, { id, familiesOverride } = {}) → result[]` — iterates the registry, never throws on one unreachable child.
- `motherVersion` = `JSON.parse(fs.readFileSync(path.join(motherRoot,'package.json'))).version`; `childVersion` = same from `<child>/.evo-lite/package.json` (null when unreadable).
- Note: `buildManagedTemplateEntries` reads the global `MANAGED_TEMPLATE_FAMILIES`; to support family filtering + override, `childEntries` maps the (filtered) families itself via `buildEntry` rather than calling `buildManagedTemplateEntries` — same output shape, one loop.

- [ ] **Step 1: Write the failing test** — append inside `runChildRuntimeTests` (both mirrors):

```javascript
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
```

- [ ] **Step 2: Run to verify it fails** — governance scope → FAIL `Cannot find module '...hive/status.js'`.

- [ ] **Step 3: Implement `hive/status.js` (both mirrors)**

```javascript
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('../template-manifest');
const { readRegistry } = require('./registry');

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readVersion(pkgPath) {
    try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null; }
    catch { return null; }
}

// Split-root managed entries: source = mother templates/, destination = child.
function childEntries(motherRoot, childRoot, options = {}) {
    const families = options.familiesOverride || manifest.MANAGED_TEMPLATE_FAMILIES;
    const selected = options.family ? families.filter(f => f.key === options.family) : families;
    if (options.family && selected.length === 0) {
        throw new Error(`unknown managed family: ${options.family}`);
    }
    const paths = {
        workspaceRoot: childRoot,
        activeCliDir: path.join(childRoot, '.evo-lite', 'cli'),
        templateRootPath: path.join(motherRoot, 'templates'),
        templateCliPath: path.join(motherRoot, 'templates', 'cli'),
    };
    return selected
        .filter(f => f.scope === 'sync-always')
        .flatMap(f => f.files.map(file => manifest.buildEntry(f, file, paths)));
}

function childStatus(motherRoot, entry, options = {}) {
    const motherVersion = readVersion(path.join(motherRoot, 'package.json'));
    if (!fs.existsSync(path.join(entry.path, '.evo-lite'))) {
        return { id: entry.id, status: 'unreachable', motherVersion, childVersion: null, driftedFiles: [] };
    }
    const childVersion = readVersion(path.join(entry.path, '.evo-lite', 'package.json'));
    const driftedFiles = [];
    for (const e of childEntries(motherRoot, entry.path, options)) {
        if (!fs.existsSync(e.templateFile)) continue; // mother-side gap is nurture's preflight problem
        if (!fs.existsSync(e.activeFile)) { driftedFiles.push(e.label); continue; }
        if (sha256(fs.readFileSync(e.templateFile)) !== sha256(fs.readFileSync(e.activeFile))) {
            driftedFiles.push(e.label);
        }
    }
    let status = 'up-to-date';
    if (driftedFiles.length) status = 'drifted';
    else if (childVersion !== motherVersion) status = 'behind';
    return { id: entry.id, status, motherVersion, childVersion, driftedFiles };
}

function hiveStatus(motherRoot, options = {}) {
    const reg = readRegistry(motherRoot);
    const children = options.id ? reg.children.filter(c => c.id === options.id) : reg.children;
    return children.map(c => childStatus(motherRoot, c, options));
}

module.exports = { childEntries, childStatus, hiveStatus, sha256 };
```

- [ ] **Step 4: Add `hive status` to `commands.js` (both mirrors)** — inside `registerHiveCommands`:

```javascript
    hive.command('status [id]')
        .description('Compare each registered child against the mother genes and version.')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const results = require('./status').hiveStatus(root, { id });
            if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
            if (results.length === 0) { console.log(id ? `unknown child: ${id}` : 'no children registered'); process.exitCode = id ? 1 : 0; return; }
            for (const r of results) {
                const detail = r.status === 'behind' ? ` (${r.childVersion} → ${r.motherVersion})`
                    : r.status === 'drifted' ? ` (${r.driftedFiles.join(', ')})` : '';
                console.log(`${r.id}: ${r.status}${detail}`);
            }
        });
```

- [ ] **Step 5: Verify** — governance scope ✅ incl T-hive-status; full suite green; smoke `node ./.evo-lite/cli/memory.js hive status` → `no children registered`.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hive .evo-lite/cli/hive templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(hive): per-child status — up-to-date/behind/drifted/unreachable"
```

---

### Task 5: `hive/nurture.js` (split-root gene push)

The core. Preflight (mother-only sources check, dirty check, rollback tag) → dry-run/check reporting → apply (anchor-merge copy, child lock, child receipt, version bump, mother registry update) → dependency report.

**Files:**
- Create: `templates/cli/hive/nurture.js` + `.evo-lite/cli/hive/nurture.js`
- Modify: `templates/cli/hive/commands.js` + `.evo-lite/cli/hive/commands.js` (add `hive nurture`)
- Test: `test/governance.js` both mirrors (extend `runChildRuntimeTests`)

**Interfaces:**
- Consumes: `childEntries` + `sha256` (Task 4), `registry.readRegistry/writeRegistry/findChild` (Task 3), `buildEntry.mergeAnchors` (Task 1).
- Produces: `mergeAnchoredContent(motherText, childText, anchorPairs) → string` — for each `[BEGIN, END]` pair, when the child text contains `<!-- BEGIN --> … <!-- END -->`, the merged output keeps the mother's body but carries the child's inter-anchor region; pairs missing in the child fall through to the mother's region.
- Produces: `nurtureChild(motherRoot, entry, opts = {}) → report` with `opts: { family, dryRun, check, force, exec, now, familiesOverride }` and `report: { status: 'applied'|'dry-run'|'refused'|'aborted'|'unreachable', copied: [], skipped: [], missingSources: [], dirtyFiles: [], depGap: { missing: [], versionDiffs: [] }, tag: string|null, receiptPath: string|null, upToDate: boolean }`. `opts.exec` defaults to a `child_process.execFileSync('git', args, { cwd })` wrapper `exec(args, cwd) → string`; throws → treated as "not a git repo".
- Receipt shape: `{ version: 'evo-hive-receipt@1', motherVersion, families: [keys], files: [labels], nurturedAt }` at `<child>/.evo-lite/hive/nurture-received.json`.
- Child lock: same `evo-runtime-mirror@1` shape as `sync-runtime`, written to `<child>/.evo-lite/generated/runtime-mirror.lock.json` with checksums over ALL selected entries.

- [ ] **Step 1: Write the failing tests** — append inside `runChildRuntimeTests` (both mirrors):

```javascript
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
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(c1, '.evo-lite', 'package.json'), 'utf8')).version, '9.9.9', 'child version bumped');
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
    const tagged = nurtureChild(m4, { id: 'k4', path: c4 }, { exec: cleanGit, familiesOverride: FAM });
    assert.strictEqual(tagged.status, 'applied');
    assert.strictEqual(tagged.tag, 'evo-nurture-pre-9.9.9');
    assert.ok(cleanCalls.some(c => c.startsWith('tag -a evo-nurture-pre-9.9.9')), 'rollback tag created');
}
console.log('✅ T-hive-nurture passed');
```

- [ ] **Step 2: Run to verify it fails** — governance scope → FAIL `Cannot find module '...hive/nurture.js'`.

- [ ] **Step 3: Implement `hive/nurture.js` (both mirrors)**

```javascript
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { childEntries, sha256 } = require('./status');
const registry = require('./registry');

function defaultExec(args, cwd) {
    return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function readJson(fp) {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// Anchor names are [A-Z0-9_]; markers are `<!-- NAME -->` — no regex escaping needed.
function mergeAnchoredContent(motherText, childText, anchorPairs) {
    let merged = motherText;
    for (const [begin, end] of anchorPairs || []) {
        const re = new RegExp(`(<!-- ${begin} -->)([\\s\\S]*?)(<!-- ${end} -->)`);
        const childMatch = childText.match(re);
        if (!childMatch) continue;
        merged = merged.replace(re, (_m, b, _mid, e) => b + childMatch[2] + e);
    }
    return merged;
}

function diffRuntimeDeps(motherRoot, childRoot) {
    const gap = { missing: [], versionDiffs: [] };
    const motherPkgPath = path.join(motherRoot, 'templates', 'runtime', 'package.json');
    const childPkgPath = path.join(childRoot, '.evo-lite', 'package.json');
    if (!fs.existsSync(motherPkgPath) || !fs.existsSync(childPkgPath)) return gap;
    const motherDeps = readJson(motherPkgPath).dependencies || {};
    const childDeps = readJson(childPkgPath).dependencies || {};
    for (const [name, range] of Object.entries(motherDeps)) {
        if (!(name in childDeps)) gap.missing.push(name);
        else if (childDeps[name] !== range) gap.versionDiffs.push({ name, mother: range, child: childDeps[name] });
    }
    return gap;
}

function nurtureChild(motherRoot, entry, opts = {}) {
    const now = opts.now || (() => new Date().toISOString());
    const exec = opts.exec || defaultExec;
    const childRoot = entry.path;
    const report = {
        status: null, copied: [], skipped: [], missingSources: [], dirtyFiles: [],
        depGap: { missing: [], versionDiffs: [] }, tag: null, receiptPath: null, upToDate: false,
    };

    if (!fs.existsSync(path.join(childRoot, '.evo-lite'))) {
        report.status = 'unreachable';
        return report;
    }

    const entries = childEntries(motherRoot, childRoot, { family: opts.family, familiesOverride: opts.familiesOverride });
    const motherVersion = readJson(path.join(motherRoot, 'package.json')).version;

    // --- Preflight 1: every source must exist BEFORE any write (all-or-nothing) ---
    report.missingSources = entries.filter(e => !fs.existsSync(e.templateFile)).map(e => e.label);
    if (report.missingSources.length) {
        report.status = 'aborted';
        return report;
    }

    // --- Plan the copy set (and dep gap) — pure reads ---
    const planned = [];
    const checksums = {};
    for (const e of entries) {
        const motherBytes = fs.readFileSync(e.templateFile);
        let targetBytes = motherBytes;
        const childExists = fs.existsSync(e.activeFile);
        if (e.mergeAnchors && e.mergeAnchors.length && childExists) {
            const mergedText = mergeAnchoredContent(motherBytes.toString('utf8'),
                fs.readFileSync(e.activeFile, 'utf8'), e.mergeAnchors);
            targetBytes = Buffer.from(mergedText, 'utf8');
        }
        const targetHash = sha256(targetBytes);
        const relActive = path.relative(childRoot, e.activeFile).replace(/\\/g, '/');
        checksums[relActive] = targetHash;
        if (childExists && sha256(fs.readFileSync(e.activeFile)) === targetHash) {
            report.skipped.push(e.label);
        } else {
            planned.push({ entry: e, bytes: targetBytes });
            report.copied.push(e.label);
        }
    }
    report.depGap = diffRuntimeDeps(motherRoot, childRoot);
    report.upToDate = report.copied.length === 0 && report.depGap.missing.length === 0;

    if (opts.dryRun || opts.check) {
        report.status = 'dry-run';
        return report;
    }

    // --- Preflight 2: dirty check + rollback tag (git; injectable) ---
    let gitAvailable = true;
    try {
        const managedRel = entries.map(e => path.relative(childRoot, e.activeFile).replace(/\\/g, '/'));
        const porcelain = exec(['status', '--porcelain', '--', ...managedRel], childRoot);
        report.dirtyFiles = String(porcelain).split('\n').filter(Boolean).map(l => l.slice(3));
    } catch {
        gitAvailable = false;
    }
    if (!gitAvailable && !opts.force) {
        report.status = 'refused';
        report.dirtyFiles = ['(not a git repo — dirty check impossible; re-run with --force)'];
        return report;
    }
    if (report.dirtyFiles.length && !opts.force) {
        report.status = 'refused';
        return report;
    }
    if (gitAvailable) {
        try {
            report.tag = `evo-nurture-pre-${motherVersion}`;
            exec(['tag', '-a', report.tag, '-m', `pre-nurture rollback point (mother ${motherVersion})`], childRoot);
        } catch {
            report.tag = null; // tag may already exist from a retried nurture — non-fatal
        }
    }

    // --- Apply: copy all, then lock, then receipt, then bump, then registry ---
    for (const p of planned) {
        fs.mkdirSync(path.dirname(p.entry.activeFile), { recursive: true });
        fs.writeFileSync(p.entry.activeFile, p.bytes);
    }
    const lockPath = path.join(childRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ version: 'evo-runtime-mirror@1', generatedAt: now(), entries: checksums }, null, 2) + '\n');

    const receipt = {
        version: 'evo-hive-receipt@1',
        motherVersion,
        families: [...new Set(entries.map(e => e.family))],
        files: entries.map(e => e.label),
        nurturedAt: now(),
    };
    report.receiptPath = path.join(childRoot, '.evo-lite', 'hive', 'nurture-received.json');
    fs.mkdirSync(path.dirname(report.receiptPath), { recursive: true });
    fs.writeFileSync(report.receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    const childPkgPath = path.join(childRoot, '.evo-lite', 'package.json');
    const childPkg = readJson(childPkgPath);
    childPkg.version = motherVersion;
    fs.writeFileSync(childPkgPath, JSON.stringify(childPkg, null, 2) + '\n');

    const reg = registry.readRegistry(motherRoot);
    const regEntry = reg.children.find(c => c.id === entry.id);
    if (regEntry) {
        regEntry.lastNurturedAt = now();
        regEntry.lastNurturedVersion = motherVersion;
        registry.writeRegistry(motherRoot, reg);
    }

    report.status = 'applied';
    return report;
}

module.exports = { nurtureChild, mergeAnchoredContent, diffRuntimeDeps };
```

- [ ] **Step 4: Add `hive nurture` to `commands.js` (both mirrors)**

```javascript
    hive.command('nurture <id>')
        .description('Push managed gene families from this mother into a registered child.')
        .option('--family <key>', 'Push only one managed family (core-cli | agents-workflows | hook-scaffold)')
        .option('--check', 'Report only; exit non-zero when the child is not up-to-date')
        .option('--dry-run', 'Report the copy/skip/missing sets without writing')
        .option('--force', 'Proceed past a dirty child working tree / missing git')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const child = registry.findChild(root, id);
            if (!child) { console.error(`❌ unknown child: ${id} (run: mem hive register <path>)`); process.exitCode = 1; return; }
            const report = require('./nurture').nurtureChild(root, child, {
                family: options.family, dryRun: options.dryRun, check: options.check, force: options.force,
            });
            if (options.json) console.log(JSON.stringify(report, null, 2));
            else {
                console.log(`status: ${report.status}  copied=${report.copied.length} skipped=${report.skipped.length}`);
                if (report.tag) console.log(`rollback tag: ${report.tag}`);
                if (report.missingSources.length) console.log(`❌ missing mother sources: ${report.missingSources.join(', ')}`);
                if (report.dirtyFiles.length) console.log(`⚠️ dirty in child: ${report.dirtyFiles.join(', ')} (use --force to override)`);
                if (report.depGap.missing.length) console.log(`⚠️ child missing deps: ${report.depGap.missing.join(', ')} — run npm install in <child>/.evo-lite`);
                if (report.depGap.versionDiffs.length) console.log(`ℹ️ version ranges differ: ${report.depGap.versionDiffs.map(d => d.name).join(', ')}`);
            }
            if (report.status === 'refused' || report.status === 'aborted' || report.status === 'unreachable') process.exitCode = 1;
            if (options.check && !report.upToDate) process.exitCode = 1;
        });
```

- [ ] **Step 5: Verify** — governance scope ✅ incl T-hive-nurture; full suite green.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hive .evo-lite/cli/hive templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(hive): nurture — split-root gene push with preflight, anchor-merge, tag, receipt"
```

---

### Task 6: Manifest registration + real-world capstone (hungersnakegame4) + contract dogfood

**Files:**
- Modify: `templates/cli/template-manifest.js` + `.evo-lite/cli/template-manifest.js` (register `hive/*.js` + `test/harness.js` untouched — already registered)
- Verify-only: real child `D:/Data/ProjectAgent/hungersnakegame4`
- Evidence: `.evo-lite/verification/evidence-mother-child-hive-nurture.json` (engine-produced)

**Interfaces:**
- Consumes: everything above. No new exports.

- [ ] **Step 1: Register the hive files** — in `core-cli.files` (both manifest mirrors), immediately after `'sync-runtime.js',` add:

```javascript
            'hive/registry.js',
            'hive/status.js',
            'hive/nurture.js',
            'hive/commands.js',
```

(Files already exist byte-identical in both mirrors from Tasks 3–5 — registration after creation, per the self-brick constraint.)

- [ ] **Step 2: Verify sync + governance** — `node ./.evo-lite/cli/test.js governance` → green (incl T17/T25 drift checks over the enlarged manifest); `node ./.evo-lite/cli/memory.js verify` → no template-drift alert.

- [ ] **Step 3: Real-world capstone (the dogfood loop that motivated the spec)** — from the mother root:

```bash
node ./.evo-lite/cli/memory.js hive register D:/Data/ProjectAgent/hungersnakegame4
node ./.evo-lite/cli/memory.js hive status
node ./.evo-lite/cli/memory.js hive nurture hungersnakegame4 --dry-run
node ./.evo-lite/cli/memory.js hive nurture hungersnakegame4
node ./.evo-lite/cli/memory.js hive status
```

Expected: register OK → status `behind`/`drifted` (child hand-upgraded earlier; hive files now missing there) → dry-run lists the pending hive/test files → apply reports `applied` + rollback tag + dep note if any → final status `up-to-date`. Then verify the child in place: `cd D:/Data/ProjectAgent/hungersnakegame4 && node .evo-lite/cli/memory.js verify` → green, and `node .evo-lite/cli/test.js governance` → child-mode skip notice + child-safe tests pass, exit 0 (this is the live proof of ac-harness-portable). **The child now has uncommitted upgrade changes — leave them for the user to review/commit; report this explicitly.**

- [ ] **Step 4: Contract dogfood** — from the mother root:

```bash
node ./.evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-07-02-mother-child-hive-nurture-design.md
```

Expected: 8 criteria PASS → READY. (Note: the CLI takes the spec FILE PATH, not `spec:<id>`.) If a criterion is STALE from a digest change, re-run once.

- [ ] **Step 5: Full suite + commit**

Run: `node ./.evo-lite/cli/test.js` → green.

```bash
git add templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js .evo-lite/verification/evidence-mother-child-hive-nurture.json .evo-lite/hive/children.json
git commit -m "feat(hive): register hive genes in manifest; capstone nurture of hungersnakegame4 + 8-criteria evidence"
```

---

## Follow-up (out of scope, do not silently drop)

- **Evolution phase (`mem hive harvest`)** — read-only child→mother diff proposals, human-gated. Blocked on ≥2 diverging children.
- **`create-evo-lite <path>` auto-register** — scaffold-time registry entry (needs the initializer to know its mother, only meaningful when scaffolding from a mother checkout, not from npm).
- **Historical spec dependsOn retarget** — unrelated debt, tracked separately.

## Self-Review

- **Spec coverage:** registry (ac-hive-registry → T3), genes-only + apply pipeline (ac-nurture-genes-only → T5), dry-run/check (ac-nurture-dry-run → T5), family filter (ac-nurture-family-filter → T5), anchor-merge (ac-nurture-anchor-merge → T1+T5), receipt+tag (ac-nurture-receipt → T5), status verdicts (ac-hive-status-drift → T4), harness portability + child gate (ac-harness-portable → T2, live-proven in T6 Step 3). Mother-only guard → T3; gitignore allowlist → T3; dep reconciliation → T5; all-or-nothing preflight → T5; manifest-after-files ordering → T6. No spec requirement without a task.
- **Placeholder scan:** all code steps carry complete code; no TBD/TODO/"similar to Task N".
- **Type consistency:** `childEntries(motherRoot, childRoot, {family, familiesOverride})` (T4) consumed identically in T5; `sha256` exported from status.js and reused; `registerChild` options `{id, now}` consistent; report shape used by commands.js matches nurture.js output; `buildEntry` export (T1) used by status.js (T4).
