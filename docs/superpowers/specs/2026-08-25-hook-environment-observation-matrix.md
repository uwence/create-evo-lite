# `[0ce0]` verify-hook-runtime-health — environment and observation matrix

**Nature: `DRAFT / FROZEN-BY-STEP`.** This is not an approved spec amendment and
not an implementation authorization. Each step is ratified by a human ruling and
then frozen; later steps **append only** and never rewrite an earlier definition.

**Not yet entered:** health interpretation. Nothing in this document says whether
any observation is acceptable, expected, or actionable.

| | |
|---|---|
| work item | `[0ce0] verify-hook-runtime-health` |
| prerequisite | `[hook-install-provenance]`, Tasks 1–8 accepted, PR #49 |
| baseline | `1f9c44b` |
| branch | `spec/0ce0-hook-environment-observation-matrix` — deliberately NOT `feat/hook-install-provenance`, whose scope is frozen |

## The ordering this document obeys

Ratified before any step began, and not skippable:

```
1 freeze environments      2 freeze observable facts    3 freeze observation semantics
4 identify health authority 5 only then define verification consequence
6 only then discuss implementation
```

The three layers stay separate:

```
Topology classification   ->   Observation   ->   Health interpretation
     where is the target        what can be         is this acceptable
     and who can own it         established
```

The danger this ordering exists to prevent is that a measurement system quietly
becomes a judging system. That collapse is **invisible**: a system that
adjudicates still emits plausible output, never goes red, and therefore cannot be
discovered by running it. The defence is the ordering itself — the health
authority must be named in step 4 *before* step 5 defines a consequence, or step
5 will appear to follow "naturally" from step 2 with nobody able to see it happen.

## Governing invariants, inherited

> **A failure to OBSERVE must never impersonate a change in FACT.**
>
> Corollary: **one question, one authority.**

---

# Step 1 — FROZEN: the row set

Ratified. `Topology = 5 states`. A row is an observable topological relationship,
not a deployment context.

| row | definition |
|---|---|
| `R1 IN-SCOPE` | Git administration exists and the target is within the observable scope |
| `R2 NESTED-TARGET` | the target lies inside a larger Git-administered scope; owner and enclosing worktree must be distinguished |
| `R3 NO-GIT-ADMIN-TOPOLOGY` | no Git administrative container; no hook administration can be claimed |
| `R4 SCOPE-UNRESOLVED` | scope cannot be reliably determined |
| `R5 OWNER-UNRESOLVED` | owner cannot be reliably determined |

## What the originally-named five "environments" became

The work item was opened naming five environments. Four of them are not rows:

```
real git working copy   -> R1
CI checkout             -> R1     same row; the difference is only whether we
                                  can observe, never what was promised
npm pack / scaffold     -> R3     a packed artifact carries no .git
child project           -> R2 when nested, R1 when standalone
no .git/hooks           -> NOT A ROW. It is an OBSERVATION on R1:
                                  the repository is there, the administrative
                                  directory is not
```

`CI checkout` is not observationally distinguishable from a real working copy by
any Git or filesystem fact — only by ambient environment variables. Keying a row
off an ambient signal would let a *missing variable* change the verdict, which is
the governing invariant violated through a side door.

## Why the two unresolved states are rows

Neither appeared in the original five. They are not damaged versions of normal
environments; they are the states where the governing invariant is under the most
pressure. Without them every query failure is forced into a normal row, and that
row's rules answer on its behalf:

```
git query failed  ->  assume no git admin  ->  R3      FORBIDDEN
```

## The expectation axis does not live in the rows

Ratified in step 1 and carried forward. Three axes, kept apart:

| axis | question | values |
|---|---|---|
| topology | where is the target and who can own it | the 5 rows above |
| document state | what can be observed about provenance | `ABSENT` / `UNOBSERVABLE` / `VALID` |
| participation | what did the producer declare | `participating` / `non-participating` |

Explicitly frozen as three different things:

```
UNOBSERVABLE   the document cannot be safely judged      (read / validation)
ABSENT         the document does not exist               (filesystem observation)
non-participating   the document declares non-participation   (declaration)
```

Any merge of the first two into the third is observation failure masquerading as
fact.

---

# Step 2 — FROZEN: the observation matrix

## 2.1 The three-value model

```
OBSERVED_TRUE     the fact holds
OBSERVED_FALSE    the fact is POSITIVELY ESTABLISHED not to hold
UNRESOLVED        the fact could not be established
```

`UNRESOLVED` is not `OBSERVED_FALSE`. Forbidden transitions, all of them:

```
UNRESOLVED    ->  NO-GIT
UNOBSERVABLE  ->  ABSENT
UNRESOLVED    ->  OBSERVED_FALSE
query failed  ->  missing
```

## 2.2 Observation binds to the fact's owner

The authority column answers *"who can answer this question?"* — never *"who
wants the answer?"* The health layer consumes facts; it never produces them.

## 2.3 The matrix

| topology | observable fact | authority | observation domain |
|---|---|---|---|
| `R1` | git scope identity | git probe | confirmed / unresolved |
| `R1` | owner git-dir | git probe | confirmed / unresolved |
| `R1` | hooks directory location | git probe `--git-path hooks` | resolved / unresolved |
| `R1` | hooks directory state | filesystem | exists / missing / inaccessible |
| `R1` | provenance document state | reader + validator | `ABSENT` / `VALID` / `UNOBSERVABLE` |
| `R1` | installed hook content | filesystem read | present / absent / unreadable |
| `R1` | hook-template comparison | diff observation | same / different / unobservable |
| `R1` | governance last-run record — location | filesystem convention | resolved / unresolved |
| `R1` | governance last-run record — presence | filesystem read | present / absent / unreadable |
| `R1` | governance last-run record — content | reader / schema | valid / unobservable |
| `R2` | enclosing owner relationship | git probe | owner / enclosing / unresolved |
| `R2` | target-local artifact location | git probe + path identity | `OBSERVED_FALSE` / unresolved |
| `R3` | git administration presence | git probe | absent / unresolved |
| `R3` | hook ownership evidence | observation only | unavailable |
| `R4` | scope query result | git probe | unresolved |
| `R5` | owner query result | git probe | unresolved |

On `R4` and `R5` every downstream fact is `UNRESOLVED`: the address itself could
not be established, so no cell below it may be filled. The governance last-run
record remains readable as a plain filesystem path, but it cannot be tied to any
Git identity.

## 2.4 Location and state are two different facts

`hooks directory location` answers *"which path should be observed?"*
`hooks directory state` answers *"is that path there?"*

They have different owners, and the location owner is **git, not the filesystem
and not string concatenation**. Measured, §A.1–A.2: the naive model
`repo root + ".git/hooks"` holds only for an ordinary clone.

## 2.5 `ambiguous` is rejected as a term

For a nested target the probe **succeeds** and returns a deterministic answer that
positively identifies the enclosing repository (§A.3). Nothing is ambiguous.

```
git probe cannot answer          ->  UNRESOLVED
git probe answers "the enclosing one"  ->  ENCLOSING
git probe answers "this one"     ->  OWNER
```

Writing *belongs elsewhere* as *unknown* is forbidden, because the health layer
turns unknown into either `assume safe` or `treat as missing` — two different
wrong answers from one imprecise word.

## 2.6 Structural cardinality — frozen

```
provenance document        one per worktree          absolute-git-dir
installed hook             one per hook location     --git-path hooks
governance last-run record one per work directory    <root>/.evo-lite/generated
```

Therefore:

```
N linked worktrees  =  N provenance descriptions  +  1 shared hook artifact
```

A later rule of the form `document count == hook count` would misjudge every
linked worktree. This is frozen here so that no such rule can be written.

## 2.7 Registered observation defect — recorded, not repaired

```
declared observation      hook-template comparison
frozen location authority git --git-path hooks
current implementation    path.join(root, '.git', 'hooks', 'post-commit')
                          templates/cli/hooks.js :: diffInstalledHook
```

The current implementation cannot reliably establish this fact for the linked
worktree and `core.hooksPath` cases (§A.1–A.2). Both statements stand together:
the observation exists in the matrix, and today's implementation cannot always
produce it.

```
classification  observation defect
owner           future implementation / health layer reconciliation
action here     RECORD_ONLY
```

Not repaired in this step: it is an implementation change, it would alter the
existing `hook status` behaviour, and it requires separate authorization.

## 2.8 Vocabulary forbidden in steps 1 and 2

To keep the health layer from leaking upward:

```
forbidden   healthy · unhealthy · pass · fail · repair · should · must exist
allowed     exists · missing · present · absent · unresolved · same · different
            unobservable
```

(`VALID` as a *document state* is allowed; it names a reader/validator outcome,
not a judgement about the design.)

---

# Appendix A — measurements

Every non-obvious claim above was measured at `1f9c44b` on Windows with Git for
Windows. Throwaway repositories, removed afterwards.

## A.1 Linked worktree: `.git` is a file, and the hook is shared

```
.git is a                         : FILE
join(root,'.git','hooks') exists  : NO
rev-parse --absolute-git-dir      : <main>/.git/worktrees/linked
rev-parse --git-common-dir        : <main>/.git
rev-parse --git-path hooks        : <main>/.git/hooks        (absolute)
```

One artifact, written where Git actually looks, then asked about from both sides:

```
asked from the main worktree   : {"status":"in-sync"}
asked from the linked worktree : {"status":"no-hook"}
```

Committing **from the linked worktree**, Git resolved and attempted that same
file:

```
error: cannot spawn <main>/.git/hooks/post-commit
```

So `diffInstalledHook` answered `no-hook` about a hook Git had just tried to run.

*(An earlier attempt at this measurement was invalid — a `mktemp -d` MSYS path
was resolved by Node as `C:\tmp\…`, so the probe measured a fabricated tree
rather than the worktree. It was withdrawn and re-run with native paths. Recorded
because the finding survives only if its measurement history does.)*

## A.2 `core.hooksPath` redirects, and is probe-observable

With both `custom-hooks/post-commit` and `.git/hooks/post-commit` present and
`core.hooksPath=custom-hooks`, the commit printed:

```
CUSTOM_RAN
```

and the redirection is visible to a probe:

```
git config core.hooksPath      : custom-hooks
git rev-parse --git-path hooks : custom-hooks
```

`--git-path hooks` therefore answers correctly in all three cases: ordinary
clone, linked worktree, and redirected hooks path.

## A.3 A nested target: the probe succeeds and names the enclosing repository

Probing from `outer/child/deep`:

```
rev-parse --absolute-git-dir : <outer>/.git
rev-parse --show-toplevel    : <outer>
rev-parse --git-path hooks   : ../../.git/hooks
exit status                  : 0
```

Path identity then establishes `DISTINCT` (target ≠ toplevel), which is what makes
the row `NESTED-TARGET`. This is the basis for §2.5.

## A.4 Where today's governance status comes from

```
verify's governance status  <- readGovernanceRunState(projectRoot)
                               <root>/.evo-lite/generated/governance/post-commit-last-run.json
                               values: healthy / missing / failed-last-run
```

It answers *did the hook run, and did its commands succeed* — not *is a hook
present and in sync*. `diffInstalledHook` is consumed only by `hook status` and
by tests; `verify` never consults it. Installed-hook freshness is, today, entirely
outside governance health.

Three separate vocabularies already exist in this neighbourhood — topology (5),
hook diff (`no-hook` / `no-block` / `in-sync` / `drifted`), and governance run
(`healthy` / `missing` / `failed-last-run`). Step 3 onward must not add a fourth
that answers a question one of these already owns.

---

# Status

```
Step 1  Topology matrix      APPROVED
Step 2  Observation matrix   APPROVED WITH CHANGES
        added     hooks directory location
                  governance last-run record (location / presence / content)
        rejected  "ambiguous" terminology
        recorded  diffInstalledHook path-resolution defect

Step 3  observation semantics    NOT ENTERED
Step 4  health authority         NOT ENTERED
Step 5  verification consequence NOT ENTERED
Step 6  implementation           NOT ENTERED
```

---

# Step 2 erratum — FROZEN before Step 3

**These corrections supersede the named statements in Steps 1–2.** The original
text above remains preserved as measurement and review history. **Step 3 may not
begin from the superseded forms.**

Raised by human review of `ac6680f`; every claim below was independently
re-measured by the controller before being written here (§A.5–A.8).

The root of both P0 items is one sentence, and it is the thing Step 3 would
otherwise have let a structural fact decide on expectation's behalf:

> **"the same Git owner" is not "the same physical hook location".**

## E2.1 — supersedes §2.6 cardinality

§2.6 froze `N linked worktrees = N provenance descriptions + 1 shared hook
artifact` as an unconditional structural fact. It is not one. It describes the
default worktree configuration only.

With `extensions.worktreeConfig = true`, `git config --worktree core.hooksPath`
gives each worktree its own effective hook location (§A.5). Superseding form:

```
N resolved worktrees
    -> N provenance document addresses
    -> M distinct effective hook locations,   1 <= M <= N
    -> 0 <= installed hook artifacts <= M
```

`M` is **not** structurally fixed at 1. And a resolved location does not imply a
file: location existing and artifact existing are two facts.

§2.6's line `installed hook — one per hook location` is superseded by:

```
effective hook location     one per resolved worktree context
installed hook artifact     may be present or absent at that location
```

Step 3 may therefore **not** write "a repository has one hook expectation".

## E2.2 — supersedes the `R2` `target-local artifact location` row

That row froze `OBSERVED_FALSE`, conflating two independent questions:

```
Git ownership          who owns the hook administration
physical path locality where the hook path happens to point
```

`NESTED-TARGET` positively establishes only the first: `target != Git toplevel`,
therefore the Git owner is the enclosing repository. It does **not** establish
that the resolved hooks path lies outside the target directory. Measured (§A.6):
with `core.hooksPath` pointing inside the nested target, the frozen classifier
still returns `NESTED-TARGET` while the effective hook location is physically
inside that target.

**The row is deleted.** `R2` retains exactly:

| topology | observable fact | authority | observation domain |
|---|---|---|---|
| `R2` | enclosing owner relationship | git scope / topology probe | enclosing / unresolved |
| `R2` | hooks directory location | git probe `--git-path hooks` | resolved / unresolved |

If a later step genuinely needs *"is the path physically inside the target?"*, it
is defined then, as its own fact:

```
hook-path containment relation    inside / outside / unresolved
```

It is not manufactured now.

## E2.3 — the governance last-run record is topology-independent

§2.3 listed the record only under `R1`, while the prose beneath it said the
record stays readable on `R4`/`R5`. Those two statements were inconsistent, and
the same reasoning covers `R2` and `R3`.

The record lives at a root-local path, `<root>/.evo-lite/generated/…`. Its
observability does not come from Git topology at all. Superseding form —
plan B, lifted out of the per-row matrix:

```
Topology-independent, root-local observation
    governance last-run record — location   root-local filesystem convention
                               — presence   filesystem read
                               — content    reader / schema
    scope: every topology row
```

and a separate relationship fact, which **is** topology-dependent:

```
record <-> Git identity binding    established / unavailable / unresolved
```

The split exists so that Step 4 cannot read `record exists` as *this record
describes the currently-owned hook*.

## E2.4 — supersedes the `R3` `hook ownership evidence` row

`authority = observation only` is not an authority. It never answered *who owns
this fact*, which violates **one question, one authority**. The row is deleted
and replaced by two rows with real owners:

| topology | observable fact | authority | observation domain |
|---|---|---|---|
| `R3` | git administration presence | topology classifier / git probe | positively absent (`OBSERVED_FALSE`) |
| `R3` | Git hook-location authority available | topology classifier | `OBSERVED_FALSE` |

On `R3` the `hooks directory location` cell is therefore **not filled with
`UNRESOLVED`** — that would suggest an attempt that failed to conclude. The
authority for that question is positively absent, so the question does not arise.
Measured (§A.7): outside any repository the probe exits `128` with the same
positive not-a-repository answer the frozen classifier already keys on.

## E2.5 — Step 1's CI sentence does not decide expectation

Step 1 wrote of CI checkout: *"same row; the difference is only whether we can
observe, **never what was promised**."* The first clause is frozen topology and
stands. The second clause answers **expectation**, which is Step 3's to decide.

Superseding form:

```
CI checkout and an ordinary working copy share the R1 topology row.

Whether they carry the same hook expectation is intentionally NOT decided
by Step 1. That belongs to Step 3, and must be derived from the expectation
authority — never from the fact that their topology matches.
```

Step 3 may well rule that the expectations are identical. It may not reach that
ruling by inheritance from a shared row.

---

# Appendix A (continued) — erratum measurements

Measured at `ac6680f`, `git version 2.48.1.windows.1`, throwaway repositories,
removed afterwards.

## A.5 Per-worktree hook locations are possible (basis for E2.1)

```
baseline, no worktreeConfig
    main   : .git/hooks
    linked : <main>/.git/hooks              -- shared

extensions.worktreeConfig = true
git config --worktree core.hooksPath main-hooks     (in main)
git config --worktree core.hooksPath linked-hooks   (in linked)

    main   : main-hooks
    linked : linked-hooks                   -- two distinct locations
```

## A.6 A nested target can physically contain its own resolved hooks path (basis for E2.2)

```
outer repository, target = outer/child/deep
core.hooksPath = <abs>/outer/child/deep/local-hooks

from the target:
    --show-toplevel  : <abs>/outer
    --git-path hooks : <abs>/outer/child/deep/local-hooks

classifyTopology(target) : NESTED-TARGET
```

Git owner is the enclosing repository; the hook location is inside the target.
Both at once.

## A.7 Outside any repository (basis for E2.4)

```
git -C <non-repo> rev-parse --git-path hooks
    fatal: not a git repository (or any of the parent directories): .git
    exit 128
```

## A.8 `--git-path hooks` walks up, so exit 0 is not proof of local ownership

A first attempt at A.7 placed the "non-repository" directory *inside* this
repository. Git walked up, found this repository, and answered `../../../.git/hooks`
with exit `0`. The probe was invalid and was re-run outside any repository.

The finding is kept because it is load-bearing: **a successful `--git-path`
answer does not establish that the queried directory is itself a repository.**
That is exactly why the frozen classifier resolves scope first, and why `R2`
exists as a distinct row.

*(A shell error is also recorded: the first re-run printed `exit=0` because `$?`
had captured a pipeline's `head`, not `git`. The exit code above was re-captured
without a pipe.)*

---

# Status after the erratum

```
Step 1  topology row set             APPROVED, unchanged
        CI expectation sentence      SUPERSEDED by E2.5

Step 2  observation framework        APPROVED
        cardinality                  SUPERSEDED by E2.1
        R2 target-local artifact     ROW DELETED by E2.2
        governance record scope      SUPERSEDED by E2.3
        R3 authority                 SUPERSEDED by E2.4

Step 3  expectation / contract       NOT ENTERED
```

---

# Step 3 — FROZEN: expectation

Ratified after the Step 2 erratum. Append-only: nothing above is rewritten.

Step 3 answers one question only:

> **When we are about to judge a fact, what should we compare it against?**

It does **not** answer what a comparison result means. That is Step 4 onward.

## 3.0 A correction of attribution, carried here rather than edited above

During review it was stated in discussion that the producer's string-joined hook
path conflicts with `ac1` of the frozen `[hook-install-provenance]` design. That
attribution was wrong, and is corrected here because the classification matters:

```
ac1 governs   the PROVENANCE DOCUMENT path
              "<git rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json"
ac1 does NOT govern the hook artifact's path
```

The finding survives; only its classification changes:

```
was recorded as   acceptance criteria failure
is               observation authority divergence   (see §3.4)
```

§2.7 of this document never cited `ac1`, so no frozen text is affected.

## 3.1 Expectation authority — one, and only one

```
Expectation is derived only from:

    a VALID provenance document
        current.participation
```

The chain, and the direction it may never run:

```
producer intent  ->  current.participation  ->  expectation
```

`ac2` of the frozen design already fixes that `current` derives from `intent` and
**not** from `install.outcome`. Step 3 inherits that and adds the negative rules:

```
FORBIDDEN   hook artifact is present   ->  therefore expected
FORBIDDEN   topology is IN-SCOPE       ->  therefore participating is expected
```

Both are observation exceeding its authority.

The CLI, the scaffold, and the explicit command action are **producers**, not
expectation authorities. Their intent is transient; the document is its durable
projection.

### `intent.source` is not a second authority

```
intent.source     answers   WHO produced this declaration
current.participation answers WHAT is declared
```

`scaffold-no-hooks` is a provenance origin, not an expectation. The expectation
is `current.participation = non-participating`. Reading the expectation off the
source would give the same answer today by coincidence of the C-2d coherence
rule, and would be the wrong authority tomorrow.

## 3.2 Expectation states — five, none collapsible

```
EXPECTED                  a declaration exists and reads participating
NOT_EXPECTED              a declaration exists and reads non-participating
UNDECLARED                the address resolves; no declaration was ever made
EXPECTATION_UNRESOLVED    the expectation authority could not be established
                          reason: document-unobservable | address-unresolved
NOT_APPLICABLE            no hook administration semantics exist here (R3)
```

`EXPECTATION_UNRESOLVED` is deliberately named for the *authority*, not for the
system's knowledge. The expectation is not absent; the authority for it could not
be established. Two distinct causes are carried in `reason`, following the
`{state, reason}` shape the observation layer already uses.

The three forbidden collapses:

```
UNDECLARED      !=  NOT_EXPECTED       absence of a statement is not
                                       a statement of absence
EXPECTATION_UNRESOLVED != EXPECTED     unreadable is not "assume participating"
NOT_APPLICABLE  !=  NOT_EXPECTED       the question not arising is not
                                       someone having declined
```

## 3.3 Binding granularity

```
For each (topology row  x  resolved worktree context):
    exactly one expectation
```

It binds to **neither** of these:

```
NOT the repository      -- N worktrees may carry M hook locations, 1 <= M <= N
NOT a hook location     -- `current` records no location at all
```

Measured (§A.10): `current` holds exactly `participation` and `derivedFrom`.
`current.digest` is forbidden by the schema. The location appears only per event,
as `install.targetPath`, slot 9 of the frozen 20-slot projection — an install
record, not a declaration.

### What identifies a worktree context

```
worktree context is identified by the PROVENANCE DOCUMENT ADDRESS
    git rev-parse --absolute-git-dir

it is NOT identified by the current hook location
    git rev-parse --git-path hooks
```

The two have different lifetimes. The document address is where a declaration
lives; the hook location is a live observation that `core.hooksPath` can change
at any time without touching any declaration.

## 3.4 Registered divergence — two authorities for one question

Measured (§A.9). One question — *where is the effective hook location* — is
answered along two paths that do not agree:

```
question         effective hook location

authority        git rev-parse --path-format=absolute --git-path hooks
                 used by observeLocator (observe.js)

implementation   path.join(targetDir,      '.git', 'hooks')   hooks.js:166
                 path.join(topo.worktreeTop,'.git', 'hooks')  hooks.js:230
                 path.join(projectRoot,     '.git', 'hooks')  hooks.js:368, 502
                 used by the producer's write path and by diffInstalledHook
```

The consequence is measurable and is already recorded by the system itself: on a
linked worktree, or wherever `core.hooksPath` is set, the producer writes to the
constructed path and `observeLocator` then correctly records

```
runnability.locator = { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' }
```

The system writes the artifact to a location Git does not use, **and** records
truthfully that the location is not the one Git uses. The fact layer is behaving
exactly as designed; the divergence is upstream of it.

```
classification   observation authority divergence
                 NOT an acceptance criteria failure  (see §3.0)
status           REGISTERED_NOT_FIXED
owner            implementation / verification layer
action           later authorized change only
```

This is registered, not turned into a Step 3 contract, and not repaired here.

## 3.5 The recorded locator verdict is historical, not live

`runnability.locator` is an observation made **at write time** and stored in that
event. `core.hooksPath` may change afterwards; the stored verdict does not.

```
stored runnability.locator   what was observed when the write was issued
a live locator observation   a different fact, observed now
```

Step 3 freezes only that these are two facts. Which of them may serve as a
comparison basis is not decided here.

---

# Appendix A (continued) — Step 3 measurements

## A.9 `observeLocator` already holds the correct authority

`templates/cli/hook-provenance/observe.js`:

```
gitQuery(targetDir, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])

pathIdentity(answer, dirname(targetPath)):
    SAME      -> { verdict: 'satisfied',     reason: null }
    DISTINCT  -> { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' }
    otherwise -> { verdict: 'indeterminate', reason: 'path-comparison-ambiguous' }
```

while the producer computes the path it writes to by string join (§3.4).

## A.10 `current` carries no location

```
current fields          participation, derivedFrom
current.digest          forbidden by the validator
install.targetPath      per event; slot 9 of the 20-slot canonical projection
```

---

# Status after Step 3

```
Step 1  topology row set          APPROVED
Step 2  observation matrix        APPROVED AFTER ERRATUM
Step 3  expectation               FROZEN
        authority                 current.participation, sole
        states                    5, none collapsible
        binding                   (topology row x resolved worktree context)
        registered                observation authority divergence

Step 4  health authority          NOT ENTERED
Step 5  verification consequence  NOT ENTERED
Step 6  implementation            NOT ENTERED
```

---

# Step 4 — FROZEN (first pass): health authority

Append-only. Step 4 answers exactly one question:

> **Who owns the power to read a relation between observation and expectation as
> a health judgement?**

It does **not** answer whether anything is acceptable, what the health states are,
how domains aggregate, or what should be done about any result. The vocabulary
ban of §2.8 is lifted only far enough to *name* domains and authorities; no
verdict is asserted anywhere below.

## 4.0 What already exists, measured

A composite health authority is already in production. It was not designed as
one; it accumulated.

```
~20 separate conditions  ->  report.hasAlerts          (boolean OR)
                         ->  takeover-session.js:66
                             (verify.hasAlerts || degraded.length > 0)
                                 ? 'attention-needed' : 'ready'
```

Two measured facts follow, and both are inputs to this step:

```
1. The installed hook artifact does not enter this chain AT ALL.
   verify never consults diffInstalledHook. So today's answer to
   "does a stale or missing hook affect overall governance health"
   is: it does not, because it is not on the chain.

2. The governance domain has already made per-case fail-open / fail-closed
   choices, in code, without naming who made them (§A.11).
```

`hasAlerts` is retained as a fact about the system. It is **not** adopted as the
analysis model for Step 4, because a boolean OR over twenty anonymous
contributors cannot answer *who judged this*.

## 4.1 Health domains — four, by question

| domain | question |
|---|---|
| `D1` declaration consistency | can the declaration itself be safely relied upon? |
| `D2` installation consistency | is the artifact where and what the installation expectation requires? |
| `D3` execution success | did the most recent governance execution succeed? |
| `D4` composite | how do multiple domain results form one external summary? |

These four have different lifetimes, different evidence sources, and different
failure semantics. They may not share one bucket.

## 4.2 Authority per domain

### `D1` — `validateHookProvenanceV1`

It already owns schema legality, the frozen vocabularies, the `C-2` consistency
family, and the `UNOBSERVABLE` boundary. It is fail-closed by construction:

```
invalid document  ->  UNOBSERVABLE
invalid document  ->  NOT "probably absent"
```

### `D2` — **NO SINGLE AUTHORITY IDENTIFIED**

This is the most important entry in Step 4, and it is deliberately left open.

```
observeLocator      holds the correct location authority
                    git rev-parse --path-format=absolute --git-path hooks
                    honours worktrees and core.hooksPath
                    BUT it expresses an observation AT MEASUREMENT TIME (§3.5),
                    which is not the same thing as an authority over the
                    current installed state

diffInstalledHook   uses path.join(root, '.git', 'hooks')
                    already registered as authority divergence (§3.4)
                    a wrong implementation may not become the authority
```

Frozen state:

```
D2 installation consistency
    authority   unresolved
    reason      the existing observers disagree on the location authority
```

This is not a defect being concealed. It is the correct outcome of asking the
question honestly. Naming an authority here to make the table look complete would
break the layering the whole document exists to protect.

### `D3` — `readGovernanceRunState`

It owns the execution lifecycle: whether the most recent run happened and whether
its commands succeeded.

### `D4` — see §4.4

## 4.3 A health judgement takes a PAIR

```
input to any domain judgement  =  (observation, expectation)
```

Neither half alone may produce a health judgement:

```
FORBIDDEN   observation alone   -- observation exceeding its authority
FORBIDDEN   expectation alone   -- declaration exceeding its authority
```

The path is always:

```
what was observed  +  what was expected  +  the domain authority's reading
```

### No automatic mapping of any unresolved state

```
SCOPE-UNRESOLVED · OWNER-UNRESOLVED · UNOBSERVABLE · EXPECTATION_UNRESOLVED
```

None of these may be mapped in either direction by default. A domain authority
may rule on any of them, fail-open or fail-closed — but the ruling must be
written down, and it must be attributable to that authority. A default is not a
ruling.

## 4.4 Composite — shape requirement only

Frozen:

```
Composite health authority requirement:

    the contributor(s) responsible for a composite judgement
    must remain identifiable
```

Explicitly **not** frozen, and deferred:

```
OR · AND · priority · severity · the mapping onto any external summary value
```

Step 4 settles *who owns the judgement*, never *how results aggregate*.

## 4.5 Registered: a boolean summary is an output shape, not an authority model

```
report.hasAlerts   may continue to exist
                   it is an OUTPUT SHAPE

hasAlerts          is NOT a health authority
                   it cannot answer "who judged this"
```

## 4.6 Registered existing consequence rule — Step 5's to adjudicate

Measured in `memory.service.js` (§A.11):

```
governance last-run  healthy          logs only
                     missing          logs only, does NOT set hasAlerts   <- fail-open
                     failed-last-run  sets hasAlerts                      <- fail-closed
                     error            sets hasAlerts                      <- fail-closed
```

```
classification   existing consequence rule
NOT              an authority definition
status           RECORDED, unchanged by Step 4
owner            Step 5
```

Step 4 neither endorses nor overturns it. It is recorded so that Step 5 rules on
it deliberately rather than inheriting it by silence.

---

# Appendix A (continued) — Step 4 measurements

## A.11 The existing composite and the existing fail-open

```
templates/cli/memory.service.js
    report.hasAlerts set from ~20 separate conditions

    governanceRun.status === 'healthy'          -> log only
                          === 'missing'         -> log only
                          === 'failed-last-run' -> log + report.hasAlerts = true
                          otherwise (error)     -> log + report.hasAlerts = true

templates/cli/takeover-session.js:66
    (verify.hasAlerts || degraded.length > 0) ? 'attention-needed' : 'ready'

templates/cli/takeover-payload.js:34
    TAKEOVER_HEALTH = { 'ready', 'bootstrap-pending', 'attention-needed' }
```

`diffInstalledHook` appears nowhere in `verify`. Confirmed by search across
`templates/cli/`: its only non-test consumers are the `hook status` command and
the tests.

*(The quoted string values above — `healthy`, `missing`, `failed-last-run`,
`ready`, `attention-needed` — are measurements of existing code, not verdicts
asserted by this document.)*

---

# Status after Step 4

```
Step 1  topology row set          APPROVED
Step 2  observation matrix        APPROVED AFTER ERRATUM
Step 3  expectation               FROZEN
Step 4  health authority          FIRST PASS FROZEN
        D1  validateHookProvenanceV1
        D2  UNRESOLVED  -- registered authority divergence, deliberately open
        D3  readGovernanceRunState
        D4  shape requirement only; aggregation deferred
        recorded: hasAlerts is an output shape, not an authority
        recorded: governance missing -> no alert, an existing consequence rule

Step 5  verification consequence  NOT ENTERED
Step 6  implementation            NOT ENTERED
```
