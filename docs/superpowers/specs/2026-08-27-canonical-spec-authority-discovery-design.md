---
id: spec:canonical-spec-authority-discovery
status: draft
created: 2026-08-27
---

# Canonical spec authority discovery — Phase 1 design

**Nature: `PHASE 1 DESIGN`.** Not an implementation authorization. It answers
**one layer** of one question and freezes the model needed to answer it. No
resolver is built here, no file is created on `main` here, and no authority moves
anywhere.

| | |
|---|---|
| work item | `canonical spec amendment discoverability` |
| baseline | `main` @ `85f0c25` |
| authorized | Phase 1 design only |
| the original question | From `main`, how does a reader resolve a work item to its **current canonical spec authority**, mechanically and uniquely? |
| what Phase 1 answers | From `main`, how does a reader mechanically and uniquely resolve the canonical authority **LOCATION ROOT**, relative to explicitly observed refs? |

**The gap between those two rows is the finding, not a shortfall.** The original
question turned out to decompose into four layers (§2), three of which are
unresolved dependencies with owners outside this design. Writing the original
question at the top and answering the narrower one below it would be the same
false certainty this document spends its length removing — so the title layer
carries the decomposition too.

Out of scope by ruling, and not smuggled back in below: merging any spec branch
into `main`, copying canonical design material into `main`, editing frozen design
documents, implementing a resolver, touching `governance.js` / `integration.js` /
hooks, writing tests, `§6` A+B enforcement, `[0ce0]` Phase 2. Also deliberately
not designed: a generic document registry, a knowledge graph, a spec search
engine, an automatic amendment merger. If the design below needed any of those to
stand up, its scope would have failed.

---

## 1. The problem is measured, not argued

Three facts, measured standing on `main` @ `85f0c25`.

**1. The strictest work item's design authority is invisible from `main`.**

```
ls docs/superpowers/specs/ | grep -i hook
  -> 2026-08-25-hook-environment-observation-matrix.md      only

mem plan scan  |  spec rows mentioning hook-install-provenance
  -> none
```

`[hook-install-provenance]`'s frozen design has never existed on `main`. Its
implementation did land there (PR #49, `main@d7daf47`); its authority did not, by
design — see the standing ruling that the two lineages stay separate.

**2. The same query gives a different answer depending on which branch you stand
on.** Run from the `spec/l3-ac12-amendment` working tree, the identical scanner
reports:

```
spec  spec:hook-install-provenance  [draft]
      docs/superpowers/specs/2026-08-18-hook-install-provenance-design.md
```

A reader on `main` gets nothing; a reader on that branch gets a row — and the
row's `[draft]` is stale besides. Neither reader is told which of the two answers
is authoritative, because nothing in the repository holds that fact.

**3. `[0ce0]`'s frozen model IS on `main` and is still invisible to the
registry.**

```
[warning] Skipped docs/superpowers/specs/2026-08-25-hook-environment-observation-matrix.md:
          missing id with spec: prefix
```

Measured at `85f0c25`: 30 of 40 documents under `docs/superpowers/specs/` carry
`id: spec:<slug>`; ten do not. So "present on `main`" is not sufficient for
discoverability either.

A fourth fact matters for what the fix must *not* be. On `main`:

```
plan  plan:hook-install-provenance  [draft]  0/8 tasks done
```

All eight tasks were implemented, individually reviewed, merged, and accepted.
The registry answers **confidently and wrongly**. This is the registered
`plan-closure-manual-gap` debt, and it is exactly why a locator must not cache
lifecycle state: a wrong "not found" announces itself; a wrong "draft, 0/8"
does not.

```
The problem on main is NOT a missing authority.
It is a missing AUTHORITY LOCATOR.
```

## 2. Frozen model

```
main
    contains locator / registry information

locator
    points to authority
    DOES NOT become authority

canonical spec authority
    remains on its declared spec branch + SHA
    each record DECLARES that its branch advances only for adopted
    authority transitions OF THAT RECORD'S WORK ITEM — a precondition the
    locator relies on and cannot verify — so a branch shared with other
    work items, main included, is UNSUPPORTED in v1                 §5.2a

location transition
    the adoption ruling AUTHORIZES it; the locator PUBLISHES it       §3
    v1 supports only the class whose FAILURE TO PUBLISH is detectable:
    same branch, SHA advances, entry unchanged. A branch or entry
    relocation stays a valid authority operation and an unsupported v1
    discovery transition                                            §5.2b

resolution
    work item
      -> exactly one canonical branch
      -> exactly one canonical SHA
      -> exactly one authority ENTRY POINT

authority set completeness
    a WHAT question, owned by the authority layer, NOT by the locator

failure to resolve
    LOCATOR_SOURCE_INVALID / UNRESOLVED / STALE / INVALID / CONFLICT
    never falls back to
        a copy on main
        the newest-looking document
        a branch tip guess
        historical PR text
```

**Discoverability turned out to be four layers, not one.** The reviews found
this by finding it broken twice; it is recorded here so the next reader starts
from it rather than rediscovering it. The four map one-to-one onto §7's four
consumer gates:

```
IDENTITY      which work item does this handle name, ever      gate 0  §4.1b
LOCATION      where is that work item's authority rooted       gate 1  this design
COMPLETE      which documents constitute the contract          gate 2  §4.2b
CURRENT       as observed when, and against what evidence      gate 3  §6.3

only LOCATION is frozen here. The other three are named dependencies with
owners outside this design. Compressing them back into LOCATION would
manufacture the false certainty this work item exists to remove.
```

The governing invariant:

```
locator failure    !=    permission to infer authority
```

which is this project's standing rule in a new position:

```
absence of authority resolution   ->   cannot produce spec judgement
missing classification            !=   negative answer
```

## 3. Q1 — who owns canonical-spec location

**A single locator DOCUMENT on `main`, holding one record per work item, and
nothing else.**

**Two different ownerships, and they must not be collapsed.** Added after the
sixth review, because `§3`'s *"and nothing else"* and `§8`'s *"the adoption
ruling decides the adopted WHERE tuple"* read as two competing `WHERE`
authorities unless the split is stated:

```
TRANSITION AUTHORITY   the adoption ruling
    authorizes the NEXT location state. It decides what the tuple becomes.

STATE AUTHORITY        the locator document on main
    is the CURRENTLY PUBLISHED location state — "currently" qualifies the
    publication, never the location's truth, which is gate 3. It is what
    consumers query.
```

Between the ruling and the locator PR the two disagree, and the disagreement has
a single licensed reading:

```
the ruling says WHERE = the new tuple
the locator still says WHERE = the old tuple

-> the published state is the old tuple, and it is STALE or wrong
-> a consumer has NO licensed fallback to the ruling, the adoption PR, or
   the merge commit
```

> **The adoption ruling is NOT a parallel discovery source.** It authorizes the
> next locator state; consumers still resolve through the locator document only.

Otherwise the project would have two answers to *"where is the authority"* and a
consumer would choose between them — which is the failure `§5.3` already forbids
for PR text, arriving through the front door instead.

Proposed:

```
data      docs/authority/canonical-spec-authority.json
schema    docs/contracts/canonical-spec-authority.schema.md
          id: contract:canonical-spec-authority
```

The schema path follows the existing convention in `docs/contracts/`
(`contract:architecture-ir`, `contract:planning-ir`). The record is ordinary
version-controlled content on `main`, changed by ordinary reviewed PR. No CLI
writes it in Phase 1, and nothing generates it.

Four candidate owners are **rejected**, each for a structural reason rather than
a preference:

```
the spec's own frontmatter
    circular. It lives at the location you are trying to find; reading it
    requires having already resolved.

the backlog in .evo-lite/active_context.md
    prose, and runtime state mutated by CLI transitions. Measured: the
    hook-install-provenance entry names no spec at all, and the scanner
    already reports R010 "Backlog item not in Planning IR" for it.

the planning IR
    it is a SCAN of whatever tree it runs in. §1 fact 2 is the disproof:
    the same scan gives two different answers on two branches, and neither
    result knows it is branch-scoped.

PR bodies and merge messages
    true when written, not durable as current-state, and not machine
    readable. PR #49 had to hand-write a navigation protocol in prose
    precisely because no locator existed.
```

The positive requirement behind all four rejections: **the locator must live
where the reader starts, and must not live inside the thing being located.**

## 4. Q2 — how a work item resolves uniquely

### 4.1 The key is the work-item id

```
key    the backlog work-item id, without brackets, compared under the
       identity contract of §4.1a
       hook-install-provenance · 0ce0 · 3d78 · attp-lw-memory-identity
```

Not the spec slug. The question a consumer actually holds is *"what is the
canonical spec for the work item I am acting on"*, and the work-item id is the
handle every ruling, backlog entry and PR in this project already uses. Measured
against the alternative: `spec:` slugs exist for 30 of 40 superpowers documents,
and `[0ce0]`'s frozen matrix has none — keying on slugs would leave the second
hardest work item unaddressable.

Where a spec slug does exist it is recorded as a **property of the located
artifact**, never as the lookup key.

### 4.1a What the existing identity authority does, and does not, establish

**Corrected after independent review.** The first version said the work-item id
is *"the handle every ruling, backlog entry and PR already uses"* and stopped
there. That is a popularity argument, not an identity contract, and it left two
holes — one of which contradicted an existing authority outright.

Measured in `templates/cli/memory.service.js`:

```
resolveBacklog                    :1879-1893
    target  = String(resolveHash).toLowerCase()
    matches = lines where extractBacklogId(line).toLowerCase() === target
    matches.length > 1  ->  "无法确定 resolve 目标"  (ambiguous)

backlog insert duplicate check    :1574-1575
    existingIds.map(id => id.toLowerCase()).includes(rawLabel.toLowerCase())

scope of both                     readSection(markdown, 'BACKLOG')
```

Two consequences, both fatal to `verbatim` as written:

```
CASE
    backlog authority already resolves ids CASE-INSENSITIVELY, and treats
    [abc] + [ABC] as ONE ambiguous identity — not two identities.
    A verbatim exact-key locator would accept "0ce0" and "0CE0" as two
    records, answer one question twice, and never raise LOCATOR_CONFLICT.

LIFETIME
    the uniqueness rule is scoped to the CURRENT BACKLOG section. Nothing
    establishes that an id, once its item leaves BACKLOG, may never be
    reused. A locator outlives the backlog line by design: a reused [3d78]
    years later would silently resolve to the retired item's authority.
    That is not a duplicate record, so it never raises CONFLICT either.
```

Both failures share the shape this whole document exists to eliminate: a
**successful-looking resolution of the wrong thing**. Neither is caught by any
check in §6.

The two halves have **different owners**, and the second correction below is
about exactly that.

```
IDENTITY — owned here
    comparison identity = the ASCII case-folded work-item id
    the record MAY store the original spelling; comparison NEVER uses it
    two records whose folded ids are equal are ONE key -> LOCATOR_CONFLICT
```

This half is the locator's own comparison semantics over its own input, it
aligns with the measured backlog behaviour rather than contradicting it, and it
is settled here.

`ASCII case-folded` is chosen over `canonical lowercase at write time` because
folding at comparison time cannot be bypassed by a hand-written record, whereas a
write-time convention is enforced only by whoever edits the file. Every measured
id is ASCII today; a non-ASCII id would need its own folding ruling, and this
design does not grant one — a record whose id is not ASCII is a record defect.

### 4.1b The lifetime half is NOT the locator's to freeze

**Corrected after the second review.** The previous revision froze this as a
rule *"this design ADDS"*:

> *"`LIFETIME` — a work-item id is a PROJECT-LIFETIME identity. Once used, it is
> never reused for a different work item, whether or not the original item is
> still in BACKLOG."*

The reasoning behind it was right; the placement was not. That rule governs
backlog creation, `context insert`, id allocation after archive or resolve, and
every other consumer that addresses anything by work-item id. A locator design
does not get to annex the project's identity lifecycle because it happens to
need it.

```
needing an authority    !=    being allowed to impersonate it
```

which is the rule this document already applied to completeness in §4.2b, and
the rule the whole `[hook-install-provenance]` amendment was written to enforce
one layer down. Applying it to completeness and violating it for identity, four
sections apart, is the failure shape this project keeps paying for.

So it is demoted to a named dependency:

```
WORK_ITEM_IDENTITY_AUTHORITY        UNRESOLVED / NOT INSTANTIATED

KNOWN, measured
    within the active BACKLOG section, ids resolve case-insensitively and
    must be unique                        memory.service.js:1879-1893, :1574-1575

MISSING
    no authority establishes that a work-item id is never reused for a
    different work item once its entry leaves BACKLOG
```

**The consequence is stated rather than hidden.** Until that authority exists, a
reused id resolves to the retired item's authority, every §6 check passes, and

```
the locator CANNOT DETECT IT
```

That is a real, named, undetectable failure mode of this design as frozen. It is
recorded here because the alternative — freezing a project-wide rule inside a
navigation spec so the gap stops showing — is precisely the false certainty this
work item exists to remove.

Two repair paths, neither chosen here:

```
A   a separate, very narrow work-item identity amendment freezes
    project-lifetime non-reuse. Probably minimal; still its own gate.

B   the locator keys on some other already-durable identity whose
    uniqueness and non-reuse contract is already established.
    None is known today; naming one is part of that work, not this one.
```

### 4.2 The record

Minimum shape, and it is minimum by argument:

```
workItem            string. Folded-identity uniqueness across the document is
                    a RESOLUTION rule (§4.3, §6.1a step 5), NOT a schema
                    constraint — see §6.1a for why that distinction is
                    load-bearing
canonicalBranch     string, a full branch name
canonicalSha        string, 40-hex
authorityEntry      exactly ONE repo-relative path, expected to exist at
                    canonicalSha
```

Four fields, each earning its place:

```
workItem            the lookup key. Without it there is no lookup.
canonicalBranch     Q3 cannot detect divergence without a declared branch to
                    compare the SHA against.
canonicalSha        the whole point. A branch name alone is a moving target,
                    and resolving to a tip is explicitly forbidden.
authorityEntry      where the authority is ROOTED. Without it, "the SHA
                    verified" says nothing about whether the document a
                    consumer needs is actually there.
```

### 4.2a Why `authorityEntry` is ONE path and not a list

**Corrected after independent review.** The first version declared
`authorityArtifacts` as a list, on the measured ground that
`[hook-install-provenance]`'s authority is two documents — the design and the
adopted amendment. The list was the wrong repair, and the review found the hole
it left:

```
a new amendment is adopted; canonical branch advances to NEW_SHA
the locator PR updates canonicalSha = NEW_SHA
and FORGETS to append the new amendment to authorityArtifacts

branch exists            PASS
NEW_SHA exists           PASS
ancestor                 PASS
every LISTED path exists PASS
NEW_SHA == branch tip    PASS
                         -> RESOLVED
```

The consumer receives a **silently incomplete contract**, and every check passes.
The list verifies *referential validity* of what was declared; nothing whatsoever
verifies that what was declared is *all of it*.

The decisive question is the review's own: **what independent fact would tell the
resolver that the list is missing an entry?** There is none. And a hand-written
manifest whose completeness nothing can check is precisely the defect the `ac12`
amendment froze one layer down, four weeks of review ago:

```
a fixed manifest is not coverage
a guard checking a fixed manifest establishes only that the manifest passed
```

Adding *"remember to update the list at adoption"* would restore the exact
failure this document exists to remove: a manual obligation, quietly forgotten,
still green.

**So the list is removed rather than kept and hoped for.** The locator declares
one entry, and its claim is narrowed to match what it can actually verify.

### 4.2b The completeness authority: NAMED, NOT INSTANTIATED

Enumerating the complete authority set is a **`WHAT` question, not a `WHERE`
question**. Which documents constitute the contract is part of the contract. A
locator that answered it would be doing exactly what `§9` forbids.

Stating the gap plainly rather than papering over it:

```
COMPLETENESS AUTHORITY   UNRESOLVED
    No mechanism today establishes the complete authority document set for a
    work item, and the locator does not become one.
```

That is not a hypothetical. Measured on the one case that has an amendment:

```
ae39cbe's design body   CANNOT point forward at its own amendment. It is
                        frozen, and the amendment was explicitly forbidden
                        from editing it.
e5f74fe's amendment     points BACKWARD: its header declares
                        "amends …-design.md @ ae39cbe".
```

So the only structure that exists at `canonicalSha` runs amendment → design, and
nothing runs design → amendments. **The leading candidate**, recorded so the next
gate starts from a position rather than a blank page:

```
authority set  =  { entry }  ∪  { d at canonicalSha : d declares it amends entry }
```

derived, not listed — no hand-maintained array anywhere. It would require every
amendment to declare what it amends, which `e5f74fe` already does and which is
therefore an existing precedent rather than a new invention. That is a
**normative rule about authority documents**, so it belongs to the authority
layer and needs its own ruling. This design does not grant it.

### 4.2c What `RESOLVED` may therefore claim

**Corrected after the sixth review.** This block previously read *"RESOLVED
MEANS this work item's authority is ROOTED at …"*, which quietly spends gate `0`.
Calling it *this work item's* authority asserts that the supplied key names the
work item the caller intends — the exact fact `§4.1b` marks `UNRESOLVED`, and the
exact substitution `§6.4`'s first boundary line forbids. `RESOLVED` is a
**record-resolution** verdict; it does not get to be an identity verdict.

```
RESOLVED MEANS
    for the SUPPLIED KEY, exactly one locator record matched under the
    locator's folded-key semantics, and that record declares the LOCATION
    ROOT — canonicalBranch, canonicalSha, authorityEntry — relative to the
    observed refs

RESOLVED DOES NOT ESTABLISH
    that the supplied key names the intended work item     gate 0  §4.1b
    that the authority set is complete                     gate 2  §4.2b
    that the location is current                           gate 3  §6.3
```

A consumer that needs the complete set — an amendment drafter, a
spec-compliance reviewer — obtains it from the authority layer, and today that
layer has no mechanism. Until it does, the honest resolution output says where
the authority is rooted and stops. This is the same move `[0ce0]` Phase 1 made
when it found `D2` had no live installation observer: name the authority, mark it
`NAMED_NOT_INSTANTIATED`, and refuse to let a lower layer fake the answer.

Fields considered and **rejected for v1**, with the reason each was rejected
rather than deferred out of vagueness:

```
schemaVersion       rejected. A version field is only worth its cost once a
                    second version exists or is planned. Adding it now buys
                    nothing and creates a value nobody will maintain. The file
                    is small, on main, and reviewed; a future shape change can
                    introduce versioning as part of that change.

amendmentChain      rejected, and this one is load-bearing. The chain
                    a8c8986 -> ae39cbe -> e5f74fe is EVIDENCE and it already
                    lives in Git and in §9 of the amendment. A resolver's job
                    is to hand back the location POINTER as recorded, not to
                    make consumers reconstruct it from history. Recording the chain would put a second,
                    hand-maintained copy of Git history in a file that cannot
                    detect its own drift.

status / disposition   rejected. See §8. This is the field class that would
                       turn the locator into a second normative state.

lastVerifiedAt      rejected. A timestamp is not evidence of currency; the
                    verification in §6 is cheap and runs at resolution time.
                    A stale timestamp would read as reassurance.
```

### 4.3 Uniqueness is a rule, not a tiebreak

At one resolution point, for one work item:

```
0 matching records    ->  LOCATOR_UNRESOLVED
1 matching record     ->  proceed to verification
>1 matching records   ->  LOCATOR_CONFLICT
```

**The representation must let the conflict survive long enough to be seen.**
Added after the fourth review. `§4.3`'s rule is stated over records, but nothing
had frozen how the document represents them, and the most natural JSON shape
destroys the evidence before any rule can inspect it:

```
{ "0ce0": {...}, "0CE0": {...} }
    two records under a folded identity — visible only if the implementation
    re-enumerates keys and folds them itself

{ "0ce0": {...}, "0ce0": {...} }
    many JSON parsers apply last-one-wins BEFORE the validator ever runs
    -> two conflicting declarations enter, one comes out
    -> LOCATOR_CONFLICT becomes UNREACHABLE
```

That is not a serialization detail. It is

```
the representation destroying the FACT
before the authority rule could adjudicate it
```

which is the same shape as every other finding in this document, moved down to
the encoding layer. So one property is frozen, and the concrete shape is left
open:

```
The locator document representation MUST preserve every authored record as a
distinct element through parsing and whole-document validation.

Duplicate workItem declarations MUST remain observable until folded-identity
conflict validation has run.
```

A top-level array of records satisfies it; an object keyed by `workItem` does
not. Whether the array is bare or wrapped in a named field is not frozen here.

**There is no "pick the newest", no "pick the last one in the file", and no
merge of competing records.** A duplicate key is a defect in the record, and a
resolver that silently picks one has answered a question nobody adjudicated —
the same shape as the `else` branch that `ac12`'s amendment just removed.

Resolution is a **lookup by exact key under §4.1a's folded identity**. Not a
glob, not a prefix match, not a substring search over titles. This project has already paid for substring
matching over work-item names twice, in `advanceFocusFromCommit` and in R012's
phantom-focus finding, both registered under
`[focus-auto-advance-manual-intent-overwrite]`:

```
reference    !=    authority
```

## 5. Q3 — stale, invalid, conflicting

The distinction the whole section exists for:

```
a locator entry EXISTS
      !=
a locator entry still names the CANONICAL authority
```

And its corollary, which is the trap:

```
the declared SHA is reachable and valid
      !=
the declared SHA is still current
```

Reachability is a property of Git objects. Currency is a property of a decision
that happened — or did not happen — outside the file. A resolver can verify the
first completely and can never establish the second by itself. What it *can* do
is detect **divergence** and refuse to adjudicate it.

### 5.1 Verdicts

Every verdict below is **relative to the refs actually observed** (§6.2), and the
observed SHAs travel with it as evidence.

```
RESOLVED
    exactly one record; §6.1 checks 1-4 pass; and check 5 finds the declared
    SHA IS the tip of the declared branch — no divergence AMONG THE OBSERVED
    REFS. Scoped by §4.2c: one record matched for the supplied key, rooted
    at, not complete, and not an identity verdict.

LOCATOR_STALE
    exactly one record; §6.1 checks 1-4 pass; check 5 OBSERVES DIVERGENCE —
    the declared branch has advanced beyond the declared SHA.
    MEANING: a canonicalization event may have occurred without the locator
    being updated.
    NOT MEANING: use the tip.

LOCATOR_INVALID
    the declared branch does not exist, or the SHA does not exist, or the SHA
    is not an ancestor of the declared branch, or the declared authorityEntry
    is absent at that SHA

LOCATOR_SOURCE_INVALID
    the locator itself could not be obtained or validated: the main ref, the
    data at main:<locator path>, its parse, the schema at main:<schema path>,
    or whole-document validation against it. Nothing about any work item can
    be concluded, including absence.                          §6.1a §6.2

LOCATOR_UNRESOLVED
    the locator document was read and validated, and NO record matches the
    SUPPLIED KEY under folded-key semantics

LOCATOR_CONFLICT
    MORE THAN ONE record matches the supplied key under folded-key
    semantics (§4.1a). Adjudicated at step 5, never by the schema.  §6.1a

    Both are worded over the SUPPLIED KEY, symmetrically with RESOLVED
    (§4.2c): the locator does not own "the supplied key names the intended
    work item", so no verdict of its own may assume it.
```

### 5.2 Why `LOCATOR_STALE` is a success of the design, not a wart

Where the canonicalization and the locator update are separate commits — the
shape of every adoption measured so far, since the authority sits on its own
branch and the locator sits on `main` — there is a window between them in which
the record names a superseded SHA. That window is real and it will happen.

(Stated as a condition rather than as a law: a work item whose authority is
already rooted on `main`, as `[0ce0]`'s matrix is, could in principle be
canonicalized and re-pointed in one commit and have no window at all. The
verdicts below do not depend on which case applies.)

The design's claim is not that the window is eliminated. It is narrower than
that, and the narrowing matters — `§5.2a` and `§5.2b` show two publication-lag
classes that stay invisible:

```
the SAME-DECLARED-BRANCH SHA-divergence window becomes detectable

today     that divergence is invisible; a consumer reads whatever it finds
after     it has a name, a verdict, and a stop

a branch or entry RELOCATION whose publication lags stays undetectable,
which is why §5.2b puts it outside the supported set instead of claiming
a guarantee that does not hold
```

Compare against the alternative that looks more convenient: resolving to the
branch tip closes the window and destroys the guarantee, because it makes any
push to the spec branch silently redefine the authority. That is
`branch tip guess`, and it is forbidden.

### 5.2a What the tip check is actually evidence of

**Added after the fifth review, and it is a model boundary rather than a
wording fix.** The divergence check compares `canonicalSha` against the tip of
`canonicalBranch`. That is a fact about a **Git ref**. The verdict it feeds is a
statement about **authority**. Those are only the same thing if

```
every authority transition        <->   a tip advance of canonicalBranch
every tip advance of that branch  <->   an authority transition
```

and nothing had frozen that biconditional. Both halves fail, in opposite
directions:

```
FALSE STALE — the branch moves without the authority moving

  canonicalBranch = main, canonicalSha = SHA_A, entry = matrix.md
  main advances to SHA_B for an unrelated PR; matrix.md untouched;
  no adoption ruling occurred
  -> SHA_A != tip -> LOCATOR_STALE, permanently, after any commit

  fail-closed, so it never lies — but a record on a shared branch expires
  on the next unrelated push. And the tempting repair, advancing
  canonicalSha to SHA_B to restore green, manufactures a canonical location
  that no adoption ruling ever established. §8 forbids exactly that.

FALSE RESOLVED — the authority moves without the branch moving

  authority migrates from spec/A @ SHA_A to spec/B @ SHA_B
  spec/A stays at SHA_A; the locator is not updated
  -> canonicalSha == spec/A's tip -> RESOLVED
  -> rooted at an abandoned location, every check green
```

The governing statement, which is this project's oldest rule at a new layer:

```
Git branch movement    !=    authority movement
observation            !=    fact
```

**The contract this design freezes, and the scope limit that follows.**

```
DECLARED PRECONDITION — PER RECORD, not per branch
    for a locator record R, R.canonicalBranch MUST advance ONLY for an
    adopted authority-location transition of R.workItem.

CONSEQUENCE — v1 SCOPE
    a shared branch is not authority-exclusive, so authority hosted on
    `main` is UNSUPPORTED by a v1 locator record. [0ce0]'s matrix, which
    lives on main, therefore has no v1 record — and UNRESOLVED is the
    honest answer for it, not a gap to backfill.

WHAT THE RESOLVER MAY THEREFORE CLAIM
    the tip check detects divergence ON THE DECLARED BRANCH, under a
    precondition the locator itself CANNOT VERIFY.
```

**Corrected after the sixth review: "authority-only" is not enough.** The
previous wording said the branch advances only when *"an authority transition for
its work items"* is adopted, which permits one branch to carry several work
items. Then every commit on it can be a genuine adoption and the detector still
lies:

```
spec/shared holds authority for A and for B
A's record declares canonicalSha = T1

B receives a legitimate adoption; spec/shared advances T1 -> T2
A's authority is untouched

A resolves: T1 != tip T2  ->  LOCATOR_STALE
```

So the biconditional the tip check depends on is not per branch, it is **per
record**:

```
authority-only branch    !=    work-item-authority-only branch
```

The precondition above is therefore quantified over `R.workItem`. It does not
forbid one branch from physically hosting several documents; it requires that a
record only ever declare a branch whose advances are all adoptions **of that
record's work item**. A branch shared between work items simply cannot satisfy
that for more than one of them, which is the same reason `main` cannot satisfy it
for any.

Two things are named rather than smoothed over:

**The precondition is declared, not established.** Whether a branch is only ever
advanced by adoptions is a fact about how people use it. No check in `§6.1` can
see it. The record asserts it; the resolver relies on it; neither proves it —
the same standing as gate `0`'s identity assumption.

**Even under the precondition, the FALSE RESOLVED case survives.** A migration to
a *different* branch leaves the declared branch untouched, so the tip check stays
green while the authority is elsewhere. Making `canonicalBranch` exclusive closes
the false-STALE half and closes nothing on the other side. That is a second
named, undetectable failure mode of the LOCATION layer, alongside identity reuse,
and it is why `§8` requires the adoption ruling to update the **whole** tuple
rather than trusting a detector to notice.

Option `B` from the review — defining independent authority-location transition
evidence, so that ordinary ref movement stops standing in for it — is the repair
that would close both halves and support shared-branch hosting. It is a
mechanism, it is not designed here, and it is recorded as the successor to this
scope limit rather than as a gap.

### 5.2b Which transitions v1 may claim to support

**Added after the seventh review, and it is the last structural gap rather than
a wording one.** `§3` separates the authority that *decides* a location change
from the authority that *publishes* it, and `§8` lets a ruling change the whole
tuple. Put together with the detectability boundary above, that produced a state
this design had named the pieces of but never ruled on:

```
an adoption ruling legitimately establishes a NEW location
the locator PR has not landed yet
the resolver returns RESOLVED, rooted at the OLD location
the consumer is FORBIDDEN to consult the ruling                         §3
```

Naming the two undetectable cases was not enough. A failure mode that is merely
*named* still leaves the transition inside the supported set, and then the
document promises support for something it cannot observe going wrong.

```
a known false-RESOLVED transition class
    cannot simultaneously be a SUPPORTED v1 transition class
```

So the supported set is defined by **detectability of its publication failure**:

```
V1-SUPPORTED TRANSITION
    canonicalBranch   unchanged
    canonicalSha      advances on that same branch
    authorityEntry    unchanged

    an unpublished update leaves canonicalSha behind the tip
        -> LOCATOR_STALE, fail-closed, detected

NOT V1-SUPPORTED
    canonicalBranch relocation      cross-branch migration
    authorityEntry relocation       a new root at the same branch

    a failure to publish the adopted tuple COMPLETELY AND CORRECTLY —
    including a PARTIAL publication — returns RESOLVED, rooted at the old
    location, with no verdict that distinguishes it           §5.2a, §8
```

**Corrected after the eighth review: "unpublished" was too narrow.** For a
branch relocation, a wholly unpublished update is enough to produce the false
`RESOLVED`. For an entry relocation it is not the only route, and often not the
one that happens:

```
entry relocation, NOTHING published, same branch advanced
    old SHA < tip  ->  LOCATOR_STALE          detected

entry relocation, canonicalSha published but authorityEntry OMITTED
    the old entry still exists at the new SHA
    SHA == tip  ->  RESOLVED, rooted at a historical artifact   NOT detected
```

So the disqualifying property is **partial or incorrect publication of the
tuple**, not merely its absence — which is the counterexample §8 already carried
and which this clause had failed to match.

**This forbids no authority operation.** Relocating a root or migrating a branch
remains a perfectly valid thing for the project to decide; what v1 cannot do is
*observe the publication of that decision failing*. So a record may not claim v1
support across such a transition unless separately established
transition-publication evidence accompanies it — option `B`, which does not
exist. Until it does, the honest handling of a relocation is to leave the work
item **without** a v1 record: `LOCATOR_UNRESOLVED` is an answer a consumer can
act on, and a silently wrong `RESOLVED` is not.

**The end state is not enough: the ORDER is part of the rule.** Added after the
eighth review. "No record afterwards" is the right destination, and reaching it
in the obvious order manufactures precisely the window this section exists to
close:

```
1  the relocation canonicalizes: authority is now spec/B @ SHA_B
2  the old record is removed from main, later

between 1 and 2
    the record still says spec/A @ SHA_A
    spec/A never moved, so SHA_A IS still its tip
    -> RESOLVED, rooted at an abandoned location
    and §3 forbids the consumer from consulting the ruling that would
       have told it otherwise
```

The consumer has no way to know, and the design would have created that state by
following its own protocol. So the ordering is frozen:

```
UNSUPPORTED-TRANSITION PROTOCOL

1  WITHDRAW the existing v1 locator record on main
2  ESTABLISH that resolution now returns LOCATOR_UNRESOLVED
3  ONLY THEN may the unsupported relocation canonicalize
4  the work item REMAINS without a v1 record until independent
   transition-publication evidence exists (option B)
```

```
withdraw first, then move
      NOT
move first, then clean up
```

The project has paid for the other order before: you do not enter a state your
detector cannot recognise and rely on a later step to erase the window.

**When v1 support ends** — bound to a Git event rather than to an intention, so
there is nothing to interpret:

```
v1 support ends at step 1's merge: when the withdrawal is canonically
published on main.

NOT when the ruling authorizes the relocation — the ruling is not a
discovery source (§3).
NOT when the relocation canonicalizes — by then the record must already
be gone.
```

`[hook-install-provenance] @ e5f74fe` is unaffected: `ae39cbe -> e5f74fe` on one
branch with the entry unchanged is exactly the supported class, which is also why
that fixture proved nothing about the other two.

### 5.3 What the locator may never do

`LOCATOR_STALE` and `LOCATOR_INVALID` are reports about the **locator**. Neither
is a finding about the spec, and neither licenses the resolver to look for a
better answer. Specifically forbidden as a fallback from any non-`RESOLVED`
verdict:

```
a document of the same name found on main
the newest file by date prefix or mtime
the declared branch's tip
another branch that looks related
a spec row from the planning IR
a PR body, merge message, or backlog entry
```

The last two are named because both are measurably wrong today: the planning IR
reports `plan:hook-install-provenance [draft] 0/8` for a work item whose eight
tasks are all merged and accepted, and `main@85f0c25`'s merge message still says
`L3/ac12 stays open` — a statement that was true when written and is now
history.

## 6. Q6 (part) — verification boundary

### 6.1 The checks

At resolution time, against the declared record:

```
1  the declared branch exists
2  the declared SHA exists as a commit
3  the declared SHA is an ancestor of the declared branch
4  the declared authorityEntry exists at that SHA
5  divergence: declared SHA == branch tip, or not
       evidence about the declared BRANCH only, and only meaningful under
       §5.2a's declared authority-exclusivity precondition
```

`1`–`4` failing yields `LOCATOR_INVALID`. `5` distinguishes `RESOLVED` from
`LOCATOR_STALE`. Check `3` is what makes `canonicalBranch` load-bearing rather
than decorative: without it a record could name any reachable commit in the
repository and pass.

### 6.1a Evaluation order, and the verdict for a locator that cannot be read

**Added after the second review.** Every check in `§6.1` starts from *"we already
have a record"*. Nothing said what happens when the locator itself cannot be
obtained — the `main` ref missing, the file absent at `main:<path>`, unparseable
JSON, a malformed top-level shape, a record failing schema, an unknown field.

Left unspecified, the most natural implementation reaches the worst answer:

```
locator source unreadable
    -> records = []
    -> 0 matching keys
    -> LOCATOR_UNRESOLVED
```

which asserts *"this work item has no locator"* on the strength of never having
looked. This project has a name for that shape and has now met it at four
different layers:

```
unreadable locator    !=    empty locator
failure to OBSERVE    !=    proof of ABSENCE
```

So the order is frozen, and it is part of the contract rather than an
implementer's choice:

```
1  resolve the observed main SHA                        §6.2, §6.3
2  read the locator document at main:<path>
3  parse it completely
4  validate the COMPLETE document against the schema read at the SAME
       observed main SHA (§6.2) — never an ambient copy
       including §9's vocabulary containment — an unknown field is a
       document defect, not a field to ignore
       and EXCLUDING folded-identity multiplicity, which step 5 owns
5  ONLY THEN look up the work item under §4.1a's folded identity

any failure in 1-4        ->  LOCATOR_SOURCE_INVALID
a valid document, 0 keys  ->  LOCATOR_UNRESOLVED
```

**Step `4` must not adjudicate duplicate identities.** Added after the fifth
review. `§4.3` had already required the representation to carry duplicate
`workItem` declarations through parsing — but a natural reading of `§4.2`'s
*"unique under §4.1a's folded identity"* makes uniqueness a **schema**
constraint, and then:

```
two authored records survive the parser      PASS   (§4.3 works)
whole-document schema sees a duplicate       FAIL
step 4 fails
        -> LOCATOR_SOURCE_INVALID
        -> LOCATOR_CONFLICT is STILL unreachable
```

The conflict fact survived the parser only to be consumed by the validator one
step later. So the split is frozen:

```
STRUCTURAL / SCHEMA VALIDITY  (step 4)
    shape, types, vocabulary containment, required fields
    MUST NOT treat folded workItem multiplicity as a source defect

FOLDED-IDENTITY MULTIPLICITY  (step 5)
    evaluated after structural validation succeeds
    0 -> LOCATOR_UNRESOLVED    1 -> verify    >1 -> LOCATOR_CONFLICT
```

```
the schema preserves the FACT
the resolver assigns the MEANING
```

One question, one authority: a schema that rejected duplicates would be a second
adjudicator of the same question, and then `LOCATOR_CONFLICT` should not exist at
all. This design keeps `LOCATOR_CONFLICT`, so the schema does not decide it.

`LOCATOR_SOURCE_INVALID` is named separately rather than folded into
`LOCATOR_INVALID` because the two answer different questions: *"the locator is
unusable"* versus *"this record is broken"*. A consumer told the second may
reasonably ask whether one record needs fixing; a consumer told the first knows
that **no** work item can be resolved right now, and that nothing it reads about
any other work item is trustworthy either.

Validation is over the **complete document**, before the lookup, deliberately. A
resolver that validated only the matched record would happily answer from a file
whose other records are malformed — and the fact that the file is corrupt is
exactly the fact a consumer needs before believing any part of it.

### 6.2 Where the locator is READ FROM — source binding

**Added after the first review.** The first version said the locator *"lives on
`main`"* and stopped. That is a statement about where the file is written, and it
does not constrain where a resolver reads it. The natural implementation —

```
read docs/authority/canonical-spec-authority.json
```

— reads the **ambient working tree**, which reproduces §1 fact 2 exactly, in the
new file:

```
on a PR branch that PROPOSES  canonicalSha = <candidate>
the resolver would read that proposal and treat it as the adopted locator
    -> a proposed locator impersonates an adopted one, before merge
```

So the binding is frozen:

```
LOCATOR AUTHORITY SOURCE
    main:<locator path>, read from the ref — never from the ambient
    working tree, the checked-out branch, or the index

A working-tree copy is a PROPOSAL. It is never authoritative, on any branch,
including main's own working tree with uncommitted edits.
```

The same rule that just governed the amendment applies here, one layer over:
a document is not the authority on whether it is the authority, and a branch is
not authorized to redefine `main`'s locator by containing a different copy of it.

**The schema is bound with it.** Added after the third review. `§6.1a` makes
whole-document schema validation a step of authoritative resolution, so the
schema is an *input* to that resolution — and binding the data while leaving the
validator ambient reproduces the same defect one move over:

```
locator data     read from the observed main SHA      bound
locator schema   read from the ambient working tree   UNBOUND

a feature branch carrying a PROPOSAL schema — allow unknown fields, relax a
required field, widen a grammar — would participate in validating main's
adopted locator, before that schema is itself adopted

    authoritative data + proposal-time validator
        ->  an authoritative-LOOKING resolution
```

So one observation owns both halves:

```
observedLocatorSha owns BOTH
    the locator data   at main:<locator path>
    the locator schema at main:<schema path>
read from the same ref, at the same observed SHA

schema missing, unreadable, or itself invalid  ->  LOCATOR_SOURCE_INVALID
    resolution STOPS; no lookup is attempted
```

If a future implementation freezes the schema as code rather than as a file, its
authority and source must be named just as explicitly. What is forbidden is
leaving it an ambient implementation detail: **the validator's provenance is part
of the resolution's provenance.**

### 6.3 What `SHA == tip` actually proves — evidence boundary

**Added after independent review.** `§5.2` says a resolver can never establish
currency by itself, and then check `5` names `SHA == tip` as `RESOLVED`. The
missing layer is what that equality is evidence *of*.

It is evidence of **no divergence among the refs the resolver observed**. It is
not evidence of global currentness, because both observed refs can be stale
together:

```
local main locator      -> old SHA
local canonical tip     -> the same old SHA
remote reality          -> both already advanced

check 5  ->  equal  ->  RESOLVED, wrongly
```

Co-staleness is invisible to every check in §6.1, and no amount of local
inspection fixes that: the missing fact is on a remote.

So the boundary is frozen, and `RESOLVED` carries its evidence rather than
claiming more than it has:

```
A resolution MUST report the two SHAs it observed:
    observedLocatorSha       the main ref the locator was read from
    observedCanonicalTipSha  the tip of the declared canonical branch

RESOLVED is relative to exactly those two observations.

    local-ref freshness NOT ESTABLISHED
          !=
    global currentness ESTABLISHED
```

Establishing ref freshness — whether a resolver must fetch, how it reports a
failed fetch, and whether a stale-but-offline resolution is usable — is a
**separate question with its own owner**, and this design does not answer it. It
is named here so that no consumer reads `RESOLVED` as more than it says. Phase 1
deliberately does not introduce a network dependency into a navigation primitive.

### 6.4 The boundary, stated as a rule

```
verification proves LOCATOR INTEGRITY
      !=
verification proves SPEC CORRECTNESS

and, after the corrections across the reviews to date:

a resolved KEY
      !=
the intended WORK ITEM                          §4.1b
declared references are VALID
      !=
the declared authority set is COMPLETE          §4.2b
a moved BRANCH
      !=
a moved AUTHORITY                              §5.2a
no divergence among OBSERVED refs
      !=
the pointer is CURRENT                          §6.3
```

The first line is the one a reader is most likely to skip, and it is the one
that invalidates all the others when it fails: everything below it is a true
statement about whatever work item the key actually named.

A green resolution says: *for the key you supplied, one record matched, and it
declares that root — that document, at that commit, on that branch — as observed
at those two ref SHAs.* It does not say the key names the work item you meant; it
says nothing about whether the spec is right, complete in substance, or adopted,
and nothing about documents beyond the entry. Those questions belong to the authority
documents and to the human gates that ratify them.

**Content digests are deliberately not verified in v1.** Existence is sufficient
for navigation integrity. A digest would begin asserting something about
*content*, which drifts the locator toward `WHAT`, and it would add a second
hand-maintained value that ages — this project has fixed exactly that defect
three times in the last two documents. A digest becomes justified only if a
concrete substitution attack or a real drift incident is observed; recorded here
so the reversal has a stated trigger rather than a mood.

## 7. Q4 — the consumer rule

**Rewritten after the second review.** The previous version said a consumer
`MUST first obtain a RESOLVED resolution` and stopped there — a single gate,
written while `RESOLVED` still meant "the complete, current authority". It no
longer means that: `§4.2c` narrowed it to *rooted at*, and `§6.3` made it
relative to observed refs. A one-gate rule over a narrowed verdict hands the
consumer a licence the verdict cannot back.

```
LOCATOR RESOLVED
    proves the LOCATION ROOT, relative to the observed refs
    NECESSARY for spec judgement, and NOT SUFFICIENT
```

A consumer that needs the **current complete contract** — a spec-compliance
reviewer, an implementation planner, an amendment drafter — passes **four**
gates, each owned by a different layer:

```
0  WORK-ITEM           work-item     does this handle name the work item the
   IDENTITY            identity      consumer intends, and no other, ever
                       authority     §4.1b — UNRESOLVED today
1  LOCATION            locator       RESOLVED per §5.1
2  AUTHORITY-SET       authority     the complete document set for that root
   COMPLETENESS        layer         §4.2b — UNRESOLVED today
3  REF FRESHNESS       that          whatever currency evidence this consumer
   the consumer needs  consumer's    actually requires
                       owner         §6.3 — UNRESOLVED as a policy question

Spec judgement may proceed only when all four hold.
```

**Gate `0` was missing from the previous revision, and its absence was the
sharpest hole in it.** `§4.1b` had already established that a reused id resolves
to the retired item's authority undetectably, and `§2` had already listed
`IDENTITY` as its own layer — but `§7` still authorised judgement on three
gates. That let the whole chain succeed against the wrong work item:

```
[3d78] retires; [3d78] is later reused for a different work item

identity authority   absent
locator              finds the OLD record          -> RESOLVED
completeness         established for the OLD authority
freshness            established
                     -> spec judgement proceeds against the WRONG WORK ITEM
```

Gates `1`–`3` can each be perfect and the answer still be about something else.
Gate `0` is first for that reason, not by numbering convenience.

Every non-`RESOLVED` verdict — `SOURCE_INVALID`, `UNRESOLVED`, `STALE`,
`INVALID`, `CONFLICT` — stops gate `1`: the consumer reports the verdict and
produces **no** spec judgement. But passing gate `1` is not the end, and the
honest current state is that **gates `0`, `2` and `3` have no mechanism at
all**.

So the conclusion this design reaches about its own sufficiency, stated rather
than avoided:

```
Phase 1 lets a consumer resolve a LOCATION ROOT relative to observed refs.

A fresh spec-compliance reviewer still CANNOT mechanically establish the
current complete contract.
```

That is not a failure of the locator. It is the locator doing its job and
uncovering **three** dependencies — identity, completeness, freshness — that were
previously invisible because nothing had ever tried to resolve authority
mechanically. Compressing all three back into one `RESOLVED` would manufacture
exactly the false certainty this work item exists to remove.

The failure mode this rule exists to prevent has already occurred here. During
PR #49, a reviewer could not find the design file on the implementation branch
and nonetheless began forming spec judgements; the PR body had to carry a
hand-written navigation protocol (`git fetch …`, `git show ae39cbe:…`) to keep
that from happening again. Prose in a PR body is not a mechanism, and it does not
survive into the next work item.

Stated as the degenerate reasoning to reject:

> *"I could not find it on `main`, so I will judge against what `main` has."*

That is `absence of observation` impersonating `established fact`, one layer up
from where this project keeps meeting it.

## 8. Q5 — advancing the pointer after an amendment

**Corrected after the fourth review.** This section previously froze *"the
adoption event advances `canonicalSha`, and changes nothing else"* — true of the
one adoption that has actually happened, and wrong as a general rule. A future
adoption may establish a new canonical root:

```
before   old-design.md @ SHA_A
after    the adopted authority is rooted at new-design.md @ SHA_B,
         and old-design.md still exists at SHA_B

under the old rule: canonicalSha SHA_A -> SHA_B, authorityEntry forced unchanged

branch exists            PASS
SHA_B exists             PASS
ancestry                 PASS
old-design.md @ SHA_B    PASS      <- it is still there
SHA_B == tip             PASS
                         -> RESOLVED, rooted at a HISTORICAL artifact
```

A successful-looking resolution of the wrong root, produced by a rule this
document wrote. The ownership was inverted: the locator does not get to decree
which parts of a location may change during an adoption.

```
the authority layer / the adoption ruling   decides the adopted WHERE tuple
the locator                                 RECORDS that tuple
```

That is the TRANSITION half of §3's split. The ruling authorizes the next
location state; the locator document remains the only **published** state a
consumer may query, and the ruling is never a parallel discovery source.

So the rule is:

```
After an adoption, the locator record MUST be updated to the ADOPTED canonical
location tuple:

    canonicalBranch
    canonicalSha
    authorityEntry

Only fields whose adopted location changed are changed. No field is inferred
to be immutable merely because the event is called an amendment.
```

**Bound by §5.2b, and the two classes have different protocols.** The rule above
says what a correct update looks like; it does not promise that an *incorrect*
one is caught. Only the same-branch SHA advance has a verdict for its own
omission, so only that class may canonicalize first:

```
SUPPORTED v1 transition
    1  canonicalize the adoption
    2  the old record is now behind the tip  ->  LOCATOR_STALE
    3  publish the updated tuple
    the window between 1 and 3 is fail-closed and detected

UNSUPPORTED v1 transition — branch or entry relocation
    1  WITHDRAW the locator record on main
    2  establish that resolution returns LOCATOR_UNRESOLVED
    3  ONLY THEN canonicalize the relocation
    4  remain without a record until option B exists
    the reverse order would leave a RESOLVED pointing at an abandoned
    location, with no verdict against it                            §5.2b
```

**Corrected after the eighth review.** This paragraph previously ended at *"the
work item leaves v1 support rather than acquiring a record whose failure mode is
silent"* — a true statement about the destination that said nothing about the
route, while the general rule directly above it ("after an adoption, the locator
record MUST be updated") reads as *canonicalize first* for every class. Taken
together they prescribed the unsafe order for exactly the class that cannot
survive it.

Q5 stays small, and no `WHAT` is pulled back into the locator: the record still
holds only location fields, and the adoption ruling still owns what the contract
says.

**The measured fixture, kept as a fixture and not as the rule.** For PR #52 /
`e5f74fe` specifically, only `canonicalSha` changed:

```
canonicalBranch     spec/hook-install-provenance      unchanged
canonicalSha        ae39cbe  ->  e5f74fe
authorityEntry      2026-08-18-hook-install-provenance-design.md   unchanged
```

The adopted amendment is deliberately NOT named in the record. It is reachable at
the new SHA, and under §4.2b enumerating the authority set is the authority
layer's question, not the locator's.

**Corrected after the fifth review.** This paragraph previously continued: *"the
whole locator delta for an adoption is therefore one field, which is also the
smallest thing that can be forgotten — and forgetting it produces LOCATOR_STALE,
not a silent wrong answer."* Both halves generalised PR #52. The delta is one
field **in that fixture**; the rule above is the tuple. And the consequence of
forgetting depends on which field was forgotten:

```
forgot canonicalSha, same declared branch advanced
    -> LOCATOR_STALE            detected, fail-closed

forgot canonicalBranch, authority migrated to another branch
    -> the declared branch never moved
    -> canonicalSha == its tip
    -> RESOLVED                 NOT detected                        §5.2a

forgot authorityEntry, new root adopted at the same branch
    -> the old entry still exists at the new SHA
    -> RESOLVED, rooted at a historical artifact                      §8
```

`LOCATOR_STALE` is what forgetting looks like in **one** of the three cases. It
is not a safety net for the other two, which is precisely why the adoption ruling
owns the whole tuple instead of a detector being trusted to catch omissions.

What must **not** appear anywhere in the record as a result of that adoption:

```
L3: CLOSED
ac12: amended
phase: WRITE_ISSUED
status: adopted
```

Every one of those is a value copied out of an authority document. The moment
the record holds a copy, it holds a copy that can go wrong on its own:

```
authority says X      registry says X       looks fine
authority says Y      registry still says X  looks fine too
```

The second line is the whole danger, and it is not hypothetical here: `main`'s
own planning IR says `plan:hook-install-provenance [draft] 0/8 tasks done`, and
the design doc's frontmatter at `e5f74fe` still says `status: draft` for a
document that is now the adopted canonical authority. Both are copies of `WHAT`
that drifted, and neither reports that it drifted.

```
registry owns WHERE
authority owns WHAT
```

The amendment chain itself needs no representation **in the record**. A consumer
that resolves `[hook-install-provenance]` gets `spec/hook-install-provenance @
e5f74fe` and the design root; it does not have to reconstruct that `e5f74fe`
amended `ae39cbe` which amended `a8c8986` in order to know where the contract
lives. That history is evidence, reachable in Git and recorded in the
amendment's own revision history.

**Corrected after the second review.** This paragraph previously said the
consumer *"gets `…@ e5f74fe` and both documents"*. Under the model as now frozen
that is false: the record holds one `authorityEntry`, and `§4.2b` establishes
that nothing today can tell the resolver the amendment belongs to the set. The
amendment is *reachable* at that SHA; it is not *delivered* by the resolution.
Which documents constitute the contract is gate `2` in `§7`, and it is
`UNRESOLVED`.

```
the chain          EVIDENCE
the resolver output  the RECORDED LOCATION ROOT, as observed
```

## 9. Q6 — proving the locator is navigation authority, not spec authority

Two structural properties, both checkable rather than asserted.

**A. Vocabulary containment.** The record schema admits exactly the frozen
`WHERE` fields: `workItem`, `canonicalBranch`, `canonicalSha`, `authorityEntry`.
Every other field is rejected. An unrecognised field is a record defect, not a
field to ignore — the same rule the `ac12` amendment just froze one layer down:

```
unclassified field    !=    harmless extra
```

**Corrected after the fourth review.** The test was previously written as *"any
field whose value could also be read out of an authority document"*, which does
not hold: an authority document may perfectly well mention a branch, a SHA or a
document path — this project's own amendment and merge records do. The criterion
is about the field's question, not about where its value may also appear:

```
does this FIELD answer WHERE, or WHAT?

a value being repeated inside an authority document
    does NOT change the field's ownership
```

**B. Falsifiability.** If the locator had quietly become the authority, deleting
the authority would leave the answer intact. So the required negative control is:

```
at a SHA where the declared authorityEntry is ABSENT
    the resolver must answer LOCATOR_INVALID
    and must NOT answer the design question

a locator that can still answer when its target is gone
    HAS become the authority
```

This is the same discipline as the mutation controls used elsewhere in this
project: the property is only meaningful if there is a state in which it fails.
Phase 1 freezes the property; the control is built when the resolver is, under
its own authorization.

## 10. The six closure questions, answered

```
Q1  who owns canonical-spec location — TWO questions, two owners       §3

   Q1a who AUTHORIZES a location transition
         the adoption ruling. It decides what the tuple becomes.

   Q1b who owns the PUBLISHED location state consumers query
         the locator document on main, one record per work item
         docs/authority/canonical-spec-authority.json
         schema docs/contracts/canonical-spec-authority.schema.md
         BOTH read from the same observed main SHA — the schema is an
         input to authoritative resolution, so it is bound too    §6.2

   the adoption ruling is NOT a parallel discovery source: it authorizes
   the next state, and consumers still resolve through the locator only
   NOT the spec frontmatter, backlog, planning IR, or PR text          §3
   and only transitions whose publication failure is detectable are
   v1-supported                                                     §5.2b

Q2  how a work item resolves uniquely
      exact-key lookup on the backlog work-item id, compared ASCII
      case-folded — a comparison rule the LOCATOR owns
      project-lifetime identity / non-reuse is an EXTERNAL UNRESOLVED
      dependency (§4.1b), NOT a rule this design adds, so locator
      uniqueness is mechanical only relative to the SUPPLIED identity
      -> canonicalBranch + canonicalSha + authorityEntry
      0 -> UNRESOLVED   1 -> verify   >1 -> CONFLICT, never a tiebreak
                                                            §4.1a §4.2 §4.3

Q3  what makes a locator stale / invalid / conflicting
      INVALID   branch/SHA/ancestry/authorityEntry check fails
      STALE     checks 1-4 pass; check 5 observes divergence — the branch
                advanced past the declared SHA
      CONFLICT  duplicate key under the folded identity — adjudicated
                after structural validation, never by the schema
                                                          §4.1a §5 §6.1a
      reachable != current; the tip is never the answer
      SHA==tip only means the OBSERVED refs do not diverge              §6.3
      and the tip check is evidence about the declared BRANCH, under a
      precondition the locator cannot verify: that branch advances only
      for adopted transitions OF THIS RECORD'S work item. A cross-branch
      migration stays undetectable, and a branch shared with other work
      items — main included — is UNSUPPORTED in v1                    §5.2a
      v1 therefore supports only the transition class whose failure to
      publish is detectable — same branch, SHA advances, entry
      unchanged; a relocation is unsupported, not merely risky       §5.2b

Q4  what a consumer must do on failure
      STOP, report the verdict, produce NO spec judgement
      every fallback enumerated and forbidden                        §5.3 §7
      and on SUCCESS: RESOLVED clears gate 1 of 4. Gates 0
      (work-item identity), 2 (authority-set completeness) and 3
      (ref freshness) are all UNRESOLVED, so a fresh reviewer still
      cannot mechanically establish the current complete contract
      — nor that the handle names the work item they intend         §7

Q5  how the pointer advances after an amendment
      the adoption RULING establishes the adopted WHERE tuple; the
      locator updates exactly the location fields whose adopted values
      changed. No field is immutable because the event is an amendment
      PR #52 fixture: canonicalSha only — a fixture, not the rule
      it copies no normative content; the chain stays evidence           §8

      TWO CLASSES, TWO ORDERS                                    §5.2b §8
      supported    canonicalize -> old record goes STALE -> publish tuple
      unsupported  WITHDRAW the record -> verify UNRESOLVED -> only then
                   canonicalize the relocation -> remain without a record
      v1 support ends when the withdrawal is published on main, not when
      the ruling is made and not when the relocation canonicalizes

Q6  how the locator is proved to be navigation, not spec, authority
      A vocabulary containment — location fields only
      B falsifiability — must answer INVALID when its entry is absent
      C source binding — DATA AND SCHEMA both read from the observed main
        SHA, never the ambient tree, so neither a proposed locator nor a
        proposed validator can impersonate an adopted one             §6.2
      verification proves locator INTEGRITY, and nothing beyond it:
        valid references != a complete authority set               §4.2b
        no divergence among observed refs != current               §6.3
        locator integrity != spec correctness                     §6.4 §9
```

## 11. Not decided here, and why

```
the resolver's implementation      Phase 2, separately authorized. Phase 1
                                   owes the model, not the mechanism.

work-item identity lifetime        §4.1b. NOT owned here, and deliberately
                                   not repaired here. Its absence is a named,
                                   undetectable failure mode of this design,
                                   and gate 0 of §7.

authority-set completeness         §4.2b. NOT owned here. Gate 2 of §7.

required ref freshness             §6.3. Whether a resolver must fetch, and
                                   how much currency evidence a given
                                   consumer needs, belong to that consumer's
                                   gate owner. Gate 3 of §7.

the schema's form                  §6.2 binds WHERE the schema is read from.
                                   Whether it is a file or frozen as code is
                                   open; either way its source must be named,
                                   never left ambient.

who writes the record, and when    ordinary reviewed PR to main at adoption
                                   time. No CLI in v1: automating a file
                                   nobody has written yet would fix a
                                   maintenance problem that does not exist.

work items with no canonical spec  most backlog items have none, and that is
                                   correct. Absence of a record is
                                   UNRESOLVED, which is an honest answer, not
                                   a gap to backfill. Under §5.2a the same
                                   now holds for authority hosted on a shared
                                   branch — [0ce0]'s matrix on main gets no
                                   v1 record, and UNRESOLVED is its honest
                                   answer too.

relocation transitions             §5.2b. Migrating canonicalBranch or
                                   changing authorityEntry stays a valid
                                   authority operation and is UNSUPPORTED by
                                   v1 discovery, because a partial or
                                   incorrect publication of the tuple returns
                                   RESOLVED with no verdict against it. The
                                   honest v1 handling is no record —
                                   UNRESOLVED — rather than a record whose
                                   failure mode is silent, and the WITHDRAWAL
                                   MUST BE PUBLISHED BEFORE the relocation
                                   canonicalizes. v1 support ends at that
                                   withdrawal's merge on main.

authority-transition evidence      §5.2a option B: independent evidence that
                                   an authority transition occurred, so that
                                   ordinary ref movement stops standing in
                                   for it. It would close both halves of the
                                   branch/authority gap and would support
                                   shared-branch hosting. A mechanism, not
                                   designed here, and the named successor to
                                   v1's scope limit.

the ten superpowers documents      out of scope. Whether they should carry
without id: spec: frontmatter      ids is a planning-IR question with its
                                   own owner; the locator does not key on
                                   slugs, so it is unaffected.

content digests                    §6. Rejected for v1 with a stated trigger
                                   for revisiting.

main's own stale statements        not rewritten. main@85f0c25's merge
                                   message and ae39cbe's "Still OPEN" were
                                   true when written, and history is not
                                   required to stay current. The locator is
                                   the place to ASK the question — it is not
                                   yet the place that can answer "what is
                                   authoritative NOW", because CURRENT is
                                   gate 3 and gate 3 is unresolved (§6.3).
```

## 12. Status

```
nature                    PHASE 1 DESIGN
design review             APPROVED / CLOSED — history in §13
design content            FROZEN @ 53ffd93
disposition               PARKED
implementation            NOT AUTHORIZED
main mutation             NOT AUTHORIZED — no record is created by this design
authority relocation      NOT AUTHORIZED and not proposed
[0ce0] Phase 2            NOT AUTHORIZED
```

**The dependency this work item was supposed to unblock is not unblocked by
closing it.** `§12` previously said `§6 A+B enforcement — blocked behind this
work item`, which reads as *this closes, that opens*. Under the model as frozen,
that is no longer true:

```
§6 A+B mechanical-enforcement design remains BLOCKED until

  a  WORK-ITEM IDENTITY is established                   §4.1b — UNRESOLVED
  b  the canonical locator ROOT is resolvable                    this design
  c  authority-set COMPLETENESS is established           §4.2b — UNRESOLVED
  d  the REF FRESHNESS evidence its reviewers require
     is established                                      §6.3 — UNRESOLVED
```

`a` is listed first and was absent from the previous revision. Without it, §12
would license starting a §6 review on the strength of a locator that resolved a
SHA correctly **for a handle that may no longer name the intended work item** —
gate `0` of §7, skipped at the dependency layer instead of the consumer layer.

`d` may turn out to be cheap: a ruling that `§6`'s reviewers need only observed
local refs would discharge it immediately. **That ruling is not made here.** It
belongs to whoever owns `§6`'s gate, and letting a consumer decide for itself how
much currency evidence it needs is the same delegation this document spent `§7`
removing.

The canonical design authority for `[hook-install-provenance]` remains
`spec/hook-install-provenance @ e5f74fe`, and this design moves nothing.

## 13. Revision history

```
87e72af   first Phase 1 design.

4a7c7ad   design review 1: CHANGES_REQUIRED, 3 Important + 1 Minor. All four
          fixed here. The reviewer named the shared pattern, and it is worth
          keeping in front of the next round:

            the design could already detect that a DECLARED thing is broken.
            It had not yet shown that the declared thing is ALL of it, is
            THAT identity, and came from the RIGHT source.

          Important 1 — KEY IDENTITY. §4.1 said "verbatim" and "exact-key"
          while offering only a popularity argument for the key. Measured in
          memory.service.js: resolveBacklog (:1879-1893) folds case and treats
          [abc]+[ABC] as ONE ambiguous identity, and the insert-time duplicate
          check (:1574-1575) does the same — so a verbatim locator would hold
          "0ce0" and "0CE0" as two records, answer one question twice, and
          never raise CONFLICT. Second hole: both rules are scoped to the
          CURRENT BACKLOG section, so nothing forbids reusing an id after its
          item leaves. A locator outlives the backlog line. §4.1a now states
          the contract this design ADDS rather than borrows: ASCII case-folded
          comparison identity, and project-lifetime non-reuse. Folding at
          comparison time is chosen over a write-time lowercase convention
          because a hand-written record cannot bypass it.

          Important 2 — COMPLETENESS. authorityArtifacts was a list, verified
          only for the existence of what it listed. An adoption that advances
          canonicalSha and forgets to append the new amendment passes every
          check and returns RESOLVED with a silently incomplete contract. The
          decisive question was the review's own — what independent fact tells
          the resolver an entry is missing? None. So the list is REMOVED, not
          supplemented with "remember to update it", which is the manual
          obligation this document exists to eliminate. It is also the same
          defect ac12's §6 froze one layer down: a fixed manifest is not
          coverage. §4.2 now declares one authorityEntry; §4.2b names the
          completeness authority UNRESOLVED, with the measured reason it
          cannot be faked (ae39cbe's frozen body cannot point forward at its
          own amendment; e5f74fe's amendment points backward via "amends"),
          and records the derived-set candidate WITHOUT granting the normative
          rule it would need. §4.2c narrows what RESOLVED may claim to
          "rooted at", not "complete".

          Important 3 — SOURCE AND FRESHNESS. "The locator lives on main"
          constrains where the file is written, not where a resolver reads.
          The natural implementation reads the ambient working tree, so a PR
          branch PROPOSING a new canonicalSha would impersonate the adopted
          locator before merge — §1 fact 2 reproduced in the new file. §6.2
          binds the source to main:<path> read from the ref, and declares any
          working-tree copy a proposal. §6.3 adds the evidence qualification
          the document was missing: SHA == tip proves only that the OBSERVED
          refs do not diverge, and both can be co-stale, so a resolution must
          report observedLocatorSha and observedCanonicalTipSha, and
          "local-ref freshness not established" is not "global currentness
          established". Whether a resolver must fetch is named as a separate
          question with its own owner and is not answered.

          Minor — §12 said "design review NOT YET PERFORMED", which stopped
          being true during the review that read it. Replaced with an
          indirection to this section, the same fix the ac12 amendment applied
          to its own §8.

          Scope held: no registry framework, no generic manifest system, no
          knowledge graph. Important 2 in particular invites one, and the
          answer taken instead was to shrink the claim to what can be
          verified and name the missing authority.

5c54b51   design review 2: CHANGES_REQUIRED, 3 Important + 0 Minor. All three
          fixed here. The review confirmed round 1's repairs held in
          direction, and found three places where the NARROWED model had not
          propagated to the bottom. Its framing is now recorded in §2: what
          looked like one problem is three layers — IDENTITY, LOCATION,
          COMPLETE+CURRENT — and only LOCATION is frozen here.

          Important 1 — IDENTITY AUTHORITY BOUNDARY. Round 1's repair froze
          project-lifetime id non-reuse as a rule "this design ADDS". The
          reasoning was right and the placement was not: that rule governs
          backlog creation, context insert, id allocation after resolve, and
          every consumer addressing anything by work-item id. A navigation
          spec does not get to annex the project's identity lifecycle because
          it needs it. The superseded clause read:

            "LIFETIME — a work-item id is a PROJECT-LIFETIME identity. Once
            used, it is never reused for a different work item, whether or
            not the original item is still in BACKLOG."

          §4.1a keeps the case-fold half — the locator's own comparison
          semantics over its own input, aligned with measured backlog
          behaviour. §4.1b demotes the lifetime half to
          WORK_ITEM_IDENTITY_AUTHORITY / UNRESOLVED, records two repair paths
          without choosing, and states the consequence rather than hiding it:
          until that authority exists, a reused id resolves to the retired
          item's authority and THE LOCATOR CANNOT DETECT IT. Isomorphic to
          §4.2b's handling of completeness:

            needing an authority != being allowed to impersonate it

          Applying that rule to completeness and violating it for identity,
          four sections apart, is the same failure shape round 1 caught.

          Important 2 — SOURCE FAILURE HAD NO VERDICT. §6.2 bound the source
          to main:<path>, but every check in §5.1/§6.1 began from "we already
          have a record". A missing ref, an absent file, unparseable JSON or a
          bad schema had no verdict, so the natural implementation reaches
          records = [] -> 0 keys -> LOCATOR_UNRESOLVED, asserting "this work
          item has no locator" on the strength of never having looked. §6.1a
          freezes the evaluation order — resolve ref, read, parse, validate
          the WHOLE document including §9's vocabulary containment, and ONLY
          THEN look up — and names LOCATOR_SOURCE_INVALID separately from
          LOCATOR_INVALID, because "the locator is unusable" and "this record
          is broken" are different facts for a consumer.

            unreadable locator != empty locator

          Important 3 — CONSUMER GATE. §4.2c narrowed RESOLVED to "rooted at"
          and §6.3 made it observed-ref-relative, but §7 still granted spec
          judgement on a single RESOLVED, and §8 still claimed a consumer
          "gets … and both documents" — false under the frozen model, since
          the record holds one authorityEntry and §4.2b establishes that
          nothing can tell the resolver the amendment belongs to the set. §7
          is now three gates with three owners: LOCATION (here, RESOLVED),
          AUTHORITY-SET COMPLETENESS (§4.2b, UNRESOLVED), REF FRESHNESS
          (§6.3, UNRESOLVED). §8's claim is corrected with its supersession
          recorded in place. §12 no longer says §6 A+B is "blocked behind this
          work item" — closing this one does not open that one — and lists the
          three conditions instead. The tempting shortcut, ruling that §6's
          reviewers need only observed local refs, is explicitly NOT taken
          here: it belongs to §6's gate owner, and letting a consumer decide
          its own currency requirement is the delegation §7 just removed.

52ea2ea   design review 3: CHANGES_REQUIRED, 3 Important + 0 Minor. All three
          fixed here. The review confirmed round 2's three repairs held, and
          found that none of them had been carried all the way to the
          consumption points. Its own summary of the remaining shape:

            upstream already demoted, downstream quietly upgraded it back.

          Important 1 — IDENTITY WAS NOT A GATE. §2 listed IDENTITY as its own
          layer and §4.1b had already stated that a reused id resolves to the
          retired item's authority undetectably — yet §7 still authorised spec
          judgement on three gates, none of them identity, and §12 listed
          three unblocking conditions for §6 A+B with identity absent. So
          gates 1-3 could each be perfect and the whole chain still answer
          about a different work item. §7 is now FOUR gates, with WORK-ITEM
          IDENTITY as gate 0 and the [3d78]-reuse chain written out; §12's
          conditions become a-d with identity first; §10's Q4 says "gate 1 of
          4"; §6.4 gains the boundary line "a resolved KEY != the intended
          WORK ITEM", noted as the one that invalidates every line below it
          when it fails.

          Important 2 — THE SCHEMA WAS AN UNBOUND INPUT. §6.1a had made
          whole-document schema validation a step of authoritative resolution,
          which makes the schema an INPUT to that resolution; §6.2 bound only
          the data. A feature branch carrying a proposal schema — allow
          unknown fields, relax a required field, widen a grammar — would have
          participated in validating main's adopted locator before that schema
          was itself adopted:

            authoritative data + proposal-time validator
                -> an authoritative-LOOKING resolution

          the same defect §6.2 had just eliminated, moved from the data to the
          validator. observedLocatorSha now owns BOTH main:<locator path> and
          main:<schema path>, read at the same observed SHA; a missing,
          unreadable or invalid schema is LOCATOR_SOURCE_INVALID and stops
          resolution before any lookup. If a future implementation freezes the
          schema as code, its authority and source must be named just as
          explicitly — the validator's provenance is part of the resolution's
          provenance.

          Important 3 — THE CLOSURE SUMMARY RESURRECTED A WITHDRAWN RULE. §10
          Q2 still read:

            "under a project-lifetime non-reuse rule this design ADDS"

          which is exactly the authority claim round 2 removed from §4.1b. §10
          is "the six closure questions, answered" and is the section a future
          reader is most likely to read alone, so this was not harmless
          leftover prose: the document carried two contradictory normative
          answers about who owns identity lifetime. Q2 now states that
          case-folding is the locator's own comparison rule, that
          project-lifetime identity is an external UNRESOLVED dependency, and
          that locator uniqueness is therefore mechanical only relative to the
          SUPPLIED identity.

          Method note, since this is the third round in a row where the
          finding was propagation rather than direction: this revision was
          made by first sweeping for every enumeration of gates, verdicts,
          dependencies and "this design owns/adds" claims, then editing — not
          by editing the three named spots. §6.4's identity line and §10's Q1
          and Q6-C schema-binding lines came from that sweep rather than from
          the review, as did §11's now-explicit list of the three unresolved
          dependencies — §11, like §10, is a section a reader may consult
          alone, and it had been silent about all three.

4bc0ed0   design review 4: CHANGES_REQUIRED, 3 Important + 1 Minor. All four
          fixed here. Round 3's repairs held, including the three the sweep
          found rather than the review. The reviewer gave the criterion for
          the next scan, and it is the right one:

            a fact TRUE OF THE CURRENT CASE written as a general rule, or
            a layer already marked UNRESOLVED used in a summary as settled.

          Important 1 — REPRESENTATION COULD DESTROY THE CONFLICT. §4.3 froze
          0/1/>1 -> UNRESOLVED/verify/CONFLICT over folded identities, but
          nothing froze how the document represents records. The natural JSON
          shape — an object keyed by workItem — makes { "0ce0", "0CE0" }
          visible only if the implementation re-folds keys itself, and makes
          { "0ce0", "0ce0" } disappear entirely, because many parsers apply
          last-one-wins BEFORE any validator runs. Two conflicting
          declarations go in and one comes out, so LOCATOR_CONFLICT becomes
          unreachable: the representation destroying the fact before the
          authority rule could adjudicate it. §4.3 now freezes one property —
          every authored record survives as a distinct element through parsing
          and whole-document validation, and duplicate workItem declarations
          remain observable until folded-identity conflict validation has run
          — and leaves the concrete shape open. §3 says locator DOCUMENT, not
          record, since the model plainly holds one record per work item.

          Important 2 — CURRENT WAS DEMOTED, THEN RE-CLAIMED FOUR TIMES. §6.3
          had made currentness an unresolved gate, and four higher-level
          places still asserted it: the title-row question ("its current
          canonical spec authority"), §4.2's "hand back the CURRENT pointer",
          §8's "the resolver output — CURRENT LOCATION ROOT", and §11's "the
          locator answers what is authoritative NOW". The header now carries
          both rows — the ORIGINAL question and the narrower one Phase 1
          actually answers — and says in as many words that the gap between
          them is the finding, not a shortfall. The other three are restated
          as recorded/observed rather than current. §2's decomposition also
          goes from three layers to FOUR, mapping one-to-one onto §7's four
          gates; three-layers-versus-four-gates was itself a leftover of the
          revision that introduced gate 0.

          Important 3 — A FIXTURE FROZEN AS A LAW. §8 said "the adoption event
          advances canonicalSha, and changes nothing else". True of PR #52,
          which is the only adoption that has happened, and wrong as a rule: a
          future adoption may root the authority at a NEW document, and under
          the old rule the locator would keep pointing at the old one, which
          still exists at the new SHA. Every check passes and the resolution
          is rooted at a historical artifact. The ownership was inverted —
          the locator does not decree which parts of a location may change.
          §8 now says the record MUST be updated to the ADOPTED location
          tuple, that only fields whose adopted location changed are changed,
          and that no field is immutable merely because the event is called an
          amendment. The measured PR #52 delta is kept, explicitly as a
          fixture rather than as the rule.

          Minor — §9's containment test read "any field whose value could also
          be read out of an authority document", which is false on its face:
          authority documents mention branches, SHAs and paths all the time —
          this project's own amendment and merge records do. The criterion is
          the field's question, not where its value may also appear: does this
          FIELD answer WHERE or WHAT. The admitted set was already exactly the
          four WHERE fields, so nothing changed but the justification.

          Found by the pre-edit sweep rather than by the review, under the
          same second criterion: §5.2 opened "Adoption happens on the spec
          branch; the locator lives on main", generalising the current
          topology. A work item already rooted on main — [0ce0]'s matrix — could
          be canonicalized and re-pointed in one commit and have no window at
          all. Restated as a condition, with a note that the verdicts do not
          depend on which case applies.

7d01e15   design review 5: CHANGES_REQUIRED, 3 Important + 3 Minor. All six
          fixed here. Round 4's repairs held. Important 1 is the first
          finding since round 1 that is a MODEL boundary rather than
          propagation residue, and it is the deepest one in the document.

          Important 1 — THE STALE DETECTOR WAS WATCHING GIT, NOT AUTHORITY.
          The divergence check compares canonicalSha against the tip of
          canonicalBranch — a fact about a REF — and feeds a verdict about
          AUTHORITY. That is sound only under a biconditional nothing had
          frozen, and both halves fail:

            FALSE STALE     main advances for an unrelated PR; the entry is
                            untouched; no ruling occurred -> LOCATOR_STALE
                            forever. Fail-closed, so it never lies, but a
                            record on a shared branch expires on the next
                            push — and the tempting repair, advancing
                            canonicalSha to restore green, manufactures a
                            canonical location no adoption ever established,
                            which §8 forbids.

            FALSE RESOLVED  authority migrates spec/A -> spec/B; spec/A stays
                            at its tip; the locator is not updated ->
                            canonicalSha == tip -> RESOLVED, rooted at an
                            abandoned location, every check green.

            Git branch movement != authority movement
            observation != fact, one layer down from where this project
            usually meets it.

          §5.2a freezes option A/C from the review as one clause: canonicalBranch
          MUST be an AUTHORITY-EXCLUSIVE ref, and the consequence is a v1 scope
          limit — authority hosted on a shared branch, [0ce0]'s matrix on main
          included, is UNSUPPORTED, with UNRESOLVED as its honest answer. Two
          things are named rather than smoothed: the precondition is DECLARED
          and unverifiable by the locator, the same standing as gate 0's
          identity assumption; and exclusivity closes only the FALSE STALE half
          — a cross-branch migration remains undetectable, a second named
          undetectable failure mode of the LOCATION layer. Option B, independent
          authority-transition evidence, is recorded in §11 as the named
          successor rather than as a gap. Propagated to §2, §6.1 check 5, §6.4
          ("a moved BRANCH != a moved AUTHORITY"), §10 Q3, §11.

          Important 2 — THE CONFLICT FACT DIED ONE STEP LATER. Round 4 made
          duplicate records survive the parser; §4.2 still called folded
          uniqueness a property of the record, so a natural whole-document
          schema would reject duplicates at step 4 and return
          LOCATOR_SOURCE_INVALID — leaving LOCATOR_CONFLICT unreachable again,
          consumed by the validator instead of the parser. §6.1a now splits
          the two questions: structural/schema validity MUST NOT adjudicate
          folded-identity multiplicity, which step 5 owns.

            the schema preserves the FACT
            the resolver assigns the MEANING

          One question, one authority: a schema that rejected duplicates would
          be a second adjudicator, and then LOCATOR_CONFLICT should not exist.
          This design keeps the verdict, so the schema does not decide it.
          §4.2's wording is corrected at the source.

          Important 3 — THE ONE-FIELD DELTA CAME BACK. §8's first half had been
          corrected to the tuple rule, and two paragraphs later still said "the
          whole locator delta for an adoption is therefore one field ... and
          forgetting it produces LOCATOR_STALE"; §10 Q5 still said "adoption
          advances canonicalSha, and that is the entire delta". Both restated.
          The second half also mattered on its own: forgetting canonicalSha is
          detected, but forgetting canonicalBranch (§5.2a) or authorityEntry
          (§8) both return RESOLVED. STALE is a safety net for one of the three
          cases, which is exactly why the adoption ruling owns the whole tuple
          instead of a detector being trusted to catch omissions.

          Minors — §5.1's LOCATOR_CONFLICT sentence was truncated mid-clause;
          §7 still said the design uncovered "two dependencies" when identity,
          completeness and freshness make three; §10 Q1 still said "one locator
          record on main" one round after §3 was corrected to DOCUMENT.

4f17747   design review 6: CHANGES_REQUIRED, 3 Important + 1 Minor. All four
          fixed here. Round 5's repairs held. This round is boundary cleanup
          rather than new mechanism: who owns the state, who authorizes the
          transition, and which question a verdict actually answers.

          Important 1 — EXCLUSIVE TO WHAT. §5.2a required canonicalBranch to
          be authority-exclusive, worded as advancing only for adoptions "for
          its work items" — which lets one branch carry several. Then every
          commit on it can be a genuine adoption and the detector still lies:

            spec/shared holds authority for A and B; A declares T1
            B receives a legitimate adoption, spec/shared T1 -> T2
            A's authority untouched
            A resolves: T1 != tip T2 -> LOCATOR_STALE

            authority-only branch != work-item-authority-only branch

          The precondition is now quantified PER RECORD: R.canonicalBranch
          MUST advance only for an adopted authority-location transition of
          R.workItem. It does not forbid one branch from physically hosting
          several documents; it means a branch shared between work items
          cannot satisfy the precondition for more than one of them — the same
          reason main satisfies it for none. Propagated to §2 and §10 Q3.

          Important 2 — RESOLVED WAS SPENDING GATE 0. §4.2c and §6.4 still
          said "this work item's authority is ROOTED at …", which asserts that
          the supplied key names the work item the caller intends — the exact
          fact §4.1b marks UNRESOLVED, and the exact substitution §6.4's own
          first boundary line forbids. RESOLVED is a RECORD-RESOLUTION
          verdict and does not get to become an identity verdict. It now says:
          for the SUPPLIED KEY, exactly one record matched under the locator's
          folded-key semantics, and that record declares the location root
          relative to the observed refs — and it lists what it does NOT
          establish, gate by gate. §6.4's green-resolution sentence follows.

          Important 3 — STATE AUTHORITY vs TRANSITION AUTHORITY. §3's "and
          nothing else" and §8's "the adoption ruling decides the adopted
          WHERE tuple" are each correct and, read together, look like two
          competing WHERE authorities. The split is now explicit in §3: the
          adoption ruling is the TRANSITION authority — it authorizes the next
          location state; the locator document on main is the STATE authority
          — it is the published state consumers query. Between the ruling and
          the locator PR they disagree, and the licensed reading is that the
          published state is the old tuple and is stale or wrong, with NO
          fallback to the ruling, the adoption PR, or the merge commit:

            the adoption ruling is NOT a parallel discovery source

          Without that, the project would hold two answers to "where is the
          authority" and a consumer would pick — the failure §5.3 already
          forbids for PR text, arriving through the front door instead. §8
          carries a pointer back, since it is readable alone.

          Minor — §5.1 defined LOCATOR_STALE as "every §6 check passes, but
          the branch has advanced", while §6.1 check 5 IS the divergence test,
          so not every check passes. Both RESOLVED and LOCATOR_STALE now say
          checks 1-4 pass and state what check 5 observed.

a973516   design review 7: CHANGES_REQUIRED, 2 Important + 4 Minor. All six
          fixed here. Round 6's repairs held. Both Importants sat on one
          edge — TRANSITION authority to PUBLISHED state — which §3 had just
          made visible enough to expose the last structural gap.

          Important 1 — A NAMED FAILURE IS NOT A SCOPE RULING. §3 separates
          who DECIDES a location change from who PUBLISHES it, and §8 lets a
          ruling change the whole tuple. Together those permit:

            the ruling legitimately establishes a NEW location
            the locator PR has not landed
            the resolver returns RESOLVED, rooted at the OLD location
            the consumer is FORBIDDEN to consult the ruling

          Earlier rounds named the two undetectable relocations and stopped
          there. Naming leaves the transition INSIDE the supported set, so the
          document was promising support for something it cannot observe going
          wrong:

            a known false-RESOLVED transition class
            cannot simultaneously be a SUPPORTED v1 transition class

          §5.2b takes option A: the supported set is defined by detectability
          of its PUBLICATION FAILURE — same canonicalBranch, canonicalSha
          advances, authorityEntry unchanged, so an unpublished update falls
          behind the tip and is caught as LOCATOR_STALE. Branch relocation and
          entry relocation stay valid AUTHORITY operations and become
          unsupported v1 DISCOVERY transitions; the honest handling is no
          record at all — UNRESOLVED, which a consumer can act on — rather
          than a record whose failure mode is silent. It forbids no authority
          operation; it stops claiming an observation the design does not
          have. Bound into §8's tuple rule, and propagated to §2, §10 Q3, §11.
          [hook-install-provenance] @ e5f74fe is unaffected: ae39cbe ->
          e5f74fe on one branch with the entry unchanged is exactly the
          supported class — which is also why that fixture proved nothing
          about the other two.

          Important 2 — §10 Q1 RE-COLLAPSED THE SPLIT. One round after §3
          separated transition authority from published-state authority, Q1
          still answered "who owns canonical-spec location" with the locator
          alone. §10 is designed to be consumed on its own, so a reader of it
          would carry away a model §3 and §8 had already replaced. Q1 is now
          Q1a (who AUTHORIZES a transition — the adoption ruling) and Q1b (who
          owns the PUBLISHED state consumers query — the locator document),
          with the not-a-parallel-discovery-source clause and a pointer to
          §5.2b. This is the fourth round in which the body text was corrected and a
          summary section kept the old model; §10 and §11 are now checked
          explicitly in every sweep.

          Minors — §3 said "the published CURRENT location state", spending
          gate 3 in the same sentence that defines the state authority;
          "currently" now qualifies the publication, not the location's truth.
          §5.2's "the window becomes detectable" claimed more than §5.2a and
          §5.2b leave standing; it now names the same-declared-branch class it
          actually covers and points at the relocation class it does not. §10
          Q3 still carried "all checks pass but the branch advanced", the
          exact wording §5.1 had been corrected away from one round earlier.
          And §5.1's UNRESOLVED and CONFLICT still spoke of "this work item"
          while RESOLVED had already been reworded to the SUPPLIED KEY — all
          three verdicts are now symmetric, because the locator does not own
          "the supplied key names the intended work item".

this      design review 8: CHANGES_REQUIRED, 1 Important + 2 Minor. All three
          fixed here.

          Important — THE RIGHT DESTINATION BY THE WRONG ROUTE. §5.2b said the
          honest handling of an unsupported relocation is to leave the work
          item without a record, which is the correct END STATE and says
          nothing about how to reach it. Meanwhile §8's general rule reads
          "after an adoption, the locator record MUST be updated", i.e.
          canonicalize first. For a relocation those combine into the exact
          window §5.2b exists to close:

            1  the relocation canonicalizes; authority is now spec/B @ SHA_B
            2  the old record is removed from main, later

            between 1 and 2: the record still says spec/A @ SHA_A, spec/A
            never moved so SHA_A IS still its tip -> RESOLVED, rooted at an
            abandoned location — and §3 forbids the consumer from consulting
            the ruling that would have told it otherwise

          The design would have manufactured that state by following its own
          protocol. §5.2b now freezes the order — WITHDRAW the record, verify
          UNRESOLVED, only then canonicalize, remain without a record — and §8
          forks explicitly, because only the same-branch SHA advance has a
          verdict for its own omission and may therefore canonicalize first.
          §10 Q5 carries the fork.

            withdraw first, then move    NOT    move first, then clean up

          The project has paid for the other order before: do not enter a
          state the detector cannot recognise and rely on a later step to
          erase the window.

          Minor 1 — §5.2b disqualified relocations because "an unpublished
          update returns RESOLVED". True for a branch relocation; too narrow
          for an entry relocation, where publishing NOTHING while the branch
          advances is actually detected as STALE, and the dangerous case is
          publishing canonicalSha while OMITTING the new entry. The
          disqualifying property is partial or incorrect publication of the
          tuple, not merely its absence — the counterexample §8 already
          carried and this clause had failed to match. §11 syncs.

          Minor 2 — "the work item leaves v1 support" had no event attached.
          Bound to a Git event so there is nothing to interpret: v1 support
          ends when the WITHDRAWAL is published on main — not when the ruling
          authorizes the relocation (the ruling is not a discovery source),
          and not when the relocation canonicalizes (by then the record must
          already be gone).

terminal  terminal disposition only.

          Independent closure review accepted the Review 8 repairs.
          Design semantics remain frozen at 53ffd93; this entry changes no
          model, boundary, protocol or rationale.

          PHASE 1 DESIGN     APPROVED / FROZEN
          work item          PARKED
          implementation     NOT AUTHORIZED

          No design reopening and no additional findings review is authorized
          by this disposition.

          (Marked "terminal" rather than by SHA: an entry cannot carry the
          hash of the commit that introduces it. §12 carries the design-content
          freeze SHA, which is the one that matters.)
```
