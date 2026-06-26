# Release Closure Patch (2.0.10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `2.0.10` that restores the runtime with a deterministic `npm ci` against shipped, in-sync lockfile assets, adds Node 24 to the release-gate matrix, and reconciles the phase-1 R4 spec↔reality conflict.

**Architecture:** Convert the runtime manifest from a dynamically-generated `.evo-lite/package.json` into a pair of shipped template assets (`templates/runtime/package.json` + `templates/runtime/package-lock.json`) that the initializer copies into the scaffold before running `npm ci`. A guard test keeps the shipped manifest's deps equal to `RUNTIME_DEPENDENCIES` (the in-code source of truth). CI and docs/version follow.

**Tech Stack:** Node.js (CommonJS), `npm ci` / `npm pack`, GitHub Actions matrix, the repo's home-grown `node ./.evo-lite/cli/test.js` runner (no Jest/Mocha — `assert` + `console.log` checkpoints), Evo-Lite CLI for governance closure.

## Global Constraints

- `engines.node` MUST stay `>=20.0.0` — no Node-floor bump (spec R-context item 3). Copied verbatim from current [package.json](../../../package.json): `"node": ">=20.0.0"`.
- The shipped runtime manifest's `dependencies` MUST deep-equal `RUNTIME_DEPENDENCIES` in [index.js](../../../index.js): `{ "better-sqlite3": "12.11.1", "tar": "7.5.16", "commander": "15.0.0", "@modelcontextprotocol/sdk": "1.29.0" }`.
- Fail-closed install contract is preserved: failed install → `runtime-not-ready` + non-zero exit; `--skip-install`/`--offline` → `skipped`, npm never invoked (T18c must stay green).
- No template asset may use an npm-pack-stripped filename (`.gitignore`, `.npmignore`). `package.json` / `package-lock.json` are NOT stripped — safe.
- Final gate before tagging: full `node ./.evo-lite/cli/test.js` green **and** `process.exitCode === 0`.

---

### Task 1: Ship runtime lockfile assets + switch installer to `npm ci`

**Files:**
- Create: `templates/runtime/package.json` (shipped static runtime manifest)
- Create: `templates/runtime/package-lock.json` (generated, committed)
- Modify: `index.js:42-49` (`writeRuntimeManifest`), `index.js:65-71` (install command in `installRuntimeDependencies`)
- Test: `templates/cli/test.js` (new guard test + reconcile stale `runInit` harness matchers)

**Interfaces:**
- Consumes: `RUNTIME_DEPENDENCIES` ([index.js:31-36](../../../index.js)), `evoLiteDir` (the scaffold's `.evo-lite/` absolute path), `options.exec` (injectable, default `execSync`), `options.skipInstall`.
- Produces: `writeRuntimeManifest(evoLiteDir)` now copies both `templates/runtime/package.json` and `templates/runtime/package-lock.json` into `evoLiteDir`; `installRuntimeDependencies(evoLiteDir, options)` returns the same `{ ok, state, skipped?, error?, message }` shape but runs `npm ci` on the success path.

- [x] **Step 1: Create the shipped static runtime manifest**

Create `templates/runtime/package.json` with a FIXED name/version (decoupled from `SELF_VERSION` so a create-evo-lite version bump never desyncs the lockfile):

```json
{
  "name": "evo-lite-workspace",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "better-sqlite3": "12.11.1",
    "tar": "7.5.16",
    "commander": "15.0.0",
    "@modelcontextprotocol/sdk": "1.29.0"
  }
}
```

- [x] **Step 2: Generate the matching lockfile (no node_modules)**

Run from repo root (resolves the tree from registry metadata without installing or compiling better-sqlite3):

```bash
npm install --package-lock-only --prefix templates/runtime
```

Expected: `templates/runtime/package-lock.json` is created with `"lockfileVersion": 3`, a `packages[""]` whose `version` is `1.0.0`, and resolved entries for all four deps plus their transitive deps. Verify no `node_modules/` was created under `templates/runtime/`:

```bash
test ! -d templates/runtime/node_modules && echo "OK: no node_modules"
```

- [x] **Step 3: Write the failing guard test (manifest deps == RUNTIME_DEPENDENCIES)**

Add to `templates/cli/test.js` after the T18d block (search `T18d. Testing no template asset`). Use the next free `T18e` id:

```javascript
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
```

- [x] **Step 4: Run the guard test to verify it fails**

Run: `node ./.evo-lite/cli/test.js`
Expected: FAIL at T18e — `index must export RUNTIME_DEPENDENCIES` (it is not exported yet) OR the deep-equal mismatch if export already present.

- [x] **Step 5: Export RUNTIME_DEPENDENCIES from index.js**

In the `module.exports` block at the bottom of [index.js](../../../index.js) (the one already exporting `installRuntimeDependencies` at line ~586), add `RUNTIME_DEPENDENCIES`:

```javascript
module.exports = {
    // ...existing exports...
    installRuntimeDependencies,
    RUNTIME_DEPENDENCIES,
};
```

- [x] **Step 6: Rewrite `writeRuntimeManifest` to copy the shipped assets**

Replace [index.js:42-49](../../../index.js):

```javascript
function writeRuntimeManifest(evoLiteDir) {
    const runtimeTemplateDir = path.join(__dirname, 'templates', 'runtime');
    fs.copyFileSync(
        path.join(runtimeTemplateDir, 'package.json'),
        path.join(evoLiteDir, 'package.json'));
    fs.copyFileSync(
        path.join(runtimeTemplateDir, 'package-lock.json'),
        path.join(evoLiteDir, 'package-lock.json'));
}
```

- [x] **Step 7: Switch the install command to `npm ci`**

In `installRuntimeDependencies` replace the success-path command at [index.js:70](../../../index.js):

```javascript
        // npm ci restores the exact shipped lockfile — deterministic, no resolution.
        exec('npm ci', { cwd: evoLiteDir, stdio: 'inherit' });
```

Leave the `writeManifest !== false` guard, the skip-install branch, and the `catch` fail-closed return unchanged.

- [x] **Step 8: Reconcile the manual-recovery hint to npm ci**

The fail-path hint at [index.js:490](../../../index.js) currently tells the user to `npm install <specs>`. Update it to the deterministic path:

```javascript
        console.warn(`👉 请稍后手动在 .evo-lite 目录运行:\nnpm ci`);
```

(Keep `runtimeInstallSpecs()` defined — it is still used by the secondary hint at [index.js:543](../../../index.js); leave that line as-is, it is a different, build-tool-failure branch.)

- [x] **Step 9: Run tests; reconcile stale runInit harness matchers**

Run: `node ./.evo-lite/cli/test.js`
Two `runInit` integration harnesses stub `execSyncImpl` with a stale string `'npm install better-sqlite3 tar commander'` at [test.js:1916](../../cli/test.js) and [test.js:2045](../../cli/test.js). If either now throws `STOP_AFTER_CHECK` / `UNEXPECTED_COMMAND:npm ci`, change that matcher to the new command:

```javascript
                if (command === 'npm ci') {
                    return Buffer.from('');
                }
```

(Delete the old `'npm install better-sqlite3 tar commander'` branch — it is dead.)

- [x] **Step 10: Run the full suite to verify green**

Run: `node ./.evo-lite/cli/test.js`
Expected: PASS — all checkpoints green, including T18c (fail-closed/skip-install) and the new T18e. Confirm the process exits 0:

```bash
node ./.evo-lite/cli/test.js; echo "exit=$?"
```
Expected: final line `exit=0`.

- [x] **Step 11: Commit**

```bash
git add templates/runtime/package.json templates/runtime/package-lock.json index.js templates/cli/test.js
git commit -m "feat(runtime): ship lockfile + npm ci for deterministic runtime install"
```

---

### Task 2: Add Node 24 to the release-gate matrix and use the npm ci path

**Files:**
- Modify: `.github/workflows/release-gate.yml:24-33` (matrix), `:51-56` (runtime install step), `:8-10` (stale comment)

**Interfaces:**
- Consumes: the shipped `templates/runtime/package-lock.json` from Task 1 (so CI installs via `npm ci`, not ad-hoc).
- Produces: a matrix proving the packed tarball + `npm ci` runtime install works on the Node-20→24 range.

- [x] **Step 1: Confirm better-sqlite3 node-24 prebuild availability**

better-sqlite3 `12.11.1` install on a runner uses `prebuild-install`. Check whether a Windows x64 node-24 (NODE_MODULE_VERSION 137) prebuild is published:

```bash
npm view better-sqlite3@12.11.1 dist.tarball
```
Then inspect the project's prebuild releases on its repo for `better_sqlite3-v12.11.1-node-v137-win32-x64.tar.gz`. Decision rule for Step 2: if a win + node-24 prebuild exists → include `windows-latest` + `node: 24`; if NOT → exclude it with the same rationale already used for win + node-20.

- [x] **Step 2: Update the matrix**

In [.github/workflows/release-gate.yml](../../../.github/workflows/release-gate.yml) replace the `node: [20, 22]` line and the `exclude` block:

```yaml
        node: [20, 22, 24]
        exclude:
          # better-sqlite3 ships no node-20 win-x64 prebuild and the runner lacks a
          # node-gyp-detectable MSVC, so a build-tool-free install can't succeed on
          # Windows + Node 20. Node 20 stays covered on Linux; Windows starts at Node 22.
          - os: windows-latest
            node: 20
          # KEEP THIS BLOCK ONLY IF Step 1 found no win-x64 node-24 prebuild:
          - os: windows-latest
            node: 24
```

If Step 1 found a win+node-24 prebuild, delete the second `exclude` entry.

- [x] **Step 3: Switch the runtime install step to npm ci**

Replace the "Runtime test suite" step body at [.github/workflows/release-gate.yml:51-56](../../../.github/workflows/release-gate.yml):

```yaml
      - name: Runtime test suite
        # Restore the shipped runtime lockfile deterministically (matches RUNTIME_DEPENDENCIES).
        shell: bash
        run: |
          cp templates/runtime/package.json templates/runtime/package-lock.json .evo-lite/
          npm ci --prefix .evo-lite
          npm test
```

- [x] **Step 4: Update the stale header comment**

The header at [.github/workflows/release-gate.yml:8-10](../../../.github/workflows/release-gate.yml) says the npm-ci/lockfile work is pending in "Task 2". Replace those lines:

```yaml
# The runtime test step restores the shipped runtime lockfile with `npm ci`
# (templates/runtime/package-lock.json), matching the deterministic install the
# initializer performs for consumers.
```

- [x] **Step 5: Validate the workflow YAML locally**

Run (Node parses YAML structure via the repo's existing deps, or use a quick check):

```bash
node -e "const y=require('fs').readFileSync('.github/workflows/release-gate.yml','utf8'); if(!/node:\s*\[20,\s*22,\s*24\]/.test(y)) throw new Error('matrix not updated'); if(!/npm ci/.test(y)) throw new Error('npm ci missing'); console.log('OK workflow updated')"
```
Expected: `OK workflow updated`.

- [x] **Step 6: Commit**

```bash
git add .github/workflows/release-gate.yml
git commit -m "ci(release-gate): add Node 24 matrix, install runtime via npm ci"
```

---

### Task 3: Bump version to 2.0.10 and add the changelog entry

**Files:**
- Modify: `package.json:3` (version), `CHANGELOG.md` (new top entry)

**Interfaces:**
- Consumes: nothing.
- Produces: `SELF_VERSION` (read from `package.json` at [index.js:10](../../../index.js)) becomes `2.0.10`.

- [x] **Step 1: Bump the version**

In [package.json](../../../package.json) change line 3:

```json
    "version": "2.0.10",
```

- [x] **Step 2: Add the changelog entry**

Prepend a `2.0.10` section at the top of the entries in [CHANGELOG.md](../../../CHANGELOG.md) (match the file's existing heading style — read the top of the file first and mirror it). Content:

```markdown
## 2.0.10

### Fixed
- **Deterministic runtime install**: the scaffolded `.evo-lite/` now ships a
  pinned `package.json` + `package-lock.json` and installs with `npm ci` instead
  of bare `npm install`, so a given `create-evo-lite` version always restores the
  same runtime dependency tree. Supersedes the ad-hoc install path.

### Added
- **Node 24 in the release gate**: the pack-and-consume CI matrix now covers
  Node 24 alongside 20 (Linux) and 22, on Linux and Windows.
```

- [x] **Step 3: Verify version propagates**

Run:

```bash
node -e "console.log(require('./package.json').version)"
```
Expected: `2.0.10`.

- [x] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): bump version to 2.0.10 with changelog"
```

---

### Task 4: Reconcile phase-1 spec R4 to the shipped informational gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-release-hardening-phase1.md` (R4 text + Acceptance Criteria line)

**Interfaces:**
- Consumes: nothing.
- Produces: a spec whose R4 wording matches the informational gate that actually shipped, so governance drift carries no `error`-level finding about it.

- [x] **Step 1: Amend the R4 requirement text**

In [docs/superpowers/specs/2026-06-23-release-hardening-phase1.md](../specs/2026-06-23-release-hardening-phase1.md) replace the last sentence of R4 (currently `Merge to `main` MUST require this gate.`) with:

```markdown
The gate MUST run green on CI for every PR and push to `main`. Promoting it to a
**required** status check for `main` is a documented manual repo-admin step
(branch-protection settings; not enforceable from the CLI) — it is therefore an
informational gate by default, not an automatically-enforced merge block.
```

- [x] **Step 2: Amend the matching Acceptance Criteria bullet**

Replace the final acceptance bullet (currently ends `... the gate is required before merge to `main`.`) with:

```markdown
- CI runs the Linux+Windows × Node-range matrix, packs the tarball, installs it
  into an empty non-Node project, and passes `verify` + `mcp-validate`; the gate
  runs green and the required-check promotion is documented as a manual repo-admin
  step.
```

- [x] **Step 3: Verify no error-level drift remains about R4**

Run the Evo-Lite verify + planning drift:

```bash
.\.evo-lite\mem.cmd verify
node ./.evo-lite/cli/memory.js plan gaps
```
Expected: `verify` reports no active alerts; `plan gaps` shows no `error`-level finding referencing the R4 required-check conflict.

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-23-release-hardening-phase1.md
git commit -m "docs(spec:release-hardening-phase1): reconcile R4 to shipped informational gate"
```

---

### Task 5: Final dogfood verification + close this spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-24-release-closure-patch.md` (status → done, on green)

- [x] **Step 1: Full suite + exit-code check**

```bash
node ./.evo-lite/cli/test.js; echo "exit=$?"
```
Expected: all checkpoints green; final line `exit=0`.

- [x] **Step 2: Prove the packed consumer path locally**

```bash
npm pack
node -e "const fs=require('fs');const t=fs.readdirSync('.').find(f=>/^create-evo-lite-.*\.tgz$/.test(f));const {execSync}=require('child_process');const tar=require('tar');const out='./.pack-check';fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);tar.x({file:t,cwd:out,sync:true});const base=out+'/package/templates/runtime';if(!fs.existsSync(base+'/package.json')||!fs.existsSync(base+'/package-lock.json'))throw new Error('runtime lockfile assets missing from tarball');console.log('OK: tarball ships runtime/package.json + package-lock.json')"
```
Expected: `OK: tarball ships runtime/package.json + package-lock.json`. Clean up: `rm -rf .pack-check create-evo-lite-*.tgz`.

- [x] **Step 3: Mark this spec done**

In [docs/superpowers/specs/2026-06-24-release-closure-patch.md](2026-06-24-release-closure-patch.md) change frontmatter `status: draft` → `status: done` only after Steps 1-2 are green.

- [x] **Step 4: Closure commit + governance track**

```bash
git add docs/superpowers/specs/2026-06-24-release-closure-patch.md
git commit -m "docs(spec:release-closure-patch): mark done — 2.0.10 verified green"
.\.evo-lite\mem.cmd verify
```
Expected: `verify` green, no active alerts. (Publishing `2.0.10` to npm + tagging is a separate manual release action, not part of this plan.)

---

## Self-Review

**1. Spec coverage:**
- R1 (npm ci + shipped in-sync lockfile, deps == RUNTIME_DEPENDENCIES, fail-closed preserved) → Task 1 (Steps 1-10).
- R2 (Node 24 matrix, keep coverage, npm ci in CI) → Task 2.
- R3 (version 2.0.10 + changelog) → Task 3.
- R4 (reconcile phase-1 R4 text) → Task 4.
- Acceptance "tarball ships both assets" → Task 5 Step 2. Acceptance "full test green + exit 0" → Task 1 Step 10 + Task 5 Step 1. Acceptance "no error-drift about R4" → Task 4 Step 3.

**2. Placeholder scan:** Step 2 of Task 2 contains a conditional `exclude` entry — this is a documented decision rule keyed on Step 1's prebuild finding, not a TODO; both branches are spelled out. No other placeholders.

**3. Type consistency:** `RUNTIME_DEPENDENCIES` (object) is exported in Task 1 Step 5 and consumed by the same name in the Task 1 Step 3 test and the Global Constraints. `writeRuntimeManifest(evoLiteDir)` and `installRuntimeDependencies(evoLiteDir, options)` signatures are unchanged from the live code. Shipped manifest version `1.0.0` is asserted equal to lockfile `packages[''].version` (Task 1 Step 3) and is generated to match in Step 2.
