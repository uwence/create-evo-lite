# PR State Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the single read-only command `pr-state validate [pr] [--json]` so an Evo-Lite operator can compare a strict expected-state block in a PR body with current GitHub and local Git facts without mutating the PR, repository, or governance state.

**Architecture:** Implement strict parsing, normalization, comparison, and Git/`gh` acquisition in a focused CommonJS service with a dependency-injected executable/argument-array runner. Register one top-level Commander group in a separate CLI module, then add both modules to the existing `core-cli` managed template manifest so scaffold, `sync-runtime`, and runtime-lock behavior remain aligned.

**Tech Stack:** Node.js CommonJS, built-in `child_process`/`fs`/`path`/`assert`, Commander, Git CLI, GitHub CLI (`gh`), existing Evo-Lite integration harness, existing manifest-driven runtime mirror, GitNexus.

## Global Constraints

- Frozen design: `docs/superpowers/specs/2026-08-08-pr-state-sync-design.md` at `1a3308122223a3440409291219f1cd9eb6c2e2fd`.
- Public syntax is exactly `pr-state validate [pr] [--json]`.
- Do not add `context pr-state`, PR URL input, `--repo`, stdin/body/file input, aliases, mutation flags, or automatic hook invocation.
- `[pr]` must match `^[1-9][0-9]*$` and parse as a JavaScript safe integer; omitted PR resolution requires one attached local branch and one resolvable PR.
- The body block uses exact case-sensitive standalone markers and the frozen nine-field order; LF and CRLF are accepted only as line terminators.
- Expected `checks` is limited to `pending | success`; `merged + pending` fails before workflow-run acquisition.
- Expected `baseSha` and `headSha` are comparison operands only and must never drive discovery.
- Current-head CI identity requires target PR number, exact workflow path `.github/workflows/release-gate.yml`, `event=pull_request`, and the current observed PR head SHA.
- Consume every workflow-run page and select the matching run with maximum numeric run ID.
- Preserve all reliably established findings; overall priority is `error > drift > pass` with exit codes 2, 1, and 0 respectively.
- All Git and `gh` processes must use an executable plus argument array with `shell: false`; never interpolate branch/ref/SHA/repository/PR input into a command string.
- Only read-only Git and GitHub commands are permitted. No PR edit/Ready/merge, non-GET API mutation, file write, context command, feedback collection, or active-context mutation.
- Do not add dependencies, modify workflow files, query the jobs endpoint, or treat mergeability/diagnostics as contract findings.
- Keep every live/template pair byte-identical after each task.
- The expected implementation surface is the frozen ten-file set in the File Map. Stop for a design amendment before touching anything else.
- Before editing an existing function/constant, run GitNexus upstream impact analysis for that symbol and report HIGH/CRITICAL risk before proceeding.
- Before every implementation commit, stage only that task and run GitNexus `detect_changes` with `scope: staged` against the current worktree.
- Use ordinary append-only commits. Do not amend, rebase, squash, or force-push.
- `node ./.evo-lite/cli/test.js` is the valid default `TEST_SCOPE=all` gate: governance runs first and integration follows in this mother repository.
- `node ./.evo-lite/cli/test.js governance` remains the separate governance-only gate. Do not add or invoke an unsupported `integration` scope.
- Do not modify the frozen design, this plan during implementation, `.evo-lite/active_context.md`, `.evo-lite/raw_memory/**`, product source, `test.js`, `test/harness.js`, `sync-runtime.js`, package files, or dependencies.

## File Map

| Responsibility | Template source | Live mirror |
| --- | --- | --- |
| Strict expected-block parser, normalization, comparison, acquisition orchestration | `templates/cli/pr-state.service.js` | `.evo-lite/cli/pr-state.service.js` |
| Commander registration, rendering, exit-code routing | `templates/cli/pr-state.js` | `.evo-lite/cli/pr-state.js` |
| Lazy top-level feature registration only | `templates/cli/memory.js` | `.evo-lite/cli/memory.js` |
| `core-cli` managed mirror membership | `templates/cli/template-manifest.js` | `.evo-lite/cli/template-manifest.js` |
| Service, acquisition, CLI, manifest, runtime-lock, and negative-surface acceptance | `templates/cli/test/integration.js` | `.evo-lite/cli/test/integration.js` |

No new dependency, workflow, test harness, or generated tracked artifact is needed.

## Pre-Implementation Baseline Gate

Before editing any runtime or test file, capture the exact reviewed plan head:

```bash
IMPLEMENTATION_BASE="$(git rev-parse HEAD)"
git status --short
```

The implementation authorization must explicitly name the same SHA as `IMPLEMENTATION_BASE`, and the worktree must be clean. Record that SHA in the implementation evidence and reuse it unchanged for every implementation-only range check. If the authorization SHA, current `HEAD`, or recorded `IMPLEMENTATION_BASE` differs, stop before editing.

The frozen design SHA `1a3308122223a3440409291219f1cd9eb6c2e2fd` is not the implementation-only comparison base because the reviewed plan commit is its descendant. The durable cumulative base remains `main@70c173b11ec64896780be67eb6b8bda94d2295fb`.

---

### Task 1: Pure Expected-State Primitives

**Files:**
- Create: `templates/cli/pr-state.service.js`
- Create: `.evo-lite/cli/pr-state.service.js`
- Modify: `templates/cli/test/integration.js:1-19, after the existing 2e service block`
- Modify: `.evo-lite/cli/test/integration.js:1-19, after the existing 2e service block`

**Interfaces:**
- Consumes: PR body text and injected `checkRefName(value) -> boolean`.
- Produces: `PrStateError`, `validatePrNumber(raw)`, `parseExpectedBlock(body, options)`, `normalizePhase(pr)`, `normalizeChecks(run)`, `compareExpectedObserved(expected, observed)`, and `createReport()`.
- `parseExpectedBlock()` returns numeric `schema`, `commits`, and `changedFiles`; all other fields remain strings.
- `compareExpectedObserved()` returns findings in the frozen schema order and never performs I/O.

- [x] **Step 1: Run impact analysis for the integration entry point**

Use GitNexus before editing the integration mirrors:

```text
impact(target="runIntegrationTests", file_path="templates/cli/test/integration.js", direction="upstream", includeTests=true)
```

Record the risk and affected processes. The new service file has no existing symbol to analyze.

- [x] **Step 2: Add the failing PS1 primitive acceptance block to both integration mirrors**

Add a block after `✅ 2e context edit service contract passed`. Use the template service path so the canonical implementation is exercised:

```js
console.log('PS1. Testing pr-state expected-block primitives ...');
{
    const servicePath = path.join(TEMPLATE_CLI_DIR, 'pr-state.service.js');
    delete require.cache[require.resolve(servicePath)];
    const {
        PrStateError, validatePrNumber, parseExpectedBlock,
        normalizePhase, normalizeChecks, compareExpectedObserved, createReport,
    } = require(servicePath);

    const SHA_A = '0123456789abcdef0123456789abcdef01234567';
    const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';
    const block = (overrides = {}, eol = '\n') => {
        const values = {
            schema: '1', base: 'main', baseSha: SHA_A,
            head: 'codex/feature', headSha: SHA_B,
            commits: '3', changedFiles: '4', phase: 'draft', checks: 'success',
            ...overrides,
        };
        return [
            'narrative before', '<!-- EVO-LITE:PR-STATE:BEGIN -->',
            `schema: ${values.schema}`, `base: ${values.base}`, `baseSha: ${values.baseSha}`,
            `head: ${values.head}`, `headSha: ${values.headSha}`,
            `commits: ${values.commits}`, `changedFiles: ${values.changedFiles}`,
            `phase: ${values.phase}`, `checks: ${values.checks}`,
            '<!-- EVO-LITE:PR-STATE:END -->', 'narrative after',
        ].join(eol);
    };
    const parse = body => parseExpectedBlock(body, { checkRefName: () => true });

    assert.deepStrictEqual(parse(block()), {
        schema: 1, base: 'main', baseSha: SHA_A,
        head: 'codex/feature', headSha: SHA_B,
        commits: 3, changedFiles: 4, phase: 'draft', checks: 'success',
    });
    assert.deepStrictEqual(parse(block({}, '\r\n')), parse(block()), 'CRLF must parse identically');
    assert.strictEqual(validatePrNumber('31'), 31);
    for (const raw of ['', '0', '03', '+3', '-1', '3.0', '3e2', '9007199254740992']) {
        assert.throws(() => validatePrNumber(raw), err => err instanceof PrStateError && err.code === 'PR_NUMBER_INVALID');
    }

    assert.strictEqual(normalizePhase({ state: 'open', draft: true, merged: false, merged_at: null }), 'draft');
    assert.strictEqual(normalizePhase({ state: 'open', draft: false, merged: false, merged_at: null }), 'ready');
    assert.strictEqual(normalizePhase({ state: 'closed', draft: false, merged: true, merged_at: '2026-08-08T00:00:00Z' }), 'merged');
    assert.strictEqual(normalizePhase({ state: 'closed', draft: false, merged: false, merged_at: null }), 'closed');
    assert.throws(
        () => normalizePhase({ state: 'open', draft: false, merged: true, merged_at: null }),
        err => err.code === 'OBSERVED_PHASE_INVALID'
    );

    assert.strictEqual(normalizeChecks({ status: 'queued', conclusion: null }), 'pending');
    assert.strictEqual(normalizeChecks({ status: 'completed', conclusion: 'success' }), 'success');
    assert.strictEqual(normalizeChecks({ status: 'completed', conclusion: 'failure' }), 'failed');
    assert.throws(() => normalizeChecks({ status: 'completed', conclusion: null }), err => err.code === 'WORKFLOW_RUN_RESPONSE_INVALID');

    const expected = parse(block());
    const observed = { ...expected, base: 'develop', headSha: SHA_A, commits: 5, checks: 'pending' };
    assert.deepStrictEqual(
        compareExpectedObserved(expected, observed).map(item => item.code),
        ['BASE_REF_DRIFT', 'HEAD_SHA_DRIFT', 'COMMIT_COUNT_DRIFT', 'CHECKS_PENDING']
    );
    assert.deepStrictEqual(Object.keys(createReport()), ['schema', 'result', 'pr', 'expected', 'observed', 'findings', 'errors']);
    console.log('✅ PS1 pr-state expected-block primitives passed');
}
```

Add table-driven marker, lexical, scalar-boundary, semantic, comparison, and checks-taxonomy cases. Each rejection must inspect a `PrStateError`, not only message text:

```js
const BEGIN_MARKER = '<!-- EVO-LITE:PR-STATE:BEGIN -->';
const END_MARKER = '<!-- EVO-LITE:PR-STATE:END -->';
const reversed = block()
    .replace(BEGIN_MARKER, '__BEGIN__')
    .replace(END_MARKER, BEGIN_MARKER)
    .replace('__BEGIN__', END_MARKER);

const markerLikeProse = block().replace(
    'narrative before',
    `narrative ${BEGIN_MARKER} remains opaque`
);
assert.deepStrictEqual(parse(markerLikeProse), parse(block()));

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
    assert.throws(() => parse(body), err => err instanceof PrStateError, label);
}

for (const [commits, changedFiles] of [
    ['1', '0'],
    ['2147483647', '2147483647'],
]) {
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
```

Prove all seven core drift mappings independently, case-sensitive ref comparison, closed-unmerged phase drift, and stable simultaneous ordering:

```js
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
    const findings = compareExpectedObserved(expected, { ...expected, [field]: value });
    assert.deepStrictEqual(findings.map(item => item.code), [code], field);
}

const closedPhase = normalizePhase({
    state: 'closed', draft: false, merged: false, merged_at: null,
});
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
```

Freeze every checks combination explicitly:

```js
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
        codes,
        `${expectedChecks}/${observedChecks}`
    );
}
```

Also prove `git check-ref-format` delegation by injecting a spy that rejects `bad ref` and records both `base` and `head` calls.

- [x] **Step 3: Run the full suite and capture RED evidence**

```bash
node ./.evo-lite/cli/test.js
```

Expected: governance completes, then integration fails in PS1 because `templates/cli/pr-state.service.js` does not exist. The failure must be attributable to the missing service.

- [x] **Step 4: Implement the pure service primitives in both mirrors**

Start both files identically:

```js
'use strict';
const BEGIN = '<!-- EVO-LITE:PR-STATE:BEGIN -->';
const END = '<!-- EVO-LITE:PR-STATE:END -->';
const SHA_RE = /^[0-9a-f]{40}$/;
const POSITIVE_DECIMAL_RE = /^[1-9][0-9]*$/;
const COUNT_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const FIELD_ORDER = Object.freeze([
    'schema', 'base', 'baseSha', 'head', 'headSha',
    'commits', 'changedFiles', 'phase', 'checks',
]);

class PrStateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PrStateError';
        this.code = code;
        this.details = details;
    }
}
```

Implement these exact signatures:

```js
function validatePrNumber(raw) {}
function parseExpectedBlock(body, { checkRefName } = {}) {}
function normalizePhase(pr) {}
function normalizeChecks(run) {}
function compareExpectedObserved(expected, observed) {}
function createReport() {
    return { schema: 1, result: 'error', pr: {}, expected: {}, observed: {}, findings: [], errors: [] };
}
```

Parser requirements:

- split on `\n` and remove only one terminal `\r` from each line;
- globally count exact marker lines before extracting;
- require exactly nine interior lines and fixed key order;
- require exact `: `, bare non-empty values, and no tabs/comments/quoted-scalar syntax;
- validate numeric text before `Number()` conversion and bounds;
- require `checkRefName` to accept both refs;
- reject `merged + pending` after scalar validation.

Use one comparison table so ordering cannot drift:

```js
const COMPARISONS = Object.freeze([
    ['base', 'BASE_REF_DRIFT'],
    ['baseSha', 'BASE_SHA_DRIFT'],
    ['head', 'HEAD_REF_DRIFT'],
    ['headSha', 'HEAD_SHA_DRIFT'],
    ['commits', 'COMMIT_COUNT_DRIFT'],
    ['changedFiles', 'CHANGED_FILE_COUNT_DRIFT'],
    ['phase', 'PHASE_DRIFT'],
]);
```

Append checks findings after scalar comparisons. Export:

```js
module.exports = {
    BEGIN, END, WORKFLOW_PATH: '.github/workflows/release-gate.yml',
    PrStateError, validatePrNumber, parseExpectedBlock,
    normalizePhase, normalizeChecks, compareExpectedObserved, createReport,
};
```

- [x] **Step 5: Run PS1 GREEN and full regression**

Run `node ./.evo-lite/cli/test.js`.

Expected: exit 0 with `✅ PS1 pr-state expected-block primitives passed`.

- [x] **Step 6: Verify parity, staged scope, and commit Task 1**

```bash
git diff --no-index -- .evo-lite/cli/pr-state.service.js templates/cli/pr-state.service.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git diff --check
git add templates/cli/pr-state.service.js .evo-lite/cli/pr-state.service.js templates/cli/test/integration.js .evo-lite/cli/test/integration.js
```

Run GitNexus `detect_changes(scope="staged")`, confirm only Task 1 files/symbols, then commit:

```bash
git commit -m "feat(pr-state): add expected state primitives"
```

---

### Task 2: Read-Only Git and GitHub Acquisition

**Files:**
- Modify: `templates/cli/pr-state.service.js`
- Modify: `.evo-lite/cli/pr-state.service.js`
- Modify: `templates/cli/test/integration.js:after the PS1 block`
- Modify: `.evo-lite/cli/test/integration.js:after the PS1 block`

**Interfaces:**
- Consumes: Task 1 primitives and injected `runCommand(executable, args, options)`.
- Produces: `createDefaultCommandRunner()` and `validatePrState(prArg, options) -> report`.
- Runner result: `{ status: number|null, stdout: string, stderr: string, error?: Error, signal?: string|null }`.
- `validatePrState()` always returns the fixed envelope; expected operational failures do not escape.

- [x] **Step 1: Run impact analysis before extending Task 1 symbols**

Use GitNexus upstream impact on `parseExpectedBlock`, `compareExpectedObserved`, `createReport`, and `runIntegrationTests`. Report HIGH/CRITICAL before editing.

- [x] **Step 2: Add the failing PS2 acquisition block to both integration mirrors**

Build deterministic fixtures and a fake raw command runner:

```js
console.log('PS2. Testing pr-state read-only acquisition ...');
{
    const service = require(path.join(TEMPLATE_CLI_DIR, 'pr-state.service.js'));
    const SHA_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SHA_BASE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const expectedBody = [
        '<!-- EVO-LITE:PR-STATE:BEGIN -->',
        'schema: 1', 'base: main', `baseSha: ${SHA_BASE}`,
        'head: codex/feature', `headSha: ${SHA_HEAD}`,
        'commits: 3', 'changedFiles: 4', 'phase: draft', 'checks: success',
        '<!-- EVO-LITE:PR-STATE:END -->',
    ].join('\n');
    const pr = {
        number: 31, html_url: 'https://github.com/uwence/create-evo-lite/pull/31',
        body: expectedBody, state: 'open', draft: true, merged: false, merged_at: null,
        base: { ref: 'main', sha: SHA_BASE }, head: { ref: 'codex/feature', sha: SHA_HEAD },
        commits: 3, changed_files: 4, mergeable: true,
    };
    const workflow = { id: 77, path: '.github/workflows/release-gate.yml', name: 'release-gate' };
    const run = (id, status, conclusion, overrides = {}) => ({
        id, event: 'pull_request', head_sha: SHA_HEAD, status, conclusion,
        pull_requests: [{ number: 31 }], html_url: `https://github.com/run/${id}`,
        created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:01:00Z', ...overrides,
    });
    const calls = [];
    const responses = new Map([
        ['git rev-parse --show-toplevel', { status: 0, stdout: '/tmp/repo\n', stderr: '' }],
        ['gh repo view --json nameWithOwner', { status: 0, stdout: '{"nameWithOwner":"uwence/create-evo-lite"}', stderr: '' }],
        ['gh api --method GET repos/uwence/create-evo-lite/pulls/31', { status: 0, stdout: JSON.stringify(pr), stderr: '' }],
        ['git check-ref-format --branch main', { status: 0, stdout: 'main\n', stderr: '' }],
        ['git check-ref-format --branch codex/feature', { status: 0, stdout: 'codex/feature\n', stderr: '' }],
        ['gh api --method GET repos/uwence/create-evo-lite/actions/workflows/release-gate.yml', { status: 0, stdout: JSON.stringify(workflow), stderr: '' }],
    ]);
    const fake = (executable, args) => {
        const key = [executable, ...args].join(' ');
        calls.push({ executable, args: [...args] });
        if (key.includes('/actions/workflows/77/runs')) {
            return { status: 0, stdout: JSON.stringify({ total_count: 1, workflow_runs: [run(100, 'completed', 'success')] }), stderr: '' };
        }
        if (!responses.has(key)) throw new Error(`unexpected command: ${key}`);
        return responses.get(key);
    };
    const report = service.validatePrState('31', { cwd: '/tmp/repo', runCommand: fake });
    assert.strictEqual(report.result, 'pass');
    assert.deepStrictEqual(report.findings, []);
    assert.deepStrictEqual(report.errors, []);
    assert.ok(calls.every(call => ['git', 'gh'].includes(call.executable)));
    assert.ok(calls.every(call => !/\b(edit|ready|merge|POST|PATCH|PUT|DELETE)\b/.test(call.args.join(' '))));
    console.log('✅ PS2 pr-state read-only acquisition passed');
}
```

Extend PS2 with these scenarios:

- omitted PR calls `git symbolic-ref --quiet --short HEAD`, then `gh pr view codex/feature --repo uwence/create-evo-lite --json number`;
- detached HEAD, no PR, and ambiguous/malformed resolution return `result:error`;
- stale expected `headSha` yields `HEAD_SHA_DRIFT`, while run-query arguments contain only observed head SHA;
- wrong PR association, event, or head SHA is ignored;
- workflow path mismatch is an observation error;
- reverse-ordered matching runs select maximum numeric run ID, independent of API order;
- an older successful run plus a larger-run-ID pending run yields `CHECKS_PENDING`;
- an older successful run plus a larger-run-ID failed run yields `CHECKS_FAILED`;
- equal `created_at`/`updated_at` timestamps do not break the tie: the larger numeric run ID still wins;
- page 1 with 100 entries and `total_count: 101` forces page 2, whose larger matching run wins;
- zero matches after complete pagination yields `CHECKS_MISSING`;
- API failure yields error and never `CHECKS_MISSING`;
- reliable `HEAD_SHA_DRIFT` remains when a later workflow query fails, while result is `error`.

- [x] **Step 3: Run the full suite and capture RED evidence**

Run `node ./.evo-lite/cli/test.js`.

Expected: integration reaches PS2 and fails because `validatePrState` or `createDefaultCommandRunner` is not exported.

- [x] **Step 4: Add the default runner and acquisition orchestration to both service mirrors**

Use `spawnSync` without shell evaluation:

```js
const { spawnSync } = require('child_process');
function createDefaultCommandRunner() {
    return (executable, args, options = {}) => {
        const result = spawnSync(executable, args, {
            cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs || 30000,
            windowsHide: true, shell: false,
        });
        return {
            status: result.status, stdout: result.stdout || '', stderr: result.stderr || '',
            error: result.error, signal: result.signal,
        };
    };
}
```

Add these internal helpers:

```js
function runText(runCommand, executable, args, options, errorCode) {}
function runJson(runCommand, executable, args, options, errorCode) {}
function validatePrShape(value) {}
function validateWorkflowShape(value) {}
function validateRunShape(value) {}
function resolveRepository(runCommand, cwd) {}
function resolvePrNumber(prArg, repository, runCommand, cwd) {}
function observeCore(pr) {}
function observeChecks({ repository, prNumber, headSha, runCommand, cwd }) {}
function finalizeReport(report) {}
function validatePrState(prArg, options = {}) {}
```

Use stable operational error codes:

```text
PR_NUMBER_INVALID
GIT_REPOSITORY_REQUIRED
PR_RESOLUTION_FAILED
PR_QUERY_FAILED
PR_RESPONSE_INVALID
PR_STATE_BLOCK_INVALID
PR_STATE_REF_INVALID
PR_STATE_SEMANTIC_INVALID
OBSERVED_PHASE_INVALID
WORKFLOW_QUERY_FAILED
WORKFLOW_IDENTITY_INVALID
WORKFLOW_RUN_QUERY_FAILED
WORKFLOW_RUN_RESPONSE_INVALID
```

The explicit-PR command sequence is:

```js
['git', ['rev-parse', '--show-toplevel']]
['gh', ['repo', 'view', '--json', 'nameWithOwner']]
['gh', ['api', '--method', 'GET', `repos/${repository}/pulls/${number}`]]
['git', ['check-ref-format', '--branch', expected.base]]
['git', ['check-ref-format', '--branch', expected.head]]
['gh', ['api', '--method', 'GET', `repos/${repository}/actions/workflows/release-gate.yml`]]
```

Run pages with argument-array fields:

```js
const args = [
    'api', '--method', 'GET', `repos/${repository}/actions/workflows/${workflowId}/runs`,
    '-f', 'event=pull_request', '-f', `head_sha=${headSha}`,
    '-f', 'per_page=100', '-f', `page=${page}`,
];
```

Consume all `total_count` entries, filter the explicit four-part identity, and select:

```js
const newest = matching.reduce((best, item) => !best || item.id > best.id ? item : best, null);
```

Compare core fields before the workflow-query `try` block. If workflow observation fails, retain core findings and append an error. Finalize with:

```js
report.result = report.errors.length > 0
    ? 'error'
    : report.findings.length > 0 ? 'drift' : 'pass';
```

- [x] **Step 5: Run PS2 GREEN and full regression**

Run `node ./.evo-lite/cli/test.js`.

Expected: exit 0 with both PS1 and `✅ PS2 pr-state read-only acquisition passed`.

- [x] **Step 6: Verify parity, staged scope, and commit Task 2**

Run pair diffs for service/integration, `git diff --check`, stage only the four Task 2 files, run GitNexus staged `detect_changes`, then commit:

```bash
git commit -m "feat(pr-state): observe current pull request state"
```

### Task 3: Register the CLI and Freeze Rendering/Exit Semantics

**Files:**

- Create: `.evo-lite/cli/pr-state.js`
- Create: `templates/cli/pr-state.js`
- Modify: `.evo-lite/cli/memory.js`
- Modify: `templates/cli/memory.js`
- Modify: `.evo-lite/cli/test/integration.js`
- Modify: `templates/cli/test/integration.js`

**Interfaces introduced:**

```js
registerPrStateCommands(program, deps)
resultExitCode(result)
renderText(report)
```

- [x] **Step 1: Run impact analysis before editing existing symbols**

Run GitNexus upstream impact analysis for `safeRegister`, `buildProgram`, and `runIntegrationTests`. Record the direct callers, affected processes, and risk. If any result is HIGH or CRITICAL, stop and return it for review before editing.

- [x] **Step 2: Add PS3 CLI tests to both integration mirrors**

Add focused tests that inject a fake `validatePrState()` into `registerPrStateCommands()` and prove:

- `pr-state validate [pr] [--json]` is the only public surface;
- pass, drift, and error reports map to exit codes 0, 1, and 2;
- text output includes the overall result and every finding/error code;
- JSON output emits the fixed envelope without changing field names;
- `pr-state --help` succeeds;
- `context pr-state`, PR URLs, `--repo`, `--file`, stdin/body inputs, and extra arguments are rejected before observation.

Use subprocess tests for the real root parser. Assert the marker:

```text
✅ PS3 pr-state CLI registration and rendering passed
```

- [x] **Step 3: Run PS3 RED**

Run `node ./.evo-lite/cli/test.js`.

Expected: non-zero in the integration phase because `pr-state.js` and root registration do not exist. An unrelated governance or earlier PS1/PS2 failure is not acceptable RED evidence.

- [x] **Step 4: Implement the live CLI module and root registration**

Create `.evo-lite/cli/pr-state.js` with this boundary:

```js
'use strict';

const service = require('./pr-state.service');

function resultExitCode(result) {
  return result === 'pass' ? 0 : result === 'drift' ? 1 : 2;
}

function renderText(report) {
  const lines = [`pr-state: ${report.result}`];
  for (const finding of report.findings || []) {
    lines.push(`finding ${finding.code}: ${finding.field}`);
  }
  for (const error of report.errors || []) {
    lines.push(`error ${error.code}: ${error.message}`);
  }
  return lines.join('\n');
}

function registerPrStateCommands(program, deps = {}) {
  const validate = deps.validatePrState || service.validatePrState;
  const group = program.command('pr-state')
    .description('Validate declared PR governance state');

  group.command('validate [pr]')
    .option('--json', 'Emit structured JSON')
    .action((pr, options) => {
      const report = validate(pr, { cwd: process.cwd() });
      console.log(options.json ? JSON.stringify(report, null, 2) : renderText(report));
      process.exitCode = resultExitCode(report.result);
    });
}

module.exports = { registerPrStateCommands, resultExitCode, renderText };
```

Preserve the frozen JSON envelope exactly; the code above is the registration skeleton, not permission to reduce the report shape. Register only this root group in both `memory.js` mirrors:

```js
safeRegister('pr-state', () => require('./pr-state').registerPrStateCommands(program));
```

Do not add `context pr-state`, aliases, body rewrite commands, or text-source options.

- [x] **Step 5: Mirror the CLI changes and run PS3 GREEN**

Copy the completed live changes byte-for-byte to the template mirrors, then run `node ./.evo-lite/cli/test.js`.

Expected: exit 0 with PS1, PS2, and `✅ PS3 pr-state CLI registration and rendering passed` visible in the integration phase.

- [x] **Step 6: Verify parity, staged scope, and commit Task 3**

Run pair diffs for `pr-state.js`, `memory.js`, and `integration.js`, plus `git diff --check`. Stage only the six Task 3 files, run GitNexus staged `detect_changes`, then commit:

```bash
git commit -m "feat(pr-state): expose read-only validation command"
```

### Task 4: Register the New Modules in the Managed Runtime Manifest

**Files:**

- Modify: `.evo-lite/cli/template-manifest.js`
- Modify: `templates/cli/template-manifest.js`
- Modify: `.evo-lite/cli/test/integration.js`
- Modify: `templates/cli/test/integration.js`

- [x] **Step 1: Run impact analysis before editing existing symbols**

Run GitNexus upstream impact analysis for `MANAGED_TEMPLATE_FAMILIES`, `buildManagedTemplateEntries`, and `runIntegrationTests`. Stop for review if any result is HIGH or CRITICAL.

- [x] **Step 2: Add PS4 manifest/runtime-lock tests to both integration mirrors**

Extend the existing T4 managed-template assertions so the `core-cli` family must contain:

```text
pr-state.js
pr-state.service.js
```

Add a temporary-runtime acceptance case that:

1. creates an isolated destination;
2. points the existing template/source environment overrides at the test fixture;
3. runs the existing `syncRuntime()` path;
4. proves both new files were copied;
5. proves the generated runtime lock has entries for `.evo-lite/cli/pr-state.js` and `.evo-lite/cli/pr-state.service.js`;
6. runs `verifyRuntimeLock()` and expects status `ok`;
7. removes the temporary runtime in `finally`.

Assert the marker:

```text
✅ PS4 pr-state managed runtime mirror coverage passed
```

- [x] **Step 3: Run PS4 RED**

Run `node ./.evo-lite/cli/test.js`.

Expected: non-zero in the integration phase because the explicit `core-cli` manifest does not yet manage the two new modules. A failure caused by modifying `sync-runtime.js` or the harness is not acceptable.

- [x] **Step 4: Add the two exact manifest entries**

Add these file names to the `core-cli` file list in both manifest mirrors:

```js
'pr-state.js',
'pr-state.service.js',
```

Do not modify `sync-runtime.js`, `index.js`, package metadata, or workflow files. The existing manifest-driven sync and lock machinery must consume the new entries without new special cases.

- [x] **Step 5: Run PS4 GREEN and verify runtime management**

Run `node ./.evo-lite/cli/test.js`.

Expected: exit 0 with PS1-PS4 markers, including `✅ PS4 pr-state managed runtime mirror coverage passed`.

- [x] **Step 6: Verify parity, staged scope, and commit Task 4**

Run pair diffs for manifest/integration, `git diff --check`, stage only the four Task 4 files, run GitNexus staged `detect_changes`, then commit:

```bash
git commit -m "feat(pr-state): manage validator runtime modules"
```

### Task 5: Close the Fail-Closed Acceptance Matrix Through the Real CLI Boundary

**Files:**

- Modify: `.evo-lite/cli/pr-state.service.js`
- Modify: `templates/cli/pr-state.service.js`
- Modify: `.evo-lite/cli/pr-state.js`
- Modify: `templates/cli/pr-state.js`
- Modify: `.evo-lite/cli/test/integration.js`
- Modify: `templates/cli/test/integration.js`

- [x] **Step 1: Run impact analysis before editing existing symbols**

Run GitNexus upstream impact analysis for `validatePrState`, `registerPrStateCommands`, `renderText`, and `runIntegrationTests`. Stop for review on HIGH or CRITICAL risk.

- [x] **Step 2: Add PS5 operational-error and portable real-CLI tests**

Complete the fail-closed matrix for:

- missing `gh` executable;
- authentication/HTTP 401 or 403 failures;
- timeout, network, or signal termination;
- malformed repository JSON;
- malformed PR response shape;
- contradictory lifecycle fields;
- malformed workflow identity/path;
- malformed run status/conclusion;
- inconsistent pagination or `total_count` evidence;
- a late workflow observation failure retaining already reliable core drift findings while the overall result is `error`.

Build a portable fake `gh` inside a temporary runtime:

- write a fixture-driven `fake-gh.js`;
- on Windows, invoke it through a temporary `gh.cmd`;
- on POSIX, invoke it through an executable `gh` script with a Node shebang;
- log argv to a temporary call-log file;
- select fixtures only through test-owned environment variables;
- prepend only the temporary fake directory to `PATH` for the subprocess;
- never depend on a developer's authenticated GitHub session.

Use the existing `createTempRuntimeRoot()` flow, initialize a local git repository in its temporary workspace, and invoke its actual `memory.js` entry point with:

```text
pr-state validate 31 --json
```

Prove through that boundary:

- pass returns exit 0;
- drift returns exit 1;
- operational error returns exit 2;
- the JSON envelope is stable;
- only the fake call log changes;
- no mutating `gh` verbs or repository writes occur;
- expected `headSha` is never used for CI discovery;
- workflow lookup uses the observed `headRefOid`;
- all run pages are consumed and the matching run with maximum numeric `run_id` wins.

Assert the marker:

```text
✅ PS5 pr-state fail-closed CLI acceptance passed
```

- [x] **Step 3: Run PS5 RED**

Run `node ./.evo-lite/cli/test.js`.

Expected: non-zero from one deliberately deferred malformed-response or operational-error case. PS1-PS4 must still pass; an unrelated parser, registration, manifest, or governance failure is not acceptable RED evidence.

- [x] **Step 4: Implement only the missing fail-closed shape/error mappings**

Keep the pure comparison and read-only acquisition architecture unchanged. Normalize thrown errors into the frozen envelope with a helper equivalent to:

```js
function errorEntry(error) {
  return {
    code: error instanceof PrStateError
      ? error.code
      : 'PR_STATE_UNEXPECTED_ERROR',
    message: error && error.message
      ? String(error.message)
      : 'unknown pr-state error',
  };
}
```

Do not convert operational errors into drift, suppress reliable earlier findings, add retries, query job details, or introduce mutation/repair behavior.

- [x] **Step 5: Run PS5 GREEN and the supported regression gates**

Run:

```bash
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
```

Expected: both exit 0; the full default `all` run contains PS1-PS5 and `✅ PS5 pr-state fail-closed CLI acceptance passed`.

Do not run `node ./.evo-lite/cli/test.js integration`; the harness does not expose that scope.

- [x] **Step 6: Verify parity, staged scope, and commit Task 5**

Run all touched live/template pair diffs and `git diff --check`. Stage only the six Task 5 files, run GitNexus staged `detect_changes`, then commit:

```bash
git commit -m "fix(pr-state): fail closed on observation gaps"
```

### Final Verification Gate: Full Regression, Runtime Management, and Scope Proof

Run this gate only after Tasks 1-5 are committed. Do not repair failures by changing the frozen design or plan.

- [x] **Verify the exact ten-file implementation surface**

Run:

```bash
test "$(git merge-base "$IMPLEMENTATION_BASE" HEAD)" = "$IMPLEMENTATION_BASE"
git diff --name-status "$IMPLEMENTATION_BASE"..HEAD
```

Expected: exactly the ten frozen files and no design, plan, active-context, raw-memory, workflow, dependency, harness, or product-source change.

Then run the cumulative branch proof:

```bash
git diff --name-status 70c173b11ec64896780be67eb6b8bda94d2295fb..HEAD
```

Expected: exactly 12 changed files: one frozen design spec, one implementation plan, and the ten frozen implementation files. Multiple append-only commits to either document do not increase this changed-file count.

- [x] **Run the supported governance and full-suite gates**

Run:

```bash
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
```

Expected: both exit 0. The default `all` suite must show PS1, PS2, PS3, PS4, and PS5 integration acceptance markers. Do not invent or add an `integration` test scope.

- [x] **Run safe parser-level CLI probes**

Run:

```bash
node ./.evo-lite/cli/memory.js pr-state --help
node ./.evo-lite/cli/memory.js context pr-state
node ./.evo-lite/cli/memory.js pr-state validate "bad id"
node ./.evo-lite/cli/memory.js pr-state validate 31 --repo owner/repo
```

Expected:

- help exits 0;
- the three unsupported/invalid invocations exit non-zero before GitHub observation;
- `context pr-state` is rejected as an unknown nested command;
- `"bad id"` is rejected as an invalid PR number;
- `--repo` is rejected by the parser;
- none of the probes changes repository files or calls a mutating GitHub operation.

- [x] **Validate context preservation**

Run:

```bash
node ./.evo-lite/cli/memory.js context validate
git diff --exit-code -- .evo-lite/active_context.md .evo-lite/raw_memory
```

Expected: validation passes and both governance-state paths are unchanged.

- [x] **Verify every live/template pair byte-for-byte**

Run `git diff --no-index` for:

```text
.evo-lite/cli/pr-state.service.js  ↔ templates/cli/pr-state.service.js
.evo-lite/cli/pr-state.js          ↔ templates/cli/pr-state.js
.evo-lite/cli/memory.js            ↔ templates/cli/memory.js
.evo-lite/cli/template-manifest.js ↔ templates/cli/template-manifest.js
.evo-lite/cli/test/integration.js  ↔ templates/cli/test/integration.js
```

Expected: all five commands exit 0. PS4 must also prove the two new modules appear in the managed runtime lock and pass `verifyRuntimeLock()`; do not commit a generated runtime-lock artifact.

- [x] **Run final diff hygiene and GitNexus compare review**

Run:

```bash
git diff --check "$IMPLEMENTATION_BASE"..HEAD
git status --short
```

Run GitNexus `detect_changes` with compare base equal to the exact recorded `$IMPLEMENTATION_BASE`. Review every affected process and confirm no unexpected symbol or flow is present. The frozen design SHA is not an acceptable substitute for this implementation-only compare.

- [x] **Hard stop for implementation review**

Return the recorded implementation-base SHA, five Task commit SHAs, the implementation-only ten-file diff, cumulative 12-file diff, per-Task RED/GREEN evidence, governance/full-suite results, PS1-PS5 markers, five pair parity results, managed-manifest/runtime-lock evidence, context preservation, GitNexus compare output, `diff --check`, and a clean worktree.

Implementation does not authorize a Draft PR, Ready transition, merge, active-context edit, raw-memory write, feedback collection, branch deletion, or adjacent NEXT scope.
