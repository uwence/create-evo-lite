---
id: spec:release-closure-patch
status: done
created: 2026-06-24
linkedPlan: plan:release-closure-patch
supersedesRequirement: spec:release-hardening-phase1#R2
amendsRequirement: spec:release-hardening-phase1#R4
---

# Release Closure Patch (2.0.10) — Spec

## Goal

Close the remaining real release-engineering gaps left after
`release-hardening-phase1`, and reconcile the one spec↔reality conflict that
phase left behind. Ship as `2.0.10`. The npm-published `2.0.9` is known-broken
on at least one packaging path; this patch is the corrected, dogfood-verified
release.

## Context & Evidence

`release-hardening-phase1` is `status: done`. A follow-up agent retrospective
plus a fresh static re-verification of `main` produced a 5-item "release
closure" list. Each item was re-checked against the live code on
`2026-06-24` before scoping this spec, and the list shrank:

1. **Runtime is not restorable with `npm ci`** — VERIFIED OPEN.
   `installRuntimeDependencies()` ([index.js:55](../../../index.js)) writes a
   manifest dynamically via `writeRuntimeManifest()` ([index.js:42](../../../index.js))
   then runs bare `npm install` ([index.js:70](../../../index.js)). No lockfile
   ships in `templates/` (`templates/` has no `package.json`/`package-lock.json`),
   and the dogfood root `.evo-lite/package-lock.json` is **not git-tracked**
   (`git ls-files` returns nothing). The CI step installs the same set ad-hoc
   ([.github/workflows/release-gate.yml:55](../../../.github/workflows/release-gate.yml)).
   Phase-1 R2 was satisfied only by its "**or** pinned versions" escape clause;
   this patch delivers the stronger `npm ci`-against-a-lockfile path R2 named
   first.

2. **`--skip-install` could skip the manifest** — VERIFIED ALREADY FIXED.
   `writeRuntimeManifest()` is called inside the install branch and the
   skip-install branch returns before any install
   ([index.js:57-70](../../../index.js)); no manifest-ordering bug remains. No
   work.

3. **Node support contract** — REDUCED. Decision (`2026-06-24`): keep the
   declared floor at `>=20` (phase-1 R1 stands; Node 20 stays covered on Linux);
   only **add Node 24** to the CI matrix. No breaking `engines` change.

4. **Tag/publish bound to a release gate** — OUT OF SCOPE for this patch
   (declined as part of the rejected "keep R4 MUST + publish-gate" bundle).
   Branch-protection remains a documented manual step per R4 below.

5. **Version + spec status reconciliation** — VERIFIED OPEN. Source is still
   `2.0.9`; published `2.0.9` carries the pre-fix packaging defect. And
   phase-1 R4 says "Merge to `main` MUST require this gate" while the phase
   shipped an **informational** gate and still marked the spec `done` — a real
   spec↔reality conflict.

## Non-Goals

- No change to the memory engine, IR model, dashboard, governance rules, or the
  archive chain.
- No bump of the declared Node floor (`engines.node` stays `>=20`).
- No new publish/tag-gating workflow.
- No closure-engine / `mem close` work (that is a later phase).

## Requirements

### R1 — Runtime dependencies MUST be restorable with `npm ci` from shipped, in-sync lockfile assets

A versioned runtime `package.json` **and** a matching `package-lock.json` MUST
ship inside the published package (under `templates/`). The initializer MUST
place both into the scaffolded `.evo-lite/` and install with `npm ci` (not bare
`npm install`), so the same `create-evo-lite` version always restores the same
runtime dependency tree. The shipped manifest's dependency set MUST equal
`RUNTIME_DEPENDENCIES` in [index.js](../../../index.js) (single source of truth —
a test MUST assert they match). The fail-closed contract (R3 of phase-1) MUST be
preserved: a failed `npm ci` still yields `runtime-not-ready` + non-zero exit,
and `--skip-install` still skips with no npm invocation.

### R2 — CI matrix MUST cover Node 24 without dropping existing coverage

The release-gate matrix MUST add Node 24 on both Linux and Windows, keep Node 20
on Linux and Node 22 on both, and keep excluding Windows + Node 20 (no
better-sqlite3 win-x64 node-20 prebuild). If `better-sqlite3@12.11.1` ships no
Windows node-24 prebuild either, Windows + Node 24 MUST be excluded with the same
documented rationale rather than left to fail. The runtime install step MUST use
the shipped `npm ci` path from R1, not the ad-hoc `npm install --prefix` line.

### R3 — The published version MUST advance to 2.0.10 with a changelog entry

`package.json` version MUST become `2.0.10`. `CHANGELOG.md` MUST gain a `2.0.10`
entry naming the npm-ci/lockfile fix and the Node-24 matrix addition.

### R4 — The phase-1 R4 spec text MUST be reconciled to the shipped informational gate

`spec:release-hardening-phase1` R4 currently states "Merge to `main` MUST require
this gate" but an informational gate shipped and the spec is `done`. R4's text
MUST be amended to match reality: the gate MUST run green on CI, and making it a
**required** check is a documented manual repo-admin step (not enforceable from
the CLI). After amendment no `error`-level governance drift may reference this
conflict.

## Acceptance Criteria

- `templates/` ships a runtime `package.json` and `package-lock.json`; `npm pack`
  includes both (neither is an npm-pack-stripped name).
- A scaffold into a clean dir produces `.evo-lite/package.json` +
  `.evo-lite/package-lock.json`, and the real install path invokes `npm ci`
  (asserted via injected `exec` capturing the command string).
- A test asserts the shipped runtime manifest's `dependencies` deep-equal
  `RUNTIME_DEPENDENCIES`.
- Fail-closed + skip-install behavior unchanged (T18c stays green).
- `release-gate.yml` matrix includes Node 24 (Linux + Windows-unless-excluded),
  keeps Node 20 Linux, and its runtime step uses `npm ci`.
- `package.json` version is `2.0.10`; `CHANGELOG.md` has a matching entry.
- `spec:release-hardening-phase1` R4 text no longer claims an enforced required
  check; `mem verify` / planning drift shows no `error`-level finding about it.
- Full `npm test` green **and** `process.exitCode === 0` (no residual non-zero
  exit), dogfood-verified before tagging.
