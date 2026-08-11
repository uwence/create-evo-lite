---
id: spec:disposition-ledger
status: draft
created: 2026-08-11
linkedPlan: plan:disposition-ledger
---

# Spec: Disposition Ledger

**Date:** 2026-08-11
**Layer:** 2 of the 3-layer portfolio cleanup sequence (layer 1 = `spec:spec-status-vocabulary`, shipped at `main@e7488aa`)

## Problem

Evo-Lite can detect governance problems but cannot record the decision *not to act on one*. Every consumer of a finding therefore re-derives that decision from scratch, and the only place a decision can currently live is an out-of-band verbal instruction to whoever is holding the session.

Measured consequences on this repo and its child:

- 4 zombie-plan + 3 size-exceeded warnings on the mother that are all registered defects, not actionable work — yet they present identically to real work.
- 79 `R008` findings, none of which has ever been dispositioned because there is nowhere to put the disposition.
- A `budget-exceeded` gate on CodePLC whose answer (`resume-authorized-execution`) is written in the focus text, where the observer cannot read it, so it keeps demanding a choice that was already made.

The system offers a way to *silence* a finding (`sizeWaiver`, threshold config) but no way to *explain* one. Silencing hides the defect; explaining preserves it. This spec builds the second.

## The primitive

```text
finding      = machine-observed fact
disposition  = human/agent governance decision
fingerprint  = validity boundary
git          = decision persistence
stale        = automatic reactivation
```

Once this exists, no future governance surface needs to invent its own
`waiver` / `ignore` / `exception` / `acknowledged` state.

**Architectural boundary this establishes:**

> Fact caches may be lost; human governance decisions may not.

`freeze-ledger.json` is derived evidence — rebuildable, gitignored. The disposition ledger is a decision record — non-reconstructable, version-controlled. The two must never be stored the same way.

## Non-goals

- Not a suppression switch. Nothing is removed from any finding collection.
- Does not change any detection rule. Layer 1's lesson: make state honest before changing judgement. Repairing the registered defects (`size-gate-state-blindness`, `zombie-plan-parked-deadlock`, `progress-empty-evidence-vacuous-pass`) is out of scope.
- Does not delete files. That is layer 3.

## 1. Finding ID contract

Every finding carries a stable id:

```text
<ruleId>:<subjectType>:<subjectId>[:<instanceKey>]
```

```text
zombie-plan:spec:codegraph-adapter-governance-linker
unknown-status:spec:codeplc-foundation-design
size-exceeded:spec:evo-code-perception-foundation:acCount
size-exceeded:spec:evo-code-perception-foundation:chars
R005:task:zvec-win-unicode-containment-t8
R008:task:portfolio-registry-core
R011:spec:governance-observation-budget
```

**Governing principle: one independently dispositionable fact = one id.**

`instanceKey` exists precisely so that a spec breaching several size dimensions yields several ids. Collapsing them into one `size-exceeded:spec:X` would force three separate governance decisions through a single act of consent — accepting the `chars` overrun would silently accept the `acCount` overrun too.

Spec warnings are currently bare strings on the registry entry and have no id at all. Producing these ids is a prerequisite of this layer, not an implementation detail.

## 2. Fingerprint

```text
fingerprint = sha256(canonicalJson({ ruleId, ruleVersion, factInputs }))
```

`factInputs` is declared **by the producer**, never by the ledger. The ledger has no knowledge of any rule's semantics; it hashes and compares. A new finding type is added by declaring its inputs, with no ledger change.

**Spec-portfolio findings:**

| finding | canonical id | factInputs | invalidated when |
|---|---|---|---|
| `unknown-status` | `unknown-status:spec:<id>` | `declaredStatus` | the status word changes |
| `zombie-plan` | `zombie-plan:spec:<id>` | `notDonePlans[]` | any linked plan completes |
| `size-exceeded` | `size-exceeded:spec:<id>:<dim>` | `dimension`, `value`, `threshold`, `state` | that dimension or the spec state changes |
| `aging-no-plan` / `aging-inactive` | `<rule>:spec:<id>` | `lastTouchedAt` | the file is touched at all |

**Planning-gap findings — all ten rules `gaps.js` currently emits.** Four already
satisfy the schema because the subject id is itself prefixed (`task:x`, `spec:x`,
`plan:x`); the other six require an id migration as part of this layer.

| rule | canonical id | factInputs | migration |
|---|---|---|---|
| `R003` no-specs | `R003:repo:specs` | `{}` | from bare `R003` |
| `R004` no-plans | `R004:repo:plans` | `{}` | from bare `R004` |
| `R005` no-linked-files | `R005:task:<id>` | `{}` | — already conforms |
| `R006` unlinked-file | `R006:file:<path>` | `changeDigest` | from `R006:<path>` |
| `R008` no-evidence | `R008:task:<id>` | `taskStatus`, `archiveHits` | — already conforms |
| `R009` stale-ir | `R009:ir:<plan\|architecture>` | `{}` | from `R009:<label>` |
| `R010` untracked-backlog | `R010:backlog:<label>` | `itemTextDigest` | from `R010:<first 40 chars>` |
| `R011` spec-status-drift | `R011:spec:<id>` | `specStatus`, `taskStatuses[]` | — already conforms |
| `R012` phantom-focus | `R012:plan:<id>` | `planStatus`, `doneCount`, `totalCount` | — already conforms |
| `R013` context drift | `R013:context:head` / `R013:context:sync` | see §2.2 | from `R013:head` / `R013:sync` |

Three entries encode a governance decision rather than a mechanical mapping, and
are called out because they are not recoverable from the code:

**`R006` carries `changeDigest`.** The finding says "this file's changes are not
covered by any task". Keying only on the path would let one `accepted-debt` exempt
every future change to that file forever — a permanent blanket waiver granted by a
decision made about one specific diff. Including the digest of the inspected
content means a further unlinked change re-enters as `STALE` and must be restated.
The cost is real: an actively churning unlinked file will demand repeated
statements. That is the correct pressure — the fix is to link the file, not to
mute it once.

**`R009` and `R005` carry empty `factInputs` deliberately.** Their condition is
purely "this absence exists", and mtime must never enter a fingerprint because it
is not stable across clones — the one property §2.1 exists to protect. They expire
through the `ORPHANED` path instead: run the scan, the finding disappears, the entry
is tombstoned, and a later recurrence therefore requires a fresh decision. This
gives exactly the intended behaviour without a single unstable input.

**`R010` keys on the bracketed backlog label**, not on the first 40 characters of
prose. Text-prefix ids fracture on any rewording, silently orphaning the old
decision and demanding a new one for what is the same item. Items with no label
fall back to a digest of the full normalized text.

### 2.1 Canonicalization

Required, or the same facts hash differently across machines and runs:

- object keys sorted lexically
- arrays with set semantics sorted before hashing
- paths normalized to `/`
- enums as their canonical value
- timestamps as UTC ISO-8601

Explicitly **excluded** from `factInputs`:

- display text (a message reword must not invalidate decisions)
- absolute machine paths
- file mtimes (they do not survive a clone)
- ambient `HEAD`
- the current time

`factInputs` describes only the governance facts on which the finding stands.

### 2.2 Ambient git state vs. git state as evidence

The `HEAD` exclusion above bars **ambient** git position. For nearly every rule
`HEAD` is not a premise, so admitting it would invalidate every disposition in the
repository on each commit — the noise mode this whole design exists to avoid.

`R013` is the exception that proves the boundary: its premise *is* a git-value
comparison. It is resolved by admitting only the **declared** value — the sha and
counters written into `active_context.md`, which are document content — and never
the live value read from the repository:

| finding | factInputs | rationale |
|---|---|---|
| `R013:context:head` | `declaredHeadSha` | the staleness belongs to the recorded value; refreshing META changes it, and every unrelated commit does not |
| `R013:context:sync` | `declaredAhead`, `declaredBehind` | same, for the counters |

Rule of thumb: **if a value is a premise of the rule, it is a fact input; if it is
merely the environment the rule ran in, it is not.** A live `HEAD` moving is the
environment. A recorded `headSha` going stale is the finding.

### 2.3 ruleVersion is a disposition compatibility version

**Not** a code version. Bump only when:

- the condition under which the finding is emitted changes
- the governance meaning of the finding changes
- the extraction of `factInputs` changes
- the set of facts the fingerprint depends on changes

Do **not** bump for: message rewording, CLI output format, internal refactoring, performance work, or bugfixes that do not alter finding semantics.

A careless bump invalidates every disposition for that rule at once, so the field must mean "old decisions may no longer apply", nothing else.

## 3. Ledger → finding resolution

Three relations, not two:

| relation | condition | consequence |
|---|---|---|
| `CURRENT` | finding emitted, id matches, fingerprint matches, entry not tombstoned | decision holds |
| `STALE` | finding emitted, id matches, fingerprint differs | **decision void, finding reactivated** |
| `ORPHANED` | entry exists, finding no longer emitted | normal resolution, **no re-statement required** |

Two load-bearing rules, not one:

> **(a)** A fingerprint mismatch invalidates a disposition only when the same findingId is still emitted.
>
> **(b)** Once an entry has been observed orphaned, it never returns to `CURRENT` — a later recurrence of the same findingId with the same fingerprint requires a fresh decision.

Without (a), resolving a problem would demand a fresh disposition for a finding that no longer exists, and the stale queue would fill with already-solved items until nobody trusted it.

Without (b), a regression silently inherits the decision that was made about the *original* occurrence. Consider: `accepted-debt` at T0, fact repaired at T1 (entry orphaned), regression at T2 restoring the exact same facts. Pure fingerprint matching marks it `CURRENT` and the old acceptance revives — precisely at the moment a human most needs to look. **Orphaning is terminal**, expressed as a tombstone on the entry:

```jsonc
{ "findingId": "…", "fingerprint": "abc…", "choice": "accepted-debt",
  "orphanedAt": "2026-09-01T10:00:00Z", "orphanedHead": "1f2e3d4…" }
```

A tombstoned entry is never `CURRENT`.

**Retention scope in v1 — deliberately narrow.** The tombstone is retained *until an
explicit fresh `set`*, at which point the new disposition **supersedes** the prior
occurrence and the old `choice` / `at` / `orphanedAt` are gone. There is still at most
one entry per `findingId` (§6), and this spec makes **no promise of permanent
occurrence history**.

That is a real limitation and it is chosen: keeping "accepted once → solved → came
back" forever would require either a `history[]` array or per-occurrence records,
which turns a validity ledger into an audit event store. The purpose of layer 2 is
*validity and automatic reactivation*, not an audit trail. The tombstone does the
one job that matters — it stops a regression from silently inheriting the previous
decision — and stops there. Git history of `dispositions.json` remains available for
anyone who genuinely needs the sequence.

`aging-*` shows both paths of rule (a): touch the file and it either still exceeds the threshold (`STALE` — circumstances changed, restate) or no longer does (`ORPHANED` — done, say nothing).

### 3.1 Single resolver

```text
effectiveDisposition(finding, ledger) =
    entry && !entry.orphanedAt && fingerprintMatches(entry, finding) ? entry : null
```

Therefore **undispositioned** means *no entry*, *entry present but stale*, **or** *entry tombstoned* — one concept, one function.

No consumer may implement fingerprint matching itself. `if (ledger.has(finding.id)) suppress()` is the specific bug this forbids: it suppresses stale and tombstoned entries alike, the exact opposite of the intended behaviour.

### 3.2 Who writes the tombstone

Detecting an orphan requires observing that a finding is *absent*, and every consumer that makes that observation (`verify`, `spec status`, `plan gaps`) is **read-only by contract**. A read-only command must never mutate a git-tracked decision record as a side effect — that would put governance writes on paths users invoke casually and expect to be inert.

The write therefore belongs to an explicit, idempotent command:

```text
mem disposition sync     # tombstones entries whose finding is no longer emitted
```

invoked from the existing `post-commit` governance hook, alongside `plan progress`, `focus auto-advance` and `plan gaps`. Read-only consumers report the pending count and never write.

### 3.3 Durability closure

`post-commit` runs **after** the commit object exists. A tombstone it writes is
therefore a working-tree modification to a tracked file that is **not in that
commit**. Saying the window is "bounded by one commit" is true only of *local
detection*; it is false for the cross-session, cross-agent, cross-machine
durability this ledger exists to provide. Four distinct stages, and only the last
one delivers the guarantee:

| stage | achieved by | still exposed |
|---|---|---|
| 1. orphan detected | next `mem disposition sync` | nothing written yet |
| 2. tombstone written locally | `sync` writes `dispositions.json` | dirty tracked file, not in git |
| 3. tombstone durable | a **subsequent** commit includes it | — |
| 4. available elsewhere | push / pull | — |

The failure this creates if left unstated:

```text
machine A:  commit C fixes the finding
            post-commit writes the tombstone
            push C            <- tombstone NOT in C
machine B:  pull C            -> finding gone, ledger not tombstoned
                              -> identical regression resolves to CURRENT
```

Three rules close it:

1. **`sync` writes; it never stages or commits.** Automatic `git add` / `git commit`
   from a hook is a worse defect than the window — implicit git mutation on a path
   users invoke casually.
2. **Uncommitted tombstones are observable.** `mem disposition list` and `verify`
   report `N 条 tombstone 尚未提交` whenever `dispositions.json` is dirty. An
   invisible pending write is what makes this class of bug survive.
3. **Closure gates require them committed.** `mem commit` / `context track` — the
   points that already assert runtime state is durable — must treat a dirty
   `dispositions.json` as part of the state they are closing, so a governance
   snapshot can never claim durability while a tombstone sits unstaged.

Under those rules the honest statement is: **the exposure lasts until the tombstone
is carried by a later commit**, normally the next one, and it is visible for its
entire duration.

## 4. Choice vocabulary

Closed set of four. Not extensible in v1.

| choice | finding valid? | will act? | meaning |
|---|---|---|---|
| `not-applicable` | no | no | rule fired, but this subject is outside its intent |
| `accepted-debt` | yes | no commitment | real problem, cost/risk knowingly accepted |
| `deferred` | yes | **yes** | will be handled, not now |
| `wont-fix` | yes | **no** | real problem, deliberately not fixing |

`false-positive` collapses into `not-applicable`. `resolved` is not a disposition at all — it must show up as the finding no longer being emitted (`ORPHANED`).

### 4.1 `deferred` requires `until`

The predictable failure mode is `deferred` decaying into a nicer-sounding `accepted-debt`. So:

```jsonc
{ "choice": "deferred",
  "reason": "等 Windows adapter 收口后统一处理",
  "until": "spec:windows-adapter reaches shipped" }   // or "2026-09-01"
```

`set` rejects `deferred` without a non-empty `until`. This is the same discipline already applied to `mem spec park --until`: **no bare deferral, always a reopening condition.**

**`until` in v1, stated exhaustively so nobody assumes a scheduler exists:**

- mandatory for `deferred`
- machine-readable and displayed
- does **not** participate in `effectiveDisposition`
- does **not** trigger `stale`
- is **not** a scheduler and must not be described as one
- dispositions still expire only through fingerprint mismatch, tombstoning, or `revoke`

Because nothing enforces it, visibility must: `mem disposition list` prints `until` on every `deferred` entry by default, so `deferred — until 2026-09-01` cannot sit six months past its date unseen. Building a condition engine is explicitly not part of layer 2.

## 5. Ledger format

`.evo-lite/dispositions.json`, **tracked by git** via a `!.evo-lite/dispositions.json` exception, following the existing convention already used for `active_context.md`, `hive/`, and `raw_memory/`.

```jsonc
{
  "version": "evo-disposition-ledger@1",
  "entries": [{
    "findingId":   "R008:task:portfolio-registry-core",
    "ruleId":      "R008",
    "ruleVersion": 1,
    "fingerprint": "a3f1…",
    "choice":      "accepted-debt",
    "reason":      "…",
    "until":       null,
    "at":          "2026-08-11T09:00:00Z",
    "head":        "22ae599…"
  }]
}
```

`ruleId` / `ruleVersion` are duplicated deliberately. They play no part in matching — they exist so `--stale` can report *`R008 ruleVersion 1 → 2`* instead of *`a3f1… → 91be…`*, which has no governance value a year later.

**Full `factInputs` are deliberately not stored.** The finding is the source of current facts; copying them here would grow the ledger into a shadow of the analysis database.

Write discipline, for git diff and merge sanity: 2-space indent, `entries` sorted by `findingId`, atomic write, trailing newline.

## 6. CLI

```text
mem disposition list [--stale] [--json]
mem disposition set <findingId> --choice <c> --reason <text> [--until <text>]
mem disposition revoke <findingId>
```

`set` constraints:

- the `findingId` **must** match a currently emitted finding — no dispositioning phantoms
- `ruleVersion`, `factInputs`, `fingerprint` and `head` are read by the system; **the caller can never supply a fingerprint**
- `reason` must be non-empty
- `deferred` must carry `until`
- at most one entry per `findingId` — `set` **replaces**, never appends, so a ledger can never hold `R008:X accepted-debt` and `R008:X wont-fix` at once with no way to tell which is in force

## 7. Annotation, not filtering

```text
producer → all findings → disposition annotation → presentation projection
```

Every finding stays in the collection and gains a `disposition` field:

```jsonc
{ "id": "R008:task:x", "ruleId": "R008", "fingerprint": "…",
  "disposition": { "status": "current", "choice": "accepted-debt",
                   "reason": "…", "at": "…" } }

{ "id": "R005:task:y",
  "disposition": { "status": "stale", "choice": "accepted-debt",
                   "reason": "…", "fingerprint": "old…" } }

{ "id": "R011:spec:z", "disposition": null }
```

**The finding collection is always complete; only the presentation may collapse.** A downstream consumer reading JSON must never be able to conclude a problem does not exist because someone dispositioned it.

Human-readable output:

```text
⚠️ 3 条待处理 finding
   spec:codegraph-adapter-governance-linker 已 parked，但关联 plan 仍活跃 — zombie-plan
   …

📋 6 条 finding 已处置
   not-applicable 3 · accepted-debt 2 · deferred 1 · wont-fix 0
   使用 mem disposition list 查看

♻️ 2 条 disposition 已失效，finding 已重新激活
   使用 mem disposition list --stale 查看
```

Line 1 leads with the actionable count — the number a reader actually needs. Line 2 keeps total debt permanently visible, which is what separates this from `sizeWaiver` silencing. Line 3 says **已重新激活**, not "需重新表态": those items are already counted as debt again.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac1", "text": "Every finding from spec-portfolio and from all ten planning-gap rules (R003, R004, R005, R006, R008, R009, R010, R011, R012, R013) carries a stable id of the form <ruleId>:<subjectType>:<subjectId>[:<instanceKey>]; the six non-conforming rules are migrated; a subject breaching multiple size dimensions yields one id per dimension; and R010 keys on the bracketed backlog label rather than a text prefix." },
    { "id": "ac2", "text": "fingerprint = sha256(canonicalJson({ruleId, ruleVersion, factInputs})) is deterministic across runs, key order, and set-array order; it excludes display text, absolute paths, file mtimes, ambient HEAD and current time; and where a rule's premise is itself a git value (R013) only the declared value from active_context is admitted, never the live one." },
    { "id": "ac3", "text": "ruleVersion is defined and documented as a disposition compatibility version; bumping it invalidates every disposition for that rule, and message/format/refactor changes do not bump it." },
    { "id": "ac4", "text": "Resolution distinguishes CURRENT, STALE and ORPHANED; a fingerprint mismatch invalidates a disposition only while the same findingId is still emitted; an ORPHANED entry never demands re-statement; and a tombstoned entry never returns to CURRENT even when an identical finding recurs with an identical fingerprint." },
    { "id": "ac5", "text": "set validates its inputs: choice restricted to the four-word closed set, reason mandatory, deferred without a non-empty until rejected, a findingId not currently emitted rejected, and a caller-supplied fingerprint rejected — the system always derives it." },
    { "id": "ac6", "text": "The ledger lives at .evo-lite/dispositions.json, is tracked by git, holds at most one entry per findingId — a fresh set supersedes any prior entry including a tombstoned one, and no occurrence history is retained — and writes sorted, 2-space, atomic, newline-terminated JSON." },
    { "id": "ac7", "text": "Findings are annotated, never filtered: every finding remains in the JSON collection with a disposition field of current/stale/null, and only human-readable presentation collapses them." },
    { "id": "ac8", "text": "All three consumers resolve dispositions through one shared resolver; no consumer implements fingerprint matching itself, and undispositioned covers no-entry, stale-entry and tombstoned-entry alike." },
    { "id": "ac9", "text": "Tombstoning is written only by the explicit idempotent `mem disposition sync` invoked from the post-commit hook; verify, spec status and plan gaps remain read-only and never mutate the ledger; sync never stages or commits; an uncommitted tombstone is reported as pending by list and verify; and mem commit / context track treat a dirty dispositions.json as part of the state they close, so durability is never claimed while a tombstone is unstaged." }
  ]
}
```

**Note on this spec's own size:** adding AC9 puts `acCount` at 9, one over the threshold, so this spec now reports `size-exceeded` against itself. That is deliberate. AC9 is an independently falsifiable property with its own failure boundary — a read-only command mutating the ledger is a distinct defect from the resolver mishandling a tombstone — and folding it into AC4 to keep the counter green would be exactly the warning-driven governance this whole layer exists to end. The overrun is left visible, to be dispositioned by the mechanism this spec defines once it exists.

## Test strategy

Beyond ordinary cases, these invariants must be verified by mutation — each must produce a red on the assertion that guards it, on a green baseline:

- changing a fact invalidates the disposition (alter `declaredStatus`, the warning must reactivate)
- bumping `ruleVersion` invalidates every disposition for that rule
- **a dispositioned finding still appears in the JSON collection** — removing it from the data layer must turn a test red, because that is the failure that would let a consumer conclude the problem is gone
- an `ORPHANED` entry does **not** appear in `--stale` and does not demand re-statement
- **regression after orphaning does not revive the old decision**: tombstone an entry, re-emit an identical finding with an identical fingerprint, and it must resolve to undispositioned — deleting the tombstone check must turn this red
- a read-only consumer run against a ledger with orphanable entries leaves the file **byte-identical**
- `sync` neither stages nor commits: after it writes a tombstone the git index is unchanged and the file is dirty
- `R013` fingerprints move when the declared META values change and **do not** move when only live `HEAD` advances
- `R006` fingerprints move when the inspected content changes, so a further unlinked change to an already-dispositioned file returns as `STALE`
- canonicalization: two payloads differing only in key order or set-array order hash identically

## Out of scope

- Repairing the three registered detection defects
- Machine evaluation / automatic expiry of `until`
- Nurturing this to child hives (a separate, gated release step)
- Layer 3 deletion
