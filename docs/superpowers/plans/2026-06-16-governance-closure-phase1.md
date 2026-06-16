---
linkedSpec: spec:governance-closure-phase1
---

# Governance Closure Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Evo-Lite governance self-enforcing at the commit boundary: post-commit hook auto-scans; `plan lint` finds/fixes plans with no frontmatter; dashboard shows staleness; agent checkpoint protocol documented.

**Architecture:** Four independent deliverables in sequence. (1) `planning/lint.js` new module + `plan lint [--fix]` subcommand; (2) `computeFreshness()` in `dashboard-data.js`; (3) `installPostCommitHook()` in `index.js` (exported for tests); (4) `.agents/rules/subagent-checkpoint.md` rule doc. Each task syncs its changes to `.evo-lite/cli/` (dogfood runtime) before committing.

**Tech Stack:** Node.js (fs, child_process, commander), POSIX sh (hook script), existing `parseFrontmatter` from `planning/parse-markdown.js`.

---

## File Map

| File | Change |
|------|--------|
| `templates/cli/planning/lint.js` | NEW — `lintPlans(projectRoot, fix)` |
| `templates/cli/planning.js:139` | MODIFY — add `plan lint [--fix]` subcommand |
| `templates/cli/template-manifest.js` | MODIFY — add `planning/lint.js` to core-cli files |
| `templates/cli/dashboard-data.js:82` | MODIFY — add `computeFreshness()` + `freshness` field |
| `index.js` | MODIFY — add `installPostCommitHook(targetDir)` + export |
| `templates/.agents/rules/subagent-checkpoint.md` | NEW — installed by `init` into new projects |
| `.agents/rules/subagent-checkpoint.md` | NEW — dogfood copy |
| `templates/cli/test.js` | MODIFY — add T9 (lint), T10 (freshness), T11 (hook) |
| `.evo-lite/cli/planning/lint.js` | NEW — sync |
| `.evo-lite/cli/planning.js` | MODIFY — sync |
| `.evo-lite/cli/dashboard-data.js` | MODIFY — sync |
| `.evo-lite/cli/template-manifest.js` | MODIFY — sync |
| `.evo-lite/cli/test.js` | MODIFY — sync |

---

### Task 1: `planning/lint.js` + `plan lint [--fix]` subcommand

**Files:**
- Create: `templates/cli/planning/lint.js`
- Modify: `templates/cli/planning.js` (after line 138, before closing `}`)
- Modify: `templates/cli/template-manifest.js` (add `planning/lint.js` to core-cli `files` array)
- Modify: `templates/cli/test.js` (add T9)
- Sync: `.evo-lite/cli/planning/lint.js`, `.evo-lite/cli/planning.js`, `.evo-lite/cli/template-manifest.js`, `.evo-lite/cli/test.js`

- [x] **Step 1: Write failing test T9 in `templates/cli/test.js`**

Find the last test block (T8) and append after it, before the final `}` that closes `runTests`:

```js
console.log('T9. Testing plan lint detects missing frontmatter and --fix injects it ...');
{
    const { lintPlans } = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'lint'));
    const tmpLintRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lint-'));
    try {
        const plansDir = path.join(tmpLintRoot, 'docs', 'superpowers', 'plans');
        fs.mkdirSync(plansDir, { recursive: true });

        // Plan with no frontmatter
        fs.writeFileSync(path.join(plansDir, '2026-01-01-my-feature.md'),
            '### Task 1: Do something\n- [ ] **Step 1:** do it\n');
        // Plan with valid frontmatter — should not be reported
        fs.writeFileSync(path.join(plansDir, '2026-01-02-good-plan.md'),
            '---\nid: plan:good-plan\nlinkedSpec: spec:good-plan\n---\n# Good Plan\n');
        // Plan with frontmatter but missing linkedSpec
        fs.writeFileSync(path.join(plansDir, '2026-01-03-partial.md'),
            '---\nid: plan:partial\n---\n# Partial Plan\n');

        const result = lintPlans(tmpLintRoot, false);
        assert.strictEqual(result.issues.length, 2, 'should find 2 issues');
        assert.ok(result.issues.some(i => i.message.includes('no frontmatter')), 'should report no-frontmatter issue');
        assert.ok(result.issues.some(i => i.message.includes('no linkedSpec')), 'should report no-linkedSpec issue');
        assert.strictEqual(result.fixed, 0, 'fix=false should not modify files');

        // --fix injects frontmatter for no-frontmatter case only
        const fixResult = lintPlans(tmpLintRoot, true);
        assert.strictEqual(fixResult.fixed, 1, '--fix should fix exactly the no-frontmatter file');
        const fixedContent = fs.readFileSync(path.join(plansDir, '2026-01-01-my-feature.md'), 'utf8');
        assert.ok(fixedContent.startsWith('---\n'), 'fixed file should start with frontmatter');
        assert.ok(fixedContent.includes('id: plan:my-feature'), 'fixed frontmatter should have id: plan:my-feature');
        assert.ok(fixedContent.includes('linkedSpec: spec:my-feature'), 'fixed frontmatter should have linkedSpec');

        // Idempotency: second --fix on already-fixed file should not re-inject
        const fixAgain = lintPlans(tmpLintRoot, true);
        assert.strictEqual(fixAgain.fixed, 0, '--fix is idempotent — no double-inject');
    } finally {
        fs.rmSync(tmpLintRoot, { recursive: true, force: true });
    }
    console.log('✅ T9 plan lint passed');
}
```

- [x] **Step 2: Run test to confirm T9 fails**

```bash
node templates/cli/test.js 2>&1 | grep -A3 "T9\|lintPlans\|Cannot find"
```

Expected: `Cannot find module '.../planning/lint'` or similar — module doesn't exist yet.

- [x] **Step 3: Create `templates/cli/planning/lint.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./parse-markdown');

const PLAN_DIRS = [
    'docs/plans',
    'docs/superpowers/plans',
];

function lintPlans(projectRoot, fix) {
    const issues = [];
    let fixed = 0;

    for (const dir of PLAN_DIRS) {
        const abs = path.join(projectRoot, dir);
        if (!fs.existsSync(abs)) continue;

        for (const fname of fs.readdirSync(abs)) {
            if (!fname.endsWith('.md')) continue;

            const filePath = path.join(abs, fname);
            const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
            const content = fs.readFileSync(filePath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);
            const hasFrontmatter = Object.keys(frontmatter).length > 0;

            if (!hasFrontmatter) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: 'no frontmatter — add id: plan:<slug> and linkedSpec: spec:<slug>',
                });

                if (fix) {
                    const slug = fname.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
                    const block = `---\nid: plan:${slug}\nlinkedSpec: spec:${slug}\n---\n\n`;
                    fs.writeFileSync(filePath, block + content);
                    fixed++;
                }
                continue;
            }

            if (!frontmatter.id || !frontmatter.id.startsWith('plan:')) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: `frontmatter missing valid id: plan:* (found: ${frontmatter.id || 'none'})`,
                });
                continue;
            }

            if (!frontmatter.linkedSpec) {
                issues.push({
                    level: 'warning',
                    file: relPath,
                    message: `${frontmatter.id} has no linkedSpec`,
                });
            }
        }
    }

    return { issues, fixed };
}

module.exports = { lintPlans };
```

- [x] **Step 4: Add `plan lint` subcommand to `templates/cli/planning.js`**

Inside `registerPlanCommands`, after the last `plan.command('trace')` block (before the closing `}`):

```js
    plan.command('lint')
        .description('Check plan files for missing frontmatter / linkedSpec.')
        .option('--fix', 'Auto-inject minimal frontmatter into plans that have none.')
        .action(async (options) => {
            const { lintPlans } = require('./planning/lint');
            const results = lintPlans(projectRoot, !!options.fix);
            if (results.issues.length === 0) {
                console.log('All plan files have valid frontmatter.');
            } else {
                for (const issue of results.issues) {
                    console.log(`[${issue.level}] ${issue.file}: ${issue.message}`);
                }
            }
            if (options.fix && results.fixed > 0) {
                console.log(`\nFixed: ${results.fixed} file(s) — frontmatter injected.`);
            }
            process.exitCode = results.issues.length > 0 && !options.fix ? 1 : 0;
        });
```

- [x] **Step 5: Add `planning/lint.js` to `templates/cli/template-manifest.js` core-cli `files` array**

Find the `core-cli` family's `files` array. Add `'planning/lint.js'` after `'planning/traceability.js'`:

```js
'planning/lint.js',
```

- [x] **Step 6: Run test to confirm T9 passes**

```bash
node templates/cli/test.js 2>&1 | grep -E "T9|✅ T9"
```

Expected: `✅ T9 plan lint passed`

- [x] **Step 7: Sync to dogfood runtime + commit**

```bash
cp templates/cli/planning/lint.js .evo-lite/cli/planning/lint.js
cp templates/cli/planning.js .evo-lite/cli/planning.js
cp templates/cli/template-manifest.js .evo-lite/cli/template-manifest.js
cp templates/cli/test.js .evo-lite/cli/test.js
```

Then update all `- [ ]` steps above to `- [x]` in this plan file, and commit:

```bash
git add templates/cli/planning/lint.js templates/cli/planning.js templates/cli/template-manifest.js templates/cli/test.js .evo-lite/cli/planning/lint.js .evo-lite/cli/planning.js .evo-lite/cli/template-manifest.js .evo-lite/cli/test.js docs/superpowers/plans/2026-06-16-governance-closure-phase1.md
git commit -m "feat(planning): plan lint command with --fix frontmatter injection"
```

---

### Task 2: Dashboard freshness — `computeFreshness()` + `freshness` in `buildDashboardData`

**Files:**
- Modify: `templates/cli/dashboard-data.js` (add `computeFreshness`, add `freshness` to return)
- Modify: `templates/cli/test.js` (add T10)
- Sync: `.evo-lite/cli/dashboard-data.js`, `.evo-lite/cli/test.js`

- [ ] **Step 1: Write failing test T10 in `templates/cli/test.js`**

Append after T9 block:

```js
console.log('T10. Testing dashboard buildDashboardData includes freshness field ...');
{
    const dashModule = require(path.join(TEMPLATE_CLI_DIR, 'dashboard-data'));
    const tmpDashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-fresh-'));
    try {
        // No IR files — ages should be null, stale flags false
        const data = dashModule.buildDashboardData(tmpDashRoot);
        assert.ok('freshness' in data, 'dashboard data must have freshness field');
        assert.ok('planIrAge' in data.freshness, 'freshness must have planIrAge');
        assert.ok('archIrAge' in data.freshness, 'freshness must have archIrAge');
        assert.ok('lastCommitAge' in data.freshness, 'freshness must have lastCommitAge');
        assert.ok('planStale' in data.freshness, 'freshness must have planStale');
        assert.ok('archStale' in data.freshness, 'freshness must have archStale');
        assert.strictEqual(data.freshness.planIrAge, null, 'planIrAge should be null when IR missing');
        assert.strictEqual(data.freshness.planStale, false, 'planStale should be false when IR missing');
        assert.strictEqual(data.freshness.archStale, false, 'archStale should be false when IR missing');
    } finally {
        fs.rmSync(tmpDashRoot, { recursive: true, force: true });
    }
    console.log('✅ T10 dashboard freshness passed');
}
```

- [ ] **Step 2: Run test to confirm T10 fails**

```bash
node templates/cli/test.js 2>&1 | grep -E "T10|freshness"
```

Expected: `AssertionError: dashboard data must have freshness field`

- [ ] **Step 3: Add `computeFreshness` to `templates/cli/dashboard-data.js`**

Add after the `readJson` helper function (after line 11), before `buildDashboardData`:

```js
function computeFreshness(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIrPath = path.join(genDir, 'planning', 'plan-ir.json');
    const archIrPath = path.join(genDir, 'architecture', 'architecture-ir.json');
    const nowMs = Date.now();

    function ageSecs(p) {
        if (!fs.existsSync(p)) return null;
        return Math.round((nowMs - fs.statSync(p).mtimeMs) / 1000);
    }

    let lastCommitAge = null;
    try {
        const { execFileSync } = require('child_process');
        const ts = execFileSync('git', ['log', '-1', '--format=%ct'], {
            cwd: projectRoot, encoding: 'utf8', timeout: 3000,
        }).trim();
        if (ts) lastCommitAge = Math.round((nowMs - parseInt(ts, 10) * 1000) / 1000);
    } catch (_) {}

    const planIrAge = ageSecs(planIrPath);
    const archIrAge = ageSecs(archIrPath);

    return {
        planIrAge,
        archIrAge,
        lastCommitAge,
        planStale: planIrAge !== null && lastCommitAge !== null && planIrAge > lastCommitAge,
        archStale: archIrAge !== null && lastCommitAge !== null && archIrAge > lastCommitAge,
    };
}
```

- [ ] **Step 4: Add `freshness` field to `buildDashboardData` return value**

In `buildDashboardData`, in the `return` object (currently returns `version, generatedAt, project, planning, architecture, drift, memory, verify`), add `freshness: computeFreshness(projectRoot)`:

```js
    return {
        version: 'evo-dashboard@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        planning,
        architecture,
        drift,
        memory,
        verify,
        freshness: computeFreshness(projectRoot),
    };
```

- [ ] **Step 5: Run test to confirm T10 passes**

```bash
node templates/cli/test.js 2>&1 | grep -E "T10|✅ T10"
```

Expected: `✅ T10 dashboard freshness passed`

- [ ] **Step 6: Sync to dogfood + commit**

```bash
cp templates/cli/dashboard-data.js .evo-lite/cli/dashboard-data.js
cp templates/cli/test.js .evo-lite/cli/test.js
```

Update `- [ ]` → `- [x]` in this task's steps, then:

```bash
git add templates/cli/dashboard-data.js .evo-lite/cli/dashboard-data.js templates/cli/test.js .evo-lite/cli/test.js docs/superpowers/plans/2026-06-16-governance-closure-phase1.md
git commit -m "feat(dashboard): add freshness field with planStale/archStale indicators"
```

---

### Task 3: Post-commit hook installer in `index.js`

**Files:**
- Modify: `index.js` (add `installPostCommitHook`, call it after `ensureGitWorkspace`, export at bottom)
- Modify: `templates/cli/test.js` (add T11)
- Sync: `.evo-lite/cli/test.js`

- [ ] **Step 1: Write failing test T11 in `templates/cli/test.js`**

Append after T10 block:

```js
console.log('T11. Testing installPostCommitHook creates and is idempotent ...');
{
    const { installPostCommitHook } = require(INIT_ENTRY);

    // T11a: fresh install creates hook with sentinel
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook1-'));
    try {
        fs.mkdirSync(path.join(dir1, '.git', 'hooks'), { recursive: true });
        installPostCommitHook(dir1);
        const hook = fs.readFileSync(path.join(dir1, '.git', 'hooks', 'post-commit'), 'utf8');
        assert.ok(hook.includes('# BEGIN evo-lite-hook'), 'hook must contain BEGIN sentinel');
        assert.ok(hook.includes('# END evo-lite-hook'), 'hook must contain END sentinel');
        assert.ok(hook.includes('plan scan'), 'hook must reference plan scan');
        assert.ok(hook.includes('dashboard build'), 'hook must reference dashboard build');

        // T11b: idempotent — second install does not duplicate sentinel
        installPostCommitHook(dir1);
        const hook2 = fs.readFileSync(path.join(dir1, '.git', 'hooks', 'post-commit'), 'utf8');
        const sentinelCount = (hook2.match(/# BEGIN evo-lite-hook/g) || []).length;
        assert.strictEqual(sentinelCount, 1, 'sentinel must appear exactly once after second install');
    } finally {
        fs.rmSync(dir1, { recursive: true, force: true });
    }

    // T11c: pre-existing hook — evo-lite section appended, original content preserved
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook2-'));
    try {
        fs.mkdirSync(path.join(dir2, '.git', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(dir2, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho "custom hook"\n');
        installPostCommitHook(dir2);
        const hook3 = fs.readFileSync(path.join(dir2, '.git', 'hooks', 'post-commit'), 'utf8');
        assert.ok(hook3.includes('custom hook'), 'pre-existing hook content must be preserved');
        assert.ok(hook3.includes('# BEGIN evo-lite-hook'), 'evo-lite sentinel must be appended');
    } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
    }

    // T11d: no .git/hooks dir — no crash
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook3-'));
    try {
        installPostCommitHook(dir3); // must not throw
    } finally {
        fs.rmSync(dir3, { recursive: true, force: true });
    }

    console.log('✅ T11 post-commit hook installer passed');
}
```

- [ ] **Step 2: Run test to confirm T11 fails**

```bash
node templates/cli/test.js 2>&1 | grep -E "T11|installPostCommitHook"
```

Expected: `installPostCommitHook is not a function` or `Cannot destructure property`.

- [ ] **Step 3: Add `installPostCommitHook` to `index.js`**

Add this function before the `main` function (around line 477):

```js
function installPostCommitHook(targetDir) {
    const SENTINEL_BEGIN = '# BEGIN evo-lite-hook';
    const SENTINEL_END = '# END evo-lite-hook';
    const hooksDir = path.join(targetDir, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    const hookLines = [
        SENTINEL_BEGIN,
        '# Managed by create-evo-lite. Do not edit this block manually.',
        '[ -d ".evo-lite/cli" ] || exit 0',
        'CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")',
        'PLAN_CHANGED="" ARCH_CHANGED=""',
        'for f in $CHANGED; do',
        '  case "$f" in',
        '    docs/specs/*|docs/plans/*|docs/superpowers/specs/*|docs/superpowers/plans/*) PLAN_CHANGED=1 ;;',
        '    templates/cli/*|index.js|bin/*) ARCH_CHANGED=1 ;;',
        '  esac',
        'done',
        'NODE_BIN=$(command -v node 2>/dev/null)',
        '[ -z "$NODE_BIN" ] && exit 0',
        '[ -z "${PLAN_CHANGED}${ARCH_CHANGED}" ] && exit 0',
        'MEM="$NODE_BIN .evo-lite/cli/memory.js"',
        '[ -n "$PLAN_CHANGED" ] && { $MEM plan scan 2>/dev/null; true; }',
        '[ -n "$ARCH_CHANGED" ] && { $MEM architecture scan 2>/dev/null; true; }',
        '$MEM plan gaps 2>/dev/null; true',
        '$MEM dashboard build 2>/dev/null; true',
        SENTINEL_END,
    ];
    const hookBody = hookLines.join('\n');

    const hookPath = path.join(hooksDir, 'post-commit');
    if (fs.existsSync(hookPath)) {
        let content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes(SENTINEL_BEGIN)) {
            content = content.replace(
                new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`),
                hookBody
            );
        } else {
            content = content.trimEnd() + '\n\n' + hookBody + '\n';
        }
        fs.writeFileSync(hookPath, content);
    } else {
        fs.writeFileSync(hookPath, '#!/bin/sh\n' + hookBody + '\n');
    }
    try { fs.chmodSync(hookPath, '755'); } catch (_) {}
}
```

- [ ] **Step 4: Call `installPostCommitHook` in the `main` flow**

Find the line that says `const gitWorkspace = ensureGitWorkspace(targetDir, options);` (around line 402). Add the hook call immediately after it:

```js
    const gitWorkspace = ensureGitWorkspace(targetDir, options);
    installPostCommitHook(targetDir);
```

- [ ] **Step 5: Export `installPostCommitHook` from `index.js` for tests**

At the very end of `index.js`, after the `main(process.argv)` call:

```js
if (require.main !== module) {
    module.exports = { installPostCommitHook };
}
```

- [ ] **Step 6: Run test to confirm T11 passes**

```bash
node templates/cli/test.js 2>&1 | grep -E "T11|✅ T11"
```

Expected: `✅ T11 post-commit hook installer passed`

- [ ] **Step 7: Sync test.js to dogfood + commit**

```bash
cp templates/cli/test.js .evo-lite/cli/test.js
```

Update `- [ ]` → `- [x]` in this task's steps, then:

```bash
git add index.js templates/cli/test.js .evo-lite/cli/test.js docs/superpowers/plans/2026-06-16-governance-closure-phase1.md
git commit -m "feat(init): install post-commit governance hook — auto-scans plan/arch IR after commits"
```

---

### Task 4: Subagent checkpoint rule doc + dogfood sync

**Files:**
- Create: `templates/.agents/rules/subagent-checkpoint.md`
- Create: `.agents/rules/subagent-checkpoint.md`

- [ ] **Step 1: Create `templates/.agents/rules/subagent-checkpoint.md`**

```markdown
---
trigger: always_on
---
# SUBAGENT CHECKPOINT PROTOCOL

When implementing a plan task (via subagent-driven-development or any agentic workflow), the task is **NOT complete** until:

## Required Completion Steps

1. **Code committed** — all implementation changes committed to git.

2. **Plan checkboxes updated** — open the plan file (e.g. `docs/superpowers/plans/YYYY-MM-DD-<name>.md`) and change the corresponding `### Task N:` step checkboxes from `- [ ] **Step` to `- [x] **Step`.

3. **Updated plan file committed** — commit the plan file with updated checkboxes (can be included in the implementation commit or as a follow-up commit).

## Why

The post-commit hook auto-runs `mem plan scan` when plan files change. If checkboxes are not updated:
- Plan IR stays stale — dashboard shows 0% progress
- R008 drift rule fires false positives (task "implemented" but no evidence)
- spec compliance reviewer cannot verify completion by reading the IR

## Spec Reviewer Enforcement

The **spec compliance reviewer** subagent MUST verify:
- The plan file for the current task has `- [x]` on all steps for that task
- If not, the task is NOT approved — ask the implementer to update and re-commit

## Controller Enforcement

The **controller** (orchestrator running subagent-driven-development) MUST:
- After each implementer subagent reports DONE, check the plan file for `- [x]` checkboxes before dispatching the spec reviewer
- If checkboxes are still `- [ ]`, ask the implementer to update them before proceeding
```

- [ ] **Step 2: Copy to dogfood `.agents/rules/`**

```bash
cp templates/.agents/rules/subagent-checkpoint.md .agents/rules/subagent-checkpoint.md
```

- [ ] **Step 3: Verify both files exist**

```bash
node -e "const fs=require('fs'); ['templates/.agents/rules/subagent-checkpoint.md','.agents/rules/subagent-checkpoint.md'].forEach(p=>{console.log(p,'exists:',fs.existsSync(p))})"
```

Expected:
```
templates/.agents/rules/subagent-checkpoint.md exists: true
.agents/rules/subagent-checkpoint.md exists: true
```

- [ ] **Step 4: Update this task's checkboxes to `- [x]` and commit**

```bash
git add templates/.agents/rules/subagent-checkpoint.md .agents/rules/subagent-checkpoint.md docs/superpowers/plans/2026-06-16-governance-closure-phase1.md
git commit -m "docs(agents): add subagent-checkpoint protocol rule — controllers must verify plan checkboxes before task approval"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| R1: post-commit hook installed by init | Task 3 |
| R2: idempotent hook (sentinel pattern) | Task 3 (T11b/T11c) |
| R3: `mem plan lint` reports frontmatter issues | Task 1 |
| R4: `mem plan lint --fix` auto-injects frontmatter | Task 1 (T9 tests fix + idempotency) |
| R5: dashboard `freshness` object + `planStale`/`archStale` | Task 2 |
| R6: subagent checkpoint rule in `.agents/rules/` | Task 4 |

All requirements covered. No placeholders.

**Type consistency check:**
- `lintPlans(projectRoot, fix)` → `{ issues: Array<{level, file, message}>, fixed: number }` — consistent across lint.js, planning.js, and tests.
- `computeFreshness(projectRoot)` → `{ planIrAge, archIrAge, lastCommitAge, planStale, archStale }` — consistent across dashboard-data.js and test T10.
- `installPostCommitHook(targetDir)` — no return value, consistent across index.js and test T11.
