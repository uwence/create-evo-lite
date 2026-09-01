'use strict';
// ATTP session-only collector —— 三条入口(mem bootstrap / SessionStart / CLI recovery)唯一真相源。
// 重依赖(db / memory.service)lazy require;refresh 路径永不加载本模块(不变量6)。
const fs = require('fs');
const path = require('path');

const RULES = Object.freeze({ dir: '.agents/rules/', required: ['evo-lite', 'execution-model'] });

// 纯派生:plan.status 仅 done|parked|draft,不能按 'active' 过滤 → 用 focus 文本关联。
function derivePlanSpec(planIr, focusText) {
    const empty = { plan: null, spec: null };
    if (!planIr || !Array.isArray(planIr.plans)) return empty;
    const text = String(focusText || '');
    const tasks = Array.isArray(planIr.tasks) ? planIr.tasks : [];
    const matches = (entry) => {
        if (entry.id && text.includes(entry.id)) return true;
        if (entry.sourcePath && text.includes(path.posix.basename(String(entry.sourcePath).replace(/\\/g, '/')))) return true;
        return false;
    };
    const planEntry = planIr.plans.find(matches) || null;
    let plan = null;
    if (planEntry) {
        const ids = Array.isArray(planEntry.taskIds) ? planEntry.taskIds : [];
        const done = ids.filter(id => {
            const t = tasks.find(x => x && x.id === id);
            return t && t.status === 'done';
        }).length;
        plan = { id: planEntry.id, title: planEntry.title || null, status: planEntry.status || null, progress: `${done}/${ids.length}` };
    }
    const specs = Array.isArray(planIr.specs) ? planIr.specs : [];
    let specEntry = null;
    if (planEntry && planEntry.linkedSpec) specEntry = specs.find(s => s && s.id === planEntry.linkedSpec) || null;
    if (!specEntry) specEntry = specs.find(matches) || null;
    const spec = specEntry ? { id: specEntry.id, title: specEntry.title || null, status: specEntry.status || null } : null;
    return { plan, spec };
}

// [takeover-freshness-snapshot-misrepresentation]
//
//     snapshot != live state
//
// BEGIN_META records where the repository stood at the last context operation.
// It is snapshot authority and is NOT required to self-refresh. What is
// forbidden is handing that snapshot to a takeover agent under the name
// `freshness`, with no live comparison — the agent then reads a historical
// headSha as "where the repo is now". governance-observer already models this
// correctly (meta and live git are two sources, and it emits
// CONTEXT_HEAD_NOT_ANCESTOR / CONTEXT_SYNC_COUNT_DRIFT); the takeover payload
// did not. So the payload now carries both sources separately, and `freshness`
// describes only the RELATION between them.
function normalizeGitTriple(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
        headSha: typeof o.headSha === 'string' && o.headSha ? o.headSha : null,
        ahead: Number.isFinite(o.ahead) ? o.ahead : null,
        behind: Number.isFinite(o.behind) ? o.behind : null,
    };
}

// A meta that FAILED validation carries no snapshot authority. readMetaAnchor
// deliberately still returns its partial `meta` so a caller can inspect what was
// wrong — but reading that while ignoring `.ok` lets a rejected meta's leftovers
// through as recorded facts. That is the "0 authority → unknown" half of the rule,
// broken at the boundary rather than in the comparison.
function projectContextSnapshot(metaResult) {
    const r = metaResult && typeof metaResult === 'object' ? metaResult : {};
    return r.ok ? normalizeGitTriple(r.meta) : { headSha: null, ahead: null, behind: null };
}

// readGitState() reports ahead/behind as 0/0 when there is no upstream, or when
// the upstream probe failed — inside the observer that is an internal default,
// but projected into the payload as an OBSERVED live fact it is a fabricated
// zero. Counts are facts only when there is an upstream to count against;
// otherwise they are unobserved, and "probe failure is not evidence of no
// divergence" is this contract's own rule.
function projectLiveGit(live) {
    const o = live && typeof live === 'object' ? live : {};
    const counted = Boolean(o.upstream);
    return {
        headSha: o.head || null,
        ahead: counted ? o.ahead : null,
        behind: counted ? o.behind : null,
    };
}

// `unknown` is a first-class answer, not a fallback to the pessimistic one. A
// probe that could not run is not evidence of divergence — "在没有 authority 的
// 地方,不产生 judgement", the same rule the [0ce0] contract states.
function compareSnapshotToLive(snapshot, live, probeAncestry) {
    let headRelation = 'unknown';
    if (snapshot.headSha && live.headSha) {
        if (snapshot.headSha === live.headSha) {
            headRelation = 'same';
        } else {
            const probe = typeof probeAncestry === 'function'
                ? probeAncestry(snapshot.headSha, live.headSha)
                : 'unknown';
            if (probe === 'ancestor') headRelation = 'ancestor';
            else if (probe === 'not-ancestor') headRelation = 'diverged';
        }
    }
    const comparable = snapshot.ahead !== null && snapshot.behind !== null
        && live.ahead !== null && live.behind !== null;
    const countDrift = comparable
        ? (snapshot.ahead !== live.ahead || snapshot.behind !== live.behind)
        : 'unknown';
    // FALSE-DOMINANT. The two halves of the rule are symmetric:
    //
    //     no authority        → do not invent a judgement
    //     half the authority  → do not erase the half you have
    //
    // `ancestor` / `diverged` only arise once both shas are known AND different,
    // so either already proves "not the same state"; an unobservable count cannot
    // walk that back into `unknown`. A real count mismatch settles it the same way
    // even when ancestry could not be probed.
    let inSync;
    if (headRelation === 'ancestor' || headRelation === 'diverged' || countDrift === true) {
        inSync = false;
    } else if (headRelation === 'same' && countDrift === false) {
        inSync = true;
    } else {
        inSync = 'unknown';
    }
    return { inSync, headRelation, countDrift };
}

// 纯装配:把已取得的部件装配成 SessionTakeoverContext。
function assembleSessionContext(base, parts) {
    const summary = parts.summary || {};
    const ss = parts.sessionstart || {};
    const degraded = Array.isArray(parts.degraded) ? parts.degraded : [];
    // 可恢复降级(verify/recall 取不到)仍须产出【通过 schema 校验】的 payload:
    // 归一化承重字段并取保守值,降级事实由 degraded[] + attention-needed 承载。
    const verifyRaw = parts.verify && typeof parts.verify === 'object' ? parts.verify : {};
    const verify = { ...verifyRaw, hasAlerts: typeof verifyRaw.hasAlerts === 'boolean' ? verifyRaw.hasAlerts : true };
    const recallRaw = parts.recall && typeof parts.recall === 'object' ? parts.recall : {};
    const recall = { ...recallRaw, status: typeof recallRaw.status === 'string' ? recallRaw.status : 'unavailable' };
    const contextSnapshot = normalizeGitTriple(parts.contextSnapshot);
    const git = normalizeGitTriple(parts.git);
    const freshness = compareSnapshotToLive(contextSnapshot, git, parts.probeAncestry);
    const risks = [...new Set([
        ...((summary.validation && summary.validation.warnings) || []),
        ...(ss.warnings || []),
    ])].slice(0, 5);
    const nextAction = (ss.reminders && ss.reminders[0])
        || (verify.nextSteps && verify.nextSteps[0])
        || '读取 .agents/rules 与 active_context 后继续当前 focus';
    const needsBootstrap = ['placeholder', 'missing'].includes(ss.contextStatus)
        || ['placeholder', 'missing'].includes(ss.architectureStatus);
    const takeover = needsBootstrap
        ? 'bootstrap-pending'
        : ((verify.hasAlerts || degraded.length > 0) ? 'attention-needed' : 'ready');
    const planSpec = parts.planSpec || { plan: null, spec: null };
    return {
        ...base, kind: 'session',
        projectName: path.basename(base.projectRoot),
        generatedAt: base.generatedAt || null,
        activePlan: planSpec.plan, activeSpec: planSpec.spec,
        rules: RULES, risks, nextAction,
        contextSnapshot, git, freshness,
        health: { takeover, contextStatus: ss.contextStatus || 'unknown',
            architectureStatus: ss.architectureStatus || 'unknown', activeTaskCount: ss.activeTaskCount || 0 },
        verify, recall, degraded,
    };
}

function readPlanIr(projectRoot, degraded) {
    const p = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(p)) { degraded.push({ part: 'plan-ir', reason: 'missing' }); return null; }
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { degraded.push({ part: 'plan-ir', reason: `parse: ${e.message}` }); return null; }
}

// 承重字段获取失败一律记入 degraded(不静默变 null);不可恢复失败直接抛出。
async function collectSessionTakeoverContextFull(base) {
    const degraded = [];
    let memoryService;
    try {
        require('./db').initDB();                 // 不可恢复:DB 未就绪则 verify/recall 无意义
        memoryService = require('./memory.service');
    } catch (e) {
        throw new Error(`takeover collector: runtime init failed: ${e.message}`);
    }
    let summary;
    try { summary = memoryService.summarizeActiveContext(); }
    catch (e) { throw new Error(`takeover collector: active context unreadable: ${e.message}`); } // 不可恢复
    let verify = {};
    try { verify = await memoryService.verify({ silent: true }); }
    catch (e) { degraded.push({ part: 'verify', reason: e.message }); }
    let sessionstart = {};
    try { sessionstart = memoryService.inspectLocalState('sessionstart'); }
    catch (e) { degraded.push({ part: 'sessionstart', reason: e.message }); }
    let recall = {};
    try { recall = await memoryService.buildTakeoverRecall(summary, verify) || {}; }
    catch (e) { degraded.push({ part: 'recall', reason: e.message }); }

    const rc = require('./takeover-receipt');
    const planSpec = derivePlanSpec(readPlanIr(base.projectRoot, degraded), base.focus);
    const metaResult = rc.readMetaAnchor(base.projectRoot);
    if (!metaResult.ok) degraded.push({ part: 'meta', reason: metaResult.reason });

    // Live git, read through governance-observer's reader so the takeover payload
    // and the observer cannot disagree about what the repository state is. An
    // unreadable git is a degraded fact, not a licence to present the snapshot as
    // current.
    let git = { headSha: null, ahead: null, behind: null };
    let probeAncestry = () => 'unknown';
    try {
        const observer = require('./governance-observer');
        git = projectLiveGit(observer.readGitState(base.projectRoot));
        probeAncestry = (ancestor, head) => observer.probeAncestry(base.projectRoot, ancestor, head);
    } catch (e) {
        degraded.push({ part: 'git', reason: e.message });
    }

    return assembleSessionContext(base, {
        summary, sessionstart, verify, recall, planSpec,
        contextSnapshot: projectContextSnapshot(metaResult),
        git, probeAncestry, degraded,
    });
}

module.exports = { derivePlanSpec, projectContextSnapshot, projectLiveGit, assembleSessionContext, collectSessionTakeoverContextFull };
