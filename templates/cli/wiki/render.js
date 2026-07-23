'use strict';

// Pure render layer (design §2). Input: projection facts + page map + optional
// groups config. Output: html/svg strings. NO fact computation here — only
// verbalization (via dictionary) and geometry (deterministic lane layout).

const { healthLabel, roleLabel, progressLabel, moduleNarrative, translateRule } = require('./dictionary');
const { CANONICAL_ROLES } = require('./projection');   // single source of the lane order — no local copy

const LANE_ORDER = CANONICAL_ROLES;
const CARD_W = 190, CARD_H = 64, LANE_GAP = 24, CARD_GAP = 14, LANE_HEADER = 40, PAD = 20;

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validateEdges(edges, knownModuleIds) {
    const known = new Set(knownModuleIds);
    const valid = []; const warnings = []; const seen = new Set();
    for (const e of (Array.isArray(edges) ? edges : [])) {
        if (!e || typeof e.sourceModuleId !== 'string' || typeof e.targetModuleId !== 'string') {
            warnings.push(`malformed edge ignored: ${JSON.stringify(e).slice(0, 60)}`); continue;
        }
        // optional fields are part of the schema: wrong TYPE = malformed edge
        if (e.kind !== undefined && typeof e.kind !== 'string') {
            warnings.push(`malformed edge ignored (kind must be a string): ${e.sourceModuleId} -> ${e.targetModuleId}`); continue;
        }
        if (e.confidence !== undefined && typeof e.confidence !== 'number') {
            warnings.push(`malformed edge ignored (confidence must be a number): ${e.sourceModuleId} -> ${e.targetModuleId}`); continue;
        }
        if (!known.has(e.sourceModuleId) || !known.has(e.targetModuleId)) {
            warnings.push(`edge endpoint not a known module: ${e.sourceModuleId} -> ${e.targetModuleId}`); continue;
        }
        const key = `${e.sourceModuleId}->${e.targetModuleId}#${e.kind || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push({ sourceModuleId: e.sourceModuleId, targetModuleId: e.targetModuleId, kind: e.kind || '' });
    }
    return { valid, warnings };
}

// Deterministic lanes: groups config first (its order), then canonical roles
// in LANE_ORDER. An unrecognized role KEEPS its original value and gets its
// OWN lane after the canonical ones (lexicographic) — it is never folded into
// 'unknown' (AC 6; the warning is produced by W3's buildProjection).
function computeLanes(modules, groupsConfig) {
    const lanes = []; const placed = new Set();
    if (groupsConfig && groupsConfig.groups.length) {
        for (const g of groupsConfig.groups) {
            const ms = g.moduleIds.map(id => modules.find(m => m.moduleId === id)).filter(Boolean);
            ms.forEach(m => placed.add(m.moduleId));
            lanes.push({ key: g.id, label: g.name, modules: ms });
        }
    }
    const rest = modules.filter(m => !placed.has(m.moduleId));
    const byRole = new Map();
    for (const m of rest) {
        const role = m.role || 'unknown';
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(m);
    }
    const laneLabels = (groupsConfig && groupsConfig.laneLabels) || {};
    const extraRoles = [...byRole.keys()].filter(r => !LANE_ORDER.includes(r)).sort();
    for (const role of [...LANE_ORDER, ...extraRoles]) {
        const ms = (byRole.get(role) || []).sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1));
        if (ms.length) lanes.push({ key: role, label: laneLabels[role] || roleLabel(role), modules: ms });
    }
    return lanes;
}

const HEALTH_FILL = { normal: '#e7f4e8', attention: '#fdf3d7', risk: '#fbe3e3' };

function renderSvgMap({ modules, groupsConfig, pageMap, validEdges }) {
    const lanes = computeLanes(modules, groupsConfig);
    const pos = new Map();
    let x = PAD;
    let maxRows = 1;
    for (const lane of lanes) { maxRows = Math.max(maxRows, lane.modules.length); }
    const height = LANE_HEADER + maxRows * (CARD_H + CARD_GAP) + PAD * 2;
    const parts = [];
    for (const lane of lanes) {
        parts.push(`<text x="${x}" y="${PAD + 14}" class="lane-label">${escapeHtml(lane.label)}</text>`);
        let y = PAD + LANE_HEADER;
        for (const m of lane.modules) {
            pos.set(m.moduleId, { cx: x + CARD_W / 2, cy: y + CARD_H / 2 });
            const alias = (groupsConfig && groupsConfig.moduleAliases && groupsConfig.moduleAliases[m.moduleId]) || m.name;
            const total = m.taskCounts.done + m.taskCounts.open + m.taskCounts.unknown;
            const ratio = total ? m.taskCounts.done / total : 0;
            parts.push(`<a href="${escapeHtml(pageMap.modulePage(m.moduleId))}">`
                + `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${HEALTH_FILL[m.healthState]}" stroke="#8a8a8a"/>`
                + `<text x="${x + 10}" y="${y + 22}" class="card-title">${escapeHtml(alias)}${m.focus ? ' ◎' : ''}</text>`
                + `<text x="${x + 10}" y="${y + 40}" class="card-sub">${escapeHtml(total ? `${m.taskCounts.done}/${total}` : '尚未纳入规划')}</text>`
                + `<rect x="${x + 10}" y="${y + 48}" width="${CARD_W - 20}" height="6" fill="#ddd"/>`
                + `<rect x="${x + 10}" y="${y + 48}" width="${Math.round((CARD_W - 20) * ratio)}" height="6" fill="#5a9"/>`
                + `</a>`);
            y += CARD_H + CARD_GAP;
        }
        x += CARD_W + LANE_GAP;
    }
    const edgeParts = [];
    if (validEdges && validEdges.length) {
        edgeParts.push('<defs><marker id="dep-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#666"/></marker></defs>');
        for (const e of validEdges) {
            const s = pos.get(e.sourceModuleId), t = pos.get(e.targetModuleId);
            if (!s || !t) continue;
            edgeParts.push(`<line class="dependency-edge" x1="${s.cx}" y1="${s.cy}" x2="${t.cx}" y2="${t.cy}" stroke="#666" marker-end="url(#dep-arrow)"/>`);
        }
    }
    const width = x + PAD;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + edgeParts.join('') + parts.join('') + '</svg>';
}

const CSS = `body{font-family:system-ui,'Microsoft YaHei',sans-serif;margin:24px;max-width:1100px}
.lane-label{font-weight:600;font-size:14px}.card-title{font-size:13px;font-weight:600}.card-sub{font-size:11px;fill:#555}
footer{margin-top:32px;color:#888;font-size:12px;border-top:1px solid #ddd;padding-top:8px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;font-size:13px}
.health-risk{color:#b00}.health-attention{color:#a60}.health-normal{color:#282}
.progress{height:8px;background:#ddd;border-radius:4px;max-width:420px;margin:8px 0}
.progress-fill{height:8px;background:#5a9;border-radius:4px}
nav ul{margin:4px 0 4px 18px;padding:0}nav li{font-size:13px;line-height:1.7}
.note{color:#666;font-size:13px}
details{margin-top:12px}summary{cursor:pointer;color:#666}`;

function pageChrome({ title, body, meta }) {
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
        + `<style>${CSS}</style></head><body>${body}`
        + `<footer>生成于 ${escapeHtml(meta.generatedAt)} @ ${escapeHtml(meta.headSha)}</footer></body></html>`;
}

function aliasOf(groupsConfig, moduleId, fallback) {
    return (groupsConfig && groupsConfig.moduleAliases && groupsConfig.moduleAliases[moduleId]) || fallback;
}

function renderIndex({ projection, groupsConfig, pageMap, meta }) {
    const p = projection.project;
    const totals = projection.totals;
    const totalAll = totals.taskDone + totals.taskOpen + totals.taskUnknown;

    // 1. 项目定位
    const positioning = `<p class="note">本页由 <code>mem wiki build</code> 从治理数据自动生成,`
        + `展示「${escapeHtml(meta.projectName || '')}」的模块架构、任务进展与治理健康。</p>`;

    // 2. 当前焦点(人话;unresolved → 固定文案)
    const focus = p.focus || { resolved: !!p.focusResolved, label: '', moduleIds: [] };
    const focusLine = focus.resolved
        ? `<p>当前焦点:${escapeHtml(focus.label)}${(focus.moduleIds || []).length
            ? '(位于 ' + focus.moduleIds.map(id =>
                `<a href="${escapeHtml(pageMap.modulePage(id))}">${escapeHtml(aliasOf(groupsConfig, id, id))}</a>`).join('、') + ')'
            : ''}。</p>`
        : '<p>当前焦点无法可靠定位。</p>';

    // 3. 总进度
    const progressLine = `<p>共 ${projection.modules.length} 个模块;任务 ${totalAll} 项,已完成 ${totals.taskDone} 项`
        + `${totals.taskUnknown ? `,${totals.taskUnknown} 项状态未知` : ''}。</p>`;

    // freshness 三态:任一 stale → 过期提示;全 fresh → 已确认;否则固定文案「数据新鲜度无法确认」
    const states = [p.inputFreshness.architecture.state, p.inputFreshness.planning.state];
    const fresh = states.includes('stale')
        ? '<p>数据已过期:建议重新运行 mem architecture scan / mem plan scan。</p>'
        : states.every(s => s === 'fresh') ? '<p>数据新鲜度:已确认。</p>'
        : '<p>数据新鲜度无法确认。</p>';

    // 4. ProjectHealth 人话摘要
    const healthBits = [];
    if (p.driftErrors) healthBits.push(`${p.driftErrors} 项治理错误`);
    if (p.driftWarnings) healthBits.push(`${p.driftWarnings} 项治理提醒`);
    const healthLine = `<p>治理健康:${healthBits.length ? healthBits.join(',') : '未发现需要处理的问题'}。</p>`;
    // 全局 verify 摘要(确定性;绝不用 generatedDataFresh 反推 IR freshness)
    let verifyLine = '';
    const v = p.verify;
    if (!v) verifyLine = '<p class="note">全局验证结果不可用。</p>';
    else {
        const missing = [];
        if (v.planScan && v.planScan.exists === false) missing.push('plan scan');
        if (v.architectureScan && v.architectureScan.exists === false) missing.push('architecture scan');
        if (missing.length) verifyLine = `<p>全局验证:缺少 ${missing.join(' / ')} 数据,建议先运行对应扫描。</p>`;
        else if (v.drift && v.drift.errors > 0) verifyLine = `<p>全局验证:存在 ${v.drift.errors} 项验证失败。</p>`;
        else verifyLine = '<p>全局验证:未发现失败项。</p>';
    }
    const unattributed = p.unattributedFindings.length
        ? `<p>另有 ${p.unattributedFindings.length} 项无法定位到具体模块的治理提醒(详见技术详情)。</p>` : '';
    // provider 状态是信息性文案,绝不渲染为风险(provider stale ≠ IR 不新鲜)
    let providerLine = '';
    const cp = p.codePerception;
    if (cp) {
        const ready = (cp.providers || []).filter(x => x.ready);
        if (!ready.length) providerLine = '<p class="note">结构代码情报未接入(不影响本页治理数据)。</p>';
        else if (cp.freshness && cp.freshness.stale) providerLine = '<p class="note">结构代码索引落后于最新提交(仅影响代码检索,不影响本页数据)。</p>';
    }
    const linksLine = (p.links && p.links.proposed)
        ? `<p class="note">另有 ${p.links.proposed} 项代码关联待确认。</p>` : '';

    // 5. 本页导航树(泳道 → 模块,别名优先)
    const lanes = computeLanes(projection.modules, groupsConfig);
    const nav = '<nav><h2>本页导航</h2><ul>' + lanes.map(l =>
        `<li>${escapeHtml(l.label)}<ul>` + l.modules.map(m =>
            `<li><a href="${escapeHtml(pageMap.modulePage(m.moduleId))}">${escapeHtml(aliasOf(groupsConfig, m.moduleId, m.name))}</a></li>`).join('')
        + '</ul></li>').join('') + '</ul></nav>';

    const body = `<h1>${escapeHtml(meta.projectName || '')} 项目全貌</h1>`
        + positioning + focusLine + progressLine + fresh
        + healthLine + verifyLine + unattributed + providerLine + linksLine
        + nav
        + renderSvgMap({ modules: projection.modules, groupsConfig, pageMap, validEdges: projection.validEdges || [] })
        + `<details><summary>技术详情</summary><pre>${escapeHtml(JSON.stringify(p, null, 2))}</pre></details>`;
    return pageChrome({ title: '项目全貌 — Evo-Lite Wiki', body, meta });
}

function renderModulePage({ mp, pageMap, meta, sourcePageFor, groupsConfig }) {
    const alias = aliasOf(groupsConfig, mp.moduleId, mp.name);
    const rows = mp.files.map(f => {
        const target = sourcePageFor(f);
        const cell = target.page ? `<a href="../${escapeHtml(target.page)}">${escapeHtml(f)}</a>`
            : `${escapeHtml(f)} <em>(源码页未生成:${escapeHtml(target.reason)})</em>`;
        return `<tr><td>${cell}</td></tr>`;
    }).join('');
    const taskRows = mp.tasks.map(t =>
        `<tr><td>${escapeHtml(t.title)}</td><td>${t.completion === 'done' ? '已完成' : t.completion === 'open' ? '进行中' : '状态未知'}${t.shared ? '(共享任务)' : ''}</td></tr>`).join('');
    const total = mp.taskCounts.done + mp.taskCounts.open + mp.taskCounts.unknown;
    const pct = total ? Math.round((mp.taskCounts.done / total) * 100) : 0;
    const progressBar = `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;
    const commits = mp.recentCommits.map(c =>
        `<li><code>${escapeHtml(c.sha.slice(0, 7))}</code> ${escapeHtml(c.subject)}`
        + `${(c.files && c.files.length) ? ' —— 涉及:' + c.files.map(f => escapeHtml(f)).join('、') : ''}</li>`).join('');
    const body = `<h1>${escapeHtml(alias)}</h1>`
        + `<p>${escapeHtml(moduleNarrative(mp))}</p>`
        + (mp.description ? `<p><em>${escapeHtml(mp.description)}</em></p>` : '')
        + `<h2>任务(${progressLabel(mp)})</h2>` + progressBar
        + `<table>${taskRows || '<tr><td>尚未纳入规划</td></tr>'}</table>`
        + `<h2>文件</h2><table>${rows}</table>`
        + (commits ? `<h2>最近变更</h2><ul>${commits}</ul>` : '')
        + `<details><summary>技术详情</summary><pre>${escapeHtml(JSON.stringify({ moduleId: mp.moduleId, role: mp.role, healthReasons: mp.healthReasons }, null, 2))}</pre></details>`
        + `<p><a href="../index.html">← 返回项目全貌</a></p>`;
    return pageChrome({ title: `${alias} — Evo-Lite Wiki`, body, meta });
}

module.exports = { escapeHtml, validateEdges, computeLanes, renderSvgMap, renderIndex, renderModulePage, pageChrome };
