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
obligation. An event records how one installation attempt went. A failed attempt
must never rewrite `participation` — otherwise an action that did not succeed
impersonates an action that was never required.

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
no such relationship exists. Participation gets its own authority, `--no-hooks`.

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

`install.reason`, and each component's `reason`, are likewise controlled enums
fixed by the implementation and validated by the shared validator; an unrecognised
member makes the document `UNOBSERVABLE` rather than being passed through.
`diagnostic.predicateQualification` admits `qualified` and `unavailable` only.

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

`event.id` is `sha256:<hex>` over a canonical projection of the event:

```
[ kind, schemaVersion, seq, recordedAt,
  intent.participation, intent.source,
  install authoritative fields      (when present),
  runnability authoritative fields  (when present),
  resultingCurrentDigest ]
```

Excluded from the projection: `id` itself, `diagnostic`, and any free-text error
message. No machine-random UUID participates in identity.

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

```
satisfied       active hooks directory == install.targetPath
not-satisfied   Git positively reports a different active directory
indeterminate   the authority query is unavailable or fails
```

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

Order: mutate the artifact, observe the result, then commit provenance. The write
follows the established idiom at `templates/cli/takeover-install.js:294` —
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
publish a document its own reader rejects. It validates top-level kind and schema,
`current` shape, non-empty events, last-event shape, last-event id recomputation,
C-2a, C-2b, conditional install/runnability shape, and controlled enums.

It does NOT deep-verify middle events. Tampering with or reordering interior events
degrades the audit trail and is intentionally not detected.

## Out of scope

- **`[0ce0]` health policy.** Whether `participating + realized + runnability
  not-satisfied` is DEGRADED or UNHEALTHY is `[0ce0]`'s ruling, not this layer's.
- **`[hook-runtime-runnability]`** — a separate installer-correctness debt with two
  confirmed contract gaps: (A) appending the managed block into an existing hook
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
- Manual copying of an ignored provenance file across workspaces has no strong
  identity defence in v1. This limitation must be stated, never described as solved.

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
      "description": "current holds participation only, with values participating or non-participating. A failed or indeterminate install never changes participation. install.outcome admits exactly realized, unrealized, indeterminate. The conditional shape is enforced in both directions: non-participating events carry neither install nor runnability, participating events carry install, realized events carry runnability, and unrealized or indeterminate events carry no runnability.",
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
      "description": "event.id is a sha256 over the frozen canonical projection, excluding id itself, diagnostic, and free-text error messages, with no machine-random UUID. seq is the only ordering authority: a document whose recordedAt values run backwards still yields the same latest event, the same current derivation, and the same verdicts as one whose timestamps ascend.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac5",
      "description": "unrealized is produced only by an errno-preserving observation primitive; existsSync returning false can never produce it, and realized requires positive proof rather than absence of a negative. A chmod failure is recorded in install.chmod and changes neither install.outcome nor any runnability verdict.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac6",
      "description": "locator is decided from git rev-parse --path-format=absolute --git-path hooks, compared against install.targetPath, and stores no copy of that path. When the command is unsupported or fails the verdict is indeterminate; no code falls back to git rev-parse --git-path hooks and resolves a relative result itself. A worktree whose core.hooksPath points elsewhere yields locator not-satisfied.",
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
      "description": "A single validateHookProvenanceV1 is used by both producer and reader. An absent document reads UNKNOWN; an unparseable document, an unrecognised kind or schemaVersion, an unrecognised controlled-enum member, and a C-2a or C-2b failure each read UNOBSERVABLE. UNOBSERVABLE and indeterminate remain distinct vocabularies, and a scaffold with no Git administrative container produces no document rather than a non-participating one.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac11",
      "description": "A --no-hooks option is the sole authority for hook participation and is recorded as intent.source scaffold-no-hooks with participation non-participating. --no-git retains its narrow meaning of skipping git init only and never determines participation: scaffolding an existing Git repository with --no-git still installs the hook and still records a participating event.",
      "dependsOn": ["index.js", "templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac12",
      "description": "Within a present install object, targetPath is present on every outcome including unrealized, expectedBodyDigest appears only when the outcome is realized, and chmod appears only when a write was attempted. diagnostic is optional on every event, is permitted on non-participating events, and never feeds any verdict.",
      "dependsOn": ["templates/cli/hooks.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    }
  ]
}
```
