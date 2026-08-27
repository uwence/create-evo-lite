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
      -> expected authority artifact(s)

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
key    the backlog work-item id, verbatim and without brackets
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

### 4.2 The record

Minimum shape, and it is minimum by argument:

```
workItem            string, unique across the file
canonicalBranch     string, a full branch name
canonicalSha        string, 40-hex
authorityArtifacts  non-empty list of repo-relative paths, expected to exist
                    at canonicalSha
```

Four fields, each earning its place:

```
workItem            the lookup key. Without it there is no lookup.
canonicalBranch     Q3 cannot detect divergence without a declared branch to
                    compare the SHA against.
canonicalSha        the whole point. A branch name alone is a moving target,
                    and resolving to a tip is explicitly forbidden.
authorityArtifacts  without it, "the SHA verified" says nothing about whether
                    the documents a consumer needs are actually there.
                    Measured need: [hook-install-provenance]'s authority is
                    TWO documents — the design and the adopted amendment.
```

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

Resolution is a **lookup by exact key**. Not a glob, not a prefix match, not a
substring search over titles. This project has already paid for substring
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

```
RESOLVED
    exactly one record; every §6 check passes; and the declared SHA is the
    tip of the declared branch — no divergence detected

LOCATOR_STALE
    exactly one record; every §6 check passes; but the declared branch has
    advanced beyond the declared SHA.
    MEANING: a canonicalization event may have occurred without the locator
    being updated.
    NOT MEANING: use the tip.

LOCATOR_INVALID
    the declared branch does not exist, or the SHA does not exist, or the SHA
    is not an ancestor of the declared branch, or a declared artifact is
    absent at that SHA

LOCATOR_UNRESOLVED
    no record for this work item

LOCATOR_CONFLICT
    more than one record claims this work item
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

At resolution time, against the declared record:

```
1  the declared branch exists
2  the declared SHA exists as a commit
3  the declared SHA is an ancestor of the declared branch
4  every declared artifact exists at that SHA
5  divergence: declared SHA == branch tip, or not
```

`1`–`4` failing yields `LOCATOR_INVALID`. `5` distinguishes `RESOLVED` from
`LOCATOR_STALE`. Check `3` is what makes `canonicalBranch` load-bearing rather
than decorative: without it a record could name any reachable commit in the
repository and pass.

**The boundary, stated as a rule:**

```
verification proves LOCATOR INTEGRITY
      !=
verification proves SPEC CORRECTNESS
```

A green resolution says: *this work item's authority is that document set, at
that commit, on that branch.* It says nothing about whether the spec is right,
complete, current in substance, or adopted. Those questions belong to the
authority documents and to the human gates that ratify them.

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
authorityArtifacts  + 2026-08-27-l3-ac12-chmod-authority-amendment.md
```

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
`workItem`, `canonicalBranch`, `canonicalSha`, `authorityArtifacts`. Any field
whose value could also be read out of an authority document is out of vocabulary
and rejected. An unrecognised field is a record defect, not a field to ignore —
the same rule the `ac12` amendment just froze one layer down:

```
unclassified field    !=    harmless extra
```

**B. Falsifiability.** If the locator had quietly become the authority, deleting
the authority would leave the answer intact. So the required negative control is:

```
at a SHA where a declared artifact is ABSENT
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
      exact-key lookup on the backlog work-item id
      -> canonicalBranch + canonicalSha + authorityArtifacts
      0 -> UNRESOLVED   1 -> verify   >1 -> CONFLICT, never a tiebreak  §4

Q3  what makes a locator stale / invalid / conflicting
      INVALID   branch/SHA/ancestry/artifact check fails
      STALE     all checks pass but the branch advanced past the SHA
      CONFLICT  duplicate key
      reachable != current; the tip is never the answer                 §5

Q4  what a consumer must do on failure
      STOP, report the verdict, produce NO spec judgement
      every fallback enumerated and forbidden                        §5.3 §7

Q5  how the pointer advances after an amendment
      adoption advances canonicalSha and extends authorityArtifacts
      it copies no normative content; the chain stays evidence           §8

Q6  how the locator is proved to be navigation, not spec, authority
      A vocabulary containment — location fields only
      B falsifiability — must answer INVALID when its target is absent
      verification proves locator integrity, not spec correctness     §6 §9
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
design review             NOT YET PERFORMED
implementation            NOT AUTHORIZED
main mutation             NOT AUTHORIZED — no record is created by this design
authority relocation      NOT AUTHORIZED and not proposed
§6 A+B enforcement        blocked behind this work item
[0ce0] Phase 2            NOT AUTHORIZED
```

The canonical design authority for `[hook-install-provenance]` remains
`spec/hook-install-provenance @ e5f74fe`, and this design moves nothing.
