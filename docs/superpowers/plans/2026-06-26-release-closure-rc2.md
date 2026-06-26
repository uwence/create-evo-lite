---
id: plan:release-closure-rc2
linkedSpec: spec:release-closure-rc2
---

# Release Closure RC2 (2.0.10-rc2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three release blockers in the 2.0.10 candidate, the test-harness
scope gap that hid them, and the doc/spec drift. Implements
`spec:release-closure-rc2`.

**Architecture:** Reorder `installRuntimeDependencies()` so the manifest copy
runs before the skip-install return; add a `evo-lite-version.json` scaffold
artifact carrying `SELF_VERSION` that `getRuntimeVersion()` prefers; regenerate
the root lockfile; make test scope `all` run both the governance and integration
suites; reconcile three drifted doc spots. All guarded by new checkpoints in the
existing governance test slice.

**Tech Stack:** Node.js (CommonJS), the home-grown `node ./.evo-lite/cli/test.js`
runner, `npm install --package-lock-only`, the `templates/cli → .evo-lite/cli`
mirror flow.

---

### Task 1: skip-install must still restore the runtime manifest + lockfile

**Files:**
- Modify: `index.js`
- Test: `templates/cli/test.js`

- [x] **Step 1:** Add failing guard T18f asserting `package.json` + `package-lock.json` exist after `installRuntimeDependencies(tmp, { skipInstall: true })`.
- [x] **Step 2:** Move the `writeManifest !== false` → `writeRuntimeManifest()` call ahead of the `skipInstall` early return in `installRuntimeDependencies()`.
- [x] **Step 3:** Run governance suite; T18f green; T18c (fail-closed/skip semantics) still green.

### Task 2: product version propagates to getRuntimeVersion (no 1.0.0 regression)

**Files:**
- Modify: `index.js`
- Modify: `templates/cli/runtime.js`
- Test: `templates/cli/test.js`

- [x] **Step 1:** Add failing guard T18g asserting `SELF_VERSION === package.json version === getRuntimeVersion()` for a fresh `writeRuntimeManifest()` scaffold; export `writeRuntimeManifest` + `SELF_VERSION` from `index.js`.
- [x] **Step 2:** `writeRuntimeManifest()` writes `.evo-lite/evo-lite-version.json = { version: SELF_VERSION }`.
- [x] **Step 3:** `getRuntimeVersion()` prefers `evo-lite-version.json`, falls back to `package.json`, then `unknown` (T18a backward-compatible).
- [x] **Step 4:** Run governance suite; T18g + T18a green.

### Task 3: root package-lock.json version consistency

**Files:**
- Modify: `package-lock.json`
- Test: `templates/cli/test.js`

- [x] **Step 1:** Add failing guard T18h asserting root lockfile `version` and `packages[""].version` equal `package.json`.
- [x] **Step 2:** `npm install --package-lock-only` to regenerate the root lockfile at `2.0.10`.
- [x] **Step 3:** Run governance suite; T18h green.

### Task 4: `npm test` runs every suite + reconcile doc/spec drift

**Files:**
- Modify: `templates/cli/test.js`
- Modify: `.github/workflows/release-gate.yml`
- Modify: `docs/superpowers/specs/2026-06-23-release-hardening-phase1.md`
- Modify: `docs/superpowers/specs/2026-06-24-release-closure-patch.md`

- [x] **Step 1:** Make scope `all` run `runGovernanceTests()` then the integration suite (was integration-only), so `npm test`/CI exercise the guards.
- [x] **Step 2:** Reconcile the release-gate header (informational, not "NOT verified"/"REQUIRED check").
- [x] **Step 3:** Reconcile the phase-1 spec architecture line to the informational gate.
- [x] **Step 4:** Correct the false "VERIFIED ALREADY FIXED" item-2 verdict in `spec:release-closure-patch` to "WAS OPEN, FIXED IN 2.0.10-rc2".
- [x] **Step 5:** `npm test` runs both suites and exits 0.

---

## Self-Review

- **R1** → Task 1 (T18f). **R2** → Task 2 (T18g, evo-lite-version.json + getRuntimeVersion). **R3** → Task 3 (T18h). **R4** → Task 4 Step 1. **R5** → Task 4 Steps 2–4.
- **Placeholder scan:** none.
- **Type consistency:** `SELF_VERSION` (string) and `writeRuntimeManifest(evoLiteDir)` exported from `index.js` and consumed in T18g; `getRuntimeVersion()` returns string. Mirror synced via `sync-runtime`.
