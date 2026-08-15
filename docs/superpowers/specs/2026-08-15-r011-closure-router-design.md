---
id: spec:r011-closure-router
status: draft
created: 2026-08-15
---

# Spec: R011 is a closure router, not a closure judge

**Date:** 2026-08-15
**Backlog:** `[7f8c] r011-evidence-blind-completion-advice`, P1 governance correctness
**Architecture:** A′ — contract-only authority + non-authoritative context. Frozen by the human; alternative B (contract-or-evidence-floor) was considered and rejected.

## Problem

R011 recommends closing a spec on the strength of hand-ticked checkboxes.

`gaps.js` decides completeness like this:

```js
const isComplete = plan => {
    const planTasks = (planIR.tasks || []).filter(t => t.linkedPlan === plan.id);
    return planTasks.length > 0 && planTasks.every(t => t.readOnly || t.status === 'implemented');
};
```

`t.status` comes from a `- [x]` in plan markdown. Nothing else is consulted. When every box is ticked, R011 emits `Update status in <spec> to: status: done`.

Two live instances on `main@28169e7`. `spec:governance-observation-budget` and `spec:planning-truth-controls` are both recommended for closure. Nine of their eleven tasks carry real file evidence — but `task:governance-observation-budget-t5` and `task:planning-truth-controls-t6` have zero linked files, zero valid git refs, and were marked implemented by hand. R005 is simultaneously warning about those same two tasks. Two rules read the same tree and disagree.

The recommendation's measured precision is 1 in 3. On 2026-08-10 an operator checked three R011 suggestions by hand and accepted one.

### This is not a missing evidence rule

The project already answered this question. `close-preview.js` carries the ruling in its own comment:

> *Advisory only — NEVER affects readiness. criteria-all-PASS stays the sole hard gate.*

It even emits `N of M linked tasks are not implemented — closing will mark the spec done anyway`. Task completion was deliberately demoted to advisory, and criteria verdicts were made the sole authority.

R011 is the one place that ignores that ruling, and it does so on the exact terminal act the ruling governs. **The defect is not that R011 lacks an evidence rule. It is that R011 is a second, weaker authority over a question that already has a designed one.**

There is a second harm on top of the first. R011's `suggestedAction` tells the operator to hand-edit spec frontmatter — routing them around `close-apply.js`, which takes a lock, refuses a dirty tree, journals every write, snapshots each target for rollback, flips the plan checkboxes and backfills R008 evidence. Even when R011 is factually right, its advice bypasses the transaction built to make that change safe.

### Why an evidence floor was rejected

The obvious alternative was to let R011 keep judging, but on better evidence: require every task to have at least one valid git ref or one existing linked file. That floor is not invented — it is the human's own written rule, recorded as `doneEvidence` in `spec:hive-nurture-engine-migration`.

It was rejected because it recreates the defect one level up. Today a checkbox is mistaken for closure evidence; under a floor, a different heuristic would be mistaken for closure evidence. It also creates a standing synchronisation duty: whenever the verification contract's standard moves, the floor must move with it, or the two authorities drift apart again. `[235a]` has just demonstrated what that architecture costs — `diffInstalledHook()` held the freshness answer while `hook status` computed its own simpler one, and a merged feature sat inert for two months.

**Presence evidence never composes into satisfaction evidence.** Git refs, linked files, archive mentions and checkboxes all answer *"did work happen near this task"*. Closure asks *"were this spec's acceptance criteria met"*. No quantity of the first produces the second; stacking three weak signals yields a more confident-feeling number, not a stronger claim.

### The archive signal is worse than weak

`checkArchiveHits` (`progress.js:30-47`) counts a task as having archive evidence when the archive text contains its id or slug as a bare substring. For both tasks at the centre of this defect, `archiveHits` is 1, and the single hit is `.evo-lite/raw_memory/mem_2026-08-10_09-32-23_0965f6e_2f8eb7f3.md`, which reads:

> 逐条核实挡下另外两条:三条 R011 建议中仅一条通过。governance-observation-budget-t5 与 planning-truth-controls-t6 的 linkedFiles 均为 0,其 spec 不予更改。

That is the archived record of a human **refusing to close these two specs**, scored as evidence in favour of closing them, contributing +0.02 confidence each. This is why archive evidence is excluded from readiness entirely rather than merely down-weighted.

## Design

### R011's new shape

```
candidate detection            (unchanged: linked plans all checkbox-complete, spec not already done)
        ↓
readinessOf(specPath)          (authoritative, read-only, from the verification contract)
        ↓
READY | BLOCKED | NO-CONTRACT  ... or a throw
        ↓
R011 maps that verdict into a finding type — it computes no verdict of its own
```

Note the two vocabularies, deliberately kept separate. `readinessOf` speaks the **existing** `previewClose` language — `READY` / `BLOCKED` / `NO-CONTRACT` — because inventing new words there would force a compatibility mapping back into `previewClose` and break the promise that its behaviour is unchanged. The four-state vocabulary belongs to **R011's findings only**:

```
READY        → spec-closure-ready
BLOCKED      → spec-closure-not-ready
NO-CONTRACT  → spec-closure-uncontracted
throw        → spec-closure-unobservable
```

Checkboxes retain exactly one job: deciding that a spec is *worth checking*. They never establish that it may be closed.

This satisfies both frozen prohibitions structurally rather than by discipline. There is no confidence threshold to hard-code because R011 renders no verdict of its own. There is no evidence logic to duplicate into `gaps.js` because the verdict arrives from the module that already computes it.

### The four states

| type | condition | level | dispositionable | closure advice |
|---|---|---|---|---|
| `spec-closure-ready` | contract present, readiness `READY` | `info` | **false** | route to `mem close <spec> --preview` |
| `spec-closure-not-ready` | contract present, readiness `BLOCKED` | `warning` | true | name the blocking criteria; no closure imperative |
| `spec-closure-uncontracted` | readiness `NO-CONTRACT` | `warning` | true | state that no authoritative verdict exists; suggest establishing or repairing a verification contract; **no closure imperative** |
| `spec-closure-unobservable` | readiness could not be computed this round | `warning` | **false** | none |

`spec-closure-uncontracted` must NOT tell the operator to close manually. Doing so would reintroduce the second defect this spec exists to remove — advice that routes around the close transaction. If the project later needs a supported path for legacy contract-less closure, that workflow gets its own design; R011 does not invent it.

The `dispositionable` values are frozen here rather than left to the implementer, because `set` treats any finding without an explicit `false` as dispositionable:

- **`ready` is `false`** — it is positive routing information, not a governance fact. "Accepted debt" and "won't fix" have no meaning against *"this spec is ready to close"*.
- **`unobservable` is `false`** — and this one is load-bearing. It reports an observer failure, not a stable fact about the spec. Allowing a human to disposition it would let *"I could not see"* be answered with *"I accept that"*, which is the exact semantic crack this project's observation discipline exists to close. A spec cannot claim that a failure to observe must never impersonate a change in fact and then offer that failure up for disposition.
- **`not_ready` and `uncontracted` are `true`** — these are genuine, stable governance facts about the spec, and deferring or accepting them is a legitimate human decision.

Four distinct types under one rule id, not one message with a caveat. The reason is the disposition ledger: `computeFingerprint` hashes `{ruleId, ruleVersion, factInputs}` and **the message is not in it**. A caveat appended to the message would not change decision identity, so a human dispositioning *"close this spec"* as `wont-fix` would silently also dispose of *"this spec cannot be evidenced"* — two different claims sharing one decision identity, which is precisely what the ledger exists to prevent.

`spec-closure-ready` is `info` because it is good news: the gate has already passed and there is nothing to remediate. Making it a warning would raise `verify`'s `hasAlerts` for a spec that is safe to close.

Only `spec-closure-ready` carries an imperative, and even then it points at the close transaction rather than at the frontmatter. **No finding, in any state, ever recommends hand-editing `status: done` again.**

### Presence evidence still shows, and still cannot promote

A spec with ten reachable commits and one with nothing must not read identically to a human. Both remain `spec-closure-uncontracted` at the machine authority layer — that boundary is not negotiable — but the finding's evidence detail may name what presence evidence exists.

The rule is stated once and holds everywhere:

- **presence evidence** = work happened nearby. Informs the human's next step.
- **satisfaction evidence** = a frozen acceptance contract was met. The only thing that can produce `READY`.

Presence evidence never promotes to satisfaction evidence, regardless of quantity.

Two boundaries follow, and both are frozen. Presence evidence may appear **only as display context**: it must never enter R011's state selection, and it must never enter `factInputs` or anything else the fingerprint reads — otherwise a file appearing on disk would lapse a human's decision about a criterion that has not moved. And it must be read from a surface that already exists; the implementation must not author a fourth evidence evaluator to obtain it. Which existing surface is a plan-level choice.

### `readinessOf()` — the extraction

`previewClose` is already read-only (pinned by test T39, *"previewClose is read-only"*) and already accepts injected `statusFn` / `planStateFn`. But it also reads plan files and assembles mutation-action strings, and a drift rule has no business touching a mutation vocabulary.

A thin export is added to `close-preview.js`:

```
readinessOf(specPath, opts) -> { readiness: 'READY' | 'BLOCKED' | 'NO-CONTRACT',
                                 blockers, contractPresent }
                            MAY THROW on observation failure
```

It computes only the contract load and the criteria verdicts, and it keeps `previewClose`'s existing readiness vocabulary unchanged. It does not catch — an unreadable evidence store must reach the caller, because `readinessOf` cannot know whether its caller wants to fail the command or degrade a census.

`previewClose` is refactored to call it and is otherwise **behaviourally unchanged** — its existing tests are the regression net for that claim.

`readinessOf` is the only new surface. Nothing else moves, and in particular the confidence bands stay in `progress.js`: they have real consumers in `dashboard-data.js` and `inspector.js` for ranking human display, and promoting them into a shared module would make a display heuristic look authoritative.

### Unobservable fails closed — without erasing the finding

`readinessOf` can throw. `evidence-store.js` deliberately throws on a malformed store rather than reading it as "no evidence", because silence there "would flip a real FAIL to UNVERIFIED-by-absence". That is correct, and R011 must catch it rather than let it escape.

Fail-closed here needs care, because suppressing the whole finding would be the wrong kind of closed. A finding absent from a complete census is read by `disposition sync` as proof of absence, and it tombstones the human's decision — the exact destruction the observation discipline exists to prevent.

So the finding survives and the *advice* fails closed:

```
readiness observation fails
  → finding retained, type spec-closure-unobservable
  → observation.unavailable(...) recorded
  → planning census complete: false
  → disposition sync writes no tombstone this round
  → no closure advice of any kind
```

`checkR011` currently has the signature `checkR011(planIR)` — no project root, no observation sink. **It is the only planning rule structurally incapable of reporting that it could not look.** It gains `(projectRoot, planIR, options, observation)`, matching `checkR006` and `checkR013`.

### `ruleVersion` 1 → 2

Both the fact inputs and the claim semantics change.

`ruleVersion: 2` lapses every existing R011 disposition **once**. It does nothing about facts that move afterwards — that is the fingerprint's job, and the fingerprint reads only `factInputs`.

So `factInputs` must carry the authoritative state **and the identity of what makes it that state**:

```json
{ "closureState": "NOT_READY", "blockers": ["ac1=FAIL", "ac3=STALE"] }
```

Carrying `closureState` alone would repeat, inside `NOT_READY`, exactly the collapse the four types exist to prevent. These two rounds are different facts:

```
NOT_READY  blockers: ac1=FAIL          →   NOT_READY  blockers: ac3=STALE
NOT_READY  contract invalid            →   NOT_READY  contract valid, ac2 FAIL
```

With only the state recorded, the fingerprint is identical across both transitions, and a `deferred` decision taken about *"ac1 is failing"* silently carries over to *"ac3 has gone stale"* — a decision inherited by a fact it was never made about.

Requirements on the blocker identity:

- **Canonically ordered** so a reordering by the verdict engine does not lapse a decision that nothing real has invalidated. This is the same rule `canonicalJson` already applies to set-valued keys.
- **A malformed contract needs a stable validation-failure identity too** — a digest or equivalent over the validation findings — not just an error string in the message. Otherwise every edit to a broken contract that leaves it broken differently is invisible to the fingerprint, and every edit that only changes the error wording lapses a decision for no reason.

Each transition then correctly lapses the old decision rather than inheriting it:

```
UNCONTRACTED  →  (contract added)  →  NOT_READY  →  (criteria pass)  →  READY
```

The mother repo has no `dispositions.json`, so migration costs nothing here. **Child hives may hold CURRENT R011 dispositions and must be checked before rollout** — a rollout note, not part of this implementation.

The finding id `R011:<spec>` is unchanged, so ledger ids survive; only fingerprints lapse.

## Out of scope

Each of these is real, verified, and deliberately excluded. None is a licence to edit while implementing this spec.

- **`[a8a8]` implicit-plan-done release-gate bypass.** `parse-markdown.js:304` promotes a superpowers plan to `status: done` when its checkboxes are all ticked and frontmatter omits status; `spec-portfolio`'s `notDonePlans` then feeds `release-preflight` blockers. That path can change a machine release judgment, where R011 only recommends. Registered separately, investigation required first.
- **Three disagreeing archive-evidence mechanisms.** `checkArchiveHits` (bare substring) and `hasArchiveEvidence` (`task:` / `[slug-tN]` patterns) return different answers for the same tasks on this tree, which is why R008 fires on tasks that `progress` credits. Unifying them silently re-decides R008's firing set across ~250 tasks.
- **`validateGitRef`'s fail-open catch** (`progress.js:17`), which returns the same `{valid:false}` for a bogus sha and for git being unavailable.
- **`loadArchiveEvidenceMap`'s swallow** (`backfill-evidence.js:98`), which reads a corrupt evidence map as `{}`.
- **`spec:disposition-ledger`'s INVALID contract.** Its criteria use `text` and omit `dependsOn` and `verifier`, so `loadValidatedContract` rejects the whole block — those nine criteria are not machine-verifiable today.
- **`takeover-session.js:26`** filters `t.status === 'done'`, a value the parser never produces, so plan progress in the takeover payload is permanently `0/N`.
- **Closure has no supported path for contract-less specs.** `close-apply` refuses anything not `READY`, and `previewClose` returns `NO-CONTRACT` for a spec with no criteria block — so the 25 contract-less specs on this tree cannot be closed through the transaction at all. `spec-closure-uncontracted` must therefore not point them at a command that will refuse them.

## Cost accepted

`spec:hive-nurture-engine-migration` was closed on R011's advice, and its `doneEvidence` line credits R011 as having been right. Under this design that spec would have produced `spec-closure-uncontracted` with a pointer to the gate, not `set status: done`. The operator would still reach the right answer, through two steps instead of one.

That is a genuine ergonomic regression for the true-positive case. The trade is 1-in-3 precision with a one-step instruction against honest routing with an extra step, for an act that permanently changes governance state and bypasses a transaction built to make it safe. The trade is accepted; it is not a free win.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac1",
      "description": "Only an authoritative verification-contract verdict can produce spec-closure-ready. No checkbox state, git ref, linked file, archive hit or progress confidence value can produce it, alone or in combination.",
      "dependsOn": ["templates/cli/planning/gaps.js", "templates/cli/verification/close-preview.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac2",
      "description": "gaps.js contains no independent closure-readiness decision logic, no confidence threshold and no duplicate of any evidence predicate; it may only map the authoritative readiness result into R011 finding types.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac3",
      "description": "R011 emits exactly four mutually exclusive types — spec-closure-ready, spec-closure-not-ready, spec-closure-uncontracted, spec-closure-unobservable — with levels info, warning, warning, warning and dispositionable false, true, true, false respectively.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac4",
      "description": "No R011 finding in any state recommends hand-editing a spec to status: done. spec-closure-ready routes to the existing close transaction; the other three carry no closure imperative.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac5",
      "description": "When readiness cannot be computed, the finding is retained as spec-closure-unobservable, the failure is recorded through the observation sink, the planning census reports complete false, disposition sync writes no tombstone that round, and no closure advice is emitted.",
      "dependsOn": ["templates/cli/planning/gaps.js", "templates/cli/verification/close-preview.js", "templates/cli/disposition/commands.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac6",
      "description": "readinessOf is exported from close-preview.js returning previewClose's existing READY / BLOCKED / NO-CONTRACT vocabulary, computes only contract load and criteria verdicts, performs no write, propagates observation failure to its caller rather than catching it, and previewClose delegates to it with its own behaviour unchanged as pinned by its existing tests.",
      "dependsOn": ["templates/cli/verification/close-preview.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac7",
      "description": "PLANNING_RULE_VERSIONS.R011 is 2, and factInputs carries both the authoritative closure state and a canonically ordered blocker identity — with a stable validation-failure identity when the contract is malformed — so that a change of blocking criteria within one state lapses a prior disposition, while a mere reordering does not. Presence evidence never appears in factInputs.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac8",
      "description": "On the mother repo the two currently-flagged specs — spec:governance-observation-budget and spec:planning-truth-controls — become spec-closure-uncontracted naming their unevidenced tasks, and neither receives closure advice.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    }
  ]
}
```
