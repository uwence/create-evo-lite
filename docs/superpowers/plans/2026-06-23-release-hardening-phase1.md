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

- [ ] **Step 1: Add a failing preflight test**

In `templates/cli/test.js`, add a case that invokes the initializer's
Node-version preflight helper with a simulated old version and asserts it reports
unsupported (exit-intent) rather than proceeding. Extract the check into a small
pure helper (e.g. `assertNodeVersion(versionString)`) so it is unit-testable.

- [ ] **Step 2: Run and confirm the gap**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: the preflight test fails (no helper / no enforcement yet).

- [ ] **Step 3: Declare engines and add preflight**

In `package.json` add:

```json
"engines": { "node": ">=20.0.0" },
"engineStrict": true
```

At the very top of the initializer `main()` in `index.js` (before any file
writes or install), check `process.versions.node` against the floor and exit
non-zero with a clear message when unmet.

- [ ] **Step 4: Sync runtime and rerun**

```bash
node ./.evo-lite/cli/memory.js sync-runtime
node ./.evo-lite/cli/test.js governance
```

Expected: preflight test passes; Node <20 exits before scaffolding.

- [ ] **Step 5: Commit**

```bash
git add package.json index.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "feat(release): declare engines.node>=20 and preflight node version before scaffolding"
```

---

### Task 2: Ship a reproducible runtime manifest

**Files:**
- Modify: `index.js`
- Add: runtime manifest + lockfile template asset

- [ ] **Step 1: Author the versioned runtime manifest**

Replace the ad-hoc `npm install better-sqlite3 tar commander @modelcontextprotocol/sdk`
(`index.js:417`) with a shipped manifest that pins all four runtime dependencies,
and generate a lockfile for it. The written `.evo-lite/package.json`
(`index.js:409`) MUST list every runtime dependency, not just `commander`.

- [ ] **Step 2: Install deterministically**

Change the initializer to install via `npm ci` against the shipped lockfile (fall
back to pinned `npm install` only when no lockfile is present). Same package
version ⇒ same runtime.

- [ ] **Step 3: Verify reproducibility**

```bash
# from a clean scaffold, runtime deps resolve without prior .evo-lite/node_modules
node ./.evo-lite/cli/memory.js verify
```

Expected: runtime engine ready from a deterministic install.

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat(release): ship versioned runtime manifest + lockfile, install via npm ci"
```

---

### Task 3: Make dependency install fail-closed

**Files:**
- Modify: `index.js`
- Test: `templates/cli/test.js`

- [ ] **Step 1: Add a failing fail-closed test**

In `templates/cli/test.js`, add a case that drives the install path with a forced
failure (e.g. an unresolvable registry or injected error) and asserts the
initializer reports `runtime-not-ready` and a non-zero exit intent — NOT a
success banner.

- [ ] **Step 2: Run and confirm current fail-open behavior**

```bash
node ./.evo-lite/cli/test.js governance
```

Expected: today the initializer swallows the error and still "succeeds" — test fails.

- [ ] **Step 3: Implement fail-closed readiness**

In `index.js`, make the install `catch` (around `index.js:417`) set an explicit
readiness state and exit non-zero. Gate the "🎉 deployment complete" banner on
readiness. Add `--skip-install` / `--offline` that report
`scaffold-created / runtime-not-ready` (never success).

- [ ] **Step 4: Sync runtime and rerun**

```bash
node ./.evo-lite/cli/memory.js sync-runtime
node ./.evo-lite/cli/test.js governance
```

Expected: forced install failure ⇒ non-zero exit + `runtime-not-ready`, no success banner.

- [ ] **Step 5: Commit**

```bash
git add index.js templates/cli/test.js .evo-lite/cli/test.js
git commit -m "fix(release): fail-closed dependency install with explicit runtime-not-ready state"
```

---

### Task 4: Add a CI release gate that consumes the packed tarball

**Files:**
- Add: `.github/workflows/release-gate.yml`

- [ ] **Step 1: Author the matrix workflow**

Create `.github/workflows/release-gate.yml` running on push/PR to `main` across
`ubuntu-latest` and `windows-latest` × Node `20` and `22`. Each job runs:

```bash
npm ci
npm test
npm pack
```

- [ ] **Step 2: Consume the tarball on a non-Node host**

In the same job, scaffold an empty project that has NO root `package.json`,
install the packed tarball into it, and prove readiness:

```bash
npm exec --package ./create-evo-lite-*.tgz create-evo-lite ./empty-non-node -- --yes
node ./empty-non-node/.evo-lite/cli/memory.js verify
node ./empty-non-node/.evo-lite/cli/mcp-validate.js ./empty-non-node
```

- [ ] **Step 3: Make the gate required**

Document (and configure, where the repo settings allow) that the release-gate
check is required before merge to `main`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-gate.yml
git commit -m "ci(release): matrix gate — npm ci/test/pack + non-Node tarball consume with verify + mcp-validate"
```

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
