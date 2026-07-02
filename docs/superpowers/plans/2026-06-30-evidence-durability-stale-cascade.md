# Evidence Durability — Kill the STALE Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 249 KB `test.js` monolith into a thin dispatcher plus `test/harness.js`, `test/governance.js`, and `test/integration.js`, so editing one functional area's tests stops staling every acceptance criterion.

**Architecture:** `test.js` already subsets by `TEST_SCOPE = process.argv[2] || 'all'` via `shouldRun(scope)`, with one scoped suite (`governance` = `runGovernanceTests`) and the default `integration` suite (the `runTests` body). We move the shared helpers into `test/harness.js`, each suite into its own file that imports the harness, and reduce `test.js` to a dispatcher that requires and runs the suites. Moving the churn-heavy integration tests out of `test.js` breaks the cascade for existing criteria (the file barely changes anymore); retargeting `dependsOn` onto the per-suite files makes staleness precise.

**Tech Stack:** Node.js (CommonJS `require`/`module.exports`), `assert`, no test framework — hand-rolled suites invoked from `runTests()`. Verifier commands run through `node ./.evo-lite/cli/test.js`.

## Global Constraints

- **Double mirror:** every file under `cli/` exists in BOTH `templates/cli/` (source) and `.evo-lite/cli/` (live runtime mirror). Every create/modify in this plan happens in BOTH trees, byte-identical. `npm test` runs `node ./.evo-lite/cli/test.js`.
- **Node floor:** `>=20.0.0` (`package.json` engines). CommonJS only; no ESM.
- **No pack-stripped names:** template asset filenames must survive `npm pack` (test T18d). `test/harness.js`, `test/governance.js`, `test/integration.js` are plain `.js` — safe.
- **Managed manifest:** any new managed template file MUST be registered in `template-manifest.js` `core-cli.files`, in BOTH mirrors, or sync-runtime drift tests (T17/T25) fail.
- **Self-brick avoidance:** create the new files in BOTH mirror trees FIRST, then register them in the manifest. Never register a managed file before it physically exists in the mirror, or a sync pass that loads the mirror can brick.
- **Behavior preservation:** `npm test` (scope `all`) and `node ./.evo-lite/cli/test.js governance` must stay green with identical test counts throughout.

---

### Task 1: Extract shared harness into `cli/test/harness.js`

Move the constants and helper functions (currently `test.js` lines ~1–361, excluding `runGovernanceTests`) into a new harness module that both suites import. This is a verbatim relocation plus an export block; `test.js` gains a `require` and keeps everything else working.

**Files:**
- Create: `templates/cli/test/harness.js`
- Create: `.evo-lite/cli/test/harness.js` (byte-identical copy of the above)
- Modify: `templates/cli/test.js` (remove moved defs; `require` the harness)
- Modify: `.evo-lite/cli/test.js` (identical change)

**Interfaces:**
- Produces (`test/harness.js` exports, all consumed by later tasks): `CLI_DIR`, `WORKSPACE_ROOT`, `TEMPLATE_CONTEXT_PATH`, `SHARED_CACHE_DIR`, `TEMPLATE_CLI_DIR`, `TEMPLATE_ROOT_DIR`, `INIT_ENTRY`, `TEST_SCOPE`, `shouldRun`, `createTempRuntimeRoot`, `createTempTemplateCli`, `copyRecursive`, `createTempTemplateRoot`, `ensureParent`, `writeText`, `runGit`, `getGitShell`, `runPostCommitHook`, `createHookTestRepo`, `runInitializer` — plus any other top-level helper defined above `runGovernanceTests`.
- Note: harness performs the `NODE_PATH` side-effect (`process.env.NODE_PATH = ...; require('module').Module._initPaths();`) at load time, so importing it first preserves module resolution for the suites.

- [ ] **Step 1: Create `test/harness.js` in both mirrors**

Move `test.js` lines 1–361 (the `require`s, all constants, the `NODE_PATH` side-effect, and every helper function through the end of `runInitializer` / just before `async function runGovernanceTests()` at line 363) verbatim into `templates/cli/test/harness.js`. Because the file moves down one directory, update the two path anchors:

```javascript
// was: const CLI_DIR = __dirname;               // .../cli
// now (test/harness.js lives in .../cli/test):
const CLI_DIR = path.resolve(__dirname, '..');            // .../cli
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..'); // repo root
```

Append the export block at the end:

```javascript
module.exports = {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY, TEST_SCOPE, shouldRun,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
};
```

Copy the finished file byte-for-byte to `.evo-lite/cli/test/harness.js`.

- [ ] **Step 2: Rewire `test.js` to import the harness (both mirrors)**

Replace the removed lines 1–361 of `test.js` with:

```javascript
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY, TEST_SCOPE, shouldRun,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
} = require('./test/harness');
```

Keep `runGovernanceTests` and `runTests` in `test.js` unchanged for now (extracted in Tasks 2–3). Retain only the `require`s still used directly by the remaining bodies (`assert`, `fs`, `os`, `path`); drop `child_process` if no longer referenced in `test.js`.

- [ ] **Step 3: Run the full suite to verify green**

Run: `node ./.evo-lite/cli/test.js`
Expected: PASS — final line `--- All CLI integration tests passed! ---`, exit 0, same test count as before.

- [ ] **Step 4: Run the governance scope to verify green**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: PASS — governance suite (T13…T18h) all ✅, exit 0.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/harness.js .evo-lite/cli/test/harness.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "refactor(test): extract shared test harness into cli/test/harness.js"
```

---

### Task 2: Extract governance suite into `cli/test/governance.js`

**Files:**
- Create: `templates/cli/test/governance.js`
- Create: `.evo-lite/cli/test/governance.js` (byte-identical)
- Modify: `templates/cli/test.js` (require governance suite)
- Modify: `.evo-lite/cli/test.js` (identical)

**Interfaces:**
- Consumes: all harness exports from Task 1 via `require('./harness')`.
- Produces: `module.exports = { runGovernanceTests }` — an `async function` that runs the governance suite and `assert`s throughout; it does NOT call `process.exit` (the dispatcher owns exit codes).

- [ ] **Step 1: Create `test/governance.js` in both mirrors**

Move `test.js` `async function runGovernanceTests() { … }` (lines 363 through its closing brace at ~2176, i.e. everything before `async function runTests()` at line 2178) verbatim into `templates/cli/test/governance.js`, prefixed with:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY, shouldRun,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
} = require('./harness');
```

and suffixed with:

```javascript
module.exports = { runGovernanceTests };
```

(Trim the destructured list to exactly the names `runGovernanceTests` references; unused imports are harmless but keep it tidy.) Copy byte-for-byte to `.evo-lite/cli/test/governance.js`.

- [ ] **Step 2: Require the governance suite from `test.js` (both mirrors)**

Remove the `runGovernanceTests` definition from `test.js`. Add near the top imports:

```javascript
const { runGovernanceTests } = require('./test/governance');
```

Leave the call site inside `runTests` (`await runGovernanceTests();`) unchanged.

- [ ] **Step 3: Run governance scope to verify it fails loudly if wired wrong, then green**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: PASS — governance suite all ✅, exit 0. (If the extracted file has a bad `require`, expect a hard `Cannot find module` / `ReferenceError` and a non-zero exit — never a silent skip.)

- [ ] **Step 4: Run the full suite to verify green**

Run: `node ./.evo-lite/cli/test.js`
Expected: PASS, exit 0, unchanged test count.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "refactor(test): extract governance suite into cli/test/governance.js"
```

---

### Task 3: Extract integration suite into `cli/test/integration.js` and make `test.js` a thin dispatcher

**Files:**
- Create: `templates/cli/test/integration.js`
- Create: `.evo-lite/cli/test/integration.js` (byte-identical)
- Modify: `templates/cli/test.js` (reduce to dispatcher)
- Modify: `.evo-lite/cli/test.js` (identical)

**Interfaces:**
- Consumes: harness exports (Task 1), `runGovernanceTests` (Task 2).
- Produces: `test/integration.js` exports `module.exports = { runIntegrationTests }` — an `async function` containing the integration test body; it throws on failure and does NOT call `process.exit`.
- Produces: `test.js` is the entrypoint; on success prints `--- All CLI integration tests passed! ---` and exits 0, on failure prints the error and exits 1, on unknown scope prints `Unknown test scope: <scope>` and exits 1.

- [ ] **Step 1: Create `test/integration.js` in both mirrors**

Move the integration body of `runTests` — from `console.log('--- Starting CLI integration tests ---');` (line 2192) through the end of the integration logic just before the final `runTests()` invocation (line 3879), including its `try`/`catch` and the success/`process.exit(1)` handling at ~3875 — into a new `async function runIntegrationTests()` in `templates/cli/test/integration.js`. Prefix:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    CLI_DIR, WORKSPACE_ROOT, TEMPLATE_CONTEXT_PATH, SHARED_CACHE_DIR,
    TEMPLATE_CLI_DIR, TEMPLATE_ROOT_DIR, INIT_ENTRY,
    createTempRuntimeRoot, createTempTemplateCli, copyRecursive, createTempTemplateRoot,
    ensureParent, writeText, runGit, getGitShell, runPostCommitHook,
    createHookTestRepo, runInitializer,
} = require('./harness');

async function runIntegrationTests() {
    console.log('--- Starting CLI integration tests ---');
```

Move the body in verbatim. Convert the terminal success/failure handling: instead of `process.exit(1)` on catch, `throw` the error so the dispatcher decides the exit code; on success just `console.log('--- All CLI integration tests passed! ---');` (no `process.exit(0)`). Suffix:

```javascript
}

module.exports = { runIntegrationTests };
```

Copy byte-for-byte to `.evo-lite/cli/test/integration.js`.

- [ ] **Step 2: Reduce `test.js` to a thin dispatcher (both mirrors)**

`test.js` in full becomes:

```javascript
'use strict';
const { TEST_SCOPE, shouldRun } = require('./test/harness');
const { runGovernanceTests } = require('./test/governance');
const { runIntegrationTests } = require('./test/integration');

async function runTests() {
    if (!shouldRun('governance')) {
        console.error(`Unknown test scope: ${TEST_SCOPE}`);
        process.exit(1);
    }

    // 'all' MUST run both suites so `npm test` / CI exercise the governance guards too;
    // 'governance' runs only the governance suite.
    if (TEST_SCOPE === 'governance' || TEST_SCOPE === 'all') {
        await runGovernanceTests();
        if (TEST_SCOPE === 'governance') return;
    }

    await runIntegrationTests();
}

runTests().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
```

- [ ] **Step 3: Verify full suite green**

Run: `node ./.evo-lite/cli/test.js`
Expected: PASS — governance ✅ then `--- All CLI integration tests passed! ---`, exit 0.

- [ ] **Step 4: Verify governance-only scope green and returns early**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: PASS — governance ✅ only, no integration output, exit 0.

- [ ] **Step 5: Verify unknown scope fails loudly**

Run: `node ./.evo-lite/cli/test.js bogus; echo "exit=$?"`
Expected: prints `Unknown test scope: bogus`, `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/test/integration.js .evo-lite/cli/test/integration.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "refactor(test): extract integration suite; reduce test.js to a scope dispatcher"
```

---

### Task 4: Register the new suite files in the managed template manifest

**Files:**
- Modify: `templates/cli/template-manifest.js` (add 3 entries to `core-cli.files`)
- Modify: `.evo-lite/cli/template-manifest.js` (identical)

**Interfaces:**
- Consumes: existing `MANAGED_TEMPLATE_FAMILIES` structure; `file` entries are POSIX-relative paths under `cli/` and are split on `/` by `buildEntry`.

- [ ] **Step 1: Add the three files to `core-cli.files` (both mirrors)**

In the `core-cli` family `files` array, immediately after `'test.js',` (line 20), insert:

```javascript
            'test/harness.js',
            'test/governance.js',
            'test/integration.js',
```

Apply the identical edit to both `templates/cli/template-manifest.js` and `.evo-lite/cli/template-manifest.js`.

- [ ] **Step 2: Verify the manifest lists the new files**

Run: `node -e "const {MANAGED_TEMPLATE_FAMILIES}=require('./.evo-lite/cli/template-manifest'); const f=MANAGED_TEMPLATE_FAMILIES.find(x=>x.key==='core-cli').files; console.log(['test/harness.js','test/governance.js','test/integration.js'].every(n=>f.includes(n)))"`
Expected: `true`

- [ ] **Step 3: Verify sync-runtime drift detection stays green (files already present in both mirrors)**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: PASS — including T17 (`sync-runtime + lock detects template/runtime drift`) and T25 (`stale lock with matching mirror content is not drift`). The new managed files exist byte-identical in both mirrors, so no drift.

- [ ] **Step 4: Verify `verify` reports no template drift**

Run: `node ./.evo-lite/cli/memory.js verify`
Expected: no template-drift alert naming `test/harness.js`, `test/governance.js`, or `test/integration.js`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
git commit -m "chore(templates): register split test suite files in managed manifest"
```

---

### Task 5: Add the precision regression test and dogfood the new spec's contract

Prove the cascade is broken: a change confined to `test/integration.js` must NOT stale a governance criterion, while a change to `test/governance.js` or `test/harness.js` must. Add this as a governance-suite test using the pure `deriveVerdicts`/`dependsMatches` helpers (no git needed).

**Files:**
- Modify: `templates/cli/test/governance.js` (add T-precision test)
- Modify: `.evo-lite/cli/test/governance.js` (identical)
- Verify-only: `docs/superpowers/specs/2026-06-30-evidence-durability-stale-cascade-design.md` (its criteria already point at the new files)

**Interfaces:**
- Consumes: `deriveVerdicts`, `globToRegExp` from `verification/derive-verdicts.js`. `deriveVerdicts(criteria, records, headSha, changedFiles)` returns `[{criterionId, verdict, detail}]`; a PASS record whose `dependsOn` matches a changed file yields `verdict: 'STALE'`, else `'PASS'` (see `derive-verdicts.js:53-55`).

- [ ] **Step 1: Write the failing precision test**

Add inside `runGovernanceTests` in `test/governance.js`, following the existing `console.log('Tnn. …')` / block style:

```javascript
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
```

- [ ] **Step 2: Run governance scope to verify the new test passes**

Run: `node ./.evo-lite/cli/test.js governance`
Expected: PASS — includes `✅ T-precision per-suite dependsOn isolation passed`, exit 0.

- [ ] **Step 3: Run the verification contract on the new spec end-to-end**

Run: `node ./.evo-lite/cli/memory.js verify-contract run spec:evidence-durability-stale-cascade`
Expected: the four criteria (`ac-suite-split`, `ac-precision-no-cascade`, `ac-full-suite-green`, `ac-mirror-parity`) each record a PASS; overall status READY. (If a criterion is STALE because its digest just changed, re-run once to re-record at the current digest.)

- [ ] **Step 4: Verify full suite still green**

Run: `node ./.evo-lite/cli/test.js`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "test(governance): assert per-suite dependsOn isolates STALE from the integration suite"
```

---

## Follow-up (out of scope, do not silently drop)

Seven historical specs still list `templates/cli/test.js` in their `dependsOn`
(`2026-05-14-evo-recall-first-takeover`, `verification-contract-phase0/1/2/3`,
`verification-contract-closure-hardening`, `verification-contract-criterion-digest`).
The split de-churns `test.js` so they no longer cascade on integration edits, but their
`dependsOn` is now imprecise. Retargeting them to the per-suite files is per-spec hygiene
tracked separately, not required to kill the cascade. The active
`2026-06-28-verification-contract-closure-correctness` spec is the best candidate to
retarget first if this is picked up.

## Self-Review

- **Spec coverage:** split into harness/governance/integration + thin dispatcher (Tasks 1–3) ✓; manifest registration + mirror parity (Task 4) ✓; dependsOn precision + dogfood (Task 5, new spec's criteria already point at the new files) ✓; error handling (unknown scope exits 1, require failure throws — Task 3 Steps 5 / Task 2 Step 3) ✓; testing notes incl. precision assertion (Task 5) ✓; one-time STALE churn (Task 5 Step 3 re-run note) ✓; sync self-brick mitigation (Global Constraints + Task 4 ordering) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows full new/boilerplate code; moved code is verbatim relocation with exact line ranges.
- **Type consistency:** `runGovernanceTests` / `runIntegrationTests` / `runTests` names and the harness export list are consistent across Tasks 1–3 and the dispatcher; `deriveVerdicts(criteria, records, headSha, changedFiles)` signature matches `derive-verdicts.js`.
