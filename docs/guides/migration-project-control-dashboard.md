# Migration Guide: Adopting Project Control Dashboard

For existing Evo-Lite projects that want to add planning governance and the local inspector dashboard.

---

## Prerequisites

- Evo-Lite installed: `.evo-lite/cli/` contains `memory.js`, `planning.js`, `architecture.js`, `dashboard-data.js`, `inspector.js`
- Host wrapper available: `.evo-lite/mem` (Unix) or `.evo-lite/mem.cmd` (Windows)

Verify:

```bash
.evo-lite/mem plan status
```

Expected: lists spec/plan sources (may say "missing" if no docs yet — that's fine).

---

## Step 1: Create your first spec

Specs live in `docs/specs/` or `docs/superpowers/specs/`.

**Evo-Lite native format** (`docs/specs/my-feature.md`):

```markdown
---
id: spec:my-feature
status: planned
created: 2026-01-01
---

# My Feature

## Goal

One sentence.

## Acceptance Criteria

- Something works.

## Linked Plans

- plan:my-feature-mvp
```

**Superpowers format** (`docs/superpowers/specs/YYYY-MM-DD-my-feature-design.md`):

```markdown
---
id: spec:my-feature
status: draft
created: 2026-01-01
linkedPlan: plan:my-feature
---

# My Feature — Design Spec
```

---

## Step 2: Create your first plan

**Evo-Lite native format** (`docs/plans/my-feature-mvp.md`):

```markdown
---
id: plan:my-feature-mvp
status: in_progress
linkedSpec: spec:my-feature
created: 2026-01-01
---

# My Feature MVP Plan

## Tasks

- [ ] [task:task-slug] Do the thing
  - files: src/my-feature.js
  - verify: node src/my-feature.js

- [ ] [task:task-slug-2] Write tests
  - files: tests/my-feature.test.js
```

**Superpowers format** (`docs/superpowers/plans/YYYY-MM-DD-my-feature.md`):

```markdown
# My Feature Implementation Plan

> **For agentic workers:** ...

**Goal:** ...

---

### Task 1: Do the thing

**Files:**
- Create: `src/my-feature.js`

- [ ] **Step 1:** ...
- [ ] **Step 2:** ...
```

Plan id is derived from filename: `YYYY-MM-DD-my-feature.md` → `plan:my-feature`.

---

## Step 3: Run planning scan

```bash
.evo-lite/mem plan scan
```

Output: `.evo-lite/generated/planning/plan-ir.json`

Verify it found your spec and plan:

```bash
.evo-lite/mem plan status
```

Expected:

```
spec  spec:my-feature  [planned]
      ↳ plan:my-feature-mvp
plan  plan:my-feature-mvp  [in_progress]  0/2 tasks done
```

---

## Step 4: Run architecture scan

```bash
.evo-lite/mem architecture scan
```

Output: `.evo-lite/generated/architecture/architecture-ir.json`

---

## Step 5: Check drift

```bash
.evo-lite/mem plan gaps
```

Common first-run warnings:

| Rule | Meaning | Fix |
|------|---------|-----|
| R005 | Task has no `linkedFiles` | Add `- files: path/to/file` to task |
| R008 | Implemented task has no evidence | Run `mem archive` after completing task |
| R010 | Backlog item not in Planning IR | Create a task that covers the backlog item |
| R011 | Plan done but spec not `done` | Update `status: done` in spec frontmatter |

---

## Step 6: Build dashboard

```bash
.evo-lite/mem dashboard build
```

Output: `.evo-lite/generated/dashboard/dashboard-data.json`

---

## Step 7: Open inspector

```bash
.evo-lite/mem inspect
```

Opens local dashboard at `http://127.0.0.1:<port>`. Shows Planning tab with your spec, plan, and tasks.

---

## Existing projects: backfilling specs

If your project has code but no specs/plans yet:

1. Write a spec describing what the project does (retrospective spec).
2. Write a plan with tasks mapped to already-implemented work.
3. Mark completed tasks with `[x]` (native) or all steps as `[x]` (superpowers).
4. Add `evidence: git:<sha>` refs to tasks that have commits.
5. Run `mem plan scan` → `mem plan gaps` → check R008 warnings.

Example retrospective task:

```markdown
- [x] [task:existing-feature] Implement existing feature
  - files: src/existing.js
  - evidence: git:abc1234
```

---

## Checking migration success

```bash
.evo-lite/mem plan status       # all specs/plans visible
.evo-lite/mem plan gaps         # 0 errors, warnings reviewed
.evo-lite/mem architecture scan # modules detected
.evo-lite/mem dashboard build   # dashboard-data.json written
.evo-lite/mem verify            # project_control.planning.planIrExists: true
```

Production ready when:
- `mem verify` shows `project_control.planning.planIrExists: true`
- `mem plan gaps` shows 0 errors
- `mem inspect` shows your spec and tasks in the Planning tab

---

## Superpowers format notes

If you use `superpowers:brainstorming` + `superpowers:writing-plans`:

- Specs go to `docs/superpowers/specs/YYYY-MM-DD-*-design.md`
- Plans go to `docs/superpowers/plans/YYYY-MM-DD-*.md`
- The scanner auto-discovers both paths — no config needed
- Plan id is inferred from filename (strips date prefix)
- Spec must have `linkedPlan: plan:<slug>` in frontmatter (brainstorming skill adds this automatically)
- Step checkboxes (`- [x] **Step N:**`) determine task status

---

## Rollback

The dashboard is read-only. All generated files are under `.evo-lite/generated/` which is gitignored. To remove:

```bash
rm -rf .evo-lite/generated/
```

Spec and plan files in `docs/` are the only additions — remove them if you want to fully revert.
