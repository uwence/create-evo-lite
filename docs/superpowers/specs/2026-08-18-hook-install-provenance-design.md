---
id: spec:hook-install-provenance
status: draft
created: 2026-08-18
---

# Spec: Hook install provenance — record what happened, never repair it

**Date:** 2026-08-18
**Backlog:** `[hook-install-provenance]`, prerequisite of `[0ce0] verify-hook-runtime-health`
**Architecture:** A′ — two orthogonal axes, `provenance × live observation`. Frozen by the human. Alternative B (single health signal) and C (environment-classifier rows) were considered and rejected.

**Amendment history.** `0c22702413ac5ac39e871f2abb7c911ec86074b6` was approved and frozen, then found — during implementation planning, before any production code existed — to have no truthful way to record an observation that fails after the topology gates and before any write is issued. That SHA is **SUPERSEDED BEFORE IMPLEMENTATION**, not extended in place: no producer had shipped and no v1 document had ever been written, so this amendment defines the first implementable v1 rather than growing a released schema. `schemaVersion` therefore stays `1`. Once this producer ships and a v1 document can persist, any further vocabulary change requires `schemaVersion: 2`.

## Problem

`installPostCommitHook()` returns nothing and records nothing. When it silently
declines to act — `if (!fs.existsSync(hooksDir)) return;` at
`templates/cli/hooks.js:69` — no artifact anywhere distinguishes these three
worlds:

- the hook was never meant to be installed here
- installation was attempted and failed
- installation succeeded and something later removed the hook

Every consumer downstream therefore re-decides the question from a weaker proxy.
`diffInstalledHook()` reports `no-hook`; `dashboard-data.js:15`
`hasManagedPostCommitHook()` reports `false` behind a `catch { return false }`.
Both answer "is there a managed hook right now" and both are then read as
"was one ever promised here" — a failure to OBSERVE impersonating a change in FACT.

`[0ce0]` cannot rule on whether a stale or missing hook should change overall
governance health until a recorded fact exists to compare the live observation
against. This spec produces that fact, and nothing else.

### This is not a hook-health rule

Nothing here assigns HEALTHY / DEGRADED / FAIL. Nothing here repairs, reinstalls,
or rewrites a hook. The fact layer observes and records; `[0ce0]` later consumes
`participation × realization × runnability` and assigns governance health. Two
runnability gaps discovered during design are likewise NOT fixed here — they are
identified by this design and must be registered separately as
`[hook-runtime-runnability]` (see Out of scope).

## Design

### Storage and ownership

The provenance document lives in the current worktree's Git administrative
context, at:

```
<git rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json
```

**Every Git authority query in this contract MUST be bound to the workspace being
operated on**, as `git -C <target> …` or an equivalent `cwd: <target>`, never to
the process's ambient working directory. This applies to the owner query here, to
the locator query below, and to any Git query added later.

The hazard is concrete, not theoretical: the CLI takes a target path
(`index.js:93` `[project-path]`, resolved at `index.js:292`), so
`create-evo-lite ../repo-B` run from inside repo A would, under an unbound query,
resolve **A's** git-dir as the provenance owner while mutating **B's** hook — the
record and the artifact describing different repositories. `ensureGitWorkspace()`
already establishes the correct idiom by passing `cwd: targetDir`; this contract
inherits it rather than inventing one.

### Path identity

Two paths are compared by one shared primitive, used everywhere this contract asks
whether two paths name the same location. It answers with three states, never two:

```
canon(p) = path.resolve(p), every '\' replaced by '/', any trailing '/' removed
real(p)  = fs.realpathSync.native(p), then canon

canon(a) === canon(b)                         → SAME
otherwise, resolve both physically
  real(a) === real(b)                         → SAME
  both resolved and they differ               → DISTINCT
  either side cannot be resolved              → UNESTABLISHED
```

**Exact canonical equality is the only lexical shortcut.** Every other difference —
including one that is only a difference of case — goes to physical resolution.
Case-insensitive equality carries no authority of its own: on a case-sensitive
filesystem `hooks/Foo` and `hooks/foo` are two real directories, so treating them
as equal would fabricate a positive claim in exactly the way this contract forbids.
Windows drive-letter and component case differences still reach `SAME`, by
resolution rather than by assumption.

`realpathSync.native`, not the pure-JS `fs.realpathSync`, is the repository's
established primitive for real-path identity
(`templates/cli/takeover-receipt.js:16`, `templates/cli/takeover-adapter.js:290`).

`DISTINCT` is the only state that positively establishes a difference. No consumer
of this primitive may treat `UNESTABLISHED` as either `SAME` or `DISTINCT`.

Ownership is structural — a property of the storage location — so the schema
carries no identity field at all. Measured consequences:

| Event | Outcome |
|---|---|
| `git clean -fdx` | survives (not in the working tree) |
| workspace rename / move | survives with the Git admin context |
| plain `clone` | does not propagate; the clone has its own admin storage |
| `rm -rf .git` | provenance and hook are lost together — consistent |
| copying `.evo-lite/` elsewhere | carries no provenance to misrepresent |
| linked worktree removal / prune | that worktree's provenance ends with its admin context |

The location was measured, not assumed. A file at `.evo-lite/hook-provenance.json`
is deleted by `git clean -fdx` while `.git/hooks/post-commit` survives — a routine
command would manufacture "installed hook, no history", the exact amnesia this
spec exists to prevent.

Per-worktree, not per-repository. `extensions.worktreeConfig` with
`git config --worktree core.hooksPath` legitimately gives two worktrees under one
common dir different active hooks directories; a single shared document would put
two legitimate owners in permanent contention over one `current`. This is not the
accepted concurrency loss — it is structural.

**One Evo-Lite governance root per Git worktree — v1 scope.** The document is keyed
by worktree, so two Evo-Lite targets inside one worktree would share one
authoritative `current`:

```
repo/                 ← one worktree, one git-dir
  .evo-lite/          project A
  child/.evo-lite/    project B

scaffold B --no-hooks  →  same git-dir  →  same document
                       →  current = non-participating
later read from A      →  A inherits B's opt-out
```

That is not the accepted concurrent audit loss; it is one target's declared intent
being served to another as authoritative. The rule:

The classification uses the shared **Path identity** primitive against
`git -C <target> rev-parse --show-toplevel`, never string equality — a target
reached through a junction or symlink alias of the worktree root would otherwise be
misclassified as nested by the very mistake the locator ladder exists to prevent:

```
pathIdentity(target, worktreeTopLevel)

  SAME           → in scope; owner is resolved and provenance is read and written
  DISTINCT       → NESTED-TARGET
  UNESTABLISHED  → SCOPE-UNRESOLVED

NESTED-TARGET
  → provenance processing short-circuits BEFORE any owner resolution or
    document access: no owner directory is created, no document is read,
    no document is written
  → legacy installer behaviour MAY continue unchanged; whatever it does is
    outside the provenance transaction defined by this spec and produces
    no provenance claim

SCOPE-UNRESOLVED
  → provenance processing short-circuits at the same point
  → the hook MUST NOT be mutated
  → reported and exits non-zero
```

The two share a stopping point and nothing else, because their evidence differs.
`NESTED-TARGET` is positive knowledge that this target lies outside v1's provenance
scope, so leaving the legacy installer alone is a deliberate, bounded exception.
`SCOPE-UNRESOLVED` is a failed observation — we were supposed to classify the scope
and could not — which is not a licence to act. Granting it the same exception would
produce precisely the state the transaction rules exist to prevent:

```
show-toplevel succeeds, realpathSync.native fails with EACCES
  → SCOPE-UNRESOLVED
  → legacy installer runs anyway
  → the hook changed, provenance cannot account for it, exit is non-zero
```

An artifact mutated with no record able to explain it is the original defect, made
worse by having been foreseeable.

`NESTED-TARGET` may be produced by `DISTINCT` and by nothing else. It is a positive
topology assertion — *this target is not the worktree top-level* — and
`UNESTABLISHED` is precisely the state in which we are not entitled to assert it.
Routing an unresolvable comparison to `NESTED-TARGET` would be a consumer treating
`UNESTABLISHED` as `DISTINCT`, which the primitive forbids.

**`NESTED-TARGET` is a topology state, not a document state.** It sits beside
`NO-GIT-ADMIN-TOPOLOGY` and `OWNER-UNRESOLVED`, and it is emphatically *not*
`UNKNOWN`: `UNKNOWN` may only arise from a positive `ENOENT` on a document this
target is entitled to read, whereas here the enclosing worktree's document may well
exist and this target is simply forbidden to look at it. Reporting `UNKNOWN` would
assert an observation that was never permitted to be made. `[0ce0]` must handle
`NESTED-TARGET` on its own terms rather than reading it as absent provenance.

Deliberately *not* chosen: refusing to install, which would be an unratified
behaviour change (today `ensureGitWorkspace()` accepts any directory inside a
worktree, since `git rev-parse --is-inside-work-tree` is true from a subdirectory
while `--absolute-git-dir` returns the enclosing worktree's git-dir); and adding a
target namespace to the document, which would reopen the ownership-identity and
rebind design that O1′ closed.

**Provenance owner is the current worktree's governance context; the hook artifact's
owner may be broader.** The two are different layers. Linked worktrees may share
one `post-commit` file while holding separate provenance, and a worktree that never
recorded provenance may legitimately observe `UNKNOWN` provenance alongside an
in-sync live hook. That combination is information, not error.

Forbidden ownership primitives, each rejected for a measured reason:

- `path.join(projectRoot, '.git')` — in a linked worktree `.git` is a file, not a directory
- a `projectRoot` / `gitDir` / `commonDir` field in the document — a stale in-file assertion where a container property suffices, and an absolute path with no frozen rebind contract
- root-commit SHA — `installPostCommitHook` runs at `index.js:489`, the initial commit at `index.js:544`; the first event is recorded while `git rev-list --max-parents=0 HEAD` still fails
- a single document under `--git-common-dir` — the worktree contention above

### Two orthogonal axes

`current` answers one question only: does this workspace declare a hook-installation
obligation. An event records how one installation attempt went.

**`participation` is derived from `intent`, never from `install.outcome`.** The two
directions are not symmetric, and both halves are load-bearing:

```
scaffold-no-hooks
  → current = non-participating

later hook-install-command
  → current = participating
  → even when outcome is unrealized or indeterminate

a failing outcome
  → MUST NOT downgrade participating to non-participating
```

Explicit non-participation is not a permanent exemption. An explicit
`mem hook install` supersedes an earlier `--no-hooks`, because the intent to
participate is expressed by invoking the installer — whether that invocation then
succeeds is the other axis entirely. Conversely a failed attempt must never rewrite
`participation` downward, or an action that did not succeed would impersonate an
action that was never required.

```
current.participation      participating | non-participating
install.outcome            realized | unrealized | indeterminate
runnability.verdict        satisfied | not-satisfied | indeterminate
```

`install.outcome` has no `not-attempted`: no legal
`participating + not-attempted` combination exists once the axes are separated, so
the state would carry no information beyond `participation`.

Conditional shape, frozen:

```
intent.participation = non-participating
  → install       MUST be absent
  → runnability   MUST be absent

intent.participation = participating
  → install       MUST exist

install.outcome = realized
  → runnability   MUST exist

install.outcome = unrealized | indeterminate
  → runnability   MUST be absent
```

Absent, not `null`, and never a fourth "not-applicable" state.

### Intent authority

`--no-git` means "do not run `git init`" and nothing more. It was never the
authority for hook participation, so hook installation does not "ignore" it —
no such relationship exists.

`--no-hooks` is the sole authority for **explicit non-participation**. It is not
the sole authority for participation: `scaffold-default` and `hook-install-command`
are both legitimate producers of a participating intent. Only the negative
direction has a single gate.

A target that is not a Git repository and is scaffolded with `--no-git` has no Git
administrative container, therefore **no provenance document** — which is not
`non-participating`. A missing document must never impersonate explicit
non-participation; `[0ce0]` may later read Git topology and rule NOT-APPLICABLE.

This forces one combination to be stated rather than inferred, because two
otherwise-correct rules would contradict each other on it:

```
--no-hooks, target has an established in-scope provenance context
             (workspace scope SAME and owner established)
  → non-participation is durably recorded, as it should be

--no-hooks + --no-git, target is not a Git repository
  → NO-GIT-ADMIN-TOPOLOGY: there is nowhere to record it, and a .git MUST NOT
    be created to gain one
  → no provenance document

--no-hooks on a nested target
  → NESTED-TARGET: a Git administrative container exists but belongs to the
    enclosing worktree, which this target may not write
  → no provenance document for this target

--no-hooks under SCOPE-UNRESOLVED or OWNER-UNRESOLVED
  → the opt-out cannot be durably recorded, so the run fails closed
```

In the first three rows the opt-out is honoured for that run; only the first leaves
a persistent record. The precondition is an **in-scope** context, not merely a
nearby `.git` — a nested target has a Git administrative container it is forbidden
to write, so requiring a durable record there would demand something the ownership
contract prohibits.

Creating a repository in order to store an opt-out would let a hook-participation
flag manufacture a Git repository — precisely the coupling DD#1 severed, running
backwards. The recording of an intent never outranks the boundary of the command
that carried it.

### Document shape

```json
{
  "kind": "evo-lite/hook-install-provenance",
  "schemaVersion": 1,
  "current": {
    "participation": "participating",
    "derivedFrom": "sha256:<64-hex>"
  },
  "events": [
    {
      "seq": 1,
      "id": "sha256:<64-hex>",
      "recordedAt": "2026-08-18T09:14:22.031Z",
      "intent": { "participation": "participating", "source": "scaffold-default" },
      "install": {
        "outcome": "realized",
        "reason": "created-managed-hook",
        "targetPath": "C:/repo/.git/hooks/post-commit",
        "expectedBodyDigest": "sha256:<64-hex>",
        "chmod": { "attempted": true, "threw": false }
      },
      "runnability": {
        "verdict": "indeterminate",
        "locator":     { "verdict": "satisfied",     "reason": null },
        "executable":  { "verdict": "indeterminate", "reason": "no-qualified-predicate" },
        "interpreter": { "verdict": "satisfied",     "reason": null }
      },
      "resultingCurrentDigest": "sha256:<64-hex>",
      "diagnostic": {
        "gitVersion": "2.48.1",
        "coreFileMode": false,
        "activeHooksPath": "C:/repo/.git/hooks",
        "shebang": "#!/bin/sh",
        "executablePredicate": "posix-mode-bits",
        "predicateQualification": "unavailable"
      }
    }
  ]
}
```

All `reason` fields are controlled enums, never free text. `runnability` has no
top-level `reason`: its verdict is a mechanical aggregation, so any top-level reason
would duplicate a component's.

### Field presence and enums

Beyond the conditional shape above, within a present `install` object:

- `targetPath` is the **intended** mutation target and is present on every
  `install` regardless of outcome — including `unrealized`, where naming the path
  that could not be written is the whole value of the record
- `expectedBodyDigest` is present only when `outcome = realized`; there is no
  digest of a body that was not established
- `chmod` is present if and only if the write was **issued** — that is, on every
  phase-2/3 outcome and on none of the phase-1 outcomes (see the phase mapping
  under "Observation primitives"). "Issued", not "attempted": an observation that
  fails before the write is reached has attempted nothing

`diagnostic` is optional on every event and carries no authority: it is raw
observation, never a verdict input. It is permitted on `non-participating` events
(a `--no-hooks` invocation may still record `gitVersion`), and its absence is
never itself a fact about the workspace.

`intent.source` is a controlled enum. v1 members:

```
scaffold-default      scaffold ran with hook installation left at its default
scaffold-no-hooks     scaffold ran with --no-hooks
hook-install-command  mem hook install was invoked explicitly
```

`install.reason` and each component's `reason` are fixed by this spec under
"v1 controlled vocabularies" below, not by the implementation.
`diagnostic.predicateQualification` is asymmetric by design: the **writer MUST**
emit only `qualified` or `unavailable`, while the **reader MAY ignore** any
unrecognised diagnostic value when deciding document validity. Diagnostic values
feed no verdict, so an unexpected one degrades a diagnostic, never the document.

An unrecognised member of any controlled vocabulary makes the document
`UNOBSERVABLE` rather than being passed through — within the validation scope
frozen under "Reader epistemic states", which does not include interior events.

### Integrity

```
C-1   events + current are replaced as one atomic whole-file write
C-2a  current.derivedFrom == lastEvent.id
C-2b  sha256(JSON.stringify([current.participation])) == lastEvent.resultingCurrentDigest
C-2c  current.participation == lastEvent.intent.participation
```

C-2c is not redundant with C-2a and C-2b. Those two prove that `current` is bound
to *some* well-formed event and that its digest is internally consistent — they do
not prove it is the participation that event's intent actually produced. Without
C-2c this document satisfies every other rule while its authoritative `current`
contradicts the intent it claims to derive from:

```
lastEvent.intent.participation    non-participating
lastEvent.install                 absent
current.participation             participating
lastEvent.resultingCurrentDigest  sha256(["participating"])
current.derivedFrom               = recomputed lastEvent.id
```

C-2c is a single field comparison against the last event, not a replay of history,
so it stays inside the frozen validation scope.

```
C-2d  intent.source and intent.participation are coherent

      scaffold-no-hooks                       ↔ non-participating
      scaffold-default | hook-install-command ↔ participating
```

C-2d does not overlap C-2c. C-2c binds `current` to the last event's
`participation`; C-2d binds that `participation` to the producer authority
entitled to declare it. Without it, this last event passes everything else:

```
intent.source          hook-install-command
intent.participation   non-participating
current.participation  non-participating
```

C-2c holds, both enum members are legal, and an explicit request to install has
been recorded as an explicit refusal to participate. A violation on the last event
makes the document `UNOBSERVABLE`.

The authoritative projection of `current` is `participation` alone. `derivedFrom`
must not enter the digest: `resultingCurrentDigest` participates in `event.id`, and
`derivedFrom` equals `event.id`, so including it closes a cycle
`digest → event.id → digest`.

There is no `current.digest` field. A reader recomputes the digest from
`current.participation` and compares it to `lastEvent.resultingCurrentDigest`.
Storing it would create a third representation of one value with no new information
and one new way to disagree.

`event.id` is `sha256:` + hex over `JSON.stringify` of a canonical projection: a
**fixed-length, fixed-order array of exactly 20 slots**, where a field absent under
the conditional shape contributes `null`. "Authoritative fields when present" is
not a specification — writer and reader must derive the identical array from this
list alone:

```
 0  kind
 1  schemaVersion
 2  seq
 3  recordedAt
 4  intent.participation
 5  intent.source
 6  install.outcome                    | null
 7  install.reason                     | null
 8  install.targetPath                 | null
 9  install.expectedBodyDigest         | null
10  install.chmod.attempted            | null
11  install.chmod.threw                | null
12  runnability.verdict                | null
13  runnability.locator.verdict        | null
14  runnability.locator.reason         | null
15  runnability.executable.verdict     | null
16  runnability.executable.reason      | null
17  runnability.interpreter.verdict    | null
18  runnability.interpreter.reason     | null
19  resultingCurrentDigest
```

Excluded from the projection: `id` itself, the whole of `diagnostic`, and any
free-text error message. No machine-random UUID participates in identity.

### v1 controlled vocabularies

A persisted schema whose enums are "fixed by the implementation" does not define
what a valid `schemaVersion: 1` document is. The v1 members are therefore fixed
here, together with the outcome each may accompany:

```
install.reason
  realized       created-managed-hook | updated-managed-block
                 | appended-managed-block
  unrealized     hooks-dir-missing | hooks-dir-not-directory | write-failed
  indeterminate  hooks-dir-unobservable | pre-write-observation-failed
                 | post-write-observation-failed

locator.reason
  satisfied      (null)
  not-satisfied  active-hooks-dir-differs
  indeterminate  authority-query-unavailable | authority-query-failed
                 | path-comparison-ambiguous

executable.reason
  satisfied      (null)
  not-satisfied  predicate-reports-not-executable
  indeterminate  no-qualified-predicate | predicate-qualification-failed

interpreter.reason
  satisfied      (null)
  not-satisfied  incompatible-interpreter | syntax-rejected
  indeterminate  missing-shebang | ambiguous-interpreter | no-safe-parser
```

A component `reason` is `null` if and only if its verdict is `satisfied`, and a
non-null `reason` must belong to the set permitted for that verdict. Extending any
vocabulary requires `schemaVersion: 2`.

There is deliberately no `already-current` member. The installer today always
writes — it replaces an existing managed block unconditionally at
`templates/cli/hooks.js:74-87` and has no byte-identical skip branch — so the
member would describe a producer state that does not exist. An invocation that
changes nothing observable still records an event, under whichever of the three
`realized` reasons describes the write it actually performed. If a
byte-identical no-write branch is ever introduced, the vocabulary extends then,
under `schemaVersion: 2`.

**`write-failed` alone has no authority to produce `unrealized`.** A thrown write
is an operation result, not a fact about the artifact; the post-write authoritative
observation still runs and still decides. The reasons are named for the **phase**
whose observation failed, not for the exception that was seen, and the complete
mapping is:

```
PHASE 1  pre-write observation — nothing has been written yet
  hooks dir ENOENT               → unrealized    / hooks-dir-missing
  hooks dir is not a directory   → unrealized    / hooks-dir-not-directory
  hooks dir any other error      → indeterminate / hooks-dir-unobservable
  existing hook unreadable       → indeterminate / pre-write-observation-failed
  ─ chmod is ABSENT on every phase-1 outcome: no write was issued

PHASE 2+3  the write was issued, then observed
  expected managed body established        → realized      / created-managed-hook
                                                           | updated-managed-block
                                                           | appended-managed-block
  expected body positively NOT established → unrealized    / write-failed
  final state cannot be established        → indeterminate / post-write-observation-failed
  ─ chmod is PRESENT on every phase-2/3 outcome: a write was issued
```

Two rows carry the weight.

**`pre-write-observation-failed`** states a phase fact: the topology and provenance
gates were passed, and the artifact observation needed to decide the mutation could
not be completed *before any write was issued*. It must not be spelled
`post-write-observation-failed`; that would put a phase the run never reached into
a record whose only purpose is that its statements are true. And because no write
was issued, it carries no `chmod`.

**`write-failed` is scoped to the write phase, not to the exception.** It means the
write phase did not establish the expected managed body — whether or not the write
threw. So a write that throws after its bytes have landed is `realized`, and a
write that returns success whose result is then found not to be the expected body
(a concurrent overwrite between the write and the observation, a sentinel
replacement that produced something else) is `unrealized / write-failed`. Reading
it as "the write call raised" would leave the second case unnamed.

Recording `unrealized` from an exception alone would let an operation result
overrule an observation — the same inversion the errno mapping above forbids on the
topology side.

`seq` is the sole ordering authority, and its value domain is frozen so that
"monotonic" is a rule rather than an aspiration:

```
seq            a positive safe integer
first event    seq = 1
next event     seq = previous lastEvent.seq + 1
```

The writer owes this monotonicity. The validator checks only the shape of the last
event's `seq` and, when appending, that the new value is exactly one greater than
the one it read — no scan or replay of interior events, so the frozen validation
scope is untouched.

`recordedAt` participates in the identity
hash — two identical installs are two events — but MUST NOT participate in event
ordering, latest-event selection, deduplication, `current` derivation,
participation, install outcome, runnability verdict, or `[0ce0]` health policy.
Clock drift and manual clock changes cannot reorder events.

### Observation authority boundary

```
Class 1  authority query            ALLOWED / PREFERRED
         ask the system that owns the fact
Class 2  static artifact analysis   ALLOWED
         read, parse, syntax-check; never execute managed semantics
Class 3  artifact execution         FORBIDDEN
         neither the real post-commit nor a substitute
```

Class 3 is not merely risky, it is unavailable: the managed body runs
`plan progress`, `disposition sync` and `dashboard build`, so executing it is a
governance write, and a substitute would only prove things about the substitute.

Therefore, frozen as a naming contract:

> `runnability = satisfied` means **all v1 statically observable Git activation
> prerequisites within this contract were positively established, and no managed
> hook semantics were executed.** It does NOT mean runtime execution was
> demonstrated.

Any future "a real Git event fired and ran it" evidence belongs to a new dimension,
never to a quiet widening of `runnability`.

### Observation primitives

`unrealized` may only be produced by a primitive that preserves error
classification. `existsSync() === false` is never eligible: it collapses
"absent", "unreachable" and "wrong type" into one bit. `realized` requires
symmetric positive proof, not the absence of a negative.

Preserving the errno is necessary but not sufficient — an implementation can see
`EACCES` and still record `unrealized`. The mapping itself is frozen:

```
ENOENT                          → unrealized    / hooks-dir-missing
stat succeeds, not a directory  → unrealized    / hooks-dir-not-directory
any other observation error     → indeterminate / hooks-dir-unobservable
```

Only the first two are positive knowledge that the hook is not there. Everything
else is a failure to observe, and a failure to observe must never be spelled
`unrealized` — that is the original defect, merely relocated. `ENOTDIR` is
deliberately not enumerated: it arrives through the third row unless a controller
establishes which of the first two it actually proves on the host in question.

`fs.chmodSync` failure is operation evidence recorded in `install.chmod`. It is
never an install outcome — the body may be correct regardless — and never a
verdict on its own.

### runnability components

**locator.** Authority: `git rev-parse --path-format=absolute --git-path hooks`.
Capability-based, not version-parsed: if the command is unsupported or fails,
`locator = indeterminate`. Falling back to `git rev-parse --git-path hooks` and
resolving the relative form ourselves is FORBIDDEN — measured, Git resolves it
against the worktree top, and the same query from a subdirectory returns the same
absolute answer, which a hand-rolled `path.join(projectRoot, …)` would get wrong.

The two sides are different quantities and must be brought into one comparison
domain before they are compared at all. The authority returns a **directory**;
`install.targetPath` is a **file**. Comparing them directly would report
`not-satisfied` for an ordinary, correct default installation.

The verdict is the shared **Path identity** primitive applied to the two, mapped
directly:

```
pathIdentity(activeHooksDir, dirname(install.targetPath))

  SAME           → satisfied
  DISTINCT       → not-satisfied
  UNESTABLISHED  → indeterminate / path-comparison-ambiguous

the authority query is unavailable or fails
                 → indeterminate
```

Physical resolution is not defensive programming here; it is a measured false
negative. On Windows, through a directory junction:

```
git -C evo-alias rev-parse --path-format=absolute --git-path hooks
  → …/evo-real/.git/hooks
path.resolve('evo-alias/.git/hooks')
  → …/evo-alias/.git/hooks
fs.realpathSync.native(…)
  → …/evo-real/.git/hooks
```

The strings differ under both case-sensitive and case-insensitive comparison while
naming one directory. Stopping at lexical inequality would report `not-satisfied`
for an ordinary aliased checkout — a fabricated positive claim that Git is using
something else.

`locator` compares against `install.targetPath` and stores no copy of it —
no `expectedPath`, `mutationTarget`, or `configuredTarget`.

**executable.** Only a predicate that has been shown to discriminate may produce a
verdict:

> A predicate qualifies only when positive and negative controllers with
> independent ground truth both exist, and the predicate separates them.

A predicate may not certify itself by declaring its own controller executable.
Two candidates are disqualified by measurement on this host: `fs.statSync().mode`
reports `666` for a hook Git Bash shows as `-rwxr-xr-x` (false negative), and
`fs.accessSync(X_OK)` also passes `README.md` (no discriminating power at all — a
fixture-validity failure, not weak evidence). `core.fileMode` is diagnostic only:
it governs working-tree files, while the hook may live on another filesystem via
`core.hooksPath`, so it may explain an `indeterminate` but must never alone produce
`satisfied` or `not-satisfied`.

v1 requires the qualification gate but does NOT assume a runtime
self-certification mechanism — minting fixtures at observation time (create,
chmod, clean up) would leave Class 2. With no qualified predicate the honest
answer is `executable = indeterminate`, and on Windows that is expected to be the
standing answer. Filling the slot for appearance is forbidden.

**interpreter.** Shebang inspection plus interpreter-aligned syntax-only
validation. A hardcoded `sh -n` for every existing hook is rejected: a valid
`#!/bin/bash` hook would be reported `not-satisfied` for using bash-legal syntax.

```
satisfied       compatible supported interpreter + static syntax accepted
not-satisfied   positively established incompatible or malformed entry
indeterminate   missing / ambiguous interpreter, or no safe parser available
```

Syntax valid ≠ hook executed successfully; the field description must say so.

**Aggregation** is mechanical and lives only in the fact layer:

```
any component not-satisfied   → runnability = not-satisfied
else any indeterminate        → runnability = indeterminate
else                          → satisfied
```

### Producer transaction

**A workspace-scope preflight runs first, before owner resolution.** A nested
target's `--absolute-git-dir` succeeds and returns the enclosing worktree's
git-dir, so an implementation that begins at owner resolution would establish that
owner and create `<outer-git-dir>/evo-lite` before ever noticing the target is
nested — writing into a context it is forbidden to touch. Order is therefore part
of the contract, not an implementation detail:

It is also the gate that first meets a target which is not a Git repository at all,
since `git -C <target> rev-parse --show-toplevel` fails there (exit 128,
*"fatal: not a git repository"*) — the owner query below never gets the chance to
classify it. The gate must therefore be total, and every branch must preserve what
was actually established:

```
0  bind every Git query to the target workspace

1  git -C <target> rev-parse --show-toplevel

   succeeds with a path
     → pathIdentity(target, worktreeTopLevel)
         SAME           → continue to owner resolution
         DISTINCT       → NESTED-TARGET
         UNESTABLISHED  → SCOPE-UNRESOLVED

   git ran and positively reports this is not a repository
     → NO-GIT-ADMIN-TOPOLOGY
     → producer-specific exit, exactly as defined for that state below

   git unavailable, cannot be spawned, or fails for any other reason
     → SCOPE-UNRESOLVED
```

```
SCOPE-UNRESOLVED
  → no provenance owner is resolved, no document is accessed
  → no provenance transaction is performed
  → the hook MUST NOT be mutated — this state fails closed, and unlike
    NESTED-TARGET it grants no legacy-installer exception
  → reported and exits non-zero
```

It is named for what was attempted. Calling it `OWNER-UNRESOLVED` would overstate
the facts: the owner query has not run yet, and a name that claims more than
happened is the failure mode this whole design exists to prevent.

Only after this gate resolves to `SAME` may owner resolution run.

**Owner-resolution preflight runs second, still before any mutation.** The owner
root comes from one authority query, and its failure modes are not interchangeable:

```
git rev-parse --absolute-git-dir

  exits 0 with a path
    → owner root established
    → ensure <owner>/evo-lite exists
    → proceed to mutation

  git ran and reported this is not a repository
    → NO-GIT-ADMIN-TOPOLOGY
    → no provenance document is created
    → hook installation is not attempted
    → exit code is producer-specific, see below

  git unavailable, cannot be spawned, or fails for any other reason
    → OWNER-UNRESOLVED
    → hook installation MUST NOT be attempted
    → reported on stderr and exits non-zero
```

`NO-GIT-ADMIN-TOPOLOGY` is one fact with two legitimate readings, and flattening
them would silently change an existing contract:

```
scaffold on a non-Git target
  → a legitimate environment with no hook container
  → the hook phase is not itself fatal to the scaffold

explicit mem hook install outside a Git repository
  → an explicit command that cannot be fulfilled
  → non-zero, preserving today's behaviour at templates/cli/hooks.js:111-115
```

The environment fact is the same; what differs is whether the caller asked for
something that cannot be delivered. This is stated here rather than left to be
inferred from the generic preflight, precisely because the generic reading would
quietly relax the explicit command.

`OWNER-UNRESOLVED` is not `NO-GIT-ADMIN-TOPOLOGY`, and neither is the reader's
`UNKNOWN`. A document that is absent because no Git administrative context exists,
and a document that is absent because we could not find out, are different facts;
collapsing them would rebuild the very confusion this spec removes, one layer up.

**A read-before-mutate gate runs third, at the same rank, still before any
mutation.** The producer must read the existing document before it can append to
it, and what it finds governs whether it may proceed:

```
ABSENT
  → this workspace has no history
  → the first event may be initialised with seq = 1

VALID
  → continue from the last event

UNOBSERVABLE
  → the existing document MUST NOT be overwritten
  → the hook MUST NOT be mutated
  → the file is left byte-for-byte unchanged
  → reported and exits non-zero
```

The `UNOBSERVABLE` row is the whole point of the gate. The natural implementation —
read fails, treat as empty, start at `seq = 1`, overwrite — converts *"I could not
read the history"* into *"there was never any history"*, which is this debt's
original defect reproduced inside its own remedy. A corrupt document is evidence
that something went wrong and must survive as such; silently replacing it destroys
the only record of it.

All three gates enforce one rule, with exactly one carve-out:

```
NESTED-TARGET
  → the sole deliberate out-of-v1-provenance mutation exception;
    legacy installer behaviour is left unchanged and claims nothing

SCOPE-UNRESOLVED
OWNER-UNRESOLVED
UNOBSERVABLE existing document
provenance-commit failure known before mutation
  → no avoidable hook mutation
```

Everything but the first row is an in-scope or unresolved run that has already
learned its provenance transaction cannot be established or completed, and none of
them may touch the artifact before failing. Creating the owner directory during
preflight — rather than at commit time — is what makes that check load-bearing
instead of decorative. Failures that cannot be foreseen (the disk filling between
preflight and commit) remain governed by the two-dimension reporting rule below.

Order thereafter: mutate the artifact, observe the result, then commit provenance.
The write follows the established idiom at `templates/cli/takeover-install.js:294` —
temp write, read back, schema-validate, fingerprint-compare, `renameSync` — with
cleanup failure surfaced through `AggregateError` rather than swallowed.

**The provenance `rename` is the transaction commit point. After it succeeds, no
fallible business operation or artifact mutation belonging to this invocation may
occur.** The idiom this inherits carries the rule in its own source
(`templates/cli/takeover-install.js:421`, *"原子替换;此后不得再有可失败的业务操作"*),
and the spec must carry it too, or an implementation that appends one more
check-and-write after the rename is formally compliant while reporting failure for
an authoritative transaction that already committed — or worse, mutating the
artifact after the record of it is sealed, so provenance and reality diverge in the
one window nothing is watching.

A no-op invocation MUST still record an event. One invocation commits provenance
exactly once. v1 accepts concurrency loss: two simultaneous installers may lose
one audit event.

Provenance write failure is reported on two orthogonal dimensions with a non-zero
exit. Compressing partial success into exit 0 with a warning is forbidden — the
artifact may have changed while the record of it did not, and that is precisely
the state that must never look like success.

### Reader epistemic states

```
open/stat → ENOENT                                → ABSENT → UNKNOWN  (legacy absence)
open/stat → any other I/O error                   → UNOBSERVABLE
unparseable / not an object                       → UNOBSERVABLE
unrecognised kind or schemaVersion                → UNOBSERVABLE
C-2a, C-2b, C-2c or C-2d fails                    → UNOBSERVABLE      (desynced)
```

The provenance document's own absence is subject to the same rule as the hooks
directory probe: **only a positive `ENOENT` may produce `ABSENT`.** A permission
error, an unreadable mount, or any other I/O failure is a failure to observe and
reads `UNOBSERVABLE`. `existsSync()` returning false is never sufficient on its own
— it would collapse "not there" and "could not look" into one bit, at the one place
where that collapse becomes `UNKNOWN`, the state this whole design exists to stop
from being manufactured.

`UNOBSERVABLE` is the reader's epistemic state about the document. It is distinct
from `indeterminate`, which is a component's verdict inside a well-formed document.
The two must never be spelled with one word.

Both are distinct again from the four **topology states** — `NO-GIT-ADMIN-TOPOLOGY`,
`SCOPE-UNRESOLVED`, `NESTED-TARGET`, `OWNER-UNRESOLVED` — which are decided before
any document is opened and describe whether this target has a provenance context at
all. A topology state must never be reported as a document state: none of them may
become `UNKNOWN` or `UNOBSERVABLE`, because both of those are claims about a
document this target was entitled to read. The six states are mutually exclusive.

Producer and reader share one `validateHookProvenanceV1()` — the lesson recorded at
`templates/cli/takeover-install.js:281`, where a split shape contract lets a writer
publish a document its own reader rejects. Its validation scope is frozen as
exactly three regions:

```
top-level     kind, schemaVersion
current       shape, participation enum
last event    shape, seq shape, id recomputation from the 20-slot projection,
              conditional install/runnability presence,
              controlled-vocabulary membership,
              reason-null-iff-satisfied,
              runnability.verdict == mechanical aggregation of its components
              intent.source ↔ intent.participation coherence
plus          events non-empty, C-2a, C-2b, C-2c, C-2d
```

Recomputing the aggregation is required, not optional. Checking only that the four
verdicts are individually legal members would let a document assert
`satisfied` over a `not-satisfied` component — a stored verdict silently
overriding the rule that produced it.

It does NOT inspect interior events at all. Tampering with, reordering, or writing
an unrecognised vocabulary member into an interior event degrades the audit trail
and is intentionally not detected; it does not change the reader's state. The
unknown-member rule above and this exclusion are one contract, not two competing
ones: unknown members matter exactly where validation reaches.

## Out of scope

- **`[0ce0]` health policy.** Whether `participating + realized + runnability
  not-satisfied` is DEGRADED or UNHEALTHY is `[0ce0]`'s ruling, not this layer's.
- **`[hook-runtime-runnability]`** — a separate installer-correctness concern
  **identified by this design and not yet registered**; it must be registered as its
  own backlog debt before it can be worked. Verified on this baseline: no such entry
  exists in the durable backlog. Two confirmed contract gaps:
  (A) appending the managed block into an existing hook
  inherits that file's interpreter, so a `#!/usr/bin/env python` hook yields a
  byte-correct block that `diffInstalledHook` still reports `in-sync`; (B) the
  installer and diff hardcode `.git/hooks` while `core.hooksPath` may redirect Git
  elsewhere. This spec observes and records both; it repairs neither. Priority is
  deliberately not set here.
- **`dashboard-data.js:15` `hasManagedPostCommitHook()`** — the second weaker
  authority. Registered, not touched.
- Repairing, reinstalling, or rewriting any hook.

## Cost accepted

- `executable` is expected to stand at `indeterminate` on Windows for all of v1.
  This is the fact layer refusing to fake an answer it does not have.
- Concurrent installers may lose one audit event.
- A complete, internally consistent provenance document manually copied from
  another Git admin directory cannot prove it came from elsewhere. This is the same
  external-replacement limitation already accepted for wholesale substitution of an
  older self-consistent copy; no `projectRoot` field or hash chain is reintroduced
  to chase it.
- The producer writes inside `.git/` outside `hooks/`.
- Manually copying a provenance document between Git administrative contexts has no
  strong identity defence in v1. This limitation must be stated, never described as
  solved.

## Acceptance Criteria

```json
{
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "description": "The provenance document is stored at <git rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json. The path is obtained from that authority query alone; no code joins projectRoot with '.git', and the document carries no projectRoot, gitDir, commonDir, or root-commit identity field. Two linked worktrees of one repository hold separate documents. A target whose path identity against git rev-parse --show-toplevel is DISTINCT is NESTED-TARGET: it neither reads nor writes the enclosing worktree's document and creates no owner directory there, so scaffolding a nested second project cannot alter the participation the enclosing worktree already recorded. NESTED-TARGET is reported as a topology state and never as UNKNOWN or UNOBSERVABLE. A target reached through a junction or symlink alias of the worktree root resolves as SAME and is therefore in scope, not nested.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac2",
      "description": "current holds participation only, with values participating or non-participating, and it is derived from intent rather than from install.outcome. A document whose latest event is scaffold-no-hooks reads non-participating; a subsequent hook-install-command event makes it participating even when that event's outcome is unrealized or indeterminate; and no install outcome ever downgrades participating to non-participating. install.outcome admits exactly realized, unrealized, indeterminate. The conditional shape is enforced in both directions: non-participating events carry neither install nor runnability, participating events carry install, realized events carry runnability, and unrealized or indeterminate events carry no runnability.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac3",
      "description": "Integrity holds as C-1, C-2a, C-2b, C-2c and C-2d: the document is replaced atomically as a whole; current.derivedFrom equals the last event id; sha256 over the canonical projection of current.participation alone equals lastEvent.resultingCurrentDigest; current.participation equals lastEvent.intent.participation; and the last event's intent.source and intent.participation are coherent, with scaffold-no-hooks paired only to non-participating and scaffold-default or hook-install-command paired only to participating. Two documents that satisfy every other rule are rejected as UNOBSERVABLE: one whose participating current sits over a non-participating last event with a correctly recomputed digest and derivedFrom, and one whose last event pairs hook-install-command with non-participating. No current.digest field exists, and current.derivedFrom does not participate in that digest.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac4",
      "description": "event.id is sha256 over JSON.stringify of the frozen 20-slot canonical projection, in the exact order the spec lists, with every field absent under the conditional shape contributing null so the array length is constant across event kinds. id itself, the whole of diagnostic, and free-text error messages are excluded, and no machine-random UUID participates. seq is a positive safe integer, is 1 on the first event, and each appended event carries exactly one more than the event it was appended to; the validator checks that shape on the last event without scanning interior events. seq is the only ordering authority: a document whose recordedAt values run backwards still yields the same latest event, the same current derivation, and the same verdicts as one whose timestamps ascend.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac5",
      "description": "unrealized is produced only by an errno-preserving observation primitive, and the frozen phase mapping is enforced in full. In phase 1, before any write is issued: ENOENT on the hooks directory yields unrealized with reason hooks-dir-missing, a successful stat of a non-directory yields unrealized with reason hooks-dir-not-directory, any other hooks-directory error yields indeterminate with reason hooks-dir-unobservable, and an unreadable existing hook yields indeterminate with reason pre-write-observation-failed — never post-write-observation-failed, and every phase-1 outcome carries no chmod because no write was issued. A permission error such as EACCES therefore never yields unrealized. In phases 2 and 3 the write was issued and every outcome carries chmod: a write that throws after its bytes landed yields realized, a final state that cannot be established yields indeterminate with reason post-write-observation-failed, and the expected managed body positively proven not established yields unrealized with reason write-failed — which is scoped to the write phase rather than to the exception, so it also covers a write that returned success whose result is then found not to be the expected body, and a failed update leaving an older managed body in place, so the criterion is not satisfied by testing physical absence alone. existsSync returning false can never produce unrealized, and realized requires positive proof rather than absence of a negative. A chmod failure is recorded in install.chmod and changes neither install.outcome nor any runnability verdict. No already-current reason exists in v1.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac6",
      "description": "locator is decided from git rev-parse --path-format=absolute --git-path hooks, and the comparison is made in one domain: the canonicalised active hooks directory against the canonicalised dirname of install.targetPath, never against the file path itself. The verdict is the shared path-identity primitive mapped as SAME to satisfied, DISTINCT to not-satisfied, and UNESTABLISHED to indeterminate with reason path-comparison-ambiguous. Exact canonical equality is the only lexical shortcut: paths differing only in case are NOT treated as equal but are sent to physical resolution, so on a case-sensitive filesystem two really distinct directories named Foo and foo yield not-satisfied rather than satisfied, while Windows drive-letter and component case differences still reach satisfied by resolving to the same real path. No branch keys off process.platform, and no lexical difference by itself yields not-satisfied. A checkout reached through a directory junction or symlink, where Git answers with the real path and Node resolves the alias, yields satisfied. not-satisfied is reserved for a positively established distinct active location, which a core.hooksPath redirected to a genuinely different directory produces. locator stores no copy of the target path. When the command is unsupported or fails the verdict is indeterminate; no code falls back to git rev-parse --git-path hooks and resolves a relative result itself.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac7",
      "description": "executable produces satisfied or not-satisfied only through a predicate that passed the qualification gate against independent positive and negative controllers; otherwise it is indeterminate with reason no-qualified-predicate. fs.accessSync with X_OK appears nowhere as executable evidence, core.fileMode appears only under diagnostic, and no observation-time fixture is created, chmod-ed, or deleted to manufacture a controller.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac8",
      "description": "interpreter is decided by shebang inspection plus interpreter-aligned syntax-only validation: a valid bash hook with bash-only syntax is not reported not-satisfied, an incompatible interpreter family is, and a missing or ambiguous shebang yields indeterminate. runnability has no top-level reason and its verdict is the frozen mechanical aggregation of the three components. No managed hook semantics are executed anywhere in the observation path.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac9",
      "description": "The producer mutates, observes, then commits provenance through the temp-write, read-back, schema-validate, fingerprint-compare, rename idiom, records an event even for a no-op invocation, and commits exactly once per invocation. The rename is the commit point: no fallible business operation and no artifact mutation belonging to the invocation occurs after it returns, verified by a mutation that injects a throwing step immediately after the rename and must be shown to have no post-rename step to attach to. When the artifact changed but provenance could not be committed, the command reports the two dimensions separately and exits non-zero.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac10",
      "description": "A single validateHookProvenanceV1 is used by both producer and reader, and its scope is exactly the top level, current, and the last event. Only a positive ENOENT on the document makes it ABSENT and therefore UNKNOWN; any other I/O error reading it, and existsSync alone in place of an errno-preserving probe, must not produce UNKNOWN. An unparseable document, an unrecognised kind or schemaVersion, an unrecognised controlled-vocabulary member in current or the last event, a component reason that is non-null on satisfied or absent on a non-satisfied verdict, a runnability.verdict that does not equal the mechanical aggregation of its own components, and a C-2a, C-2b, C-2c or C-2d failure each read UNOBSERVABLE. The same violations written into an interior event leave the reader state unchanged, because interior events are not inspected. UNOBSERVABLE and indeterminate remain distinct vocabularies, and a scaffold with no Git administrative container produces no document rather than a non-participating one.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac11",
      "description": "A --no-hooks option is the sole authority for explicit non-participation and, whenever the target has an established in-scope provenance context — workspace scope SAME and owner established — is durably recorded as intent.source scaffold-no-hooks with participation non-participating. The precondition is in-scope ownership, not the mere presence of a nearby .git: on a target that is not a Git repository scaffolded with --no-git, and on a nested target whose enclosing worktree owns the only container, the opt-out is honoured for that run but produces no provenance document, and no .git is created in order to store one. Under SCOPE-UNRESOLVED or OWNER-UNRESOLVED the opt-out cannot be durably recorded and the run fails closed instead. It is not the sole authority for participation: scaffold-default and hook-install-command both produce participating intent. --no-git retains its narrow meaning of skipping git init only and never determines participation, expressed as a reverse property: holding the Git topology fixed, toggling --no-git does not suppress hook participation or the install attempt. What that attempt then realizes remains decided by topology and observation, so the criterion asserts nothing about outcome.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac12",
      "description": "Within a present install object, targetPath records the intended mutation target and is present on every outcome including unrealized, expectedBodyDigest appears only when the outcome is realized, and chmod is present if and only if the hook write was issued: it is absent on every phase-1 outcome and present on every phase-2/3 outcome. diagnostic is optional on every event, is permitted on non-participating events, and never feeds any verdict. Every reason value used anywhere belongs to the v1 vocabulary fixed by this spec, and no vocabulary member originates in the implementation.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac13",
      "description": "A workspace-scope preflight runs before owner resolution and is total. When git rev-parse --show-toplevel succeeds, the target is compared to it by path identity: SAME continues, DISTINCT is NESTED-TARGET, and UNESTABLISHED is SCOPE-UNRESOLVED — NESTED-TARGET is reachable from DISTINCT alone, so injecting a realpath failure yields SCOPE-UNRESOLVED and never NESTED-TARGET. When git positively reports the target is not a repository the state is NO-GIT-ADMIN-TOPOLOGY with its producer-specific exit, never swallowed into SCOPE-UNRESOLVED or NESTED-TARGET. When git is unavailable or the query fails for any other reason the state is SCOPE-UNRESOLVED, reported with a non-zero exit. Every non-SAME branch short-circuits before any owner is resolved, before any owner directory is created, and before any document is opened — verified by asserting that no evo-lite directory appears under the enclosing worktree's git-dir after scaffolding a nested target. NESTED-TARGET and SCOPE-UNRESOLVED share that stopping point and no more: NESTED-TARGET leaves legacy installer behaviour unchanged, whereas SCOPE-UNRESOLVED fails closed and mutates no hook, verified by injecting a realpath failure and asserting the hook file is byte-identical before and after — or absent throughout — so that no run ever changes the artifact while unable to record it. Owner resolution then runs as a preflight before any hook mutation and separates three outcomes. When git rev-parse --absolute-git-dir succeeds the owner root is established and its evo-lite subdirectory is created during preflight. When git reports the target is not a repository the run is NO-GIT-ADMIN-TOPOLOGY: no document and no install attempt, and the exit code is producer-specific — a scaffold run does not fail on the hook phase, while an explicit mem hook install outside a Git repository still exits non-zero as it does today. When git is unavailable or fails for any other reason the run is OWNER-UNRESOLVED: the hook is not mutated at all, the condition is reported, and the exit code is non-zero. Except for the deliberate NESTED-TARGET legacy-installer exception, which is the sole out-of-v1-provenance mutation carve-out, any in-scope or unresolved run that cannot establish or complete its provenance transaction performs no avoidable hook mutation before failing. The six states are mutually exclusive with no code path collapsing any pair: the four topology states NO-GIT-ADMIN-TOPOLOGY, SCOPE-UNRESOLVED, NESTED-TARGET and OWNER-UNRESOLVED, and the two document states UNKNOWN and UNOBSERVABLE. In particular no topology state is ever reported as UNKNOWN or UNOBSERVABLE.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac14",
      "description": "A read-before-mutate gate runs before any hook mutation. An absent document permits initialising the first event at seq 1; a valid document is continued from its last event; an UNOBSERVABLE document stops the run — the hook is not mutated, the existing file is left byte-for-byte identical as verified by digest before and after, the condition is reported, and the exit code is non-zero. No path treats an unreadable document as empty history, and no path renumbers a continuing document back to seq 1.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac15",
      "description": "Every Git authority query is bound to the workspace being operated on, via git -C or an equivalent cwd, and never to the process working directory. The controller is A to B: running the scaffold from inside repository A against a target path in repository B resolves B's git-dir as the provenance owner and B's active hooks directory as the locator answer, and writes no provenance into A. No Git authority or provenance-observation invocation defined by this contract omits the target binding; Git commands inside the managed hook body are out of scope, since they run in the working directory Git sets for the hook.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac16",
      "description": "One controller exercises the pre-write phase end to end and proves both halves at once. Starting from a document whose current is non-participating, an explicit hook-install-command runs against a workspace where reading the existing post-commit fails with EACCES. The hook file is byte-identical before and after; chmod is never called; exactly one event is committed; that event carries intent participating with source hook-install-command, install outcome indeterminate with reason pre-write-observation-failed, no chmod, no expectedBodyDigest and no runnability; and current becomes participating. A failed observation is therefore never dressed as a write, and a failed install never swallows the intent that superseded an earlier opt-out.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    }
  ]
}
```
