# Hook Install Provenance — whole-feature evidence reconciliation

Work item `[hook-install-provenance]`, Task 8.
Reconciled snapshot: **`3163696`** (`feat/hook-install-provenance`, working tree clean).

> **Task 8 is reconciliation-only.**
>
> It may describe an evidence gap.
> It may not close that gap by:
> - inventing a new mutation,
> - changing an existing assertion,
> - changing production code,
> - changing the frozen plan/spec,
> - renumbering an HP or mutation ID,
> - reclassifying a historical disposition.
>
> Any such need => `STOP_AND_REPORT` for separate human authorization.

`RETIRED`, `STRUCTURALLY_DOMINATED` and `LOCALLY_NON_FALSIFIABLE` keep their original
ledger identity, named authority and first-responsible pointer. They are not gaps
awaiting a green tick — they record *why a negative control should not, cannot, or
need not be owned by this layer*. This document does not decide any of them.

**Reading direction.** Every fact below was read in exactly one direction:

```
mutation apparatus -> task acceptance evidence -> SDD ledger disposition
                   -> amendment records -> PR summary
```

Never the reverse. Reading backwards from a summary is what produced the one
documented false gap in this work item: several summaries listed `L1 / L2 / L3` in
parallel with only `L3` flagged open, while the canonical ledger had recorded
`L1 CLOSED BY IMPLEMENTATION (M3v, M4f)` since Task 2. See §3, entry `L1`.

---

## Section 0 — Evidence-source manifest

Five questions. Five authorities. Task 8 reconciles the sets; **no source overwrites
another.**

| question | authority | identity at `3163696` |
|---|---|---|
| Which mutations did the original plan declare? | frozen plan `013d64d` — `docs/superpowers/plans/2026-08-18-hook-install-provenance.md` | sha256 `1563ba5c9122dae2f757ae3958ed01354850335b880d5d861321059ccaccca01` |
| Which mutation IDs actually ran? | the mutation apparatus — `.superpowers/sdd/2026-08-18-hook-install-provenance/mutate*.js` | seven files, sha256 below |
| What is each one's final ACCEPTED / RETIRED adjudication? | the SDD ledger — `.superpowers/sdd/2026-08-18-hook-install-provenance/progress.md` | sha256 `e558f9359d99eea694e449cb94e4bdcc870302ace00a1a74eba623ec33dc22e5` (1603 lines) |
| Why did the set change relative to the plan? | the five `task-N-brief-amendment.md` files (N = 3,4,5,6,7) | sha256 below |
| What do the acceptance criteria require? | frozen design `ae39cbe` — `docs/superpowers/specs/2026-08-18-hook-install-provenance-design.md` | sha256 `c3a5f1ce143c552541b966d33db0300401711e6f37184fbd6a0e98565c6d8412`, 16 criteria |

The plan is **no longer the inventory authority**. It remains the authority for *what
was originally declared* — which is exactly what makes the `⊆` check in §2 meaningful.

### Apparatus files

| file | unique IDs | sha256 |
|---|---:|---|
| `mutate.js` | 9 | `ef35e0f0c4addc1d3fd96e73e12b949c644012ad7627d8a41d070db3227016da` |
| `mutate2.js` | 13 | `95a52868c3d421686b1e98ca22cced406c5bd9c310b0a529aeb492f86ec478d9` |
| `mutate3.js` | 7 | `90e58c40e9d7cc1080ce4208a13d4c50da3a10f2977172095e3751f6ebdc5cbf` |
| `mutate4.js` | 15 | `aab6c08220ac5fa74f4dc9be3abaa722345e0568543547995e294f3e396fa3fe` |
| `mutate5.js` | 7 | `6b91f4c0bbd421b06bc619f6eacd1243b57348a4614477446043358805785521` |
| `mutate6.js` | 23 | `4a432fb0c62b7649e9854060aa4c4f3ee11677e67a5c13e8da2ff24ff7289de8` |
| `mutate7.js` | 2 | `9f7ef0a3bf27816a7f55d3b117fce3d2f7c1d1b21657e71fd35b0a00ec48e68c` |

`mutate2.js` supersedes `mutate.js` — its 13 IDs are a strict superset of the earlier
9, re-run in full after patch 2.1 changed the code every one of them targets (rule
`R-C`: changing a test oracle voids every prior mutation result).

### Amendment records

| file | sha256 |
|---|---|
| `task-3-brief-amendment.md` | `a83eeaa82a04cbf7415c61e52a64cc933e7b4b3d5177c7f839c2faf4cb2509ea` |
| `task-4-brief-amendment.md` | `9ba697fe7b25fa62cc850cbd810d935190d38c956930034bbb9795858e8f01ad` |
| `task-5-brief-amendment.md` | `d72c45e015fc0fb3d8048f9354a611c7c4de665ff3dfa178976d1e48ddb4104b` |
| `task-6-brief-amendment.md` | `89f6347279bb0c1b04c290e7dc6c7a6d5f56a533f3e361447bac1f7e698d921a` |
| `task-7-brief-amendment.md` | `e7d3a0f86cd3fa530b16fbb0f6881df5bf5f0fe08bf5cb1215a307d64f6c4147` |
| `task-8-brief-amendment.md` | `b27a1b879c5d1ea10b5b994275f2e363d725681f7ed0c5291660585c77f36670` |

Task 1's evidence amendment (`G2`) and Task 2's corrective patch (2.1) were recorded
directly in `progress.md` rather than as separate amendment files; both are ratified
and both are transcribed in §3.

### Per-mutation execution records

The apparatus wrote one line per run to `mut*.txt`. The **final** record for each ID —
after every authorized re-run — is:

```
Task 2   mut2-a.txt … mut2-e.txt, mut2-new-a.txt, mut2-new-b.txt   (13 IDs)
Task 3   mut3-r-a.txt … mut3-r-d.txt                               ( 7 IDs, post-3.1 re-run)
Task 4   mut4r-a.txt … mut4r-h.txt                                 (15 IDs, post-4.1 re-run)
Task 5   mut5-a.txt … mut5-d.txt                                   ( 7 IDs)
Task 6   mut6-a.txt … mut6-n.txt                                   (23 IDs; g/g2/g3 are the
                                                                    M16/M16b expression repairs)
Task 7   mut7-a.txt + mut7-viability.txt                           ( 2 IDs + preflight)
```

Parsed at `3163696`: **67 execution records, 67 apparatus IDs, zero on either side
without a counterpart.**

---

## Section 0.1 — Plan Step 0: JS fence syntax check (retained as written)

Extracted from frozen plan `013d64d`, every ```` ```js ```` fence written to a temp file
and run through `node --check`.

```
fenced ```js blocks (paired)        18
                                    (a 19th `​``js` occurrence is inside Step 0's own
                                     prose sentence, not a fence)
node --check PASS                   17
node --check FAIL                   1
```

The single failure is the **deliberate fragment** the plan names: the
`.option('--no-hooks', …)` line in Task 7 Step 3, shown as the line to add beside
`index.js:95`. It is a fragment, not a program. Every other fence parses.

Result: **as the plan predicted — 17 programs parse, exactly one declared fragment
does not.** The backslash-collapse defect the step exists to catch is absent.

---

## Section 0.2 — Plan Step 2: full suite in the foreground (retained as written)

```
command   node .evo-lite/cli/test.js            (foreground, timeout 600000 ms)
exit      0
checks    445
AssertionError                                   0
HP block executions                             38   (37 unique IDs; HP7 prints twice)
banners   --- hook-provenance tests passed! ---
          --- Governance-focused CLI tests passed! ---
          --- All CLI integration tests passed! ---
```

Compared byte-for-byte in shape against the Task 7 acceptance artifact
`verify-task7.txt`: identical on every metric (445 / 0 / 38 / three banners).
Baseline at `BASE` before Task 1 was 445 passing checks — **no decrease across the
whole work item.**

The mutation apparatus was **not** re-run. Those results are historical evidence held
by Tasks 1–7; re-running them is not Task 8's authority.

---

## Section 0.3 — Step 1 REPLACED: mirror reconciliation report

Per the Task 8 A10 human ruling, the mirror surface is **derived**, not listed.

> **A hardcoded file manifest may be used as an initial expectation, but it cannot be
> the sole authority for whole-feature mirror verification.**

### Derivation inputs

```
1. git diff <base>..HEAD      base = git merge-base main HEAD
                              DERIVED = 356e357193cbadc549e96a8eb6fbe6333e6d7cb7
2. accepted task file manifests     the Files block of each task
3. task amendments                  files a ruling added to a task's scope
                                    (Task 7 amendment added templates/cli/test/harness.js;
                                     Task 6 phase-2 repair added templates/cli/test/integration.js)
4. implementation commits           fe13346 · 1422bfc · 183721d · 8e4157e · e6fbc80 ·
                                    00fd404 · 7c80e9b · 4d9fe7d · 2d8f3a5 · 35c91cc · 3163696
```

### Scope boundary

```
Feature Mirror Surface =
    union( task declared files,
           accepted amendment-added files,
           implementation diff files )
```

That union — and nothing wider. This is **not** a whole-repository
`.evo-lite/cli → templates/cli` audit; such an audit would drag unrelated historical
mirror debt into a task that owns none of it.

### Report

```
Declared surface (plan 013d64d Step 1) — 8 pairs
    hook-provenance/observe.js
    hook-provenance/path-identity.js
    hook-provenance/schema.js
    hook-provenance/store.js
    hook-provenance/topology.js
    test/hook-provenance.js
    hooks.js
    test/governance.js

Derived surface — 10 pairs
    the eight above, plus
    test/harness.js         (Task 7 amendment)
    test/integration.js     (Task 6 phase-2 fixture repair)

Difference (derived − declared) — 2
    test/harness.js
    test/integration.js

Difference (declared − derived) — 0

Uncovered modified pairs — 0
    both pairs the declared surface missed were measured directly and are
    byte-identical to their mirrors.
```

### Pair integrity, measured

| relative path | sha256 (identical on both sides) | result |
|---|---|---|
| `hook-provenance/observe.js` | `bf69b2e48e2d1dc81a042c238bba3fa237b3278fe9f5fc26039f76b30e421d0f` | OK |
| `hook-provenance/path-identity.js` | `47eeba38350f60b2473ff3078a2f0350a6e316461cf1be5503d79f290f30c85f` | OK |
| `hook-provenance/schema.js` | `f31a9dcd5164415213a54569c3faeaafb15b191722d9139f0f1a706846194854` | OK |
| `hook-provenance/store.js` | `e2ddaf5c116487381904fa68724bb3bd2682450a815809eb646daf55e9fe3002` | OK |
| `hook-provenance/topology.js` | `3ba61017fb16689d93cd416b9f785cec813bb9ad3284dc9e2332dffa701fa5b2` | OK |
| `hooks.js` | `1730e8c6eb5278d889a717054b5f8d986fa3d56d431658e589a799e10e879511` | OK |
| `test/governance.js` | `e110cad56d50a47c46465b16d863f126454315b5f239bc4ce657b2c7b679e5e1` | OK |
| `test/harness.js` | `835bb0c2744e34a1ac5eea022bd338131c88754597ef44161cbccd1b4626b884` | OK |
| `test/hook-provenance.js` | `749bea800055c6bbbedc4ac29caa18737af3fa42325c82228f8eba8659913b53` | OK |
| `test/integration.js` | `4d42a53fe9e695037d03073cad976b51e7b14ea2448cefc864b9c07d8385caea` | OK |

Reverse direction, also asserted: every file modified under `templates/cli` in the
feature range has a mirror pair, and every file modified under `.evo-lite/cli` has a
template counterpart. Both sets are empty of exceptions.

Non-mirror files in the feature diff, listed so the surface is complete:
`index.js` (repo-root CLI, has no `templates/cli` counterpart by design) and
`docs/superpowers/plans/2026-08-18-hook-install-provenance.md`.

### Verdict

**`Declared != Derived` is TRUE (8 vs 10).** Per §8.4 of the Task 8 brief amendment,
that routes to `STOP_AND_REPORT`, never to a failed implementation, because it has
three possible causes with different owners.

**This particular difference already carries its human ruling.** It was measured and
adjudicated before implementation and is recorded in `progress.md` under
*"Task 8 A10 HUMAN RULING"*:

```
classification  TASK-8 EXECUTION INSTRUCTION GAP
authority       the Task 8 whole-feature reconciliation requirement
severity        Important
action          amend before implementation
```

The cause is named there and is **not** a plan defect: `013d64d` never declared product
behaviour wrongly; its Task 8 closure procedure did not grow as the feature's surface
grew. The defect is an authority choice — Step 1 verified *"are the files the plan's
author listed mirrored?"* when the question Task 8 exists to answer is *"is every
mirror file participating in this feature mirrored?"*

Task 8 re-measured and reproduced the ruling's numbers exactly (8 / 10 / 2 / 0
uncovered, all 10 equal). **The gap is COVERAGE, not DRIFT** — executed as written,
Step 1 would have reported all-OK forever while two modified pairs went unexamined.
No new cause was discovered and no new ruling is inferred here. See §3 entry `A10`.

---

## Section 1 — AC traceability, `ac1`–`ac16`

Authority for the criteria: frozen design `ae39cbe` (16 criteria, verified to parse).

**Prohibited compression.** No row below is written as "covered by Task 8". Where a
property's negative authority lives in a different layer than its positive control,
both are named, because the authority map *is* the content: collapsing it destroys the
only record of which layer answers the question first.

Legend for **coverage**:

- `COVERED` — positive control present, negative authority named, mutation evidence
  present and accepted.
- `COVERED (authority elsewhere)` — positive control here, negative authority
  explicitly owned by another layer, recorded rather than duplicated.
- `PARTIAL` — an identified sub-clause of the criterion has no located control. The
  residual is named. This is a finding for the reviewer, not a defect in the matrix.

---

### `ac1` — storage location, worktree separation, NESTED-TARGET

| | |
|---|---|
| **positive controls** | `HP1`, `HP2`, `HP3`, `HP3b` (path identity primitive, Task 1) · `HP7` (scope gate + storage layout, Task 3) · `HP8` (owner path from the bound authority, Task 3) · `HP16` (nested target claims nothing, Task 6) |
| **negative authority** | Task 3 topology classifier (`M5`, `M6a`, `M6b`, `M6c`) and Task 6's producer (`M14`, `M14b`) |
| **mutation evidence** | `M6b` (evo-lite literal), `M6c` (document filename), `M6a` (owner is the TARGET git-dir, not the caller cwd), `M5` (UNESTABLISHED must not claim NESTED-TARGET), `M14` (no owner dir in the enclosing worktree), `M14b` (the nested exception preserves legacy behaviour, it does not freeze it) |
| **coverage** | **PARTIAL** |
| **residual** | *"Two linked worktrees of one repository hold separate documents."* Measured during this reconciliation: no `git worktree add` appears anywhere in the four test files of the feature surface, so this sub-clause has **no located control**. The adjacent alias property (a junction/symlink of the worktree root resolves as `SAME`, therefore in scope) *is* controlled — `HP2:85` — but it is fixture-conditional: on a host where `symlinkSync` throws, the alias assertion is skipped by design. Recorded, not closed. See §3 entry `S1-a`. |

---

### `ac2` — `current` holds participation only, derived from intent

| | |
|---|---|
| **positive controls** | `HP6` (validator shape rules, Task 2) · `HP15` (`seq` monotonic, current follows intent, Task 5) · `HP17` (a realized install records outcome and runnability, Task 6) · `HP18` (`--no-hooks` records the opt-out, Task 6) |
| **negative authority** | Task 2's `C-2c` and `C-2d` in the shared validator, `schema.js` |
| **mutation evidence** | `M1` (delete `C-2c`), `M2` (delete `C-2d`), `M4h`/`M4i` (chmod value/typing boundary), `M15b` (the reason describes what was found *before* the write) |
| **coverage** | **COVERED** |
| **note** | Task 5's `M13` — *"an explicit install supersedes an earlier opt-out"* — is **RETIRED, STRUCTURALLY_DOMINATED by `C-2c`.** Its positive control (`HP15:870`) stands; its negative authority is Task 2's `C-2c`, witnessed by `M1`; the backstop is that `commit()` re-runs the shared validator before the rename, so a producer that miscomputes `current` cannot obtain a wrong-but-legal document. This is an architecture finding, not a gap. See §2. |

---

### `ac3` — integrity C-1, C-2a … C-2d

| | |
|---|---|
| **positive controls** | `HP6` — twelve negative fixtures, each failing with exactly one error which is its own guard; four positive fixtures all validating (independently confirmed by the Task 2 reviewer; masking measured at zero) |
| **negative authority** | Task 2's shared validator, `templates/cli/hook-provenance/schema.js` |
| **mutation evidence** | `M1` (C-2c), `M2` (C-2d), `M4f` (C-2b), `M3` (aggregation comparison), `M4e` (`current.digest` must not exist), `M4` (interior events are not inspected) |
| **coverage** | **COVERED** |
| **history** | `C-2b` originally had **no** negative control anywhere — the existing fixture recomputed the digest correctly, so only `C-2c` could fire. Closed by fixture `b2` + `M4f` in patch 2.1. This is ledger item `L1`, half of it. |

---

### `ac4` — `event.id` projection, `seq` ordering authority

| | |
|---|---|
| **positive controls** | `HP4` (projection is fixed-length, excludes `diagnostic`, and `recordedAt` participates in identity) · `HP6` (`seq` shape on the last event) · `HP15` (`seq` is 1 on the first event and increments by exactly one) |
| **negative authority** | Task 2's `eventId` / canonical projection in `schema.js` |
| **mutation evidence** | `M4` (a malformed interior event must not change the reader state — the "last event only" scope) |
| **coverage** | **PARTIAL** |
| **residual** | *"`seq` is the only ordering authority: a document whose `recordedAt` values run backwards still yields the same latest event, the same current derivation, and the same verdicts."* Measured during this reconciliation: every fixture in the suite carries **ascending** `recordedAt` values (`HP15` uses `00:00 → 00:01 → 00:02 → 00:03`); no descending-timestamp fixture exists. The sub-clause has **no located control**. Recorded, not closed. See §3 entry `S1-b`. |

---

### `ac5` — errno-preserving observation, the frozen phase mapping

| | |
|---|---|
| **positive controls** | `HP9` (the errno mapping is frozen, Task 4) · `HP21` (a thrown write whose bytes landed is still realized, Task 6) · `HP25` (the pre-write controller, Task 6) · `HP26` (the phase-2/3 outcomes, Task 6) · `HP29` (a phase-1 outcome stops before any write, Task 6) · vocabulary half at `HP6` (Task 2) |
| **negative authority** | Task 4's `observe.js` for the errno mapping; Task 6's `hooks.js` for the phase mapping; Task 2's validator for the vocabulary |
| **mutation evidence** | `M8` (a permission error is a failure to observe, never `unrealized`) · `M15` (a thrown write whose bytes landed is not `unrealized`) · `M15b` (the reason describes the pre-write state) · `M15c` (chmod is never called on phase 1) · `M15f` (a phase-1 outcome never writes) · `M18` (readable-but-wrong is `write-failed`, not `realized`) · `M19`, `M19b` (an unreadable artifact after an issued write is a failure to observe) · `M3v` (`install.reason` vocabulary exactness) |
| **coverage** | **COVERED** |
| **note** | `M15d` — *"record a post-write reason for a pre-write failure"* — is **RETIRED, STRUCTURALLY_DOMINATED.** See `ac12` and §2. |

---

### `ac6` — `locator`, one comparison domain, no platform branch

| | |
|---|---|
| **positive controls** | `HP12` (locator compares directory to directory, Task 4) · `HP12b` (the query is bound to B, not to the caller, Task 4) · `HP1`/`HP2`/`HP3` (the shared path-identity primitive, Task 1) |
| **negative authority** | Task 4's `observeLocator`; the `SAME`/`DISTINCT`/`UNESTABLISHED` mapping is owned by Task 1's primitive |
| **mutation evidence** | `M9` (a default installation must be satisfied, not a directory-vs-file mismatch) · `M9b` (the active hooks directory must be B's) · `M9c` (an authority that cannot be asked is indeterminate) · `M9d` (an authority that answers with a failure is indeterminate) · `M9e` (a comparison that cannot be established is indeterminate) · `M9f` (exactly one hooks-path query may exist — the "no `--git-path hooks` fallback" rule) |
| **coverage** | **COVERED** |
| **history** | `M9b` first went red on `HP12`'s *"a default installation must be satisfied"*, which caught it only because the suite's ambient cwd is a different repository — `ENVIRONMENTAL_MASKING`, the same shape as Task 3's `M6a`. Repaired in 4.1 by injecting `boundToRepo` into `HP12`'s real-git assertions; `M9b` now lands on `HP12b` with `HP=15`, i.e. `HP12` completed in full first. |

---

### `ac7` — `executable`, qualification gate, no `X_OK`

| | |
|---|---|
| **positive controls** | `HP10` (v1 has no qualified executable predicate on any host, Task 4) |
| **negative authority** | Task 4's `observeExecutable` plus two **source-level** negative assertions in `HP10`: `!/X_OK/.test(src)` and `!/process\.platform/.test(src)` |
| **mutation evidence** | `M10b` (v1 has no qualified executable predicate on any host) · `M11` (`executable` is stripped to `{ verdict, reason }` — no diagnostic leaks into a verdict) |
| **coverage** | **PARTIAL** |
| **residual** | *"`core.fileMode` appears only under `diagnostic`."* Measured: the token `core.fileMode` occurs **zero times** in `observe.js`, `hooks.js` and the HP test file. The clause is satisfied vacuously by absence, not by an assertion — there is no source-level negative assertion pinning it the way `X_OK` and `process.platform` are pinned. Recorded, not closed. See §3 entry `S1-c`. |
| **history** | The plan's own `observe.js` body contained the literal token `X_OK` inside the comment explaining why `accessSync X_OK` is disqualified, while `HP10` asserts `!/X_OK/.test(src)` over that same file — the plan could never pass its own test. This is plan self-consistency defect **#1**; see §4. |

---

### `ac8` — `interpreter`, aligned syntax-only validation, exact-path qualification

| | |
|---|---|
| **positive controls** | `HP11` (interpreter is aligned and never guesses, Task 4) — asserts the declared entry is the one statted *and* the one spawned, with both fs calls injected so the control is host-independent |
| **negative authority** | Task 4's `observeInterpreter`, over the amended `ae39cbe` boundary |
| **mutation evidence** | `M10` (the syntax check runs through that SAME declared entry) · `M10c` (presence is established for the DECLARED entry) · `M10d` (`#!/usr/bin/env bash`) · `M10e` (`#!/tmp/tools/bash`) · `M10f` (`#!/bin/bash --definitely-invalid-option`) |
| **coverage** | **COVERED** |
| **history — the highest-value finding of the work item** | `a8c8986` originally required *"an incompatible interpreter family IS not-satisfied"* while the plan had narrowed v1 the other way across four commits and stated outright that the member is unreachable. Task 4's header claimed `ac8`; the specified implementation provably could not satisfy it; **every test would have passed.** Closed by spec amendment `ae39cbe`, which narrowed `ac8` and added the note that *membership is not producer reachability*: `incompatible-interpreter` and `predicate-qualification-failed` stay in the frozen vocabulary and no v1 producer emits them. `schemaVersion` stayed 1 — narrowing what a producer emits removes no member. Verified independently from GitHub before Task 4 was authorized. |
| **note** | `M10d` was originally an `EQUIVALENT` mutation — exit 0, suite fully green — because re-admitting the two-token env form returned `bash`, which `SUPPORTED_ENTRIES` rejects anyway. Redesigned in 4.1 to unpack the wrapper into an entry that *is* in the allowlist, which is the forbidden inference itself. |

---

### `ac9` — the commit transaction, rename as the commit point

| | |
|---|---|
| **positive controls** | `HP15c` (the commit gate refuses bad data before the rename, Task 5) · `HP22` (provenance is committed after the artifact, never before, Task 6) · `HP23` (the rename is the commit point, Task 6) · `HP27` (a committed artifact with an uncommitted record reports both, Task 6) · `HP19` (a no-op invocation still records an event, Task 6) |
| **negative authority** | Task 5's `store.js` commit transaction; Task 6's producer for the post-rename rule |
| **mutation evidence** | `M13c` (a temp the validator rejects must never be renamed into place) · `M13d` (a read-back that is valid but is not what we wrote must never be renamed) · `M13e` (a cleanup that also fails must not be collapsed into a single error) · `M16` (an artifact write after the rename) · `M16b` (a fallible stat after the rename) · `M20` (the artifact dimension is reported beside the provenance failure) · `M20e` (the CLI surfaces BOTH dimensions) |
| **coverage** | **COVERED** |
| **history** | The commit transaction originally had **no test at all** — read-back validation, fingerprint comparison, temp cleanup and the `AggregateError` composition were four independent facts with zero assertions and zero mutations, and they are exactly what `ac9` makes load-bearing. Registered as Task 5 `I3`, strengthened by human ruling beyond the controller's proposal (a cleanup test alone proves only the cleanup path), and closed by `HP15c` + `M13c`/`M13d`/`M13e`. |
| **note** | `M16` and `M16b` each required three apparatus iterations (`mut6-g`, `mut6-g2`, `mut6-g3`) before the mutant expression altered the intended semantic dimension. All three iterations are retained in the workspace; only the final record is counted. This is the origin of the mutation-viability preflight. |

---

### `ac10` — one shared validator; ABSENT only on positive ENOENT

| | |
|---|---|
| **positive controls** | `HP6` (validator scope: top level, `current`, last event only, Task 2) · `HP13` (`observeRunnability` yields a shape the shared validator accepts — interface self-proof, Task 4) · `HP14` (only a positive ENOENT makes the document ABSENT, Task 5) · `HP16d` (a scaffold with no Git administrative container produces no document, Task 6) |
| **negative authority** | Task 2's `validateHookProvenanceV1` — the single validator both producer and reader use |
| **mutation evidence** | `M12` (a permission error must not be reported as ABSENT) · `M13b` (a document that parses but fails the shared validator is UNOBSERVABLE) · `M4` (interior events are not inspected) · `M4g` (an unrecognised component verdict is not positive evidence) · `M11b` (the verdict is the *shared* mechanical aggregation, not a second one computed locally) |
| **coverage** | **COVERED** |
| **history** | `ac10`'s parseable-but-invalid class was originally unasserted: both negative fixtures were *unparseable*, so the `validateHookProvenanceV1` call in `readProvenance` was never the reason for UNOBSERVABLE and deleting it turned nothing red. That call is the reader/shared-validator seam `ac10` exists to fix. Registered as Task 5 `I4`, closed by `M13b`. |

---

### `ac11` — `--no-hooks` is the sole authority for explicit non-participation

| | |
|---|---|
| **positive controls** | `HP20` (Task 7) — five scenarios, five fixture-validity gates, five `status === 0` assertions, driven in-process through the real harness so real Commander parsing, real `runInit`, real Git topology and the real Task 7 → Task 6 handoff are exercised · `HP18` (the producer half, Task 6) |
| **negative authority** | Task 7's `index.js` call site for the flag→intent translation; Task 2's `C-2d` for intent coherence |
| **mutation evidence** | `M17` (`--no-git` governs repository initialisation only, never hook participation) · `M17b` (no `.git` may be created in order to record an opt-out) |
| **coverage** | **COVERED (negative authority for `source` elsewhere)** |
| **the `source` property — recorded in full, never compressed** | |

```
positive control                : PASS  (Task 7 / HP20)
local Task-7 negative mutation  : N/A — no third mutation was ever declared
reason                          : STRUCTURALLY DOMINATED BY C-2d
negative authority              : Task 2 / C-2d / HP6, witnessed by M2
backstop                        : the shared validator runs before every commit, so a
                                  mistranslated source cannot produce a
                                  wrong-but-legal record
```

Measured, not reasoned (`probe-task7.js`): `--no-hooks` mistranslated as
`{ non-participating, scaffold-default }` makes `installPostCommitHook` throw
*"intent incoherent"*, provenance goes ABSENT, `HP20`'s first assertion yields a
`TypeError` rather than an `AssertionError`, and the real `HP20` dies earlier still
because a non-zero scaffold exit makes `execFileSync` throw. Unrepairable by
reshaping: the frozen vocabulary gives `non-participating` **exactly one** legal
source (verified programmatically), so every source mutation is incoherent and `C-2d`
necessarily rejects it first.

This is **not** a retired mutation and **not** a gap. It is the ledger form the human
ruled: *keep the assertion, do not open a production seam to observe the intent.*
Task 7's mutation set stays at two.

`M17`'s viability was the load-bearing preflight measurement: it binds the whole
*coherent* pair to `--no-git`. Expressed naively — participation alone, leaving
`source` at `scaffold-default` — `C-2d` would have rejected it before `HP20` could
read the document, and the mutation would have died on domination instead of on its
guard, making it not Task-7-local evidence at all.

---

### `ac12` — `install` shape: `targetPath`, `expectedBodyDigest`, `chmod`

| | |
|---|---|
| **positive controls** | `HP6` (the conditional shape rules, Task 2) — fixtures `i` (pre-write carries no chmod), `j` (an outcome that follows an issued write must carry chmod), `cf` (an issued write whose chmod was skipped is legal), `cfBad` (typed fields) · `HP25`, `HP26` (the producer's phase-2/3 chmod presence, Task 6) |
| **negative authority** | Task 2's shared validator, `templates/cli/hook-provenance/schema.js`, phase-gated install block |
| **mutation evidence** | `M4b` (a pre-write outcome must carry no chmod) · `M4d` (and it must not claim a chmod) · `M4h` (an issued write whose chmod was skipped is a legal v1 record) · `M4i` (chmod fields stay typed) · `M15c` (chmod is never called on phase 1) · `M3v` (`install.reason` vocabulary exactness) |
| **coverage** | **PARTIAL — and this is the correct result, not a defect in the matrix** |
| **residual 1 — `L3`, an open design question** | *May `chmod` be ABSENT on a phase-2/3 outcome?* `ac12` says chmod *"is present if and only if the hook write was issued: absent on every phase-1 outcome and PRESENT on every phase-2/3 outcome."* During patch 2.1 the human's literal fix text was *"if chmod absent: allowed"*, which would contradict `ac12`. The controller **stopped and reported the divergence in the ruling itself** rather than implementing it, and shipped only the common subset of both readings: presence stays mandatory on phase 2/3, and only the *value* of `attempted` is relaxed from `=== true` to `boolean`. The human withdrew the instruction as having crossed the authorization boundary and confirmed the stop was correct. `ac12` is untouched in `ae39cbe`. **Task 8 may not decide this.** See §3, `L3`. |
| **residual 2 — HP6-`j`, a witness gap** | The chmod-required rule has a validator rule and an assertion, but **no mutation names that assertion as its first responsible guard.** See §5. |

---

### `ac13` — workspace-scope preflight, six mutually exclusive states

| | |
|---|---|
| **positive controls** | `HP7` (the scope gate is total — five states reached over disjoint fixtures, 5 of 5 distinct, Task 3) · `HP8` (owner from the bound authority, Task 3) · `HP16` (NESTED-TARGET claims nothing, Task 6) · `HP16b` (SCOPE-UNRESOLVED mutates nothing, Task 6) · `HP16c` (a nested opt-out still refuses the hook, Task 6) · `HP16d` (NO-GIT-ADMIN-TOPOLOGY touches nothing and does not throw, Task 6) |
| **negative authority** | Task 3's `classifyTopology` for the state machine; Task 6's producer for the fail-closed and carve-out rules |
| **mutation evidence** | `M5` · `M6a` · `M7` (a positive not-a-repository must not be swallowed) · `M7b` (a bare repo is not a positive not-a-repository answer) · `M7c` (the OWNER catch must not collapse onto SCOPE-UNRESOLVED) · `M14` · `M14b` · `M14c` · `M14d` · `M14e` |
| **coverage** | **COVERED end to end at Task 6** |
| **history** | The owner-query-throws → `OWNER-UNRESOLVED` branch had **no assertion** in Task 3 and none in any later task — `HP7`'s `unavailable` injector throws on the first call, so the scope gate answers and the owner catch is never entered. Deleting the branch left the suite green: implemented, described by `ac13`, never proved. Registered `T3-A`, closed by an owner-throw fixture + `M7c`. The controller further refined the ruling's literal mutation (deleting the try/catch lets the ENOENT escape and the suite dies on an *uncaught* Error — `guardHit = FALSE` by this project's own bar), so `M7c` collapses the catch's return to `SCOPE-UNRESOLVED` instead. |
| **note** | `M6a` is the origin of standing rule `R-A`. Its red originally landed on `HP7`'s `T3-B` layout assertion, which held only because the suite's ambient cwd happens to be a different repository — measured, not reasoned (`probe-m6a.js`): with cwd set to the fixture itself, the guard evaporates. `HP8` manufactures the divergence on purpose and is the load-bearing guard. Repaired in 3.1 by injecting `boundToTarget` into `T3-B`; `M6a` now lands on `HP8` with `HP=10`, i.e. `HP7` completed in full. |

---

### `ac14` — read-before-mutate gate

| | |
|---|---|
| **positive controls** | `HP14` (only a positive ENOENT makes the document ABSENT, Task 5) · `HP15b` (an unobservable document is never overwritten, Task 5) · `HP28` (an unobservable document stops the run BEFORE the artifact, Task 6) |
| **negative authority** | Task 5's `readProvenance`/`appendEvent`; Task 6's producer for the ordering |
| **mutation evidence** | `M12` (a permission error must not be reported as ABSENT) · `M12b` (appending onto an unobservable document must throw) · `M13b` (parseable-but-invalid is UNOBSERVABLE) · `M16c` (move the UNOBSERVABLE gate to just before `appendEvent` → the hook is byte-identical, the gate ran BEFORE the artifact was touched) |
| **coverage** | **COVERED** |

---

### `ac15` — every Git authority query is bound to the workspace

| | |
|---|---|
| **positive controls** | `HP8` (owner path comes from the bound authority, Task 3) · `HP12b` (the locator query is bound to B, not to the caller, Task 4) — the A-to-B controller the design names |
| **negative authority** | Task 3's `defaultGitQuery` binding; Task 4's `observeLocator` binding |
| **mutation evidence** | `M6a` (the owner must be the TARGET git-dir, never the caller cwd git-dir) · `M9b` (the active hooks directory must be B's, even when the caller stands in A) |
| **coverage** | **COVERED** |
| **note** | Both mutations for this criterion are the two `ENVIRONMENTAL_MASKING` cases the work item found, and both were repaired to land on the binding guard rather than on an ambient-cwd accident. `ac15` is therefore the criterion whose evidence quality improved most under review: an ambient-cwd guard would have "passed" while proving nothing about binding. |

---

### `ac16` — the pre-write controller, both halves at once

| | |
|---|---|
| **positive controls** | `HP25` (Task 6) — the single controller the frozen design names. Starting from a recorded opt-out with a third-party hook on disk, an explicit `hook-install-command` runs against a workspace where reading the existing post-commit fails with EACCES. Asserts, in one block: exactly one event committed, hook byte-identical, `chmodCalls === 0`, intent `participating`/`hook-install-command`, outcome `indeterminate`/`pre-write-observation-failed`, no chmod, no `expectedBodyDigest`, no runnability, and `current` becomes `participating` |
| **negative authority** | Task 6's producer for the phase-1 branch; Task 2's validator for the resulting document's legality |
| **mutation evidence** | `M15c` (chmod is never called) · `M15e` (exactly one event is committed) · `M15f` (a phase-1 outcome never writes the artifact) |
| **coverage** | **COVERED** |
| **note** | `ac16` is the criterion the amended design added; it is not claimed by any task header in frozen plan `013d64d` (`Satisfies …` lines stop at `ac15`). Its controller is nonetheless present, labelled `(ac16)` in the source at `test/hook-provenance.js:1294`, and carries three accepted mutations. `M15d` — the fourth mutation aimed at this block — is **RETIRED, STRUCTURALLY_DOMINATED**; see §2 and §5. |

---

### AC coverage summary

```
COVERED                          12    ac2 ac3 ac5 ac6 ac8 ac9 ac10 ac11 ac13 ac14 ac15 ac16
PARTIAL, residual named           4    ac1 ac4 ac7 ac12
```

Three of the four `PARTIAL` residuals (`ac1`, `ac4`, `ac7`) were **measured during this
reconciliation** and are new entries (`S1-a`, `S1-b`, `S1-c` in §3). The fourth
(`ac12`) is `L3`, open by human ruling since Task 2 and explicitly reserved from every
task since.

**A matrix that is not fully green is the correct result here.** Task 8 has no
authority to close any of these four, and did not.

---

## Section 2 — Mutation evidence reconciliation

### 2.1 Inventory reconciliation — derived, not hardcoded

```
Current reconciled snapshot at 3163696: 67
Rule: |union of IDs declared by every mutate*.js in the SDD workspace|
```

**This number is a snapshot, not a constant.** A later task that adds a mutation must
**re-derive** it, never inherit it. The plan's `expected count = 42` is the cautionary
case: it was correct when `013d64d` was frozen and became wrong as the evidence set
grew across Tasks 3–7. A constant frozen into a document outlives the world it
described.

All eleven assertions, derived at `3163696`:

| # | assertion | derived | result |
|---:|---|---|:--:|
| 1 | apparatus unique IDs == 67 | 67 | PASS |
| 2 | per-task decomposition == 13 + 7 + 15 + 7 + 23 + 2 | 13 + 7 + 15 + 7 + 23 + 2 = 67 | PASS |
| 3 | admissible == 65 | 67 − 2 retired = 65 | PASS |
| 4 | retired == 2 (`M13`, `M15d`) | `M13`, `M15d` | PASS |
| 5 | admissible + retired == apparatus unique IDs | 65 + 2 = 67 | PASS |
| 6 | plan unique IDs == 42 | 42 | PASS |
| 7 | plan ID set ⊆ apparatus ID set | true | PASS |
| 8 | planned IDs missing from apparatus == 0 | 0 | PASS |
| 9 | post-plan additions == 25 | 25 | PASS |
| 10 | duplicate IDs within a task == 0 | 0 in all seven files | PASS |
| 11 | decomposition agrees with the ledger's accepted per-task numbers | see below | PASS |

**Assertion 11 is the one that matters**, because it is the only one that uses two
sources. The decomposition is **not** recomputed from the apparatus alone; it is
checked against the per-task numbers the human accepted in `progress.md`:

| task | ledger's accepted statement | admissible | retired | apparatus IDs |
|---|---|---:|---:|---:|
| Task 2 (2.1) | *"Mutation suite re-run in full — 13 run, 13 effective, 13 guardHit TRUE"* | 13 | 0 | 13 |
| Task 3 (3.1) | *"All SEVEN mutations re-run … 7 effective, 7 guardHit TRUE"* | 7 | 0 | 7 |
| Task 4 (4.1) | *"ALL FIFTEEN re-run … 15 effective, 15 guardHit TRUE, 15 declared == first responsible"* | 15 | 0 | 15 |
| Task 5 | *"6 admissible, 6/6 effective, 6/6 guardHit TRUE"* + *"`M13`: RETIRED"* | 6 | 1 | 7 |
| Task 6 | *"22 admissible, 22/22 effective … Plus 1 RETIRED"* | 22 | 1 | 23 |
| Task 7 | *"2 admissible, 2/2 effective, 2/2 guardHit TRUE"* | 2 | 0 | 2 |
| **total** | | **65** | **2** | **67** |

The apparatus and the accepted counts **agree**. Had they disagreed, that would have
been a finding requiring `STOP_AND_REPORT` — not an adjustment of either side.

The ledger labels the first bucket `T1-2 13`. Measured: all 13 IDs in that bucket are
Task 2's (`mutate.js` 9 ⊂ `mutate2.js` 13). Task 1's evidence amendment ran two
mutations in a **different ID namespace** — `M-G2a` (rejected as evidence, masked by
`HP1`) and `M-G2b` (accepted, red on `HP3b`) — run ad hoc rather than through a
`mutate*.js` device, so they fall outside the derivation rule by construction. The
count is correct; the bucket label is loose. Recorded as §3 entry `S2-a`, not
adjusted.

### 2.2 Post-plan additions — 25, each with a traceable source

| ID(s) | task | source of the addition |
|---|---|---|
| `M3v` | 2 | `progress.md` Task 2 block — the plan's Task 2 mutation table had no member aimed at the `install.reason` vocabulary membership check. Added as an **additional** control rather than renaming anything. Half of `L1`. |
| `M4f` | 2 | patch 2.1 finding `F2` — `C-2b` had no negative control anywhere. Other half of `L1`. |
| `M4g` | 2 | patch 2.1 finding `F1` — `aggregateRunnability` treated a present-but-unreadable component as `satisfied`. |
| `M4h`, `M4i` | 2 | patch 2.1 finding `F3` — both sides of the new chmod `attempted` boundary. |
| `M6c` | 3 | `task-3-brief-amendment.md`, finding `T3-B` (storage layout assertions). |
| `M7c` | 3 | `task-3-brief-amendment.md`, finding `T3-A` (owner-throw fixture), with the controller's refinement from "remove owner catch" to "collapse the catch's return". |
| `M9b` | 4 | `task-4-brief-amendment.md` — **rename**, not an addition: the Task 3 amendment spent `M6b`/`M6c` while Task 4's plan-native table already used `M6b` (controller ID collision `m1`). `M6b` → `M9b`. |
| `M9c`, `M9d`, `M9e` | 4 | `task-4-brief-amendment.md`, finding `I2` — `observeLocator`'s three failure-to-observe branches had no assertion and no mutation. |
| `M9f` | 4 | `task-4-brief-amendment.md`, finding `I4` — `ac6`'s "no fallback to `--git-path hooks`" had no guard. |
| `M11b` | 4 | `task-4-brief-amendment.md`, finding `I3` — new `HP13` interface self-proof. |
| `M12b` | 5 | `task-5-brief-amendment.md`, finding `I2` — identifier collision; Task 5's plan-native `M11` was already spent by accepted Task 4 evidence. `M11` → `M12b`. |
| `M13b` | 5 | `task-5-brief-amendment.md`, finding `I4` — `ac10`'s parseable-but-invalid class was unasserted. |
| `M13c`, `M13d`, `M13e` | 5 | `task-5-brief-amendment.md`, finding `I3` **as strengthened by the human**: validation, fingerprint and cleanup+`AggregateError` each need their own fixture. |
| `M14e` | 6 | `task-6-brief-amendment.md` round 1 — the two further gaps the human added. |
| `M15f` | 6 | `task-6-brief-amendment.md` round 1. |
| `M16c` | 6 | `task-6-brief-amendment.md` round 1. |
| `M20b`, `M20c` | 6 | `task-6-brief-amendment.md` round 2, finding `I4` (16 → 21 mutations). |
| `M20d`, `M20e` | 6 | `task-6-brief-amendment.md` round 3 — option (c): drive both remaining CLI paths (16 → 23 mutations). |

Counted: **25**, matching assertion 9. Every one traces to an amendment or to a
`progress.md` ledger entry. **No ID was renumbered away**: the two renames (`M6b`→`M9b`,
`M11`→`M12b`) moved a *future* task's identifier because accepted evidence IDs are
ledger identity — *"history is not renumbered, the future task moves"* (human ruling,
Task 5).

### 2.3 The three axes

`RETIRED`, `STRUCTURALLY_DOMINATED` and `LOCALLY_NON_FALSIFIABLE` are **not three
values of one column.** They are three axes, and real entries occupy them
independently. `PASS`/`FAIL` alone is forbidden.

```
disposition                 execution / falsifiability      classification
    ADMISSIBLE                  EFFECTIVE                       NORMAL
    RETIRED                     LOCALLY_NON_FALSIFIABLE         STRUCTURALLY_DOMINATED
    N/A                         N/A                             EQUIVALENT
                                                                ENVIRONMENTAL_MASKING
                                                                UNCAUGHT_ERROR
                                                                CO_OCCURRING_FAILURE
```

Naming note: the first ruling called the admissible disposition `ACCEPTED_ADMISSIBLE`;
the second renamed it `ADMISSIBLE`. **Same value, one name** — a closed enum with two
spellings for one state is itself a defect. Only `ADMISSIBLE` is used below.

Rules:

```
ADMISSIBLE
  -> effective            == true
  -> guardHit             == true
  -> declaredGuard        == firstResponsibleGuard

RETIRED
  -> NOT required to be redesigned and re-run
  -> MUST carry classification
  -> MUST carry namedAuthority
  -> MUST carry authorityPointer
  -> MUST state why it is no longer part of the admissible mutation set
```

> **Only an admissible mutation seeking acceptance must be redesigned and re-run when
> `guardHit=false`. Historical retired / dominated / non-falsifiable evidence must
> retain its adjudicated classification.**

**`guardHit` is reported in two columns, deliberately.** `guardHit (device)` is what
the message-matching apparatus wrote to `mut*.txt`. `guardHit (adjudicated)` is the
accepted value under the **upgraded guard-identity rule** the human adopted in Task 6:

```
guard identity = the assertion message when present and unique,
                 OTHERWISE a pinned structural identity:
                 commit SHA + file + HP block + normalized assertion expression.
```

A message is a convenience label; the **expression** is the authority. Treating the two
as equivalent turns a perfectly valid message-less assertion into a false "no guard" —
an evidence-tooling false negative. Block-level identification was explicitly
**rejected** as too coarse. Collapsing the two columns into one would erase either the
raw measurement or the ruling; both are kept.

### 2.4 `authorityPointer` convention

A pointer is a **structural identity**, never a bare line number, because line numbers
move and a rotted pointer silently degrades into "covered". Written as:

```
<file> § <HP block> :: <normalized assertion expression>
```

Line numbers, where given, are advisory and qualified by `@3163696`. All pointers
below were re-resolved against the sources at `3163696`.

### 2.5 `restorationProof`

Restoration is proved **per apparatus run**, not per mutation — a run applies its
mutations, restores, and then proves the tree is clean. Every row's
`restorationProof` is the four-fold proof recorded for its task:

```
1. git diff vs HEAD: empty — byte-identity with the committed baseline
2. sha256 of every touched file unchanged, and every mirror pair equal
3. every mutation anchor occurs exactly once in the restored source
4. full suite after restore: exit 0, 445 checks, 0 AssertionError, three banners
```

| task | four-fold proof recorded in | post-restore artifact | apparatus footer |
|---|---|---|---|
| T1 | `progress.md`, Task 1 evidence amendment block — `path-identity.js` sha256 back to `47eeba38…`, all three mirror pairs equal, full suite after restore exit 0 / 445 / 0 / three banners | *(recorded inline; `verify-task1.txt` is the pre-mutation run)* | *(ad-hoc run, no `mutate*.js` device)* |
| T2 | `progress.md`, Task 2.1 block | `verify-task2-1-post-mutation.txt` | `ALL RESTORED, tree matches HEAD, mirrors equal` |
| T3 | `progress.md`, Task 3.1 block | `verify-task3-1-post-mutation.txt` | `ALL RESTORED, tree matches HEAD, mirrors equal` |
| T4 | `progress.md`, Task 4.1 block | `verify-task4-1-post-mutation.txt` | `ALL RESTORED, tree matches HEAD, mirrors equal` |
| T5 | `progress.md`, Task 5 block | `verify-task5-post-mutation.txt` | `ALL RESTORED, tree matches HEAD, mirrors equal` |
| T6 | `progress.md`, Task 6 block | `verify-task6-post-mutation.txt` | `ALL RESTORED, tree matches HEAD, mirrors equal` |
| T7 | `progress.md`, Task 7 block | `verify-task7-post-mutation.txt` | `ALL RESTORED, tree matches HEAD` (`index.js` has no mirror) |

The devices additionally refuse to run if the pre-mutation sha256 differs from
baseline, abort if the anchor does not occur exactly once, abort if the edit was a
no-op, and re-verify the sha256 after restoring.

### 2.6 The complete 67-ID inventory

All 67 rows. `exit` and `guardHit (device)` are read from the final `mut*.txt` record.

`disp` = disposition · `fals` = execution/falsifiability · `class` = classification ·
`gH-d` = guardHit (device) · `gH-a` = guardHit (adjudicated) · `rest` = restorationProof.

#### Task 2 — `schema.js`, the shared validator (13)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M1` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `test/hook-provenance.js § HP6 :: "C-2c: participating current over a non-participating intent must be rejected"` | T2 |
| `M2` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "C-2d: an explicit install may not be recorded as an explicit opt-out"` | T2 |
| `M3` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "runnability.verdict must equal the aggregation of its components"` | T2 |
| `M3v` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "already-current is not a v1 reason"` | T2 |
| `M4` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "a malformed interior event must not change the reader state"` | T2 |
| `M4b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "a pre-write outcome must carry no chmod: no write was attempted"` (assertion `i`, `:286@3163696`) | T2 |
| `M4c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "runnability must have no top-level reason"` | T2 |
| `M4d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "and it must not claim a chmod: the write was never issued"` | T2 |
| `M4e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "current.digest must not exist"` | T2 |
| `M4f` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "C-2b: resultingCurrentDigest must equal the digest of current.participation"` (fixture `b2`) | T2 |
| `M4g` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP5 :: "an unrecognised component verdict is not positive evidence"` | T2 |
| `M4h` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "an issued write whose chmod was skipped is a legal v1 record"` (fixture `cf`) | T2 |
| `M4i` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP6 :: "chmod fields stay typed: attempted must be a boolean"` (fixture `cfBad`) | T2 |

`M4g` ran with `HP=6`, not 7: `HP5` precedes `HP6` and aborts there. That is the
guard's **position**, not an early crash — the declared guard *is* in `HP5`. Accepted
by human ruling with the harness semantic named explicitly: **first responsible guard
wins.** Demanding the later blocks also run would change what the harness means.

#### Task 3 — `topology.js` (7)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M5` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `test/hook-provenance.js § HP7 :: "must be SCOPE-UNRESOLVED, never NESTED-TARGET"` | T3 |
| `M6a` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP8 :: "the owner must be the TARGET git-dir, never the caller cwd git-dir"` | T3 |
| `M6b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP7 :: "it lives in the evo-lite subdirectory"` | T3 |
| `M6c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP7 :: "the document is named hook-provenance.json"` | T3 |
| `M7` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP7 :: "a non-repository must not be swallowed into SCOPE-UNRESOLVED"` | T3 |
| `M7b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP7 :: "is NOT a positive not-a-repository answer"` | T3 |
| `M7c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP7 :: "OWNER-UNRESOLVED, never SCOPE-UNRESOLVED"` | T3 |

`M6a`'s **first pass** was `ENVIRONMENTAL_MASKING` (red on `T3-B` in `HP7`, which held
only because the suite's ambient cwd is a different repository). The classification
above is the **post-3.1** state after `T3-B` was given an injected `boundToTarget`.
The historical `ENVIRONMENTAL_MASKING` finding is not erased — it is recorded here and
is the origin of standing rule `R-A`.

#### Task 4 — `observe.js` (15)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M8` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP9 :: "a permission error is a failure to observe, never unrealized"` | T4 |
| `M9` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12 :: "a default installation must be satisfied, not a directory-vs-file mismatch"` | T4 |
| `M9b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12b :: "the active hooks directory must be B's, even when the caller stands in A"` | T4 |
| `M9c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12 :: "an authority that cannot be asked is indeterminate, never not-satisfied"` | T4 |
| `M9d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12 :: "an authority that answers with a failure is indeterminate, never not-satisfied"` | T4 |
| `M9e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12 :: "a comparison that cannot be established is indeterminate, never not-satisfied"` | T4 |
| `M9f` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP12 :: "exactly one hooks-path query may exist"` | T4 |
| `M10` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP11 :: assert.deepStrictEqual(invoked, [declared], \`the syntax check runs through that SAME declared entry …\`)` | T4 |
| `M10b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP10 :: "v1 has no qualified executable predicate on any host"` | T4 |
| `M10c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP11 :: assert.deepStrictEqual(statted, [declared], "presence is established for the DECLARED entry, not for a name resolved elsewhere")` | T4 |
| `M10d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP11 :: assert.strictEqual(v.reason, 'ambiguous-interpreter', \`${line} is not a form v1 can prove end to end, so it is ambiguous\`)` with `line = '#!/usr/bin/env bash'` | T4 |
| `M10e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | same template assertion, `line = '#!/tmp/tools/bash'` | T4 |
| `M10f` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | same template assertion, `line = '#!/bin/bash --definitely-invalid-option'` | T4 |
| `M11` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP13 :: assert.deepStrictEqual(Object.keys(runnability[name]).sort(), ['reason','verdict'], \`${name} is stripped to { verdict, reason } …\`)` with `name = 'executable'` | T4 |
| `M11b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP13 :: "the verdict is the shared mechanical aggregation of its components"` | T4 |

**Guard-identity note for `M10d`/`M10e`/`M10f`/`M11`.** These four declared guards
produce **no literal match** in the test source, because their messages are built by
**template literals** (`` `${line} is not a form …` ``, `` `${name} is stripped …` ``).
Their identity is therefore structural — file § HP block § normalized assertion
expression + the loop binding — exactly as the upgraded rule requires. This is not a
missing guard; a message-matching search alone would misreport it as one.

**`M11` bookkeeping history.** Its declared guard was originally `locator`. Measured:
`observeLocator` returns exactly `["verdict","reason"]`, so `strip(locator)` is the
**identity** and the locator assertion could not witness the mutation.
`observeExecutable` returns four keys and is the first component that can — the red
landed there, correctly. The declaration was corrected to `executable`; **no test,
implementation or mutation changed.** Bookkeeping, not repair.

**`M9b` first pass** was `ENVIRONMENTAL_MASKING` — Task 3's `M6a` defect reproduced in
a **plan-native** mutation. **`M10d` first pass** was `EQUIVALENT` — exit 0, suite
fully green. Both were repaired in 4.1 and both first-pass classifications are
recorded here rather than erased; the 12/15 first pass is why the final 15/15 is worth
believing.

#### Task 5 — `store.js` (7: 6 admissible + 1 retired)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M12` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP14 :: "a permission error must not be reported as ABSENT"` | T5 |
| `M12b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP15b :: assert.throws(…, /unobservable/i, "appending onto an unobservable document must throw")` | T5 |
| **`M13`** | **RETIRED** | **N/A** | **STRUCTURALLY_DOMINATED** | 1 | FALSE | N/A | see detail block below | T5 |
| `M13b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP14 :: "a document that parses but fails the shared validator is UNOBSERVABLE"` | T5 |
| `M13c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP15c :: "a temp the shared validator rejects must never be renamed into place"` | T5 |
| `M13d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP15c :: "a read-back that is valid but is not what we wrote must never be renamed into place"` | T5 |
| `M13e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP15c :: "a cleanup that also fails must not be collapsed into a single error"` | T5 |

##### `M13` — RETIRED, STRUCTURALLY_DOMINATED

```
mutation ID             M13
task                    5
disposition             RETIRED
falsifiability          N/A  (not a local negative control; nothing to falsify here)
classification          STRUCTURALLY_DOMINATED
exit                    1
guardHit (device)       FALSE — red on (UNCAUGHT ERROR, not an assertion)
guardHit (adjudicated)  N/A — not required; a retired entry is not re-run for guardHit
declaredGuard           "an explicit install supersedes an earlier opt-out"
namedAuthority          Task 2's C-2c, in the shared validator
authorityPointer        templates/cli/hook-provenance/schema.js
                          § C-2c integrity block
                          :: errors.push('C-2c: current.participation != last event
                             intent.participation')
                        witnessed by Task 2's M1, whose first responsible guard is
                          templates/cli/test/hook-provenance.js § HP6
                          :: "C-2c: participating current over a non-participating
                             intent must be rejected"
positive control        templates/cli/test/hook-provenance.js § HP15
                          :: assert.strictEqual(second.current.participation,
                             'participating', 'an explicit install supersedes an earlier
                             opt-out even when it did not realize')     (:870@3163696)
backstop                commit() re-runs the shared validator before the rename
restorationProof        T5 four-fold
```

**Why it is no longer part of the admissible mutation set.** Measured in-process
(`probe-m13.js`), not reasoned: the document `M13` would commit is rejected by the
shared validator with the **sole** violation
`["C-2c: current.participation != last event intent.participation"]`. `commit()`
re-runs that validator before the rename, so `appendEvent` throws and `HP15` — an
unguarded call — dies on a raw `Error`. By rule `R-B` that is not a `guardHit`.

The three-part test for this class is satisfied:

1. the mutation genuinely changes behaviour;
2. the dominating guard is identified (`C-2c`) **and** independently witnessed (`M1`);
3. no same-property mutation can bypass it without changing a **second** contract —
   evading `C-2c` requires also rewriting `event.intent`, which stops testing *"current
   wrongly derived from install.outcome"* and starts testing *"producer tampers with
   the caller's intent."*

The resulting authority is **stronger** than forcing `guardHit=true` would have been:
a producer that miscomputes a field cannot obtain a wrong-but-legal document, because
the transaction refuses to commit. This is a finding about **architecture**, not a gap.

#### Task 6 — `hooks.js` (23: 22 admissible + 1 retired)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M14` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP16 :: "a nested target must not create an owner directory in the enclosing worktree"` | T6 |
| `M14b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP16 :: "the nested exception preserves legacy installer behaviour, it does not freeze it"` | T6 |
| `M14c` | ADMISSIBLE | EFFECTIVE | **GUARD_IDENTITY** (NORMAL after ruling) | 1 | **FALSE** | TRUE | see detail block below | T6 |
| `M14d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP16c :: "a nested opt-out still refuses the hook: a topology fact must not overrule an explicit instruction"` | T6 |
| `M14e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP16d :: "a workspace with no Git administrative container gets no hook, even where a hooks directory exists"` | T6 |
| `M15` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP21 :: "a thrown write whose bytes landed must not be recorded as unrealized"` | T6 |
| `M15b` | ADMISSIBLE | EFFECTIVE | **GUARD_IDENTITY** (NORMAL after ruling) | 1 | **FALSE** | TRUE | see detail block below | T6 |
| `M15c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP25 :: assert.strictEqual(chmodCalls, 0, 'chmod is never called')` (`:1332@3163696`) | T6 |
| **`M15d`** | **RETIRED** | **N/A** | **STRUCTURALLY_DOMINATED** | 1 | FALSE | N/A | see detail block below | T6 |
| `M15e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP25 :: assert.strictEqual(doc.doc.events.length, eventsBefore + 1, 'exactly one event is committed')` (`:1330@3163696`; the same message also appears in `HP29:1601`, but `HP25` runs first and is the first responsible guard) | T6 |
| `M15f` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP29 :: "a phase-1 outcome never writes the artifact: the fact was established before any write"` | T6 |
| `M16` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP22 :: "the provenance commit is the last write of the invocation"` | T6 |
| `M16b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP23 :: "no fallible operation may follow the commit rename"` | T6 |
| `M16c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP28 :: "the hook is byte-identical: the gate ran BEFORE the artifact was touched"` | T6 |
| `M16d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP24 :: "artifactContent reports unchanged when no byte changed"` | T6 |
| `M18` | ADMISSIBLE | EFFECTIVE | **GUARD_IDENTITY** (NORMAL after ruling) | 1 | **FALSE** | TRUE | see detail block below | T6 |
| `M19` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP26 :: "an unreadable artifact after an issued write is a failure to observe, not unrealized"` | T6 |
| `M19b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP26 :: same property, reached by routing realization through the ambient reader` | T6 |
| `M20` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP27 :: "the artifact dimension is reported as the fact it is, beside the provenance failure"` | T6 |
| `M20b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP30 :: "an explicit hook install with no Git administrative container exits non-zero"` | T6 |
| `M20c` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP30 :: "the explicit command declares itself as the source, never the scaffold default"` | T6 |
| `M20d` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP30 :: "an explicit hook install that cannot resolve its own scope exits non-zero"` | T6 |
| `M20e` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP30 :: "the command surfaces BOTH dimensions: what the artifact is, and that the record did not commit"` | T6 |

##### `M15d` — RETIRED, STRUCTURALLY_DOMINATED

```
mutation ID             M15d
task                    6
disposition             RETIRED
falsifiability          N/A
classification          STRUCTURALLY_DOMINATED
exit                    1
guardHit (device)       FALSE — red on (UNCAUGHT ERROR, not an assertion)
guardHit (adjudicated)  N/A — a retired entry is not re-run for guardHit
declaredGuard           "install.reason is pre-write-observation-failed"
declaredGuard pointer   templates/cli/test/hook-provenance.js § HP25
                        :: assert.strictEqual(ev.install.reason,
                           'pre-write-observation-failed')          (:1336@3163696,
                           message-less — structural identity applies)
namedAuthority          Task 2's shared validator — the chmod-required rule
authorityPointer        templates/cli/hook-provenance/schema.js
                          § phase-gated install block
                          :: errors.push('install.chmod required when the hook write
                             was issued')                            (:192@3163696)
restorationProof        T6 four-fold
```

**Why it is no longer part of the admissible mutation set.** Measured: the document
`M15d` would commit has the **sole** violation
`"install.chmod required when the hook write was issued"`, because
`post-write-observation-failed` is not in `PRE_WRITE_REASONS` while the correct
pre-write path carries no chmod. The validator rejects it before `HP25`'s declared
local guard can observe the reason at all.

**Ledger nuance, recorded honestly rather than tidied.** The assertion that *owns* the
dominating rule is `HP6`'s `j`, and **no Task 2 mutation lands on it as first
responsible.** So the dominating rule is guarded by an assertion, but that assertion is
itself unwitnessed. This is a **separate fact about a different layer** — it is not
resolved by `M15d`'s retirement and must not be presented as if it were. See §5.

##### `M14c` — guard identity, evidence bookkeeping

```
mutation ID             M14c
disposition             ADMISSIBLE           falsifiability  EFFECTIVE
exit                    1
guardHit (device)       FALSE
guardHit (adjudicated)  TRUE
declaredGuard           "SCOPE-UNRESOLVED grants no legacy exception: the hook is
                         byte-identical"                       (HP16b :1084@3163696)
firstResponsibleGuard   templates/cli/test/hook-provenance.js § HP16b
                        :: assert.throws(() => installPostCommitHook(sub, …),
                           /SCOPE-UNRESOLVED/, 'a run that cannot classify its own
                           scope must fail rather than proceed')  (:1080-1082@3163696)
namedAuthority          Task 6 human ruling, progress.md — same class as Task 5's M11
                        (bookkeeping correction, not repair)
restorationProof        T6 four-fold
```

The declared guard and the first responsible guard are **both in `HP16b` and both on the
fail-closed property**; the source order puts the `assert.throws` first, and that is
what `M14c` breaks. The byte-identity assertion is **not** left unguarded — it is a
direct pre/post digest state guard and would fail for a mutate-then-throw
implementation. **Human ruling: do not manufacture a fixture-coupled mutation for it
just to raise coverage.** The declaration in `mutate6.js` was deliberately left
unedited, which is why the device still reports `FALSE`; editing it after the fact
would have destroyed the record of the correction.

##### `M15b` and `M18` — guard identity, message-less assertions

```
M15b
  disposition ADMISSIBLE   falsifiability EFFECTIVE   exit 1
  guardHit (device) FALSE  — "red on: Expected values to be strictly equal:"
  guardHit (adjudicated) TRUE
  declaredGuard          "the reason describes what was found before the write, not
                          what the exception suggests"
  firstResponsibleGuard  templates/cli/test/hook-provenance.js § HP17
                         :: assert.strictEqual(ev.install.reason,
                            'created-managed-hook')            (:1106@3163696,
                            message-less)
  namedAuthority         Task 6 human ruling — the upgraded guard-identity rule
  restorationProof       T6 four-fold

M18
  disposition ADMISSIBLE   falsifiability EFFECTIVE   exit 1
  guardHit (device) FALSE  — "red on: Expected values to be strictly equal:"
  guardHit (adjudicated) TRUE
  declaredGuard          "a write that returned success but did not establish the
                          expected body is write-failed"
  firstResponsibleGuard  templates/cli/test/hook-provenance.js § HP26
                         :: assert.strictEqual(a.event.install.outcome, 'unrealized')
                            (:1404@3163696, message-less; was :1299@35c91cc)
  namedAuthority         Task 6 human ruling — the upgraded guard-identity rule
  restorationProof       T6 four-fold
```

Both land in the **right block on the right property**, but on assertions the plan
wrote without a message, so a message-matching device cannot name them.
**Human ruling: do NOT add messages** — that would change the oracle and void all 23
Task 6 mutations (rule `R-C`). The device's rule was upgraded instead. A message is a
convenience label; the expression is the authority.

##### Task 6 apparatus iterations, recorded not hidden

Four controller mutation-**expression** errors were caught by the device before any
false evidence was recorded. All four are the controller's, not the implementer's:

```
M15b   initialised a variable an if/else unconditionally overwrote — dead code,
       EQUIVALENT mutation, suite fully green            (mut6-d.txt: exit 0)
M19b   added an existsSync gate only; in HP26-B the file EXISTS and only the INJECTED
       fsOps.readFileSync throws, so nothing changed
M16    injected a step on EVERY path including opt-out, tripping HP18's different
       property; then, once scoped, collided with HP21's own injected writeFileSync
       on the same path — fixed with a sidecar path   (mut6-g, mut6-g2, mut6-g3)
M16b   same every-path root cause as M16
```

Common root cause, and the human's new rule: **the mutant expression was never
independently proven to alter the intended semantic dimension before the evidence
suite ran.** This is the origin of the mutation-viability preflight:

```
fixture preflight asks:  is the target real?
mutant preflight asks:   did the bullet actually hit that target?

For each mutation, BEFORE guardHit / masking / dominance analysis:
    anchor applies exactly once
    -> the mutated source is syntactically valid
    -> the target expression actually changes runtime state
    -> that change survives later assignments and branches
    -> in the target fixture the intended semantic dimension differs
Screens three named failures: dead mutation, wrong injected authority,
cross-fixture contamination.
```

Only the **final** record of each ID is counted in the inventory. The superseded
`mut6-d.txt`, `mut6-g.txt` and `mut6-g2.txt` records are retained in the workspace as
the provenance of the repair.

#### Task 7 — `index.js` (2)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M17` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP20 :: "--no-git governs repository initialisation only, never hook participation"` | T7 |
| `M17b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP20 :: "no .git may be created in order to record an opt-out"` | T7 |

Both passed the mutation-viability preflight (`mutate7.js --viability`) **before** any
`guardHit` analysis. Both ran with `HP=28`, i.e. the 28th printed block, which is
`HP20`. **No third mutation was declared. This is not "2/3".**

#### Task 1 — the `G2` evidence amendment (outside the `M`-numbered namespace)

| ID | disp | fals | class | exit | gH-d | gH-a | firstResponsibleGuard / authorityPointer | rest |
|---|---|---|---|---:|---|---|---|---|
| `M-G2a` | **REJECTED AS EVIDENCE** | EFFECTIVE (but masked) | **ENVIRONMENTAL_MASKING** | 1 | FALSE | FALSE | red on `… § HP1 :: "on a case-insensitive filesystem they resolve to one directory"` — **not** on `HP3b` | T1 |
| `M-G2b` | ADMISSIBLE | EFFECTIVE | NORMAL | 1 | TRUE | TRUE | `… § HP3b :: "the pure-JS resolver must never be consulted"` | T1 |

These two are **not** in the 67-ID inventory: they were run ad hoc rather than through
a `mutate*.js` device, and they use a different ID namespace, so they fall outside the
derivation rule `|union of IDs declared by every mutate*.js|` by construction. Listed
here for completeness of the *evidence*, not of the *count*. See §3 entry `S2-a`.

`M-G2a` established a side fact worth keeping: on **this** host `HP1` incidentally
guards the `.native` choice, because the pure-JS resolver does not normalise casing.
On a case-sensitive host `HP1` would stay green under that mutation and `HP3b` would be
the only guard.

### 2.7 Aggregate

```
apparatus unique IDs                                67
  ADMISSIBLE                                        65
    guardHit TRUE by message identity               62
    guardHit TRUE by structural identity (ruling)    3   M14c, M15b, M18
    effective                                       65 / 65
    exit != 0                                       65 / 65
    declaredGuard == firstResponsibleGuard          65 / 65
        (62 by message, 3 by the upgraded rule)
  RETIRED                                            2   M13, M15d
    both STRUCTURALLY_DOMINATED
    both carry namedAuthority + authorityPointer
    neither is required to be redesigned or re-run

classification distribution (final state)
  NORMAL                                            62
  GUARD_IDENTITY (adjudicated to NORMAL)             3
  STRUCTURALLY_DOMINATED                             2

historical first-pass classifications, retained
  ENVIRONMENTAL_MASKING                              2   M6a (T3), M9b (T4)
  EQUIVALENT                                         2   M10d (T4), M15b (T6, mut6-d)
  UNCAUGHT_ERROR as not-evidence                     3   M13, M15d, M16b (mut6-g/g2)
  CO_OCCURRING_FAILURE                               1   Task 2's sha256:b — invalidated
                                                         the whole first Task 2 evidence
                                                         graph before repair 183721d
```

---

## Section 3 — Non-AC / non-mutation ledger reconciliation

Neither an AC row nor a mutation row can hold these entries; they get their own
section. The three axes of §2.3 govern here as well, so `STRUCTURALLY_DOMINATED` means
the same thing in both sections.

**`Task-8 action` is a closed set. There is no `FIX`, and no default:**

```
CARRY_FORWARD
HISTORICALLY_CLOSED
RECORD_ONLY
REQUIRES_SEPARATE_RULING
```

Task 8 does not re-decide any of these. It transcribes them from the canonical ledger.

| ledger ID | classification | current status | origin task | named authority | authority pointer | Task-8 action |
|---|---|---|---|---|---|---|
| `L1` | PLAN MUTATION COVERAGE DEBT | **CLOSED BY IMPLEMENTATION (`M3v`, `M4f`)** | 2 | `progress.md`, "LEDGER ITEMS CARRIED FORWARD" block | `progress.md` § LEDGER ITEMS CARRIED FORWARD § `L1` (`:311-316`) | **`HISTORICALLY_CLOSED`** |
| `L2` | PROCESS DEBT | **still standing** | 2 | `progress.md`, same block | `progress.md` § LEDGER ITEMS CARRIED FORWARD § `L2` (`:318-323`) | **`CARRY_FORWARD`** |
| `L3` | OPEN DESIGN QUESTION | **open** | 2 | `progress.md`, same block; `ae39cbe` `ac12` untouched | `progress.md` § `L3` (`:325-327`); design `ae39cbe` § `acceptanceCriteria[ac12]` | **`REQUIRES_SEPARATE_RULING`** |
| `G1` | EVIDENCE GAP, NOT FALSIFIABLE ON THIS HOST | recorded, not fixed, by human ruling | 1 | human ruling, Task 1 acceptance: *"G1 记录，不补"* | `progress.md` § Task 1 § evidence gaps (`:37`) | **`RECORD_ONLY`** |
| `G2` | EVIDENCE GAP | **CLOSED** by `HP3b` + `M-G2b` | 1 | `progress.md`, Task 1 evidence amendment | `progress.md` § "Task 1 evidence amendment (G2)" (`:42-72`) | **`HISTORICALLY_CLOSED`** |
| `G3` | EVIDENCE GAP — asserted, not observed | recorded, not fixed, by human ruling | 1 | human ruling, Task 1 acceptance: *"G3 不补"* | `progress.md` § Task 1 § evidence gaps (`:39`) | **`RECORD_ONLY`** |
| `T3-A` | UNPROVED BRANCH | **fixed** — owner-throw fixture + `M7c` | 3 | `task-3-brief-amendment.md` | `progress.md` § Task 3 preparation audit § finding 1 | **`RECORD_ONLY`** |
| `T3-B` | UNGUARDED STORAGE LITERALS | **fixed** — layout assertions + `M6b`, `M6c`; authority re-narrowed in 3.1 | 3 | `task-3-brief-amendment.md` + Task 3.1 ruling | `progress.md` § Task 3 preparation audit § finding 2 | **`RECORD_ONLY`** |
| `T3-C` | FIXTURE ASSUMPTION | **fixed** — Step 0 fixture-validity gate, no mutation (it gates fixtures, not a rule) | 3 | `task-3-brief-amendment.md` | `progress.md` § Task 3 preparation audit § finding 3 | **`RECORD_ONLY`** |
| `T3-D` | LOCALLY_NON_FALSIFIABLE | **registered only** — locale forcing is not falsifiable on an English host | 3 | human ruling: *"register, do not fix, do not manufacture a mutation"* | `progress.md` § Task 3 preparation audit § finding 4 | **`RECORD_ONLY`** |
| `T3-E` | NON-BLOCKING DEBT | **registered only** — four branches have assertions but no declared mutation | 3 | human ruling: *"strength, not false confidence"* — unlike `C-2b` these are guarded | `progress.md` § Task 3 preparation audit § finding 5 | **`RECORD_ONLY`** |
| `T4-m1` | CONTROLLER ID COLLISION | **resolved** by rename `M6b` → `M9b` | 4 | `task-4-brief-amendment.md` | `progress.md` § Task 4 pre-audit § `m1` | **`RECORD_ONLY`** |
| `T4-m2`, `T4-m3`, `T4-e1`, `T4-e2` | REGISTERED, NON-BLOCKING | registered, explicitly not to be fixed in their task | 4 | `progress.md` § Task 4 pre-audit | `progress.md` § Task 4 pre-audit § `m2/m3, e1/e2` | **`RECORD_ONLY`** |
| `T4-m4` | HEADER CORRECTION | **fixed** in `task-4-brief-amendment.md` | 4 | `task-4-brief-amendment.md` | `progress.md` § Task 4 Step 2 | **`RECORD_ONLY`** |
| `T4-w1` | WITHDRAWN BEFORE REPORTING | withdrawn — all 12 reasons Task 4 emits mechanically checked against the frozen tables, **zero** violations | 4 | controller measurement | `progress.md` § Task 4 pre-audit § WITHDRAWN | **`RECORD_ONLY`** |
| `T4-w2` | WITHDRAWN, DOWNGRADED | downgraded to `I3` after tracing Tasks 5 and 6 | 4 | controller measurement | `progress.md` § Task 4 pre-audit § WITHDRAWN | **`RECORD_ONLY`** |
| `T4-STEP0-DEBT` | PROCESS DEBT | **closed as standing rule `R-H`**, effective from Task 5 | 4 | human ruling | `progress.md` § "STANDING RULES — now R-A through R-H" | **`RECORD_ONLY`** |
| `T5-m1` | PARTIAL AC CLAIM | registered — *"Satisfies ac9"* is partial, like Task 4's `ac5` | 5 | `progress.md` § Task 5 pre-audit § `m1` | `progress.md` § Task 5 pre-audit | **`RECORD_ONLY`** |
| `T5-w1` | WITHDRAWN BEFORE REPORTING | withdrawn — `ac9`'s post-rename mutation lives in Task 6 as `HP23` | 5 | controller measurement | `progress.md` § Task 5 pre-audit § WITHDRAWN | **`RECORD_ONLY`** |
| `T5-DISPATCH` | DISPATCH DEFECT (controller's) | **closed** — brief wording now mandates an explicit ≥300 s timeout | 5 | human ruling, standing wording | `progress.md` § Task 5 implementation § DISPATCH DEFECT | **`RECORD_ONLY`** |
| `T5-DEVIATION` | MINOR, UNDISCLOSED, NON-SEMANTIC | recorded — a Chinese comment translated to English, not disclosed while the report said "No concerns" | 5 | controller verification | `progress.md` § Task 5 § controller verification | **`RECORD_ONLY`** |
| `T7-m1`, `T7-m2` | REGISTERED, NON-BLOCKING | scenarios C, D, E rest on properties Task 6 owns; Task 7's value is that the flag **reaches** the proven-correct producer path — integration positive control, no duplicated mutation authority | 7 | `progress.md` § Task 7 pre-audit | `progress.md` § Task 7 pre-audit § `m1/m2` | **`RECORD_ONLY`** |
| `T7-w1` | WITHDRAWN BEFORE REPORTING | withdrawn — `--no-git` is not consulted at the hook call site; `index.js:489` passes only the intent, `options.git` appears at 185 and 232, both about `git init`. The design is correct and `M17` witnesses it | 7 | controller measurement | `progress.md` § Task 7 pre-audit § `w1 WITHDRAWN` | **`RECORD_ONLY`** |
| `T7-I1` | STRUCTURALLY_DOMINATED | **not a retired mutation — no third mutation was ever declared** | 7 | Task 2 / `C-2d` / `HP6`, witnessed by `M2` | `templates/cli/hook-provenance/schema.js § C-2d :: errors.push(\`intent incoherent: ${intent.source} cannot declare ${intent.participation}\`)` | **`RECORD_ONLY`** |
| `HP6-j` | PLAN / EVIDENCE GAP | **witness gap — no first-responsible mutation** | 2 | see §5 | see §5 | **`RECORD_ONLY`** |
| `A10` | TASK-8 EXECUTION INSTRUCTION GAP | **ruled and amended before implementation**; reproduced by measurement in §0.3 (declared 8 / derived 10 / uncovered 0, all pairs equal — COVERAGE, not drift) | 8 | human ruling, *"Task 8 A10 HUMAN RULING"* | `progress.md` § "Task 8 A10 HUMAN RULING"; `task-8-brief-amendment.md` § 8 | **`RECORD_ONLY`** |
| `A1`/`A7`/`A8` | PLAN EVIDENCE GAP / STALE TASK-8 EXECUTION INSTRUCTION | **ruled and amended before implementation** — explicitly **NOT** a fourth plan self-consistency defect | 8 | human ruling on the Task 8 pre-audit | `progress.md` § "Task 8 HUMAN RULING"; `task-8-brief-amendment.md` § 7 | **`RECORD_ONLY`** |
| `PSC-1` `X_OK` | PLAN SELF-CONSISTENCY DEFECT | **closed by implementation-time disclosure** | 4 | human verdict, Task 4 | see §4 | **`RECORD_ONLY`** |
| `PSC-2` `existsSync` | PLAN SELF-CONSISTENCY DEFECT | **closed before implementation** by rule `R-H` | 5 | `progress.md` § Task 5 pre-audit § `I1` | see §4 | **`RECORD_ONLY`** |
| `PSC-3` "pre-existing tests still pass" | PLAN SELF-CONSISTENCY DEFECT | **closed during implementation** (fixture repair, phase 2) | 6 | `progress.md` § Task 6 phase 1 | see §4 | **`RECORD_ONLY`** |
| `S1-a` | AC SUB-CLAUSE, NO LOCATED CONTROL | **new, measured by Task 8** — `ac1`'s "two linked worktrees hold separate documents": no `git worktree add` anywhere in the feature's four test files | 8 | none — no prior ledger entry | measured over `templates/cli/test/{hook-provenance,integration,governance,harness}.js` at `3163696` | **`RECORD_ONLY`** |
| `S1-b` | AC SUB-CLAUSE, NO LOCATED CONTROL | **new, measured by Task 8** — `ac4`'s "`recordedAt` running backwards still yields the same latest event": every fixture uses ascending timestamps | 8 | none — no prior ledger entry | measured over `templates/cli/test/hook-provenance.js` (`HP15` uses `00:00 → 00:01 → 00:02 → 00:03`) | **`RECORD_ONLY`** |
| `S1-c` | AC SUB-CLAUSE, VACUOUSLY SATISFIED | **new, measured by Task 8** — `ac7`'s "`core.fileMode` appears only under `diagnostic`": the token occurs **zero** times in `observe.js`, `hooks.js` and the HP test file, so it is satisfied by absence rather than pinned by a source-level negative assertion the way `X_OK` and `process.platform` are | 8 | none — no prior ledger entry | measured at `3163696` | **`RECORD_ONLY`** |
| `S2-a` | LEDGER LABEL NUANCE | **new, measured by Task 8** — the decomposition bucket labelled `T1-2 13` contains only Task 2's 13 IDs; Task 1's `M-G2a`/`M-G2b` use a different ID namespace and no `mutate*.js` device, so they fall outside the derivation rule by construction. **The count is correct; the label is loose.** No count was adjusted | 8 | none — no prior ledger entry | `progress.md` § Task 8 pre-audit § CONTROLLER CORRECTION OF THE AUDITOR; `mutate.js` ⊂ `mutate2.js` | **`RECORD_ONLY`** |

### `L1` in particular

`L1` was **already closed** in the canonical ledger (`progress.md`, the "LEDGER ITEMS
CARRIED FORWARD" block), and has been since the Task 2 block:

```
L1  plan mutation coverage debt
    013d64d's Task 2 mutation table was incomplete: no control for install.reason
    vocabulary exactness, no independent control for C-2b.
    STATUS: CLOSED BY IMPLEMENTATION (M3v, M4f). Recorded as a fixture coverage
    hole closed, NOT as an ordinary test enhancement.
```

Later conversational summaries — **including the Task 7 completion report** — listed
`L1 / L2 / L3` in parallel without that distinction. **That was a reporting error; the
canonical ledger never reopened `L1`.**

This document therefore shows `status before Task 8 = CLOSED` and
`Task-8 action = HISTORICALLY_CLOSED`. **`L1` is not a debt Task 8 closed.** This entry
is the concrete reason Task 8 is required to read `progress.md` and forbidden to
reconstruct history from a summary.

### `L3` in particular

```
L3  AC12 chmod semantics — may chmod be ABSENT on a phase-2/3 outcome?
    STATUS: OPEN DESIGN QUESTION.
```

It traces to **`ac12`** (§1). It remains unresolved because answering it requires
amending `ac12` in the frozen design, which is a design-layer decision. During patch
2.1 the controller stopped and reported that the ruling's own literal fix text
contradicted `ac12`, implemented only the common subset of both readings, and the human
withdrew the instruction as having crossed the authorization boundary. `ac12` is
untouched in the amended spec `ae39cbe`. It was explicitly excluded from Task 3
(*"Task 3 depends on the existing frozen contract, not on a possible improvement to
it"*) and from Task 4 (*"L3/AC12 must NOT be folded in"*).

**Task 8 may not decide the chmod semantics.** `ac12`'s row is not fully green because
`L3` is open. **That is the correct result, not a defect in the matrix.**

### `L2` in particular

`L2` is the only `CARRY_FORWARD` in this section. It is a live process constraint, not
a historical record:

```
L2  validator/spec visibility problem
    The frozen design a8c8986 is not present on the implementation branch.
    STATUS: PROCESS DEBT. Every later review must be labelled either
    "implementation consistency review" or "spec compliance review", and only
    a reviewer that actually holds the approved spec commit, the plan commit and
    the implementation commit may claim the latter.
```

Formalised as standing rule `R-E`. It still binds every future review of this branch,
including any review of this document. Confirmed still true at `3163696`: `ae39cbe`
lives on `spec/hook-install-provenance`, not on `feat/hook-install-provenance`.

### Evidence reachability

The controller's standing note applies to this document: `L1`/`L2`/`L3` and the
per-task registered items lived only in a gitignored workspace. This project has been
bitten once by evidence that existed only in gitignored files and PR bodies, which
later produced a false *"this was never done"* judgement. **This document is the
durable restatement** — it is a tracked file under `docs/validation/`, and it is why
Task 8 exists.

---

## Section 4 — The three plan self-consistency defects

They stay **three**. A self-consistency defect is false against its **own** document.

| # | defect | where discovered | how the executing brief amended it | closed |
|---|---|---|---|---|
| 1 | `X_OK` — the plan's own `observe.js` body carries the literal token `X_OK` inside the comment explaining why `accessSync X_OK` is disqualified, while `HP10` asserts `!/X_OK/.test(src)` over that same file. The brief could never pass its own test | **during implementation**, Task 4 — the implementer disclosed it rather than absorbing it | reworded that one comment; controller diff of the committed `observe.js` against the brief's specified code: **three comment lines, zero code change** | **CLOSED BY IMPLEMENTATION-TIME DISCLOSURE** |
| 2 | `existsSync` — the plan's `store.js` line 10 reads *"existsSync is therefore never used here"* while `HP13` asserts `!/existsSync/.test(src)` over that same file. Measured: 1 occurrence | **before implementation**, Task 5 — rule `R-H` fired on its first use | `task-5-brief-amendment.md` reworded the line; the check proved the rewording takes `existsSync` from 1 occurrence to 0 and that the reworded source still parses | **CLOSED BEFORE IMPLEMENTATION** |
| 3 | *"the pre-existing hook tests in `integration.js` still pass"* — mechanically falsifiable by the plan's own Step 3 production change | **during implementation**, Task 6 — the implementer returned BLOCKED, correctly, without widening its own scope | phase-2 fixture repair, authorized narrowly: four sites, one line each (`execFileSync('git', ['-C', dir, 'init', '-q'], …)`). Controller verified 4 insertions, 0 deletions, **zero assertion edits** | **CLOSED DURING IMPLEMENTATION** |

Defect 3 could not be caught by `R-H`: it is not a source assertion. The controller's
sweep found **four** affected sites where the implementer reported two —
`governance.js` T15a and T22, `integration.js` T11 dir1 and dir2 — which is precisely
why a BLOCKED implementer must not fix across the boundary on its own guess.

The human's framing of the repair, kept: **repair the fixture so the ORIGINAL assertion
keeps asking the same question under the precondition the contract now makes explicit
— not change an expected result to fit new code.**

### `A1` / `A7` / `A8` are NOT a fourth defect

```
A1 / A7 / A8
    = PLAN EVIDENCE GAP / STALE TASK-8 EXECUTION INSTRUCTION

NOT = a fourth PLAN SELF-CONSISTENCY DEFECT
```

The reason is **temporal**. `expected count = 42`, *"grep the plan's mutation tables"*,
and the absence of the ledger and the amendments from Task 8's source list were not
necessarily self-contradictory when `013d64d` was frozen. They became wrong as the
amendment and evidence set grew across Tasks 3–7. **A self-consistency defect is false
against its own document; a stale instruction is false against a world that moved.**

`A10` (§0.3) is classified the same way, and by the same reasoning.

---

## Section 5 — `HP6-j`: the chmod witness gap, recorded exactly as it is

The gap is **NOT** *"`M15d` is structurally dominated, therefore `HP6-j` is covered."*
Those are different facts about different layers.

Measured at `3163696`:

```
validator rule exists
    templates/cli/hook-provenance/schema.js
    § phase-gated install block
    :: errors.push('install.chmod required when the hook write was issued')
    (line 192 as of 3163696 — verified)

assertion exists
    templates/cli/test/hook-provenance.js
    § HP6, fixture/assertion `j`
    :: assert.strictEqual(validateOk(j), false,
         'an outcome that follows an issued write must carry chmod')
    (line 293 as of 3163696 — verified; fixture built at :288-291 by deleting
     j.events[0].install.chmod and re-deriving the event id and derivedFrom)

dedicated first-responsible mutation witness
    ABSENT
```

**Why it is absent, measured.** `M4b` deletes the whole chmod conditional block, and
its declared guard is assertion **`i`** —
`'a pre-write outcome must carry no chmod: no write was attempted'`
(`test/hook-provenance.js:286@3163696`) — which answers first. Re-derived across all
67 apparatus IDs at `3163696`: **no mutation declares `j`'s message as its guard**, and
no mutation's first responsible guard resolves to that assertion.

Section 3 row:

```
ledger ID           HP6-j
classification      PLAN / EVIDENCE GAP
assertion           HP6-j
rule authority      the shared validator's chmod-required rule
                    (schema.js § phase-gated install block :: 'install.chmod required
                     when the hook write was issued')
mutation witness    NONE AS FIRST RESPONSIBLE
origin task         2   (registered as a Task 2 evidence nuance during Task 6)
Task-8 action       RECORD_ONLY
```

**Task 8 did NOT invent a 68th mutation to close this.** Doing so would convert
reconciliation into new evidence work and change the accepted inventory `67 → 68`,
invalidating every count in §2. **Closing it requires separate human authorization.**

Note the relationship to `M15d` precisely: `M15d` is dominated *by the rule this
assertion owns*. The rule is real, is exercised, and does reject `M15d`'s document with
that sole violation — that is measured. What is missing is a mutation that makes
assertion `j` itself the first thing to go red. Those are two different statements about
two different layers, and this document keeps them apart.

---

## Section 6 — Verification checklist for this document

Per §10 of the Task 8 brief amendment:

| # | requirement | where | status |
|---:|---|---|:--:|
| 1 | the evidence-source manifest names all five authorities and no source overwrites another | §0 | ✔ |
| 2 | all eleven reconciliation assertions are present and **derived**, not hardcoded | §2.1 | ✔ |
| 3 | the mutation row schema has three independent dimensions, and `namedAuthority` + `authorityPointer` are mandatory on every non-`NORMAL` row | §2.3, §2.6 | ✔ |
| 4 | Section 3 exists, its `Task-8 action` set is closed, and it contains no `FIX` | §3 | ✔ |
| 5 | the reconciliation-only stop rule is present verbatim | document header | ✔ |
| 6 | `L1` shows `CLOSED` / `HISTORICALLY_CLOSED`, `L3` shows `REQUIRES_SEPARATE_RULING` | §3 | ✔ |
| 7 | `HP6-j` is `RECORD_ONLY` and no 68th mutation is proposed anywhere | §5 | ✔ |
| 8 | the mirror surface is DERIVED from the four inputs, the scope boundary forbids a whole-repository audit, the stop rule is present verbatim, and `Declared != Derived` routes to `STOP_AND_REPORT` rather than to a failure | §0.3 | ✔ |
| 9 | every count is written as a current reconciled snapshot with its derivation rule beside it — no permanent constants | §2.1 | ✔ |

Independent cross-check: `check-task8-amendment.js` re-run at `3163696` —
**exit 0, 88 PASS, 0 FAIL.** It recomputes the inventory from the apparatus, re-derives
the mirror surface from git, and re-resolves the `HP6-j` pointers against `schema.js`,
`hook-provenance.js` and `mutate2.js`. Its numbers (67 / 42 / 25 / 65 / 8 vs 10) agree
with every number derived independently in this document. Working tree clean before and
after.

---

## Section 7 — What Task 8 did not do

Recorded explicitly, because the absence is the point:

```
no mutation was added
no assertion was modified
no production file was touched
no plan, spec or mirror was modified
no mutation or HP ID was renumbered
no RETIRED entry was rewritten as covered
no STRUCTURALLY_DOMINATED entry was rewritten as PASS
no LOCALLY_NON_FALSIFIABLE entry was treated as a missing test
no summary was used in place of the canonical ledger
```

Files changed by Task 8: **this one.**

Four criteria are `PARTIAL` and four ledger items remain open or carried forward
(`L2`, `L3`, `HP6-j`, and the three newly measured `S1-*` sub-clause observations).
**A matrix that is not fully green is the expected outcome of an honest
reconciliation.** Every residual above names its authority and its owner, and none of
them is Task 8's to close.
