---
id: plan:codegraph-adapter-governance-linker-mvp
linkedSpec: spec:codegraph-adapter-governance-linker
status: draft
created: 2026-07-13
---

# CodeGraph Adapter & Governance Linker — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real structural Provider (`provider:codegraph`, a fingerprint-locked CodeGraph CLI adapter) plus the Governance Linker that turns code facts into Task/Commit/Evidence links — Evo-Lite's Task-to-Code differentiation — with a file-based cache, post-commit integration, status surface, failure isolation, a dogfood validator, and a host-gated live dogfood run.

**Architecture:** The adapter implements sub-spec ①'s `CodePerceptionProvider` contract, driven entirely through a secure `execFile` runner (no shell, `--` option-injection defense). JSON command output is normalized through ①'s `normalize.js` via explicit per-command translators; `explore`/`node` output is opaque text. A file-based bounded cache (readable by the separate post-commit process) stores normalized results and never rewrites stale as fresh. The Governance Linker consumes Planning IR + explicit inputs + Git + Evidence + Provider references to emit confidence-graded `GovernanceCodeLink`s. Fixtures are derived from pinned upstream `@colbymchenry/codegraph@1.4.1` with recorded provenance — never invented.

**Tech Stack:** Node CommonJS, zero new deps (node builtins: child_process/crypto/fs/path), 4-space indent. Consumes shipped sub-spec ① modules under `templates/cli/code-perception/`.

## Global Constraints (binding — verbatim from spec; every task inherits these)

- **Upstream identity locked** to `colbymchenry/codegraph` (package `@colbymchenry/codegraph`, provider id `provider:codegraph`, compat `>=1.0.0 <2.0.0`, MIT). NOT `optave/ops-codegraph-tool`. `check()` fingerprints identity (semver in range + `help` contains command set `status/files/query/explore/node/callers/callees/impact/affected` + output shape) — never trust the bare executable name.
- **Command mapping (exact):** status→`status <root> --json`, files→`files <root> --json`, search→`query <query> --json`, callers→`callers <symbol> --json`, callees→`callees <symbol> --json`, impact→`impact <symbol> --json`, affectedTests→`affected [files...] --json`, explore→`explore <query>` (opaque), entity source→`node <entity>` (opaque).
- **Execution security:** single executable; `execFile` with **no `shell:true`**; args as an array; explicit project-root argument; enforced timeout (kill child on expiry); stdout/stderr byte caps; strip ANSI; NEVER execute a command found in Provider output.
- **Option-injection defense (no-shell is NOT enough):** user-derived operands (query/symbol/file) must pass AFTER an upstream-verified `--` positional separator, e.g. `['query','--json','--',query]`. If cg-fixtures proves upstream 1.4.1 does NOT honor `--`, then a leading-dash operand is REJECTED with diagnostic `unsafe-argument` (never passed as an option). A test drives `query="--help"` and asserts it is treated as query text, never triggers CLI help.
- **Network boundary (Local-First default) with fixed merge order:** `env = { ...baseEnv, ...callerEnv }; if (!allowNetwork) { env.DO_NOT_TRACK='1'; env.CODEGRAPH_NO_UPDATE_CHECK='1'; }` — the forced Local-First values are applied LAST so a caller's `env` can never override them. Only when `allowNetwork` is explicitly true are they omitted.
- **Allowlist as frozen array, not a frozen Set** (`Object.freeze(new Set())` does NOT block `.add()`): export `ALLOWED_SUBCOMMANDS = Object.freeze([...])`; build a module-private `new Set(ALLOWED_SUBCOMMANDS)` for lookup; do NOT export the Set.
- **No direct DB coupling:** never open/execute `.codegraph` internal DB/SQL, never depend on undocumented table structure, never modify `.codegraph`. All data comes from CLI stdout only.
- **JSON parsing rule:** validate JSON type, ignore unknown fields, preserve original provider entity id, degrade on missing fields, emit a diagnostic on bad schema, never fail on newly-added fields. `explore`/`node` output is **opaque text** — may extract explicitly-marked file/line, MUST NOT synthesize structural edges from prose, MUST NOT override JSON structural results.
- **Version compatibility + per-capability disable lifecycle:** store `adapterVersion`/`providerVersion`/`observedSchemaFingerprint`; declare `minimumProviderVersion`/`testedProviderVersions`; unknown version → attempt parse, mark `compatibility=untested`, don't block read-only queries. Schema-validation failure disables ONE capability (not the whole provider), with a defined lifecycle (see Design Notes `capabilityHealth`): schema-fail → disable + record fingerprint+diagnostic; timeout/exit-error → degrade this request only, do NOT disable; later successful parse of that capability → re-enable; providerVersion/schemaFingerprint change → clear all disable state.
- **Fixtures are captured, not invented:** every codegraph fixture derives from pinned `@colbymchenry/codegraph@1.4.1` (real-CLI capture OR pinned-upstream source), recorded in `codegraph-fixture-manifest.json` (upstream/package/providerVersion/upstreamCommit/captureMethod/per-command/fixtureSha256/redactions). The adapter defines explicit per-command translators (upstream shape → ProviderStatus / normalize raw input) — never "hand the raw blob to normalize."
- **Cache is file-based + bounded:** stored under `.evo-lite/.cache/code-perception/` so the separate post-commit process can `markStale`/invalidate it. `MAX_CACHE_ENTRIES=256`, `MAX_CACHE_VALUE_BYTES=1*1024*1024`; over-limit value → `{ stored:false, reason:'cache-value-too-large' }`. Never rewrite a stale result as fresh (values keep their original freshness). Never cache full graphs, unbounded source, secrets.
- **Failure isolation:** provider missing/not-indexed/timeout/malformed/unsupported-version must NOT break Planning IR, Architecture IR, memory, or verify; Native Lite stays available; never auto-run `codegraph sync`/`init`; truncate diagnostics that could contain source.
- **Uses sub-spec ① (shipped, do NOT modify its contracts):** `require('../provider-contract')` → `{ FRESHNESS, DIRTY, COMPAT, INDEX, CAPABILITY_KEYS, validateProvider/validateAvailability/validateStatus }`; `require('../normalize')` → `{ makeReferenceId, normalizeReference, normalizeSearchResult, normalizeRelationship, normalizeImpactResult }`; `require('../provider-loader')` → `{ DEFAULT_REGISTRY, loadProviders }`; `require('../provider-router')` → `{ inspectProviders, selectProvider }`.
- CommonJS, `'use strict'`, zero new deps, 4-space indent, style like sibling `code-perception/*.js`. New production files registered in `template-manifest.js` core-cli family; `sync-runtime` double-run-zero; `.evo-lite/cli` mirror byte-identical; `node ./.evo-lite/cli/test.js governance` green throughout; no existing plan-closure regression.
- **Live CodeGraph run is IN this plan (task `cg-live-dogfood`), host-gated + excluded from normal CI — but NOT excluded from plan completion.** If the host lacks CodeGraph, that task stays unchecked and the plan + spec honestly stay `active` (no "code done but contract unclosed"). It closes `ac-live-codegraph-dogfood`.

## Design Notes (implementer contracts — read before your task)

### `code-perception/providers/codegraph-exec.js` (secure command runner — the security seam)
```js
module.exports = {
    // Runs one allowlisted codegraph subcommand via node's execFile. NEVER shell.
    // Structured interface so tests can drive a fake CLI through node cross-platform.
    runCodegraph({ executable, prefixArgs = [], subcommand, args = [], cwd,
                   timeoutMs = 15000, maxBytes = 8*1024*1024, allowNetwork = false, env }) => {
        // → { ok, code, stdout, stderr, timedOut, truncated, diagnostics:[{code,message}] }
    },
    ALLOWED_SUBCOMMANDS,  // Object.freeze(['status','files','query','callers','callees','impact','affected','explore','node','version','help'])
    stripAnsi(s),
    childEnv(baseEnv, callerEnv, allowNetwork),  // { ...baseEnv, ...callerEnv } then force Local-First LAST unless allowNetwork
    safeOperand(value),   // → { ok:true, value } | { ok:false, reason:'unsafe-argument' } for leading-dash operands when `--` unsupported
};
```
- Full argv = `[...prefixArgs, subcommand, ...args]`. Production: `executable='codegraph'`, `prefixArgs=[]`. Test: `executable=process.execPath`, `prefixArgs=[fakeCodegraphPath]` — so `execFile(process.execPath, [fakeCodegraphPath, subcommand, ...args])` runs the fake CLI under node (reliable on Windows; NOT relying on a `.js` being directly executable).
- `subcommand ∉` the private Set → `{ ok:false, diagnostics:[{code:'disallowed-subcommand'}] }` WITHOUT spawning.
- `execFile(executable, fullArgs, { cwd, timeout: timeoutMs, maxBuffer: maxBytes, env, shell:false, windowsHide:true })`. Timeout → child killed, `{ ok:false, timedOut:true, code:null, diagnostics:[{code:'command-timeout'}] }`. Output over maxBytes (execFile ENOBUFS) → `{ ok:false, truncated:true, diagnostics:[{code:'output-truncated'}] }` (never retain the full possibly-source-bearing blob). ANSI stripped from stdout/stderr. Never throws.
- `childEnv` fixed order: `const env = { ...baseEnv, ...(callerEnv||{}) }; if (!allowNetwork) { env.DO_NOT_TRACK='1'; env.CODEGRAPH_NO_UPDATE_CHECK='1'; } return env;` (caller can't override the forced values).

### `code-perception/providers/codegraph.js` (the adapter — stateful instance)
```js
module.exports = { create };   // create(options?) => Provider (id 'provider:codegraph')
// options (also readable from context.providerConfig at call time): { executable='codegraph', prefixArgs=[], timeoutMs=15000, allowNetwork=false }
// capabilities: files/symbols/source/callers/callees/impact/affectedTests = true;
//               modules = FALSE (upstream 1.4.1 fixture does not prove structured module membership — do not wrap the dir tree as a module capability; flip to true ONLY if cg-fixtures shows real module data);
//               semanticSearch/trace/flows/summaries/layers/tours/incrementalIndex = false. Build the full 15-key map from CAPABILITY_KEYS.
```
- Constants: `ADAPTER_VERSION='0.1.0'`, `MIN_PROVIDER_VERSION='1.0.0'`, `TESTED_PROVIDER_VERSIONS=['1.4.1']`, `COMPAT={min:'1.0.0',maxExclusive:'2.0.0'}`.
- `create()` returns a closure-scoped instance holding `const capabilityHealth = new Map()` (capability → { disabled:boolean, schemaFingerprint, diagnostic }). Lifecycle exactly per Global Constraints. `getStatus` reports a capability as false when `capabilityHealth.get(cap)?.disabled`; a subsequent successful parse re-enables; a providerVersion/schemaFingerprint change clears the map.
- `check(context)` → detection ladder (§2.1) via runCodegraph(version)+runCodegraph(help)+fingerprint. Returns `ProviderAvailability` (passes `validateAvailability`): missing exe → `{available:false,ready:false,installed:false,indexState:INDEX.MISSING,suggestedAction:'install @colbymchenry/codegraph@1.x'}`; installed but `status` no-index → `{available:true,ready:false,installed:true,indexState:INDEX.MISSING,suggestedAction:'run: codegraph init'}`; semver∉COMPAT OR help missing command set → `{available:false,ready:false,installed:true,reason:'codegraph identity/version mismatch',indexState:INDEX.UNKNOWN}` (identity disambiguation — no adapt-guess); valid → `{available:true,ready:true,installed:true,indexState:INDEX.READY,providerVersion}`. Never throws.
- `getStatus(context)` → `ProviderStatus` (passes `validateStatus`): fields from a fresh `status --json` via the STATUS translator; compatibility UNTESTED (in-range, providerVersion∉TESTED) / SUPPORTED (∈TESTED) / UNSUPPORTED (out of range); records `observedSchemaFingerprint`; capabilities map reflects `capabilityHealth`; diagnostics. Never throws.
- Query methods run the mapped command via runCodegraph, apply the EXPLICIT per-command translator, then normalize via ①:
  - `getFiles` → `{ provider, files:[{reference, moduleId:null, declaredByTaskIds:[], changed:false}], diagnostics }` (translator: upstream files row → normalizeReference raw). (moduleId stays null because modules=false.)
  - `search` → translator(query rows) → `normalizeSearchResult(status, {query, matches})`.
  - `getCallers`/`getCallees` → translator(rows) → `normalizeRelationship('provider:codegraph', src, tgt, 'called_by'|'calls', confidence)[]`.
  - `impact` → translator(impact json) → `normalizeImpactResult(status, {target, upstream, downstream, affectedTests, risk})`.
  - `getAffectedTests(context,{files})` → translator(affected json) → test CodeReferences; **independent of impact()**.
  - `getEntity(context,{entity})` → `{ reference, content /*opaque node text*/, truncated, diagnostics }`; only explicitly-marked file/line lifted into reference; no structural synthesis.
  - `explore(context,{query})` → `{ opaqueText, extracted:[{filePath?,lineRange?}], diagnostics }`; no edges.
  - A malformed response for capability X → that call returns an empty normalized shape + schema diagnostic AND disables X in `capabilityHealth`.
- **No `.codegraph` path is ever opened.**

### `code-perception/cache.js` (file-based, bounded, cross-process)
```js
module.exports = {
    makeCacheKey(parts) => string,   // sha256 of canonical {providerId,providerVersion,adapterVersion,snapshot,rootFingerprint,query}
    createCache({ root, ttlMs=300000, maxEntries=256, maxValueBytes=1*1024*1024, now }={}) => {
        get(key) => { hit, value?, storedAt?, stale? },        // MISS if absent/TTL-expired; hit returns value UNCHANGED
        set(key, value) => { stored:boolean, reason? },        // false + 'cache-value-too-large' when serialized > maxValueBytes; evicts oldest past maxEntries
        invalidateOn(reason) => void,                          // reasons: snapshot|head|dirty|adapter|config|ttl — clears matching/all
        markStale({ reason, currentCommit }) => void,          // flips entries' stored freshness marker to stale (does NOT delete) so a hit returns stale
        size() => number,
    },
};
```
- Persists entries as JSON files under `root` (default `path.join(projectRoot,'.evo-lite','.cache','code-perception')`) so the separate post-commit process can `markStale`/invalidate. `now` injected (default real clock passed by production; tests pass a fake) — no top-level `Date.now`. `MAX` values are the fixed constants above. A cache hit returns the stored value BYTE-IDENTICAL (a stale value stays stale; `markStale` sets a stale flag read back on `get`). Never store full graphs/unbounded source/secrets.

### `code-perception/governance-linker.js`
```js
module.exports = { buildGovernanceLinks(inputs) => { links: GovernanceCodeLink[], diagnostics: [] } };
// inputs = {
//   planIR,                         // provides task.linkedFiles (the ONLY per-task field Planning IR currently emits — verified against scan.js)
//   acceptanceDependencies?: [{ governanceEntityId, filePath, sourcePath }],  // EXPLICIT depends_on_file input (NOT auto-read from Markdown/AC — that is Planning-IR-v2 follow-up)
//   commits?: [{ sha, changedFiles:[...], diffRanges?:{ [file]:[[startLine,endLine],...] } }],
//   evidence?: [{ taskId, sourcePath?, symbols?:[...], archivePath? }],
//   activeContextFocus?: string,
//   providerFileRefs?: [{ taskId?, reference, symbolRanges?:[{ symbolRef, range:[s,e], filePath }] }],
// }
// GovernanceCodeLink = { id, governanceEntityId, codeReferenceId, kind, status, confidence, evidence:{sourcePath?,commitSha?,archivePath?,lineRange?} }
```
Kind mapping (fixed — no ambiguity):
- `task.linkedFiles` → `declares_file`, status `confirmed`, confidence `1.0`.
- `acceptanceDependencies[]` (explicit input) → `depends_on_file`, `confirmed`, `1.0`.
- `commit.changedFiles` → `changed_by_commit`, `1.0` (file). Symbol links use provider resolution confidence.
- Strong-evidence task→symbol/file → `implements_task`, status `derived`. A symbol link is emitted ONLY when a rule holds: Plan names the symbol / Evidence names the symbol / a commit `diffRange` intersects a `providerFileRefs` symbol range / a test/evidence references the symbol. **A file with symbols but no matching rule produces NO symbol link.**
- `verified_by_test` / `evidenced_by_archive` from `evidence[]`; `related_to_focus` from `activeContextFocus`.
- Heuristic (Task title ↔ symbol name fuzzy) → status `proposed`, `confidence <= 0.5`, never confirmed/derived.
- `id = 'gov-link:' + sha256(governanceEntityId + '|' + codeReferenceId + '|' + kind).slice(0,16)`; dedupe by id keeping the strongest (confirmed > derived > proposed). Never throws; missing inputs → `{links:[],diagnostics:[]}`.
- **NO guessing from Markdown text** — if a datum isn't in `planIR` or an explicit input, it is not linked (auto-extracting Spec-AC `dependsOn` / task `acceptance` into links is a Planning-IR-v2 follow-up, since neither is in the current IR).

### `code-perception/status.js`
```js
module.exports = { buildCodePerceptionStatus(context, { registrations, candidates, links }) => {
    providers:[{ id, role, available, ready, indexState, compatibility, degraded, reason? }],
    staleHints:[{ providerId, indexedCommit?, currentCommit?, message }],   // advises MANUAL codegraph sync; NEVER auto-runs
    links:{ confirmed, derived, proposed },
    diagnostics:[],
} };
```
Pure aggregation over router candidates + governance link summary; no subprocess; never throws. (This is the READ surface; the ACT surface — actually marking cache stale + refreshing links after a commit — is `post-commit-code-perception.js`.)

### `code-perception/post-commit-code-perception.js` (§5 integration — the ACT surface)
```js
module.exports = { runPostCommitCodePerception(context) => { report, diagnostics } };
// context = { projectRoot, headSha, changedFiles, cache }
```
On a commit: read new HEAD + changedFiles → refresh Native Lite file facts (call native-lite getFiles to recompute hashes) → `cache.markStale({reason:'head', currentCommit:headSha})` (+ invalidateOn('dirty') as needed) → rebuild commit/file governance links (buildGovernanceLinks with the new commit) → write a post-commit status blob → surface a MANUAL `codegraph sync` suggestion when index is stale. **NEVER auto-runs `codegraph sync`/`init`.** Wired into the existing hook chain (invoked from `hooks.js`'s post-commit path or a thin dispatch), guarded so a Provider failure never breaks the commit hook.

### `code-perception/dogfood-validate.js`
```js
module.exports = { validateDogfoodArtifact(text, { requireClosureEvidence = true } = {}) => { valid, findings:[{code,message}] } };
```
- Parses the artifact's metadata lines (`repoCommit`, `codegraphVersion`, `adapterVersion`, and when required `closureEvidenceCommit`) and its fenced `command`/`result` blocks. For each declared `fingerprint: sha256:<hex>`, **RE-COMPUTE** sha256 over the corresponding fenced block and compare — a mismatch is a `finding` (not just "a 64-hex string exists"). Requires the sections: status / search / callers-callees / impact / current-focus / Task-to-Code / stale-index / fallback / limitations. Missing field/section/fingerprint-mismatch → finding (valid:false). Pure; never throws.

### Fixtures (`templates/cli/test/fixtures/code-perception/`)
`codegraph-fixture-manifest.json` (provenance: upstream/package/providerVersion `1.4.1`/upstreamCommit/captureMethod per command/fixtureSha256/redactions), `codegraph-version.txt`, `codegraph-help.txt`, `codegraph-status.json`, `codegraph-files.json`, `codegraph-query.json`, `codegraph-callers.json`, `codegraph-callees.json`, `codegraph-impact.json`, `codegraph-affected.json`, `codegraph-malformed.json`, `codegraph-node.txt`, `codegraph-explore.txt`, `dogfood-sample.md`, `dogfood-bad.md`, and `fake-codegraph.js`. Every codegraph-* fixture is DERIVED from pinned `@colbymchenry/codegraph@1.4.1` (fetch the npm tarball / GitHub tag; read its `--json` output definitions from source/tests/docs) — `captureMethod:'pinned-upstream-source'`; where upstream source does not define a command's JSON shape, capture via a one-time real-CLI run recorded `captureMethod:'real-cli'`. Also determine at this step whether upstream honors the `--` positional separator (record it in the manifest — drives the exec option-injection strategy). `fake-codegraph.js` is a node script invoked as `node fake-codegraph.js <subcommand> [args]`: maps subcommand → prints the matching fixture to stdout, exits 0 (unknown → exit 2); on `--fake-sleep <ms>` it sleeps (timeout test); on `--fake-echo-env` it prints its env (network-boundary test) — **no new production subcommand like `env`; the echo is a test flag on an ALLOWED subcommand (`status --fake-echo-env`)**; resolves fixture paths relative to its own `__dirname` (no cwd dependence). Fixtures + fake-cli are manifest-registered test assets (for the mirror) but never enter production `DEFAULT_REGISTRY` selection.

### Loader wiring
Extend `DEFAULT_REGISTRY` (in `provider-loader.js`) with `'provider:codegraph': { role:'structural-primary', create: () => require('./providers/codegraph').create() }`. Config-gated: native-lite stays the only force-added entry, so `loadProviders()` with no config still returns only native-lite (① `T-cp-loader` assertion #1 unchanged). codegraph loads only when `config.codePerception.providers` selects it; `create()` is config-less (reads `context.providerConfig` at call time).

## Tasks

### Phase 2 — CodeGraph Adapter

- [ ] [task:cg-fixtures] pinned-upstream CodeGraph fixtures + provenance manifest + fake-cli (built FIRST so cg-exec/detect/queries have real data)
  - files: templates/cli/test/fixtures/code-perception/codegraph-fixture-manifest.json, codegraph-version.txt, codegraph-help.txt, codegraph-status.json, codegraph-files.json, codegraph-query.json, codegraph-callers.json, codegraph-callees.json, codegraph-impact.json, codegraph-affected.json, codegraph-malformed.json, codegraph-node.txt, codegraph-explore.txt, fake-codegraph.js, dogfood-sample.md, dogfood-bad.md
  - verify: node templates/cli/test.js governance
  - acceptance: fixtures DERIVED from pinned `@colbymchenry/codegraph@1.4.1` (fetch npm tarball / GitHub 1.4.1 tag; read real `--json` shapes from source/tests) — NOT invented; `codegraph-fixture-manifest.json` records upstream/package/providerVersion `1.4.1`/upstreamCommit/per-command captureMethod (`pinned-upstream-source`|`real-cli`)/fixtureSha256/redactions AND whether upstream honors the `--` separator; version.txt=`1.4.1` semver, help.txt lists all 9 commands; each JSON fixture is a real 1.4.1 shape; malformed.json is valid JSON with a wrong-typed field; node/explore .txt opaque with one marked `file:line`; `fake-codegraph.js` runs as `node fake-codegraph.js <subcommand>` → prints matching fixture (unknown→exit 2), supports `--fake-sleep <ms>` + `--fake-echo-env` on an ALLOWED subcommand, resolves paths via `__dirname`; dogfood-sample.md well-formed (all sections + recomputable fingerprints + repoCommit/version lines), dogfood-bad.md missing ≥1 section
  - test-first: governance.js「T-cg-fixtures」asserts manifest fields present + each `fixtureSha256` matches a recomputed sha of its file, every JSON fixture `JSON.parse`s, help.txt has all 9 commands, fake-codegraph resolves via __dirname; 红→绿
  - NOTE: fetching upstream is a network step; if the environment blocks it, record captureMethod + the blocking reason in the manifest and STOP (do not invent shapes) — this task is BLOCKED, not silently faked.

- [ ] [task:cg-exec] codegraph-exec.js: secure no-shell runner + `--` option-injection defense + env-order + output caps
  - files: templates/cli/code-perception/providers/codegraph-exec.js
  - verify: node templates/cli/test.js governance
  - acceptance: exports `runCodegraph`/`ALLOWED_SUBCOMMANDS` (frozen ARRAY)/`stripAnsi`/`childEnv`/`safeOperand`; `runCodegraph({executable,prefixArgs,subcommand,args,...})` builds argv `[...prefixArgs, subcommand, ...args]`, uses `execFile` `shell:false`, enforced timeout (kill child), maxBuffer=maxBytes; `subcommand` not in the private Set → `{ok:false,diagnostics:[{code:'disallowed-subcommand'}]}` WITHOUT spawn; timeout → `{ok:false,timedOut:true,code:null,'command-timeout'}`; oversize → `{ok:false,truncated:true,'output-truncated'}` (no full blob); ANSI stripped; `childEnv(base,caller,false)` yields DO_NOT_TRACK=1+CODEGRAPH_NO_UPDATE_CHECK=1 applied AFTER caller env (caller cannot override), `allowNetwork:true` omits them; `safeOperand('--help')`→`{ok:false,reason:'unsafe-argument'}` when manifest says `--` unsupported, else the query is passed after `--`; never throws
  - test-first: governance.js「T-cg-exec」drives `fake-codegraph.js` via `executable=process.execPath, prefixArgs=[fakeCodegraphPath]`; asserts a `status` call echoes the fixture; disallowed-subcommand rejection (no spawn); timeout kill via `--fake-sleep`; env injection via `status --fake-echo-env` (assert DO_NOT_TRACK present, and that a caller env `DO_NOT_TRACK=0` is OVERRIDDEN back to 1); option-injection: a `query="--help"` operand is passed after `--` (or rejected) and the fake never prints help; 红→绿

- [ ] [task:cg-detect] codegraph.js check()/getStatus: detection ladder + fingerprint identity lock + version compat + capabilityHealth
  - files: templates/cli/code-perception/providers/codegraph.js
  - verify: node templates/cli/test.js governance
  - acceptance: `create()` returns a provider passing `validateProvider` (15-key caps: files/symbols/source/callers/callees/impact/affectedTests=true, modules=FALSE, rest false; methods check/getStatus/getFiles/search/getEntity/getCallers/getCallees/impact/getAffectedTests/explore present); instance holds `capabilityHealth` Map; `check` fingerprints via runCodegraph(version)+ (help) — semver∉[1.0.0,2.0.0) OR help missing command set → available:false + identity/version-mismatch reason (no adapt-guess); missing exe → installed:false/MISSING/install hint; installed+no-index → ready:false/MISSING/`codegraph init` hint; valid → ready/READY/providerVersion; `getStatus` passes `validateStatus`, compatibility UNTESTED/SUPPORTED/UNSUPPORTED correctly, records observedSchemaFingerprint, reflects capabilityHealth; both never throw; Local-First env injected by default
  - test-first: governance.js「T-cg-detect」via fake-cli: valid fingerprint→ready; wrong-help fixture→identity mismatch available:false; `0.9.0`/`2.1.0`→UNSUPPORTED/reject; missing-exe→installed:false; 红→绿

- [ ] [task:cg-queries] codegraph.js query methods: exact command mapping + per-command translators → ① normalize + opaque explore/node + per-capability disable
  - files: templates/cli/code-perception/providers/codegraph.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: getFiles/search/getCallers/getCallees/impact/getAffectedTests run the exact mapped command (args array, operands after `--` per manifest), apply an EXPLICIT per-command translator (upstream row → normalize raw input; documented field-by-field, NOT "raw→normalize"), return ①-normalized shapes with `code-ref:provider:codegraph:…` ids; parsing rule honored (ignore unknown, preserve entity id, degrade on missing, diagnostic on bad schema, no fail on new fields); getFiles moduleId stays null (modules=false); getEntity(`node`)+explore(`explore`) OPAQUE (assert NO `kind:'calls'` synthesized from prose); affectedTests independent of impact; a malformed response for one capability → empty normalized shape + schema diagnostic + `capabilityHealth` disables THAT capability (getStatus shows it false), others unaffected; a later good parse re-enables it; **no `.codegraph` path opened** (grep-assert)
  - test-first: governance.js「T-cg-queries」drives fake-cli; asserts translators produce unified shapes with provider-scoped ids, opaque explore/node, malformed→single-capability-disable-then-re-enable, and grep the module has zero `.codegraph` references; 红→绿

- [ ] [task:cg-loader-register] register provider:codegraph in DEFAULT_REGISTRY (config-gated, structural-primary)
  - files: templates/cli/code-perception/provider-loader.js
  - verify: node templates/cli/test.js governance
  - acceptance: `DEFAULT_REGISTRY` gains `'provider:codegraph': { role:'structural-primary', create: () => require('./providers/codegraph').create() }`; native-lite remains the only force-added entry so `loadProviders()` (no config) still returns exactly native-lite (① `T-cp-loader` assertion #1 unchanged + green); config-selected codegraph returns a registration (role structural-primary, source configured) + native-lite; broken codegraph create isolates per ① loader contract
  - test-first: governance.js「T-cg-loader-register」asserts default still native-lite-only, config-selected codegraph present (role/source), native-lite still present; re-run `T-cp-loader` to confirm no ① regression; 红→绿

- [ ] [task:cg-cache] cache.js: file-based bounded cache + fingerprint key + TTL/invalidation/markStale + stale-not-fresh
  - files: templates/cli/code-perception/cache.js
  - verify: node templates/cli/test.js governance
  - acceptance: `makeCacheKey` sha256 over canonical {providerId,providerVersion,adapterVersion,snapshot,rootFingerprint,query}; `createCache({root,ttlMs,maxEntries=256,maxValueBytes=1MiB,now})` persists entries as files under `root` (default `.evo-lite/.cache/code-perception/`), INJECTED clock (no top-level Date.now); get MISS on absent/TTL-expired; set → `{stored:false,reason:'cache-value-too-large'}` when serialized > maxValueBytes, evicts oldest beyond maxEntries; `invalidateOn('head'|'snapshot'|'dirty'|'adapter'|'config')` clears; `markStale({reason,currentCommit})` flips stored freshness to stale WITHOUT delete; **a hit returns the stored value byte-identical and a stale value stays stale (never rewritten fresh)**; never throws
  - test-first: governance.js「T-cg-cache」asserts key sensitivity, file persistence across two createCache instances (same root), TTL expiry via injected clock, too-large rejection, markStale→get returns stale, invalidateOn clears; 红→绿

- [ ] [task:cg-status] status.js: code-perception status surface + stale hints (read-only, no auto-sync)
  - files: templates/cli/code-perception/status.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildCodePerceptionStatus(context,{registrations,candidates,links})` pure-aggregates candidates into `providers[]`, emits `staleHints[]` (indexedCommit≠currentCommit → MANUAL `codegraph sync` message, NEVER auto-run/spawn), and a `links` summary `{confirmed,derived,proposed}`; no subprocess; never throws
  - test-first: governance.js「T-cg-status」feeds hand-built candidates (codegraph stale + native-lite ready) + a links summary → asserts staleHint manual-sync message, no spawn, correct degraded flags + link counts; 红→绿

- [ ] [task:cg-post-commit] post-commit-code-perception.js: §5 integration (refresh native-lite facts + markStale + rebuild links + suggest manual sync)
  - files: templates/cli/code-perception/post-commit-code-perception.js, templates/cli/hooks.js (wire into post-commit path, guarded)
  - verify: node templates/cli/test.js governance
  - acceptance: `runPostCommitCodePerception({projectRoot,headSha,changedFiles,cache})` refreshes Native Lite file facts (recompute via native-lite getFiles), calls `cache.markStale({reason:'head',currentCommit:headSha})`, rebuilds commit/file governance links (buildGovernanceLinks with the new commit), writes a post-commit status blob, and surfaces a MANUAL sync suggestion when index stale; **NEVER runs `codegraph sync`/`init`** (grep-assert no such spawn); wired into hooks.js post-commit GUARDED so a Provider failure never fails the commit; existing hook tests stay green
  - test-first: governance.js「T-cg-post-commit」builds a temp repo (createTempRuntimeRoot) + a file cache with a codegraph entry → runs the post-commit fn → asserts cache entry now stale, links rebuilt for the changed file, a manual-sync suggestion present, and NO codegraph subprocess spawned; assert an injected Provider failure does not throw out of the hook path; 红→绿

### Phase 3 — Governance Linker

- [ ] [task:cg-linker-exact] governance-linker.js: exact declared + explicit-dependency + git-derived file links (confidence 1.0)
  - files: templates/cli/code-perception/governance-linker.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildGovernanceLinks(inputs)` emits `declares_file` from `planIR` task.linkedFiles (confirmed, 1.0), `depends_on_file` from the EXPLICIT `acceptanceDependencies` input (confirmed, 1.0), `changed_by_commit` from `commit.changedFiles` (file, 1.0); each link has `evidence.sourcePath`/`commitSha`; stable `id=gov-link:<16hex>`; dedupe by id; never throws; empty inputs → `{links:[],diagnostics:[]}`; **does NOT read acceptance/dependsOn from Markdown or the IR (neither is present — verified against scan.js); only the explicit input is used**
  - test-first: governance.js「T-cg-linker-exact」builds a small planIR (task+linkedFiles), an acceptanceDependencies array, and one commit → asserts the three kinds at confidence 1.0 with correct evidence, and that a task with linkedFiles but NO acceptanceDependencies produces NO depends_on_file link; 红→绿

- [ ] [task:cg-linker-symbol] governance-linker.js: symbol links via diff-range∩provider-range + evidence/focus links
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: symbol links (status derived) emitted ONLY when a rule holds — Plan names the symbol / Evidence names the symbol / a commit `diffRange` intersects a `providerFileRefs` symbol range / a test/evidence references the symbol; **a file with symbols but no matching rule → NO symbol link (assert the negative)**; `verified_by_test`/`evidenced_by_archive` from `evidence[]`; `related_to_focus` from `activeContextFocus`; provider-resolved symbol confidence = the provider reference's resolution confidence
  - test-first: governance.js「T-cg-linker-symbol」a commit diffRange intersecting exactly one of two provider symbol ranges → asserts only the intersecting symbol gets a derived link, the other does NOT; an evidence-named symbol link present; 红→绿

- [ ] [task:cg-linker-heuristic] governance-linker.js: heuristic proposals (≤0.5) + stored graph assembly + dedupe
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: name-only fuzzy Task-title↔symbol matches → `status:'proposed'`, `confidence<=0.5`, never confirmed/derived; every `GovernanceCodeLink` validates (id/governanceEntityId/codeReferenceId/kind∈7/status∈{confirmed,derived,proposed}/confidence/evidence); dedupe keeps the strongest per id (confirmed>derived>proposed); diagnostics for dropped/ambiguous heuristics
  - test-first: governance.js「T-cg-linker-heuristic」asserts a fuzzy match is proposed≤0.5, an exact link for the same pair supersedes a proposed one on dedupe, all links pass a shape check; 红→绿

- [ ] [task:cg-failure-isolation] failure isolation across adapter+cache+linker (missing/not-indexed/timeout/schema-drift/stale)
  - files: templates/cli/code-perception/providers/codegraph.js (harden), templates/cli/code-perception/cache.js (harden)
  - verify: node templates/cli/test.js governance
  - acceptance: with codegraph missing/timeout/malformed, ①'s loader+router still return Native Lite for `files` (degraded) and `candidate:null`+ready-centric reason for `impact`; Planning IR / Architecture IR / memory / verify untouched (assert none written); timeout → child killed + diagnostic + request degraded + provider NOT permanently disabled (a subsequent healthy call succeeds); schema drift → single capability disabled (others live) then re-enabled on good parse; stale index → results returned but `freshness:'stale'` + indexedCommit/currentCommit (never fresh); diagnostics truncated (no large source blobs)
  - test-first: governance.js「T-cg-failure-isolation」drives fake-cli in timeout/malformed/stale modes through the ① loader+router with codegraph config-selected; asserts fallback, exact no-substitution reason, non-permanent disable, stale visibility, no governance-artifact writes; 红→绿

- [ ] [task:cg-dogfood-validate] dogfood-validate.js: artifact validator (fields + RECOMPUTED fingerprints + sections + closure evidence)
  - files: templates/cli/code-perception/dogfood-validate.js
  - verify: node templates/cli/test.js governance
  - acceptance: `validateDogfoodArtifact(text,{requireClosureEvidence})` returns valid:true for `dogfood-sample.md` (metadata repoCommit/codegraphVersion/adapterVersion; each declared `fingerprint: sha256:<hex>` RE-COMPUTED over its fenced command/result block and matching; all sections status/search/callers-callees/impact/current-focus/Task-to-Code/stale-index/fallback/limitations) and valid:false with specific findings for `dogfood-bad.md` (missing section), for a tampered fingerprint (recompute mismatch), and for a missing `closureEvidenceCommit:` when required; pure; never throws
  - test-first: governance.js「T-cg-dogfood-validate」runs the validator on the two committed samples (accept good, reject bad), a fingerprint-tampered copy (reject with fingerprint-mismatch finding), and a no-closure-evidence case; 红→绿

- [ ] [task:cg-manifest-sync] register all new files in manifest + mirror sync + full regression
  - files: templates/cli/template-manifest.js, .evo-lite/cli/code-perception/
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: manifest core-cli gains all new PRODUCTION modules (providers/codegraph-exec.js, providers/codegraph.js, cache.js, status.js, governance-linker.js, post-commit-code-perception.js, dogfood-validate.js) AND all new TEST assets (codegraph-fixture-manifest.json + 12 codegraph-* fixtures + fake-codegraph.js + dogfood-sample.md + dogfood-bad.md); sync-runtime converges to two consecutive `copied:0` (may take 3 runs — mirror reads its own manifest, per ①'s cp-manifest-sync); every new file byte-identical template↔mirror; `node ./.evo-lite/cli/test.js governance` (runtime) green with all T-cg-* + T-cp-* sections; `node templates/cli/test.js governance` (template) green; no other governance regression
  - (no separate unit test — sync double-run-zero + byte-identical + both suites green IS the acceptance)

- [ ] [task:cg-live-dogfood] host-gated real CodeGraph run → committed dogfood artifact (closes ac-live-codegraph-dogfood; NOT in normal CI, but IN plan completion)
  - files: docs/code-perception-codegraph-dogfood.md
  - verify: node -e "const {validateDogfoodArtifact}=require('./templates/cli/code-perception/dogfood-validate'); const fs=require('fs'); const r=validateDogfoodArtifact(fs.readFileSync('docs/code-perception-codegraph-dogfood.md','utf8'),{requireClosureEvidence:true}); if(!r.valid){console.error(r.findings);process.exit(1)} console.log('dogfood valid')"
  - acceptance: on a host with `@colbymchenry/codegraph@1.4.1` installed (`npm i -g @colbymchenry/codegraph@1.4.1`; `codegraph init` on create-evo-lite), capture a REAL run through the shipped adapter and write `docs/code-perception-codegraph-dogfood.md` with: metadata `repoCommit:<implementation HEAD being tested>`, `codegraphVersion`, `adapterVersion`, `closureEvidenceCommit:<same already-existing implementation HEAD>` (two-step protocol — a commit cannot reference its own SHA: the artifact points at the PRIOR implementation HEAD it was run against, then this artifact is committed separately); fenced command/result blocks each with a `fingerprint: sha256:<hex>` that `dogfood-validate` RE-COMPUTES; all sections status/search/callers-callees/impact/current-focus/Task-to-Code/stale-index/fallback/limitations; `validateDogfoodArtifact(...,{requireClosureEvidence:true}).valid===true`
  - HOST-GATE: if `@colbymchenry/codegraph@1.4.1` cannot be installed/run on the host, leave this task UNCHECKED — the plan + spec honestly stay `active` and `ac-live-codegraph-dogfood` stays open until a capable host runs it. Do NOT fake the artifact. Record the capability gate reason.

## Follow-ups (OUTSIDE this plan)

- **Planning IR v2 — auto-extract acceptance dependencies:** teach `scan.js` to emit each task's `acceptance`/`dependsOn` into the Planning IR (and the spec-AC `dependsOn` into the spec data model) so the linker can derive `depends_on_file` without the explicit `acceptanceDependencies` input. Until then the linker requires the explicit input (this plan).
- **UA / GitNexus adapters** (§1 explicitly deferred): additional structural providers behind the same contract.

## Self-Review

**Spec coverage:** §2.0 identity → cg-detect fingerprint. §2.1 detection → cg-detect ladder. §2.2 command mapping → cg-queries (exact args + `--`). §2.3 parsing rule + opaque → cg-queries. §2.4 version compat + per-capability disable (lifecycle) → cg-detect + cg-queries. §2.5 security → cg-exec (no-shell/args/`--`/timeout/caps/ANSI) + cg-queries (no .codegraph). §2.6 network boundary (fixed merge order) → cg-exec childEnv. §3 linker (kinds/confidence/graph, explicit inputs) → cg-linker-exact/symbol/heuristic. §4 cache (file-based, fixed caps, stale-not-fresh, markStale) → cg-cache. §5 post-commit (act surface) → cg-post-commit; status read surface → cg-status. §6 failure isolation → cg-failure-isolation. §7 fixtures (pinned provenance) + dogfood validator (recompute) + live run → cg-fixtures + cg-dogfood-validate + cg-live-dogfood. §8 layout (all 7 prod files) → cg-manifest-sync. §9 phases → Phase 2 (cg-fixtures…cg-post-commit) / Phase 3 (cg-linker-*…cg-live-dogfood). AC ac-codegraph-adapter → cg-exec/cg-queries (dependsOn now includes codegraph-exec.js); ac-governance-linker → cg-linker-*; ac-provider-failure-isolation → cg-failure-isolation; ac-live-codegraph-dogfood → cg-dogfood-validate (validator) + cg-live-dogfood (real run, in-plan host-gated). No AC left structurally unclosable: cg-live-dogfood keeps the spec honestly active until a capable host runs it.

**Type consistency:** provider methods/capabilities match ①'s `validateProvider`/`CAPABILITY_METHOD` (modules=false, no method required for a false capability); normalize calls use shipped signatures via explicit translators; DEFAULT_REGISTRY entry shape matches ①'s `{role,create}`; GovernanceCodeLink shape matches spec §3.4; cache clock injected (no top-level Date.now); linker inputs use only data proven present in the IR (task.linkedFiles) plus explicit inputs.
