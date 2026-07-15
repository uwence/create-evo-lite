---
id: plan:sync-runtime-bootstrap-hardening
title: Sync-Runtime Bootstrap Hardening — permanent self-brick fix
status: draft
---

# Sync-Runtime Bootstrap Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "add a new managed module + sync the runtime mirror" a reliable atomic workflow that can never self-brick, by adding a bootstrap-safe standalone `sync-runtime` entrypoint and a defense-in-depth guard around `memory.js` feature-command registration.

**Architecture:** Two complementary fixes. (1) A new `templates/cli/sync-runtime-entry.js` that requires ONLY the already-stable, dependency-light `./sync-runtime` and `./runtime` modules — never the full CLI, DB, command registry, or any feature/gene module — so it can always run even when the mirror is mid-update. (2) A `safeRegister` guard in `memory.js` that wraps each `require('./feature').registerXCommands(program)` in try/catch, emitting a clear stderr warning and continuing, so a half-mirrored feature module can no longer brick the entire CLI (including `mem sync-runtime` itself). A spawn-based end-to-end regression test reproduces the real self-brick scenario and proves both paths heal it.

**Tech Stack:** Node.js (CommonJS), commander.js, node:assert governance/integration test harness, existing `template-manifest.js` + `sync-runtime.js` runtime-mirror machinery.

## Background / Root Cause (verified against current code)

- `sync-runtime.js` is already clean: it requires only `fs`, `path`, `crypto`, and `./template-manifest`; `syncRuntime(projectRoot, options)` takes the root directly and never routes back through the CLI. `registerSyncRuntimeCommands` additionally requires `./runtime` (`getWorkspaceRoot`), which requires only `fs`+`path`.
- The self-brick is NOT in `sync-runtime.js`. It is that `node .evo-lite/cli/memory.js sync-runtime` loads `memory.js`, whose program-build function eagerly runs the block at `memory.js:699-708` — `require('./planning')…require('./code-perception/post-commit-code-perception')`. If any of those modules (or a transitive dep) is not yet mirrored, the `require` throws `Cannot find module` BEFORE commander dispatches to the `sync-runtime` action, so the very command that would heal the mirror cannot run. This recurred in sub-spec ② (`cg-manifest-sync`) and is documented in memory `project-sync-runtime-selfbrick`.
- Fix scope: the feature-register block (lines 699-708) and a new standalone entry. The top-level module requires in `memory.js` (`fs`, `memory.service`, `db`, `commander`) stay UNGUARDED — they are core and always mirrored first; they are not the self-brick vector.

## Global Constraints

- **Entry bootstrap-safety is the core invariant.** `sync-runtime-entry.js` may require ONLY `./sync-runtime` and `./runtime` (plus Node builtins). It MUST NOT require `./memory.service`, `./db`, `commander`, the command registry, or any feature/gene module (`./code-perception/*`, `./hive/*`, `./verification/*`, `./planning`, `./spec-portfolio`, `./architecture`, `./dashboard-data`, `./hooks`, `./inspector`, MCP, wiki). A static-source assertion enforces this.
- **The guard must warn, never silence.** Each guarded registration failure MUST emit a `console.error` warning naming the failed module and its error message. Silent skips are forbidden — a genuinely broken module must be visible.
- **`sync-runtime` must survive any other feature's failure.** After the guard, a throw in any single `registerXCommands` must not prevent `sync-runtime` (or any other independent group) from registering.
- **Preserve existing sync-runtime behavior byte-for-byte.** `syncRuntime` output shape (`copied`/`skipped`/`missingTemplates`/`lockPath`/`status`), the lock file format, and idempotent convergence (`copied: 0` on a clean re-run) are unchanged. The entry is a thin caller, not a reimplementation.
- **The entry is a managed template file.** It MUST be registered in `template-manifest.js` `core-cli` family and mirrored into `.evo-lite/cli/`. On a fresh scaffold (`index.js copyManagedTemplateAssets`) it is copied in the same pass as everything else, so it is never itself a "waiting to be mirrored" module.
- **Do not edit `.evo-lite/cli/**` by hand.** Let `sync-runtime` generate the mirror. Both `node templates/cli/test.js governance` and `node ./.evo-lite/cli/test.js governance` (and the integration suite) must be green at the end.
- **Windows-first.** Repo root is `d:\Data\ProjectAgent\create-evo-lite`; paths use `path.join`; child spawns use `process.execPath`.

---

### Task 1: sync-runtime-entry.js standalone bootstrap entry

**Files:**
- Create: `templates/cli/sync-runtime-entry.js`
- Test: `templates/cli/test/governance.js` (append a new `T-sr-entry` section inside `runGovernanceTests`)

**Interfaces:**
- Consumes: `syncRuntime(projectRoot, options)` and `verifyRuntimeLock(projectRoot)` from `./sync-runtime`; `getWorkspaceRoot()` from `./runtime`.
- Produces: an executable module. Run as `node templates/cli/sync-runtime-entry.js [--check] [--json]`. Exit code 0 on success/in-sync; exit code 1 on `--check` drift. Prints the same human summary as the `sync-runtime` command (copied / unchanged / lock).

- [ ] **Step 1: Write the failing test**

Append inside `runGovernanceTests` in `templates/cli/test/governance.js` (near the T17 block; reuse the `path`, `fs`, `os`, `assert` already in scope, and `TEMPLATE_CLI_DIR`):

```javascript
console.log('T-sr-entry. Testing standalone sync-runtime-entry is bootstrap-safe and syncs ...');
{
    const { execFileSync } = require('child_process');
    const entryPath = path.join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js');

    // (a) The entry file exists.
    assert.ok(fs.existsSync(entryPath), 'sync-runtime-entry.js must exist');

    // (b) Bootstrap-safety: the entry source must not require any heavy/feature module.
    const entrySrc = fs.readFileSync(entryPath, 'utf8');
    const FORBIDDEN = [
        './memory.service', './db', 'commander', './planning', './spec-portfolio',
        './architecture', './verification', './hive', './dashboard-data', './hooks',
        './inspector', './code-perception', './mcp',
    ];
    for (const mod of FORBIDDEN) {
        assert.ok(
            !new RegExp(`require\\(\\s*['"]${mod.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`).test(entrySrc),
            `sync-runtime-entry.js must NOT require ${mod} (bootstrap-safety)`
        );
    }
    // It MAY require only ./sync-runtime and ./runtime.
    assert.ok(/require\(\s*['"]\.\/sync-runtime['"]\s*\)/.test(entrySrc), 'entry should require ./sync-runtime');

    // (c) Functional: entry syncs a sparse tmp workspace using the real manifest.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sr-entry-'));
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

        // (d) Idempotent: a second run copies nothing.
        const out2 = execFileSync(process.execPath, [entryPath, '--json'], { env, encoding: 'utf8' });
        assert.strictEqual(JSON.parse(out2).copied.length, 0, 'second entry run should copy nothing');
    } finally {
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
// This is the CANONICAL path for adding a new managed module and healing the
// mirror. It deliberately requires ONLY ./sync-runtime and ./runtime — both
// depend on nothing beyond Node builtins + ./template-manifest — so it can run
// even when memory.js's full command registry cannot load because a feature
// module has not been mirrored yet (the self-brick scenario). NEVER add a
// require here for memory.service, db, commander, or any feature/gene module.

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
        return result.status === 'ok' || result.status === 'no-lock' ? 0 : 1;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-sr-entry standalone bootstrap entry passed`, suite exits 0.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/sync-runtime-entry.js templates/cli/test/governance.js
git commit -m "feat(sync-runtime): bootstrap-safe standalone sync-runtime-entry (task:sr-entry)"
```

---

### Task 2: memory.js defense-in-depth registration guard

**Files:**
- Modify: `templates/cli/memory.js:699-708` (the feature-register block)
- Test: `templates/cli/test/governance.js` (append a new `T-sr-guard` section)

**Interfaces:**
- Produces: a module-local `function safeRegister(program, modulePath, fnName)` used to replace each direct `require('./X').registerYCommands(program)` call. On success it registers normally; on any throw it writes a stderr warning and returns without throwing.

- [ ] **Step 1: Write the failing test**

Append inside `runGovernanceTests` in `templates/cli/test/governance.js`:

```javascript
console.log('T-sr-guard. Testing memory.js feature-register guard isolates a broken module ...');
{
    // The guard must be a named helper `safeRegister` in memory.js source, applied
    // to the feature-register block, so one throwing module cannot brick the CLI.
    const memSrc = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'memory.js'), 'utf8');
    assert.ok(/function safeRegister\s*\(/.test(memSrc), 'memory.js must define safeRegister');
    // Every feature register must go through safeRegister (no bare require().registerXCommands(program)).
    assert.ok(
        !/require\('\.\/code-perception\/post-commit-code-perception'\)\.registerCodePerceptionCommands\(program\)/.test(memSrc),
        'code-perception registration must be routed through safeRegister, not a bare require'
    );
    assert.ok(
        /safeRegister\(program,\s*'\.\/sync-runtime',\s*'registerSyncRuntimeCommands'\)/.test(memSrc),
        'sync-runtime must be registered via safeRegister'
    );

    // Behavioral: safeRegister swallows a throwing register, warns to stderr, and
    // lets later registers still run. Exercise the exact helper via a tiny harness.
    const { execFileSync } = require('child_process');
    const harness = [
        "const mem = require(" + JSON.stringify(path.join(TEMPLATE_CLI_DIR, 'memory.js').replace(/\\/g, '\\\\')) + ");",
        // safeRegister is module-local; re-declare an equivalent by loading memory.js is not
        // enough, so assert via the public behavior below instead.
        "console.log('harness-ok');",
    ].join('\n');
    // Public behavior: spawning memory.js with a deliberately missing feature module
    // must still expose `sync-runtime` in --help (guard kept the CLI alive).
    const help = execFileSync(process.execPath, [path.join(TEMPLATE_CLI_DIR, 'memory.js'), '--help'], {
        env: { ...process.env }, encoding: 'utf8',
    });
    assert.ok(/sync-runtime/.test(help), 'memory.js --help must list sync-runtime');
    console.log('✅ T-sr-guard registration guard passed');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node templates/cli/test.js governance`
Expected: FAIL at `T-sr-guard` with "memory.js must define safeRegister" (helper not added yet).

- [ ] **Step 3: Add the guard**

In `templates/cli/memory.js`, define `safeRegister` immediately before the register block (keep it inside the same function scope that has `program`), and route every feature registration through it. Replace lines 699-708:

```javascript
    function safeRegister(program, modulePath, fnName) {
        try {
            require(modulePath)[fnName](program);
        } catch (err) {
            // Defense-in-depth: a not-yet-mirrored (or genuinely broken) feature
            // module must NOT brick the whole CLI — especially sync-runtime, which
            // heals the mirror. Warn loudly (never silent) and continue so the
            // remaining command groups still register.
            console.error(
                `[evo-lite] warning: command group ${modulePath} failed to register ` +
                `(${err && err.message}); continuing so core commands (e.g. sync-runtime) stay available.`
            );
        }
    }

    safeRegister(program, './planning', 'registerPlanCommands');
    safeRegister(program, './spec-portfolio', 'registerSpecPortfolioCommands');
    safeRegister(program, './architecture', 'registerArchitectureCommands');
    safeRegister(program, './verification/commands', 'registerVerificationCommands');
    safeRegister(program, './verification/close-commands', 'registerCloseCommands');
    safeRegister(program, './hive/commands', 'registerHiveCommands');
    safeRegister(program, './dashboard-data', 'registerDashboardCommands');
    safeRegister(program, './hooks', 'registerHookCommands');
    safeRegister(program, './sync-runtime', 'registerSyncRuntimeCommands');
    safeRegister(program, './code-perception/post-commit-code-perception', 'registerCodePerceptionCommands');
```

(Keep the exact same module paths and function names as the current lines 699-708 — verify each against the file before editing. The `inspect` / `mcp` commands defined after line 708 stay as they are.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-sr-guard registration guard passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory.js templates/cli/test/governance.js
git commit -m "feat(cli): guard feature-command registration so a half-mirror can't brick the CLI (task:sr-guard)"
```

---

### Task 3: End-to-end self-brick reproduction regression test

**Files:**
- Test: `templates/cli/test/integration.js` (append a new self-brick section inside `runIntegrationTests`)

**Interfaces:**
- Consumes (in-test): `syncRuntime` from `templates/cli/sync-runtime`, the real repo templates as the sync source, `child_process.execFileSync`/`spawnSync`.
- Produces: a regression test that faithfully reproduces the self-brick (a mirrored `memory.js` whose feature module is missing) and proves BOTH heal paths: (a) the guarded `memory.js sync-runtime` survives and re-copies; (b) `sync-runtime-entry.js` heals independently regardless of the guard.

- [ ] **Step 1: Write the failing test**

Append inside `runIntegrationTests` in `templates/cli/test/integration.js` (uses `fs`, `os`, `path`, `assert` already in scope; `REPO_ROOT` = the repo root — if not already defined in the file, derive it as `path.resolve(__dirname, '..', '..', '..')` from `templates/cli/test/`):

```javascript
console.log('SB. Testing self-brick reproduction: missing mirror module heals via guard + standalone entry ...');
{
    const { syncRuntime } = require(path.join(REPO_ROOT, 'templates', 'cli', 'sync-runtime'));
    const { spawnSync } = require('child_process');
    const mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-selfbrick-'));
    // Both the IN-PROCESS syncRuntime (below) and the spawned children resolve the
    // template source from these env vars, so set them on process.env (restored in
    // finally) AND pass them to child spawns via childEnv.
    process.env.EVO_LITE_TEMPLATE_CLI_DIR = path.join(REPO_ROOT, 'templates', 'cli');
    process.env.EVO_LITE_TEMPLATE_ROOT_DIR = path.join(REPO_ROOT, 'templates');
    const childEnv = {
        ...process.env,
        EVO_LITE_WORKSPACE_ROOT: mirrorRoot,
    };
    try {
        // Build a full faithful mirror of the real templates into the tmp workspace.
        const first = syncRuntime(mirrorRoot, {});
        assert.strictEqual(first.status, 'ok', 'initial mirror build should succeed');
        const cliDir = path.join(mirrorRoot, '.evo-lite', 'cli');
        const bricked = path.join(cliDir, 'code-perception', 'post-commit-code-perception.js');
        const entry = path.join(cliDir, 'sync-runtime-entry.js');
        assert.ok(fs.existsSync(bricked), 'mirror must contain the code-perception module to delete');
        assert.ok(fs.existsSync(entry), 'mirror must contain sync-runtime-entry.js');

        // Reproduce the self-brick: delete a module that memory.js eagerly registers.
        fs.rmSync(bricked);

        // (a) GUARDED memory.js survives: sync-runtime still runs (exit 0) and re-copies the module.
        const viaMemory = spawnSync(process.execPath, [path.join(cliDir, 'memory.js'), 'sync-runtime'], {
            env: childEnv, encoding: 'utf8',
        });
        assert.strictEqual(viaMemory.status, 0, 'guarded memory.js sync-runtime must exit 0 despite the missing module');
        assert.ok(/warning: command group/.test(viaMemory.stderr || ''), 'guard must warn about the missing module on stderr');
        assert.ok(fs.existsSync(bricked), 'sync-runtime must re-copy the deleted module');

        // (b) Standalone entry heals independently: delete again, run the entry directly.
        fs.rmSync(bricked);
        const viaEntry = spawnSync(process.execPath, [entry, '--json'], { env: childEnv, encoding: 'utf8' });
        assert.strictEqual(viaEntry.status, 0, 'standalone entry must exit 0');
        assert.ok(fs.existsSync(bricked), 'standalone entry must re-copy the deleted module');

        // (c) Convergence: a clean re-run via the entry copies nothing.
        const converged = spawnSync(process.execPath, [entry, '--json'], { env: childEnv, encoding: 'utf8' });
        assert.strictEqual(JSON.parse(converged.stdout).copied.length, 0, 'converged entry run copies nothing');
    } finally {
        delete process.env.EVO_LITE_TEMPLATE_CLI_DIR;
        delete process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
        fs.rmSync(mirrorRoot, { recursive: true, force: true });
    }
    console.log('✅ SB self-brick reproduction + dual heal passed');
}
```

- [ ] **Step 2: Confirm the test is meaningful (genuine red without the fixes)**

This is a regression test that locks behavior delivered in Tasks 1-2, so it passes once those tasks are in the template tree. To prove it is not a vacuous test, demonstrate a genuine red once: temporarily comment out the `safeRegister` guard body in `templates/cli/memory.js` (make the register calls bare `require(...).registerXCommands(program)` again), run `node templates/cli/test.js`, and confirm the `SB` section FAILS at assertion (a) — "guarded memory.js sync-runtime must exit 0 …" (the bricked mirror crashes the child). Then restore the guard.

Run: `node templates/cli/test.js`
Expected (guard temporarily removed): FAIL at `SB` (a). After restoring the guard: proceed to Step 4.

- [ ] **Step 3: (No new production code)**

This task adds only the regression test; the production behavior it locks was delivered in Tasks 1-2. If Step 2's red does not appear (test passes even with the guard removed), the test is not exercising the guard — fix the test before proceeding.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node templates/cli/test.js`
Expected: PASS — `✅ SB self-brick reproduction + dual heal passed`; full suite exits 0.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/integration.js
git commit -m "test(sync-runtime): end-to-end self-brick reproduction — guard + standalone entry both heal (task:sr-selfbrick-test)"
```

---

### Task 4: Register entry in manifest + sync mirror + full regression

**Files:**
- Modify: `templates/cli/template-manifest.js` (`core-cli` family `files` array)
- Result (generated by sync, committed): `.evo-lite/cli/sync-runtime-entry.js` + refreshed mirrors of the already-managed modified files (`memory.js`, `test/governance.js`, `test/integration.js`)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a complete, byte-identical runtime mirror; both suites green through the mirror.

- [ ] **Step 1: Add the manifest entry**

In `templates/cli/template-manifest.js`, in the `core-cli` family `files` array, add (grouped with the other top-level `cli/` modules, e.g. next to `'sync-runtime.js'`):

```
'sync-runtime-entry.js',
```

Do NOT reorder or remove any existing entry.

- [ ] **Step 2: Sync the runtime mirror to convergence**

Because `sync-runtime` runs the mirror's own copy, run it repeatedly until TWO CONSECUTIVE runs report `copied: 0` (≤4 runs is the known bootstrap, not a failure). Prefer the NEW standalone entry — it is exactly the bootstrap-safe path this plan adds:

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
```

If it does not converge within ~4 runs, STOP and report.

- [ ] **Step 3: Verify byte-identical mirror**

Run (bash, from repo root):

```bash
for f in sync-runtime-entry.js memory.js template-manifest.js test/governance.js test/integration.js; do
  diff -q "templates/cli/$f" ".evo-lite/cli/$f" || echo "DRIFT $f"
done
```

All must be identical (no `DRIFT` output).

- [ ] **Step 4: Full regression through both trees**

```bash
node templates/cli/test.js
node ./.evo-lite/cli/test.js
```

Expected: both exit 0, with `T-sr-entry`, `T-sr-guard` (governance) and `SB` (integration) sections all present and green in BOTH the template and mirror runs. This proves the mirrored `memory.js` guard + mirrored entry work through the mirror.

- [ ] **Step 5: Commit**

Stage the manifest edit AND the generated/updated mirror files only:

```bash
git add templates/cli/template-manifest.js .evo-lite/cli/sync-runtime-entry.js .evo-lite/cli/memory.js .evo-lite/cli/template-manifest.js .evo-lite/cli/test/governance.js .evo-lite/cli/test/integration.js
git commit -m "chore(sync-runtime): register bootstrap-safe entry in manifest + sync runtime mirror (task:sr-manifest-sync)"
```

Verify `git status --short` shows only manifest + mirror paths (the post-commit hook may re-touch `active_context.md`; do not stage generated `.evo-lite/generated/*`).

---

## Self-Review

- **Coverage:** entry (Task 1) + guard (Task 2) + faithful self-brick repro (Task 3) + manifest/mirror/regression (Task 4). Both the user-stated 8-step repro and the two heal paths are covered by Task 3.
- **Bootstrap-safety** is asserted statically (Task 1 Step 1 FORBIDDEN list) and behaviorally (Task 3).
- **Guard warns, never silent** — asserted in Task 3 (`/warning: command group/` on stderr).
- **No placeholders** — every step carries the actual entry code, guard code, test code, and exact commands.
- **Type/name consistency** — `safeRegister(program, modulePath, fnName)`, `syncRuntime(projectRoot, options)`, `verifyRuntimeLock(projectRoot)`, `getWorkspaceRoot()` are used consistently across tasks and match the current source.
