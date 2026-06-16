---
id: spec:plan-progress
status: done
created: 2026-06-16
linkedPlan: plan:plan-progress
---

# Plan Progress — Design Spec

## Goal

Add `mem plan progress` command that enriches Planning IR task statuses with multi-signal evidence evaluation, producing `progress-report.json` with per-task `derivedStatus` and `confidence`.

## Problem Statement

`plan scan` maps checkbox state directly to task status (`[x]` → `implemented`, `[ ]` → `todo`). This misses real completion signals: git commits, file existence, archive entries. A task marked `[x]` with no evidence has the same status as one with 5 verified commits. The dashboard cannot show progress confidence without this layer.

## Non-Goals

- No mutation of plan files or plan-ir.json.
- No LLM inference.
- No GitHub PR integration.
- No cross-repository evidence lookup.
- No re-running `plan scan` (reads plan-ir.json, does not re-parse markdown).

## Requirements

1. `plan progress` MUST read `plan-ir.json`. If absent, exit with hint to run `plan scan` first.
2. For each task, MUST evaluate four evidence signals: checkbox, git refs, linked files, archive hits.
3. Git ref validation MUST call `git show --stat {sha}` and capture one-line summary or mark invalid.
4. `derivedStatus` MUST be one of: `verified`, `implemented`, `in_progress`, `todo`.
5. `confidence` MUST be a float 0.0–1.0 per the algorithm below.
6. Output MUST be written to `.evo-lite/generated/planning/progress-report.json`.
7. `dashboard build` MUST read `progress-report.json` when present and inject into dashboard data.
8. Command MUST complete under 5 seconds for ≤100 tasks on a local git repo.

## Architecture

### Input

Reads from `.evo-lite/generated/planning/plan-ir.json` (produced by `plan scan`).

### Evidence Signals Per Task

| Signal | Source | How |
|--------|--------|-----|
| `checkboxStatus` | plan-ir task.status | `'implemented'` \| `'todo'` |
| `gitRefs` | task.evidence `git:xxxxx` refs | `git show --stat {sha}` — valid=true/false, summary=first line |
| `linkedFilesRatio` | task.linkedFiles | `fs.existsSync` per file, ratio of existing/total (1.0 if no linkedFiles) |
| `archiveHits` | `.evo-lite/raw_memory/*.md` filenames | count of files whose name contains task id slug |

### derivedStatus Algorithm

```
checkbox=implemented AND validGitRefs≥1 AND linkedFilesRatio=1.0  → verified     confidence=0.95
checkbox=implemented AND (validGitRefs≥1 OR linkedFilesRatio>0)   → implemented  confidence=0.80
checkbox=implemented AND no positive evidence                      → implemented  confidence=0.50
checkbox=todo       AND (validGitRefs≥1 OR linkedFilesRatio>0)    → in_progress  confidence=0.40
checkbox=todo       AND no positive evidence                       → todo         confidence=0.00
```

`archiveHits` is informational only — does not change derivedStatus tier, but adds to confidence: `min(confidence + archiveHits * 0.02, 1.0)`.

### Output Schema

```json
{
  "version": "evo-progress@1",
  "generatedAt": "2026-06-16T00:00:00.000Z",
  "planIrPath": ".evo-lite/generated/planning/plan-ir.json",
  "summary": {
    "total": 33,
    "verified": 5,
    "implemented": 20,
    "in_progress": 3,
    "todo": 5
  },
  "byPlan": {
    "plan:project-control-dashboard-mvp": {
      "total": 10,
      "verified": 3,
      "implemented": 5,
      "in_progress": 1,
      "todo": 1
    }
  },
  "tasks": [
    {
      "id": "task:add-plan-scan-command",
      "title": "Add plan scan command",
      "linkedPlan": "plan:project-control-dashboard-mvp",
      "checkboxStatus": "implemented",
      "derivedStatus": "verified",
      "confidence": 0.97,
      "evidence": {
        "gitRefs": [
          { "ref": "git:abc1234", "valid": true, "summary": "feat: add plan scan command" }
        ],
        "linkedFilesRatio": 1.0,
        "linkedFilesTotal": 2,
        "linkedFilesExist": 2,
        "archiveHits": 1
      }
    }
  ]
}
```

## Files Changed

- Create: `templates/cli/planning/progress.js`
- Modify: `templates/cli/planning.js` — register `progress` subcommand
- Modify: `templates/cli/memory.js` — wire planning.js (already wired; verify `plan progress` reachable)
- Modify: `templates/cli/dashboard-data.js` — read progress-report.json and inject into dashboard.planning
- Mirror: `.evo-lite/cli/planning/progress.js`, `.evo-lite/cli/planning.js`, `.evo-lite/cli/memory.js`, `.evo-lite/cli/dashboard-data.js`

## Acceptance Criteria

- [ ] `mem plan progress` exits with error + hint when plan-ir.json absent
- [ ] `mem plan progress` produces `.evo-lite/generated/planning/progress-report.json`
- [ ] Tasks with `[x]` + valid `evidence: git:xxxxx` refs → `derivedStatus: verified`
- [ ] Tasks with `[x]` + no evidence → `derivedStatus: implemented`, `confidence: 0.50`
- [ ] Tasks with `[ ]` + no evidence → `derivedStatus: todo`, `confidence: 0.00`
- [ ] Invalid git SHA (non-existent) → `valid: false` in gitRefs, does not count as positive evidence
- [ ] `dashboard build` after `plan progress` includes `summary` in dashboard.planning
- [ ] Command completes under 5 seconds on this repo
