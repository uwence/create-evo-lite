'use strict';
// ATTP host-agnostic 纯函数 builder + 两个 discriminated validator。严禁 IO / env / hook input。
const SCHEMA_VERSION = 1;
const CAPSULE_BUDGET_BYTES = 1024;
const TRANSITION_TO_EVOLITE = {
    active: 'takeover-active', refreshed: 'takeover-refreshed', stale: 'takeover-stale', degraded: 'takeover-degraded',
};
const EVOLITE_VALUES = new Set(Object.values(TRANSITION_TO_EVOLITE));
const CAPSULE_FIXED_KEYS = ['evoLite', 'project', 'receipt', 'focusHash'];

const bytes = (obj) => Buffer.byteLength(JSON.stringify(obj), 'utf8');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function buildSessionPayload(ctx) {
    return {
        schemaVersion: SCHEMA_VERSION,
        host: ctx.host,
        generatedAt: ctx.generatedAt || null,
        sourceEvent: ctx.sourceEvent,
        project: { name: ctx.projectName, root: ctx.projectRoot },
        focus: { text: ctx.focus, hash: ctx.focusHash || null, updatedAt: ctx.focusUpdatedAt || null },
        active: { plan: ctx.activePlan || null, spec: ctx.activeSpec || null },
        rules: ctx.rules,
        risks: ctx.risks,
        nextAction: ctx.nextAction,
        // Two sources, then the relation between them. `freshness` deliberately
        // carries no sha: it describes how the recorded snapshot stands against
        // live git, and never stands in for either.
        contextSnapshot: ctx.contextSnapshot,
        git: ctx.git,
        freshness: ctx.freshness,
        health: ctx.health,
        verify: ctx.verify,
        recall: ctx.recall,
        degraded: ctx.degraded,
    };
}

const TAKEOVER_HEALTH = new Set(['ready', 'bootstrap-pending', 'attention-needed']);
// ahead/behind 是提交计数:null 或非负整数(NaN / 负数 / 小数一律非法)
const countOrNull = (v) => v === null || (Number.isInteger(v) && v >= 0);
// 三态:true / false / 'unknown'。'unknown' 是一个答案(探测不到),
// 不是 false 的委婉说法。
const TRISTATE = new Set([true, false, 'unknown']);
const HEAD_RELATIONS = new Set(['same', 'ancestor', 'diverged', 'unknown']);

// active.plan / active.spec:只能是 null 或约定对象(id 必须是非空字符串)
function badActiveEntry(entry, extraKeys) {
    if (entry === null) return false;
    if (!isObj(entry)) return true;
    if (typeof entry.id !== 'string' || !entry.id) return true;
    for (const k of extraKeys) if (k in entry && entry[k] !== null && typeof entry[k] !== 'string') return true;
    return false;
}

function validateSessionPayload(payload) {
    const errors = [];
    if (!isObj(payload)) return { ok: false, errors: ['not-object'] };
    if (payload.schemaVersion !== SCHEMA_VERSION) errors.push('schema-version');
    for (const f of ['host', 'sourceEvent', 'nextAction']) {
        if (typeof payload[f] !== 'string' || !payload[f]) errors.push(`missing-${f}`);
    }
    if (!isObj(payload.project) || typeof payload.project.name !== 'string' || !payload.project.name
        || typeof payload.project.root !== 'string' || !payload.project.root) errors.push('bad-project');
    if (!isObj(payload.focus) || typeof payload.focus.text !== 'string'
        || !(payload.focus.hash === null || typeof payload.focus.hash === 'string')) errors.push('bad-focus');
    // active:深校验,不只查键存在
    if (!isObj(payload.active)) errors.push('bad-active');
    else {
        if (badActiveEntry(payload.active.plan, ['title', 'status', 'progress'])) errors.push('bad-active-plan');
        if (badActiveEntry(payload.active.spec, ['title', 'status'])) errors.push('bad-active-spec');
    }
    if (!isObj(payload.rules) || typeof payload.rules.dir !== 'string' || !Array.isArray(payload.rules.required)
        || payload.rules.required.some(r => typeof r !== 'string')) errors.push('bad-rules');
    if (!Array.isArray(payload.risks) || payload.risks.some(r => typeof r !== 'string')) errors.push('bad-risks');
    // contextSnapshot / git:两个来源,同一形状。计数必须是非负整数或 null
    // (NaN / 负数 / 小数不得穿过)。
    for (const source of ['contextSnapshot', 'git']) {
        const value = payload[source];
        if (!isObj(value)) { errors.push(`bad-${source}`); continue; }
        for (const k of ['headSha', 'ahead', 'behind']) if (!(k in value)) errors.push(`bad-${source}-${k}`);
        if (!(value.headSha === null || typeof value.headSha === 'string')) errors.push(`bad-${source}-headSha`);
        if (!countOrNull(value.ahead) || !countOrNull(value.behind)) errors.push(`bad-${source}-counts`);
    }
    // freshness:只描述【关系】。它不得携带 sha —— 一旦携带,快照就又能冒充当前状态,
    // 而这正是本字段被重新定义的原因。
    if (!isObj(payload.freshness)) errors.push('bad-freshness');
    else {
        if ('headSha' in payload.freshness) errors.push('bad-freshness-carries-sha');
        for (const k of ['inSync', 'headRelation', 'countDrift']) {
            if (!(k in payload.freshness)) errors.push(`bad-freshness-${k}`);
        }
        if (!TRISTATE.has(payload.freshness.inSync)) errors.push('bad-freshness-inSync');
        if (!HEAD_RELATIONS.has(payload.freshness.headRelation)) errors.push('bad-freshness-headRelation');
        if (!TRISTATE.has(payload.freshness.countDrift)) errors.push('bad-freshness-countDrift');
    }
    // health.takeover:枚举
    if (!isObj(payload.health) || !TAKEOVER_HEALTH.has(payload.health.takeover)) errors.push('bad-health');
    else if (typeof payload.health.contextStatus !== 'string' || typeof payload.health.architectureStatus !== 'string') errors.push('bad-health-status');
    // verify / recall:承重字段
    if (!isObj(payload.verify) || typeof payload.verify.hasAlerts !== 'boolean') errors.push('bad-verify');
    if (!isObj(payload.recall) || typeof payload.recall.status !== 'string') errors.push('bad-recall');
    // degraded[]:每项 {part,reason} 均为字符串
    if (!Array.isArray(payload.degraded)) errors.push('bad-degraded');
    else if (payload.degraded.some(d => !isObj(d) || typeof d.part !== 'string' || typeof d.reason !== 'string')) errors.push('bad-degraded-entry');
    return { ok: errors.length === 0, errors };
}

function validateCapsule(capsule, budget = CAPSULE_BUDGET_BYTES) {
    const errors = [];
    if (!isObj(capsule)) return { ok: false, errors: ['not-object'] };
    for (const k of CAPSULE_FIXED_KEYS) if (!(k in capsule)) errors.push(`missing-${k}`);
    if (!EVOLITE_VALUES.has(capsule.evoLite)) errors.push('bad-evoLite');
    if (capsule.receipt !== 'valid' && capsule.receipt !== 'invalid') errors.push('bad-receipt');
    if (typeof capsule.project !== 'string') errors.push('bad-project');
    if (!(capsule.focusHash === null || typeof capsule.focusHash === 'string')) errors.push('bad-focusHash');
    if (bytes(capsule) > budget) errors.push('over-budget');
    return { ok: errors.length === 0, errors };
}

// 按 Unicode code point 边界截断到 maxBytes 的 UTF-8 字节内
function truncateToBytes(text, maxBytes) {
    if (maxBytes <= 0) return { text: '', truncated: true };
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
    let out = '';
    for (const ch of Array.from(text)) {
        if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
        out += ch;
    }
    return { text: out, truncated: true };
}

function buildCapsule(ctx, budget) {
    const evoLite = TRANSITION_TO_EVOLITE[ctx.receiptVerdict.transition] || 'takeover-degraded';
    const receipt = ctx.receiptVerdict.state === 'committed' ? 'valid' : 'invalid';
    const anomaly = evoLite === 'takeover-stale' || evoLite === 'takeover-degraded';
    const focusText = ctx.focus == null ? 'unknown' : String(ctx.focus);
    const fixed = { evoLite, project: ctx.projectName || 'unknown', receipt, focusHash: ctx.focusHash || null };
    if (ctx.receiptVerdict.reason) fixed.reason = ctx.receiptVerdict.reason;
    const action = anomaly && ctx.recoveryAction ? String(ctx.recoveryAction) : null;

    // 1) focus 全量 + action
    const full = { ...fixed, focus: focusText }; if (action) full.action = action;
    if (bytes(full) <= budget) return full;
    // 2) 裁剪 focus(保留 action)
    const shell = { ...fixed, focus: '', truncated: true }; if (action) shell.action = action;
    const room = budget - bytes(shell);
    if (room > 0) {
        const cut = truncateToBytes(focusText, room);
        const o = { ...fixed, focus: cut.text }; if (cut.truncated) o.truncated = true; if (action) o.action = action;
        if (bytes(o) <= budget) return o;
    }
    // 3) 省略 action,仅保 focus 截断
    const noAction = { ...fixed, focus: '', truncated: true };
    if (bytes(noAction) <= budget) return noAction;
    // 4) 最终回退:固定短 degraded capsule(固定字段齐全,尽量保留真实 focusHash —— 16 字符成本极低)
    return { evoLite: 'takeover-degraded', project: 'unknown', receipt: 'invalid',
        focusHash: ctx.focusHash || null, reason: 'capsule-budget-exceeded' };
}

// ── emergency capsule:正常 builder 已失败时的独立降级路径 ──
// 契约:恒 ≤ budget、恒过 validateCapsule、不依赖 buildCapsule;恢复命令只整条带上或整条省略
// (截断的 shell 命令比没有命令更危险),省略时由 systemMessage 承载完整命令。
const EMERGENCY_FLOOR = Object.freeze({ evoLite: 'takeover-degraded', project: 'unknown',
    receipt: 'invalid', focusHash: null, reason: 'capsule-invalid' });
const EMERGENCY_FLOOR_BYTES = bytes(EMERGENCY_FLOOR);
const PROJECT_NAME_MAX_BYTES = 40;

function buildEmergencyCapsule(input, budget = CAPSULE_BUDGET_BYTES) {
    if (budget < EMERGENCY_FLOOR_BYTES) throw new Error('takeover: emergency budget below floor');
    const src = isObj(input) ? input : {};
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const reason = str(src.reason) || 'capsule-invalid';
    const action = str(src.recoveryAction);
    const hash = str(src.focusHash);
    const name = str(src.projectName) || 'unknown';
    const shortName = truncateToBytes(name, PROJECT_NAME_MAX_BYTES).text || 'unknown';
    const mk = (p, h, r, withAction) => {
        const c = { evoLite: 'takeover-degraded', project: p, receipt: 'invalid', focusHash: h, reason: r };
        if (withAction) c.action = action;
        return c;
    };
    // 确定性阶梯:每级更小,最后一级是常量地板。focusHash(16 字符)比长 project 名更有价值 → 先裁 project。
    const ladder = [];
    if (action) ladder.push(mk(name, hash, reason, true));
    ladder.push(mk(name, hash, reason, false));
    ladder.push(mk(shortName, hash, reason, false));
    ladder.push(mk(shortName, null, reason, false));
    ladder.push(mk('unknown', null, reason, false));
    ladder.push({ ...EMERGENCY_FLOOR });
    for (const capsule of ladder) {
        if (bytes(capsule) <= budget && validateCapsule(capsule, budget).ok) {
            const systemMessage = action && !('action' in capsule)
                ? `evo-lite takeover degraded (${reason}). Recovery command: ${action}`
                : null;
            return { capsule, systemMessage };
        }
    }
    /* istanbul ignore next */ // 不可达:地板恒 ≤ budget(入口已断言)
    throw new Error('takeover: emergency capsule ladder exhausted');
}

function buildTakeoverPayload(context, budget = CAPSULE_BUDGET_BYTES) {
    if (!isObj(context)) throw new Error('takeover: context required');
    if (context.kind === 'session') return buildSessionPayload(context);
    if (context.kind === 'refresh') {
        const capsule = buildCapsule(context, budget);
        if (bytes(capsule) > budget) throw new Error('takeover: capsule exceeds budget after trim');
        return capsule;
    }
    throw new Error(`takeover: unknown context.kind ${context.kind}`);
}

module.exports = {
    buildTakeoverPayload, buildEmergencyCapsule, validateSessionPayload, validateCapsule,
    SCHEMA_VERSION, CAPSULE_BUDGET_BYTES, EMERGENCY_FLOOR_BYTES, TRANSITION_TO_EVOLITE,
};
