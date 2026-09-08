---
id: spec:record-only-closure-terminal-state
status: draft
created: 2026-09-08
linkedPlan: plan:record-only-closure-terminal-state
---

# Spec: `closed-record-only` Terminal State + Portfolio Finding Correctness

**Date:** 2026-09-08
**Depends on:** `spec:spec-portfolio-governance` (registry, states, findings, release
blockers), `spec:verification-contract-phase0..3` (criteria schema, validator,
evidence store), `spec:disposition-ledger` (finding disposition identity).

## Problem

Work that is genuinely finished cannot always be closed. The portfolio offers
exactly two ways out — `status: done` (state `shipped`) and `status: parked` —
and `mem close --apply` will only produce the first when the spec carries a
machine-executable acceptance contract. Specs written before the verification
contract existed, or whose contract block is structurally broken, have no exit
at all. They sit in `active` forever, aging, and their findings never clear.

Measured on this repository, 2026-09-08:

| Spec | Contract state | Plan | Reality |
| --- | --- | --- | --- |
| `spec:governance-observation-budget` | NO-CONTRACT | 5/5 checkbox-complete | merged |
| `spec:planning-truth-controls` | NO-CONTRACT | 6/6 checkbox-complete | merged |
| `spec:disposition-ledger` | 7 criteria, **all INVALID** | 10 tasks | shipped; `disposition/` modules are in the tree |

`R011` already names this precisely — *"checkbox state is not closure evidence"* —
but naming it does not provide an exit. The result is a governance system whose
detection is strong and whose closure is unreachable for an entire class of
legitimately finished work.

The obvious fix is the wrong one. Labelling these `done` would make the machine
assert something false: that a contract was verified. It would also silently
clear their release blockers, because `deriveBlocker` returns `null` for
`shipped`. The existing code comment on that function already anticipates the
hazard — *if changing governance state silently cleared the gate, anyone could
route around a real product risk by re-labelling it.*

So the need is a **third terminal state** that says what actually happened:
the project's books are closed on this item, and no machine verification stands
behind that closure.

## Non-Goals

- **Not** a downgrade of the release gate. `release-preflight.js` and the CI
  release job are untouched. This spec changes what `deriveBlocker` decides for
  one new state; it does not change how that decision is enforced.
- **Not** a parser consolidation. The divergence between
  `extractLastCriteriaArray()` and `parseSpecCriteria()` is registered in §8 and
  guarded by a characterization test, deliberately not fixed here.
- **Not** an escape hatch for failed verification. See §2, which is the first
  and hardest gate in this design.
- **Not** a closure of any specific spec. This delivers the mechanism. Applying
  it to the three specs above is separate, adjudicated work.

## §1 State Vocabulary

`declaredStatus` (frontmatter) and `state` (registry) remain two vocabularies.
The new terminal state uses the same token in both.

```
declaredStatus                    →  state
──────────────────────────────────────────────────────
done                              →  shipped
parked                            →  parked
closed-record-only                →  closed-record-only     ← new
draft / absent, linkedPlans > 0   →  active
draft / absent, linkedPlans === 0  →  adopted
```

`closed-record-only` joins `RECOGNIZED_SPEC_STATUSES`, so a correctly spelled
declaration never raises `unknown-status`. A *misapplied* one raises the new
finding of §5 instead — recognized vocabulary, wrong usage, is a different fact
from invented vocabulary.

Set membership is fixed:

```
terminal = { shipped, closed-record-only }
open     = { adopted, active }
deferred = { parked }
```

`closed-record-only ∉ shipped`, `∉ open`, `∈ terminal`.

Portfolio counts gain an independent column:

```
📋 [Spec Portfolio]: adopted=N active=N parked=N shipped=N recordClosed=N
```

Folding `recordClosed` into `shipped` in any summary view is prohibited. A view
that must present a single "finished" number is required to name both addends
explicitly at the call site; the registry never pre-merges them. Adding a state
whose only visible effect is absorbed by a downstream total would leave the
semantics exactly where they were.

## §2 First Hard Gate: Eligibility

**This is the load-bearing constraint of the entire design.** The release waiver
of §4 prevents routing around the *release gate*; this gate prevents routing
around the *verification system itself*, which is the more valuable of the two.

The admissible entry condition is `contractState ∈ { NO-CONTRACT, INVALID }`.
Reading the validator shows this condition reduces to a purely **static**
property of the spec file — no evidence record is consulted:

```
NO-CONTRACT   →  criteria absent or empty
INVALID       →  criteria present but structurally invalid
──────────────────────────────────────────────────────────
UNVERIFIED    ┐
STALE         │  criteria present AND structurally valid.
FAIL          │  These four differ only in their evidence,
PASS          ┘  never in the contract itself.
```

The boundary between the two admissible states and the four inadmissible ones is
exactly *"does this spec contain a machine-executable acceptance assertion"*.

### Canonical authority

> `spec-portfolio.js` MUST consume the canonical contract parser and validator
> exported by `verification/validate-contract.js`. It MUST NOT reproduce a
> second structural-validity implementation.

`validate-contract.js` itself is not modified. Importing the authority is
required precisely because a private copy would be a narrower second
implementation of a question that already has an owner — a defect class this
repository has paid for before.

### Whole-array invocation

The validator MUST be called on the **whole criteria array**, once:

```js
const { criteria } = parseSpecCriteria(specText);
const findings = validateCriteria(criteria);
```

Per-criterion invocation (`validateCriteria([c])`) is **prohibited**. It strips
the array-level observation context, and the validator already carries at least
one cross-criterion invariant — duplicate `id` detection. Under per-criterion
calls, two criteria sharing an id would both validate clean, and a contract the
authority rejects would be read as executable. Per-criterion invocation becomes
permissible only if the validator's contract is amended to guarantee
`validateCriteria(criteria) ≡ Σ validateCriteria([criterion])`, which it does
not today.

### Executability and the eligibility invariant

A criterion is **executable** iff the whole-array validation produced no finding
against its identity. Finding identity MUST be derived the same way the
validator derives it — `c.id` when it is a non-empty string, else the positional
fallback `#<index>` — so that the mapping back from findings to criteria cannot
drift from the authority that produced them. This coupling is deliberate and is
asserted directly (AC1), not left implicit.

```
executableCriteria = criteria where no validation finding names that criterion

eligibleForRecordOnly  ⟺  executableCriteria.length === 0
```

The predicate is `=== 0`, **not** "some criterion is invalid". The weaker form
carries an abuse vector: appending one deliberately broken criterion to an
otherwise valid contract would unlock record-only closure. Requiring that *no*
executable criterion exists closes it.

A top-level validation failure (`criteria must be an array`) yields zero
executable criteria and is therefore eligible — a contract that cannot be parsed
as a contract is not an executable contract.

### Continuous enforcement

Eligibility is recomputed on **every registry build**, not once at the moment
the label is applied. Adding a valid contract to a spec that was already closed
record-only makes it ineligible on the next `mem spec status`, and §5 applies
from that point. A label does not acquire immunity by having been accepted
earlier.

## §3 Closure Record: A Credential Independent of the Release Waiver

Record-only closure requires three frontmatter fields. They reuse the
**validation pattern** proven by `releaseBlockWaiver` — closed enum, non-empty
text, round-trippable date — with their own field names, their own parser, and
their own findings.

```yaml
closureBasis: record-only        # closed enum; must equal this exact token, unquoted
closureReason: <non-empty after trim>
closureRecordedAt: 2026-09-08    # YYYY-MM-DD, must survive a round-trip
```

The design invariant, in both directions:

```
closure record  ⊬  release waiver
release waiver  ⊬  closure record
```

Neither credential implies the other, and neither may be validated by the
other's parser output. A `releaseBlocking: true` spec that has completed
record-only closure is **still release-BLOCKED** unless it separately carries a
complete and valid `releaseBlockWaiver`.

This separation is the substantive value of the design. Two facts that the
portfolio previously conflated become independent:

```
Portfolio lifecycle          Release risk
───────────────────          ────────────
active                       releaseBlocking = true
  ↓                            ↓
closed-record-only           still BLOCKED
  ↓                            ↓
books closed                 independent valid waiver
                               ↓
                             publish permitted
```

"The project's books are closed" and "the risk was shown not to exist" are no
longer the same assertion.

## §4 `deriveBlocker`: Shared Policy, Distinct Semantics

The two waiver-gated states share a *policy predicate*, never a lifecycle
branch, and never a message.

```js
const REQUIRES_RELEASE_WAIVER = Object.freeze(new Set(['parked', 'closed-record-only']));
```

Distinct blocker reasons are mandatory, because the two states describe opposite
situations and an audit must separate them at a glance:

```
parked              = the work is not finished / deliberately deferred
closed-record-only  = the work is claimed finished, with no verifiable closure
```

```js
const WAIVER_GATED_REASON = Object.freeze({
    'parked': {
        invalidWaiver: 'parked release-blocking spec whose waiver is incomplete or invalid',
        noWaiver:      'parked release-blocking spec with no waiver',
    },
    'closed-record-only': {
        invalidWaiver: 'record-only-closed release-blocking spec whose waiver is incomplete or invalid',
        noWaiver:      'record-only-closed release-blocking spec with no waiver — '
                     + 'a closure record is not a waiver; the risk was never verified',
    },
});
```

Order of evaluation is unchanged: `!releaseBlocking → null`; `shipped → null`;
`REQUIRES_RELEASE_WAIVER.has(state) →` waiver check; otherwise the in-flight
blocker. The blocker record continues to carry `state`, so consumers can
distinguish the two without parsing prose.

**Verified during design:** `release-preflight.js` consumes `registry.blockers`
and never derives state itself. `deriveBlocker` is therefore the single
authority for release behaviour, and this section is the whole of this spec's
effect on the release gate.

## §5 Anti-Abuse Invariants

### Base lifecycle derivation

State derivation MUST be expressed with an explicit helper that does not consult
any terminal declaration:

```
baseState(spec):
    linkedPlans.length > 0   →  active
    linkedPlans.length === 0 →  adopted
```

Full derivation:

```
declaredStatus === 'done'                              →  shipped
declaredStatus === 'parked'                            →  parked
declaredStatus === 'closed-record-only'
    AND eligibleForRecordOnly
    AND closureRecordValid                             →  closed-record-only
declaredStatus === 'closed-record-only'
    AND NOT (eligible AND recordValid)                 →  baseState(spec)
otherwise                                              →  baseState(spec)
```

> **Invariant: an invalid record-only declaration does not participate in state
> derivation.** It is an invalid declaration plus a finding — never a
> half-legal state, and never a value reached by falling through a branch.

`baseState` MUST exist as a named helper rather than as the residue of an
`if`/`else` chain. The failure mode being designed against is a future reorder
of those branches quietly turning an invalid declaration into a terminal one.

### Violations and consequences

When `declaredStatus === 'closed-record-only'` and either condition fails:

| Violation | `instanceKey` | Test |
| --- | --- | --- |
| Ineligible | `ineligible` | `executableCriteria.length > 0` |
| Record incomplete | `record-incomplete` | closure record missing or invalid |

Three consequences, together:

1. A finding `invalid-record-only-closure:<instanceKey>` is emitted, following
   the `size-exceeded` precedent of one independently dispositionable fact per
   instance key.
2. The state **does not** become `closed-record-only`. It becomes
   `baseState(spec)`. The label is rejected, not tolerated.
3. Because the spec is now in an open state, `deriveBlocker` reaches the
   in-flight branch and a `releaseBlocking` spec is blocked. Fail-closed is a
   consequence of (2), requiring no separate code path.

**Both violations report independently.** When a spec is simultaneously
ineligible and record-incomplete, both findings are emitted; short-circuiting to
the first is prohibited. They are separately actionable — *you were never
eligible for this route* and *even if you were, your record is incomplete*.
State derivation nevertheless runs exactly once; two findings never produce two
state transitions.

### Terminal privileges are conditional

Only a **valid** `closed-record-only` spec is exempt from `zombie-plan`, the
aging findings, and actionable `size-exceeded`. An invalid one receives no
exemption whatsoever — it is an open spec that additionally carries a violation
finding.

## §6 Portfolio Finding Correctness (W5)

Both fixes are consequences of the same lifecycle model, not opportunistic
cleanups.

### zombie-plan deadlock

`notDonePlans` currently filters on `plan.status !== 'done'`, so a *parked* plan
counts as not-done. A parked spec whose plan is also parked — a fully coherent,
deliberately-stopped combination — can therefore never clear its warning, by any
disposition available to the operator.

The single-predicate fix is rejected. `notDonePlans` is read by **two** rules:
the `zombie-plan` branch and the `aging-inactive` branch. Widening it to treat a
parked plan as settled would silently import a governance judgement this design
has not argued — *an active spec backed only by parked plans is not stale* —
and would create a silent state in which such a spec emits neither `zombie-plan`
nor `aging-inactive` while still declaring itself in flight. That removes
signal; it does not fix a deadlock.

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
`notDonePlans`. A finding whose fingerprint is computed over a set its own rule
no longer consults would describe the wrong fact, and would silently invalidate
existing dispositions. The registry entry continues to expose `notDonePlans`
unchanged for `aging-inactive` and for external consumers; `zombieRelevantPlans`
is added alongside it rather than replacing it.

The repository already contains **four** distinct plan-status predicates, each
answering a different question — `spec-portfolio.js` (this section),
`memory.service.js:1847` (a parked plan is not "focus here now"), and
`planning/gaps.js:667` (a parked or draft sibling deliberately keeps a spec
*open*, the opposite of settled). Collapsing them into one shared set would
break three rules to tidy one. The duplication is the design.

### size-gate state blindness

The gate at `spec-portfolio.js` does not consult state, so on 2026-08-09 all
three size warnings landed on `shipped`/`parked` specs and none on an `active`
one — a check whose stated purpose is preventing in-flight specs from growing
unbounded, firing exclusively at closed issues.

The fix separates **measurement** from **actionability** rather than suppressing
the measurement:

```js
// Measurement: computed for every state; `size` and `sizeExceeded` remain in
// the registry output unchanged for all states.
const sizeExceeded = isSizeExceeded(size);

// Actionable finding: emitted only where the spec can still cheaply change.
const SIZE_ACTIONABLE_STATES = Object.freeze(new Set(['adopted', 'active']));
if (sizeExceeded && !sizeWaiver && SIZE_ACTIONABLE_STATES.has(state)) {
    warnings.push('size-exceeded');
}
```

`adopted` is included deliberately. The gate asks a governance question — *is
this still-editable spec large enough to need splitting or an explicit waiver?*
— and `adopted` (in the portfolio, no plan yet) is where editing is cheapest.
Excluding it would create an incoherent window in which an oversized spec is
silent until a plan is linked, then becomes a violation on `state → active`
without the document having changed at all.

`sizeWaiver` remains the mechanism for a deliberate oversize; it is not used to
silence any finding this spec touches.

## §7 Production Change Surface

> Production change is **expected** to be confined to the files listed below.
> Any additional production consumer discovered during implementation requires
> explicit justification recorded in this spec before it is modified.

Enumerated during design by repository-wide search for `spec.state`, registry
consumers, and portfolio counts:

| File | Change |
| --- | --- |
| `templates/cli/spec-portfolio.js` | Primary: vocabulary, `baseState`, eligibility gate, closure-record parser, `deriveBlocker`, counts, findings, formatters |
| `templates/cli/memory.service.js` (~3377) | **Required.** Four hard-coded buckets (`adopted`/`active`/`parked`/`shipped`); a `closed-record-only` spec would fall into none and vanish from the report. Add `recordClosed`. |
| `templates/cli/verification/validate-contract.js` | **Imported, not modified.** Canonical parser/validator per §2. |

Confirmed to need no change:

- `release-preflight.js` — consumes `registry.blockers`; inherits §4.
- `disposition/commands.js` — consumes findings generically; the new ruleId
  flows through without special-casing.
- `governance-observer.js` — reads the registry; its consumed fields MUST be
  re-confirmed during implementation before this line is relied upon.

Test files and the `.evo-lite/cli/**` mirror (refreshed via `mem sync-runtime`,
never edited directly) are naturally in scope.

New rule versions: `invalid-record-only-closure` enters `SPEC_RULE_VERSIONS` at
version 1. `zombie-plan` and `size-exceeded` change their emission conditions;
whether that constitutes a rule-version bump for disposition-fingerprint
purposes MUST be decided during implementation and recorded — a silently
changed rule under an unchanged version would invalidate existing dispositions
without saying so.

## §8 Registered Divergence — Out of Scope

`spec-portfolio.js` and `verification/validate-contract.js` extract criteria by
**materially different rules**:

```
parseSpecCriteria(text)        positional — requires a "## Acceptance Criteria"
                               heading, takes the first ```json block beneath it
extractLastCriteriaArray(text) last-wins — scans every ```json block in the
                               document, takes the last one containing "criteria"
```

A constructible divergence follows: a spec whose criteria block sits elsewhere,
or under a differently-spelled heading, is **NO-CONTRACT** to the authority
(hence eligible for record-only closure) while the size gate reads `acCount = N`
from it.

This round: **register and guard, do not converge.** Parser authority
convergence is a separate problem from record-only lifecycle semantics, and
merging it here would widen the size-gate behaviour surface, the parser
regression surface, and the historical-spec compatibility surface — while making
the diff impossible to review as either one change or the other.

AC8 is a **characterization guard**, not a permanent specification of parser
behaviour. It compares a defined common projection — criterion count, criterion
identity, and normalized criterion payload — over every canonical spec present
in the repository, scanned dynamically rather than against a frozen count.
Comparing lengths alone would pass falsely on `[AC1, AC2]` versus `[AC1, AC3]`.
When parser consolidation is undertaken, this guard is expected to be
deliberately deleted or replaced.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-eligibility-is-static-contract-property",
      "description": "A spec with at least one structurally valid criterion may NEVER be closed record-only, independent of evidence: with no evidence record, and with fixtures producing UNVERIFIED, STALE, FAIL and PASS, labelling it closed-record-only emits invalid-record-only-closure:ineligible in all five cases. Executability is computed from one whole-array validateCriteria call on parseSpecCriteria output, and criterion identity mirrors the validator's own id derivation (c.id, else #index); a duplicate-id contract yields zero executable criteria under whole-array validation and would be misread as executable under per-criterion calls.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/verification/validate-contract.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-invalid-declaration-derives-base-state",
      "description": "An ineligible or record-incomplete closed-record-only declaration derives state === baseState(spec) — 'active' when linkedPlans is non-empty, 'adopted' when empty — and never 'closed-record-only' nor 'shipped'. Asserted on the derived state value itself, not on finding text. A fixture with linkedPlans present and one without both resolve per baseState.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-invalid-declaration-fails-release-closed",
      "description": "A releaseBlocking spec carrying an invalid closed-record-only declaration produces a non-null deriveBlocker record whose state field is the base state and whose reason is the in-flight reason — never null, and never a waiver-gated reason. Asserted on the blocker record, not on portfolio prose.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-valid-record-only-is-terminal-never-shipped",
      "description": "A spec that is eligible (NO-CONTRACT fixture and INVALID-contract fixture, both covered) with a complete closure record derives state === 'closed-record-only'; registry counts report recordClosed incremented with shipped unchanged; and it emits no zombie-plan, aging-no-plan, aging-inactive or size-exceeded finding. memory.service report.specPortfolio exposes recordClosed rather than absorbing it into any existing bucket.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/memory.service.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-closure-record-and-waiver-are-independent",
      "description": "Credentials do not substitute for each other in either direction. A valid closed-record-only spec with releaseBlocking true and NO releaseBlockWaiver yields a non-null blocker carrying the record-only-specific reason (distinct in text from the parked reason); adding a valid waiver clears it. Conversely a spec with a valid releaseBlockWaiver but no closure record does NOT derive a terminal state.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-dual-violations-report-independently",
      "description": "A spec that is simultaneously ineligible and record-incomplete emits BOTH invalid-record-only-closure:ineligible and invalid-record-only-closure:record-incomplete, with distinct finding ids; neither short-circuits the other. State derivation runs once and yields exactly one state. Each instanceKey is independently dispositionable. Each of the three closure-record fields, omitted alone, produces record-incomplete.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-w5-zombie-and-size-actionability",
      "description": "Z1: a parked spec whose only linked plan is parked emits no zombie-plan finding, while a linked plan that is draft or absent from the IR still does, and the zombie-plan finding's factInputs name zombieRelevantPlans rather than notDonePlans. Z2 (scope negative control): an active spec with a parked linked plan MUST still emit the aging-inactive finding that the pre-change implementation would have emitted — the patch may not suppress it merely because plan.status === 'parked', and the registry entry still exposes notDonePlans computed by the unchanged status !== 'done' rule. Independently: size-exceeded findings are emitted only for states adopted and active, while registry entries for parked, shipped and closed-record-only specs still report sizeExceeded true and their measured size dimensions — the fact is preserved, only the demand for governance action is withdrawn.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-parser-divergence-characterization-guard",
      "description": "Characterization guard, not a permanent parser specification. For every canonical spec discovered in the repository at run time (dynamically scanned, no hard-coded corpus size), the normalized projections of extractLastCriteriaArray and parseSpecCriteria agree on criterion count, criterion identity set, and normalized criterion payload. Comparing count alone is explicitly insufficient. The test is labelled as a characterization guard and is expected to be deleted or replaced when parser consolidation is undertaken.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/verification/validate-contract.js", "templates/cli/test/governance.js"]
    }
  ]
}
```

## Follow-ups (not authorized by this spec)

- **Applying** record-only closure to `spec:governance-observation-budget`,
  `spec:planning-truth-controls` and `spec:disposition-ledger`. Each needs its
  own adjudication and its own `closureReason`; the mechanism landing does not
  authorize any particular use of it.
- **Parser authority convergence** (§8): unify `extractLastCriteriaArray` and
  `parseSpecCriteria` behind the canonical parser, then retire AC8.
- **A CLI application path.** This spec defines derivation and validation only.
  Whether record-only closure is applied by hand-edited frontmatter or by a
  `mem spec` subcommand mirroring `parkSpec` is deliberately left open; adding a
  command before the semantics are proven would fix the ergonomics of a contract
  that has not yet been exercised.
- **Rule-version policy** for changed emission conditions on existing rules
  (§7), which affects disposition fingerprint stability beyond this spec.
