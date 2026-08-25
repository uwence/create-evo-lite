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
