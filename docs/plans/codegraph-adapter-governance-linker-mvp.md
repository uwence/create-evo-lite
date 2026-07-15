---
id: plan:codegraph-adapter-governance-linker-mvp
linkedSpec: spec:codegraph-adapter-governance-linker
status: draft
created: 2026-07-13
---

# CodeGraph Adapter & Governance Linker — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real structural Provider (`provider:codegraph`, a fingerprint-locked CodeGraph CLI adapter) plus the Governance Linker that turns code facts into Task/Commit/Evidence links — Evo-Lite's Task-to-Code differentiation — with a file-based cache, post-commit integration, status surface, failure isolation, a dogfood validator, and a host-gated live dogfood run.

**Architecture:** The adapter implements sub-spec ①'s `CodePerceptionProvider` contract, driven through a secure `execFile` runner (no shell, `--` option-injection defense). JSON output is normalized through ①'s `normalize.js` via explicit per-command translators; `explore`/`node` output is opaque. A file-based bounded cache (readable by the separate post-commit process, envelope-wrapped so stale never masquerades as fresh) stores ONLY provider status / normalized metadata / governance links. The Governance Linker consumes Planning IR + explicit reference inputs + Git + Evidence, resolves every `codeReferenceId` against provided `CodeReference`s (no dangling links, no text guessing), and persists a deterministic stored graph. Fixtures derive from pinned `@colbymchenry/codegraph@1.4.1` with recorded provenance.

**Tech Stack:** Node CommonJS, zero new deps (node builtins: child_process/crypto/fs/path), 4-space indent. Consumes shipped sub-spec ① modules under `templates/cli/code-perception/`.

## Global Constraints (binding — verbatim from spec; every task inherits these)

- **Upstream identity locked** to `colbymchenry/codegraph` (`@colbymchenry/codegraph`, provider id `provider:codegraph`, compat `>=1.0.0 <2.0.0`, MIT). NOT `optave/ops-codegraph-tool`. `check()` fingerprints identity (semver in range + `help` contains `status/files/query/explore/node/callers/callees/impact/affected` + output shape) — never trust the bare executable name.
- **Command mapping (exact):** status→`status <root> --json`, files→`files <root> --json`, search→`query <query> --json`, callers→`callers <symbol> --json`, callees→`callees <symbol> --json`, impact→`impact <symbol> --json`, affectedTests→`affected [files...] --json`, explore→`explore <query>` (opaque), entity source→`node <entity>` (opaque).
- **Execution security:** single executable; `execFile` **no `shell:true`**; args array; explicit project-root arg; enforced timeout (kill child); stdout/stderr byte caps; strip ANSI; NEVER execute a command found in Provider output.
- **Option-injection defense:** user-derived operands pass AFTER an upstream-verified `--` separator when supported. cg-fixtures determines whether upstream 1.4.1 honors `--` and records it in the provenance manifest; the exec module then hard-codes a frozen production constant `SUPPORTS_POSITIONAL_SEPARATOR` matching that conclusion (**production code never reads the test manifest at runtime**; a test asserts the constant equals the manifest value). If `--` is unsupported, a leading-dash operand is REJECTED with diagnostic `unsafe-argument`. A test drives `query="--help"` → treated as query text (or rejected), never triggers CLI help.
- **Network boundary (Local-First) with fixed merge order:** `env = { ...baseEnv, ...callerEnv }; if (!allowNetwork) { env.DO_NOT_TRACK='1'; env.CODEGRAPH_NO_UPDATE_CHECK='1'; }` — forced values applied LAST so a caller can never override them.
- **Allowlist as frozen ARRAY, not a frozen Set** (`Object.freeze(new Set())` doesn't block `.add()`): export `ALLOWED_SUBCOMMANDS = Object.freeze([...])`; module-private `new Set(...)` for lookup; the Set is not exported.
- **No `.codegraph` DB coupling:** never open/execute internal DB/SQL, depend on undocumented tables, or modify `.codegraph`. Data from CLI stdout only.
- **JSON parsing rule:** validate type, ignore unknown fields, preserve original provider entity id, degrade on missing, diagnostic on bad schema, never fail on new fields. `explore`/`node` = opaque text (extract only explicitly-marked file/line; no edge synthesis; no overriding JSON results).
- **Version compat + per-capability disable lifecycle (`capabilityHealth` Map on the instance):** schema-fail → disable that capability + record fingerprint+diagnostic; timeout/exit-error → degrade THIS request only (do NOT disable); later good parse of that capability → re-enable; providerVersion/schemaFingerprint change → clear the map. `getStatus` reflects the map. compatibility UNTESTED (in-range, providerVersion∉TESTED) / SUPPORTED (∈TESTED) / UNSUPPORTED (out of range).
- **Fixtures captured, not invented:** every codegraph fixture derives from pinned `@colbymchenry/codegraph@1.4.1` (pinned-upstream-source or one-time real-cli), recorded in `codegraph-fixture-manifest.json`. The adapter uses explicit per-command translators (upstream shape → ProviderStatus / normalize raw input) — never "raw blob → normalize".
- **Cache is file-based, bounded, envelope-wrapped, contained:** under `.evo-lite/.cache/code-perception/`; `MAX_CACHE_ENTRIES=256`, `MAX_CACHE_VALUE_BYTES=1*1024*1024`; entries are an envelope `{version:'evo-code-cache@1', storedAt, stale, staleReason, currentCommit, value}` — `markStale` mutates the envelope (never the `value`), consumers treat `envelope.stale` as effective freshness (never re-present a stale value's inner `freshness:'fresh'` as current). **Persist ONLY:** provider status, normalized search/relationship/impact metadata, governance links. **NEVER persist:** getEntity content, explore opaqueText, raw stdout/stderr, source snippets, secrets. (1 MiB size alone can't classify secrets — source context stays in-process transient until a redaction contract exists.)
- **Cache disk safety:** filenames are ONLY the 64-hex `makeCacheKey` SHA; reject symlink components in the cache root; production root must be contained within project root; write via same-dir temp file + atomic rename (no half-files); check file size BEFORE reading (don't read-then-check the cap); corrupt JSON → diagnostic + MISS (never throw); eviction deletes only valid hash files within the root.
- **Config reaches the provider:** the loader passes `registration.options` into `create(options)` (backward-compatible — native-lite ignores extra args); the codegraph adapter stores `{executable, prefixArgs, timeoutMs, allowNetwork}` from those options. `sanitizeOptions` still strips dangerous fields (module/path/require/factory/create/id/enabled/role).
- **Failure isolation:** provider missing/not-indexed/timeout/malformed/unsupported-version must NOT break Planning IR, Architecture IR, memory, or verify; Native Lite stays available; never auto-run `codegraph sync`/`init`; truncate diagnostics that could carry source.
- **Uses sub-spec ① (shipped — do NOT modify its CONTRACTS; the one compatible loader enhancement above is explicitly allowed):** `require('../provider-contract')`, `require('../normalize')`, `require('../provider-loader')`, `require('../provider-router')` with their shipped signatures.
- **Derived outputs (deterministic sort + atomic write, GITIGNORED runtime-derived data):** `.evo-lite/generated/code-perception/governance-links.json` (the §3.4 stored graph), `.evo-lite/generated/code-perception/post-commit-last-run.json`. `.evo-lite/generated/**` is gitignored (`.gitignore` ignores `.evo-lite/*` and does NOT whitelist `generated/`) — do NOT expand Git tracking for the stored graph or post-commit blob; they are regenerated at runtime. The ONLY committed artifact this plan produces is the dogfood doc under `docs/`.
- CommonJS, `'use strict'`, zero new deps, 4-space indent, style like sibling `code-perception/*.js`. New production files registered in `template-manifest.js` core-cli family; `sync-runtime` double-run-zero; `.evo-lite/cli` mirror byte-identical; `node ./.evo-lite/cli/test.js governance` green throughout; no existing plan-closure regression.
- **Live CodeGraph run is IN this plan** (`cg-live-dogfood`), host-gated, **optional in normal CI but MANDATORY for Spec closure**. Its AC verifier is strict mode `node ./.evo-lite/cli/test.js governance --require-live-codegraph`. Host without CodeGraph → the task stays unchecked, plan+spec honestly stay `active`. Never fake the artifact.

## Design Notes (implementer contracts — read before your task)

### `code-perception/providers/codegraph-exec.js` (secure command runner — security seam)
```js
const SUPPORTS_POSITIONAL_SEPARATOR = true;  // FROZEN production constant; value set from cg-fixtures' upstream conclusion; a test asserts it === manifest's recorded value. Production NEVER reads the test manifest.
module.exports = {
    runCodegraph({ executable, prefixArgs = [], subcommand, args = [], cwd,
                   timeoutMs = 15000, maxBytes = 8*1024*1024, allowNetwork = false, env }) => {
        // → { ok, code, stdout, stderr, timedOut, truncated, diagnostics:[{code,message}] }
    },
    ALLOWED_SUBCOMMANDS,   // Object.freeze(['status','files','query','callers','callees','impact','affected','explore','node','version','help'])
    SUPPORTS_POSITIONAL_SEPARATOR,
    stripAnsi(s),
    childEnv(baseEnv, callerEnv, allowNetwork),
    safeOperand(value),    // uses the frozen constant (NOT the manifest): if separator unsupported and value has a leading '-', → {ok:false,reason:'unsafe-argument'}; else {ok:true,value}
};
```
- Full argv = `[...prefixArgs, subcommand, ...args]`. Production: `executable='codegraph'`, `prefixArgs=[]`. Test: `executable=process.execPath`, `prefixArgs=[fakeCodegraphPath]` → `execFile(process.execPath, [fakeCodegraphPath, subcommand, ...args])` (Windows-safe; NOT relying on a `.js` being directly executable).
- `subcommand ∉` private Set → `{ok:false,diagnostics:[{code:'disallowed-subcommand'}]}` WITHOUT spawn. `execFile(executable, fullArgs, { cwd, timeout, maxBuffer, env, shell:false, windowsHide:true })`. Timeout → kill, `{ok:false,timedOut:true,code:null,'command-timeout'}`. Oversize (ENOBUFS) → `{ok:false,truncated:true,'output-truncated'}` (no full blob). ANSI stripped. Never throws.
- `childEnv` fixed order: `const e={...baseEnv,...(callerEnv||{})}; if(!allowNetwork){e.DO_NOT_TRACK='1';e.CODEGRAPH_NO_UPDATE_CHECK='1';} return e;`.

### `code-perception/providers/codegraph.js` (adapter — stateful instance, config from create options)
```js
module.exports = { create };   // create(options = {}) => Provider (id 'provider:codegraph')
// options = { executable='codegraph', prefixArgs=[], timeoutMs=15000, allowNetwork=false } — STORED on the instance and used by check/getStatus/queries (config-less create was WRONG: the loader passes options to create()).
// capabilities: files/symbols/source/callers/callees/impact/affectedTests = true; modules = FALSE (upstream 1.4.1 module data unproven); semanticSearch/trace/flows/summaries/layers/tours/incrementalIndex = false. Full 15-key map from CAPABILITY_KEYS.
```
- `ADAPTER_VERSION='0.1.0'`, `MIN_PROVIDER_VERSION='1.0.0'`, `TESTED_PROVIDER_VERSIONS=['1.4.1']`, `COMPAT={min:'1.0.0',maxExclusive:'2.0.0'}`.
- `create(options)` → closure-scoped instance holding `options` + `const capabilityHealth = new Map()` (lifecycle per Global Constraints). check/getStatus/queries use `this` options (executable/prefixArgs/timeoutMs/allowNetwork) when calling runCodegraph; `context.providerConfig`, if present, may override per-call but the stored options are the primary source.
- `check`/`getStatus`/query methods exactly as the prior revision (detection ladder, fingerprint, ready+indexState, per-command translators → ① normalize, opaque explore/node, per-capability disable). getFiles moduleId stays null (modules=false). No `.codegraph` access.
- Return shapes carry a diagnostics channel on every query method, symmetric across the board: `getFiles(...) → { files, diagnostics }`, `search(...) → { matches, diagnostics }`, `impact(...) → { ..., diagnostics }`, `getCallers/getCallees(...) → { relationships: normalizeRelationship(...)[], diagnostics }`, `getAffectedTests(...) → { tests: CodeReference[], diagnostics }`. None return a bare array — a caller must be able to tell "zero results" from "call failed / capability disabled" via `diagnostics`.

### `code-perception/cache.js` (file-based, bounded, envelope, contained)
```js
module.exports = {
    makeCacheKey(parts) => string,   // sha256 hex of canonical {providerId,providerVersion,adapterVersion,snapshot,rootFingerprint,query}
    createCache({ projectRoot, root = path.join(projectRoot, '.evo-lite', '.cache', 'code-perception'),
                  ttlMs = 300000, maxEntries = 256, maxValueBytes = 1*1024*1024, now }) => {
        get(key) => { hit, value?, stale?, staleReason?, storedAt? },   // reads envelope; value byte-identical; effective freshness = envelope.stale
        set(key, value, meta?) => { stored:boolean, reason? },          // false+'cache-value-too-large' when serialized>maxValueBytes; false+'uncacheable-kind' for non-whitelisted; evict oldest past maxEntries
        invalidateOn(reason) => void,                                   // snapshot|head|dirty|adapter|config|ttl
        markStale({ reason, currentCommit }) => void,                   // mutate envelopes' stale/staleReason/currentCommit; value untouched
        size() => number,
    },
};
```
- Requires `projectRoot` (or an explicit `root`); neither → structured error, NEVER `process.cwd()`. Entries persisted as `<64hex>.json` envelope files under `root`. `now` injected. Disk safety per Global Constraints (64-hex-only filenames, symlink-reject, containment, size-check-before-read, atomic temp+rename, corrupt→MISS, eviction only valid hash files). `set` refuses non-whitelisted value kinds (only provider-status / normalized-search-relationship-impact / governance-links; a `meta.kind` tags it).

### `code-perception/governance-linker.js` (reference-resolved, no dangling links)
```js
module.exports = { buildGovernanceLinks(inputs) => { links: GovernanceCodeLink[], diagnostics: [] } };
// inputs = {
//   planIR,                        // task.linkedFiles (the ONLY per-task IR field — verified against scan.js:162)
//   acceptanceDependencies?: [{ governanceEntityId, filePath, sourcePath }],
//   fileReferences?: CodeReference[],                    // resolve file-relation codeReferenceId by normalized filePath match
//   symbolReferences?: [{ reference: CodeReference, filePath, lineRange:[s,e], resolutionConfidence }],
//   commits?: [{ sha, changedFiles:[...], diffRanges?:{ [file]:[[s,e],...] } }],
//   evidence?: [{ taskId, kind:'test'|'archive', codeReferenceId?, filePath?, sourcePath?, archivePath?, symbols? }],
//   focusReferences?: [{ governanceEntityId, codeReferenceId }],   // pre-resolved; free-text activeContextFocus is NOT accepted here
// }
```
Fixed rules (enforce "no guessing from Markdown/text"):
1. File relations (`declares_file`/`depends_on_file`/`changed_by_commit`) resolve `codeReferenceId` by EXACT normalized `filePath` match against `fileReferences`. No matching reference → `unresolved-code-reference` diagnostic and **NO dangling link**.
2. Symbol links (`implements_task`, status derived) ONLY when a rule holds against `symbolReferences`: Plan names the symbol / Evidence names the symbol / a commit `diffRange` intersects a symbolReference `lineRange` / a test/evidence references it. Confidence = the symbolReference `resolutionConfidence`. A file with symbols but no matching rule → NO symbol link.
3. `related_to_focus` ONLY from pre-resolved `focusReferences` (each carrying a real `codeReferenceId`). Free-text focus never yields a confirmed/derived link.
4. Fuzzy Task-title↔symbol matches → heuristic `proposed`, `confidence<=0.5` only.
5. `evidence` without a `codeReferenceId` or an exactly-resolvable `filePath`/symbol → NO code link (a diagnostic, not a guess).
- Kinds: linkedFiles→`declares_file`(confirmed 1.0); acceptanceDependencies→`depends_on_file`(confirmed 1.0); changedFiles→`changed_by_commit`(1.0); strong symbol→`implements_task`(derived); evidence→`verified_by_test`/`evidenced_by_archive`; focusReferences→`related_to_focus`.
- `id='gov-link:'+sha256(governanceEntityId+'|'+codeReferenceId+'|'+kind).slice(0,16)`; dedupe strongest per id (confirmed>derived>proposed). Never throws.
- **Stored graph persistence:** a `persistGovernanceLinks(root, links)` writes `.evo-lite/generated/code-perception/governance-links.json` with deterministic key/array ordering + atomic temp+rename (the §3.4 stored graph; §1 Scope + §3.4 require it — returning `links[]` alone is insufficient).

### `code-perception/status.js`
```js
module.exports = { buildCodePerceptionStatus(context, { registrations, candidates, links }) => {
    providers:[{ id, role, available, ready, indexState, compatibility, degraded, reason? }],
    staleHints:[{ providerId, indexedCommit?, currentCommit?, message }],   // MANUAL codegraph sync; never auto-run/spawn
    links:{ confirmed, derived, proposed },
    diagnostics:[],
} };
```
Pure aggregation (read surface); no subprocess; never throws.

### `code-perception/post-commit-code-perception.js` (§5 ACT surface — after linker exists)
```js
module.exports = { runPostCommitCodePerception(context) => { report, diagnostics } };
// context = { projectRoot, headSha, changedFiles, cache }
```
On commit: refresh Native Lite file facts (native-lite getFiles recompute) → `cache.markStale({reason:'head',currentCommit:headSha})` → rebuild commit/file governance links (buildGovernanceLinks with the new commit + fileReferences from native-lite) → `persistGovernanceLinks(...)` (refresh the stored graph) → write `.evo-lite/generated/code-perception/post-commit-last-run.json` (deterministic + atomic) → surface a MANUAL sync suggestion when index stale. **NEVER runs `codegraph sync`/`init`.** Wired into `hooks.js` post-commit GUARDED so a Provider failure never fails the commit.

### `code-perception/dogfood-validate.js` (+ strict test flag)
```js
module.exports = { validateDogfoodArtifact(text, { requireClosureEvidence = true } = {}) => { valid, findings:[{code,message}] } };
```
- Parses metadata (`repoCommit`,`codegraphVersion`,`adapterVersion`, and when required `closureEvidenceCommit`) + fenced `command`/`result` blocks; for each declared `fingerprint: sha256:<hex>` RE-COMPUTES sha256 over the block and compares (mismatch → finding). Requires sections status/search/callers-callees/impact/current-focus/Task-to-Code/stale-index/fallback/limitations. Pure; never throws.
- **Strict test flag:** `test.js` gains `--require-live-codegraph`. In that mode, after (or instead of) the normal governance run, it reads `docs/code-perception-codegraph-dogfood.md`, runs `validateDogfoodArtifact(text,{requireClosureEvidence:true})`, and `process.exit(1)` if the file is absent or `valid:false` (tampered fingerprint, missing section, missing closure evidence). Normal `governance` (no flag) does NOT require the artifact — so the other 3 ACs stay green in ordinary dev/CI. The command keeps the `node ./.evo-lite/cli/test.js` prefix (command-policy compatible).

### Fixtures (`templates/cli/test/fixtures/code-perception/`)
`codegraph-fixture-manifest.json` (provenance: upstream/package/providerVersion `1.4.1`/upstreamCommit/per-command captureMethod/fixtureSha256/redactions/**`supportsPositionalSeparator`**), the codegraph-* fixtures derived from pinned 1.4.1, `dogfood-sample.md`/`dogfood-bad.md`, and `fake-codegraph.js` (node script `node fake-codegraph.js <subcommand>`: echoes fixture, exit 0/unknown 2; `--fake-sleep <ms>`; `--fake-echo-env` on an ALLOWED subcommand — NO bogus `env` subcommand; resolves via `__dirname`). Test assets, manifest-registered for the mirror, never in production `DEFAULT_REGISTRY` selection.

### Loader wiring (compatible enhancement)
`provider-loader.js`: (1) add `'provider:codegraph': { role:'structural-primary', create: options => require('./providers/codegraph').create(options) }`; (2) change the instantiation site from `regEntry.create()` to `regEntry.create(selection.options)` (backward-compatible: native-lite/fixture ignore extra args). Config-gated: native-lite stays the only force-added entry (① `T-cp-loader` #1 unchanged). `sanitizeOptions` still strips dangerous keys.

## Tasks

### Phase 2 — CodeGraph Adapter

- [x] [task:cg-fixtures] pinned-upstream fixtures + provenance manifest (incl. `--` support + separator conclusion) + fake-cli
  - files: templates/cli/test/fixtures/code-perception/codegraph-fixture-manifest.json, codegraph-version.txt, codegraph-help.txt, codegraph-status.json, codegraph-files.json, codegraph-query.json, codegraph-callers.json, codegraph-callees.json, codegraph-impact.json, codegraph-affected.json, codegraph-malformed.json, codegraph-node.txt, codegraph-explore.txt, fake-codegraph.js, dogfood-sample.md, dogfood-bad.md
  - verify: node templates/cli/test.js governance
  - acceptance: fixtures DERIVED from pinned `@colbymchenry/codegraph@1.4.1` (fetch npm tarball / GitHub 1.4.1 tag; read real `--json` shapes) — NOT invented; manifest records upstream/package/providerVersion/upstreamCommit/per-command captureMethod/fixtureSha256/redactions AND `supportsPositionalSeparator` (whether upstream 1.4.1 honors `--`); version.txt=`1.4.1`, help.txt lists all 9 commands; malformed.json = valid JSON wrong-typed field; node/explore opaque with one marked `file:line`; fake-codegraph runs via `node fake-codegraph.js <subcommand>`, `--fake-sleep`/`--fake-echo-env` on allowed subcommand, `__dirname` paths; dogfood-sample.md well-formed (sections + recomputable fingerprints + repoCommit/version), dogfood-bad.md missing ≥1 section
  - test-first: governance.js「T-cg-fixtures」asserts manifest fields + each fixtureSha256 == recomputed sha, JSON fixtures parse, help has 9 commands, `supportsPositionalSeparator` is a boolean; 红→绿
  - BLOCKED-not-faked: if the environment blocks fetching upstream, record captureMethod + blocking reason in the manifest and STOP — do NOT invent shapes.

- [x] [task:cg-exec] codegraph-exec.js: secure no-shell runner + `--` defense (frozen const) + env-order + caps
  - files: templates/cli/code-perception/providers/codegraph-exec.js
  - verify: node templates/cli/test.js governance
  - acceptance: exports `runCodegraph`/`ALLOWED_SUBCOMMANDS`(frozen array)/`SUPPORTS_POSITIONAL_SEPARATOR`(frozen const == manifest's `supportsPositionalSeparator`)/`stripAnsi`/`childEnv`/`safeOperand`; argv `[...prefixArgs,subcommand,...args]`; `execFile` shell:false, timeout kill, maxBuffer; disallowed subcommand → reject without spawn; timeout→command-timeout; oversize→output-truncated (no blob); ANSI stripped; `childEnv(base,caller,false)` forces DO_NOT_TRACK=1+CODEGRAPH_NO_UPDATE_CHECK=1 AFTER caller (caller `DO_NOT_TRACK=0` is overridden back to 1), allowNetwork:true omits them; `safeOperand` uses the frozen const (not the manifest) — leading-dash rejected when unsupported; never throws
  - test-first: governance.js「T-cg-exec」drives fake-cli via `process.execPath`+prefixArgs; asserts fixture echo, disallowed-subcommand no-spawn, timeout kill (`--fake-sleep`), env override (`status --fake-echo-env`, caller can't override), option-injection (`--help` operand → after `--` or rejected, fake never prints help), and `SUPPORTS_POSITIONAL_SEPARATOR===manifest.supportsPositionalSeparator`; 红→绿

- [x] [task:cg-detect] codegraph.js create(options)/check()/getStatus: detection + fingerprint lock + version compat + capabilityHealth
  - files: templates/cli/code-perception/providers/codegraph.js
  - verify: node templates/cli/test.js governance
  - acceptance: `create(options)` stores `{executable,prefixArgs,timeoutMs,allowNetwork}` + `capabilityHealth` Map; returns a provider passing `validateProvider` (15-key caps: files/symbols/source/callers/callees/impact/affectedTests=true, modules=FALSE, rest false; methods present); `check` fingerprints (semver∉[1.0.0,2.0.0) OR help missing command set → available:false identity/version mismatch, no adapt-guess; missing exe → installed:false/MISSING/install hint; installed+no-index → ready:false/MISSING/`codegraph init`; valid → ready/READY/providerVersion); `getStatus` passes `validateStatus`, compatibility UNTESTED/SUPPORTED/UNSUPPORTED, records observedSchemaFingerprint, reflects capabilityHealth; uses the STORED options (a configured executable/prefixArgs actually drives runCodegraph); Local-First env by default; both never throw
  - test-first: governance.js「T-cg-detect」`create({executable:process.execPath, prefixArgs:[fakePath]})`; asserts the stored config drives detection, valid→ready, wrong-help→identity mismatch, `0.9.0`/`2.1.0`→UNSUPPORTED/reject, missing-exe→installed:false; 红→绿

- [x] [task:cg-queries] codegraph.js query methods: mapping + per-command translators → ① normalize + opaque + per-capability disable
  - files: templates/cli/code-perception/providers/codegraph.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: getFiles/search/getCallers/getCallees/impact/getAffectedTests run exact mapped commands (operands after `--` per the frozen const), apply EXPLICIT per-command translators (documented field-by-field), return ①-normalized shapes `code-ref:provider:codegraph:…`; parsing rule honored; getFiles moduleId null (modules=false); getEntity/explore OPAQUE (assert NO synthesized `kind:'calls'` from prose); affectedTests independent of impact; malformed for one capability → empty shape + schema diagnostic + capabilityHealth disables THAT capability (getStatus false), others live, re-enabled on later good parse; no `.codegraph` opened (grep-assert)
  - test-first: governance.js「T-cg-queries」drives fake-cli; unified shapes + provider-scoped ids, opaque explore/node, single-capability disable→re-enable, zero `.codegraph` refs; 红→绿

- [x] [task:cg-loader-register] register provider:codegraph + pass registration.options into create() (compatible loader enhancement)
  - files: templates/cli/code-perception/provider-loader.js
  - verify: node templates/cli/test.js governance
  - acceptance: DEFAULT_REGISTRY gains `'provider:codegraph': { role:'structural-primary', create: options => require('./providers/codegraph').create(options) }`; instantiation site changed to `regEntry.create(selection.options)` (native-lite/fixture unaffected by the extra arg); `loadProviders()` (no config) STILL returns exactly native-lite (① `T-cp-loader` #1 green); config-selected codegraph returns a registration (role structural-primary, source configured) whose provider ACTUALLY received the configured executable/prefixArgs/timeoutMs/allowNetwork (assert the values reached the adapter, e.g. via a probe on check()), not merely stored in registration.options; sanitizeOptions still strips dangerous fields; broken codegraph create isolates per ① contract
  - test-first: governance.js「T-cg-loader-register」asserts default native-lite-only, config-selected codegraph present with options reaching the adapter (configured fake executable drives its check), dangerous fields stripped; re-run `T-cp-loader` (no ① regression); 红→绿

- [x] [task:cg-cache] cache.js: file-based bounded cache + envelope + disk safety + whitelist + markStale
  - files: templates/cli/code-perception/cache.js
  - verify: node templates/cli/test.js governance
  - acceptance: `makeCacheKey` sha256 over canonical parts; `createCache({projectRoot, root=default, ttlMs, maxEntries=256, maxValueBytes=1MiB, now})` — missing projectRoot AND root → structured error (no process.cwd); entries persisted as `<64hex>.json` envelopes `{version,storedAt,stale,staleReason,currentCommit,value}`; get MISS on absent/TTL-expired, hit returns value byte-identical + effective freshness=envelope.stale; set → `{stored:false,reason:'cache-value-too-large'}` over 1MiB (size checked BEFORE read on get) and `{stored:false,reason:'uncacheable-kind'}` for non-whitelisted kinds (only status/normalized-metadata/links); markStale mutates envelope not value; disk safety: 64-hex-only filenames, symlink-component reject, project-root containment, atomic temp+rename, corrupt JSON→diagnostic+MISS (no throw), eviction only valid hash files; injected clock
  - test-first: governance.js「T-cg-cache」via createTempRuntimeRoot: key sensitivity, cross-instance file persistence (same root), TTL expiry (injected clock), too-large + uncacheable-kind rejection, markStale→get stale (value identical), invalidateOn clears, a symlinked root component rejected, corrupt file→MISS; 红→绿

- [x] [task:cg-status] status.js: code-perception status surface + stale hints (read-only)
  - files: templates/cli/code-perception/status.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildCodePerceptionStatus(context,{registrations,candidates,links})` aggregates candidates into providers[], emits staleHints[] (indexedCommit≠currentCommit → MANUAL sync message, never spawn) + links summary {confirmed,derived,proposed}; no subprocess; never throws
  - test-first: governance.js「T-cg-status」hand-built candidates (codegraph stale + native-lite ready) + links → staleHint manual-sync, no spawn, correct flags + counts; 红→绿

### Phase 3 — Governance Linker

- [x] [task:cg-linker-exact] governance-linker.js: reference-resolved declared + explicit-dep + git-derived file links (1.0)
  - files: templates/cli/code-perception/governance-linker.js
  - verify: node templates/cli/test.js governance
  - acceptance: `buildGovernanceLinks(inputs)` emits `declares_file` (planIR task.linkedFiles), `depends_on_file` (explicit `acceptanceDependencies`), `changed_by_commit` (commit.changedFiles) at confirmed/1.0; every link's `codeReferenceId` resolved by EXACT normalized filePath match against `fileReferences`; a relation with no matching reference → `unresolved-code-reference` diagnostic + NO dangling link; stable `id=gov-link:<16hex>`; dedupe by id; empty inputs → `{links:[],diagnostics:[]}`; reads NO acceptance/dependsOn from Markdown or IR; never throws
  - test-first: governance.js「T-cg-linker-exact」planIR+acceptanceDependencies+commit+fileReferences → three kinds at 1.0 with resolved ids; a linkedFile with NO matching fileReference → unresolved diagnostic + no link; a task with no acceptanceDependencies → no depends_on_file; 红→绿

- [x] [task:cg-linker-symbol] governance-linker.js: symbol links via diff-range∩symbolReferences + evidence/focus links
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: `implements_task` symbol links (derived) ONLY when a rule holds against `symbolReferences` (Plan names symbol / Evidence names symbol / commit diffRange intersects a symbolReference lineRange / test-evidence references it); confidence = symbolReference resolutionConfidence; a file with symbols but no matching rule → NO symbol link (assert negative); `verified_by_test`/`evidenced_by_archive` from evidence WITH a codeReferenceId or exactly-resolvable filePath/symbol (else no link + diagnostic); `related_to_focus` ONLY from pre-resolved `focusReferences` (free-text focus never yields confirmed/derived)
  - test-first: governance.js「T-cg-linker-symbol」commit diffRange intersecting exactly one of two symbolReferences → only that symbol linked; evidence without codeReferenceId/resolvable → no link + diagnostic; focusReferences → related_to_focus, raw focus text → none; 红→绿

- [x] [task:cg-linker-heuristic] governance-linker.js: heuristic proposals (≤0.5) + stored graph persistence + dedupe
  - files: templates/cli/code-perception/governance-linker.js (extend)
  - verify: node templates/cli/test.js governance
  - acceptance: name-only fuzzy Task-title↔symbol → `proposed`/`confidence<=0.5`, never confirmed/derived; every GovernanceCodeLink validates (id/governanceEntityId/codeReferenceId/kind∈7/status∈{confirmed,derived,proposed}/confidence/evidence); dedupe keeps strongest per id (confirmed>derived>proposed); `persistGovernanceLinks(root, links)` writes `.evo-lite/generated/code-perception/governance-links.json` with deterministic ordering + atomic temp+rename (the §3.4 stored graph); diagnostics for dropped/ambiguous heuristics
  - test-first: governance.js「T-cg-linker-heuristic」fuzzy→proposed≤0.5, exact supersedes proposed on dedupe, all links shape-valid, persistGovernanceLinks writes deterministic sorted JSON (two runs byte-identical); 红→绿

- [x] [task:cg-post-commit] post-commit-code-perception.js: §5 integration (refresh facts + markStale + rebuild+persist links + suggest manual sync) — AFTER linker exists
  - files: templates/cli/code-perception/post-commit-code-perception.js, templates/cli/hooks.js (guarded wire)
  - verify: node templates/cli/test.js governance
  - acceptance: `runPostCommitCodePerception({projectRoot,headSha,changedFiles,cache})` refreshes Native Lite facts, `cache.markStale({reason:'head',currentCommit:headSha})`, rebuilds commit/file links (buildGovernanceLinks with fileReferences from native-lite), `persistGovernanceLinks` (refresh `.evo-lite/generated/code-perception/governance-links.json`), writes `.evo-lite/generated/code-perception/post-commit-last-run.json` (deterministic + atomic), surfaces MANUAL sync when stale; **NEVER spawns `codegraph sync`/`init`** (grep-assert); wired into hooks.js post-commit GUARDED (Provider failure never fails the commit); existing hook tests green
  - test-first: governance.js「T-cg-post-commit」createTempRuntimeRoot + file cache with a codegraph entry → run fn → cache entry stale, governance-links.json + post-commit-last-run.json written deterministically, manual-sync suggestion present, NO codegraph subprocess, injected Provider failure doesn't throw out of the hook; 红→绿

- [x] [task:cg-failure-isolation] failure isolation across adapter+cache+linker (missing/not-indexed/timeout/schema-drift/stale)
  - files: templates/cli/code-perception/providers/codegraph.js (harden), templates/cli/code-perception/cache.js (harden)
  - verify: node templates/cli/test.js governance
  - acceptance: codegraph missing/timeout/malformed → ①'s loader+router still return Native Lite for `files` (degraded) + `candidate:null`+ready-centric reason for `impact`; Planning IR/Architecture IR/memory/verify untouched (assert none written); timeout → child killed + diagnostic + request degraded + provider NOT permanently disabled (subsequent healthy call succeeds); schema drift → single capability disabled then re-enabled; stale index → results returned but `freshness:'stale'` + indexedCommit/currentCommit (never fresh); diagnostics truncated
  - test-first: governance.js「T-cg-failure-isolation」fake-cli timeout/malformed/stale through ① loader+router with codegraph config-selected; fallback, exact no-substitution reason, non-permanent disable, stale visibility, no governance-artifact writes; 红→绿

- [x] [task:cg-dogfood-validate] dogfood-validate.js + `--require-live-codegraph` strict flag (fingerprint recompute)
  - files: templates/cli/code-perception/dogfood-validate.js, templates/cli/test.js (add --require-live-codegraph mode)
  - verify: node templates/cli/test.js governance
  - acceptance: `validateDogfoodArtifact(text,{requireClosureEvidence})` valid:true for dogfood-sample.md (metadata + RECOMPUTED matching fingerprints + all sections), valid:false w/ specific findings for dogfood-bad.md (missing section), a fingerprint-tampered copy (recompute mismatch), and a missing closureEvidenceCommit; strict mode `node ./.evo-lite/cli/test.js governance --require-live-codegraph` resolves the artifact at `<workspaceRoot>/docs/code-perception-codegraph-dogfood.md` where workspaceRoot comes from `EVO_LITE_WORKSPACE_ROOT` (or the runtime's resolved root), emits a distinct `live-codegraph-artifact-missing` finding/stderr token when absent and a validator-finding token when invalid/tampered, exit 1 in both cases, exit 0 only on a valid real artifact; normal `governance` (no flag) does NOT require the artifact; command keeps `node ./.evo-lite/cli/test.js` prefix
  - test-first: governance.js「T-cg-dogfood-validate」runs validator on the two samples + tampered + no-closure-evidence; the strict-mode subtest invokes `execFileSync(process.execPath, [<ABSOLUTE templates/cli/test.js>, 'governance', '--require-live-codegraph'], { env:{...process.env, EVO_LITE_WORKSPACE_ROOT: tempWorkspaceRoot} })` (absolute script path + explicit workspace root — NOT a relative path in a temp cwd, which would exit 1 for "script missing" and false-pass the test) against a temp workspace WITHOUT the artifact, and asserts the failure carries the `live-codegraph-artifact-missing` token (not merely a non-zero exit); 红→绿

- [x] [task:cg-manifest-sync] register all new files in manifest + mirror sync + full regression
  - files: templates/cli/template-manifest.js, .evo-lite/cli/code-perception/
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: manifest core-cli gains all new PRODUCTION modules (providers/codegraph-exec.js, providers/codegraph.js, cache.js, status.js, governance-linker.js, post-commit-code-perception.js, dogfood-validate.js) AND all new TEST assets (codegraph-fixture-manifest.json + 12 codegraph-* fixtures + fake-codegraph.js + dogfood-sample.md + dogfood-bad.md); sync-runtime converges to two consecutive `copied:0` (may take 3 runs); every new file byte-identical template↔mirror; `node ./.evo-lite/cli/test.js governance` (runtime) green with all T-cg-* + T-cp-*; `node templates/cli/test.js governance` (template) green; no other regression
  - (no separate unit test — sync double-run-zero + byte-identical + both suites green IS the acceptance)

- [ ] [task:cg-live-dogfood] host-gated real CodeGraph run → committed dogfood artifact (closes ac-live-codegraph-dogfood; strict-mode verified)
  - files: docs/code-perception-codegraph-dogfood.md
  - verify: node ./.evo-lite/cli/test.js governance --require-live-codegraph
  - acceptance: on a host with `@colbymchenry/codegraph@1.4.1` (`npm i -g @colbymchenry/codegraph@1.4.1`; `codegraph init` on create-evo-lite), capture a REAL run through the shipped adapter and write `docs/code-perception-codegraph-dogfood.md` with metadata `repoCommit:<implementation HEAD run against>`, `codegraphVersion`, `adapterVersion`, `closureEvidenceCommit:<same already-existing implementation HEAD>` (two-step protocol — a commit can't reference its own SHA; the artifact points at the PRIOR implementation HEAD it ran against, then is committed separately), fenced command/result blocks each with a recomputable `fingerprint: sha256:<hex>`, and all sections status/search/callers-callees/impact/current-focus/Task-to-Code/stale-index/fallback/limitations; `node ./.evo-lite/cli/test.js governance --require-live-codegraph` exits 0
  - HOST-GATE: if `@colbymchenry/codegraph@1.4.1` cannot be installed/run, leave this task UNCHECKED — plan+spec honestly stay `active` and `ac-live-codegraph-dogfood` stays open. Do NOT fake the artifact; record the capability gate reason.

## Follow-ups (OUTSIDE this plan)

- **Planning IR v2 — auto-extract acceptance dependencies:** teach `scan.js` to emit each task's `acceptance`/`dependsOn` into Planning IR (and spec-AC `dependsOn` into the spec model) so the linker derives `depends_on_file` without the explicit input. Until then the linker requires the explicit `acceptanceDependencies` (this plan).
- **Persistent source-context cache:** persist getEntity/explore opaque source only behind a redaction/classification contract (this MVP keeps it in-process transient).
- **UA / GitNexus adapters** (§1 deferred): more structural providers behind the same contract.

## Self-Review

**Spec coverage:** §2.0 identity → cg-detect. §2.1 detection (ready+indexState) → cg-detect. §2.2 mapping → cg-queries. §2.3 parsing/opaque → cg-queries. §2.4 compat + per-capability disable lifecycle → cg-detect/cg-queries. §2.5 security → cg-exec + cg-queries (no .codegraph). §2.6 network (fixed merge order) → cg-exec. §3 linker (kinds/confidence, reference-resolved, no dangling/guessing, stored graph) → cg-linker-exact/symbol/heuristic + persistGovernanceLinks. §4 cache (file-based, envelope, disk-safe, whitelist, stale-not-fresh) → cg-cache. §5 post-commit (act) → cg-post-commit (AFTER linkers); read surface → cg-status. §6 failure isolation → cg-failure-isolation. §7 fixtures (pinned) + validator (recompute) + strict flag + live run → cg-fixtures + cg-dogfood-validate + cg-live-dogfood. §8 layout (7 prod files) → cg-manifest-sync. §9 phases → Phase 2 / Phase 3. AC ac-codegraph-adapter (dependsOn incl. codegraph-exec.js) → cg-exec/cg-queries; ac-governance-linker → cg-linker-*; ac-provider-failure-isolation → cg-failure-isolation; ac-live-codegraph-dogfood (strict-mode verifier) → cg-dogfood-validate + cg-live-dogfood. Closure honesty: live AC's strict verifier cannot PASS without a real artifact, and cg-live-dogfood stays unchecked (spec active) until a capable host runs it.

**Type consistency:** capabilities match ①'s validateProvider (modules=false, no method for false caps); normalize via explicit translators with shipped signatures; loader create(options) is a compatible enhancement (native-lite ignores the arg); GovernanceCodeLink shape per §3.4 with every codeReferenceId reference-resolved; cache clock injected; linker inputs use only IR-present data (task.linkedFiles) + explicit reference inputs; SUPPORTS_POSITIONAL_SEPARATOR is a frozen production constant asserted equal to the fixture manifest.
