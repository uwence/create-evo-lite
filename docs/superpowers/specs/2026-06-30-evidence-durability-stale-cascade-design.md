---
id: spec:evidence-durability-stale-cascade
linkedPlan: plan:evidence-durability-stale-cascade
status: draft
---

# Evidence Durability — Kill the STALE Cascade (Precision Slice)

## Context

The verification-contract engine (shipped through PR-CC) derives a live verdict per
acceptance criterion in `derive-verdicts.js` / `compute-status.js`. A criterion's
recorded PASS goes **STALE** when a file in its `dependsOn` globs changed since the
evidence commit (`git diff <record.commitSha>..HEAD --name-only`).

Every dogfood criterion declares `templates/cli/test.js` in its `dependsOn`, because
its verifier is the whole-suite command `node ./.evo-lite/cli/test.js governance`.
`test.js` is a single 249 KB monolith that is edited on nearly every task (tests are
added for everything). The result: **any** edit to `test.js` matches **every**
criterion's `dependsOn`, so all criteria go STALE together — the "STALE cascade."

## Root Cause

The coupling point is the shared monolith file appearing in every `dependsOn`.
`dependsOn` matching is **file-level** (git diff is file-granular), so as long as the
verifying tests live in one file, the engine physically cannot tell which criterion's
tests changed. **Precision requires splitting `test.js` along file boundaries.**

Dropping `test.js` from `dependsOn` is *not* an option: a criterion genuinely depends
on the test code that verifies it; omitting it would under-stale (false PASS when the
test changes).

## Goal

Decouple per-criterion staleness by splitting `test.js` along its existing
`shouldRun(scope)` seam, so editing one functional area's tests only stales the
criteria for that area.

## Non-Goals

- **Per-criterion test files** (one file per `ac-*`): over-granular; the existing
  scope seam is the right grain.
- **Intra-file `assertionId` addressing** (sub-file verifier targeting): solves
  re-verify *speed*, not staleness *precision*. Deferred.
- **Atomic evidence write** (crash-safe `evidence-*.json`): real robustness work, but
  a separate scope unrelated to the cascade.
- **Splitting `integration` further**: no criterion verifier references it today, so
  there is no precision payoff. YAGNI.

## Design

### Current structure

`test.js` already subsets by scope: `TEST_SCOPE = process.argv[2] || 'all'`,
`shouldRun(scope) = TEST_SCOPE === 'all' || TEST_SCOPE === scope`. There is exactly
one scoped suite, `governance` (`runGovernanceTests`, the suite the criteria verify);
the rest is the default CLI `integration` suite (`runTests` body). Shared helpers
(`runGit`, `runPostCommitHook`, `runInitializer`, temp-runtime builders, assertion
setup) are used by both.

### Target structure (thin dispatcher + 3 files)

Under `cli/test/` (mirrored in both `templates/cli/test/` and `.evo-lite/cli/test/`):

- `test/harness.js` — shared helpers, exported. Stable and minimal.
- `test/governance.js` — `runGovernanceTests`, imports harness. Exports the suite fn.
- `test/integration.js` — the default CLI suite, imports harness. Exports the suite fn.
- `test.js` — thin dispatcher: parse `TEST_SCOPE`, `require` and run the matching
  suite(s); `all` runs every suite (preserves `npm test`). Keeps the non-suite argv
  branches it already dispatches (`plan gaps`, `dashboard build`) or delegates them
  unchanged.

### dependsOn retarget

Rewrite each governance criterion's `dependsOn`: replace `templates/cli/test.js` with
`templates/cli/test/governance.js` and `templates/cli/test/harness.js` (keep the
criterion's own source file, e.g. `close-apply.js`). After this, editing
`test/integration.js` no longer stales governance criteria.

`harness.js` is shared by all suites, so a harness edit still stales every criterion —
that is correct (a harness change really can affect every test). Keep harness small
and change-averse to minimize this residual, intentional coupling.

### Template mirror + manifest

The 3 new files are managed template assets. Register them in
`template-manifest.js` and ship them to both mirrors. **Risk:** partial-mirror sync
can self-brick when a loaded file requires a newly-managed file that is not yet present
(see the sync-runtime self-brick note). Mitigation: update the manifest first, then
sync 2–3× or hand-copy the new files before relying on a single sync pass.

### One-time evidence churn

`criterionDigest` includes `dependsOn`, so retargeting changes each affected
criterion's digest → those criteria go STALE once on the next status read. Re-run
`mem verify-contract run <spec>` to re-record PASS at the new digest. Expected and
self-healing.

## Error Handling

- Dispatcher: an unknown scope runs nothing and exits non-zero with a clear message
  (preserve today's behavior where `shouldRun` simply gates).
- A suite `require` failure must fail loudly (non-zero exit), never silently skip — a
  missing sub-suite file must not masquerade as a green run.

## Testing

- `npm test` (scope `all`) stays green: every extracted suite still runs and passes.
- `node ./.evo-lite/cli/test.js governance` stays green against the extracted
  `test/governance.js`.
- **Precision assertion (the load-bearing new test):** simulate a change limited to
  `test/integration.js` and assert that a governance criterion's derived verdict
  remains PASS (not STALE) — i.e. `dependsMatches(governanceCriterion.dependsOn,
  ['.../test/integration.js'])` is `false`, while a change to `test/governance.js` or
  `test/harness.js` *does* stale it.
- Mirror parity: `templates/cli/test/*` and `.evo-lite/cli/test/*` stay byte-identical
  (existing mirror-parity test extended to the new files).
- `verify` reports no template drift after the manifest update.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-suite-split",
      "description": "test.js is a thin scope dispatcher over test/governance.js, test/integration.js, and test/harness.js; the governance scope runs green against the extracted suite.",
      "dependsOn": ["templates/cli/test.js", "templates/cli/test/governance.js", "templates/cli/test/integration.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-precision-no-cascade",
      "description": "A change confined to test/integration.js must not stale a governance criterion; a change to test/governance.js or test/harness.js must, per the T-precision regression test.",
      "dependsOn": ["templates/cli/test/governance.js", "templates/cli/test/harness.js", "templates/cli/verification/derive-verdicts.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-full-suite-green",
      "description": "npm test (scope all) stays green: every extracted suite still runs and passes end to end.",
      "dependsOn": ["templates/cli/test.js", "templates/cli/test/governance.js", "templates/cli/test/integration.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js", "scope": "all" } } },
    { "id": "ac-mirror-parity",
      "description": "templates/cli/test/* and .evo-lite/cli/test/* stay byte-identical across the split suite files and the manifest registration.",
      "dependsOn": ["templates/cli/test/governance.js", "templates/cli/test/integration.js", "templates/cli/test/harness.js", "templates/cli/template-manifest.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```
