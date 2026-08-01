# Native entry audit — `[zvec-win-unicode-containment]` Task 5

Status: complete for the production CLI as of this branch.
Scope: every production entry that can reach `@zvec/zvec`, directly or through
`memory-index-zvec`.

Why this document exists: Task 4 routed the *selector* through the containment
decision, which is not the same as routing *every entry* through it. Two
production paths still reached the binding around the decision. An audit that
only reads the selector would have reported the work finished.

## The rule being audited

The Windows fault is an uncatchable native fail-fast (`0xC0000409`). No
`try/catch` contains it, so the only defence is to not perform the load at all
on a path the classifier has not cleared (spec I1). Therefore:

> On a non-SAFE verdict, `require('@zvec/zvec')` must not execute, and
> `memory-index-zvec` must not even be reached — because that module is what
> mkdirs the directory and calls `ZVecOpen` / `ZVecCreateAndOpen`.

Two load sites are approved, and only two:

| site | when it may load | gate |
|---|---|---|
| `memory-index.js` → `defaultLoadZvecIndex()` | after a `SAFE` verdict | `resolveEngineDecisionFromInputs` returns before it on any non-`SAFE` verdict |
| `memory-index-zvec.js` → `loadZvec()` | inside an instance the decision cleared | the class is only reachable through `decision.ZvecIndex`, which is `null` unless `SAFE` |

`T7-7` enforces this by scanning the production CLI; a third site fails the
suite.

## Entry-by-entry

Common chain, referenced below as **SHARED**:

```
<entry> → memory.service → getMemoryIndex()
        → sharedEngineDecision()          collectDecisionInputs → classify → decide
        → instantiateFromDecision(d)      d.ZvecIndex ? new d.ZvecIndex({paths: d.paths}) : new SqliteFtsIndex()
```

The decision is taken **once per process** and cached on
`(choice, collectionPath, platform)`; every entry below consumes that same
object rather than computing its own (`T7-8` asserts object identity, not merely
that a decision exists).

| entry | call chain | decision consumed at | native load point | non-SAFE result | test evidence |
|---|---|---|---|---|---|
| `recall` | `memory.js recall` → `memory.service.recall` → `getMemoryIndex().searchText` | SHARED | none on this path | SQLite FTS answers; one containment warning | `T7-8`, `T-zwuc-warn-once` |
| `remember` | `memory.js remember` → `memory.service.memorize` → `getMemoryIndex().upsert` | SHARED | none | write lands in SQLite | `T7-8` |
| `archive` | `memory.js archive` → `memory.service.archive` → `ingestArchiveFile` → `memorize` → `getMemoryIndex().upsert` | SHARED | none | archive file written, chunks indexed in SQLite | stop point 2 E2E; `T7-8` |
| `track` | `context track` → `archive` + `memorize` | SHARED (same cached decision) | none | closure completes on SQLite | stop point 2 E2E |
| `sync` | `memory.js sync` → `syncIndexMemory` → `ingestArchiveFile` → `memorize` | SHARED | none | unindexed archives ingest into SQLite | `T7-8` (same acquisition site) |
| `rebuild` | `memory.js rebuild` → `rebuildLocalIndex` → `resolveActiveImpl()` then `getMemoryIndex()` | SHARED, and the zvec-specific wipe branch is gated on `impl === 'zvec'` | none | takes the SQLite branch; the zvec collection directory is **not** removed | `T-REBUILD-ZVEC`, `T7-8` |
| MCP | `mcp-server` → `memoryService.recall` (tools) and `require('./memory-index').peekMemoryIndex()` (shutdown) | SHARED; shutdown *peeks* and never opens | none | serves from SQLite; shutdown closes nothing it did not open | `T-mcp-stdin-exit`, `T7-8` |
| `memory-ab` | `memory.js memory-ab` → `runMemoryAb` → `resolveEngineDecision({choice:'zvec'})` | its own explicit call, before anything else happens | only via `decision.ZvecIndex` on `SAFE` | **refuses**: throws `EVO_ZVEC_CONTAINED`, CLI exits nonzero | `T7-1`, `T7-2`, `T7-3` |
| lock error path | `ZvecMemoryIndex.initialize` → `openWithCoordination` → `ctx.seams.isLockErrorFn` | reached only from an instance the decision cleared | none — the predicate is injected | not reachable: no instance exists on a non-SAFE verdict | `T7-4`, `T7-5`, `T7-6` |

## The two entries this task closed

### `memory-ab` — selector bypass

Before: the first statement of `runMemoryAb` resolved the native binding and
then constructed `ZvecMemoryIndex` directly. Nothing had classified the
collection path. On a contained path this is precisely the load the spec
forbids, and the offline A/B is exactly the kind of long-running batch job where
a fail-fast is most expensive.

After: the decision is taken first, and a non-SAFE verdict **refuses**.

Refusal rather than degradation is deliberate. Degrading would have compared
SQLite against SQLite and printed a table showing near-perfect agreement — a
result that reads as "the engines agree" while measuring nothing at all. A false
green here is worse than a missing number, so the refusal is an error with
`code: EVO_ZVEC_CONTAINED`; `memory.js` already converts a thrown error into
exit code 1, so a script sees the failure too, not only a human reading stdout.

The refusal message names the verdict, the reason, the affected collection path,
and states that no sqlite-vs-sqlite comparison was run and that the existing
collection was neither opened nor modified. It claims no fix and no recovery,
because neither exists.

`T7-1` also proves the refusal happens *before* the SQLite control side is
constructed — the thrown error alone could not show that.

### `memory-index-lock` — bare native require in the error path

Before: `isLockError()` resolved the binding on **every error classification**,
i.e. after a collection open had already failed — the worst possible moment to
touch native code again.

After: the module resolves nothing. The predicate is injected by the caller,
and the caller (`ZvecMemoryIndex.initialize`) already holds `z` from its own
`loadZvec()` on a path the decision cleared, so no second resolution is needed.

One defect was found and fixed while doing this. The old fallback — used when
the require failed — was `/zvec/i.test(err.name)`. Upstream's `isZVecError`
actually keys on `err.code.startsWith('ZVEC_')`, not on the name, so that
fallback would classify almost no real zvec error. It never mattered before,
because it only ran when `@zvec/zvec` was absent and therefore no zvec errors
existed. Removing the require would have promoted that dead branch to the normal
path and silently downgraded every lock diagnostic to a bare rethrow. The
fallback now mirrors upstream's contract, and the real-conflict concurrency
matrix asserts the injected and native-free forms agree, so an upstream change
turns red instead of degrading quietly.

Both conditions are still required — a zvec-shaped error **and** a `can't lock`
message. An ordinary `EBUSY` "can't lock" must never enter the self-heal ladder
(`T7-4`).

## Residual scan

`require('@zvec/zvec')` in the production CLI, executable occurrences only:

```
memory-index.js        defaultLoadZvecIndex()   — SAFE-gated
memory-index-zvec.js   loadZvec()               — inside a cleared instance
```

`require('./memory-index-zvec')` in the production CLI:

```
memory-index.js        defaultLoadZvecIndex()   — the only requirer
```

Zero in `memory-ab.js` and `memory-index-lock.js` — asserted twice, once through
the comment-aware scan and once as a raw substring check that does not depend on
the comment stripper being correct.

Fixtures, test files and historical documents are out of scope for this scan, as
specified.

## Not covered by this audit

Task 6 (degradation markers and recovery), Task 7 (`verify` diagnostics) and
Task 8 (release enforcement) are unimplemented and unauthorized. This audit
establishes that no production entry *loads* native code on a contained path; it
does not establish that a contained runtime is diagnosable from `verify`, nor
that a release is blocked on it.
