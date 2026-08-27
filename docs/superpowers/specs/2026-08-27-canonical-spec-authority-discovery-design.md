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
    LOCATOR_UNRESOLVED / STALE / INVALID / CONFLICT
    never falls back to
        a copy on main
        the newest-looking document
        a branch tip guess
        historical PR text
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

### 4.1a The key contract this design must ADD

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

So the key contract is stated here, as an **addition this design owns** rather
than a property borrowed from the backlog contract:

```
IDENTITY
    comparison identity = the ASCII case-folded work-item id
    the record MAY store the original spelling; comparison NEVER uses it
    two records whose folded ids are equal are ONE key -> LOCATOR_CONFLICT

LIFETIME
    a work-item id is a PROJECT-LIFETIME identity. Once used, it is never
    reused for a different work item, whether or not the original item is
    still in BACKLOG.
```

The lifetime clause is a **new constraint on the project**, not a restatement.
It is recorded as such, and it is the reason this design cannot simply defer to
the backlog contract: that contract answers *"which BACKLOG line does this id
name right now"*, and the locator asks *"which work item does this id name,
ever"*. Two different questions.

`ASCII case-folded` is chosen over `canonical lowercase at write time` because
folding at comparison time cannot be bypassed by a hand-written record, whereas a
write-time convention is enforced only by whoever edits the file. Every measured
id is ASCII today; a non-ASCII id would need its own folding ruling, and this
design does not grant one — a record whose id is not ASCII is a record defect.

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

LOCATOR_UNRESOLVED
    no record for this work item

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

### 6.2 Where the locator is READ FROM — source binding

**Added after independent review.** The first version said the locator *"lives on
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

and, after the two corrections above:

declared references are VALID
      !=
the declared authority set is COMPLETE          §4.2b
no divergence among OBSERVED refs
      !=
the pointer is CURRENT                          §6.3
```

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

```
Any consumer about to perform
    spec compliance review
    implementation planning against a spec
    amendment drafting
    any other judgement that presupposes knowing what the contract says

MUST first obtain a RESOLVED resolution for the work item.

On any of UNRESOLVED / STALE / INVALID / CONFLICT the consumer STOPS,
reports the verdict, and produces NO spec judgement.
```

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

The amendment chain itself needs no representation. A consumer that resolves
`[hook-install-provenance]` gets `spec/hook-install-provenance @ e5f74fe` and
both documents. It does not need to understand that `e5f74fe` amended `ae39cbe`
which amended `a8c8986` in order to know what the contract says — that history is
evidence, reachable in Git and recorded in the amendment's own revision history.

```
the chain          EVIDENCE
the resolver output  CURRENT POINTER
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
      NOT the spec frontmatter, backlog, planning IR, or PR text        §3

Q2  how a work item resolves uniquely
      exact-key lookup on the backlog work-item id, compared ASCII
      case-folded, under a project-lifetime non-reuse rule this design ADDS
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

Q5  how the pointer advances after an amendment
      adoption advances canonicalSha, and that is the entire delta
      it copies no normative content; the chain stays evidence           §8

Q6  how the locator is proved to be navigation, not spec, authority
      A vocabulary containment — location fields only
      B falsifiability — must answer INVALID when its entry is absent
      C source binding — read from main:<path>, never the ambient tree,
        so a proposed locator cannot impersonate an adopted one       §6.2
      verification proves locator INTEGRITY, and nothing beyond it:
        valid references != a complete authority set               §4.2b
        no divergence among observed refs != current               §6.3
        locator integrity != spec correctness                     §6.4 §9
```

## 11. Not decided here, and why

```
the resolver's implementation      Phase 2, separately authorized. Phase 1
                                   owes the model, not the mechanism.

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
§6 A+B enforcement        blocked behind this work item
[0ce0] Phase 2            NOT AUTHORIZED
```

The canonical design authority for `[hook-install-provenance]` remains
`spec/hook-install-provenance @ e5f74fe`, and this design moves nothing.

## 13. Revision history

```
87e72af   first Phase 1 design.

this      design review 1: CHANGES_REQUIRED, 3 Important + 1 Minor. All four
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
```
