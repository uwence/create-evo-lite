---
id: spec:verification-contract-closure-hardening
status: draft
created: 2026-06-28
linkedPlan: plan:verification-contract-closure-hardening
---

# Verification Contract — Closure Hardening (PR3-scoped + PR4-A) Spec

## Goal

Close the two genuinely-worth-fixing gaps the external review raised about
`mem close --apply`, while explicitly rejecting the redundant ones. After this
spec:

1. A failure during `git add` rolls back exactly like any other mutation failure
   (today staging is *outside* the try, so a staging error leaves a half-applied,
   un-rolled-back tree).
2. Two concurrent `mem close --apply` runs cannot interleave and corrupt the
   regenerated `plan-ir.json` / `archive-evidence.json` (a minimal advisory lock).
3. `mem close --preview` surfaces unimplemented tasks as a **warning**, not a
   blocker — preserving "acceptance criteria are the only hard gate" while still
   telling the human the planned work is not all done.

## Why (and why NOT the full transaction dir)

The review asked for a crash-safe transaction directory: on-disk journal storing
`priorBytes`, a backups dir, a lock, and `mem close recover/abort`. Most of that
is **redundant given the existing clean-tree invariant**:

- `applyClose` refuses to run unless `git status --porcelain` is empty (Gate 1).
  So at apply time every tracked file equals HEAD.
- If the process crashes mid-apply, the tracked targets (`plan.md`, `spec.md`)
  are recoverable with `git checkout -- <plan> <spec>` — they were clean at HEAD.
- The only non-tracked targets (`.evo-lite/generated/planning/archive-evidence.json`,
  `plan-ir.json`) are gitignored and **fully regenerable** by `scanFn` / `backfillFn`.

So git + a rescan already are the crash backstop. A disk `priorBytes` journal and
`mem close recover/abort` would duplicate what git already guarantees. We drop them
(YAGNI). What git does **not** cover:

- **Staging outside the try** — a real bug. If `exec(['add', ...])` throws, the
  file mutations have already happened and the catch never runs. Fix: move staging
  inside the try so the existing journal rollback fires.
- **Concurrency** — two parallel `--apply` runs both pass Gate 1, then both mutate
  + rescan, racing on the generated artifacts. Cheap fix: a single advisory lock.

## Design

### 1. Staging inside the transaction (close-apply.js)

Move the `git add` of `sourceTargets` from after the `catch` (lines 114-117) to
the end of the `try` block, before the success-journal write. The existing catch
already restores every journal entry (including the freshly-mutated source files)
and writes `status: 'aborted'`. A staging failure now takes that same path.

The success-journal write (`status: 'applied'`) stays after the try (it only
records what happened; its own failure is non-fatal to the mutation).

Behavior unchanged on the happy path; the only difference is that a `git add`
throw now rolls back instead of leaving a half-applied tree.

### 2. Minimal advisory lock (close-apply.js)

Before Gate 1, acquire a lock at `.evo-lite/verification/close.lock`:

- Lock content: `{ pid, startedAt }` (startedAt = `opts.now`).
- If the lock file is **absent** → write it, proceed, and remove it in a `finally`
  that wraps the whole apply body.
- If the lock file **exists**:
  - Parse its `startedAt`. If older than `LOCK_STALE_MS` (10 minutes) → treat as a
    crashed run, overwrite and proceed (stale-tolerant: a crashed `--apply` must not
    brick the command forever — consistent with "git is the backstop").
  - Otherwise → refuse: `{ applied: false, refused: 'locked', message: 'another mem
    close --apply is in progress (close.lock) — wait or remove the lock' }`.
- The lock file lives under `.evo-lite/verification/` and is gitignored alongside
  the journals (`close.lock` added to the verification-dir ignore).

`opts.now` is already injectable (used for journal timestamps); the stale check
reuses it so tests stay deterministic. Lock acquisition is best-effort advisory —
it is NOT a kernel lock; it only guards the normal single-user local case, which
is the whole threat model.

### 3. Task-completeness warning (close-preview.js)

`previewClose` already computes `planState` (`tasksTotal`, `tasksImplemented`,
`uncheckedBoxes`). Add a `warnings` array to the returned object:

- If `planState.found` and `tasksImplemented < tasksTotal` → push
  `{ kind: 'tasks-incomplete', message: 'N of M linked tasks are not implemented —
  closing will mark the spec done anyway' }`.
- `warnings` is `[]` otherwise.

`warnings` **never** affects `readiness`. READY still means criteria all PASS.
The CLI (`close-commands.js`) prints warnings after the readiness verdict (a
`⚠` line each) in both human and `--json` output. This is the PR4-A decision:
criteria are the only hard gate; task completion is advisory.

### 4. `mem close` scope note (PR4-B)

No rename, no expansion. Add one line to the `mem close` help/usage text clarifying
scope: "closes one spec + its linked plan (criteria-gated); not a full-governance
sweep." Documentation-only.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-staging-inside-try",
      "description": "A git add failure during applyClose triggers full journal rollback (every target restored, journal status aborted), not a half-applied tree.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-advisory-lock",
      "description": "applyClose refuses with refused:locked when a fresh close.lock exists, and proceeds (overwriting) when the lock is older than the stale threshold; the lock is removed on normal completion.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-task-warning-not-blocker",
      "description": "previewClose returns a tasks-incomplete warning when implemented<total but readiness stays READY when criteria all PASS; warnings is [] when tasks are complete.",
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- On-disk `priorBytes` journal, backups dir, `mem close recover/abort` (redundant
  given clean-tree + git + regenerable artifacts).
- Kernel/OS file locking or cross-host concurrency (single-user local CLI only).
- Task-gating as a hard close gate (rejected — criteria remain the sole gate).
- Renaming `mem close` or expanding it into full governance self-closure.
- criterion↔task mapping (the warning is plan-level, not per-criterion).

## Testing notes

- Staging-rollback test: inject `exec` that returns `''` for `status --porcelain`
  and **throws** for `add`; assert the result is `aborted`, the spec/plan files are
  restored to prior bytes, and the journal status is `aborted`.
- Lock test: pre-write a fresh `close.lock` → assert `refused: 'locked'`; pre-write
  a stale one (startedAt far before `opts.now`) → assert it proceeds; assert the
  lock file is gone after a successful apply.
- Warning test: build a `planStateFn` returning `tasksImplemented < tasksTotal`
  with all criteria PASS → assert `readiness === 'READY'` AND a `tasks-incomplete`
  warning is present; then with `tasksImplemented === tasksTotal` → assert
  `warnings` is empty.
