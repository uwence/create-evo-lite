# Agent Takeover Trigger Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让裸 prompt 下的 Claude Code Agent 无需用户提醒即确定性地进入 Evo-Lite 项目接管,并在无有效接管上下文时对 Edit/Write fail-closed。

**Architecture:** 三层协议 —— ①host-agnostic 纯函数 builder(`takeover-payload.js`)由 adapter 与 `mem bootstrap` 共同消费;②Claude Code 生命周期 adapter(`takeover-adapter.js`)在 SessionStart 注入完整 payload、每轮 UserPromptSubmit 无条件注入 ≤1 KiB 状态反射 capsule,并按"是否已有有效 committed receipt"判 establishment/refresh;③PreToolUse fail-closed 守卫(health gate + target-path 绑定)。receipt(`takeover-receipt.js`)session-scoped、ordered publication 发布、硬字段 fail-closed。

**Tech Stack:** Node.js (CommonJS), commander (现有 CLI), Claude Code hooks (SessionStart/UserPromptSubmit/PreToolUse, `hookSpecificOutput.additionalContext` / `permissionDecision`), 现有 `test/harness.js` + assert 测试骨架。

**契约文档(canonical):** `docs/superpowers/specs/2026-07-24-agent-takeover-trigger-protocol-design.md`(R5 APPROVED)。分歧时以设计文档为准。
**probe 证据:** `docs/validation/attp-cc-capability-probe.md`(装机 2.1.218,基线三事件 FULLY-OBSERVED)。

## Global Constraints

- **宿主范围:** 仅 Claude Code(MVP)。非 Claude 宿主只保留静态规则 fallback,不实现生命周期 adapter。
- **builder 纯函数:** `takeover-payload.js` 无 IO、无 `process.env`、无 hook input 读取;只接受已归一化的 discriminated context,返回 payload/capsule。
- **不变量 6(refresh 隔离):** refresh call graph **不得加载** `memory.service` / `db` / `memory-index` / zvec;refresh 只经 `runtime.js`(轻量路径)+ `fs` 读 receipt + active_context 的 FOCUS 锚点。
- **receipt session-scoped:** establishment 还是 refresh 由"当前 host/sessionId/projectRoot 下是否已有有效 committed receipt"判定,**不由 `SessionStart.source`**;`sourceEvent` 仅诊断字段。
- **硬有效性字段:** `state==="committed"` 且 `schemaVersion`+`host`+`sessionId`+`projectRoot` 全匹配且文件可解析;缺失/损坏/`state!=="committed"`/任一硬字段不符 → invalid。软字段 `focusHash`/`payloadHash`/`generatedAt`/`sourceEvent`/`reason` 不参与 fail-closed。
- **ordered publication(非原子):** 先"完整序列化并写出注入" → 再"原子 rename 发布 committed receipt";发布后无其他可失败操作。Hook transport 与 CLI recovery transport envelope 不同(Bash stdout ≠ additionalContext)。
- **receipt 存放:** `.evo-lite/generated/takeover/receipts/claude-code/<sha256(host\0sessionId)>.json`,temp+rename 原子写,**gitignore、不入模板真相源、不提交**;TTL 仅 GC 不作硬有效性。
- **capsule 预算:** 量最终注入的 additionalContext UTF-8 字节数,硬上限 **1 KiB**;裁剪顺序:永不删 `evoLite`/`receipt`/`project`/`focusHash`,先裁 `focus` 文本(带 `focusHash`+`truncated:true`),异常态保 `reason`/`action`;按 Unicode code point 边界截断,绝不产出无效 UTF-8/JSON。健康 capsule 不含 `action`/`refresh`(状态反射,非行为指令)。
- **恢复命令:** canonical-root-bound shell-neutral `node '<canonicalProjectRoot>/.evo-lite/cli/memory.js' bootstrap --receipt --host claude-code --session-id '<bash-escaped>' --source manual-recovery --json`;root/CLI 路径/sessionId 按 **Bash(非 OS)** 引用;不依赖裸相对路径或全局 `mem`。
- **守卫(阶段2):** Edit/Write fail-closed(health gate:committed + active_context 可读 + refresh 构建成功 + target-path 落 receipt.projectRoot 内);Read/Glob/Grep 恒 allow;**Bash 排除出守卫**(全 allow);NotebookEdit 仅 probe 证明工具名存在才纳入。
- **installer:** `.claude/settings.json` 幂等 **deep-merge**(保留未知字段与第三方 hooks),**禁整文件覆盖**;status/diff 只比 Evo-Lite 托管的 hook identity。
- **镜像:** 新文件落 `templates/cli/**`;**不手改 `.evo-lite/cli/**` 镜像**;`mem sync-runtime` 生成后 `git add` 镜像;`sync-runtime` 二次运行须 `copied: 0`。
- **两阶段两复审门:** 阶段1(Task 1–6)获独立复审门批准后,才进入阶段2(Task 7–8)。implementation 各任务经 SDD 独立复审。
- **语言:** 用户可见文本中文;代码标识符/日志 keyword 英文。commit trailer:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

# 阶段 1 —— 确定性接管(复审门 1:P0 determinism)

## Task 1: 纯函数 builder + capsule 投影(`takeover-payload.js`)

**Files:**
- Create: `templates/cli/takeover-payload.js`
- Test: `templates/cli/test/governance.js`(新增 `T-takeover-payload`、`T-takeover-capsule-states` 用例块,在 `runGovernanceTests()` 内)

**Interfaces:**
- Produces:
  - `buildTakeoverPayload(context, budget)` → `TakeoverPayload | Capsule`
    - `context.kind === "session"`(`SessionTakeoverContext`)→ 完整 `TakeoverPayload`(JS 对象)
    - `context.kind === "refresh"`(`RefreshTakeoverContext`)→ `Capsule`(JS 对象,`buildCapsule` 保证序列化 ≤ `budget` 字节)
  - `SCHEMA_VERSION = 1`
  - `CAPSULE_BUDGET_BYTES = 1024`
  - `TRANSITION_TO_EVOLITE = { active:'takeover-active', refreshed:'takeover-refreshed', stale:'takeover-stale', degraded:'takeover-degraded' }`
- 纯函数:无 `require('fs')`、无 `require('./memory.service')`、无 `process.env`、无 hook input。

- [ ] **Step 1: 写失败测试(payload + capsule 基本形态)**

在 `templates/cli/test/governance.js` 的 `runGovernanceTests()` try 块内(在 T13 之前或之后均可,保持顺序清晰)新增:

```javascript
console.log('T-takeover-payload. Pure builder produces payload + budgeted capsule ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    // session payload：含设计 §3 全字段
    const sessionCtx = {
        kind: 'session', host: 'claude-code', sessionId: 's1',
        projectRoot: '/p', projectName: 'proj', sourceEvent: 'SessionStart:startup',
        focus: 'FOCUS-LINE', activePlan: { id: 'plan:x', status: 'active', progress: '1/3' },
        activeSpec: { id: 'spec:x', status: 'active' }, rules: { dir: '.agents/rules/', required: ['evo-lite'] },
        risks: ['r1'], nextAction: 'do x', freshness: { ahead: 0, behind: 0, headSha: 'abc' },
        verify: { status: 'ok' }, recall: [{ id: 'm1' }],
    };
    const payload = tp.buildTakeoverPayload(sessionCtx, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(payload.schemaVersion, 1, 'payload has schemaVersion');
    assert.strictEqual(payload.host, 'claude-code');
    assert.strictEqual(payload.project.name, 'proj');
    assert.strictEqual(payload.focus.text, 'FOCUS-LINE');
    assert.strictEqual(payload.active.plan.id, 'plan:x');
    assert.strictEqual(payload.nextAction, 'do x');
    assert.strictEqual(payload.verify.status, 'ok');

    // refresh capsule：≤ budget，且经单一 builder
    const refreshCtx = {
        kind: 'refresh', host: 'claude-code', sessionId: 's1', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus: 'FOCUS-LINE', focusHash: 'h1',
        receiptVerdict: { state: 'committed', transition: 'active', reason: null }, recoveryAction: null,
    };
    const capsule = tp.buildTakeoverPayload(refreshCtx, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(capsule.evoLite, 'takeover-active');
    assert.strictEqual(capsule.receipt, 'valid');
    assert.ok(!('action' in capsule), 'healthy capsule has no action');
    assert.ok(!('refresh' in capsule), 'healthy capsule has no refresh directive');
    assert.ok(Buffer.byteLength(JSON.stringify(capsule), 'utf8') <= tp.CAPSULE_BUDGET_BYTES, 'capsule within budget');
    console.log('✅ T-takeover-payload passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-payload.js'`。

- [ ] **Step 3: 实现 `takeover-payload.js`(纯函数)**

```javascript
'use strict';
// Agent Takeover Trigger Protocol —— host-agnostic 纯函数 builder。
// 严禁 IO / env / hook input:只接受已归一化的 discriminated context。
const SCHEMA_VERSION = 1;
const CAPSULE_BUDGET_BYTES = 1024;
const TRANSITION_TO_EVOLITE = {
    active: 'takeover-active', refreshed: 'takeover-refreshed',
    stale: 'takeover-stale', degraded: 'takeover-degraded',
};

function buildSessionPayload(ctx) {
    return {
        schemaVersion: SCHEMA_VERSION,
        host: ctx.host,
        generatedAt: ctx.generatedAt || null, // adapter 传入(纯函数不取时钟)
        sourceEvent: ctx.sourceEvent,
        project: { name: ctx.projectName, root: ctx.projectRoot },
        focus: { text: ctx.focus, hash: ctx.focusHash || null, updatedAt: ctx.focusUpdatedAt || null },
        active: { plan: ctx.activePlan || null, spec: ctx.activeSpec || null },
        rules: ctx.rules || { dir: '.agents/rules/', required: [] },
        risks: Array.isArray(ctx.risks) ? ctx.risks : [],
        nextAction: ctx.nextAction || null,
        freshness: ctx.freshness || null,
        verify: ctx.verify || null,
        recall: Array.isArray(ctx.recall) ? ctx.recall : [],
    };
}

// 按 Unicode code point 边界截断到 maxBytes 的 UTF-8 字节内
function truncateToBytes(text, maxBytes) {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
    const chars = Array.from(text); // code point 数组
    let out = '';
    for (const ch of chars) {
        if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
        out += ch;
    }
    return { text: out, truncated: true };
}

function buildCapsule(ctx, budget) {
    const evoLite = TRANSITION_TO_EVOLITE[ctx.receiptVerdict.transition] || 'takeover-degraded';
    const receipt = ctx.receiptVerdict.state === 'committed' ? 'valid' : 'invalid';
    const anomaly = evoLite === 'takeover-stale' || evoLite === 'takeover-degraded';

    // 固定字段永不删除
    const base = { evoLite, project: ctx.projectName || 'unknown', receipt, focusHash: ctx.focusHash || null };
    if (anomaly && ctx.recoveryAction) base.action = ctx.recoveryAction;
    if (ctx.receiptVerdict.reason) base.reason = ctx.receiptVerdict.reason;

    // focus 文本按预算裁剪(先算固定部分占用)
    const focusText = ctx.focus == null ? 'unknown' : String(ctx.focus);
    const withFocusFull = { ...base, focus: focusText };
    if (Buffer.byteLength(JSON.stringify(withFocusFull), 'utf8') <= budget) return withFocusFull;

    const fixedBytes = Buffer.byteLength(JSON.stringify({ ...base, focus: '' }), 'utf8');
    const room = budget - fixedBytes;
    if (room > 0) {
        const cut = truncateToBytes(focusText, room);
        const out = { ...base, focus: cut.text };
        if (cut.truncated) out.truncated = true;
        if (Buffer.byteLength(JSON.stringify(out), 'utf8') <= budget) return out;
    }
    // 最小异常 capsule 仍超限 → 固定短错误码 + 恢复命令
    return { evoLite: 'takeover-degraded', project: ctx.projectName || 'unknown', receipt: 'invalid',
        reason: 'capsule-budget-exceeded', action: ctx.recoveryAction || null };
}

function buildTakeoverPayload(context, budget = CAPSULE_BUDGET_BYTES) {
    if (!context || typeof context !== 'object') throw new Error('takeover: context required');
    if (context.kind === 'session') return buildSessionPayload(context);
    if (context.kind === 'refresh') return buildCapsule(context, budget);
    throw new Error(`takeover: unknown context.kind ${context.kind}`);
}

module.exports = { buildTakeoverPayload, SCHEMA_VERSION, CAPSULE_BUDGET_BYTES, TRANSITION_TO_EVOLITE };
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-payload passed`。

- [ ] **Step 5: 写状态映射 + 预算裁剪测试**

在 T-takeover-payload 之后新增:

```javascript
console.log('T-takeover-capsule-states. Four transitions map + budget trim ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const mk = (transition, state, reason = null, action = null, focus = 'F') => tp.buildTakeoverPayload({
        kind: 'refresh', host: 'claude-code', sessionId: 's', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus, focusHash: 'h',
        receiptVerdict: { state, transition, reason }, recoveryAction: action,
    }, tp.CAPSULE_BUDGET_BYTES);

    assert.strictEqual(mk('active', 'committed').evoLite, 'takeover-active');
    assert.strictEqual(mk('refreshed', 'committed').evoLite, 'takeover-refreshed');
    const stale = mk('stale', 'invalid', null, 'RECOVER_CMD');
    assert.strictEqual(stale.evoLite, 'takeover-stale');
    assert.strictEqual(stale.receipt, 'invalid');
    assert.strictEqual(stale.action, 'RECOVER_CMD', 'anomaly capsule carries action');
    const degraded = mk('degraded', 'invalid', 'active-context-unreadable', 'RECOVER_CMD');
    assert.strictEqual(degraded.reason, 'active-context-unreadable');

    // 超长 focus → 截断 + focusHash 保留 + 仍 ≤ budget + 合法 JSON
    const longFocus = '焦'.repeat(5000);
    const trimmed = mk('active', 'committed', null, null, longFocus);
    assert.ok(Buffer.byteLength(JSON.stringify(trimmed), 'utf8') <= tp.CAPSULE_BUDGET_BYTES, 'trimmed within budget');
    assert.strictEqual(trimmed.truncated, true, 'marks truncated');
    assert.strictEqual(trimmed.focusHash, 'h', 'focusHash preserved when focus trimmed');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(trimmed)), 'valid JSON after truncation');
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
feat(takeover): pure-function payload builder + budgeted state-reflective capsule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: receipt 层(`takeover-receipt.js`)—— schema / canonicalProjectRoot / focus 读取 / 有效性 / reconcile / ordered publication / 失效事务

**Files:**
- Create: `templates/cli/takeover-receipt.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-receipt`、`T-takeover-reconcile`、`T-takeover-degraded`)

**Interfaces:**
- Consumes: `require('./runtime')` 的 `getWorkspaceRoot`、`getActiveContextPath`(轻量,不载 db)。
- Produces:
  - `canonicalProjectRoot(startDir?)` → string(discover root → `path.resolve` → `fs.realpathSync` → win32 盘符大写 + 正斜杠)
  - `receiptPathFor(dir, host, sessionId)` → string(`<dir>/generated/takeover/receipts/<host>/<sha256(host\0sessionId)>.json`)
  - `readFocusAnchor(projectRoot)` → `{ text, hash }`(**仅 fs + runtime,不载 memory.service**;读 active_context 的 FOCUS 锚点)
  - `readReceipt(dir, host, sessionId, projectRoot)` → `{ state:'committed'|'missing'|'invalid', reason, receipt|null }`
  - `publishReceipt(dir, receiptObj)` → void(temp+rename 原子)
  - `invalidateReceipt(dir, host, sessionId, projectRoot, reason)` → `{ ok, method:'tombstone'|'unlink'|'none' }`(tombstone 覆盖 → 回退 unlink)
  - `reconcile({ dir, host, sessionId, projectRoot, currentFocusHash })` → `{ verdict:{ state, transition, reason }, focus }`
  - `RECEIPT_SCHEMA_VERSION = 1`
- refresh 路径(readReceipt/readFocusAnchor/reconcile)**不得** `require('./memory.service')`/`./db`/memory-index/zvec。

- [ ] **Step 1: 写失败测试(ordered publication + 硬有效性 + 文件名)**

```javascript
console.log('T-takeover-receipt. Ordered publication + hard validity + sha256 filename ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const crypto = require('crypto');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-rc-'));
    const host = 'claude-code', sid = 's/1:weird', root = dir;

    // 文件名 = sha256(host \0 sessionId)
    const expectHash = crypto.createHash('sha256').update(`${host}\0${sid}`).digest('hex');
    assert.ok(rc.receiptPathFor(dir, host, sid).includes(`${expectHash}.json`), 'filename = sha256(host\\0sid)');

    // publish committed → readReceipt committed
    rc.publishReceipt(dir, { schemaVersion: 1, host, sessionId: sid, projectRoot: root, state: 'committed',
        focusHash: 'h', payloadHash: 'p', generatedAt: 't', sourceEvent: 'SessionStart:startup' });
    assert.strictEqual(rc.readReceipt(dir, host, sid, root).state, 'committed', 'committed readable');

    // 硬字段不符 → invalid
    assert.strictEqual(rc.readReceipt(dir, host, sid, '/other').state, 'invalid', 'projectRoot mismatch → invalid');
    assert.strictEqual(rc.readReceipt(dir, host, 'other-sid', root).state, 'missing', 'unknown sid → missing');

    // state != committed → invalid
    rc.publishReceipt(dir, { schemaVersion: 1, host, sessionId: sid, projectRoot: root, state: 'invalid', reason: 'x' });
    assert.strictEqual(rc.readReceipt(dir, host, sid, root).state, 'invalid', 'state=invalid → invalid');

    // 损坏文件 → invalid
    fs.writeFileSync(rc.receiptPathFor(dir, host, sid), 'not json', 'utf8');
    assert.strictEqual(rc.readReceipt(dir, host, sid, root).state, 'invalid', 'corrupt → invalid');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-receipt passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-receipt.js'`。

- [ ] **Step 3: 实现 `takeover-receipt.js`**

```javascript
'use strict';
// Agent Takeover Trigger Protocol —— receipt IO / 有效性 / reconcile / ordered publication。
// refresh 路径(readReceipt/readFocusAnchor/reconcile)严禁 require memory.service/db/zvec(不变量6)。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot, getActiveContextPath } = require('./runtime');

const RECEIPT_SCHEMA_VERSION = 1;
const HARD_FIELDS = ['schemaVersion', 'host', 'sessionId', 'projectRoot', 'state'];

function canonicalProjectRoot(startDir) {
    let root = startDir || getWorkspaceRoot();
    let resolved = path.resolve(root);
    try { resolved = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved); }
    catch (_) { /* 目录可能尚不存在,退回 resolve 结果 */ }
    resolved = resolved.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(resolved)) {
        resolved = resolved[0].toUpperCase() + resolved.slice(1);
    }
    return resolved;
}

function receiptDir(dir, host) {
    return path.join(dir, 'generated', 'takeover', 'receipts', host);
}
function receiptPathFor(dir, host, sessionId) {
    const name = crypto.createHash('sha256').update(`${host}\0${sessionId}`).digest('hex');
    return path.join(receiptDir(dir, host), `${name}.json`);
}

function readFocusAnchor(projectRoot) {
    // 轻量:直接读 active_context 的 FOCUS 锚点,不经 memory.service
    let acPath;
    try { acPath = getActiveContextPath(); } catch (_) { acPath = path.join(projectRoot, '.evo-lite', 'active_context.md'); }
    let text = '';
    try {
        const md = fs.readFileSync(acPath, 'utf8');
        const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
        text = (m ? m[1] : '').trim();
    } catch (_) { return null; } // 不可读 → null(触发 degraded)
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    return { text, hash };
}

function publishReceipt(dir, receiptObj) {
    const host = receiptObj.host;
    const finalPath = receiptPathFor(dir, host, receiptObj.sessionId);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    const tmp = path.join(path.dirname(finalPath),
        `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(tmp, JSON.stringify(receiptObj), 'utf8');
    fs.renameSync(tmp, finalPath); // 原子发布
}

function parseReceipt(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return undefined; }
}

function readReceipt(dir, host, sessionId, projectRoot) {
    const p = receiptPathFor(dir, host, sessionId);
    if (!fs.existsSync(p)) return { state: 'missing', reason: null, receipt: null };
    const raw = parseReceipt(p);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'invalid', reason: 'corrupt', receipt: null };
    for (const f of HARD_FIELDS) if (!(f in raw)) return { state: 'invalid', reason: `missing-${f}`, receipt: raw };
    if (raw.state !== 'committed') return { state: 'invalid', reason: raw.reason || 'state-not-committed', receipt: raw };
    if (raw.schemaVersion !== RECEIPT_SCHEMA_VERSION || raw.host !== host
        || raw.sessionId !== sessionId || raw.projectRoot !== projectRoot) {
        return { state: 'invalid', reason: 'identity-mismatch', receipt: raw };
    }
    return { state: 'committed', reason: null, receipt: raw };
}

function invalidateReceipt(dir, host, sessionId, projectRoot, reason) {
    const p = receiptPathFor(dir, host, sessionId);
    // 1) tombstone 原子覆盖
    try {
        publishReceipt(dir, { schemaVersion: RECEIPT_SCHEMA_VERSION, host, sessionId, projectRoot,
            state: 'invalid', reason });
        return { ok: true, method: 'tombstone' };
    } catch (_) { /* 回退 */ }
    // 2) unlink
    try { if (fs.existsSync(p)) fs.unlinkSync(p); return { ok: true, method: 'unlink' }; }
    catch (_) { return { ok: false, method: 'none' }; }
}

function reconcile({ dir, host, sessionId, projectRoot, currentFocusHash }) {
    const rr = readReceipt(dir, host, sessionId, projectRoot);
    const focus = readFocusAnchor(projectRoot);
    if (focus === null) {
        // active_context 不可读 → degraded + 失效已存在 committed
        if (rr.state === 'committed') invalidateReceipt(dir, host, sessionId, projectRoot, 'active-context-unreadable');
        return { verdict: { state: 'invalid', transition: 'degraded', reason: 'active-context-unreadable' }, focus: null };
    }
    if (rr.state !== 'committed') {
        return { verdict: { state: rr.state === 'missing' ? 'missing' : 'invalid', transition: 'stale', reason: rr.reason }, focus };
    }
    // committed:focus 漂移 → 静默刷新 focusHash(不阻断)
    if (rr.receipt.focusHash !== focus.hash) {
        publishReceipt(dir, { ...rr.receipt, focusHash: focus.hash, generatedAt: rr.receipt.generatedAt });
        return { verdict: { state: 'committed', transition: 'refreshed', reason: null }, focus };
    }
    return { verdict: { state: 'committed', transition: 'active', reason: null }, focus };
}

module.exports = {
    RECEIPT_SCHEMA_VERSION, canonicalProjectRoot, receiptPathFor, readFocusAnchor,
    publishReceipt, readReceipt, invalidateReceipt, reconcile,
};
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-receipt passed`。

- [ ] **Step 5: 写 reconcile + degraded 测试**

```javascript
console.log('T-takeover-reconcile. focus drift refreshes (still committed); degraded invalidates ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-rec-'));
    const host = 'claude-code', sid = 's1', root = dir;
    const acDir = path.join(dir, '.evo-lite');
    fs.mkdirSync(acDir, { recursive: true });
    const writeFocus = (t) => fs.writeFileSync(path.join(acDir, 'active_context.md'),
        `x\n<!-- BEGIN_FOCUS -->\n${t}\n<!-- END_FOCUS -->\ny\n`, 'utf8');
    writeFocus('FOCUS-A');
    const focusA = rc.readFocusAnchor(root);
    rc.publishReceipt(dir, { schemaVersion: 1, host, sessionId: sid, projectRoot: root, state: 'committed',
        focusHash: focusA.hash, payloadHash: 'p', generatedAt: 't', sourceEvent: 'SessionStart:startup' });

    // focus 无变化 → active
    assert.strictEqual(rc.reconcile({ dir, host, sessionId: sid, projectRoot: root }).verdict.transition, 'active');

    // focus 漂移 → refreshed 且仍 committed
    writeFocus('FOCUS-B');
    const r2 = rc.reconcile({ dir, host, sessionId: sid, projectRoot: root });
    assert.strictEqual(r2.verdict.transition, 'refreshed');
    assert.strictEqual(rc.readReceipt(dir, host, sid, root).state, 'committed', 'focus drift keeps committed');
    console.log('✅ T-takeover-reconcile passed');

    console.log('T-takeover-degraded. active_context unreadable → tombstone/unlink invalidation ...');
    fs.rmSync(path.join(acDir, 'active_context.md'), { force: true });
    const rd = rc.reconcile({ dir, host, sessionId: sid, projectRoot: root });
    assert.strictEqual(rd.verdict.transition, 'degraded');
    assert.strictEqual(rc.readReceipt(dir, host, sid, root).state, 'invalid', 'degraded truly revokes committed receipt');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-degraded passed');
}
```

> 注:该测试用例向临时目录写 `active_context.md` 并让 `readFocusAnchor` 回退到 `<projectRoot>/.evo-lite/active_context.md`(getActiveContextPath 在临时根下解析到工作区外时的兜底分支);实现中 `readFocusAnchor` 已含该兜底。

- [ ] **Step 6: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-reconcile passed` 与 `✅ T-takeover-degraded passed`。

- [ ] **Step 7: 提交**

```bash
git add templates/cli/takeover-receipt.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): session-scoped receipt — ordered publication, hard validity, reconcile, degraded invalidation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 生命周期 adapter(`takeover-adapter.js`)—— SessionStart + UserPromptSubmit

**Files:**
- Create: `templates/cli/takeover-adapter.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-adapter-session`、`T-takeover-refresh-isolation`)

**Interfaces:**
- Consumes: `takeover-payload.js` 的 `buildTakeoverPayload`;`takeover-receipt.js` 的 `canonicalProjectRoot/readReceipt/reconcile/publishReceipt/readFocusAnchor`。
- Produces:
  - `handleHookInput(input, deps?)` → `{ json, exitCode }`(`input` = 解析后的 hook JSON;`deps` 可注入 `{ buildSessionContext }` 供测试跳过 verify/recall)。dispatch on `input.hook_event_name`:
    - `SessionStart` → establishment(无有效 receipt)或 refresh(有);establishment 走 ordered publication;返回 `hookSpecificOutput.additionalContext`(完整 payload 文本)。
    - `UserPromptSubmit` → reconcile + emit capsule(每轮无条件);返回 `hookSpecificOutput.additionalContext`(capsule JSON 串)。
  - `buildRecoveryCommand(projectRoot, sessionId)` → string(§7,Task 4 复用;此处先给出实现)
  - `main()` → 读 stdin JSON → `handleHookInput` → 写 stdout → `process.exit`
- **不变量 6:** UserPromptSubmit(refresh)分支只调 receipt 层(receipt 层不载 memory.service);session 分支的 verify/recall 经 `deps.buildSessionContext` **lazy** 注入,模块顶部不得 `require('./memory.service')`。

- [ ] **Step 1: 写失败测试(establishment/refresh by receipt presence + capsule 每轮)**

```javascript
console.log('T-takeover-adapter-session. establishment vs refresh decided by receipt presence ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-ad-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'),
        'x\n<!-- BEGIN_FOCUS -->\nFOCUS-A\n<!-- END_FOCUS -->\ny\n', 'utf8');
    const host = 'claude-code', sid = 'sess-1';
    // 注入 deps:跳过真实 verify/recall,证明 establishment 路径可测且 session-only 依赖是 lazy
    const deps = { projectRoot: dir, buildSessionContext: (base) => ({ ...base, projectName: 'proj',
        activePlan: null, activeSpec: null, rules: { dir: '.agents/rules/', required: [] }, risks: [],
        nextAction: 'x', freshness: null, verify: { status: 'ok' }, recall: [] }) };

    // 无 receipt → establishment → 发布 committed
    const r1 = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, cwd: dir, source: 'startup' }, deps);
    assert.strictEqual(r1.exitCode, 0);
    assert.ok(r1.json.hookSpecificOutput.additionalContext.includes('FOCUS-A'), 'establishment injects payload');
    assert.strictEqual(typeof r1.commit, 'function', 'ordered publication: commit deferred until after injection');
    r1.commit(); // main() 在写出 stdout 后调用;测试手动触发
    assert.strictEqual(rc.readReceipt(dir, host, sid, rc.canonicalProjectRoot(dir)).state, 'committed', 'establishment publishes committed receipt');

    // 已有 receipt → resume 视为 refresh(不因 source 判定):receipt 仍 committed
    const r2 = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, cwd: dir, source: 'resume' }, deps);
    assert.strictEqual(r2.exitCode, 0);
    r2.commit();
    assert.strictEqual(rc.readReceipt(dir, host, sid, rc.canonicalProjectRoot(dir)).state, 'committed', 'refresh keeps committed');

    // UserPromptSubmit 每轮 emit capsule
    const up = ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: dir }, deps);
    const capsule = JSON.parse(up.json.hookSpecificOutput.additionalContext);
    assert.strictEqual(capsule.evoLite, 'takeover-active', 'capsule active when committed');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-adapter-session passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-adapter.js'`。

- [ ] **Step 3: 实现 `takeover-adapter.js`**

```javascript
'use strict';
// Agent Takeover Trigger Protocol —— Claude Code 生命周期 adapter。
// 模块顶部禁止 require memory.service/db/zvec(不变量6);session-only 依赖 lazy(defaultBuildSessionContext 内)。
const path = require('path');
const rc = require('./takeover-receipt');
const { buildTakeoverPayload, CAPSULE_BUDGET_BYTES } = require('./takeover-payload');

const HOST = 'claude-code';

function bashSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function buildRecoveryCommand(projectRoot, sessionId) {
    const cli = bashSingleQuote(`${projectRoot}/.evo-lite/cli/memory.js`);
    return `node ${cli} bootstrap --receipt --host claude-code --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}

// session-only 依赖 lazy require —— 只有 establishment 路径才加载 memory.service。
function defaultBuildSessionContext(base) {
    const memoryService = require('./memory.service'); // lazy:refresh 路径永不到此
    const context = memoryService.summarizeActiveContext();
    return {
        ...base,
        projectName: (context && context.projectName) || path.basename(base.projectRoot),
        activePlan: (context && context.activePlan) || null,
        activeSpec: (context && context.activeSpec) || null,
        rules: { dir: '.agents/rules/', required: ['evo-lite', 'execution-model'] },
        risks: (context && context.risks) || [],
        nextAction: (context && context.nextAction) || null,
        freshness: (context && context.freshness) || null,
        verify: null, // verify/recall 可后续接入;MVP 允许 null(builder 容忍)
        recall: [],
    };
}

function handleSessionStart(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot || input.cwd);
    const sessionId = input.session_id;
    const dir = path.join(projectRoot, '.evo-lite');
    const sourceEvent = `SessionStart:${input.source || 'startup'}`;
    const existing = rc.readReceipt(dir, HOST, sessionId, projectRoot);
    const focus = rc.readFocusAnchor(projectRoot);

    if (focus === null) {
        // active_context 不可读:degraded,失效已存在 committed,报告
        if (existing.state === 'committed') rc.invalidateReceipt(dir, HOST, sessionId, projectRoot, 'active-context-unreadable');
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover DEGRADED: active_context unreadable. Recover: ${buildRecoveryCommand(projectRoot, sessionId)}` },
            systemMessage: 'evo-lite takeover degraded (active_context unreadable)' }, exitCode: 1 };
    }

    const base = { kind: 'session', host: HOST, sessionId, projectRoot, sourceEvent,
        focus: focus.text, focusHash: focus.hash };
    const buildCtx = deps.buildSessionContext || defaultBuildSessionContext;
    const context = buildCtx(base);
    const payload = buildTakeoverPayload(context); // 序列化前置(step 2-3)
    const additionalContext = `[evo-lite takeover] ${JSON.stringify(payload)}`;

    // ordered publication:注入文本已构建 → main() 先写出 stdout(注入)→ 再调 commit 发布 committed receipt。
    // handler 不在此内联发布,以保证"交付先于授权发布"(establishment 与 refresh 同刷新 receipt 内容,
    // refresh 不改授权世代但可更新 focusHash;establishment 由缺失/无效 receipt 判定,见 readReceipt)。
    const commit = () => rc.publishReceipt(dir, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: HOST,
        sessionId, projectRoot, state: 'committed', focusHash: focus.hash, payloadHash: null,
        generatedAt: input.__now || null, sourceEvent });
    void existing; // establishment vs refresh 均走 commit;差异仅诊断,不改变发布动作
    return { json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }, exitCode: 0, commit };
}

function handleUserPromptSubmit(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot || input.cwd);
    const sessionId = input.session_id;
    const dir = path.join(projectRoot, '.evo-lite');
    const { verdict, focus } = rc.reconcile({ dir, host: HOST, sessionId, projectRoot });
    const recoveryAction = buildRecoveryCommand(projectRoot, sessionId);
    const ctx = { kind: 'refresh', host: HOST, sessionId, projectRoot,
        projectName: path.basename(projectRoot), sourceEvent: 'UserPromptSubmit',
        focus: focus ? focus.text : null, focusHash: focus ? focus.hash : null,
        receiptVerdict: verdict, recoveryAction };
    const capsule = buildTakeoverPayload(ctx, CAPSULE_BUDGET_BYTES);
    return { json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit',
        additionalContext: JSON.stringify(capsule) } }, exitCode: 0 };
}

function handleHookInput(input, deps = {}) {
    switch (input && input.hook_event_name) {
        case 'SessionStart': return handleSessionStart(input, deps);
        case 'UserPromptSubmit': return handleUserPromptSubmit(input, deps);
        default: return { json: {}, exitCode: 0 }; // 未纳管事件:静默放过(阶段2 增 PreToolUse)
    }
}

function main() {
    let raw = '';
    process.stdin.on('data', d => raw += d).on('end', () => {
        let input = {};
        try { input = JSON.parse(raw); } catch (_) {}
        let out;
        try { out = handleHookInput(input); }
        catch (e) { out = { json: { systemMessage: `evo-lite takeover adapter error: ${e.message}` }, exitCode: 1 }; }
        if (out.json && Object.keys(out.json).length) process.stdout.write(JSON.stringify(out.json));
        // ordered publication:注入(stdout)已写出后,才发布 committed receipt。
        if (typeof out.commit === 'function') { try { out.commit(); } catch (_) {} }
        process.exit(out.exitCode || 0);
    });
}

if (require.main === module) main();
module.exports = { handleHookInput, buildRecoveryCommand };
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-adapter-session passed`。

- [ ] **Step 5: 写 refresh 隔离测试(不变量 6)**

```javascript
console.log('T-takeover-refresh-isolation. refresh path must not load memory.service/db/zvec ...');
{
    // 让重依赖模块加载即抛错,证明 UserPromptSubmit(refresh)分支仍能产出 capsule
    const heavy = ['memory.service', 'db', 'memory-index', 'memory-index-zvec'];
    const saved = {};
    for (const m of heavy) {
        const rp = require.resolve(path.join(TEMPLATE_CLI_DIR, m));
        saved[rp] = require.cache[rp];
        delete require.cache[rp];
        require.cache[rp] = { id: rp, filename: rp, loaded: true,
            get exports() { throw new Error(`refresh must not load ${m}`); } };
    }
    try {
        const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-iso-'));
        const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
        fs.writeFileSync(path.join(acDir, 'active_context.md'),
            'x\n<!-- BEGIN_FOCUS -->\nFOCUS\n<!-- END_FOCUS -->\ny\n', 'utf8');
        const up = ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: dir },
            { projectRoot: dir });
        assert.ok(up.json.hookSpecificOutput.additionalContext, 'refresh capsule produced without heavy deps');
        fs.rmSync(dir, { recursive: true, force: true });
    } finally {
        for (const rp of Object.keys(saved)) { delete require.cache[rp]; if (saved[rp]) require.cache[rp] = saved[rp]; }
    }
    console.log('✅ T-takeover-refresh-isolation passed');
}
```

- [ ] **Step 6: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-refresh-isolation passed`。若失败提示某重依赖被加载,把该 `require` 移入 `defaultBuildSessionContext`(lazy)。

- [ ] **Step 7: 提交**

```bash
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): CC lifecycle adapter — SessionStart establishment/refresh by receipt presence, UserPromptSubmit capsule, refresh isolation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `mem bootstrap --receipt`(CLI recovery transport)+ 恢复命令跨 cwd 合法

**Files:**
- Modify: `templates/cli/memory.js`(`bootstrap` 命令增 `--receipt`/`--host`/`--session-id`/`--source` 选项;新增 `runReceiptRecovery`)
- Test: `templates/cli/test/governance.js`(`T-takeover-recovery`)

**Interfaces:**
- Consumes: `takeover-receipt.js` 的 `canonicalProjectRoot/publishReceipt/readFocusAnchor/readReceipt`;`takeover-adapter.js` 的 `buildRecoveryCommand`。
- Produces: `mem bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json` → 经 **CLI recovery transport**(普通 JSON 输出,非 hook envelope)写 committed receipt。

- [ ] **Step 1: 写失败测试(recovery 写 committed + 命令跨 cwd 合法)**

```javascript
console.log('T-takeover-recovery. CLI recovery writes committed receipt; command valid across cwds ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-rcv-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'),
        'x\n<!-- BEGIN_FOCUS -->\nFOCUS\n<!-- END_FOCUS -->\ny\n', 'utf8');
    const root = rc.canonicalProjectRoot(dir);

    // 恢复命令:含绝对 root、bash 引用、无裸相对路径
    const cmd = ad.buildRecoveryCommand(root, "sid'with'quote");
    assert.ok(cmd.startsWith(`node '${root}/.evo-lite/cli/memory.js'`), 'absolute canonical-root-bound path');
    assert.ok(!/node \.evo-lite/.test(cmd), 'no bare relative path');
    assert.ok(cmd.includes(`'sid'\\''with'\\''quote'`), 'sessionId bash-escaped');

    // 经 memory.js CLI 子进程执行 recovery(在不同 cwd 下)→ 写 committed receipt
    const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
    const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt',
        '--host', 'claude-code', '--session-id', 'rec-sid', '--source', 'manual-recovery', '--json'],
        { cwd: path.join(dir, '.evo-lite'), // 故意在子目录执行
          env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: dir }, encoding: 'utf8' });
    assert.strictEqual(sub.status, 0, `recovery exit 0 (stderr: ${sub.stderr})`);
    assert.strictEqual(rc.readReceipt(dir, 'claude-code', 'rec-sid', root).state, 'committed', 'recovery wrote committed receipt');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-recovery passed');
}
```

> 说明:测试用 `EVO_LITE_WORKSPACE_ROOT` 覆盖工作区根(runtime 已支持该 env;若未支持,改为在 `dir` 下建最小 `.evo-lite` 并让 `canonicalProjectRoot` 自 cwd 上溯)。`runReceiptRecovery` 内以 `canonicalProjectRoot()` 解析根,不依赖 cwd。

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — recovery 子进程非 0 或 receipt 非 committed(`--receipt` 未实现)。

- [ ] **Step 3: 在 `memory.js` 增 `--receipt` 分支**

在 `program.command('bootstrap')` 的链上增加选项与分流(替换 Task 现有 bootstrap 注册块):

```javascript
    program.command('bootstrap')
        .alias('evo-start')
        .description('Read active_context, inspect architecture bootstrap state, and print a compact takeover report.')
        .option('--json', 'Print JSON output')
        .option('--receipt', 'CLI recovery transport: publish a session-bound committed takeover receipt')
        .option('--host <host>', 'Host label for the receipt', 'claude-code')
        .option('--session-id <id>', 'Session id to bind the receipt to')
        .option('--source <source>', 'Receipt sourceEvent label', 'manual-recovery')
        .action(async options => {
            if (options.receipt) {
                await runReceiptRecovery(options);
                return;
            }
            await runBootstrapCommand(options);
        });
```

在 `runBootstrapCommand` 附近新增(**CLI recovery transport:普通 JSON 输出,非 hook envelope**):

```javascript
async function runReceiptRecovery(options = {}) {
    const rc = require('./takeover-receipt');
    if (!options.sessionId) {
        throw new Error('Usage: bootstrap --receipt --host <host> --session-id <id> --source <source> [--json]');
    }
    const projectRoot = rc.canonicalProjectRoot();
    const dir = require('path').join(projectRoot, '.evo-lite');
    const focus = rc.readFocusAnchor(projectRoot);
    if (focus === null) {
        throw new Error('active_context unreadable; cannot establish takeover receipt');
    }
    rc.publishReceipt(dir, {
        schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: options.host, sessionId: options.sessionId,
        projectRoot, state: 'committed', focusHash: focus.hash, payloadHash: null,
        generatedAt: null, sourceEvent: options.source || 'manual-recovery',
    });
    const payload = { ok: true, host: options.host, sessionId: options.sessionId, projectRoot, state: 'committed' };
    console.log(options.json ? JSON.stringify(payload, null, 2) : `✅ takeover receipt committed for session ${options.sessionId}`);
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-recovery passed`。

- [ ] **Step 5: 提交**

```bash
git add templates/cli/memory.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): mem bootstrap --receipt CLI recovery transport (canonical-root-bound, session-scoped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: installer(`.claude/settings.json` 幂等 deep-merge)+ manifest + `.gitignore` + 镜像回归

**Files:**
- Modify: `templates/cli/memory.js`(新增 `mem takeover install|status` 命令组,或最小 `takeover-install.js` 助手 —— 见下)
- Create: `templates/cli/takeover-install.js`(deep-merge 助手)
- Modify: `templates/cli/template-manifest.js`(core-cli 增三文件)
- Modify: `.gitignore`(忽略 receipts)
- Test: `templates/cli/test/governance.js`(`T-takeover-installer`);`templates/cli/test/integration.js`(manifest 覆盖守卫,若存在 `required` 列表则加三文件)

**Interfaces:**
- Produces:
  - `takeover-install.js`:`mergeHookConfig(existing, managedFragment)` → merged(幂等 deep-merge,保留未知字段与第三方 hooks;只按"命令含 `takeover-adapter.js`"识别 Evo-Lite 托管 hook);`installTakeoverHooks(settingsPath, { events })` → `{ changed }`。
  - 阶段1 只并入 `SessionStart` + `UserPromptSubmit`(PreToolUse 由 Task 7 追加)。
- Hook 命令(相对,依赖 Claude Code 以项目根为 cwd 运行 hook):`node .evo-lite/cli/takeover-adapter.js`。

- [ ] **Step 1: 写失败测试(deep-merge 幂等 + 保留第三方)**

```javascript
console.log('T-takeover-installer. idempotent deep-merge preserves unknown fields and third-party hooks ...');
{
    const ti = require(path.join(TEMPLATE_CLI_DIR, 'takeover-install.js'));
    const existing = { model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } };
    const frag = ti.managedFragment(['SessionStart', 'UserPromptSubmit']);
    const merged1 = ti.mergeHookConfig(existing, frag);
    assert.strictEqual(merged1.model, 'sonnet', 'preserves unknown top-level field');
    assert.ok(merged1.hooks.PreToolUse.some(g => g.hooks.some(h => h.command === 'rtk hook claude')), 'preserves third-party hook');
    assert.ok(merged1.hooks.SessionStart.some(g => g.hooks.some(h => /takeover-adapter\.js/.test(h.command))), 'adds SessionStart');
    // 幂等:再 merge 不新增重复 Evo-Lite hook
    const merged2 = ti.mergeHookConfig(merged1, frag);
    const count = merged2.hooks.SessionStart.filter(g => g.hooks.some(h => /takeover-adapter\.js/.test(h.command))).length;
    assert.strictEqual(count, 1, 'idempotent: no duplicate managed hook');
    console.log('✅ T-takeover-installer passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-install.js'`。

- [ ] **Step 3: 实现 `takeover-install.js`**

```javascript
'use strict';
// Agent Takeover Trigger Protocol —— .claude/settings.json 幂等 deep-merge installer。
// 只按"命令含 takeover-adapter.js"识别 Evo-Lite 托管 hook;禁整文件覆盖。
const fs = require('fs');
const path = require('path');

const MANAGED_MARK = 'takeover-adapter.js';
const HOOK_COMMAND = 'node .evo-lite/cli/takeover-adapter.js';

function managedGroup(event) {
    // PreToolUse 需 matcher;其余事件无 matcher
    const hooks = [{ type: 'command', command: HOOK_COMMAND }];
    return event === 'PreToolUse' ? { matcher: '*', hooks } : { hooks };
}
function managedFragment(events) {
    const out = {};
    for (const ev of events) out[ev] = [managedGroup(ev)];
    return out;
}

function isManagedGroup(group) {
    return group && Array.isArray(group.hooks) && group.hooks.some(h => h && typeof h.command === 'string' && h.command.includes(MANAGED_MARK));
}

function mergeHookConfig(existing, fragment) {
    const out = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
    out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
    for (const event of Object.keys(fragment)) {
        const arr = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
        const kept = arr.filter(g => !isManagedGroup(g)); // 移除旧的 Evo-Lite 托管组(幂等 + 升级)
        out.hooks[event] = [...kept, ...fragment[event]];
    }
    return out;
}

function installTakeoverHooks(settingsPath, { events }) {
    let existing = {};
    if (fs.existsSync(settingsPath)) {
        try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) { existing = {}; }
    }
    const before = JSON.stringify(existing);
    const merged = mergeHookConfig(existing, managedFragment(events));
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    return { changed: JSON.stringify(merged) !== before };
}

module.exports = { MANAGED_MARK, HOOK_COMMAND, managedGroup, managedFragment, isManagedGroup, mergeHookConfig, installTakeoverHooks };
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-installer passed`。

- [ ] **Step 5: 注册三文件入 manifest**

在 `templates/cli/template-manifest.js` 的 core-cli `files` 数组中 `'memory-index-lock.js',` 之后插入:

```javascript
            'takeover-payload.js',
            'takeover-receipt.js',
            'takeover-adapter.js',
            'takeover-install.js',
```

- [ ] **Step 6: `.gitignore` 忽略 receipts**

在项目根 `.gitignore` 末尾追加:

```gitignore
# Agent Takeover Trigger Protocol —— session-bound receipts (generated, never committed)
.evo-lite/generated/takeover/receipts/
```

- [ ] **Step 7: manifest 覆盖守卫(若 integration 有 required 列表)**

若 `templates/cli/test/integration.js` 存在 `required` 数组的 manifest-coverage 守卫(参见 memory-index-lock.js 先例,~L427),在其中加入四个新文件名:`'takeover-payload.js'`, `'takeover-receipt.js'`, `'takeover-adapter.js'`, `'takeover-install.js'`。

- [ ] **Step 8: 同步镜像 + 双运行零**

```bash
node templates/cli/sync-runtime-entry.js
node templates/cli/sync-runtime-entry.js   # 二次运行必须 copied: 0
git add .evo-lite/cli/ templates/cli/template-manifest.js .gitignore
```
Expected: 首次 sync 复制新文件;二次 `copied: 0`。

> 若 `sync-runtime-entry.js` 入口名不同,用 `node .evo-lite/cli/sync-runtime.js` 或仓库既有 sync 命令(见 CLAUDE.md:`.\.evo-lite\mem.cmd sync-runtime`)。

- [ ] **Step 9: 全套件回归**

Run: `node templates/cli/test.js all`
Expected: PASS —— governance + integration 全绿(`All CLI integration tests passed` / `Governance-focused CLI tests passed`)。

- [ ] **Step 10: 提交**

```bash
git add templates/cli/takeover-install.js templates/cli/template-manifest.js templates/cli/test/ .gitignore .evo-lite/cli/
git commit -m "$(cat <<'EOF'
feat(takeover): idempotent deep-merge installer + manifest registration + gitignore receipts + runtime mirror

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 阶段 1 S9b dogfood + 复审门 1

**Files:**
- Create: `docs/validation/attp-phase1-dogfood.md`(dogfood 记录)
- (安装 installer 到母仓 `.claude/settings.json` 的 SessionStart + UserPromptSubmit)

**Interfaces:**
- Consumes: Task 1–5 全部产物。

- [ ] **Step 1: 母仓安装 hook(SessionStart + UserPromptSubmit)**

```bash
node -e "require('./templates/cli/takeover-install.js').installTakeoverHooks('.claude/settings.json', { events: ['SessionStart','UserPromptSubmit'] })"
```
确认 `.claude/settings.json` 出现 `takeover-adapter.js` 的 SessionStart/UserPromptSubmit hook,且未破坏既有 hooks。

- [ ] **Step 2: echo-harness 风格 dogfood(裸 prompt)**

在 scratch 项目(或母仓)以 `claude -p` 跑一次裸开发 prompt(不提 `.evo-lite`),观察:
- 首次模型推理前上下文出现 `[evo-lite takeover]` payload(SessionStart 注入);
- 每轮出现 capsule(`takeover-active`);
- receipt 于 `.evo-lite/generated/takeover/receipts/claude-code/` 落地为 committed。

```bash
# 记录到 docs/validation/attp-phase1-dogfood.md:prompt、注入证据、receipt 路径、S9b 前后对比
```

- [ ] **Step 3: S9b 行为验证**

裸 prompt("分析当前项目正在做什么,下一步该做什么")下,Agent 首轮回答/调查**明确引用 injected focus**(不再把项目当普通仓库)。记录为 P2 效果证据(非唯一确定性来源)。

- [ ] **Step 4: 提交 dogfood 记录**

```bash
git add docs/validation/attp-phase1-dogfood.md .claude/settings.json
git commit -m "$(cat <<'EOF'
docs(takeover): phase-1 S9b dogfood — deterministic bare-prompt takeover observed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 阶段 1 复审门**

停止,请求阶段 1 复审门(P0 determinism)。**获批前不进入阶段 2。** 复审须证明:裸 prompt 首次推理前有有效 payload;SessionStart 写 committed receipt(establishment/refresh 由 receipt 存在性判定);UserPromptSubmit 每轮 capsule;cwd/project 变化不复用旧 receipt;显式 CLI 能恢复 receipt;S9b 转为按治理 focus 接管。

---

# 阶段 2 —— 不可静默绕过(复审门 2:P0 no-silent-bypass)

> **前置:阶段 1 复审门已通过。**

## Task 7: PreToolUse fail-closed 守卫(health gate + target-path 绑定)

**Files:**
- Modify: `templates/cli/takeover-adapter.js`(增 `handlePreToolUse`;`handleHookInput` dispatch 增 `PreToolUse`)
- Modify: `templates/cli/takeover-install.js` 使用方(installer events 增 `PreToolUse`)
- Test: `templates/cli/test/governance.js`(`T-takeover-guard`、`T-takeover-target-path`、`T-takeover-session-scope`)

**Interfaces:**
- Produces:`handlePreToolUse(input, deps)` → `{ json:{ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision:'allow'|'deny', permissionDecisionReason? } }, exitCode:0 }`。
  - Read/Glob/Grep/Bash → allow。
  - Edit/Write(及 probe 证明存在的 NotebookEdit)→ health gate:committed receipt + active_context 可读(reconcile 非 degraded)+ refresh capsule 可构建 + `tool_input` 目标路径规范化后落 `receipt.projectRoot` 内;否则 deny + `permissionDecisionReason`=恢复命令 / 越界说明。

- [ ] **Step 1: 写失败测试(守卫 allow/deny 矩阵)**

```javascript
console.log('T-takeover-guard. Edit/Write fail-closed; Read/Glob/Grep/Bash allow ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-guard-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'),
        'x\n<!-- BEGIN_FOCUS -->\nFOCUS\n<!-- END_FOCUS -->\ny\n', 'utf8');
    const root = rc.canonicalProjectRoot(dir), sid = 'g-sid';
    const G = (tool, tin) => ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: dir,
        tool_name: tool, tool_input: tin || {} }, { projectRoot: dir }).json.hookSpecificOutput.permissionDecision;

    // 无 committed receipt → Edit/Write deny,只读/Bash allow
    assert.strictEqual(G('Read'), 'allow');
    assert.strictEqual(G('Bash'), 'allow', 'Bash excluded from guard');
    const denyEdit = ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: dir,
        tool_name: 'Write', tool_input: { file_path: path.join(dir, 'a.txt') } }, { projectRoot: dir });
    assert.strictEqual(denyEdit.json.hookSpecificOutput.permissionDecision, 'deny', 'Write deny without receipt');
    assert.ok(/memory\.js' bootstrap --receipt/.test(denyEdit.json.hookSpecificOutput.permissionDecisionReason), 'deny reason carries recovery command');

    // 建立 committed receipt → 项目内 Write allow
    rc.publishReceipt(dir, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: root,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, payloadHash: null, generatedAt: null, sourceEvent: 'x' });
    assert.strictEqual(G('Write', { file_path: path.join(dir, 'src', 'a.txt') }), 'allow', 'in-project Write allow');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-guard passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — PreToolUse 未纳管 → `permissionDecision` undefined。

- [ ] **Step 3: 在 `takeover-adapter.js` 增 `handlePreToolUse`**

在 `handleUserPromptSubmit` 之后新增,并在 `handleHookInput` 的 switch 增 `case 'PreToolUse'`:

```javascript
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const GUARDED_WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function allow() { return { json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }, exitCode: 0 }; }
function deny(reason) { return { json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }, exitCode: 0 }; }

function targetPathOf(toolInput) {
    if (!toolInput || typeof toolInput !== 'object') return null;
    return toolInput.file_path || toolInput.path || toolInput.notebook_path || null;
}

function handlePreToolUse(input, deps) {
    const tool = input.tool_name;
    if (READONLY_TOOLS.has(tool) || tool === 'Bash') return allow(); // Bash 排除出守卫
    if (!GUARDED_WRITE_TOOLS.has(tool)) return allow();

    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot || input.cwd);
    const sessionId = input.session_id;
    const dir = path.join(projectRoot, '.evo-lite');
    const recovery = buildRecoveryCommand(projectRoot, sessionId);

    // (a) committed receipt
    const rr = rc.readReceipt(dir, HOST, sessionId, projectRoot);
    if (rr.state !== 'committed') return deny(`[evo-lite] takeover required. Run: ${recovery}`);
    // (b) active_context 可读 + refresh capsule 可构建(轻量 health gate,非 degraded)
    const { verdict } = rc.reconcile({ dir, host: HOST, sessionId, projectRoot });
    if (verdict.transition === 'degraded' || verdict.state !== 'committed') {
        return deny(`[evo-lite] takeover unhealthy (${verdict.reason || verdict.transition}). Run: ${recovery}`);
    }
    // (c) target-path 落 receipt.projectRoot 内
    const target = targetPathOf(input.tool_input);
    if (target) {
        let abs = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
        // 新文件用最近存在父目录 realpath;逃逸检测
        let probe = abs;
        while (!require('fs').existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
        try { probe = require('fs').realpathSync(probe); } catch (_) {}
        const canonProbe = probe.replace(/\\/g, '/');
        const canonRoot = projectRoot.replace(/\\/g, '/');
        const within = canonProbe === canonRoot || canonProbe.startsWith(canonRoot + '/');
        if (!within) return deny(`[evo-lite] target '${target}' outside project '${projectRoot}'. Complete takeover in that project.`);
    }
    return allow();
}
```

`handleHookInput` switch 增:

```javascript
        case 'PreToolUse': return handlePreToolUse(input, deps);
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-guard passed`。

- [ ] **Step 5: 写 target-path + session-scope 测试**

```javascript
console.log('T-takeover-target-path. cross-project / escape denied ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-tp-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-other-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'), 'x\n<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\ny\n', 'utf8');
    const root = rc.canonicalProjectRoot(dir), sid = 'tp';
    rc.publishReceipt(dir, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: root,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, payloadHash: null, generatedAt: null, sourceEvent: 'x' });
    const dec = (tin) => ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: dir,
        tool_name: 'Write', tool_input: tin }, { projectRoot: dir }).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(dec({ file_path: path.join(other, 'x.js') }), 'deny', 'cross-project write denied');
    assert.strictEqual(dec({ file_path: path.join(dir, '..', 'escape.js') }), 'deny', 'parent escape denied');
    assert.strictEqual(dec({ file_path: path.join(dir, 'ok.js') }), 'allow', 'in-project allowed');
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
    console.log('✅ T-takeover-target-path passed');
}

console.log('T-takeover-session-scope. establishment vs refresh-failure by receipt presence, health gate decides ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-ss-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'), 'x\n<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\ny\n', 'utf8');
    const root = rc.canonicalProjectRoot(dir), sid = 'ss';
    const wDeny = () => ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: dir,
        tool_name: 'Write', tool_input: { file_path: path.join(dir, 'a.js') } }, { projectRoot: dir }).json.hookSpecificOutput.permissionDecision;
    // 首次接管前(无 receipt)→ deny
    assert.strictEqual(wDeny(), 'deny', 'no receipt → deny');
    // 已 committed → allow;随后 active_context 变不可读(治理健康失败)→ health gate → deny
    rc.publishReceipt(dir, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: root,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, payloadHash: null, generatedAt: null, sourceEvent: 'x' });
    assert.strictEqual(wDeny(), 'allow', 'committed + healthy → allow');
    fs.rmSync(path.join(acDir, 'active_context.md'), { force: true });
    assert.strictEqual(wDeny(), 'deny', 'governance-health failure → health gate deny (not unconditional allow)');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-session-scope passed');
}
```

- [ ] **Step 6: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-target-path passed`、`✅ T-takeover-session-scope passed`。

- [ ] **Step 7: 同步镜像 + 提交**

```bash
node templates/cli/sync-runtime-entry.js && node templates/cli/sync-runtime-entry.js
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "$(cat <<'EOF'
feat(takeover): PreToolUse fail-closed guard — health gate + target-path binding, Bash excluded

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 故障注入验收 + 复审门 2

**Files:**
- Test: `templates/cli/test/governance.js`(`T-takeover-transport`、`T-takeover-fault-injection`)
- Modify: 母仓 `.claude/settings.json`(installer events 增 `PreToolUse`)
- Create: `docs/validation/attp-phase2-fault-injection.md`

**Interfaces:**
- Consumes: Task 1–7 全部产物。

- [ ] **Step 1: 写 transport 分离 + 故障注入测试**

```javascript
console.log('T-takeover-transport. Hook vs CLI recovery transport; serialize fail → no committed receipt ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-tr-'));
    const acDir = path.join(dir, '.evo-lite'); fs.mkdirSync(acDir, { recursive: true });
    fs.writeFileSync(path.join(acDir, 'active_context.md'), 'x\n<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\ny\n', 'utf8');
    // Hook transport 产出 hookSpecificOutput 信封
    const r = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 's', cwd: dir, source: 'startup' },
        { projectRoot: dir, buildSessionContext: (b) => ({ ...b, projectName: 'p', rules: {}, risks: [], recall: [] }) });
    assert.ok(r.json.hookSpecificOutput && r.json.hookSpecificOutput.hookEventName === 'SessionStart', 'hook transport = hookSpecificOutput envelope');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-transport passed');
}

console.log('T-takeover-fault-injection. broken active_context → no committed receipt + fail-closed ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-takeover-fi-'));
    fs.mkdirSync(path.join(dir, '.evo-lite'), { recursive: true }); // 无 active_context.md → focus 不可读
    const root = rc.canonicalProjectRoot(dir), sid = 'fi';
    const r = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, cwd: dir, source: 'startup' }, { projectRoot: dir });
    assert.strictEqual(r.exitCode, 1, 'degraded SessionStart exits non-zero');
    assert.notStrictEqual(rc.readReceipt(dir, 'claude-code', sid, root).state, 'committed', 'no committed receipt on fault');
    // 守卫据此 deny Write,但 Bash 放行
    const g = (tool, tin) => ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: dir, tool_name: tool, tool_input: tin || {} }, { projectRoot: dir }).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(g('Write', { file_path: path.join(dir, 'a.js') }), 'deny', 'fault → Write deny');
    assert.strictEqual(g('Bash'), 'allow', 'Bash still allowed for recovery');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-fault-injection passed');
}
```

- [ ] **Step 2: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-transport passed`、`✅ T-takeover-fault-injection passed`。

- [ ] **Step 3: 母仓安装 PreToolUse hook + 全套件回归**

```bash
node -e "require('./templates/cli/takeover-install.js').installTakeoverHooks('.claude/settings.json', { events: ['SessionStart','UserPromptSubmit','PreToolUse'] })"
node templates/cli/test.js all
```
Expected: 全绿;`.claude/settings.json` 现含三事件 Evo-Lite 托管 hook,既有第三方 hooks 保留。

- [ ] **Step 4: 记录故障注入验收 + 提交**

```bash
git add templates/cli/test/governance.js .claude/settings.json docs/validation/attp-phase2-fault-injection.md .evo-lite/cli/
git commit -m "$(cat <<'EOF'
test(takeover): fault-injection acceptance — no silent bypass, transport split, recovery unlock

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 复审门 2 + 阶段收口**

停止,请求阶段 2 复审门(P0 no-silent-bypass)。复审须证明:无 committed receipt 时 Edit/Write deny + Read/Glob/Grep + Bash allow + deny reason 可执行;坏 hook/坏 payload 不产 committed receipt 且可自助恢复;degraded 真失效;focus 变化不阻断、下一 prompt 刷新;projectRoot 变化旧 receipt 失效;target-path 越界 deny。两个 P0 均达成后,进入治理闭环(`mem` intake spec + plan closure)与 hive nurture 分发。

---

## 附:实现期须复核的开放点(非阻断,记录以免遗漏)

- **hook cwd 假设**:Claude Code 运行 hook 命令时的 cwd 是否恒为项目根,决定 settings.json 用相对 `node .evo-lite/cli/takeover-adapter.js` 是否可靠;若否,adapter 已从 hook input `cwd`/`session_id` 自解析 projectRoot(治理路径不依赖 process.cwd),但 `node <相对>` 的 shell 解析仍需 cwd 正确 —— 实现期用 echo-harness 实测,必要时 installer 改写绝对路径(注意绝对路径不利子仓分发,权衡)。
- **runtime `getActiveContextPath()` 在临时根下的解析**:Task 2/3 测试依赖 `readFocusAnchor` 的 `<projectRoot>/.evo-lite/active_context.md` 兜底;若 runtime 强绑单一工作区,测试改注入 `EVO_LITE_WORKSPACE_ROOT` 或直接构造路径。
- **verify/recall 接入 session payload**:MVP 允许 `verify:null`;若阶段1复审要求完整 payload 含 verify,则在 `defaultBuildSessionContext` lazy 调 `memoryService.verify({silent:true})` + `buildTakeoverRecall`(仅 establishment 路径,保持 refresh 隔离)。
- **nurture 分发 installer**:子仓获取 hook 需 nurture 侧调用 `installTakeoverHooks`;本 MVP 只保证 installer 幂等 deep-merge 可用,分发接线为后续。
- **SessionStart(compact)/CwdChanged**:probe 列为待实测优化器;实现期以 echo-harness 验证后再决定是否纳管。
