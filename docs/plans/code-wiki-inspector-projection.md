---
id: plan:code-wiki-inspector-projection
title: Code Wiki & Inspector Projection (Phase 4b)
status: parked
linkedSpec: spec:unified-code-explore-wiki-projection
---

# Code Wiki & Inspector Projection (Phase 4b) Implementation Plan

> **STATUS: PARKED — do not execute.** This plan is deliberately not active. See **Activation criteria** below. It is kept fully specified so that, if the evidence arrives, execution can start immediately without re-derivation.

> **For agentic workers:** REQUIRED SUB-SKILL (once activated): Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project the ONE Unified Explore service (`code-perception.js#exploreCode`, shipped by `plan:unified-code-explore-agent-surface-mvp`) into two **human** surfaces: a pure-derived Code Wiki and a read-only Inspector Code page.

**Architecture:** Both surfaces are thin, read-only consumers of the SAME service — no duplicate provider orchestration, no second source of truth. The Wiki writes only under `.evo-lite/generated/code-wiki/` and is reproducible from scratch. The Inspector adds read-only `/api/code/*` routes plus a Code tab to the existing zero-dep server.

**Tech Stack:** Node.js (CommonJS, `'use strict'`, no build step), zero-dep `http.createServer` (existing Inspector), Node `assert` test harness. Windows-first. No new dependencies.

## Why this is parked

Phase 4a ships `mem code explore` + the `evo_code_explore` MCP tool. Those already answer the core question ("what code does this task touch, and why was it built this way") for **both** the agent and a human at a terminal. This plan adds a *persistent, browsable* human surface on top — which is:

- the **highest-cost** third of the spec (an HTML surface, an HTTP API, a deterministic generator, extra managed mirror files, and their long-term compatibility burden), and
- the **least evidenced**: nothing yet shows a user wants it when the CLI/MCP answer is already available, and
- the part where plan review found the **most defects**, precisely because it is furthest from any verified producer shape.

Building it before validation would add permanent maintenance surface to answer a question nobody has asked. Parking it is not abandonment — it is refusing to spend the budget before the evidence exists.

## Activation criteria

Activate ONLY when external validation produces at least one of these, from a real user who is not the author:

- a user asks for a browsable/visual surface after using `mem code explore` — not instead of trying it;
- a user cannot read the CLI/MCP JSON or terminal output and is blocked by that;
- a non-developer needs to browse Task-to-Code links;
- a teammate needs a shared, read-only project view;
- a user explicitly asks for a persistent, navigable Code Wiki.

If users are served by `mem code explore` + MCP alone, **this plan stays parked and its cost is never paid**.

## Prerequisites (all from Phase 4a)

- `code-perception.js#exploreCode(query, opts) -> UnifiedExploreResult{query, ok, freshness, providers, matches, relationships, impact?, source, files, modules, focus, governance, recommendedReading, diagnostics}` — the ONE service.
- `result.focus = {entityId, taskId, resolved}` — the canonical resolved focus. Render THIS; never re-derive focus (e.g. "all unfinished tasks" is not the focus).
- `result.files` (sorted repo-relative paths) and `result.modules` (`[{id, files, taskIds, changed}]`) — feed module pages and unresolved-link detection.
- `result.ok === false` is the §3.1 fatal signal. The Inspector maps it to HTTP 503 — never a 200 envelope.
- Verified producer shapes (see 4a's **Grounded reality**): `changed_by_commit` is keyed by `commit:<sha>`, so task→commit association goes through `evidence.taskId + evidence.commitSha`, and module→commit through `commit.changedFiles ∩ module.files`.

## Global Constraints

*(Inherited from the spec; these bind every task here.)*

- One shared Unified Explore service backs CLI + MCP + Code Wiki + Inspector — NO duplicate logic. These surfaces only project.
- **Code Wiki (§5):** `.evo-lite/generated/code-wiki/` is pure-derived + read-only; NO canonical human truth stored there; deleting the whole dir + rebuild reproduces EVERY page. Pages carry provenance frontmatter.
- **Unified exit/error model (§3.1):** capability-insufficiency is success-shaped; `ok:false` → Inspector 503; missing required query param → 400; 500 only for a thrown/unexpected error.
- **Mirror parity:** sync via the canonical bootstrap-safe `node ./.evo-lite/cli/sync-runtime-entry.js`; a second run reports zero changes; mirrors byte-identical (Node `Buffer.equals`).
- **Provider security invariants from ①②:** never auto-install / `codegraph init`, never read `.codegraph` internals, path-containment before read, no-shell `execFile`. These surfaces are read-only and must not spawn writes.
- **Windows-first**; `path.join`. Never edit `.evo-lite/cli/**` by hand.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `templates/cli/code-perception/status.js` (modify) | provider rows carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit` — needed ONLY by Wiki provenance + the Inspector page, which is why this ships here and not in 4a | T1 |
| `templates/cli/code-perception/wiki.js` (create) | `buildCodeWiki`, `getWikiStatus` — pure-derived overview/current-focus/providers/modules/tasks pages + manifest | T1 |
| `templates/cli/code-perception/cli.js` (modify) | add the `mem code wiki <build\|status>` subgroup (4a deliberately omitted it — the module did not exist) | T1 |
| `templates/cli/inspector.js` (modify) | exported `code*Response` mappers + `/api/code/status\|focus\|task` routes + Code page tab | T2 |
| `templates/cli/template-manifest.js` (modify) | register `code-perception/wiki.js` | T3 |
| `templates/cli/test/governance.js` (modify) | `T-ce-wiki`, `T-ce-inspector`, `T-ce-manifest-sync-4b` | T1–T3 |

## Task order

```
T1 cw-wiki        status.js enrichment + Code Wiki + `mem code wiki` subgroup
T2 cw-inspector   Inspector Code page + read-only /api/code/*
T3 cw-closure     manifest registration + 4b mirror closure
```

**Completing this plan closes the parent spec's last two ACs** (`ac-minimal-code-wiki`, `ac-inspector-code-surface`). Only then may `spec:unified-code-explore-wiki-projection` move to done.

---
### Task 1: status.js enrichment + Minimal Code Wiki (pure-derived projection)

**Files:**
- Modify: `templates/cli/code-perception/status.js` (provider rows carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit`)
- Create: `templates/cli/code-perception/wiki.js`
- Modify: `templates/cli/code-perception/cli.js` (add the `mem code wiki <build|status>` subgroup)
- Test: `templates/cli/test/governance.js` (append block `T-ce-wiki`)

**Interfaces:**
- Consumes: `../code-perception.js#exploreCode` (the ONE service, shipped by 4a); `../runtime.js#getWorkspaceRoot`.
- Produces:
  - Enriched status rows (Step 3a): `buildProviderRow` also carries `capabilities` (object), `providerVersion`, `adapterVersion`, `indexedCommit`, `currentCommit` — additive; existing status tests assert individual fields, not whole-row shape, so they keep passing. Flows through `result.providers` to the Wiki provenance and the Inspector page.
  - `async buildCodeWiki(opts) -> {dir, pages: string[], manifest}`. `opts = {projectRoot, now?}` (`now` is an injectable clock for the determinism test). Writes `.evo-lite/generated/code-wiki/{manifest.json, overview.md, current-focus.md, providers.md, modules/<id>.md (one per derived module), tasks/<id>.md}`. Module pages (spec §5): description / files / representative symbols / callers-callees summary / related tasks+commits / freshness. Task pages (spec §5): linkedFiles / resolved provider files / confirmed-derived-proposed links / related commits+tests / evidence / unresolved links. Pure-derived: reads only the service output (incl. `result.modules`/`result.files`) + Planning IR; writes ONLY under the generated dir; a fresh `rmSync(wikiDir)` precedes every build so a removed task/module never lingers; deleting the whole dir and rebuilding reproduces EVERY page byte-for-byte (deterministic ordering; the only clock value is the provenance `generatedAt`).
  - `getWikiStatus(opts) -> {exists, pageCount, generatedAt, provider, dependencies}`.
  - Every page starts with provenance frontmatter: `generatedBy / generatedAt / provider / providerVersion / indexedCommit / currentCommit / freshness / dependencies[]`.

- [ ] **Step 1: Write the failing test** — append after the T-ce-manifest-sync-4a block (the last block Phase 4a added):

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

- [ ] **Step 3a: Enrich the status rows** in `templates/cli/code-perception/status.js#buildProviderRow`. `result.providers` comes straight from `buildCodePerceptionStatus` and is the single provider table both this Wiki and the Inspector page render. The row currently drops `capabilities`/versions/commits even though `candidate.status` (a `ProviderStatus`) carries them — so provenance could not honestly report `providerVersion`. Phase 4a deliberately did NOT make this change (nothing there reads the fields); it ships here, with its first consumer. Find:

```javascript
    const row = { id, role, available, ready, indexState, compatibility, degraded };
    const reason = availability && availability.reason;
    if (reason) {
        row.reason = reason;
    }
```

Replace with (purely additive):

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

- [ ] **Step 3b: Create `templates/cli/code-perception/wiki.js`**

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
        // providerVersion is the PROVIDER's version (Step 3a of this task puts it on the row);
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

- [ ] **Step 3c: Add the `mem code wiki` subgroup** to `templates/cli/code-perception/cli.js`. Phase 4a deliberately omitted it because `./wiki` did not exist — registering a subgroup whose `require` throws would either brick the `code` group or ship a permanently-failing command. Now that the module exists, add it inside `registerCodeCommands`, immediately before the `code.action(() => code.outputHelp());` line:

```javascript
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
```

4a's `exitOverride` loop already walks nested subgroups (`for (const c of code.commands) scoped.push(...c.commands)`), so this subgroup inherits the invalid-args → exit 2 contract with no further change.

- [ ] **Step 4: Run test to verify it passes**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-wiki"`
Expected: PASS — `✅ T-ce-wiki code wiki determinism passed`.

- [ ] **Step 5: Commit**

```bash
git add templates/cli/code-perception/status.js templates/cli/code-perception/wiki.js templates/cli/code-perception/cli.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(code-perception): minimal pure-derived Code Wiki projection (task:cw-wiki)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Inspector Code page + read-only `/api/code/*`

**Files:**
- Modify: `templates/cli/inspector.js` (export pure response mappers + add API branches in `handleApi` + a Code tab in `renderHtml`)
- Test: `templates/cli/test/governance.js` (append block `T-ce-inspector`)

**Interfaces:**
- Consumes: `code-perception.js#exploreCode` (its `providers` rows already carry `capabilities`/`providerVersion`/`adapterVersion`/`indexedCommit`/`currentCommit` — enriched in T1 Step 3a of this plan); `code-perception/wiki.js#getWikiStatus`; existing `getWorkspaceRoot`.
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
feat(inspector): read-only Code page + /api/code/* over unified service (task:cw-inspector)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manifest registration + 4b mirror closure

**Files:**
- Modify: `templates/cli/template-manifest.js` (register `code-perception/wiki.js`)
- Test: `templates/cli/test/governance.js` (append block `T-ce-manifest-sync-4b`)
- Mirror (generated, do NOT hand-edit): every managed file this plan changed. **Do not hand-maintain that list** — derive it, exactly as 4a's closure task does.

**Interfaces:**
- Consumes: `sync-runtime-entry.js`; `template-manifest.js#{MANAGED_TEMPLATE_FAMILIES}`.
- Produces: `code-perception/wiki.js` registered as a managed core-cli entry; a second `sync-runtime-entry` run reports zero changes; **every** managed core-cli file byte-identical to its template.

- [ ] **Step 1: Write the failing test** — append after the T-ce-inspector block:

```javascript
        console.log('T-ce-manifest-sync-4b. Wiki managed + EVERY managed mirror byte-identical ...');
        {
            const cp = require('child_process');
            const manifest = require(path.join(TEMPLATE_CLI_DIR, 'template-manifest.js'));
            const core = manifest.MANAGED_TEMPLATE_FAMILIES.find(f => f.key === 'core-cli');
            assert.ok(core.files.includes('code-perception/wiki.js'), 'code-perception/wiki.js must be a managed core-cli template');

            const runtime = createTempRuntimeRoot('ce-manifest-4b');
            const entry = path.join(TEMPLATE_CLI_DIR, 'sync-runtime-entry.js');
            const run = () => JSON.parse(cp.execFileSync(process.execPath, [entry, '--json'], {
                cwd: runtime.workspaceRoot,
                env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: runtime.workspaceRoot },
                encoding: 'utf8',
            }));
            run();
            const second = run();
            assert.strictEqual(second.copied.length, 0, 'second sync-runtime-entry run must report zero copies (converged)');

            // EVERY managed core-cli entry — derived from the manifest, never a hand list.
            // No skipping and no `>= N` gate: a missing template is itself a defect, and an
            // approximate count would let a skipped entry pass (see 4a's T6 for the same rule).
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
        console.log('✅ T-ce-manifest-sync-4b mirror parity passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node templates/cli/test.js governance 2>&1 | grep -E "T-ce-manifest-sync-4b|must be a managed" | head`
Expected: FAIL — `code-perception/wiki.js must be a managed core-cli template`.

- [ ] **Step 3a: Register the file** in `templates/cli/template-manifest.js`, in the `core-cli` family `files` array, next to the other `code-perception/*` entries:

```javascript
            'code-perception/wiki.js',
```

- [ ] **Step 3b: Converge the real mirror**

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

Expected: both print `exit: 0`.

- [ ] **Step 5: Commit** — derive the mirror list from git, never from memory:

```bash
git status --short .evo-lite/cli   # <- authoritative list
git add templates/cli/template-manifest.js templates/cli/test/governance.js
git add .evo-lite/cli
git status --short                 # verify: no .evo-lite/generated/** staged
git commit -m "$(cat <<'EOF'
feat(manifest): register code wiki + converge runtime mirror (task:cw-closure)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage

| AC (spec §9) | Satisfied by |
|----|----|
| `ac-minimal-code-wiki` | **T1** — `buildCodeWiki`/`getWikiStatus`, overview/current-focus/providers/modules/tasks pages with provenance frontmatter, pure-derived, whole-tree delete + rebuild reproduces every page byte-identically. Verifier: `mem code wiki build` / `mem code wiki status`. |
| `ac-inspector-code-surface` | **T2** — Code page + `/api/code/status\|focus\|task?id=`, read-only, never auto-install, diagnostics surfaced, `ok:false` → 503, missing id → 400. |
| `ac-mirror-parity` (4b portion) | **T3** — every managed file byte-identical, second entry run zero changes. |

On completion, the parent spec's five ACs are all closed and `spec:unified-code-explore-wiki-projection` may move to done.

### Notes carried from plan review

- Task pages must associate commits via `evidence.taskId + evidence.commitSha` and module pages via `commit.changedFiles ∩ module.files` — filtering `changed_by_commit` by a task id always returns empty (it is keyed `commit:<sha>`).
- `current-focus.md` renders `result.focus` only. Listing every unfinished task is not the focus and was an explicit review defect.
- Wiki provenance reports `providerVersion` and `adapterVersion` as DISTINCT fields; reporting the adapter's version as the provider's is a provenance lie. This is why T1 also ships the `status.js` row enrichment.
- The determinism test recursively snapshots the WHOLE generated tree, deletes the directory, rebuilds with a fixed injected clock, and compares every page byte-for-byte — not just `overview.md`.
- The Inspector's response mappers are exported pure functions so the `ok:false` → 503 mapping is unit-testable without HTTP.
