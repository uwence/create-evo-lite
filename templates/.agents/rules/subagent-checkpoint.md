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
