'use strict';

// Chinese terminology dictionary + deterministic narrative templates
// (design §4). The narrative ONLY verbalizes ModuleProjection fields.
// Raw rule ids (Rxxx) may appear only in the collapsible tech-details area,
// never in the main narrative — listBareTerms() is the test hook for that.

const RULE_LABELS = {
    R003: '计划文档结构不完整',
    R006: '有代码变更未关联到任何任务',
    R008: '任务缺少完成证据',
    R009: '架构记录落后于代码',
    R011: '规格状态落后于计划完成度',
    R012: '当前焦点指向未真正开始的计划',
    R013: '验证契约存在缺口',
};

const HEALTH_LABELS = { normal: '正常', attention: '需要注意', risk: '存在风险' };
const ROLE_LABELS = {
    entry: '入口', service: '核心服务', feature: '功能', ui: '界面', runtime: '运行时',
    scanner: '扫描与分析', governance: '治理', docs: '文档', test: '测试', unknown: '其他',
};

// Display-only Chinese names for module ids verified against this repo's
// Architecture IR. EXACT id match only — no tokenizing, no regex guessing, no
// role substitution, no prefix matching: a child repo whose module ids differ
// simply falls back to its own module name. A project's own
// wiki-groups.moduleAliases still wins over this table. Canonical identity
// (moduleId, IR name, hrefs, edge endpoints) is never touched by this.
const DEFAULT_MODULE_LABELS = {
    'module:agents-workflow': 'Agent 与工作流',
    'module:architecture': '架构扫描',
    'module:architecture-wiki': '架构治理 Wiki',
    'module:cli-entry': 'CLI 入口',
    'module:dashboard': '仪表盘',
    'module:docs-planning': '文档与规划',
    'module:hook-scaffold': '钩子脚手架',
    'module:inspector': '检视器',
    'module:memory-service': '记忆服务',
    'module:planning': '计划扫描',
    'module:runtime': '运行时',
    'module:test': '测试',
};

function moduleLabel(moduleId, fallback) {
    return DEFAULT_MODULE_LABELS[moduleId] || fallback;
}

function translateRule(rule) {
    return RULE_LABELS[rule] || '发现一项尚未分类的治理检查';
}

function healthLabel(state) { return HEALTH_LABELS[state] || HEALTH_LABELS.normal; }

function roleLabel(role) { return ROLE_LABELS[role] || `其他(${role})`; }

function progressLabel(mp) {
    if (mp.progressState === 'unplanned') return '尚未纳入规划';
    const total = mp.taskCounts.done + mp.taskCounts.open + mp.taskCounts.unknown;
    let text = `${total} 项任务,${mp.taskCounts.done} 项已完成`;
    if (mp.taskCounts.unknown) text += `,${mp.taskCounts.unknown} 项状态未知`;
    if (mp.taskCounts.shared) text += `(含 ${mp.taskCounts.shared} 项与其他模块共享)`;
    return text;
}

// displayName is the caller-resolved display name (config alias > default label >
// IR name). It is passed in rather than read off `mp` so the projection's
// canonical `mp.name` is never rewritten for rendering.
function moduleNarrative(mp, displayName) {
    const parts = [];
    parts.push(`「${displayName || moduleLabel(mp.moduleId, mp.name)}」属于${roleLabel(mp.role)}分区,包含 ${mp.files.length} 个文件。`);
    parts.push(`进度:${progressLabel(mp)}。`);
    if (mp.healthState === 'normal') parts.push('治理健康:正常。');
    else {
        const reasons = [...new Set(mp.healthReasons.map(translateRule))].join('、');
        parts.push(`治理健康:${healthLabel(mp.healthState)} —— ${reasons}。`);
    }
    if (mp.focus) parts.push('这里是当前焦点所在的模块。');
    return parts.join(' ');
}

function listBareTerms(text) {
    return (String(text).match(/R\d{3}/g) || []);
}

module.exports = { RULE_LABELS, DEFAULT_MODULE_LABELS, moduleLabel, translateRule, healthLabel, roleLabel, progressLabel, moduleNarrative, listBareTerms };
