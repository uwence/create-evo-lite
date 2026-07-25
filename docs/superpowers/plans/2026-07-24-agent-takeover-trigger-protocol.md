# Agent Takeover Trigger Protocol Implementation Plan (R3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让裸 prompt 下的 Claude Code Agent 无需用户提醒即确定性地进入 Evo-Lite 项目接管,并在无有效接管上下文时对 Edit/Write fail-closed。

**Architecture:** 三层协议 —— ①host-agnostic 纯函数 builder(`takeover-payload.js`)+ 两个 discriminated validator;②Claude Code 生命周期 adapter(`takeover-adapter.js`);③PreToolUse fail-closed 守卫。**三条入口(`mem bootstrap` / SessionStart hook / CLI recovery)统一经单一 collector `collectSessionTakeoverContextFull`(`takeover-session.js`)→ `buildTakeoverPayload` → `validateSessionPayload` → 各自 transport**。receipt(`takeover-receipt.js`)session-scoped、ordered publication、硬字段 fail-closed。

**Tech Stack:** Node.js (CommonJS), commander, Claude Code hooks(`hookSpecificOutput.additionalContext` / `permissionDecision` / `${CLAUDE_PROJECT_DIR}`), 现有 `test/harness.js` + assert 骨架。

**契约文档(canonical):** `docs/superpowers/specs/2026-07-24-agent-takeover-trigger-protocol-design.md`(R5 APPROVED)。**probe:** `docs/validation/attp-cc-capability-probe.md`(2.1.218)。

**计划 R1/R2 外部复审(各 5 P0 + 5 P1)已折入**,逐条见文末《复审落点》。

## 已核实的代码事实(实现须以此为准,勿再猜测)

- `runtime.js`:`getRuntimeRoot()` 用 **`EVO_LITE_ROOT`**(非 `EVO_LITE_WORKSPACE_ROOT`),否则 `path.resolve(__dirname,'..')`;`getWorkspaceRoot()=resolve(runtimeRoot,'..')`;`getActiveContextPath()=join(runtimeRoot,'active_context.md')`(绑运行时根,**不随传入 projectRoot 切换**)。
- `memory.service.summarizeActiveContext()` 返回 **`{path, focus, activeTasks, latestTrajectory, trajectoryCount, validation}`** —— **无 `activePlan`/`activeSpec`/`freshness`**。
- `memory.service.inspectLocalState('sessionstart')` 返回含 `focus, activeTaskCount, contextStatus, architectureStatus, reminders[], warnings[]`。
- `memory.service.verify({silent:true})` 返回含 `hasAlerts, git, templateSync, localEngine, entityStore, nextSteps[]`。
- `memory.service.buildTakeoverRecall(summary, verify)` 返回 **对象** `{status, effect, queries[], hits[], reflections[]}`(非数组)。
- `memory.js:runBootstrapCommand` 现调 `await bootstrap()`(=`initDB()`)后才用 memory.service;`formatBootstrapReport(payload)` 现消费 `{context, sessionstart, verify, takeoverRecall}`。
- `.evo-lite/generated/planning/plan-ir.json`:`{version, generatedAt, project, sources, specs[], plans[], tasks[], warnings[]}`;plan 字段 `{id,title,status,sourcePath,linkedSpec,r008Exempt,taskIds}`;spec 字段 `{id,title,status,sourcePath,linkedPlans,acceptanceCriteria}`;**plan.status 取值仅 `done|parked|draft`(无 `active`)** → activePlan **不得**按 `status==='active'` 过滤。
- `templates/cli/test/integration.js:420-428` 有 manifest 覆盖守卫 `required` 数组(末项 `'memory-index-lock.js',`)。
- `templates/cli/sync-runtime-entry.js` 存在(sync 入口)。
- `active_context.md` 锚点:`BEGIN_META/END_META`(含 `headSha/upstreamSha/ahead/behind`)、`BEGIN_FOCUS/END_FOCUS`。

## Global Constraints

- **宿主范围:** 仅 Claude Code(MVP);非 Claude 宿主只静态 fallback。
- **单一 collector + 单一 builder + 强制校验:** 三条入口全部 `collectSessionTakeoverContextFull(...)` → `buildTakeoverPayload(...)` → **`validateSessionPayload(...)` 通过后才 transport**;禁止任何入口自拼语义或硬编码 `verify:null`/`recall:[]`。
- **失败不可静默:** 承重字段获取失败**禁止空 catch 变 null**。**可恢复**失败(verify/recall/plan-ir/meta)→ 记入 `payload.degraded[]` 结构化状态并 `health.takeover='attention-needed'`,仍交付;**不可恢复**失败(focus 不可读、initDB/memory.service 加载失败、payload 校验不过)→ establishment 失败、**不发布 receipt**、非零退出。
- **项目根严格 fail-closed:** `discoverProjectRoot(startDir)` 向上找最近含 `.evo-lite/` 的祖先,**找不到即抛错**;`canonicalProjectRoot` **不得**退回 `path.resolve(base)`。scaffold 场景不复用此函数。
- **receipt 路径 project-bound:** 所有 receipt API 取 canonical `projectRoot`,内部计算 `<projectRoot>/.evo-lite/generated/takeover/receipts/<host>/<sha256(host\0sessionId)>.json`;`readFocusAnchor`/`readMetaAnchor` 直接读 `<projectRoot>/.evo-lite/active_context.md`(**不**用 `getActiveContextPath()`)。gitignore、不入模板真相源、不提交;temp+rename 原子。
- **ordered publication(先确认交付、后授权、不吞错):** 两条 transport 共用 `writeAllSync(fd, text)`(**循环处理 partial write,确认全部 UTF-8 字节写出**)→ 成功后才 `publishReceipt` → 写失败**不 publish**;publish 失败**显式输出 stderr 且返回非零**;发布后无可失败业务操作。CLI recovery **先输出 payload、后发布授权**,不得在发布前打印完成态文案。
- **硬有效性:** `state==="committed"` 且 `schemaVersion`+`host`+`sessionId`+`projectRoot` 全匹配且文件可解析;否则 invalid。软字段不参与 fail-closed。
- **establishment vs refresh 由 receipt 存在性判定,非 `SessionStart.source`。**
- **不变量 6(refresh 隔离):** refresh call graph(UserPromptSubmit / reconcile / readReceipt / readFocusAnchor / 守卫 health gate)**禁载** `memory.service`/`db`/memory-index/zvec/`takeover-session`;collector 仅在 session 路径 lazy require。
- **capsule 预算:** 量最终注入的 additionalContext UTF-8 字节,硬上限 **1 KiB**;序列化后循环裁剪 + 最终硬断言;固定字段 `evoLite`/`project`/`receipt`/**`focusHash`(可为 null 但键必存)**永不删除;先裁 `focus`,再缩减/省略 `action`,最后回退固定短 degraded capsule(仍含 `focusHash:null`);Unicode code point 边界截断。健康 capsule 不含 `action`/`refresh`。
- **守卫(阶段2):** Edit/Write allow ⟺ committed receipt + reconcile 非 degraded + **`buildTakeoverPayload(refresh)` → `validateCapsule` → 字节预算** 全过 + target-path 落 receipt.projectRoot 内;**target 缺失/非字符串/解析失败 → deny**。Read/Glob/Grep/Bash → allow;**MVP 守卫工具集仅 `Edit`/`Write`**。
- **hook 启动命令:** `node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"`;**installer 事务化:先 probe 候选配置可用,通过才原子替换 settings,失败保留原文件**。
- **installer:** 幂等 deep-merge,保留未知字段/第三方 hooks;`install` 与 `status` 遇损坏 JSON **均 fail loudly、不覆盖、不静默降级**;正式 CLI `mem takeover install|status`。
- **可注入 seam(测试用,前缀 `__`):** `takeover-receipt.__setFsOps/__resetFsOps`;transport `{ write }`;adapter `deps.{collect,buildPayload,validate}`。生产路径默认真实实现。
- **镜像:** 新文件落 `templates/cli/**`;不手改 `.evo-lite/cli/**`;`node templates/cli/sync-runtime-entry.js` 后 `git add` 镜像;二次运行 `copied: 0`。
- **两阶段两复审门:** 阶段1(Task 1–6)复审门批准后才进阶段2(Task 7–8);每任务 SDD 独立复审。
- **语言:** 用户可见中文;代码标识符/日志英文。commit trailer:`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

# 阶段 1 —— 确定性接管(复审门 1:P0 determinism)

## Task 1: 纯函数 builder + 两个 discriminated validator(`takeover-payload.js`)

**Files:**
- Create: `templates/cli/takeover-payload.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-payload`、`T-takeover-capsule-states`)

**Interfaces:**
- Produces:
  - `buildTakeoverPayload(context, budget?)` → `TakeoverPayload`(`kind:'session'`)| `Capsule`(`kind:'refresh'`,序列化后硬保证 ≤ budget)
  - `validateSessionPayload(payload)` → `{ ok, errors[] }`(**完整 session schema**:顶层字段 + `project/focus/active/rules/health` 对象形状 + `risks/degraded/recall` 类型)
  - `validateCapsule(capsule, budget)` → `{ ok, errors[] }`(capsule 专用:`evoLite` 枚举、`receipt` 枚举、固定键存在、字节 ≤ budget)
  - `SCHEMA_VERSION=1`、`CAPSULE_BUDGET_BYTES=1024`、`TRANSITION_TO_EVOLITE`
- 纯函数:无 `require('fs')`、无 `require('./memory.service')`、无 `process.env`、无 hook input。

- [ ] **Step 1: 写失败测试(payload 全字段 + 两个 validator)**

在 `templates/cli/test/governance.js` 的 `runGovernanceTests()` try 块内新增:

```javascript
console.log('T-takeover-payload. Pure builder + discriminated validators ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const sessionCtx = {
        kind: 'session', host: 'claude-code', sessionId: 's1', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'SessionStart:startup', generatedAt: '2026-07-24T00:00:00.000Z',
        focus: 'FOCUS-LINE', focusHash: 'h',
        activePlan: { id: 'plan:x', status: 'draft', progress: '1/3' }, activeSpec: { id: 'spec:x', status: 'draft' },
        rules: { dir: '.agents/rules/', required: ['evo-lite'] }, risks: ['r1'], nextAction: 'do x',
        freshness: { ahead: 0, behind: 0, headSha: 'abc' },
        health: { takeover: 'ready', contextStatus: 'configured', architectureStatus: 'configured', activeTaskCount: 3 },
        verify: { hasAlerts: false, git: 'clean' }, recall: { status: 'hit', hits: [] }, degraded: [],
    };
    const payload = tp.buildTakeoverPayload(sessionCtx);
    assert.strictEqual(payload.schemaVersion, 1);
    assert.strictEqual(payload.project.name, 'proj');
    assert.strictEqual(payload.focus.text, 'FOCUS-LINE');
    assert.strictEqual(payload.active.plan.id, 'plan:x');
    assert.strictEqual(payload.active.spec.id, 'spec:x');
    assert.strictEqual(payload.freshness.headSha, 'abc');
    assert.strictEqual(payload.health.takeover, 'ready');
    assert.strictEqual(payload.verify.git, 'clean');
    assert.strictEqual(payload.recall.status, 'hit');
    assert.strictEqual(tp.validateSessionPayload(payload).ok, true, 'full payload passes');

    // 完整 schema:缺 active / verify / health / freshness 均须失败(不只查六个顶层字段)
    for (const drop of ['active', 'verify', 'health', 'freshness', 'recall', 'degraded']) {
        const bad = JSON.parse(JSON.stringify(payload)); delete bad[drop];
        assert.strictEqual(tp.validateSessionPayload(bad).ok, false, `missing ${drop} must fail`);
    }
    const badType = JSON.parse(JSON.stringify(payload)); badType.risks = 'not-array';
    assert.strictEqual(tp.validateSessionPayload(badType).ok, false, 'risks must be array');
    const badProject = JSON.parse(JSON.stringify(payload)); badProject.project = { name: 'x' }; // 缺 root
    assert.strictEqual(tp.validateSessionPayload(badProject).ok, false, 'project.root required');

    // capsule validator 是 capsule 专用,session validator 不可复用
    const capsule = tp.buildTakeoverPayload({
        kind: 'refresh', host: 'claude-code', sessionId: 's1', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus: 'FOCUS-LINE', focusHash: 'h1',
        receiptVerdict: { state: 'committed', transition: 'active', reason: null }, recoveryAction: null,
    }, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(capsule.evoLite, 'takeover-active');
    assert.strictEqual(capsule.receipt, 'valid');
    assert.ok(!('action' in capsule) && !('refresh' in capsule), 'healthy capsule reflective only');
    assert.strictEqual(tp.validateCapsule(capsule, tp.CAPSULE_BUDGET_BYTES).ok, true);
    assert.strictEqual(tp.validateCapsule({ unexpected: true }, tp.CAPSULE_BUDGET_BYTES).ok, false, 'junk object rejected');
    assert.strictEqual(tp.validateCapsule({ evoLite: 'nope', project: 'p', receipt: 'valid', focusHash: null }, 1024).ok, false, 'bad evoLite enum rejected');
    assert.strictEqual(tp.validateCapsule(capsule, 5).ok, false, 'over-budget rejected');
    console.log('✅ T-takeover-payload passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-payload.js'`。

- [ ] **Step 3: 实现 `takeover-payload.js`**

```javascript
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
        freshness: ctx.freshness,
        health: ctx.health,
        verify: ctx.verify,
        recall: ctx.recall,
        degraded: ctx.degraded,
    };
}

function validateSessionPayload(payload) {
    const errors = [];
    if (!isObj(payload)) return { ok: false, errors: ['not-object'] };
    if (payload.schemaVersion !== SCHEMA_VERSION) errors.push('schema-version');
    for (const f of ['host', 'sourceEvent', 'nextAction']) {
        if (typeof payload[f] !== 'string' || !payload[f]) errors.push(`missing-${f}`);
    }
    if (!isObj(payload.project) || typeof payload.project.name !== 'string' || typeof payload.project.root !== 'string') errors.push('bad-project');
    if (!isObj(payload.focus) || typeof payload.focus.text !== 'string') errors.push('bad-focus');
    if (!isObj(payload.active) || !('plan' in payload.active) || !('spec' in payload.active)) errors.push('bad-active');
    if (!isObj(payload.rules) || typeof payload.rules.dir !== 'string' || !Array.isArray(payload.rules.required)) errors.push('bad-rules');
    if (!Array.isArray(payload.risks)) errors.push('bad-risks');
    if (!isObj(payload.freshness)) errors.push('bad-freshness');
    if (!isObj(payload.health) || typeof payload.health.takeover !== 'string') errors.push('bad-health');
    if (!isObj(payload.verify)) errors.push('bad-verify');
    if (!isObj(payload.recall)) errors.push('bad-recall');
    if (!Array.isArray(payload.degraded)) errors.push('bad-degraded');
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
    const shell = { ...fixed, focus: '' }; if (action) shell.action = action;
    const room = budget - bytes(shell);
    if (room > 0) {
        const cut = truncateToBytes(focusText, room);
        const o = { ...fixed, focus: cut.text }; if (cut.truncated) o.truncated = true; if (action) o.action = action;
        if (bytes(o) <= budget) return o;
    }
    // 3) 省略 action,仅保 focus 截断
    const noAction = { ...fixed, focus: '', truncated: true };
    if (bytes(noAction) <= budget) return noAction;
    // 4) 最终回退:固定短 degraded capsule(固定字段齐全,focusHash 键保留)
    return { evoLite: 'takeover-degraded', project: 'unknown', receipt: 'invalid', focusHash: null, reason: 'capsule-budget-exceeded' };
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
    buildTakeoverPayload, validateSessionPayload, validateCapsule,
    SCHEMA_VERSION, CAPSULE_BUDGET_BYTES, TRANSITION_TO_EVOLITE,
};
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-payload passed`。

- [ ] **Step 5: 写状态映射 + 预算硬保证测试**

```javascript
console.log('T-takeover-capsule-states. transitions + budget always <= 1 KiB with fixed keys ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const mk = (transition, state, reason, action, focus) => tp.buildTakeoverPayload({
        kind: 'refresh', host: 'claude-code', sessionId: 's', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus, focusHash: 'h',
        receiptVerdict: { state, transition, reason }, recoveryAction: action,
    }, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(mk('active', 'committed', null, null, 'F').evoLite, 'takeover-active');
    assert.strictEqual(mk('refreshed', 'committed', null, null, 'F').evoLite, 'takeover-refreshed');
    const stale = mk('stale', 'invalid', null, 'RC', 'F');
    assert.strictEqual(stale.receipt, 'invalid');
    assert.strictEqual(stale.action, 'RC');
    const trimmed = mk('active', 'committed', null, null, '焦'.repeat(5000));
    assert.ok(Buffer.byteLength(JSON.stringify(trimmed), 'utf8') <= 1024);
    assert.strictEqual(trimmed.truncated, true);
    assert.strictEqual(trimmed.focusHash, 'h', 'focusHash preserved when focus trimmed');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(trimmed)));
    // 超长 action + 超长 focus → 仍 ≤ budget,且固定键(含 focusHash)齐全
    const hard = mk('stale', 'invalid', 'r', 'node ' + 'x'.repeat(4000), 'F'.repeat(4000));
    assert.ok(Buffer.byteLength(JSON.stringify(hard), 'utf8') <= 1024, 'oversized action stays within budget');
    for (const k of ['evoLite', 'project', 'receipt', 'focusHash']) {
        assert.ok(k in hard, `fixed key ${k} never dropped (even in fallback)`);
    }
    assert.strictEqual(tp.validateCapsule(hard, 1024).ok, true, 'fallback capsule still valid');
    console.log('✅ T-takeover-capsule-states passed');
}
```

- [ ] **Step 6: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-capsule-states passed`。

- [ ] **Step 7: 提交**

```bash
git add templates/cli/takeover-payload.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): pure-function builder + session/capsule discriminated validators + budget guarantee

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: receipt 层(`takeover-receipt.js`)—— 严格根发现 / project-bound 路径 / 有效性 / reconcile / 失效事务 / fs seam

**Files:**
- Create: `templates/cli/takeover-receipt.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-receipt`、`T-takeover-projectroot`、`T-takeover-reconcile`、`T-takeover-degraded`)

**Interfaces:**
- Consumes: `require('./runtime')` 的 `getWorkspaceRoot`(轻量,不载 db)。
- Produces:
  - `discoverProjectRoot(startDir)` → string(向上找最近含 `.evo-lite/` 的祖先;**找不到抛错**)
  - `canonicalProjectRoot(startDir?)` → string(**严格**:discover → realpath → win 规范化;不 fail-open)
  - `evoLiteDir(projectRoot)`、`receiptPathFor(projectRoot, host, sessionId)`
  - `readFocusAnchor(projectRoot)` → `{ text, hash } | null`
  - `readMetaAnchor(projectRoot)` → `{ headSha, upstreamSha, ahead, behind } | null`(供 freshness)
  - `publishReceipt(projectRoot, receiptObj)`、`readReceipt(projectRoot, host, sessionId)`、`invalidateReceipt(...)`、`reconcile({projectRoot, host, sessionId})`
  - `RECEIPT_SCHEMA_VERSION=1`、`__setFsOps(overrides)` / `__resetFsOps()`(**测试 seam**)
- **不载** `memory.service`/`db`/memory-index/zvec。

- [ ] **Step 1: 写失败测试(严格根发现 + project-bound + 硬有效性)**

```javascript
console.log('T-takeover-receipt / T-takeover-projectroot. strict root discovery + project-bound receipts ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const crypto = require('crypto');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-rc-'));
    fs.mkdirSync(path.join(root, '.evo-lite'), { recursive: true });
    const host = 'claude-code', sid = 's/1:weird';

    // 严格根发现:嵌套子目录向上找到 root;无 .evo-lite 的目录必须抛错(不 fail-open)
    const deep = path.join(root, 'src', 'a'); fs.mkdirSync(deep, { recursive: true });
    assert.strictEqual(rc.discoverProjectRoot(deep), path.resolve(root), 'walks up to .evo-lite');
    assert.strictEqual(rc.canonicalProjectRoot(deep), rc.canonicalProjectRoot(root), 'canonical stable across nested cwd');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-bare-'));
    assert.throws(() => rc.discoverProjectRoot(bare), /no .evo-lite|not an evo-lite/i, 'non-project dir throws');
    assert.throws(() => rc.canonicalProjectRoot(bare), /no .evo-lite|not an evo-lite/i, 'canonicalProjectRoot fail-closed');
    assert.strictEqual(fs.existsSync(path.join(bare, '.evo-lite')), false, 'never creates .evo-lite in a bare dir');
    fs.rmSync(bare, { recursive: true, force: true });
    console.log('✅ T-takeover-projectroot passed');

    const canon = rc.canonicalProjectRoot(root);
    const expect = crypto.createHash('sha256').update(`${host}\0${sid}`).digest('hex');
    const rp = rc.receiptPathFor(root, host, sid);
    assert.ok(rp.includes(`${expect}.json`), 'filename = sha256(host\\0sid)');
    assert.ok(rp.replace(/\\/g, '/').includes('/.evo-lite/generated/takeover/receipts/claude-code/'), 'project-bound path');

    rc.publishReceipt(root, { schemaVersion: 1, host, sessionId: sid, projectRoot: canon, state: 'committed', focusHash: 'h', sourceEvent: 'x' });
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'committed');
    rc.publishReceipt(root, { schemaVersion: 1, host, sessionId: sid, projectRoot: '/wrong', state: 'committed', focusHash: 'h' });
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'invalid', 'projectRoot mismatch → invalid');
    assert.strictEqual(rc.readReceipt(root, host, 'nope').state, 'missing');
    fs.writeFileSync(rc.receiptPathFor(root, host, sid), 'x', 'utf8');
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'invalid', 'corrupt → invalid');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-receipt passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-receipt.js`**

```javascript
'use strict';
// ATTP receipt IO / 严格项目根发现 / 有效性 / reconcile / 失效事务。禁载 memory.service/db/zvec(不变量6)。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot } = require('./runtime');

const RECEIPT_SCHEMA_VERSION = 1;
const HARD_FIELDS = ['schemaVersion', 'host', 'sessionId', 'projectRoot', 'state'];

// ── fs seam(测试注入失败用;生产恒为真实实现)──
const DEFAULT_FS_OPS = {
    existsSync: fs.existsSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync, unlinkSync: fs.unlinkSync, mkdirSync: fs.mkdirSync,
    realpathSync: fs.realpathSync,
};
let fsOps = { ...DEFAULT_FS_OPS };
function __setFsOps(overrides) { fsOps = { ...DEFAULT_FS_OPS, ...overrides }; }
function __resetFsOps() { fsOps = { ...DEFAULT_FS_OPS }; }

function discoverProjectRoot(startDir) {
    let cur = path.resolve(startDir);
    for (;;) {
        if (fsOps.existsSync(path.join(cur, '.evo-lite'))) return cur;
        const parent = path.dirname(cur);
        if (parent === cur) throw new Error(`takeover: no .evo-lite ancestor from ${startDir} (not an evo-lite project)`);
        cur = parent;
    }
}
function normalize(p) {
    let r = p.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
    return r;
}
function canonicalProjectRoot(startDir) {
    const root = discoverProjectRoot(startDir || getWorkspaceRoot()); // 严格:找不到直接抛
    let real = root;
    try { real = fsOps.realpathSync(root); } catch (_) { /* 目录存在但 realpath 不可用时用原路径 */ }
    return normalize(real);
}

function evoLiteDir(projectRoot) { return path.join(projectRoot, '.evo-lite'); }
function receiptDir(projectRoot, host) { return path.join(evoLiteDir(projectRoot), 'generated', 'takeover', 'receipts', host); }
function receiptPathFor(projectRoot, host, sessionId) {
    const name = crypto.createHash('sha256').update(`${host}\0${sessionId}`).digest('hex');
    return path.join(receiptDir(projectRoot, host), `${name}.json`);
}

function readActiveContextMarkdown(projectRoot) {
    try { return fsOps.readFileSync(path.join(evoLiteDir(projectRoot), 'active_context.md'), 'utf8'); }
    catch (_) { return null; }
}
function readFocusAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return null;
    const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
    const text = (m ? m[1] : '').trim();
    return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}
function readMetaAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return null;
    const m = md.match(/<!--\s*BEGIN_META\s*-->([\s\S]*?)<!--\s*END_META\s*-->/);
    const block = m ? m[1] : '';
    const pick = (key) => { const r = block.match(new RegExp(`${key}:\\s*([^\\s]+)`)); return r ? r[1] : null; };
    const num = (key) => { const v = pick(key); return v === null ? null : Number(v); };
    return { headSha: pick('headSha'), upstreamSha: pick('upstreamSha'), ahead: num('ahead'), behind: num('behind') };
}

function publishReceipt(projectRoot, receiptObj) {
    const finalPath = receiptPathFor(projectRoot, receiptObj.host, receiptObj.sessionId);
    fsOps.mkdirSync(path.dirname(finalPath), { recursive: true });
    const tmp = path.join(path.dirname(finalPath), `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fsOps.writeFileSync(tmp, JSON.stringify(receiptObj), 'utf8');
    fsOps.renameSync(tmp, finalPath);
}

function readReceipt(projectRoot, host, sessionId) {
    const p = receiptPathFor(projectRoot, host, sessionId);
    if (!fsOps.existsSync(p)) return { state: 'missing', reason: null, receipt: null };
    let raw; try { raw = JSON.parse(fsOps.readFileSync(p, 'utf8')); }
    catch (_) { return { state: 'invalid', reason: 'corrupt', receipt: null }; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'invalid', reason: 'corrupt', receipt: null };
    for (const f of HARD_FIELDS) if (!(f in raw)) return { state: 'invalid', reason: `missing-${f}`, receipt: raw };
    if (raw.state !== 'committed') return { state: 'invalid', reason: raw.reason || 'state-not-committed', receipt: raw };
    const canonRoot = canonicalProjectRoot(projectRoot);
    if (raw.schemaVersion !== RECEIPT_SCHEMA_VERSION || raw.host !== host || raw.sessionId !== sessionId || raw.projectRoot !== canonRoot) {
        return { state: 'invalid', reason: 'identity-mismatch', receipt: raw };
    }
    return { state: 'committed', reason: null, receipt: raw };
}

function invalidateReceipt(projectRoot, host, sessionId, reason) {
    let canonRoot = null;
    try { canonRoot = canonicalProjectRoot(projectRoot); } catch (_) { canonRoot = normalize(path.resolve(projectRoot)); }
    try {
        publishReceipt(projectRoot, { schemaVersion: RECEIPT_SCHEMA_VERSION, host, sessionId, projectRoot: canonRoot, state: 'invalid', reason });
        return { ok: true, method: 'tombstone' };
    } catch (_) { /* 回退 unlink */ }
    try {
        const p = receiptPathFor(projectRoot, host, sessionId);
        if (fsOps.existsSync(p)) fsOps.unlinkSync(p);
        return { ok: true, method: 'unlink' };
    } catch (_) { return { ok: false, method: 'none' }; }
}

function reconcile({ projectRoot, host, sessionId }) {
    const rr = readReceipt(projectRoot, host, sessionId);
    const focus = readFocusAnchor(projectRoot);
    if (focus === null) {
        let invalidation = { ok: true, method: 'none' };
        if (rr.state === 'committed') invalidation = invalidateReceipt(projectRoot, host, sessionId, 'active-context-unreadable');
        // 失效持久化即便双失败,verdict 仍为 degraded —— 守卫据此 fail-closed(不依赖文件状态)
        return { verdict: { state: 'invalid', transition: 'degraded', reason: 'active-context-unreadable' }, focus: null, invalidation };
    }
    if (rr.state !== 'committed') {
        return { verdict: { state: rr.state === 'missing' ? 'missing' : 'invalid', transition: 'stale', reason: rr.reason }, focus, invalidation: null };
    }
    if (rr.receipt.focusHash !== focus.hash) {
        publishReceipt(projectRoot, { ...rr.receipt, focusHash: focus.hash });
        return { verdict: { state: 'committed', transition: 'refreshed', reason: null }, focus, invalidation: null };
    }
    return { verdict: { state: 'committed', transition: 'active', reason: null }, focus, invalidation: null };
}

module.exports = {
    RECEIPT_SCHEMA_VERSION, discoverProjectRoot, canonicalProjectRoot, evoLiteDir, receiptPathFor,
    readFocusAnchor, readMetaAnchor, publishReceipt, readReceipt, invalidateReceipt, reconcile,
    __setFsOps, __resetFsOps,
};
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-projectroot passed`、`✅ T-takeover-receipt passed`。

- [ ] **Step 5: 写 reconcile / degraded / meta 测试**

```javascript
console.log('T-takeover-reconcile / T-takeover-degraded. drift refreshes; unreadable degrades even if invalidation fails ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-rec-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    const wf = (t) => fs.writeFileSync(path.join(ac, 'active_context.md'),
        `<!-- BEGIN_META -->\n> headSha: abc123\n> ahead: 2\n> behind: 0\n<!-- END_META -->\n<!-- BEGIN_FOCUS -->\n${t}\n<!-- END_FOCUS -->\n`, 'utf8');
    wf('FOCUS-A');
    const canon = rc.canonicalProjectRoot(root);
    // meta 锚点供 freshness
    const meta = rc.readMetaAnchor(root);
    assert.strictEqual(meta.headSha, 'abc123'); assert.strictEqual(meta.ahead, 2); assert.strictEqual(meta.behind, 0);

    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 's', projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual(rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' }).verdict.transition, 'active');
    wf('FOCUS-B');
    assert.strictEqual(rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' }).verdict.transition, 'refreshed');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's').state, 'committed', 'drift keeps committed');
    console.log('✅ T-takeover-reconcile passed');

    fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
    const rd = rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' });
    assert.strictEqual(rd.verdict.transition, 'degraded');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's').state, 'invalid', 'degraded revokes committed');

    // 失效双失败(tombstone + unlink 均抛)→ verdict 仍 degraded、invalidation.ok=false
    wf('FOCUS-C');
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 's2', projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
    rc.__setFsOps({ writeFileSync: () => { throw new Error('tombstone fail'); }, unlinkSync: () => { throw new Error('unlink fail'); } });
    try {
        const dbl = rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's2' });
        assert.strictEqual(dbl.verdict.transition, 'degraded', 'degraded verdict independent of invalidation success');
        assert.strictEqual(dbl.invalidation.ok, false, 'double failure reported');
    } finally { rc.__resetFsOps(); }
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's2').state, 'committed', 'stale committed receipt survives on disk (guard must not rely on it)');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-degraded passed');
}
```

- [ ] **Step 6: 运行验证通过 + 提交**

Run: `node templates/cli/test.js governance`
Expected: PASS — reconcile / degraded 通过。

```bash
git add templates/cli/takeover-receipt.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): strict project-root discovery + project-bound session-scoped receipt + fs seam for fault injection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 单一 collector(`takeover-session.js`)—— 现有 bootstrap 四件套 + plan/spec/freshness 派生 + 结构化降级

**Files:**
- Create: `templates/cli/takeover-session.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-collector`)

**Interfaces:**
- Produces:
  - `derivePlanSpec(planIr, focusText)` → `{ plan|null, spec|null }`(**纯函数**:按 focus 文本匹配 plan/spec id 与 sourcePath basename;plan 带 `progress:"done/total"`,来自 `taskIds` × `tasks[].status`)
  - `assembleSessionContext(base, parts)` → `SessionTakeoverContext`(**纯函数**,parts = `{summary, sessionstart, verify, recall, planSpec, freshness, degraded}`)
  - `collectSessionTakeoverContextFull(base)` → `Promise<SessionTakeoverContext>`(**async**;`initDB()` → 四件套 → plan-ir → meta;可恢复失败入 `degraded[]`,不可恢复抛错)
- session-only:内部 lazy require `./db` 与 `./memory.service`;refresh 路径**永不**加载本模块。

- [ ] **Step 1: 写失败测试(纯派生 + 结构化降级 + 真实 verify/recall)**

```javascript
console.log('T-takeover-collector. plan/spec derivation + structured degradation + real four-part collection ...');
{
    const ts = require(path.join(TEMPLATE_CLI_DIR, 'takeover-session.js'));
    // 纯派生:按 focus 文本匹配 plan/spec(plan.status 只有 done|parked|draft,不能按 'active' 过滤)
    const ir = {
        plans: [{ id: 'plan:alpha', title: 'Alpha', status: 'draft', sourcePath: 'docs/superpowers/plans/2026-07-24-alpha.md', linkedSpec: 'spec:alpha', taskIds: ['t1', 't2'] }],
        specs: [{ id: 'spec:alpha', title: 'Alpha spec', status: 'draft', sourcePath: 'docs/specs/alpha.md', linkedPlans: ['plan:alpha'] }],
        tasks: [{ id: 't1', status: 'done' }, { id: 't2', status: 'todo' }],
    };
    const byId = ts.derivePlanSpec(ir, 'now working on plan:alpha stage 1');
    assert.strictEqual(byId.plan.id, 'plan:alpha');
    assert.strictEqual(byId.plan.progress, '1/2', 'progress from taskIds x tasks[].status');
    assert.strictEqual(byId.spec.id, 'spec:alpha', 'spec resolved via linkedSpec');
    const byPath = ts.derivePlanSpec(ir, 'see 2026-07-24-alpha.md for detail');
    assert.strictEqual(byPath.plan.id, 'plan:alpha', 'matches by sourcePath basename');
    const none = ts.derivePlanSpec(ir, 'unrelated focus text');
    assert.strictEqual(none.plan, null); assert.strictEqual(none.spec, null);

    // 装配:承重字段直通,degraded 结构化
    const ctx = ts.assembleSessionContext(
        { host: 'claude-code', sessionId: 's', projectRoot: '/p', sourceEvent: 'x', focus: 'F', focusHash: 'h' },
        { summary: { activeTasks: [{ line: '- [ ] task A' }], validation: { warnings: ['w1'] } },
          sessionstart: { contextStatus: 'configured', architectureStatus: 'configured', activeTaskCount: 1, reminders: ['r1'], warnings: ['w2'] },
          verify: { hasAlerts: false, nextSteps: ['ns1'] }, recall: { status: 'hit' },
          planSpec: { plan: null, spec: null }, freshness: { headSha: 'abc', ahead: 0, behind: 0 },
          degraded: [{ part: 'recall', reason: 'boom' }] });
    assert.strictEqual(ctx.kind, 'session');
    assert.deepStrictEqual(ctx.degraded, [{ part: 'recall', reason: 'boom' }]);
    assert.strictEqual(ctx.health.takeover, 'attention-needed', 'degraded entries force attention-needed');
    assert.ok(ctx.risks.includes('w1') && ctx.risks.includes('w2'), 'risks merge validation + sessionstart warnings');
    assert.strictEqual(ctx.nextAction, 'r1', 'nextAction from reminders/nextSteps');
    assert.strictEqual(ctx.verify.hasAlerts, false, 'verify passed through verbatim');
    assert.strictEqual(ctx.recall.status, 'hit', 'recall object passed through (not array)');

    // 真实 collector(全新进程内自 initDB,得到真实 verify/recall,不依赖预跑 mem bootstrap)
    const probeScript = `
        const ts = require(${JSON.stringify(path.join(TEMPLATE_CLI_DIR, 'takeover-session.js'))});
        const rc = require(${JSON.stringify(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'))});
        (async () => {
            const root = rc.canonicalProjectRoot();
            const focus = rc.readFocusAnchor(root);
            const c = await ts.collectSessionTakeoverContextFull({ host: 'claude-code', sessionId: 'p',
                projectRoot: root, sourceEvent: 'probe', focus: focus.text, focusHash: focus.hash });
            console.log(JSON.stringify({ hasVerify: c.verify && typeof c.verify === 'object',
                hasRecall: c.recall && typeof c.recall === 'object', degraded: c.degraded.map(d => d.part) }));
        })().catch(e => { console.error(e.message); process.exit(3); });`;
    const runtimeRoot = path.join(WORKSPACE_ROOT, '.evo-lite');
    const sub = childProcess.spawnSync(process.execPath, ['-e', probeScript],
        { env: { ...process.env, EVO_LITE_ROOT: runtimeRoot, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
    assert.strictEqual(sub.status, 0, `collector runs in a fresh process (stderr: ${sub.stderr})`);
    const out = JSON.parse(sub.stdout.trim().split('\n').pop());
    assert.strictEqual(out.hasVerify, true, 'fresh process yields a real verify object');
    assert.strictEqual(out.hasRecall, true, 'fresh process yields a real recall object');
    console.log('✅ T-takeover-collector passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-session.js`**

```javascript
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
    const verify = parts.verify || {};
    const degraded = Array.isArray(parts.degraded) ? parts.degraded : [];
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
        rules: RULES, risks, nextAction,
        freshness: parts.freshness || { headSha: null, ahead: null, behind: null },
        health: { takeover, contextStatus: ss.contextStatus || 'unknown',
            architectureStatus: ss.architectureStatus || 'unknown', activeTaskCount: ss.activeTaskCount || 0 },
        verify, recall: parts.recall || {}, degraded,
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
    const meta = rc.readMetaAnchor(base.projectRoot);
    if (meta === null) degraded.push({ part: 'meta', reason: 'active-context-unreadable' });

    return assembleSessionContext(base, {
        summary, sessionstart, verify, recall, planSpec,
        freshness: meta || { headSha: null, ahead: null, behind: null }, degraded,
    });
}

module.exports = { derivePlanSpec, assembleSessionContext, collectSessionTakeoverContextFull };
```

- [ ] **Step 4: 运行验证通过 + 提交**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-collector passed`。

```bash
git add templates/cli/takeover-session.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): single session collector — four-part bootstrap reuse, plan/spec + freshness derivation, structured degradation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 生命周期 adapter + 两条 transport(`takeover-adapter.js`)

**Files:**
- Create: `templates/cli/takeover-adapter.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-adapter-session`、`T-takeover-refresh-isolation`、`T-takeover-transport-order`)

**Interfaces:**
- Produces:
  - `writeAllSync(fd, text)`(循环 partial write,确认全部字节)
  - `executeHookTransport(json, publish, { write }?)` → `{ exitCode, error? }`
  - `executeCliRecoveryTransport(text, publish, { write }?)` → `{ exitCode, error? }`
  - `buildRecoveryCommand(projectRoot, sessionId)` → string
  - `handleHookInput(input, deps?)` → `Promise<{ json, exitCode, publish|null }>`(deps 可注入 `{projectRoot, collect, buildPayload, validate}`)
  - `main()`
- 顶部只 require `takeover-receipt` + `takeover-payload`;collector lazy(不变量 6)。

- [ ] **Step 1: 写失败测试(establishment/refresh + transport 顺序 + 校验前置)**

```javascript
console.log('T-takeover-adapter-session. establishment/refresh by receipt presence; validate before publish ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-ad-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'),
        '<!-- BEGIN_META -->\n> headSha: abc\n> ahead: 0\n> behind: 0\n<!-- END_META -->\n<!-- BEGIN_FOCUS -->\nFOCUS-A\n<!-- END_FOCUS -->\n', 'utf8');
    const sid = 'sess-1';
    const ts = require(path.join(TEMPLATE_CLI_DIR, 'takeover-session.js'));
    const deps = { projectRoot: root, collect: (base) => ts.assembleSessionContext(base, {
        summary: {}, sessionstart: { contextStatus: 'configured', architectureStatus: 'configured', activeTaskCount: 0, reminders: ['r'], warnings: [] },
        verify: { hasAlerts: false, nextSteps: [] }, recall: { status: 'no-match' },
        planSpec: { plan: null, spec: null }, freshness: { headSha: 'abc', ahead: 0, behind: 0 }, degraded: [] }) };

    const r1 = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }, deps);
    assert.strictEqual(r1.exitCode, 0);
    assert.ok(r1.json.hookSpecificOutput.additionalContext.includes('FOCUS-A'), 'establishment injects payload');
    assert.strictEqual(typeof r1.publish, 'function', 'publish deferred (ordered publication)');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'missing', 'no receipt before transport');
    assert.strictEqual(ad.executeHookTransport(r1.json, r1.publish, { write: () => {} }).exitCode, 0);
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'committed', 'committed after delivery');

    // 已有 receipt → resume 仍走 refresh(不因 source 判定)
    const r2 = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, source: 'resume' }, deps);
    ad.executeHookTransport(r2.json, r2.publish, { write: () => {} });
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'committed');

    // payload 校验不过 → 不发布、非零(注入坏 payload)
    const bad = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'bad', source: 'startup' },
        { ...deps, buildPayload: () => ({ schemaVersion: 1 }) });
    assert.strictEqual(bad.exitCode, 1, 'invalid payload → nonzero');
    assert.strictEqual(bad.publish, null, 'invalid payload → no publish');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 'bad').state, 'missing', 'invalid payload never yields committed receipt');

    const up = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid }, deps);
    assert.strictEqual(JSON.parse(up.json.hookSpecificOutput.additionalContext).evoLite, 'takeover-active');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-adapter-session passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-adapter.js`**

```javascript
'use strict';
// ATTP Claude Code 生命周期 adapter + 两条 transport。顶部只载 receipt + payload;collector lazy(不变量6)。
const fs = require('fs');
const path = require('path');
const rc = require('./takeover-receipt');
const { buildTakeoverPayload, validateSessionPayload, validateCapsule, CAPSULE_BUDGET_BYTES } = require('./takeover-payload');
const HOST = 'claude-code';

function bashSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function buildRecoveryCommand(projectRoot, sessionId) {
    const cli = bashSingleQuote(`${projectRoot}/.evo-lite/cli/memory.js`);
    return `node ${cli} bootstrap --receipt --host claude-code --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}

// ── 同步完整写入:循环处理 partial write,确认全部 UTF-8 字节送出 ──
function writeAllSync(fd, text) {
    const buf = Buffer.from(String(text), 'utf8');
    let off = 0;
    while (off < buf.length) {
        off += fs.writeSync(fd, buf, off, buf.length - off);
    }
}

function runTransport(serialize, publish, write) {
    let serialized;
    try { serialized = serialize(); }
    catch (e) { process.stderr.write(`evo-lite takeover: serialize failed: ${e.message}\n`); return { exitCode: 1, error: `serialize: ${e.message}` }; }
    try { write(serialized); }
    catch (e) { process.stderr.write(`evo-lite takeover: delivery failed: ${e.message}\n`); return { exitCode: 1, error: `write: ${e.message}` }; }
    if (typeof publish === 'function') {
        try { publish(); }
        catch (e) { process.stderr.write(`evo-lite takeover: receipt publish failed: ${e.message}\n`); return { exitCode: 1, error: `publish: ${e.message}` }; }
    }
    return { exitCode: 0 };
}

function executeHookTransport(json, publish, opts = {}) {
    const write = opts.write || ((s) => writeAllSync(1, s));
    return runTransport(() => JSON.stringify(json || {}), publish, write);
}
function executeCliRecoveryTransport(text, publish, opts = {}) {
    const write = opts.write || ((s) => writeAllSync(1, s + '\n'));
    return runTransport(() => String(text), publish, write);
}

async function handleSessionStart(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot);
    const sessionId = input.session_id;
    const sourceEvent = `SessionStart:${input.source || 'startup'}`;
    const existing = rc.readReceipt(projectRoot, HOST, sessionId);
    const focus = rc.readFocusAnchor(projectRoot);
    const recovery = buildRecoveryCommand(projectRoot, sessionId);

    if (focus === null) { // 不可恢复:degraded,失效已有 committed,不发布
        if (existing.state === 'committed') rc.invalidateReceipt(projectRoot, HOST, sessionId, 'active-context-unreadable');
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover DEGRADED (active_context unreadable). Recover: ${recovery}` },
            systemMessage: 'evo-lite takeover degraded' }, exitCode: 1, publish: null };
    }

    const base = { host: HOST, sessionId, projectRoot, sourceEvent, focus: focus.text, focusHash: focus.hash,
        generatedAt: new Date().toISOString() };
    let context;
    try {
        context = deps.collect ? await deps.collect(base)
            : await require('./takeover-session').collectSessionTakeoverContextFull(base);
    } catch (e) {
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover FAILED: ${e.message}. Recover: ${recovery}` },
            systemMessage: `evo-lite takeover collector failed: ${e.message}` }, exitCode: 1, publish: null };
    }
    const build = deps.buildPayload || buildTakeoverPayload;
    const validate = deps.validate || validateSessionPayload;
    const payload = build(context);
    const verdict = validate(payload);
    if (!verdict.ok) { // 校验不过 → 不发布 receipt
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover payload invalid (${verdict.errors.join(',')}). Recover: ${recovery}` },
            systemMessage: 'evo-lite takeover payload validation failed' }, exitCode: 1, publish: null };
    }
    const publish = () => rc.publishReceipt(projectRoot, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: HOST,
        sessionId, projectRoot: rc.canonicalProjectRoot(projectRoot), state: 'committed', focusHash: focus.hash,
        payloadHash: null, generatedAt: base.generatedAt, sourceEvent });
    void existing; // establishment 与 refresh 都刷新 receipt;差异仅诊断
    return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
        additionalContext: `[evo-lite takeover] ${JSON.stringify(payload)}` } }, exitCode: 0, publish };
}

function handleUserPromptSubmit(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot);
    const sessionId = input.session_id;
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    const capsule = buildTakeoverPayload({ kind: 'refresh', host: HOST, sessionId, projectRoot,
        projectName: path.basename(projectRoot), sourceEvent: 'UserPromptSubmit',
        focus: focus ? focus.text : null, focusHash: focus ? focus.hash : null,
        receiptVerdict: verdict, recoveryAction: buildRecoveryCommand(projectRoot, sessionId) }, CAPSULE_BUDGET_BYTES);
    return { json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(capsule) } },
        exitCode: 0, publish: null };
}

async function handleHookInput(input, deps = {}) {
    switch (input && input.hook_event_name) {
        case 'SessionStart': return handleSessionStart(input, deps);
        case 'UserPromptSubmit': return handleUserPromptSubmit(input, deps);
        default: return { json: {}, exitCode: 0, publish: null }; // 阶段2 增 PreToolUse
    }
}

function main() {
    let raw = '';
    process.stdin.on('data', d => raw += d).on('end', async () => {
        let input = {}; try { input = JSON.parse(raw); } catch (_) {}
        let out;
        try { out = await handleHookInput(input, {}); }
        catch (e) { out = { json: { systemMessage: `evo-lite takeover error: ${e.message}` }, exitCode: 1, publish: null }; }
        const res = executeHookTransport(out.json, out.publish);
        process.exit(res.exitCode || out.exitCode || 0);
    });
}

if (require.main === module) main();
module.exports = { handleHookInput, executeHookTransport, executeCliRecoveryTransport, writeAllSync, buildRecoveryCommand };
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-adapter-session passed`。

- [ ] **Step 5: 写 refresh 隔离 + transport 顺序测试**

```javascript
console.log('T-takeover-refresh-isolation. UserPromptSubmit must not load heavy deps ...');
{
    const heavy = ['memory.service', 'db', 'memory-index', 'memory-index-zvec', 'takeover-session'];
    const saved = {};
    for (const m of heavy) {
        const rp = require.resolve(path.join(TEMPLATE_CLI_DIR, m));
        saved[rp] = require.cache[rp]; delete require.cache[rp];
        require.cache[rp] = { id: rp, filename: rp, loaded: true, get exports() { throw new Error(`refresh loaded ${m}`); } };
    }
    try {
        const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-iso-'));
        const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
        fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
        const up = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: 's' }, { projectRoot: root });
        assert.ok(up.json.hookSpecificOutput.additionalContext, 'refresh capsule without heavy deps');
        fs.rmSync(root, { recursive: true, force: true });
    } finally { for (const rp of Object.keys(saved)) { delete require.cache[rp]; if (saved[rp]) require.cache[rp] = saved[rp]; } }
    console.log('✅ T-takeover-refresh-isolation passed');
}

console.log('T-takeover-transport-order. writeAllSync completeness; deliver-before-publish; failures not swallowed ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    // writeAllSync 完整写出(经真实 fd:临时文件)
    const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-w-')), 'out.txt');
    const fd = fs.openSync(tmpFile, 'w');
    const big = '漢'.repeat(20000);
    ad.writeAllSync(fd, big); fs.closeSync(fd);
    assert.strictEqual(fs.readFileSync(tmpFile, 'utf8'), big, 'writeAllSync writes every byte');

    let published = false, written = '';
    const ok = ad.executeHookTransport({ a: 1 }, () => { assert.ok(written, 'write happened before publish'); published = true; }, { write: (s) => { written = s; } });
    assert.strictEqual(ok.exitCode, 0); assert.strictEqual(published, true);
    published = false;
    const wf = ad.executeHookTransport({ a: 1 }, () => { published = true; }, { write: () => { throw new Error('stdout fail'); } });
    assert.strictEqual(wf.exitCode, 1); assert.strictEqual(published, false, 'delivery failure → no publish');
    const pf = ad.executeHookTransport({ a: 1 }, () => { throw new Error('rename fail'); }, { write: () => {} });
    assert.strictEqual(pf.exitCode, 1, 'publish failure → nonzero, not swallowed');
    // CLI transport 同规则,且 envelope 不同(纯文本,非 hookSpecificOutput)
    let cliOut = '';
    const cli = ad.executeCliRecoveryTransport('PAYLOAD_TEXT', () => {}, { write: (s) => { cliOut = s; } });
    assert.strictEqual(cli.exitCode, 0);
    assert.ok(cliOut.includes('PAYLOAD_TEXT') && !cliOut.includes('hookSpecificOutput'), 'CLI transport is not a hook envelope');
    console.log('✅ T-takeover-transport-order passed');
}
```

- [ ] **Step 6: 运行验证通过 + 提交**

```bash
node templates/cli/test.js governance
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): lifecycle adapter + writeAllSync ordered-publication transports; payload validated before receipt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 三入口收口 —— `mem bootstrap` 经 builder + `--receipt` CLI recovery

**Files:**
- Modify: `templates/cli/memory.js`(`runBootstrapCommand` 改经 collector+builder+validate;`formatBootstrapReport` 改消费新 payload;新增 `runReceiptRecovery`;bootstrap 命令增四个选项)
- Test: `templates/cli/test/governance.js`(`T-takeover-recovery`)

**Interfaces:**
- Consumes: `takeover-session.collectSessionTakeoverContextFull`、`takeover-payload.{buildTakeoverPayload,validateSessionPayload}`、`takeover-receipt.*`、`takeover-adapter.{executeCliRecoveryTransport,buildRecoveryCommand}`。

- [ ] **Step 1: 写失败测试**

```javascript
console.log('T-takeover-recovery. CLI recovery: payload before authorization; committed receipt; root-bound command ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const canonRepo = rc.canonicalProjectRoot(WORKSPACE_ROOT);
    const cmd = ad.buildRecoveryCommand(canonRepo, "sid'q");
    assert.ok(cmd.startsWith(`node '${canonRepo}/.evo-lite/cli/memory.js'`), 'canonical-root-bound absolute path');
    assert.ok(!/(^| )node \.evo-lite\//.test(cmd), 'no bare relative path');
    assert.ok(/'sid'\\''q'/.test(cmd), 'sessionId bash-escaped');

    // 子进程在【子目录】cwd 下执行 recovery:EVO_LITE_ROOT 指向真实 .evo-lite
    const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
    const runtimeRoot = path.join(WORKSPACE_ROOT, '.evo-lite');
    const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt',
        '--host', 'claude-code', '--session-id', 'rec-test', '--source', 'manual-recovery', '--json'],
        { cwd: path.join(WORKSPACE_ROOT, 'templates'), env: { ...process.env, EVO_LITE_ROOT: runtimeRoot, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
    assert.strictEqual(sub.status, 0, `recovery exit 0 (stderr: ${sub.stderr})`);
    const printed = JSON.parse(sub.stdout.slice(sub.stdout.indexOf('{')));
    assert.strictEqual(printed.schemaVersion, 1, 'recovery prints the takeover payload (not a "committed" banner)');
    assert.ok(!/hookSpecificOutput/.test(sub.stdout), 'CLI output is not a hook envelope');
    assert.strictEqual(rc.readReceipt(WORKSPACE_ROOT, 'claude-code', 'rec-test').state, 'committed', 'receipt committed');
    fs.rmSync(rc.receiptPathFor(WORKSPACE_ROOT, 'claude-code', 'rec-test'), { force: true });
    console.log('✅ T-takeover-recovery passed');
}
```

- [ ] **Step 2: 运行验证失败** — `--receipt` 未实现。

- [ ] **Step 3: 替换 `memory.js` 的 bootstrap 注册块**

把 `program.command('bootstrap')...` 整块替换为:

```javascript
    program.command('bootstrap')
        .alias('evo-start')
        .description('Print the canonical takeover payload; with --receipt also publish a session-bound committed receipt.')
        .option('--json', 'Print JSON output')
        .option('--receipt', 'CLI recovery transport: publish a session-bound committed takeover receipt')
        .option('--host <host>', 'Host label', 'claude-code')
        .option('--session-id <id>', 'Session id to bind the receipt to')
        .option('--source <source>', 'Receipt sourceEvent label', 'manual-recovery')
        .action(async options => {
            if (options.receipt) { await runReceiptRecovery(options); return; }
            await runBootstrapCommand(options);
        });
```

- [ ] **Step 4: 替换 `runBootstrapCommand` 并新增 `runReceiptRecovery`**

```javascript
async function buildCanonicalTakeoverPayload(options = {}) {
    const rc = require('./takeover-receipt');
    const { collectSessionTakeoverContextFull } = require('./takeover-session');
    const { buildTakeoverPayload, validateSessionPayload } = require('./takeover-payload');
    const projectRoot = rc.canonicalProjectRoot();
    const focus = rc.readFocusAnchor(projectRoot);
    if (focus === null) throw new Error('active_context unreadable; cannot build takeover payload');
    const context = await collectSessionTakeoverContextFull({
        host: options.host || 'claude-code', sessionId: options.sessionId || 'cli',
        projectRoot, sourceEvent: options.source || 'bootstrap',
        focus: focus.text, focusHash: focus.hash, generatedAt: new Date().toISOString(),
    });
    const payload = buildTakeoverPayload(context);
    const verdict = validateSessionPayload(payload);
    if (!verdict.ok) throw new Error(`takeover payload invalid: ${verdict.errors.join(',')}`);
    return { payload, projectRoot, focus };
}

async function runBootstrapCommand(options = {}) {
    await bootstrap();
    const { payload } = await buildCanonicalTakeoverPayload({ ...options, source: 'bootstrap' });
    if (options.json === true) { console.log(JSON.stringify(payload, null, 2)); return; }
    console.log(formatBootstrapReport(payload));
}

async function runReceiptRecovery(options = {}) {
    await bootstrap();
    if (!options.sessionId) {
        throw new Error('Usage: bootstrap --receipt --host <host> --session-id <id> --source <source> [--json]');
    }
    const rc = require('./takeover-receipt');
    const { executeCliRecoveryTransport } = require('./takeover-adapter');
    const { payload, projectRoot, focus } = await buildCanonicalTakeoverPayload(options);
    const publish = () => rc.publishReceipt(projectRoot, {
        schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: options.host, sessionId: options.sessionId,
        projectRoot, state: 'committed', focusHash: focus.hash, payloadHash: null,
        generatedAt: payload.generatedAt, sourceEvent: options.source || 'manual-recovery',
    });
    // 先交付 payload,后发布授权(不在发布前打印完成态文案)
    const text = options.json ? JSON.stringify(payload, null, 2) : formatBootstrapReport(payload);
    const res = executeCliRecoveryTransport(text, publish);
    if (res.exitCode) { process.exitCode = res.exitCode; }
}
```

- [ ] **Step 5: 改写 `formatBootstrapReport` 消费新 payload**

把整个 `formatBootstrapReport` 函数替换为:

```javascript
function formatBootstrapReport(payload) {
    const health = payload.health || {};
    const verify = payload.verify || {};
    const recall = payload.recall || {};
    const lines = [
        `takeover: ${health.takeover || 'unknown'}`,
        `project: ${payload.project.name}`,
        `focus: ${payload.focus.text || '(empty)'}`,
        `active_plan: ${payload.active.plan ? `${payload.active.plan.id} (${payload.active.plan.status}, ${payload.active.plan.progress})` : '(none)'}`,
        `active_spec: ${payload.active.spec ? `${payload.active.spec.id} (${payload.active.spec.status})` : '(none)'}`,
        `active_tasks: ${health.activeTaskCount || 0}`,
        `context_status: ${health.contextStatus || 'unknown'}`,
        `architecture_status: ${health.architectureStatus || 'unknown'}`,
        `git_status: ${verify.git || 'unknown'}`,
        `template_sync: ${verify.templateSync || 'unknown'}`,
        `local_engine: ${verify.localEngine || 'unknown'}`,
        `entity_store: ${verify.entityStore || 'unknown'}`,
        `freshness: head=${payload.freshness.headSha || 'unknown'} ahead=${payload.freshness.ahead} behind=${payload.freshness.behind}`,
        `rules: ${payload.rules.dir} (${payload.rules.required.join(', ')})`,
        `memory_status: ${recall.status || 'no-match'}`,
        `memory_effect: ${recall.effect || 'fresh-takeover'}`,
    ];
    for (const hit of (Array.isArray(recall.hits) ? recall.hits : [])) {
        if (hit && hit.label) lines.push(`memory_hit: ${hit.label}`);
    }
    for (const risk of payload.risks) lines.push(`warning: ${risk}`);
    for (const d of payload.degraded) lines.push(`degraded: ${d.part} (${d.reason})`);
    lines.push(`next_step: ${payload.nextAction}`);
    for (const item of (Array.isArray(recall.reflections) ? recall.reflections : [])) {
        lines.push(`reflection: [${item.keyword}] memory:${item.memoryId}`);
    }
    return lines.join('\n');
}
```

- [ ] **Step 6: 运行验证通过 + 人工核对**

```bash
node templates/cli/test.js governance
EVO_LITE_ROOT="$PWD/.evo-lite" node templates/cli/memory.js bootstrap
EVO_LITE_ROOT="$PWD/.evo-lite" node templates/cli/memory.js bootstrap --json
```
Expected: 测试通过;人类视图含 `takeover/focus/active_plan/freshness/next_step`;`--json` 输出 schemaVersion=1 的完整 payload。

- [ ] **Step 7: 提交**

```bash
git add templates/cli/memory.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): route mem bootstrap + CLI recovery through the single collector/builder/validator

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: installer(事务化 capability-gate)+ manifest + gitignore + 镜像 + 阶段 1 dogfood/复审门

**Files:**
- Create: `templates/cli/takeover-install.js`
- Modify: `templates/cli/memory.js`(`mem takeover install|status`)
- Modify: `templates/cli/template-manifest.js`、`templates/cli/test/integration.js`、`.gitignore`
- Test: `templates/cli/test/governance.js`(`T-takeover-installer`)
- Create: `docs/validation/attp-phase1-dogfood.md`

**Interfaces:**
- `HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"'`
- `managedFragment(events)`、`mergeHookConfig(existing, fragment)`、`isManagedGroup(g)`
- `probeAdapter(projectRoot)` → `{ ok, reason }`(**安装前**验证 adapter 可被 node 执行:喂一条最小 UserPromptSubmit JSON,期望 stdout 含 `hookSpecificOutput`)
- `installTakeoverHooks(settingsPath, { events, projectRoot })` → `{ changed }`(**损坏 JSON 抛错不覆盖;probe 不过则抛错、原文件不变**)
- `statusTakeoverHooks(settingsPath, events)` → `{ installed[], missing[] }`(**损坏 JSON 抛错**)

- [ ] **Step 1: 写失败测试**

```javascript
console.log('T-takeover-installer. idempotent deep-merge; corrupt → throw (install & status); probe gate ...');
{
    const ti = require(path.join(TEMPLATE_CLI_DIR, 'takeover-install.js'));
    const existing = { model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } };
    const frag = ti.managedFragment(['SessionStart', 'UserPromptSubmit']);
    const m1 = ti.mergeHookConfig(existing, frag);
    assert.strictEqual(m1.model, 'sonnet', 'unknown field preserved');
    assert.ok(m1.hooks.PreToolUse.some(g => g.hooks.some(h => h.command === 'rtk hook claude')), 'third-party preserved');
    assert.ok(m1.hooks.SessionStart.some(g => g.hooks.some(h => /CLAUDE_PROJECT_DIR/.test(h.command))), 'uses CLAUDE_PROJECT_DIR');
    assert.strictEqual(ti.mergeHookConfig(m1, frag).hooks.SessionStart.filter(ti.isManagedGroup).length, 1, 'idempotent');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-inst-'));
    const corrupt = path.join(dir, 'settings.json');
    fs.writeFileSync(corrupt, '{ not json', 'utf8');
    assert.throws(() => ti.installTakeoverHooks(corrupt, { events: ['SessionStart'], projectRoot: WORKSPACE_ROOT }), /corrupt|JSON/i, 'install throws on corrupt');
    assert.strictEqual(fs.readFileSync(corrupt, 'utf8'), '{ not json', 'corrupt file unchanged');
    assert.throws(() => ti.statusTakeoverHooks(corrupt, ['SessionStart']), /corrupt|JSON/i, 'status throws on corrupt (no silent all-missing)');

    // probe gate:真实仓库 adapter 可跑
    assert.strictEqual(ti.probeAdapter(WORKSPACE_ROOT).ok, true, 'adapter probe passes in this repo');
    // probe 失败 → 不写 settings
    const fresh = path.join(dir, 'fresh.json');
    assert.throws(() => ti.installTakeoverHooks(fresh, { events: ['SessionStart'], projectRoot: path.join(dir, 'nonexistent') }), /probe/i, 'probe failure blocks install');
    assert.strictEqual(fs.existsSync(fresh), false, 'no settings written when probe fails');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-installer passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-install.js`**

```javascript
'use strict';
// ATTP .claude/settings.json 事务化幂等 deep-merge installer。禁整文件覆盖;损坏 JSON fail-loud;安装前 probe。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MANAGED_MARK = 'takeover-adapter.js';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"';

function managedGroup(event) {
    const hooks = [{ type: 'command', command: HOOK_COMMAND }];
    return event === 'PreToolUse' ? { matcher: '*', hooks } : { hooks };
}
function managedFragment(events) { const o = {}; for (const e of events) o[e] = [managedGroup(e)]; return o; }
function isManagedGroup(g) {
    return Boolean(g && Array.isArray(g.hooks) && g.hooks.some(h => h && typeof h.command === 'string' && h.command.includes(MANAGED_MARK)));
}
function mergeHookConfig(existing, fragment) {
    const out = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
    out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
    for (const ev of Object.keys(fragment)) {
        const arr = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : [];
        out.hooks[ev] = [...arr.filter(g => !isManagedGroup(g)), ...fragment[ev]];
    }
    return out;
}

function readSettingsStrict(settingsPath) {
    if (!fs.existsSync(settingsPath)) return {};
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try { return JSON.parse(raw); }
    catch (e) { throw new Error(`takeover: ${settingsPath} is corrupt JSON (${e.message}); leaving it unchanged`); }
}

// 安装前 probe:adapter 必须能被 node 执行并产出 hook envelope。
function probeAdapter(projectRoot) {
    const adapter = path.join(projectRoot, '.evo-lite', 'cli', 'takeover-adapter.js');
    if (!fs.existsSync(adapter)) return { ok: false, reason: `adapter not found: ${adapter}` };
    const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'probe', cwd: projectRoot });
    const res = spawnSync(process.execPath, [adapter], { input, encoding: 'utf8', timeout: 20000 });
    if (res.status !== 0) return { ok: false, reason: `adapter exited ${res.status}: ${String(res.stderr || '').trim()}` };
    if (!String(res.stdout || '').includes('hookSpecificOutput')) return { ok: false, reason: 'adapter produced no hook envelope' };
    return { ok: true, reason: null };
}

function installTakeoverHooks(settingsPath, { events, projectRoot }) {
    const existing = readSettingsStrict(settingsPath);            // 损坏 → 抛,原文件不动
    const probe = probeAdapter(projectRoot);                       // probe 先行
    if (!probe.ok) throw new Error(`takeover install: adapter probe failed (${probe.reason}); settings unchanged`);
    const before = JSON.stringify(existing);
    const merged = mergeHookConfig(existing, managedFragment(events));
    const serialized = JSON.stringify(merged, null, 2) + '\n';
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.evo-tmp-${process.pid}`;
    fs.writeFileSync(tmp, serialized, 'utf8');
    fs.renameSync(tmp, settingsPath);                              // 原子替换
    return { changed: JSON.stringify(merged) !== before };
}

function statusTakeoverHooks(settingsPath, events) {
    const cfg = readSettingsStrict(settingsPath);                  // 损坏 → 抛(不误报 all-missing)
    const hooks = cfg.hooks || {};
    const installed = [], missing = [];
    for (const ev of events) {
        (Array.isArray(hooks[ev]) && hooks[ev].some(isManagedGroup) ? installed : missing).push(ev);
    }
    return { installed, missing };
}

module.exports = { MANAGED_MARK, HOOK_COMMAND, managedGroup, managedFragment, isManagedGroup,
    mergeHookConfig, probeAdapter, installTakeoverHooks, statusTakeoverHooks };
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-installer passed`。

- [ ] **Step 5: 加 `mem takeover install|status`**

在 `buildProgram()` 内 bootstrap 注册之后新增:

```javascript
    const takeoverCmd = program.command('takeover').description('Agent Takeover Trigger Protocol host-adapter management.');
    takeoverCmd.command('install')
        .option('--events <list>', 'Comma-separated events', 'SessionStart,UserPromptSubmit')
        .option('--settings <path>', 'Path to settings.json', '.claude/settings.json')
        .action(options => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const events = options.events.split(',').map(s => s.trim()).filter(Boolean);
            const res = ti.installTakeoverHooks(options.settings, { events, projectRoot: rc.canonicalProjectRoot() });
            console.log(res.changed ? `✅ takeover hooks installed (${events.join(', ')})` : '✅ takeover hooks already in sync');
        });
    takeoverCmd.command('status')
        .option('--events <list>', 'Comma-separated events', 'SessionStart,UserPromptSubmit,PreToolUse')
        .option('--settings <path>', 'Path to settings.json', '.claude/settings.json')
        .action(options => {
            const ti = require('./takeover-install');
            const events = options.events.split(',').map(s => s.trim()).filter(Boolean);
            const s = ti.statusTakeoverHooks(options.settings, events);
            console.log(`installed: ${s.installed.join(', ') || '(none)'} | missing: ${s.missing.join(', ') || '(none)'}`);
        });
```

- [ ] **Step 6: manifest 注册五文件**

`templates/cli/template-manifest.js` core-cli `files` 数组中 `'memory-index-lock.js',` 之后插入:

```javascript
            'takeover-payload.js',
            'takeover-receipt.js',
            'takeover-session.js',
            'takeover-adapter.js',
            'takeover-install.js',
```

- [ ] **Step 7: integration 覆盖守卫 + gitignore**

`templates/cli/test/integration.js:427` 的 `'memory-index-lock.js',` 之后插入:

```javascript
                'takeover-payload.js', 'takeover-receipt.js', 'takeover-session.js',
                'takeover-adapter.js', 'takeover-install.js',
```

项目根 `.gitignore` 末尾追加:

```gitignore
# Agent Takeover Trigger Protocol — session-bound receipts (generated, never committed)
.evo-lite/generated/takeover/receipts/
```

- [ ] **Step 8: 同步镜像 + 双运行零 + 全套件**

```bash
node templates/cli/sync-runtime-entry.js
node templates/cli/sync-runtime-entry.js
node templates/cli/test.js all
```
Expected: 首次复制五文件;二次 `copied: 0`;`test.js all` 全绿。

- [ ] **Step 9: 母仓安装 + dogfood**

```bash
node templates/cli/memory.js takeover install --events SessionStart,UserPromptSubmit --settings .claude/settings.json
node templates/cli/memory.js takeover status --settings .claude/settings.json
```
用 `claude -p` 跑裸 prompt("分析当前项目正在做什么,下一步该做什么"),记录到 `docs/validation/attp-phase1-dogfood.md`:
- 首次推理前上下文含 `[evo-lite takeover]` payload;每轮 capsule `takeover-active`;
- receipt 落 `.evo-lite/generated/takeover/receipts/claude-code/` 为 committed;
- **在子目录 cwd 下**仍生效(证明 `$CLAUDE_PROJECT_DIR` 可用);
- Agent 首轮明确引用 injected focus(S9b,P2 效果证据)。

- [ ] **Step 10: 提交 + 阶段 1 复审门**

```bash
git add templates/cli/takeover-install.js templates/cli/memory.js templates/cli/template-manifest.js templates/cli/test/ .gitignore .evo-lite/cli/ .claude/settings.json docs/validation/attp-phase1-dogfood.md
git commit -m "$(cat <<'EOF'
feat(takeover): transactional capability-gated installer + manifest/gitignore/mirror + phase-1 dogfood

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

停止,请求阶段 1 复审门(P0 determinism)。**获批前不进入阶段 2。**

---

# 阶段 2 —— 不可静默绕过(复审门 2:P0 no-silent-bypass)

> **前置:阶段 1 复审门已通过。**

## Task 7: PreToolUse fail-closed 守卫(完整 health gate + target-path 绑定)

**Files:**
- Modify: `templates/cli/takeover-adapter.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-guard`、`T-takeover-target-path`、`T-takeover-session-scope`)

**Interfaces:** `handlePreToolUse(input, deps)` → `{ json:{ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision, permissionDecisionReason? } }, exitCode:0, publish:null }`。

- [ ] **Step 1: 写失败测试(守卫矩阵 + 未知目标 + 坏 capsule)**

```javascript
console.log('T-takeover-guard. Edit/Write fail-closed incl unknown target and invalid capsule ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-guard-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'g';
    const call = async (tool, tin, deps) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: tool, tool_input: tin || {} }, { projectRoot: root, ...(deps || {}) })).json.hookSpecificOutput;

    assert.strictEqual((await call('Read')).permissionDecision, 'allow');
    assert.strictEqual((await call('Glob')).permissionDecision, 'allow');
    assert.strictEqual((await call('Bash')).permissionDecision, 'allow', 'Bash excluded from guard');
    const noRcpt = await call('Write', { file_path: path.join(root, 'a.txt') });
    assert.strictEqual(noRcpt.permissionDecision, 'deny', 'no receipt → deny');
    assert.ok(/memory\.js' bootstrap --receipt/.test(noRcpt.permissionDecisionReason), 'deny reason carries recovery command');

    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual((await call('Write', { file_path: path.join(root, 'src', 'a.txt') })).permissionDecision, 'allow', 'in-project allow');
    assert.strictEqual((await call('Write', {})).permissionDecision, 'deny', 'missing target → fail-closed');
    assert.strictEqual((await call('Write', { file_path: 123 })).permissionDecision, 'deny', 'non-string target → fail-closed');
    // 坏 capsule(builder 被注入返回垃圾)→ validateCapsule 失败 → deny
    const badCap = await call('Write', { file_path: path.join(root, 'a.txt') }, { buildPayload: () => ({ unexpected: true }) });
    assert.strictEqual(badCap.permissionDecision, 'deny', 'invalid capsule → deny (validator actually runs)');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-guard passed');
}
```

- [ ] **Step 2: 运行验证失败** — PreToolUse 未纳管。

- [ ] **Step 3: 实现 `handlePreToolUse`**

在 `takeover-adapter.js` 新增(并在 `handleHookInput` switch 增 `case 'PreToolUse': return handlePreToolUse(input, deps);`):

```javascript
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const GUARDED_WRITE_TOOLS = new Set(['Edit', 'Write']); // MVP:NotebookEdit 待 probe 证明工具名+输入 schema

function ptu(decision, reason) {
    const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision };
    if (reason) hookSpecificOutput.permissionDecisionReason = reason;
    return { json: { hookSpecificOutput }, exitCode: 0, publish: null };
}

function handlePreToolUse(input, deps) {
    const tool = input.tool_name;
    if (READONLY_TOOLS.has(tool) || tool === 'Bash') return ptu('allow');
    if (!GUARDED_WRITE_TOOLS.has(tool)) return ptu('allow');

    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot);
    const sessionId = input.session_id;
    const recovery = buildRecoveryCommand(projectRoot, sessionId);

    // (a) committed receipt
    if (rc.readReceipt(projectRoot, HOST, sessionId).state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover required before writing. Run: ${recovery}`);
    }
    // (b) active_context 可读 + reconcile 非 degraded
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    if (verdict.transition === 'degraded' || verdict.state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover unhealthy (${verdict.reason || verdict.transition}). Run: ${recovery}`);
    }
    // (b2) 构建 refresh capsule → validateCapsule → 字节预算
    const build = deps.buildPayload || buildTakeoverPayload;
    let capsule;
    try {
        capsule = build({ kind: 'refresh', host: HOST, sessionId, projectRoot, projectName: path.basename(projectRoot),
            sourceEvent: 'PreToolUse', focus: focus.text, focusHash: focus.hash,
            receiptVerdict: verdict, recoveryAction: recovery }, CAPSULE_BUDGET_BYTES);
    } catch (e) { return ptu('deny', `[evo-lite] takeover payload build failed (${e.message}). Run: ${recovery}`); }
    const capVerdict = validateCapsule(capsule, CAPSULE_BUDGET_BYTES);
    if (!capVerdict.ok) return ptu('deny', `[evo-lite] takeover payload invalid (${capVerdict.errors.join(',')}). Run: ${recovery}`);

    // (c) target-path fail-closed
    const ti = input.tool_input;
    const target = ti && typeof ti === 'object' ? ti.file_path : null;
    if (!target || typeof target !== 'string') {
        return ptu('deny', `[evo-lite] cannot determine target path; refusing write. Run: ${recovery}`);
    }
    let abs = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    let probe = abs;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { probe = fs.realpathSync(probe); } catch (_) { /* 不可解析时用最近存在父目录原路径 */ }
    const cp = probe.replace(/\\/g, '/'), cr = projectRoot.replace(/\\/g, '/');
    if (!(cp === cr || cp.startsWith(cr + '/'))) {
        return ptu('deny', `[evo-lite] target '${target}' resolves outside project '${projectRoot}'.`);
    }
    return ptu('allow');
}
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-guard passed`。

- [ ] **Step 5: 写 target-path(含 symlink)+ session-scope 测试**

```javascript
console.log('T-takeover-target-path. cross-project / .. escape / symlink escape denied ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-tp-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-other-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'tp';
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    const dec = async (tin) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Write', tool_input: tin }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(await dec({ file_path: path.join(other, 'x.js') }), 'deny', 'cross-project deny');
    assert.strictEqual(await dec({ file_path: path.join(root, '..', 'esc.js') }), 'deny', 'parent escape deny');
    assert.strictEqual(await dec({ file_path: path.join(root, 'ok.js') }), 'allow', 'in-project allow');

    // symlink 逃逸:project/link → other;POSIX 必测,win32 无权限时跳过并显式说明
    const link = path.join(root, 'link');
    let linked = false;
    try { fs.symlinkSync(other, link, 'junction'); linked = true; }
    catch (_) { try { fs.symlinkSync(other, link, 'dir'); linked = true; } catch (_) { linked = false; } }
    if (linked) {
        assert.strictEqual(await dec({ file_path: path.join(link, 'x.js') }), 'deny', 'symlink/junction escape deny');
    } else {
        assert.strictEqual(process.platform, 'win32', 'symlink creation may only be skipped on win32 without privilege');
        console.log('   ⏭️ symlink escape case skipped (win32 without symlink privilege)');
    }
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
    console.log('✅ T-takeover-target-path passed');
}

console.log('T-takeover-session-scope. no receipt → deny; committed+healthy → allow; governance-health fail → deny ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-ss-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    const wf = () => fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    wf();
    const canon = rc.canonicalProjectRoot(root), sid = 'ss';
    const w = async () => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.js') } }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(await w(), 'deny', 'no receipt → deny');
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual(await w(), 'allow', 'committed + healthy → allow');
    fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
    assert.strictEqual(await w(), 'deny', 'governance-health failure → deny (health gate, not unconditional allow)');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-session-scope passed');
}
```

- [ ] **Step 6: 运行验证通过 + 镜像 + 提交**

```bash
node templates/cli/test.js governance
node templates/cli/sync-runtime-entry.js && node templates/cli/sync-runtime-entry.js
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "$(cat <<'EOF'
feat(takeover): PreToolUse fail-closed guard — capsule validator health gate + target-path binding (symlink escape denied)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 故障注入验收(逐条对应复审门)+ 复审门 2

**Files:**
- Test: `templates/cli/test/governance.js`(`T-takeover-fault-suite`)
- Modify: `.claude/settings.json`(installer events 增 `PreToolUse`)
- Create: `docs/validation/attp-phase2-fault-injection.md`

- [ ] **Step 1: 写故障注入测试(七条断言,均用注入 seam 真实制造失败)**

```javascript
console.log('T-takeover-fault-suite. injected failures per review-gate assertion ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const ts = require(path.join(TEMPLATE_CLI_DIR, 'takeover-session.js'));
    const mkRoot = () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-f-'));
        const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
        fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
        return { root, ac };
    };
    const goodCollect = (base) => ts.assembleSessionContext(base, {
        summary: {}, sessionstart: { contextStatus: 'configured', architectureStatus: 'configured', activeTaskCount: 0, reminders: ['r'], warnings: [] },
        verify: { hasAlerts: false, nextSteps: [] }, recall: { status: 'no-match' },
        planSpec: { plan: null, spec: null }, freshness: { headSha: 'a', ahead: 0, behind: 0 }, degraded: [] });
    const writeDec = async (root, sid) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid,
        tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.js') } }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;

    // 1) receipt 发布失败(rename 抛)→ 非零 + 无 committed
    { const { root } = mkRoot();
      const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f1', source: 'startup' }, { projectRoot: root, collect: goodCollect });
      rc.__setFsOps({ renameSync: () => { throw new Error('rename fail'); } });
      let res; try { res = ad.executeHookTransport(r.json, r.publish, { write: () => {} }); } finally { rc.__resetFsOps(); }
      assert.strictEqual(res.exitCode, 1, 'publish failure → nonzero');
      assert.notStrictEqual(rc.readReceipt(root, 'claude-code', 'f1').state, 'committed', 'no committed receipt when publish fails');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 2) 坏 session payload(collector 返回残缺)→ 校验拦截 → 无 committed + 非零
    { const { root } = mkRoot();
      const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f2', source: 'startup' },
          { projectRoot: root, collect: (b) => ({ ...b, kind: 'session', projectName: 'p' }) }); // 缺 rules/health/verify...
      assert.strictEqual(r.exitCode, 1, 'invalid payload → nonzero');
      assert.strictEqual(r.publish, null, 'invalid payload → no publish');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f2').state, 'missing');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 3) collector 抛错(不可恢复)→ 无 committed + 非零 + 明示恢复命令
    { const { root } = mkRoot();
      const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f3', source: 'startup' },
          { projectRoot: root, collect: () => { throw new Error('initDB boom'); } });
      assert.strictEqual(r.exitCode, 1); assert.strictEqual(r.publish, null);
      assert.ok(/bootstrap --receipt/.test(r.json.hookSpecificOutput.additionalContext), 'degraded context carries recovery command');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 4) 失效双失败(tombstone + unlink 均抛)后:旧 committed 仍在盘上,但 Write 仍被 health gate deny
    { const { root, ac } = mkRoot(); const canon = rc.canonicalProjectRoot(root);
      rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 'f4', projectRoot: canon,
          state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
      fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
      rc.__setFsOps({ writeFileSync: () => { throw new Error('tombstone fail'); }, unlinkSync: () => { throw new Error('unlink fail'); } });
      let dec; try { dec = await writeDec(root, 'f4'); } finally { rc.__resetFsOps(); }
      assert.strictEqual(dec, 'deny', 'health gate denies even when invalidation persistence double-fails');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f4').state, 'committed', 'stale receipt indeed survived on disk');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 5) source=resume/clear 且 receipt 缺失 → 走 establishment(不因 source 跳过)
    { const { root } = mkRoot();
      for (const source of ['resume', 'clear']) {
          const sid = `f5-${source}`;
          const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, source }, { projectRoot: root, collect: goodCollect });
          assert.strictEqual(typeof r.publish, 'function', `${source} with missing receipt must establish`);
          ad.executeHookTransport(r.json, r.publish, { write: () => {} });
          assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'committed', `${source} established committed receipt`);
      }
      fs.rmSync(root, { recursive: true, force: true }); }

    // 6) CLI write 失败 → 不 publish;CLI 输出非 hook envelope
    { let published = false;
      const bad = ad.executeCliRecoveryTransport('X', () => { published = true; }, { write: () => { throw new Error('cli stdout fail'); } });
      assert.strictEqual(bad.exitCode, 1); assert.strictEqual(published, false, 'CLI delivery failure → no publish'); }

    // 7) recovery 执行后 Write 解锁(端到端子进程)
    { const { root, ac } = mkRoot();
      const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
      const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt', '--host', 'claude-code',
          '--session-id', 'f7', '--source', 'manual-recovery', '--json'],
          { cwd: root, env: { ...process.env, EVO_LITE_ROOT: ac, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
      assert.strictEqual(sub.status, 0, `recovery ok (stderr: ${sub.stderr})`);
      assert.strictEqual(await writeDec(root, 'f7'), 'allow', 'Write unlocked after explicit recovery');
      fs.rmSync(root, { recursive: true, force: true }); }

    console.log('✅ T-takeover-fault-suite passed');
}
```

- [ ] **Step 2: 运行验证通过** — `✅ T-takeover-fault-suite passed`。

- [ ] **Step 3: 装 PreToolUse + 全套件回归**

```bash
node templates/cli/memory.js takeover install --events SessionStart,UserPromptSubmit,PreToolUse --settings .claude/settings.json
node templates/cli/memory.js takeover status --settings .claude/settings.json
node templates/cli/test.js all
```
Expected: 三事件已装、第三方 hooks 保留;`test.js all` 全绿。

- [ ] **Step 4: 记录 + 提交**

```bash
git add templates/cli/test/governance.js .claude/settings.json docs/validation/attp-phase2-fault-injection.md .evo-lite/cli/
git commit -m "$(cat <<'EOF'
test(takeover): phase-2 fault-injection acceptance — seam-injected failures per review-gate assertion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 复审门 2 + 阶段收口** — 停止请求复审门(P0 no-silent-bypass)。两 P0 均达成后,进入治理闭环(`mem` intake spec + plan closure)与 hive nurture 分发。

---

## 复审落点(R1-plan / R2-plan)

| 编号 | 问题 | R3 落点 |
|---|---|---|
| R1 P0-1..P0-5 | builder 未统一 / transport 顺序 / 根发现 / 守卫 fail-open / 测试不足 | 见下 R2 各条(R3 已在其基础上继续收紧) |
| R2 P0-1 | collector 取不存在的 `summary.activePlan`;verify/recall 静默吞;丢 `inspectLocalState` | Task 3 collector 收集**四件套**(summary/sessionstart/verify/recall)+ plan-ir 派生 `derivePlanSpec`(按 focus 匹配,**不按 status==='active'**)+ meta freshness;可恢复失败入 `degraded[]` 并置 `attention-needed`,不可恢复抛错;Task 1 `validateSessionPayload` 覆盖 active/risks/freshness/health/verify/recall/degraded 全字段;三入口 transport 前强制校验 |
| R2 P0-2 | CLI transport 未确认交付、错误不显式 | Task 4 `writeAllSync`(循环 partial write)+ 两 transport 共用 `runTransport`;失败写 stderr 且非零;CLI **先输出 payload 后发布**,不打印发布前完成态文案 |
| R2 P0-3 | `canonicalProjectRoot` 静默接受非项目目录 | Task 2 `discoverProjectRoot` 找不到即抛;`canonicalProjectRoot` **无 fail-open 兜底**;测试断言 bare 目录抛错且不创建 `.evo-lite` |
| R2 P0-4 | 守卫未调 validator;session validator 不适用 capsule | Task 1 拆 `validateSessionPayload` / `validateCapsule`;Task 7 守卫按序 build→validateCapsule→预算→target;新增坏 capsule 注入用例 + symlink 逃逸用例 |
| R2 P0-5 | fault suite 未真实注入 | Task 8 用 `__setFsOps` / transport `write` / `deps.collect`+`deps.buildPayload` seam 逐条注入:publish-fail、坏 payload、collector 抛错、失效双失败仍 deny、resume/clear 重建、CLI write 失败、recovery 解锁 |
| R2 P1-1 | 预算 fallback 丢 `focusHash`;死代码 | Task 1 fallback 保 `focusHash:null`;删除 `assemble`/`cand` 死代码;测试断言四个固定键在 fallback 中齐全 |
| R2 P1-2 | `status` 吞损坏 JSON | Task 6 `readSettingsStrict` 供 install 与 status 共用,损坏均抛 |
| R2 P1-3 | capability gate 在安装之后 | Task 6 `probeAdapter` **安装前**执行,失败抛错且不写 settings;写入用 temp+rename 原子替换 |
| R2 P1-4 | 占位式步骤 | R3 给出 `formatBootstrapReport` 完整替换代码、`integration.js:427` 精确插入位置、`sync-runtime-entry.js` 确认存在 |
| R2 P1-5 | collector 缺初始化契约 | Task 3 collector 自调 `require('./db').initDB()`(失败即不可恢复抛错);`T-takeover-collector` 用**全新子进程**证明真实 verify/recall 可得 |

## 附:实现期须复核的开放点(非阻断)

- `formatBootstrapReport` 替换后,若仓库内还有其他调用点依赖旧 `{context,sessionstart,verify,takeoverRecall}` 结构,一并适配(实现前 `grep -rn "formatBootstrapReport" templates/cli/`)。
- `collectSessionTakeoverContextFull` 每次 SessionStart 跑 `verify({silent:true})`;若 dogfood 实测拖慢会话启动,可在 session 路径加缓存(不影响 refresh —— 后者不调 collector)。
- `SessionStart(compact)` / `CwdChanged`:probe 列为待实测优化器,阶段 2 后以 echo-harness 验证再决定纳管。
- nurture 分发:子仓获取 hook 需在 nurture 侧调 `mem takeover install`;本 MVP 只保证 installer 幂等可用。
