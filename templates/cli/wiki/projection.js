'use strict';

// Deterministic fact model (design §3). The narrative/render layer may ONLY
// explain what this module computed — it never computes facts of its own.
// Attribution authority: architectureIR.files[].module; module.paths is a
// fallback for IR files lacking a module field (confidence downgraded).
// Task->module attribution source: planIR.tasks[].linkedFiles (the same
// declares_file producer the 4a linker consumes).

const DONE_STATUSES = new Set(['implemented', 'verified', 'done']);
const OPEN_STATUSES = new Set(['todo', 'active']);

// Single source of the canonical lane order (design §2.1). W5's render layer
// imports this — an unrecognized role keeps its ORIGINAL value, gets its own
// lane after the canonical ones (lexicographic), and produces a warning here.
const CANONICAL_ROLES = ['entry', 'service', 'feature', 'ui', 'runtime', 'scanner', 'governance', 'docs', 'test', 'unknown'];

function normalizePath(p) { return String(p).replace(/\\/g, '/').replace(/^\.\//, ''); }

function taskCompletion(status) {
    if (DONE_STATUSES.has(status)) return 'done';
    if (OPEN_STATUSES.has(status)) return 'open';
    return 'unknown';
}

function buildFileIndex(architectureIR, warnings) {
    const index = new Map();
    const files = (architectureIR && architectureIR.files) || [];
    for (const f of files) {
        if (f && f.path && f.module) index.set(normalizePath(f.path), { module: f.module, confidence: f.confidence ?? 1 });
    }
    for (const f of files) {
        if (!f || !f.path || f.module) continue;
        const p = normalizePath(f.path);
        // Architecture-scanner pattern semantics: a trailing '/' means directory
        // prefix; anything else is an EXACT file path — never a prefix.
        const m = ((architectureIR && architectureIR.modules) || [])
            .find(mod => (mod.paths || []).some(x => {
                const pat = normalizePath(x);
                return pat.endsWith('/') ? p.startsWith(pat) : p === pat;
            }));
        if (m) {
            index.set(p, { module: m.id, confidence: 0.5 });
            warnings.push(`file ${p} attributed via paths fallback (confidence downgraded)`);
        }
    }
    return index;
}

// Canonical tri-state freshness (design §1.1): 'fresh'/'stale' come ONLY from
// an explicit comparable snapshot pair recorded by the producer. Today's IRs
// carry generatedAt only, so this always returns 'unknown' — the fingerprint
// branch is a forward-compat seam, not a claim about current producers.
// FORBIDDEN inputs: generatedAt, file mtime, build success, drift silence
// (dashboard-data.generatedDataFresh is R009-derived and must never feed this).
function computeFreshness(ir) {
    if (!ir) return { state: 'unknown', reason: 'IR 缺失' };
    if (typeof ir.sourceFingerprint === 'string' && typeof ir.observedFingerprint === 'string') {
        return ir.sourceFingerprint === ir.observedFingerprint
            ? { state: 'fresh', reason: '快照指纹一致' }
            : { state: 'stale', reason: '快照指纹不一致' };
    }
    return { state: 'unknown', reason: 'IR 仅有 generatedAt,无可比对快照' };
}

function buildProjection({ architectureIR, planIR, exploreResult, driftReport, verifySummary, recentCommits }) {
    const warnings = [];
    const fileIndex = buildFileIndex(architectureIR || {}, warnings);

    const modules = new Map();
    for (const m of ((architectureIR && architectureIR.modules) || [])) {
        modules.set(m.id, {
            moduleId: m.id, name: m.name || m.id, description: m.description || '',
            role: m.role || 'unknown', confidence: m.confidence ?? 1,
            files: [], tasks: [], taskCounts: { done: 0, open: 0, unknown: 0, shared: 0 },
            progressState: 'unplanned', healthState: 'normal', healthReasons: [],
            focus: false, recentCommits: [],
        });
    }
    for (const [p, att] of fileIndex) { const m = modules.get(att.module); if (m) m.files.push(p); }
    for (const m of modules.values()) {
        m.files.sort();
        if (!CANONICAL_ROLES.includes(m.role)) {
            warnings.push(`module ${m.moduleId} has unrecognized role "${m.role}" — rendered in its own lane after canonical lanes`);
        }
    }

    // ---- task attribution (declares_file source: tasks[].linkedFiles) ----
    const taskModuleHits = new Map();
    for (const t of ((planIR && planIR.tasks) || [])) {
        const hit = new Set();
        for (const f of (t.linkedFiles || [])) {
            const att = fileIndex.get(normalizePath(f));
            if (att) hit.add(att.module);
        }
        if (hit.size) taskModuleHits.set(t.id, hit);
    }
    for (const t of ((planIR && planIR.tasks) || [])) {
        const hit = taskModuleHits.get(t.id);
        if (!hit) continue;
        const completion = taskCompletion(t.status);
        if (completion === 'unknown') warnings.push(`task ${t.id} has unrecognized status "${t.status}" — counted as 状态未知`);
        const shared = hit.size > 1;
        for (const moduleId of hit) {
            const m = modules.get(moduleId);
            if (!m) continue;
            m.tasks.push({ id: t.id, title: t.title || t.id, status: t.status, completion, shared });
            m.taskCounts[completion] += 1;
            if (shared) m.taskCounts.shared += 1;
        }
    }
    for (const m of modules.values()) {
        const total = m.taskCounts.done + m.taskCounts.open + m.taskCounts.unknown;
        m.progressState = total === 0 ? 'unplanned'
            : (m.taskCounts.open + m.taskCounts.unknown) === 0 ? 'done' : 'in-progress';
        m.tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    // ---- health: attributable findings only; dedup by finding id ----
    // info findings are EXCLUDED from health grading (design §3.3) but are
    // counted into ProjectHealth.driftInfo — data never silently disappears.
    const unattributed = [];
    const findingsByModule = new Map();
    let infoCount = 0;
    for (const f of (((driftReport || {}).findings) || [])) {
        if (!f) continue;
        if (f.level === 'info') { infoCount += 1; continue; }
        const hits = new Set();
        for (const ev of (f.evidence || [])) {
            const att = fileIndex.get(normalizePath(ev));
            if (att) hits.add(att.module);
        }
        if (!hits.size) { unattributed.push(f); continue; }
        for (const moduleId of hits) {
            if (!findingsByModule.has(moduleId)) findingsByModule.set(moduleId, new Map());
            findingsByModule.get(moduleId).set(f.id, f);
        }
    }
    for (const m of modules.values()) {
        const list = findingsByModule.has(m.moduleId) ? [...findingsByModule.get(m.moduleId).values()] : [];
        const errors = list.filter(f => f.level === 'error');
        const warns = list.filter(f => f.level === 'warning');
        if (errors.length) { m.healthState = 'risk'; m.healthReasons = errors.map(f => f.rule); }
        else if (warns.length >= 3) { m.healthState = 'risk'; m.healthReasons = warns.map(f => f.rule); }
        else if (warns.length >= 1) { m.healthState = 'attention'; m.healthReasons = warns.map(f => f.rule); }
    }

    // ---- focus: 4a canonical only; ProjectHealth carries the narrative facts ----
    const focus = (exploreResult && exploreResult.focus) || { resolved: false };
    const focusInfo = { resolved: !!focus.resolved, taskId: focus.taskId || null, label: '', moduleIds: [] };
    if (focus.resolved) {
        const t = ((planIR && planIR.tasks) || []).find(x => x.id === focus.taskId);
        focusInfo.label = t ? (t.title || t.id) : String(focus.taskId || focus.entityId || '');
        if (focus.taskId && taskModuleHits.has(focus.taskId)) {
            focusInfo.moduleIds = [...taskModuleHits.get(focus.taskId)].sort();
            for (const id of focusInfo.moduleIds) {
                const m = modules.get(id);
                if (m) m.focus = true;
            }
        }
    }

    // ---- recent commits per module ----
    // A cross-module commit appears on every touched module's page, but each
    // page lists ONLY the files belonging to THAT module — never the full set.
    for (const c of (recentCommits || [])) {
        const touched = new Set();
        for (const f of (c.files || [])) {
            const att = fileIndex.get(normalizePath(f));
            if (att) touched.add(att.module);
        }
        for (const id of touched) {
            const m = modules.get(id);
            if (m && m.recentCommits.length < 10) {
                m.recentCommits.push({
                    sha: c.sha, subject: c.subject,
                    files: (c.files || []).filter(f => {
                        const att = fileIndex.get(normalizePath(f));
                        return att && att.module === id;
                    }),
                });
            }
        }
    }

    // ---- homepage totals: dedup by task id ----
    let taskDone = 0, taskOpen = 0, taskUnknown = 0;
    for (const t of ((planIR && planIR.tasks) || [])) {
        const c = taskCompletion(t.status);
        if (c === 'done') taskDone += 1; else if (c === 'open') taskOpen += 1; else taskUnknown += 1;
    }

    const summary = ((driftReport || {}).summary) || {};
    const project = {
        driftErrors: summary.errors ?? 0,
        driftWarnings: summary.warnings ?? 0,
        driftInfo: summary.info ?? infoCount,
        unattributedFindings: unattributed.map(f => ({ id: f.id, rule: f.rule, level: f.level })),
        verify: verifySummary || null,
        inputFreshness: {
            architecture: computeFreshness(architectureIR),
            planning: computeFreshness(planIR),
        },
        focus: focusInfo,
        focusResolved: !!focus.resolved,
        codePerception: exploreResult
            ? { providers: exploreResult.providers || [], freshness: exploreResult.freshness || null }
            : null,
        links: (exploreResult && exploreResult.governance && exploreResult.governance.linkSummary) || null,
    };

    return {
        modules: [...modules.values()].sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1)),
        project,
        totals: { taskDone, taskOpen, taskUnknown },
        warnings,
    };
}

module.exports = { buildProjection, taskCompletion, computeFreshness, CANONICAL_ROLES, DONE_STATUSES, OPEN_STATUSES };
