---
id: plan:r011-closure-router
status: draft
created: 2026-08-15
linkedSpec: spec:r011-closure-router
---

# R011 Closure Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop R011 from deciding whether a spec may be closed, and make it render the verdict the verification contract already produces.

**Architecture:** A thin `readinessOf()` is extracted from `previewClose()` so the authoritative readiness computation has one home. R011 gains a project root and an observation sink, calls `readinessOf()`, and maps its answer into one of four finding types. R011 computes no verdict of its own; an observation failure retains the finding, degrades the census and suppresses all closure advice.

**Tech Stack:** Node >= 20, CommonJS only, no ESM. No new dependencies.

**Frozen design:** `docs/superpowers/specs/2026-08-15-r011-closure-router-design.md` at `494b20c`. Where this plan and the spec disagree, the spec wins — stop and report rather than resolving it yourself.

**Revision:** supersedes the `e19c949` draft, which was reviewed CHANGES REQUIRED (5 Important, 2 Minor). Every change is recorded in `## What changed since e19c949` at the end.

## Global Constraints

- **Double mirror.** `templates/cli/**` is the source; `.evo-lite/cli/**` is the live mirror. Every changed file must end up byte-identical in both. Copy source → live, never the reverse.
- **Mirror before running the suite.** A mirror-asymmetric tree makes `verify` report `templateSync: out-of-sync`, which sets an early alert and deterministically reddens an unrelated test hundreds of blocks earlier. This has cost this project several wasted runs. Mirror even for a throwaway experiment.
- **Verification is the full suite, no scope argument:** `node .evo-lite/cli/test.js`. Run it ALONE — two concurrent runs writing one log produced a garbage count before. Count blocks with `grep -c "^✅"`. The baseline at plan time is **439**, and each task below adds exactly one block. Count it yourself and report the number you measured; never repeat a count from a prior report.
- **`node .evo-lite/cli/test.js integration` is not a runnable scope.** `shouldRun` accepts only `governance` and the default `all`; anything else exits 1 with `Unknown test scope`. Use `governance` for inner-loop feedback if you like; report the full run.
- **CI runs Node 20, 22 and 24 on Ubuntu and Windows** (`.github/workflows`, minus the windows+node20 exclusion). No test and no fingerprint input may depend on a V8-internal string or on a generated artifact that only exists on a developer's machine. Measured: `JSON.parse('{"a":1,}')` reports `Expected double-quoted property name in JSON at position 7 (line 1 column 8)` on Node 22 — engine prose, with an offset, not a contract.
- **`mem close` takes a FILESYSTEM PATH, not a spec id.** Measured: `close-commands.js:34` declares `close <spec>` and passes the argument straight to `previewClose(specPath)`, whose first statement is `fs.readFileSync(specPath, 'utf8')`. There is no `spec:<slug>` → path resolver anywhere on that path. Any advice string this plan produces must use `spec.sourcePath`.
- **No commit message may contain backticks inside a double-quoted `-m` argument.** Bash executes them as command substitution and silently empties them. Use a heredoc: `git commit -F -` with `<<'EOF'`.
- **`git checkout -- <file>` destroys uncommitted work.** To restore after a mutation experiment, copy the file aside first and copy it back. This has destroyed work twice on this project.
- **Do not set focus or touch `.evo-lite/active_context.md`.** If a commit message names a `plan:<slug>` or `spec:<slug>`, post-commit auto-advance may overwrite the human's focus. Prefix such commits with `EVO_LITE_NO_FOCUS_AUTOADVANCE=1`.
- **`ruleVersion` may never lag the semantics inside a single commit.** Every commit runs a real post-commit governance pass. A commit that ships new R011 claim semantics and new `factInputs` while `PLANNING_RULE_VERSIONS.R011` is still `1` publishes a state `ruleVersion` exists to forbid, even on a repo that currently holds no dispositions.
- **Presence evidence is display context only.** Git refs, linked files, archive hits and checkboxes may never enter state selection and may never enter `factInputs`. No fourth evidence evaluator may be written — presence is read from `progress.js`'s existing `evaluateTask`, and its `confidence` band is never read.
- **Each task proves its own guards.** The mutations belonging to a task run inside that task, before its commit. Task 5 consolidates the report; it is not where a guard is first shown to bear load.
- **Out of scope, do not touch:** `parse-markdown.js`'s checkbox→plan-status promotion (`[a8a8]`), the three disagreeing archive-evidence mechanisms, `validateGitRef`'s fail-open catch, `loadArchiveEvidenceMap`'s swallow, `takeover-session.js`, `spec:disposition-ledger`'s invalid contract, `mem verify`, and every other known debt.

## Canonical vocabularies

Three vocabularies exist. Each has exactly one home. **Do not invent a fourth spelling, and do not use one vocabulary in another's place.**

| layer | values | where |
|---|---|---|
| authority | `READY` / `BLOCKED` / `NO-CONTRACT` | `readinessOf()` and `previewClose()` — existing, unchanged |
| finding type | `spec-closure-ready` / `spec-closure-not-ready` / `spec-closure-uncontracted` / `spec-closure-unobservable` | R011 findings |
| fact input | `ready` / `not-ready` / `uncontracted` / `unobservable` | `factInputs.closureState` |

`closureState` is derived from the finding type by one function, `r011ClosureState(type)`, used by **all four** states including `unobservable`. No call site may hand-write the string — two places that happen to agree today are not an identity contract. The spec's prose example writes `NOT_READY`; **this plan overrides that spelling with `not-ready`.** The design semantics are unchanged.

## File Structure

| file | responsibility | change |
|---|---|---|
| `templates/cli/verification/close-preview.js` | owns the authoritative readiness computation | gains `readinessOf()`; `previewClose()` delegates to it and is otherwise behaviourally unchanged |
| `templates/cli/planning/gaps.js` | emits planning drift findings | `checkR011` gains a project root, options and an observation sink, calls `readinessOf()`, maps to four types, carries the new `factInputs`; `PLANNING_RULE_VERSIONS.R011` → 2 |
| `templates/cli/planning/progress.js` | owns the per-task evidence evaluation | **additive export only** — `evaluateTask` joins `module.exports`. No logic change. |
| `templates/cli/verification/validate-contract.js` | owns contract parsing and validation | **additive returns only** — `parseSpecCriteria` also returns the raw block text, `loadValidatedContract` propagates it as `contractSource`. No validation logic change, no new failure codes. **Ratification required — see below.** |
| `templates/cli/test/governance.js` | governance test suite | all new tests; T26b updated |

Mirrors of the first four under `.evo-lite/cli/` change identically.

### Two file-set expansions, and their standing

**`progress.js` — decided at plan level, no ratification needed.** The frozen spec says presence evidence "must be read from a surface that already exists; the implementation must not author a fourth evidence evaluator to obtain it. **Which existing surface is a plan-level choice.**" This plan chooses `evaluateTask`, because it already owns this project's definition of *positive evidence*. Re-deriving that boolean inside `gaps.js` would install a second, weaker authority over a question that already has a designed one — the exact defect this whole item exists to remove. Only its structured `evidence` fields are read; `confidence` is not, and the bands stay in `progress.js` as the spec requires.

**`validate-contract.js` — RATIFICATION REQUIRED BEFORE TASK 4.** Tasks 1-3 and 5 do not touch it; Task 4 does. See the next section. Tasks 1, 2, 3 may be authorized and executed while this ruling is outstanding.

## Pending ratification — the malformed-contract identity (blocks Task 4 only)

AC7 requires a stable validation-failure identity for a malformed contract. The frozen design suggests the input: *"a digest or equivalent over the validation findings"*. It also states two properties in the same sentence:

- an edit that leaves the contract **broken differently** must lapse the decision;
- an edit that only changes the **error wording** must not.

Measured against the current source, those two cannot both be satisfied from the validation findings, because a finding is `{ id, level, message }` and nothing else (`validate-contract.js:11`), and the discriminating information lives only in `message`:

| invalid class | finding id | what actually differs |
|---|---|---|
| bad frontmatter `id` | `id` | the rejected value, in the message |
| bad `linkedPlan` | `linkedPlan` | the rejected value, in the message |
| unterminated / malformed JSON | `contract` | V8's parser prose **and offset**, in the message |
| criterion-level failures | criterion id | the rule that failed, in the message |

So a digest over finding **ids** collapses every JSON malformation to `contract` — the AC7 violation. A digest over finding **messages** discriminates correctly but makes decision identity depend on V8's `JSON.parse` prose, which is engine-internal and carries a character offset, on a project whose CI runs three Node majors. That is the *"lapses a decision for no reason"* failure the same spec sentence forbids.

**This is a gap in the frozen contract, not an implementation choice, so it is not mine to close.** The two options:

| | Option 1 — digest the findings | Option 2 — digest the cause (recommended) |
|---|---|---|
| input | `{id, message}` pairs | frontmatter `id` + `linkedPlan` + raw criteria block text + sorted finding ids |
| broken-differently lapses | ✅ | ✅ |
| wording-only change is invisible | ❌ | ✅ |
| engine-independent | ❌ | ✅ |
| file set | unchanged | `validate-contract.js` gains two additive return fields |
| over-lapse | none | a whitespace edit inside a still-broken block lapses the decision — conservative direction |

Option 2 needs **no new failure codes** — `parseSpecCriteria` already computes the block text and simply does not return it. Task 4 below is written against Option 2. **If the ruling is Option 1, Task 4's Step 3 must be rewritten before dispatch; do not let an implementer choose.**

---

### Task 1: Extract `readinessOf` from `previewClose`

**Files:**
- Modify: `templates/cli/verification/close-preview.js`
- Modify: `.evo-lite/cli/verification/close-preview.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/verification/close-preview.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac6

**Interfaces:**
- Produces: `readinessOf(specPath, opts) -> { readiness, contractStatus, contractPresent, criteria, blockers }` where `readiness` is `'READY' | 'BLOCKED' | 'NO-CONTRACT'` and `contractStatus` is `'valid' | 'invalid' | 'absent'`. It MAY THROW. `opts` accepts `{ root, statusFn }` with the same meanings `previewClose` already gives them.

This is a pure refactor. `previewClose`'s outward behaviour must not change, and its existing tests T38 (`previewClose readiness (READY/BLOCKED/NO-CONTRACT)`) and T39 (`previewClose is read-only`) are the regression net. If either goes red, the refactor is wrong — do not adjust those tests.

Two things stay behind in `previewClose` on purpose:

- **the note prose.** `readinessOf` is an authority accessor, not closure UX. Strings like *"…or close manually"* are advice, and a future consumer that acquires the authority must not inherit them by accident. `readinessOf` returns `contractStatus`; `previewClose` maps that back to its own historical `note` text, unchanged to the character.
- **the `actions` asymmetry.** The invalid-contract branch returns `actions` populated; the no-contract branch returns `actions: []`. `actions` stays in `previewClose`; `readinessOf` never computes it.

- [ ] **Step 1: Write the failing test**

Add to `templates/cli/test/governance.js`, immediately after the existing T38 block:

```js
        console.log('T38a. readinessOf answers readiness alone, and previewClose still agrees with it ...');
        {
            const cp = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));
            assert.strictEqual(typeof cp.readinessOf, 'function', 'readinessOf must be exported');

            const root = createTempRuntimeRoot('readiness-of').workspaceRoot;
            const specDir = path.join(root, 'docs', 'specs');
            const writeSpec = (name, criteriaJson) => {
                const p = path.join(specDir, name);
                writeText(p, ['---', `id: spec:${name.replace(/\.md$/, '')}`, 'status: draft', '---', '',
                    '# S', '', '## Acceptance Criteria', '', '```json', criteriaJson, '```', ''].join('\n'));
                return p;
            };
            const oneCmd = JSON.stringify({ criteria: [{ id: 'ac-1', description: 'd',
                dependsOn: ['x'], verifier: { type: 'command', params: { cmd: 'true' } } }] }, null, 2);

            const readyPath = writeSpec('ready.md', oneCmd);
            const r = cp.readinessOf(readyPath, { root, statusFn: () => [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }] });
            assert.strictEqual(r.readiness, 'READY', 'all-PASS is READY');
            assert.strictEqual(r.contractStatus, 'valid', 'a well-formed criteria block is a valid contract');
            assert.strictEqual(r.contractPresent, true, 'a criteria block means a contract is present');

            const blockedPath = writeSpec('blocked.md', oneCmd);
            const b = cp.readinessOf(blockedPath, { root, statusFn: () => [{ criterionId: 'ac-1', verdict: 'FAIL', detail: 'd' }] });
            assert.strictEqual(b.readiness, 'BLOCKED', 'a non-PASS verdict is BLOCKED');
            assert.deepStrictEqual(b.blockers.map(x => x.criterionId), ['ac-1'], 'the blocking criterion is named');

            const nonePath = writeSpec('none.md', JSON.stringify({ criteria: [] }));
            const n = cp.readinessOf(nonePath, { root, statusFn: () => [] });
            assert.strictEqual(n.readiness, 'NO-CONTRACT', 'an empty criteria block is NO-CONTRACT');
            assert.strictEqual(n.contractStatus, 'absent', 'and it reports no contract, not an invalid one');
            assert.strictEqual(n.contractPresent, false);

            // The authority accessor carries no closure UX. previewClose keeps its
            // own note, so a future consumer cannot inherit "close manually" advice
            // simply by acquiring the authoritative verdict.
            for (const res of [r, b, n]) {
                assert.ok(!/close manually|criteria block for a real gate/.test(JSON.stringify(res)),
                    'FORBIDDEN: readinessOf carrying previewClose note prose');
            }

            // THE REFACTOR PROPERTY: previewClose must not have drifted from the
            // function it now delegates to. If these ever disagree, previewClose
            // has grown a second readiness opinion — which is the defect this
            // whole change removes, reappearing one layer down.
            const planStateFn = () => ({ planId: 'plan:t', found: false, tasksTotal: 0, tasksImplemented: 0, uncheckedBoxes: 0 });
            for (const [label, sp, verdicts] of [
                ['READY', readyPath, [{ criterionId: 'ac-1', verdict: 'PASS', detail: 'd' }]],
                ['BLOCKED', blockedPath, [{ criterionId: 'ac-1', verdict: 'FAIL', detail: 'd' }]],
                ['NO-CONTRACT', nonePath, []],
            ]) {
                const viaPreview = cp.previewClose(sp, { root, planStateFn, statusFn: () => verdicts });
                const viaReadiness = cp.readinessOf(sp, { root, statusFn: () => verdicts });
                assert.strictEqual(viaPreview.readiness, viaReadiness.readiness,
                    `${label}: previewClose and readinessOf must never disagree about readiness`);
            }
            console.log('✅ T38a readinessOf extraction');
        }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL on `readinessOf must be exported`.

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/verification/close-preview.js`, add `readinessOf` above `previewClose`:

```js
// The authoritative closure readiness, and nothing else. Split out of
// previewClose so a consumer that only needs the verdict — R011 — does not
// have to touch plan state or the mutation action list to get it.
//
// It returns contractStatus rather than prose: an authority accessor states
// what is true, and leaves how to phrase the next step to its caller.
//
// It deliberately does NOT catch. An unreadable evidence store must reach the
// caller: this function cannot know whether its caller wants to fail a command
// or degrade a census, and guessing would turn "I could not look" into "there
// is nothing there" — the exact impersonation this project forbids.
function readinessOf(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const specText = fs.readFileSync(specPath, 'utf8');
    const contract = loadValidatedContract(specText);
    const typeById = {};
    for (const c of contract.criteria) typeById[c.id] = c.verifier && c.verifier.type;

    if (!contract.ok) {
        return {
            readiness: 'BLOCKED', contractStatus: 'invalid', contractPresent: true, criteria: [],
            blockers: contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', remedy: f.message })),
        };
    }
    if (contract.noContract) {
        return {
            readiness: 'NO-CONTRACT', contractStatus: 'absent', contractPresent: false,
            criteria: [], blockers: [],
        };
    }

    const statusFn = opts.statusFn || function (sp) { return require('./engine').statusSpec(sp, { root }); };
    const verdicts = statusFn(specPath);
    const blockers = verdicts.filter(v => v.verdict !== 'PASS').map(v => ({
        criterionId: v.criterionId, verdict: v.verdict, remedy: remedyFor(v.verdict, typeById[v.criterionId]),
    }));
    return {
        readiness: blockers.length ? 'BLOCKED' : 'READY',
        contractStatus: 'valid', contractPresent: true, criteria: verdicts, blockers,
    };
}
```

Then replace `previewClose`'s three readiness returns with delegation. Its head — the specText read, the frontmatter parse, `planState`, `actions` and `warnings` — is unchanged up to and including the `if (totalTasks > 0) actions.push(...)` line. Everything from `// Malformed contract (present but invalid)` to the end of the function becomes:

```js
    const r = readinessOf(specPath, { root, statusFn: opts.statusFn });

    // The note is previewClose's own voice, kept verbatim. readinessOf reports
    // contractStatus; phrasing the operator's next step is not an authority's job.
    // NO-CONTRACT also keeps its historical empty action list while the invalid
    // branch keeps its populated one — preserved deliberately, T38 pins it.
    if (r.contractStatus === 'absent') {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions: [], warnings,
            note: 'no machine-readable acceptance criteria — add a criteria block for a real gate, or close manually' };
    }
    if (r.contractStatus === 'invalid') {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions, warnings,
            note: 'contract is invalid — fix the criteria block (mem verify-contract lint <spec>)' };
    }
    return { readiness: r.readiness, criteria: r.criteria, plan: planState,
        blockers: r.blockers, actions, warnings };
}
```

**Copy both note strings from the current source character-for-character.** T38 compares them; a re-typed near-miss is a silent behaviour change.

Add `readinessOf` to the exports:

```js
module.exports = { previewClose, readinessOf, remedyFor, defaultPlanState, defaultPlanStates };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/verification/close-preview.js .evo-lite/cli/verification/close-preview.js
node .evo-lite/cli/test.js
```

Expected: PASS, 440 blocks. T38 and T39 must both still pass — they are the proof that `previewClose` did not change.

- [ ] **Step 5: Prove the delegation is real (mutation M0)**

The cross-assertion in T38a only shows the two agree. This shows they are the *same computation*: if `previewClose` had quietly kept its own copy, mutating `readinessOf` would leave T38 green.

Copy `close-preview.js` aside first — **never restore with `git checkout --`.**

Mutation: in `readinessOf`, change the final readiness to `readiness: 'READY'` unconditionally.

Must turn red on **T38**'s BLOCKED assertion (the pre-existing test), not only on T38a. A red confined to T38a means `previewClose` is not delegating and Task 1 has failed its purpose. Restore, confirm the sha256 matches the pre-mutation copy, re-run the suite green, and record the result in the task report.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/close-preview.js .evo-lite/cli/verification/close-preview.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
refactor(verification): give the authoritative readiness computation one home

readinessOf() computes contract load and criteria verdicts and nothing else.
previewClose() delegates to it and keeps its outward behaviour, pinned by its
existing T38 and T39 — and by a mutation showing that breaking readinessOf
reddens T38, which is only possible if the delegation is real.

It returns contractStatus rather than note prose: an authority accessor states
what is true and leaves the operator's next step to its caller.

It deliberately does not catch: an unreadable evidence store must reach the
caller, because this function cannot know whether the caller wants to fail a
command or degrade a census.
EOF
```

---

### Task 2: R011 becomes a router — four types, four levels, and version 2 in the same commit

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Modify: `templates/cli/planning/progress.js` (additive export only)
- Modify: `.evo-lite/cli/planning/progress.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/planning/gaps.js, templates/cli/planning/progress.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac1, ac2, ac3, ac4

**Interfaces:**
- Consumes: `readinessOf(specPath, opts)` from Task 1.
- Produces: `checkR011(projectRoot, planIR, options, observation)`. `options` accepts `{ readinessFn, evidenceFn }`; both default to the real implementations, and both exist so the four states can be tested as properties instead of by constructing evidence stores. The `observation` sink is used in Task 3 — accept and ignore it here.
- Produces: `r011ClosureState(type)`, used by every state including Task 3's.
- Produces (from `progress.js`): `evaluateTask(task, projectRoot)`, unchanged, now exported.

`checkR011`'s candidate detection is unchanged: a spec is a candidate when it is not already `done` and every linked plan has at least one task and all its tasks are `readOnly` or `implemented`. Checkboxes decide only that a spec is **worth checking**.

`PLANNING_RULE_VERSIONS.R011` goes to `2` **here**, not in Task 4. This commit changes both the claim semantics and `factInputs`; shipping it under version 1 would publish exactly the state `ruleVersion` exists to prevent, and every commit triggers a real post-commit governance pass.

- [ ] **Step 1: Write the failing test**

Add to `templates/cli/test/governance.js`:

```js
        console.log('T-r011-router. R011 renders the authoritative verdict and never invents one ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            assert.strictEqual(gaps.PLANNING_RULE_VERSIONS.R011, 2,
                'R011 ruleVersion must bump in the SAME commit as the semantics change — new claims '
                + 'published under the old version are what ruleVersion exists to prevent');

            const root = createTempRuntimeRoot('r011-router').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: draft', '---', '', '# S', ''].join('\n'));
            const ir = {
                version: 'evo-plan-ir@1',
                specs: [{ id: 'spec:u', status: 'draft', sourcePath: 'docs/specs/u.md' }],
                plans: [{ id: 'plan:u', status: 'draft', linkedSpec: 'spec:u' }],
                tasks: [
                    { id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: ['a.js'], evidence: [] },
                    { id: 'task:u2', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [], evidence: [] },
                ],
                warnings: [],
            };
            const evidenceFn = (task) => ({
                id: task.id,
                evidence: {
                    gitRefs: task.id === 'task:u1' ? [{ ref: 'git:abc', valid: true }] : [],
                    linkedFilesTotal: (task.linkedFiles || []).length,
                    linkedFilesExist: (task.linkedFiles || []).length,
                    linkedFilesRatio: 1, archiveHits: 0,
                },
            });
            const r011 = (readiness, blockers) => gaps.checkR011(root, ir, {
                readinessFn: () => ({ readiness, blockers: blockers || [],
                    contractStatus: readiness === 'NO-CONTRACT' ? 'absent' : 'valid',
                    contractPresent: readiness !== 'NO-CONTRACT' }),
                evidenceFn,
            }, null);

            const ready = r011('READY')[0];
            assert.strictEqual(ready.type, 'spec-closure-ready', 'READY maps to spec-closure-ready');
            assert.strictEqual(ready.level, 'info', 'ready is good news, not an alert');
            assert.strictEqual(ready.dispositionable, false,
                'ready is positive routing information — accepted-debt has no meaning against it');
            assert.match(ready.suggestedAction, /mem close docs\/specs\/u\.md --preview/,
                'ready routes to the close transaction with the argument the CLI actually accepts: a PATH');
            assert.ok(!/mem close spec:/.test(ready.suggestedAction),
                'FORBIDDEN: mem close <spec-id> — close-commands passes the argument straight to '
                + 'fs.readFileSync, so an id produces ENOENT, not a preview');

            const notReady = r011('BLOCKED', [{ criterionId: 'ac-1', verdict: 'FAIL' }])[0];
            assert.strictEqual(notReady.type, 'spec-closure-not-ready', 'BLOCKED maps to spec-closure-not-ready');
            assert.strictEqual(notReady.level, 'warning');
            assert.strictEqual(notReady.dispositionable, true, 'a blocked spec is a real governance fact');
            assert.match(notReady.message, /ac-1/, 'the blocking criterion is named for the operator');

            const unc = r011('NO-CONTRACT')[0];
            assert.strictEqual(unc.type, 'spec-closure-uncontracted', 'NO-CONTRACT maps to spec-closure-uncontracted');
            assert.strictEqual(unc.level, 'warning');
            assert.strictEqual(unc.dispositionable, true);

            // Presence evidence appears as DISPLAY CONTEXT and nowhere else: the
            // task with no files and no git refs is named, the one with evidence
            // is not, and neither reaches factInputs.
            assert.match(unc.message, /task:u2/, 'the unevidenced task is named for the human');
            assert.ok(!/task:u1/.test(unc.message), 'a task with evidence is not listed as unevidenced');
            assert.ok(!/task:u1|task:u2|linkedFiles|archiveHits|confidence/.test(JSON.stringify(unc.factInputs)),
                'FORBIDDEN: presence evidence in factInputs — a file appearing on disk would lapse a '
                + 'human decision about a criterion that has not moved');

            // closureState is DERIVED, never hand-written.
            assert.strictEqual(typeof gaps.r011ClosureState, 'function', 'r011ClosureState must be exported');
            for (const f of [ready, notReady, unc]) {
                assert.strictEqual(f.factInputs.closureState, gaps.r011ClosureState(f.type),
                    `${f.type}: closureState must come from r011ClosureState, not a hand-picked synonym`);
            }

            // THE PROPERTY THE WHOLE CHANGE EXISTS FOR: no state may tell the
            // operator to hand-edit the frontmatter, because that routes around
            // the close transaction's lock, dirty-tree check, journal and rollback.
            for (const f of [ready, notReady, unc]) {
                assert.ok(!/status:\s*done/.test(f.suggestedAction),
                    `FORBIDDEN: ${f.type} recommends hand-editing status: done — the bypass this change removes`);
            }
            assert.ok(!/mem close/.test(unc.suggestedAction),
                'uncontracted must not point at a command that would refuse it — close-apply rejects anything not READY');
            console.log('✅ T-r011-router passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL on the `PLANNING_RULE_VERSIONS.R011` assertion, then on the signature — `checkR011` currently takes `(planIR)`, so `root` arrives where `planIR` is expected.

- [ ] **Step 3: Write minimal implementation**

First, in `templates/cli/planning/progress.js`, export the existing evaluator. **No logic change:**

```js
module.exports = { evaluateTask, evaluateProgress, writeProgressReport, checkArchiveHits };
```

Then replace `checkR011`'s signature and finding construction in `templates/cli/planning/gaps.js`. The candidate loop above it is unchanged.

```js
// R011 is a closure ROUTER, not a closure judge.
//
// It used to read `t.status === 'implemented'` — a hand-ticked checkbox — and
// tell the operator to set `status: done`. close-preview.js had already ruled
// that task completion is "Advisory only — NEVER affects readiness", so R011
// was a second, weaker authority over a question that already had a designed
// one, recommending the exact terminal act that ruling governs.
//
// Checkboxes now decide one thing only: that a spec is worth CHECKING. The
// verdict comes from readinessOf(), which R011 renders and never recomputes.
const R011_TYPE_BY_READINESS = Object.freeze({
    'READY': 'spec-closure-ready',
    'BLOCKED': 'spec-closure-not-ready',
    'NO-CONTRACT': 'spec-closure-uncontracted',
});
// Frozen ARRAYS, not Sets — this repo has been bitten by Object.freeze(new Set())
// reporting frozen while add() still works. Lookup is .includes().
const R011_INFO_TYPES = Object.freeze(['spec-closure-ready']);
const R011_NON_DISPOSITIONABLE = Object.freeze(['spec-closure-ready', 'spec-closure-unobservable']);

// The one derivation. Every state goes through it, including unobservable:
// two hand-written strings that happen to agree are not an identity contract.
function r011ClosureState(type) {
    return String(type).replace(/^spec-closure-/, '');
}

function checkR011(projectRoot, planIR, options = {}, observation = null) {
```

Inside the candidate loop, replace the `findings.push({...})` block:

```js
        const readinessFn = options.readinessFn
            || ((sp) => require('../verification/close-preview').readinessOf(sp, { root: projectRoot }));
        const specPath = path.join(projectRoot, spec.sourcePath);
        const verdict = readinessFn(specPath, spec);

        const type = R011_TYPE_BY_READINESS[verdict.readiness];
        const blockerIds = (verdict.blockers || []).map(b => `${b.criterionId}=${b.verdict}`).sort();

        findings.push({
            id: `R011:${spec.id}`,
            rule: 'R011',
            scope: 'planning',
            level: R011_INFO_TYPES.includes(type) ? 'info' : 'warning',
            type,
            message: r011Message(spec, plans, type, blockerIds, r011Unevidenced(planIR, plans, projectRoot, options)),
            evidence: [spec.sourcePath],
            suggestedAction: r011Action(spec, type),
            dispositionable: !R011_NON_DISPOSITIONABLE.includes(type),
            factInputs: { closureState: r011ClosureState(type), blockers: blockerIds },
        });
```

Add the presence-evidence reader and the two renderers next to `checkR011`:

```js
// Presence evidence, for the operator's eyes only. It is read from the surface
// that already owns this project's definition of positive evidence — a second
// copy inside a drift rule would be the very "weaker second authority" this
// change exists to delete. The confidence band is deliberately NOT read: the
// spec keeps it in progress.js so a display heuristic cannot look authoritative.
//
// Best-effort by design. Presence never selects a state and never reaches
// factInputs, so failing to read it withholds context — it makes no claim about
// the spec, and must not degrade the census the way an unreadable READINESS does.
function r011Unevidenced(planIR, plans, projectRoot, options) {
    const evaluate = options.evidenceFn
        || ((task, root) => require('./progress').evaluateTask(task, root));
    const planIds = plans.map(p => p.id);
    const tasks = (planIR.tasks || []).filter(t => planIds.includes(t.linkedPlan));
    try {
        return tasks.filter(t => {
            const e = evaluate(t, projectRoot);
            if (!e || !e.evidence) return false;
            const validRefs = (e.evidence.gitRefs || []).filter(g => g && g.valid).length;
            return validRefs === 0 && !(e.evidence.linkedFilesTotal > 0 && e.evidence.linkedFilesExist > 0);
        }).map(t => t.id);
    } catch (_) {
        return null;   // null = "not read", distinct from [] = "read, none found"
    }
}

function r011EvidenceClause(unevidenced) {
    if (unevidenced === null) return ' (linked task evidence could not be read)';
    if (!unevidenced.length) return '';
    return ` — tasks with no evidence of their own: ${unevidenced.join(', ')}`;
}

function r011Message(spec, plans, type, blockerIds, unevidenced) {
    const shape = plans.length > 1
        ? `all ${plans.length} linked plans are checkbox-complete`
        : `linked plan ${plans[0].id} is checkbox-complete`;
    if (type === 'spec-closure-ready') {
        return `Spec ${spec.id} is [${spec.status}] and its acceptance contract is satisfied — ${shape}`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Spec ${spec.id} is [${spec.status}] and ${shape}, but its acceptance contract is not satisfied: `
            + `${blockerIds.join(', ')}${r011EvidenceClause(unevidenced)}`;
    }
    return `Spec ${spec.id} is [${spec.status}] and ${shape}, but has no machine-readable acceptance contract`
        + ` — checkbox state is not closure evidence${r011EvidenceClause(unevidenced)}`;
}

function r011Action(spec, type) {
    if (type === 'spec-closure-ready') {
        // A PATH, not an id: close-commands.js passes this argument straight to
        // fs.readFileSync. `mem close spec:foo --preview` is ENOENT, not a preview.
        return `Run the close transaction: mem close ${spec.sourcePath} --preview`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Resolve the failing criteria in ${spec.sourcePath}, then re-check readiness`;
    }
    return `Add or repair the acceptance criteria block in ${spec.sourcePath} so closure has an authoritative verdict`;
}
```

`spec-closure-ready` carries no evidence clause: a satisfied contract has already answered the question presence evidence was being consulted about.

Update the call site at the census (currently `...checkR011(planIR),`):

```js
        ...checkR011(projectRoot, planIR, options, observation),
```

Bump the version table and record why:

```js
// R011 is 2 because both its fact inputs and its claim semantics changed: it
// stopped asserting "this spec should be closed" from checkbox state and began
// reporting an authoritative closure verdict. The bump lapses every existing
// R011 disposition ONCE; every later change of fact is the fingerprint's job.
    R009: 1, R010: 1, R011: 2, R012: 1, R013: 1,
```

Export the derivation: `r011ClosureState` joins `module.exports` alongside `checkR011`.

**`planTaskStatuses` becomes dead.** Measured: `gaps.js:317` defines it and `gaps.js:584` is its only caller — the `factInputs` this task replaces. Delete the function in this commit and say so in the report.

- [ ] **Step 4: Update T26b — keep its invariants, change only what this task changes**

`T26b` (`templates/cli/test/governance.js:3367`) calls `checkR011(ir)` three times and asserts the legacy message wording. Update it to:

```js
            const stubReadiness = () => ({ readiness: 'NO-CONTRACT', blockers: [],
                contractStatus: 'absent', contractPresent: false });
            const run = (ir) => checkR011(WORKSPACE_ROOT, ir,
                { readinessFn: stubReadiness, evidenceFn: () => null }, null);
```

and replace each `checkR011(x)` with `run(x)`.

**These three assertions are load-bearing and must survive unchanged in meaning** — they pin the spec-grouping fix that removed duplicate `R011:<spec>` ids:

```
run(multi).length === 0   // an incomplete sibling plan suppresses the finding
run(single).length === 1
run(dup).length === 1     // one finding per SPEC, not one per complete plan
```

Only the legacy message assertion changes:

```js
            assert.ok(one[0].message.includes('linked plan plan:single-a is checkbox-complete'),
                'single-plan message keeps naming the plan, in the new router wording');
```

Report T26b as an intentionally modified test. Any *other* pre-existing test asserting R011's old `type: 'spec-status-drift'` or its old `factInputs` must be updated the same way — report every one you touch.

- [ ] **Step 5: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
cp templates/cli/planning/progress.js .evo-lite/cli/planning/progress.js
node .evo-lite/cli/test.js
```

Expected: PASS, 441 blocks.

- [ ] **Step 6: Run this task's mutations**

Copy each file aside before mutating and restore by copying back — **never `git checkout --`**. Confirm the restored sha256 matches, and re-run green between rows.

| # | mutation | must turn red on |
|---|---|---|
| M1 | map `'NO-CONTRACT'` to `'spec-closure-ready'` | `NO-CONTRACT maps to spec-closure-uncontracted` |
| M7 | restore `suggestedAction` for READY to `Update status in ${spec.sourcePath} to: status: done` | `FORBIDDEN: spec-closure-ready recommends hand-editing status: done` |
| M8 | revert `PLANNING_RULE_VERSIONS.R011` to `1` | `R011 ruleVersion must bump in the SAME commit` |
| M9 | change READY's action to `mem close ${spec.id} --preview` | `FORBIDDEN: mem close <spec-id>` |
| M10 | drop the unevidenced clause from the uncontracted message | `the unevidenced task is named for the human` |

A red landing anywhere else — an unrelated block, a crash, a non-zero exit alone — is `INEFFECTIVE — guard is decorative` and must be recorded as such, not relabelled. An INEFFECTIVE row is a legitimate and valuable outcome; do not massage a fixture until it goes red.

- [ ] **Step 7: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
        templates/cli/planning/progress.js .evo-lite/cli/planning/progress.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
feat(gaps): R011 renders the authoritative closure verdict instead of guessing

R011 read a hand-ticked checkbox and told the operator to set status: done.
close-preview had already ruled task completion "Advisory only — NEVER affects
readiness", so R011 was a second, weaker authority over a settled question,
recommending the exact act that ruling governs — and by hand-editing
frontmatter, routing around the transaction built to make it safe.

Checkboxes now decide only that a spec is worth checking. readinessOf supplies
the verdict; R011 maps it to one of four types and computes nothing.

ruleVersion goes to 2 in this commit, not a later one: this is where the claim
semantics and the fact inputs change, and every commit runs a real governance
pass.

Unevidenced tasks are named as display context, read from the evaluator that
already owns that definition, and never reach factInputs.

No state recommends hand-editing status: done. Only READY carries an
imperative, and it points at the close transaction with the argument that
command actually accepts — a path.
EOF
```

---

### Task 3: Observation failure retains the finding and fails the census closed

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/planning/gaps.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac5

**Interfaces:**
- Consumes: `createObservation()`'s sink, already threaded to `checkR006` and `checkR013`. It exposes `unavailable(what, err)` and collects into `errors`, which `runPlanningDriftCensus` folds into its result.
- Consumes: `r011ClosureState(type)` from Task 2 — the unobservable state uses it too.

`readinessOf` throws on an unreadable evidence store — `evidence-store.js` does that deliberately, so that silence cannot flip a real FAIL into UNVERIFIED-by-absence. R011 must catch it and degrade, never let it escape and never let it look like absence.

Suppressing the whole finding would be the wrong kind of closed: a finding absent from a **complete** census is read by `disposition sync` as proof of absence, and it tombstones the human's decision terminally. So the finding survives; the advice is what fails closed.

Note the asymmetry with Task 2's presence evidence, and keep it: unreadable **readiness** degrades the census, unreadable **presence** does not. Readiness is a fact input; presence is display context that no state depends on.

- [ ] **Step 1: Write the failing test**

```js
        console.log('T-r011-unobservable. A readiness we could not read is not a spec we may close ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const root = createTempRuntimeRoot('r011-unobservable').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: draft', '---', '', '# S', ''].join('\n'));
            const ir = {
                version: 'evo-plan-ir@1',
                specs: [{ id: 'spec:u', status: 'draft', sourcePath: 'docs/specs/u.md' }],
                plans: [{ id: 'plan:u', status: 'draft', linkedSpec: 'spec:u' }],
                tasks: [{ id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [], evidence: [] }],
                warnings: [],
            };
            const boom = () => { throw new Error('disposition ledger is invalid JSON'); };
            const evidenceFn = () => ({ id: 'task:u1', evidence: { gitRefs: [], linkedFilesTotal: 0, linkedFilesExist: 0 } });

            // Control first: with readiness readable, the census is complete and
            // the finding is NOT unobservable. Without this the degraded
            // assertions below could pass for the wrong reason.
            const healthy = gaps.runPlanningDriftCensus(root, ir, {
                readinessFn: () => ({ readiness: 'NO-CONTRACT', blockers: [], contractStatus: 'absent', contractPresent: false }),
                evidenceFn,
            });
            assert.strictEqual(healthy.complete, true, 'precondition: a readable round is complete');
            const healthyR011 = healthy.findings.filter(f => f.rule === 'R011');
            assert.strictEqual(healthyR011.length, 1, 'precondition: exactly one R011 finding is emitted');
            assert.strictEqual(healthyR011[0].type, 'spec-closure-uncontracted');

            const degraded = gaps.runPlanningDriftCensus(root, ir, { readinessFn: boom, evidenceFn });
            const r011 = degraded.findings.filter(f => f.rule === 'R011');

            assert.strictEqual(r011.length, 1,
                'FORBIDDEN: dropping the finding — an absence in a COMPLETE census is read by sync as proof, '
                + 'and it tombstones the human decision terminally');
            assert.strictEqual(r011[0].type, 'spec-closure-unobservable');
            assert.strictEqual(r011[0].factInputs.closureState, gaps.r011ClosureState('spec-closure-unobservable'),
                'unobservable derives its closureState like every other state — no hand-written string');
            assert.strictEqual(r011[0].dispositionable, false,
                'a failure to observe is not a fact about the spec — it must not be dispositionable as accepted');
            assert.strictEqual(r011[0].suggestedAction, null,
                'no closure advice of any kind when readiness could not be read');
            assert.strictEqual(degraded.complete, false,
                'the census degrades so sync writes no tombstone this round');
            assert.ok(degraded.errors.some(e => /R011|readiness/i.test(e)),
                'and the degradation names what could not be observed');

            // The asymmetry, pinned: unreadable PRESENCE withholds context, it does
            // not degrade the round. Presence selects no state and enters no
            // factInputs, so it makes no claim that silence could falsify.
            const presenceBlind = gaps.runPlanningDriftCensus(root, ir, {
                readinessFn: () => ({ readiness: 'NO-CONTRACT', blockers: [], contractStatus: 'absent', contractPresent: false }),
                evidenceFn: () => { throw new Error('git is unavailable'); },
            });
            assert.strictEqual(presenceBlind.complete, true,
                'unreadable presence evidence must NOT degrade the census — it is display context, not a fact input');
            assert.strictEqual(presenceBlind.findings.filter(f => f.rule === 'R011')[0].type,
                'spec-closure-uncontracted', 'and the authoritative state is unaffected by it');
            console.log('✅ T-r011-unobservable passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL — the throw escapes `runPlanningDriftCensus` entirely.

- [ ] **Step 3: Write minimal implementation**

Wrap the readiness call in `checkR011`:

```js
        let verdict;
        try {
            verdict = readinessFn(specPath, spec);
        } catch (err) {
            // Retain the finding, withdraw the advice. Suppressing it would remove
            // it from the census, and `sync` reads an absence from a COMPLETE
            // census as proof — tombstoning a human decision terminally. Degrading
            // the census is the conservative direction; erasing the finding is not.
            if (observation) {
                observation.unavailable(`R011 closure readiness for ${spec.id}`, err);
            }
            findings.push({
                id: `R011:${spec.id}`,
                rule: 'R011',
                scope: 'planning',
                level: 'warning',
                type: 'spec-closure-unobservable',
                message: `Spec ${spec.id} closure readiness could not be read: ${err && err.message ? err.message : String(err)}`,
                evidence: [spec.sourcePath],
                suggestedAction: null,
                dispositionable: false,
                factInputs: { closureState: r011ClosureState('spec-closure-unobservable') },
            });
            continue;
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
node .evo-lite/cli/test.js
```

Expected: PASS, 442 blocks.

- [ ] **Step 5: Run this task's mutations**

| # | mutation | must turn red on |
|---|---|---|
| M2 | set `dispositionable: true` on the unobservable branch | `a failure to observe is not a fact about the spec` |
| M3 | delete the `observation.unavailable(...)` call | `the census degrades so sync writes no tombstone this round` |
| M4 | delete the unobservable `findings.push({...})` block, keeping `continue` | `FORBIDDEN: dropping the finding` |
| M11 | route the presence-evidence catch through `observation.unavailable` too | `unreadable presence evidence must NOT degrade the census` |

M4 deliberately deletes the push rather than removing `continue`: removing `continue` lets execution fall through to `verdict.readiness` on an undefined `verdict`, which reddens on a TypeError rather than on the retention property — `INEFFECTIVE` by this plan's own standard.

Same restore discipline: copy aside, copy back, confirm sha256, re-run green between rows.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
fix(gaps): a readiness R011 could not read degrades the round, it does not vanish

readinessOf throws on an unreadable evidence store, by design. R011 now catches
it, keeps the finding as spec-closure-unobservable, records the failure through
the observation sink, and emits no closure advice.

The finding is retained on purpose. An absence from a COMPLETE census is read by
disposition sync as proof of absence, and it writes a terminal tombstone over a
human decision. Degrading the census is the conservative direction; erasing the
finding is not.

Unreadable presence evidence deliberately does NOT degrade the round: it selects
no state and enters no factInputs, so withholding it makes no claim that silence
could falsify. That asymmetry is pinned by a test.
EOF
```

---

### Task 4: Fingerprint carries what makes the state what it is

> **GATE: do not start this task until the human has ruled on `## Pending ratification`.** It is written against Option 2. Under Option 1, Step 3 changes and this plan must be amended first.

**Files:**
- Modify: `templates/cli/verification/validate-contract.js` (additive returns only)
- Modify: `.evo-lite/cli/verification/validate-contract.js`
- Modify: `templates/cli/verification/close-preview.js`
- Modify: `.evo-lite/cli/verification/close-preview.js`
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/verification/validate-contract.js, templates/cli/verification/close-preview.js, templates/cli/planning/gaps.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac7

**Interfaces:**
- Consumes: `computeFingerprint({ruleId, ruleVersion, factInputs})` from `templates/cli/disposition/fingerprint.js`.
- Produces: `readinessOf(...).validationIdentity` — a 16-hex-char digest, present **only** when `contractStatus === 'invalid'`, absent otherwise.

Task 2 already emits `blockers` as a sorted `criterionId=verdict` array and bumped the version. This task adds the malformed-contract identity and proves all four discrimination properties.

Two measured facts about the sort, so nobody re-litigates it mid-task:

- `SET_KEYS` in `fingerprint.js` is `['linkedFiles', 'notDonePlans', 'taskStatuses', 'linkedPlans']`. **`blockers` is not in it**, so `canonicalJson` treats the array as a sequence and the `.sort()` in `gaps.js` is genuinely load-bearing — M5 will redden.
- Do **not** move the sort into `SET_KEYS` instead. The same ordering also has to make `blockerIds.join(', ')` deterministic in the finding's *message*, which `canonicalJson` never sees. One sort at the producer serves both; a `SET_KEYS` entry would serve only the fingerprint and leave the message order-dependent.

- [ ] **Step 1: Write the failing test**

```js
        console.log('T-r011-fingerprint. Different blockers are different facts, reordered ones are not ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
            const cp = require(path.join(TEMPLATE_CLI_DIR, 'verification', 'close-preview'));

            const root = createTempRuntimeRoot('r011-fingerprint').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: draft', '---', '', '# S', ''].join('\n'));
            const ir = {
                version: 'evo-plan-ir@1',
                specs: [{ id: 'spec:u', status: 'draft', sourcePath: 'docs/specs/u.md' }],
                plans: [{ id: 'plan:u', status: 'draft', linkedSpec: 'spec:u' }],
                tasks: [{ id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [], evidence: [] }],
                warnings: [],
            };
            const printOf = (verdict) => {
                const f = gaps.checkR011(root, ir, {
                    readinessFn: () => verdict,
                    evidenceFn: () => ({ id: 'task:u1', evidence: { gitRefs: [], linkedFilesTotal: 0, linkedFilesExist: 0 } }),
                }, null)[0];
                return fp.computeFingerprint({ ruleId: f.rule, ruleVersion: gaps.PLANNING_RULE_VERSIONS.R011, factInputs: f.factInputs });
            };
            const blocked = (blockers) => ({ readiness: 'BLOCKED', blockers, contractStatus: 'valid', contractPresent: true });
            const invalid = (identity, message) => ({ readiness: 'BLOCKED', contractStatus: 'invalid', contractPresent: true,
                validationIdentity: identity, blockers: [{ criterionId: 'contract', verdict: 'INVALID', remedy: message }] });

            // 1. different failing criteria are different facts
            assert.notStrictEqual(printOf(blocked([{ criterionId: 'ac-1', verdict: 'FAIL' }])),
                printOf(blocked([{ criterionId: 'ac-3', verdict: 'STALE' }])),
                'FORBIDDEN: ac-1=FAIL and ac-3=STALE sharing one fingerprint — a decision taken about the '
                + 'first would be silently inherited by the second, which is the collapse the four types exist to prevent');

            // 2. a reordering is not a change of fact
            assert.strictEqual(
                printOf(blocked([{ criterionId: 'ac-1', verdict: 'FAIL' }, { criterionId: 'ac-3', verdict: 'STALE' }])),
                printOf(blocked([{ criterionId: 'ac-3', verdict: 'STALE' }, { criterionId: 'ac-1', verdict: 'FAIL' }])),
                'a mere reordering by the verdict engine must NOT lapse a decision that nothing real invalidated');

            // 3. two DIFFERENT malformations are different facts, even though both
            //    reduce to the single finding id `contract`
            assert.notStrictEqual(printOf(invalid('aaaaaaaaaaaaaaaa', 'x')), printOf(invalid('bbbbbbbbbbbbbbbb', 'y')),
                'FORBIDDEN: every malformed contract sharing one fingerprint — finding ids collapse all JSON '
                + 'failures to `contract`, so identity must come from the cause, not the id');

            // 4. re-wording an error message is not a change of fact
            assert.strictEqual(printOf(invalid('aaaaaaaaaaaaaaaa', 'Unexpected token at position 7')),
                printOf(invalid('aaaaaaaaaaaaaaaa', 'Expected double-quoted property name at position 7')),
                'a validator or V8 rewording must NOT lapse a decision — CI runs three Node majors and the '
                + 'JSON parser message is engine prose with an offset, not a contract');

            // and the identity is actually computed from the spec source, not stubbed
            const badPath = path.join(root, 'docs', 'specs', 'bad.md');
            const withBlock = (body) => ['---', 'id: spec:bad', 'status: draft', '---', '',
                '## Acceptance Criteria', '', '```json', body, '```', ''].join('\n');
            writeText(badPath, withBlock('{ "criteria": [ }'));
            const idA = cp.readinessOf(badPath, { root }).validationIdentity;
            writeText(badPath, withBlock('{ "criteria": [{ "id": } ] }'));
            const idB = cp.readinessOf(badPath, { root }).validationIdentity;
            assert.ok(idA && idB, 'an invalid contract must carry a validationIdentity');
            assert.notStrictEqual(idA, idB, 'two differently-broken blocks must not share one identity');
            writeText(badPath, withBlock('{ "criteria": [ }'));
            assert.strictEqual(cp.readinessOf(badPath, { root }).validationIdentity, idA,
                'restoring the same broken block must restore the same identity — it is a function of the cause');
            assert.strictEqual(cp.readinessOf(path.join(root, 'docs', 'specs', 'u.md'), { root }).validationIdentity, undefined,
                'a spec with no contract carries no validation identity');
            console.log('✅ T-r011-fingerprint passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL on property 3 — `validationIdentity` does not exist yet, so both invalid rounds produce the same `factInputs`.

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/verification/validate-contract.js`, return the block text that `parseSpecCriteria` already isolates. **Additive only — no validation logic changes and no new failure codes:**

```js
    const end = lines.findIndex((l, i) => i >= start && /^```\s*$/.test(l));
    if (end === -1) {
        return { criteria: [], error: 'unterminated ```json block', blockText: lines.slice(start).join('\n') };
    }
    const blockText = lines.slice(start, end).join('\n');
    try {
        const parsed = JSON.parse(blockText);
        return { criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [], error: null, blockText };
    } catch (e) {
        return { criteria: [], error: `invalid JSON in criteria block: ${e.message}`, blockText };
    }
```

The two early returns (`no "## Acceptance Criteria" heading found`, `no ```json criteria block`) keep `blockText: ''` — both are the NO-CONTRACT opt-out, where no identity is needed.

In `loadValidatedContract`, propagate it on the malformed branch only:

```js
        return { ok: false, noContract: false, specId, linkedPlan, criteria: [],
            contractSource: parsed.blockText || '',
            findings: [finding('contract', parsed.error)] };
```

In `templates/cli/verification/close-preview.js`, add `const crypto = require('crypto');` to the requires (it is not currently imported), and compute the identity on the invalid branch of `readinessOf`:

```js
    if (!contract.ok) {
        // Identity of the CAUSE, not of the complaint. A validation finding is
        // { id, level, message } and nothing else, so every JSON malformation
        // collapses to the single id `contract` — digesting ids alone cannot
        // tell two broken contracts apart. Digesting messages would work, but
        // would put V8's JSON parser prose (with a character offset) inside a
        // human decision's identity, on a project whose CI spans three Node
        // majors. The authored text that caused the failure is the stable input.
        const validationIdentity = crypto.createHash('sha256').update(JSON.stringify({
            specId: contract.specId == null ? null : String(contract.specId),
            linkedPlan: contract.linkedPlan == null ? null : String(contract.linkedPlan),
            findingIds: contract.findings.map(f => f.id).sort(),
            source: contract.contractSource || '',
        })).digest('hex').slice(0, 16);
        return {
            readiness: 'BLOCKED', contractStatus: 'invalid', contractPresent: true, criteria: [],
            validationIdentity,
            blockers: contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', remedy: f.message })),
        };
    }
```

`specId` and `linkedPlan` are in the digest because their own two failure classes carry the rejected value only in the message: without them, `spec:BAD1` and `spec:BAD2` would share one identity.

In `templates/cli/planning/gaps.js`, carry it into `factInputs` when — and only when — it exists:

```js
            factInputs: verdict.validationIdentity
                ? { closureState: r011ClosureState(type), blockers: blockerIds, validationIdentity: verdict.validationIdentity }
                : { closureState: r011ClosureState(type), blockers: blockerIds },
```

The key is omitted rather than set to `null` so that a valid contract's fingerprint is unchanged by this task.

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/verification/validate-contract.js .evo-lite/cli/verification/validate-contract.js
cp templates/cli/verification/close-preview.js .evo-lite/cli/verification/close-preview.js
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
node .evo-lite/cli/test.js
```

Expected: PASS, 443 blocks. Every pre-existing `validate-contract` and `verify-contract` test must still pass — this task adds return fields and removes none.

- [ ] **Step 5: Run this task's mutations**

| # | mutation | must turn red on |
|---|---|---|
| M5 | remove `.sort()` from `blockerIds` | `a mere reordering ... must NOT lapse a decision` |
| M6 | drop `blockers` from `factInputs` | `ac-1=FAIL and ac-3=STALE sharing one fingerprint` |
| M12 | drop `validationIdentity` from `factInputs` | `every malformed contract sharing one fingerprint` |
| M13 | replace the digest input `source` with `contract.findings.map(f => f.message)` | `a validator or V8 rewording must NOT lapse a decision` |
| M14 | drop `specId`/`linkedPlan` from the digest input | *expected INEFFECTIVE unless you add a case for it* — record honestly which |

M14 is included precisely because this plan predicts it is not covered by the tests above. Record the outcome as measured. If it is `INEFFECTIVE`, say so and stop — do not add a test during a mutation run.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/verification/validate-contract.js .evo-lite/cli/verification/validate-contract.js \
        templates/cli/verification/close-preview.js .evo-lite/cli/verification/close-preview.js \
        templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
feat(verification): give a malformed contract a stable identity of its own

factInputs already carried a canonically sorted blocker identity. Without one
for the malformed case, every broken contract shared a fingerprint: a validation
finding is { id, level, message }, so all JSON failures collapse to the single
id `contract`, and a decision taken about one malformation would be inherited by
the next.

The identity digests the CAUSE — frontmatter id, linkedPlan, the raw criteria
block text and the sorted finding ids — not the complaint. Digesting messages
would also discriminate, but it would put V8's JSON parser prose and its
character offset inside a human decision's identity, on a repo whose CI spans
three Node majors.

parseSpecCriteria now also returns the block text it already isolated. No
validation logic changed and no failure codes were added.
EOF
```

---

### Task 5: The real repository, deterministically

**Files:**
- Test: `templates/cli/test/governance.js`
- Create: `docs/validation/r011-closure-router-mutation-matrix.md`

- files: templates/cli/test/governance.js, docs/validation/r011-closure-router-mutation-matrix.md
- verify: node .evo-lite/cli/test.js
- acceptance: ac8

**Interfaces:**
- Consumes: `scanPlanning(projectRoot)` from `templates/cli/planning/scan.js`, and everything above.

**Production scope for this task is ZERO.** If a mutation or the real-repo run reveals a genuine defect, STOP and report BLOCKED rather than fixing product code.

The IR is built with `scanPlanning(WORKSPACE_ROOT)`, not read from `.evo-lite/generated/planning/plan-ir.json`. That file is git-ignored and is not produced by `npm test`, so a `existsSync` guard around it would make AC8 green on a developer machine with a stale artifact and **silently unexecuted** in every CI checkout. **There is no skip branch.**

Measured on this tree at plan time, so the assertions below are facts, not guesses:

```
spec:governance-observation-budget  draft  docs/superpowers/specs/2026-08-09-governance-observation-budget-design.md
  plan:governance-observation-budget  5 tasks, all implemented
    t5  linkedFiles 0  evidence 0   ← the only unevidenced task
spec:planning-truth-controls        draft  docs/superpowers/specs/2026-08-09-planning-truth-controls-design.md
  plan:planning-truth-controls        6 tasks, all implemented
    t6  linkedFiles 0  evidence 0   ← the only unevidenced task
```

Neither spec has a criteria block, so both must land on `spec-closure-uncontracted`.

- [ ] **Step 1: Write the failing test**

```js
        console.log('T-r011-real-repo. The two specs this defect was found on stop being told to close ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const { scanPlanning } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'scan'));

            // Built from tracked sources, never from .evo-lite/generated/**: that
            // directory is git-ignored and npm test does not create it, so reading
            // it would make this criterion pass locally and never run in CI.
            const ir = scanPlanning(WORKSPACE_ROOT);
            const findings = gaps.checkR011(WORKSPACE_ROOT, ir, {}, null);

            const expected = {
                'spec:governance-observation-budget': 'task:governance-observation-budget-t5',
                'spec:planning-truth-controls': 'task:planning-truth-controls-t6',
            };
            const seen = findings.filter(f => Object.keys(expected).includes(f.id.replace('R011:', '')));
            assert.strictEqual(seen.length, 2,
                'precondition: both specs are still R011 candidates on this tree, or this control proves nothing');
            for (const f of seen) {
                const specId = f.id.replace('R011:', '');
                assert.strictEqual(f.type, 'spec-closure-uncontracted',
                    `${specId}: no criteria block means no authoritative verdict`);
                assert.ok(!/status:\s*done/.test(f.suggestedAction || ''),
                    `${specId}: FORBIDDEN — the advice a human overruled by hand on 2026-08-10`);
                assert.ok(!/mem close/.test(f.suggestedAction || ''),
                    `${specId}: an uncontracted spec must not be routed at a command that would refuse it`);
                assert.match(f.message, new RegExp(expected[specId].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
                    `${specId}: the unevidenced task must be named — a human closing this spec needs to see `
                    + 'WHICH work has nothing behind it');
            }
            console.log('✅ T-r011-real-repo passed');
        }
```

- [ ] **Step 2: Run the test**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Tasks 2-4 are already present, so this may pass on the first run. **If it passes, say so plainly** — do not manufacture a red by temporarily breaking product code. Its falsifiability is shown by Step 3 instead.

- [ ] **Step 3: Prove this control bears load**

| # | mutation | must turn red on |
|---|---|---|
| M15 | in `r011Unevidenced`, return `[]` unconditionally | `the unevidenced task must be named` |
| M16 | map `'NO-CONTRACT'` to `'spec-closure-not-ready'` | `no criteria block means no authoritative verdict` |

Same restore discipline: copy aside, copy back, confirm sha256, re-run green.

- [ ] **Step 4: Write the consolidated matrix**

Write `docs/validation/r011-closure-router-mutation-matrix.md` covering **every** mutation from Tasks 1-5 — M0, M1-M16 — with one row each: which task ran it, the mutation and its replacement count, the fixture's path through the target branch on the green baseline, the exact failing assertion text, the restored sha256, and an explicit `effective` / `INEFFECTIVE — guard is decorative` verdict.

Take each row's evidence from that task's report. Do not re-run a mutation to fill a gap in the record — if a row's evidence is missing, say the record is incomplete.

- [ ] **Step 5: Verify and commit**

```bash
git status --porcelain
node .evo-lite/cli/test.js
```

Expected: no modification outside the new doc and the test file; full suite green at 444 blocks.

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js \
        docs/validation/r011-closure-router-mutation-matrix.md
git commit -F - <<'EOF'
test(gaps): pin R011's new contract on the real repo, deterministically

The two specs this defect was found on now report spec-closure-uncontracted,
name the one task behind each that has no evidence at all, and receive no
closure advice — reproducing, in code, the decision a human made by hand on
2026-08-10 after checking three R011 suggestions and accepting one.

The IR comes from scanPlanning(), not from .evo-lite/generated/**: that
directory is git-ignored and npm test never creates it, so a guarded read would
have made this criterion pass locally and never execute in CI.

Consolidated mutation record for the whole change, one row per mutation with the
assertion it reddens or an explicit INEFFECTIVE verdict.
EOF
```

---

## What changed since `e19c949`

| review item | change |
|---|---|
| Important 1 | `## Pending ratification` records the frozen contract's gap and the two options; Task 4 is written against Option 2 and gated on the human's ruling. The digest input is frozen in the plan, not left to the implementer. |
| Important 2 | M1/M7/M8/M9/M10 moved into Task 2, M2/M3/M4/M11 into Task 3, M5/M6/M12/M13/M14 into Task 4, M15/M16 into Task 5, M0 added to Task 1. Task 5 now only consolidates the record. Old M4 (`remove continue`) replaced with deleting the push, because the original would have reddened on a TypeError. |
| Important 3 | READY routes to `mem close <spec.sourcePath> --preview`; a negative assertion forbids the id form; M9 pins it. |
| Important 4 | `PLANNING_RULE_VERSIONS.R011 → 2` moved into Task 2, asserted there, and M8 moved with it. Task 4 keeps only the identity work. |
| Important 5 | Task 5 builds its IR with `scanPlanning(WORKSPACE_ROOT)` and has no skip branch. Unevidenced tasks are named — capability built in Task 2 via `progress.js`'s `evaluateTask`, asserted on the real repo in Task 5, with the measured task ids `…-t5` / `…-t6`. |
| Minor 1 | `r011ClosureState(type)` is exported and used by all four states; T-r011-router and T-r011-unobservable both assert derivation rather than the literal string. |
| Minor 2 | `readinessOf` returns `contractStatus` and no note prose; `previewClose` keeps both note strings verbatim. A negative assertion forbids the prose from returning. |
| — | T26b named explicitly (`governance.js:3367`) with its three cardinality invariants marked load-bearing, and `planTaskStatuses` identified as dead after Task 2 (`gaps.js:317`, sole caller `gaps.js:584`). |

## Out of scope

- `parse-markdown.js`'s checkbox → plan `status: done` promotion, and the release-blocker path it feeds — registered as `[a8a8]`, investigation required first.
- The three disagreeing archive-evidence mechanisms (`checkArchiveHits`, `hasArchiveEvidence`, and `backfill-evidence.js`'s matchers).
- `validateGitRef`'s fail-open catch and `loadArchiveEvidenceMap`'s swallow.
- `mem verify` folding hook or closure health into overall governance status — `[0ce0]`, contract not frozen.
- `spec:disposition-ledger`'s invalid contract.
- `takeover-session.js`'s dead `t.status === 'done'` filter.
- A supported closure path for contract-less specs.
- Adding structured failure codes to `validate-contract.js` — Option 1's alternative, and a larger change than this item needs.
- Removing `'taskStatuses'` from `fingerprint.js`'s `SET_KEYS` once Task 2 stops emitting it. It becomes a dead registry entry, and it is harmless: editing the canonicalization registry to delete an unused key is a fingerprint-behaviour change with no benefit to this item.
