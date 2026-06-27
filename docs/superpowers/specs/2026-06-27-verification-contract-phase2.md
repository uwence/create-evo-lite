---
id: spec:verification-contract-phase2
status: done
created: 2026-06-27
linkedPlan: plan:verification-contract-phase2
---

# Verification Contract Phase 2 — Closure Preview Spec

## Goal

Add `mem close --preview <spec>`: a read-only judgment of whether a spec is
ready to close, gated on its machine-readable acceptance criteria all being PASS.
This turns "green ≠ verified" fully around — without PASS contract evidence at
HEAD, a spec cannot be reported READY to close. Read-only: it mutates nothing.
`--apply` (performing the closure) is the next phase.

## Why

Phases 0–1 made acceptance criteria machine-readable and produced live,
commit-bound verdicts. Phase 2 consumes those verdicts as a closure gate, so the
manual, error-prone closure dance ([[the R008 backfill recipe]]) gets a single
read-only readiness answer first. It is the consumer the whole contract was built
for.

## Builds on Phases 0–1

Reuses, unchanged: `statusSpec` (Phase 1, four-state verdicts per criterion),
`parseSpecCriteria`, `parseFrontmatter`, and the planning IR (`plan-ir.json`).
Phase 2 adds a pure readiness judgment + a CLI surface.

## CLI surface

- `mem close --preview <spec>` — read-only. `<spec>` is a spec file path. Prints a
  readiness verdict, blockers (with per-blocker remedies), and the closure action
  list `--apply` would perform. `--json` for machine output. Exit 0 always (it is
  a report, not a gate); `--strict` exits non-zero unless the verdict is READY.
- Without `--preview` the command errors `--apply not yet implemented (Phase 3)` —
  `--preview` is mandatory in Phase 2 so the flag is explicit and future-proof.

## Readiness model (three states)

`previewClose(spec, opts) -> { readiness, criteria, plan, blockers, actions }`.

- **NO-CONTRACT** — the spec declares zero criteria. The contract gate cannot
  apply; this is an honest opt-out, NOT a failure. The report says "this spec has
  no machine-readable acceptance criteria — add a `criteria` block for a real gate,
  or close manually." (The 12 pre-contract specs are all NO-CONTRACT.)
- **BLOCKED** — the spec has ≥1 criteria but not all are PASS. Lists each
  non-PASS criterion, its verdict, and a remedy.
- **READY** — the spec has ≥1 criteria and every one is PASS at HEAD.

The criteria gate is the ONLY hard gate. Plan checkboxes, spec status, and R008
evidence are mechanical closure outputs (what `--apply` will produce), never
preconditions — reporting them informs the action list, not the readiness verdict.

### Per-blocker remedies

| criterion verdict | remedy reported |
|-------------------|-----------------|
| `UNVERIFIED` (machine type) | "run `mem verify-contract run <spec>` on a clean HEAD" |
| `STALE` (machine type) | "dependsOn changed since evidence — re-run `mem verify-contract run <spec>`" |
| `UNVERIFIED` (manual type) | "attest: `mem verify-contract attest <spec> <criterionId> --by <name>`" |
| `FAIL` | "verifier failed — fix the underlying issue, then re-run" |

## Plan-state reporting (informational)

From the planning IR, for the spec's `linkedPlan`: `{ planId, tasksTotal,
tasksImplemented, uncheckedBoxes, specStatus }`. Drives the action list; never a
blocker.

## Closure action list (what `--apply` would do — Phase 3)

Reported in every state (labelled "would run" when READY, "would run once
unblocked" when BLOCKED, omitted for NO-CONTRACT):
- flip the linked plan's `N` unchecked `- [ ]` task checkboxes to `- [x]`,
- set the spec frontmatter `status: done` (if not already),
- backfill R008 archive evidence for the plan's tasks.

These are the existing-governance closure mechanics (the manual recipe), surfaced
so a reviewer sees exactly what `--apply` will mutate.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-ready-when-all-pass",
      "description": "previewClose returns READY when a spec has >=1 criteria and statusSpec reports all PASS.",
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-blocked-lists-remedies",
      "description": "previewClose returns BLOCKED with a per-criterion remedy when any criterion is STALE/UNVERIFIED/FAIL.",
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-no-contract-state",
      "description": "previewClose returns NO-CONTRACT (not BLOCKED) for a spec with zero criteria.",
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-action-list-and-plan-state",
      "description": "previewClose reports linked-plan state and the closure action list (flip boxes / spec done / backfill).",
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-cli-read-only",
      "description": "mem close --preview prints a verdict and mutates no files; --strict exits non-zero unless READY.",
      "dependsOn": ["templates/cli/verification/close-commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- `mem close --apply` — performing the closure + rollback journal (Phase 3).
- Wiring readiness into the drift engine / dashboard (later).
- Changing R008 / planning IR / `statusSpec` behavior.
- Multi-spec / batch close.

## Testing notes

Governance tests T38+ use fixture specs + injected `statusSpec`/IR readers so the
readiness logic is unit-tested without running real verifiers or git. The CLI test
asserts no file mutation (snapshot the fixture dir before/after).
