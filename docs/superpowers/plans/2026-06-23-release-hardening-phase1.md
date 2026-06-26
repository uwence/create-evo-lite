---
id: plan:release-hardening-phase1
linkedSpec: spec:release-hardening-phase1
---

# Release Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three verified release blockers plus the Node-engine contract
so a fresh consumer install reaches a verified-ready runtime or fails loudly.
Implements `spec:release-hardening-phase1`.

**Architecture:** Add an engine contract + preflight, ship a reproducible runtime
manifest, make dependency install fail-closed with an explicit readiness state,
and add a CI release gate that packs and consumes the tarball on a non-Node host.

**Tech Stack:** Node.js (initializer `index.js`), npm (manifest + lockfile),
GitHub Actions, existing `.evo-lite/cli/memory.js verify` and `mcp-validate.js`.

---

## File Map

| File | Change |
|------|--------|
| `package.json` | add `engines.node >=20` (+ `engineStrict`) |
| `index.js` | Node-version preflight; deterministic install; fail-closed readiness state + exit code; gate completion banner |
| `templates/.evo-lite/package.json` (or equivalent runtime manifest asset) | versioned runtime dependencies + lockfile shipped with the package |
| `.github/workflows/release-gate.yml` | Linux+Windows × Node matrix: `npm ci` → `npm test` → `npm pack` → consume tarball in empty non-Node project → `verify` + `mcp-validate` |
| `templates/cli/test.js` | coverage for preflight + fail-closed readiness behavior |

---

### Task 1: Declare and enforce the Node-engine contract

**Files:**
- Modify: `package.json`
- Modify: `index.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing preflight test**

In `templates/cli/test.js`, add a case that invokes the initializer's
Node-version preflight helper with a simulated old version and asserts it reports
unsupported (exit-intent) rather than proceeding. Extract the check into a small
pure helper (e.g. `assertNodeVersion(versionString)`) so it is unit-testable.

- [x] **Step 2: Run and confirm the gap**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: the preflight test fails (no helper / no enforcement yet).

- [x] **Step 3: Declare engines and add preflight**

In `package.json` add:

```json
"engines": { "node": ">=20.0.0" },
"engineStrict": true
```

At the very top of the initializer `main()` in `index.js` (before any file
writes or install), check `process.versions.node` against the floor and exit
non-zero with a clear message when unmet.

- [x] **Step 4: Sync runtime and rerun**

```bash
node ./.evo-lite/cli/memory.js sync-runtime
node ./.evo-lite/cli/test.js governance
```

Expected: preflight test passes; Node <20 exits before scaffolding.

- [x] **Step 5: Commit**

```bash
git add package.json index.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "feat(release): declare engines.node>=20 and preflight node version before scaffolding"
```

---

### Task 2: Ship a reproducible runtime manifest

**Files:**
- Modify: `index.js`
- Add: runtime manifest + lockfile template asset

- [x] **Step 1: Author the versioned runtime manifest**

Replace the ad-hoc `npm install better-sqlite3 tar commander @modelcontextprotocol/sdk`
(`index.js:417`) with a shipped manifest that pins all four runtime dependencies,
and generate a lockfile for it. The written `.evo-lite/package.json`
(`index.js:409`) MUST list every runtime dependency, not just `commander`.

- [x] **Step 2: Install deterministically**

Change the initializer to install via `npm ci` against the shipped lockfile (fall
back to pinned `npm install` only when no lockfile is present). Same package
version ⇒ same runtime.

- [x] **Step 3: Verify reproducibility**

```bash
# from a clean scaffold, runtime deps resolve without prior .evo-lite/node_modules
node ./.evo-lite/cli/memory.js verify
```

Expected: runtime engine ready from a deterministic install.

- [x] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat(release): ship versioned runtime manifest + lockfile, install via npm ci"
```

> Implemented via the R2-permitted **exact pinned versions** path (not a committed
> lockfile): shipping a static lockfile conflicts with the SELF_VERSION-injected
> manifest version. Exact top-level pins give reproducibility without that coupling.

---

### Task 3: Make dependency install fail-closed

**Files:**
- Modify: `index.js`
- Test: `templates/cli/test.js`

- [x] **Step 1: Add a failing fail-closed test**

In `templates/cli/test.js`, add a case that drives the install path with a forced
failure (e.g. an unresolvable registry or injected error) and asserts the
initializer reports `runtime-not-ready` and a non-zero exit intent — NOT a
success banner.

- [x] **Step 2: Run and confirm current fail-open behavior**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: today the initializer swallows the error and still "succeeds" — test fails.

- [x] **Step 3: Implement fail-closed readiness**

In `index.js`, make the install `catch` (around `index.js:417`) set an explicit
readiness state and exit non-zero. Gate the "🎉 deployment complete" banner on
readiness. Add `--skip-install` / `--offline` that report
`scaffold-created / runtime-not-ready` (never success).

- [x] **Step 4: Sync runtime and rerun**

```bash
node ./.evo-lite/cli/memory.js sync-runtime
node ./.evo-lite/cli/test.js governance
```

Expected: forced install failure ⇒ non-zero exit + `runtime-not-ready`, no success banner.

- [x] **Step 5: Commit**

```bash
git add index.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "fix(release): fail-closed dependency install with explicit runtime-not-ready state"
```

---

### Task 4: Add a CI release gate that consumes the packed tarball

**Files:**
- Create: `.github/workflows/release-gate.yml`

- [x] **Step 1: Author the matrix workflow**

Create `.github/workflows/release-gate.yml` running on push/PR to `main` across
`ubuntu-latest` and `windows-latest` × Node `20` and `22`. Each job runs:

```bash
npm ci
npm test
npm pack
```

- [x] **Step 2: Consume the tarball on a non-Node host**

In the same job, scaffold an empty project that has NO root `package.json`,
install the packed tarball into it, and prove readiness:

```bash
npm exec --package ./create-evo-lite-*.tgz create-evo-lite ./empty-non-node -- --yes
node ./empty-non-node/.evo-lite/cli/memory.js verify
node ./empty-non-node/.evo-lite/cli/mcp-validate.js ./empty-non-node
```

> **Verified green on real runners (run 28073351322).** The first runs caught
> three real bugs the gate then forced fixed: a process.exitCode leak in the test
> harness (commit 7112e0b), npm pack stripping templates/.gitignore — broke every
> npx consumer, present in published 2.0.9 (commit 74ff1d2), and the
> Windows/Node-20 better-sqlite3 prebuild gap (matrix exclude, commit 2232d2f).
> Current matrix: Linux 20/22 + Windows 22, all passing.

- [x] **Step 3: Make the gate required** — _resolved: informational gate, no branch rule (by decision)_

Document (and configure, where the repo settings allow) that the release-gate
check is required before merge to `main`.

> **Decision (2026-06-24): informational gate, no branch protection rule.** A hard
> required status check would block landing any unchecked commit on `main`,
> forcing a branch → CI-green → push/merge flow even without requiring PRs. The
> maintainer works by direct push to `main` and chose to keep that, so no branch
> rule is added. The gate still runs: release-gate fires on every push to `main`
> (`on: push`) and its ✓/✗ shows on each commit — visible, just not blocking.
> Step closed as not-applicable-under-this-model; the gate is delivered and green,
> only the hard-block was declined.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/release-gate.yml
git commit -m "ci(release): matrix gate — npm ci/test/pack + non-Node tarball consume with verify + mcp-validate"
```

> Landed as a series rather than one commit: initial draft (fd96814 lineage),
> matrix exclude (2232d2f), and the pinned runtime-test step (5c9cd30).

---

## Self-Review

**Spec coverage check:**
- ✅ R1 engine contract + preflight → Task 1
- ✅ R2 reproducible runtime deps → Task 2
- ✅ R3 fail-closed install → Task 3
- ✅ R4 CI release gate consuming the tarball → Task 4

**Placeholder scan:** No `TODO`, `TBD`, or "implement later" placeholders remain
in the task steps.

**Type consistency:** The plan consistently uses `engines.node`, `npm ci`,
`runtime-not-ready`, `release-gate.yml`, `verify`, and `mcp-validate`.
