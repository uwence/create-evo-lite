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
- **`readActiveContext`** is exported by `memory.service.js` (canonical, full parse). `sections.focus` is FREE TEXT — no structured spec/task field. Its `tasks[]` come from `parseBacklogTasks`, whose row shape is **`{checked, hash, line, text}`** — the canonical id is `hash`; there is **NO `id` field**. Any code reading `task.id` on an active-context task is dead against a real `active_context.md`.
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
| `templates/cli/code-perception/status.js` (modify) | provider rows carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit` (consumed by T5 provenance + T6 page) | T2 |
| `templates/cli/code-perception/cli.js` (create) | `mem code` command group `registerCodeCommands` + unified exit model | T3 |
| `templates/cli/memory.js` (modify) | `safeRegister('code', …)` thunk | T3 |
| `templates/cli/mcp-server.js` (modify) | `evo_code_explore` TOOLS entry + dispatch case + handler | T4 |
| `templates/cli/mcp-validate.js` (modify) | add `evo_code_explore` to validator TOOLS + `summarise` | T4 |
| `templates/cli/code-perception/wiki.js` (create) | `buildCodeWiki`, `getWikiStatus` — pure-derived overview/current-focus/providers/modules/tasks pages + manifest | T5 |
| `templates/cli/inspector.js` (modify) | exported `code*Response` mappers + `/api/code/status|focus|task` routes + Code page tab | T6 |
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
- Modify: `templates/cli/code-perception/status.js` (provider rows carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit`)
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
  - `async exploreCode(query: string, opts?: ExploreOpts) -> UnifiedExploreResult`. `ExploreOpts = {focusId?, preferredProvider?, includeSource?, includeImpact?, includeGovernance?, maxResults?, maxSourceChars?, projectRoot?, config?, registry?, activeContext?, commits?, acceptanceDependencies?}`. `projectRoot`/`config`/`registry`/`activeContext`/`commits`/`acceptanceDependencies` are DI seams for tests and callers — `activeContext` overrides the host-bound `memory.service.readActiveContext()` (which is pinned to a module-load `ACTIVE_CONTEXT_PATH`, so a foreign `projectRoot` with no injected `activeContext` gets an EMPTY context + diagnostic, never the host's focus). `commits`/`acceptanceDependencies` feed the ② linker's Layer-1/Layer-2 inputs; when omitted, `commits` is read from the persisted post-commit run (explore never shells `git log`). Never throws; internal exceptions become diagnostics + `result.ok=false` only for true invariant breaks.
  - Reads (best-effort, may be absent): `<root>/.evo-lite/generated/code-perception/governance-links.json` (persisted graph — merged, deduped by link id, so `changed_by_commit` links survive into explore) and `.../post-commit-last-run.json`, whose REAL shape is `{ commit: '<headSha>', changedFiles: [...] }` (verified in `post-commit-code-perception.js` — it writes `commit`, there is NO `commits` or `headSha` key; reading those would silently yield zero commits).
  - `rankRecommendedReading(inputs) -> ReadingItem[]` where `ReadingItem = {path, kind, reason, priority, confidence}` sorted by §2.3 order.
  - `UnifiedExploreResult = {query, ok, freshness, providers, matches, relationships, impact?, source, files, modules, focus, governance, recommendedReading, diagnostics}` (spec §2). `focus = {entityId, taskId, resolved}` — the CANONICAL resolved focus; the Wiki/Inspector must render this rather than re-deriving focus (e.g. "all unfinished tasks" is not the focus). `ok:false` is returned for the §3.1 FATAL set only (`adapter-exception`, `security-violation`, `unparseable-response`, `internal-error`) — capability gaps stay `ok:true`. `freshness = {stale, dirty, indexedCommit?, currentCommit?}`. `governance = {specs, plans, tasks, commits, evidence, links, linkSummary}`. `files = string[]` (sorted repo-relative paths from native-lite file facts). `modules = [{id, files:string[], taskIds:string[], changed}]` (declared moduleId, else top-level path segment). Both feed the Code Wiki's module pages + unresolved-link detection (T5).

- [ ] **Step 1: Write the failing test** — append inside `runGovernanceTests()` after the T-ce-seam block. THREE scenarios (a single test cannot exercise all provider realities). **Scenario A** = the native-lite degradation dogfood (the common host state — no structural provider; also pins the real post-commit blob shape + the real backlog `hash` shape); **Scenario B** = an injected structural fixture provider (proves the full symbol/relationship/impact/source path + the M1/M2 seams end-to-end); **Scenario C** = a ready provider that throws, proving the SERVICE itself produces the `ok:false` fatal that T4/T6's surface mappings depend on. All `git init` the temp workspace because native-lite `getFiles` runs `git ls-files --cached --others --exclude-standard` and returns `files:[]` + a `git-enumeration-failed` diagnostic when the root is not a repo — so without a real repo the file facts (and every `declares_file` link) would be empty and the asserts could never pass.

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
            // Inject activeContext in its REAL parseBacklogTasks shape ({checked, hash, line, text})
            // so the host repo's focus never leaks in AND the unique-active-task path is exercised.
            const result = await svc.exploreCode('engine selection', {
                projectRoot: runtime.workspaceRoot, config: {}, includeSource: false, includeImpact: true,
                activeContext: { sections: { focus: 'Focus: task:x' }, summary: { focus: 'Focus: task:x' },
                    tasks: [{ hash: 'task:x', checked: false, line: '- [ ] [task:x] Engine', text: 'Engine' }], trajectory: [] },
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
            assert.strictEqual(result.focus.entityId, 'task:x', 'A: focus resolves to the canonical task via the real backlog hash shape');
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
            // evidence.symbols names the symbol -> implements_task derived fires (linker rule);
            // M2 then floors its confidence > 0.
            seedPlanIR(runtime.runtimeRoot,
                [{ id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: ['src/engine.js'],
                   evidence: [{ kind: 'test', symbols: ['selectEngine'] }] }],
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
                activeContext: { sections: { focus: 'Focus: task:x' }, summary: { focus: 'Focus: task:x' },
                    tasks: [{ hash: 'task:x', checked: false, line: '- [ ] [task:x] Engine', text: 'Engine' }], trajectory: [] },
            });

            assert.strictEqual(result.ok, true, 'B: ok:true');
            assert.ok(result.matches.length >= 1, 'B: structural provider yields symbol matches');
            assert.ok(result.matches.every(m => /^code-ref:/.test(m.id)), 'B: matches are normalized CodeReferences');
            assert.ok(result.relationships.length >= 1, 'B: callers relationships present');
            assert.ok(result.relationships.every(r => r.source && r.target && typeof r.kind === 'string'), 'B: relationships normalized');
            assert.ok(result.impact && Array.isArray(result.impact.downstream) && result.impact.downstream.length >= 1, 'B: impact shape with downstream');
            assert.ok(['low', 'medium', 'high', 'unknown'].includes(result.impact.risk), 'B: impact carries a risk level');
            assert.ok(result.source.length >= 1 && typeof result.source[0].excerpt === 'string', 'B: source excerpt present');
            // implements_task derived (via evidence.symbols) MUST exist and carry confidence > 0 (M1 produced the symbolRef; M2 floored it).
            const derived = result.governance.links.filter(l => l.kind === 'implements_task' && l.status === 'derived');
            assert.ok(derived.length >= 1, 'B: implements_task derived link exists (M1 bridge fed the linker)');
            assert.ok(derived.every(l => l.confidence > 0), 'B: derived link confidence floored > 0 (M2)');
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
        }
        console.log('✅ T-ce-explore-B injected structural provider passed');

        console.log('T-ce-explore-C. Unified explore — adapter exception is FATAL (ok:false) ...');
        {
            // The service itself must generate ok:false for an adapter/invariant break.
            // T4/T6 only prove the SURFACE mapping given an ok:false; without this the
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

> **Cross-surface reuse (spec Global Constraint "NO duplicate logic"):** Scenario B proves the service produces the full structural shape. The "MCP/CLI/Wiki consume the SAME service" half of ac-unified-explore is asserted in T-ce-cli (T3), T-ce-mcp (T4), and T-ce-wiki (T5), each of which `require`s `code-perception.js#exploreCode` and asserts against its result — none re-implements provider orchestration.

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
//      the focus text — multiple candidates => `focus-ambiguous`, never a silent
//      "pick the first";
//   3. else, iff the active context lists EXACTLY ONE open task whose canonical
//      id matches a Planning-IR task, that unique task;
//   4. else NO focus — push a `focus-unresolved` diagnostic and return [].
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
    // 3. UNIQUE open active-context task that maps to a Planning-IR task.
    //    memory.service#parseBacklogTasks yields `{checked, hash, line, text}` —
    //    the canonical id lives in `hash`, NOT `id`. Reading `t.id` would make
    //    this branch permanently unreachable against a real active_context.md.
    if (!focusEntityId && activeContext && Array.isArray(activeContext.tasks)) {
        const activeOpen = activeContext.tasks.filter(t => t && !t.checked && (t.id || t.hash));
        if (activeOpen.length === 1) {
            const activeId = activeOpen[0].id || activeOpen[0].hash;
            const match = tasks.find(t => t && t.id === activeId);
            if (match) { focusTask = match; focusEntityId = match.id; }
        }
    }
    // 4. nothing resolved → diagnostic, no fabricated focus.
    if (!focusEntityId) {
        if (diagnostics) diagnostics.push(diag('focus-unresolved',
            'no explicit focusId, no unique exact task/title in focus text, and no unique open active task; emitting no focus links'));
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
        const evidence = [];
        for (const t of (planIR.tasks || [])) {
            for (const e of (Array.isArray(t.evidence) ? t.evidence : [])) {
                if (e && typeof e === 'object') evidence.push(Object.assign({ taskId: t.id }, e));
            }
        }
        let links = [];
        if (includeGovernance) {
            // Build the full input set (spec §2.2 Layers 1-3): file/symbol/focus/
            // commit/acceptance/evidence — NOT just files+symbols.
            const built = linker.buildGovernanceLinks({
                planIR: { tasks: planIR.tasks },
                fileReferences, symbolReferences, focusReferences,
                commits, acceptanceDependencies, evidence,
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
            commits, evidence, links, linkSummary,
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

- [ ] **Step 3b: Enrich the status rows** in `templates/cli/code-perception/status.js#buildProviderRow`. `result.providers` comes straight from `buildCodePerceptionStatus`, and it is the SINGLE provider table all four surfaces render. Today the row drops `capabilities`/versions/commits even though `candidate.status` (a `ProviderStatus`) carries them — so the Wiki provenance (T5) and the spec §6 Inspector page (T6) could not render them honestly. Enrich it HERE (in the service task) so both downstream consumers are correct by construction. Find:

```javascript
    const row = { id, role, available, ready, indexState, compatibility, degraded };
    const reason = availability && availability.reason;
    if (reason) {
        row.reason = reason;
    }
```

Replace with (purely additive — the existing status tests assert individual fields, not whole-row shape, so they keep passing):

```javascript
    const row = { id, role, available, ready, indexState, compatibility, degraded };
    // Spec §6: the Code page + Wiki provenance render capabilities, versions and
    // indexed/current commit. Carry them from the ProviderStatus (best-effort, never throw).
    if (status && typeof status.capabilities === 'object' && status.capabilities !== null) row.capabilities = status.capabilities;
    row.providerVersion = (status && status.providerVersion) ?? null;
    row.adapterVersion = (status && status.adapterVersion)
        ?? (registration && registration.provider && registration.provider.adapterVersion) ?? null;
    row.indexedCommit = (status && status.indexedCommit) ?? null;
    row.currentCommit = (status && status.currentCommit) ?? null;
    const reason = availability && availability.reason;
    if (reason) {
        row.reason = reason;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-explore"`
Expected: PASS — all three: `✅ T-ce-explore-A native-lite degradation passed`, `✅ T-ce-explore-B injected structural provider passed`, `✅ T-ce-explore-C adapter-exception fatal passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception.js templates/cli/code-perception/status.js templates/cli/test/governance.js
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
- Produces: `registerCodeCommands(program)` registering `mem code <providers|status|search|explore|callers|callees|impact|context|wiki>`. Exit codes: success/degraded → 0; internal invariant/security → 1 (`result.ok===false`); invalid args → 2 via a SCOPED `exitOverride` on the `code` group + every subcommand (commander's default is 1, so the override is required — it must NOT be placed on the root program or it would change every other `mem` command's exit codes). `wiki` subcommands delegate to T5's module.

- [ ] **Step 1: Write the failing test** — append after the T-ce-explore-B block. Run the **template** `memory.js` directly (NOT the mirror): `code-perception/cli.js` is not manifest-managed until Task 7, so a `sync-runtime-entry` mirror would omit it and `mem code` would be unknown. Running the template source exercises the real production registrar in place; mirror parity is proven separately in T7. `git init` so native-lite `getFiles` enumerates (degradation stays success-shaped either way, but this keeps the run realistic).

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
            const childEnv = { ...process.env, EVO_LITE_ROOT: runtime.runtimeRoot };
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

    // Scope the exit-2 override to this group + its subcommands (incl. the nested
    // `wiki` group) — never the root program. Applied AFTER all subcommands exist.
    const scoped = [code, ...code.commands];
    for (const c of code.commands) scoped.push(...(Array.isArray(c.commands) ? c.commands : []));
    for (const c of scoped) c.exitOverride(invalidArgsExit);
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

### Task 5: Minimal Code Wiki (pure-derived projection)

**Files:**
- Create: `templates/cli/code-perception/wiki.js`
- Test: `templates/cli/test/governance.js` (append block `T-ce-wiki`)

**Interfaces:**
- Consumes: `../code-perception.js#exploreCode` (the ONE service); `../runtime.js#getWorkspaceRoot`.
- Produces:
  - `async buildCodeWiki(opts) -> {dir, pages: string[], manifest}`. `opts = {projectRoot, now?}` (`now` is an injectable clock for the determinism test). Writes `.evo-lite/generated/code-wiki/{manifest.json, overview.md, current-focus.md, providers.md, modules/<id>.md (one per derived module), tasks/<id>.md}`. Module pages (spec §5): description / files / representative symbols / callers-callees summary / related tasks+commits / freshness. Task pages (spec §5): linkedFiles / resolved provider files / confirmed-derived-proposed links / related commits+tests / evidence / unresolved links. Pure-derived: reads only the service output (incl. `result.modules`/`result.files`) + Planning IR; writes ONLY under the generated dir; a fresh `rmSync(wikiDir)` precedes every build so a removed task/module never lingers; deleting the whole dir and rebuilding reproduces EVERY page byte-for-byte (deterministic ordering; the only clock value is the provenance `generatedAt`).
  - `getWikiStatus(opts) -> {exists, pageCount, generatedAt, provider, dependencies}`.
  - Every page starts with provenance frontmatter: `generatedBy / generatedAt / provider / providerVersion / indexedCommit / currentCommit / freshness / dependencies[]`.

- [ ] **Step 1: Write the failing test** — append after the T-ce-mcp block:

```javascript
        console.log('T-ce-wiki. Testing code wiki determinism (delete WHOLE dir + rebuild reproduces EVERY page) ...');
        {
            const { execFileSync } = require('node:child_process');
            const wiki = require(path.join(TEMPLATE_CLI_DIR, 'code-perception', 'wiki.js'));
            const runtime = createTempRuntimeRoot('ce-wiki');
            const planDir = path.join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = 1;\n');
            const FIXTURE_SHA = 'b'.repeat(40);
            fs.writeFileSync(path.join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [{ id: 'plan:x', status: 'active', sourcePath: 'docs/plans/x.md' }],
                tasks: [
                    // evidence ties task:x to the fixture commit -> Related commits must render the SHA.
                    { id: 'task:x', title: 'Engine', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md',
                      linkedFiles: ['src/engine.js', 'src/missing.js'],
                      evidence: [{ kind: 'test', symbols: ['selectEngine'], commitSha: FIXTURE_SHA }] },
                    // An UNRELATED unfinished task: it must NOT be presented as the focus.
                    { id: 'task:unrelated', title: 'Unrelated', status: 'todo', linkedPlan: 'plan:x', sourcePath: 'docs/plans/x.md', linkedFiles: [], evidence: [] },
                ],
                warnings: [],
            }, null, 2), 'utf8');
            // Persisted post-commit blob in its REAL shape ({commit, changedFiles}).
            const cpDir = path.join(runtime.runtimeRoot, 'generated', 'code-perception');
            fs.mkdirSync(cpDir, { recursive: true });
            fs.writeFileSync(path.join(cpDir, 'post-commit-last-run.json'), JSON.stringify({
                commit: FIXTURE_SHA, changedFiles: ['src/engine.js'],
            }, null, 2), 'utf8');
            // git init so native-lite enumerates src/engine.js -> a module page exists.
            execFileSync('git', ['init', '-q'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.email', 'test@evo.local'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.name', 'evo-test'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['add', '-A'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: runtime.workspaceRoot });

            const fixedClock = () => '2026-07-16T00:00:00.000Z';
            // Real backlog row shape ({checked, hash, ...}) -> focus resolves to task:x only.
            const wikiActiveContext = { sections: { focus: 'Focus: task:x' }, summary: { focus: 'Focus: task:x' },
                tasks: [{ hash: 'task:x', checked: false, line: '- [ ] [task:x] Engine', text: 'Engine' }], trajectory: [] };
            const wikiDir = path.join(runtime.runtimeRoot, 'generated', 'code-wiki');
            // Recursively snapshot EVERY page (path -> bytes), deterministically ordered.
            function snapshot(dir) {
                const out = {};
                const walk = (d, rel) => {
                    for (const name of fs.readdirSync(d).sort()) {
                        const abs = path.join(d, name); const r = rel ? rel + '/' + name : name;
                        if (fs.statSync(abs).isDirectory()) walk(abs, r);
                        else out[r] = fs.readFileSync(abs);
                    }
                };
                walk(dir, '');
                return out;
            }

            await wiki.buildCodeWiki({ projectRoot: runtime.workspaceRoot, now: fixedClock, activeContext: wikiActiveContext });
            const snap1 = snapshot(wikiDir);
            // Required page set (spec §5): manifest + overview + current-focus + providers + a module + the task page.
            assert.ok(snap1['manifest.json'] && snap1['overview.md'] && snap1['current-focus.md'] && snap1['providers.md'], 'core pages written');
            assert.ok(Object.keys(snap1).some(p => /^modules\/.+\.md$/.test(p)), 'at least one modules/<id>.md page written');
            assert.ok(snap1['tasks/task-x.md'], 'per-task page written');
            const overview1 = snap1['overview.md'].toString('utf8');
            assert.ok(/generatedBy:/.test(overview1) && /provider:/.test(overview1), 'pages carry provenance frontmatter');
            assert.ok(/## Modules/.test(overview1), 'overview lists modules');
            const taskPage = snap1['tasks/task-x.md'].toString('utf8');
            for (const section of ['## Resolved provider files', '## Related commits', '## Related tests', '## Evidence', '## Unresolved links']) {
                assert.ok(taskPage.includes(section), `task page has ${section}`);
            }
            assert.ok(/src\/missing\.js/.test(taskPage), 'unresolved (declared-but-absent) linked file is surfaced');
            // The real commit graph must actually reach the pages (task via
            // evidence.commitSha; module via commit.changedFiles ∩ module.files).
            assert.ok(taskPage.includes(FIXTURE_SHA), 'task page Related commits carries the fixture SHA');
            const modulePath = Object.keys(snap1).find(p => /^modules\/.+\.md$/.test(p));
            assert.ok(snap1[modulePath].toString('utf8').includes(FIXTURE_SHA), 'module page Related commits carries the fixture SHA');
            // current-focus.md shows ONLY the resolved focus — not every unfinished task.
            const focusPage = snap1['current-focus.md'].toString('utf8');
            assert.ok(focusPage.includes('task:x'), 'current-focus names the resolved focus task');
            assert.ok(!focusPage.includes('task:unrelated'), 'current-focus must NOT list an unrelated unfinished task');
            // Provenance reports the PROVIDER version, not the adapter version.
            assert.ok(/providerVersion:/.test(overview1) && /adapterVersion:/.test(overview1),
                'provenance carries providerVersion AND adapterVersion as distinct fields');

            // Delete the WHOLE generated dir and rebuild — EVERY page must reproduce byte-identically.
            fs.rmSync(wikiDir, { recursive: true, force: true });
            assert.ok(!fs.existsSync(wikiDir), 'wiki dir deleted');
            await wiki.buildCodeWiki({ projectRoot: runtime.workspaceRoot, now: fixedClock, activeContext: wikiActiveContext });
            const snap2 = snapshot(wikiDir);
            assert.deepStrictEqual(Object.keys(snap2).sort(), Object.keys(snap1).sort(), 'same page set after rebuild');
            for (const p of Object.keys(snap1)) {
                assert.ok(snap1[p].equals(snap2[p]), `delete-dir + rebuild reproduces ${p} byte-identically`);
            }

            const status = wiki.getWikiStatus({ projectRoot: runtime.workspaceRoot });
            assert.strictEqual(status.exists, true, 'status reports built');
            assert.ok(status.pageCount >= 5, 'status counts pages (overview/current-focus/providers/module/task)');
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
        // providerVersion is the PROVIDER's version (T2 Step 3b puts it on the row);
        // adapterVersion is Evo-Lite's adapter and is a distinct field — reporting
        // the adapter's version as the provider's would be a provenance lie.
        providerVersion: p.providerVersion || 'unknown',
        adapterVersion: p.adapterVersion || 'unknown',
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
    // activeContext is forwarded so a caller/test can bind a real focus; without it
    // a non-host projectRoot resolves to no focus (never the host's — see the service).
    const result = await service.exploreCode('', {
        includeSource: false, includeImpact: false, projectRoot,
        activeContext: options.activeContext, config: options.config, registry: options.registry,
    });

    const wikiDir = path.join(projectRoot, '.evo-lite', 'generated', 'code-wiki');
    // Fresh rebuild: clear any prior pages so a removed task/module never lingers.
    fs.rmSync(wikiDir, { recursive: true, force: true });

    const fm = provenanceFor(result, generatedAt);
    const pages = [];
    // Normalize the manifest's page paths to forward slashes so the bytes are
    // identical regardless of host separator (Windows-first, but deterministic anywhere).
    const write = (rel, body) => { const r = rel.split(path.sep).join('/'); writeFileAtomic(path.join(wikiDir, r), frontmatter(fm) + body); pages.push(r); };

    const links = Array.isArray(result.governance.links) ? result.governance.links : [];
    const modules = Array.isArray(result.modules) ? result.modules : [];
    const knownFiles = new Set(Array.isArray(result.files) ? result.files : []);
    const linksByKindFor = (entityId, kind) => links.filter(l => l.governanceEntityId === entityId && l.kind === kind);
    const degradedCaps = result.providers.filter(p => p.degraded).map(p => `- ${p.id}${p.reason ? ` — ${p.reason}` : ''}`).join('\n') || '- (none degraded)';

    // overview.md
    const providersList = result.providers.map(p => `- ${p.id} (role ${p.role}, ready ${p.ready}${p.degraded ? ', degraded' : ''})`).join('\n') || '- none';
    const modulesList = modules.map(m => `- \`${m.id}\` — ${m.files.length} file(s)${m.changed ? ' (changed)' : ''}`).join('\n') || '- (none)';
    const changedModules = modules.filter(m => m.changed).map(m => `- \`${m.id}\``);
    const readingList = result.recommendedReading.slice(0, 10).map(r => `- [${r.priority}] \`${r.path}\` — ${r.reason}`).join('\n') || '- (none)';
    write('overview.md', [
        '# Code Overview', '',
        `Focus / provider status / freshness / modules for **${path.basename(projectRoot)}**.`, '',
        '## Providers', providersList, '',
        '## Freshness', `- stale: ${result.freshness.stale}`, `- dirty: ${result.freshness.dirty}`, '',
        '## Modules', modulesList, '',
        '## Recently changed', (changedModules.length ? changedModules.join('\n') : '- (none)'), '',
        '## Degraded capabilities', degradedCaps, '',
        '## Governance links', `- ${JSON.stringify(result.governance.linkSummary)}`, '',
        '## Recommended reading', readingList, '',
    ].join('\n'));

    // current-focus.md — ONLY the canonical resolved focus (result.focus), never
    // "every unfinished task": that would present unrelated backlog as the focus.
    // When the service could not resolve a focus, say so and show its diagnostic.
    const focus = result.focus || { entityId: null, resolved: false };
    const focusEntity = focus.entityId
        ? (result.governance.tasks || []).find(t => t.id === focus.entityId) || null
        : null;
    const focusDiag = result.diagnostics.find(d => ['focus-unresolved', 'focus-ambiguous', 'focus-id-unknown'].includes(d.code || ''));
    write('current-focus.md', [
        '# Current Focus', '',
        focus.resolved
            ? `- ${focus.entityId}${focusEntity ? ` — ${focusEntity.title || ''} (${focusEntity.status})` : ''}`
            : `- (no resolved focus)${focusDiag ? ` — ${focusDiag.message || focusDiag.code}` : ''}`, '',
        '## Focus-linked files',
        (links.filter(l => l.kind === 'related_to_focus').map(l => `- ${l.codeReferenceId}`).join('\n')) || '- (none)', '',
    ].join('\n'));

    // providers.md
    write('providers.md', [
        '# Providers', '',
        result.providers.map(p => `## ${p.id}\n- role: ${p.role}\n- ready: ${p.ready}\n- indexState: ${p.indexState}\n- compatibility: ${p.compatibility}\n- degraded: ${p.degraded}${p.reason ? `\n- reason: ${p.reason}` : ''}`).join('\n\n') || '(none)', '',
    ].join('\n'));

    // modules/<module-id>.md — spec §5: description / files / representative symbols /
    // callers-callees summary / related tasks+commits / freshness. Deterministic by id.
    const tasksByFile = new Map();
    for (const t of (result.governance.tasks || [])) {
        for (const f of (Array.isArray(t.linkedFiles) ? t.linkedFiles : [])) {
            if (!tasksByFile.has(f)) tasksByFile.set(f, []);
            tasksByFile.get(f).push(t.id);
        }
    }
    for (const m of modules) {
        const moduleFiles = new Set(m.files);
        const repSymbols = result.matches.filter(s => s.filePath && moduleFiles.has(s.filePath)).slice(0, 10);
        const rels = result.relationships.filter(r => (r.source && moduleFiles.has(r.source.filePath)) || (r.target && moduleFiles.has(r.target.filePath)));
        const relatedTasks = [...new Set([...m.taskIds, ...m.files.flatMap(f => tasksByFile.get(f) || [])])].sort();
        // Module -> commits via commit.changedFiles ∩ module.files. (NOT via
        // linksByKindFor(taskId,'changed_by_commit'): those links are keyed by
        // governanceEntityId 'commit:<sha>', so a task-id lookup is always empty.)
        const relatedCommits = (result.governance.commits || [])
            .filter(c => (Array.isArray(c.changedFiles) ? c.changedFiles : []).some(f => moduleFiles.has(f)))
            .map(c => c.sha).sort();
        write(path.join('modules', `${slug(m.id)}.md`), [
            `# Module: ${m.id}`, '',
            `Derived module grouping ${m.files.length} file(s)${m.changed ? ' (has working-tree changes)' : ''}.`, '',
            '## Files', (m.files.length ? m.files.map(f => `- \`${f}\``).join('\n') : '- (none)'), '',
            '## Representative symbols', (repSymbols.length ? repSymbols.map(s => `- ${s.name} \`${s.filePath || ''}\``).join('\n') : '- (none — no structural provider)'), '',
            '## Callers / callees summary', `- ${rels.length} relationship edge(s) touch this module`, '',
            '## Related tasks', (relatedTasks.length ? relatedTasks.map(id => `- ${id}`).join('\n') : '- (none)'), '',
            '## Related commits', (relatedCommits.length ? relatedCommits.map(c => `- ${c}`).join('\n') : '- (none)'), '',
            '## Freshness', `- stale: ${result.freshness.stale}`, `- dirty: ${result.freshness.dirty}`, '',
        ].join('\n'));
    }

    // tasks/<id>.md — spec §5: linkedFiles / resolved provider files / confirmed-
    // derived-proposed links / related commits+tests / evidence / unresolved links.
    const sortedTasks = [...(result.governance.tasks || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const t of sortedTasks) {
        const taskLinks = links.filter(l => l.governanceEntityId === t.id);
        const byStatus = s => taskLinks.filter(l => l.status === s).map(l => `  - ${l.kind} → ${l.codeReferenceId} (conf ${l.confidence})`).join('\n') || '  - (none)';
        const linkedFiles = Array.isArray(t.linkedFiles) ? t.linkedFiles : [];
        const resolvedFiles = linkedFiles.filter(f => knownFiles.has(f));
        const unresolvedFiles = linkedFiles.filter(f => !knownFiles.has(f)); // declared but no provider file fact
        // Task -> commits via evidence.taskId + evidence.commitSha, resolved against
        // governance.commits. (NOT via linksByKindFor(t.id,'changed_by_commit'):
        // changed_by_commit is keyed by 'commit:<sha>', never a task id.)
        const taskCommitShas = new Set((result.governance.evidence || [])
            .filter(e => e.taskId === t.id && e.commitSha).map(e => e.commitSha));
        const commits = (result.governance.commits || [])
            .filter(c => taskCommitShas.has(c.sha))
            .map(c => `- ${c.sha}`);
        const tests = linksByKindFor(t.id, 'verified_by_test').map(l => `- ${l.codeReferenceId}`);
        const archives = linksByKindFor(t.id, 'evidenced_by_archive').map(l => `- ${l.codeReferenceId}`);
        const evidenceEntries = (result.governance.evidence || []).filter(e => e.taskId === t.id)
            .map(e => `- ${e.kind || 'evidence'}${Array.isArray(e.symbols) ? ` symbols=[${e.symbols.join(', ')}]` : ''}${e.commitSha ? ` commit=${e.commitSha}` : ''}`);
        write(path.join('tasks', `${slug(t.id)}.md`), [
            `# ${t.id}`, '', `**Title:** ${t.title || ''}`, `**Status:** ${t.status}`, '',
            '## Linked files', (linkedFiles.length ? linkedFiles.map(f => `- \`${f}\``).join('\n') : '- (none)'), '',
            '## Resolved provider files', (resolvedFiles.length ? resolvedFiles.map(f => `- \`${f}\``).join('\n') : '- (none)'), '',
            '## Confirmed links', byStatus('confirmed'), '',
            '## Derived links', byStatus('derived'), '',
            '## Proposed links', byStatus('proposed'), '',
            '## Related commits', (commits.length ? commits.join('\n') : '- (none)'), '',
            '## Related tests', (tests.length ? tests.join('\n') : '- (none)'), '',
            '## Evidence', (evidenceEntries.length || archives.length ? [...evidenceEntries, ...archives].join('\n') : '- (none)'), '',
            '## Unresolved links', (unresolvedFiles.length ? unresolvedFiles.map(f => `- \`${f}\` (declared, no provider file fact)`).join('\n') : '- (none)'), '',
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
- Modify: `templates/cli/inspector.js` (export pure response mappers + add API branches in `handleApi` + a Code tab in `renderHtml`)
- Test: `templates/cli/test/governance.js` (append block `T-ce-inspector`)

**Interfaces:**
- Consumes: `code-perception.js#exploreCode` (its `providers` rows already carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit` — enriched in T2 Step 3b); `code-perception/wiki.js#getWikiStatus`; existing `getWorkspaceRoot`.
- Produces:
  - Pure, exported response mappers (so the ok/`ok:false` mapping is unit-testable without HTTP): `codeStatusResponse(result, wikiStatus) -> {status, body}`, `codeFocusResponse(result) -> {status, body}`, `codeTaskResponse(result, id) -> {status, body}`. A `result.ok === false` (true fatal) maps to HTTP **503** (never 200 — same unified error model as the CLI/MCP paths); a missing `?id=` maps to **400**.
  - Read-only endpoints on the existing zero-dep server, dispatched by prefix on the full `req.url` (query string included):
    - `GET /api/code/status` → `{providers (with capabilities/versions/commits), freshness, links, wiki, diagnostics}`.
    - `GET /api/code/focus` → `{focusLinks, focusFiles, resolvedSymbols, tasks, diagnostics}`.
    - `GET /api/code/task?id=<task-id>` → `{taskId, links, task, diagnostics}`.
  - All never auto-install/index a provider (read-only service only), and surface diagnostics on provider failure. Missing `?id=` on `/task` → `400`; `result.ok===false` → `503`; NOT a 500 for either (500 remains only for a thrown/unexpected error).
  - Inspector HTML gains a **Code** tab rendering: selected provider + version, indexed/current commit, stale/dirty, capabilities, current-focus files + resolved symbols, Task-to-Code links, Code Wiki entry, degraded guidance.

- [ ] **Step 1: Write the failing test** — append after the T-ce-wiki block:

```javascript
        console.log('T-ce-inspector. Testing Inspector Code page + /api/code/* read-only endpoints + fatal mapping ...');
        {
            const inspector = require(path.join(TEMPLATE_CLI_DIR, 'inspector.js'));
            const http = require('http');
            const { execFileSync } = require('node:child_process');
            const runtime = createTempRuntimeRoot('ce-inspector');
            const planDir = path.join(runtime.runtimeRoot, 'generated', 'planning');
            fs.mkdirSync(planDir, { recursive: true });
            writeText(path.join(runtime.workspaceRoot, 'src', 'engine.js'), 'module.exports = 1;\n');
            fs.writeFileSync(path.join(planDir, 'plan-ir.json'), JSON.stringify({
                version: 'evo-plan-ir@1', specs: [], plans: [], tasks: [{ id: 'task:x', title: 'X', status: 'todo', linkedFiles: ['src/engine.js'], evidence: [] }], warnings: [],
            }, null, 2), 'utf8');
            execFileSync('git', ['init', '-q'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.email', 'test@evo.local'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['config', 'user.name', 'evo-test'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['add', '-A'], { cwd: runtime.workspaceRoot });
            execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: runtime.workspaceRoot });

            // Pure mapper: a true fatal (ok:false) MUST map to a non-200 (503), never 200.
            const fatal = inspector.codeStatusResponse({ ok: false, diagnostics: [{ code: 'internal-error', message: 'boom' }] }, { exists: false });
            assert.notStrictEqual(fatal.status, 200, 'ok:false maps to a non-200 status');
            assert.strictEqual(fatal.status, 503, 'ok:false maps specifically to 503');

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
                const nl = stj.providers.find(p => /native-lite/.test(p.id || ''));
                assert.ok(nl && typeof nl.capabilities === 'object', 'provider row carries capabilities (spec §6)');
                assert.ok(nl && 'providerVersion' in nl && 'adapterVersion' in nl, 'provider row carries providerVersion + adapterVersion');

                const focus = await get('/api/code/focus');
                assert.strictEqual(focus.status, 200, '/api/code/focus returns 200');
                const fj = JSON.parse(focus.body);
                assert.ok(Array.isArray(fj.focusFiles) && Array.isArray(fj.resolvedSymbols), 'focus carries focusFiles + resolvedSymbols (spec §6)');

                const task = await get('/api/code/task?id=task:x');
                assert.strictEqual(task.status, 200, '/api/code/task?id= returns 200');
                assert.strictEqual(JSON.parse(task.body).taskId, 'task:x', 'task endpoint echoes id');
                const bad = await get('/api/code/task');
                assert.strictEqual(bad.status, 400, 'missing ?id= is a 400 invalid-arg, not a 500');

                // The served HTML page must expose a Code tab wired to the code renderer.
                const page = await get('/');
                assert.strictEqual(page.status, 200, 'index page served');
                assert.ok(/showTab\('code'\)/.test(page.body), 'page has a Code tab button');
                assert.ok(/\/api\/code\/status/.test(page.body), 'page client fetches /api/code/status');
            } finally {
                server.close();
                if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT; else process.env.EVO_LITE_ROOT = prevRoot;
                fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
            }
        }
        console.log('✅ T-ce-inspector code endpoints passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-inspector|404|unknown api|codeStatusResponse" | head`
Expected: FAIL — `inspector.codeStatusResponse` is not yet exported (and `/api/code/status` hits the fallthrough 404).

- [ ] **Step 3a: Add exported response mappers + API branches** to `templates/cli/inspector.js`.

First, define pure mappers near the other helpers (module scope) and export them, so the unified error mapping (`ok:false` → 503, missing id → 400) is unit-testable without HTTP:

```javascript
// Read-only Code-perception response mappers. A result.ok === false is a true
// fatal (spec §3.1 unified error model) → 503, never a 200 success envelope.
function codeStatusResponse(result, wikiStatus) {
    if (result && result.ok === false) return { status: 503, body: { error: 'code perception failed', diagnostics: result.diagnostics || [] } };
    return { status: 200, body: {
        providers: result.providers, freshness: result.freshness,
        links: result.governance.linkSummary, wiki: wikiStatus || { exists: false }, diagnostics: result.diagnostics,
    } };
}
function codeFocusResponse(result) {
    if (result && result.ok === false) return { status: 503, body: { error: 'code perception failed', diagnostics: result.diagnostics || [] } };
    const focusLinks = result.governance.links.filter(l => l.kind === 'related_to_focus');
    return { status: 200, body: {
        focusLinks,
        focusFiles: result.recommendedReading.filter(r => r.kind === 'focus' || r.kind === 'linked-file').map(r => r.path),
        resolvedSymbols: result.matches.map(m => ({ name: m.name, filePath: m.filePath || null })),
        tasks: result.governance.tasks, diagnostics: result.diagnostics,
    } };
}
function codeTaskResponse(result, id) {
    if (!id) return { status: 400, body: { error: 'missing required query parameter: id' } };
    if (result && result.ok === false) return { status: 503, body: { error: 'code perception failed', diagnostics: result.diagnostics || [] } };
    return { status: 200, body: {
        taskId: id,
        links: result.governance.links.filter(l => l.governanceEntityId === id),
        task: (result.governance.tasks || []).find(t => t.id === id) || null,
        diagnostics: result.diagnostics,
    } };
}
```

Add `codeStatusResponse`, `codeFocusResponse`, `codeTaskResponse` to `module.exports`.

Then add the API branches in `handleApi`, inside the `try {` block, before the `} catch (error) {` line (after the existing `/api/drift` branch):

```javascript
        if (url.startsWith('/api/code/')) {
            const service = require('./code-perception');
            const { getWikiStatus } = require('./code-perception/wiki');
            const root = getWorkspaceRoot();
            const parsed = require('url').parse(url, true);
            const route = parsed.pathname;
            if (route === '/api/code/status') {
                return service.exploreCode('', { projectRoot: root, includeSource: false, includeImpact: false })
                    .then(r => { const m = codeStatusResponse(r, getWikiStatus({ projectRoot: root })); send(m.status, m.body); })
                    .catch(e => send(500, { error: e.message }));
            }
            if (route === '/api/code/focus') {
                return service.exploreCode('', { projectRoot: root, includeSource: false, includeImpact: false })
                    .then(r => { const m = codeFocusResponse(r); send(m.status, m.body); })
                    .catch(e => send(500, { error: e.message }));
            }
            if (route === '/api/code/task') {
                const id = parsed.query && parsed.query.id;
                if (!id) { const m = codeTaskResponse(null, null); return send(m.status, m.body); }
                return service.exploreCode(id, { projectRoot: root, focusId: id, includeSource: false, includeImpact: false })
                    .then(r => { const m = codeTaskResponse(r, id); send(m.status, m.body); })
                    .catch(e => send(500, { error: e.message }));
            }
            return send(404, { error: 'unknown code api', path: route });
        }
```

*(These branches `return` a Promise from `handleApi`; the existing synchronous branches ignore the return value, so mixing is safe — the response is sent inside `.then`. A THROWN/unexpected error still maps to 500; only the modeled fatal `ok:false` maps to 503.)*

- [ ] **Step 3b: Add a Code tab** to `renderHtml()`. Find the tab-button strip and the `load('timeline');` bootstrap (near line 305). Add a `code` tab button alongside the others (search the existing markup for the `<button` tab pattern used for `timeline`/`planning` and add one more that calls `showTab('code')`), and register a loader entry so `showTab('code')` fetches `/api/code/status`:

```html
        <button onclick="showTab('code')">Code</button>
```

and in the client-side `load()`/`showTab()` dispatch, add a `code` case that fetches `/api/code/status` and renders the spec §6 fields (selected provider + version, indexed/current commit, stale/dirty, capabilities, links, wiki entry, degraded guidance). Reuse the existing `escapeHtml` + fetch idiom. Renderer body to insert into the inline `<script>` map that `load(name)` reads:

```javascript
      code: { url: '/api/code/status', render: d => {
        var p = (d.providers||[])[0] || {};
        var caps = Object.keys((p.capabilities)||{}).filter(function(k){return p.capabilities[k];}).join(', ');
        var degraded = (d.providers||[]).filter(function(x){return x.degraded;}).map(function(x){return x.id+(x.reason?(' — '+x.reason):'');});
        return '<h3>Code Perception</h3>'
          + '<p>Provider: ' + escapeHtml((p.id||'none')) + ' v' + escapeHtml(String(p.providerVersion||p.adapterVersion||'?')) + '</p>'
          + '<p>Commit: indexed ' + escapeHtml(String(p.indexedCommit||'?')) + ' / current ' + escapeHtml(String(p.currentCommit||'?')) + '</p>'
          + '<p>Freshness: stale=' + d.freshness.stale + ' dirty=' + d.freshness.dirty + '</p>'
          + '<p>Capabilities: ' + escapeHtml(caps || '(none)') + '</p>'
          + '<p>Links: ' + escapeHtml(JSON.stringify(d.links)) + '</p>'
          + '<p>Wiki: ' + (d.wiki && d.wiki.exists ? (d.wiki.pageCount + ' pages') : 'not built') + '</p>'
          + '<p>Degraded: ' + escapeHtml(degraded.length ? degraded.join('; ') : '(none)') + '</p>'; } },
```

*(Match the exact object/registry shape the existing inline script uses for `timeline`/`planning`. The endpoint contract + the Code-tab wiring are BOTH pinned by the test: it asserts the served page contains `showTab('code')` and fetches `/api/code/status`.)*

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
- Modify: `templates/cli/template-manifest.js` (register 3 NEW managed files)
- Mirror (generated, do NOT hand-edit) — the convergence updates **every** managed mirror file this plan touched: **11 files**, not only the 3 new ones. Affected managed set (all core-cli):
  - New (3): `.evo-lite/cli/code-perception.js`, `.evo-lite/cli/code-perception/cli.js`, `.evo-lite/cli/code-perception/wiki.js`
  - Modified by earlier tasks (6): `.evo-lite/cli/code-perception/normalize.js` (T1), `.evo-lite/cli/code-perception/status.js` (T2), `.evo-lite/cli/memory.js` (T3), `.evo-lite/cli/mcp-server.js` + `.evo-lite/cli/mcp-validate.js` (T4), `.evo-lite/cli/inspector.js` (T6)
  - Modified by THIS task (2): `.evo-lite/cli/template-manifest.js`, `.evo-lite/cli/test/governance.js` — both are managed core-cli entries; every task appends to `test/governance.js`, and this task edits the manifest itself. Omitting them leaves uncommitted mirror drift.
- Test: `templates/cli/test/governance.js` (append block `T-ce-manifest-sync`)

**Interfaces:**
- Consumes: `sync-runtime-entry.js` (bootstrap-safe standalone entry); `template-manifest.js#{MANAGED_TEMPLATE_FAMILIES, buildManagedTemplateEntries}`.
- Produces: the 3 new files registered as managed core-cli entries; a second `sync-runtime-entry` run reports zero changes; **every** affected mirror file (all **11** above) is byte-identical to its template (Node `Buffer.equals`). The generated lock `.evo-lite/generated/runtime-mirror.lock.json` is NOT a committed artifact (it lives under the git-ignored `generated/` tree).

- [ ] **Step 1: Write the failing test** — append after the T-ce-inspector block:

```javascript
        console.log('T-ce-manifest-sync. Testing new files are managed + mirror byte-identical (in a TEMP workspace) ...');
        {
            const cp = require('child_process');
            const manifest = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            const core = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
            const NEW_FILES = ['code-perception.js', 'code-perception/cli.js', 'code-perception/wiki.js'];
            // Every managed file THIS PLAN touched must converge + stay byte-identical — not
            // only the 3 new ones. (Byte-checking just the new files would let a stale
            // modified mirror — e.g. inspector.js or memory.js — pass silently.)
            // 11 files: the 3 new + 8 modified. `template-manifest.js` and
            // `test/governance.js` ARE managed core-cli entries and THIS task edits
            // both — omitting them would leave real, uncommitted mirror drift.
            const AFFECTED = [...NEW_FILES,
                'code-perception/normalize.js', 'code-perception/status.js', 'memory.js',
                'mcp-server.js', 'mcp-validate.js', 'inspector.js',
                'template-manifest.js', 'test/governance.js'];
            assert.strictEqual(AFFECTED.length, 11, 'closure covers all 11 managed files this plan touches');
            for (const f of AFFECTED) {
                assert.ok(core.files.includes(f), `${f} must be a managed core-cli template`);
            }

            // Converge into a TEMP workspace — NEVER mutate the real repo's .evo-lite/cli
            // during a test. Seed from the template entry (its __dirname is the template
            // cli dir), writing the mirror under the temp workspace via EVO_LITE_WORKSPACE_ROOT.
            const runtime = createTempRuntimeRoot('ce-manifest');
            const entry = path.join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js');
            const run = () => JSON.parse(cp.execFileSync(process.execPath, [entry, '--json'], {
                cwd: runtime.workspaceRoot, env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: runtime.workspaceRoot }, encoding: 'utf8',
            }));
            run();                         // first seed
            const second = run();          // must converge
            assert.strictEqual(second.copied.length, 0, 'second sync-runtime-entry run must report zero copies (converged)');

            const mirrorCliDir = path.join(runtime.workspaceRoot, '.evo-lite', 'cli');
            for (const f of AFFECTED) {
                const tpl = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, ...f.split('/')));
                const mir = fs.readFileSync(path.join(mirrorCliDir, ...f.split('/')));
                assert.ok(tpl.equals(mir), `${f} mirror must be byte-identical to template`);
            }
            fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true });
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

Then run BOTH full suites DIRECTLY (no `| tail`, which would mask a non-zero exit) and confirm each exits 0 — the template suite AND the mirrored runtime suite (the latter proves the mirror is coherent and executable):

```bash
node templates/cli/test.js all;              echo "template suite exit: $?"
node ./.evo-lite/cli/test.js all;            echo "runtime suite exit:  $?"
```

Expected: both print `exit: 0`, and both include the passing `T-ce-*` blocks. A non-zero exit on either is a blocker — read the full output (not a tail) to find the failing block.

- [ ] **Step 5: Commit** — stage the templates this task edited plus EVERY affected mirror file the convergence rewrote (all **11**). Do NOT stage the generated lock: `.evo-lite/generated/runtime-mirror.lock.json` lives under the git-ignored `generated/` tree and is not a committed artifact.

```bash
git add templates/cli/template-manifest.js templates/cli/test/governance.js \
  .evo-lite/cli/code-perception.js .evo-lite/cli/code-perception/cli.js .evo-lite/cli/code-perception/wiki.js \
  .evo-lite/cli/code-perception/normalize.js .evo-lite/cli/code-perception/status.js \
  .evo-lite/cli/memory.js .evo-lite/cli/mcp-server.js .evo-lite/cli/mcp-validate.js .evo-lite/cli/inspector.js \
  .evo-lite/cli/template-manifest.js .evo-lite/cli/test/governance.js
git status --short   # verify: no .evo-lite/generated/**, no stray files, no leftover .evo-lite/cli drift
git commit -m "$(cat <<'EOF'
feat(manifest): register unified code-explore files + converge runtime mirror (task:ce-manifest-sync)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage per Acceptance Criterion

| AC | Description (abbrev) | Satisfied by |
|----|----------------------|--------------|
| `ac-unified-explore` | one shared service returns freshness/providers/normalized refs/relationships/optional impact+source/governance/diagnostics/explained recommended reading; native-lite degradation success-shaped | **T2** — the `T-ce-explore` block is split into **A** (native-lite degradation: `ok:true`, `matches:[]`, `capability-unavailable` diagnostic, non-dangling `declares_file`, floored derived links, recommended reading contains the fixture) and **B** (injected structural provider: matches/relationships/impact/source + `implements_task` derived via M1/M2 with confidence > 0). Same-service reuse pinned by T3/T4/T5 all calling `exploreCode`. + **T1** (M1/M2 seam) + **T3** (`mem code explore --json` verifier). |
| `ac-mcp-code-explore` | MCP `evo_code_explore` on the same service; missing/unindexed/stale/ambiguous/unsupported return successful guidance not isError | **T4** (tool + handler) + T4 adds it to `mcp-validate.js` (the AC's verifier `node ./.evo-lite/cli/mcp-validate.js`). |
| `ac-minimal-code-wiki` | `wiki build` produces provider/overview/current-focus/module/task pages with freshness+dependencies; pure-derived read-only; delete-dir + rebuild reproduces | **T5** (`buildCodeWiki`/`getWikiStatus` + determinism test) + T3 (`mem code wiki build|status`). |
| `ac-inspector-code-surface` | Inspector Code page + `/api/code/status|focus|task?id=` read-only, never auto-install, diagnostics on failure | **T6** (routes + page + test). Verifier `node ./.evo-lite/cli/test.js governance` covers `T-ce-inspector`. |
| `ac-mirror-parity` | new files + mirrors byte-identical; second `sync-runtime-entry` zero changes; uses standalone entry not `memory.js sync-runtime` | **T7** (manifest + convergence + Buffer.equals over all **11** affected managed files, converged in a temp workspace; generated lock not committed). |

### Spec section coverage

- §2 UnifiedExploreResult shape (incl. `files`/`modules`) → T2 result assembly. §2.1 ExploreQuery → T2 `ExploreOpts`. §2.2 processing steps 1–10 → T2 orchestration (commented per step; focus resolved by exact order, governance built from files+symbols+focus+commits+acceptance+evidence + persisted-graph merge). §2.3 recommended-reading order → T2 `rankRecommendedReading` (8 tiers, each with `reason`). §2.4 M1/M2 → T1 + wired in T2. §3 CLI contract → T3. §3.1 unified exit/error model → T3 `exitFor` (ok:false→1) + scoped `exitOverride` (invalid args→2), T4 MCP (`ok:false`→throw→isError:true), T6 Inspector (`ok:false`→503). §4 MCP → T4. §5 Code Wiki (overview/current-focus/providers/modules/tasks + provenance) → T5. §6 Inspector (provider/version/commit/capabilities/focus files/symbols/links/degraded) → T6. §7 directory layout + mirror parity → T5/T6 files + T7 (all 9 affected mirror files byte-checked). §8 phases → T1–T4 (4a) / T5–T7 (4b). §9 ACs → table above.

### Placeholder scan

No `TODO` / "add error handling" / "similar to Task N" / bare prose-for-code. Every code step carries complete, runnable code. The only intentionally light spot is T6 Step 3b's Inspector HTML tab wiring, which is presentation-only; its behavioral contract (`/api/code/*` responses) is fully specified and pinned by `T-ce-inspector`, and the exact inline-script object shape is instructed to match the file's existing `timeline`/`planning` idiom (which the implementer reads in-place). This is a deliberate "follow the established pattern" instruction, not a missing-code placeholder.

### Type / signature consistency

- `toSymbolReferences(matches, opts?)` — defined T1, consumed T2 (`{focusId}`). ✔
- `normalizeDerivedLinkConfidence(links)` / `DERIVED_LINK_CONFIDENCE_FLOOR` — defined T1, consumed T1 test + T2. ✔
- `exploreCode(query, opts) -> UnifiedExploreResult{query,ok,freshness,providers,matches,relationships,impact?,source,files,modules,focus,governance,recommendedReading,diagnostics}` — defined T2, consumed identically in T3 (CLI), T4 (MCP), T5 (Wiki), T6 (Inspector). `files`/`modules` feed T5 module pages + unresolved-link detection; `focus` is the canonical resolved focus T5/T6 render. `ok:false` comes from the T2 fatal gate (`FATAL_CODES`), which is what makes T4's isError / T6's 503 / T3's exit 1 reachable. ✔
- Verified real shapes the plan binds to (each previously mis-read): `post-commit-last-run.json` = `{commit, changedFiles}` (NOT `commits`/`headSha`); active-context backlog rows = `{checked, hash, line, text}` (NOT `id`); `changed_by_commit` entityId = `commit:<sha>` (NOT a task id) → task commits via `evidence.commitSha`, module commits via `changedFiles ∩ module.files`. ✔
- `buildGovernanceLinks` input keys used (`planIR.tasks`, `fileReferences`, `symbolReferences`, `focusReferences`, `commits`, `acceptanceDependencies`, `evidence`) all match the API map; the linker derives `implements_task` via `evidence.symbols`/commit diff-ranges (NOT `task.symbols`, which the scanner never populates). `selectProvider` request `{capability, preferredProvider?}` + `selection.candidate.registration.provider` match the router. `buildCodePerceptionStatus(context,{candidates,links})` matches status.js (rows enriched in T6). `readActiveContext()` matches memory.service.js; the service overrides it via `opts.activeContext` DI (host-bound `ACTIVE_CONTEXT_PATH`). ✔
- `buildCodeWiki(opts{projectRoot,now?}) -> {dir,pages,manifest}` / `getWikiStatus(opts) -> {exists,pageCount,...}` — defined T5, consumed T3 + T6. ✔
- `codeStatusResponse/codeFocusResponse/codeTaskResponse(result,...) -> {status,body}` — defined + exported T6, consumed by the T6 HTTP branches + unit-tested for `ok:false`→503. ✔
- `handleCodeExplore(args, deps?)` — defined + exported T4, `ok:false`→throw→isError:true. ✔
- `registerCodeCommands(program)` — defined T3, thunked in memory.js T3; scoped `exitOverride` maps invalid args→2. ✔

---

## Execution Handoff

**Plan complete and saved to `docs/plans/unified-code-explore-wiki-projection-mvp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (T1→T7), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

**Which approach?**
