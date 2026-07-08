---
id: spec:hive-nurture-engine-migration
status: draft
created: 2026-07-08
linkedPlan: plan:hive-nurture-engine-migration
---

# Spec: Hive Nurture — Engine-Migration Safety

**Date:** 2026-07-08
**Depends on:** `spec:memory-index-abstraction` (seam / engine selection),
`spec:zvec-memory-index` (`ZvecMemoryIndex`, optional `@zvec/zvec` dep),
`spec:memory-engine-default-flip` (`DEFAULT_ENGINE_CHOICE='zvec'`),
`spec:mother-child-hive-nurture` (nurture + dependency report).

## Problem

The mother flipped its default memory engine to `zvec` (2026-07-07) and nurtured
the new engine genes into child **CodePLC** (2026-07-08). Genes are code; a child's
engine **state** and **runtime dep** are not genes and do not follow a nurture. The
result is a silent, destructive divergence between the engine a child *chooses* and
the engine it can actually *run*.

## Field Evidence (CodePLC, reproduced 2026-07-08)

1. Post-nurture, `resolveEngine()` returns `'zvec'` (the nurtured default), but
   `@zvec/zvec` is **absent** in the child, so `getMemoryIndex()` silently falls
   back to `SqliteFtsIndex`.
2. `rebuildLocalIndex()` (`memory.service.js:1645-1665`) branches on the engine
   **choice** (`=== 'zvec'`). The zvec branch skips the sqlite `unlinkSync(DB_PATH)`
   drop; the fallback impl then appends into the un-dropped table → child records
   went **12 → 24 (duplicated)**, still tagged `sqlite-fts5-trigram`.
3. Nothing warned. `verify` reported a healthy engine while the store was degraded.

Manual restore (not this spec's mechanism): forced sqlite rebuild → 12 rows + pinned
`.evo-lite/memory-engine.json` to `sqlite-fts5-trigram`.

## Goal

Make the choice/impl divergence **non-destructive, observable, and reported** across
the nurture boundary — without installing deps into a child or writing child state
from nurture (genes-only holds).

## Non-Goals

- **Auto-installing `@zvec/zvec` into a child** — rejected. Dep installs are the
  child owner's decision; nurture never runs npm in a child.
- **Nurture writing `memory-engine.json` into a child** — rejected. Engine pin is
  per-child curated state; the preflight reports and recommends only.
- **Removing the zvec→sqlite fallback** — rejected. The fallback must keep the child
  runnable when the dep is absent; it just must be visible, not silent.
- **A new engine or index impl** — out of scope. This hardens the existing seam.

## Design

See `plan:hive-nurture-engine-migration`. Three surgical gene changes:
`resolveActiveImpl()` (choice vs impl vs degraded), impl-keyed drop in
`rebuildLocalIndex`, degradation WARN in verify/rebuild, plus a report-only
engine-readiness preflight in `hive nurture`.

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-active-impl-resolver",
      "description": "resolveActiveImpl() reports impl='sqlite' & degraded=true when choice='zvec' and the zvec index cannot load; impl='zvec' & degraded=false when it can.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory-index.js", ".evo-lite/cli/memory-index.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-no-duplication-on-rebuild",
      "description": "A rebuild whose actual impl is sqlite drops the sqlite store first, so a choice='zvec' + dep-absent rebuild over N archives yields exactly N records, never 2N.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js all", "scope": "all" } },
      "dependsOn": ["templates/cli/memory.service.js", ".evo-lite/cli/memory.service.js", "templates/cli/test/integration.js"]
    },
    {
      "id": "ac-degradation-visible",
      "description": "verify and rebuild emit an explicit engine-degradation WARN (naming dep-install or sqlite-pin fixes) when choice='zvec' but impl fell back to sqlite; no WARN when impl matches choice.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/memory.service.js", ".evo-lite/cli/memory.service.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-nurture-engine-readiness-report",
      "description": "hive nurture reports engineReadiness {childChoice, depPresent, recommendation} for a child whose pushed engine resolves to an unrunnable choice, and writes NO file into the child beyond the copied genes.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/hive/nurture.js", ".evo-lite/cli/hive/nurture.js", "templates/cli/test/governance.js"]
    },
    {
      "id": "ac-codeplc-capstone-green",
      "description": "The CodePLC-shaped capstone (12 archives, dep absent, choice zvec) runs nurture-report -> rebuild -> verify with 12 records, a visible degradation WARN, depPresent=false, and the full test suite green.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js", "scope": "full" } },
      "dependsOn": ["templates/cli/test/integration.js", ".evo-lite/cli/test/integration.js"]
    }
  ]
}
```

## Manifest & Mirror

No new managed gene family. All touched `cli/**` files already live in both
`templates/cli/**` and `.evo-lite/cli/**`; every change lands byte-identical in both
mirrors. `npm test` = `node ./.evo-lite/cli/test.js`.

## Follow-up (not this spec)

- A real zvec migration path for a child that *does* install `@zvec/zvec`
  (trigram→zvec reindex with dedup) — deferred until a child opts into the dep.
