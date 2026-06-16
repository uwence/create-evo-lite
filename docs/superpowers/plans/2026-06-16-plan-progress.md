# Plan Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mem plan progress` command that evaluates per-task evidence (git refs, linked files, archive hits) and produces `progress-report.json` with `derivedStatus` and `confidence` per task.

**Architecture:** New `templates/cli/planning/progress.js` contains the evidence evaluator and report writer. `planning.js` registers the `progress` subcommand (pattern matches existing `gaps`, `scan`, `status` commands). `dashboard-data.js` reads `progress-report.json` and injects a `progress` key into `planning`. Mirror sync copies all changed files to `.evo-lite/cli/` after each commit.

**Tech Stack:** Node.js, `child_process.execFileSync` (git), `fs`, `path`. No new npm dependencies.

---

### Task 1: Create `templates/cli/planning/progress.js`

**Files:**
- Create: `templates/cli/planning/progress.js`

**Context:** This is the core evidence evaluator. It reads `plan-ir.json`, checks each task's evidence signals, and writes `progress-report.json`. Follows the same `'use strict'` + `module.exports` pattern as `gaps.js`.

Evidence signals per task:
1. `checkboxStatus` — from `task.status` in plan-ir (`'implemented'` or `'todo'`)
2. `gitRefs` — parse `task.evidence` entries matching `/^git:[a-f0-9]+/i`, call `git show --stat --oneline {sha}`, capture first line as summary
3. `linkedFilesRatio` — `fs.existsSync` each file in `task.linkedFiles`; ratio = exist/total; 1.0 when `linkedFiles` is empty (no files = no penalty)
4. `archiveHits` — count `.evo-lite/raw_memory/*.md` filenames containing the task id slug (e.g. `task:add-plan-scan` → slug `add-plan-scan`)

DerivedStatus algorithm (evaluated in order, first match wins):
```
hasPositiveFileEvidence = linkedFilesTotal > 0 AND linkedFilesExist > 0
hasPositiveEvidence = validGitRefs >= 1 OR hasPositiveFileEvidence

implemented AND validGitRefs >= 1 AND (linkedFilesTotal === 0 OR linkedFilesRatio === 1.0) → verified     (0.95)
implemented AND hasPositiveEvidence                                                          → implemented  (0.80)
implemented AND NOT hasPositiveEvidence                                                     → implemented  (0.50)
todo        AND hasPositiveEvidence                                                          → in_progress  (0.40)
todo        AND NOT hasPositiveEvidence                                                     → todo         (0.00)

archiveHits boost: confidence = Math.min(confidence + archiveHits * 0.02, 1.0)
```

- [ ] **Step 1: Create `templates/cli/planning/progress.js`**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function validateGitRef(ref, projectRoot) {
    const sha = ref.replace(/^git:/i, '');
    try {
        const out = execFileSync('git', ['show', '--stat', '--oneline', sha], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        });
        return { ref, valid: true, summary: out.split('\n')[0].trim() };
    } catch {
        return { ref, valid: false, summary: null };
    }
}

function checkLinkedFiles(linkedFiles, projectRoot) {
    if (!linkedFiles || linkedFiles.length === 0) {
        return { ratio: 1.0, total: 0, exist: 0 };
    }
    const exist = linkedFiles.filter(f => fs.existsSync(path.join(projectRoot, f))).length;
    return { ratio: exist / linkedFiles.length, total: linkedFiles.length, exist };
}

function checkArchiveHits(taskId, projectRoot) {
    const rawDir = path.join(projectRoot, '.evo-lite', 'raw_memory');
    if (!fs.existsSync(rawDir)) return 0;
    const slug = taskId.replace(/^task:/, '');
    return fs.readdirSync(rawDir).filter(f => f.endsWith('.md') && f.includes(slug)).length;
}

function evaluateTask(task, projectRoot) {
    const evidenceRefs = (task.evidence || []).filter(e => /^git:[a-f0-9]+/i.test(e));
    const gitRefs = evidenceRefs.map(ref => validateGitRef(ref, projectRoot));
    const validGitRefs = gitRefs.filter(r => r.valid).length;

    const filesResult = checkLinkedFiles(task.linkedFiles, projectRoot);
    const hasPositiveFileEvidence = filesResult.total > 0 && filesResult.exist > 0;
    const hasPositiveEvidence = validGitRefs >= 1 || hasPositiveFileEvidence;
    const archiveHits = checkArchiveHits(task.id, projectRoot);

    let derivedStatus, confidence;
    if (task.status === 'implemented') {
        if (validGitRefs >= 1 && (filesResult.total === 0 || filesResult.ratio === 1.0)) {
            derivedStatus = 'verified';
            confidence = 0.95;
        } else if (hasPositiveEvidence) {
            derivedStatus = 'implemented';
            confidence = 0.80;
        } else {
            derivedStatus = 'implemented';
            confidence = 0.50;
        }
    } else {
        if (hasPositiveEvidence) {
            derivedStatus = 'in_progress';
            confidence = 0.40;
        } else {
            derivedStatus = 'todo';
            confidence = 0.00;
        }
    }

    confidence = Math.round(Math.min(confidence + archiveHits * 0.02, 1.0) * 100) / 100;

    return {
        id: task.id,
        title: task.title,
        linkedPlan: task.linkedPlan || null,
        checkboxStatus: task.status,
        derivedStatus,
        confidence,
        evidence: {
            gitRefs,
            linkedFilesRatio: filesResult.ratio,
            linkedFilesTotal: filesResult.total,
            linkedFilesExist: filesResult.exist,
            archiveHits,
        },
    };
}

function evaluateProgress(projectRoot) {
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(irPath)) return null;

    const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
    const tasks = (ir.tasks || []).map(t => evaluateTask(t, projectRoot));

    const count = { verified: 0, implemented: 0, in_progress: 0, todo: 0 };
    for (const t of tasks) { if (count[t.derivedStatus] !== undefined) count[t.derivedStatus]++; }

    const byPlan = {};
    for (const t of tasks) {
        const pid = t.linkedPlan || 'unknown';
        if (!byPlan[pid]) byPlan[pid] = { total: 0, verified: 0, implemented: 0, in_progress: 0, todo: 0 };
        byPlan[pid].total++;
        if (byPlan[pid][t.derivedStatus] !== undefined) byPlan[pid][t.derivedStatus]++;
    }

    return {
        version: 'evo-progress@1',
        generatedAt: new Date().toISOString(),
        planIrPath: path.relative(projectRoot, irPath).replace(/\\/g, '/'),
        summary: { total: tasks.length, ...count },
        byPlan,
        tasks,
    };
}

function writeProgressReport(report, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'progress-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    return outPath;
}

module.exports = { evaluateProgress, writeProgressReport };
```

- [ ] **Step 2: Smoke-test module loads**

Run:
```bash
node -e "require('./templates/cli/planning/progress'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add templates/cli/planning/progress.js
git commit -m "feat(planning): add progress.js evidence evaluator

evaluateProgress() reads plan-ir.json, validates git refs via
git show --stat, checks linked file existence, and derives
task status (verified/implemented/in_progress/todo) with confidence.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Register `plan progress` subcommand in `planning.js`

**Files:**
- Modify: `templates/cli/planning.js:69-96` (add after `plan gaps` block, before closing brace)

**Context:** `registerPlanCommands` is already called by `memory.js:633`. Adding a new `plan.command('progress')` block is sufficient — no changes to `memory.js` needed. The command reads `plan-ir.json` before calling `evaluateProgress` so it can exit early with a clear error if the file is missing.

- [ ] **Step 1: Add `plan progress` command to `planning.js`**

In `templates/cli/planning.js`, replace the closing of `registerPlanCommands`:

```javascript
// BEFORE (line 96-98):
}

module.exports = { registerPlanCommands };

// AFTER:
    plan.command('progress')
        .description('Evaluate task evidence (git refs, files, archive), write progress-report.json.')
        .action(async () => {
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (!fs.existsSync(irPath)) {
                console.error('No plan-ir.json found. Run: mem plan scan first.');
                process.exit(1);
            }
            const { evaluateProgress, writeProgressReport } = require('./planning/progress');
            console.log('Evaluating task evidence...\n');
            const report = evaluateProgress(projectRoot);
            const outPath = writeProgressReport(report, projectRoot);
            const s = report.summary;
            console.log(`  total: ${s.total}  verified: ${s.verified}  implemented: ${s.implemented}  in_progress: ${s.in_progress}  todo: ${s.todo}`);
            console.log(`\nWritten: ${outPath}`);
        });
}

module.exports = { registerPlanCommands };
```

Exact edit: find `}\n\nmodule.exports = { registerPlanCommands };` and replace with the block above.

- [ ] **Step 2: Verify command is reachable**

Run:
```bash
node .evo-lite/cli/memory.js plan --help
```
Expected output includes `progress` in the command list.

(Note: `.evo-lite/cli/` will be updated in Task 4 mirror sync. For now verify against `templates/cli/` directly if needed.)

- [ ] **Step 3: Commit**

```bash
git add templates/cli/planning.js
git commit -m "feat(planning): register plan progress subcommand

Adds mem plan progress command: exits with error hint when
plan-ir.json absent, otherwise calls evaluateProgress()
and writes progress-report.json.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Inject progress into `dashboard-data.js`

**Files:**
- Modify: `templates/cli/dashboard-data.js:13-31` (add `progressReport` read + inject into `planning`)

**Context:** `buildDashboardData` already reads `plan-ir.json`, `architecture-ir.json`, `drift-report.json` via `readJson`. Add `progress-report.json` read and inject a `progress` key into the `planning` object when present. Dashboard build output line stays unchanged.

- [ ] **Step 1: Edit `buildDashboardData` in `templates/cli/dashboard-data.js`**

Replace lines 13-31 (the `buildDashboardData` function body up through the `planning` object):

```javascript
// BEFORE (lines 13-31):
function buildDashboardData(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIR = readJson(path.join(genDir, 'planning', 'plan-ir.json'));
    const archIR = readJson(path.join(genDir, 'architecture', 'architecture-ir.json'));
    const driftReport = readJson(path.join(genDir, 'architecture', 'drift-report.json'));

    const planning = planIR ? {
        version: planIR.version,
        specs: planIR.specs,
        plans: planIR.plans,
        tasks: planIR.tasks,
        warnings: planIR.warnings,
        summary: {
            specs: planIR.specs.length,
            plans: planIR.plans.length,
            tasks: planIR.tasks.length,
            implemented: planIR.tasks.filter(t => t.status === 'implemented').length,
        },
    } : { missing: true, hint: 'Run: mem plan scan' };

// AFTER:
function buildDashboardData(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIR = readJson(path.join(genDir, 'planning', 'plan-ir.json'));
    const progressReport = readJson(path.join(genDir, 'planning', 'progress-report.json'));
    const archIR = readJson(path.join(genDir, 'architecture', 'architecture-ir.json'));
    const driftReport = readJson(path.join(genDir, 'architecture', 'drift-report.json'));

    const planning = planIR ? {
        version: planIR.version,
        specs: planIR.specs,
        plans: planIR.plans,
        tasks: planIR.tasks,
        warnings: planIR.warnings,
        summary: {
            specs: planIR.specs.length,
            plans: planIR.plans.length,
            tasks: planIR.tasks.length,
            implemented: planIR.tasks.filter(t => t.status === 'implemented').length,
        },
        progress: progressReport ? { summary: progressReport.summary, byPlan: progressReport.byPlan } : null,
    } : { missing: true, hint: 'Run: mem plan scan' };
```

- [ ] **Step 2: Smoke-test `dashboard-data.js` loads**

Run:
```bash
node -e "require('./templates/cli/dashboard-data'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add templates/cli/dashboard-data.js
git commit -m "feat(dashboard): inject progress-report into dashboard planning data

buildDashboardData() reads progress-report.json when present
and injects { summary, byPlan } into dashboard.planning.progress.
Null when progress-report.json absent (dashboard build still works).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Mirror sync + end-to-end verification

**Files:**
- Sync: `templates/cli/planning/progress.js` → `.evo-lite/cli/planning/progress.js`
- Sync: `templates/cli/planning.js` → `.evo-lite/cli/planning.js`
- Sync: `templates/cli/dashboard-data.js` → `.evo-lite/cli/dashboard-data.js`

- [ ] **Step 1: Copy files to mirror**

Run (PowerShell):
```powershell
Copy-Item "templates/cli/planning/progress.js" ".evo-lite/cli/planning/progress.js" -Force
Copy-Item "templates/cli/planning.js" ".evo-lite/cli/planning.js" -Force
Copy-Item "templates/cli/dashboard-data.js" ".evo-lite/cli/dashboard-data.js" -Force
```

- [ ] **Step 2: Verify hashes match**

Run (PowerShell):
```powershell
$files = @(
  @("templates/cli/planning/progress.js", ".evo-lite/cli/planning/progress.js"),
  @("templates/cli/planning.js", ".evo-lite/cli/planning.js"),
  @("templates/cli/dashboard-data.js", ".evo-lite/cli/dashboard-data.js")
)
foreach ($pair in $files) {
  $h1 = (Get-FileHash $pair[0] -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $pair[1] -Algorithm SHA256).Hash
  if ($h1 -eq $h2) { "$($pair[0]): IDENTICAL" } else { "$($pair[0]): MISMATCH" }
}
```
Expected: all three `IDENTICAL`

- [ ] **Step 3: Verify `plan progress` absent plan-ir exits with error**

Delete plan-ir temporarily and verify error (then restore):
```bash
node -e "
const { execFileSync } = require('child_process');
try {
  execFileSync('node', ['.evo-lite/cli/memory.js', 'plan', 'progress'], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env }
  });
  console.log('FAIL: expected error exit');
} catch(e) {
  if (e.stderr && e.stderr.includes('plan scan')) {
    console.log('PASS: error hint shown');
  } else {
    console.log('FAIL:', e.stderr || e.message);
  }
}
"
```

Actually, since plan-ir.json exists in this project, just rename it, test, rename back:

Run (PowerShell):
```powershell
Rename-Item ".evo-lite/generated/planning/plan-ir.json" "plan-ir.json.bak"
node .evo-lite/cli/memory.js plan progress
# Expected output: "No plan-ir.json found. Run: mem plan scan first." (exit 1)
Rename-Item ".evo-lite/generated/planning/plan-ir.json.bak" "plan-ir.json"
```
Expected: error message printed, non-zero exit.

- [ ] **Step 4: Run `plan progress` end-to-end**

Run:
```bash
node .evo-lite/cli/memory.js plan progress
```
Expected output:
```
Evaluating task evidence...

  total: <N>  verified: <V>  implemented: <I>  in_progress: <P>  todo: <T>

Written: D:\...\create-evo-lite\.evo-lite\generated\planning\progress-report.json
```
And `progress-report.json` exists.

- [ ] **Step 5: Spot-check output JSON**

Run (PowerShell):
```powershell
$r = Get-Content ".evo-lite/generated/planning/progress-report.json" | ConvertFrom-Json
$r.summary
$r.tasks | Where-Object { $_.derivedStatus -eq "verified" } | Select-Object id, derivedStatus, confidence | Select-Object -First 3
```
Expected: `summary` shows counts, verified tasks have `confidence` ≥ 0.95.

- [ ] **Step 6: Run `dashboard build` and verify progress injected**

Run:
```bash
node .evo-lite/cli/memory.js dashboard build
```
Then verify:
```powershell
$d = Get-Content ".evo-lite/generated/dashboard/dashboard-data.json" | ConvertFrom-Json
$d.planning.progress.summary
```
Expected: `summary` object with `total`, `verified`, `implemented`, `in_progress`, `todo` counts.

- [ ] **Step 7: Commit mirror sync**

```bash
git add .evo-lite/cli/planning/progress.js .evo-lite/cli/planning.js .evo-lite/cli/dashboard-data.js .evo-lite/generated/planning/progress-report.json .evo-lite/generated/dashboard/dashboard-data.json
git commit -m "chore(sync): mirror plan progress to .evo-lite/cli + generated artifacts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
| Requirement | Task |
|-------------|------|
| Exit with error + hint when plan-ir absent | Task 2 (command guard) |
| Produce `progress-report.json` | Task 1 `writeProgressReport` |
| Tasks `[x]` + valid git refs → `verified` | Task 1 `evaluateTask` algorithm |
| Tasks `[x]` + no evidence → `implemented` 0.50 | Task 1 algorithm |
| Tasks `[ ]` + no evidence → `todo` 0.00 | Task 1 algorithm |
| Invalid SHA → `valid: false`, not positive evidence | Task 1 `validateGitRef` catch block |
| `dashboard build` includes progress summary | Task 3 |
| Complete under 5 seconds | git calls capped at 5000ms timeout each; no unbounded loops |

**Placeholder scan:** All code blocks complete. No TBD. ✅

**Type consistency:**
- `evaluateProgress` returns `{ version, generatedAt, planIrPath, summary, byPlan, tasks }` — matches schema in spec
- `writeProgressReport(report, projectRoot)` — called with same signature in Task 2
- `dashboard.planning.progress` has `{ summary, byPlan }` — Task 3 injects exactly that shape
- `task.evidence` in plan-ir is `string[]` from `parse-markdown.js:62` — `filter(e => /^git:/.test(e))` correct ✅
