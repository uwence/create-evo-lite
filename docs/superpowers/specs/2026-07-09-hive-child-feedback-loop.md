---
id: spec:hive-child-feedback-loop
status: draft
created: 2026-07-09
linkedPlan: plan:hive-child-feedback-loop
---

# Spec: Hive Child Feedback Loop — Outbox + Mutation Detection

**Date:** 2026-07-09
**Depends on:** `spec:mother-child-hive-nurture` (nurture, receipt, registry),
`spec:hive-nurture-engine-migration` (preflight report pattern, genes-only holds).

## Problem

The hive is a one-way pipe. Genes flow mother → child via `hive nurture`; nothing
structured flows back. Two consequences observed across the first two real
children (hungersnakegame4, CodePLC):

1. **Child problems reach the mother only by accident.** Every dogfood finding
   that became a mother backlog item ([36e1], [20bb], [nurture-tag]) was noticed
   because a human happened to be working inside the child at that moment. A
   child agent that hits evo-lite friction on its own has nowhere to report it;
   the signal dies in that session.
2. **Committed child gene mutations are silently erased.** Nurture's dirty check
   (`git status --porcelain` over managed files) only refuses on *uncommitted*
   changes. A child that committed a local patch to a managed gene file passes
   the dirty check, and nurture overwrites it with mother bytes without ever
   saying the child had diverged. `hive status`'s `driftedFiles` cannot help:
   it diffs child-vs-*current-mother-templates*, so it cannot distinguish "child
   mutated" from "mother moved forward" — both hash-mismatch identically.

## Field Evidence

- 2026-07-08 CodePLC dogfood: three evo-lite defects surfaced only because the
  operator was manually driving the nurture session; all three were hand-copied
  into the mother backlog. No child-side artifact records them.
- `nurtureChild()` (`templates/cli/hive/nurture.js`): preflight 2 checks
  porcelain only; the apply phase writes mother bytes over any committed child
  edit with no comparison against what was previously deployed.
- The information needed to detect mutation already exists child-side:
  `.evo-lite/generated/runtime-mirror.lock.json` stores the sha256 of every
  managed file *as last deployed by nurture*. `child-active-hash ≠ lock-hash`
  is precisely "child changed this file since the mother last touched it".

## Goal

Close the loop in both directions, keeping the mother the sole evolution owner:

- **(A) Feedback outbox** — a genes-defined protocol file in each child where
  agents append evo-lite friction reports; `hive nurture` (and `hive status`)
  collects them mother-side so they become backlog candidates instead of relying
  on human presence.
- **(B) Mutation detection** — nurture preflight compares child active files
  against the child's `runtime-mirror.lock.json`; any mismatch is a *mutation
  candidate* reported before overwrite, requiring an explicit decision
  (absorb into mother / overwrite / skip), never a silent erase.

## Non-Goals

- **Child self-modifying genes as a supported flow** — rejected. Genes stay
  mother-owned; a child mutation is a *candidate* the mother selects on, not a
  fork. Detection makes mutation visible; it does not legitimize divergence.
- **Auto-absorbing child mutations into mother templates** — rejected. Absorb is
  a human/mother-agent decision; nurture only reports the diff.
- **Auto-converting collected feedback into backlog items** — rejected for v1.
  Collection surfaces the items in the nurture/status report; the operator (or
  `/evo` takeover) decides what enters the mother backlog. Avoids backlog spam
  from noisy children.
- **Child health telemetry rollup** (`hive status` running child `mem verify`)
  — deferred. Useful, separable, not required for the loop to close.
- **Network/remote children** — out of scope; hive remains local-path based.

## Design

### A. Feedback outbox

- **Protocol file:** `.evo-lite/hive/feedback.md` in the child. Backlog-style
  checkbox lines (`- [ ] [label] text`), same grammar as `active_context.md`
  backlog so `parseBacklogTasks` is reusable.
- **Genes rule:** a managed rule file instructs child agents: when friction is
  in *evo-lite itself* (not the child project), append a line to the outbox.
  The file is scaffolded empty by `create-evo-lite` and nurture.
- **Collection:** `hive nurture` and `hive status` read the child outbox and
  include unchecked items in their report (`report.feedback: [{label, text}]`).
  Nurture marks collected lines checked (`- [x]`) in the child inside the same
  transaction, so items are collected exactly once. `hive status` is read-only:
  it reports but never marks.

### B. Mutation detection

- **Preflight 3 (new, before apply):** for every managed entry, if the child
  active file exists and `runtime-mirror.lock.json` has a checksum for it and
  `sha256(child-active) ≠ lock-hash`, record it in `report.mutations`.
- **Refuse by default:** `report.mutations.length > 0` → `status: 'refused'`
  with the mutation list, mirroring the dirty-file refuse path. `--force`
  overwrites (explicit erase); a future `--absorb <label>` is out of v1 scope.
- **No lock, no verdict:** a child without a lock file (pre-lock scaffold) skips
  mutation detection with a WARN line, never a refuse — legacy children stay
  nurturable.
- **Anchored-merge files exempt:** entries with `mergeAnchors` legitimately
  diverge (child anchor content); mutation detection applies only to
  non-anchored managed files.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-outbox-collected-once",
      "description": "Given a child outbox with 2 unchecked items, hive nurture reports both in report.feedback and re-writes them checked in the child; a second nurture reports zero feedback items.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-status-reports-without-marking",
      "description": "hive status includes unchecked child outbox items in its report and leaves the child outbox file byte-identical.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/hive/status.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-mutation-refuses-before-overwrite",
      "description": "A child with a committed local edit to a non-anchored managed file (clean porcelain, active-hash ≠ lock-hash) makes nurture return status='refused' with the file in report.mutations, and the child file is left unmodified; --force proceeds and overwrites.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-mutation-skips-anchored-and-lockless",
      "description": "Anchored-merge entries never appear in report.mutations regardless of divergence; a child with no runtime-mirror.lock.json skips mutation detection with a WARN and is still nurturable.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-outbox-scaffolded-and-ruled",
      "description": "create-evo-lite scaffolds an empty .evo-lite/hive/feedback.md, and a managed genes rule documents the outbox protocol for child agents.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/template-manifest.js", "templates/cli/test/integration.js"]
    }
  ]
}
```
