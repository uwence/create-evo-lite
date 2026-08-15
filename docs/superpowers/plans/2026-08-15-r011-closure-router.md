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

## Global Constraints

- **Double mirror.** `templates/cli/**` is the source; `.evo-lite/cli/**` is the live mirror. Every changed file must end up byte-identical in both. Copy source → live, never the reverse.
- **Mirror before running the suite.** A mirror-asymmetric tree makes `verify` report `templateSync: out-of-sync`, which sets an early alert and deterministically reddens an unrelated test hundreds of blocks earlier. This has cost this project several wasted runs. Mirror even for a throwaway experiment.
- **Verification is the full suite, no scope argument:** `node .evo-lite/cli/test.js`. Run it ALONE — two concurrent runs writing one log produced a garbage count before. Count blocks with `grep -c "^✅"`. The baseline at plan time is **439**.
- **`node .evo-lite/cli/test.js integration` is not a runnable scope.** `shouldRun` accepts only `governance` and the default `all`; anything else exits 1 with `Unknown test scope`. Use `governance` for inner-loop feedback if you like; report the full run.
- **No commit message may contain backticks inside a double-quoted `-m` argument.** Bash executes them as command substitution and silently empties them. Use a heredoc: `git commit -F -` with `<<'EOF'`.
- **`git checkout -- <file>` destroys uncommitted work.** To restore after a mutation experiment, copy the file aside first and copy it back. This has destroyed work twice on this project.
- **Do not set focus or touch `.evo-lite/active_context.md`.** If a commit message names a `plan:<slug>` or `spec:<slug>`, post-commit auto-advance may overwrite the human's focus. Prefix such commits with `EVO_LITE_NO_FOCUS_AUTOADVANCE=1`.
- **Presence evidence is display context only.** Git refs, linked files, archive hits and checkboxes may never enter state selection and may never enter `factInputs`. No fourth evidence evaluator may be written.
- **Out of scope, do not touch:** `parse-markdown.js`'s checkbox→plan-status promotion (`[a8a8]`), the three disagreeing archive-evidence mechanisms, `validateGitRef`'s fail-open catch, `loadArchiveEvidenceMap`'s swallow, `takeover-session.js`, `spec:disposition-ledger`'s invalid contract, `mem verify`, and every other known debt.

## Canonical vocabularies

Three vocabularies exist. Each has exactly one home. **Do not invent a fourth spelling, and do not use one vocabulary in another's place.**

| layer | values | where |
|---|---|---|
| authority | `READY` / `BLOCKED` / `NO-CONTRACT` | `readinessOf()` and `previewClose()` — existing, unchanged |
| finding type | `spec-closure-ready` / `spec-closure-not-ready` / `spec-closure-uncontracted` / `spec-closure-unobservable` | R011 findings |
| fact input | `ready` / `not-ready` / `uncontracted` / `unobservable` | `factInputs.closureState` |

`closureState` is the finding type with the `spec-closure-` prefix removed — mechanically, never by hand-picking a synonym. The spec's prose example writes `NOT_READY`; **this plan overrides that spelling with `not-ready`.** The design semantics are unchanged.

## File Structure

| file | responsibility | change |
|---|---|---|
| `templates/cli/verification/close-preview.js` | owns the authoritative readiness computation | gains `readinessOf()`; `previewClose()` delegates to it and is otherwise behaviourally unchanged |
| `templates/cli/planning/gaps.js` | emits planning drift findings | `checkR011` gains a project root and observation sink, calls `readinessOf()`, maps to four types, carries the new `factInputs`; `PLANNING_RULE_VERSIONS.R011` → 2 |
| `templates/cli/test/governance.js` | governance test suite | all new tests |

Mirrors of the first two under `.evo-lite/cli/` change identically.

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
- Produces: `readinessOf(specPath, opts) -> { readiness, blockers, criteria, contractPresent, note }` where `readiness` is `'READY' | 'BLOCKED' | 'NO-CONTRACT'`. It MAY THROW. `opts` accepts `{ root, statusFn }` with the same meanings `previewClose` already gives them.

This is a pure refactor. `previewClose`'s outward behaviour must not change, and its existing tests T38 (`previewClose readiness (READY/BLOCKED/NO-CONTRACT)`) and T39 (`previewClose is read-only`) are the regression net. If either goes red, the refactor is wrong — do not adjust those tests.

Note the existing asymmetry you must preserve: the invalid-contract branch returns `actions` populated, while the no-contract branch returns `actions: []`. `actions` stays in `previewClose`; `readinessOf` never computes it.

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
            assert.strictEqual(r.contractPresent, true, 'a criteria block means a contract is present');

            const blockedPath = writeSpec('blocked.md', oneCmd);
            const b = cp.readinessOf(blockedPath, { root, statusFn: () => [{ criterionId: 'ac-1', verdict: 'FAIL', detail: 'd' }] });
            assert.strictEqual(b.readiness, 'BLOCKED', 'a non-PASS verdict is BLOCKED');
            assert.deepStrictEqual(b.blockers.map(x => x.criterionId), ['ac-1'], 'the blocking criterion is named');

            const nonePath = writeSpec('none.md', JSON.stringify({ criteria: [] }));
            const n = cp.readinessOf(nonePath, { root, statusFn: () => [] });
            assert.strictEqual(n.readiness, 'NO-CONTRACT', 'an empty criteria block is NO-CONTRACT');
            assert.strictEqual(n.contractPresent, false, 'and no contract is present');

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
            readiness: 'BLOCKED', criteria: [], contractPresent: true,
            blockers: contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', remedy: f.message })),
            note: 'contract is invalid — fix the criteria block (mem verify-contract lint <spec>)',
        };
    }
    if (contract.noContract) {
        return {
            readiness: 'NO-CONTRACT', criteria: [], contractPresent: false, blockers: [],
            note: 'no machine-readable acceptance criteria — add a criteria block for a real gate, or close manually',
        };
    }

    const statusFn = opts.statusFn || function (sp) { return require('./engine').statusSpec(sp, { root }); };
    const verdicts = statusFn(specPath);
    const blockers = verdicts.filter(v => v.verdict !== 'PASS').map(v => ({
        criterionId: v.criterionId, verdict: v.verdict, remedy: remedyFor(v.verdict, typeById[v.criterionId]),
    }));
    return {
        readiness: blockers.length ? 'BLOCKED' : 'READY',
        criteria: verdicts, contractPresent: true, blockers, note: null,
    };
}
```

Then replace `previewClose`'s three readiness returns with delegation. Its head — the specText read, the frontmatter parse, `planState`, `actions` and `warnings` — is unchanged up to and including the `if (totalTasks > 0) actions.push(...)` line. Everything from `// Malformed contract (present but invalid)` to the end of the function becomes:

```js
    const r = readinessOf(specPath, { root, statusFn: opts.statusFn });

    // NO-CONTRACT keeps its historical empty action list; the invalid-contract
    // branch keeps its populated one. Preserved deliberately — T38 pins it.
    if (r.readiness === 'NO-CONTRACT') {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions: [], warnings, note: r.note };
    }
    if (r.note) {
        return { readiness: r.readiness, criteria: r.criteria, plan: planState,
            blockers: r.blockers, actions, warnings, note: r.note };
    }
    return { readiness: r.readiness, criteria: r.criteria, plan: planState,
        blockers: r.blockers, actions, warnings };
}
```

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

- [ ] **Step 5: Commit**

```bash
git add templates/cli/verification/close-preview.js .evo-lite/cli/verification/close-preview.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
refactor(verification): give the authoritative readiness computation one home

readinessOf() computes contract load and criteria verdicts and nothing else.
previewClose() delegates to it and keeps its outward behaviour, pinned by its
existing T38 and T39.

It deliberately does not catch: an unreadable evidence store must reach the
caller, because this function cannot know whether the caller wants to fail a
command or degrade a census.
EOF
```

---

### Task 2: R011 becomes a router — four types, four levels, four dispositionability values

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/planning/gaps.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac1, ac2, ac3, ac4

**Interfaces:**
- Consumes: `readinessOf(specPath, opts)` from Task 1.
- Produces: `checkR011(projectRoot, planIR, options, observation)`. The observation sink is used in Task 3; accept and ignore it here.

`checkR011`'s candidate detection is unchanged: a spec is a candidate when it is not already `done` and every linked plan has at least one task and all its tasks are `readOnly` or `implemented`. Checkboxes decide only that a spec is **worth checking**.

- [ ] **Step 1: Write the failing test**

Add to `templates/cli/test/governance.js`:

```js
        console.log('T-r011-router. R011 renders the authoritative verdict and never invents one ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const root = createTempRuntimeRoot('r011-router').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: draft', '---', '', '# S', ''].join('\n'));
            const ir = {
                version: 'evo-plan-ir@1',
                specs: [{ id: 'spec:u', status: 'draft', sourcePath: 'docs/specs/u.md' }],
                plans: [{ id: 'plan:u', status: 'draft', linkedSpec: 'spec:u' }],
                tasks: [{ id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [] }],
                warnings: [],
            };
            const r011 = (readiness, blockers) => gaps.checkR011(root, ir, {
                readinessFn: () => ({ readiness, blockers: blockers || [], contractPresent: readiness !== 'NO-CONTRACT' }),
            }, null);

            const ready = r011('READY')[0];
            assert.strictEqual(ready.type, 'spec-closure-ready', 'READY maps to spec-closure-ready');
            assert.strictEqual(ready.level, 'info', 'ready is good news, not an alert');
            assert.strictEqual(ready.dispositionable, false,
                'ready is positive routing information — accepted-debt has no meaning against it');
            assert.match(ready.suggestedAction, /mem close spec:u --preview/,
                'ready routes to the close transaction, with the real command shape');

            const notReady = r011('BLOCKED', [{ criterionId: 'ac-1', verdict: 'FAIL' }])[0];
            assert.strictEqual(notReady.type, 'spec-closure-not-ready', 'BLOCKED maps to spec-closure-not-ready');
            assert.strictEqual(notReady.level, 'warning');
            assert.strictEqual(notReady.dispositionable, true, 'a blocked spec is a real governance fact');
            assert.match(notReady.message, /ac-1/, 'the blocking criterion is named for the operator');

            const unc = r011('NO-CONTRACT')[0];
            assert.strictEqual(unc.type, 'spec-closure-uncontracted', 'NO-CONTRACT maps to spec-closure-uncontracted');
            assert.strictEqual(unc.level, 'warning');
            assert.strictEqual(unc.dispositionable, true);

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

Expected: FAIL — `checkR011` currently takes `(planIR)`, so `root` arrives where `planIR` is expected and `planIR.plans` is undefined.

- [ ] **Step 3: Write minimal implementation**

Replace `checkR011`'s signature and its finding construction in `templates/cli/planning/gaps.js`. The candidate loop above it is unchanged.

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
            message: r011Message(spec, plans, type, blockerIds),
            evidence: [spec.sourcePath],
            suggestedAction: r011Action(spec, type),
            dispositionable: !R011_NON_DISPOSITIONABLE.includes(type),
            factInputs: { closureState: type.replace('spec-closure-', ''), blockers: blockerIds },
        });
```

Add the two renderers next to `checkR011`:

```js
// closureState is the finding type minus its prefix — derived, never a synonym
// chosen by hand. Three vocabularies exist (authority READY/BLOCKED/NO-CONTRACT,
// finding type, fact input) and each has exactly one home.
function r011Message(spec, plans, type, blockerIds) {
    const shape = plans.length > 1
        ? `all ${plans.length} linked plans are checkbox-complete`
        : `linked plan ${plans[0].id} is checkbox-complete`;
    if (type === 'spec-closure-ready') {
        return `Spec ${spec.id} is [${spec.status}] and its acceptance contract is satisfied — ${shape}`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Spec ${spec.id} is [${spec.status}] and ${shape}, but its acceptance contract is not satisfied: ${blockerIds.join(', ')}`;
    }
    return `Spec ${spec.id} is [${spec.status}] and ${shape}, but has no machine-readable acceptance contract — checkbox state is not closure evidence`;
}

function r011Action(spec, type) {
    if (type === 'spec-closure-ready') {
        return `Run the close transaction: mem close ${spec.id} --preview`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Resolve the failing criteria in ${spec.sourcePath}, then re-check readiness`;
    }
    return `Add or repair the acceptance criteria block in ${spec.sourcePath} so closure has an authoritative verdict`;
}
```

Update the call site at the census (currently `...checkR011(planIR),`):

```js
        ...checkR011(projectRoot, planIR, options, observation),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
node .evo-lite/cli/test.js
```

Expected: PASS. Any pre-existing test asserting R011's old `type: 'spec-status-drift'` or its old message must be updated to the new contract — that is the intended change, not a regression. Report every such test you touch.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
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

No state recommends hand-editing status: done. Only READY carries an
imperative, and it points at the close transaction.
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

`readinessOf` throws on an unreadable evidence store — `evidence-store.js` does that deliberately, so that silence cannot flip a real FAIL into UNVERIFIED-by-absence. R011 must catch it and degrade, never let it escape and never let it look like absence.

Suppressing the whole finding would be the wrong kind of closed: a finding absent from a **complete** census is read by `disposition sync` as proof of absence, and it tombstones the human's decision terminally. So the finding survives; the advice is what fails closed.

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
                tasks: [{ id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [] }],
                warnings: [],
            };
            const boom = () => { throw new Error('disposition ledger is invalid JSON'); };

            // Control first: with readiness readable, the census is complete and
            // the finding is NOT unobservable. Without this the degraded
            // assertions below could pass for the wrong reason.
            const healthy = gaps.runPlanningDriftCensus(root, ir, {
                readinessFn: () => ({ readiness: 'NO-CONTRACT', blockers: [], contractPresent: false }),
            });
            assert.strictEqual(healthy.complete, true, 'precondition: a readable round is complete');
            const healthyR011 = healthy.findings.filter(f => f.rule === 'R011');
            assert.strictEqual(healthyR011.length, 1, 'precondition: exactly one R011 finding is emitted');
            assert.strictEqual(healthyR011[0].type, 'spec-closure-uncontracted');

            const degraded = gaps.runPlanningDriftCensus(root, ir, { readinessFn: boom });
            const r011 = degraded.findings.filter(f => f.rule === 'R011');

            assert.strictEqual(r011.length, 1,
                'FORBIDDEN: dropping the finding — an absence in a COMPLETE census is read by sync as proof, '
                + 'and it tombstones the human decision terminally');
            assert.strictEqual(r011[0].type, 'spec-closure-unobservable');
            assert.strictEqual(r011[0].dispositionable, false,
                'a failure to observe is not a fact about the spec — it must not be dispositionable as accepted');
            assert.strictEqual(r011[0].suggestedAction, null,
                'no closure advice of any kind when readiness could not be read');
            assert.strictEqual(degraded.complete, false,
                'the census degrades so sync writes no tombstone this round');
            assert.ok(degraded.errors.some(e => /R011|readiness/i.test(e)),
                'and the degradation names what could not be observed');
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
                factInputs: { closureState: 'unobservable' },
            });
            continue;
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
node .evo-lite/cli/test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

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
EOF
```

---

### Task 4: Fingerprint carries what makes the state what it is

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `.evo-lite/cli/planning/gaps.js`
- Test: `templates/cli/test/governance.js`

- files: templates/cli/planning/gaps.js, templates/cli/test/governance.js
- verify: node .evo-lite/cli/test.js
- acceptance: ac7

**Interfaces:**
- Consumes: `computeFingerprint({ruleId, ruleVersion, factInputs})` from `templates/cli/disposition/fingerprint.js`.

`ruleVersion: 2` lapses every existing R011 disposition **once**. It does nothing about facts that move afterwards — that is the fingerprint's job, and the fingerprint reads only `factInputs`.

Tasks 2 and 3 already emit `blockers` as a sorted `criterionId=verdict` array. This task bumps the version and proves the discrimination.

- [ ] **Step 1: Write the failing test**

```js
        console.log('T-r011-fingerprint. Different blockers are different facts, reordered ones are not ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const fp = require(path.join(TEMPLATE_CLI_DIR, 'disposition', 'fingerprint'));
            assert.strictEqual(gaps.PLANNING_RULE_VERSIONS.R011, 2,
                'R011 ruleVersion must bump — both its fact inputs and its claim semantics changed');

            const root = createTempRuntimeRoot('r011-fingerprint').workspaceRoot;
            writeText(path.join(root, 'docs', 'specs', 'u.md'),
                ['---', 'id: spec:u', 'status: draft', '---', '', '# S', ''].join('\n'));
            const ir = {
                version: 'evo-plan-ir@1',
                specs: [{ id: 'spec:u', status: 'draft', sourcePath: 'docs/specs/u.md' }],
                plans: [{ id: 'plan:u', status: 'draft', linkedSpec: 'spec:u' }],
                tasks: [{ id: 'task:u1', linkedPlan: 'plan:u', status: 'implemented', linkedFiles: [] }],
                warnings: [],
            };
            const printOf = (blockers) => {
                const f = gaps.checkR011(root, ir, {
                    readinessFn: () => ({ readiness: 'BLOCKED', blockers, contractPresent: true }),
                }, null)[0];
                return fp.computeFingerprint({ ruleId: f.rule, ruleVersion: gaps.PLANNING_RULE_VERSIONS.R011, factInputs: f.factInputs });
            };

            const ac1Fail = printOf([{ criterionId: 'ac-1', verdict: 'FAIL' }]);
            const ac3Stale = printOf([{ criterionId: 'ac-3', verdict: 'STALE' }]);
            assert.notStrictEqual(ac1Fail, ac3Stale,
                'FORBIDDEN: ac-1=FAIL and ac-3=STALE sharing one fingerprint — a decision taken about the '
                + 'first would be silently inherited by the second, which is the collapse the four types exist to prevent');

            const forward = printOf([{ criterionId: 'ac-1', verdict: 'FAIL' }, { criterionId: 'ac-3', verdict: 'STALE' }]);
            const reversed = printOf([{ criterionId: 'ac-3', verdict: 'STALE' }, { criterionId: 'ac-1', verdict: 'FAIL' }]);
            assert.strictEqual(forward, reversed,
                'a mere reordering by the verdict engine must NOT lapse a decision that nothing real invalidated');
            console.log('✅ T-r011-fingerprint passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

Expected: FAIL on the `PLANNING_RULE_VERSIONS.R011` assertion — it is still `1`.

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/planning/gaps.js`, change the version table entry:

```js
    R009: 1, R010: 1, R011: 2, R012: 1, R013: 1,
```

Add the reason immediately above the table:

```js
// R011 is 2 because both its fact inputs and its claim semantics changed: it
// stopped asserting "this spec should be closed" from checkbox state and began
// reporting an authoritative closure verdict. The bump lapses every existing
// R011 disposition ONCE; every later change of fact is the fingerprint's job.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cp templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js
node .evo-lite/cli/test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js \
        templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -F - <<'EOF'
feat(gaps): R011 ruleVersion 2, and blockers become part of the fact

The version bump lapses existing R011 dispositions once, because both the fact
inputs and the claim semantics changed. It cannot do the fingerprint's job
afterwards.

factInputs now carries the closure state AND a canonically sorted blocker
identity. Without it, ac-1=FAIL and ac-3=STALE share a fingerprint while both
sit in NOT_READY, so a decision taken about one is inherited by the other —
the same collapse the four finding types exist to prevent, reappearing inside
a single state.
EOF
```

---

### Task 5: The real repository, and the mutation matrix

**Files:**
- Test: `templates/cli/test/governance.js`
- Create: `docs/validation/r011-closure-router-mutation-matrix.md`

- files: templates/cli/test/governance.js, docs/validation/r011-closure-router-mutation-matrix.md
- verify: node .evo-lite/cli/test.js
- acceptance: ac8

**Interfaces:**
- Consumes: everything above.

Two currently-flagged specs on the mother repo — `spec:governance-observation-budget` and `spec:planning-truth-controls` — must become `spec-closure-uncontracted` and receive no closure advice. Both have no criteria block, verified at plan time.

**Production scope for this task is ZERO.** If a mutation reveals a genuine defect, STOP and report BLOCKED rather than fixing product code.

- [ ] **Step 1: Write the failing test**

```js
        console.log('T-r011-real-repo. The two specs this defect was found on stop being told to close ...');
        {
            const gaps = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'gaps'));
            const irPath = path.join(WORKSPACE_ROOT, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (!fs.existsSync(irPath)) {
                console.log('   (skipped: no plan-ir.json — run mem plan scan)');
            } else {
                const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
                const findings = gaps.checkR011(WORKSPACE_ROOT, ir, {}, null);
                const targets = ['spec:governance-observation-budget', 'spec:planning-truth-controls'];
                const seen = findings.filter(f => targets.includes(f.id.replace('R011:', '')));
                assert.strictEqual(seen.length, 2,
                    'precondition: both specs are still R011 candidates on this tree, or this control proves nothing');
                for (const f of seen) {
                    assert.strictEqual(f.type, 'spec-closure-uncontracted',
                        `${f.id}: no criteria block means no authoritative verdict`);
                    assert.ok(!/status:\s*done/.test(f.suggestedAction || ''),
                        `${f.id}: FORBIDDEN — the advice a human overruled by hand on 2026-08-10`);
                }
            }
            console.log('✅ T-r011-real-repo passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run before Tasks 2-4 are present, or confirm it passes now that they are. If it already passes, state that explicitly rather than manufacturing a red.

```bash
cp templates/cli/test/governance.js .evo-lite/cli/test/governance.js
node .evo-lite/cli/test.js governance
```

- [ ] **Step 3: Run the mutation matrix**

For each row: apply to BOTH mirrors, run `node .evo-lite/cli/test.js governance`, record the exact failing assertion, restore by copying the pre-mutation file back — **never `git checkout --`** — and confirm the sha256 matches.

| # | mutation | must turn red on |
|---|---|---|
| M1 | in `checkR011`, map `'NO-CONTRACT'` to `'spec-closure-ready'` | `NO-CONTRACT maps to spec-closure-uncontracted` |
| M2 | set `dispositionable: true` on the unobservable branch | `a failure to observe is not a fact about the spec` |
| M3 | drop the `observation.unavailable(...)` call | `the census degrades so sync writes no tombstone this round` |
| M4 | remove `continue` after pushing the unobservable finding | `dropping the finding` or a duplicate-id assertion |
| M5 | remove `.sort()` from `blockerIds` | `a mere reordering ... must NOT lapse a decision` |
| M6 | drop `blockers` from `factInputs` | `ac-1=FAIL and ac-3=STALE sharing one fingerprint` |
| M7 | restore `suggestedAction` to `Update status in ... to: status: done` | `FORBIDDEN: ... recommends hand-editing status: done` |
| M8 | revert `PLANNING_RULE_VERSIONS.R011` to 1 | `R011 ruleVersion must bump` |

A red landing anywhere else — an unrelated block, a crash, a non-zero exit alone — is `INEFFECTIVE — guard is decorative` and must be recorded as such, not relabelled. An INEFFECTIVE row is a legitimate and valuable outcome; do not massage a fixture until it goes red.

- [ ] **Step 4: Record the matrix**

Write `docs/validation/r011-closure-router-mutation-matrix.md` with one row per mutation: mutation applied and its replacement count, the fixture's path through the target branch on the green baseline, the exact failing assertion text, the restored sha256, and an explicit `effective` / `INEFFECTIVE — guard is decorative` verdict.

- [ ] **Step 5: Verify and commit**

```bash
git status --porcelain
node .evo-lite/cli/test.js
```

Expected: no modification outside the new doc and the test file; full suite green.

```bash
git add templates/cli/test/governance.js .evo-lite/cli/test/governance.js \
        docs/validation/r011-closure-router-mutation-matrix.md
git commit -F - <<'EOF'
test(gaps): pin R011's new contract on the real repo and prove each guard bears load

The two specs this defect was found on now report spec-closure-uncontracted
and receive no closure advice — reproducing, in code, the decision a human
made by hand on 2026-08-10 after checking three R011 suggestions and
accepting one.

Eight mutations recorded with the assertion each reddens.
EOF
```

---

## Out of scope

- `parse-markdown.js`'s checkbox → plan `status: done` promotion, and the release-blocker path it feeds — registered as `[a8a8]`, investigation required first.
- The three disagreeing archive-evidence mechanisms (`checkArchiveHits`, `hasArchiveEvidence`, and `backfill-evidence.js`'s matchers).
- `validateGitRef`'s fail-open catch and `loadArchiveEvidenceMap`'s swallow.
- `mem verify` folding hook or closure health into overall governance status — `[0ce0]`, contract not frozen.
- `spec:disposition-ledger`'s invalid contract.
- `takeover-session.js`'s dead `t.status === 'done'` filter.
- A supported closure path for contract-less specs.
