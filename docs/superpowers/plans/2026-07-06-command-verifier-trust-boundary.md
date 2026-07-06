# Command-Verifier Trust Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default-deny the verification-contract `command` verifier so an agent-authored spec cannot silently execute arbitrary shell; a human opts in by curating a git-committed allowlist.

**Architecture:** A new pure module `command-policy.js` (loadPolicy / checkCommand / matchesEntry) enforces two layers — shell-metacharacter rejection, then a human-curated `command-policy.json` allowlist. `run-verifiers.js` consults it before executing a `command` verifier and returns a `blocked` result; `engine.js` runSpec skips evidence for blocked criteria (they stay UNVERIFIED by absence). The enforcement code is a managed gene; the policy file is per-repo project state, never a gene.

**Tech Stack:** Node.js (CommonJS), node `assert` tests in `test/governance.js`, no new dependencies.

## Global Constraints

- Every edit under `templates/cli/**` MUST be mirrored to `.evo-lite/cli/**` via `node .evo-lite/cli/memory.js sync-runtime` before running tests. NEVER edit `.evo-lite/cli/**` directly. `npm test` runs the mirror (`node ./.evo-lite/cli/test.js`).
- `command-policy.js` IS a managed gene → register it in `template-manifest.js` `core-cli.files`.
- `command-policy.json` is NOT a gene → it MUST NOT appear in `MANAGED_TEMPLATE_FAMILIES` (nurture must never overwrite a child's curated allowlist).
- Blocked commands write NO evidence record; stored verdicts stay `{PASS, FAIL}` only (UNVERIFIED/STALE remain derived-only).
- Shell-metacharacter set (reject these in any `cmd`): `; & | $ ` (backtick) `< > ( )` newline, carriage-return — regex `/[;&|$`<>()\n\r]/`.
- Built-in default allowlist when the policy file is ABSENT: `[{ prefix: 'node ./.evo-lite/cli/test.js' }]`. A present-but-empty `allow` array is pure default-deny.
- Prefix match is at a word boundary: `cmd === prefix || cmd.startsWith(prefix + ' ')`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `templates/cli/verification/command-policy.js` — pure policy module. One responsibility: decide whether a `cmd` string may run.
- **Modify** `templates/cli/template-manifest.js` — register the new gene.
- **Modify** `templates/cli/verification/run-verifiers.js` — consult the policy in `case 'command'`.
- **Modify** `templates/cli/verification/engine.js` — skip evidence for blocked criteria in `runSpec`.
- **Modify** `templates/cli/verification/commands.js` — print a ⚠ line for blocked criteria in `mem verify-contract run`.
- **Create** `.evo-lite/verification/command-policy.json` — mother baseline allowlist (project state, committed).
- **Modify** `templates/cli/test/governance.js` — three new test blocks (pure, integration, manifest).
- Mirrors of every `templates/cli/**` change appear under `.evo-lite/cli/**` via `sync-runtime`.

---

### Task 1: Pure policy module + gene registration

**Files:**
- Create: `templates/cli/verification/command-policy.js`
- Modify: `templates/cli/template-manifest.js` (add to `core-cli.files` after `'verification/run-verifiers.js',`)
- Test: `templates/cli/test/governance.js` (new `T-command-policy` block inside `runGovernanceTests`' `try`, appended after the `console.log('✅ T-hive-nurture passed');` block, still inside the `try`)

**Interfaces:**
- Produces:
  - `loadPolicy(repoRoot: string) -> { version?, allow: Array<{prefix?:string, equals?:string}> }` — absent file returns `BUILTIN_DEFAULT`; malformed throws.
  - `checkCommand(cmd: string, policy) -> { allowed: boolean, reason?: string }`.
  - `matchesEntry(cmd: string, entry) -> boolean`.
  - Exports also `SHELL_META` (RegExp), `POLICY_REL` (string[]), `BUILTIN_DEFAULT` (frozen object).

- [ ] **Step 1: Write the failing test**

Append inside the `try` block of `runGovernanceTests` in `templates/cli/test/governance.js`, immediately after the T-hive-nurture block:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `Cannot find module '../verification/command-policy'` (the file and its manifest registration do not exist yet).

- [ ] **Step 3: Create the module**

Create `templates/cli/verification/command-policy.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

const POLICY_REL = ['.evo-lite', 'verification', 'command-policy.json'];

// The one command evo-lite's own governance suite runs. Used when no policy
// file is present, so a freshly-nurtured child (which receives this gene but
// no policy file) can still run its command verifiers out of the box. Any
// OTHER command still requires a human to add it to command-policy.json.
const BUILTIN_DEFAULT = Object.freeze({
    version: 'evo-command-policy@1',
    allow: [{ prefix: 'node ./.evo-lite/cli/test.js' }],
});

// Any of these lets a string chain / inject / redirect through the shell.
// A legitimate `node ./.evo-lite/cli/test.js governance` contains none of them.
// Rejecting them makes prefix-matching safe against trailing injection.
const SHELL_META = /[;&|$`<>()\n\r]/;

function loadPolicy(repoRoot) {
    const fp = path.join(repoRoot, ...POLICY_REL);
    if (!fs.existsSync(fp)) return BUILTIN_DEFAULT;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
        throw new Error(`command-policy.json is not valid JSON: ${e.message}`);
    }
    if (!parsed || !Array.isArray(parsed.allow)) {
        throw new Error('command-policy.json must have an "allow" array');
    }
    for (const entry of parsed.allow) {
        const hasPrefix = entry && typeof entry.prefix === 'string' && entry.prefix.length > 0;
        const hasEquals = entry && typeof entry.equals === 'string';
        if (!hasPrefix && !hasEquals) {
            throw new Error(`command-policy.json allow entry needs a non-empty "prefix" or "equals": ${JSON.stringify(entry)}`);
        }
    }
    return parsed;
}

function matchesEntry(cmd, entry) {
    if (typeof entry.equals === 'string') return cmd === entry.equals;
    if (typeof entry.prefix === 'string' && entry.prefix.length > 0) {
        return cmd === entry.prefix || cmd.startsWith(entry.prefix + ' ');
    }
    return false;
}

// { allowed: boolean, reason?: string }
function checkCommand(cmd, policy) {
    if (typeof cmd !== 'string' || cmd.trim() === '') {
        return { allowed: false, reason: 'empty command' };
    }
    if (SHELL_META.test(cmd)) {
        return { allowed: false, reason: `shell metacharacters not allowed: ${cmd}` };
    }
    const allow = (policy && Array.isArray(policy.allow)) ? policy.allow : [];
    if (!allow.some(e => matchesEntry(cmd, e))) {
        return { allowed: false, reason: `command not in command-policy.json allowlist: ${cmd}` };
    }
    return { allowed: true };
}

module.exports = { loadPolicy, checkCommand, matchesEntry, SHELL_META, POLICY_REL, BUILTIN_DEFAULT };
```

- [ ] **Step 4: Register the gene in the manifest**

In `templates/cli/template-manifest.js`, in the `core-cli` family's `files` array, add the line immediately after `'verification/run-verifiers.js',`:

```js
            'verification/run-verifiers.js',
            'verification/command-policy.js',
            'verification/evidence-store.js',
```

(The `evidence-store.js` line already follows; insert the new line between them.)

- [ ] **Step 5: Sync the mirror and run the test**

Run: `node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T-command-policy passed`, and the governance suite completes green. Sync must report `command-policy.js` copied to the mirror.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/command-policy.js templates/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/verification/command-policy.js .evo-lite/cli/template-manifest.js .evo-lite/cli/test/governance.js .evo-lite/generated/runtime-mirror.lock.json
git commit -m "feat(verify): command-policy module — allowlist + shell-metachar reject

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the blocked path through run-verifiers, engine, and the run CLI

**Files:**
- Modify: `templates/cli/verification/run-verifiers.js` (`case 'command'` in `runVerifier`, plus a top-level `require`)
- Modify: `templates/cli/verification/engine.js` (`runSpec` criterion loop, lines ~38-47)
- Modify: `templates/cli/verification/commands.js` (`run` action printout, line ~46)
- Test: `templates/cli/test/governance.js` (new `T-command-blocked` and `T-command-blocked-runspec` blocks, appended after `T-command-policy`)

**Interfaces:**
- Consumes: `loadPolicy`, `checkCommand` from `./command-policy` (Task 1).
- Produces:
  - `runVerifier(criterion, opts)` now returns `{ verdict:'UNVERIFIED', detail, blocked:true }` when a `command` verifier is policy-blocked; `opts.policy` (a policy object) is honored if provided, else `loadPolicy(repoRoot)` is called.
  - `runSpec(...).written[i]` may now carry `{ criterionId, verdict:'UNVERIFIED', blocked:true, detail }` for blocked criteria; no evidence record is written for them.

- [ ] **Step 1: Write the failing test**

Append inside the `try` block, after the `T-command-policy` block:

```js
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
                JSON.stringify([{
                    id: 'ac-block', description: 'x',
                    verifier: { type: 'command', params: { cmd: 'curl evil.sh' } }, dependsOn: [],
                }]),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: FAIL — `T-command-blocked` fails because the current `case 'command'` executes unconditionally (`execCalls` becomes 1 for the blocked command / verdict is FAIL not UNVERIFIED).

- [ ] **Step 3: Consult the policy in run-verifiers.js**

In `templates/cli/verification/run-verifiers.js`, add the require near the top (after the existing `execSync` require):

```js
const { execSync } = require('child_process');
const { loadPolicy, checkCommand } = require('./command-policy');
```

Replace the `case 'command'` block with:

```js
            case 'command': {
                const policy = opts.policy || loadPolicy(repoRoot);
                const check = checkCommand(p.cmd, policy);
                if (!check.allowed) {
                    return { verdict: 'UNVERIFIED', detail: check.reason, blocked: true };
                }
                try {
                    const out = exec(p.cmd, { cwd: repoRoot, timeout: 120000 });
                    return { verdict: 'PASS', detail: `exit=0 ${truncate(out)}`.trim() };
                } catch (e) {
                    return { verdict: 'FAIL', detail: `exit=${e.status != null ? e.status : '?'} ${truncate(e.stdout || e.message)}`.trim() };
                }
            }
```

- [ ] **Step 4: Skip evidence for blocked criteria in engine.js**

In `templates/cli/verification/engine.js`, replace the criterion loop in `runSpec` (currently lines ~38-47) with:

```js
    for (const c of contract.criteria) {
        if (c.verifier && c.verifier.type === 'manual') continue;
        const result = runVerifier(c, { repoRoot: root, exec });
        if (result.blocked) {
            // Policy-blocked: write no evidence — the criterion stays UNVERIFIED
            // by absence, preserving stored-verdict ∈ {PASS,FAIL}. Reported below.
            written.push({ criterionId: c.id, verdict: 'UNVERIFIED', blocked: true, detail: result.detail });
            continue;
        }
        writeRecord(root, specId, {
            criterionId: c.id, verdict: result.verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail: result.detail, attestedBy: null,
            criterionDigest: criterionDigest(c),
        });
        written.push({ criterionId: c.id, verdict: result.verdict });
    }
```

- [ ] **Step 5: Print a blocked line in the run CLI**

In `templates/cli/verification/commands.js`, replace the `run` action's printout loop (line ~46) with:

```js
            for (const w of res.written) {
                if (w.blocked) {
                    console.log(`⚠ ${w.criterionId} UNVERIFIED — ${w.detail}`);
                    continue;
                }
                console.log(`${w.verdict === 'PASS' ? '✅' : '❌'} ${w.criterionId} ${w.verdict}`);
            }
            console.log(`ran ${res.written.length} machine verifier(s)`);
```

- [ ] **Step 6: Sync the mirror and run the test**

Run: `node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T-command-blocked passed` and `✅ T-command-blocked-runspec passed`, suite green.

- [ ] **Step 7: Run the full default suite (no regression)**

Run: `npm test`
Expected: PASS — the default integration suite is green (the 45 existing `command` criteria are unaffected: their `node ./.evo-lite/cli/test.js ...` commands match the built-in default allowlist).

- [ ] **Step 8: Commit**

```bash
git add templates/cli/verification/run-verifiers.js templates/cli/verification/engine.js templates/cli/verification/commands.js templates/cli/test/governance.js .evo-lite/cli/verification/run-verifiers.js .evo-lite/cli/verification/engine.js .evo-lite/cli/verification/commands.js .evo-lite/cli/test/governance.js .evo-lite/generated/runtime-mirror.lock.json
git commit -m "feat(verify): enforce command-policy in run-verifiers + engine + run CLI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Mother baseline policy, not-a-gene test, and dogfood

**Files:**
- Create: `.evo-lite/verification/command-policy.json` (mother baseline; project state, committed)
- Test: `templates/cli/test/governance.js` (new `T-command-policy-manifest` block, appended after `T-command-blocked-runspec`)
- Evidence (generated by the dogfood run): `.evo-lite/verification/evidence-command-verifier-trust-boundary.json`

**Interfaces:**
- Consumes: `MANAGED_TEMPLATE_FAMILIES` from `../template-manifest`; the shipped enforcement from Tasks 1-2.

- [ ] **Step 1: Write the failing test**

Append inside the `try` block, after the `T-command-blocked-runspec` block:

```js
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node .evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/test.js governance`
Expected: PASS — `✅ T-command-policy-manifest passed`. (This asserts the state Task 1 already produced: `command-policy.js` registered, no `.json` gene. It is a guard, so it passes immediately.)

- [ ] **Step 3: Create the mother baseline policy file**

Create `.evo-lite/verification/command-policy.json`:

```json
{
  "version": "evo-command-policy@1",
  "allow": [
    { "prefix": "node ./.evo-lite/cli/test.js" }
  ]
}
```

- [ ] **Step 4: Commit the implementation + policy so the tree is clean for the dogfood**

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js .evo-lite/generated/runtime-mirror.lock.json .evo-lite/verification/command-policy.json
git commit -m "feat(verify): mother baseline command-policy.json + not-a-gene guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Dogfood — run the contract on its own spec**

Run: `node .evo-lite/cli/memory.js verify-contract run docs/superpowers/specs/2026-07-06-command-verifier-trust-boundary-design.md`
Expected: five `✅ ac-... PASS` lines (each AC's verifier is `node ./.evo-lite/cli/test.js governance`, which is allowlisted and passes), and `ran 5 machine verifier(s)`. No ⚠ blocked lines. An evidence file `.evo-lite/verification/evidence-command-verifier-trust-boundary.json` is written with 5 PASS records.

- [ ] **Step 6: Confirm READY and commit the evidence**

Run: `node .evo-lite/cli/memory.js verify-contract status docs/superpowers/specs/2026-07-06-command-verifier-trust-boundary-design.md --strict`
Expected: five `PASS ac-...` lines, exit 0.

```bash
git add .evo-lite/verification/evidence-command-verifier-trust-boundary.json
git commit -m "test(verify): bind command-verifier-trust-boundary evidence (5 PASS)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** policy file (Task 1 module + Task 3 mother file), not-a-gene (Task 1 manifest + Task 3 guard test → `ac-policy-not-a-gene`), built-in default & empty-deny (Task 1 tests h/i → `ac-builtin-default`), metachar reject (Task 1 test a → `ac-no-shell-injection`), allowlist run (Task 1 test c + Task 2 → `ac-policy-allowlist`), default-deny UNVERIFIED not executed (Task 2 tests → `ac-policy-default-deny`), CLI reporting (Task 2 Step 5). All spec sections mapped.
- **Blocked-verdict invariant:** Task 2 Step 4 preserves stored ∈ {PASS,FAIL} by skipping `writeRecord`; verified by `T-command-blocked-runspec` asserting no evidence file.
- **Ordering:** `command-policy.js` is manifest-registered in Task 1 so `sync-runtime` mirrors it before any mirror-run test needs it.
