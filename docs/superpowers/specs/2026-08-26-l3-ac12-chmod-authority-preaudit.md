# `L3` / `ac12` — spec-amendment PRE-AUDIT

**Nature: `PRE-AUDIT`.** This is not the amendment, not an approved spec change,
and not an implementation authorization. It states what the amendment should
settle and why, so that the amendment itself can be written, reviewed and frozen
on its own gate.

| | |
|---|---|
| ledger item | `L3` — *"AC12 chmod semantics — may chmod be ABSENT on a phase-2/3 outcome?"* |
| registered | Task 2 of `[hook-install-provenance]`, `OPEN DESIGN QUESTION` ever since |
| frozen design | `ae39cbe`, branch `spec/hook-install-provenance` |
| baseline | `main` @ `85f0c25` |
| authorized | read-only pre-audit only. No test, no validator change, no schema change. |

`L3` has been explicitly reserved from every task since Task 3, on the ground that
it is a change to the frozen contract and must travel the design-change path. This
document is the first step of that path.

---

## 1. The question `L3` names is not the question `L3` is

`ac12`, verbatim from `ae39cbe`:

> Within a present `install` object, `targetPath` records the intended mutation
> target and is present on every outcome including `unrealized`,
> `expectedBodyDigest` appears only when the outcome is `realized`, and **`chmod`
> is present if and only if the hook write was issued: it is absent on every
> phase-1 outcome and present on every phase-2/3 outcome.** …

That is not ambiguous, and the producer complies with it. Measured:

```
hooks.js   writeManagedHook returns
             pre-write failure  -> phase-1, `pre-write-observation-failed`, no chmod
             otherwise          -> chmodSync in a try/catch that cannot escape
                                -> chmodEvidence = { issued: true, threw }
                                -> only THEN is the outcome computed
```

One earlier reading of mine was wrong and is corrected here rather than quietly
dropped: the `catch` block that attaches `e.chmodEvidence` looked like evidence of
a window where the write was issued but no chmod fact existed. It is not — that
`catch` wraps `appendEvent`, the *record commit*, by which point `chmodEvidence`
is already assigned. `chmodEvidence` is a return-value / error-attachment
dimension and is a different thing from the document's `install.chmod` field.

**So `L3` is not a product-compliance defect and not a wording defect.** What it
actually exposes is one layer down.

## 2. What it actually exposes: the phase decision has no named authority

The validator decides whether the write was issued like this:

```js
const preWrite = PRE_WRITE_REASONS.includes(inst.reason);
if (preWrite) {
    if (inst.chmod !== undefined) errors.push(`install.chmod must be absent for ${inst.reason}`);
} else if (!inst.chmod || typeof inst.chmod !== 'object') {
    errors.push('install.chmod required when the hook write was issued');
}
```

*"The write was issued"* is **not a recorded fact.** It is inferred from list
membership of `install.reason`, and the inference has a semantic `else`.

Measured at `85f0c25`:

```
INSTALL_REASONS union                 9   the frozen reason vocabulary
PRE_WRITE_REASONS                     4   hooks-dir-missing · hooks-dir-not-directory
                                          hooks-dir-unobservable · pre-write-observation-failed
therefore phase-2/3, must carry chmod  5   created-managed-hook · updated-managed-block
                                          appended-managed-block · write-failed
                                          post-write-observation-failed
partition total today                 true
strays (in PRE_WRITE, not in vocab)   none
PRE_WRITE_REASONS exported?           NO — visible only inside the validator
```

The partition is correct today and hand-maintained. The defect is structural, not
current:

```
a new INSTALL_REASON
+ nobody classifies it
-> the `else` branch claims it
-> silently WRITE_ISSUED
-> silently required to carry chmod
```

No error. No gap. A wrong default that looks like a decision.

This is the same shape `[0ce0]` Phase 1 spent its whole length on:

```
missing classification   !=   negative answer
```

## 3. The pre-audit's own probe failed the same way, and it is kept

The first attempt to measure the partition read `PRE_WRITE_REASONS` off the module
— where it is **not exported** — got `undefined`, and computed:

```
pre = []
0 + 9 === 9
partition total : true
```

**A plausible-looking `true`, derived from an input that was never established.**
The product risk and the audit-tool risk are isomorphic:

```
product      unclassified reason      ->  default WRITE_ISSUED
audit tool   undefined classification ->  default zero -> partition appears complete
```

It is recorded here because an audit that hides its own near-miss is asking to be
trusted rather than checked.

---

## 4. What the amendment should settle — ratified directions

These were adjudicated before this document was written. The amendment is bound
by them; this pre-audit does not reopen them.

### 4.1 `ac12`'s semantic contract is UNCHANGED

```
chmod present iff the hook write was issued
    phase 1   -> absent
    phase 2/3 -> present
```

No wording change. Every historical piece of `ac12` evidence keeps pointing at the
same property. The amendment must not produce an `old ac12` versus a `new ac12`.

### 4.2 The recorded fact stays `install.reason`

No new persisted field. Explicitly **rejected**: recording `writeIssued` as its own
fact. It would be the larger, not the safer, change — provenance schema change,
a new producer field, a new validator consistency relation, historical event
compatibility, the canonical projection, and a fresh mutation/evidence surface.
Nothing measured shows `reason` cannot be the canonical fact.

The minimal correct repair is not a second source of truth. It is to make the
existing derivation into a real authority.

### 4.3 The derived authority is an explicit, total reason-phase classifier

```
INSTALL_REASONS
        |
        v
explicit TOTAL classifier
        |
        v
PRE_WRITE   |   WRITE_ISSUED
```

Answering, once and by name, the question §2 showed had no owner:

> **Who decides whether the write was issued?**
>
> A classifier that performs a total partition of the frozen `INSTALL_REASONS`
> vocabulary. Not the `chmod` field. Not a downstream `else`. Not a fixture.

> **PRE-REVIEW OVERSTATEMENT — SUPERSEDED by §4.4 and §4.6.**
>
> The paragraph above is kept verbatim because it is the assertion an independent
> review attacked, and a `CHANGES REQUIRED` verdict is unreadable once the
> sentence it pointed at has quietly disappeared. It is **not** current guidance.
>
> It was too strong. A named total classifier establishes `reason → phase`
> classification only. It does **not** establish that every emission of an
> already-classified reason occurs in that phase. The classifier does not become
> the authority by being named; it *implements* a contract that the producer's
> emission sites must also conform to.

### 4.4 Required invariants — TWO, and the set equation alone is not one of them

**Corrected after independent review.** The first draft of this section carried
only the set equation. That is satisfied *tautologically* by

```
WRITE_ISSUED := INSTALL_REASONS \ PRE_WRITE
```

which is today's `else` under a new name. The equation must never travel without
§4.5 and §4.6; on its own it forbids nothing.

```
A. VOCABULARY PARTITION
   every member of INSTALL_REASONS belongs to exactly one semantic phase

       PRE_WRITE  ∪  WRITE_ISSUED  =  INSTALL_REASONS
       PRE_WRITE  ∩  WRITE_ISSUED  =  ∅

B. EMISSION CONSISTENCY
   every producer path able to emit a reason is in that reason's assigned phase

       for every emission site e that can emit reason r:
           phase(e) == assignedPhase(r)
```

`B` is the one the review found missing, and it is the one that bites. A future
idempotent-skip path recording `updated-managed-block`, or a pre-write
feasibility check recording `write-failed` — a token that names an *outcome*, not
a phase — makes an **already-classified** reason reachable with no write issued.
The guard proposed in §4.5 fires on *unclassified*, so it would never fire; the
classifier would return a confident wrong answer.

Measured today: both `write-failed` emission sites live inside `observeInstalled`,
the post-write observation, so `B` holds at `85f0c25`. Nothing enforces that it
keeps holding — which is the whole point.

```
CONTRACT FAILURE   a known reason becomes reachable from a path in the other phase
NOT                "wait until someone adds an unclassified reason"
```

### 4.4b Three constraints of different kinds, none sufficient alone

The review also surfaced that this document had never cited a check that already
exists:

```
lexical closure            reason ∈ INSTALL_REASONS[outcome]
                           schema.js:177-180 — ALREADY ENFORCED today
                           closes: an out-of-vocabulary reason

total / disjoint           a known reason has exactly one phase
classification             §4.4 A — NOT enforced today
                           closes: an unclassified new reason

emission consistency       every path emitting r is in phase(r)
                           §4.4 B — NOT enforced today
                           closes: a known reason emitted in the wrong phase
```

`schema.js:177-180` closes the first leg and **only** the first leg. It says
nothing about a known reason emitted from the wrong phase. Note also that there
is no early return before the `chmod` branch, so on a rejected out-of-vocabulary
document the phase `else` still runs and still emits a phase claim about a reason
that was never classified — harmless today, because the document is rejected
anyway, but it is a second place the default speaks without authority.

### 4.5 Forbidden: a complement branch with meaning

```
unclassified reason   !=   WRITE_ISSUED
```

A reason that has not been explicitly placed on one side is a **contract
failure**, mechanically, not a phase-2/3 reason by default.

### 4.6 Suggested normative clause

Placed beside `ac12` rather than inside it, so the criterion's text is untouched
while its previously implicit authority becomes explicit:

```
For AC12, whether "the hook write was issued" is determined solely by the
reason-phase contract.

The contract owns the semantic classification. A classifier IMPLEMENTS it, and
every producer emission site MUST CONFORM to it. Being named does not make the
classifier the authority.

The contract MUST explicitly assign every member of INSTALL_REASONS to exactly
one phase, and every producer path able to emit a reason MUST lie in that
reason's assigned phase.

There is no semantic default branch. Both of these are contract failures, not
phase-2/3 reasons:
  - a reason with no phase assignment;
  - a reason reachable from a path in a phase other than its assigned one.
```

The result is not a changed criterion. It is:

```
ac12 unchanged
+  its previously implicit authority made explicit and mechanically closable
```

### 4.7 Two closure points, kept apart

```
DESIGN CLOSURE
    reason is the recorded fact
    a total classifier owns the phase derivation
    the partition is exhaustive and disjoint
    no fallback classification
    -> L3 design question CLOSED BY SPEC AMENDMENT, once that amendment is
       independently reviewed and frozen

IMPLEMENTATION OBLIGATION, recorded separately
    a mechanical partition-completeness guard does not exist yet
    -> registered as its own obligation
    -> NOT a reason to keep L3 open
```

**Scope constraint on that obligation, added after review.** The hand-maintained
partition lives in **two live copies**, measured byte-identical at `85f0c25`:

```
templates/cli/hook-provenance/schema.js     sha256 f31a9dcd5164…
.evo-lite/cli/hook-provenance/schema.js     sha256 f31a9dcd5164…
```

Equal hashes prove `CURRENTLY IN SYNC`. They do not prove that a guard installed
against one copy protects the other.

```
Any mechanical enforcement of the reason-phase contract must cover both
maintained schema surfaces, or prove that one is mechanically derived from
the other. Passing in only one mirror is insufficient evidence.
```

This is an evidence boundary on a future obligation. It authorizes nothing, and
it is deliberately **not** an invitation to resolve *why* two copies exist — that
is a different question with a different owner.

### 4.8 What L3's closure now requires

Five conditions, not one. `install.reason` earns the right to remain the sole
recorded fact — with no second `writeIssued` field — only if all five hold:

```
1  the reason vocabulary is closed              schema.js:177-180, enforced today
2  every reason has exactly one semantic phase  §4.4 A, not yet enforced
3  every emission site conforms to that phase   §4.4 B, not yet enforced
4  missing OR conflicting classification is a contract failure
5  enforcement covers both maintained mirrors   §4.7
```

The first pre-audit found that **absence of classification must not become a
default answer**. The review found its dual, and it belongs beside it:

```
absent classification    ->  must not fake a judgement
present classification   ->  must not fake an established fact
```

A classification that exists but whose premise is unguaranteed is not a weaker
version of the first problem. It is worse, because it never looks empty.

Collapsing these two would recreate the confusion this project keeps paying for:

```
design unresolved   !=   approved design not yet mechanically enforced
```

---

## 5. Scope of the eventual implementation, for information only

Recorded so the amendment's reviewer can see the size of what it authorizes, and
so nobody later mistakes this paragraph for the authorization itself:

```
expected      one guard that turns "a new reason was added without being
              classified" from silence into a failure
NOT expected  any production-schema change
              any change to ac12's text
              any change to the producer
              any change to existing chmod behaviour
```

**Not authorized by this document.** The amendment is written and reviewed first;
only an approved amendment can authorize even that small a change.

---

## 6. Status

```
revision                  corrective, after an independent CHANGES REQUIRED
L3 design question        OPEN — this pre-audit does not close it
ac12                      UNCHANGED
spec amendment            NOT YET WRITTEN
implementation            NOT AUTHORIZED
tests / validator         UNTOUCHED, deliberately
producer                  UNTOUCHED, deliberately
```

## 7. Revision history

```
6a38671   first pre-audit
          verdict from an independent review: CHANGES REQUIRED, one additive
          change. No measured fact in the document was found false.

this      §4.3 overstatement PRESERVED and explicitly SUPERSEDED
revision  §4.4 split into two invariants; the set equation alone shown to be
               satisfiable tautologically
          §4.4b three constraints of different kinds, and schema.js:177-180
               cited for the first time — it closes one leg and only one
          §4.6 normative clause rewritten: the CONTRACT owns the classification,
               the classifier implements it, emission sites conform to it
          §4.7 mirror obligation added as an evidence boundary
          §4.8 L3's five closure conditions, and the dual of the original finding
```

The reviewer's two counterexamples are named in §4.4 rather than paraphrased, so
a re-review can check whether they are now covered by a mechanical contract or
merely by better wording.
