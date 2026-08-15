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
READY | NOT_READY | UNCONTRACTED | UNOBSERVABLE
        ↓
R011 renders that verdict — it does not compute one
```

Checkboxes retain exactly one job: deciding that a spec is *worth checking*. They never establish that it may be closed.

This satisfies both frozen prohibitions structurally rather than by discipline. There is no confidence threshold to hard-code because R011 renders no verdict of its own. There is no evidence logic to duplicate into `gaps.js` because the verdict arrives from the module that already computes it.

### The four states

| type | condition | level | closure advice |
|---|---|---|---|
| `spec-closure-ready` | contract present, authoritative readiness `READY` | `info` | route to `mem verify-contract close --preview <spec>` |
| `spec-closure-not-ready` | contract present, readiness not `READY` | `warning` | name the blocking criteria; no closure advice |
| `spec-closure-uncontracted` | no contract can serve as closure authority | `warning` | add a criteria block, or close manually and record why |
| `spec-closure-unobservable` | readiness could not be computed this round | `warning` | none |

Four distinct types under one rule id, not one message with a caveat. The reason is the disposition ledger: `computeFingerprint` hashes `{ruleId, ruleVersion, factInputs}` and **the message is not in it**. A caveat appended to the message would not change decision identity, so a human dispositioning *"close this spec"* as `wont-fix` would silently also dispose of *"this spec cannot be evidenced"* — two different claims sharing one decision identity, which is precisely what the ledger exists to prevent.

`spec-closure-ready` is `info` because it is good news: the gate has already passed and there is nothing to remediate. Making it a warning would raise `verify`'s `hasAlerts` for a spec that is safe to close.

Only `spec-closure-ready` carries an imperative, and even then it points at the close transaction rather than at the frontmatter. **No finding, in any state, ever recommends hand-editing `status: done` again.**

### Presence evidence still shows, and still cannot promote

A spec with ten reachable commits and one with nothing must not read identically to a human. Both remain `spec-closure-uncontracted` at the machine authority layer — that boundary is not negotiable — but the finding's evidence detail may name what presence evidence exists.

The rule is stated once and holds everywhere:

- **presence evidence** = work happened nearby. Informs the human's next step.
- **satisfaction evidence** = a frozen acceptance contract was met. The only thing that can produce `READY`.

Presence evidence never promotes to satisfaction evidence, regardless of quantity.

### `readinessOf()` — the extraction

`previewClose` is already read-only (pinned by test T39, *"previewClose is read-only"*) and already accepts injected `statusFn` / `planStateFn`. But it also reads plan files and assembles mutation-action strings, and a drift rule has no business touching a mutation vocabulary.

A thin export is added to `close-preview.js`:

```
readinessOf(specPath, opts) -> { readiness, blockers, contractPresent }
```

It computes only the contract load and the criteria verdicts. `previewClose` is refactored to call it and is otherwise **behaviourally unchanged** — its existing tests are the regression net for that claim.

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

Both the fact inputs and the claim semantics change. `factInputs` must carry the authoritative state itself — not only in `type` or `message`, or a disposition taken while a spec was `UNCONTRACTED` would silently carry over once a contract is added and the verdict becomes `NOT_READY`.

Each transition then correctly lapses the old decision rather than inheriting it:

```
UNCONTRACTED  →  (contract added)     →  NOT_READY  →  (criteria pass)  →  READY
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
      "description": "R011 renders a verdict it received and computes none of its own: gaps.js contains no closure-readiness logic, no confidence threshold, and no duplicate of any evidence predicate.",
      "dependsOn": ["templates/cli/planning/gaps.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac3",
      "description": "R011 emits exactly four mutually exclusive types — spec-closure-ready, spec-closure-not-ready, spec-closure-uncontracted, spec-closure-unobservable — with levels info, warning, warning, warning respectively.",
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
      "dependsOn": ["templates/cli/planning/gaps.js", "templates/cli/disposition/commands.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac6",
      "description": "readinessOf is exported from close-preview.js, computes only contract load and criteria verdicts, performs no write, and previewClose delegates to it with its own behaviour unchanged as pinned by its existing tests.",
      "dependsOn": ["templates/cli/verification/close-preview.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js" } }
    },
    {
      "id": "ac7",
      "description": "PLANNING_RULE_VERSIONS.R011 is 2, and factInputs carries the authoritative closure state so that a transition between UNCONTRACTED, NOT_READY and READY lapses a prior disposition instead of inheriting it.",
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
