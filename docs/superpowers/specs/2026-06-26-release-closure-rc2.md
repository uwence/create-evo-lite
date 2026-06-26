---
id: spec:release-closure-rc2
status: done
created: 2026-06-26
linkedPlan: plan:release-closure-rc2
---

# Release Closure RC2 (2.0.10-rc2) — Spec

## Goal

Fix the three concrete release blockers an independent review found in the
2.0.10 candidate, plus the test-harness gap that let them ship green, plus the
doc/spec drift left behind. Make `2.0.10` actually publishable and make the
governance record honest. Supersedes the false "VERIFIED ALREADY FIXED" verdict
on item 2 of `spec:release-closure-patch`.

## Context

The 2.0.10 patch was declared "verified green, fully closed", but `npm test`
(default scope `all`) ran **integration tests only** — the entire governance
suite (T13–T27) never executed in `npm test` or CI. Three regressions therefore
shipped green:

1. `--skip-install` / `--offline` returned before `writeRuntimeManifest()`, so a
   skipped install left `.evo-lite/` with no `package.json` / `package-lock.json`
   while the fail hint still told the user to `cd .evo-lite && npm ci` — an
   unrunnable recovery.
2. The shipped runtime manifest is version-pinned to `1.0.0` (decoupled from the
   product version for lockfile stability), but `getRuntimeVersion()` read that
   value, so a 2.0.10-scaffolded MCP server advertised `evo-lite version 1.0.0`.
3. The root `package-lock.json` stayed at `2.0.9` after `package.json` bumped to
   `2.0.10` — version metadata inconsistency, no guard.

## Requirements

- **R1 — skip-install restores the manifest.** `installRuntimeDependencies()`
  MUST copy the runtime `package.json` + `package-lock.json` even when the install
  is skipped, so the documented `npm ci` recovery works. A guard test MUST assert
  both assets exist after a skipped install.
- **R2 — product version propagates.** The initializer MUST write the product
  version (`SELF_VERSION`) to a scaffold artifact, and `getRuntimeVersion()` MUST
  report it (falling back to `package.json`, then `unknown`). A guard test MUST
  assert `SELF_VERSION === package.json version === getRuntimeVersion()` for a
  fresh scaffold. The runtime manifest stays pinned (lockfile stability preserved).
- **R3 — root lockfile version consistency.** The root `package-lock.json`
  `version` and `packages[""].version` MUST equal `package.json`. A guard test
  MUST assert this.
- **R4 — `npm test` runs every suite.** Scope `all` MUST run the governance suite
  AND the integration suite, so `npm test` and CI exercise the guards above.
- **R5 — doc/spec drift reconciled.** The release-gate header, the phase-1 spec
  architecture line, and the false item-2 verdict in `spec:release-closure-patch`
  MUST match the shipped informational gate and the corrected skip-install reality.

## Acceptance Criteria

- `npm test` runs both the governance and integration suites and exits 0,
  including new guards T18f (skip-install manifest), T18g (version propagation),
  T18h (root lockfile consistency).
- A `--offline` scaffold leaves a runnable `.evo-lite/` (`npm ci` works).
- A 2.0.10-scaffolded MCP server advertises `2.0.10`, not `1.0.0`.
- Root `package-lock.json` is `2.0.10`.
- No spec/workflow text still claims the gate is a required check or that
  skip-install was "already fixed".
- Planning drift carries no `error`-level finding about this work.

## Non-Goals

- `npm publish` + git tag of 2.0.10 (separate manual release action).
- The Verification Contract / `mem close` engine (next phase).
