---
linkedSpec: spec:dogfood-operator-experience-phase1
---

# Dogfood Operator Experience Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the latest dogfood session into concrete operator-facing runtime improvements so `/evo`, `verify`, hook telemetry, dashboard/inspector, and governance testing are easier to trust and easier to use.

**Architecture:** Reuse the current Evo-Lite runtime surfaces instead of inventing new ones. Add a lightweight governance run report for hook telemetry, teach `verify` and `/evo` to summarize operator-governance health, surface that status in dashboard/inspector, and isolate a governance-focused verification slice so dogfood fixes can be proven quickly.

**Tech Stack:** Node.js, Commander, existing `.evo-lite/generated/` JSON artifacts, existing inspector HTTP server, existing CLI integration test harness

---

## File Map

| File | Change |
|------|--------|
| `.agents/workflows/evo.md` | tighten `/evo` output contract around operator-action hints |
| `templates/cli/hooks.js` | write last-run governance telemetry and keep hook body/operator commands aligned |
| `templates/cli/memory.service.js` | extend `verify()` and takeover helpers with governance-operational status |
| `templates/cli/dashboard-data.js` | include governance runtime status in dashboard payload |
| `templates/cli/inspector.js` | expose stable timeline/governance API payloads |
| `templates/cli/test.js` | add/fix governance-focused coverage and optional test filtering |
| `package.json` | add a targeted governance test script |
| `.evo-lite/cli/*` | sync changed runtime files after each template edit |

---

### Task 1: Make `/evo` and `verify` operator-forward

**Files:**
- Modify: `.agents/workflows/evo.md`
- Modify: `templates/cli/memory.service.js`
- Sync: `.evo-lite/cli/memory.service.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing verification test for operator guidance**

Add a test case near the existing `verify()` coverage in `templates/cli/test.js`:

```js
console.log('T13. Testing verify reports governance-operational next steps ...');
{
    const runtime = createTempRuntimeRoot('verify-governance-guidance');
    const loaded = await bootstrapRuntime(runtime.runtimeRoot, {
        EVO_LITE_SKIP_GIT_STATUS: '1',
    });
    const output = await captureConsole(async () => {
        await loaded.service.verify();
    });
    assert.ok(output.includes('hook') || output.includes('plan progress'), 'verify should mention governance-operational guidance when relevant');
}
```

- [x] **Step 2: Run the focused test and confirm the current gap**

Run:

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: the new guidance assertion fails before implementation.

- [x] **Step 3: Extend `/evo` and `verify` to emit action-oriented governance hints**

Update `.agents/workflows/evo.md` so the takeover summary explicitly prefers actionable next commands over generic “continue development” language when governance surfaces are stale or missing.

In `templates/cli/memory.service.js`, extend `verify()` / takeover helpers so they can surface operator hints such as:

```js
pushNextStep('Run `node .evo-lite/cli/memory.js hook status` to verify post-commit governance is active.');
pushNextStep('Run `node .evo-lite/cli/memory.js plan progress` to refresh task-evidence status before reading the dashboard.');
```

- [x] **Step 4: Sync dogfood runtime and rerun focused verification**

Run:

```bash
Copy-Item "templates/cli/memory.service.js" ".evo-lite/cli/memory.service.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: the governance guidance test passes.

- [x] **Step 5: Commit**

```bash
git add .agents/workflows/evo.md templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/test.js
git commit -m "feat(evo): add operator-facing governance guidance to takeover and verify"
```

---

### Task 2: Add hook last-run telemetry and verify it

**Files:**
- Modify: `templates/cli/hooks.js`
- Modify: `templates/cli/memory.service.js`
- Sync: `.evo-lite/cli/hooks.js`, `.evo-lite/cli/memory.service.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing hook telemetry test**

Extend the hook tests in `templates/cli/test.js` with a case that runs the generated hook and expects a last-run JSON report:

```js
console.log('T14. Testing post-commit hook writes governance run report ...');
{
    const repo = createHookTestRepo('hook-report');
    writeText(path.join(repo.projectRoot, 'src', 'report.js'), 'module.exports = 1;\\n');
    runGit(repo.projectRoot, ['add', 'src/report.js']);
    runGit(repo.projectRoot, ['commit', '-m', 'feat: report']);
    runPostCommitHook(repo.projectRoot);
    const reportPath = path.join(repo.projectRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json');
    assert.ok(fs.existsSync(reportPath), 'hook must write last-run governance report');
}
```

- [x] **Step 2: Run the focused hook tests to verify failure**

Run:

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: the hook-report test fails because no JSON report is written yet.

- [x] **Step 3: Implement lightweight hook telemetry**

In `templates/cli/hooks.js`, add a tiny helper block inside the hook body that writes a JSON artifact such as:

```sh
REPORT_DIR=".evo-lite/generated/governance"
REPORT_PATH="$REPORT_DIR/post-commit-last-run.json"
mkdir -p "$REPORT_DIR"
```

and record fields such as:

```json
{
  "event": "post-commit",
  "changedFiles": ["src/report.js"],
  "categories": ["code"],
  "commands": [
    { "name": "plan progress", "ok": true },
    { "name": "plan gaps", "ok": true },
    { "name": "dashboard build", "ok": true }
  ]
}
```

Then update `templates/cli/memory.service.js` `verify()` to read this file and classify it as healthy / missing / failed-last-run.

- [x] **Step 4: Sync runtime and rerun hook coverage**

Run:

```bash
Copy-Item "templates/cli/hooks.js" ".evo-lite/cli/hooks.js" -Force
Copy-Item "templates/cli/memory.service.js" ".evo-lite/cli/memory.service.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: hook telemetry test passes and verify can read the report.

- [x] **Step 5: Commit**

```bash
git add templates/cli/hooks.js .evo-lite/cli/hooks.js templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/test.js
git commit -m "feat(governance): record post-commit last-run telemetry and surface it in verify"
```

---

### Task 3: Surface governance-operational health in dashboard and inspector

**Files:**
- Modify: `templates/cli/dashboard-data.js`
- Modify: `templates/cli/inspector.js`
- Sync: `.evo-lite/cli/dashboard-data.js`, `.evo-lite/cli/inspector.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add failing dashboard/inspector tests**

Extend `templates/cli/test.js` with two checks:

```js
assert.ok(data.governance, 'dashboard data must include governance runtime status');
assert.ok(Array.isArray(timeline.entries), '/api/timeline must return an entries array');
```

The timeline assertion already exists and currently fails in the broad suite; keep it in the governance slice so it becomes part of the focused operator contract.

- [x] **Step 2: Implement dashboard governance summary**

In `templates/cli/dashboard-data.js`, add a `governance` block alongside `freshness` and `verify`, for example:

```js
governance: {
    hookInstalled: true,
    lastRun: { exists: true, ok: true },
    stale: data.freshness.planStale || data.freshness.archStale,
}
```

- [x] **Step 3: Fix inspector API payload consistency**

In `templates/cli/inspector.js`, update `/api/timeline` to return a stable shape instead of raw `extractActiveContext(md)`:

```js
if (url === '/api/timeline') {
    const md = readActiveContext();
    const context = extractActiveContext(md);
    return send(200, {
        entries: context.trajectory || [],
        focus: context.focus || '',
        backlog: context.backlog || [],
        context,
    });
}
```

- [x] **Step 4: Sync runtime and rerun focused surface tests**

Run:

```bash
Copy-Item "templates/cli/dashboard-data.js" ".evo-lite/cli/dashboard-data.js" -Force
Copy-Item "templates/cli/inspector.js" ".evo-lite/cli/inspector.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: governance dashboard assertion and `/api/timeline` contract both pass.

- [x] **Step 5: Commit**

```bash
git add templates/cli/dashboard-data.js .evo-lite/cli/dashboard-data.js templates/cli/inspector.js .evo-lite/cli/inspector.js templates/cli/test.js
git commit -m "feat(operator): surface governance health in dashboard and stabilize inspector timeline payload"
```

---

### Task 4: Isolate a governance-focused verification slice

**Files:**
- Modify: `templates/cli/test.js`
- Modify: `package.json`

- [x] **Step 1: Add a simple test filter to the CLI test harness**

At the top of `templates/cli/test.js`, add a narrow filter based on `process.argv[2]`:

```js
const TEST_SCOPE = process.argv[2] || 'all';
function shouldRun(scope) {
    return TEST_SCOPE === 'all' || TEST_SCOPE === scope;
}
```

Guard governance-specific blocks with:

```js
if (shouldRun('governance')) {
    // governance-only tests
}
```

- [x] **Step 2: Wire a package script**

In `package.json`, add:

```json
"scripts": {
  "start": "node ./bin/cli.js",
  "test": "node ./.evo-lite/cli/test.js",
  "test:governance": "node ./.evo-lite/cli/test.js governance"
}
```

- [x] **Step 3: Move the governance-critical checks behind the new scope**

The governance slice MUST include:

- verify/operator guidance assertions
- hook body assertions
- code-only / plan-commit / root-commit hook tests
- dashboard freshness checks
- inspector `/api/timeline` payload contract

- [x] **Step 4: Run the new slice**

Run:

```bash
npm run test:governance
```

Expected: governance-focused tests pass even if unrelated broad-suite areas still need separate cleanup.

- [x] **Step 5: Commit**

```bash
git add templates/cli/test.js package.json
git commit -m "test(governance): add focused operator-governance test slice"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `/evo` action guidance → Task 1
- ✅ hook run telemetry → Task 2
- ✅ verify governance-operational summary → Tasks 1-2
- ✅ dashboard / inspector operator health → Task 3
- ✅ targeted governance verification path → Task 4

**Placeholder scan:** No `TODO`, `TBD`, or “implement later” placeholders remain in the task steps.

**Type consistency:** The plan consistently uses `governance`, `post-commit-last-run.json`, `entries`, `test:governance`, and `node ./.evo-lite/cli/test.js governance`.
