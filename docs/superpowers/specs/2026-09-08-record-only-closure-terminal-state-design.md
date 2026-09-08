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

Work that is genuinely finished cannot always be closed. The portfolio offers two
ways out — `status: done` (`shipped`) and `status: parked` — and
`mem close --apply` produces the first only for a spec carrying a
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

The obvious fix is wrong. Labelling these `done` makes the machine assert
something false — that a contract was verified — and silently clears their
release blockers, since `deriveBlocker` returns `null` for `shipped`. That
function's own comment already anticipates the hazard: *if changing governance
state silently cleared the gate, anyone could route around a real product risk
by re-labelling it.*

The need is a **third terminal state** saying what actually happened: the books
are closed on this item, and no machine verification stands behind that closure.

## Non-Goals

- **Not** a downgrade or reimplementation of the release gate. Enforcement
  continues to consume `registry.blockers` unchanged, and the CI release job is
  untouched. This spec changes what `deriveBlocker` decides for one new state,
  and updates `release-preflight.js`'s **remediation text** so it stops asserting
  something the gate no longer does. A correct gate paired with guidance that
  misinforms the operator is not a gate left alone.
- **Not** a parser consolidation. The divergence between
  `extractLastCriteriaArray()` and `parseSpecCriteria()` is registered in §8 and
  made **fail-closed** in §2 — disagreement denies eligibility and raises a
  finding. Neither parser is modified, so no existing contract verdict moves.
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
declaration never raises `unknown-status`; a *misapplied* one raises §5's new
finding instead. Recognized vocabulary used wrongly is a different fact from
invented vocabulary.

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

Folding `recordClosed` into `shipped` in any summary view is prohibited; a view
needing one "finished" number names both addends at the call site, and the
registry never pre-merges them. A state whose only visible effect is absorbed by
a downstream total leaves the semantics exactly where they were.

## §2 First Hard Gate: Eligibility

**This is the load-bearing constraint of the entire design.** The waiver of §4
prevents routing around the *release gate*; this gate prevents routing around
the *verification system itself* — the more valuable of the two.

The admissible entry condition is `contractState ∈ { NO-CONTRACT, INVALID }`,
which reduces to a purely **static** property of the spec file; no evidence
record is consulted:

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

`validate-contract.js` itself is not modified. A private copy would be a
narrower second implementation of a question that already has an owner — a
defect class this repository has paid for before.

### Two invocations, different jobs

A withdrawn earlier rule derived per-criterion executability by matching
whole-array findings back to criterion identity. It is exploitable, and the
exploit was reproduced on a fixture before this text existed.
`validateCriteria` reports a duplicate id against the *id itself*
(`finding.id === 'AC1'`), with no positional component, so identity-matching
tars **both** criteria sharing that id — including the valid one. Duplicating
one criterion of a valid contract verbatim therefore made the whole contract
read as unexecutable, granting eligibility: the exact inverse of what this gate
exists to do.

The two invocations are assigned different jobs, and neither may do the other's:

| Invocation | Authority over | May conclude |
| --- | --- | --- |
| `validateCriteria(criteria)` | contract validity as a whole | valid / not valid |
| `validateCriteria([c])` | local executability of one criterion | **DENY only** — never "valid" |

The singleton call is a **one-way probe**: a PASS proves a self-contained
executable acceptance assertion exists and MUST deny record-only closure; a FAIL
proves nothing alone and defers to the aggregate. Singleton constraints are a
strict subset of whole-array constraints, so this direction can only ever deny
eligibility, never grant it. That asymmetry is what makes the singleton call safe
here while the withdrawn rule was not.

### Contract visibility: disagreement is fail-closed

The authority `parseSpecCriteria` locates criteria **positionally**, requiring a
heading matching `/^##\s+Acceptance Criteria\s*$/` exactly. A numbered heading
misses, and `loadValidatedContract` classifies that miss as
`optedOut → noContract: true` — so a spec with a real contract reads as
NO-CONTRACT purely because its heading is numbered.

Live, not hypothetical: across all 56 canonical specs on `main`, three diverge,
all for this reason:

| Spec | `extractLastCriteriaArray` | `parseSpecCriteria` | Heading |
| --- | --- | --- | --- |
| `codegraph-adapter-governance-linker` | 4 | 0 | `## 10. Acceptance Criteria` |
| `unified-code-explore-wiki-projection` | 5 | 0 | `## 9. Acceptance Criteria` |
| `evo-code-perception-foundation` | 14 | 0 | `## 24. Acceptance Criteria` |

Under an authority-only gate all three are eligible today, despite carrying 4, 5
and 14 authored criteria. Numbering a heading would be an accidental, invisible
bypass of the first hard gate — cheaper than the duplicate-id attack and
reachable without intent. The gate therefore requires **corroboration**:

> Eligibility requires that **both** extractors agree there is no executable
> contract. When `extractLastCriteriaArray` finds criteria that the authority
> cannot see, the spec is **not** eligible, and a
> `invalid-record-only-closure:contract-visibility-discrepancy` finding is
> emitted naming both counts.

Neither parser is modified, so no existing `verify-contract` or `close` verdict
changes. The divergence of §8 stops being a silent hole and becomes a visible,
conservative denial.

### The eligibility invariant

```
authority      = parseSpecCriteria(specText).criteria
corroboration  = extractLastCriteriaArray(specText)

aggregateFindings   = validateCriteria(authority)
locallyExecutable   = authority.filter(c => validateCriteria([c]).length === 0)

visibilityAgrees    = (authority.length === 0) === (corroboration.length === 0)

eligibleForRecordOnly ⟺
       visibilityAgrees
   AND locallyExecutable.length === 0
   AND ( authority.length === 0 OR aggregateFindings.length > 0 )
```

The `locallyExecutable.length === 0` term is `=== 0`, **not** "some criterion is
invalid". The weaker form carries the original abuse vector: appending one
deliberately broken criterion to an otherwise valid contract would unlock
record-only closure. Requiring that *no* criterion is independently executable
closes both that vector and the duplicate-id inverse.

A top-level validation failure (`criteria must be an array`) yields no locally
executable criterion and a non-empty aggregate, and is therefore eligible — a
contract that cannot be parsed as a contract is not an executable contract.

### Continuous enforcement

Eligibility is recomputed on **every registry build**, not once when the label is
applied. Adding a valid contract to an already record-only-closed spec makes it
ineligible on the next `mem spec status`, and §5 applies from that point. A label
does not acquire immunity by having been accepted earlier.

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
Portfolio lifecycle: active → closed-record-only → books closed
Release risk:        releaseBlocking → still BLOCKED
                       → independent valid waiver → publish permitted
```

"The project's books are closed" and "the risk was shown not to exist" are no
longer the same assertion.

### Credential lifecycle: leaving the state invalidates the record

`parkSpec` and `reactivateSpec` today rewrite `status` and remove `parkedUntil`,
nothing else. Without a further rule a closure record outlives the closure it
justified: reactivate leaves `R1` in the frontmatter, a further round of work
happens, `status` is set back to `closed-record-only`, and — still NO-CONTRACT,
`R1`'s three fields still valid — the spec is terminal again on a credential
that was never restated.

> **Transition invariant.** Leaving `closed-record-only` MUST invalidate the
> current closure credential. `parkSpec` and `reactivateSpec`, when the spec
> they act on is currently `closed-record-only`, remove `closureBasis`,
> `closureReason` and `closureRecordedAt`.

Removing those fields is not erasing history — git retains every prior record.
The frontmatter asserts the *current* credential, and re-entry must require a
fresh one. Without this, "terminal privileges only when valid" (§5) constrains
only the first entry and says nothing about re-entry.

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
and never derives state itself. `deriveBlocker` remains the single authority for
release *enforcement*, and this section is the whole of this spec's effect on
that enforcement. It is **not** the whole of its effect on `release-preflight.js`,
whose operator guidance text becomes false under the new state — see §7.

### `waiverIsLoadBearing` consumes the same predicate

`spec-portfolio.js` reports waiver schema errors only where a waiver could
actually change the outcome:

```js
const waiverIsLoadBearing = blocking.value && state === 'parked';   // before
const waiverIsLoadBearing = blocking.value && REQUIRES_RELEASE_WAIVER.has(state);
```

`closed-record-only` is waiver-load-bearing by construction. Without this, a
malformed waiver on such a spec is still correctly BLOCKED — the gate does not
fail open — but its schema errors never reach `registry.errors`, so the operator
learns the spec is blocked without learning their waiver is malformed. A
diagnosis gap, not a gate gap. Routing both call sites through
`REQUIRES_RELEASE_WAIVER` also makes this section's policy predicate a real
authority rather than a private helper of `deriveBlocker`.

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
| Ineligible | `ineligible` | `locallyExecutable.length > 0`, or a non-empty authority contract with no aggregate findings |
| Contract not visible to the authority | `contract-visibility-discrepancy` | `visibilityAgrees === false` (§2) |
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

**Every applicable violation reports independently.** When a spec trips more
than one, all of them are emitted; short-circuiting to the first is prohibited.
They are separately actionable — *you were never eligible for this route*, *the
authority cannot see the contract you wrote*, and *even if you were eligible,
your record is incomplete*. State derivation nevertheless runs exactly once;
three findings never produce three state transitions.

### Disposition identity

`computeFingerprint` hashes `{ruleId, ruleVersion, factInputs}`, so what makes an
existing decision STALE is fixed by what `factInputs` carries. These are frozen
here rather than left to implementation:

| `instanceKey` | `factInputs` |
| --- | --- |
| `ineligible` | `locallyExecutableCriterionDigests` — sorted digests of the criteria that independently validated clean |
| `contract-visibility-discrepancy` | `authorityCriterionCount`, `corroborationCriterionCount` |
| `record-incomplete` | `invalidClosureFields` — sorted names of the missing or invalid fields |

Consequences are the intended ones: changing which assertions are executable
moves the `ineligible` fingerprint; fixing `closureBasis` while
`closureRecordedAt` stays malformed moves `record-incomplete`; rewording a
message moves nothing. `locallyExecutableCriterionDigests` uses `criterionDigest`
rather than raw ids, so a criterion edited in place — same id, different
assertion — is a different fact.

**Set canonicalization.** `fingerprint.js` sorts arrays only for keys in its
`SET_KEYS` vocabulary (`linkedFiles`, `notDonePlans`, `taskStatuses`,
`linkedPlans`). Every set-valued key introduced here MUST be added there, so
`[A, B]` and `[B, A]` fingerprint identically. Sorting locally in
`spec-portfolio.js` instead is prohibited: it would place a second, invisible
canonicalization rule outside the authority that owns it.

**Rule versions.** The disposition contract (`spec:disposition-ledger` §2.3)
already decides this — not an implementation choice. It requires a bump when the
emission condition changes, when `factInputs` extraction changes, or when the set
of facts the fingerprint depends on changes:

| Rule | Version | Why |
| --- | --- | --- |
| `invalid-record-only-closure` | 1 | new rule |
| `zombie-plan` | **2** | emission condition changed (§6) *and* `factInputs` moved from `notDonePlans` to `zombieRelevantPlans` |
| `size-exceeded` | **2** | emission condition narrowed to `{adopted, active}` (§6) |

### Terminal privileges are conditional

Only a **valid** `closed-record-only` spec is exempt from `zombie-plan`, the
aging findings, and actionable `size-exceeded`. An invalid one gets no exemption
at all — it is an open spec carrying a violation finding.

## §6 Portfolio Finding Correctness (W5)

Both fixes are consequences of the same lifecycle model, not opportunistic
cleanups.

### zombie-plan deadlock

`notDonePlans` currently filters on `plan.status !== 'done'`, so a *parked* plan
counts as not-done. A parked spec whose plan is also parked — a fully coherent,
deliberately-stopped combination — can therefore never clear its warning, by any
disposition available to the operator.

The single-predicate fix is rejected. `notDonePlans` is read by **two** rules —
`zombie-plan` and `aging-inactive`. Widening it would silently import a
governance judgement this design has not argued (*an active spec backed only by
parked plans is not stale*) and create a silent state where such a spec emits
neither finding while still declaring itself in flight. That removes signal
rather than fixing a deadlock.

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
alongside, not in place of it. Changed emission condition plus changed
`factInputs` extraction make this `zombie-plan@2`, and `zombieRelevantPlans`
joins `SET_KEYS` — see §5.

Counting the two here, the repository holds **four** distinct plan-status
predicates, each answering a different question (§7 enumerates them). Collapsing
them into one shared set would break three rules to tidy one. The duplication is
the design.

### size-gate state blindness

The gate does not consult state, so on 2026-08-09 all three size warnings landed
on `shipped`/`parked` specs and none on an `active` one — a check meant to stop
in-flight specs growing unbounded, firing exclusively at closed issues.

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
editing is cheapest. Excluding it would let an oversized spec stay silent until
a plan is linked, then become a violation on `state → active` without the
document changing at all.

`sizeWaiver` remains the mechanism for a deliberate oversize; it is not used to
silence any finding this spec touches. The narrowed emission condition makes this
`size-exceeded@2` — see §5.

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
| `templates/cli/disposition/fingerprint.js` | **Required.** `SET_KEYS` gains `zombieRelevantPlans`, `locallyExecutableCriterionDigests`, `invalidClosureFields` (§5). Canonicalization is owned here; local sorting elsewhere is prohibited. |
| `templates/cli/release-preflight.js` | **Required — operator guidance only.** Its remediation text states *"A waiver applies to parked specs only; adopted/active must be finished or deliberately parked first"*, which becomes false once `closed-record-only` is waiver-gated. Enforcement logic is untouched. |
| `templates/cli/verification/validate-contract.js` | **Imported, not modified.** Canonical parser/validator per §2. |

Confirmed to need no change:

- `disposition/commands.js` — consumes findings generically
  (`reg.specs.flatMap(s => s.findings)` then `annotate`); the new ruleId flows
  through without special-casing.
- `governance-observer.js` — passes the registry through whole, does not bucket
  by state; re-confirm during implementation before relying on this line.
- `memory.js`, `template-manifest.js`, `code-perception/post-commit-*.js` —
  matched the repo-wide search only on unrelated `.state` fields (ledger/commit
  identity) or on the literal filename. Verified non-consumers.

Deliberately unchanged, and asserted so (AC7): `memory.service.js:1847`
(`plan.status === 'parked'` in focus derivation) and `planning/gaps.js:667` (a
parked or draft sibling keeps a spec *open*). With the two predicates of §6 these
are the four plan-status predicates; this spec changes exactly one.

Test files and the `.evo-lite/cli/**` mirror (refreshed via `mem sync-runtime`,
never edited directly) are naturally in scope.

Rule versions are settled in §5 by the disposition contract, not by the
implementer: `invalid-record-only-closure@1`, `zombie-plan@2`,
`size-exceeded@2`.

## §8 Registered Divergence — Out of Scope

`spec-portfolio.js` and `verification/validate-contract.js` extract criteria by
**materially different rules**:

```
parseSpecCriteria(text)        positional — requires a "## Acceptance Criteria"
                               heading, takes the first ```json block beneath it
extractLastCriteriaArray(text) last-wins — scans every ```json block in the
                               document, takes the last one containing "criteria"
```

This divergence is **not constructible-in-principle; it is already live** — 3 of
56 specs on `main`, cause and inventory in §2. An earlier draft called it
hypothetical and proposed a characterization guard asserting the two parsers
agree across the corpus; that guard was run before this text was written and is
**RED on arrival**. A guard that is red on arrival is not a regression guard,
and the design it was protecting had a hole rather than a risk.

This round: **register, fail closed, do not converge.** Parser convergence is a
separate problem from record-only lifecycle semantics; merging it here would
widen the size-gate behaviour surface, the parser regression surface and the
historical-spec compatibility surface at once, while making the diff impossible
to review as either change. Fixing the regex was considered and rejected for the
same round: it would move three specs from NO-CONTRACT into a contract state,
changing live `verify-contract` and `close` verdicts as a side effect of a
lifecycle spec.

The mitigation is containment, not correction. §2 makes disagreement deny
eligibility and raise `:contract-visibility-discrepancy`; AC1 asserts that
against those three real specs. The invariant *disagreement denies* is GREEN
today, while the divergence stays openly registered as unfixed.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-eligibility-gate-denies-every-executable-contract",
      "description": "A spec with at least one independently executable criterion may NEVER be closed record-only, by any route. (a) Evidence-independence: with no evidence record, and with fixtures producing UNVERIFIED, STALE, FAIL and PASS, labelling it closed-record-only emits invalid-record-only-closure:ineligible in all five cases. (b) Duplicate-id inverse escape: a contract of two valid criteria sharing one id — which makes whole-array validateCriteria emit a single finding naming that id — is INELIGIBLE, because locallyExecutable is computed by singleton probe and yields 2; the withdrawn identity-matching rule yielded 0 and would have granted eligibility, so this case must turn red against that rule. (c) Appending one structurally broken criterion to a valid contract does not unlock eligibility. (d) Contract visibility: a spec whose Acceptance Criteria heading is numbered — parseSpecCriteria sees 0, extractLastCriteriaArray sees N>0 — is INELIGIBLE and emits invalid-record-only-closure:contract-visibility-discrepancy carrying both counts; asserted against the three real divergent specs on main, discovered by dynamic scan rather than a hard-coded list. (e) A genuinely contractless spec and an all-criteria-invalid spec both remain ELIGIBLE.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/verification/validate-contract.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-invalid-declaration-derives-base-state-and-fails-closed",
      "description": "A rejected closed-record-only declaration — for any of the three violation kinds — derives state === baseState(spec): 'active' when linkedPlans is non-empty, 'adopted' when empty, and never 'closed-record-only' nor 'shipped'. Asserted on the derived state value itself, not on finding text; fixtures with and without linkedPlans both resolve per baseState. Consequently, when such a spec is releaseBlocking, deriveBlocker returns a non-null record whose state field is the base state and whose reason is the in-flight reason — never null, and never a waiver-gated reason. Fail-closed is asserted as a consequence of the derived state, not as an independent code path.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-closure-credential-does-not-survive-reopen",
      "description": "Leaving closed-record-only invalidates the closure credential. Given a validly closed-record-only spec, parkSpec and reactivateSpec each remove closureBasis, closureReason and closureRecordedAt from the frontmatter, and the fields are absent from the file afterwards. Negative control for credential replay: closed-record-only → reactivate → set status back to closed-record-only WITHOUT writing a fresh closure record MUST yield invalid-record-only-closure:record-incomplete and state === baseState(spec), never a terminal state. Leaving parked (a spec that was never record-only closed) does not touch closure fields that were never there.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-valid-record-only-is-terminal-never-shipped",
      "description": "A spec that is eligible (NO-CONTRACT fixture and INVALID-contract fixture, both covered) with a complete closure record derives state === 'closed-record-only'; registry counts report recordClosed incremented with shipped unchanged; and it emits no zombie-plan, aging-no-plan, aging-inactive, size-exceeded, nor unknown-status finding — the last because closed-record-only is in RECOGNIZED_SPEC_STATUSES per §1, so a correctly spelled declaration is recognized vocabulary. memory.service report.specPortfolio exposes recordClosed rather than absorbing it into any existing bucket.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/memory.service.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-closure-record-and-waiver-are-independent",
      "description": "Credentials do not substitute for each other in either direction. A valid closed-record-only spec with releaseBlocking true and NO releaseBlockWaiver yields a non-null blocker carrying the record-only-specific reason (distinct in text from the parked reason); adding a valid waiver clears it. Conversely a spec with a valid releaseBlockWaiver but no closure record does NOT derive a terminal state. Diagnosis parity: a MALFORMED waiver on a valid closed-record-only spec surfaces its schema errors in registry.errors, because waiverIsLoadBearing consumes REQUIRES_RELEASE_WAIVER rather than testing state === 'parked' — with the pre-change condition this case reports a block with no explanation of the malformed waiver. Guidance parity: release-preflight's remediation text does not assert that a waiver applies to parked specs only, so a blocked operator is not told something the gate no longer does.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/release-preflight.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-violations-report-independently",
      "description": "A spec tripping several violations at once emits ALL of them, with distinct finding ids, and none short-circuits another: a fixture that is simultaneously ineligible, visibility-discrepant and record-incomplete emits all three of invalid-record-only-closure:ineligible, :contract-visibility-discrepancy and :record-incomplete. State derivation nevertheless runs once and yields exactly one state. Each instanceKey is independently dispositionable. Each of the three closure-record fields, omitted alone, produces record-incomplete.",
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
      "id": "ac-disposition-identity-is-stable-and-versioned",
      "description": "Fingerprint identity behaves as §5 freezes it. Set canonicalization: findings whose set-valued factInputs (zombieRelevantPlans, locallyExecutableCriterionDigests, invalidClosureFields) differ only in element ORDER produce an IDENTICAL fingerprint — asserted through computeFingerprint, and each key is present in fingerprint.js SET_KEYS so no local sorting in spec-portfolio.js can satisfy this. Sensitivity: changing WHICH criteria are locally executable moves the ineligible fingerprint; fixing one closure-record field while another stays invalid moves the record-incomplete fingerprint; rewording a finding message moves neither. Versions: SPEC_RULE_VERSIONS declares invalid-record-only-closure at 1, zombie-plan at 2 and size-exceeded at 2, and a test asserts those literals so a future silent emission-condition change under an unchanged version turns red.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "timeoutMs": 600000, "scope": "governance" } },
      "dependsOn": ["templates/cli/spec-portfolio.js", "templates/cli/disposition/fingerprint.js", "templates/cli/test/governance.js"]
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
  `parseSpecCriteria` behind the canonical parser. The containment in §2 makes
  the divergence safe, not absent.
- **The numbered-heading defect itself.** `parseSpecCriteria`'s
  `/^##\s+Acceptance Criteria\s*$/` silently classifies three real specs as
  having opted out of the contract system. Fixing the regex is a change to the
  verification authority and would move live `verify-contract` / `close`
  verdicts on those specs, so it needs its own adjudication — including what
  those three specs' contract states should become.
- **A CLI application path.** This spec defines derivation and validation only.
  Whether record-only closure is applied by hand-edited frontmatter or by a
  `mem spec` subcommand mirroring `parkSpec` is deliberately left open; adding a
  command before the semantics are proven would fix the ergonomics of a contract
  that has not yet been exercised.
- **A migration path for dispositions invalidated by the `zombie-plan@2` /
  `size-exceeded@2` bumps.** The bumps are required (§5) and correct, but they
  invalidate every existing decision on those two rules at once; whether any of
  those decisions deserve re-statement is a separate question from making the
  version honest.
