---
id: spec:verification-contract-phase3
status: draft
created: 2026-06-27
linkedPlan: plan:verification-contract-phase3
---

# Verification Contract Phase 3 — Closure Apply Spec

## Goal

Add `mem close --apply <spec>`: perform the closure action list (flip the linked
plan's task checkboxes, set the spec frontmatter `status: done`, backfill R008
archive evidence) — but ONLY when `previewClose` reports READY, and only as an
atomic, journaled mutation that fully rolls back on any failure. This is the
mutation leg the whole Verification Contract was built toward: a spec closes
automatically only when its machine-readable acceptance criteria are all PASS at
a clean HEAD. It retires the manual R008 backfill recipe.

## Why

Phases 0–2 made acceptance criteria machine-readable, produced live commit-bound
verdicts, and gated closure readiness read-only. The closure itself is still the
manual, error-prone dance (flip boxes by hand, hand-edit spec status, remember
`mem plan archive-evidence --backfill && mem plan scan`, get the full `task:<slug>-tN`
id right). Phase 3 makes the action list `previewClose` already reports executable,
gated on READY, with a rollback journal so a half-applied closure can never leave
the runtime state inconsistent.

## Builds on Phases 0–2

Reuses, unchanged:
- `previewClose` (Phase 2) — the readiness gate and the source of the action list.
- `backfillArchiveEvidence(projectRoot)` (planning) — idempotent regeneration of
  `archive-evidence.json` from `raw_memory`.
- `parseFrontmatter` (planning) — reading the spec frontmatter.
- The dirty-tree fail-closed rule from `runSpec` (Phase 1) — evidence and closure
  must bind to a real committed state.

Phase 3 adds the mutation engine + an atomic journal + the `--apply` CLI surface.

## CLI surface

- `mem close --apply <spec>` — perform the closure. `--json` for machine output.
  - Refuses (exit 1) when the working tree is dirty, or when `previewClose` is not
    READY (BLOCKED prints blockers; NO-CONTRACT prints the no-contract note).
  - On success, prints the actions performed, the journal path, and the staged
    files; exit 0.
- `mem close --preview <spec>` (Phase 2) is unchanged and remains the read-only
  path. Exactly one of `--preview` / `--apply` is required; passing neither errors
  `specify --preview or --apply`.

## Gate (fail-closed, evaluated in order)

1. **Clean tree.** `git status --porcelain` must be empty. A dirty tree means the
   working state does not match any commit, so contract evidence binding is
   meaningless — refuse with `working tree is dirty — commit or stash first`.
2. **READY only.** Run `previewClose(specPath)`. If `readiness !== 'READY'`,
   refuse: for BLOCKED print each blocker (`criterionId [verdict] → remedy`); for
   NO-CONTRACT print the note. The criteria gate is the ONLY hard gate; checkboxes,
   spec status, and R008 are mutations, never preconditions.

## Mutation engine (`applyClose`)

`applyClose(specPath, opts) -> { applied, readiness, actions, journalPath, staged, aborted?, blockers?, note? }`.

`opts`: `{ root, previewFn, exec }` — `previewFn` and `exec` (git/stage runner)
injectable for tests so the engine is unit-testable without real git.

### Target files

Derived from `previewClose`'s result before any write:
- the linked plan's `sourcePath` (`.md`) — when `plan.uncheckedBoxes > 0`,
- the spec file — when frontmatter `status !== 'done'`,
- `.evo-lite/generated/planning/archive-evidence.json` — always (R008 backfill),
- `.evo-lite/generated/planning/plan-ir.json` — always (rescan after backfill).

### Journal-then-apply (atomic)

1. **Snapshot.** For every target file, record `{ path, priorBytes }` where
   `priorBytes` is the current file content or `null` if the file does not exist.
   Write `{ version: 'evo-close-journal@1', spec, createdAt, status: 'applying',
   entries: [...] }` to `.evo-lite/verification/close-journal-<slug>.json`.
   `createdAt` is supplied by the caller (no `Date.now()` in pure engine paths;
   the CLI passes `new Date().toISOString()`).
2. **Apply, in sequence:**
   - **Flip checkboxes:** read the plan `.md`, replace every `- [ ] ` with
     `- [x] `, write back. (No-op if none.)
   - **Spec status:** rewrite the frontmatter `status:` line to `status: done`
     (insert into frontmatter if the key is absent). (No-op if already `done`.)
   - **R008 backfill:** call `backfillArchiveEvidence(root)` (regenerates
     `archive-evidence.json`), then regenerate `plan-ir.json` via the existing
     planning scan so task evidence links refresh.
3. **Rollback on failure.** If any apply step throws, restore every journaled
   entry — rewrite `priorBytes`, or delete the file if `priorBytes === null` —
   then mark the journal `status: 'aborted'` and return `{ applied: false,
   aborted: true }`. The error propagates after restoration; the tree is left as
   it was before `applyClose`.

### Staging (no commit)

On success, `git add` exactly the mutated files (plan `.md`, spec, and the two
generated JSON files if tracked). The changes are left staged; `applyClose` does
NOT commit — the commit message and timing belong to the user / `/commit` /
`mem commit`. The journal records `status: 'applied'`.

### Idempotency

A READY spec already `status: done` with zero unchecked boxes still succeeds: the
checkbox/status steps are no-ops, R008 backfill regenerates identical artifacts,
`actions` is `['backfill R008 evidence ...']` (or empty if nothing changed),
`applied: true`.

## STALE interaction (informational)

Flipping plan checkboxes and setting spec status mutate the plan `.md` and spec
files, which are NOT in any criterion's `dependsOn` (those point at code files like
`close-apply.js` / `test.js`). So closure does not STALE the spec's own criteria —
the same property proven by the Phase 2 capstone, now relied on by `--apply`.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-apply-when-ready",
      "description": "applyClose performs all three closure mutations (flip checkboxes, spec status done, R008 backfill) when previewClose is READY.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-refuse-when-not-ready",
      "description": "applyClose refuses and mutates nothing when previewClose is BLOCKED or NO-CONTRACT.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-rollback-on-failure",
      "description": "When an apply step throws mid-closure, applyClose restores every journaled file to its prior bytes and marks the journal aborted.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-dirty-tree-fail-closed",
      "description": "applyClose refuses when the working tree is dirty, before any mutation.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-cli-apply-wiring",
      "description": "mem close --apply runs applyClose and prints actions/journal/staged; --json emits the result object; neither-flag errors.",
      "dependsOn": ["templates/cli/verification/close-commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- Auto-committing the closure (left staged for the user / `/commit`).
- Multi-spec / batch close.
- Wiring closure into the drift engine / dashboard.
- Changing R008 / planning IR / `statusSpec` / `previewClose` behavior.
- Re-running verifiers during `--apply` (that is `run`'s job; `--apply` trusts the
  READY verdict derived from stored evidence at a clean HEAD).

## Testing notes

Governance tests T40+ use fixture spec/plan dirs + injected `previewFn`/`exec` so
the mutation + rollback logic is unit-tested without real git or real verifiers.
The rollback test injects a throwing backfill step and asserts every target file
is byte-identical to its pre-apply state. The dirty-tree test injects an `exec`
that reports porcelain output and asserts zero file mutation. The CLI test asserts
`--apply` calls the engine and `--json` shape, and that neither-flag errors.
