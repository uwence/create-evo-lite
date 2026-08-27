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

**Corrected after the second review.** The first version of this block said *"a
total classifier owns the phase derivation"* and listed four closure conditions.
That reinstated the very authority model §4.3 had just superseded, and it left
`emission consistency` out of closure entirely — so the document carried two
different definitions of what closing `L3` requires. There is now one, and it is
§4.8's.

```
DESIGN CLOSURE
    reason is the recorded fact
    the reason-phase CONTRACT owns the derivation
        a classifier IMPLEMENTS the vocabulary partition
        producer emissions CONFORM to the assigned phase
    closure conditions: §4.8's DESIGN CLOSURE layer, 1-4, no separate list
    -> L3 design question CLOSED BY SPEC AMENDMENT, once that amendment is
       independently reviewed and frozen

IMPLEMENTATION OBLIGATION, recorded separately
    no mechanical enforcement exists yet for EITHER invariant
    -> future enforcement MUST mechanically establish BOTH
           A. vocabulary partition
           B. emission consistency
       The exact mechanism stays deferred; the coverage does not.
    -> a guard that only catches "a new reason was added without being
       classified" closes A alone and leaves B forbidden by prose only
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

**Corrected after the second review: that was half the surface.** `A` lives in
the schema, but `B`'s facts live in the **producer**, which is mirrored the same
way. Measured at `85f0c25` — identical content and the same Git blob, so these
are two maintained copies rather than one file seen twice:

```
classification surfaces   templates/cli/hook-provenance/schema.js
                          .evo-lite/cli/hook-provenance/schema.js
                          sha256 f31a9dcd5164…

emission surfaces         templates/cli/hooks.js
                          .evo-lite/cli/hooks.js
                          sha256 1730e8c6eb52…   blob 76ff7acd71b1 (both)

                          templates/cli/hook-provenance/observe.js
                          .evo-lite/cli/hook-provenance/observe.js
                          sha256 bf69b2e48e2d…
```

**The observe.js pair was omitted from the previous revision** and is added after
the third review. It is not incidental: `observeHooksDir` emits three of the nine
reasons directly — `hooks-dir-missing`, `hooks-dir-unobservable`,
`hooks-dir-not-directory` — and `hooks.js:238` writes `dir.reason` straight into
`draft.install.reason` without transformation. It is squarely inside `B`'s
emission graph.

### 4.7a A file list is a measurement, not the authority

`B` is quantified over *every* emission site:

```
for every emission site e that can emit reason r:  phase(e) == assignedPhase(r)
```

so the authority has to be **all admissible emission sites**, not the files this
pre-audit happened to enumerate. That the list was already wrong once — twice, if
`hooks.js` counts, since the first revision named neither pair — is the argument,
not an anecdote.

A token-grep manifest is unsound, and the two directions do **not** rest on the
same strength of evidence. Stated at the strength each actually earned:

```
MEASURED — false positives

  code-perception/cache.js:348 returns { reason: 'write-failed' }
      the same token, an unrelated subsystem, not an install.reason
  post-commit-code-perception.js:164 diag('post-commit-blob-write-failed')
      a substring, not the token

STRUCTURAL, NOT MEASURED — false negatives

  an emission site computing a reason into a variable emits no literal to
  match. No such site exists today; the argument is that nothing prevents one,
  not that one was found.
```

An earlier revision said *"two measurements show … in both directions"*. They do
not: the false-negative leg was marked `unmeasured` in the same block. Fabricating
a fixture to promote it would buy a stronger-sounding claim for a risk that is
already sound as a structural argument — in a document whose subject is evidence
that looks better than it is.

```
The surfaces listed above are EVIDENCE of the current emission graph.
They are NOT the authority for it.

Future enforcement MUST cover every producer path capable of contributing
install.reason, including emission sites introduced later. A guard that
checks a fixed manifest establishes only that the manifest passed.
```

The mechanism stays deferred; this is not a request to design a static analyser
today. It is a refusal to let an incomplete current list stand in for contract
coverage — the same lesson `[hook-install-provenance]`'s Task 8 paid for, where a
hardcoded mirror manifest reported `OK` while two modified pairs went unexamined.

Naming only the schema mirrors would permit exactly this:

```
schema guard      both mirrors PASS
producer guard    only one hooks.js checked
the other hooks.js   a wrong-phase emission is introduced, unnoticed
```

**Corrected after the fourth review.** The clause below first read *"must cover
both CLASSIFICATION surfaces and both EMISSION surfaces"*. That fixed tomorrow's
boundary at today's count — reintroducing, one paragraph later, the exact failure
mode §4.7a exists to eliminate.

```
Future mechanical enforcement MUST cover:

  - the complete maintained CLASSIFICATION surface; and
  - EVERY producer path capable of contributing install.reason.

Where any such surface is mirrored, every maintained member of that mirror
set must be covered, unless mechanical derivation from another member is
established.
```

```
current list    evidence
complete graph  authority
mirror set      obligation, whatever its size
```

Equal hashes prove `CURRENTLY IN SYNC`. They do not prove that a guard installed
against one copy protects the other.

This is an evidence boundary on a future obligation. It authorizes nothing, and
it is deliberately **not** an invitation to resolve *why* two copies exist — that
is a different question with a different owner.

### 4.7b The phase claim that survives a lexical rejection

§4.4b recorded that the `chmod` branch still runs after `schema.js:177-180`
rejects an out-of-vocabulary reason, and left it without a disposition. §4.6 says
*"there is no semantic default branch"* while §5 forecasts *"no production-schema
change"* — the two were not reconciled. They are now.

**Disposition: it is a contract violation, and it is eliminated by enforcing
§4.4 A rather than by short-circuiting the validator.**

Measured: the validator has 37 `errors.push` sites and deliberately accumulates
rather than failing fast, because a caller wants every defect at once.
Short-circuiting the phase step to silence the stray claim would buy the rule at
the cost of that design.

It does not have to be bought. Once the classifier is total and explicit,
`PRE_WRITE_REASONS.includes(r) === false` no longer *means* write-issued — the
classifier is asked, and for an unclassified reason it answers `unclassified`,
which is a contract failure in its own right. The stray phase claim disappears as
a **consequence** of `A`, not as a separate fix.

```
today          lexical authority says INVALID
               phase else nevertheless emits a write-issued claim
               -> no accepted provenance fact is affected: the document is
                  rejected either way
               -> but a reader is told something about a write that may never
                  have been issued

after A        the classifier answers `unclassified`
               no phase is claimed for a reason nobody classified
               error accumulation is preserved
```

So `no semantic default branch` stands as written in §4.6, it covers the
validator's diagnostic path, and it still requires **no production-schema change**
— which is what §5 forecasts. The three sections now agree.

### 4.8 What L3's closure now requires

**Corrected after the third review.** The previous revision listed five
conditions as one flat set. Four of them are things an amendment can freeze; the
fifth is mechanical enforcement, which by §4.7's own rule must **not** hold the
design question open. A single flat list therefore made the document say both
*"enforcement is not a reason to keep L3 open"* and *"L3 needs enforcement"*.
Deleting the rival list fixed the authority model but left the two closure
**layers** compressed. They are now separate.

`install.reason` earns the right to remain the sole recorded fact — with no
second `writeIssued` field — only if all of this holds, in both layers:

```
DESIGN CLOSURE REQUIREMENTS          frozen by the amendment
1  reason remains the canonical recorded fact
2  the contract assigns every reason exactly one phase          §4.4 A
3  the contract requires every emission site to conform         §4.4 B
4  missing OR conflicting classification is a contract failure

IMPLEMENTATION / EVIDENCE OBLIGATION  recorded, does NOT gate design closure
5  mechanical enforcement establishes A and B across the COMPLETE maintained
   surface — the whole classification surface, and EVERY producer path capable
   of contributing install.reason, with every member of any mirror set covered.
   Not a fixed manifest, and not a fixed count of pairs   §4.7, §4.7a
```

```
L3 DESIGN closes when the amendment freezes 1–4.
5 remains an implementation obligation and does not keep the design
question open.
```

This is the document's only closure list, and the layer split is what makes it
consistent with the rule it inherited:

```
design unresolved   !=   approved design not yet mechanically enforced
```

Condition 1 is also worth stating plainly: nothing measured across three reviews
has shown `reason` unable to serve as the canonical fact. That remains an absence
of refutation — which is exactly why `2`–`4` exist, and why `5` is written down
rather than assumed.

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

**Corrected after the second review.** The first version forecast a single guard
for unclassified reasons. That is `A` only, and it would have left the review's
two counterexamples forbidden by prose and by nothing else.

```
expected      mechanical enforcement of BOTH invariants:
                A  a reason added without a phase assignment       -> failure
                B  a reason reachable from a path in another phase -> failure
              covering the complete maintained classification surface and EVERY
              producer path capable of contributing install.reason, with every
              member of any mirror set covered — not a fixed count of pairs
              exact mechanism deferred; coverage is not

NOT expected  any production-schema change
              any change to ac12's text
              any change to the producer's behaviour
              any change to existing chmod behaviour
              any short-circuit of the validator's error accumulation (§4.7b)
```

`B` is the harder half and its cost is not yet estimated here. Saying so is the
point: a forecast that quietly omits the expensive half is worse than no forecast,
because it under-prices the direction being approved.

**Not authorized by this document.** The amendment is written and reviewed first;
only an approved amendment can authorize that future implementation.

The earlier wording here said *"even that small a change"*. It contradicted the
paragraph directly above it — a cost that has not been estimated may not be
called small — and it did so in the one section whose purpose is to stop the
forecast from under-pricing what it forecasts.

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

```
0ac76b5   second review, cross-checked against schema.js, hooks.js and the
          observer rather than against this document's prose:
          CHANGES REQUIRED, 3 Important, 0 Minor. Again no measured fact false.

          R1  the contract was fixed; the OBLIGATION still covered A only, so
              both counterexamples remained forbidden by prose alone
          R1  mirror scope named the schema pair and missed the producer pair,
              where B's facts actually live
          R2  the phase claim surviving a lexical rejection had been spotted in
              §4.4b and left without a disposition, while §4.6 and §5 pulled in
              opposite directions
          R3  §4.3's supersession passed, but §4.7 reinstated the superseded
              authority model and carried a second, shorter closure list

this      §4.7  authority wording aligned with §4.6; the rival closure list
revision        deleted in favour of a pointer to §4.8; obligation now covers
                A and B
          §4.7  mirror scope split into classification and emission surfaces,
                both pairs measured
          §4.7b disposition for the surviving phase claim: a contract violation,
                eliminated BY enforcing A, not by short-circuiting a validator
                that deliberately accumulates 37 error sites
          §4.8  marked as the document's only closure list
          §5    forecast corrected to both invariants, and its unestimated half
                said out loud

3ba2a95   third review, again cross-checked against source:
          CHANGES REQUIRED, 2 Important + 1 Minor. R2 and R3 PASS. No measured
          fact false.

          I1  the emission surface was still incomplete — observe.js x2 emits
              three reasons directly and was omitted — and, more importantly, a
              fixed file list cannot be the authority for a quantifier over
              every emission site
          I2  design closure and enforcement closure were re-conflated: 4.8's
              flat five-item list made the document require enforcement for
              closure while 4.7 said enforcement must not gate it
          m   "even that small a change" contradicted "its cost is not yet
              estimated", in the section written to prevent under-pricing

this      §4.7  observe.js pair added, measured
revision  §4.7a a file list is a measurement, not the authority — with two
                measured false positives showing a token grep is unsound in both
                directions
          §4.8  split into DESIGN CLOSURE (1-4, frozen by the amendment) and
                IMPLEMENTATION / EVIDENCE OBLIGATION (5, does not gate closure)
          §4.7  DESIGN CLOSURE now points at the 1-4 layer specifically
          §5    "small" removed, with the contradiction recorded rather than
                silently edited

a39eea7   fourth review: CHANGES REQUIRED, 1 Important + 1 Minor. Design-closure
          layering, the "small" contradiction, R2 and R3 all confirmed closed.

          I   the normative clauses in 4.7, 4.8 and 5 still said "both
              EMISSION surfaces" / "both emission mirrors" — fixing tomorrow's
              boundary at today's count, one paragraph after 4.7a declared that
              a list is not the authority
          m   "two measurements show ... in both directions" overstated a
              false-negative leg the same block marked unmeasured

this      §4.7 §4.8 §5  every fixed-count phrase replaced by complete-surface
revision                wording: the whole classification surface, every
                        producer path capable of contributing install.reason,
                        and every member of any mirror set whatever its size
          §4.7a         evidence downgraded to what it earned — MEASURED false
                        positives, STRUCTURAL-not-measured false negatives, with
                        a note on why fabricating a fixture would be the wrong
                        purchase in this document in particular
```
