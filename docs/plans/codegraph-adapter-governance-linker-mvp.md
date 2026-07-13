---
id: plan:codegraph-adapter-governance-linker-mvp
linkedSpec: spec:codegraph-adapter-governance-linker
status: draft
created: 2026-07-13
---

# CodeGraph Adapter & Governance Linker — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real structural Provider (`provider:codegraph`, a fingerprint-locked CodeGraph CLI adapter) plus the Governance Linker that turns code facts into Task/Commit/Evidence links — Evo-Lite's Task-to-Code differentiation — with a local cache, status surface, failure isolation, and a fixture-based dogfood validator.

**Architecture:** The adapter implements sub-spec ①'s `CodePerceptionProvider` contract and is driven entirely through a secure `execFile` runner (no shell); JSON command output is normalized through ①'s `normalize.js`; `explore`/`node` output is opaque text. The Governance Linker consumes Planning/Architecture IR + Git + Evidence + Provider references to emit confidence-graded `GovernanceCodeLink`s. A local cache stores normalized results keyed by provider+snapshot fingerprints and never rewrites stale as fresh. The live CodeGraph run is a host-gated follow-up OUTSIDE this plan's completion — this plan builds and tests everything against committed fixtures.

**Tech Stack:** Node CommonJS, zero new deps (node builtins: child_process/crypto/fs/path), 4-space indent. Consumes shipped sub-spec ① modules under `templates/cli/code-perception/`.

## Global Constraints (binding — verbatim from spec; every task inherits these)

- **Upstream identity locked** to `colbymchenry/codegraph` (package `@colbymchenry/codegraph`, provider id `provider:codegraph`, compat `>=1.0.0 <2.0.0`, MIT). NOT `optave/ops-codegraph-tool`. `check()` must fingerprint identity (semver in range + `help` contains command set `status/files/query/explore/node/callers/callees/impact/affected` + output shape) — never trust the bare executable name.
- **Command mapping (exact):** status→`status <root> --json`, files→`files <root> --json`, search→`query <query> --json`, callers→`callers <symbol> --json`, callees→`callees <symbol> --json`, impact→`impact <symbol> --json`, affectedTests→`affected [files...] --json`, explore→`explore <query>` (opaque), entity source→`node <entity>` (opaque).
- **Execution security:** single executable; `spawn`/`execFile` with **no `shell:true`**; args as an array; explicit project-root argument; enforced timeout (kill child on expiry); stdout/stderr byte caps; strip ANSI; NEVER execute a command found in Provider output.
- **Network boundary (Local-First default):** inject `DO_NOT_TRACK=1` and `CODEGRAPH_NO_UPDATE_CHECK=1` into the child env by default; only omit when the caller's config explicitly allows external network behavior.
- **No direct DB coupling:** never open/execute `.codegraph` internal DB/SQL, never depend on undocumented table structure, never modify `.codegraph`.
- **JSON parsing rule:** validate JSON type, ignore unknown fields, preserve original provider entity id, degrade on missing fields, emit a diagnostic on bad schema, never fail on newly-added fields. `explore`/`node` output is **opaque text** — may extract explicitly-marked file/line metadata but MUST NOT synthesize structural edges from natural language, and MUST NOT override JSON structural results.
- **Version compatibility:** store `adapterVersion`/`providerVersion`/`observedSchemaFingerprint`; declare `minimumProviderVersion`/`testedProviderVersions`; unknown version → attempt compatible parse, mark `compatibility=untested`, don't block read-only queries, and on schema-validation failure **disable that one capability, not the whole provider**.
- **Cache:** never rewrite a stale result as fresh (results keep their original freshness); invalidate on snapshot/HEAD/dirty-hash/adapterVersion/config change or TTL.
- **Failure isolation:** provider missing/not-indexed/timeout/malformed/unsupported-version must NOT break Planning IR, Architecture IR, memory, or verify; Native Lite stays available; never auto-run `codegraph sync`/`init`; truncate diagnostics that could contain source.
- **Uses sub-spec ① (shipped, do NOT modify its contracts):** `require('../provider-contract')` → `{ FRESHNESS, DIRTY, COMPAT, INDEX, CAPABILITY_KEYS, validateProvider/validateAvailability/validateStatus }`; `require('../normalize')` → `{ makeReferenceId, normalizeReference, normalizeSearchResult, normalizeRelationship, normalizeImpactResult }`; `require('../provider-loader')` → `{ DEFAULT_REGISTRY, loadProviders }`; `require('../provider-router')` → `{ inspectProviders, selectProvider }`.
- CommonJS, `'use strict'`, zero new deps, 4-space indent, style like sibling `code-perception/*.js`. New production files registered in `template-manifest.js` core-cli family; `sync-runtime` double-run-zero; `.evo-lite/cli` mirror byte-identical; `node ./.evo-lite/cli/test.js governance` green throughout; no existing plan-closure regression.
- **Live CodeGraph run is a follow-up, NOT in this plan's completion.** Every task here is deterministic + fixture-based + CI-safe. `ac-live-codegraph-dogfood` closes later via the host-gated follow-up (§ Follow-ups).

## Design Notes (implementer contracts — read before your task)

### `code-perception/providers/codegraph-exec.js` (secure command runner — the security seam)
```js
module.exports = {
    // Runs one allowlisted codegraph subcommand. NEVER shell. Returns a structured
    // result; never throws (spawn error/timeout/oversize → diagnostics + ok:false).
    runCodegraph(spec) => {
        // spec = { executable, args:[...], cwd, timeoutMs=15000, maxBytes=8*1024*1024, allowNetwork=false, env? }
        // → { ok:boolean, code:number|null, stdout:string, stderr:string, timedOut:boolean,
        //     truncated:boolean, diagnostics:[{code,message}] }
    },
    ALLOWED_SUBCOMMANDS,   // frozen Set: status,files,query,callers,callees,impact,affected,explore,node,version,help
    stripAnsi(s),          // remove ANSI escape sequences
    childEnv(base, allowNetwork),  // returns env with DO_NOT_TRACK=1 + CODEGRAPH_NO_UPDATE_CHECK=1 unless allowNetwork
};
```
- Uses `child_process.execFile(executable, args, { cwd, timeout, maxBuffer, env, shell:false, windowsHide:true })`. `args[0]` MUST be in `ALLOWED_SUBCOMMANDS` else `{ok:false, diagnostics:[{code:'disallowed-subcommand'}]}` (defense in depth — never spawn an unlisted subcommand).
- Timeout → kill child, `timedOut:true`, `code:null`, diagnostic `command-timeout`. Output over `maxBytes` → `truncated:true` + diagnostic `output-truncated` (truncate; do NOT keep the full possibly-source-bearing blob). Strip ANSI from stdout/stderr before returning. Never `shell:true`; args always an array.

### `code-perception/providers/codegraph.js` (the adapter)
```js
module.exports = { create };   // create(options?) => Provider (id 'provider:codegraph')
// options (all optional; also readable from context.providerConfig at call time):
//   { executable='codegraph', timeoutMs=15000, allowNetwork=false }
// capabilities: files/symbols/source/callers/callees/impact/affectedTests/modules = true;
//               semanticSearch = false; trace/flows/summaries/layers/tours = false (explore is opaque, not structured);
//               incrementalIndex = false. (Build the full 15-key map from CAPABILITY_KEYS.)
```
- `ADAPTER_VERSION='0.1.0'`, `MIN_PROVIDER_VERSION='1.0.0'`, `TESTED_PROVIDER_VERSIONS=['1.4.1']`, `COMPAT_RANGE={min:'1.0.0',maxExclusive:'2.0.0'}`.
- `check(context)` → detection ladder (§2.1): resolve executable (context/options → PATH) → run `version` → run `help` → fingerprint. Returns `ProviderAvailability` passing `validateAvailability`: `{ available, ready, installed, indexState, providerVersion?, executable?, reason?, suggestedAction? }`. Missing exe → `{available:false, ready:false, installed:false, indexState:INDEX.MISSING, suggestedAction:'install @colbymchenry/codegraph'}`. Installed, `status` fails/no index → `{available:true, ready:false, installed:true, indexState:INDEX.MISSING, suggestedAction:'run: codegraph init'}`. Version out of `COMPAT_RANGE` or help missing the command set → `{available:false, ready:false, installed:true, reason:'codegraph identity/version mismatch', indexState:INDEX.UNKNOWN}` (**identity disambiguation — do not adapt-guess**). Valid → `{available:true, ready:true, installed:true, indexState:INDEX.READY, providerVersion}`. Never throws.
- `getStatus(context)` → `ProviderStatus` passing `validateStatus`: providerId, adapterVersion, providerVersion?, available/ready/indexState from a fresh `status --json`, indexedCommit/currentCommit when present, dirty/freshness/compatibility (compatibility=UNTESTED when providerVersion∉TESTED_PROVIDER_VERSIONS but in range; UNSUPPORTED when out of range), `observedSchemaFingerprint` recorded, capabilities map (a capability whose schema failed validation this call is downgraded to false — per-capability disable), diagnostics.
- Query methods (each runs the mapped command via `runCodegraph`, parses JSON per the parsing rule, normalizes via ①'s normalize, never throws — a failure returns an empty normalized shape + diagnostics):
  - `getFiles(context, query)` → `{ provider: getStatus(...), files:[{reference, moduleId:null, declaredByTaskIds:[], changed:false}], diagnostics }` (codegraph files → CodeReferences via `normalizeReference('provider:codegraph', raw)`).
  - `search(context, q)` → `normalizeSearchResult(status, rawFromQueryJson)`.
  - `getCallers(context, ref)` / `getCallees(context, ref)` → array of `normalizeRelationship('provider:codegraph', src, tgt, kind, confidence)` (kind `called_by`/`calls`).
  - `impact(context, ref)` → `normalizeImpactResult(status, rawFromImpactJson)` (upstream/downstream/affectedTests as CodeReferences).
  - `getAffectedTests(context, {files})` → array of test CodeReferences (via `affected` command); **independent of impact()** (do not fold into impact).
  - `getEntity(context, {entity})` → `{ reference, content, truncated, diagnostics }` where content is OPAQUE text from `node <entity>` (may carry extracted file/line in reference; no structural synthesis).
  - `explore(context, {query})` → `{ opaqueText, extracted:[{filePath?, lineRange?}], diagnostics }` — opaque; MUST NOT produce structural edges.
- **No `.codegraph` access anywhere.** All data comes from CLI stdout only.

### `code-perception/cache.js`
```js
module.exports = {
    makeCacheKey(parts) => string,  // sha256 of canonical {providerId,providerVersion,adapterVersion,snapshot,rootFingerprint,query}
    createCache({ ttlMs=300000, now }={}) => {
        get(key) => { hit:boolean, value?, storedAt? },     // MISS if absent or TTL-expired
        set(key, value) => void,                             // value stored verbatim (keeps its freshness)
        invalidateOn(reason) => void,                        // clears entries; reasons: snapshot|head|dirty|adapter|config|ttl
        size() => number,
    },
};
```
- In-memory Map keyed by `makeCacheKey`. `now` is injectable (default `() => Date.now()` — but the module must accept an injected clock so tests are deterministic; production callers pass a real clock). **A cache hit returns the stored value UNCHANGED — never mutate a stale freshness to fresh.** Do NOT cache full graphs, unbounded source, secrets. (`now` injection is why `Date.now` isn't called at module top-level.)

### `code-perception/governance-linker.js`
```js
module.exports = {
    buildGovernanceLinks(inputs) => { links: GovernanceCodeLink[], diagnostics: [] },
};
// inputs = { planIR, architectureIR, activeContext, commits:[{sha, changedFiles:[...], diffRanges?:{file:[[s,e],...]}}],
//            evidence:[{taskId, sourcePath?, symbols?:[...], archivePath?}], providerSearch?, providerFileRefs? }
// GovernanceCodeLink = { id, governanceEntityId, codeReferenceId, kind, status, confidence, evidence:{sourcePath?,commitSha?,archivePath?,lineRange?} }
```
Link kinds + rules (§3.2–3.3, exact):
- `declares_file` / `depends_on_file` / `implements_task` from Task `linkedFiles` / acceptance `dependsOn` → `status:'confirmed'`, `confidence:1.0`.
- `changed_by_commit` from commit changed files → `confidence:1.0` for file links; symbol links use provider resolution confidence.
- Provider-resolved symbol links (linked file → provider file entity → symbols): **do NOT link every symbol in a file to the task.** Emit a symbol link ONLY when one holds: Plan explicitly names the symbol / Evidence explicitly names the symbol / a commit diff line-range intersects the provider symbol range / a test/evidence explicitly references the symbol → `status:'derived'`.
- `verified_by_test` / `evidenced_by_archive` from evidence records; `related_to_focus` from Active Context focus.
- Heuristic (Task title ↔ symbol name fuzzy match): `status:'proposed'`, `confidence <= 0.5`, `authority governance` — NEVER shown as a confirmed implementation link.
- `id = 'gov-link:' + sha256(governanceEntityId + '|' + codeReferenceId + '|' + kind).slice(0,16)`; dedupe by id (highest-confidence/most-confirmed wins).

### `code-perception/status.js`
```js
module.exports = {
    buildCodePerceptionStatus(context, { registrations, candidates }) => {
        providers:[{ id, role, available, ready, indexState, compatibility, degraded, reason? }],
        staleHints:[{ providerId, indexedCommit?, currentCommit?, message }],   // §5 post-commit: index stale → advise manual sync, never auto-run
        links:{ confirmed:number, derived:number, proposed:number },
        diagnostics:[],
    },
};
```
- Pure aggregation over router candidates + governance link summary. Surfaces degradation + stale hints (the post-commit §5 face: detect stale index → advise `codegraph sync` manually; NEVER auto-run). No subprocess of its own.

### `code-perception/dogfood-validate.js`
```js
module.exports = {
    validateDogfoodArtifact(text, { requireClosureEvidence=true }={}) => { valid:boolean, findings:[{code,message}] },
};
```
- Asserts the committed dogfood artifact (§7) has: front-line metadata `repoCommit`, `codegraphVersion`, `adapterVersion`; captured **command/result fingerprints** (sha256 lines); and the required sections: status / search / callers-callees / impact / current-focus / Task-to-Code / stale-index / fallback / limitations. `requireClosureEvidence` → also require a `closureEvidenceCommit:` line. Missing field/section → a `finding` (valid:false). Pure text validation; never throws. (This proves the VALIDATOR; the real artifact is produced by the host-gated live run in Follow-ups.)

### Fixtures (committed test assets — `templates/cli/test/fixtures/code-perception/`)
`codegraph-version.txt`, `codegraph-help.txt` (fingerprint inputs), `codegraph-status.json`, `codegraph-files.json`, `codegraph-query.json`, `codegraph-callers.json`, `codegraph-callees.json`, `codegraph-impact.json`, `codegraph-affected.json`, `codegraph-malformed.json` (bad schema), `codegraph-node.txt` / `codegraph-explore.txt` (opaque), `dogfood-sample.md` (well-formed artifact) + `dogfood-bad.md` (missing sections). A tiny **fake-codegraph** harness (`fake-codegraph.js`) that, given a subcommand, echoes the matching fixture to stdout — lets exec/adapter tests drive real `execFile` without installing CodeGraph. Fixtures + fake-cli are test assets (registered in manifest for the mirror, per ①'s lesson) but NEVER in production `DEFAULT_REGISTRY` selection paths.

### Loader wiring
Extend `DEFAULT_REGISTRY` (in `provider-loader.js`) with `'provider:codegraph': { role: 'structural-primary', create: () => require('./providers/codegraph').create() }`. It is **config-gated**: native-lite stays the only force-added entry, so `loadProviders()` with no config still returns only native-lite (① `T-cp-loader` assertion #1 stays green). codegraph is instantiated only when `config.codePerception.providers` selects it; `create()` is config-less (reads `context.providerConfig` at call time), matching native-lite.

## Tasks

### Phase 2 — CodeGraph Adapter

- [ ] [task:cg-exec] codegraph-exec.js: secure no-shell command runner + network-boundary env + output caps
  - files: templates/cli/code-perception/providers/codegraph-exec.js
  - verify: node templates/cli/test.js governance
  - acceptance: exports `runCodegraph`/`ALLOWED_SUBCOMMANDS`/`stripAnsi`/`childEnv`; `runCodegraph` uses `execFile` with `shell:false`, args array, `cwd`, enforced `timeout` (kill child), `maxBuffer`=maxBytes; `args[0]∉ALLOWED_SUBCOMMANDS` → `{ok:false, diagnostics:[{code:'disallowed-subcommand'}]}` without spawning; timeout → `{ok:false,timedOut:true,code:null,diagnostics:[{code:'command-timeout'}]}`; over-size output → `truncated:true` + `output-truncated` diagnostic (no full blob retained); ANSI stripped from stdout/stderr; `childEnv(base,false)` sets `DO_NOT_TRACK=1`+`CODEGRAPH_NO_UPDATE_CHECK=1`, `childEnv(base,true)` leaves them unset; never throws
  - test-first: governance.js「T-cg-exec」drives the committed `fake-codegraph.js` via real execFile (echo fixture), asserts no-shell (a subcommand containing shell metachars like `; rm` is passed as a literal arg, never interpreted), disallowed-subcommand rejection, timeout kill (fake sleeps), truncation, and env injection (fake prints its env); guard-skip nothing — fake-cli is committed; 红→绿

- [ ] [task:cg-fixtures] committed CodeGraph fixtures + fake-cli harness
  - files: templates/cli/test/fixtures/code-perception/codegraph-version.txt, codegraph-help.txt, codegraph-status.json, codegraph-files.json, codegraph-query.json, codegraph-callers.json, codegraph-callees.json, codegraph-impact.json, codegraph-affected.json, codegraph-malformed.json, codegraph-node.txt, codegraph-explore.txt, fake-codegraph.js, dogfood-sample.md, dogfood-bad.md
  - verify: node templates/cli/test.js governance
  - acceptance: version.txt holds a `1.4.1` semver line; help.txt lists the full command set `status/files/query/explore/node/callers/callees/impact/affected`; each JSON fixture is a realistic `colbymchenry/codegraph --json` shape (status: index/commit fields; files: file list with provider entity ids + paths; query: matches with entity id/name/path/range; callers/callees: relationship rows; impact: upstream/downstream/affectedTests; affected: test file list); malformed.json is valid JSON with a wrong-typed field (drives schema diagnostic, not a crash); node/explore .txt are opaque prose with one explicitly-marked `file:line`; `fake-codegraph.js` maps `argv[2]` (subcommand) → prints the matching fixture to stdout and exits 0 (unknown → exit 2), sleeps when `argv` contains `--sleep <ms>` (for timeout test), echoes env when subcommand `env`; dogfood-sample.md is a well-formed artifact (all required sections + fingerprints + repoCommit/version lines), dogfood-bad.md omits ≥1 required section
  - test-first: governance.js「T-cg-fixtures」asserts every JSON fixture `JSON.parse`s, help.txt contains all 9 commands, fake-codegraph resolves paths relative to its own dir (no cwd dependence); 红→绿

- [ ] [task:cg-detect] codegraph.js check()/getStatus: detection ladder + fingerprint identity lock + version compat
  - files: templates/cli/code-perception/providers/codegraph.js
  - verify: node templates/cli/test.js governance
  - acceptance: `create()` returns a provider passing `validateProvider` (full 15-key capabilities: files/symbols/source/callers/callees/impact/affectedTests/modules=true, rest false; methods check/getStatus/getFiles/search/getEntity/getCallers/getCallees/impact/getAffectedTests/explore present); `check(context)` runs version+help via runCodegraph and fingerprints — semver∉`[1.0.0,2.0.0)` OR help missing the command set → `available:false`+`reason` identity/version mismatch (NOT adapt-guess); missing exe → installed:false/indexState MISSING/suggestedAction install; installed but status no-index → ready:false/indexState MISSING/suggestedAction `codegraph init`; valid → available/ready true, indexState READY, providerVersion; `getStatus` passes `validateStatus`, sets compatibility UNTESTED (in-range, providerVersion∉TESTED) / SUPPORTED (∈TESTED) / UNSUPPORTED (out of range), records observedSchemaFingerprint; both never throw; injects DO_NOT_TRACK/CODEGRAPH_NO_UPDATE_CHECK by default
  - test-first: governance.js「T-cg-detect」points executable at `fake-codegraph.js`; asserts valid-fingerprint→ready, a wrong-help fixture→identity mismatch available:false, a `0.9.0`/`2.1.0` version→UNSUPPORTED/reject, missing-exe path→installed:false; 红→绿

- [ ] [task:cg-queries] codegraph.js query methods: command mapping + JSON normalize + opaque explore/node + per-capability schema disable
  - files: templates/cli/code-perception/providers/codegraph.js (extend), templates/cli/test/fixtures/code-perception/ (reuse)
  - verify: node templates/cli/test.js governance
  - acceptance: getFiles/search/getCallers/getCallees/impact/getAffectedTests each run the exact mapped command (args array: e.g. `['query', q, '--json']`), parse JSON per the parsing rule (ignore unknown fields, preserve provider entity id, degrade on missing, diagnostic on bad schema, never fail on new fields), and return ①-normalized shapes (references `code-ref:provider:codegraph:…`); getEntity(`node`) + explore(`explore`) return OPAQUE text with only explicitly-marked file/line extracted and NO structural edges; a malformed.json response for one capability → that capability's call returns empty normalized shape + schema diagnostic AND getStatus downgrades that one capability to false (per-capability disable), other capabilities unaffected; no method throws; **no `.codegraph` path is ever opened**
  - test-first: governance.js「T-cg-queries」drives fake-codegraph, asserts search/callers/impact normalize to unified shapes with provider-scoped ids, affectedTests independent of impact, explore/node opaque (assert no `kind:'calls'` edge synthesized from prose), malformed→capability-disabled + diagnostic; grep-assert the module never references `.codegraph`; 红→绿

- [ ] [task:cg-loader-register] register provider:codegraph in DEFAULT_REGISTRY (config-gated, structural-primary)
  - files: templates/cli/code-perception/provider-loader.js
  - verify: node templates/cli/test.js governance
  - acceptance: `DEFAULT_REGISTRY` gains `'provider:codegraph': { role:'structural-primary', create: () => require('./providers/codegraph').create() }`; native-lite remains the only force-added entry so `loadProviders()` (no config) still returns exactly native-lite (① `T-cp-loader` assertion #1 unchanged + still green); `loadProviders({codePerception:{providers:[{id:'provider:codegraph', role:'structural-primary'}]}})` returns a codegraph registration (source configured) + native-lite; a broken codegraph create still isolates per ① loader contract
  - test-first: governance.js「T-cg-loader-register」asserts default still native-lite-only, config-selected codegraph present with role structural-primary/source configured, native-lite still present; run full `T-cp-loader` to confirm no ① regression; 红→绿

- [ ] [task:cg-cache] cache.js: fingerprint key + TTL/invalidation + stale-not-fresh
  - files: templates/cli/code-perception/cache.js
  - verify: node templates/cli/test.js governance
  - acceptance: `makeCacheKey` sha256 over canonical {providerId,providerVersion,adapterVersion,snapshot,rootFingerprint,query} (different snapshot/query → different key); `createCache({ttlMs, now})` get/set/invalidateOn/size with INJECTED clock (no top-level Date.now); TTL-expired entry → MISS; `invalidateOn('head'|'snapshot'|'dirty'|'adapter'|'config')` clears; **a stored stale-freshness value is returned byte-identical on hit (never rewritten to fresh)**; does not store unbounded blobs (documented cap on value size or a guard)
  - test-first: governance.js「T-cg-cache」asserts key sensitivity, TTL expiry via injected clock, invalidation, and that a value with `freshness:'stale'` comes back `stale` on hit; 红→绿

- [ ] [task:cg-status] status.js: code-perception status surface + post-commit stale hints (no auto-sync)
  - files: templates/cli/code-perception/status.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildCodePerceptionStatus(context,{registrations,candidates})` pure-aggregates router candidates into `providers[]` (id/role/available/ready/indexState/compatibility/degraded), emits `staleHints[]` when indexedCommit≠currentCommit advising MANUAL `codegraph sync` (NEVER auto-run, NEVER spawn), and a `links` summary `{confirmed,derived,proposed}` when governance links are supplied; no subprocess; never throws
  - test-first: governance.js「T-cg-status」feeds hand-built candidates (codegraph stale + native-lite ready) → asserts staleHint present with manual-sync message + no spawn, degraded flags correct; 红→绿

### Phase 3 — Governance Linker

- [ ] [task:cg-linker-exact] governance-linker.js: exact declared + git-derived file links (confidence 1.0)
  - files: templates/cli/code-perception/governance-linker.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildGovernanceLinks(inputs)` emits `declares_file`/`depends_on_file`/`implements_task` from Task linkedFiles + acceptance dependsOn (status confirmed, confidence 1.0) and `changed_by_commit` from commit changedFiles (file confidence 1.0); each link carries `evidence.sourcePath`/`commitSha`; stable `id=gov-link:<16hex>`; dedupe by id; never throws on missing inputs (empty arrays → `{links:[],diagnostics:[]}`)
  - test-first: governance.js「T-cg-linker-exact」builds a small planIR (task with linkedFiles) + one commit → asserts confirmed file links at confidence 1.0 with correct kinds + evidence; 红→绿

- [ ] [task:cg-linker-symbol] governance-linker.js: symbol links via diff-range∩provider-range + evidence/focus links
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: symbol links (status derived) emitted ONLY when a rule holds — Plan names the symbol / Evidence names the symbol / commit diff line-range intersects provider symbol range / test/evidence references the symbol; **a file with symbols but no matching rule produces NO symbol link** (assert the negative); `verified_by_test`/`evidenced_by_archive` from evidence records; `related_to_focus` from activeContext focus; provider-resolved symbol confidence = the provider reference's resolution confidence
  - test-first: governance.js「T-cg-linker-symbol」gives a commit diffRange intersecting one of two provider symbol ranges → asserts exactly the intersecting symbol gets a derived link and the non-intersecting one does NOT; evidence-named symbol link present; 红→绿

- [ ] [task:cg-linker-heuristic] governance-linker.js: heuristic proposals (≤0.5) + stored graph assembly
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: name-only fuzzy Task-title↔symbol matches emit `status:'proposed'`, `confidence<=0.5`, never confirmed/derived; full `GovernanceCodeLink` objects validate (id/governanceEntityId/codeReferenceId/kind∈7/status∈{confirmed,derived,proposed}/confidence/evidence); dedupe keeps the strongest link per id (confirmed>derived>proposed); diagnostics for any dropped/ambiguous heuristic
  - test-first: governance.js「T-cg-linker-heuristic」asserts a fuzzy match is proposed≤0.5, that an exact link for the same pair supersedes a proposed one on dedupe, and all links pass a shape check; 红→绿

- [ ] [task:cg-failure-isolation] failure isolation across adapter+cache+linker (missing/not-indexed/timeout/schema-drift/stale)
  - files: templates/cli/code-perception/providers/codegraph.js (harden), templates/cli/code-perception/cache.js (harden), templates/cli/test/fixtures/code-perception/ (reuse)
  - verify: node templates/cli/test.js governance
  - acceptance: with codegraph missing/timeout/malformed, `loadProviders`+`inspectProviders`+`selectProvider` still return Native Lite for `files` (degraded) and `candidate:null`+ready-centric reason for `impact` (no silent substitution); Planning IR / Architecture IR / memory / verify untouched (assert none written); timeout → child killed + diagnostic + request degraded + provider NOT permanently disabled (a subsequent healthy call succeeds); schema drift → single capability disabled, others live; stale index → results returned but `freshness:'stale'` + `indexedCommit`/`currentCommit` in the reference (never presented as fresh); diagnostics truncated (no large source-bearing blobs stored)
  - test-first: governance.js「T-cg-failure-isolation」drives fake-codegraph in timeout/malformed/stale modes through the ① loader+router with codegraph config-selected; asserts fallback, no-substitution reason string, non-permanent disable, stale visibility; 红→绿

- [ ] [task:cg-dogfood-validate] dogfood-validate.js: artifact validator (fields + fingerprints + sections + closure evidence)
  - files: templates/cli/code-perception/dogfood-validate.js
  - verify: node templates/cli/test.js governance
  - acceptance: `validateDogfoodArtifact(text,{requireClosureEvidence})` returns valid:true for `dogfood-sample.md` (has repoCommit/codegraphVersion/adapterVersion metadata, command/result sha256 fingerprint lines, and all sections: status/search/callers-callees/impact/current-focus/Task-to-Code/stale-index/fallback/limitations) and valid:false with specific findings for `dogfood-bad.md` (missing section) and for a text lacking a `closureEvidenceCommit:` line when `requireClosureEvidence:true`; pure, never throws
  - test-first: governance.js「T-cg-dogfood-validate」runs the validator on the two committed sample artifacts (accept good, reject bad with the missing-section finding code) + a no-closure-evidence case; 红→绿

- [ ] [task:cg-manifest-sync] register all new files in manifest + mirror sync + full regression
  - files: templates/cli/template-manifest.js, .evo-lite/cli/code-perception/
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: manifest core-cli family gains all new PRODUCTION modules (providers/codegraph-exec.js, providers/codegraph.js, cache.js, status.js, governance-linker.js, dogfood-validate.js) AND all new TEST assets (the 12 codegraph-* fixtures + fake-codegraph.js + dogfood-sample.md + dogfood-bad.md under test/fixtures/code-perception/); sync-runtime converges to two consecutive `copied:0` (may take 3 runs — mirror reads its own manifest, per ①'s cp-manifest-sync); every new file byte-identical template↔mirror; `node ./.evo-lite/cli/test.js governance` (runtime) green with all T-cg-* + all T-cp-* sections; `node templates/cli/test.js governance` (template) green; no other governance regression; security boundary stays `DEFAULT_REGISTRY` config-gating (fixtures mirrored but unselectable in production)
  - (no separate unit test — the sync double-run-zero + byte-identical + both suites green IS the acceptance)

## Follow-ups (host-gated — OUTSIDE this plan's completion)

- **Live CodeGraph dogfood run** (closes `ac-live-codegraph-dogfood`): `npm i -g @colbymchenry/codegraph@1.4.1`; on create-evo-lite run `codegraph init` then real status/query/callers-callees/impact/current-focus/Task-to-Code/stale/fallback captures; write `docs/code-perception-codegraph-dogfood.md` (repoCommit, codegraphVersion, adapterVersion, command/result fingerprints, all required sections, observed limitations, closureEvidenceCommit); run `dogfood-validate.js` on it (must be valid:true); commit as the closure-evidence commit. Only then does `ac-live-codegraph-dogfood` have a real artifact to verify. This is a single focused host-gated session; the whole adapter/linker/cache/status/validator it exercises is already shipped by this plan.
- **UA / GitNexus adapters** (§1 explicitly deferred): additional structural providers behind the same contract.

## Self-Review

**Spec coverage:** §2.0 identity → cg-detect fingerprint. §2.1 detection → cg-detect ladder. §2.2 command mapping → cg-queries (exact args). §2.3 parsing rule + opaque → cg-queries. §2.4 version compat + per-capability disable → cg-detect + cg-queries. §2.5 security → cg-exec (no-shell/args/timeout/caps/ANSI) + cg-queries (no .codegraph). §2.6 network boundary → cg-exec childEnv. §3 linker (kinds/confidence/graph) → cg-linker-exact + cg-linker-symbol + cg-linker-heuristic. §4 cache → cg-cache. §5 post-commit stale hints → cg-status. §6 failure isolation → cg-failure-isolation. §7 fixtures + dogfood validator → cg-fixtures + cg-dogfood-validate; live run → Follow-ups. §8 layout → cg-manifest-sync (+ codegraph-exec.js added as the security seam, noted). §9 phases → Phase 2 (cg-exec…cg-status) / Phase 3 (cg-linker-*…). AC ac-codegraph-adapter → cg-exec/cg-queries; ac-governance-linker → cg-linker-*; ac-provider-failure-isolation → cg-failure-isolation; ac-live-codegraph-dogfood → cg-dogfood-validate (validator) + Follow-ups (real run). Gap by design: the live run is host-gated (Follow-ups), so ac-live-codegraph-dogfood closes after this plan.

**Type consistency:** provider methods/capabilities match ①'s `validateProvider`/`CAPABILITY_METHOD`; normalize calls use the shipped signatures; DEFAULT_REGISTRY entry shape matches ①'s `{role, create}`; GovernanceCodeLink shape matches spec §3.4; cache clock injection avoids the Date.now top-level ban.
