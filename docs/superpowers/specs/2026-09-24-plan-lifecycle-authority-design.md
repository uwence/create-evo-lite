---
id: spec:plan-lifecycle-authority
status: draft
created: 2026-09-24
releaseBlocking: false
---

# Spec: Plan Lifecycle Authority

**Date:** 2026-09-24
**Scope of this document:** Phase A only — freeze the contract. It authorizes no
implementation, no parser change, no CLI, and no change to any existing plan file.
**Depends on:** `spec:disposition-ledger` (finding identity, §2.3 rule versions),
`spec:portfolio-finding-correctness` (`zombieRelevantPlans` / `notDonePlans`).
**Supersedes as authority:** the "freeze the contract first" condition recorded in
Backlog Ideas `[plan-status-parser-divergence]`. That entry's measured facts stay
valid; this document is the contract it was waiting for.

## Problem

`plan.status` is one field carrying two different facts, and which fact it
carries depends on the parse path a document happens to take.

```js
// parseSuperPowersPlan
status: frontmatter.status || (allDone ? 'done' : 'draft')
// parsePlanFile (native)
status: frontmatter.status || 'unknown'
```

The parse path is chosen by **document shape, not directory**: a file with no
`id: plan:` frontmatter always goes to the Superpowers parser, and so does a file
whose native task extraction is empty but which carries `### Task N:` headings.
So two equivalent documents can receive different lifecycle states from nothing
but formatting — and every consumer below then inherits the divergence,
including R012's `factInputs.planStatus`, i.e. finding **identity**, not just
display.

Measured on main@5a3672b (50 plans):

| parse path | authored `status` | current `plan.status` | count |
| --- | --- | --- | --- |
| native | present | done / parked / draft | 7 / 1 / 1 |
| Superpowers | **absent** | **done (derived from checkboxes)** | **21** |
| Superpowers | **absent** | **draft (derived)** | **3** |
| Superpowers | present | done / draft / active | 11 / 4 / 2 |

The 21 derived-done plans are real historical work (the verification-contract
phases, the release-closure series, `pr-state-sync`, …). Any rule of the form
"missing status means unknown" moves all 24 derived plans at once. That blast
radius is the reason this contract has a migration boundary (§4) and not just a
target semantics.

## Non-Goals

- This spec does not rule any specific historical plan `done`, and does not
  rewrite any historical plan, individually or in bulk.
- No checkbox is flipped, by this spec or by anything it authorizes.
- No automatic close. Nothing in this contract turns an observation into an
  authored lifecycle transition.
- Spec lifecycle is untouched (`spec-portfolio` states, `closed-record-only`).
- Rules are changed only as far as they consume `plan.status` (§5); no other
  finding logic is in scope.
- `frontmatter` parsing fidelity (folded scalars, quoting) is a separate
  registered defect and is not fixed here.

The migration boundary is **not** a non-goal: §4 must hold before the parser
semantics switch.

## §1 Two Axes: Lifecycle Is Authored, Completion Is Observed

A plan carries two independent facts. Neither may overwrite the other.

| field | source | values |
| --- | --- | --- |
| `status` (lifecycle) | authored frontmatter **only** | `draft` · `active` · `parked` · `done` · `unknown` |
| `lifecycleProvenance` | parser | `authored` · `unspecified` |
| `taskCompletion` | derived from the plan's tracked task markers | `complete` · `incomplete` · `no-tracked-work` |

- `status` keeps its name so existing consumers keep reading one field; what
  changes is that it is never derived. Missing `status`, or an authored literal
  `unknown`, yields `status: unknown` + `lifecycleProvenance: unspecified`.
- `taskCompletion`: `no-tracked-work` when the plan has zero parsed tasks;
  `complete` when every parsed task is `implemented`; otherwise `incomplete`.
  It is computed by one function for both parse paths.
- `taskCompletion` is deliberately **not** named `progress`: `mem plan progress`
  already names the evidence evaluation (`verified` / `implemented` / …) and
  `active.plan.progress` is an existing `done/total` display string. Checkbox
  completion is neither.
- An authored value outside the recognized set (e.g. `in_progress`) is preserved
  verbatim and surfaced as an unrecognized-plan-status observation; it is never
  coerced to a recognized value. This mirrors `RECOGNIZED_SPEC_STATUSES`.

So a historical Superpowers plan is represented truthfully as
`status: unknown, lifecycleProvenance: unspecified, taskCompletion: complete` —
"nobody formally closed this" and "all tracked work is checked" are both kept.

**Rejected alternative:** a `derived-done` lifecycle value. Once zombie-plan,
R012 or the dashboard branch on it, it is a second lifecycle authority under a
different name — the current implicit dual authority made explicit, not removed.

## §2 Parser Convergence

For any two documents with equal authored frontmatter `status` and equal parsed
task sets, both parse paths MUST produce equal `status`,
`lifecycleProvenance` and `taskCompletion`. Format may change which tasks are
found; it may not change what the found facts mean.

## §3 Close Persists Authored `done`

A plan leaves the open lifecycle only by an authored transition:

- A future `mem plan close <id>` (Phase D) writes an explicit `status: done`
  into the plan's frontmatter. It MUST NOT flip checkboxes: completion is an
  observation, and writing it would forge the second axis to match the first.
  It writes the `status` key only, creating a minimal frontmatter block when the
  plan has none (12 of the 24 unspecified plans have no frontmatter at all; the
  other 12 have one without `status`). It MUST NOT add or change
  any other key: adding `id: plan:` would move the file from the Superpowers
  parse path to the native one, so a lifecycle write would silently become a
  parse-path change.
- The existing verification close path (`close-preview` / `close-apply`)
  already persists `status: done` and flips checkboxes when a contract verdict
  authorizes it. Its decision "does this plan still need `status: done`
  written" MUST read authored `status`, not a derived value — today an
  all-checked Superpowers plan without authored status reports `done` and the
  write is skipped, leaving no durable lifecycle record.
- Whether `mem plan close` may close a plan whose `taskCompletion` is not
  `complete`, and what it must record when it does, is decided in the Phase D
  plan, not here. What is fixed here: close never infers, and never edits
  completion.

## §4 Migration Boundary (Legacy Unspecified Plans)

For each plan whose `status` would change under §1 there are three distinct
things, and only the last needs a human:

| kind | content | who decides |
| --- | --- | --- |
| authority fact | no authored `status` | parser |
| observed fact | `taskCompletion` | parser |
| migration decision | whether to record authored `done` (or another state) | owner, per plan |

Ordering constraint: **the parser switch (Phase C) MUST NOT land before
Phase B.** Phase B produces a read-only enumeration of every existing plan whose
`status` would change, with its current value, its target value and its
`taskCompletion`, and records the owner's per-plan migration decision or an
explicit "leave `unknown`". Findings that newly appear because of the switch are
therefore known before it, not discovered after it as "migration work" — the
governance layer must not manufacture noise and then govern it.

Current population (main@5a3672b): 21 plans derived `done → unknown`, 3 derived
`draft → unknown` (`evidence-durability-stale-cascade`,
`mother-child-hive-nurture`, `backlog-edit-cli-gap`). At least one new finding
is already predictable: `spec:hive-child-feedback-loop` (spec status `draft`,
idle since 2026-07-09) links only `plan:hive-child-feedback-loop`, which is
derived-done today and would become not-done, emitting `aging-inactive`.

## §5 Consumers

Every reader of `plan.status` on main, and what the contract means for it.
Phase C must reconcile each one; this list is the review checklist.

| consumer | reads | consequence |
| --- | --- | --- |
| `parseSuperPowersPlan` | derives from checkboxes | source of divergence; stop deriving (§1) |
| `parsePlanFile` (native) | `frontmatter.status \|\| 'unknown'` | already the target; add provenance + completion |
| `spec-portfolio` `zombieRelevantPlans` | settled = `{done, parked}` | semantics kept; population shifts per §4 |
| `spec-portfolio` `notDonePlans` (aging) | `!== 'done'` | semantics kept; population shifts per §4 |
| `gaps.js` R012 phantom-focus | `status === 'draft' \|\| done === 0`; `factInputs.planStatus` | `unknown` is not `draft`; equivalent plans get equal emission and fingerprint |
| `verification/close-preview`, `close-apply` | `planStatus !== 'done'` | reads authored status (§3) |
| `memory.service` `pickActivePlan` | `in_progress`, then `draft` | `in_progress` is authored by no plan; reconcile to the recognized set |
| `memory.service` no-active-plan nudge | `in_progress \|\| draft` | same |
| `memory.service` focus auto-advance | refuses `parked` | unchanged |
| `governance-observer` `detectFocusPlanDrift` | `=== 'active'` | unchanged |
| `planning.js`, `inspector.js`, `memory.js` | display | may show `taskCompletion` beside `status` |
| `takeover-session.js` comment | claims status ∈ `done\|parked\|draft` | already false (`active`, `unknown` exist); correct it |
| `test/integration.js` CRLF plan test | asserts derived `done` when all implemented | encodes the retired semantics; restate against `taskCompletion` |

`zombie-plan`, `aging-inactive` and R012 can all change emission for the
same document. Phase C MUST apply `spec:disposition-ledger` §2.3 to each rule
whose emission condition or `factInputs` values change, naming the bump (or the
§2.3.1 carve-out it relies on) per rule. R012 is currently `@1`.

## §6 Phases

| phase | content | authorized by |
| --- | --- | --- |
| A | this contract | this document |
| B | read-only migration enumeration + per-plan owner decisions | its own plan |
| C | parser convergence + consumer reconciliation (§5) | its own plan, after B |
| D | `mem plan close` | its own plan |
| E | review the zombie-plan findings one plan at a time | owner, per plan |

Freezing this contract changes no finding: the three current `zombie-plan`
findings link plans that are authored `draft` or derived `draft`, and both are
unsettled before and after. The finding count moves only when a specific plan
is closed in Phase E.

## Acceptance Criteria

These are the contract the Phase C and D implementations will be verified
against. They are expected to be unverified until then.

```json
{
  "criteria": [
    {
      "id": "ac-equivalent-documents-equal-lifecycle",
      "description": "Two content-equivalent plans, one parsed by parsePlanFile (native) and one by parseSuperPowersPlan, both with no authored status and every tracked task implemented, produce equal status (unknown), equal lifecycleProvenance (unspecified) and equal taskCompletion (complete); the same holds when both carry the same authored status.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-completion-never-moves-lifecycle",
      "description": "Changing only checkbox state on a plan with an authored status changes taskCompletion and leaves status and lifecycleProvenance unchanged, on both parse paths; a plan with zero parsed tasks reports taskCompletion no-tracked-work, never complete.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-unrecognized-status-preserved-not-coerced",
      "description": "An authored plan status outside {draft, active, parked, done, unknown} (e.g. in_progress) is preserved verbatim in status and surfaced as an unrecognized-plan-status observation; it is not mapped to any recognized value by either parse path.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-r012-identity-is-format-independent",
      "description": "R012 phantom-focus on two equivalent plans that differ only in parse path yields the same emission decision and, when emitted, an identical computeFingerprint; the R012 ruleVersion change (or the disposition-ledger 2.3.1 carve-out relied on) is recorded.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/gaps.js", "templates/cli/disposition/fingerprint.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-close-writes-done-and-leaves-checkboxes",
      "description": "mem plan close writes an explicit status: done into the plan frontmatter, after which the parsed status is done with lifecycleProvenance authored; the plan body, including every checkbox, is byte-identical before and after; a second close is a no-op.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-verification-close-reads-authored-status",
      "description": "close-preview lists a set status: done action for an all-checked Superpowers plan with no authored status (today it is skipped because the derived status is already done), and close-apply persists it.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/verification/close-apply.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-migration-population-enumerable-before-switch",
      "description": "A read-only enumeration lists every plan whose status would change under the converged parser, with current value, target value and taskCompletion, and on a fixture corpus lists exactly the changing plans and no others; it performs no writes.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/scan.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-regression-done-plan-not-zombie-relevant",
      "description": "Regression guard, already true since PR #75: a parked spec whose only linked plan has status done emits no zombie-plan finding, both before and after parser convergence.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    }
  ]
}
```

## Follow-ups (not authorized by this spec)

- Whether `mem plan close` may close a plan with `taskCompletion` other than
  `complete`, and with what recorded reason (§3, Phase D).
- The per-plan migration decisions for the 24 unspecified plans (§4, Phase B).
- Whether the recognized plan-status set should share one vocabulary module
  with `RECOGNIZED_SPEC_STATUSES`.
