# Disposition ledger — mutation matrix

Task 10 of the `disposition-ledger` plan. Each row breaks ONE invariant guard and
records whether the intended assertion goes red. A red that lands anywhere else —
an unrelated block, a crash, a non-zero exit for another reason — proves nothing
about the named guard and is recorded as `INEFFECTIVE — guard is decorative`.

## Protocol

Every row records five things. A row missing any of them is not done.

1. **The mutation actually applied** — the replacement matched `n > 0` times and
   BOTH mirrors (`templates/cli/**` and `.evo-lite/cli/**`) changed sha256. A
   string that matched zero times and a suite that then ran green is a no-op, not
   a control.
2. **The fixture genuinely traverses the target branch on the GREEN baseline** —
   named explicitly per row, and in every case carried by an in-suite precondition
   assertion that survives the mutation.
3. **Where the red landed**, against the assertion the row names.
4. **Restored** — both mirrors returned to the pre-mutation sha256, verified by
   re-hashing after the run; the full suite then re-ran green (see Baseline).
5. **The exact failing assertion text, verbatim.**

Mechanics: `.evo-lite/generated/task10-mut/` (gitignored, transient) held a harness
that applied each mutation to both mirrors, ran the scope as a child process,
restored from the in-memory pre-image in a `finally`, and re-hashed. Per-run logs
and JSON records were written beside it. Nothing in that directory is part of the
deliverable.

## Baseline

| | |
|---|---|
| BASE commit | `572c7a7` |
| Command | `node .evo-lite/cli/test.js` (no scope), run ALONE |
| Green before this task | exit `0`, `420` blocks |
| Green after this task | exit `0`, `423` blocks (three new baseline blocks: M10, M12, M13) |
| Scopes | only `governance` and `all` exist; there is no `integration` scope, so the two rows whose assertion lives in `test/integration.js` were run as `all` |

Pre-mutation sha256 of every file touched (identical in both mirrors):

| file | sha256 |
|---|---|
| `disposition/resolve.js` | `9048aa609b33018cf0292a80c860329e37c199038fc30e3fe1faeb2256990b6b` |
| `disposition/commands.js` | `64ce3f1d3f88bcdece60ba628a0012a058a079d90f560762765f8fe37969cb61` |
| `disposition/fingerprint.js` | `aa6cfa3fddb4958d671d4a52c6afa755a5c2d2c6005f6ebce3947585eae9eb89` |
| `disposition/ledger.js` | `87d04e6c87f03f71c511d3666828afc8083e7ee037f2154af770036a01a20a64` |
| `planning/gaps.js` | `727facbf898aa4ff661b74595edba3d520781d16b56e06e4d027f6a6be40c58e` |
| `spec-portfolio.js` | `687e1b71750c2a889246b2adedd25937c4a17c26b94c7cd8f112e0e263a62903` |
| `memory.service.js` | `d8ee621d88806dbd272a028a9c16dbe85f4a7736751340396a2f885d099cce5f` |
| `test/governance.js` (with this task's new blocks) | `7d705caf71e796f034c3b77a9593463c62bcb195ef3ba367348c069a715df59e` |

Every row below restored to exactly these values in both mirrors after its run.

## Summary

| # | verdict | note |
|---|---|---|
| M1 | effective | plan text was STALE; targeted the current presence-based guard |
| M2 | effective | |
| M3 | **INEFFECTIVE — guard is decorative** *(as the plan writes the mutation)* | the red is a `TypeError` in an earlier block; corrected seam M3′ is effective |
| M4 | effective | |
| M5 | effective | |
| M6 | effective | assertion already shipped, in `test/integration.js` |
| M7 | effective | |
| M8 | effective | assertion already shipped by Task 8 — nothing was written for this row |
| M9 | effective — red lands on the ADJACENT assertion, not the named one | that assertion is in the same block and strictly STRONGER, so the guard is not decorative; unlike M3, whose red was an unrelated `TypeError` 200 lines away. M9′ confirms the named assertion also reddens |
| M10 | effective | **new baseline block** |
| M11 | effective | assertion already shipped, in `test/integration.js` |
| M12 | effective | **new baseline block**; the brief's own injection is dead — corrected fault seam |
| M13 | effective | **new baseline block** |
| M14 | effective | assertion already shipped by Task 9 — nothing was written for this row |

Rows that needed a corrected fault seam: **M3** (dead as specified), **M9** (red
displaced by one line), **M12** (the brief's injection is dead — see the row).
Rows that needed a new baseline: **M10, M12, M13**.
Rows already satisfied by shipped assertions, where nothing was added: **M6, M8,
M11, M14**.

---

## M1 — a tombstone is terminal

- **Mutation.** `disposition/resolve.js`: delete the tombstone short-circuit in
  `effectiveDisposition`.

  > **The plan's text for this row is STALE.** It says delete
  > `if (entry.orphanedAt) return null;`. That line no longer exists — Task 3
  > replaced it with the presence-based `if (isTombstoned(entry)) return null;`,
  > and `isTombstoned` uses `Object.prototype.hasOwnProperty`. A literal string
  > replacement would have matched ZERO times and the green suite that followed
  > would have been reported as a passing control. The CURRENT semantic guard was
  > targeted instead.

  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-resolve` builds an entry whose
  fingerprint MATCHES the live finding and then tombstones it, so `findEntry` hits
  and `computeFingerprint` agrees — the tombstone short-circuit is the only thing
  that can return `null`. The block asserts the untombstoned twin resolves
  `current` immediately above, so the fixture is not merely failing to match.
- **Scope.** `governance` — exit `1` after 104 green blocks.
- **Red landed on** the named assertion, `templates/cli/test/governance.js`
  `T-disposition-resolve`.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: a tombstoned entry NEVER returns to CURRENT, even on an identical recurrence
  + actual - expected
  + { at: '2026-08-11T00:00:00Z', choice: 'not-applicable', findingId: 'unknown-status:spec:x',
  +   fingerprint: '714df65f…', orphanedAt: '2026-09-01T00:00:00Z', orphanedHead: '1f2e3d4',
  +   reason: 'r', ruleId: 'unknown-status', ruleVersion: 1 }
  - null
  ```
- **Restored.** Both mirrors back to `9048aa60…`, verified.
- **Verdict: effective.**

## M2 — a degraded round writes no tombstone

- **Mutation.** `disposition/commands.js`, inside `sync`: delete the whole
  `if (!complete) { … return; }` fail-closed block.

  > `if (!complete) {` occurs TWICE in this file — once in `sync`, once in `list`.
  > The find string therefore carries the block body, so it matches the `sync`
  > occurrence only. `n = 1` per mirror confirms it. The `list` occurrence is M13.

  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-sync` resolves the finding for
  real AND corrupts `plan-ir.json`, then asserts *both* halves as preconditions:
  `precondition: the round really is degraded` and `precondition: the degraded
  round DOES see the finding as absent`. Without the second, deleting the guard
  would tombstone nothing and the ledger would stay byte-identical for the wrong
  reason.
- **Scope.** `governance` — exit `1` after 113 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: a degraded round leaves the ledger BYTE-IDENTICAL — observation failure is not fact change
  ...
  +   '      "orphanedAt": "2026-08-13T16:15:52.174Z"\n' +
  ```
- **Restored.** Both mirrors back to `64ce3f1d…`, verified.
- **Verdict: effective.**

## M3 — a dispositioned finding stays in the collection

- **Mutation (as the plan writes it).** `disposition/resolve.js`: `annotate`
  returns `null` instead of the finding when a disposition is current.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-annotation` writes a ledger
  entry whose fingerprint matches, and asserts `after.disposition.status ===
  'current'` on the green baseline — so `annotate`'s `if (live)` arm is genuinely
  taken.
- **Where the red landed.** NOT on the named assertion. `governance` exited `1`
  after 104 blocks with a **`TypeError`** raised in an earlier block,
  `T-disposition-resolve`:

  ```
  TypeError: Cannot read properties of null (reading 'disposition')
  ```

  That is `assert.strictEqual(res.annotate(finding, ledger).disposition.status,
  'current')` — an unguarded dereference of `annotate`'s return value in the
  resolver's own unit block. Any mutation that makes `annotate` return `null`
  crashes there before `T-disposition-annotation` is ever reached.
- **Confirmed not an artefact of the null surviving into the array.** A second
  run (`M3′`) applied the same `annotate` change *plus* a `.filter(Boolean)` at
  the collection site in `spec-portfolio.js`, so no `null` could reach a consumer.
  Identical outcome: same `TypeError`, same line, 104 blocks. The crash is
  upstream of the guard, not downstream of it.
- **Verdict for the row as written: `INEFFECTIVE — guard is decorative`.** Not
  because the guard is worthless, but because this mutation can never reach it:
  the named assertion is *shadowed* by an earlier unguarded dereference, so it can
  never be the assertion that reports this defect.

### M3′ — corrected fault seam (effective)

The defect the named assertion actually guards is at the **collection site**: a
dispositioned finding disappearing from `specs[].findings`, which is what would
let a downstream reader conclude a problem does not exist because somebody
dispositioned it. Mutating that site instead:

- **Mutation.** `spec-portfolio.js`: `s.findings.map(f => annotate(f, ledger))`
  → the same, plus `.filter(f => !(f.disposition && f.disposition.status ===
  'current'))`. Applied: `n = 1` in each mirror, both sha256 changed.
- **Scope.** `governance` — exit `1` after 107 green blocks.
- **Red landed on** the named assertion, in `T-disposition-annotation`.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: a dispositioned finding MUST remain in the collection
    actual: undefined, expected: true, operator: '=='
  ```
- **Restored.** `spec-portfolio.js` back to `687e1b71…` in both mirrors, verified.
- **Verdict: effective.** The invariant IS defended; the plan's chosen seam simply
  cannot be the thing that demonstrates it.

## M4 — set-array order does not move the fingerprint

- **Mutation.** `disposition/fingerprint.js`: stop sorting `SET_KEYS` arrays
  (`if (SET_KEYS_LOOKUP.has(key)) items.sort();` deleted).
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-fingerprint` hashes
  `linkedFiles: ['b','a']` against `linkedFiles: ['a','b']` — `linkedFiles` is a
  member of `SET_KEYS`, so the sort branch is the only thing that makes them equal.
- **Scope.** `governance` — exit `1` after 102 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: key order and set-array order must not change the fingerprint
  + '330bac0c879658557cebd38061405d5458adefbbcc769b31aa848a182d73f4ce'
  - '93cb4168ef47f2513b554bf1fabf2db8b8484a8e65c001d3522b4eab68c0a8ea'
  ```
- **Restored.** Both mirrors back to `aa6cfa3f…`, verified.
- **Verdict: effective.**

## M5 — ruleVersion participates in the fingerprint

- **Mutation.** `disposition/fingerprint.js`: drop `ruleVersion` from the hashed
  payload. Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The same block hashes an otherwise identical
  input at `ruleVersion: 1` and `ruleVersion: 2`; `computeFingerprint` still
  validates `ruleVersion` as an integer, so the value is present and only its
  participation in the payload is removed.
- **Scope.** `governance` — exit `1` after 102 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: ruleVersion participates in the fingerprint
    actual: '8842e23df4bd222876a3bed8ac34011548fad3341780a72eeb2997a28ab8d789'
    expected: '8842e23df4bd222876a3bed8ac34011548fad3341780a72eeb2997a28ab8d789'
    operator: 'notStrictEqual'
  ```
- **Restored.** Both mirrors back to `aa6cfa3f…`, verified.
- **Verdict: effective.**

## M6 — a deferral without a reopening condition is refused

- **Assertion already exists**, in `templates/cli/test/integration.js`
  (`T-disposition-cli`). Nothing was written for this row.
- **Mutation.** `disposition/commands.js`: delete the
  `--until is required for deferred` guard in `set`.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The block issues `--choice deferred` with no
  `--until`, and immediately below issues the same command WITH `--until` and
  asserts `status === 0` plus a real ledger entry — the positive control that the
  `set` handler ran at all, so the four refusal assertions are not vacuously
  passing on "unknown command".
- **Scope.** `all` (there is no `integration` scope) — exit `1` after 418 green
  blocks, i.e. the entire governance suite passed first.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: deferred without until is rejected — no bare deferral
    actual: 0, expected: 0, operator: 'notStrictEqual'
  ```
- **Restored.** Both mirrors back to `64ce3f1d…`, verified.
- **Verdict: effective.**

## M7 — set replaces rather than appends

- **Mutation.** `disposition/ledger.js`: `upsertEntry` pushes without filtering
  the existing entry for that `findingId`.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-ledger` upserts `R008:task:z`,
  writes, reads back, then upserts the SAME `findingId` with a different
  fingerprint and choice — so the filter is exercised with a genuine collision,
  not with a fresh id.
- **Scope.** `governance` — exit `1` after 103 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: set replaces rather than appends — a findingId can never hold two live decisions
  2 !== 1
  ```
- **Restored.** Both mirrors back to `87d04e6c…`, verified.
- **Verdict: effective.**

## M8 — sync neither stages nor commits

- **The assertion already ships.** The brief says this row "needs its assertion
  written now", but Task 8 already landed `T-disposition-sync-never-stages` in
  `templates/cli/test/governance.js`, which observes real git state (`rev-parse
  HEAD` and `diff --cached --name-only` before and after) rather than grepping the
  source. **Nothing was added for this row** — a second block would have been a
  duplicate.
- **Mutation.** `disposition/commands.js`: add a `git add -- .evo-lite/dispositions.json`
  immediately after `writeLedger` in `sync`.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The block asserts
  `precondition: nothing is staged going in` and
  `precondition: this round really did write a tombstone` (`/1 tombstoned/`), so
  the injected `git add` is reached with something to stage; "index unchanged" is
  not vacuous.
- **Scope.** `governance` — exit `1` after 116 green blocks.
- **Red landed on** the named assertion (the staging half; the HEAD half is the
  line below and would not have fired for a `git add`).
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: sync must never stage — the index is unchanged
  + '.evo-lite/dispositions.json'
  - ''
  ```
- **Restored.** Both mirrors back to `64ce3f1d…`, verified.
- **Verdict: effective.**

## M9 — live HEAD moving alone does not void an R013 decision

- **Mutation.** `planning/gaps.js`: add the live `git.headSha` to R013's
  `factInputs`. Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** `T-disposition-planning-census` drives
  `checkR013` with a fixed `metaState` and two `gitState`s differing ONLY in
  `headSha` (`bbbb…` vs `cccc…`), both with `isAncestorOfHead: () => false`, so the
  R013:head finding is emitted in both rounds (asserted by
  `R013:context:head uses the canonical id`).
- **Scope.** `governance` — exit `1` after 106 green blocks.
- **Where the red landed.** On the *structural precondition one line above* the
  named assertion — `assert.deepStrictEqual(head(gitA).factInputs, {
  declaredHeadSha: meta.headSha })` — which pins the exact `factInputs` shape and
  therefore fires first.
- **M9′ — corrected seam.** The same production mutation was re-run with that one
  precondition line temporarily removed from both mirrors of `test/governance.js`,
  forcing the red onto the named assertion. It went red:

  ```
  AssertionError [ERR_ASSERTION]: live HEAD moving alone must NOT change the R013 fingerprint
  + actual - expected
    { declaredHeadSha: 'aaaa…',
  +   liveHeadSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  -   liveHeadSha: 'cccccccccccccccccccccccccccccccccccccccc' }
  ```

  `governance` exit `1` after 106 blocks; `test/governance.js` restored to
  `7d705caf…` in both mirrors, verified.
- **Restored.** `planning/gaps.js` back to `727facbf…` in both mirrors, verified.
- **The M9′ technique is a DIAGNOSTIC, not the same class of evidence as M3′ and
  M12.** Those two found a different real seam in PRODUCTION code. M9′ instead
  removed a line from the OBSERVER — the test file — to see what the next
  assertion would do. That is legitimate and it is disclosed, but a future reader
  must not treat the two as interchangeable: editing the test until the desired
  assertion fires proves nothing on its own. What makes M9 effective is the fact
  below, not the M9′ run.
- **Verdict: effective — but the red lands on the ADJACENT assertion, not the
  named one.** The row is NOT decorative, and this is materially different from
  M3. There the red was a `TypeError` in an unrelated block ~200 lines earlier
  that would fire for *any* null-returning mutation, telling you nothing about the
  invariant. Here the red lands one line above, inside the same block, on an
  assertion that guards the SAME invariant and is strictly STRONGER: "`factInputs`
  contains only the declared head" implies "a moving live HEAD cannot change it".
  A guard that fires earlier because it is more precise is a better guard, not an
  absent one.
- **Follow-up applied (controller, fix round 1).** That adjacent assertion
  originally carried NO message, so the failure an operator actually sees stated
  nothing about the broken property, and this row could not record meaningful
  "verbatim failing assertion text". It now reads:

  ```
  AssertionError [ERR_ASSERTION]: R013 factInputs carries the DECLARED head and NOTHING else
  — a live-HEAD leak here would move the fingerprint on every commit and void every R013 decision
  ```

  Semantics unchanged; only the diagnostic text was added.

## M10 — a rolled-back change is a NEW occurrence

- **New baseline block:** `T-disposition-r006-occurrence` in
  `templates/cli/test/governance.js` (mirrored). Nothing in the suite covered the
  rollback-revival property before this task — the C1/C2/C3 comment in
  `planning/gaps.js` described it, and no assertion held it.
- **Mutation.** `planning/gaps.js`: drop `occurrence` from R006's `factInputs`.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** A real git repo, four commits —
  seed `A`, C1 `A→B`, C2 `B→A`, C3 `A→B` — read in COMMITTED observation mode
  (`{ lastCommit: true }`, the mode every disposition command uses; a working-tree
  R006 has no occurrence at all and is marked non-dispositionable, so it could
  never exercise this). Three preconditions that survive the mutation guard the
  verdict: same `path`, same change `status`, and `c3.head !== c1.head`. The
  `snap()` helper also asserts the R006 finding is actually emitted at each
  commit.
- **Scope.** `governance` — exit `1` after 126 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: C3 fingerprint != C1 — a rolled-back-and-reapplied change is a NEW occurrence; reusing C1's fingerprint would silently revive the disposition a human made once
    actual:   'd3a9f94782d111857136277f5115370cb0ff28482276c004bd6ba8e6f2a4f1cf'
    expected: 'd3a9f94782d111857136277f5115370cb0ff28482276c004bd6ba8e6f2a4f1cf'
    operator: 'notStrictEqual'
  ```
- **Restored.** Both mirrors back to `727facbf…`, verified.
- **Verdict: effective.**

## M11 — one findingId with two live occurrences is refused

- **Assertion already exists**, in `templates/cli/test/integration.js`
  (`T-disposition-cli`). Nothing was written for this row.
- **Mutation.** `disposition/commands.js`: delete the working-tree shadow guard
  in `set` (the second, worktree-mode census and its `if (shadow) throw`).
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The fixture has BOTH a committed change and a
  further uncommitted change on the same path (`src/shadow.js` committed as `v1`,
  then written to `v2` in the working tree), and asserts
  `the committed occurrence IS in the disposition id space` first — so `set` gets
  past the `no such finding` branch and the shadow guard is the only thing that
  can refuse. A merely-uncommitted file would have been rejected earlier and the
  guard would be unreachable.
- **Scope.** `all` — exit `1` after 418 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: one findingId with two live occurrences must be refused, not silently bound to the committed one
    actual: 0, expected: 0, operator: 'notStrictEqual'
  ```
- **Restored.** Both mirrors back to `64ce3f1d…`, verified.
- **Verdict: effective.**

## M12 — a parse failure under the compatibility root blocks the round

- **New baseline block:** `T-disposition-census-parse-failure` in
  `templates/cli/test/governance.js` (mirrored).

  > **The brief's own injection for this row is DEAD.** It throws on EVERY read of
  > the victim file. `buildSpecRegistry` reads the file ITSELF first
  > (`content = fs.readFileSync(absPath)`), so the fault lands on read #1, is
  > recorded in `errors[]`, and `continue`s — `parseSpecFile` never runs and the
  > `spec parse threw` sourceWarning is never produced. Under the row's mutation
  > (`complete` relaxed to `errors.length === 0`) the census would still be `false`
  > because `errors` is non-empty, and the mutation would SURVIVE.
  >
  > **Corrected fault seam:** a call-counted `fs.readFileSync` stub keyed on the
  > victim path. Read #1 SUCCEEDS; only read #2 — the one inside `parseSpecFile`,
  > which goes through the same shared `fs` module object — throws. The victim
  > lives under `docs/superpowers/specs/` so the finding is routed to
  > `sourceWarnings`, not `errors`, which makes `parseFailures` the SOLE reason
  > `complete` is false. The block self-checks the calibration
  > (`victimReads >= 2`) rather than assuming the call index was reached.

- **Mutation.** `spec-portfolio.js`: relax `census.complete` to
  `errors.length === 0`. Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** Four preconditions, all surviving the
  mutation: the INTACT same file is a complete census; `victimReads >= 2`;
  `reg.errors` is `[]`; `discoveredFileCount === parsedSpecCount`; and a
  `parse threw` sourceWarning is genuinely present.
- **Scope.** `governance` — exit `1` after 127 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: a parse failure under the compatibility root blocks the round, even though the id-less design docs beside it do not
  true !== false
  ```
- **Narrowed control (M12b).** Because the row's mutation relaxes four conditions
  at once, it was re-run deleting ONLY `&& parseFailures.length === 0`. Identical
  result: same assertion, same message, exit `1` after 127 blocks. The red is
  attributable to the `parseFailures` gate specifically, not to one of the other
  three collaterally removed predicates.
- **Restored.** Both mirrors back to `687e1b71…` after each run, verified.
- **Verdict: effective.**

## M13 — a degraded census must not manufacture an ORPHANED in `list`

- **New baseline block:** `T-disposition-list-degraded` in
  `templates/cli/test/governance.js` (mirrored). `'unobserved'` appeared NOWHERE
  in the suite before this task — the `list` branch had no covering assertion at
  all, and the mutation would have had nothing to turn red.
- **Mutation.** `disposition/commands.js`: replace
  `complete ? 'orphaned' : 'unobserved'` with a bare `'orphaned'`.
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The dispositioned finding is `R005:task:t1`,
  DERIVED FROM `plan-ir.json` — the producer the fixture then breaks. An
  `unknown-status:spec:*` entry would have survived a broken plan-ir untouched,
  `byId` would still have hit, and the ternary would never have executed. Three
  preconditions guard it, all surviving the mutation: the intact round is a
  COMPLETE census; `set` exits 0; the degraded round reports `complete === false`;
  and the entry carries no `orphanedAt`, so the earlier tombstone branch cannot be
  what produced the status.
- **Scope.** `governance` — exit `1` after 128 green blocks.
- **Red landed on** the named assertion.
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: a finding we could not look for is unobserved — ORPHANED means a complete census PROVED absence
  + 'orphaned'
  - 'unobserved'
  ```
- **Restored.** Both mirrors back to `64ce3f1d…`, verified.
- **Verdict: effective.**

## M14 — a tombstone that survives the retry is reported partial

- **The baseline already ships.** The brief says this row needs one written, but
  Task 9 landed `T-disposition-durability-honesty` in
  `templates/cli/test/governance.js`, which does exactly what the brief's fixture
  describes: it runs `mem commit` (not `context track` — a `track` probe would
  assert on `formatTrackResult` and stay green after the re-check is deleted), and
  installs a post-commit hook that dirties the ledger after EVERY commit including
  the closure retry's own. **Nothing was added for this row.**
- **Mutation.** `memory.service.js`: delete the post-meta-commit re-check in
  `commitWithContext` (the final `if (dispositionsDirty(workspaceRoot))` that
  downgrades `runtime.status` to `partial`).
  Applied: `n = 1` in each mirror, both sha256 changed.
- **Fixture traverses the branch.** The block asserts
  `precondition: the writer really did win` by reading `git status --porcelain`
  directly — so the deleted re-check would genuinely have observed a dirty ledger.
  That precondition survives the mutation.
- **Scope.** `governance` — exit `1` after 121 green blocks.
- **Red landed on** the named assertion (the FORBIDDEN form fires first; the
  `=== 'partial'` line below is the same property stated positively).
- **Verbatim.**

  ```
  AssertionError [ERR_ASSERTION]: FORBIDDEN: reporting runtime.status = "written" while git still shows dispositions.json dirty
    actual: 'written', expected: 'written', operator: 'notStrictEqual'
  ```
- **Restored.** Both mirrors back to `d8ee621d…`, verified.
- **Verdict: effective.**

---

## What this exercise found

1. **One plan row (M1) named source text that no longer exists.** A literal
   replacement would have matched zero times and produced a green suite that read
   as a passing control. Match counts are now recorded per mirror for every row
   precisely so a no-op cannot masquerade as evidence.
2. **One brief-supplied fixture (M12) was dead despite carrying a confident
   explanation of why it worked.** Verifying that the fixture reaches its branch
   on the green baseline BEFORE trusting the mutation result is what caught it.
3. **One guard (M3) is shadowed by an earlier unguarded dereference.** The
   invariant is defended — the corrected seam proves it — but the assertion the
   plan names can never be the one that reports the defect, because
   `T-disposition-resolve` crashes on `annotate(...).disposition.status` first.
   That is a real (small) weakness in the test suite's failure reporting, not in
   the product. **Left as found: this task's production scope is zero, and
   tightening `T-disposition-resolve` is a separate call.**
4. **Three invariants had no covering assertion at all** — R006 occurrence
   identity (M10), the compatibility-root parse-failure gate (M12), and `list`'s
   degraded-census branch (M13). All three now have one.
5. **Four rows were already covered** by assertions shipped in Tasks 8 and 9
   (M6, M8, M11, M14). No duplicate blocks were written.

## Not done, deliberately

No production code was touched. No mutation revealed a production defect; the one
weakness found (item 3 above) is in the test suite's assertion ordering, and
changing it is a human gate decision, not this task's.
