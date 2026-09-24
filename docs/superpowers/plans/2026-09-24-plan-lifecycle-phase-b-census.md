---
id: plan:plan-lifecycle-phase-b-census
status: draft
created: 2026-09-24
linkedSpec: spec:plan-lifecycle-authority
---

# Plan Lifecycle Phase B — Migration-Impact Census Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Authorization status:** this document was written under **Phase B PLAN AUTHORING** only.
Executing any task below needs the owner's separate **Phase B execution** authorization.
Tasks 5 and 6 carry their own owner gates on top of that.

**Goal:** Produce a reproducible, read-only census of every plan the Phase C migration would affect, and a decision table that the owner — not the agent — fills with exactly one target lifecycle per plan.

**Architecture:** Four additive pure functions carry the frozen lifecycle semantics (`parse-markdown.js`); the census and the decision completeness check are read-only functions next to the scanner (`planning/scan.js`); `mem plan census` is a thin CLI over them (`planning.js`). Nothing is wired into any existing consumer: the parsers, `pickActivePlan`, the portfolio rules and verification close behave byte-for-byte as today. The decision artifact is a table inside **this** plan document.

**Tech Stack:** Node.js (CommonJS), zero new dependencies. `git` via `child_process.execFileSync`. Tests in `templates/cli/test/governance.js` (`assert`, `createTempRuntimeRoot`, `writeText`, `runGit`, `runCli` from `./harness`).

**Spec:** `docs/superpowers/specs/2026-09-24-plan-lifecycle-authority-design.md` (`spec:plan-lifecycle-authority`, ADOPTED, main@18c514f) — §1, §4, §5.1, §6 Phase B, and `ac-migration-population-enumerable-before-switch` (AC7). No other AC is in scope; the other seven stay unverified until Phases C/D.

## Global Constraints

- **Read-only toward every existing plan.** No task edits any file under `docs/plans/` or `docs/superpowers/plans/` except **this** document. The 26 historical plans are never written.
- **No behavior change.** `parsePlanFile`, `parseSuperPowersPlan`, `scanPlanning`, `pickActivePlan`, the no-active-plan nudge, every spec-portfolio rule and `verification/close-preview` / `close-apply` are not modified. Task 1 pins this with a behavior-freeze test.
- **The census never answers for the owner.** No function, output format or test fixture may emit a `decision`, a default, a suggestion or a ranking. `taskCompletion: complete` is an observation; it is **never** a reason to target `done` (spec §1, §4). Rendered decision cells are always empty.
- **Placement follows the frozen spec's criterion-level `dependsOn`.** AC7 depends on `planning/scan.js`, `planning/parse-markdown.js`, `memory.service.js`, `test/governance.js`. New code therefore goes into `parse-markdown.js` and `scan.js` — no new module, which would sit outside every criterion's `dependsOn` and leave AC7 evidence un-STALE-able.
- **Never `require('memory.service')` from census code.** It loads `db.js` → `better-sqlite3` (verified: fails to resolve from `templates/cli`). §5.1 eligibility is therefore implemented as a pure function in `parse-markdown.js` (also in AC7's and AC8's `dependsOn`); `pickActivePlan` keeps its current predicate until Phase C.
- **`buildSpecRegistry` is called only with `{ write: false }`** (spec-portfolio.js:580 — the default writes the registry).
- **Recognized plan statuses, verbatim from spec §1:** `draft` · `active` · `parked` · `done` · `unknown`. `taskCompletion` values: `complete` · `incomplete` · `no-tracked-work`.
- **Decision grammar, verbatim from spec §4:** `target <recognized-status>` or `leave unknown`; `leave unknown` is valid only when the plan has no authored `status`.
- **Never edit `.evo-lite/cli/**` directly.** It is a mirror; Task 4 refreshes it with `node .evo-lite/cli/memory.js sync-runtime`.
- **Test command for Tasks 1–4: `node ./templates/cli/test.js governance`** (the canonical runner; `.evo-lite/cli/test.js` runs the stale mirror until Task 4). The suite takes 3–5 minutes.
- **Exit code decides.** `exit != 0` is FAIL, with one narrow amnesty only: all of (1) the step's own `✅ T-… passed` line present, (2) `--- Governance-focused CLI tests passed! ---` present, (3) no error or stack trace of any kind, (4) the sole non-zero cause is the known `verify-spec-portfolio-clean` temp-cleanup `EBUSY … memory.db`. Any other `EBUSY` — especially one naming a fixture added by this plan — is a FAIL (Backlog `[governance-test-ebusy-amnesty-overbreadth]`).

---

### Task 1: Lifecycle semantics as additive pure functions

**Files:**
- Modify: `templates/cli/planning/parse-markdown.js` (new functions before `// --- Public API ---`; extend `module.exports` at the bottom)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `RECOGNIZED_PLAN_STATUSES: readonly string[]` — `['draft','active','parked','done','unknown']`
  - `authoredLifecycle(frontmatter) -> { status: string, provenance: 'authored'|'unspecified', authoredStatus: string|null, recognized: boolean }`
  - `taskCompletionOf(tasks) -> 'complete'|'incomplete'|'no-tracked-work'`
  - `activePlanPriority(status) -> 1|2|null` — spec §5.1: `active` → 1, `draft` → 2, everything else → `null`

- [ ] **Step 1: Write the failing test**

Add inside `runGovernanceTests()` in `templates/cli/test/governance.js`, directly after the block that ends with `console.log('✅ T-record-only-state passed');`:

```js
        console.log('T-plan-lifecycle-contract. Testing the additive plan lifecycle functions ...');
        {
            const pm = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'parse-markdown'));

            assert.deepStrictEqual([...pm.RECOGNIZED_PLAN_STATUSES], ['draft', 'active', 'parked', 'done', 'unknown']);

            // Provenance records the source, not the value (spec §1 table).
            assert.deepStrictEqual(pm.authoredLifecycle({}),
                { status: 'unknown', provenance: 'unspecified', authoredStatus: null, recognized: true });
            assert.deepStrictEqual(pm.authoredLifecycle({ status: 'unknown' }),
                { status: 'unknown', provenance: 'authored', authoredStatus: 'unknown', recognized: true },
                'an explicitly written unknown is authored, not unspecified');
            assert.deepStrictEqual(pm.authoredLifecycle({ status: 'done' }),
                { status: 'done', provenance: 'authored', authoredStatus: 'done', recognized: true });
            assert.deepStrictEqual(pm.authoredLifecycle({ status: 'in_progress' }),
                { status: 'in_progress', provenance: 'authored', authoredStatus: 'in_progress', recognized: false },
                'an unrecognized value is preserved verbatim, never coerced');

            assert.strictEqual(pm.taskCompletionOf([]), 'no-tracked-work');
            assert.strictEqual(pm.taskCompletionOf(undefined), 'no-tracked-work');
            assert.strictEqual(pm.taskCompletionOf([{ status: 'implemented' }]), 'complete');
            assert.strictEqual(pm.taskCompletionOf([{ status: 'implemented' }, { status: 'todo' }]), 'incomplete');

            assert.strictEqual(pm.activePlanPriority('active'), 1);
            assert.strictEqual(pm.activePlanPriority('draft'), 2);
            for (const s of ['unknown', 'parked', 'done', 'in_progress', 'closed-completed']) {
                assert.strictEqual(pm.activePlanPriority(s), null, `${s} must never be eligible`);
            }

            // Behavior freeze: Phase B adds functions; it must not change what the
            // parsers return today. Phase C is where these outputs change.
            const dir = createTempRuntimeRoot('plan-lifecycle-freeze').workspaceRoot;
            const spFile = path.join(dir, 'docs', 'superpowers', 'plans', '2026-01-01-freeze.md');
            writeText(spFile, ['# Freeze', '', '### Task 1: Do', '', '- [x] **Step 1: act**', ''].join('\n'));
            assert.strictEqual(pm.parsePlanFile(spFile).status, 'done',
                'Superpowers derivation must be unchanged in Phase B');
            const nFile = path.join(dir, 'docs', 'plans', 'freeze-native.md');
            writeText(nFile, ['---', 'id: plan:freeze-native', '---', '# N', '', '- [x] [task:fn-a] A', ''].join('\n'));
            assert.strictEqual(pm.parsePlanFile(nFile).status, 'unknown',
                'native default must be unchanged in Phase B');
            console.log('✅ T-plan-lifecycle-contract passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL at `T-plan-lifecycle-contract` — `pm.RECOGNIZED_PLAN_STATUSES` is not iterable (undefined).

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/planning/parse-markdown.js`, insert immediately above the line `// --- Public API ---`:

```js
// --- Plan lifecycle contract (spec:plan-lifecycle-authority §1, §5.1) ---
//
// Additive and UNWIRED in Phase B: parsePlanFile / parseSuperPowersPlan do not
// call these yet. Phase C switches the parsers and consumers onto them in one
// atomic change. Until then they are consumed only by the migration census.
const RECOGNIZED_PLAN_STATUSES = Object.freeze(['draft', 'active', 'parked', 'done', 'unknown']);

// Lifecycle comes from authored frontmatter only. Provenance records where the
// value came from, not what it is: an absent key is `unspecified`; a written
// `status: unknown` is `authored`.
function authoredLifecycle(frontmatter) {
    const fm = frontmatter || {};
    if (!Object.prototype.hasOwnProperty.call(fm, 'status')) {
        return { status: 'unknown', provenance: 'unspecified', authoredStatus: null, recognized: true };
    }
    const raw = String(fm.status);
    return { status: raw, provenance: 'authored', authoredStatus: raw, recognized: RECOGNIZED_PLAN_STATUSES.includes(raw) };
}

// An observation of the plan's tracked task markers. It never moves lifecycle.
function taskCompletionOf(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    if (list.length === 0) return 'no-tracked-work';
    return list.every(t => t && t.status === 'implemented') ? 'complete' : 'incomplete';
}

// §5.1: authored `active` first, authored `draft` second; nothing else is ever
// eligible, and taskCompletion plays no part.
function activePlanPriority(status) {
    if (status === 'active') return 1;
    if (status === 'draft') return 2;
    return null;
}

```

Then extend the existing `module.exports` object at the bottom of the same file by adding these four names to it:

```js
    RECOGNIZED_PLAN_STATUSES, authoredLifecycle, taskCompletionOf, activePlanPriority,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: `✅ T-plan-lifecycle-contract passed`, suite banner present, exit 0 (or the narrow amnesty in Global Constraints).

- [ ] **Step 5: Mutation check (guard must hit its own assertion)**

Temporarily change `if (list.length === 0) return 'no-tracked-work';` to `if (list.length === 0) return 'complete';`, run `node ./templates/cli/test.js governance`, and confirm the red lands on `assert.strictEqual(pm.taskCompletionOf([]), 'no-tracked-work')` inside `T-plan-lifecycle-contract` — not on an unrelated failure. Revert, re-run, confirm green.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/planning/parse-markdown.js templates/cli/test/governance.js
git commit -m "feat(planning): add unwired plan lifecycle functions for Phase B census"
```

### Task 2: Read-only migration-impact census

**Files:**
- Modify: `templates/cli/planning/scan.js` (new functions above `module.exports`; extend imports and exports)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `authoredLifecycle`, `taskCompletionOf`, `activePlanPriority`, `parseFrontmatter` from `./parse-markdown` (Task 1); `scanPlanning` (same file); `buildSpecRegistry(projectRoot, { write: false })` from `../spec-portfolio`.
- Produces:
  - `buildMigrationCensus(projectRoot) -> { version: 'evo-plan-census@1', headSha: string|null, rows: CensusRow[], counts: { parser, eligibility, total }, populationDigest: string, unresolvedPlans: string[] }`
  - `CensusRow = { planId, impactSet: 'parser'|'eligibility', authoredStatus: string /* 'absent' when no key */, currentEffectiveStatus, convergedStatus, taskCompletion, sourcePath, linkedSpecs: {id, state}[], evidence: { gitAvailable, merges: {sha, pr: number|null}[], lastCommit: {sha, date}|null } }`
  - `populationDigest(rows) -> 'sha256:<hex>'` — order-independent; covers identity fields only
  - `CENSUS_IDENTITY_FIELDS: readonly string[]`

- [ ] **Step 1: Write the failing test**

First add this module-level helper to `templates/cli/test/governance.js`, directly below the existing `createObservationRepo` function:

```js
// Content hash of a workspace, excluding .git. A read-only operation must leave
// it identical — the census is not allowed to write anywhere, including .evo-lite.
function hashWorkspaceTree(root) {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256');
    const walk = dir => {
        for (const name of fs.readdirSync(dir).sort()) {
            if (name === '.git') continue;
            const abs = path.join(dir, name);
            const st = fs.statSync(abs);
            if (st.isDirectory()) walk(abs);
            else h.update(path.relative(root, abs).replace(/\\/g, '/')).update('\0').update(fs.readFileSync(abs)).update('\0');
        }
    };
    walk(root);
    return h.digest('hex');
}
```

Then add inside `runGovernanceTests()`, directly after the `T-plan-lifecycle-contract` block:

```js
        console.log('T-plan-census-population. Testing the migration-impact census (parser ∪ eligibility) ...');
        {
            const scan = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'scan'));
            const root = createTempRuntimeRoot('plan-census').workspaceRoot;
            const fm = lines => ['---', ...lines, '---', ''].join('\n');
            const sp = (title, checked) => ['# ' + title, '', '### Task 1: Do it', '', `- [${checked ? 'x' : ' '}] **Step 1: act**`, ''].join('\n');
            const P = rel => path.join(root, ...rel.split('/'));

            // parser set: no authored status, every task checked -> today `done`, converged `unknown`
            writeText(P('docs/superpowers/plans/2026-01-01-legacy-done.md'), sp('Legacy done', true));
            // parser set: no authored status, unchecked -> today `draft`, converged `unknown`
            writeText(P('docs/superpowers/plans/2026-01-02-legacy-draft.md'), sp('Legacy draft', false));
            // eligibility set — the negative control: authored active + complete + spec closed-record-only.
            // Three distinct facts; none of them may be inferred from another.
            writeText(P('docs/superpowers/plans/2026-01-03-active-closed.md'),
                fm(['id: plan:active-closed', 'status: active', 'linkedSpec: spec:closed']) + sp('Active closed', true));
            writeText(P('docs/specs/closed.md'),
                fm(['id: spec:closed', 'status: closed-record-only', 'linkedPlan: plan:active-closed',
                    'closureBasis: record-only', 'closureReason: fixture', 'closureRecordedAt: 2026-01-03']) + '# Closed\n');
            // outside the population
            writeText(P('docs/superpowers/plans/2026-01-04-authored-draft.md'), fm(['status: draft']) + sp('Authored draft', false));
            writeText(P('docs/superpowers/plans/2026-01-05-authored-done.md'), fm(['status: done']) + sp('Authored done', false));
            writeText(P('docs/plans/native-nostatus.md'), fm(['id: plan:native-nostatus']) + '# Native\n\n- [x] [task:nn-a] A\n');

            runGit(root, ['init']);
            runGit(root, ['config', 'user.name', 'Evo Test']);
            runGit(root, ['config', 'user.email', 'evo@example.com']);
            runGit(root, ['add', '.']);
            runGit(root, ['commit', '-m', 'baseline']);
            // One merge touching legacy-done, so evidence has a PR to report.
            runGit(root, ['checkout', '-b', 'feat']);
            fs.appendFileSync(P('docs/superpowers/plans/2026-01-01-legacy-done.md'), '\n');
            runGit(root, ['commit', '-am', 'touch legacy-done']);
            runGit(root, ['checkout', '-']);
            runGit(root, ['merge', '--no-ff', 'feat', '-m', 'Merge pull request #7 from o/feat']);

            const before = hashWorkspaceTree(root);
            const census = scan.buildMigrationCensus(root);
            assert.strictEqual(hashWorkspaceTree(root), before, 'the census must write nothing, anywhere');

            assert.strictEqual(census.version, 'evo-plan-census@1');
            assert.ok(/^[0-9a-f]{40}$/.test(census.headSha), 'census pins the HEAD it was computed on');
            assert.deepStrictEqual(census.counts, { parser: 2, eligibility: 1, total: 3 });
            assert.deepStrictEqual(census.rows.map(r => r.planId),
                ['plan:active-closed', 'plan:legacy-done', 'plan:legacy-draft']);
            assert.deepStrictEqual(census.unresolvedPlans, []);

            const byId = Object.fromEntries(census.rows.map(r => [r.planId, r]));
            const pick = r => ({ impactSet: r.impactSet, authoredStatus: r.authoredStatus,
                currentEffectiveStatus: r.currentEffectiveStatus, convergedStatus: r.convergedStatus, taskCompletion: r.taskCompletion });
            assert.deepStrictEqual(pick(byId['plan:legacy-done']),
                { impactSet: 'parser', authoredStatus: 'absent', currentEffectiveStatus: 'done', convergedStatus: 'unknown', taskCompletion: 'complete' });
            assert.deepStrictEqual(pick(byId['plan:legacy-draft']),
                { impactSet: 'parser', authoredStatus: 'absent', currentEffectiveStatus: 'draft', convergedStatus: 'unknown', taskCompletion: 'incomplete' });
            assert.deepStrictEqual(pick(byId['plan:active-closed']),
                { impactSet: 'eligibility', authoredStatus: 'active', currentEffectiveStatus: 'active', convergedStatus: 'active', taskCompletion: 'complete' });
            assert.deepStrictEqual(byId['plan:active-closed'].linkedSpecs, [{ id: 'spec:closed', state: 'closed-record-only' }]);

            const ev = byId['plan:legacy-done'].evidence;
            assert.strictEqual(ev.gitAvailable, true);
            assert.deepStrictEqual(ev.merges.map(m => m.pr), [7], 'evidence reports the merge that touched the plan');

            // No field of any row may carry an answer.
            for (const r of census.rows) {
                assert.deepStrictEqual(Object.keys(r).filter(k => /decision|suggest|recommend|target|default/i.test(k)), [],
                    `${r.planId}: the census states facts, never a decision`);
            }

            // Reproducible: same HEAD -> identical census; digest ignores row order.
            assert.deepStrictEqual(scan.buildMigrationCensus(root), census, 'census must be deterministic');
            assert.strictEqual(scan.populationDigest(census.rows.slice().reverse()), census.populationDigest);
            // Digest covers identity fields only: evidence context may drift, identity may not.
            const tweaked = census.rows.map(r => Object.assign({}, r, { evidence: { gitAvailable: false, merges: [], lastCommit: null } }));
            assert.strictEqual(scan.populationDigest(tweaked), census.populationDigest);
            const moved = census.rows.map(r => r.planId === 'plan:legacy-draft' ? Object.assign({}, r, { convergedStatus: 'draft' }) : r);
            assert.notStrictEqual(scan.populationDigest(moved), census.populationDigest);
            console.log('✅ T-plan-census-population passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL at `T-plan-census-population` — `scan.buildMigrationCensus is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/planning/scan.js`:

(a) Replace the existing import line

```js
const { parseSpecFile, parsePlanFile, parseFrontmatter, resolveLinkedPlanIds } = require('./parse-markdown');
```

with

```js
const { parseSpecFile, parsePlanFile, parseFrontmatter, resolveLinkedPlanIds,
    authoredLifecycle, taskCompletionOf, activePlanPriority } = require('./parse-markdown');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
```

(b) Insert immediately above `module.exports`:

```js
// --- Migration-impact census (spec:plan-lifecycle-authority §4, Phase B) ---
//
// READ-ONLY, and it answers nothing. The census states facts; the owner states
// targets. No function here may emit a decision, a default or a suggestion —
// `taskCompletion: complete` is an observation, never a reason to target `done`.

// Census-only copy of today's pickActivePlan predicate (memory.service.js,
// main@18c514f). It describes the pre-migration world so the eligibility
// population is computable without loading memory.service.js, which pulls in
// the native sqlite driver. Phase C replaces pickActivePlan itself.
function legacyActivePlanEligible(status) {
    return status === 'in_progress' || status === 'draft';
}

const CENSUS_IDENTITY_FIELDS = Object.freeze(['planId', 'impactSet', 'authoredStatus',
    'currentEffectiveStatus', 'convergedStatus', 'taskCompletion']);

// Identity only: evidence and linked-spec context may drift between HEADs
// without changing who is in the population or what their facts are.
function populationDigest(rows) {
    const canonical = rows
        .map(r => CENSUS_IDENTITY_FIELDS.map(k => r[k]))
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function gitLines(projectRoot, args) {
    try {
        const out = execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return { ok: true, lines: out.split(/\r?\n/).filter(Boolean) };
    } catch (_) {
        return { ok: false, lines: [] };
    }
}

// Mechanical observations only: which first-parent merges touched the plan file,
// and when it was last touched. Evidence for the owner's judgement, not a verdict.
function collectPlanEvidence(projectRoot, relPath) {
    const log = gitLines(projectRoot, ['log', '--first-parent', '--format=%H%x1f%cs%x1f%s', '--', relPath]);
    if (!log.ok) return { gitAvailable: false, merges: [], lastCommit: null };
    const commits = log.lines.map(line => {
        const [sha, date, subject] = line.split('\x1f');
        return { sha, date, subject: subject || '' };
    });
    const merges = commits
        .filter(c => /^Merge (pull request|branch)/.test(c.subject))
        .map(c => {
            const m = c.subject.match(/^Merge pull request #(\d+)/);
            return { sha: c.sha.slice(0, 7), pr: m ? Number(m[1]) : null };
        });
    const lastCommit = commits[0] ? { sha: commits[0].sha.slice(0, 7), date: commits[0].date } : null;
    return { gitAvailable: true, merges, lastCommit };
}

function buildMigrationCensus(projectRoot) {
    const ir = scanPlanning(projectRoot);
    const tasksByPlan = new Map();
    for (const t of ir.tasks) {
        if (!tasksByPlan.has(t.linkedPlan)) tasksByPlan.set(t.linkedPlan, []);
        tasksByPlan.get(t.linkedPlan).push(t);
    }
    // Spec state is navigation context for the owner — never an input to
    // population membership, and excluded from populationDigest.
    const { buildSpecRegistry } = require('../spec-portfolio');
    const registry = buildSpecRegistry(projectRoot, { write: false });

    const rows = [];
    const unresolvedPlans = [];
    for (const plan of ir.plans) {
        if (!plan.sourcePath) { unresolvedPlans.push(plan.id); continue; }
        const content = fs.readFileSync(path.join(projectRoot, plan.sourcePath), 'utf8');
        const lifecycle = authoredLifecycle(parseFrontmatter(content).frontmatter);
        const current = plan.status;
        const converged = lifecycle.status;

        let impactSet = null;
        if (converged !== current) {
            impactSet = 'parser';
        } else if (legacyActivePlanEligible(current) !== (activePlanPriority(converged) !== null)) {
            impactSet = 'eligibility';
        }
        if (!impactSet) continue;

        const linkedSpecs = registry.specs
            .filter(s => (s.linkedPlans || []).includes(plan.id) || s.id === plan.linkedSpec)
            .map(s => ({ id: s.id, state: s.state }));
        if (plan.linkedSpec && !linkedSpecs.some(s => s.id === plan.linkedSpec)) {
            linkedSpecs.push({ id: plan.linkedSpec, state: 'unresolved' });
        }
        linkedSpecs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        rows.push({
            planId: plan.id,
            impactSet,
            authoredStatus: lifecycle.authoredStatus === null ? 'absent' : lifecycle.authoredStatus,
            currentEffectiveStatus: current,
            convergedStatus: converged,
            taskCompletion: taskCompletionOf(tasksByPlan.get(plan.id)),
            sourcePath: plan.sourcePath,
            linkedSpecs,
            evidence: collectPlanEvidence(projectRoot, plan.sourcePath),
        });
    }
    rows.sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0));
    const head = gitLines(projectRoot, ['rev-parse', 'HEAD']);
    return {
        version: 'evo-plan-census@1',
        headSha: head.ok && head.lines[0] ? head.lines[0] : null,
        rows,
        counts: {
            parser: rows.filter(r => r.impactSet === 'parser').length,
            eligibility: rows.filter(r => r.impactSet === 'eligibility').length,
            total: rows.length,
        },
        populationDigest: populationDigest(rows),
        unresolvedPlans: unresolvedPlans.sort(),
    };
}

```

(c) Replace `module.exports = { scanPlanning, writePlanIR };` with

```js
module.exports = { scanPlanning, writePlanIR, buildMigrationCensus, populationDigest, CENSUS_IDENTITY_FIELDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: `✅ T-plan-census-population passed`, banner present, exit 0 (or the narrow amnesty). No `EBUSY` naming `evo-lite-plan-census-*`.

- [ ] **Step 5: Mutation checks**

(a) Replace the `else if (legacyActivePlanEligible(...) ...)` branch condition with `else if (false)`; confirm the red lands on the `census.counts` assertion (`eligibility: 1`). (b) Add `decision: ''` to the pushed row object; confirm the red lands on the "never a decision" assertion. Revert both; re-run green.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/planning/scan.js templates/cli/test/governance.js
git commit -m "feat(planning): read-only migration-impact census (parser ∪ eligibility)"
```

### Task 3: Decision table rendering and completeness check

**Files:**
- Modify: `templates/cli/planning/scan.js` (below `buildMigrationCensus`; extend imports and exports)
- Test: `templates/cli/test/governance.js`

**Interfaces:**
- Consumes: `CensusRow`, `populationDigest`, `CENSUS_IDENTITY_FIELDS` (Task 2); `RECOGNIZED_PLAN_STATUSES` (Task 1).
- Produces:
  - `CENSUS_COLUMNS: readonly string[]` — `planId, impactSet, authoredStatus, currentEffectiveStatus, convergedStatus, taskCompletion, linkedSpec, linkedSpecState, evidence, decision, decisionReason`
  - `renderCensusMarkdown(census) -> string` — a `<!-- BEGIN_CENSUS -->` … `<!-- END_CENSUS -->` block; decision cells always empty
  - `parseCensusBlock(text) -> { header: {version, headSha, populationDigest, rows}|null, rows: Record<column,string>[] } | null`
  - `checkCensusDecisions(census, docText) -> { ok: boolean, errors: {kind, planId, detail}[], decided: number, undecided: number }` with `kind` ∈ `no-census-block`, `digest-mismatch`, `extra-row`, `missing-row`, `duplicate-row`, `row-mismatch`, `undecided`, `invalid-decision`, `leave-unknown-on-authored`, `missing-reason`

- [ ] **Step 1: Write the failing test**

Add directly after the `T-plan-census-population` block:

```js
        console.log('T-plan-census-decisions. Testing the decision table and its completeness check ...');
        {
            const scan = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'scan'));
            const rows = [
                { planId: 'plan:a', impactSet: 'parser', authoredStatus: 'absent', currentEffectiveStatus: 'done',
                  convergedStatus: 'unknown', taskCompletion: 'complete', sourcePath: 'a.md', linkedSpecs: [],
                  evidence: { gitAvailable: true, merges: [{ sha: 'abc1234', pr: 36 }], lastCommit: { sha: 'abc1234', date: '2026-08-09' } } },
                { planId: 'plan:b', impactSet: 'eligibility', authoredStatus: 'active', currentEffectiveStatus: 'active',
                  convergedStatus: 'active', taskCompletion: 'complete', sourcePath: 'b.md',
                  linkedSpecs: [{ id: 'spec:b', state: 'closed-record-only' }],
                  evidence: { gitAvailable: false, merges: [], lastCommit: null } },
            ];
            const census = { version: 'evo-plan-census@1', headSha: 'f'.repeat(40), rows,
                counts: { parser: 1, eligibility: 1, total: 2 }, populationDigest: scan.populationDigest(rows), unresolvedPlans: [] };

            const md = scan.renderCensusMarkdown(census);
            const parsed = scan.parseCensusBlock(md);
            assert.strictEqual(parsed.header.populationDigest, census.populationDigest);
            assert.strictEqual(parsed.rows.length, 2);
            for (const r of parsed.rows) {
                assert.strictEqual(r.decision, '', `${r.planId}: the rendered table must not pre-fill a decision`);
                assert.strictEqual(r.decisionReason, '', `${r.planId}: nor a reason`);
            }
            assert.ok(!/target |leave unknown/.test(md), 'rendered census contains no decision text at all');

            // Fresh census: every row undecided, nothing else wrong — the owner has work to do.
            const fresh = scan.checkCensusDecisions(census, md);
            assert.strictEqual(fresh.ok, false);
            assert.deepStrictEqual(fresh.errors.map(e => e.kind), ['undecided', 'undecided']);
            assert.strictEqual(fresh.undecided, 2);

            const decide = (text, planId, decision, reason) => text.split('\n')
                .map(l => (l.startsWith(`| ${planId} |`) ? l.replace(/\|\s*\|\s*\|$/, `| ${decision} | ${reason} |`) : l))
                .join('\n');
            const kinds = text => scan.checkCensusDecisions(census, text).errors.map(e => e.kind).sort();

            const good = decide(decide(md, 'plan:a', 'target done', 'owner: shipped in PR #36'),
                'plan:b', 'target active', 'owner: keep active pending review');
            const ok = scan.checkCensusDecisions(census, good);
            assert.deepStrictEqual(ok.errors, []);
            assert.strictEqual(ok.ok, true);
            assert.strictEqual(ok.decided, 2);

            assert.deepStrictEqual(kinds(decide(decide(md, 'plan:a', 'leave unknown', 'owner: no lifecycle record'),
                'plan:b', 'target active', 'owner: keep')), [], 'leave unknown is valid for a plan with no authored status');
            assert.deepStrictEqual(kinds(decide(good.replace('| target active | owner: keep active pending review |', '|  |  |'),
                'plan:b', 'leave unknown', 'owner: x')), ['leave-unknown-on-authored']);
            assert.deepStrictEqual(kinds(good.replace('owner: shipped in PR #36', '')), ['missing-reason']);
            assert.deepStrictEqual(kinds(good.replace('target done', 'target finished')), ['invalid-decision']);
            assert.deepStrictEqual(kinds(good.replace('target done', 'done')), ['invalid-decision']);

            const lines = good.split('\n');
            const rowA = lines.find(l => l.startsWith('| plan:a |'));
            const rowB = lines.find(l => l.startsWith('| plan:b |'));
            assert.deepStrictEqual(kinds(lines.filter(l => l !== rowB).join('\n')), ['missing-row']);
            assert.deepStrictEqual(kinds(good.replace(rowA, `${rowA}\n${rowA}`)), ['duplicate-row']);
            assert.deepStrictEqual(kinds(good.replace(rowA, `${rowA}\n${rowA.replace('plan:a', 'plan:zzz')}`)), ['extra-row']);
            assert.deepStrictEqual(kinds(good.replace(rowA, rowA.replace('| done | unknown |', '| done | done |'))), ['row-mismatch']);
            assert.deepStrictEqual(kinds(good.replace(census.populationDigest, 'sha256:' + '0'.repeat(64))), ['digest-mismatch']);
            assert.deepStrictEqual(kinds('no block here'), ['no-census-block']);
            console.log('✅ T-plan-census-decisions passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL at `T-plan-census-decisions` — `scan.renderCensusMarkdown is not a function`.

- [ ] **Step 3: Write minimal implementation**

(a) In `templates/cli/planning/scan.js`, add `RECOGNIZED_PLAN_STATUSES` to the `require('./parse-markdown')` destructuring from Task 2.

(b) Insert directly below `buildMigrationCensus`:

```js
const CENSUS_COLUMNS = Object.freeze(['planId', 'impactSet', 'authoredStatus', 'currentEffectiveStatus',
    'convergedStatus', 'taskCompletion', 'linkedSpec', 'linkedSpecState', 'evidence', 'decision', 'decisionReason']);
const DECISION_RE = /^(?:target (\S+)|leave unknown)$/;

function censusCell(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatEvidence(ev) {
    if (!ev || !ev.gitAvailable) return 'git unavailable';
    const parts = ev.merges.map(m => (m.pr ? `PR #${m.pr} (${m.sha})` : `merge ${m.sha}`));
    if (ev.lastCommit) parts.push(`last ${ev.lastCommit.date} ${ev.lastCommit.sha}`);
    return parts.join('; ') || 'none';
}

// The decision cells are ALWAYS rendered empty. Filling them is the owner's act.
function renderCensusMarkdown(census) {
    const lines = [
        '<!-- BEGIN_CENSUS -->',
        `<!-- census version=${census.version} headSha=${census.headSha} populationDigest=${census.populationDigest} rows=${census.rows.length} -->`,
        '',
        `| ${CENSUS_COLUMNS.join(' | ')} |`,
        `| ${CENSUS_COLUMNS.map(() => '---').join(' | ')} |`,
    ];
    for (const r of census.rows) {
        const specIds = r.linkedSpecs.map(s => s.id).join(', ') || '(none)';
        const specStates = r.linkedSpecs.map(s => s.state).join(', ') || '(none)';
        const cells = [r.planId, r.impactSet, r.authoredStatus, r.currentEffectiveStatus, r.convergedStatus,
            r.taskCompletion, specIds, specStates, formatEvidence(r.evidence)].map(censusCell);
        lines.push(`| ${cells.join(' | ')} |  |  |`);
    }
    lines.push('', '<!-- END_CENSUS -->');
    return `${lines.join('\n')}\n`;
}

function splitCensusRow(line) {
    const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i++; continue; }
        if (inner[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
        cur += inner[i];
    }
    cells.push(cur.trim());
    return cells;
}

function parseCensusBlock(text) {
    const m = String(text).match(/<!-- BEGIN_CENSUS -->([\s\S]*?)<!-- END_CENSUS -->/);
    if (!m) return null;
    const h = m[1].match(/<!-- census version=(\S+) headSha=(\S+) populationDigest=(\S+) rows=(\d+) -->/);
    const rows = [];
    for (const line of m[1].split(/\r?\n/)) {
        if (!line.trim().startsWith('|')) continue;
        const cells = splitCensusRow(line);
        if (cells[0] === 'planId' || /^-+$/.test(cells[0])) continue;
        const rec = {};
        CENSUS_COLUMNS.forEach((col, i) => { rec[col] = cells[i] || ''; });
        rows.push(rec);
    }
    return {
        header: h ? { version: h[1], headSha: h[2], populationDigest: h[3], rows: Number(h[4]) } : null,
        rows,
    };
}

// Completeness is set equality between the LIVE census and the decided table,
// with exactly one valid decision per plan. It validates the owner's answers;
// it never supplies one.
function checkCensusDecisions(census, docText) {
    const block = parseCensusBlock(docText);
    if (!block) {
        return { ok: false, decided: 0, undecided: 0,
            errors: [{ kind: 'no-census-block', planId: null, detail: 'no <!-- BEGIN_CENSUS --> ... <!-- END_CENSUS --> block' }] };
    }
    const errors = [];
    if (!block.header || block.header.populationDigest !== census.populationDigest) {
        errors.push({ kind: 'digest-mismatch', planId: null,
            detail: `recorded ${block.header ? block.header.populationDigest : '<none>'} != live ${census.populationDigest}` });
    }
    const live = new Map(census.rows.map(r => [r.planId, r]));
    const seen = new Map();
    let decided = 0;
    let undecided = 0;
    for (const row of block.rows) {
        seen.set(row.planId, (seen.get(row.planId) || 0) + 1);
        const liveRow = live.get(row.planId);
        if (!liveRow) {
            errors.push({ kind: 'extra-row', planId: row.planId, detail: 'not in the live migration-impact population' });
            continue;
        }
        for (const k of CENSUS_IDENTITY_FIELDS) {
            if (row[k] !== String(liveRow[k])) {
                errors.push({ kind: 'row-mismatch', planId: row.planId, detail: `${k}: recorded ${row[k]} != live ${liveRow[k]}` });
            }
        }
        if (!row.decision) {
            undecided++;
            errors.push({ kind: 'undecided', planId: row.planId, detail: 'no owner decision recorded' });
            continue;
        }
        const d = row.decision.match(DECISION_RE);
        if (!d) {
            errors.push({ kind: 'invalid-decision', planId: row.planId, detail: `unparseable decision: ${row.decision}` });
            continue;
        }
        if (d[1] !== undefined && !RECOGNIZED_PLAN_STATUSES.includes(d[1])) {
            errors.push({ kind: 'invalid-decision', planId: row.planId, detail: `target ${d[1]} is not a recognized plan status` });
            continue;
        }
        if (d[1] === undefined && liveRow.authoredStatus !== 'absent') {
            errors.push({ kind: 'leave-unknown-on-authored', planId: row.planId,
                detail: `authored status ${liveRow.authoredStatus} cannot be left unknown; use target <status>` });
            continue;
        }
        if (!row.decisionReason) {
            errors.push({ kind: 'missing-reason', planId: row.planId, detail: "a decision needs the owner's decisionReason" });
            continue;
        }
        decided++;
    }
    for (const [planId, n] of seen) {
        if (n > 1) errors.push({ kind: 'duplicate-row', planId, detail: `${n} rows` });
    }
    for (const planId of live.keys()) {
        if (!seen.has(planId)) errors.push({ kind: 'missing-row', planId, detail: 'in the live population but absent from the table' });
    }
    return { ok: errors.length === 0, errors, decided, undecided };
}

```

(c) Extend `module.exports` to:

```js
module.exports = { scanPlanning, writePlanIR, buildMigrationCensus, populationDigest, CENSUS_IDENTITY_FIELDS,
    CENSUS_COLUMNS, renderCensusMarkdown, parseCensusBlock, checkCensusDecisions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: `✅ T-plan-census-decisions passed`, banner present, exit 0 (or the narrow amnesty).

- [ ] **Step 5: Mutation checks**

(a) Delete the `leave-unknown-on-authored` branch; confirm the red lands on the `['leave-unknown-on-authored']` assertion. (b) Make `renderCensusMarkdown` emit `| target done |` in the decision cell; confirm the red lands on "must not pre-fill a decision". Revert both; re-run green.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/planning/scan.js templates/cli/test/governance.js
git commit -m "feat(planning): census decision table and set-equality completeness check"
```

### Task 4: `mem plan census` CLI, mirror sync, full verification

**Files:**
- Modify: `templates/cli/planning.js` (new `plan.command('census')`, directly after the `plan.command('ledger')` block)
- Test: `templates/cli/test/governance.js`
- Mirror: `.evo-lite/cli/**` via `sync-runtime` only

**Interfaces:**
- Consumes: `buildMigrationCensus`, `renderCensusMarkdown`, `checkCensusDecisions` (Tasks 2–3).
- Produces: `mem plan census` — default human summary; `--json` census JSON; `--markdown` decision table on stdout; `--check <file>` exits 1 unless the table in `<file>` is clean (`--json` with `--check` prints the check result). The command never writes a file.

- [ ] **Step 1: Write the failing test**

Add directly after the `T-plan-census-decisions` block:

```js
        console.log('T-plan-census-cli. Testing mem plan census end to end ...');
        {
            const root = createTempRuntimeRoot('plan-census-cli').workspaceRoot;
            writeText(path.join(root, 'docs', 'superpowers', 'plans', '2026-01-01-legacy-done.md'),
                ['# Legacy', '', '### Task 1: Do', '', '- [x] **Step 1: act**', ''].join('\n'));
            runGit(root, ['init']);
            runGit(root, ['config', 'user.name', 'Evo Test']);
            runGit(root, ['config', 'user.email', 'evo@example.com']);
            runGit(root, ['add', '.']);
            runGit(root, ['commit', '-m', 'baseline']);
            const docsBefore = hashWorkspaceTree(path.join(root, 'docs'));

            const j = runCli(root, ['plan', 'census', '--json']);
            assert.strictEqual(j.status, 0, j.stderr);
            const census = JSON.parse(j.stdout);
            assert.deepStrictEqual(census.counts, { parser: 1, eligibility: 0, total: 1 });

            const m = runCli(root, ['plan', 'census', '--markdown']);
            assert.strictEqual(m.status, 0, m.stderr);
            assert.ok(m.stdout.includes('<!-- BEGIN_CENSUS -->') && m.stdout.includes('| plan:legacy-done |'));

            // The decision doc lives OUTSIDE the workspace so the read-only assertion stays exact.
            const docPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evo-census-doc-')), 'decisions.md');
            fs.writeFileSync(docPath, m.stdout, 'utf8');
            const undecided = runCli(root, ['plan', 'census', '--check', docPath]);
            assert.strictEqual(undecided.status, 1, 'an undecided table must not pass');
            assert.ok(/NOT CLEAN/.test(undecided.stdout) && /\[undecided\] plan:legacy-done/.test(undecided.stdout));

            fs.writeFileSync(docPath, m.stdout.replace(/\|\s*\|\s*\|\n/, '| leave unknown | owner: fixture |\n'), 'utf8');
            const clean = runCli(root, ['plan', 'census', '--check', docPath]);
            assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
            assert.ok(/Census check: CLEAN/.test(clean.stdout));

            assert.strictEqual(hashWorkspaceTree(path.join(root, 'docs')), docsBefore, 'mem plan census must not touch any plan');
            assert.ok(!fs.existsSync(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json')),
                'census must not write the plan IR');
            console.log('✅ T-plan-census-cli passed');
        }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./templates/cli/test.js governance`
Expected: FAIL at `T-plan-census-cli` — non-zero status with `error: unknown command 'census'`.

- [ ] **Step 3: Write minimal implementation**

In `templates/cli/planning.js`, directly after the `plan.command('ledger')` block (before `plan.command('new <slug>')`):

```js
    plan.command('census')
        .description('Read-only migration-impact census (spec:plan-lifecycle-authority Phase B). Proposes no decisions.')
        .option('--json', 'Emit the census (or, with --check, the check result) as JSON.')
        .option('--markdown', 'Emit the decision table; decision cells are left empty for the owner.')
        .option('--check <file>', 'Check the decision table in <file> against the live census; exit 1 unless clean.')
        .action(options => {
            const { buildMigrationCensus, renderCensusMarkdown, checkCensusDecisions } = require('./planning/scan');
            const census = buildMigrationCensus(projectRoot);
            if (options.check) {
                const result = checkCensusDecisions(census, fs.readFileSync(path.resolve(options.check), 'utf8'));
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`Census check: ${result.ok ? 'CLEAN' : 'NOT CLEAN'} (decided ${result.decided}/${census.rows.length}, undecided ${result.undecided})`);
                    for (const e of result.errors) console.log(`- [${e.kind}] ${e.planId || '-'}: ${e.detail}`);
                }
                if (!result.ok) process.exitCode = 1;
                return;
            }
            if (options.json) { console.log(JSON.stringify(census, null, 2)); return; }
            if (options.markdown) { process.stdout.write(renderCensusMarkdown(census)); return; }
            console.log(`Migration-impact census @ ${census.headSha || '(no git HEAD)'}`);
            console.log(`  parser ${census.counts.parser} + eligibility ${census.counts.eligibility} = ${census.counts.total}`);
            console.log(`  populationDigest ${census.populationDigest}`);
            for (const r of census.rows) {
                console.log(`  ${r.planId}  [${r.impactSet}]  ${r.currentEffectiveStatus} -> ${r.convergedStatus}  taskCompletion=${r.taskCompletion}`);
            }
            if (census.unresolvedPlans.length > 0) console.log(`  unresolved (no source file): ${census.unresolvedPlans.join(', ')}`);
        });

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./templates/cli/test.js governance`
Expected: all four new `✅ T-plan-…` lines, banner present, exit 0 (or the narrow amnesty).

- [ ] **Step 5: Sync the mirror and run both runners**

```bash
node .evo-lite/cli/memory.js sync-runtime
node ./templates/cli/test.js governance
node ./.evo-lite/cli/test.js governance
node ./templates/cli/test.js integration
```

Expected: every run exits 0 (governance runs may use the narrow amnesty only). The mirror runner matters: in PR #75 a leak was invisible under the canonical runner and surfaced only under the mirror / packed consume. `git diff --stat` must show `.evo-lite/cli/` changes only in the three files this plan touched plus their tests.

- [ ] **Step 6: Scope audit**

```bash
git diff --stat main...HEAD -- docs/plans docs/superpowers/plans
```

Expected: exactly one file — this plan document. Then run `detect_changes({scope: "compare", base_ref: "main"})` and confirm the changed symbols are limited to the new functions and the `census` command; no existing parser, `pickActivePlan`, spec-portfolio rule or verification-close symbol may appear as modified.

- [ ] **Step 7: Commit**

```bash
git add templates/cli/planning.js templates/cli/test/governance.js .evo-lite/cli
git commit -m "feat(planning): mem plan census CLI (read-only, proposes no decisions)"
```

### Task 5: Record the census in this document (owner gate: execution authorization)

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md` (this file, section "Census & Decisions" only)

**Interfaces:**
- Consumes: `mem plan census --markdown`, `mem plan census --check` (Task 4).
- Produces: the decision artifact — the census block below, with every decision cell empty.

- [ ] **Step 1: Generate the census on the branch base**

```bash
git fetch origin
git merge-base HEAD origin/main
node .evo-lite/cli/memory.js plan census
```

Expected: `parser 24 + eligibility 2 = 26` if main has not gained or re-statused plans since main@18c514f. **Any other count is not an error to fix — record it as measured and state the difference in the commit message.** Confirm `plan:governance-observation-budget` and `plan:planning-truth-controls` appear with `[eligibility]`.

- [ ] **Step 2: Paste the table**

Replace the single line `<!-- census not generated yet: Task 5 -->` in the "Census & Decisions" section with the exact stdout of:

```bash
node .evo-lite/cli/memory.js plan census --markdown
```

Do not edit any cell. Do not fill `decision` or `decisionReason`.

- [ ] **Step 3: Verify the block round-trips**

```bash
node .evo-lite/cli/memory.js plan census --check docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md
```

Expected: exit 1 with `NOT CLEAN`, and **every** listed error is `[undecided]` — one per row, nothing else. Any other kind means the pasted table is wrong; regenerate, do not hand-fix.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md
git commit -m "docs(plan): record the Phase B migration-impact census (undecided)"
```

### Task 6: Owner decisions (OWNER ONLY)

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md` (the `decision` and `decisionReason` cells only)

**Interfaces:**
- Consumes: the undecided census block from Task 5.
- Produces: a clean `mem plan census --check` — the precondition for requesting Phase C authorization (spec §4). It does not grant that authorization.

The agent does not choose any value in this task. If asked for a view, the agent may point at the row's facts and evidence columns, and must name the three-fact distinction for rows like `plan:governance-observation-budget` (authored lifecycle, task-completion observation, linked-spec lifecycle are independent); it must not propose a `target`.

- [ ] **Step 1: Owner records one decision per row**

The owner fills each row's `decision` (`target <draft|active|parked|done|unknown>` or `leave unknown`) and `decisionReason`, either by editing the file or by giving the values in chat for the agent to transcribe **verbatim** into those two cells only.

- [ ] **Step 2: Check completeness**

```bash
node .evo-lite/cli/memory.js plan census --check docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md
```

Expected: exit 0, `Census check: CLEAN (decided 26/26, undecided 0)` (or the measured row count from Task 5). Any error goes back to the owner; the agent does not resolve it by picking a value.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-09-24-plan-lifecycle-phase-b-census.md
git commit -m "docs(plan): record owner migration decisions for Phase B census"
```

## Census & Decisions

<!-- census not generated yet: Task 5 -->
