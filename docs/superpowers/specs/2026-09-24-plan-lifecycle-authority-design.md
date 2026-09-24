---
id: spec:plan-lifecycle-authority
status: adopted
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
**Supersedes in part (§3):** the "flip checkboxes" apply step of
`spec:verification-contract-phase3`, and the "when flipping checkboxes" half of
`ac-plan-status-done` in `spec:verification-contract-closure-correctness`. That
spec's Non-Goals deferred the "criteria-gated vs task-evidence-driven closure"
debate; §3 settles it. Both documents stay as historical record; they are not
edited.

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
  rewrite any historical plan, individually or in bulk. The only historical
  writes it permits are Phase C applying per-plan decisions the owner recorded
  in Phase B (§4).
- No checkbox is flipped, by this spec or by anything it authorizes — including
  the existing verification close path, whose checkbox rewrite §3 retires.
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
  changes is that it is never derived. Provenance records where the value came
  from, not what it is:

  | frontmatter | `status` | `lifecycleProvenance` |
  | --- | --- | --- |
  | `status` key absent | `unknown` | `unspecified` |
  | `status: unknown` written explicitly | `unknown` | `authored` |
  | any other written value | that value | `authored` |

  (`spec-portfolio` treats an authored spec `unknown` as absent only because the
  upstream spec parser cannot tell them apart; the plan parser can, so it must.)
- `taskCompletion`: `no-tracked-work` when the plan has zero parsed tasks;
  `complete` when every parsed task is `implemented`; otherwise `incomplete`.
  It is computed by one function for both parse paths.
- `taskCompletion` is deliberately **not** named `progress`: `mem plan progress`
  already names the evidence evaluation (`verified` / `implemented` / …) and
  `active.plan.progress` is an existing `done/total` display string. Checkbox
  completion is neither.
- An authored value outside the recognized set (e.g. `in_progress`) is preserved
  verbatim and never coerced to a recognized value. It surfaces as a
  **planning-scan warning** only, emitted by `planning/scan.js` in the same
  shape as today's `[warning] Skipped …` entries, which carry no `rule` field
  (unlike the P001/R003 scan warnings). It is not a drift finding, not
  dispositionable, and adds no rule id or rule version; making it a governance
  finding would need its own spec.

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

## §3 Close Writes Lifecycle Only

A plan leaves the open lifecycle only by an authored transition, and **every**
close path writes lifecycle and nothing else. The state

```text
status = done, taskCompletion = incomplete
```

is legal. It is not a contradiction; it is the reason for two axes: the
lifecycle was formally closed, and the tracked work was not forged into
completion to match.

**One write rule for every plan-lifecycle write** (close, and the Phase C
migration in §4): write the `status` key only, creating a minimal frontmatter
block when the plan has none (12 of the 24 unspecified plans have no
frontmatter at all; the other 12 have one without `status`). Never add or
change any other key — adding `id: plan:` would move the file from the
Superpowers parse path to the native one, so a lifecycle write would silently
become a parse-path change. The body is byte-identical and the file's newline
style is preserved.

- **`mem plan close <id>`** (Phase D) writes `status: done` under that rule.
- **Verification close** (`close-preview` / `close-apply`): a READY contract
  verdict authorizes closing the spec and writing `status: done` on its linked
  plans. It does **not** authorize the claim that every checkbox's work was
  done. The checkbox rewrite (`markTrackedPlanCheckboxesDone`) is **retired**
  by this contract: the preview no longer lists a flip action, apply no longer
  performs one, and the existing `tasks-incomplete` warning stays as the
  operator's signal. The "does this plan still need `status: done`" decision
  reads authored `status`: today an all-checked Superpowers plan without
  authored status reports `done` and the write is skipped, leaving no durable
  lifecycle record.
- R008 evidence backfill is unaffected; it records evidence, not completion.
  No drift rule on main conditions on "`done` plan with unchecked tasks"
  (checked across `planning/`), so retiring the flip creates no finding by
  itself.
- Whether `mem plan close` may close a plan whose `taskCompletion` is not
  `complete`, and what it must record when it does, is decided in the Phase D
  plan. What is fixed here: no close path infers lifecycle, and no close path
  edits completion.

## §4 Migration Boundary

**The migration-impact population** is the union of two sets of existing plans:

1. **parser population** — plans whose `status` changes under §1/§2;
2. **eligibility population** — plans whose `status` is unchanged but whose
   §5.1 active-plan eligibility changes (they are status-stable yet
   behavior-changing: `context auto-refresh` could newly select them).

Only these two classes are in the census. Other consumer differences either
follow from a status change already in set 1, or come from semantics this
contract keeps; the census is not a general impact analysis.

For each plan in the population there are three distinct things, and only the
last needs a human:

| kind | content | who decides |
| --- | --- | --- |
| authority fact | authored `status`, or its absence | parser |
| observed fact | `taskCompletion` | parser |
| migration decision | the plan's target lifecycle | owner, per plan |

**Phase B — census and decisions (no plan writes).** A read-only enumeration
lists every plan in the migration-impact population with its set (parser /
eligibility), its current value, its value under the converged parser, and its
`taskCompletion`. Phase B's own tracked plan document is the decision
artifact — no new ledger or runtime. It MUST record **exactly one** decision
per enumerated plan, recording a target lifecycle, not whether a write is
needed:

- `target <recognized-status>` — the plan's lifecycle after Phase C. When it
  equals the plan's current authored value (e.g. `target active` for a plan
  already authored `active`), Phase C writes no bytes; otherwise Phase C
  writes it under §3's write rule.
- `leave unknown` — keep `status` absent (`unknown`, `unspecified`). Valid only
  for plans with no authored `status`; distinct from `target unknown`, which
  writes an authored `unknown`.

Completeness is set equality: enumerated population = decided population, with
no plan missing, none extra, none decided twice. Phase C is not authorizable
until that check is clean against the real census.

**Phase C — one atomic migration.** A single reviewed change that, in order:
(1) applies the approved `target` decisions under §3's write rule,
(2) switches parser semantics, (3) reconciles every §5 consumer. It merges as
one unit. So no plan on main passes through a false `done → unknown → done`,
the only plans that become `unknown` are those the owner decided to leave
`unknown`, and no plan becomes auto-refresh-selectable without a recorded
decision. Findings and behavior that appear are therefore decided before the
switch, not discovered after it as "migration work" — the governance layer must
not manufacture noise and then govern it.

Current population (main@5a3672b, computed, no overlap between the sets):

| set | plans | count |
| --- | --- | --- |
| parser | 21 derived `done → unknown`; 3 derived `draft → unknown` (`evidence-durability-stale-cascade`, `mother-child-hive-nurture`, `backlog-edit-cli-gap`) | 24 |
| eligibility | `plan:governance-observation-budget`, `plan:planning-truth-controls` — authored `active`, ineligible under today's `in_progress`/`draft` rule, eligible under §5.1 | 2 |
| **migration-impact** | | **26** |

One consequence is already
predictable and is exactly what Phase B decides: `spec:hive-child-feedback-loop`
(spec status `draft`, idle since 2026-07-09) links only
`plan:hive-child-feedback-loop`, derived-done today; if Phase B leaves it
`unknown`, the switch emits `aging-inactive` for that spec, and if it targets
`done`, it does not.

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
| `verification/close-preview`, `close-apply` | `planStatus !== 'done'`; flips checkboxes via `markTrackedPlanCheckboxesDone` | reads authored status; checkbox rewrite retired, plan body untouched (§3) |
| governance tests pinning the flip (`flip N checkbox(es)` actions, post-apply `[x]` bodies) | retired behavior | restate: lifecycle written, body byte-identical |
| `memory.service` `pickActivePlan` (drives `context auto-refresh` FOCUS) | `in_progress`, then `draft` | replaced by §5.1 |
| `memory.service` no-active-plan nudge | `in_progress \|\| draft` | uses §5.1's eligibility, not its own condition |
| `memory.service` focus auto-advance | refuses `parked` | unchanged |
| `governance-observer` `detectFocusPlanDrift` | `=== 'active'` | unchanged |
| `planning.js`, `inspector.js`, `memory.js` | display | may show `taskCompletion` beside `status` |
| `takeover-session.js` comment | claims status ∈ `done\|parked\|draft` | already false (`active`, `unknown` exist); correct it |
| `test/integration.js` CRLF plan test | asserts derived `done` when all implemented | encodes the retired semantics; restate against `taskCompletion` |

`zombie-plan`, `aging-inactive` and R012 can all change emission for the
same document. Phase C MUST apply `spec:disposition-ledger` §2.3 to each rule
whose emission condition or `factInputs` values change, naming the bump (or the
§2.3.1 carve-out it relies on) per rule. R012 is currently `@1`.

### §5.1 Active-Plan Eligibility

One eligibility rule, shared by `pickActivePlan` and the no-active-plan nudge;
neither may restate it.

1. authored `status: active` → eligible, first priority;
2. authored `status: draft` → eligible, second priority;
3. `unknown`, `parked`, `done` and any unrecognized value → never eligible;
4. `taskCompletion` plays no part in eligibility or priority;
5. ties within a priority resolve by plan-IR order, as `find` does today.

`in_progress` is retired from both consumers: no plan authors it, and under §1
it would be an unrecognized value.

Foreseeable consequence, recorded rather than decided here:
`plan:governance-observation-budget` and `plan:planning-truth-controls` are
authored `active` with every task checked, while their specs are
`closed-record-only` (PR #76). Under this rule `context auto-refresh` would
select one of them. That is the rule reading true authored state; whether those
two plans stay `active` is a per-plan lifecycle decision for the owner.

## §6 Phases

| phase | content | authorized by |
| --- | --- | --- |
| A | this contract | this document |
| B | migration-impact census (parser ∪ eligibility) + exactly one `target` / `leave unknown` decision per plan, recorded in its plan document; no plan writes | its own plan |
| C | one atomic change: approved status writes → parser convergence → consumer reconciliation (§5), incl. retiring the verification-close checkbox rewrite | its own plan, after B's completeness check is clean |
| D | `mem plan close` | its own plan |
| E | review the zombie-plan findings one plan at a time | owner, per plan |

Freezing this contract changes no finding. Phase C changes only findings that
Phase B's decisions fixed in advance. The three current `zombie-plan` findings
link plans that are authored `draft` or derived `draft` — unsettled before and
after the switch unless Phase B records otherwise — so that count moves only
when a specific plan is decided or closed, never as a side effect.

## Acceptance Criteria

These are the contract the Phase C and D implementations will be verified
against. They are expected to be unverified until then.

```json
{
  "criteria": [
    {
      "id": "ac-equivalent-documents-equal-lifecycle",
      "description": "Two content-equivalent plans, one parsed by parsePlanFile (native) and one by parseSuperPowersPlan, both with no authored status and every tracked task implemented, produce equal status (unknown), equal lifecycleProvenance (unspecified) and equal taskCompletion (complete); the same holds when both carry the same authored status. Counterexample locked: a plan that explicitly writes status: unknown yields status unknown with lifecycleProvenance authored, not unspecified, on both parse paths.",
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
      "description": "An authored plan status outside {draft, active, parked, done, unknown} (e.g. in_progress) is preserved verbatim in status and surfaced as a mem plan scan warning of the same shape as the existing Skipped warnings, carrying no rule field; it is not mapped to any recognized value by either parse path, and it produces no drift finding, no disposition fingerprint and no new rule id.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/parse-markdown.js", "templates/cli/planning/scan.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-r012-identity-is-format-independent",
      "description": "R012 phantom-focus on two equivalent plans that differ only in parse path yields the same emission decision and, when emitted, an identical computeFingerprint; the R012 ruleVersion change (or the disposition-ledger 2.3.1 carve-out relied on) is recorded.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/gaps.js", "templates/cli/disposition/fingerprint.js", "templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-close-writes-done-and-leaves-checkboxes",
      "description": "mem plan close writes an explicit status: done into the plan frontmatter, after which the parsed status is done with lifecycleProvenance authored; the plan body, including every checkbox, is byte-identical before and after. For a plan with no frontmatter, the only added content is a frontmatter block containing exactly status: done, no id key is added so the parse path is unchanged, and the file's original newline style is preserved. A second close leaves the file byte-identical.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning.js", "templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-verification-close-writes-lifecycle-only",
      "description": "Verification close writes lifecycle only. For an all-checked Superpowers plan with no authored status, close-preview lists a set status: done action (today it is skipped because the derived status is already done) and close-apply persists it. For a plan with unchecked tasks, a READY close still writes status: done, close-preview lists no checkbox-flip action, and after close-apply the plan body is byte-identical with every checkbox unchanged, so status done with taskCompletion incomplete is the result.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/verification/close-preview.js", "templates/cli/verification/close-apply.js", "templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-migration-population-enumerable-before-switch",
      "description": "A read-only enumeration lists the migration-impact population: every plan whose status changes under the converged parser, plus every plan whose status is unchanged but whose active-plan eligibility changes; each entry names its set, current value, converged value and taskCompletion. On a fixture corpus covering both sets it lists exactly those plans and no others, and performs no writes. A completeness check compares that population with a per-plan decision set (target <recognized-status> or leave unknown) and reports every missing, extra and duplicated decision, and every leave unknown given to a plan that has an authored status; it passes only when the enumerated population equals the decided population and every plan has exactly one valid decision.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/planning/scan.js", "templates/cli/planning/parse-markdown.js", "templates/cli/memory.service.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-active-plan-selection-uses-authored-lifecycle",
      "description": "pickActivePlan selects an authored active plan before an authored draft plan; plans whose status is unknown, parked, done or an unrecognized value are never selected; ties within a priority resolve by plan-IR order; the no-active-plan nudge reaches its decision through the same eligibility function; changing taskCompletion alone never changes which plan is selected.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/memory.service.js", "templates/cli/planning/parse-markdown.js", "templates/cli/test/governance.js"]
    }
  ]
}
```

## Follow-ups (not authorized by this spec)

- Whether `mem plan close` may close a plan with `taskCompletion` other than
  `complete`, and with what recorded reason (§3, Phase D).
- The per-plan migration decisions for the 26 migration-impact plans (§4, Phase B).
- Whether the recognized plan-status set should share one vocabulary module
  with `RECOGNIZED_SPEC_STATUSES`.
