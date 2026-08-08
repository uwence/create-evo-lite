# Backlog Edit CLI Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the single safe command `context edit <id> <new-text>` so an existing pending backlog item's text can be revised without changing its ID, status, formatting, surrounding sections, or file bytes outside the target payload.

**Architecture:** Implement `editBacklogTask(id, newText)` in the memory service using offsets into the original Markdown string, with canonical whole-document validation before interpretation and again before the one changed write. Route one nested Commander command directly to that service method; integration coverage proves error ordering, duplicate semantics, byte preservation, no-op behavior, structural-injection rejection, audit ordering, and the absence of alternate command surfaces.

**Tech Stack:** Node.js CommonJS, built-in `fs`/`crypto`/`child_process`/`assert`, Commander, existing Evo-Lite integration harness, GitNexus.

## Global Constraints

- Frozen design: `docs/superpowers/specs/2026-08-08-backlog-edit-cli-gap-design.md` at `f46ec8a899c86b73bef7ac146e873aab6306c1d7`.
- Public syntax is exactly `context edit <id> <new-text>`; both positional arguments are required.
- Do not add a top-level `edit` alias, `--content`, `--file`, stdin handling, multiline Markdown, regex matching, or batch editing.
- Validate the original active context before all edit-specific work.
- Validate raw `newText` for `\r`/`\n` before `trim()`; the trimmed result must be non-empty.
- Reuse `[A-Za-z0-9_-]{1,32}` and case-insensitive ID resolution.
- Scan IDs across all checked and pending backlog items; ambiguity is decided before pending state.
- Only a unique pending target is editable; missing, ambiguous, checked-only, or structurally malformed targets fail closed.
- Derive the payload span from original Markdown offsets; do not parse and reserialize the BACKLOG section.
- Preserve checkbox bytes, original ID case, ID-to-payload whitespace, line ending, all other items, anchors, and all other sections.
- Treat payload text as opaque, then validate the complete candidate with `validateActiveContextMarkdown()` before writing.
- Same-text after trim is a successful no-op with no write and no `CONTEXT_EDIT`.
- A changed edit performs one `fs.writeFileSync()` call, followed by best-effort `CONTEXT_EDIT`; do not claim crash atomicity or rollback.
- If the active-context write throws, propagate that error and do not attempt `CONTEXT_EDIT`.
- Do not call `ensureContextFile()` from edit: a missing active-context file fails through the existing read error and is not implicitly created.
- Keep each live/template pair byte-identical after every task.
- Do not modify `validateActiveContextMarkdown`; GitNexus reports it as HIGH risk (2 direct callers, 4 affected processes). This feature only calls the existing validator.
- Do not modify `.evo-lite/active_context.md`, planning state, product source, dependencies, or the frozen design spec.

## File Map

| Responsibility | Template source | Live mirror |
| --- | --- | --- |
| Service validation, resolution, offset mutation, audit | `templates/cli/memory.service.js` | `.evo-lite/cli/memory.service.js` |
| Nested command registration and routing | `templates/cli/memory.js` | `.evo-lite/cli/memory.js` |
| Service and CLI acceptance coverage | `templates/cli/test/integration.js` | `.evo-lite/cli/test/integration.js` |

No new runtime module is needed. The implementation adds one exported service function and one nested command while reusing the canonical validator and existing logging/write paths.

---

### Task 1: Service Contract and Byte-Surgical Mutation

**Files:**
- Modify: `templates/cli/test/integration.js:1-6,476-545`
- Modify: `.evo-lite/cli/test/integration.js:1-6,476-545`
- Modify: `templates/cli/memory.service.js:212-249,1476-1519,3324-3370`
- Modify: `.evo-lite/cli/memory.service.js:212-249,1476-1519,3324-3370`

**Interfaces:**
- Consumes: `validateActiveContextMarkdown(markdown)`, `extractBacklogId(line)`, `BACKLOG_LABEL_RE`, `ACTIVE_CONTEXT_PATH`, `appendLog(action, content)`.
- Produces: `editBacklogTask(id, newText) -> { id: string, line: string }`, exported from both service mirrors. The returned `id` preserves the stored ID's original case; no public `changed` field is added.

- [ ] **Step 1: Add the failing service acceptance block to both integration mirrors**

Add the built-in hash dependency beside the existing imports:

```js
const crypto = require('crypto');
```

Insert the following isolated block after the existing `2r` backlog-label block. Keep the two integration files byte-identical.

```js
console.log('2e. Testing context edit service contract ...');
{
    const editRuntime = createTempRuntimeRoot('backlog-edit-service');
    const editLoaded = await bootstrapRuntime(editRuntime.runtimeRoot);
    const svc = editLoaded.service;
    const contextPath = path.join(editRuntime.runtimeRoot, 'active_context.md');
    const logPath = path.join(editRuntime.runtimeRoot, 'memory.log');
    const template = fs.readFileSync(contextPath, 'utf8');
    const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
    const editLogCount = () => {
        if (!fs.existsSync(logPath)) return 0;
        return (fs.readFileSync(logPath, 'utf8').match(/CONTEXT_EDIT:/g) || []).length;
    };
    const withBacklog = (lines, eol = '\n') => {
        const begin = '<!-- BEGIN_BACKLOG -->';
        const end = '<!-- END_BACKLOG -->';
        const beginIndex = template.indexOf(begin);
        const endIndex = template.indexOf(end);
        return template.slice(0, beginIndex + begin.length)
            + eol + lines.join(eol) + eol
            + template.slice(endIndex);
    };
    const assertRejected = (markdown, id, newText, pattern, message) => {
        fs.writeFileSync(contextPath, markdown, 'utf8');
        const beforeBytes = fs.readFileSync(contextPath);
        const beforeLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
        assert.throws(() => svc.editBacklogTask(id, newText), pattern, message);
        const afterBytes = fs.readFileSync(contextPath);
        const afterLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
        assert.strictEqual(sha256(afterBytes), sha256(beforeBytes), `${message}: active_context SHA-256 changed`);
        assert.strictEqual(afterLog, beforeLog, `${message}: CONTEXT_EDIT log changed`);
    };
    const captureEditIo = fn => {
        const operations = [];
        const originalWriteFileSync = fs.writeFileSync;
        const originalAppendFileSync = fs.appendFileSync;
        fs.writeFileSync = (filePath, ...args) => {
            if (path.resolve(filePath) === path.resolve(contextPath)) operations.push('write');
            return originalWriteFileSync(filePath, ...args);
        };
        fs.appendFileSync = (filePath, content, ...args) => {
            if (path.resolve(filePath) === path.resolve(logPath) && String(content).includes('CONTEXT_EDIT:')) {
                operations.push('audit');
            }
            return originalAppendFileSync(filePath, content, ...args);
        };
        try {
            return { result: fn(), operations };
        } finally {
            fs.writeFileSync = originalWriteFileSync;
            fs.appendFileSync = originalAppendFileSync;
        }
    };

    const seeded = withBacklog([
        '- [ ] [AbC]\t  old text',
        '- [x] [done1] completed text',
    ], '\r\n');
    fs.writeFileSync(contextPath, seeded, 'utf8');
    const expected = seeded.replace('- [ ] [AbC]\t  old text', '- [ ] [AbC]\t  [BLOCKED] 新文本，"quoted"');
    const logBeforeChange = editLogCount();
    const changedIo = captureEditIo(() => svc.editBacklogTask('abc', '  [BLOCKED] 新文本，"quoted"  '));
    const changed = changedIo.result;
    assert.deepStrictEqual(changed, {
        id: 'AbC',
        line: '- [ ] [AbC]\t  [BLOCKED] 新文本，"quoted"',
    });
    assert.deepStrictEqual(changedIo.operations, ['write', 'audit'], 'changed edit must write once before auditing');
    assert.strictEqual(fs.readFileSync(contextPath, 'utf8'), expected, 'edit changed bytes outside the payload');
    assert.strictEqual(editLogCount(), logBeforeChange + 1, 'changed edit must append one CONTEXT_EDIT');

    const noOpBefore = fs.readFileSync(contextPath);
    const noOpLogBefore = editLogCount();
    const noOpIo = captureEditIo(() => svc.editBacklogTask('ABC', '  [BLOCKED] 新文本，"quoted"  '));
    const noOp = noOpIo.result;
    assert.deepStrictEqual(noOp, changed, 'same-text no-op should return the stored target identity');
    assert.deepStrictEqual(noOpIo.operations, [], 'same-text no-op must not write or audit');
    assert.strictEqual(sha256(fs.readFileSync(contextPath)), sha256(noOpBefore), 'same-text no-op rewrote active_context');
    assert.strictEqual(editLogCount(), noOpLogBefore, 'same-text no-op appended CONTEXT_EDIT');

    const lfSeeded = withBacklog(['- [ ] [lf1] old LF text'], '\n');
    fs.writeFileSync(contextPath, lfSeeded, 'utf8');
    svc.editBacklogTask('LF1', 'new LF text');
    assert.strictEqual(
        fs.readFileSync(contextPath, 'utf8'),
        lfSeeded.replace('- [ ] [lf1] old LF text', '- [ ] [lf1] new LF text'),
        'LF edit changed bytes outside the payload'
    );

    // This is a write-ordering fault test, not a crash-atomicity proof. The
    // injected write throws before touching the file; the contract under test
    // is exception propagation plus zero audit attempt after that throw.
    fs.writeFileSync(contextPath, seeded, 'utf8');
    const writeFailureLogBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
    const writeFailureOperations = [];
    const originalWrite = fs.writeFileSync;
    const originalAppend = fs.appendFileSync;
    fs.writeFileSync = (filePath, ...args) => {
        if (path.resolve(filePath) === path.resolve(contextPath)) {
            writeFailureOperations.push('write');
            throw new Error('INJECTED_CONTEXT_WRITE_FAILURE');
        }
        return originalWrite(filePath, ...args);
    };
    fs.appendFileSync = (filePath, content, ...args) => {
        if (path.resolve(filePath) === path.resolve(logPath) && String(content).includes('CONTEXT_EDIT:')) {
            writeFailureOperations.push('audit');
        }
        return originalAppend(filePath, content, ...args);
    };
    try {
        assert.throws(
            () => svc.editBacklogTask('abc', 'write failure probe'),
            /INJECTED_CONTEXT_WRITE_FAILURE/,
            'context write error must propagate'
        );
        assert.deepStrictEqual(
            writeFailureOperations,
            ['write'],
            'failed context write must not attempt CONTEXT_EDIT'
        );
    } finally {
        fs.writeFileSync = originalWrite;
        fs.appendFileSync = originalAppend;
    }
    const writeFailureLogAfter = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
    assert.strictEqual(writeFailureLogAfter, writeFailureLogBefore, 'failed context write changed the edit audit log');

    assertRejected(seeded, 'bad id', 'valid', /invalid backlog id/, 'invalid id');
    assertRejected(seeded, 'missing', 'valid', /not found/, 'missing id');
    assertRejected(seeded, 'bad id', 'line1\nline2', /single-line/, 'raw newline must win before id validation');
    assertRejected(seeded, 'bad id', 'line1\rline2', /single-line/, 'raw CR must win before id validation');
    assertRejected(seeded, 'bad id', 'line1\r\nline2', /single-line/, 'raw CRLF must win before id validation');
    assertRejected(seeded, 'bad id', '', /new-text.*empty|empty.*new-text/, 'empty string must win before id validation');
    assertRejected(seeded, 'bad id', '   ', /new-text.*empty|empty.*new-text/, 'empty text must win before id validation');
    assertRejected(
        withBacklog(['- [ ] [abc] first', '- [ ] [ABC] second']),
        'aBc',
        'replacement',
        /ambiguous|multiple IDs/,
        'pending duplicate id'
    );
    assertRejected(
        withBacklog(['- [ ] [abc] pending', '- [x] [ABC] checked']),
        'aBc',
        'replacement',
        /ambiguous|multiple IDs/,
        'mixed-status duplicate id'
    );
    assertRejected(
        withBacklog(['- [x] [abc] checked']),
        'ABC',
        'replacement',
        /not pending/,
        'checked-only target'
    );
    assertRejected(
        seeded.replace('<!-- END_BACKLOG -->', '<!-- END_BACKLOG -->\n<!-- END_BACKLOG -->'),
        'bad id',
        'line1\nline2',
        /active_context.*invalid/,
        'invalid original structure must win before input validation'
    );
    assertRejected(seeded, 'abc', 'waiting <!-- END_BACKLOG -->', /active_context.*invalid/, 'BACKLOG anchor injection');
    assertRejected(seeded, 'abc', 'waiting <!-- BEGIN_META -->', /active_context.*invalid/, 'cross-section anchor injection');
    console.log('✅ 2e context edit service contract passed');
}
```

- [ ] **Step 2: Run the integration suite and prove RED**

Run:

```bash
node ./.evo-lite/cli/test.js integration
```

Expected: non-zero with `svc.editBacklogTask is not a function`. If it fails earlier for dependency resolution, restore the documented test environment first; do not change the test contract to bypass the missing function.

- [ ] **Step 3: Implement `editBacklogTask` in both service mirrors**

Place the function beside `addTask`/`setFocus`, and export it in `module.exports`. Apply the same patch to both files; do not modify `validateActiveContextMarkdown`.

```js
function editBacklogTask(id, newText) {
    const markdown = fs.readFileSync(ACTIVE_CONTEXT_PATH, 'utf8');
    const originalValidation = validateActiveContextMarkdown(markdown);
    if (!originalValidation.valid) {
        throw new Error(`active_context invalid: ${originalValidation.errors.join('; ')}`);
    }

    const rawText = newText === undefined || newText === null ? '' : String(newText);
    if (/[\r\n]/.test(rawText)) {
        throw new Error('new-text must be single-line');
    }
    const text = rawText.trim();
    if (!text) {
        throw new Error('new-text must not be empty');
    }

    const normalizedId = id === undefined || id === null ? '' : String(id).trim();
    if (!BACKLOG_LABEL_RE.test(normalizedId)) {
        throw new Error(`invalid backlog id: ${normalizedId}`);
    }

    const beginMarker = '<!-- BEGIN_BACKLOG -->';
    const endMarker = '<!-- END_BACKLOG -->';
    const bodyStart = markdown.indexOf(beginMarker) + beginMarker.length;
    const bodyEnd = markdown.indexOf(endMarker, bodyStart);
    const body = markdown.slice(bodyStart, bodyEnd);
    const matches = [];
    const linePattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
    let lineMatch;
    while ((lineMatch = linePattern.exec(body)) !== null) {
        if (lineMatch[0] === '') break;
        const fullLine = lineMatch[0];
        const eolLength = fullLine.endsWith('\r\n') ? 2 : /[\r\n]$/.test(fullLine) ? 1 : 0;
        const line = fullLine.slice(0, fullLine.length - eolLength);
        const storedId = extractBacklogId(line);
        if (storedId && storedId.toLowerCase() === normalizedId.toLowerCase()) {
            matches.push({
                id: storedId,
                line,
                start: bodyStart + lineMatch.index,
            });
        }
    }

    if (matches.length === 0) {
        throw new Error(`backlog id not found: ${normalizedId}`);
    }
    if (matches.length > 1) {
        throw new Error(`ambiguous backlog id (multiple IDs): ${normalizedId}`);
    }

    const target = matches[0];
    const checkbox = target.line.trim().match(/^- \[([ xX])\]/);
    if (!checkbox || checkbox[1].toLowerCase() === 'x') {
        throw new Error(`backlog id is not pending: ${normalizedId}`);
    }

    const payload = target.line.match(/^(\s*- \[[ xX]\]\s*\[[A-Za-z0-9_-]{1,32}\])([ \t]+)(.*)$/);
    if (!payload) {
        throw new Error(`active_context invalid backlog payload: ${normalizedId}`);
    }
    const payloadStart = target.start + payload[1].length + payload[2].length;
    const payloadEnd = target.start + target.line.length;
    const resultLine = target.line.slice(0, payload[1].length + payload[2].length) + text;
    const result = { id: target.id, line: resultLine };

    if (payload[3] === text) {
        return result;
    }

    const candidateMarkdown = markdown.slice(0, payloadStart) + text + markdown.slice(payloadEnd);
    const candidateValidation = validateActiveContextMarkdown(candidateMarkdown);
    if (!candidateValidation.valid) {
        throw new Error(`active_context invalid: ${candidateValidation.errors.join('; ')}`);
    }

    fs.writeFileSync(ACTIVE_CONTEXT_PATH, candidateMarkdown, 'utf8');
    appendLog('CONTEXT_EDIT', resultLine);
    return result;
}
```

Add `editBacklogTask` to the exported object immediately after `addTask` so both mirrors expose the same interface.

- [ ] **Step 4: Run the service acceptance cycle and prove GREEN**

Run:

```bash
node ./.evo-lite/cli/test.js integration
```

Expected: exit `0`, including `✅ 2e context edit service contract passed`.

- [ ] **Step 5: Prove live/template parity for the two changed pairs**

Run:

```bash
git diff --no-index -- .evo-lite/cli/memory.service.js templates/cli/memory.service.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
```

Expected: both commands exit `0` with no diff.

- [ ] **Step 6: Review scope and commit the service slice**

Run GitNexus `detect_changes(scope: "all", worktree: "C:/Users/uwenc/.codex/worktrees/eebc/create-evo-lite")`. Expected: only the new service symbol and integration coverage; `validateActiveContextMarkdown` is referenced, not changed.

Then run:

```bash
git diff --check
git status --short
git add .evo-lite/cli/memory.service.js templates/cli/memory.service.js .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git commit -m "feat(context): edit pending backlog text safely"
```

Expected staged surface: exactly the two service files and two integration files.

---

### Task 2: Nested CLI Surface and End-to-End Rejection Contract

**Files:**
- Modify: `templates/cli/test/integration.js:1085-1110`
- Modify: `.evo-lite/cli/test/integration.js:1085-1110`
- Modify: `templates/cli/memory.js:94-99,356-374,699-712`
- Modify: `.evo-lite/cli/memory.js:94-99,356-374,699-712`

**Interfaces:**
- Consumes: `editBacklogTask(id, newText) -> { id, line }` from Task 1.
- Produces: exactly one nested Commander registration, `context edit <id> <new-text>`, routed through `runContextCommand('edit', newText, { id })`.

- [ ] **Step 1: Add failing CLI end-to-end tests to both integration mirrors**

Insert this block after the current command-surface parsing assertions. It invokes the real CLI entry point so missing arguments, extra arguments, aliases, and unknown options are tested by Commander rather than by a duplicate parser in the test.

```js
console.log('3e. Testing context edit CLI surface ...');
{
    const cliRuntime = createTempRuntimeRoot('backlog-edit-cli');
    const contextPath = path.join(cliRuntime.runtimeRoot, 'active_context.md');
    const initial = fs.readFileSync(contextPath, 'utf8').replace(
        /<!-- BEGIN_BACKLOG -->[\s\S]*?<!-- END_BACKLOG -->/,
        '<!-- BEGIN_BACKLOG -->\n- [ ] [Cli1] before CLI edit\n<!-- END_BACKLOG -->'
    );
    fs.writeFileSync(contextPath, initial, 'utf8');
    const cliEnv = {
        ...process.env,
        EVO_LITE_ROOT: cliRuntime.runtimeRoot,
        EVO_LITE_CACHE_DIR: SHARED_CACHE_DIR,
        EVO_LITE_SKIP_GIT_GUARD: '1',
        EVO_LITE_MEMORY_ENGINE: 'sqlite-fts5-trigram',
    };
    const spawnCli = (args, input) => childProcess.spawnSync(
        process.execPath,
        [path.join(CLI_DIR, 'memory.js'), ...args],
        { cwd: cliRuntime.workspaceRoot, env: cliEnv, encoding: 'utf8', input }
    );

    const success = spawnCli(['context', 'edit', 'cli1', '[BLOCKED] CLI replacement']);
    assert.strictEqual(success.status, 0, `${success.stdout}\n${success.stderr}`);
    assert.ok(
        fs.readFileSync(contextPath, 'utf8').includes('- [ ] [Cli1] [BLOCKED] CLI replacement'),
        'nested context edit did not persist the replacement'
    );

    const unchanged = fs.readFileSync(contextPath);
    const rejected = [
        { args: ['edit', 'cli1', 'alias'], label: 'top-level alias' },
        { args: ['context', 'edit', 'cli1', 'value', '--content', 'other'], label: '--content' },
        { args: ['context', 'edit', 'cli1', 'value', '--file', 'task.md'], label: '--file' },
        { args: ['context', 'edit', 'cli1', 'one', 'two'], label: 'extra/batch argument' },
    ];
    for (const testCase of rejected) {
        const result = spawnCli(testCase.args);
        assert.notStrictEqual(result.status, 0, `${testCase.label} must be rejected`);
        assert.deepStrictEqual(fs.readFileSync(contextPath), unchanged, `${testCase.label} mutated active_context`);
    }
    const stdinOnly = spawnCli(['context', 'edit', 'cli1'], 'stdin replacement');
    assert.notStrictEqual(stdinOnly.status, 0, 'stdin must not satisfy missing <new-text>');
    assert.deepStrictEqual(fs.readFileSync(contextPath), unchanged, 'stdin rejection mutated active_context');
    console.log('✅ 3e context edit CLI surface passed');
}
```

- [ ] **Step 2: Run the integration suite and prove RED**

Run:

```bash
node ./.evo-lite/cli/test.js integration
```

Expected: non-zero because `context edit` is not registered. The successful nested case should report an unknown command or argument error; do not weaken the assertion.

- [ ] **Step 3: Register and route the nested command in both CLI mirrors**

Update the static context help summary from `(track, add, focus)` to `(track, add, edit, focus)`.

Add this branch after `add` and before `focus` in `runContextCommand`:

```js
if (op === 'edit') {
    console.log(memoryService.editBacklogTask(options.id, text));
    return;
}
```

Register the command after `context add` and before `context focus`. Do not wrap it in `withTextSourceOptions` and do not register a corresponding top-level command:

```js
contextCommand.command('edit <id> <new-text>')
    .description('Replace the text of an existing pending backlog item.')
    .action(async (id, newText) => {
        await runContextCommand('edit', newText, { id });
    });
```

- [ ] **Step 4: Run the CLI acceptance cycle and prove GREEN**

Run:

```bash
node ./.evo-lite/cli/test.js integration
```

Expected: exit `0`, including both `✅ 2e context edit service contract passed` and `✅ 3e context edit CLI surface passed`.

- [ ] **Step 5: Verify the public help and rejected surfaces manually**

Run:

```bash
node ./.evo-lite/cli/memory.js context --help
node ./.evo-lite/cli/memory.js edit --help
node ./.evo-lite/cli/memory.js context edit 3d78 value --content other
```

Expected:

- nested help lists `edit <id> <new-text>`;
- the top-level `edit` command exits non-zero;
- `--content` exits non-zero;
- none of these commands modify the repository's active context (use a test runtime for any valid edit invocation).

- [ ] **Step 6: Run full regression and parity gates**

Run:

```bash
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
git diff --no-index -- .evo-lite/cli/memory.service.js templates/cli/memory.service.js
git diff --no-index -- .evo-lite/cli/memory.js templates/cli/memory.js
git diff --no-index -- .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git diff --check
```

Expected: all test commands exit `0`; all three parity checks exit `0` with no output; `git diff --check` is clean.

- [ ] **Step 7: Review scope and commit the CLI slice**

Run GitNexus `detect_changes(scope: "all", worktree: "C:/Users/uwenc/.codex/worktrees/eebc/create-evo-lite")`. Review every affected process; stop if the changed-file surface exceeds the frozen three live/template pairs.

Then run:

```bash
git status --short
git add .evo-lite/cli/memory.js templates/cli/memory.js .evo-lite/cli/test/integration.js templates/cli/test/integration.js
git commit -m "feat(context): expose pending backlog edit command"
```

Expected staged surface: exactly the two CLI files and the already-paired integration files. Do not amend, squash, or rebase the Task 1 commit.

---

## Final Verification Gate

This gate creates no commit. Run it after Task 2 is committed and before requesting implementation review:

```bash
git status --short
git diff --check f46ec8a899c86b73bef7ac146e873aab6306c1d7..HEAD
git diff --name-only f46ec8a899c86b73bef7ac146e873aab6306c1d7..HEAD
node ./.evo-lite/cli/test.js integration
node ./.evo-lite/cli/test.js governance
node ./.evo-lite/cli/test.js
node ./.evo-lite/cli/memory.js context validate
```

Required result:

```text
worktree                         clean
runtime/test changed files       exactly 6 (three live/template pairs)
plan document changes            exactly 1
total changed files              exactly 7 relative to f46ec8a
whole branch files               exactly 8 relative to main@bd0e526
product source changes           0
active_context changes           0
live/template parity             PASS for all three pairs
service acceptance               PASS
CLI surface acceptance           PASS
governance suite                 PASS
full suite                       PASS
context validate                 PASS
```

Run GitNexus `detect_changes(scope: "compare", base_ref: "f46ec8a899c86b73bef7ac146e873aab6306c1d7", worktree: "C:/Users/uwenc/.codex/worktrees/eebc/create-evo-lite")` and retain its risk/process summary with the review evidence. If any command changes tracked files or any unexpected process/file appears, stop and investigate before requesting review.

Implementation completion does not authorize Ready, merge, branch deletion, active-context mutation, or backlog resolution; each remains a separate gate.
