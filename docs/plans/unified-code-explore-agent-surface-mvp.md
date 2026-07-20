---
id: plan:unified-code-explore-agent-surface-mvp
title: Unified Code Explore — Agent Surface (Phase 4a)
status: active
linkedSpec: spec:unified-code-explore-wiki-projection
---

# Unified Code Explore — Agent Surface (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the ONE shared Unified Explore service and the two surfaces an agent actually consumes — `mem code` CLI and the `evo_code_explore` MCP tool — driving structural exploration plus file/commit/focus governance links, and gated by composition tests that run the REAL producers (not hand-written fixtures) so the service reads what those producers actually emit. The M1/M2 adapter↔linker seams are implemented and unit-proven but DORMANT on the built-in pipeline (the default producer emits no `task.symbols` and only opaque string evidence — see Grounded reality); they are the forward-compatibility path for a future explicit producer, not a shipped default capability.

**Architecture:** A single stateless service (`code-perception.js#exploreCode`) orchestrates sub-spec ①'s router/loader + ②'s adapter/linker/status per spec §2.2, converts references through the one M1 seam (`normalize.js#toSymbolReferences`), floors derived-link confidence through the one M2 seam (`normalize.js#normalizeDerivedLinkConfidence`), and returns a `UnifiedExploreResult`. Two thin surfaces (CLI group, MCP tool) call that one service — no duplicate logic. New files are registered as managed core-cli templates and mirrored byte-identical via the bootstrap-safe `sync-runtime-entry`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`, no build step), commander (existing CLI framework), `@modelcontextprotocol/sdk` (existing MCP server), Node `assert` test harness (`templates/cli/test/*.js`). Windows-first. `node:crypto`/`node:fs`/`node:path` builtins only for new code; no new dependencies.

## Scope: why this plan is Phase 4a only

Spec `spec:unified-code-explore-wiki-projection` covers four surfaces. This plan implements the **agent-facing** half (service + CLI + MCP) — the part that makes the ①② investment visible and, more importantly, the part that finally **integration-tests ①②** by composing them behind one consumer.

The **human projection** half (Code Wiki, Inspector Code page) is split into `plan:code-wiki-inspector-projection`, which is **parked**: it is the highest-cost, lowest-demo-value third of the spec, and nothing yet demonstrates that users want a persistent browsable surface when `mem code explore` + MCP already answer the question. That plan documents its own activation criteria.

**Completing this plan does NOT close the parent spec.** On completion: `plan:unified-code-explore-agent-surface-mvp = done`, `spec:unified-code-explore-wiki-projection` stays **adopted/active** (the Wiki/Inspector acceptance criteria remain open), `plan:code-wiki-inspector-projection` stays **parked**. Do not mark the spec done to "finish" it — that would trade an honest open AC for an unvalidated implementation.

## Global Constraints

*(These bind every task. Exact values copied from the spec + task brief.)*

- One shared Unified Explore service backs `mem code` CLI + `evo_code_explore` MCP + Code Wiki + Inspector — NO duplicate logic.
- **M1:** a SINGLE `toSymbolReferences(matches: CodeReference[], opts?) -> SymbolReference[]` (shape `{reference, filePath?, lineRange?, resolutionConfidence}`) owned by `code-perception/normalize.js` is the ONLY converter feeding the ② linker's `symbolReferences` input. No other module reshapes references for the linker.
- **M2:** derived (`status:'derived'`) `implements_task` links must never carry confidence 0/undefined into ranking/projection. Define `DERIVED_LINK_CONFIDENCE_FLOOR` (> 0, e.g. 0.15) and either set `resolutionConfidence` to at least the floor in `toSymbolReferences` AND/OR floor derived-link confidence after `buildGovernanceLinks`. Tests must assert no derived link ends at 0.
- **Unified exit/error model (§3.1):** capability-insufficiency is success-shaped (exit 0 / isError false / degraded diagnostics). exit1/isError only for: security violation, internal invariant/adapter exception, JSON schema fully unparseable, no legal response with no fallback. CLI invalid args → exit 2.
- **Code Wiki (§5):** `.evo-lite/generated/code-wiki/` is pure-derived + read-only; NO canonical human truth stored there; deleting the whole dir + rebuild reproduces every page. Pages carry provenance frontmatter.
- **Mirror parity:** mirror sync uses the canonical bootstrap-safe `node ./.evo-lite/cli/sync-runtime-entry.js` (NOT `memory.js sync-runtime`); first run may seed from `node templates/cli/sync-runtime-entry.js`; a second entry run reports zero changes; new files byte-identical (verify via Node `Buffer.equals`, not shell diff).
- **Windows-first** (repo root `d:\Data\ProjectAgent\create-evo-lite`; `path.join`; child spawns `process.execPath`). Never edit `.evo-lite/cli/**` by hand.
- **Provider security invariants from ①②:** never auto-install / `codegraph init`, never read `.codegraph` internals, path-containment before read, no-shell `execFile`. The service is read-only and must not spawn writes.


## Grounded reality (verified against the code — read before implementing)

These facts were verified in the current tree and shape the faithful bridges below. See the **Spec-vs-reality conflicts** note at the end for the four that diverge from a literal spec read.

- **`native-lite` capabilities** (`code-perception/native-lite.js#buildCapabilities`) are `files:true, source:true, modules:true` — everything symbol-graph shaped (`symbols`, `semanticSearch`, `callers`, `callees`, `impact`, `affectedTests`, ...) is `false`. Native Lite exposes methods `check, getStatus, getFiles, getEntity` ONLY (no `search`/`getCallers`/`getCallees`/`impact`). So when CodeGraph is absent (the common dogfood state) `selectProvider({capability:'symbols'})` returns `candidate:null, reason:"No ready provider exposes symbols analysis"`, and `matches` is `[]`. This is success-shaped degradation, not an error.
- **`selectProvider`** (`provider-router.js`) is pure/sync; provider instance is `selection.candidate.registration.provider`; degraded fallback sets `selection.degraded=true`; no-capability sets `candidate:null` + `reason`.
- **Built-in Planning IR emits NO structured evidence — the default pipeline produces no live symbol/evidence governance links.** `scanPlanning` (`planning/scan.js`) populates `task.linkedFiles` but **never** `task.symbols` (verified: 0 of 205 tasks). And `task.evidence` rows are **opaque strings**, not objects: `planning/parse-markdown.js:63` pushes `- evidence:` lines as trimmed strings, and `planning/scan.js:164` merges `backfillArchiveEvidence`'s output — also strings like `"archive:mem_….md"` (verified: 131 of 131 evidence rows are strings, 0 objects). No producer anywhere emits `{symbols, commitSha, codeReferenceId, filePath}` evidence rows. Therefore the linker's rule-gated links — `implements_task:derived` (needs `task.symbols` OR `evidence.symbols` OR an `evidence.commitSha` diff-range tie), `verified_by_test`, `evidenced_by_archive` (both need `evidence.codeReferenceId` OR a resolvable `evidence.filePath`) — are **ALL unreachable on the default data**. What DOES fire: `declares_file` (1.0), `changed_by_commit` (1.0), `related_to_focus` (1.0), and the weak `implements_task:proposed` (title-heuristic, ≤0.5, needs no evidence). **M1/M2 are correct but DORMANT compatibility seams** for a future explicit producer / configured planning provider / Evidence IR — they are NOT evidence that the built-in pipeline produces Task-to-Symbol links. The service must retain opaque evidence verbatim (as `{taskId, raw, linkable:false}`), emit ONE aggregated `unstructured-evidence` diagnostic, and never synthesize a code anchor it did not receive.
- **`buildGovernanceLinks`** (`governance-linker.js`) `implements_task` derived confidence is `clampConfidence(symRef.resolutionConfidence)` → **0 when `resolutionConfidence` is undefined** (the M2 trigger). `declares_file`/`depends_on_file`/`changed_by_commit` are conf 1.0; heuristic `implements_task` proposed is ≤0.5; `verified_by_test`/`evidenced_by_archive`/`related_to_focus` are 1.0.
- **`readActiveContext`** is exported by `memory.service.js` (canonical, full parse). `sections.focus` is FREE TEXT — no structured spec/task field. Its `tasks[]` come from `parseBacklogTasks`, whose row shape is **`{checked, hash, line, text}`** — there is **NO `id` field**.
- **The active-context backlog is NOT a task registry.** `hash` is a free-form human slug — real rows from this repo parse to `hash: 'fresh-plan-progress'` and `hash: '06fd'`. These never equal a Planning-IR task id (`task:ce-seam`), so matching backlog rows against `planIR.tasks` cannot fire on real data. Verified by running the real parser over the real file.
- **Real FOCUS text has no task id.** `advanceFocusFromCommit` writes `"<plan title>: <task title>"` — e.g. `Unified Code Explore & Code Wiki Projection Implementation Plan: M1/M2 reference seam in normalize.js`. Therefore **exact task-title match is the only automatic focus bridge that fires in production**; an id match only works when a human or `--task` supplies one.
- **`templates/cli/memory.js` cannot be spawned bare.** It requires `memory.service → db.js → better-sqlite3`, which is NOT in the package's dependencies — it lives in the workspace runtime's `.evo-lite/node_modules`. Any test spawning the template CLI must set `NODE_PATH` to that directory (idiom: `harness.js:18`, `integration.js:650/678/705`). `templates/cli/test.js` itself runs fine because it never top-level-requires `db.js`.
- **`post-commit-last-run.json`** (written by `post-commit-code-perception.js`) has shape **`{commit: '<headSha>', changedFiles: [...], ...}`** — the key is `commit`, NOT `commits`/`headSha`.
- **`changed_by_commit`** links are keyed by **`governanceEntityId = 'commit:<sha>'`** (governance-linker.js), NOT by task id. Task→commit association must go through `evidence.taskId + evidence.commitSha`; module→commit through `commit.changedFiles ∩ module.files`. Filtering `changed_by_commit` by a task id always returns empty.
- **CLI registration:** `memory.js` registers feature groups through `safeRegister('<name>', () => require('./mod').registerXCommands(program))` (thunked require so a missing module warns, never bricks the CLI). Existing `code-perception` group registers `mem code-perception post-commit`.
- **MCP server** (`mcp-server.js`): `TOOLS[]` array + `dispatch()` `switch(name)` + `freshRequire(relPath)` hot-reload; CallTool handler wraps result in `{content:[{type:'text',text:JSON.stringify(result)}]}` and only sets `isError:true` when the handler throws.
- **MCP validator** (`mcp-validate.js`): spawns `mem mcp`, calls each tool in its own `TOOLS[]` list, writes `.evo-lite/generated/mcp-validation.json`, `process.exit(ok===total?0:1)`. AC `ac-mcp-code-explore` runs this file, so the new tool must be added to its list AND its `summarise()`.
- **Inspector** (`inspector.js`): `handleApi(req,res)` dispatches `if (url === '/api/...')` on the **full** `req.url` (query string included); `startServer` strips the query only for the page-vs-api decision. Exports `{buildVerifyJson, extractTrajectory, extractActiveContext, listArchiveFiles, runInspectCommand, startServer}`.
- **Test harness** (`test/harness.js`): `createTempRuntimeRoot`, `bootstrapRuntime`, `captureConsole`, `writeText`, `WORKSPACE_ROOT`, `TEMPLATE_CLI_DIR`, `CLI_DIR`. Governance tests are sequential `assert` blocks inside `runGovernanceTests()` in `test/governance.js`, each labelled with a `console.log('Txx ...')`.
- **`template-manifest.js`**: managed core-cli file list is `MANAGED_TEMPLATE_FAMILIES[0].files`. Adding a managed file = append its `cli/`-relative path there.

---


## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `templates/cli/code-perception/normalize.js` (modify) | + M1 `toSymbolReferences`, M2 `DERIVED_LINK_CONFIDENCE_FLOOR` + `normalizeDerivedLinkConfidence` | T1 |
| `templates/cli/code-perception.js` (create) | Unified Explore service: `exploreCode`, `rankRecommendedReading`; §3.1 fatal gate | T2 |
| `templates/cli/test/governance.js` (modify) | `T-ce-seam`, `T-ce-explore-A/B/B2/C`, `T-ce-compose-A/B/C`, `T-ce-cli`, `T-ce-mcp`, `T-ce-manifest-sync-4a` | T1–T6 |
| `templates/cli/code-perception/cli.js` (create) | `mem code` command group `registerCodeCommands` + unified exit model | T4 |
| `templates/cli/memory.js` (modify) | `safeRegister('code', …)` thunk | T4 |
| `templates/cli/mcp-server.js` (modify) | `evo_code_explore` TOOLS entry + dispatch case + exported handler | T5 |
| `templates/cli/mcp-validate.js` (modify) | add `evo_code_explore` to validator TOOLS + `summarise` | T5 |
| `templates/cli/template-manifest.js` (modify) | register the 2 new managed files | T6 |

**Explicitly NOT in this plan** (they belong to `plan:code-wiki-inspector-projection`): `code-perception/wiki.js`, `inspector.js`, and the `code-perception/status.js` row enrichment (`capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit`) — that enrichment exists ONLY to feed the Wiki provenance and the Inspector Code page, so it ships with them. Nothing in 4a reads those fields.

## Task order

```
T1 ce-seam           M1/M2 reference seam (normalize.js)
T2 ce-explore-service Unified Explore service
T3 ce-compose        REAL producer→consumer composition tests   ← integration gate
T4 ce-mem-code-cli   `mem code` command group
T5 ce-mcp            `evo_code_explore` MCP tool
T6 ce-manifest-sync  manifest registration + 4a mirror closure
```

T3 sits immediately after the service, not at the end, so a producer/consumer shape mismatch fails **before** two surfaces get built on top of a wrong service. This ordering is a direct response to the defects found during plan review: three real shape mismatches (`post-commit-last-run.json`, active-context rows, `changed_by_commit` keying) survived in shipped, governance-green ①② code precisely because every test wrote its own idealized producer output by hand.

---

### Task 1: M1/M2 reference seam in normalize.js

**Files:**
- Modify: `templates/cli/code-perception/normalize.js`
- Test: `templates/cli/test/governance.js` (append block `T-ce-seam`)

**Interfaces:**
- Consumes: existing `normalize.js` internals (`isPlainObject`, `clampConfidence`, `normalizeReference`). CodeReference shape `{id, providerId, providerEntityId, kind, name, filePath?, lineRange?, provenance:{confidence}}`.
- Produces (relied on by T2, T5):
  - `DERIVED_LINK_CONFIDENCE_FLOOR: number` (= `0.15`).
  - `toSymbolReferences(matches: CodeReference[], opts?: string | {focusId?: string}) -> SymbolReference[]` where `SymbolReference = {reference: CodeReference, filePath?: string, lineRange?: [number,number], resolutionConfidence: number}`. Pure, total, never throws, never drops a match; a match with no resolvable `reference.id` becomes a `{code:'unresolved-reference', ...}` diagnostic-shaped entry is NOT produced here (the linker emits that) — instead its `resolutionConfidence` is floored so downstream never sees 0.
  - `normalizeDerivedLinkConfidence(links: Link[]) -> Link[]` — pure; returns a NEW array; for every `link.status==='derived'` whose `confidence` is missing/0/non-finite, sets `confidence = DERIVED_LINK_CONFIDENCE_FLOOR`; leaves `confirmed`/`proposed` links untouched.

- [ ] **Step 1: Write the failing test** — append inside `runGovernanceTests()` try-block in `templates/cli/test/governance.js`, after the last existing `T-…` block (before the final success `console.log`):

```javascript
        console.log('T-ce-seam. Testing M1 toSymbolReferences + M2 derived-confidence floor ...');
        {
            const norm = require(require('path').join(TEMPLATE_CLI_DIR, 'code-perception', 'normalize.js'));
            const { toSymbolReferences, normalizeDerivedLinkConfidence, DERIVED_LINK_CONFIDENCE_FLOOR } = norm;

            // Floor is a real positive number.
            assert.ok(typeof DERIVED_LINK_CONFIDENCE_FLOOR === 'number' && DERIVED_LINK_CONFIDENCE_FLOOR > 0,
                'DERIVED_LINK_CONFIDENCE_FLOOR must be a positive number');

            // (a) flat CR[] -> wrapper shape, carrying filePath/lineRange, nonzero confidence.
            const cr = {
                id: 'code-ref:provider:codegraph:abc123abc123', providerId: 'provider:codegraph',
                providerEntityId: 'sym-1', kind: 'function', name: 'selectEngine',
                filePath: 'src/engine.js', lineRange: [10, 42],
                provenance: { providerId: 'provider:codegraph', method: 'provider-structural', authority: 'structural', confidence: 0.9 },
            };
            const [wrapped] = toSymbolReferences([cr]);
            assert.strictEqual(wrapped.reference, cr, 'wrapper must carry the original reference');
            assert.strictEqual(wrapped.filePath, 'src/engine.js', 'wrapper must lift filePath');
            assert.deepStrictEqual(wrapped.lineRange, [10, 42], 'wrapper must lift lineRange');
            assert.ok(wrapped.resolutionConfidence > 0, 'resolved match must have nonzero resolutionConfidence');

            // (b) unresolved / zero-confidence match -> floored (never 0), still not dropped.
            const weak = { id: 'code-ref:x:0', providerId: 'x', providerEntityId: '', kind: 'unknown', name: '',
                provenance: { providerId: 'x', method: 'heuristic', authority: 'enrichment', confidence: 0 } };
            const out = toSymbolReferences([cr, weak]);
            assert.strictEqual(out.length, 2, 'toSymbolReferences must never drop a match');
            assert.ok(out[1].resolutionConfidence >= DERIVED_LINK_CONFIDENCE_FLOOR,
                'unresolved match resolutionConfidence must be floored, never 0');

            // (c) derived link floor pass: derived@0 and derived@undefined -> floor; confirmed/proposed untouched.
            const links = [
                { id: 'a', status: 'derived', confidence: 0 },
                { id: 'b', status: 'derived', confidence: undefined },
                { id: 'c', status: 'confirmed', confidence: 1 },
                { id: 'd', status: 'proposed', confidence: 0.4 },
            ];
            const floored = normalizeDerivedLinkConfidence(links);
            assert.strictEqual(floored[0].confidence, DERIVED_LINK_CONFIDENCE_FLOOR, 'derived@0 must be floored');
            assert.strictEqual(floored[1].confidence, DERIVED_LINK_CONFIDENCE_FLOOR, 'derived@undefined must be floored');
            assert.strictEqual(floored[2].confidence, 1, 'confirmed must stay 1.0');
            assert.strictEqual(floored[3].confidence, 0.4, 'proposed must keep its value');
            assert.strictEqual(links[0].confidence, 0, 'normalizeDerivedLinkConfidence must be pure (no mutation)');
            for (const l of floored) assert.ok(!(l.status === 'derived' && !(l.confidence > 0)), 'no derived link may end at 0');
        }
        console.log('✅ T-ce-seam M1/M2 seam passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-seam|not a function|is not|AssertionError" | head`
Expected: FAIL — `TypeError: toSymbolReferences is not a function` (or the `DERIVED_LINK_CONFIDENCE_FLOOR must be a positive number` assertion).

- [ ] **Step 3: Write the implementation** — in `templates/cli/code-perception/normalize.js`, add the constant + two functions above the `module.exports` block:

```javascript
// ── M1/M2 adapter↔linker seam (spec §2.4) ─────────────────────────────────────
// The SINGLE conversion from flat CodeReference[] (① search output) to the
// wrapper shape ② governance-linker consumes as `symbolReferences`. Owning it
// here (shared with ①) guarantees no other module reshapes references for the
// linker. Pure, total: never throws, never drops a match. An unresolvable
// match keeps its slot with a floored confidence so a downstream derived link
// can never be silently born at 0 (M2).

const DERIVED_LINK_CONFIDENCE_FLOOR = 0.15;

function toSymbolReferences(matches, opts) {
    const focusId = typeof opts === 'string' ? opts : (isPlainObject(opts) ? opts.focusId : undefined);
    void focusId; // reserved for future focus-scoped resolution; linker binds by name today.
    const list = Array.isArray(matches) ? matches : [];
    const out = [];
    for (const raw of list) {
        // Accept an already-normalized CodeReference or a best-effort normalize.
        const reference = isPlainObject(raw) && typeof raw.id === 'string' && raw.id
            ? raw
            : normalizeReference(isPlainObject(raw) ? raw.providerId : undefined, raw);
        const provConf = clampConfidence(reference.provenance && reference.provenance.confidence);
        const resolutionConfidence = provConf > 0 ? provConf : DERIVED_LINK_CONFIDENCE_FLOOR;
        const symRef = { reference, resolutionConfidence };
        if (reference.filePath !== undefined) symRef.filePath = reference.filePath;
        if (reference.lineRange !== undefined) symRef.lineRange = reference.lineRange;
        out.push(symRef);
    }
    return out;
}

// M2 defensive floor pass: run AFTER buildGovernanceLinks, BEFORE ranking /
// projection / any consumer filter. A rule-gated derived link whose confidence
// is missing/0/non-finite is raised to the floor so recommended-reading and
// Wiki/Inspector never drop it merely for a missing score. Confirmed stays 1.0;
// proposed keeps its <=0.5 value. Pure — returns a new array.
function normalizeDerivedLinkConfidence(links) {
    const list = Array.isArray(links) ? links : [];
    return list.map(link => {
        if (!isPlainObject(link)) return link;
        if (link.status === 'derived') {
            const c = link.confidence;
            if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) {
                return Object.assign({}, link, { confidence: DERIVED_LINK_CONFIDENCE_FLOOR });
            }
        }
        return link;
    });
}
```

Then extend the exports:

```javascript
module.exports = {
    makeReferenceId,
    normalizeReference,
    normalizeSearchResult,
    normalizeRelationship,
    normalizeImpactResult,
    toSymbolReferences,
    normalizeDerivedLinkConfidence,
    DERIVED_LINK_CONFIDENCE_FLOOR,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-seam"`
Expected: PASS — `✅ T-ce-seam M1/M2 seam passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception/normalize.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(code-perception): M1 toSymbolReferences + M2 derived-confidence floor (task:ce-seam)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Unified Explore service

**Files:**
- Create: `templates/cli/code-perception.js`
- Test: `templates/cli/test/governance.js` (append block `T-ce-explore`)

*(The `code-perception/status.js` row enrichment — `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit` — is NOT part of 4a. Nothing here reads those fields; they exist only for the Wiki provenance and the Inspector Code page, so they ship with `plan:code-wiki-inspector-projection`. `result.providers` in 4a is whatever `buildCodePerceptionStatus` returns today.)*

**Interfaces:**
- Consumes:
  - `./code-perception/provider-loader.js#loadProviders(config, opts) -> {registrations, diagnostics}` (native-lite always appended).
  - `./code-perception/provider-router.js#{inspectProviders(registrations, context) -> Candidate[], selectProvider(request, candidates) -> Selection}`; provider instance = `selection.candidate.registration.provider`.
  - Provider methods (async, never throw): `getFiles(ctx)->{files:[{reference,changed,...}],diagnostics}`, `search(ctx,query)->{matches:CR[],diagnostics}`, `getCallers/getCallees(ctx,symbol)->{relationships,diagnostics}`, `impact(ctx,symbol)->ImpactResult`, `getEntity(ctx,{entity})->{reference,content,truncated,diagnostics}`.
  - `./code-perception/normalize.js#{normalizeSearchResult, normalizeRelationship, normalizeImpactResult, toSymbolReferences, normalizeDerivedLinkConfidence, DERIVED_LINK_CONFIDENCE_FLOOR}` (M1/M2 from T1).
  - `./code-perception/governance-linker.js#buildGovernanceLinks(inputs) -> {links, diagnostics}`.
  - `./code-perception/status.js#buildCodePerceptionStatus(context, {candidates, links}) -> {providers, staleHints, links, diagnostics}`.
  - `./memory.service.js#readActiveContext() -> {sections:{focus},summary:{focus,...},tasks:BacklogTask[],...}`.
  - `./runtime.js#{getWorkspaceRoot, getEvoConfig}`.
  - Planning IR read inline from `<root>/.evo-lite/generated/planning/plan-ir.json`.
- Produces (relied on by T3, T4, T5, T6):
  - `async exploreCode(query: string, opts?: ExploreOpts) -> UnifiedExploreResult`. `ExploreOpts = {focusId?, preferredProvider?, includeSource?, includeImpact?, includeGovernance?, maxResults?, maxSourceChars?, projectRoot?, config?, registry?, activeContext?, commits?, acceptanceDependencies?}`. `projectRoot`/`config`/`registry`/`activeContext`/`commits`/`acceptanceDependencies` are DI seams for tests and callers — `activeContext` overrides the host-bound `memory.service.readActiveContext()` (which is pinned to a module-load `ACTIVE_CONTEXT_PATH`, so a foreign `projectRoot` with no injected `activeContext` gets an EMPTY context + diagnostic, never the host's focus). `commits`/`acceptanceDependencies` feed the ② linker's Layer-1/Layer-2 inputs; when omitted, `commits` is read from the persisted post-commit run (explore never shells `git log`). Never throws; internal exceptions become diagnostics + `result.ok=false` only for true invariant breaks.
  - Reads (best-effort, may be absent): `<root>/.evo-lite/generated/code-perception/governance-links.json` (persisted graph — merged, deduped by link id, so `changed_by_commit` links survive into explore) and `.../post-commit-last-run.json`, whose REAL shape is `{ commit: '<headSha>', changedFiles: [...] }` (verified in `post-commit-code-perception.js` — it writes `commit`, there is NO `commits` or `headSha` key; reading those would silently yield zero commits).
  - `rankRecommendedReading(inputs) -> ReadingItem[]` where `ReadingItem = {path, kind, reason, priority, confidence}` sorted by §2.3 order.
  - `UnifiedExploreResult = {query, ok, freshness, providers, matches, relationships, impact?, source, files, modules, focus, governance, recommendedReading, diagnostics}` (spec §2). `focus = {entityId, taskId, resolved}` — the CANONICAL resolved focus; the Wiki/Inspector must render this rather than re-deriving focus (e.g. "all unfinished tasks" is not the focus). `ok:false` is returned for the §3.1 FATAL set only (`adapter-exception`, `security-violation`, `unparseable-response`, `internal-error`) — capability gaps stay `ok:true`. `freshness = {stale, dirty, indexedCommit?, currentCommit?}`. `governance = {specs, plans, tasks, commits, evidence, links, linkSummary}`. `governance.evidence` retains ALL real evidence verbatim (opaque built-in rows appear as `{taskId, raw, linkable:false}`; structured rows are kept as-is with a `linkable` flag). Only rows carrying a linker signal (`codeReferenceId` / `filePath` / non-empty `symbols` / `commitSha`) are handed to the linker — NOT narrowed to code anchors, so a future structured `{symbols}`/`{commitSha}` row still reaches the derived-link rules. On the default pipeline the producer emits none of these signals, so `implements_task:derived` / `verified_by_test` / `evidenced_by_archive` are **not produced** and an aggregated `unstructured-evidence` diagnostic explains why (see Grounded reality). `files = string[]` (sorted repo-relative paths from native-lite file facts). `modules = [{id, files:string[], taskIds:string[], changed}]` (declared moduleId, else top-level path segment). Both are produced here but consumed only by the parked Phase 4b Wiki (module pages + unresolved-link detection); they stay in the shape so activating 4b needs no T2 signature change.

- [ ] **Step 1: Write the failing test** — append inside `runGovernanceTests()` after the T-ce-seam block. FOUR scenarios (a single test cannot exercise all provider realities). **Scenario A** = the native-lite degradation dogfood (the common host state — no structural provider; also pins the real post-commit blob shape + the real backlog `hash` shape); **Scenario B** = an injected structural fixture provider (proves the full symbol/relationship/impact/source path and that M1 produces valid SymbolReferences — while asserting the service does NOT fabricate symbol-level governance links the built-in producer can't supply); **Scenario B2** = a compatibility-contract test proving a structured `evidence.symbols` row (no code anchor) still reaches the linker — guarding the dormant seam against being severed at the service layer, WITHOUT claiming the built-in producer emits that shape; **Scenario C** = a ready provider that throws, proving the SERVICE itself produces the `ok:false` fatal that T4's and T5's surface mappings depend on. All `git init` the temp workspace because native-lite `getFiles` runs `git ls-files --cached --others --exclude-standard` and returns `files:[]` + a `git-enumeration-failed` diagnostic when the root is not a repo — so without a real repo the file facts (and every `declares_file` link) would be empty and the asserts could never pass.

```javascript
        const { execFileSync } = require('node:child_process');
        function gitInit(root) {
            // Minimal repo so native-lite `git ls-files` enumerates the tree.
            execFileSync('git', ['init', '-q'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'test@evo.local'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'evo-test'], { cwd: root });
            execFileSync('git', ['add', '-A'], { cwd: root });
            execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
        }
        function seedPlanIR(runtimeRoot, tasks, plans) {
            const planDir = path.join(runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            fs.writeFileSync(path.join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: plans || [], tasks: tasks || [], warnings: [],
            }, null, 2), 'utf8');
        }

        console.log('T-ce-explore-A. Unified explore — native-lite degradation is success-shaped ...');
        {
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-explore-a');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'], evidence: [] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime.workspaceRoot);
            // Persisted post-commit blob in its REAL shape ({commit, changedFiles}) —
            // this is the ONLY commit source explore has (it never shells `git log`).
            const cpDir = path.join(runtime.runtimeRoot, 'generated', 'code-perception');
            fs.mkdirSync(cpDir, { recursive: true });
            const FIXTURE_SHA = 'a'.repeat(40);
            fs.writeFileSync(path.join(cpDir, 'post-commit-last-run.json'), JSON.stringify({
                commit: FIXTURE_SHA, changedFiles: ['src/engine.js'],
            }, null, 2), 'utf8');

            // No codegraph configured -> native-lite fallback. `symbols` absent -> matches [].
            // activeContext is injected so the host repo's focus never leaks into the fixture.
            // FOCUS text uses the REAL production shape "<plan title>: <task title>" written by
            // advanceFocusFromCommit — it contains NO task id, so the exact-title bridge is what
            // must resolve it. The backlog rows carry a realistic free-form human slug: they are
            // deliberately IRRELEVANT to focus resolution and must not influence the result
            // (the backlog is a scratchpad, not a task registry — see Grounded reality).
            const result = await svc.exploreCode('engine selection', {
                projectRoot: runtime.workspaceRoot, config: {}, includeSource: false, includeImpact: true,
                activeContext: {
                    sections: { focus: 'Demo Plan: Engine' },
                    summary: { focus: 'Demo Plan: Engine' },
                    tasks: [{ hash: 'fresh-plan-progress', checked: false, line: '- [ ] [fresh-plan-progress] Example backlog item', text: 'Example backlog item' }],
                    trajectory: [],
                },
            });

            assert.strictEqual(result.ok, true, 'A: capability gap must be success-shaped (ok:true)');
            assert.strictEqual(result.matches.length, 0, 'A: no structural provider -> zero symbol matches');
            // The persisted commit must actually reach governance (blob key is `commit`).
            assert.strictEqual(result.governance.commits.length, 1, 'A: persisted post-commit blob yields exactly one commit');
            assert.strictEqual(result.governance.commits[0].sha, FIXTURE_SHA, 'A: governance.commits carries the fixture SHA');
            const changedLinks = result.governance.links.filter(l => l.kind === 'changed_by_commit');
            assert.ok(changedLinks.length >= 1, 'A: changed_by_commit links built from the persisted commit + file facts');
            assert.ok(changedLinks.every(l => l.governanceEntityId === `commit:${FIXTURE_SHA}`),
                'A: changed_by_commit is keyed by commit:<sha> (NOT a task id)');
            assert.strictEqual(result.focus.entityId, 'task:x',
                'A: focus resolves through the exact task title in REAL FOCUS text; the backlog hash is irrelevant to resolution');
            assert.ok(result.diagnostics.some(d => (d.code || '') === 'capability-unavailable'),
                'A: a capability-unavailable diagnostic explains the missing symbols capability');
            const nl = result.providers.find(p => /native-lite/.test(p.id || ''));
            assert.ok(nl && nl.ready === true, 'A: native-lite provider present and ready');
            // declares_file (conf 1.0) from task.linkedFiles ∩ native-lite file facts; and NO dangling link.
            const declares = result.governance.links.filter(l => l.kind === 'declares_file');
            assert.ok(declares.length >= 1, 'A: declares_file link derived from linkedFiles + native-lite file facts');
            // No dangling: every link points at a real code-ref id (file facts / matches).
            for (const l of result.governance.links) {
                assert.ok(/^code-ref:/.test(l.codeReferenceId), 'A: every link points at a real code-ref id (no dangling)');
            }
            // No derived link may carry 0 (M2 wired through the service).
            for (const l of result.governance.links) {
                assert.ok(!(l.status === 'derived' && !(l.confidence > 0)), 'A: service must floor derived links (M2)');
            }
            assert.ok(result.recommendedReading.length >= 1, 'A: recommendedReading non-empty');
            assert.ok(result.recommendedReading.some(r => /engine\.js$/.test(r.path)), 'A: recommendedReading contains the fixture file');
            for (const r of result.recommendedReading) assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'A: every reading item explains why');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore-A native-lite degradation passed');

        console.log('T-ce-explore-B. Unified explore — injected structural provider drives the full path ...');
        {
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-explore-b');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            // Evidence uses the REAL built-in producer shape: an opaque string. It must NOT
            // fabricate a rule-gated link, and it must survive verbatim into governance.evidence.
            // (A structured {symbols,...} row would be a shape no producer emits — the exact
            // category error this suite exists to prevent.)
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'],
                   evidence: ['archive:mem_2026-07-15_demo.md'] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime.workspaceRoot);

            // A structural provider shaped to the SERVICE call sites (NOT the shared
            // fixture-provider.js, whose getCallers returns a bare array by ①'s contract).
            const PID = 'provider:fixture-structural';
            const structuralStatus = {
                providerId: PID, adapterVersion: '0.0.1', providerVersion: '9.9.9', available: true, ready: true,
                indexState: 'ready', freshness: 'fresh', dirty: 'clean', compatibility: 'supported',
                capabilities: { files: false, symbols: true, source: true, callers: true, callees: true, impact: true, affectedTests: false, modules: false },
                diagnostics: [],
            };
            const structuralProvider = {
                id: PID, name: 'Fixture Structural', adapterVersion: '0.0.1', capabilities: structuralStatus.capabilities,
                async check() { return { available: true, ready: true, installed: true, indexState: 'ready' }; },
                async getStatus() { return structuralStatus; },
                // RAW matches -> the service normalizes via normalizeSearchResult(status, raw).
                async search() { return { query: 'engine', matches: [{ providerEntityId: 'sym:selectEngine', name: 'selectEngine', kind: 'function', filePath: 'src/engine.js', lineRange: [1, 1] }], diagnostics: [] }; },
                async getCallers() { return { relationships: [{ providerId: PID, source: { name: 'main', filePath: 'src/main.js' }, target: { name: 'selectEngine', filePath: 'src/engine.js' }, kind: 'called_by', confidence: 0.9 }], diagnostics: [] }; },
                async getCallees() { return { relationships: [], diagnostics: [] }; },
                // RAW impact -> the service normalizes via normalizeImpactResult(status, raw).
                async impact() { return { target: { name: 'selectEngine', filePath: 'src/engine.js' }, downstream: [{ name: 'main', filePath: 'src/main.js' }], risk: 'medium', diagnostics: [] }; },
                async getEntity() { return { reference: { name: 'selectEngine', filePath: 'src/engine.js' }, content: 'function selectEngine(){ return 1; }', truncated: false, diagnostics: [] }; },
            };
            const registry = Object.assign({}, require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader')).DEFAULT_REGISTRY,
                { [PID]: { role: 'structural-primary', create: () => structuralProvider } });
            const config = { codePerception: { providers: [{ id: PID, enabled: true, role: 'structural-primary' }] } };

            const result = await svc.exploreCode('engine', {
                projectRoot: runtime.workspaceRoot, config, registry, includeSource: true, includeImpact: true,
                // Real FOCUS shape ("<plan title>: <task title>"); no backlog rows needed —
                // focus never comes from the backlog. T3-B covers the real parser end-to-end.
                activeContext: { sections: { focus: 'Demo Plan: Engine' }, summary: { focus: 'Demo Plan: Engine' }, tasks: [], trajectory: [] },
            });

            assert.strictEqual(result.ok, true, 'B: ok:true');
            assert.ok(result.matches.length >= 1, 'B: structural provider yields symbol matches');
            assert.ok(result.matches.every(m => /^code-ref:/.test(m.id)), 'B: matches are normalized CodeReferences');
            assert.ok(result.relationships.length >= 1, 'B: callers relationships present');
            assert.ok(result.relationships.every(r => r.source && r.target && typeof r.kind === 'string'), 'B: relationships normalized');
            assert.ok(result.impact && Array.isArray(result.impact.downstream) && result.impact.downstream.length >= 1, 'B: impact shape with downstream');
            assert.ok(['low', 'medium', 'high', 'unknown'].includes(result.impact.risk), 'B: impact carries a risk level');
            assert.ok(result.source.length >= 1 && typeof result.source[0].excerpt === 'string', 'B: source excerpt present');
            // M1 must produce a valid SymbolReference from the structural match (this is the
            // dormant seam's unit-level proof — it just is not FED by the built-in producer).
            assert.ok(result.matches.some(m => m.filePath === 'src/engine.js' && m.name === 'selectEngine'),
                'B: M1 normalized the structural match into a resolvable reference');
            // The default Planning IR has no task.symbols and no structured evidence, so the
            // service must NOT fabricate a symbol-level Task-to-Code link. Guarding at 0 is the
            // whole point: a structural provider finding a symbol is NOT the same as governance
            // data binding a task to that symbol.
            const derived = result.governance.links.filter(l => l.kind === 'implements_task' && l.status === 'derived');
            assert.strictEqual(derived.length, 0,
                'B: no task.symbols / structured evidence -> service must not fabricate derived Task-to-Symbol links');
            // The opaque evidence is retained, marked non-linkable, and explained by ONE diagnostic.
            assert.ok(result.governance.evidence.some(e => e.raw === 'archive:mem_2026-07-15_demo.md' && e.linkable === false),
                'B: opaque evidence is retained verbatim in governance.evidence, flagged non-linkable');
            assert.ok(result.diagnostics.some(d => (d.code || '') === 'unstructured-evidence'),
                'B: an aggregated unstructured-evidence diagnostic explains the limitation');
            // Precise invariant: opaque evidence must not add an EVIDENCE-path
            // unresolved-code-reference. (declares_file may legitimately emit that code for a
            // linkedFile not in the tree, so a blanket "zero unresolved-code-reference" would be
            // false on real data — assert the `evidence:`-prefixed message specifically.)
            assert.ok(!result.diagnostics.some(d => (d.code || '') === 'unresolved-code-reference' && /^evidence:/.test(d.message || '')),
                'B: opaque evidence is NOT handed to the linker, so it produces no evidence-path unresolved-code-reference');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore-B injected structural provider passed');

        console.log('T-ce-explore-B2. COMPATIBILITY CONTRACT — structured evidence.symbols reaches the linker ...');
        {
            // This proves the SUPPORTED contract ONLY: a structured evidence row carrying a
            // linker signal (symbols) must survive the service's evidence split and reach the
            // linker, even though it has NO codeReferenceId/filePath. It does NOT claim the
            // built-in Planning producer emits this shape — it does not (see Grounded reality).
            // Its purpose is to guard against the service silently severing the dormant M1/M2 seam.
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-explore-b2');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            // Structured evidence with symbols and NO code anchor — a DI-shaped row, explicitly
            // NOT what scanPlanning produces. task.symbols left empty on purpose.
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'],
                   evidence: [{ kind: 'test', symbols: ['selectEngine'] }] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime.workspaceRoot);

            const PID = 'provider:fixture-structural-b2';
            const status = {
                providerId: PID, adapterVersion: '0.0.1', providerVersion: '9.9.9', available: true, ready: true,
                indexState: 'ready', freshness: 'fresh', dirty: 'clean', compatibility: 'supported',
                capabilities: { files: false, symbols: true, source: false, callers: false, callees: false, impact: false },
                diagnostics: [],
            };
            const provider = {
                id: PID, name: 'Fixture B2', adapterVersion: '0.0.1', capabilities: status.capabilities,
                async check() { return { available: true, ready: true, installed: true, indexState: 'ready' }; },
                async getStatus() { return status; },
                async search() { return { query: 'engine', matches: [{ providerEntityId: 'sym:selectEngine', name: 'selectEngine', kind: 'function', filePath: 'src/engine.js', lineRange: [1, 1] }], diagnostics: [] }; },
            };
            const registry = Object.assign({}, require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader')).DEFAULT_REGISTRY,
                { [PID]: { role: 'structural-primary', create: () => provider } });

            const result = await svc.exploreCode('engine', {
                projectRoot: runtime.workspaceRoot, includeSource: false, includeImpact: false,
                config: { codePerception: { providers: [{ id: PID, enabled: true, role: 'structural-primary' }] } },
                registry, activeContext: { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] },
            });

            assert.strictEqual(result.ok, true, 'B2: ok:true');
            // The structured symbols row reached the linker: implements_task derived exists.
            const derived = result.governance.links.filter(l => l.kind === 'implements_task' && l.status === 'derived');
            assert.ok(derived.length >= 1,
                'B2: a structured evidence.symbols row (no code anchor) MUST reach the linker and yield an implements_task derived link — the service must not sever the seam');
            assert.ok(derived.every(l => l.confidence > 0), 'B2: M2 floored the derived confidence > 0');
            // The structured row is retained AND flagged linkable in governance.evidence.
            assert.ok(result.governance.evidence.some(e => Array.isArray(e.symbols) && e.symbols.includes('selectEngine') && e.linkable === true),
                'B2: the structured evidence row is retained and flagged linkable:true');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });

            // B2-mismatch: a row whose OWN taskId points at a different task must be
            // fail-closed — retained for observation but NEVER linked (no cross-task fabrication).
            const runtime2 = createTempRuntimeRoot('ce-explore-b2m');
            writeText(path.join(runtime2.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            seedPlanIR(runtime2.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'],
                   evidence: [{ taskId: 'task:y', kind: 'test', symbols: ['selectEngine'] }] },
                 { id: 'task:y', title: 'Other', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: [], evidence: [] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime2.workspaceRoot);
            const result2 = await svc.exploreCode('engine', {
                projectRoot: runtime2.workspaceRoot, includeSource: false, includeImpact: false,
                config: { codePerception: { providers: [{ id: PID, enabled: true, role: 'structural-primary' }] } },
                registry, activeContext: { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] },
            });
            assert.strictEqual(result2.diagnostics.filter(d => (d.code || '') === 'evidence-task-mismatch').length, 1,
                'B2-mismatch: exactly one evidence-task-mismatch diagnostic');
            assert.ok(result2.governance.evidence.some(e => Array.isArray(e.symbols) && e.symbols.includes('selectEngine') && e.taskId === 'task:x' && e.linkable === false),
                'B2-mismatch: conflicting row is retained under its OWNER task:x and flagged non-linkable');
            const impl = result2.governance.links.filter(l => l.kind === 'implements_task' && l.status === 'derived');
            assert.ok(!impl.some(l => l.governanceEntityId === 'task:y'), 'B2-mismatch: no fabricated task:y implements link');
            assert.ok(!impl.some(l => l.governanceEntityId === 'task:x'), 'B2-mismatch: and no task:x link either (the mismatched row is not linked at all)');
            fs.rmSync(runtime2.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore-B2 structured-evidence compatibility contract passed');

        console.log('T-ce-explore-C. Unified explore — adapter exception is FATAL (ok:false) ...');
        {
            // The service itself must generate ok:false for an adapter/invariant break.
            // T4/T5 only prove the SURFACE mapping given an ok:false; without this the
            // production service would never produce one and those mappings are dead code.
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-explore-c');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = 1;\n');
            seedPlanIR(runtime.runtimeRoot, [], []);
            gitInit(runtime.workspaceRoot);

            const PID = 'provider:exploding';
            const status = {
                providerId: PID, adapterVersion: '0.0.1', providerVersion: '9.9.9', available: true, ready: true,
                indexState: 'ready', freshness: 'fresh', dirty: 'clean', compatibility: 'supported',
                // symbols ONLY -> a throw here has no same-capability fallback.
                capabilities: { files: false, symbols: true, source: false, callers: false, callees: false, impact: false },
                diagnostics: [],
            };
            const exploding = {
                id: PID, name: 'Exploding', adapterVersion: '0.0.1', capabilities: status.capabilities,
                async check() { return { available: true, ready: true, installed: true, indexState: 'ready' }; },
                async getStatus() { return status; },
                async search() { throw new Error('adapter blew up'); },
            };
            const registry = Object.assign({}, require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'provider-loader')).DEFAULT_REGISTRY,
                { [PID]: { role: 'structural-primary', create: () => exploding } });

            const result = await svc.exploreCode('engine', {
                projectRoot: runtime.workspaceRoot,
                config: { codePerception: { providers: [{ id: PID, enabled: true, role: 'structural-primary' }] } },
                registry, activeContext: { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] },
            });

            assert.strictEqual(result.ok, false, 'C: a ready provider throwing is FATAL -> ok:false (not success-shaped)');
            assert.ok(result.diagnostics.some(d => (d.code || '') === 'adapter-exception'),
                'C: diagnostics carry adapter-exception');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore-C adapter-exception fatal passed');
```

> **Cross-surface reuse (spec Global Constraint "NO duplicate logic"):** Scenario B proves the shared service produces the full structural result. **T4** proves the CLI consumes that service; **T5** proves MCP consumes the same service. Each `require`s `code-perception.js#exploreCode` and asserts against its result — neither re-implements provider orchestration. Wiki/Inspector consumption is intentionally deferred to the parked Phase 4b plan and is NOT an acceptance requirement here.

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-explore|Cannot find module|is not a function" | head`
Expected: FAIL — `Cannot find module '.../code-perception.js'`.

- [ ] **Step 3: Write the implementation** — create `templates/cli/code-perception.js`:

```javascript
'use strict';

// Unified Code Explore service (spec §2). ONE stateless orchestration used by
// `mem code` CLI, `evo_code_explore` MCP, Code Wiki, and Inspector. Read-only:
// never installs, indexes, or spawns a write. Never throws on capability gaps —
// missing/unindexed/stale/ambiguous/unsupported all degrade to success-shaped
// diagnostics (spec §3.1). Wraps the whole pipeline in try/catch and only sets
// ok:false for a genuine internal invariant break.

const fs = require('node:fs');
const path = require('node:path');

const loader = require('./code-perception/provider-loader');
const router = require('./code-perception/provider-router');
const normalize = require('./code-perception/normalize');
const linker = require('./code-perception/governance-linker');
const statusModule = require('./code-perception/status');
const runtime = require('./runtime');

const { toSymbolReferences, normalizeDerivedLinkConfidence, normalizeSearchResult,
    normalizeRelationship, normalizeImpactResult } = normalize;

function diag(code, message, providerId) {
    const d = { code, message: message || code };
    if (providerId) d.providerId = providerId;
    return d;
}

function readJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function loadPlanIR(root) {
    return readJson(path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json'))
        || { version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [], warnings: [] };
}

// Active context is host-process bound: memory.service.js reads a
// module-load-time ACTIVE_CONTEXT_PATH (getActiveContextPath()), NOT a
// per-call project root. So a temp-root fixture would otherwise read the REAL
// repo's active_context.md. The service therefore takes a DI seam:
//   - options.activeContext        -> use it verbatim (tests + callers inject).
//   - else project-root-bound read -> only when options.projectRoot is unset OR
//     equals runtime.getWorkspaceRoot() (i.e. the host workspace). A foreign
//     projectRoot with no injected activeContext yields an EMPTY context + a
//     diagnostic — never the host's focus leaking into a fixture run.
function safeReadActiveContext(options, diagnostics) {
    if (options && options.activeContext) return options.activeContext;
    const empty = { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] };
    let hostRoot;
    try { hostRoot = runtime.getWorkspaceRoot(); } catch (_) { hostRoot = undefined; }
    const root = options && options.projectRoot;
    if (root && hostRoot && path.resolve(root) !== path.resolve(hostRoot)) {
        if (diagnostics) diagnostics.push(diag('active-context-not-bound',
            'projectRoot differs from the host workspace and no activeContext was injected; focus resolution runs without active-context signal'));
        return empty;
    }
    try {
        return require('./memory.service').readActiveContext();
    } catch (_) {
        return empty;
    }
}

// Resolve free-text focus into PRE-RESOLVED focusReferences
// [{governanceEntityId, codeReferenceId}] (spec §2.4: the linker NEVER parses
// free text — the service must resolve it first). Resolution order is EXACT and
// has NO "first unfinished task" fallback (that fabricates unproven focus):
//   1. explicit options.focusId that names a real Planning-IR task or spec;
//   2. else a UNIQUE task whose EXACT id (preferred) or exact title appears in
//      the FOCUS text — multiple candidates => `focus-ambiguous`, never a silent
//      "pick the first". Title is the bridge that actually fires on real data:
//      advanceFocusFromCommit writes the focus as "<plan title>: <task title>",
//      which contains NO task id. (Verified against a real active_context.md.)
//   3. else NO focus — push a `focus-unresolved` diagnostic and return [].
// Returns focusEntityId so callers (Wiki/Inspector) render the REAL focus rather
// than re-deriving it (e.g. "every unfinished task", which is not the focus).
function resolveFocusReferences(planIR, fileReferences, activeContext, options, diagnostics) {
    const focusReferences = [];
    const byPath = new Map();
    for (const ref of fileReferences) {
        if (ref && typeof ref.filePath === 'string') byPath.set(linker.normalizePath(ref.filePath), ref);
    }
    const tasks = Array.isArray(planIR.tasks) ? planIR.tasks : [];
    const specs = Array.isArray(planIR.specs) ? planIR.specs : [];
    const focusText = (activeContext && activeContext.summary && activeContext.summary.focus)
        || (activeContext && activeContext.sections && activeContext.sections.focus) || '';

    let focusTask = null;
    let focusEntityId = null;
    // 1. explicit focusId → exact task or spec id.
    if (options && options.focusId) {
        focusTask = tasks.find(t => t && t.id === options.focusId) || null;
        const focusSpec = specs.find(s => s && s.id === options.focusId) || null;
        if (focusTask) focusEntityId = focusTask.id;
        else if (focusSpec) focusEntityId = focusSpec.id;
        else if (diagnostics) diagnostics.push(diag('focus-id-unknown',
            `focusId "${options.focusId}" matches no Planning-IR task or spec`));
    }
    // 2. exact id (preferred) else exact title named in the focus text. Collect
    //    ALL candidates and require exactly one — a `find()` would silently bind
    //    the first of several equally-plausible tasks (fabricated focus).
    if (!focusEntityId && focusText) {
        const idMatches = tasks.filter(t => t && t.id && focusText.includes(t.id));
        const titleMatches = tasks.filter(t => t && t.title && t.title.length > 0 && focusText.includes(t.title));
        const cands = idMatches.length ? idMatches : titleMatches;
        if (cands.length === 1) { focusTask = cands[0]; focusEntityId = focusTask.id; }
        else if (cands.length > 1) {
            if (diagnostics) diagnostics.push(diag('focus-ambiguous',
                `focus text matches ${cands.length} tasks (${cands.map(t => t.id).join(', ')}); emitting no focus links`));
            return { focusReferences, focusTask: null, focusEntityId: null };
        }
    }
    // NOTE — there is deliberately NO "unique active-context backlog task" branch.
    // The active-context backlog is a free-form human scratchpad: parseBacklogTasks
    // yields `{checked, hash, line, text}` where `hash` is an ad-hoc slug authored by
    // a person (real examples: `fresh-plan-progress`, `06fd`). Those are NOT
    // Planning-IR task ids (`task:ce-seam`), so matching backlog rows against
    // planIR.tasks is a category error that can never hit on real data — it only
    // "works" against a hand-written fixture that pretends backlog hashes look like
    // task ids. Focus comes from the FOCUS section (step 2), not the backlog.

    // 3. nothing resolved → diagnostic, no fabricated focus.
    if (!focusEntityId) {
        if (diagnostics) diagnostics.push(diag('focus-unresolved',
            'no explicit focusId and no unique exact task id/title in the focus text; emitting no focus links'));
        return { focusReferences, focusTask: null, focusEntityId: null };
    }
    // Bind ONLY a task's declared files (a spec-level focus contributes no file refs here).
    if (focusTask && Array.isArray(focusTask.linkedFiles)) {
        for (const lf of focusTask.linkedFiles) {
            const ref = byPath.get(linker.normalizePath(lf));
            if (ref) focusReferences.push({ governanceEntityId: focusEntityId, codeReferenceId: ref.id });
        }
    }
    return { focusReferences, focusTask, focusEntityId };
}

// The FATAL set (spec §3.1). Everything else — missing/unindexed/stale/ambiguous/
// unsupported — is success-shaped degradation. A fatal makes exploreCode return
// ok:false, which each surface maps to its own failure channel (CLI exit 1, MCP
// isError:true, Inspector 503).
const FATAL_CODES = Object.freeze(['adapter-exception', 'security-violation', 'unparseable-response', 'internal-error']);

function fatalResult(query, diagnostics) {
    return {
        query, ok: false, freshness: { stale: false, dirty: false },
        providers: [], matches: [], relationships: [], source: [], files: [], modules: [],
        focus: { entityId: null, taskId: null, resolved: false },
        governance: { specs: [], plans: [], tasks: [], commits: [], evidence: [], links: [], linkSummary: { confirmed: 0, derived: 0, proposed: 0 } },
        recommendedReading: [], diagnostics,
    };
}

async function callProvider(candidates, request, invoke, diagnostics, fatals) {
    const selection = router.selectProvider(request, candidates);
    if (Array.isArray(selection.diagnostics)) diagnostics.push(...selection.diagnostics);
    if (!selection.candidate) {
        // Capability gap — success-shaped, NOT fatal.
        if (selection.reason) diagnostics.push(diag('capability-unavailable', selection.reason));
        return { selection, value: null };
    }
    const provider = selection.candidate.registration.provider;
    try {
        const value = await invoke(provider, selection.candidate.status);
        return { selection, value };
    } catch (err) {
        // A READY provider that throws is an adapter/invariant break, not a
        // capability gap: there is no legal response and (in this MVP) no
        // same-capability retry. Spec §3.1 classes this FATAL -> ok:false.
        // Recording it in `fatals` is what makes that real; a diagnostic alone
        // would leave the result ok:true and silently swallow the failure.
        const d = diag('adapter-exception', err && err.message ? err.message : String(err),
            provider && provider.id);
        diagnostics.push(d);
        if (fatals) fatals.push(d);
        return { selection, value: null, adapterError: true };
    }
}

// Security/path-containment violations surface as provider diagnostics rather than
// throws; treat those codes as fatal too when a provider reports one.
function collectFatalDiagnostics(diagnostics) {
    return diagnostics.filter(d => d && FATAL_CODES.includes(d.code));
}

async function exploreCode(query, opts) {
    const options = opts || {};
    const q = typeof query === 'string' ? query : '';
    const projectRoot = options.projectRoot || runtime.getWorkspaceRoot();
    const includeSource = options.includeSource !== false;
    const includeImpact = options.includeImpact !== false;
    const includeGovernance = options.includeGovernance !== false;
    const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : 10;
    const maxSourceChars = Number.isFinite(options.maxSourceChars) ? options.maxSourceChars : 4000;

    const diagnostics = [];
    const fatals = [];   // spec §3.1 fatal accumulator -> drives ok:false
    const context = { projectRoot };

    try {
        // §2.2 step 1 — load providers + active context + planning IR.
        const config = options.config
            || (function () { const c = runtime.getEvoConfig(); return c && c.codePerception ? c : {}; })();
        const loaded = loader.loadProviders(config, options.registry ? { registry: options.registry } : {});
        if (Array.isArray(loaded.diagnostics)) diagnostics.push(...loaded.diagnostics);
        const candidates = await router.inspectProviders(loaded.registrations, context);
        const activeContext = safeReadActiveContext(options, diagnostics);
        const planIR = loadPlanIR(projectRoot);
        // Governance graph the post-commit hook already persisted (holds the
        // changed_by_commit links + the commit set explore itself never re-derives).
        const persisted = readJson(path.join(projectRoot, '.evo-lite', 'generated', 'code-perception', 'governance-links.json'));
        const lastRun = readJson(path.join(projectRoot, '.evo-lite', 'generated', 'code-perception', 'post-commit-last-run.json'));

        // File facts (files capability) — always available via native-lite.
        let fileReferences = [];
        let fileFacts = [];
        const files = await callProvider(candidates, { capability: 'files' },
            (p) => p.getFiles(context, {}), diagnostics, fatals);
        if (files.value && Array.isArray(files.value.files)) {
            fileFacts = files.value.files;
            fileReferences = fileFacts.map(f => f.reference).filter(Boolean);
            if (Array.isArray(files.value.diagnostics)) diagnostics.push(...files.value.diagnostics);
        }
        // Modules (files/modules capability) — group facts by declared moduleId, or
        // by top-level path segment when the provider gives none (deterministic,
        // pure-derived fallback so the Code Wiki always has module pages). Also a
        // flat sorted `filePaths` set the Wiki uses to resolve/flag task.linkedFiles.
        const filePaths = fileReferences.map(r => r.filePath).filter(Boolean).sort();
        const modules = (function buildModules() {
            const byModule = new Map();
            for (const fact of fileFacts) {
                const p = fact && fact.reference && fact.reference.filePath;
                if (!p) continue;
                const mid = (fact.moduleId != null && fact.moduleId !== '') ? String(fact.moduleId) : (p.split('/')[0] || '(root)');
                if (!byModule.has(mid)) byModule.set(mid, { id: mid, files: [], taskIds: new Set(), changed: false });
                const m = byModule.get(mid);
                m.files.push(p);
                if (fact.changed) m.changed = true;
                for (const tid of (Array.isArray(fact.declaredByTaskIds) ? fact.declaredByTaskIds : [])) m.taskIds.add(tid);
            }
            return [...byModule.values()]
                .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                .map(m => ({ id: m.id, files: m.files.sort(), taskIds: [...m.taskIds].sort(), changed: m.changed }));
        })();

        // §2.2 step 3-4 — structural search (symbols). Absent under native-lite → matches [].
        let matches = [];
        const searchSel = await callProvider(candidates, { capability: 'symbols', preferredProvider: options.preferredProvider },
            (p, st) => p.search(context, q).then(raw => normalizeSearchResult(st, raw)), diagnostics, fatals);
        if (searchSel.value && Array.isArray(searchSel.value.matches)) {
            matches = searchSel.value.matches.slice(0, maxResults);
            if (Array.isArray(searchSel.value.diagnostics)) diagnostics.push(...searchSel.value.diagnostics);
        }
        const structuralStatus = searchSel.selection.candidate ? searchSel.selection.candidate.status : null;

        // §2.2 step 5 — callers/callees for the top symbol match (when supported).
        const relationships = [];
        const topSymbol = matches[0] ? (matches[0].name || matches[0].providerEntityId) : null;
        if (topSymbol) {
            for (const [cap, method] of [['callers', 'getCallers'], ['callees', 'getCallees']]) {
                const rel = await callProvider(candidates, { capability: cap },
                    (p) => p[method](context, topSymbol), diagnostics, fatals);
                if (rel.value && Array.isArray(rel.value.relationships)) {
                    for (const r of rel.value.relationships) {
                        relationships.push(normalizeRelationship(r.providerId, r.source, r.target, r.kind, r.confidence));
                    }
                    if (Array.isArray(rel.value.diagnostics)) diagnostics.push(...rel.value.diagnostics);
                }
            }
        }

        // §2.2 step 6 — impact (when requested + supported).
        let impact;
        if (includeImpact && topSymbol) {
            const imp = await callProvider(candidates, { capability: 'impact' },
                (p, st) => p.impact(context, topSymbol).then(raw => normalizeImpactResult(st, raw)), diagnostics, fatals);
            if (imp.value) impact = imp.value;
        }

        // §2.2 step 7 — source excerpts (when requested + supported).
        const source = [];
        if (includeSource && matches.length) {
            for (const m of matches.slice(0, 3)) {
                const ent = await callProvider(candidates, { capability: 'source' },
                    (p) => p.getEntity(context, { entity: m.providerEntityId || m.name }), diagnostics, fatals);
                if (ent.value && typeof ent.value.content === 'string') {
                    source.push({ reference: ent.value.reference || m, excerpt: ent.value.content.slice(0, maxSourceChars),
                        truncated: Boolean(ent.value.truncated) });
                }
            }
        }

        // §2.2 step 2 + 8 — resolve focus, then build governance links via the
        // ONE M1 seam; then apply the M2 floor before ranking/projection.
        const { focusReferences, focusTask, focusEntityId } = resolveFocusReferences(planIR, fileReferences, activeContext, options, diagnostics);
        const symbolReferences = toSymbolReferences(matches, { focusId: options.focusId });
        // Commits: explore NEVER shells out to `git log`. It reuses the commit set
        // the post-commit hook persisted (Layer-1 changed_by_commit source), plus
        // any DI commits a caller injects. The blob's REAL shape is
        // `{ commit: <headSha>, changedFiles: [...] }` (post-commit-code-perception.js
        // writes `commit`, NOT `commits`/`headSha`) — read exactly that.
        const persistedCommits = (lastRun && typeof lastRun.commit === 'string')
            ? [{ sha: lastRun.commit, changedFiles: Array.isArray(lastRun.changedFiles) ? lastRun.changedFiles : [] }]
            : [];
        const commits = Array.isArray(options.commits) ? options.commits : persistedCommits;
        const acceptanceDependencies = Array.isArray(options.acceptanceDependencies) ? options.acceptanceDependencies : [];

        // Evidence has TWO audiences and they are NOT the same set (this distinction
        // is the whole point — conflating them either hides real evidence or fabricates
        // links). The built-in Planning producer emits evidence as OPAQUE STRINGS
        // (e.g. "archive:mem_...md" from planning/parse-markdown.js + scan.js); it emits
        // no task.symbols and no structured {symbols,commitSha,codeReferenceId,filePath}
        // rows. So on real data NONE of the rule-gated evidence links can fire.
        //   - allEvidence  -> surfaced verbatim in governance.evidence so the CLI/MCP show
        //     that evidence EXISTS. Opaque strings are projected as {taskId, raw, linkable:false}.
        //     We NEVER synthesize symbols/commitSha/codeReferenceId/filePath we did not see.
        //   - linkableEvidence -> any structured row carrying a signal the linker ALREADY
        //     consumes. This must NOT be narrowed to code anchors: the linker derives
        //     implements_task from evidence.symbols / evidence.commitSha WITHOUT a
        //     codeReferenceId/filePath (verified against governance-linker.js), and derives
        //     verified_by_test / evidenced_by_archive from codeReferenceId / resolvable filePath.
        //     Filtering on code anchors alone would sever the dormant M1/M2 seam at the service
        //     layer — the opposite of keeping T1 as a forward-compat seam. Today the built-in
        //     producer yields none of these signals; a DI caller or a future Evidence IR may.
        const hasLinkerSignal = (e) => e && typeof e === 'object' && (
            typeof e.codeReferenceId === 'string'
            || typeof e.filePath === 'string'
            || (Array.isArray(e.symbols) && e.symbols.length > 0)
            || typeof e.commitSha === 'string'
        );
        const allEvidence = [];
        const linkableEvidence = [];
        let opaqueEvidenceCount = 0;
        for (const t of (planIR.tasks || [])) {
            for (const e of (Array.isArray(t.evidence) ? t.evidence : [])) {
                if (e && typeof e === 'object') {
                    // Ownership is FAIL-CLOSED. `t.id` always wins (correct owner), but a row that
                    // DECLARED a different taskId is inconsistent producer data: retain it for
                    // observation, but never let it reach the linker (a mismatched taskId would
                    // silently create a cross-task governance link — fabricated semantics).
                    const suppliedTaskId = (typeof e.taskId === 'string' && e.taskId) ? e.taskId : null;
                    const row = Object.assign({}, e, { taskId: t.id });
                    if (suppliedTaskId && suppliedTaskId !== t.id) {
                        row.linkable = false;
                        diagnostics.push(diag('evidence-task-mismatch',
                            `evidence declares ${suppliedTaskId} but is owned by ${t.id}; retained but not linked`));
                    } else {
                        // `linkable` records whether the linker can act on the row. We NEVER
                        // synthesize a signal that was not present.
                        row.linkable = hasLinkerSignal(row);
                    }
                    allEvidence.push(row);
                    if (row.linkable) linkableEvidence.push(row);
                } else if (typeof e === 'string' && e.length) {
                    // Opaque built-in evidence: retained, flagged non-linkable, counted.
                    allEvidence.push({ taskId: t.id, raw: e, linkable: false });
                    opaqueEvidenceCount += 1;
                }
            }
        }
        // ONE aggregated diagnostic — never 131 duplicate lines. It explains the
        // limitation instead of silently dropping the evidence.
        if (opaqueEvidenceCount > 0) {
            diagnostics.push(diag('unstructured-evidence',
                `${opaqueEvidenceCount} evidence entr${opaqueEvidenceCount === 1 ? 'y is an opaque string' : 'ies are opaque strings'} and cannot produce symbol/evidence-to-code governance links (no structured linker signal). They are retained as raw evidence.`));
        }
        let links = [];
        if (includeGovernance) {
            // Build the full input set (spec §2.2 Layers 1-3): file/symbol/focus/
            // commit/acceptance + ONLY the linkable evidence. Handing the linker opaque
            // string evidence would just make it emit per-row unresolved-code-reference noise.
            const built = linker.buildGovernanceLinks({
                planIR: { tasks: planIR.tasks },
                fileReferences, symbolReferences, focusReferences,
                commits, acceptanceDependencies, evidence: linkableEvidence,
            });
            links = Array.isArray(built.links) ? built.links : [];
            if (Array.isArray(built.diagnostics)) diagnostics.push(...built.diagnostics);
            // Merge the persisted graph (changed_by_commit + anything an earlier
            // run confirmed) so explore reflects, not discards, prior link state.
            if (persisted && Array.isArray(persisted.links)) {
                const seen = new Set(links.map(l => l.id));
                for (const l of persisted.links) {
                    if (l && l.id && !seen.has(l.id) && linker.isValidLink(l)) { links.push(l); seen.add(l.id); }
                }
            }
            links = normalizeDerivedLinkConfidence(links); // M2 — before ranking / any consumer filter.
        }

        // Status table + freshness from the structural provider (or native-lite).
        const statusReport = statusModule.buildCodePerceptionStatus(context, { candidates, links });
        if (Array.isArray(statusReport.diagnostics)) diagnostics.push(...statusReport.diagnostics);
        const freshnessStatus = structuralStatus || (candidates[0] ? candidates[0].status : null);
        const freshness = {
            stale: statusReport.staleHints.length > 0,
            dirty: Boolean(freshnessStatus && freshnessStatus.dirty === 'dirty'),
        };
        if (freshnessStatus && freshnessStatus.indexedCommit !== undefined) freshness.indexedCommit = freshnessStatus.indexedCommit;
        if (freshnessStatus && freshnessStatus.currentCommit !== undefined) freshness.currentCommit = freshnessStatus.currentCommit;

        // §2.2 step 9 — recommended reading.
        const recommendedReading = rankRecommendedReading({
            query: q, matches, relationships, links, fileReferences, focusReferences, focusTask,
        });

        // §2 governance context.
        const linkSummary = statusReport.links;
        const governance = {
            specs: planIR.specs || [], plans: planIR.plans || [], tasks: planIR.tasks || [],
            commits, evidence: allEvidence, links, linkSummary,
        };

        // §3.1 fatal gate — a READY provider that threw (adapter-exception), a
        // security violation, or an unparseable response is NOT success-shaped.
        // Without this gate the service would return ok:true and the surfaces'
        // fatal mappings (CLI 1 / MCP isError / Inspector 503) would be dead code.
        const allFatals = fatals.concat(collectFatalDiagnostics(diagnostics).filter(d => !fatals.includes(d)));
        if (allFatals.length) return fatalResult(q, diagnostics);

        return {
            query: q, ok: true, freshness,
            providers: statusReport.providers, matches, relationships,
            impact, source, files: filePaths, modules,
            focus: { entityId: focusEntityId || null, taskId: focusTask ? focusTask.id : null, resolved: Boolean(focusEntityId) },
            governance, recommendedReading, diagnostics,
        };
    } catch (err) {
        // A genuine internal invariant break — also fatal.
        diagnostics.push(diag('internal-error', err && err.message ? err.message : String(err)));
        return fatalResult(q, diagnostics);
    }
}

// §2.3 order: explicit linked file -> current focus relation -> exact symbol
// match -> entrypoint -> call-path centrality -> changed file -> test file ->
// documentation. Every item carries a human `reason`.
function rankRecommendedReading(inputs) {
    const { query, matches, relationships, links, fileReferences, focusReferences } = inputs;
    const items = [];
    const seen = new Set();
    const push = (p, kind, reason, priority, confidence) => {
        if (!p) return;
        const key = p + '|' + priority;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ path: p, kind, reason, priority, confidence: typeof confidence === 'number' ? confidence : 1 });
    };
    const refById = new Map();
    for (const r of (fileReferences || [])) if (r && r.id) refById.set(r.id, r);
    for (const m of (matches || [])) if (m && m.id) refById.set(m.id, m);

    // 1 explicit linked file (declares_file / implements_task confirmed|derived).
    for (const l of (links || [])) {
        if (l.kind === 'declares_file' || l.kind === 'implements_task') {
            const ref = refById.get(l.codeReferenceId);
            const p = ref && ref.filePath;
            if (p) push(p, 'linked-file', `Linked to governance entity ${l.governanceEntityId} (${l.kind}, ${l.status})`, 1, l.confidence);
        }
    }
    // 2 current focus relation.
    for (const fr of (focusReferences || [])) {
        const ref = refById.get(fr.codeReferenceId);
        const p = ref && ref.filePath;
        if (p) push(p, 'focus', `In current focus for ${fr.governanceEntityId}`, 2, 1);
    }
    // 3 exact symbol match.
    const ql = (query || '').toLowerCase();
    for (const m of (matches || [])) {
        if (m.filePath && typeof m.name === 'string' && m.name.toLowerCase() === ql) {
            push(m.filePath, 'exact-symbol', `Exact symbol match for "${query}" (${m.name})`, 3, 1);
        }
    }
    // 4 entrypoint (route/command/flow kinds).
    for (const m of (matches || [])) {
        if (m.filePath && ['route', 'command', 'flow'].includes(m.kind)) {
            push(m.filePath, 'entrypoint', `Entrypoint symbol (${m.kind}) ${m.name}`, 4, 0.8);
        }
    }
    // 5 call-path centrality (files with the most caller/callee edges).
    const degree = new Map();
    for (const r of (relationships || [])) {
        for (const end of [r.source, r.target]) {
            if (end && end.filePath) degree.set(end.filePath, (degree.get(end.filePath) || 0) + 1);
        }
    }
    for (const [p, d] of [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        push(p, 'call-centrality', `Central in the call graph (${d} edges)`, 5, 0.6);
    }
    // 6 changed file.
    for (const ref of (fileReferences || [])) {
        if (ref && ref.filePath && ref.snapshot && ref.snapshot.dirty === 'dirty') {
            push(ref.filePath, 'changed', 'Changed in the working tree', 6, 0.5);
        }
    }
    // 7 test file. 8 documentation.
    for (const ref of (fileReferences || [])) {
        const p = ref && ref.filePath;
        if (!p) continue;
        if (/(^|\/)test|\.test\.|\.spec\./.test(p)) push(p, 'test', 'Test file — shows expected behavior', 7, 0.4);
        else if (/\.md$/.test(p)) push(p, 'documentation', 'Documentation for this area', 8, 0.3);
    }
    return items.sort((a, b) => a.priority - b.priority);
}

module.exports = { exploreCode, rankRecommendedReading };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-explore"`
Expected: PASS — all four: `✅ T-ce-explore-A native-lite degradation passed`, `✅ T-ce-explore-B injected structural provider passed`, `✅ T-ce-explore-B2 structured-evidence compatibility contract passed`, `✅ T-ce-explore-C adapter-exception fatal passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(code-perception): unified explore service orchestrating router/linker (task:ce-explore-service)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: REAL producer→consumer composition tests

**Files:**
- Test: `templates/cli/test/governance.js` (append block `T-ce-compose`)
- Modify (only if a composition test proves a real mismatch): `templates/cli/code-perception.js`

**Why this task exists (read this first):** Every shape defect found during plan review survived in shipped, governance-green ①② code for the same reason: **each test wrote, by hand, the producer output it wished for, then asserted its consumer could read that wish.** Both sides passed. Reality did not compose. Three separate instances were confirmed against source:

| Consumer assumed | Producer actually emits |
|---|---|
| `post-commit-last-run.json` has `commits` / `headSha` | `{ commit: '<sha>', changedFiles: [...] }` (`post-commit-code-perception.js`) |
| active-context task rows have `.id` | `{checked, hash, line, text}` (`memory.service#parseBacklogTasks`) |
| `changed_by_commit` is keyed by task id | keyed by `governanceEntityId = 'commit:<sha>'` (`governance-linker.js`) |

A fourth was found while writing this task and is the reason the focus design below changed — see **Focus reality** in T2's Interfaces.

**Rule for this task: NO hand-authored producer artifacts.** Every input must be produced by the real production function that writes it in a real run. If a composition test cannot be written without hand-forging an artifact, that is itself the finding — report it, do not forge.

**Interfaces:**
- Consumes: `./code-perception/post-commit-code-perception.js#runPostCommitCodePerception({projectRoot, headSha, changedFiles, cache?}) -> {report, diagnostics}` (the REAL blob producer — never throws); `./memory.service.js#readActiveContext()` (the REAL active-context parser, bound to a module-load `ACTIVE_CONTEXT_PATH`); `./code-perception.js#exploreCode` (T2).
- Produces: no production API. THREE regression tests that fail if a producer's real output stops feeding the consumer: **A** commit graph (real post-commit blob), **B** focus (real `active_context.md` parse), **C** archive evidence (real backfill + scan chain — pins that opaque string evidence is retained + explained + never fabricated into links).

- [ ] **Step 1: Write the failing tests** — append after the T-ce-explore-C block:

```javascript
        console.log('T-ce-compose-A. REAL post-commit producer -> exploreCode consumer (commit graph) ...');
        {
            const { execFileSync } = require('node:child_process');
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const pc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'post-commit-code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-compose-a');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'], evidence: [] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime.workspaceRoot);
            const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime.workspaceRoot, encoding: 'utf8' }).trim();

            // PRODUCER: the real post-commit path writes the blob. Nothing is hand-forged.
            pc.runPostCommitCodePerception({ projectRoot: runtime.workspaceRoot, headSha, changedFiles: ['src/engine.js'] });
            const blobPath = path.join(runtime.runtimeRoot, 'generated', 'code-perception', 'post-commit-last-run.json');
            assert.ok(fs.existsSync(blobPath), 'A: the real producer wrote post-commit-last-run.json');

            // CONSUMER: the service must read what the producer actually wrote.
            const result = await svc.exploreCode('', {
                projectRoot: runtime.workspaceRoot, config: {}, includeSource: false, includeImpact: false,
                activeContext: { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] },
            });
            assert.strictEqual(result.ok, true, 'A: ok:true');
            assert.ok(result.governance.commits.length >= 1,
                'A: governance.commits is non-empty — the service reads the producer\'s REAL key (this fails if it reads `commits`/`headSha`)');
            assert.strictEqual(result.governance.commits[0].sha, headSha, 'A: the commit sha round-trips producer -> consumer');
            const changed = result.governance.links.filter(l => l.kind === 'changed_by_commit');
            assert.ok(changed.length >= 1, 'A: changed_by_commit links exist end-to-end');
            assert.ok(changed.every(l => l.governanceEntityId === `commit:${headSha}`),
                'A: changed_by_commit keyed by commit:<sha> (consumers must not filter these by task id)');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-compose-A real commit graph composes');

        console.log('T-ce-compose-B. REAL active_context.md -> memory.service parser -> exploreCode focus ...');
        {
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-compose-b');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            const TASK_TITLE = 'M1/M2 reference seam in normalize.js';
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: TASK_TITLE, status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'], evidence: [] }],
                [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }]);
            gitInit(runtime.workspaceRoot);

            // PRODUCER: write the FOCUS section in the exact shape advanceFocusFromCommit
            // emits — "<plan title>: <task title>" — into the real active_context.md, then
            // let the REAL parser read it. The parser, not a hand-built object, feeds the service.
            const acPath = path.join(runtime.runtimeRoot, 'active_context.md');
            const ac = fs.readFileSync(acPath, 'utf8').replace(
                /<!-- BEGIN_FOCUS -->[\s\S]*?<!-- END_FOCUS -->/,
                `<!-- BEGIN_FOCUS -->\nDemo Plan: ${TASK_TITLE}\n<!-- END_FOCUS -->`);
            fs.writeFileSync(acPath, ac, 'utf8');

            // memory.service pins ACTIVE_CONTEXT_PATH at module load, so it must be reloaded
            // AFTER EVO_LITE_ROOT is set. `resetCliModuleCache()` clears CLI_DIR, but this block
            // requires from TEMPLATE_CLI_DIR — those dirs DIFFER when the suite runs from the
            // runtime mirror entry (CLI_DIR=.evo-lite/cli, TEMPLATE_CLI_DIR=templates/cli), so the
            // CLI_DIR-scoped clear would miss the module and read a stale (real-repo) context.
            // Clear the exact TEMPLATE_CLI_DIR modules this block loads so it is entry-point-robust.
            const resetTemplateCliCache = () => {
                for (const f of ['runtime.js', 'db.js', 'models.js', 'memory-index-util.js', 'memory-index.js', 'memory-index-zvec.js', 'memory.service.js']) {
                    const p = path.join(TEMPLATE_CLI_DIR, f);
                    if (fs.existsSync(p)) delete require.cache[require.resolve(p)];
                }
            };
            const prevRoot = process.env.EVO_LITE_ROOT;
            process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
            resetTemplateCliCache();
            try {
                const memoryService = require(path.join(TEMPLATE_CLI_DIR, 'memory.service.js'));
                const realAc = memoryService.readActiveContext();   // REAL parser output
                assert.ok(realAc.sections.focus.includes(TASK_TITLE), 'B: precondition — the real parser sees the focus text');

                const result = await svc.exploreCode('', {
                    projectRoot: runtime.workspaceRoot, config: {}, includeSource: false, includeImpact: false,
                    activeContext: realAc,   // <- the parser's output, NOT a hand-written shape
                });
                assert.strictEqual(result.ok, true, 'B: ok:true');
                assert.strictEqual(result.focus.resolved, true,
                    'B: focus resolves from a REAL active_context.md (fails if resolution depends on ids/hashes that real focus text never contains)');
                assert.strictEqual(result.focus.entityId, 'task:x', 'B: focus binds the canonical Planning-IR task id');
                const focusLinks = result.governance.links.filter(l => l.kind === 'related_to_focus');
                assert.ok(focusLinks.length >= 1, 'B: related_to_focus is non-empty end-to-end');
            } finally {
                if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT; else process.env.EVO_LITE_ROOT = prevRoot;
                resetTemplateCliCache();
                fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
            }
        }
        console.log('✅ T-ce-compose-B real focus composes');

        console.log('T-ce-compose-C. REAL archive evidence chain -> exploreCode retains-but-does-not-fabricate ...');
        {
            // The built-in Planning producer emits evidence as OPAQUE STRINGS. This pins the
            // honest degradation with the REAL producer chain end-to-end — NO hand-authored
            // planIR.tasks[].evidence: a real raw_memory archive, the real backfill, the real
            // scanner + writer, then the service. The contract under test is: retain the
            // evidence, explain the limitation, and REFUSE to fabricate symbol/evidence links.
            const { execFileSync } = require('node:child_process');
            const svc = require(path.join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const scan = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'scan.js'));
            const backfill = require(path.join(TEMPLATE_CLI_DIR, 'planning', 'backfill-evidence.js'));
            const runtime = createTempRuntimeRoot('ce-compose-c');
            const ws = runtime.workspaceRoot;
            writeText(path.join(ws, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            // A real plan (compact checkbox format -> author-controlled task id + linkedFiles).
            writeText(path.join(ws, 'docs', 'plans', 'demo.md'),
                '---\nid: plan:demo\ntitle: Demo\nstatus: active\n---\n\n# Demo\n\n- [ ] [task:demo] Engine work\n  - files: src/engine.js\n');
            // A real archive that binds itself to the task via a `task:demo` reference in its body.
            writeText(path.join(runtime.runtimeRoot, 'raw_memory', 'mem_2026-07-15_demo.md'),
                '# Archive\n\nClosure for task:demo — implemented selectEngine.\n');
            gitInit(ws);

            // REAL producer chain: backfill -> scan -> write. No hand-forged evidence rows.
            const bf = backfill.backfillArchiveEvidence(ws);
            assert.ok(bf.taskIdToArchives['task:demo'] && bf.taskIdToArchives['task:demo'].length >= 1,
                'C: backfill binds the real archive to task:demo');
            const ir = scan.scanPlanning(ws);
            scan.writePlanIR(ir, ws);
            const irTask = ir.tasks.find(t => t.id === 'task:demo');
            assert.ok(irTask, 'C: scanner produced task:demo');
            assert.ok(irTask.evidence.length >= 1 && irTask.evidence.every(e => typeof e === 'string'),
                'C: the REAL producer emits evidence as opaque STRINGS (this is the shape the service must handle)');

            const result = await svc.exploreCode('', { projectRoot: ws, config: {}, includeSource: false, includeImpact: false });

            assert.strictEqual(result.ok, true, 'C: ok:true');
            // 1. Evidence is RETAINED (never silently dropped) and flagged non-linkable.
            const kept = result.governance.evidence.filter(e => e.taskId === 'task:demo');
            assert.ok(kept.length >= 1 && kept.some(e => /archive:mem_2026-07-15_demo\.md/.test(e.raw || '')),
                'C: real opaque evidence is retained verbatim in governance.evidence');
            assert.ok(kept.every(e => e.linkable === false), 'C: opaque evidence is flagged non-linkable');
            // 2. ONE aggregated diagnostic explains the limitation (not 1-per-row).
            const unstructured = result.diagnostics.filter(d => (d.code || '') === 'unstructured-evidence');
            assert.strictEqual(unstructured.length, 1, 'C: exactly one aggregated unstructured-evidence diagnostic');
            // 3. declares_file still works (file-level governance is the real 4a deliverable).
            assert.ok(result.governance.links.some(l => l.kind === 'declares_file'),
                'C: declares_file still fires from task.linkedFiles + native-lite file facts');
            // 4. NO fabricated symbol/evidence links, and NO per-row unresolved noise.
            for (const kind of ['implements_task', 'verified_by_test', 'evidenced_by_archive']) {
                const derivedish = result.governance.links.filter(l => l.kind === kind && l.status !== 'proposed');
                assert.strictEqual(derivedish.length, 0,
                    `C: default pipeline must not fabricate ${kind} (confirmed/derived) links from opaque evidence`);
            }
            assert.ok(!result.diagnostics.some(d => (d.code || '') === 'unresolved-code-reference' && /^evidence:/.test(d.message || '')),
                'C: opaque evidence never reaches the linker, so no evidence-path unresolved-code-reference (declares_file may still emit its own for absent files — that is legitimate)');
            fs.rmSync(ws, { recursive: true, force: true });
        }
        console.log('✅ T-ce-compose-C real evidence chain degrades honestly');
```

- [ ] **Step 2: Run to verify they fail (or reveal a real mismatch)**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-compose|AssertionError" | head`
Expected: FAIL before T2's service exists. Once T2 exists, all THREE (A/B/C) MUST pass without touching them — if any fails, the SERVICE is wrong (or a producer's shape was misread again). **Fix the service, never the test's expectation of the producer.** In particular, T-ce-compose-C must never be made green by teaching the service to synthesize a symbol/commit/codeReferenceId the producer did not emit — that is the exact defect this task exists to catch.

- [ ] **Step 3: No implementation of its own**

This task adds no production code. If a composition test fails, apply the minimal fix to `code-perception.js` so the consumer reads what the producer really emits, and record the corrected shape in the plan's **Grounded reality** section so the next consumer inherits the fact.

- [ ] **Step 4: Commit**

```bash
git add templates/cli/test/governance.js templates/cli/code-perception.js
git commit -m "$(cat <<'EOF'
test(code-perception): real producer->consumer composition tests (task:ce-compose)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `mem code` command group + unified exit model

**Files:**
- Create: `templates/cli/code-perception/cli.js`
- Modify: `templates/cli/memory.js` (add one `safeRegister('code', …)` line)
- Test: `templates/cli/test/governance.js` (append block `T-ce-cli`)

**Design decision (justified):** Put the group in a **new** `code-perception/cli.js` exporting `registerCodeCommands(program)`, NOT inside `code-perception.js`. Rationale: `code-perception.js` is the pure, MCP/Inspector/Wiki-shared service and must stay free of commander so it can be `require`d in a long-lived MCP process and unit-tested without side effects; the CLI layer (option parsing, `console.log`, `process.exitCode`) is a distinct responsibility. This mirrors the shipped pattern (`planning.js`→`registerPlanCommands`, `spec-portfolio.js`→`registerSpecPortfolioCommands`) and keeps `safeRegister` thunks uniform.

**Interfaces:**
- Consumes: `../code-perception.js#exploreCode` (T2); `../code-perception/status`, `../provider-loader`, `../provider-router` (for `mem code providers`/`status`); commander `program`.
- Produces: `registerCodeCommands(program)` registering `mem code <providers|status|search|explore|callers|callees|impact|context>`. Exit codes: success/degraded → 0; internal invariant/security → 1 (`result.ok===false`); invalid args → 2 via a SCOPED `exitOverride` on the `code` group + every subcommand (commander's default is 1, so the override is required — it must NOT be placed on the root program or it would change every other `mem` command's exit codes).
- **No `mem code wiki` subgroup in 4a.** It would `require('./wiki')`, which Phase 4b creates; registering it now would either brick the group or ship a command that always throws. Phase 4b adds the subgroup together with the module.

- [ ] **Step 1: Write the failing test** — append after the T-ce-compose-B block. Run the **template** `memory.js` directly (NOT the mirror): `code-perception/cli.js` is not manifest-managed until **Task 6**, so a `sync-runtime-entry` mirror would omit it and `mem code` would be unknown. Running the template source exercises the real production registrar in place; mirror parity is proven separately in **T6**. `git init` so native-lite `getFiles` enumerates (degradation stays success-shaped either way, but this keeps the run realistic).

```javascript
        console.log('T-ce-cli. Testing `mem code explore --json` success-shaped exit + exit-2 on bad args ...');
        {
            const cp = require('child_process');
            const { execFileSync } = require('node:child_process');
            const runtime = createTempRuntimeRoot('ce-cli');
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            execFileSync('git', ['init', '-q'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.email', 'test@evo.local'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.name', 'evo-test'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['add', '-A'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: runtime.workspaceRoot });

            const memCli = path.join(TEMPLATE_CLI_DIR, 'memory.js'); // template source, not the mirror
            // memory.js -> memory.service -> db.js -> require('better-sqlite3'), which is
            // NOT a package dependency: it lives in the WORKSPACE RUNTIME's node_modules
            // (.evo-lite/node_modules). Module resolution is file-relative, so a spawn of
            // templates/cli/memory.js resolves up to the repo root and fails with
            // MODULE_NOT_FOUND unless NODE_PATH points at that runtime. Established idiom:
            // harness.js:18 and integration.js:650/678/705 do exactly this.
            const childEnv = {
                ...process.env,
                EVO_LITE_ROOT: runtime.runtimeRoot,
                NODE_PATH: [path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules'), process.env.NODE_PATH]
                    .filter(Boolean).join(path.delimiter),
            };
            const res = cp.spawnSync(process.execPath, [memCli, 'code', 'explore', 'engine selection', '--json'], {
                cwd: runtime.workspaceRoot, env: childEnv, encoding: 'utf8',
            });
            assert.strictEqual(res.status, 0, 'capability gap must exit 0 (success-shaped): ' + (res.stderr || ''));
            const parsed = JSON.parse(res.stdout);
            assert.strictEqual(parsed.query, 'engine selection', 'JSON echoes query');
            assert.ok(Array.isArray(parsed.providers), 'JSON carries providers');
            assert.ok(parsed.freshness && typeof parsed.freshness.stale === 'boolean', 'JSON carries freshness');
            // Invalid subcommand under `mem code` -> the group's scoped exitOverride maps it to exit 2.
            const bad = cp.spawnSync(process.execPath, [memCli, 'code', 'nonexistent-subcmd'], {
                cwd: runtime.workspaceRoot, env: childEnv, encoding: 'utf8',
            });
            assert.strictEqual(bad.status, 2, 'invalid CLI args must exit 2 (spec §3.1 / Global Constraint)');
            // `mem code context --json` with no --task/--spec uses the current focus by default
            // (the default focus IS the behavior — there is no --focus flag). Success-shaped.
            const ctx = cp.spawnSync(process.execPath, [memCli, 'code', 'context', '--json'], {
                cwd: runtime.workspaceRoot, env: childEnv, encoding: 'utf8',
            });
            assert.strictEqual(ctx.status, 0, 'code context --json (default focus) must exit 0: ' + (ctx.stderr || ''));
            const ctxParsed = JSON.parse(ctx.stdout);
            assert.strictEqual(ctxParsed.scope, 'focus', 'default context scope is the current focus');
            assert.ok(Array.isArray(ctxParsed.links), 'context JSON carries a links array');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-cli mem code CLI passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-cli|exit 0|exit 2" | head`
Expected: FAIL — `mem code` is not a known command yet (the `safeRegister('code', …)` thunk's `require('./code-perception/cli')` throws and warns), so commander reports an unknown command and `res.status` is `1`, not `0`.

- [ ] **Step 3a: Create `templates/cli/code-perception/cli.js`**

```javascript
'use strict';

// `mem code` command group — the human/agent CLI over the ONE Unified Explore
// service (../code-perception.js). Unified exit model (spec §3.1): success and
// capability-degraded both exit 0; only result.ok===false (internal invariant /
// adapter break with no fallback) exits 1; commander handles invalid args (exit 2).

function printResult(result, options) {
    if (options && options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
    }
    console.log(`code explore: "${result.query}"`);
    console.log(`  providers: ${result.providers.map(p => p.id + (p.degraded ? '(degraded)' : '')).join(', ') || 'none'}`);
    console.log(`  freshness: stale=${result.freshness.stale} dirty=${result.freshness.dirty}`);
    console.log(`  matches: ${result.matches.length}  relationships: ${result.relationships.length}  links: ${result.governance.links.length}`);
    if (result.recommendedReading.length) {
        console.log('  recommended reading:');
        for (const r of result.recommendedReading.slice(0, 8)) console.log(`    [${r.priority}] ${r.path} — ${r.reason}`);
    }
    if (result.diagnostics.length) console.log(`  diagnostics: ${result.diagnostics.length}`);
}

function exitFor(result) {
    // Success-shaped degradation exits 0; only a true invariant break exits 1.
    process.exitCode = result && result.ok === false ? 1 : 0;
}

// Spec §3.1 / Global Constraint: invalid CLI args must exit 2. Commander's
// DEFAULT for unknown-command / missing-argument is exit 1, so the `code` group
// installs a SCOPED exitOverride (on the group + every subcommand — never on the
// root program, which would change exit codes for every other `mem` command).
// help/version are not errors → exit 0; every other parse failure → exit 2.
function invalidArgsExit(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'commander.help' || code === 'commander.helpDisplayed'
        || code === 'commander.version' || code === 'commander.helpDisplayedAfterError') {
        process.exit(0);
    }
    if (err && err.message) process.stderr.write(err.message + '\n');
    process.exit(2);
}

function registerCodeCommands(program) {
    const service = require('../code-perception');
    const code = program.command('code').description('Provider-first code perception: explore code + governance context.');

    code.command('providers')
        .description('List code-perception providers and their availability.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const result = await service.exploreCode('', { includeSource: false, includeImpact: false, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ providers: result.providers, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log('providers:'); for (const p of result.providers) console.log(`  ${p.id}  role=${p.role} ready=${p.ready} index=${p.indexState}${p.degraded ? ' (degraded)' : ''}`); }
            exitFor(result);
        });

    code.command('status')
        .description('Show provider status, freshness and governance link counts.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const result = await service.exploreCode('', { includeSource: false, includeImpact: false });
            if (options.json) process.stdout.write(JSON.stringify({ providers: result.providers, freshness: result.freshness, links: result.governance.linkSummary, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`freshness: stale=${result.freshness.stale} dirty=${result.freshness.dirty}`); console.log(`links: ${JSON.stringify(result.governance.linkSummary)}`); }
            exitFor(result);
        });

    code.command('search <query>')
        .description('Search code symbols (structural provider; degrades to empty under native-lite).')
        .option('--json', 'Print JSON output')
        .action(async (query, options) => {
            const result = await service.exploreCode(query, { includeSource: false, includeImpact: false, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ query: result.query, matches: result.matches, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${result.matches.length} match(es) for "${query}"`); for (const m of result.matches) console.log(`  ${m.name}  ${m.filePath || ''}`); }
            exitFor(result);
        });

    code.command('explore <query>')
        .description('Unified explore: matches + relationships + impact + governance + recommended reading.')
        .option('--json', 'Print JSON output')
        .action(async (query, options) => {
            const result = await service.exploreCode(query, {});
            printResult(result, options);
            exitFor(result);
        });

    code.command('callers <symbol>')
        .description('Show callers of a symbol (structural provider required).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: false, includeGovernance: false });
            const callers = result.relationships.filter(r => r.kind === 'called_by');
            if (options.json) process.stdout.write(JSON.stringify({ symbol, callers, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${callers.length} caller(s) of ${symbol}`); for (const c of callers) console.log(`  ${c.source.name} ${c.source.filePath || ''}`); }
            exitFor(result);
        });

    code.command('callees <symbol>')
        .description('Show callees of a symbol (structural provider required).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: false, includeGovernance: false });
            const callees = result.relationships.filter(r => r.kind === 'calls');
            if (options.json) process.stdout.write(JSON.stringify({ symbol, callees, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${callees.length} callee(s) of ${symbol}`); for (const c of callees) console.log(`  ${c.target.name} ${c.target.filePath || ''}`); }
            exitFor(result);
        });

    code.command('impact <symbol>')
        .description('Show downstream impact of a symbol (structural provider required; success-shaped guidance otherwise).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: true, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ symbol, impact: result.impact || null, diagnostics: result.diagnostics }, null, 2) + '\n');
            else if (result.impact) console.log(`impact of ${symbol}: risk=${result.impact.risk} downstream=${result.impact.downstream.length}`);
            else console.log(`impact analysis unavailable for ${symbol} (no structural provider). See diagnostics.`);
            exitFor(result);
        });

    code.command('context')
        .description('Governance context for the current focus / a task / a spec.')
        .option('--task <task-id>', 'Scope to a task id')
        .option('--spec <spec-id>', 'Scope to a spec id')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const focusId = options.task || options.spec || undefined;
            const query = options.task || options.spec || '';
            const result = await service.exploreCode(query, { focusId, includeSource: false, includeImpact: false });
            const links = focusId ? result.governance.links.filter(l => l.governanceEntityId === focusId) : result.governance.links;
            if (options.json) process.stdout.write(JSON.stringify({ scope: focusId || 'focus', links, tasks: result.governance.tasks, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`context: ${focusId || 'current focus'} — ${links.length} link(s)`); for (const l of links) console.log(`  ${l.kind} ${l.status} conf=${l.confidence}`); }
            exitFor(result);
        });

    code.action(() => code.outputHelp());

    // Scope the exit-2 override to this group + its subcommands — never the root
    // program (that would change every other `mem` command's exit codes). Applied
    // AFTER all subcommands exist. The nested-group walk is kept so a future
    // subgroup (e.g. `mem code wiki` in Phase 4b) is covered without a code change.
    const scoped = [code, ...code.commands];
    for (const c of code.commands) scoped.push(...(Array.isArray(c.commands) ? c.commands : []));
    for (const c of scoped) c.exitOverride(invalidArgsExit);
}

module.exports = { registerCodeCommands };
```

- [ ] **Step 3b: Wire the thunk in `templates/cli/memory.js`** — add one line immediately after the existing `code-perception` registrar (line ~731):

Find:

```javascript
    safeRegister('code-perception', () => require('./code-perception/post-commit-code-perception').registerCodePerceptionCommands(program));
```

Add directly below it:

```javascript
    safeRegister('code', () => require('./code-perception/cli').registerCodeCommands(program));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-cli"`
Expected: PASS — `✅ T-ce-cli mem code CLI passed`.

*(Phase 4a intentionally registers no `mem code wiki` subgroup. `code-perception/wiki.js` and its CLI handlers belong exclusively to the parked Phase 4b plan, which adds the subgroup together with the module.)*

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception/cli.js templates/cli/memory.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(code-perception): mem code command group + unified exit model (task:ce-mem-code-cli)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `evo_code_explore` MCP tool

**Files:**
- Modify: `templates/cli/mcp-server.js` (append TOOLS entry + dispatch case + handler)
- Modify: `templates/cli/mcp-validate.js` (add tool to validator list + `summarise` case)
- Test: `templates/cli/test/governance.js` (append block `T-ce-mcp`)

**Interfaces:**
- Consumes: `code-perception.js#exploreCode` via `freshRequire('./code-perception')` (same service, hot-reloadable in the long-lived MCP process).
- Produces: MCP tool `evo_code_explore` (schema per spec §4) + an exported `handleCodeExplore(args, deps?)`. Returns the `UnifiedExploreResult` as JSON text; NEVER `isError:true` for capability gaps (`result.ok === true`). A `result.ok === false` (true fatal) is re-thrown so the CallTool catch produces `isError:true` — the unified error model must not wrap a fatal as a success envelope.

- [ ] **Step 1: Write the failing test** — append after the T-ce-cli block:

```javascript
        console.log('T-ce-mcp. Testing evo_code_explore MCP tool (registered + unified error model) ...');
        {
            const mcp = require(path.join(TEMPLATE_CLI_DIR, 'mcp-server.js'));
            const tool = mcp.TOOLS.find(t => t.name === 'evo_code_explore');
            assert.ok(tool, 'evo_code_explore must be registered in TOOLS');
            assert.ok(tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.query, 'tool schema declares query');
            assert.deepStrictEqual(tool.inputSchema.required, ['query'], 'query is required');
            // Validator must include it so AC ac-mcp-code-explore stays green.
            const valSrc = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'mcp-validate.js'), 'utf8');
            assert.ok(valSrc.includes('evo_code_explore'), 'mcp-validate.js must call evo_code_explore');

            // Unified error model — capability gap is success-shaped: handler RESOLVES (never throws).
            const okResult = await mcp.handleCodeExplore({ query: 'x' }, {
                service: { exploreCode: async () => ({ ok: true, query: 'x', matches: [], providers: [], diagnostics: [], governance: { links: [] } }) },
            });
            assert.strictEqual(okResult.ok, true, 'capability gap returns a success-shaped result (no isError)');

            // Unified error model — a true fatal (ok:false) MUST throw so the CallTool
            // catch sets isError:true; it must NOT be wrapped as a success envelope.
            let threw = false;
            try {
                await mcp.handleCodeExplore({ query: 'x' }, {
                    service: { exploreCode: async () => ({ ok: false, diagnostics: [{ code: 'internal-error', message: 'boom' }] }) },
                });
            } catch (err) {
                threw = true;
                assert.ok(/boom/.test(err.message), 'fatal error message carries the diagnostics');
            }
            assert.ok(threw, 'result.ok===false must throw (maps to isError:true), not return a success envelope');
        }
        console.log('✅ T-ce-mcp evo_code_explore passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-mcp"`
Expected: FAIL — `evo_code_explore must be registered in TOOLS` (and `mcp.handleCodeExplore` is not yet exported).

- [ ] **Step 3a: Add the tool to `templates/cli/mcp-server.js`** — append to the `TOOLS` array (after the `evo_active_context` entry, before the closing `]`):

```javascript
    {
        name: 'evo_code_explore',
        description: 'Explore code and its Evo-Lite governance context using the best available code-perception provider.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                focusId: { type: 'string' },
                includeSource: { type: 'boolean', default: true },
                includeImpact: { type: 'boolean', default: true },
                maxResults: { type: 'number', default: 10 },
            },
            required: ['query'],
        },
    },
```

Add the handler (after `handleActiveContext`). The `deps` seam exists ONLY so the test can inject a service that returns `ok:false` deterministically — production always uses `freshRequire('./code-perception')`:

```javascript
async function handleCodeExplore(args, deps) {
    const service = (deps && deps.service) || freshRequire('./code-perception');
    const result = await service.exploreCode((args && args.query) || '', {
        focusId: args && args.focusId,
        includeSource: !(args && args.includeSource === false),
        includeImpact: !(args && args.includeImpact === false),
        maxResults: Number(args && args.maxResults) || 10,
    });
    // Unified error model (spec §3.1 / §4). Capability gaps are SUCCESS-shaped
    // (result.ok === true) and returned verbatim — never isError. But result.ok
    // === false is the service's ONLY signal of a true fatal (internal invariant /
    // adapter break with no fallback). The CallTool handler sets isError:true ONLY
    // when the tool handler throws, so a fatal must throw here rather than be wrapped
    // as a success envelope. The diagnostics travel in the error message.
    if (result && result.ok === false) {
        const reasons = (result.diagnostics || []).map(d => d.message || d.code).filter(Boolean).join('; ');
        const err = new Error(`code explore failed: ${reasons || 'internal invariant error'}`);
        err.result = result;
        throw err;
    }
    return result;
}
```

Add the dispatch case (in the `switch (name)`):

```javascript
        case 'evo_code_explore':      return handleCodeExplore(args);
```

Export `handleCodeExplore` alongside the existing `module.exports` (so the test can exercise the error mapping directly): add `handleCodeExplore` to the exported object.

- [ ] **Step 3b: Add to `templates/cli/mcp-validate.js`** — append to that file's own `TOOLS` list:

```javascript
    { name: 'evo_code_explore', arguments: { query: 'memory engine selection', includeSource: false } },
```

And add a `summarise` case:

```javascript
        case 'evo_code_explore': return `${(data.matches || []).length} matches, ${(data.governance?.links || []).length} links, providers ${(data.providers || []).length}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-mcp"`
Expected: PASS — `✅ T-ce-mcp evo_code_explore passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/mcp-server.js templates/cli/mcp-validate.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(mcp): evo_code_explore tool backed by unified explore service (task:ce-mcp)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manifest registration + 4a mirror closure

**Files:**
- Modify: `templates/cli/template-manifest.js` (register the 2 NEW managed files)
- Test: `templates/cli/test/governance.js` (append block `T-ce-manifest-sync-4a`)
- Mirror (generated, do NOT hand-edit): every managed file this plan changed. **Do not hand-maintain that list** — see below.

**Interfaces:**
- Consumes: `sync-runtime-entry.js` (bootstrap-safe standalone entry); `template-manifest.js#{MANAGED_TEMPLATE_FAMILIES, buildManagedTemplateEntries}`.
- Produces: `code-perception.js` + `code-perception/cli.js` registered as managed core-cli entries; a second `sync-runtime-entry` run reports zero changes; **every** managed core-cli file is byte-identical to its template.

**Why no `AFFECTED = [...]` list:** two consecutive plan reviews miscounted it (9 vs the real 11 — `template-manifest.js` and `test/governance.js` are themselves managed and were both missed). A hand-maintained constant is exactly the thing that drifts. The mirror invariant is not "the files I remembered are identical" but **"every managed entry is identical"** — so assert that directly, derived from the manifest itself.

**Why the check must not skip or approximate:** the manifest is the exact expectation, so the test asserts `checked === core.files.length` (90 entries today) and asserts each template EXISTS rather than `continue`-ing past it. A `if (!exists) continue` + `checked >= 50` shape would re-open the exact hole a derived check exists to close: a managed entry pointing at a missing template would be silently skipped, `sync-runtime` would silently not copy it, and the suite would still be green. Verified against the current tree: all 90 core-cli entries resolve to real templates, so the strict form has no legitimate skip to accommodate.

- [ ] **Step 1: Write the failing test** — append after the T-ce-mcp block:

```javascript
        console.log('T-ce-manifest-sync-4a. New files managed + EVERY managed mirror byte-identical ...');
        {
            const cp = require('child_process');
            const manifest = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            const core = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');

            // The 2 files 4a introduces must be registered (wiki.js belongs to 4b).
            for (const f of ['code-perception.js', 'code-perception/cli.js']) {
                assert.ok(core.files.includes(f), `${f} must be a managed core-cli template`);
            }
            assert.ok(!core.files.includes('code-perception/wiki.js'),
                'code-wiki is Phase 4b — 4a must not register it');

            // Converge into a TEMP workspace — never mutate the real repo's mirror in a test.
            // sync-runtime resolves its template SOURCE from EVO_LITE_TEMPLATE_CLI_DIR /
            // EVO_LITE_TEMPLATE_ROOT_DIR (sync-runtime.js:10-16); without them a run whose cwd is
            // the temp workspace finds no templates and returns status:'no-templates' (copies
            // nothing). Point them at the REAL template tree so the temp mirror converges from it.
            // Same override pattern as T-sr-entry.
            const runtime = createTempRuntimeRoot('ce-manifest-4a');
            const entry = path.join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js');
            const run = () => JSON.parse(cp.execFileSync(process.execPath, [entry, '--json'], {
                cwd: runtime.workspaceRoot,
                env: {
                    ...process.env,
                    EVO_LITE_WORKSPACE_ROOT: runtime.workspaceRoot,
                    EVO_LITE_TEMPLATE_CLI_DIR: TEMPLATE_CLI_DIR,
                    EVO_LITE_TEMPLATE_ROOT_DIR: path.join(WORKSPACE_ROOT, 'templates'),
                },
                encoding: 'utf8',
            }));
            run();                      // seed from the template entry
            const second = run();       // must converge
            assert.strictEqual(second.copied.length, 0, 'second sync-runtime-entry run must report zero copies (converged)');

            // EVERY managed core-cli entry — derived from the manifest, not a hand list.
            // No skipping: a manifest entry whose template is missing is itself a defect
            // (sync-runtime would silently not copy it), so assert existence rather than
            // `continue`. And assert the exact count from the manifest — a `>= N` gate
            // would let a skipped entry pass unnoticed, which is the very hole a derived
            // check exists to close.
            const mirrorCliDir = path.join(runtime.workspaceRoot, '.evo-lite', 'cli');
            let checked = 0;
            for (const rel of core.files) {
                const tpl = path.join(TEMPLATE_CLI_DIR, ...rel.split('/'));
                const mir = path.join(mirrorCliDir, ...rel.split('/'));
                assert.ok(fs.existsSync(tpl), `${rel} is declared as managed but the template file is missing`);
                assert.ok(fs.existsSync(mir), `${rel} must exist in the runtime mirror`);
                assert.ok(fs.readFileSync(tpl).equals(fs.readFileSync(mir)), `${rel} mirror must be byte-identical to template`);
                checked += 1;
            }
            assert.strictEqual(checked, core.files.length, 'every core-cli manifest entry must be checked');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-manifest-sync-4a mirror parity passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-manifest-sync-4a|must be a managed" | head`
Expected: FAIL — `code-perception.js must be a managed core-cli template`.

- [ ] **Step 3a: Register the files** in `templates/cli/template-manifest.js`. In the `core-cli` family `files` array, add the two entries next to the existing `code-perception/*` group (e.g. right after `'code-perception/provider-router.js',`):

```javascript
            'code-perception.js',
            'code-perception/cli.js',
```

- [ ] **Step 3b: Converge the real mirror** — seed from the template entry, then let the standalone entry converge to zero:

```bash
node templates/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
```

Expected on the final run: `copied: 0` (converged).

- [ ] **Step 4: Run both suites DIRECTLY and confirm exit 0**

No `| tail` — a pipe masks the exit code:

```bash
node templates/cli/test.js all;   echo "template suite exit: $?"
node ./.evo-lite/cli/test.js all; echo "runtime suite exit:  $?"
```

Expected: both print `exit: 0` and include the passing `T-ce-*` blocks. The runtime run proves the mirror is coherent and executable.

- [ ] **Step 5: Commit** — stage the templates this task edited plus **whatever mirror files the convergence actually rewrote**. Derive that list from git, do not type it from memory:

```bash
git status --short .evo-lite/cli   # <- this is the authoritative list
git add templates/cli/template-manifest.js templates/cli/test/governance.js
git add .evo-lite/cli              # every mirror file the sync touched
git status --short                 # verify: no .evo-lite/generated/** staged
git commit -m "$(cat <<'EOF'
feat(manifest): register unified explore agent-surface files + converge runtime mirror (task:ce-manifest-sync)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

The generated lock `.evo-lite/generated/runtime-mirror.lock.json` is git-ignored and is NOT a committed artifact — `git add .evo-lite/cli` cannot reach it, and `git status --short` confirms.

---

## Self-Review

### Spec coverage — what 4a closes, and what it deliberately leaves open

| AC (spec §9) | 4a status | Satisfied by |
|----|----|----|
| `ac-unified-explore` | **closed by 4a** (with the symbol-level-governance caveat below) | T2 (service) + T1 (M1/M2 seam) + T3 (real composition) + T4 (`mem code explore --json` verifier). Scenarios: **A** native-lite degradation (`ok:true`, `matches:[]`, `capability-unavailable`, non-dangling `declares_file`), **B** injected structural provider (matches/relationships/impact/source; M1 produces a valid SymbolReference; and — because the default Planning IR carries no `task.symbols`/structured evidence — the service must NOT fabricate a derived Task-to-Symbol link, so `derived === 0` and opaque evidence is retained + explained), **B2** compatibility contract (a structured `evidence.symbols` row with no code anchor still reaches the linker → derived link exists; guards the dormant seam without claiming the built-in producer emits it), **C** ready-provider throw → `ok:false` + `adapter-exception`. |
| `ac-mcp-code-explore` | **closed by 4a** | T5 (tool + exported handler; `ok:false` → throw → `isError:true`; capability gaps stay success-shaped) + `mcp-validate.js` registration (the AC's verifier). |
| `ac-mirror-parity` | **partially closed** | T6 covers every managed file 4a touches, derived from the manifest. 4b re-runs closure for the files it adds. |
| `ac-minimal-code-wiki` | **OPEN — parked** | `plan:code-wiki-inspector-projection` |
| `ac-inspector-code-surface` | **OPEN — parked** | `plan:code-wiki-inspector-projection` |

**The parent spec must NOT be marked done when this plan completes.** Two of its five ACs stay genuinely open. Honest state: `plan:unified-code-explore-agent-surface-mvp = done`, `spec:unified-code-explore-wiki-projection = adopted/active`, `plan:code-wiki-inspector-projection = parked`.

**Symbol-level-governance caveat (what 4a actually delivers).** 4a delivers **structural code exploration** (matches / callers / callees / impact / source, when a structural provider is present) plus **file-, commit-, and focus-level governance links** (`declares_file`, `changed_by_commit`, `related_to_focus`, all confidence 1.0). It does **NOT** deliver confirmed/derived **symbol-level** Task-to-Code or Evidence-to-Code links on the built-in pipeline: the default Planning producer emits no `task.symbols` and only opaque string evidence, so those rule-gated links have no live input path (see Grounded reality). The M1/M2 seams are implemented, unit-proven, and ready for a future explicit producer, but must not be described as a shipped default capability. External validation should validate this real product — Task→File→Commit→Focus — not a fixture-simulated Task→Symbol.

### Spec section coverage

§2 `UnifiedExploreResult` (incl. `files`/`modules`/`focus`) → T2. §2.1 ExploreQuery → T2 `ExploreOpts`. §2.2 steps 1–10 → T2 orchestration (focus resolved by exact order; governance built from files+symbols+focus+commits+acceptance + linkable-only evidence + persisted-graph merge; opaque evidence retained separately in `governance.evidence`). §2.3 recommended-reading order → T2 `rankRecommendedReading` (8 tiers, each with a `reason`). §2.4 M1/M2 → T1, wired in T2. §3 CLI contract → T4. §3.1 unified exit/error model → T2 fatal gate (`FATAL_CODES`) + T4 `exitFor` (ok:false→1) and scoped `exitOverride` (invalid args→2) + T5 MCP (`ok:false`→throw→isError). §4 MCP → T5. §7 mirror parity → T6. §8 phases → this plan IS Phase 4a. §5 Code Wiki / §6 Inspector → **not in this plan** (4b).

`files`/`modules` remain in the T2 result shape even though only 4b renders them: they are cheap, derived from file facts the service already fetches, and dropping them would force a T2 signature change when 4b activates. `focus` is consumed by 4a itself (T3-B asserts it).

### Type / signature consistency

- `toSymbolReferences(matches, opts?)` — defined T1, consumed T2 (`{focusId}`). ✔
- `normalizeDerivedLinkConfidence(links)` / `DERIVED_LINK_CONFIDENCE_FLOOR` — defined T1, consumed T1 test + T2. ✔
- `exploreCode(query, opts) -> UnifiedExploreResult{query,ok,freshness,providers,matches,relationships,impact?,source,files,modules,focus,governance,recommendedReading,diagnostics}` — defined T2, consumed identically in T3 (composition), T4 (CLI), T5 (MCP). ✔
- `handleCodeExplore(args, deps?)` — defined + exported T5; `deps` exists solely so the test can inject an `ok:false` service deterministically. ✔
- `registerCodeCommands(program)` — defined T4, thunked in `memory.js` via `safeRegister`; scoped `exitOverride` maps invalid args → 2 (commander's default is 1). ✔
- `buildGovernanceLinks` inputs used (`planIR.tasks`, `fileReferences`, `symbolReferences`, `focusReferences`, `commits`, `acceptanceDependencies`, and ONLY the **linkable** evidence) match the API map. The service hands the linker only evidence rows carrying a code anchor (`codeReferenceId` / resolvable `filePath`); the built-in producer yields none, so `implements_task:derived` / `verified_by_test` / `evidenced_by_archive` are dormant on the default pipeline (see Grounded reality). ✔

### Verified producer shapes this plan binds to

Each was mis-assumed at least once during review; all are now recorded in **Grounded reality** and pinned by T3:

- `post-commit-last-run.json` = `{commit, changedFiles}` — NOT `commits`/`headSha`.
- active-context backlog rows = `{checked, hash, line, text}` — and `hash` is a free-form human slug (`fresh-plan-progress`, `06fd`), **not** a Planning-IR task id. The backlog is a scratchpad, not a task registry.
- Real FOCUS text = `"<plan title>: <task title>"` (written by `advanceFocusFromCommit`) — contains **no** task id. Exact-title match is the only working automatic bridge.
- `changed_by_commit` entityId = `commit:<sha>` — never a task id.
- `templates/cli/memory.js` cannot be spawned without `NODE_PATH` pointing at the workspace runtime's `node_modules` (`better-sqlite3` lives there, not in the package deps) — existing idiom: `harness.js:18`, `integration.js:650/678/705`.

### Placeholder scan

No `TODO` / "add error handling" / "similar to Task N" / prose-instead-of-code. Every code step carries complete, runnable code.

---

## Execution Handoff

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (T1→T6), review between tasks. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

On completion: **freeze feature work** and start the external Validation Sprint (publish, 5-minute install path, 3-minute `mem code explore` + MCP demo, 3–5 external users). Do NOT start `plan:code-wiki-inspector-projection` until that sprint produces evidence for it.
