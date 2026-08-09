# PR State Sync Post-Merge Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `pr-state validate` for merged pull requests by proving PR-to-run association through PR-scoped check links, while making the PS5 Windows cleanup resilient to bounded transient removal failures.

**Architecture:** Keep the existing workflow-run acquisition and normalization as the authoritative source of workflow path, event, observed head, ordering, status, and conclusion. Add a PR-scoped `gh pr checks` association layer only after workflow candidates exist, intersect its parsed run IDs with the workflow candidates, and remove all workflow-run `pull_requests` validation or binding. Keep cleanup retry behavior inside Node's built-in recursive `rmSync` contract rather than adding a custom retry loop.

**Tech Stack:** Node.js CommonJS, synchronous `child_process.spawnSync`, GitHub CLI, Commander integration harness, Node `assert`, GitNexus, Git live/template mirrors.

## Global Constraints

- Frozen corrective design: `132ed14a5ffff13f7728c12c29d7a6da0676d010`.
- Durable main baseline: `23b6b095c853366c07c14590342277604a274246`.
- Implementation starts only after an independent review authorizes the exact plan commit at current `HEAD`.
- Capture that reviewed plan commit as `IMPLEMENTATION_BASE`; every implementation-only scope check uses `IMPLEMENTATION_BASE..HEAD`, never the design SHA or `main`.
- Modify exactly four implementation files:

```text
.evo-lite/cli/pr-state.service.js
templates/cli/pr-state.service.js
.evo-lite/cli/test/integration.js
templates/cli/test/integration.js
```

- Keep each live/template pair byte-identical after every task.
- Do not edit the frozen original design, corrective design, or this plan during implementation.
- Do not edit `pr-state.js`, `memory.js`, `template-manifest.js`, `test.js`, `test/harness.js`, `sync-runtime.js`, workflows, dependencies, product source, active context, or raw memory.
- Do not read `run.pull_requests` for workflow-run validity or PR binding. The field may be absent, empty, malformed, or populated and remains ignored.
- Expected `headSha` remains comparison-only. Workflow discovery always uses the observed PR head SHA.
- Preserve exact workflow path, `event=pull_request`, full pagination, maximum numeric run ID, main-push exclusion, finding taxonomy, JSON envelope, and error-over-drift-over-pass precedence.
- `gh pr checks` is read-only association evidence only. It never classifies pending, success, or failure.
- Only command exits `0` and documented `8`, each with valid JSON, are consumable. Exit `1`, `2`, `4`, or any other value is an operational error.
- PS5 cleanup uses exactly `maxRetries: 5` and `retryDelay: 100`, with no catch or suppression.
- Use append-only ordinary commits. Do not amend, rebase, squash, or force-push.
- No PR #33 body mutation, active-context mutation, branch deletion, or adjacent work is authorized by implementation execution.

## File Map

| File | Responsibility in this correction |
|---|---|
| `.evo-lite/cli/pr-state.service.js` | Live validator: PR URL authority, accepted-status JSON execution, PR-scoped link parsing, candidate-first workflow intersection, and removal of `pull_requests` dependency. |
| `templates/cli/pr-state.service.js` | Shipped mirror of the live validator; must remain byte-identical. |
| `.evo-lite/cli/test/integration.js` | Live PS2/PS5 corrective acceptance and bounded cleanup contract. |
| `templates/cli/test/integration.js` | Shipped mirror of the integration acceptance; must remain byte-identical. |

## Pre-Implementation Baseline Gate

- [x] **Step 1: Confirm the reviewed plan head before any runtime or test edit**

Run in PowerShell:

```powershell
$reviewedPlanHead = git rev-parse HEAD
git status --short
```

Expected:

```text
the reviewer authorization names exactly $reviewedPlanHead
worktree output is empty
```

If either condition fails, stop before editing. Then capture:

```powershell
$env:IMPLEMENTATION_BASE = $reviewedPlanHead
```

- [x] **Step 2: Confirm the frozen design is an ancestor and main has not drifted**

Run:

```powershell
git merge-base --is-ancestor 132ed14a5ffff13f7728c12c29d7a6da0676d010 HEAD
git ls-remote origin refs/heads/main
```

Expected: ancestor check exits `0`; remote main is exactly `23b6b095c853366c07c14590342277604a274246`. Otherwise stop for review.

- [x] **Step 3: Run GitNexus impact analysis before symbol edits**

Use upstream impact analysis on these live/template symbols before editing:

```text
validatePrShape
validateRunShape
observeChecks
validatePrState
runText
runJson
```

Report direct callers, affected processes, and risk. Stop and obtain approval if any result is HIGH or CRITICAL.

---

### Task 1: PR-Scoped Association and Merged Workflow Acquisition

**Files:**
- Modify: `.evo-lite/cli/pr-state.service.js`
- Modify: `templates/cli/pr-state.service.js`
- Test: `.evo-lite/cli/test/integration.js`
- Test: `templates/cli/test/integration.js`

**Interfaces:**
- Consumes: existing `validatePrState(prArg, options)`, `runCommand(executable, args, options)`, workflow pagination, `normalizeChecks(run)`, and fixed report envelope.
- Produces: internal `resolvePrWebIdentity(pr, repository, prNumber) -> { githubHost, repositoryArg }`.
- Produces: internal `validatePrCheckRows(value) -> object[]`.
- Produces: internal `extractPrScopedRunIds(rows, identity) -> Set<number>`.
- Changes: `runText(...)` and `runJson(...)` accept an optional final `acceptedStatuses` array defaulting to `[0]`.
- Preserves: public exports and CLI surface remain unchanged.

- [x] **Step 1: Extend the PS2 fake runner and add failing acquisition tests**

In both integration mirrors, extend the PS2 helpers with PR-scoped rows:

```js
const makeCheckRow = (runId, overrides = {}) => ({
    bucket: 'pass',
    event: 'pull_request',
    link: `https://github.com/uwence/create-evo-lite/actions/runs/${runId}/job/${runId + 1000}`,
    name: 'pack + consume on windows-latest / node 24',
    state: 'SUCCESS',
    workflow: 'release-gate',
    ...overrides,
});
```

Extend `runValidation(options)` with `checkRows`, `checkStatus`, and a `prChecks` handler. Match only the exact command shape:

```js
if (executable === 'gh' && args[0] === 'pr' && args[1] === 'checks') {
    assert.deepStrictEqual(args, [
        'pr', 'checks', '31',
        '--repo', 'github.com/uwence/create-evo-lite',
        '--json', 'bucket,event,link,name,state,workflow',
    ]);
    return use('prChecks', {
        status: checkStatus,
        stdout: JSON.stringify(checkRows),
        stderr: '',
    });
}
```

Default `checkRows` to `[makeCheckRow(100)]` and `checkStatus` to `0` so existing pass fixtures continue to express an associated run.

Add these assertions before changing the service:

```js
const omittedRun = makeRun(100, 'completed', 'success');
delete omittedRun.pull_requests;
const omittedPullRequests = runValidation({
    pages: [{ total_count: 1, workflow_runs: [
        omittedRun,
    ] }],
});
assert.strictEqual(omittedPullRequests.report.result, 'pass');

for (const pullRequests of [[], [{ number: 99 }], 'ignored-shape']) {
    const ignored = runValidation({
        pages: [{ total_count: 1, workflow_runs: [
            makeRun(100, 'completed', 'success', { pull_requests: pullRequests }),
        ] }],
    });
    assert.strictEqual(ignored.report.result, 'pass');
}

const zeroCandidates = runValidation({
    pages: [{ total_count: 0, workflow_runs: [] }],
    handlers: { prChecks: () => { throw new Error('must not run'); } },
});
assert.deepStrictEqual(zeroCandidates.report.findings.map(item => item.code), ['CHECKS_MISSING']);
assert.ok(!zeroCandidates.calls.some(call => call.args.slice(0, 2).join(' ') === 'pr checks'));

const exitOne = runValidation({ checkStatus: 1 });
assert.strictEqual(exitOne.report.result, 'error');
assert.ok(exitOne.report.errors.some(error => error.code === 'PR_CHECKS_QUERY_FAILED'));

const exitEight = runValidation({ checkStatus: 8 });
assert.strictEqual(exitEight.report.result, 'pass');
```

Add host and URL cases:

```js
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
    assert.ok(invalid.report.errors.some(error => error.code === 'PR_RESPONSE_INVALID'), html_url);
}

const wrongHost = runValidation({
    checkRows: [makeCheckRow(100, {
        link: 'https://example.com/uwence/create-evo-lite/actions/runs/100/job/1100',
    })],
});
assert.deepStrictEqual(wrongHost.report.findings.map(item => item.code), ['CHECKS_MISSING']);
```

Add ordering and association cases:

```js
const association = runValidation({
    pages: [{ total_count: 2, workflow_runs: [
        makeRun(200, 'completed', 'success'),
        makeRun(201, 'in_progress', null),
    ] }],
    checkRows: [makeCheckRow(200), makeCheckRow(201), makeCheckRow(201)],
});
assert.deepStrictEqual(association.report.findings.map(item => item.code), ['CHECKS_PENDING']);
assert.strictEqual(association.report.observed.diagnostics.runId, 201);
const runCallIndex = association.calls.findIndex(call => call.args.some(value => /actions\/workflows\/77\/runs/.test(value)));
const checksCallIndex = association.calls.findIndex(call => call.args.slice(0, 2).join(' ') === 'pr checks');
assert.ok(runCallIndex >= 0 && checksCallIndex > runCallIndex);
```

Update the existing PS2 regressions with explicit PR-scoped association rows so
their original selected-run assertions remain meaningful after intersection:

```js
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
assert.strictEqual(identityFiltered.report.observed.diagnostics.runId, 123);

const newerPending = runValidation({
    pages: [{ total_count: 2, workflow_runs: [
        makeRun(200, 'completed', 'success'),
        makeRun(201, 'in_progress', null),
    ] }],
    checkRows: [makeCheckRow(200), makeCheckRow(201)],
});
assert.strictEqual(newerPending.report.observed.diagnostics.runId, 201);

const newerFailed = runValidation({
    pages: [{ total_count: 2, workflow_runs: [
        makeRun(301, 'completed', 'failure'),
        makeRun(300, 'completed', 'success'),
    ] }],
    checkRows: [makeCheckRow(300), makeCheckRow(301)],
});
assert.strictEqual(newerFailed.report.observed.diagnostics.runId, 301);

const paginated = runValidation({
    pages: [
        { total_count: 101, workflow_runs: firstPage },
        { total_count: 101, workflow_runs: [makeRun(999, 'completed', 'success')] },
    ],
    checkRows: [makeCheckRow(999)],
});
assert.strictEqual(paginated.report.observed.diagnostics.runId, 999);
const pageCallIndices = paginated.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.args.some(value => /actions\/workflows\/77\/runs/.test(value)))
    .map(({ index }) => index);
const paginatedChecksIndex = paginated.calls.findIndex(
    call => call.args.slice(0, 2).join(' ') === 'pr checks'
);
assert.strictEqual(pageCallIndices.length, 2);
assert.ok(pageCallIndices.every(index => index < paginatedChecksIndex));
```

Add the merged PR #33-style regression:

```js
const mergedPr = overrides => makePr({
    state: 'closed', draft: false, merged: true,
    merged_at: '2026-08-08T16:37:22Z',
    ...overrides,
});
const mergedRun = makeRun(100, 'completed', 'success');
delete mergedRun.pull_requests;
const mergedReady = runValidation({
    pr: mergedPr({ body: expectedBody({ phase: 'ready' }) }),
    pages: [{ total_count: 1, workflow_runs: [mergedRun] }],
});
assert.deepStrictEqual(mergedReady.report.findings.map(item => item.code), ['PHASE_DRIFT']);
assert.strictEqual(mergedReady.report.observed.checks, 'success');

const mergedPass = runValidation({
    pr: mergedPr({ body: expectedBody({ phase: 'merged' }) }),
    pages: [{ total_count: 1, workflow_runs: [mergedRun] }],
});
assert.strictEqual(mergedPass.report.result, 'pass');
```

Add exact fail-closed PR-check acquisition cases:

```js
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

for (const status of [2, 4, 9]) {
    const invalidExit = runValidation({ checkStatus: status });
    assert.strictEqual(invalidExit.report.result, 'error', String(status));
    assert.ok(invalidExit.report.errors.some(
        error => error.code === 'PR_CHECKS_QUERY_FAILED'
    ), String(status));
}
```

Add exact accepted-link cases:

```js
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
```

Add exact nonassociation cases. Each fixture has a valid workflow candidate but
no qualifying PR-scoped run ID, so it must produce only `CHECKS_MISSING`:

```js
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
```

Prove same-head candidates do not qualify without PR-scoped association and
that duplicate job rows deduplicate harmlessly:

```js
const sameHeadUnassociated = runValidation({
    pages: [{ total_count: 2, workflow_runs: [
        makeRun(100, 'completed', 'success'),
        makeRun(101, 'completed', 'failure'),
    ] }],
    checkRows: [makeCheckRow(100), makeCheckRow(100)],
});
assert.strictEqual(sameHeadUnassociated.report.result, 'pass');
assert.strictEqual(sameHeadUnassociated.report.observed.diagnostics.runId, 100);
```

Prove check-row presentation never classifies the selected workflow run:

```js
const rowCannotHideFailure = runValidation({
    pages: [{ total_count: 1, workflow_runs: [
        makeRun(100, 'completed', 'failure'),
    ] }],
    checkRows: [makeCheckRow(100, {
        bucket: 'pass', state: 'SUCCESS', event: 'push', workflow: 'other-name',
    })],
});
assert.deepStrictEqual(
    rowCannotHideFailure.report.findings.map(item => item.code),
    ['CHECKS_FAILED']
);
```

- [x] **Step 2: Run the full suite and capture RED evidence**

Run:

```powershell
node ./.evo-lite/cli/test.js
```

Expected: governance completes, then integration fails in PS2 because the existing service still requires/reads `pull_requests`, never invokes `gh pr checks`, does not validate `PR.html_url`, and cannot consume exit `8`. Record the first contract-relevant failure; do not accept unrelated infrastructure failure as RED evidence.

- [x] **Step 3: Implement accepted-status execution and observed PR URL authority**

In both service mirrors, extend the internal runner helpers without changing existing callers:

```js
function runText(runCommand, executable, args, options, errorCode, acceptedStatuses = [0]) {
    let result;
    try {
        result = runCommand(executable, args, options);
    } catch (error) {
        throw new PrStateError(
            errorCode,
            error && error.message ? error.message : `${executable} failed`
        );
    }
    if (!result || typeof result !== 'object') {
        fail(errorCode, `${executable} returned no process result`);
    }
    if (result.error) {
        fail(errorCode, result.error.message || `${executable} failed to start`);
    }
    if (result.signal) {
        fail(errorCode, `${executable} terminated by signal ${result.signal}`);
    }
    if (!acceptedStatuses.includes(result.status)) {
        const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
        fail(errorCode, stderr || `${executable} exited with status ${result.status}`);
    }
    if (typeof result.stdout !== 'string') {
        fail(errorCode, `${executable} returned malformed stdout`);
    }
    return result.stdout.trim();
}

function runJson(runCommand, executable, args, options, errorCode, acceptedStatuses = [0]) {
    const text = runText(runCommand, executable, args, options, errorCode, acceptedStatuses);
    try {
        return JSON.parse(text);
    } catch {
        fail(errorCode, `${executable} returned malformed JSON`);
    }
}
```

Add local observed-identity validation:

```js
function resolvePrWebIdentity(pr, repository, prNumber) {
    let url;
    try {
        url = new URL(pr.html_url);
    } catch {
        fail('PR_RESPONSE_INVALID', 'pull request html_url is malformed');
    }
    const expectedPath = `/${repository}/pull/${prNumber}`;
    if (url.protocol !== 'https:' || url.username || url.password || !url.host
        || url.pathname !== expectedPath || url.search || url.hash) {
        fail('PR_RESPONSE_INVALID', 'pull request html_url does not match the resolved pull request');
    }
    return {
        githubHost: url.host,
        repositoryArg: `${url.host}/${repository}`,
    };
}
```

Call this only after the expected block has parsed and the observed core facts have been built. Pass `repositoryArg` and `githubHost` into `observeChecks`; keep `report.pr.repository` as `OWNER/REPO` and `report.pr.url` unchanged.

- [x] **Step 4: Implement strict PR-check rows and run/job URL parsing**

Add exact internal validation:

```js
const PR_CHECK_FIELDS = ['bucket', 'event', 'link', 'name', 'state', 'workflow'];

function validatePrCheckRows(value) {
    if (!Array.isArray(value) || value.some(row =>
        !row || typeof row !== 'object' || Array.isArray(row)
        || PR_CHECK_FIELDS.some(field => typeof row[field] !== 'string')
    )) {
        fail('PR_CHECKS_RESPONSE_INVALID', 'gh pr checks response is malformed');
    }
    return value;
}
```

Implement `extractPrScopedRunIds(rows, { githubHost, repository })` with `new URL(row.link)` and exact path segments:

```js
function parseCanonicalPositiveId(value) {
    if (!/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function extractPrScopedRunIds(rows, { githubHost, repository }) {
    const [owner, repo] = repository.split('/');
    const runIds = new Set();
    for (const row of rows) {
        let url;
        try {
            url = new URL(row.link);
        } catch {
            continue;
        }
        if (url.protocol !== 'https:' || url.username || url.password
            || url.host !== githubHost || url.search || url.hash) continue;
        const parts = url.pathname.split('/');
        const runShape = parts.length === 6;
        const jobShape = parts.length === 8 && parts[6] === 'job';
        if ((!runShape && !jobShape)
            || parts[0] !== '' || parts[1] !== owner || parts[2] !== repo
            || parts[3] !== 'actions' || parts[4] !== 'runs') continue;
        const runId = parseCanonicalPositiveId(parts[5]);
        const jobId = jobShape ? parseCanonicalPositiveId(parts[7]) : 1;
        if (runId === null || jobId === null) continue;
        runIds.add(runId);
    }
    return runIds;
}
```

This accepts only:

```text
/<owner>/<repo>/actions/runs/<positive canonical safe integer>
/<owner>/<repo>/actions/runs/<positive canonical safe integer>/job/<positive canonical safe integer>
```

Require HTTPS, no credentials, `url.host === githubHost`, exact owner/repository components, no query/fragment/trailing segments, and canonical `[1-9][0-9]*` IDs within `Number.isSafeInteger`. Return `null` for a nonqualifying well-formed row and deduplicate accepted run IDs in a `Set`. Do not fetch or follow links.

- [x] **Step 5: Implement candidate-first acquisition and two-sided intersection**

Remove both `pull_requests` clauses from `validateRunShape()` and remove every service read of `run.pull_requests`.

Refactor `observeChecks()` in this exact order:

```js
const workflowCandidates = runs.filter(run =>
    run.event === 'pull_request' && run.head_sha === headSha
);
if (workflowCandidates.length === 0) {
    return {
        checks: 'missing',
        diagnostics: { workflowId: workflow.id, workflowPath: workflow.path },
    };
}

const rows = validatePrCheckRows(runJson(
    runCommand,
    'gh',
    [
        'pr', 'checks', String(prNumber),
        '--repo', repositoryArg,
        '--json', 'bucket,event,link,name,state,workflow',
    ],
    { cwd },
    'PR_CHECKS_QUERY_FAILED',
    [0, 8]
));
const associatedRunIds = extractPrScopedRunIds(rows, { githubHost, repository });
const matching = workflowCandidates.filter(run => associatedRunIds.has(run.id));
const newest = matching.reduce(
    (best, item) => !best || item.id > best.id ? item : best,
    null
);
```

Keep the existing missing result when `matching` is empty and existing diagnostics/`normalizeChecks(newest)` when a run is selected. Do not use check-row status fields or `run.pull_requests`.

- [x] **Step 6: Extend PS5 real-CLI dogfood fixtures before GREEN**

Teach the fake `gh` executable to recognize the exact `pr checks` command and emit `fixture.checks`. Define a PS5-local row helper because the PS2 helper is block-scoped:

```js
const baseCheckRow = (overrides = {}) => ({
    bucket: 'pass',
    event: 'pull_request',
    link: 'https://github.com/uwence/create-evo-lite/actions/runs/900/job/1900',
    name: 'pack + consume on windows-latest / node 24',
    state: 'SUCCESS',
    workflow: 'release-gate',
    ...overrides,
});
```

Define that helper before PS5 `directValidate()`. Inside the existing
`directValidate(options)` function, insert these declarations immediately after
the existing `pages` declaration and before `handlers`:

```js
const checkRows = options.checkRows || [baseCheckRow()];
const checkStatus = options.checkStatus === undefined ? 0 : options.checkStatus;
```

Inside its existing `runCommand`, insert this exact branch after the workflow-run
handler and before the final unexpected-command throw:

```js
if (executable === 'gh' && args[0] === 'pr' && args[1] === 'checks') {
    assert.deepStrictEqual(args, [
        'pr', 'checks', '31',
        '--repo', 'github.com/uwence/create-evo-lite',
        '--json', 'bucket,event,link,name,state,workflow',
    ]);
    return custom('prChecks', response(checkRows, checkStatus));
}
```

Add this branch to the fake executable before its generic unexpected-args failure:

```js
else if (args[0] === 'pr' && args[1] === 'checks') {
    const expected = [
        'pr', 'checks', '31',
        '--repo', 'github.com/uwence/create-evo-lite',
        '--json', 'bucket,event,link,name,state,workflow',
    ];
    if (JSON.stringify(args) !== JSON.stringify(expected)) {
        console.error('unexpected pr checks args: ' + args.join(' '));
        process.exit(3);
    }
    value = fixture.checks;
}
```

Add real-CLI merged cases:

```js
const realMergedDrift = runCli(fixture(
    stateBody({ phase: 'ready' }),
    '.github/workflows/release-gate.yml',
    { state: 'closed', draft: false, merged: true, merged_at: '2026-08-08T16:37:22Z' }
));
assert.strictEqual(realMergedDrift.result.status, 1);
assert.deepStrictEqual(realMergedDrift.report.findings.map(item => item.code), ['PHASE_DRIFT']);
assert.strictEqual(realMergedDrift.report.observed.checks, 'success');
```

Extend the fixture helper so its third parameter is merged into `fixture.pr`:

```js
const fixture = (
    body,
    workflowPath = '.github/workflows/release-gate.yml',
    prOverrides = {}
) => ({
    repository: 'uwence/create-evo-lite',
    pr: basePr({ body, ...prOverrides }),
    workflow: { id: 77, path: workflowPath },
    pages: [{ total_count: 1, workflow_runs: [baseRun()] }],
    checks: [baseCheckRow()],
});
```

Add a second `phase: merged` invocation expecting exit `0`. Assert the fake call log contains host-qualified `pr checks`, and still contains no edit, ready, merge, POST, PATCH, PUT, or DELETE command.

- [x] **Step 7: Run GREEN and regression gates**

Run:

```powershell
node ./.evo-lite/cli/test.js
```

Expected: exit `0`, including:

```text
✅ PS2 pr-state read-only acquisition passed
✅ PS5 pr-state fail-closed CLI acceptance passed
All CLI integration tests passed.
```

- [x] **Step 8: Verify Task 1 parity, scope, and affected flows**

Run:

```powershell
git diff --no-index -- .evo-lite/cli/pr-state.service.js templates/cli/pr-state.service.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git diff --check "$env:IMPLEMENTATION_BASE"
git diff --name-status "$env:IMPLEMENTATION_BASE"
```

Expected: both parity commands exit `0`; the worktree relative to the implementation base contains exactly the four authorized files. Run GitNexus `detect_changes(scope: "all")` and review all affected processes before committing.

Prove the service no longer contains the retired field dependency:

```powershell
$pullRequestReads = rg -n "pull_requests" .evo-lite/cli/pr-state.service.js templates/cli/pr-state.service.js
if ($LASTEXITCODE -eq 0) { throw "service still reads pull_requests: $pullRequestReads" }
if ($LASTEXITCODE -ne 1) { throw "rg failed with exit $LASTEXITCODE" }
```

- [x] **Step 9: Commit Task 1**

```powershell
git add .evo-lite/cli/pr-state.service.js templates/cli/pr-state.service.js `
        .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git commit -m "fix(pr-state): preserve merged PR check association"
```

---

### Task 2: PS5 Bounded Windows Cleanup Retry

**Files:**
- Modify: `.evo-lite/cli/test/integration.js`
- Modify: `templates/cli/test/integration.js`

**Interfaces:**
- Consumes: PS5 `runtime.workspaceRoot` and Node `fs.rmSync` recursive-removal contract.
- Produces: local test helper `removePrStateRuntimeRoot(root, rmSync = fs.rmSync)`.
- Preserves: persistent removal failures propagate; no custom retry loop or catch is introduced.

- [x] **Step 1: Add a failing cleanup-option contract test**

In both integration mirrors, add the helper acceptance before the PS5 real runtime is created:

```js
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
```

Do not add a fake JavaScript retry loop: these assertions prove the exact options delegated to Node and that terminal errors are not suppressed.

- [x] **Step 2: Run the suite and capture RED evidence**

Run:

```powershell
node ./.evo-lite/cli/test.js
```

Expected: integration fails with `ReferenceError: removePrStateRuntimeRoot is not defined`. Do not accept a network or unrelated cleanup failure as RED evidence.

- [x] **Step 3: Implement the minimal cleanup helper and use it in PS5**

Add in both integration mirrors:

```js
function removePrStateRuntimeRoot(root, rmSync = fs.rmSync) {
    return rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    });
}
```

Replace only the PS5 `finally` cleanup:

```js
removePrStateRuntimeRoot(runtime.workspaceRoot);
```

Do not change other cleanup sites.

- [x] **Step 4: Run GREEN and verify exact cleanup containment**

Run:

```powershell
node ./.evo-lite/cli/test.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git diff --check "$env:IMPLEMENTATION_BASE"
git diff --name-status "$env:IMPLEMENTATION_BASE"
```

Expected: full suite exits `0`; mirror diff exits `0`; the cumulative worktree still contains exactly the four authorized files; only the PS5 cleanup uses the new helper/options.

- [x] **Step 5: Run GitNexus review and commit Task 2**

Run GitNexus `detect_changes(scope: "all")`, confirm the uncommitted Task 2 change affects only the integration-test pair and expected test flow, then commit:

```powershell
git add .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git commit -m "test(pr-state): retry transient PS5 cleanup"
```

---

### Final Verification Gate: Regression, Real Merged-PR Dogfood, and Scope Proof

Windows Node 22 and Windows Node 24 release-gate acceptance is **mandatory but
deferred** to a separately authorized corrective Draft PR gate. It is not
waived, and neither the local full suite nor real PR #33 dogfood satisfies it.
This implementation gate may approve the local branch for Draft PR creation;
it cannot declare the amendment durably complete.

- [x] **Step 1: Confirm implementation history and exact four-file surface**

Run:

```powershell
git log --oneline "$env:IMPLEMENTATION_BASE..HEAD"
git diff --name-status "$env:IMPLEMENTATION_BASE..HEAD"
git diff --check "$env:IMPLEMENTATION_BASE..HEAD"
```

Expected: exactly two ordinary implementation commits and exactly the four authorized files.

- [x] **Step 2: Confirm cumulative branch surface from durable main**

Run:

```powershell
git diff --name-status 23b6b095c853366c07c14590342277604a274246..HEAD
```

Expected: exactly six files:

```text
docs/superpowers/specs/2026-08-09-pr-state-sync-postmerge-correction-design.md
docs/superpowers/plans/2026-08-09-pr-state-sync-postmerge-correction.md
.evo-lite/cli/pr-state.service.js
templates/cli/pr-state.service.js
.evo-lite/cli/test/integration.js
templates/cli/test/integration.js
```

- [x] **Step 3: Run independent governance and full-suite gates**

Run:

```powershell
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
```

Expected: both exit `0`; default `all` scope contains governance and integration, including `✅ PS2` and `✅ PS5`.

- [x] **Step 4: Run real merged-PR #33 dogfood without body mutation**

Run:

```powershell
node ./.evo-lite/cli/memory.js pr-state validate 33 --json
$dogfoodExit = $LASTEXITCODE
if ($dogfoodExit -ne 1) { throw "expected merged-body drift exit 1, got $dogfoodExit" }
```

Parse the JSON and require:

```text
result                    drift
errors                    []
findings                  [PHASE_DRIFT] only
expected.phase            ready
observed.phase            merged
expected.checks           success
observed.checks           success
observed.diagnostics.runId 31265842002
CHECKS_MISSING             absent
```

Do not change PR #33 body. A later reviewer decides whether `phase: ready -> merged` is authorized after the corrective implementation is durably merged.

- [x] **Step 5: Verify context preservation and both mirror identities**

Run:

```powershell
git diff --exit-code "$env:IMPLEMENTATION_BASE..HEAD" -- .evo-lite/active_context.md .evo-lite/raw_memory
git diff --no-index -- .evo-lite/cli/pr-state.service.js templates/cli/pr-state.service.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git status --short
```

Expected: all diff commands exit `0`; worktree is clean. Confirm remote `main` and the retained PR #33 feature branch identities separately; do not delete either corrective or historical branch.

- [x] **Step 6: Run final GitNexus compare review**

Run GitNexus `detect_changes(scope: "compare", base_ref: $env:IMPLEMENTATION_BASE)`.

Expected:

```text
implementation files  exactly 4
unexpected processes  none
scope escalation       none
```

If GitNexus is stale, refresh the index with the repository-provided runner and rerun compare; do not broaden code scope to satisfy indexing.

- [x] **Step 7: Push the verified implementation head without rewriting history**

Only after Steps 1-6 pass and the worktree is clean, run:

```powershell
git push origin HEAD:codex/pr-state-sync-postmerge-plan

$localHead = git rev-parse HEAD
$remoteLine = git ls-remote origin refs/heads/codex/pr-state-sync-postmerge-plan
if (-not $remoteLine) { throw "remote implementation branch is missing" }
$remoteHead = ($remoteLine -split "`t")[0]
if ($remoteHead -ne $localHead) {
    throw "remote implementation head mismatch: local=$localHead remote=$remoteHead"
}

$remoteMainLine = git ls-remote origin refs/heads/main
if (-not $remoteMainLine) { throw "remote main is missing" }
$remoteMain = ($remoteMainLine -split "`t")[0]
if ($remoteMain -ne '23b6b095c853366c07c14590342277604a274246') {
    throw "remote main drifted: $remoteMain"
}
```

Expected: an ordinary fast-forward push; remote branch equals local `HEAD`;
remote main is unchanged. Force-push is forbidden.

- [x] **Step 8: Hard stop for implementation-level review**

Return:

```text
IMPLEMENTATION_BASE
Task 1 commit SHA and RED/GREEN evidence
Task 2 commit SHA and RED/GREEN evidence
4-file implementation-only diff
6-file cumulative diff
governance/full-suite output
PS2/PS5 acceptance evidence
real PR #33 dogfood JSON summary
2 live/template parity proofs
GitNexus compare
context preservation
diff --check
clean worktree
remote branch/main identity
Windows Node 22/24 CI deferred to mandatory Draft PR gate, not waived
```

Do not create a Draft PR, mutate PR #33, modify active context, delete a branch, or begin another scope.
