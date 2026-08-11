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

| finding | factInputs | invalidated when |
|---|---|---|
| `unknown-status` | `declaredStatus` | the status word changes |
| `zombie-plan` | `notDonePlans[]` | any linked plan completes |
| `size-exceeded:<dim>` | `dimension`, `value`, `threshold`, `state` | that dimension or the spec state changes |
| `aging-*` | `lastTouchedAt` | the file is touched at all |
| `R005` | `linkedFiles[]` | files are declared |
| `R008` | `taskStatus`, `archiveHits` | archive evidence appears |
| `R011` | `specStatus`, `taskStatuses[]` | either side moves |

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
- `HEAD`
- the current time

`factInputs` describes only the governance facts on which the finding stands.

### 2.2 ruleVersion is a disposition compatibility version

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
| `CURRENT` | finding emitted, id matches, fingerprint matches | decision holds |
| `STALE` | finding emitted, id matches, fingerprint differs | **decision void, finding reactivated** |
| `ORPHANED` | entry exists, finding no longer emitted | normal resolution, **no re-statement required** |

The load-bearing rule:

> **A fingerprint mismatch invalidates a disposition only when the same findingId is still emitted.**

Without the `ORPHANED` case, resolving a problem would demand a fresh disposition for a finding that no longer exists, and the stale queue would fill with already-solved items until nobody trusted it.

`aging-*` shows both paths: touch the file and it either still exceeds the threshold (`STALE` — circumstances changed, restate) or no longer does (`ORPHANED` — done, say nothing).

### 3.1 Single resolver

```text
effectiveDisposition(finding, ledger) = fingerprint matches ? entry : null
```

Therefore **undispositioned** means *no entry* **or** *entry present but stale* — one concept, one function.

No consumer may implement fingerprint matching itself. `if (ledger.has(finding.id)) suppress()` is the specific bug this forbids: it suppresses stale entries, which is the exact opposite of the intended behaviour.

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

`until` is recorded and displayed but **not** machine-evaluated in v1 — it is a promise to the reader, not a trigger. Automatic expiry is a later decision.

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
    { "id": "ac1", "text": "Every finding from spec-portfolio and planning gaps carries a stable id of the form <ruleId>:<subjectType>:<subjectId>[:<instanceKey>], and a subject breaching multiple size dimensions yields one id per dimension." },
    { "id": "ac2", "text": "fingerprint = sha256(canonicalJson({ruleId, ruleVersion, factInputs})) is deterministic across runs, key order, and set-array order, and excludes display text, absolute paths, HEAD, and current time." },
    { "id": "ac3", "text": "ruleVersion is defined and documented as a disposition compatibility version; bumping it invalidates every disposition for that rule, and message/format/refactor changes do not bump it." },
    { "id": "ac4", "text": "Resolution distinguishes CURRENT, STALE and ORPHANED; a fingerprint mismatch invalidates a disposition only while the same findingId is still emitted, and an ORPHANED entry never demands re-statement." },
    { "id": "ac5", "text": "set validates its inputs: choice restricted to the four-word closed set, reason mandatory, deferred without a non-empty until rejected, a findingId not currently emitted rejected, and a caller-supplied fingerprint rejected — the system always derives it." },
    { "id": "ac6", "text": "The ledger lives at .evo-lite/dispositions.json, is tracked by git, holds at most one entry per findingId with set replacing rather than appending, and writes sorted, 2-space, atomic, newline-terminated JSON." },
    { "id": "ac7", "text": "Findings are annotated, never filtered: every finding remains in the JSON collection with a disposition field of current/stale/null, and only human-readable presentation collapses them." },
    { "id": "ac8", "text": "All three consumers resolve dispositions through one shared resolver; no consumer implements fingerprint matching itself, and undispositioned covers both no-entry and stale-entry." }
  ]
}
```

## Test strategy

Beyond ordinary cases, these invariants must be verified by mutation — each must produce a red on the assertion that guards it, on a green baseline:

- changing a fact invalidates the disposition (alter `declaredStatus`, the warning must reactivate)
- bumping `ruleVersion` invalidates every disposition for that rule
- **a dispositioned finding still appears in the JSON collection** — removing it from the data layer must turn a test red, because that is the failure that would let a consumer conclude the problem is gone
- an `ORPHANED` entry does **not** appear in `--stale` and does not demand re-statement
- canonicalization: two payloads differing only in key order or set-array order hash identically

## Out of scope

- Repairing the three registered detection defects
- Machine evaluation / automatic expiry of `until`
- Nurturing this to child hives (a separate, gated release step)
- Layer 3 deletion
