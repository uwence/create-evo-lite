# `ac12` — the reason-phase authority

## SPEC AMENDMENT · ledger item `L3`

| | |
|---|---|
| amends | `docs/superpowers/specs/2026-08-18-hook-install-provenance-design.md` @ `ae39cbe` |
| criterion | `ac12` |
| ledger item | `L3` — *"AC12 chmod semantics — may `chmod` be ABSENT on a phase-2/3 outcome?"* |
| evidence basis | `L3` / `ac12` pre-audit @ `c17a113` — **informational / evidentiary, NOT normative authority** |
| `schemaVersion` | unchanged — `1` |
| status | **DRAFT.** Written under authorization to draft. Adoption NOT authorized. |

**This document carries its own complete normative rule.** A future reader
settles what the contract says from the text below alone. The pre-audit explains
*why* the amendment exists and records how it was measured; it is not required
reading and it is not a source of obligation.

```
pre-audit    explains WHY
amendment    owns WHAT
```

---

## 1. What is amended

`ac12` is amended by **addition of a named authority beside it**. Its own text is
not touched.

The criterion says, verbatim from `ae39cbe`:

> Within a present `install` object, `targetPath` records the intended mutation
> target and is present on every outcome including `unrealized`,
> `expectedBodyDigest` appears only when the outcome is `realized`, and **`chmod`
> is present if and only if the hook write was issued: it is absent on every
> phase-1 outcome and present on every phase-2/3 outcome.** `diagnostic` is
> optional on every event, is permitted on non-participating events, and never
> feeds any verdict. Every `reason` value used anywhere belongs to the v1
> vocabulary fixed by this spec, and no vocabulary member originates in the
> implementation.

`L3` asked whether that *iff* should be relaxed — whether `chmod` may be ABSENT on
a phase-2/3 outcome.

**The answer is no, and the question was pointing at the wrong layer.** The
criterion is not ambiguous, and the producer complies with it. What was missing
is one layer down: the criterion is written in terms of *"the hook write was
issued"*, and no part of the frozen contract said **who decides that**.

```
ac12's requirement      unchanged
ac12's premise          previously implicit — now owned, named, and closable
```

## 2. The gap this closes

*"The hook write was issued"* is not a recorded fact anywhere in a provenance
document. There is no `writeIssued` field, and this amendment does not introduce
one. The phase is **derived** from `install.reason`.

That derivation existed, but only as an implementation detail with a semantic
`else`: a reason found on a hand-maintained pre-write list meant no write was
issued, and **anything else** meant a write was issued. So:

```
a new install.reason is added to the vocabulary
+  nobody classifies it
->  the else branch claims it
->  silently WRITE_ISSUED
->  silently required to carry chmod
```

No error is raised, and nothing looks empty. A wrong default wearing the shape of
a decision.

That is the same failure this whole contract exists to forbid:

```
missing classification    !=    negative answer
a failure to OBSERVE      must never impersonate a change in FACT
```

There is a dual, and it is the harder half. Classifying a reason says nothing
about **where that reason can be emitted from**. A reason that is correctly
classified as write-issued, but which a future producer path can emit *before any
write is issued*, produces a confident and wrong phase answer — and no guard
aimed at unclassified reasons would ever fire on it.

```
absent classification    ->  must not fake a judgement
present classification   ->  must not fake an established fact
```

---

## 3. NORMATIVE — the reason-phase contract

Everything in this section is binding contract text.

### 3.1 The recorded fact

`install.reason` remains the sole recorded fact from which the write phase is
derived.

No `writeIssued` field, and no other second source of truth for the phase, is
introduced. Recording the phase as its own persisted fact is **rejected**: it
would be the larger change, not the safer one — a provenance schema change, a new
producer field, a new validator consistency relation, a compatibility question
for every historical event, a change to the canonical projection over which
`event.id` is computed, and a fresh evidence surface. Nothing measured has shown
`reason` unable to serve as the canonical fact.

The repair is not a second source of truth. It is to make the existing derivation
into a real authority.

### 3.2 The authority

> **For `ac12`, whether "the hook write was issued" is determined solely by the
> reason-phase contract defined in this amendment.**

The contract owns the semantic classification. A classifier **implements** it, and
every producer emission site **must conform** to it. Being named does not make a
classifier the authority.

```
INSTALL_REASONS
        |
        v
the reason-phase CONTRACT          <- owns the classification
        |
   implemented by                   conformed to by
        |                                |
   a classifier                     every producer emission site
        |
        v
PRE_WRITE   |   WRITE_ISSUED
```

### 3.3 The v1 phase assignment

The contract must assign every member of the frozen v1 `install.reason`
vocabulary to exactly one phase. For `schemaVersion: 1`, that assignment is:

```
PRE_WRITE          no write was issued; install.chmod is ABSENT
  hooks-dir-missing
  hooks-dir-not-directory
  hooks-dir-unobservable
  pre-write-observation-failed

WRITE_ISSUED       a write was issued; install.chmod is PRESENT
  created-managed-hook
  updated-managed-block
  appended-managed-block
  write-failed
  post-write-observation-failed
```

This is a restatement of the phase mapping already frozen in the design's
**"complete mapping"** block, promoted from a description of situations into an
explicit total function over the vocabulary. It changes no member's meaning and
moves no member across the line.

Two members are worth naming, because their spelling and their phase are the
whole point:

- **`pre-write-observation-failed`** states a phase fact. The observation needed
  to decide the mutation could not be completed *before any write was issued*. It
  is not `post-write-observation-failed`, which would put a phase the run never
  reached into a record whose only purpose is that its statements are true.
- **`write-failed` is scoped to the write phase, not to the exception.** It is a
  `WRITE_ISSUED` reason because the write phase was entered — not because a throw
  was seen. A reader must not infer from its name that it may be emitted by a
  pre-write feasibility check.

The vocabulary is frozen by the design document, not by this amendment. If a
future `schemaVersion` adds, removes, or renames a member, invariant **A** below
requires the assignment to be extended with it, in the contract, before that
member may be emitted.

### 3.4 Invariant A — VOCABULARY PARTITION

> Every member of `INSTALL_REASONS` belongs to exactly one semantic phase.
>
> ```
> PRE_WRITE  ∪  WRITE_ISSUED  =  INSTALL_REASONS
> PRE_WRITE  ∩  WRITE_ISSUED  =  ∅
> ```

The set equation is necessary and **not sufficient**. On its own it is satisfied
tautologically by

```
WRITE_ISSUED := INSTALL_REASONS \ PRE_WRITE
```

which is the old `else` under a new name. `A` therefore never travels alone: it
is binding only together with **B** (§3.5) and the prohibition of a semantic
default (§3.6). The word *explicit* is load-bearing — the assignment must be
stated, member by member, not produced by complementation.

### 3.5 Invariant B — EMISSION CONSISTENCY

> Every producer path able to emit a reason must lie in that reason's assigned
> phase.
>
> ```
> for every emission site e that can emit reason r:
>     phase(e) == assignedPhase(r)
> ```

`B` is the invariant that bites, and it is not implied by `A`. Two concrete
shapes violate it while `A` holds perfectly:

- an idempotent-skip path that records `updated-managed-block` without issuing a
  write;
- a pre-write feasibility check that records `write-failed` — a token naming an
  *outcome*, not a phase.

In both, the reason is **already classified**. A guard that fires on
*unclassified* reasons never fires; the classifier returns a confident wrong
answer; and `ac12`'s `chmod` requirement is then enforced against a phase that
never happened.

```
CONTRACT FAILURE   a known reason becomes reachable from a path in the other phase
NOT                "wait until someone adds an unclassified reason"
```

### 3.6 No semantic default branch

> There is no semantic default branch. Each of the following is a **contract
> failure**, mechanically, and never a phase-2/3 reason by default:
>
> - a reason with no phase assignment;
> - a reason reachable from a path in a phase other than its assigned one.

```
unclassified reason    !=    WRITE_ISSUED
```

A reason that has not been explicitly placed on one side has not been answered.
It must be reported as unanswered.

### 3.7 Consequence: the phase claim that survives an outcome/reason rejection

The validator already enforces **outcome/reason coherence** — that
`install.reason` is a member of the vocabulary permitted for its
`install.outcome`. It also accumulates errors rather than failing fast, by
design, because a caller wants every defect in one report. So a document
rejected on that check still reaches the phase step, and the phase step still
speaks.

Two different rejections reach it, and they must not be collapsed:

```
CASE A   the reason has NO phase assignment
         a token belonging to neither side of §3.3
         -> the classifier answers `unclassified`
         -> NO phase is claimed
         -> a contract failure in its own right, closed by A

CASE B   the reason IS assigned a phase, and is paired with an outcome that
         does not permit it — outcome `realized` carrying `hooks-dir-missing`,
         or an unrecognised `install.outcome` altogether
         -> outcome/reason coherence rejects the DOCUMENT
         -> the reason's phase assignment is untouched: `hooks-dir-missing`
            is PRE_WRITE, and stays PRE_WRITE
         -> the classifier may answer for it; that answer does not make the
            document valid
```

```
invalid outcome/reason pairing    !=    absent phase assignment
```

Two questions, two authorities. The design already keeps them apart: the
vocabulary is grouped **by `outcome`**, while the phase mapping is a separate,
orthogonal statement over the same members.

> **Disposition. `A` eliminates the unauthorized default for reasons with no
> phase assignment. It does not erase the valid phase assignment of a known
> reason merely because that reason is paired with an invalid outcome.**

For Case A that is the whole repair. Once the classification is total and
explicit, `member of PRE_WRITE === false` no longer *means* write-issued: the
classifier is asked, and for an unassigned reason it answers `unclassified`, so
no phase is claimed about a reason nobody classified. Error accumulation is
preserved and the validator is not short-circuited.

For Case B there is nothing to repair. The document is rejected by the authority
that owns outcome/reason coherence; the phase contract's answer about that reason
remains true and simply does not bear on the document's validity.

This amendment therefore introduces **no** rule forbidding a phase claim after a
rejection. Such a rule would be broader than anything the design requires, and it
would be wrong for Case B.

Three constraints of different kinds are now distinguishable, and none is
sufficient alone:

```
outcome/reason           reason ∈ INSTALL_REASONS[outcome]
coherence                already enforced
                         closes: a reason not permitted for its outcome
                         says nothing about phase assignment either way

vocabulary partition     a known reason has exactly one phase
                         §3.4 A — contract, not yet mechanically enforced
                         closes: an unclassified new reason

emission consistency     every path emitting r lies in phase(r)
                         §3.5 B — contract, not yet mechanically enforced
                         closes: a known reason emitted from the wrong phase
```

---

## 4. What is NOT amended

```
ac12's text                        UNCHANGED — no old-ac12 / new-ac12 split
the chmod iff requirement          UNCHANGED — absent phase 1, present phase 2/3
the v1 install.reason vocabulary   UNCHANGED — no member added, removed or moved
install.outcome                    UNCHANGED
the persisted schema               UNCHANGED — no new field
schemaVersion                      UNCHANGED — stays 1
producer behaviour                 UNCHANGED
existing chmod behaviour           UNCHANGED
the validator's error accumulation UNCHANGED — no short-circuit (§3.7)
```

Every historical piece of `ac12` evidence keeps pointing at the same property.
This amendment makes a premise explicit; it does not restate a requirement.

## 5. Design closure

`install.reason` earns the right to remain the sole recorded fact — with no
second `writeIssued` field — only if **both layers** hold: the four design
closure requirements frozen here, and the implementation obligation recorded in
§6.

The design question `L3` closes on the first layer alone. §6 does not gate it,
and must not be cited as a reason to keep `L3` open.

```
DESIGN CLOSURE REQUIREMENTS               frozen here
1  reason remains the canonical recorded fact                       §3.1
2  the contract assigns every reason exactly one phase, explicitly  §3.3 §3.4
3  the contract requires every emission site to conform             §3.5
4  missing OR conflicting classification is a contract failure      §3.6
```

All four are stated above. On adoption of this amendment:

```
L3    CLOSED BY SPEC AMENDMENT
ac12  UNCHANGED, its authority now named
```

Condition `1` is worth stating plainly rather than leaving as an assumption:
nothing measured to date has shown `reason` unable to serve as the canonical
fact. That is an **absence of refutation**, not a proof — which is exactly why
`2`–`4` exist, and why the obligation in §6 is written down rather than assumed.

## 6. Implementation and evidence obligation — recorded, non-gating

This section creates an obligation on a **future, separately authorized** work
item. It does **not** gate the closure in §5, and it authorizes nothing.

```
design unresolved    !=    approved design not yet mechanically enforced
```

No current mechanical enforcement establishes either `A` or `B` as a complete
invariant. The controlled reason vocabulary, the outcome/reason coherence check,
the existing pre-write list, the `chmod` phase checks, the producer's actual
phase structure and the accepted evidence all constrain the cases that exist
today. None of them mechanically establishes the total properties defined here,
and that gap — not an absence of any check at all — is what the obligation below
addresses.

> **5.** Future mechanical enforcement MUST establish **both** invariants:
>
> - **A** — a reason added without a phase assignment is a failure;
> - **B** — a reason reachable from a path in a phase other than its assigned one
>   is a failure.
>
> Coverage MUST extend to:
>
> - the complete maintained **classification** surface; and
> - **every producer path capable of contributing `install.reason`**, including
>   emission sites introduced later.
>
> Where any such surface is mirrored, **every maintained member of that mirror
> set** must be covered, unless mechanical derivation from another member is
> established.
>
> The exact mechanism is deferred. The coverage is not.

Three things follow from the way that obligation is written, and each is
deliberate:

- **A guard that closes `A` alone does not discharge it.** `A` catches a reason
  added without classification. It cannot catch either counterexample in §3.5,
  where the reason is already classified. An enforcement that stops at `A` leaves
  `B` with no mechanical statement of its general property — the existing tests
  pin the emission behaviour of particular cases, not the invariant — and should
  not be reported as having enforced this amendment.
- **A fixed manifest of files is not coverage.** `B` is quantified over *every*
  admissible emission site. Any enumeration of today's files is **evidence of the
  current emission graph, not the authority for it**; a guard checking a fixed
  manifest establishes only that the manifest passed. This project has already
  paid for that distinction once, where a hardcoded mirror manifest reported `OK`
  while modified pairs went unexamined.

  ```
  current list      evidence
  complete graph    authority
  mirror set        obligation, whatever its size
  ```

  Equal hashes across a mirror pair prove `CURRENTLY IN SYNC`. They do not prove
  that a guard installed against one copy protects the other. This is an evidence
  boundary on a future obligation; it is deliberately **not** an invitation to
  resolve *why* two copies exist, which is a different question with a different
  owner.
- **`B`'s cost is not estimated here.** Saying so is the point. A forecast that
  quietly omits the expensive half under-prices the direction being approved.
  This amendment does not choose a mechanism, does not scope one, and must not be
  read as implying that a small test discharges `B`.

## 7. Compatibility

```
schemaVersion            stays 1
documents legal before   remain legal — no member removed, no field added
producer emissions       unchanged
validator verdicts       unchanged for every document the contract already admits
```

This amendment narrows nothing a producer may emit and adds nothing a document
must carry. It states, in the contract, a classification the implementation was
already performing without a named owner.

`ae39cbe` and `a8c8986` are **amended, not rewritten**. `a8c8986` remains the SHA
the implementation plan was approved against; `ae39cbe` remains the SHA Tasks 1–8
of `[hook-install-provenance]` were accepted under. This document is additive and
sits beside them.

## 8. Status

```
nature                    SPEC AMENDMENT — DRAFT
authorized                drafting only
amendment adoption        NOT AUTHORIZED
independent review        NOT YET PERFORMED
L3                        OPEN until this amendment is reviewed and frozen
ac12                      UNCHANGED
implementation            NOT AUTHORIZED
tests / validator         UNTOUCHED, deliberately
producer                  UNTOUCHED, deliberately
spec/hook-install-provenance   NOT ADVANCED — still at ae39cbe
```

Adoption path, for the record:

```
draft (this document)
  -> independent amendment-level review
  -> explicit amendment-adoption authorization
  -> advance spec/hook-install-provenance
  -> that new SHA becomes the canonical design authority
```

Until the last step, `ae39cbe` remains the canonical frozen design, and a reader
asking *"what does `ac12` require"* is answered by `ae39cbe` alone.

## 9. Revision history

```
e858694   first draft of the amendment.
          Derived from the approved L3/ac12 pre-audit @ c17a113, which reached
          APPROVED (0 Important, 1 Minor closed) on its fifth independent
          review. Normative content restated here in full so that no future
          reader needs the pre-audit to know what the contract says.

this      amendment-level review 1: CHANGES_REQUIRED, 1 Important + 1 Minor.
          §3.3's nine-member assignment was reviewed and explicitly upheld as
          normative and in scope.

          Important — §3.7 collapsed two different rejections into one. The
          check is (outcome, reason) coherence, not global vocabulary
          membership, so a rejected document may carry a reason that IS
          assigned a phase. The old text asserted the reason "was never
          classified" and had A erasing the stray claim in all cases; that is
          false for outcome `realized` paired with `hooks-dir-missing`.
          §3.7 now separates CASE A from CASE B, narrows the disposition to
          reasons without a phase assignment, and states outright that this
          amendment adds no rule forbidding a phase claim after a rejection.
          The constraints block's first row is renamed accordingly.

          The three superseded sentences, verbatim, so that the finding stays
          readable against the artifact it attacked:

            "That check closes one leg and only one leg: an out-of-vocabulary
            reason."

            "... the phase step still runs and still emits a phase claim about
            a reason that was never classified."

            "Disposition: that stray claim is a contract violation, and it is
            eliminated by enforcing A, not by short-circuiting the validator."

          They are kept HERE, in the revision history, and not inside §3 —
          §3 is the normative text a future reader consults, and a superseded
          rule sitting beside a live one is exactly the ambiguity this
          amendment exists to remove.

          Minor — §6 said both invariants were "forbidden by contract and by
          nothing else". Overstated: the vocabulary, the coherence check, the
          pre-write list, the chmod phase checks and the accepted evidence all
          constrain today's cases. Restated as "no current mechanical
          enforcement establishes either as a COMPLETE invariant". The same
          overstatement two paragraphs later ("B forbidden by prose only") is
          corrected with it — a rule stated correctly and then broken a few
          lines down is the failure this document family keeps repeating.
```
