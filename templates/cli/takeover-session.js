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
    const freshnessRaw = parts.freshness && typeof parts.freshness === 'object' ? parts.freshness : {};
    const freshness = {
        headSha: typeof freshnessRaw.headSha === 'string' ? freshnessRaw.headSha : null,
        ahead: Number.isFinite(freshnessRaw.ahead) ? freshnessRaw.ahead : null,
        behind: Number.isFinite(freshnessRaw.behind) ? freshnessRaw.behind : null,
    };
    const risks = [...new Set([
        ...((summary.validation && summary.validation.warnings) || []),
        ...(ss.warnings || []),
    ])].slice(0, 5);
    const nextAction = (ss.reminders && ss.reminders[0])
        || (verify.nextSteps && verify.nextSteps[0])
        || '读取 .agents/rules 与 active_context 后继续当前 focus';
    const needsBootstrap = ['placeholder', 'missing'].includes(ss.contextStatus)
        || ['placeholder', 'missing'].includes(ss.architectureStatus);
    const takeover = (verify.hasAlerts || degraded.length > 0)
        ? 'attention-needed'
        : (needsBootstrap ? 'bootstrap-pending' : 'ready');
    const planSpec = parts.planSpec || { plan: null, spec: null };
    return {
        ...base, kind: 'session',
        projectName: path.basename(base.projectRoot),
        generatedAt: base.generatedAt || null,
        activePlan: planSpec.plan, activeSpec: planSpec.spec,
        rules: RULES, risks, nextAction, freshness,
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
    let sessionstart = {};
    try { sessionstart = memoryService.inspectLocalState('sessionstart'); }
    catch (e) { degraded.push({ part: 'sessionstart', reason: e.message }); }
    let verify = {};
    try { verify = await memoryService.verify({ silent: true }); }
    catch (e) { degraded.push({ part: 'verify', reason: e.message }); }
    let recall = {};
    try { recall = await memoryService.buildTakeoverRecall(summary, verify) || {}; }
    catch (e) { degraded.push({ part: 'recall', reason: e.message }); }

    const rc = require('./takeover-receipt');
    const planSpec = derivePlanSpec(readPlanIr(base.projectRoot, degraded), base.focus);
    const metaResult = rc.readMetaAnchor(base.projectRoot);
    if (!metaResult.ok) degraded.push({ part: 'meta', reason: metaResult.reason });

    return assembleSessionContext(base, {
        summary, sessionstart, verify, recall, planSpec,
        freshness: metaResult.meta || { headSha: null, ahead: null, behind: null }, degraded,
    });
}

module.exports = { derivePlanSpec, assembleSessionContext, collectSessionTakeoverContextFull };
