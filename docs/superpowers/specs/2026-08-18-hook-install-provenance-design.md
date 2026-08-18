---
id: spec:hook-install-provenance
status: draft
created: 2026-08-18
---

# Spec: Hook install provenance — record what happened, never repair it

**Date:** 2026-08-18
**Backlog:** `[hook-install-provenance]`, prerequisite of `[0ce0] verify-hook-runtime-health`
**Architecture:** A′ — two orthogonal axes, `provenance × live observation`. Frozen by the human. Alternative B (single health signal) and C (environment-classifier rows) were considered and rejected.

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
registered as the separate debt `[hook-runtime-runnability]` (see Out of scope).

## Design

### Storage and ownership

The provenance document lives in the current worktree's Git administrative
context, at:

```
<git rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json
```

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
- `chmod` is present whenever a write was attempted, absent otherwise

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
`diagnostic.predicateQualification` admits `qualified` and `unavailable` only;
being diagnostic, it feeds no verdict and is not validated as a gate.

An unrecognised member of any controlled vocabulary makes the document
`UNOBSERVABLE` rather than being passed through — within the validation scope
frozen under "Reader epistemic states", which does not include interior events.

### Integrity

```
C-1   events + current are replaced as one atomic whole-file write
C-2a  current.derivedFrom == lastEvent.id
C-2b  sha256(JSON.stringify([current.participation])) == lastEvent.resultingCurrentDigest
```

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
                 | appended-managed-block | already-current
  unrealized     hooks-dir-missing | hooks-dir-not-directory | write-failed
  indeterminate  hooks-dir-unobservable | post-write-observation-failed

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

`seq` is the sole ordering authority. `recordedAt` participates in the identity
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

```
canon(p) = path.resolve(p), every '\' replaced by '/', any trailing '/' removed

satisfied       canon(activeHooksDir) === canon(path.dirname(install.targetPath))
not-satisfied   they differ, and still differ when compared case-insensitively
indeterminate   they are equal only under case-insensitive comparison
                → reason path-comparison-ambiguous
indeterminate   the authority query is unavailable or fails
```

The case rule exists because Windows paths may differ only in drive-letter or
component case between what Git canonicalises and what Node resolves. Deciding
that by sniffing `process.platform` would re-introduce a platform constant where a
fact is needed, so a difference we cannot establish becomes `indeterminate` —
never a manufactured `not-satisfied`.

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

**Owner-resolution preflight runs before any mutation.** The owner root comes from
one authority query, and its failure modes are not interchangeable:

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
    → exit 0; this is a legitimate environment, not a failure

  git unavailable, cannot be spawned, or fails for any other reason
    → OWNER-UNRESOLVED
    → hook installation MUST NOT be attempted
    → reported on stderr and exits non-zero
```

`OWNER-UNRESOLVED` is not `NO-GIT-ADMIN-TOPOLOGY`, and neither is the reader's
`UNKNOWN`. A document that is absent because no Git administrative context exists,
and a document that is absent because we could not find out, are different facts;
collapsing them would rebuild the very confusion this spec removes, one layer up.

The preflight exists to obey one rule: **when it is already known that the
provenance transaction cannot complete, no avoidable hook mutation may be
performed first.** Creating the owner directory during preflight — rather than at
commit time — is what makes the check load-bearing instead of decorative. Failures
that cannot be foreseen (the disk filling between preflight and commit) remain
governed by the two-dimension reporting rule below.

Order thereafter: mutate the artifact, observe the result, then commit provenance.
The write follows the established idiom at `templates/cli/takeover-install.js:294` —
temp write, read back, schema-validate, fingerprint-compare, `renameSync` — with
cleanup failure surfaced through `AggregateError` rather than swallowed.

A no-op invocation MUST still record an event. One invocation commits provenance
exactly once. v1 accepts concurrency loss: two simultaneous installers may lose
one audit event.

Provenance write failure is reported on two orthogonal dimensions with a non-zero
exit. Compressing partial success into exit 0 with a warning is forbidden — the
artifact may have changed while the record of it did not, and that is precisely
the state that must never look like success.

### Reader epistemic states

```
document absent                                   → UNKNOWN        (legacy absence)
unparseable / not an object                       → UNOBSERVABLE
unrecognised kind or schemaVersion                → UNOBSERVABLE
C-2a or C-2b fails                                → UNOBSERVABLE   (desynced)
```

`UNOBSERVABLE` is the reader's epistemic state about the document. It is distinct
from `indeterminate`, which is a component's verdict inside a well-formed document.
The two must never be spelled with one word.

Producer and reader share one `validateHookProvenanceV1()` — the lesson recorded at
`templates/cli/takeover-install.js:281`, where a split shape contract lets a writer
publish a document its own reader rejects. Its validation scope is frozen as
exactly three regions:

```
top-level     kind, schemaVersion
current       shape, participation enum
last event    shape, id recomputation from the 20-slot projection,
              conditional install/runnability presence,
              controlled-vocabulary membership,
              reason-null-iff-satisfied,
              runnability.verdict == mechanical aggregation of its components
plus          events non-empty, C-2a, C-2b
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
      "description": "The provenance document is stored at <git rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json. The path is obtained from that authority query alone; no code joins projectRoot with '.git', and the document carries no projectRoot, gitDir, commonDir, or root-commit identity field. Two linked worktrees of one repository hold separate documents.",
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
      "description": "Integrity holds as C-1, C-2a and C-2b: the document is replaced atomically as a whole; current.derivedFrom equals the last event id; and sha256 over the canonical projection of current.participation alone equals lastEvent.resultingCurrentDigest. No current.digest field exists, and current.derivedFrom does not participate in that digest.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac4",
      "description": "event.id is sha256 over JSON.stringify of the frozen 20-slot canonical projection, in the exact order the spec lists, with every field absent under the conditional shape contributing null so the array length is constant across event kinds. id itself, the whole of diagnostic, and free-text error messages are excluded, and no machine-random UUID participates. seq is the only ordering authority: a document whose recordedAt values run backwards still yields the same latest event, the same current derivation, and the same verdicts as one whose timestamps ascend.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac5",
      "description": "unrealized is produced only by an errno-preserving observation primitive, and the frozen mapping is enforced: ENOENT yields unrealized with reason hooks-dir-missing, a successful stat of a non-directory yields unrealized with reason hooks-dir-not-directory, and every other observation error yields indeterminate with reason hooks-dir-unobservable. A permission error such as EACCES therefore never yields unrealized. existsSync returning false can never produce unrealized, and realized requires positive proof rather than absence of a negative. A chmod failure is recorded in install.chmod and changes neither install.outcome nor any runnability verdict.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac6",
      "description": "locator is decided from git rev-parse --path-format=absolute --git-path hooks, and the comparison is made in one domain: the canonicalised active hooks directory against the canonicalised dirname of install.targetPath, never against the file path itself. An ordinary default installation on Windows, where Git returns forward slashes and Node resolves backslashes, yields satisfied. Paths equal only under case-insensitive comparison yield indeterminate with reason path-comparison-ambiguous rather than not-satisfied, and no branch keys off process.platform. locator stores no copy of the target path. When the command is unsupported or fails the verdict is indeterminate; no code falls back to git rev-parse --git-path hooks and resolves a relative result itself. A worktree whose core.hooksPath points elsewhere yields locator not-satisfied.",
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
      "description": "The producer mutates, observes, then commits provenance through the temp-write, read-back, schema-validate, fingerprint-compare, rename idiom, records an event even for a no-op invocation, and commits exactly once per invocation. When the artifact changed but provenance could not be committed, the command reports the two dimensions separately and exits non-zero.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac10",
      "description": "A single validateHookProvenanceV1 is used by both producer and reader, and its scope is exactly the top level, current, and the last event. An absent document reads UNKNOWN; an unparseable document, an unrecognised kind or schemaVersion, an unrecognised controlled-vocabulary member in current or the last event, a component reason that is non-null on satisfied or absent on a non-satisfied verdict, a runnability.verdict that does not equal the mechanical aggregation of its own components, and a C-2a or C-2b failure each read UNOBSERVABLE. The same violations written into an interior event leave the reader state unchanged, because interior events are not inspected. UNOBSERVABLE and indeterminate remain distinct vocabularies, and a scaffold with no Git administrative container produces no document rather than a non-participating one.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac11",
      "description": "A --no-hooks option is the sole authority for explicit non-participation and is recorded as intent.source scaffold-no-hooks with participation non-participating. It is not the sole authority for participation: scaffold-default and hook-install-command both produce participating intent. --no-git retains its narrow meaning of skipping git init only and never determines participation, expressed as a reverse property: holding the Git topology fixed, toggling --no-git does not suppress hook participation or the install attempt. What that attempt then realizes remains decided by topology and observation, so the criterion asserts nothing about outcome.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac12",
      "description": "Within a present install object, targetPath records the intended mutation target and is present on every outcome including unrealized, expectedBodyDigest appears only when the outcome is realized, and chmod appears only when a write was attempted. diagnostic is optional on every event, is permitted on non-participating events, and never feeds any verdict. Every reason value used anywhere belongs to the v1 vocabulary fixed by this spec, and no vocabulary member originates in the implementation.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac13",
      "description": "Owner resolution runs as a preflight before any hook mutation and separates three outcomes. When git rev-parse --absolute-git-dir succeeds the owner root is established and its evo-lite subdirectory is created during preflight. When git reports the target is not a repository the run is NO-GIT-ADMIN-TOPOLOGY: no document, no install attempt, exit zero. When git is unavailable or fails for any other reason the run is OWNER-UNRESOLVED: the hook is not mutated at all, the condition is reported, and the exit code is non-zero. A run that cannot record provenance never performs an avoidable hook mutation first, and OWNER-UNRESOLVED, NO-GIT-ADMIN-TOPOLOGY, and the reader's UNKNOWN are three distinct states that no code path collapses.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    }
  ]
}
```
