---
id: spec:release-hardening-phase1
status: done
created: 2026-06-23
linkedPlan: plan:release-hardening-phase1
---

# Release Hardening Phase 1 — Spec

## Goal

Close the release-engineering and post-install-runtime gaps that block calling
`main` production-ready. After this phase, a fresh consumer install of the
published package on a non-Node host either reaches a verified-ready runtime or
fails loudly with a non-zero exit — never a false "deployment complete".

## Review Evidence

Grounded in an external static review of `main@aa4b0aa` (2026-06-23) whose three
P1 blockers were each independently verified against the code in this repo. The
fourth blocker it raised (MCP version path) is already fixed in `daa6b91`
(`runtime.getRuntimeVersion()` + T18a); this phase covers the remaining three
plus the Node-engine contract.

### Verified findings

1. **Fail-open dependency install** — `index.js:417` runs
   `execSync('npm install better-sqlite3 tar commander @modelcontextprotocol/sdk')`
   inside a `try`; the `catch` only `console.warn`s and execution continues to
   the "🎉 deployment complete" message. A host with no build toolchain or no
   network gets a "success" banner over a runtime that then fails at
   `mem bootstrap` / db / archive / MCP.

2. **Non-reproducible dependency set** — the same install command pins no
   versions, and the written `.evo-lite/package.json` (`index.js:409`) declares
   only `commander` in `dependencies`; `better-sqlite3`, `tar`, and the MCP SDK
   are installed ad-hoc. `npm ci` cannot restore the runtime, so a clean checkout
   is not self-consistent ("works on the dev box, maybe not on a clean one").

3. **No remote release gate** — there is no CI proving `npm ci && npm test` or a
   packaged consumer install on a clean machine. The most important release
   evidence currently lives only in local state, which contradicts Evo-Lite's own
   "evidence closure" principle.

4. **No Node-engine contract** — root `package.json` declares no `engines`, yet
   `commander@14` requires Node ≥20. A Node 18 user can scaffold first and only
   hit an unintuitive failure later, mid-initialization.

## Problem

The product model (As-Planned / As-Designed / As-Built, plus drift/traceability)
is mature, but the path from "published package" to "verified-ready runtime on an
arbitrary host" has gaps that only stay hidden because the dogfood repo root
happens to be a Node project with a warm `.evo-lite/node_modules`.

## Non-Goals

- No change to the memory engine, IR model, dashboard, or governance rules.
- No redesign of the archive chain.
- No attempt to support hosts below the declared Node floor.
- Hook dispatcher safety, Git `cwd` binding, migration atomicity, and the
  raw_memory privacy default are real (P2 in the review) but are deferred to a
  later phase — this phase is scoped to the three release blockers + engines.

## Requirements

### R1 — A Node-engine contract MUST be declared and enforced early

Root `package.json` MUST declare `engines.node` matching the real floor
(`>=20`). The initializer MUST check `process.versions.node` at the very start
and exit non-zero with a clear message when the floor is not met, before writing
any files or running install.

### R2 — Runtime dependencies MUST be reproducible

The runtime's required dependencies (`better-sqlite3`, `tar`, `commander`, the
MCP SDK) MUST be expressed as a versioned manifest shipped with the package, not
installed ad-hoc with floating versions. Installation MUST prefer a deterministic
path (`npm ci` against a lockfile, or pinned versions) so the same package
version always produces the same runtime.

### R3 — Dependency install MUST be fail-closed

When a required dependency fails to install or compile, the initializer MUST NOT
print a success banner. It MUST surface a `runtime-not-ready` state and exit
non-zero. An explicit `--skip-install` / `--offline` flag MAY skip installation,
but MUST report `scaffold-created / runtime-not-ready`, never success.

### R4 — A remote CI release gate MUST prove a clean consumer install

CI MUST run on Linux and Windows across the supported Node range and MUST, at
minimum: `npm ci`, `npm test`, `npm pack`, then install the packed tarball into a
**non-Node** empty project and prove the runtime is ready
(`memory.js verify` + `mcp-validate`). The gate MUST run green on CI for every PR and push to `main`. Promoting it to a
**required** status check for `main` is a documented manual repo-admin step
(branch-protection settings; not enforceable from the CLI) — it is therefore an
informational gate by default, not an automatically-enforced merge block.

## Architecture

1. **Engine-contract layer** — `engines` in `package.json` + a top-of-`main()`
   Node-version preflight in `index.js`.
2. **Reproducible-runtime layer** — a versioned runtime manifest (and lockfile)
   shipped as a template asset; initializer installs from it deterministically.
3. **Fail-closed install layer** — install result drives an explicit readiness
   state and process exit code; the completion banner is gated on readiness.
4. **Release-gate layer** — a GitHub Actions workflow doing the matrix +
   pack-and-consume smoke test, made a required check on `main`.

## Acceptance Criteria

- `package.json` declares `engines.node >=20`; running the initializer on Node
  <20 exits non-zero before scaffolding.
- A clean `npm ci` (no pre-existing `.evo-lite/node_modules`) followed by
  `npm test` passes the runtime tests, or the test entry reports its missing
  runtime deps explicitly rather than silently depending on prior state.
- Simulated install failure yields a non-zero exit and a `runtime-not-ready`
  message, with no "deployment complete" banner.
- CI runs the Linux+Windows × Node-range matrix, packs the tarball, installs it
  into an empty non-Node project, and passes `verify` + `mcp-validate`; the gate
  runs green and the required-check promotion is documented as a manual repo-admin
  step.
