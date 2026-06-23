---
id: plan:dogfood-operator-experience-phase2
linkedSpec: spec:dogfood-operator-experience-phase2
---

# Dogfood Operator Experience Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the common, mechanical governance chores self-healing so a
non-expert operator is not punished for ordinary actions (snapshots, hot-fixes,
config edits, `git pull`/`rebase`). Implements `spec:dogfood-operator-experience-phase2`.

**Architecture:** Reuse existing runtime surfaces. Generalize one R006 exemption
predicate, make the runtime-mirror lock check content-aware, add a conservative
focus auto-advance to the post-commit path, and add a focus-health planning drift
rule — all proven through the existing governance test slice.

**Tech Stack:** Node.js, Commander, existing `.evo-lite/generated/` JSON
artifacts, existing CLI integration test harness, existing `templates/cli → .evo-lite/cli` mirror flow.

---

## File Map

| File | Change |
|------|--------|
| `templates/cli/planning/gaps.js` | generalize `isGovernanceRuntimeFile()` exemption; add focus-health rule (R012) |
| `templates/cli/sync-runtime.js` | make `verifyRuntimeLock()` content-aware (mirror vs live templates) |
| `templates/cli/memory.service.js` | content-aware lock verdict in `verify()`; surface focus-health + focus-staleness advice |
| `templates/cli/hooks.js` | conservative commit-evidence focus auto-advance; post-merge self-heal |
| `templates/cli/test.js` | governance-slice coverage for all four behaviors |
| `.evo-lite/cli/*` | sync changed runtime files after each template edit |

---

### Task 1: Generalize the R006 traceability exemption

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Sync: `.evo-lite/cli/planning/gaps.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing exemption test**

In `templates/cli/test.js`, extend the governance slice with a case asserting
that a changed host-adapter / meta file produces no `R006`:

```js
console.log('T16. Testing R006 exempts host-adapter and meta files ...');
{
    const findings = checkR006(projectRoot, planIR, {
        changedFilesOverride: ['.claude/settings.local.json', 'CLAUDE.md', '.evo-lite/active_context.md'],
    });
    assert.equal(findings.length, 0, 'R006 must exempt .claude/**, root meta, and .evo-lite/**');
}
```

- [x] **Step 2: Run the focused slice and confirm the gap**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: `.claude/settings.local.json` and `CLAUDE.md` still flag `R006` before the fix.

- [x] **Step 3: Generalize the predicate**

In `templates/cli/planning/gaps.js`, widen `isGovernanceRuntimeFile()` from the
current `.evo-lite/**`-only check to a single named predicate covering:

- `.evo-lite/**` (existing)
- `.claude/**`
- root meta files: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `README` variants,
  `.gitignore`, `.gitattributes`, and `*.lock` / lockfiles

Keep it one predicate (rename to `isGovernanceInfraFile()` if clearer) so future
additions are one-line edits, not new filter rules.

- [x] **Step 4: Sync runtime and rerun**

```bash
Copy-Item "templates/cli/planning/gaps.js" ".evo-lite/cli/planning/gaps.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: the exemption test passes; no `R006` for host-adapter/meta files.

- [x] **Step 5: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js templates/cli/test.js
git commit -m "fix(governance): exempt host-adapter and meta files from R006 traceability"
```

---

### Task 2: Make the runtime-mirror lock check content-aware

**Files:**
- Modify: `templates/cli/sync-runtime.js`
- Modify: `templates/cli/memory.service.js`
- Sync: `.evo-lite/cli/sync-runtime.js`, `.evo-lite/cli/memory.service.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing stale-lock test**

In `templates/cli/test.js`, add a case that sets up a mirror byte-identical to
`templates/cli/**` but with a stale/mismatched lock, then asserts the verdict is
NOT a hard error:

```js
console.log('T17. Testing stale lock with matching content is not a hard error ...');
{
    // mirror == templates, lock hashes stale
    const verdict = verifyRuntimeLock(workspaceRoot);
    assert.notEqual(verdict.status, 'drifted',
        'mirror identical to templates must not be reported as drifted');
}
```

Add a second case asserting a mirror that differs from templates DOES still drift.

- [x] **Step 2: Run the slice and confirm the false ERROR**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: the stale-lock case fails (current code reports `drifted` purely from lock-hash mismatch).

- [x] **Step 3: Compare mirror against live templates, not just the lock**

In `templates/cli/sync-runtime.js`, change `verifyRuntimeLock()` so its verdict
is driven by mirror-vs-live-`templates/cli/**` content:

- if every mirror file is byte-identical to its template → `status: 'ok'`
  (optionally `lockStale: true` so the caller can refresh the lock)
- if any mirror file differs from its template → `status: 'drifted'`
- preserve `no-lock` and `no-templates` outcomes

- [x] **Step 4: Downgrade the verify verdict and self-heal the lock**

In `templates/cli/memory.service.js` (the lock block around the
`'❌ ERROR: runtime mirror …'` warning), only emit the hard `ERROR` when mirror
content actually differs from templates. When content matches but the lock is
stale, refresh the lock silently (or log an `info` naming `mem sync-runtime`) and
do NOT set `report.hasAlerts`.

- [x] **Step 5: Sync runtime and rerun**

```bash
Copy-Item "templates/cli/sync-runtime.js" ".evo-lite/cli/sync-runtime.js" -Force
Copy-Item "templates/cli/memory.service.js" ".evo-lite/cli/memory.service.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: stale-lock-with-matching-content passes as healthy; real mirror edits still error.

- [x] **Step 6: Commit**

```bash
git add templates/cli/sync-runtime.js .evo-lite/cli/sync-runtime.js templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/test.js
git commit -m "fix(governance): make runtime-mirror lock content-aware, no false ERROR on stale lock"
```

---

### Task 3: Add a focus-health planning drift rule (R012)

**Files:**
- Modify: `templates/cli/planning/gaps.js`
- Modify: `templates/cli/memory.service.js`
- Sync: `.evo-lite/cli/planning/gaps.js`, `.evo-lite/cli/memory.service.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing focus-health test**

In `templates/cli/test.js`, add a case where `BEGIN_FOCUS` references a plan whose
IR status is `draft` / `0-done`, and assert an R012 warning is produced:

```js
console.log('T18. Testing focus pointing at a draft/0-done plan is flagged ...');
{
    const findings = checkR012(projectRoot, planIR, { focusText: 'plan:dogfood-operator-experience-phase1' });
    assert.ok(findings.some(f => f.rule === 'R012' && f.level === 'warning'),
        'focus on a draft/0-done plan must raise R012');
}
```

- [x] **Step 2: Run the slice and confirm the gap**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: no R012 exists yet, test fails.

- [x] **Step 3: Implement R012**

In `templates/cli/planning/gaps.js`, add `checkR012(projectRoot, planIR, options)`
following the existing R-rule shape (id/rule/scope/level/type/message/evidence/
suggestedAction). It MUST:

- read the focus text (from `active_context.md` `BEGIN_FOCUS`, or `options.focusText`)
- resolve any referenced `plan:<slug>` in the IR
- emit a `warning` when that plan is `status: draft` OR has `0/N` tasks done,
  naming the plan and its `done/total` count

Wire it into the aggregate finding list next to R009.

- [x] **Step 4: Surface it in verify**

In `templates/cli/memory.service.js`, ensure `verify()` reports the R012 finding
in its governance-health summary (alongside the existing freshness/staleness
output), with an actionable hint (advance focus or start the plan).

- [x] **Step 5: Sync runtime and rerun**

```bash
Copy-Item "templates/cli/planning/gaps.js" ".evo-lite/cli/planning/gaps.js" -Force
Copy-Item "templates/cli/memory.service.js" ".evo-lite/cli/memory.service.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: R012 fires for a draft/0-done focus and is visible in verify output.

- [x] **Step 6: Commit**

```bash
git add templates/cli/planning/gaps.js .evo-lite/cli/planning/gaps.js templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/test.js
git commit -m "feat(governance): add R012 focus-health rule for draft/0-done focus"
```

---

### Task 4: Conservative commit-evidence focus auto-advance

**Files:**
- Modify: `templates/cli/hooks.js`
- Modify: `templates/cli/memory.service.js`
- Sync: `.evo-lite/cli/hooks.js`, `.evo-lite/cli/memory.service.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing auto-advance test**

In `templates/cli/test.js`, add two hook cases:

```js
console.log('T19. Testing focus auto-advances from a plan-referencing commit ...');
{
    const repo = createHookTestRepo('focus-advance');
    // commit whose message references a known plan slug
    runGit(repo.projectRoot, ['commit', '--allow-empty', '-m', 'feat(plan:demo): land demo task']);
    runPostCommitHook(repo.projectRoot);
    const focus = readFocus(repo.projectRoot);
    assert.ok(/demo/.test(focus), 'focus must advance to the referenced plan summary');
}
console.log('T20. Testing a bare snapshot/meta commit does NOT move focus ...');
{
    // ... commit with no plan/spec reference → focus unchanged
}
```

- [x] **Step 2: Run the slice and confirm the gap**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: focus does not move yet; the advance test fails, the no-move test passes.

- [x] **Step 3: Implement a conservative detector + advance**

Add a helper (in `templates/cli/memory.service.js`, callable from `hooks.js`) that:

- parses the latest commit message for an explicit `plan:<slug>` / `spec:<slug>`
  token (Conventional-Commit scope `feat(plan:slug)`, a `plan:`/`spec:` token, or
  a trailer)
- if found and the slug resolves in the IR, advances `BEGIN_FOCUS` to a summary
  derived from that plan/spec
- does NOTHING when no explicit reference is present (snapshots, meta commits)
- is disabled when `EVO_LITE_NO_FOCUS_AUTOADVANCE=1`

Wire the call into the post-commit path in `templates/cli/hooks.js`.

- [x] **Step 4: Make verify advise on staleness**

In `templates/cli/memory.service.js`, when focus is stale, have `verify()` state
either the exact advance command or that auto-advance is enabled and will run on
the next plan-referencing commit (instead of only ">24h stale").

- [x] **Step 5: Sync runtime and rerun**

```bash
Copy-Item "templates/cli/hooks.js" ".evo-lite/cli/hooks.js" -Force
Copy-Item "templates/cli/memory.service.js" ".evo-lite/cli/memory.service.js" -Force
node ./.evo-lite/cli/test.js governance
```

Expected: plan-referencing commit advances focus; bare commit leaves it; opt-out env disables it.

- [x] **Step 6: Commit**

```bash
git add templates/cli/hooks.js .evo-lite/cli/hooks.js templates/cli/memory.service.js .evo-lite/cli/memory.service.js templates/cli/test.js
git commit -m "feat(governance): conservative commit-evidence focus auto-advance with opt-out"
```

---

## Self-Review

**Spec coverage check:**
- ✅ R1 focus auto-advance from commit evidence → Task 4
- ✅ R2 generalized host-adapter / meta R006 exemption → Task 1
- ✅ R3 content-aware runtime-mirror lock (no false ERROR) → Task 2
- ✅ R4 focus-health rule for draft/0-done focus → Task 3

**Placeholder scan:** No `TODO`, `TBD`, or "implement later" placeholders remain
in the task steps.

**Type consistency:** The plan consistently uses `R006`, `R012`,
`isGovernanceInfraFile`, `verifyRuntimeLock`, `EVO_LITE_NO_FOCUS_AUTOADVANCE`,
and `node ./.evo-lite/cli/test.js governance`.
