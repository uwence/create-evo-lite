---
id: spec:canonical-spec-authority-discovery
status: draft
created: 2026-08-27
---

# Canonical spec authority discovery — Phase 1 design

**Nature: `PHASE 1 DESIGN`.** Not an implementation authorization. It answers one
question and freezes the model needed to answer it. No resolver is built here, no
file is created on `main` here, and no authority moves anywhere.

| | |
|---|---|
| work item | `canonical spec amendment discoverability` |
| baseline | `main` @ `85f0c25` |
| authorized | Phase 1 design only |
| the question | **From `main`, how does a reader resolve a work item to its current canonical spec authority, mechanically and uniquely?** |

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

**Discoverability turned out to be three layers, not one.** The reviews found
this by finding it broken twice; it is recorded here so the next reader starts
from it rather than rediscovering it:

```
IDENTITY      which work item does this handle name, ever          §4.1a §4.1b
LOCATION      where is that work item's authority rooted            this design
COMPLETE      which documents constitute the contract, as of when   §4.2b §6.3
+ CURRENT

only LOCATION is frozen here. Compressing the other two back into it would
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

**A single locator record on `main`, and nothing else.** Proposed:

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
workItem            string, unique under §4.1a's folded identity
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

```
RESOLVED MEANS
    this work item's authority is ROOTED at <authorityEntry>, at
    <canonicalSha>, on <canonicalBranch>

RESOLVED DOES NOT MEAN
    that entry is the complete contract
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
                    is to hand back the CURRENT pointer, not to make consumers
                    reconstruct it. Recording the chain would put a second,
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
    exactly one record; every §6 check passes; and the declared SHA is the
    tip of the declared branch — no divergence detected AMONG THE OBSERVED
    REFS. Scoped by §4.2c: rooted at, not complete.

LOCATOR_STALE
    exactly one record; every §6 check passes; but the declared branch has
    advanced beyond the declared SHA.
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
    the locator document was read and validated, and it holds no record for
    this work item

LOCATOR_CONFLICT
    more than one record whose folded id (§4.1a) equals this work item's
```

### 5.2 Why `LOCATOR_STALE` is a success of the design, not a wart

Adoption happens on the spec branch; the locator lives on `main`. Between the
canonicalization merge and the locator PR there is a window in which the record
names a superseded SHA. That window is real and it will happen.

The design's claim is not that the window is eliminated. It is that the window
becomes **detectable**:

```
today     the divergence is invisible; a consumer reads whatever it finds
after     the divergence has a name, a verdict, and a stop
```

Compare against the alternative that looks more convenient: resolving to the
branch tip closes the window and destroys the guarantee, because it makes any
push to the spec branch silently redefine the authority. That is
`branch tip guess`, and it is forbidden.

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
5  ONLY THEN look up the work item under §4.1a's folded identity

any failure in 1-4        ->  LOCATOR_SOURCE_INVALID
a valid document, 0 keys  ->  LOCATOR_UNRESOLVED
```

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

and, after the corrections across three reviews:

a resolved KEY
      !=
the intended WORK ITEM                          §4.1b
declared references are VALID
      !=
the declared authority set is COMPLETE          §4.2b
no divergence among OBSERVED refs
      !=
the pointer is CURRENT                          §6.3
```

The first line is the one a reader is most likely to skip, and it is the one
that invalidates all the others when it fails: everything below it is a true
statement about whatever work item the key actually named.

A green resolution says: *this work item's authority is rooted at that document,
at that commit, on that branch, as observed at those two ref SHAs.* It says
nothing about whether the spec is right, complete in substance, or adopted, and
nothing about documents beyond the entry. Those questions belong to the authority
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
uncovering two dependencies that were previously invisible because nothing had
ever tried to resolve authority mechanically. Compressing all three back into one
`RESOLVED` would manufacture exactly the false certainty this work item exists to
remove.

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

**The adoption event advances `canonicalSha`, and changes nothing else.**

For `[hook-install-provenance]`, the whole update is:

```
canonicalBranch     spec/hook-install-provenance      unchanged
canonicalSha        ae39cbe  ->  e5f74fe
authorityEntry      2026-08-18-hook-install-provenance-design.md   unchanged
```

The adopted amendment is deliberately NOT named in the record. It is reachable at
the new SHA, and under §4.2b enumerating the authority set is the authority
layer's question, not the locator's. The whole locator delta for an adoption is
therefore **one field**, which is also the smallest thing that can be forgotten
— and forgetting it produces LOCATOR_STALE, not a silent wrong answer.

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
the resolver output  CURRENT LOCATION ROOT
```

## 9. Q6 — proving the locator is navigation authority, not spec authority

Two structural properties, both checkable rather than asserted.

**A. Vocabulary containment.** The record schema admits location fields only:
`workItem`, `canonicalBranch`, `canonicalSha`, `authorityEntry`. Any field
whose value could also be read out of an authority document is out of vocabulary
and rejected. An unrecognised field is a record defect, not a field to ignore —
the same rule the `ac12` amendment just froze one layer down:

```
unclassified field    !=    harmless extra
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
Q1  who owns canonical-spec location
      one locator record on main
      docs/authority/canonical-spec-authority.json
      schema docs/contracts/canonical-spec-authority.schema.md
      BOTH read from the same observed main SHA — the schema is an
      input to authoritative resolution, so it is bound too      §3 §6.2
      NOT the spec frontmatter, backlog, planning IR, or PR text        §3

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
      STALE     all checks pass but the branch advanced past the SHA
      CONFLICT  duplicate key under the folded identity            §4.1a §5
      reachable != current; the tip is never the answer
      and SHA==tip only means the OBSERVED refs do not diverge         §6.3

Q4  what a consumer must do on failure
      STOP, report the verdict, produce NO spec judgement
      every fallback enumerated and forbidden                        §5.3 §7
      and on SUCCESS: RESOLVED clears gate 1 of 4. Gates 0
      (work-item identity), 2 (authority-set completeness) and 3
      (ref freshness) are all UNRESOLVED, so a fresh reviewer still
      cannot mechanically establish the current complete contract
      — nor that the handle names the work item they intend         §7

Q5  how the pointer advances after an amendment
      adoption advances canonicalSha, and that is the entire delta
      it copies no normative content; the chain stays evidence           §8

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
                                   a gap to backfill.

the ten superpowers documents      out of scope. Whether they should carry
without id: spec: frontmatter      ids is a planning-IR question with its
                                   own owner; the locator does not key on
                                   slugs, so it is unaffected.

content digests                    §6. Rejected for v1 with a stated trigger
                                   for revisiting.

main's own stale statements        not rewritten. main@85f0c25's merge
                                   message and ae39cbe's "Still OPEN" were
                                   true when written. The locator answers
                                   "what is authoritative NOW"; history is
                                   not required to stay current.
```

## 12. Status

```
nature                    PHASE 1 DESIGN
design review             disposition recorded in §13
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

this      design review 3: CHANGES_REQUIRED, 3 Important + 0 Minor. All three
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
```
