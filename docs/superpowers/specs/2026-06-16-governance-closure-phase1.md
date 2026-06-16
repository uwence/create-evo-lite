---
id: spec:governance-closure-phase1
status: draft
created: 2026-06-16
linkedPlan: plan:governance-closure-phase1
---

# Governance Closure Phase 1 — Spec

## Problem

Evo-Lite has governance primitives (drift rules, IR, dashboard) but governance breaks the moment a subagent starts implementing. Three root causes:

1. **No post-commit hook**: plan IR goes stale silently after every commit; dashboard shows wrong data until human manually runs `mem plan scan`.
2. **Subagents don't update plan checkboxes**: tasks stay `todo` forever even after code is committed and tested.
3. **Plans without frontmatter are silently misclassified**: `parseSuperPowersPlan` fallback hides missing `linkedSpec`; no tooling to fix in bulk.

## Goal

Make governance self-enforcing at the commit boundary without requiring agents or humans to remember CLI commands.

## Requirements

### R1 — Post-commit hook installed by `init`

`create-evo-lite init` (or `mem init`) MUST write a `.git/hooks/post-commit` script to the target project's `.git/hooks/` directory.

The hook MUST:
- Be executable (chmod +x on Unix; `.cmd` wrapper on Windows not needed — Git for Windows runs sh hooks)
- Detect which files changed in HEAD via `git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD`
- Conditionally run scans based on changed paths:
  - `docs/specs/**`, `docs/plans/**`, `docs/superpowers/**` changed → `mem plan scan`
  - `templates/cli/**`, `index.js`, `bin/**` changed → `mem architecture scan`
  - Any of the above changed → `mem plan gaps` then `mem dashboard build`
- Run silently on success (no output unless error)
- Not block the commit on scan failure (exit 0 always — governance warns, never blocks commits)
- Skip if `.evo-lite/` does not exist in the repo root (not an evo-lite project)

### R2 — Hook is idempotent

Running `init` multiple times MUST NOT create duplicate hooks. If `.git/hooks/post-commit` already exists and was NOT written by evo-lite, MUST append rather than overwrite (guard with `# evo-lite-hook` sentinel comment).

### R3 — `mem plan lint` command

New subcommand `mem plan lint` MUST:
- Scan all plan files in `docs/specs/`, `docs/plans/`, `docs/superpowers/plans/`, `docs/superpowers/specs/`
- Report plans that:
  - Have no YAML frontmatter at all
  - Have frontmatter but no `id: plan:*`
  - Have `id: plan:*` but no `linkedSpec`
- Exit non-zero if any issues found

### R4 — `mem plan lint --fix`

`mem plan lint --fix` MUST auto-inject minimal frontmatter into plan files that have none:

```yaml
---
id: plan:<slug-from-filename>
linkedSpec: spec:<slug-from-filename>
---
```

Where `<slug-from-filename>` strips the date prefix (`YYYY-MM-DD-`). MUST NOT overwrite existing frontmatter. MUST emit a list of files modified.

### R5 — Dashboard staleness indicator

`dashboard-data.js` MUST add a `freshness` object to the dashboard payload:

```json
{
  "freshness": {
    "planIrAge": 42,
    "archIrAge": 120,
    "lastCommitAge": 5,
    "planStale": true,
    "archStale": false
  }
}
```

Where `*Age` is seconds since last modification. `planStale: true` when `planIrAge > lastCommitAge` (IR older than last commit). Dashboard inspector MUST render a visible warning banner when `planStale || archStale`.

### R6 — Subagent checkpoint rule documented in `.agents/rules/`

A new rule file `.agents/rules/subagent-checkpoint.md` MUST document the required protocol for any agent implementing a plan task:

1. After committing code, update the corresponding `### Task N:` step checkboxes to `- [x]` in the plan file.
2. Commit the updated plan file in the same commit or a follow-up commit before marking the task done.
3. The post-commit hook then auto-refreshes IR and dashboard.

This rule is enforced by the controller during subagent-driven-development (spec reviewer checks plan file was updated before approving a task).

## Non-Goals

- New drift rules R012–R014 (separate spec)
- Changing superpowers plugin skill templates
- Full evidence tracking with git SHA per task (Phase 3)
- Hook for pre-commit (don't block commits)
- Hook for push (separate concern)

## Acceptance Criteria

- `create-evo-lite init` on a git repo writes `.git/hooks/post-commit`; subsequent `git commit` auto-runs plan scan when plan files change
- `mem plan lint` reports plans with missing/incomplete frontmatter
- `mem plan lint --fix` injects frontmatter; re-running is idempotent
- Dashboard `freshness.planStale` is `true` when plan IR is older than last commit
- `.agents/rules/subagent-checkpoint.md` exists and is referenced by `.agents/rules/index.md` (or equivalent)
- All existing tests pass; new tests cover hook installer, lint, lint --fix, freshness computation
