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
        //     layer. Today the built-in producer yields none of these; a DI caller / Evidence IR may.
        //     We NEVER synthesize a signal that was not present.
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
                    // Ownership is FAIL-CLOSED. `t.id` always wins (correct owner), but if the
                    // row DECLARED a different taskId, that is inconsistent producer data: retain
                    // it for observation, but never let it reach the linker (a mismatched taskId
                    // would silently create a cross-task governance link — fabricated semantics).
                    const suppliedTaskId = (typeof e.taskId === 'string' && e.taskId) ? e.taskId : null;
                    const row = Object.assign({}, e, { taskId: t.id });
                    if (suppliedTaskId && suppliedTaskId !== t.id) {
                        row.linkable = false;
                        diagnostics.push(diag('evidence-task-mismatch',
                            `evidence declares ${suppliedTaskId} but is owned by ${t.id}; retained but not linked`));
                    } else {
                        row.linkable = hasLinkerSignal(row);
                    }
                    allEvidence.push(row);
                    if (row.linkable) linkableEvidence.push(row);
                } else if (typeof e === 'string' && e.length) {
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
