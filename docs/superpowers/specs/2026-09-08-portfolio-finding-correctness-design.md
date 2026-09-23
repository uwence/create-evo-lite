---
id: spec:portfolio-finding-correctness
status: draft
created: 2026-09-08
linkedPlan: plan:record-only-closure-terminal-state
relations: [{"kind":"spawned-from","target":"spec:record-only-closure-terminal-state"}]
---

# Spec: Portfolio Finding Correctness — zombie-plan and size-exceeded

**Date:** 2026-09-08
**Split from:** `spec:record-only-closure-terminal-state`, which carried these
two rules until its combined authority document crossed the active-spec size
boundary. The split is of *document ownership*, not of implementation: both
specs point at one implementation plan. See §5.
**Depends on:** `spec:spec-portfolio-governance` (registry, states, findings),
`spec:disposition-ledger` (finding identity, rule versions),
`spec:record-only-closure-terminal-state` (the `closed-record-only` state whose
size actionability §2 decides).

## Problem

Two registered judgement defects in the spec portfolio's finding layer. Both are
real, both are measured, and neither can be cleared by any disposition the
operator has.

**A parked spec whose plan is also parked can never stop warning.**
`notDonePlans` filters on `plan.status !== 'done'`, so a *parked* plan counts as
not-done. `spec:unified-code-explore-wiki-projection` (parked) ×
`plan:code-wiki-inspector-projection` (parked) is a fully coherent,
deliberately-stopped combination that emits `zombie-plan` forever.

**The size gate fires exclusively at closed issues.** It does not consult state.
Measured 2026-08-09: all three `size-exceeded` warnings landed on
`shipped`/`parked` specs, none on an `active` one — a check whose stated purpose
is stopping in-flight specs from growing unbounded, firing only where nothing can
cheaply change. (The rule has since produced its first true positive on an
`active` spec: the very document this one was split out of.)

## Non-Goals

- **Not** an adjudication of `active` spec × `parked` plan. Whether that
  combination is itself lifecycle-inconsistent is deliberately left open — see
  §1, which preserves the existing `aging-inactive` semantics rather than
  changing them by side effect.
- **Not** a consolidation of the repository's plan-status predicates. §1 explains
  why the duplication is load-bearing.
- **Not** a silencing of true findings. Measurement is preserved for every state;
  only the demand for governance action is withdrawn where no action is possible.

## §1 Two Plan Predicates, Deliberately Distinct

The single-predicate fix is rejected. `notDonePlans` is read by **two** rules —
`zombie-plan` and `aging-inactive`. Widening it would silently import a
governance judgement no design has argued (*an active spec backed only by parked
plans is not stale*) and create a silent state where such a spec emits neither
finding while still declaring itself in flight. That removes signal rather than
fixing a deadlock.

> **The two plan predicates are intentionally distinct.**
>
> `zombie-plan` asks whether a *parked* spec still has any linked plan that is
> neither completed nor deliberately deferred. **For this rule only**,
> `{done, parked}` are settled.
>
> `aging-inactive` retains its pre-existing definition of not-done: any linked
> plan whose status is not `done`.
>
> This design does **not** adjudicate whether an active spec backed only by
> parked plans is itself lifecycle-inconsistent. That question is out of scope
> and may require a separate finding rather than a change to `aging-inactive`
> semantics.

```js
// zombie-plan only: "does this parked spec still have unsettled plans?"
const ZOMBIE_SETTLED_PLAN_STATUSES = Object.freeze(new Set(['done', 'parked']));
const zombieRelevantPlans = linkedPlans.filter(id => {
    const plan = plansById.get(id);
    return !plan || !ZOMBIE_SETTLED_PLAN_STATUSES.has(plan.status);
});

// aging-inactive: UNCHANGED pre-existing semantics. Do not merge with the above.
const notDonePlans = linkedPlans.filter(id => {
    const plan = plansById.get(id);
    return !plan || plan.status !== 'done';
});
```

A plan absent from the plan-IR remains conservatively unsettled under **both**
predicates. Plan `parked` is a real observed status (1 instance in the current
IR).

The `zombie-plan` finding's `factInputs` MUST carry `zombieRelevantPlans`, not
`notDonePlans`: a fingerprint computed over a set its own rule no longer consults
describes the wrong fact. The registry keeps exposing `notDonePlans` unchanged
for `aging-inactive` and external consumers; `zombieRelevantPlans` is added
alongside, not in place of it.

Counting the two here, the repository holds **four** distinct plan-status
predicates, each answering a different question (§4 enumerates them). Collapsing
them into one shared set would break three rules to tidy one. The duplication is
the design.

## §2 Size: Measurement Always, Actionability by State

The fix separates **measurement** from **actionability** rather than suppressing
the measurement:

```js
// Measurement: every state; `size` / `sizeExceeded` stay in the registry output.
const sizeExceeded = isSizeExceeded(size);

// Actionable finding: only where the spec can still cheaply change.
const SIZE_ACTIONABLE_STATES = Object.freeze(new Set(['adopted', 'active']));
if (sizeExceeded && !sizeWaiver && SIZE_ACTIONABLE_STATES.has(state)) {
    warnings.push('size-exceeded');
}
```

`adopted` is included deliberately: the gate asks whether a still-editable spec
needs splitting or a waiver, and `adopted` (adopted, no plan yet) is where
editing is cheapest. Excluding it would let an oversized spec stay silent until a
plan is linked, then become a violation on `state → active` without the document
changing at all.

`sizeWaiver` remains the mechanism for a deliberate oversize. It is not used to
silence any finding this spec touches.

**This rule, and only this rule, decides size actionability for every state —
including `closed-record-only`.** That state is defined by
`spec:record-only-closure-terminal-state`, which owns its lifecycle semantics
(terminal, not open, no aging derivation) but deliberately does **not** define
its size behaviour. A `closed-record-only` spec over threshold therefore reports
`sizeExceeded: true` in the registry and emits no actionable finding, by the same
`SIZE_ACTIONABLE_STATES` membership test that governs `parked` and `shipped`.
Keeping the exemption here rather than restating it there prevents one rule from
having two owners.

## §3 Disposition Identity

`computeFingerprint` hashes `{ruleId, ruleVersion, factInputs}`. Both changes
here move what a finding is *about*, so both are frozen rather than left to
implementation.

**Set canonicalization.** `fingerprint.js` sorts arrays only for keys in its
`SET_KEYS` vocabulary (`linkedFiles`, `notDonePlans`, `taskStatuses`,
`linkedPlans`). `zombieRelevantPlans` MUST join it, so `[A, B]` and `[B, A]`
fingerprint identically. Sorting locally in `spec-portfolio.js` instead is
prohibited: it would place a second, invisible canonicalization rule outside the
authority that owns it.

**Rule versions.** The disposition contract (`spec:disposition-ledger` §2.3)
already decides this — not an implementation choice. It requires a bump when the
emission condition changes, when `factInputs` extraction changes, or when the set
of facts the fingerprint depends on changes:

| Rule | Version | Why |
| --- | --- | --- |
| `zombie-plan` | **2** | emission condition changed (§1) *and* `factInputs` moved from `notDonePlans` to `zombieRelevantPlans` |
| `size-exceeded` | **2** | emission condition narrowed to `{adopted, active}` (§2) |

Both bumps invalidate every existing disposition on those rules at once. That is
the correct consequence of the field's meaning — *old decisions may no longer
apply* — and whether any of them deserve re-statement is a separate question from
making the version honest.

## §4 Production Change Surface

> Production change is **expected** to be confined to the files listed below.
> Any additional production consumer discovered during implementation requires
> explicit justification recorded in this spec before it is modified.

| File | Change |
| --- | --- |
| `templates/cli/spec-portfolio.js` | `zombieRelevantPlans` derivation, `zombie-plan` emission + `factInputs`, `SIZE_ACTIONABLE_STATES`, both rule versions |
| `templates/cli/disposition/fingerprint.js` | `SET_KEYS` gains `zombieRelevantPlans` |

Deliberately unchanged, and asserted so (AC1): `memory.service.js:1847`
(`plan.status === 'parked'` in focus derivation) and `planning/gaps.js:667` (a
parked or draft sibling keeps a spec *open* — the opposite of settled). With the
two predicates of §1 these are the four plan-status predicates in the repository;
this spec changes exactly one.

Test files and the `.evo-lite/cli/**` mirror (refreshed via `mem sync-runtime`,
never edited directly) are naturally in scope.

## §5 Relationship to `spec:record-only-closure-terminal-state`

This spec was split out of that one. The split is of authority ownership only:

- **That spec owns** the `closed-record-only` state vocabulary, its eligibility
  gate, its closure credential, `deriveBlocker`, `invalid-record-only-closure@1`,
  its four record-only set-valued fingerprint keys, and `evo-spec-registry@3`.
- **This spec owns** `zombie-plan`, `size-exceeded`, `zombieRelevantPlans`, and
  both `@2` bumps — including size actionability for the `closed-record-only`
  state (§2).

No requirement is owned by both. Both declare the same `linkedPlan`, so a single
implementation plan, branch and PR can carry the pair and verify them together;
that engineering judgement is unchanged by the document split. Task order within
that plan is expected to be record-only core first, this spec second, then
integrated governance regression, then the runtime mirror.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-zombie-and-aging-predicates-stay-distinct",
      "description": "Z1: a parked spec whose only linked plan is parked emits NO zombie-plan finding, while a linked plan that is draft, active, or absent from the plan-IR still does; the zombie-plan finding's factInputs name zombieRelevantPlans and not notDonePlans. Z2 (scope negative control): an active spec with a parked linked plan MUST still emit the aging-inactive finding that the pre-change implementation would have emitted — the patch may not suppress it merely because plan.status === 'parked' — and the registry still exposes notDonePlans computed by the unchanged status !== 'done' rule. W5-c (anti-merge control): a future implementation that collapses the two predicates back into one shared settled set must turn Z2 red. Negative controls on the other two predicates: memory.service.js focus derivation and planning/gaps.js sibling completeness are unchanged by this patch.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/memory.service.js", "templates/cli/planning/gaps.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-size-measurement-survives-actionability-narrowing",
      "description": "size-exceeded findings are emitted only for states adopted and active. Registry entries for parked, shipped and closed-record-only specs over threshold still report sizeExceeded true and their measured size dimensions — the fact is preserved, only the demand for governance action is withdrawn. An oversized adopted spec emits the finding, and gaining a linked plan (adopted → active) does not change whether it is emitted. A closed-record-only spec's size behaviour is decided here by SIZE_ACTIONABLE_STATES membership and is not restated in spec:record-only-closure-terminal-state, so exactly one rule owns it.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-w5-disposition-identity-is-canonical-and-versioned",
      "description": "Set canonicalization: two zombie-plan findings whose zombieRelevantPlans differ only in element ORDER produce an IDENTICAL fingerprint, asserted through computeFingerprint; zombieRelevantPlans is present in fingerprint.js SET_KEYS, so an implementation that sorts locally in spec-portfolio.js instead does not satisfy this. Sensitivity: changing WHICH plans are zombie-relevant moves the fingerprint. Versions: SPEC_RULE_VERSIONS declares zombie-plan at 2 and size-exceeded at 2, asserted as literals so a future silent emission-condition change under an unchanged version turns red.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/disposition/fingerprint.js", "templates/cli/test/governance.js"]
    }
  ]
}
```

## Follow-ups (not authorized by this spec)

- **`active` spec × `parked` plan lifecycle mismatch.** Registered by §1 as out
  of scope. It may deserve its own finding rather than a change to
  `aging-inactive`, and answering it needs decisions this spec does not make:
  what a partially-parked plan set means, whether a fully-parked one should park
  its spec, whether the finding waits for `agingDays`, and whether it reaches
  `deriveBlocker`.
- **A migration path for dispositions invalidated by the two `@2` bumps** (§3).
