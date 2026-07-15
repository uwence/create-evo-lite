---
id: plan:sync-runtime-bootstrap-hardening
title: Sync-Runtime Bootstrap Hardening — permanent self-brick fix
status: draft
---

# Sync-Runtime Bootstrap Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "add a new managed module + sync the runtime mirror" a reliable atomic workflow that can never self-brick, by adding a bootstrap-safe standalone `sync-runtime` entrypoint (the canonical recovery path for a hard brick) and a defense-in-depth guard around `memory.js` feature-command registration (recovery for the feature-registrar brick class).

**Architecture:** Two complementary fixes for two distinct brick classes. (1) A new `templates/cli/sync-runtime-entry.js` that requires ONLY the dependency-light `./sync-runtime` and `./runtime` modules — verified bootstrap-safe across the whole dependency closure — so it can always run even when `memory.js` cannot load at all (e.g. a top-level `require` chain like `memory.service → memory-index → memory-index-util` hits a not-yet-mirrored file). (2) A `safeRegister` thunk guard in `memory.js` that wraps each feature registrar's `require`+register in try/catch, so a half-mirrored FEATURE module no longer bricks the whole CLI — it warns and continues. A spawn-based regression test reproduces BOTH brick classes and proves each fix heals its class.

**Tech Stack:** Node.js (CommonJS), commander.js, node:assert governance/integration test harness, existing `template-manifest.js` + `sync-runtime.js` runtime-mirror machinery.

## Background / Root Cause (verified against current code)

There are TWO distinct self-brick classes, and the two fixes address them separately:

- **Feature-registrar brick.** `memory.js`'s program-build eagerly runs the block at `memory.js:699-708` — `require('./planning')…require('./code-perception/post-commit-code-perception')` — which registers command groups. If a FEATURE module (or a transitive dep) is not yet mirrored, that `require` throws `Cannot find module` before commander dispatches, so even `mem sync-runtime` (which would heal the mirror) cannot run. The `safeRegister` guard fixes THIS class: a throwing feature registrar warns and is skipped, and the remaining groups (crucially `sync-runtime`) still register.

- **Hard brick (top-level core require).** `memory.js` loads `require('./memory.service')` and `require('./db')` at module top level, BEFORE any command registration. `memory.service` in turn top-level-requires `./memory-index`, which top-level-requires `./memory-index-util`. If any of THESE managed files is missing from the mirror, `memory.js` cannot load at all — `safeRegister` never even runs. `safeRegister` does NOT and cannot protect this class. The standalone `sync-runtime-entry.js` is the canonical recovery for it: it never touches `memory.service`/`db`, so it still runs and re-copies the missing file. History (`project-sync-runtime-selfbrick`, sub-spec ② `cg-manifest-sync`) confirms this class is real, not hypothetical.

Accurate boundary statement (must appear in the guard's code comment and here): *the top-level core requires in `memory.js` (`memory.service` → `memory-index` → `memory-index-util`; `db`) are NOT guarded and can still abort `memory.js` startup; the standalone entry is the canonical recovery path for that hard-brick class. `safeRegister` only isolates the lazy feature registrars.*

Verified dependency facts:
- `sync-runtime.js` requires only `fs`/`path`/`crypto` at top level and dynamically requires `./template-manifest` inside `readEntries()`. `syncRuntime(projectRoot, options)` takes the root directly; `registerSyncRuntimeCommands` also requires `./runtime` (`getWorkspaceRoot`).
- `runtime.js` requires only `fs`/`path`; `getWorkspaceRoot()` is pure path derivation.
- `template-manifest.js` requires only `path`. `memory-index-util.js` requires nothing.
- Closure of the standalone entry: `sync-runtime-entry.js → {sync-runtime, runtime}`, `sync-runtime.js → {template-manifest}`, `runtime.js → {}`, `template-manifest.js → {}`. No business module in the closure.

## Global Constraints

- **Entry bootstrap-safety is the core invariant, enforced as a WHITELIST across the closure.** Each closure file may relative-`require` ONLY its allowed set: `sync-runtime-entry.js` → `./sync-runtime`, `./runtime`; `sync-runtime.js` → `./template-manifest`; `runtime.js` → (none); `template-manifest.js` → (none). Node builtins are allowed. Any OTHER relative `require` in any closure file fails the test — a blacklist is insufficient because a future heavy require not on the list would slip through.
- **The guard must warn, never silence.** Each guarded registration failure MUST emit a `console.error` warning naming the feature and carrying the error code (`MODULE_NOT_FOUND`) + message. A failed feature MUST NOT be presented as registered.
- **`sync-runtime` must survive any other feature's failure.** After the guard, a throw in any single `registerXCommands` must not prevent `sync-runtime` (or any other independent group) from registering.
- **All 10 feature registrars go through `safeRegister`.** No bare `require('./x').registerXCommands(program)` may remain.
- **Preserve existing `sync-runtime` behavior exactly.** `syncRuntime` output shape (`copied`/`skipped`/`missingTemplates`/`lockPath`/`status`), lock format, idempotent convergence (`copied: 0`), AND the `--check` exit semantics (only `status === 'ok'` exits 0; `no-lock` and `drift` exit 1) are unchanged. The entry is a thin caller, not a reimplementation.
- **The entry is a managed template file, declared in Task 1.** It is registered in `template-manifest.js` `core-cli` when created (Task 1), so every subsequent `syncRuntime` (including Task 3's tmp mirror) includes it. On a fresh scaffold (`index.js copyManagedTemplateAssets`) it is copied in the same pass as everything else.
- **Do not edit `.evo-lite/cli/**` by hand.** Both `node templates/cli/test.js` and `node ./.evo-lite/cli/test.js` (governance + integration) must be green at the end.
- **Windows-first.** Repo root `d:\Data\ProjectAgent\create-evo-lite`; use `path.join`; child spawns use `process.execPath`; byte-identical checks use Node `Buffer.equals`, not shell `diff`.

---

### Task 1: sync-runtime-entry.js standalone bootstrap entry (+ manifest declaration)

**Files:**
- Create: `templates/cli/sync-runtime-entry.js`
- Modify: `templates/cli/template-manifest.js` (`core-cli` family `files` array — declare the entry here so all later syncs include it)
- Test: `templates/cli/test/governance.js` (append a new `T-sr-entry` section inside `runGovernanceTests`)

**Interfaces:**
- Consumes: `syncRuntime(projectRoot, options)` and `verifyRuntimeLock(projectRoot)` from `./sync-runtime`; `getWorkspaceRoot()` from `./runtime`.
- Produces: an executable module. `node templates/cli/sync-runtime-entry.js [--check] [--json]`. Exit 0 on successful sync or `--check` in-sync; exit 1 on `--check` drift OR `--check` no-lock (matching the existing command). Prints the same human summary as the `sync-runtime` command.

- [ ] **Step 1: Write the failing test**

Append inside `runGovernanceTests` in `templates/cli/test/governance.js` (reuse the in-scope `path`, `fs`, `os`, `assert`, `writeText`, `TEMPLATE_CLI_DIR`):

```javascript
console.log('T-sr-entry. Testing standalone sync-runtime-entry is bootstrap-safe (closure whitelist) and syncs ...');
{
    const { execFileSync } = require('child_process');
    const entryPath = path.join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js');

    // (a) The entry file exists.
    assert.ok(fs.existsSync(entryPath), 'sync-runtime-entry.js must exist');

    // (b) Bootstrap-safety as a WHITELIST across the whole dependency closure.
    // Each file may relative-require ONLY its allowed set; any other relative
    // require fails. Node builtins (no leading dot) are always allowed.
    function relRequires(src) {
        const out = [];
        const re = /require\(\s*['"](\.[^'"]*)['"]\s*\)/g;
        let m;
        while ((m = re.exec(src)) !== null) out.push(m[1]);
        return out;
    }
    const CLOSURE_ALLOW = {
        'sync-runtime-entry.js': ['./sync-runtime', './runtime'],
        'sync-runtime.js': ['./template-manifest'],
        'runtime.js': [],
        'template-manifest.js': [],
    };
    for (const [rel, allow] of Object.entries(CLOSURE_ALLOW)) {
        const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, rel), 'utf8');
        for (const r of relRequires(src)) {
            assert.ok(allow.includes(r), `${rel}: unexpected relative require '${r}' (bootstrap-safe closure whitelist)`);
        }
    }

    // (c) The entry is declared in the manifest core-cli family (so all syncs include it).
    const manifestSrc = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'), 'utf8');
    assert.ok(/'sync-runtime-entry\.js'/.test(manifestSrc), 'sync-runtime-entry.js must be declared in template-manifest.js');

    // (d) Functional: entry syncs a sparse tmp workspace using the real manifest.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sr-entry-'));
    const savedCli = process.env.EVO_LITE_TEMPLATE_CLI_DIR;
    const savedRoot = process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
    try {
        fs.mkdirSync(path.join(tmpRoot, 'templates', 'cli'), { recursive: true });
        writeText(path.join(tmpRoot, 'templates', 'cli', 'memory.js'), '// entry-sync-canonical\n');
        const env = {
            ...process.env,
            EVO_LITE_TEMPLATE_CLI_DIR: path.join(tmpRoot, 'templates', 'cli'),
            EVO_LITE_TEMPLATE_ROOT_DIR: path.join(tmpRoot, 'templates'),
            EVO_LITE_WORKSPACE_ROOT: tmpRoot,
        };
        const out = execFileSync(process.execPath, [entryPath, '--json'], { env, encoding: 'utf8' });
        const result = JSON.parse(out);
        assert.strictEqual(result.status, 'ok', 'entry sync should report ok');
        assert.ok(result.copied.includes('memory.js'), 'entry should copy memory.js into the mirror');
        assert.ok(fs.existsSync(path.join(tmpRoot, '.evo-lite', 'cli', 'memory.js')), 'mirror memory.js must exist after entry run');

        // (e) Idempotent: a second run copies nothing.
        const out2 = execFileSync(process.execPath, [entryPath, '--json'], { env, encoding: 'utf8' });
        assert.strictEqual(JSON.parse(out2).copied.length, 0, 'second entry run should copy nothing');

        // (f) --check exit semantics match the existing command:
        //     in-sync → 0 ; no-lock → 1 ; drift → 1. Use spawnSync so a non-zero
        //     exit does not throw; read .status.
        const { spawnSync } = require('child_process');
        const check = () => spawnSync(process.execPath, [entryPath, '--check', '--json'], { env, encoding: 'utf8' }).status;
        assert.strictEqual(check(), 0, '--check on an in-sync mirror should exit 0');
        fs.rmSync(path.join(tmpRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json'));
        assert.strictEqual(check(), 1, '--check with no lock should exit 1');
        // Re-create lock, then drift the mirror by hand:
        execFileSync(process.execPath, [entryPath, '--json'], { env, encoding: 'utf8' });
        writeText(path.join(tmpRoot, '.evo-lite', 'cli', 'memory.js'), '// drifted-by-hand\n');
        assert.strictEqual(check(), 1, '--check with drift should exit 1');
    } finally {
        if (savedCli === undefined) delete process.env.EVO_LITE_TEMPLATE_CLI_DIR; else process.env.EVO_LITE_TEMPLATE_CLI_DIR = savedCli;
        if (savedRoot === undefined) delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR; else process.env.EVO_LITE_TEMPLATE_ROOT_DIR = savedRoot;
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    console.log('✅ T-sr-entry standalone bootstrap entry passed');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at `T-sr-entry` with "sync-runtime-entry.js must exist" (file not created yet).

- [ ] **Step 3: Write the entry**

Create `templates/cli/sync-runtime-entry.js`:

```javascript
'use strict';

// Bootstrap-safe standalone entrypoint for the runtime-mirror sync.
//
// CANONICAL RECOVERY PATH for a hard brick: when memory.js cannot load at all
// (e.g. a top-level require chain memory.service → memory-index → memory-index-util
// hits a not-yet-mirrored file), this entry still runs because it requires ONLY
// ./sync-runtime and ./runtime — both depend on nothing beyond Node builtins +
// ./template-manifest. NEVER add a require here (or in that closure) for
// memory.service, db, commander, or any feature/gene module. A closure whitelist
// test (T-sr-entry) enforces this.

const { syncRuntime, verifyRuntimeLock } = require('./sync-runtime');
const { getWorkspaceRoot } = require('./runtime');

function main(argv) {
    const args = argv.slice(2);
    const json = args.includes('--json');
    const check = args.includes('--check');
    const projectRoot = process.env.EVO_LITE_WORKSPACE_ROOT || getWorkspaceRoot();

    if (check) {
        const result = verifyRuntimeLock(projectRoot);
        if (json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (result.status === 'no-lock') {
            console.log('runtime-mirror lock missing. Run sync-runtime-entry to generate it.');
        } else if (result.status === 'ok') {
            console.log(`✅ runtime mirror in-sync (${result.lockPath}, ${result.generatedAt}).`);
        } else {
            console.log('❌ runtime mirror drifted from templates/cli/.');
            for (const m of result.mismatches) console.log(`  drift: ${m.path}`);
            for (const m of result.missing) console.log(`  missing: ${m}`);
        }
        // Match the existing `mem sync-runtime --check`: ONLY status 'ok' exits 0.
        // 'no-lock' still prints its remedy but exits 1 (drift/missing likewise).
        return result.status === 'ok' ? 0 : 1;
    }

    const result = syncRuntime(projectRoot);
    if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return 0;
    }
    if (result.status === 'no-templates') {
        console.log('templates/cli/ not found. Nothing to sync.');
        return 0;
    }
    console.log('Runtime mirror synced from templates/cli/ (standalone entry).');
    console.log(`  copied: ${result.copied.length}`);
    console.log(`  unchanged: ${result.skipped.length}`);
    if (result.missingTemplates.length > 0) {
        console.log(`  missing in templates: ${result.missingTemplates.join(', ')}`);
    }
    console.log(`  lock: ${result.lockPath}`);
    return 0;
}

process.exitCode = main(process.argv);
```

- [ ] **Step 4: Declare the entry in the manifest**

In `templates/cli/template-manifest.js`, in the `core-cli` family `files` array, add (next to `'sync-runtime.js'`):

```
'sync-runtime-entry.js',
```

Do NOT reorder or remove any existing entry. (The real repo mirror is reconciled in Task 4; no other test asserts the real mirror mid-plan.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-sr-entry standalone bootstrap entry passed`, suite exits 0.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/sync-runtime-entry.js templates/cli/template-manifest.js templates/cli/test/governance.js
git commit -m "feat(sync-runtime): bootstrap-safe standalone sync-runtime-entry + manifest declaration (task:sr-entry)"
```

---

### Task 2: memory.js defense-in-depth registration guard (all 10 registrars)

**Files:**
- Modify: `templates/cli/memory.js:699-708` (the feature-register block)
- Test: `templates/cli/test/governance.js` (append a new `T-sr-guard` section)

**Interfaces:**
- Produces: a module-local `function safeRegister(featureName, register)` where `register` is a THUNK performing BOTH the `require` and the `.registerXCommands(program)` call. The require MUST live inside the thunk (inside the try) — a hoisted top-level `require` would throw before the guard. On any throw it writes a stderr warning naming the feature + error code/message and returns without throwing.

- [ ] **Step 1: Write the failing test**

Append inside `runGovernanceTests` in `templates/cli/test/governance.js`:

```javascript
console.log('T-sr-guard. Testing memory.js routes ALL 10 feature registrars through the guard ...');
{
    const { execFileSync } = require('child_process');
    const memSrc = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'memory.js'), 'utf8');

    // (a) The guard helper exists.
    assert.ok(/function safeRegister\s*\(\s*featureName\s*,\s*register\s*\)/.test(memSrc), 'memory.js must define safeRegister(featureName, register)');

    // (b) Every one of the 10 feature registrars is wired as an EXACT safeRegister
    // thunk whose require lives inside the thunk.
    const EXPECTED = [
        ['planning', './planning', 'registerPlanCommands'],
        ['spec-portfolio', './spec-portfolio', 'registerSpecPortfolioCommands'],
        ['architecture', './architecture', 'registerArchitectureCommands'],
        ['verification', './verification/commands', 'registerVerificationCommands'],
        ['close', './verification/close-commands', 'registerCloseCommands'],
        ['hive', './hive/commands', 'registerHiveCommands'],
        ['dashboard', './dashboard-data', 'registerDashboardCommands'],
        ['hooks', './hooks', 'registerHookCommands'],
        ['sync-runtime', './sync-runtime', 'registerSyncRuntimeCommands'],
        ['code-perception', './code-perception/post-commit-code-perception', 'registerCodePerceptionCommands'],
    ];
    const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    for (const [feat, mod, fn] of EXPECTED) {
        const re = new RegExp(`safeRegister\\('${esc(feat)}',\\s*\\(\\)\\s*=>\\s*require\\('${esc(mod)}'\\)\\.${esc(fn)}\\(program\\)\\)`);
        assert.ok(re.test(memSrc), `feature '${feat}' must be registered via an exact safeRegister thunk`);
    }

    // (c) No bare require().registerXCommands(program) survives anywhere.
    assert.ok(
        !/^\s*require\('\.\/[^']*'\)\.register\w*Commands\(program\);/m.test(memSrc),
        'no bare require().registerXCommands(program) may remain (all must go through safeRegister)'
    );

    // (d) Healthy CLI still lists sync-runtime in --help.
    const help = execFileSync(process.execPath, [path.join(TEMPLATE_CLI_DIR, 'memory.js'), '--help'], {
        env: { ...process.env }, encoding: 'utf8',
    });
    assert.ok(/sync-runtime/.test(help), 'memory.js --help must list sync-runtime');
    console.log('✅ T-sr-guard registration guard passed');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at `T-sr-guard` with "memory.js must define safeRegister(featureName, register)".

- [ ] **Step 3: Add the guard**

In `templates/cli/memory.js`, define `safeRegister` immediately before the register block (same function scope that has `program`), and route every feature registration through it as a THUNK. Replace lines 699-708:

```javascript
    function safeRegister(featureName, register) {
        try {
            register();
        } catch (err) {
            // Defense-in-depth for the FEATURE-REGISTRAR brick class: a not-yet-mirrored
            // (or genuinely broken) feature module must NOT brick the whole CLI —
            // especially sync-runtime, which heals the mirror. The require() lives INSIDE
            // the thunk, so a missing module throws here and is caught. Warn loudly
            // (never silent) and continue so the remaining groups register.
            //
            // BOUNDARY: this guards only the lazy feature registrars. The top-level core
            // requires in this file (memory.service → memory-index → memory-index-util; db)
            // run before this block and are NOT guarded — a missing core module still
            // aborts startup by design. sync-runtime-entry.js is the canonical recovery
            // path for that hard-brick class.
            const code = err && err.code ? err.code + ': ' : '';
            console.error(
                `[evo-lite] warning: command group ${featureName} failed to register ` +
                `(${code}${err && err.message}); continuing so core commands (e.g. sync-runtime) stay available.`
            );
        }
    }

    safeRegister('planning', () => require('./planning').registerPlanCommands(program));
    safeRegister('spec-portfolio', () => require('./spec-portfolio').registerSpecPortfolioCommands(program));
    safeRegister('architecture', () => require('./architecture').registerArchitectureCommands(program));
    safeRegister('verification', () => require('./verification/commands').registerVerificationCommands(program));
    safeRegister('close', () => require('./verification/close-commands').registerCloseCommands(program));
    safeRegister('hive', () => require('./hive/commands').registerHiveCommands(program));
    safeRegister('dashboard', () => require('./dashboard-data').registerDashboardCommands(program));
    safeRegister('hooks', () => require('./hooks').registerHookCommands(program));
    safeRegister('sync-runtime', () => require('./sync-runtime').registerSyncRuntimeCommands(program));
    safeRegister('code-perception', () => require('./code-perception/post-commit-code-perception').registerCodePerceptionCommands(program));
```

(Verify each module path + function name against the current lines 699-708 before editing. Each thunk contains BOTH the `require(...)` and the `.registerXCommands(program)` call; do NOT hoist any `require`. The `inspect`/`mcp` commands after line 708 stay unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-sr-guard registration guard passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory.js templates/cli/test/governance.js
git commit -m "feat(cli): route all 10 feature registrars through safeRegister guard (task:sr-guard)"
```

---

### Task 3: End-to-end self-brick regression — BOTH brick classes

**Files:**
- Test: `templates/cli/test/integration.js` (append a new self-brick section inside `runIntegrationTests`)

**Interfaces:**
- Consumes (in-test): `syncRuntime` from `templates/cli/sync-runtime`; the real repo templates via `WORKSPACE_ROOT`/`TEMPLATE_CLI_DIR`/`TEMPLATE_ROOT_DIR` (already imported from `./harness`); `child_process.spawnSync`.
- Produces: a regression test with two independent scenarios — Scenario A (hard brick, only the standalone entry recovers) and Scenario B (feature-registrar brick, the guard degrades gracefully).

- [ ] **Step 1: Write the failing test**

Append inside `runIntegrationTests` in `templates/cli/test/integration.js` (uses in-scope `fs`, `os`, `path`, `assert`, and the imported `WORKSPACE_ROOT`, `TEMPLATE_CLI_DIR`, `TEMPLATE_ROOT_DIR`):

```javascript
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
    const childEnv = { ...process.env, EVO_LITE_WORKSPACE_ROOT: mirrorRoot };
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
```

- [ ] **Step 2: Confirm each scenario is a genuine red without its fix**

This regression locks behavior from Tasks 1-2, so it passes once those are in the template tree. Prove it is not vacuous with two one-off demonstrations, restoring after each:
- **Scenario A red:** temporarily rename/remove `sync-runtime-entry.js` recovery by pointing `runEntry` at a non-existent path — the `hardEntry.status === 0` assertion fails, confirming only the entry can recover a hard brick. Restore.
- **Scenario B red:** temporarily replace the `code-perception` `safeRegister` thunk in `templates/cli/memory.js` with the bare `require('./code-perception/post-commit-code-perception').registerCodePerceptionCommands(program);` form and re-run — `featHelp.status === 0` fails because the child now aborts at the bare require with `MODULE_NOT_FOUND`. Restore the thunk.

Run: `node templates/cli/test.js`
Expected: each temporary removal produces a FAIL at the named `SB` assertion; with both fixes in place, `SB` passes.

- [ ] **Step 3: (No new production code)**

This task adds only the regression test; if Step 2 shows a scenario passes even with its fix removed, the test is not exercising that fix — fix the test before proceeding.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `node templates/cli/test.js`
Expected: PASS — `✅ SB self-brick regression (hard-brick + feature-brick) passed`; full suite exits 0.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/integration.js
git commit -m "test(sync-runtime): self-brick regression covering hard-brick + feature-brick classes (task:sr-selfbrick-test)"
```

---

### Task 4: Final mirror convergence + full regression

**Files:**
- Result (generated by sync, committed): `.evo-lite/cli/sync-runtime-entry.js` + refreshed mirrors of the already-managed modified files (`memory.js`, `template-manifest.js`, `test/governance.js`, `test/integration.js`)

(The manifest entry was declared in Task 1; this task only reconciles the real repo mirror and runs the full regression through it.)

- [ ] **Step 1: Seed the mirror from the TEMPLATE entry, then converge from the mirror entry**

The real repo mirror does not yet contain `sync-runtime-entry.js` (only the manifest declares it). Seed the first sync from the TEMPLATE copy of the entry (it exists in `templates/cli/`), which copies the entry into the mirror; then run the MIRROR entry to convergence. Run until TWO CONSECUTIVE runs report `copied: 0` (≤4 runs total):

```bash
node templates/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
```

If it does not converge within ~4 runs, STOP and report.

- [ ] **Step 2: Verify byte-identical mirror (Node, not shell)**

Run:

```bash
node -e "const fs=require('fs'),p=require('path'); const files=['sync-runtime-entry.js','memory.js','template-manifest.js','test/governance.js','test/integration.js']; let drift=0; for(const f of files){const a=fs.readFileSync(p.join('templates/cli',f)); const b=fs.readFileSync(p.join('.evo-lite/cli',f)); if(!a.equals(b)){console.log('DRIFT',f);drift++;}} console.log(drift?('DRIFT '+drift):'byte-identical OK'); process.exit(drift?1:0);"
```

Expected: `byte-identical OK`, exit 0.

- [ ] **Step 3: Full regression through both trees**

```bash
node templates/cli/test.js
node ./.evo-lite/cli/test.js
```

Expected: both exit 0, with `T-sr-entry`, `T-sr-guard` (governance) and `SB` (integration) present and green in BOTH the template and mirror runs — proving the mirrored `memory.js` guard + mirrored entry work through the mirror.

- [ ] **Step 4: Commit**

Stage only the generated/updated mirror files:

```bash
git add .evo-lite/cli/sync-runtime-entry.js .evo-lite/cli/memory.js .evo-lite/cli/template-manifest.js .evo-lite/cli/test/governance.js .evo-lite/cli/test/integration.js
git commit -m "chore(sync-runtime): reconcile runtime mirror for bootstrap-safe entry + guard (task:sr-manifest-sync)"
```

Verify `git status --short` shows only mirror paths (the post-commit hook may re-touch `active_context.md`; do not stage generated `.evo-lite/generated/*`).

---

## Self-Review

- **Coverage:** entry + manifest declaration (Task 1) → guard for all 10 registrars (Task 2) → both-brick-class regression (Task 3) → mirror reconcile + full regression (Task 4). BLOCKER 1 (ordering) resolved by declaring the manifest entry in Task 1 and seeding Task 4 from the template entry. BLOCKER 2 (hard-brick class) resolved by Scenario A. BLOCKER 3 (`--check` no-lock) resolved: entry returns 0 only for `status === 'ok'`; no-lock/drift exit 1, asserted in T-sr-entry (f).
- **Bootstrap-safety** is a closure WHITELIST (Task 1 (b)), not a blacklist — a new heavy require anywhere in the closure fails the test.
- **Guard covers all 10 registrars** via the exact-thunk `EXPECTED` map + a global no-bare-registration assertion (Task 2 (b)/(c)).
- **Honest failure** — Scenario B asserts the bricked `--help` lists sync-runtime but NOT the failed `code-perception` command, warns by name with `MODULE_NOT_FOUND`, and that the command reappears after healing.
- **Windows-first** — byte-identical via Node `Buffer.equals`; child spawns via `process.execPath`.
- **Env hygiene** — T-sr-entry and SB save and restore `EVO_LITE_TEMPLATE_*` rather than unconditionally deleting.
- **Signature consistency** — `safeRegister(featureName, register)` (thunk form) is used consistently in the guard code, the guard test, and this review. `syncRuntime(projectRoot, options)`, `verifyRuntimeLock(projectRoot)`, `getWorkspaceRoot()` match current source.
- **Accurate boundary** — Background + the guard comment both state that top-level core requires are unguarded and the standalone entry is the hard-brick recovery path; no over-claim.
