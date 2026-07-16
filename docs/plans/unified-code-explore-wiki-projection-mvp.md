---
id: plan:unified-code-explore-wiki-projection-mvp
title: Unified Code Explore & Code Wiki Projection (MVP)
status: draft
linkedSpec: spec:unified-code-explore-wiki-projection
---

# Unified Code Explore & Code Wiki Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one shared Unified Explore service that backs `mem code` CLI, the `evo_code_explore` MCP tool, a pure-derived Code Wiki projection, and an Inspector Code page — with the M1/M2 adapter↔linker seams nailed down so governance links never silently drop.

**Architecture:** A single stateless service (`code-perception.js#exploreCode`) orchestrates sub-spec ①'s router/loader + ②'s adapter/linker/status exactly per spec §2.2, converts references through the one M1 seam (`normalize.js#toSymbolReferences`), floors derived-link confidence through the one M2 seam (`normalize.js#normalizeDerivedLinkConfidence`), and returns a `UnifiedExploreResult`. Four thin surfaces (CLI group, MCP tool, Wiki builder, Inspector routes) all call that one service — no duplicate logic. All new files are registered as managed core-cli templates and mirrored byte-identical via the bootstrap-safe `sync-runtime-entry`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`, no build step), commander (existing CLI framework), `@modelcontextprotocol/sdk` (existing MCP server), zero-dep `http.createServer` (existing Inspector), Node `assert` test harness (`templates/cli/test/*.js`). Windows-first. `node:crypto`/`node:fs`/`node:path` builtins only for new code; no new dependencies.

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
- **`scanPlanning`** (`planning/scan.js`) populates `task.linkedFiles` (from frontmatter) but **never** `task.symbols`. So derived `implements_task` links fire in dogfood only via `evidence.symbols` or commit `diffRanges` intersection, not via `task.symbols`.
- **`buildGovernanceLinks`** (`governance-linker.js`) `implements_task` derived confidence is `clampConfidence(symRef.resolutionConfidence)` → **0 when `resolutionConfidence` is undefined** (the M2 trigger). `declares_file`/`depends_on_file`/`changed_by_commit` are conf 1.0; heuristic `implements_task` proposed is ≤0.5; `verified_by_test`/`evidenced_by_archive`/`related_to_focus` are 1.0.
- **`readActiveContext`** is exported by `memory.service.js` (canonical, full parse). `sections.focus` is FREE TEXT — no structured spec/task field.
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
| `templates/cli/code-perception.js` (create) | Unified Explore service: `exploreCode`, `rankRecommendedReading`, `buildExploreStatus` | T2 |
| `templates/cli/code-perception/cli.js` (create) | `mem code` command group `registerCodeCommands` + unified exit model | T3 |
| `templates/cli/memory.js` (modify) | `safeRegister('code', …)` thunk | T3 |
| `templates/cli/mcp-server.js` (modify) | `evo_code_explore` TOOLS entry + dispatch case + handler | T4 |
| `templates/cli/mcp-validate.js` (modify) | add `evo_code_explore` to validator TOOLS + `summarise` | T4 |
| `templates/cli/code-perception/wiki.js` (create) | `buildCodeWiki`, `getWikiStatus` — pure-derived pages + manifest | T5 |
| `templates/cli/inspector.js` (modify) | `/api/code/status|focus|task` routes + Code page tab | T6 |
| `templates/cli/template-manifest.js` (modify) | register 3 new managed files | T7 |
| `templates/cli/test/governance.js` (modify) | `T-ce-seam`, `T-ce-explore`, `T-ce-cli`, `T-ce-mcp`, `T-ce-wiki`, `T-ce-inspector`, `T-ce-manifest-sync` | T1–T7 |

**Phase 4a = T1–T4** (Agent + CLI surface). **Phase 4b = T5–T7** (Human projection + parity).

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
  - `async exploreCode(query: string, opts?: ExploreOpts) -> UnifiedExploreResult`. `ExploreOpts = {focusId?, preferredProvider?, includeSource?, includeImpact?, includeGovernance?, maxResults?, maxSourceChars?, projectRoot?, config?, registry?}` (last three are DI seams for tests). Never throws; internal exceptions become diagnostics + `result.ok=false` only for true invariant breaks.
  - `rankRecommendedReading(inputs) -> ReadingItem[]` where `ReadingItem = {path, kind, reason, priority, confidence}` sorted by §2.3 order.
  - `UnifiedExploreResult = {query, ok, freshness, providers, matches, relationships, impact?, source, governance, recommendedReading, diagnostics}` (spec §2). `freshness = {stale, dirty, indexedCommit?, currentCommit?}`. `governance = {specs, plans, tasks, commits, evidence, links, linkSummary}`.

- [ ] **Step 1: Write the failing test** — append inside `runGovernanceTests()` after the T-ce-seam block:

```javascript
        console.log('T-ce-explore. Testing unified explore service (native-lite degradation, success-shaped) ...');
        {
            const svc = require(require('path').join(TEMPLATE_CLI_DIR, 'code-perception.js'));
            const runtime = createTempRuntimeRoot('ce-explore');
            // Seed a plan-ir with a task whose linkedFiles point at a real repo-relative file.
            const planDir = require('path').join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            writeText(require('path').join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = function selectEngine(){ return 1; };\n');
            fs.writeFileSync(require('path').join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }],
                tasks: [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'], evidence: [] }],
                warnings: [],
            }, null, 2), 'utf8');

            // No codegraph configured -> native-lite fallback. symbols capability absent -> matches [].
            const result = await svc.exploreCode('engine selection', {
                projectRoot: runtime.workspaceRoot, config: {}, includeSource: false, includeImpact: true,
            });

            assert.strictEqual(result.ok, true, 'capability gap must be success-shaped (ok:true)');
            assert.strictEqual(result.query, 'engine selection', 'echoes the query');
            assert.ok(Array.isArray(result.matches), 'matches is an array');
            assert.ok(Array.isArray(result.providers) && result.providers.length >= 1, 'lists at least native-lite provider');
            assert.ok(result.freshness && typeof result.freshness.stale === 'boolean', 'freshness present');
            assert.ok(result.governance && Array.isArray(result.governance.links), 'governance links present');
            assert.ok(result.diagnostics.some(d => /no ready provider exposes symbols|degraded|fallback/i.test(d.message || d.code || '')),
                'a degraded/no-symbols diagnostic explains the missing structural capability');
            // declares_file link from linkedFiles + native-lite fileReferences must appear.
            assert.ok(result.governance.links.some(l => l.kind === 'declares_file'),
                'declares_file link derived from task.linkedFiles + native-lite file facts');
            // No derived link may carry 0 (M2 wired through the service).
            for (const l of result.governance.links) {
                assert.ok(!(l.status === 'derived' && !(l.confidence > 0)), 'service must floor derived links (M2)');
            }
            assert.ok(Array.isArray(result.recommendedReading), 'recommendedReading present');
            for (const r of result.recommendedReading) assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'every reading item explains its reason');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore unified service passed');
```

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

function safeReadActiveContext() {
    try {
        return require('./memory.service').readActiveContext();
    } catch (_) {
        return { sections: { focus: '' }, summary: { focus: '' }, tasks: [], trajectory: [] };
    }
}

// Resolve free-text focus (spec §2.4: the linker NEVER parses free text). We
// bind the active task (from Planning IR) to its declared files' CodeReferences
// and emit PRE-RESOLVED focusReferences [{governanceEntityId, codeReferenceId}].
function resolveFocusReferences(planIR, fileReferences, activeContext) {
    const focusReferences = [];
    const byPath = new Map();
    for (const ref of fileReferences) {
        if (ref && typeof ref.filePath === 'string') byPath.set(linker.normalizePath(ref.filePath), ref);
    }
    const focusText = (activeContext && activeContext.summary && activeContext.summary.focus)
        || (activeContext && activeContext.sections && activeContext.sections.focus) || '';
    // Prefer a task whose id/title is named in the focus text; else the first non-implemented task.
    const tasks = Array.isArray(planIR.tasks) ? planIR.tasks : [];
    let focusTask = tasks.find(t => t && t.id && focusText.includes(t.id))
        || tasks.find(t => t && t.title && focusText && focusText.includes(t.title))
        || tasks.find(t => t && t.status !== 'implemented')
        || null;
    if (focusTask && Array.isArray(focusTask.linkedFiles)) {
        for (const lf of focusTask.linkedFiles) {
            const ref = byPath.get(linker.normalizePath(lf));
            if (ref) focusReferences.push({ governanceEntityId: focusTask.id, codeReferenceId: ref.id });
        }
    }
    return { focusReferences, focusTask };
}

async function callProvider(candidates, request, invoke, diagnostics) {
    const selection = router.selectProvider(request, candidates);
    if (Array.isArray(selection.diagnostics)) diagnostics.push(...selection.diagnostics);
    if (!selection.candidate) {
        if (selection.reason) diagnostics.push(diag('capability-unavailable', selection.reason));
        return { selection, value: null };
    }
    const provider = selection.candidate.registration.provider;
    try {
        const value = await invoke(provider, selection.candidate.status);
        return { selection, value };
    } catch (err) {
        // Adapter exception is the ONE non-capability failure — surface it but
        // do not crash the service; caller decides ok-ness.
        diagnostics.push(diag('adapter-exception', err && err.message ? err.message : String(err),
            provider && provider.id));
        return { selection, value: null, adapterError: true };
    }
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
    const context = { projectRoot };

    try {
        // §2.2 step 1 — load providers + active context + planning IR.
        const config = options.config
            || (function () { const c = runtime.getEvoConfig(); return c && c.codePerception ? c : {}; })();
        const loaded = loader.loadProviders(config, options.registry ? { registry: options.registry } : {});
        if (Array.isArray(loaded.diagnostics)) diagnostics.push(...loaded.diagnostics);
        const candidates = await router.inspectProviders(loaded.registrations, context);
        const activeContext = safeReadActiveContext();
        const planIR = loadPlanIR(projectRoot);

        // File facts (files capability) — always available via native-lite.
        let fileReferences = [];
        const files = await callProvider(candidates, { capability: 'files' },
            (p) => p.getFiles(context, {}), diagnostics);
        if (files.value && Array.isArray(files.value.files)) {
            fileReferences = files.value.files.map(f => f.reference).filter(Boolean);
            if (Array.isArray(files.value.diagnostics)) diagnostics.push(...files.value.diagnostics);
        }

        // §2.2 step 3-4 — structural search (symbols). Absent under native-lite → matches [].
        let matches = [];
        const searchSel = await callProvider(candidates, { capability: 'symbols', preferredProvider: options.preferredProvider },
            (p, st) => p.search(context, q).then(raw => normalizeSearchResult(st, raw)), diagnostics);
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
                    (p) => p[method](context, topSymbol), diagnostics);
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
                (p, st) => p.impact(context, topSymbol).then(raw => normalizeImpactResult(st, raw)), diagnostics);
            if (imp.value) impact = imp.value;
        }

        // §2.2 step 7 — source excerpts (when requested + supported).
        const source = [];
        if (includeSource && matches.length) {
            for (const m of matches.slice(0, 3)) {
                const ent = await callProvider(candidates, { capability: 'source' },
                    (p) => p.getEntity(context, { entity: m.providerEntityId || m.name }), diagnostics);
                if (ent.value && typeof ent.value.content === 'string') {
                    source.push({ reference: ent.value.reference || m, excerpt: ent.value.content.slice(0, maxSourceChars),
                        truncated: Boolean(ent.value.truncated) });
                }
            }
        }

        // §2.2 step 2 + 8 — resolve focus, then build governance links via the
        // ONE M1 seam; then apply the M2 floor before ranking/projection.
        const { focusReferences, focusTask } = resolveFocusReferences(planIR, fileReferences, activeContext);
        const symbolReferences = toSymbolReferences(matches, { focusId: options.focusId });
        const evidence = [];
        for (const t of (planIR.tasks || [])) {
            for (const e of (Array.isArray(t.evidence) ? t.evidence : [])) {
                if (e && typeof e === 'object') evidence.push(Object.assign({ taskId: t.id }, e));
            }
        }
        let links = [];
        if (includeGovernance) {
            const built = linker.buildGovernanceLinks({
                planIR: { tasks: planIR.tasks },
                fileReferences, symbolReferences, focusReferences, evidence,
            });
            links = Array.isArray(built.links) ? built.links : [];
            if (Array.isArray(built.diagnostics)) diagnostics.push(...built.diagnostics);
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
            commits: [], evidence, links, linkSummary,
        };

        return {
            query: q, ok: true, freshness,
            providers: statusReport.providers, matches, relationships,
            impact, source, governance, recommendedReading, diagnostics,
        };
    } catch (err) {
        // A genuine internal invariant break — the only ok:false path.
        diagnostics.push(diag('internal-error', err && err.message ? err.message : String(err)));
        return {
            query: q, ok: false, freshness: { stale: false, dirty: false },
            providers: [], matches: [], relationships: [], source: [],
            governance: { specs: [], plans: [], tasks: [], commits: [], evidence: [], links: [], linkSummary: { confirmed: 0, derived: 0, proposed: 0 } },
            recommendedReading: [], diagnostics,
        };
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
Expected: PASS — `✅ T-ce-explore unified service passed`.

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

### Task 3: `mem code` command group + unified exit model

**Files:**
- Create: `templates/cli/code-perception/cli.js`
- Modify: `templates/cli/memory.js` (add one `safeRegister('code', …)` line)
- Test: `templates/cli/test/governance.js` (append block `T-ce-cli`)

**Design decision (justified):** Put the group in a **new** `code-perception/cli.js` exporting `registerCodeCommands(program)`, NOT inside `code-perception.js`. Rationale: `code-perception.js` is the pure, MCP/Inspector/Wiki-shared service and must stay free of commander so it can be `require`d in a long-lived MCP process and unit-tested without side effects; the CLI layer (option parsing, `console.log`, `process.exitCode`) is a distinct responsibility. This mirrors the shipped pattern (`planning.js`→`registerPlanCommands`, `spec-portfolio.js`→`registerSpecPortfolioCommands`) and keeps `safeRegister` thunks uniform.

**Interfaces:**
- Consumes: `../code-perception.js#exploreCode` (T2); `../code-perception/status`, `../provider-loader`, `../provider-router` (for `mem code providers`/`status`); commander `program`.
- Produces: `registerCodeCommands(program)` registering `mem code <providers|status|search|explore|callers|callees|impact|context|wiki>`. Exit codes: success/degraded → 0; internal invariant/security → 1 (`result.ok===false`); commander handles invalid args → 2. `wiki` subcommands are stubbed here to delegate to T5's module (added in T5).

- [ ] **Step 1: Write the failing test** — append after the T-ce-explore block:

```javascript
        console.log('T-ce-cli. Testing `mem code explore --json` success-shaped exit + shape ...');
        {
            const cp = require('child_process');
            const runtime = createTempRuntimeRoot('ce-cli');
            // Mirror the CLI into the temp runtime so `.evo-lite/cli/memory.js` exists.
            cp.execFileSync(process.execPath, [require('path').join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js')], {
                cwd: runtime.workspaceRoot, env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: runtime.workspaceRoot }, encoding: 'utf8',
            });
            const memCli = require('path').join(runtime.runtimeRoot, 'cli', 'memory.js');
            const res = cp.spawnSync(process.execPath, [memCli, 'code', 'explore', 'engine selection', '--json'], {
                cwd: runtime.workspaceRoot, env: { ...process.env, EVO_LITE_ROOT: runtime.runtimeRoot }, encoding: 'utf8',
            });
            assert.strictEqual(res.status, 0, 'capability gap must exit 0 (success-shaped): ' + (res.stderr || ''));
            const parsed = JSON.parse(res.stdout);
            assert.strictEqual(parsed.query, 'engine selection', 'JSON echoes query');
            assert.ok(Array.isArray(parsed.providers), 'JSON carries providers');
            assert.ok(parsed.freshness && typeof parsed.freshness.stale === 'boolean', 'JSON carries freshness');
            // Invalid subcommand -> commander exit 2.
            const bad = cp.spawnSync(process.execPath, [memCli, 'code', 'nonexistent-subcmd'], {
                cwd: runtime.workspaceRoot, env: { ...process.env, EVO_LITE_ROOT: runtime.runtimeRoot }, encoding: 'utf8',
            });
            assert.strictEqual(bad.status, 2, 'invalid CLI args must exit 2');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-cli mem code CLI passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-cli|exit 0|exit 2" | head`
Expected: FAIL — `mem code` is not a known command, so `res.status` is `1` (commander unknown command on the top-level `code`) not `0`.

- [ ] **Step 3a: Create `templates/cli/code-perception/cli.js`**

```javascript
'use strict';

// `mem code` command group — the human/agent CLI over the ONE Unified Explore
// service (../code-perception.js). Unified exit model (spec §3.1): success and
// capability-degraded both exit 0; only result.ok===false (internal invariant /
// adapter break with no fallback) exits 1; commander handles invalid args (exit 2).

const path = require('node:path');

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
        .option('--focus', 'Use the current focus')
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

    // `mem code wiki` namespace — implemented in Task 5 (code-perception/wiki.js).
    const wiki = code.command('wiki').description('Minimal Code Wiki (pure-derived projection).');
    wiki.command('build')
        .description('Build the Code Wiki under .evo-lite/generated/code-wiki/.')
        .action(async () => {
            const { buildCodeWiki } = require('./wiki');
            const out = await buildCodeWiki({ projectRoot: require('../runtime').getWorkspaceRoot() });
            console.log(`code wiki built: ${out.pages.length} page(s) at ${out.dir}`);
        });
    wiki.command('status')
        .description('Show Code Wiki manifest status.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const { getWikiStatus } = require('./wiki');
            const st = getWikiStatus({ projectRoot: require('../runtime').getWorkspaceRoot() });
            if (options.json) process.stdout.write(JSON.stringify(st, null, 2) + '\n');
            else console.log(`code wiki: ${st.exists ? st.pageCount + ' page(s), built ' + st.generatedAt : 'not built'}`);
        });
    code.action(() => code.outputHelp());
    void path;
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

*(Note: the wiki subcommand handlers require `./wiki` which lands in Task 5; because the require is inside the action thunk, registration in Task 3 does not fail — only invoking `mem code wiki *` before Task 5 would error, which no Task-3 test does.)*

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

### Task 4: `evo_code_explore` MCP tool

**Files:**
- Modify: `templates/cli/mcp-server.js` (append TOOLS entry + dispatch case + handler)
- Modify: `templates/cli/mcp-validate.js` (add tool to validator list + `summarise` case)
- Test: `templates/cli/test/governance.js` (append block `T-ce-mcp`)

**Interfaces:**
- Consumes: `code-perception.js#exploreCode` via `freshRequire('./code-perception')` (same service, hot-reloadable in the long-lived MCP process).
- Produces: MCP tool `evo_code_explore` (schema per spec §4). Returns the `UnifiedExploreResult` as JSON text; NEVER `isError:true` for capability gaps — only a thrown adapter/invariant error trips the existing catch in the CallTool handler.

- [ ] **Step 1: Write the failing test** — append after the T-ce-cli block:

```javascript
        console.log('T-ce-mcp. Testing evo_code_explore MCP tool (registered + success-shaped) ...');
        {
            const mcp = require(require('path').join(TEMPLATE_CLI_DIR, 'mcp-server.js'));
            const tool = mcp.TOOLS.find(t => t.name === 'evo_code_explore');
            assert.ok(tool, 'evo_code_explore must be registered in TOOLS');
            assert.ok(tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.query, 'tool schema declares query');
            assert.deepStrictEqual(tool.inputSchema.required, ['query'], 'query is required');
            // Validator must include it so AC ac-mcp-code-explore stays green.
            const valSrc = fs.readFileSync(require('path').join(TEMPLATE_CLI_DIR, 'mcp-validate.js'), 'utf8');
            assert.ok(valSrc.includes('evo_code_explore'), 'mcp-validate.js must call evo_code_explore');
        }
        console.log('✅ T-ce-mcp evo_code_explore passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-mcp"`
Expected: FAIL — `evo_code_explore must be registered in TOOLS`.

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

Add the handler (after `handleActiveContext`):

```javascript
async function handleCodeExplore(args) {
    const service = freshRequire('./code-perception');
    const result = await service.exploreCode(args.query || '', {
        focusId: args.focusId,
        includeSource: args.includeSource !== false,
        includeImpact: args.includeImpact !== false,
        maxResults: Number(args.maxResults) || 10,
    });
    // Success-shaped even for capability gaps (spec §4): return the result as-is.
    return result;
}
```

Add the dispatch case (in the `switch (name)`):

```javascript
        case 'evo_code_explore':      return handleCodeExplore(args);
```

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

### Task 5: Minimal Code Wiki (pure-derived projection)

**Files:**
- Create: `templates/cli/code-perception/wiki.js`
- Test: `templates/cli/test/governance.js` (append block `T-ce-wiki`)

**Interfaces:**
- Consumes: `../code-perception.js#exploreCode` (the ONE service); `../runtime.js#getWorkspaceRoot`.
- Produces:
  - `async buildCodeWiki(opts) -> {dir, pages: string[], manifest}`. `opts = {projectRoot}`. Writes `.evo-lite/generated/code-wiki/{manifest.json, overview.md, current-focus.md, providers.md, modules/<id>.md, tasks/<id>.md}`. Pure-derived: it reads only the service output + Planning IR; it writes ONLY under the generated dir; deleting the whole dir and re-running reproduces every page byte-for-byte (deterministic ordering, no timestamps in bodies except the provenance `generatedAt` field, which the determinism test injects a fixed clock for).
  - `getWikiStatus(opts) -> {exists, pageCount, generatedAt, provider, dependencies}`.
  - Every page starts with provenance frontmatter: `generatedBy / generatedAt / provider / providerVersion / indexedCommit / currentCommit / freshness / dependencies[]`.

- [ ] **Step 1: Write the failing test** — append after the T-ce-mcp block:

```javascript
        console.log('T-ce-wiki. Testing code wiki build determinism (delete-dir + rebuild reproduces) ...');
        {
            const wiki = require(require('path').join(TEMPLATE_CLI_DIR, 'code-perception', 'wiki.js'));
            const runtime = createTempRuntimeRoot('ce-wiki');
            const planDir = require('path').join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            writeText(require('path').join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = 1;\n');
            fs.writeFileSync(require('path').join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }],
                tasks: [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'], evidence: [] }],
                warnings: [],
            }, null, 2), 'utf8');

            const fixedClock = () => '2026-07-16T00:00:00.000Z';
            const wikiDir = require('path').join(runtime.runtimeRoot, 'generated', 'code-wiki');
            const first = await wiki.buildCodeWiki({ projectRoot: runtime.workspaceRoot, now: fixedClock });
            assert.ok(fs.existsSync(require('path').join(wikiDir, 'manifest.json')), 'manifest.json written');
            assert.ok(fs.existsSync(require('path').join(wikiDir, 'overview.md')), 'overview.md written');
            assert.ok(fs.existsSync(require('path').join(wikiDir, 'current-focus.md')), 'current-focus.md written');
            assert.ok(fs.existsSync(require('path').join(wikiDir, 'providers.md')), 'providers.md written');
            assert.ok(fs.existsSync(require('path').join(wikiDir, 'tasks', 'task-x.md')), 'per-task page written');
            const overview1 = fs.readFileSync(require('path').join(wikiDir, 'overview.md'), 'utf8');
            assert.ok(/generatedBy:/.test(overview1) && /provider:/.test(overview1), 'pages carry provenance frontmatter');

            // Delete the WHOLE generated dir and rebuild — every page must reproduce byte-identically.
            fs.rmSync(wikiDir, { recursive: true, force: true });
            assert.ok(!fs.existsSync(wikiDir), 'wiki dir deleted');
            await wiki.buildCodeWiki({ projectRoot: runtime.workspaceRoot, now: fixedClock });
            const overview2 = fs.readFileSync(require('path').join(wikiDir, 'overview.md'), 'utf8');
            assert.ok(Buffer.from(overview1).equals(Buffer.from(overview2)), 'delete-dir + rebuild reproduces overview.md byte-identically');

            const status = wiki.getWikiStatus({ projectRoot: runtime.workspaceRoot });
            assert.strictEqual(status.exists, true, 'status reports built');
            assert.ok(status.pageCount >= 4, 'status counts pages');
            void first;
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-wiki code wiki determinism passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-wiki|Cannot find module" | head`
Expected: FAIL — `Cannot find module '.../code-perception/wiki.js'`.

- [ ] **Step 3: Create `templates/cli/code-perception/wiki.js`**

```javascript
'use strict';

// Minimal Code Wiki (spec §5) — a PURE-DERIVED, read-only projection of the ONE
// Unified Explore service. Writes ONLY under .evo-lite/generated/code-wiki/.
// No canonical human truth lives here: deleting the whole dir and rebuilding
// reproduces every page byte-for-byte (deterministic ordering; the only clock
// value is the provenance `generatedAt`, injectable via opts.now for tests).

const fs = require('node:fs');
const path = require('node:path');

function slug(id) {
    return String(id).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function frontmatter(fields) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(fields)) {
        if (Array.isArray(v)) lines.push(`${k}:` + (v.length ? '\n' + v.map(x => `  - ${x}`).join('\n') : ' []'));
        else lines.push(`${k}: ${v === undefined || v === null ? '' : v}`);
    }
    lines.push('---', '');
    return lines.join('\n');
}

function writeFileAtomic(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function provenanceFor(result, generatedAt) {
    const p = result.providers[0] || {};
    return {
        generatedBy: 'evo-lite code-perception/wiki',
        generatedAt,
        provider: p.id || 'none',
        providerVersion: p.adapterVersion || 'unknown',
        indexedCommit: result.freshness.indexedCommit || 'unknown',
        currentCommit: result.freshness.currentCommit || 'unknown',
        freshness: `stale=${result.freshness.stale} dirty=${result.freshness.dirty}`,
        dependencies: ['.evo-lite/generated/planning/plan-ir.json', '.evo-lite/active_context.md'],
    };
}

async function buildCodeWiki(opts) {
    const options = opts || {};
    const projectRoot = options.projectRoot || require('../runtime').getWorkspaceRoot();
    const generatedAt = typeof options.now === 'function' ? options.now() : new Date().toISOString();
    const service = require('../code-perception');
    const result = await service.exploreCode('', { includeSource: false, includeImpact: false, projectRoot });

    const wikiDir = path.join(projectRoot, '.evo-lite', 'generated', 'code-wiki');
    // Fresh rebuild: clear any prior pages so a removed task/module never lingers.
    fs.rmSync(wikiDir, { recursive: true, force: true });

    const fm = provenanceFor(result, generatedAt);
    const pages = [];
    const write = (rel, body) => { writeFileAtomic(path.join(wikiDir, rel), frontmatter(fm) + body); pages.push(rel); };

    // overview.md
    const providersList = result.providers.map(p => `- ${p.id} (role ${p.role}, ready ${p.ready}${p.degraded ? ', degraded' : ''})`).join('\n') || '- none';
    const readingList = result.recommendedReading.slice(0, 10).map(r => `- [${r.priority}] \`${r.path}\` — ${r.reason}`).join('\n') || '- (none)';
    write('overview.md', [
        '# Code Overview', '',
        `Focus / provider status / freshness for **${path.basename(projectRoot)}**.`, '',
        '## Providers', providersList, '',
        '## Freshness', `- stale: ${result.freshness.stale}`, `- dirty: ${result.freshness.dirty}`, '',
        '## Governance links', `- ${JSON.stringify(result.governance.linkSummary)}`, '',
        '## Recommended reading', readingList, '',
    ].join('\n'));

    // current-focus.md
    const focusTasks = (result.governance.tasks || []).filter(t => t.status !== 'implemented');
    write('current-focus.md', [
        '# Current Focus', '',
        focusTasks.length ? focusTasks.map(t => `- ${t.id} — ${t.title || ''} (${t.status})`).join('\n') : '- (no active task)', '',
        '## Focus-linked files',
        (result.governance.links.filter(l => l.kind === 'related_to_focus').map(l => `- ${l.codeReferenceId}`).join('\n')) || '- (none)', '',
    ].join('\n'));

    // providers.md
    write('providers.md', [
        '# Providers', '',
        result.providers.map(p => `## ${p.id}\n- role: ${p.role}\n- ready: ${p.ready}\n- indexState: ${p.indexState}\n- compatibility: ${p.compatibility}\n- degraded: ${p.degraded}${p.reason ? `\n- reason: ${p.reason}` : ''}`).join('\n\n') || '(none)', '',
    ].join('\n'));

    // tasks/<id>.md — deterministic order by task id.
    const sortedTasks = [...(result.governance.tasks || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const t of sortedTasks) {
        const taskLinks = result.governance.links.filter(l => l.governanceEntityId === t.id);
        const byStatus = s => taskLinks.filter(l => l.status === s).map(l => `  - ${l.kind} → ${l.codeReferenceId} (conf ${l.confidence})`).join('\n') || '  - (none)';
        write(path.join('tasks', `${slug(t.id)}.md`), [
            `# ${t.id}`, '', `**Title:** ${t.title || ''}`, `**Status:** ${t.status}`, '',
            '## Linked files', (Array.isArray(t.linkedFiles) && t.linkedFiles.length ? t.linkedFiles.map(f => `- \`${f}\``).join('\n') : '- (none)'), '',
            '## Confirmed links', byStatus('confirmed'), '',
            '## Derived links', byStatus('derived'), '',
            '## Proposed links', byStatus('proposed'), '',
        ].join('\n'));
    }

    // manifest.json — deterministic (sorted pages).
    const manifest = {
        version: 'evo-code-wiki@1', generatedAt, provider: fm.provider, providerVersion: fm.providerVersion,
        indexedCommit: fm.indexedCommit, currentCommit: fm.currentCommit,
        freshness: result.freshness, dependencies: fm.dependencies, pages: [...pages].sort(),
    };
    writeFileAtomic(path.join(wikiDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    return { dir: wikiDir, pages: [...pages].sort(), manifest };
}

function getWikiStatus(opts) {
    const options = opts || {};
    const projectRoot = options.projectRoot || require('../runtime').getWorkspaceRoot();
    const manifestPath = path.join(projectRoot, '.evo-lite', 'generated', 'code-wiki', 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { exists: false, pageCount: 0 };
    try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { exists: true, pageCount: (m.pages || []).length, generatedAt: m.generatedAt, provider: m.provider, dependencies: m.dependencies || [] };
    } catch (_) {
        return { exists: false, pageCount: 0 };
    }
}

module.exports = { buildCodeWiki, getWikiStatus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-wiki"`
Expected: PASS — `✅ T-ce-wiki code wiki determinism passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception/wiki.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(code-perception): minimal pure-derived Code Wiki projection (task:ce-wiki)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Inspector Code page + read-only `/api/code/*`

**Files:**
- Modify: `templates/cli/inspector.js` (add API branches in `handleApi` + a Code tab in `renderHtml`)
- Test: `templates/cli/test/governance.js` (append block `T-ce-inspector`)

**Interfaces:**
- Consumes: `code-perception.js#exploreCode`; `code-perception/wiki.js#getWikiStatus`; existing `getWorkspaceRoot`.
- Produces: read-only endpoints on the existing zero-dep server, dispatched by prefix on the full `req.url` (query string included):
  - `GET /api/code/status` → `{providers, freshness, links, wiki, diagnostics}`.
  - `GET /api/code/focus` → `{focusLinks, tasks, diagnostics}`.
  - `GET /api/code/task?id=<task-id>` → `{taskId, links, task, diagnostics}`.
  - All never auto-install/index a provider (they only call the read-only service), and surface diagnostics on provider failure. A missing `?id=` on `/task` → `400 {error}` (invalid arg), NOT a 500.

- [ ] **Step 1: Write the failing test** — append after the T-ce-wiki block:

```javascript
        console.log('T-ce-inspector. Testing Inspector /api/code/* read-only endpoints ...');
        {
            const inspector = require(require('path').join(TEMPLATE_CLI_DIR, 'inspector.js'));
            const http = require('http');
            const runtime = createTempRuntimeRoot('ce-inspector');
            const planDir = require('path').join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            fs.writeFileSync(require('path').join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [{ id: 'task:x', title: 'X', status: 'todo', linkedFiles: [], evidence: [] }], warnings: [],
            }, null, 2), 'utf8');
            const prevRoot = process.env.EVO_LITE_ROOT;
            process.env.EVO_LITE_ROOT = runtime.runtimeRoot;
            const { server, port } = await inspector.startServer({ port: 0 });
            const get = (p) => new Promise((resolve, reject) => {
                http.get({ host: '127.0.0.1', port, path: p }, res => {
                    let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
                }).on('error', reject);
            });
            try {
                const st = await get('/api/code/status');
                assert.strictEqual(st.status, 200, '/api/code/status returns 200');
                const stj = JSON.parse(st.body);
                assert.ok(Array.isArray(stj.providers) && stj.freshness, 'status carries providers + freshness');
                const focus = await get('/api/code/focus');
                assert.strictEqual(focus.status, 200, '/api/code/focus returns 200');
                const task = await get('/api/code/task?id=task:x');
                assert.strictEqual(task.status, 200, '/api/code/task?id= returns 200');
                assert.strictEqual(JSON.parse(task.body).taskId, 'task:x', 'task endpoint echoes id');
                const bad = await get('/api/code/task');
                assert.strictEqual(bad.status, 400, 'missing ?id= is a 400 invalid-arg, not a 500');
            } finally {
                server.close();
                if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT; else process.env.EVO_LITE_ROOT = prevRoot;
                fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
            }
        }
        console.log('✅ T-ce-inspector code endpoints passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-inspector|404|unknown api" | head`
Expected: FAIL — `/api/code/status` hits the fallthrough `send(404, {error:'unknown api'})`, so `st.status` is 404 not 200.

- [ ] **Step 3a: Add the API branches** in `templates/cli/inspector.js#handleApi`, inside the `try {` block, before the `} catch (error) {` line (after the existing `/api/drift` branch):

```javascript
        if (url.startsWith('/api/code/')) {
            const service = require('./code-perception');
            const { getWikiStatus } = require('./code-perception/wiki');
            const root = getWorkspaceRoot();
            const parsed = require('url').parse(url, true);
            const route = parsed.pathname;
            if (route === '/api/code/status') {
                return service.exploreCode('', { projectRoot: root, includeSource: false, includeImpact: false }).then(r => {
                    send(200, { providers: r.providers, freshness: r.freshness, links: r.governance.linkSummary, wiki: getWikiStatus({ projectRoot: root }), diagnostics: r.diagnostics });
                }).catch(e => send(500, { error: e.message }));
            }
            if (route === '/api/code/focus') {
                return service.exploreCode('', { projectRoot: root, includeSource: false, includeImpact: false }).then(r => {
                    send(200, { focusLinks: r.governance.links.filter(l => l.kind === 'related_to_focus'), tasks: r.governance.tasks, diagnostics: r.diagnostics });
                }).catch(e => send(500, { error: e.message }));
            }
            if (route === '/api/code/task') {
                const id = parsed.query && parsed.query.id;
                if (!id) return send(400, { error: 'missing required query parameter: id' });
                return service.exploreCode(id, { projectRoot: root, focusId: id, includeSource: false, includeImpact: false }).then(r => {
                    const links = r.governance.links.filter(l => l.governanceEntityId === id);
                    const task = (r.governance.tasks || []).find(t => t.id === id) || null;
                    send(200, { taskId: id, links, task, diagnostics: r.diagnostics });
                }).catch(e => send(500, { error: e.message }));
            }
            return send(404, { error: 'unknown code api', path: route });
        }
```

*(These branches `return` a Promise from `handleApi`; the existing synchronous branches ignore the return value, so mixing is safe — the response is sent inside `.then`.)*

- [ ] **Step 3b: Add a Code tab** to `renderHtml()`. Find the tab-button strip and the `load('timeline');` bootstrap (near line 305). Add a `code` tab button alongside the others (search the existing markup for the `<button` tab pattern used for `timeline`/`planning` and add one more that calls `showTab('code')`), and register a loader entry so `showTab('code')` fetches `/api/code/status`:

```html
        <button onclick="showTab('code')">Code</button>
```

and in the client-side `load()`/`showTab()` dispatch, add a `code` case that fetches `/api/code/status` and renders provider/freshness/links/wiki entry (reuse the existing `escapeHtml` + fetch idiom already present in the inline script). Minimal renderer body to insert into the inline `<script>` map that `load(name)` reads:

```javascript
      code: { url: '/api/code/status', render: d => '<h3>Code Perception</h3>'
        + '<p>Providers: ' + escapeHtml((d.providers||[]).map(p=>p.id+(p.degraded?'(degraded)':'')).join(', ')) + '</p>'
        + '<p>Freshness: stale=' + d.freshness.stale + ' dirty=' + d.freshness.dirty + '</p>'
        + '<p>Links: ' + escapeHtml(JSON.stringify(d.links)) + '</p>'
        + '<p>Wiki: ' + (d.wiki && d.wiki.exists ? (d.wiki.pageCount + ' pages') : 'not built') + '</p>' },
```

*(Match the exact object/registry shape the existing inline script uses for `timeline`/`planning`; the endpoint contract above is what the test pins — the HTML wiring is presentation and is covered only by the endpoint assertions.)*

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-inspector"`
Expected: PASS — `✅ T-ce-inspector code endpoints passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/inspector.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(inspector): read-only Code page + /api/code/* over unified service (task:ce-inspector)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manifest registration + mirror parity convergence

**Files:**
- Modify: `templates/cli/template-manifest.js` (register 3 new managed files)
- Mirror (generated, do NOT hand-edit): `.evo-lite/cli/code-perception.js`, `.evo-lite/cli/code-perception/cli.js`, `.evo-lite/cli/code-perception/wiki.js`
- Test: `templates/cli/test/governance.js` (append block `T-ce-manifest-sync`)

**Interfaces:**
- Consumes: `sync-runtime-entry.js` (bootstrap-safe standalone entry); `template-manifest.js#buildManagedTemplateEntries`.
- Produces: the new files registered as managed core-cli entries so `sync-runtime` copies them to the runtime mirror; a second `sync-runtime-entry` run reports zero changes; each mirror file is byte-identical to its template (Node `Buffer.equals`).

- [ ] **Step 1: Write the failing test** — append after the T-ce-inspector block:

```javascript
        console.log('T-ce-manifest-sync. Testing new code-perception files are managed + mirror byte-identical ...');
        {
            const manifest = require(require('path').join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            const core = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
            for (const f of ['code-perception.js', 'code-perception/cli.js', 'code-perception/wiki.js']) {
                assert.ok(core.files.includes(f), `${f} must be a managed core-cli template`);
            }
            // Converge the mirror via the bootstrap-safe standalone entry, twice.
            const cp = require('child_process');
            const run = () => cp.execFileSync(process.execPath, [require('path').join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js'), '--json'], {
                cwd: WORKSPACE_ROOT, env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: WORKSPACE_ROOT }, encoding: 'utf8',
            });
            run();
            const second = JSON.parse(run());
            assert.strictEqual(second.copied.length, 0, 'second sync-runtime-entry run must report zero copies (converged)');
            // Byte-identical check via Buffer.equals (not shell diff).
            for (const f of ['code-perception.js', 'code-perception/cli.js', 'code-perception/wiki.js']) {
                const tpl = fs.readFileSync(require('path').join(TEMPLATE_CLI_DIR, ...f.split('/')));
                const mir = fs.readFileSync(require('path').join(WORKSPACE_ROOT, '.evo-lite', 'cli', ...f.split('/')));
                assert.ok(Buffer.from(tpl).equals(Buffer.from(mir)), `${f} mirror must be byte-identical to template`);
            }
        }
        console.log('✅ T-ce-manifest-sync mirror parity passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-manifest-sync|must be a managed" | head`
Expected: FAIL — `code-perception.js must be a managed core-cli template` (not yet in the manifest list).

- [ ] **Step 3a: Register the files** in `templates/cli/template-manifest.js`. In the `core-cli` family `files` array, add the three entries next to the existing `code-perception/*` group (e.g. right after `'code-perception/provider-router.js',`):

```javascript
            'code-perception.js',
            'code-perception/cli.js',
            'code-perception/wiki.js',
```

- [ ] **Step 3b: Converge the mirror** from the template entry (first-run seed), then let the standalone entry converge to zero:

```bash
node templates/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
node ./.evo-lite/cli/sync-runtime-entry.js
```

Expected on the final run: `copied: 0` and `unchanged: <N>` (converged; zero changes).

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-manifest-sync"`
Expected: PASS — `✅ T-ce-manifest-sync mirror parity passed`.

Then run the FULL suite (template + runtime) to confirm no regressions and that the runtime mirror is executable:

Run: `node templates/cli/test.js all 2>&1 | tail -5`
Expected: the governance + integration suites finish without an `AssertionError` / non-zero stack.

Run: `node ./.evo-lite/cli/test.js governance 2>&1 | tail -3`
Expected: the mirrored runtime suite passes the same `T-ce-*` blocks (proves the mirror is coherent).

- [ ] **Step 5: Commit**

```bash
git add templates/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/code-perception.js .evo-lite/cli/code-perception/cli.js .evo-lite/cli/code-perception/wiki.js .evo-lite/cli/runtime-mirror.lock
git commit -m "$(cat <<'EOF'
feat(manifest): register unified code-explore files + converge runtime mirror (task:ce-manifest-sync)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

*(If the sync writes a lock at a different path, `git add` whatever the second entry run reports as written; the byte-identical mirrors + lock are the artifacts to commit.)*

---

## Self-Review

### Spec coverage per Acceptance Criterion

| AC | Description (abbrev) | Satisfied by |
|----|----------------------|--------------|
| `ac-unified-explore` | one shared service returns freshness/providers/normalized refs/relationships/optional impact+source/governance/diagnostics/explained recommended reading; native-lite degradation success-shaped | **T2** (service) + **T1** (M1/M2 seam) + **T3** (`mem code explore --json` verifier). Verifier cmd `memory.js code explore "…" --json` is wired in T3. |
| `ac-mcp-code-explore` | MCP `evo_code_explore` on the same service; missing/unindexed/stale/ambiguous/unsupported return successful guidance not isError | **T4** (tool + handler) + T4 adds it to `mcp-validate.js` (the AC's verifier `node ./.evo-lite/cli/mcp-validate.js`). |
| `ac-minimal-code-wiki` | `wiki build` produces provider/overview/current-focus/module/task pages with freshness+dependencies; pure-derived read-only; delete-dir + rebuild reproduces | **T5** (`buildCodeWiki`/`getWikiStatus` + determinism test) + T3 (`mem code wiki build|status`). |
| `ac-inspector-code-surface` | Inspector Code page + `/api/code/status|focus|task?id=` read-only, never auto-install, diagnostics on failure | **T6** (routes + page + test). Verifier `node ./.evo-lite/cli/test.js governance` covers `T-ce-inspector`. |
| `ac-mirror-parity` | new files + mirrors byte-identical; second `sync-runtime-entry` zero changes; uses standalone entry not `memory.js sync-runtime` | **T7** (manifest + convergence + Buffer.equals test). |

### Spec section coverage

- §2 UnifiedExploreResult shape → T2 result assembly. §2.1 ExploreQuery → T2 `ExploreOpts`. §2.2 processing steps 1–10 → T2 orchestration (commented per step). §2.3 recommended-reading order → T2 `rankRecommendedReading` (8 tiers, each with `reason`). §2.4 M1/M2 → T1 + wired in T2. §3 CLI contract → T3. §3.1 exit model → T3 `exitFor` + commander (exit 2). §4 MCP → T4. §5 Code Wiki → T5. §6 Inspector → T6. §7 directory layout + mirror parity → T5/T6 files + T7. §8 phases → T1–T4 (4a) / T5–T7 (4b). §9 ACs → table above.

### Placeholder scan

No `TODO` / "add error handling" / "similar to Task N" / bare prose-for-code. Every code step carries complete, runnable code. The only intentionally light spot is T6 Step 3b's Inspector HTML tab wiring, which is presentation-only; its behavioral contract (`/api/code/*` responses) is fully specified and pinned by `T-ce-inspector`, and the exact inline-script object shape is instructed to match the file's existing `timeline`/`planning` idiom (which the implementer reads in-place). This is a deliberate "follow the established pattern" instruction, not a missing-code placeholder.

### Type / signature consistency

- `toSymbolReferences(matches, opts?)` — defined T1, consumed T2 (`{focusId}`). ✔
- `normalizeDerivedLinkConfidence(links)` / `DERIVED_LINK_CONFIDENCE_FLOOR` — defined T1, consumed T1 test + T2. ✔
- `exploreCode(query, opts) -> UnifiedExploreResult{query,ok,freshness,providers,matches,relationships,impact?,source,governance,recommendedReading,diagnostics}` — defined T2, consumed identically in T3 (CLI), T4 (MCP), T5 (Wiki), T6 (Inspector). ✔
- `buildGovernanceLinks` input keys used (`planIR.tasks`, `fileReferences`, `symbolReferences`, `focusReferences`, `evidence`) all match the API map. `selectProvider` request `{capability, preferredProvider?}` + `selection.candidate.registration.provider` match the router. `buildCodePerceptionStatus(context,{candidates,links})` matches status.js. `readActiveContext()` matches memory.service.js. ✔
- `buildCodeWiki(opts) -> {dir,pages,manifest}` / `getWikiStatus(opts) -> {exists,pageCount,...}` — defined T5, consumed T3 + T6. ✔
- `registerCodeCommands(program)` — defined T3, thunked in memory.js T3. ✔

---

## Execution Handoff

**Plan complete and saved to `docs/plans/unified-code-explore-wiki-projection-mvp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (T1→T7), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

**Which approach?**
