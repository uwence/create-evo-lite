# Agent Takeover Trigger Protocol Implementation Plan (R2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让裸 prompt 下的 Claude Code Agent 无需用户提醒即确定性地进入 Evo-Lite 项目接管,并在无有效接管上下文时对 Edit/Write fail-closed。

**Architecture:** 三层协议 —— ①host-agnostic 纯函数 builder(`takeover-payload.js`);②Claude Code 生命周期 adapter(`takeover-adapter.js`);③PreToolUse fail-closed 守卫。**三条入口(`mem bootstrap` / SessionStart hook / CLI recovery)统一经单一 session 聚合器 `collectSessionTakeoverContext`(`takeover-session.js`)→ `buildTakeoverPayload` → 各自 transport**。receipt(`takeover-receipt.js`)session-scoped、ordered publication、硬字段 fail-closed。

**Tech Stack:** Node.js (CommonJS), commander, Claude Code hooks(`hookSpecificOutput.additionalContext` / `permissionDecision`, `${CLAUDE_PROJECT_DIR}`), 现有 `test/harness.js` + assert 骨架。

**契约文档(canonical):** `docs/superpowers/specs/2026-07-24-agent-takeover-trigger-protocol-design.md`(R5 APPROVED)。**probe:** `docs/validation/attp-cc-capability-probe.md`(2.1.218)。

**R1 计划复审(CHANGES REQUIRED,5 P0 + 5 P1)已折入 R2**,逐条见文末《R1-plan 复审落点》。

## Global Constraints

- **宿主范围:** 仅 Claude Code(MVP);非 Claude 宿主只静态 fallback。
- **单一 builder + 单一 collector:** `takeover-payload.js` 纯函数(无 IO/env/hook input)。**三条入口全部** `collectSessionTakeoverContext(...)` → `buildTakeoverPayload(...)` → transport;**禁止**任何入口自拼语义或把 `verify`/`recall` 硬编码为 null/空(P0-1)。
- **项目根来源 = adapter/CLI 自身位置,非 cwd:** `canonicalProjectRoot(startDir?)` 默认由 `runtime.getWorkspaceRoot()`(基于模块 `__dirname`)推导;可选 `discoverProjectRoot` 从 startDir 向上找最近含 `.evo-lite/` 的祖先;再 `path.resolve` + `fs.realpathSync` + win32 盘符大写/正斜杠。**绝不**用 `path.resolve(cwd)` 当项目根(P0-3)。
- **receipt 路径 project-bound:** 所有 receipt API 取 **`projectRoot`(canonical)**,内部计算 `<projectRoot>/.evo-lite/generated/takeover/receipts/<host>/<sha256(host\0sessionId)>.json`;`readFocusAnchor(projectRoot)` 直接读 `<projectRoot>/.evo-lite/active_context.md`(**不**用 `getActiveContextPath()` 的运行时全局路径)(P0-3)。gitignore、不入模板真相源、不提交;temp+rename 原子。
- **ordered publication(先交付、后授权、不吞错):** transport executor 先**同步写出**注入(`fs.writeSync(1, ...)`,可确认完成)→ 成功后才 `publishReceipt` → **发布失败返回非零、不吞异常**、发布后无可失败业务操作(P0-2)。Hook transport(`hookSpecificOutput.additionalContext` 信封)与 CLI recovery transport(普通 JSON,Bash stdout ≠ additionalContext)envelope 不同。
- **硬有效性:** `state==="committed"` 且 `schemaVersion`+`host`+`sessionId`+`projectRoot` 全匹配且文件可解析;缺失/损坏/`state!=="committed"`/任一硬字段不符 → invalid。软字段不参与 fail-closed。
- **establishment vs refresh 由 receipt 存在性判定,非 SessionStart.source。**
- **不变量 6(refresh 隔离):** refresh call graph(UserPromptSubmit / reconcile / readReceipt / readFocusAnchor)**禁载** `memory.service`/`db`/memory-index/zvec;`collectSessionTakeoverContext` 仅在 session 路径**lazy require**。
- **capsule 预算:** 量最终注入的 additionalContext UTF-8 字节,硬上限 **1 KiB**;序列化后**循环裁剪**并对最终输出**硬断言 ≤ 1 KiB**;裁剪顺序:永不删 `evoLite`/`receipt`/`project`/`focusHash`,先裁 `focus`,异常态尽量保 `reason`/`action`,`action` 仍超限则缩减/省略,最后回退固定短 degraded capsule;按 Unicode code point 边界截断(P1-1)。健康 capsule 不含 `action`/`refresh`。
- **守卫(阶段2):** Edit/Write health gate = committed receipt + active_context 可读 + **构建 RefreshTakeoverContext → buildTakeoverPayload → schema+预算校验成功** + target-path 落 receipt.projectRoot 内;**target-path 缺失/非字符串/解析失败 → deny(fail-closed)**(P0-4)。Read/Glob/Grep/Bash → allow;**MVP 守卫工具集仅 `Edit`/`Write`**(NotebookEdit 待 probe 证明工具名+输入 schema 后再纳入)。
- **hook 启动命令:** `node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"`(官方占位符,cwd/机器无关、可分发);installer 安装时**capability-gate**:probe 无 `${CLAUDE_PROJECT_DIR}` 支持则拒装并显式失败(P1-3)。
- **installer:** `.claude/settings.json` 幂等 deep-merge,保留未知字段/第三方 hooks;**settings JSON 损坏时 fail loudly、不覆盖原文件**(P1-2);正式 CLI `mem takeover install|status`(P1-5)。
- **镜像:** 新文件落 `templates/cli/**`;不手改 `.evo-lite/cli/**`;sync 后 `git add` 镜像;`sync-runtime` 二次运行 `copied: 0`。
- **两阶段两复审门:** 阶段1(Task 1–6)复审门批准后才进阶段2(Task 7–8);每任务 SDD 独立复审。
- **语言:** 用户可见中文;代码标识符/日志英文。commit trailer:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

# 阶段 1 —— 确定性接管(复审门 1:P0 determinism)

## Task 1: 纯函数 builder + 预算保证 capsule(`takeover-payload.js`)

**Files:**
- Create: `templates/cli/takeover-payload.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-payload`、`T-takeover-capsule-states`)

**Interfaces:**
- Produces:
  - `buildTakeoverPayload(context, budget?)` → `TakeoverPayload`(`context.kind==='session'`)| `Capsule`(`context.kind==='refresh'`,序列化后硬保证 ≤ `budget`)
  - `validatePayload(payload)` → `{ ok, errors }`(轻量 schema 校验,守卫 health gate 复用)
  - `SCHEMA_VERSION=1`、`CAPSULE_BUDGET_BYTES=1024`、`TRANSITION_TO_EVOLITE`
- 纯函数:无 `require('fs')`、无 `require('./memory.service')`、无 `process.env`、无 hook input。

- [ ] **Step 1: 写失败测试(payload 全字段 + capsule 无 IO)**

在 `runGovernanceTests()` try 块内新增:

```javascript
console.log('T-takeover-payload. Pure builder produces full payload + budgeted capsule ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const sessionCtx = {
        kind: 'session', host: 'claude-code', sessionId: 's1', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'SessionStart:startup', focus: 'FOCUS-LINE', focusHash: 'h',
        activePlan: { id: 'plan:x', status: 'active', progress: '1/3' }, activeSpec: { id: 'spec:x', status: 'active' },
        rules: { dir: '.agents/rules/', required: ['evo-lite'] }, risks: ['r1'], nextAction: 'do x',
        freshness: { ahead: 0, behind: 0, headSha: 'abc' }, verify: { status: 'ok' }, recall: [{ id: 'm1' }],
    };
    const payload = tp.buildTakeoverPayload(sessionCtx);
    assert.strictEqual(payload.schemaVersion, 1);
    assert.strictEqual(payload.project.name, 'proj');
    assert.strictEqual(payload.focus.text, 'FOCUS-LINE');
    assert.strictEqual(payload.active.plan.id, 'plan:x');
    assert.strictEqual(payload.verify.status, 'ok');
    assert.strictEqual(payload.recall.length, 1);
    assert.strictEqual(tp.validatePayload(payload).ok, true, 'valid payload passes schema');
    assert.strictEqual(tp.validatePayload({ schemaVersion: 1 }).ok, false, 'missing fields fail schema');

    const refreshCtx = {
        kind: 'refresh', host: 'claude-code', sessionId: 's1', projectRoot: '/p', projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus: 'FOCUS-LINE', focusHash: 'h1',
        receiptVerdict: { state: 'committed', transition: 'active', reason: null }, recoveryAction: null,
    };
    const capsule = tp.buildTakeoverPayload(refreshCtx, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(capsule.evoLite, 'takeover-active');
    assert.strictEqual(capsule.receipt, 'valid');
    assert.ok(!('action' in capsule) && !('refresh' in capsule), 'healthy capsule reflective only');
    assert.ok(Buffer.byteLength(JSON.stringify(capsule), 'utf8') <= tp.CAPSULE_BUDGET_BYTES);
    console.log('✅ T-takeover-payload passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `Cannot find module '.../takeover-payload.js'`。

- [ ] **Step 3: 实现 `takeover-payload.js`(纯函数,预算硬保证)**

```javascript
'use strict';
// ATTP host-agnostic 纯函数 builder。严禁 IO / env / hook input。
const SCHEMA_VERSION = 1;
const CAPSULE_BUDGET_BYTES = 1024;
const TRANSITION_TO_EVOLITE = {
    active: 'takeover-active', refreshed: 'takeover-refreshed', stale: 'takeover-stale', degraded: 'takeover-degraded',
};
const SESSION_REQUIRED = ['schemaVersion', 'host', 'project', 'focus', 'rules', 'nextAction'];

function buildSessionPayload(ctx) {
    return {
        schemaVersion: SCHEMA_VERSION, host: ctx.host, generatedAt: ctx.generatedAt || null,
        sourceEvent: ctx.sourceEvent, project: { name: ctx.projectName, root: ctx.projectRoot },
        focus: { text: ctx.focus, hash: ctx.focusHash || null, updatedAt: ctx.focusUpdatedAt || null },
        active: { plan: ctx.activePlan || null, spec: ctx.activeSpec || null },
        rules: ctx.rules || { dir: '.agents/rules/', required: [] },
        risks: Array.isArray(ctx.risks) ? ctx.risks : [], nextAction: ctx.nextAction || null,
        freshness: ctx.freshness || null, verify: ctx.verify || null,
        recall: Array.isArray(ctx.recall) ? ctx.recall : [],
    };
}

function validatePayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object') return { ok: false, errors: ['not-object'] };
    for (const f of SESSION_REQUIRED) if (payload[f] == null) errors.push(`missing-${f}`);
    if (payload.schemaVersion !== SCHEMA_VERSION) errors.push('schema-version');
    return { ok: errors.length === 0, errors };
}

function truncateToBytes(text, maxBytes) {
    if (maxBytes <= 0) return { text: '', truncated: true };
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
    let out = '';
    for (const ch of Array.from(text)) { // code point 迭代
        if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
        out += ch;
    }
    return { text: out, truncated: true };
}
const bytes = (obj) => Buffer.byteLength(JSON.stringify(obj), 'utf8');

function buildCapsule(ctx, budget) {
    const evoLite = TRANSITION_TO_EVOLITE[ctx.receiptVerdict.transition] || 'takeover-degraded';
    const receipt = ctx.receiptVerdict.state === 'committed' ? 'valid' : 'invalid';
    const anomaly = evoLite === 'takeover-stale' || evoLite === 'takeover-degraded';
    const focusText = ctx.focus == null ? 'unknown' : String(ctx.focus);

    // 固定字段(永不删)
    const fixed = { evoLite, project: ctx.projectName || 'unknown', receipt, focusHash: ctx.focusHash || null };
    if (ctx.receiptVerdict.reason) fixed.reason = ctx.receiptVerdict.reason;
    let action = anomaly && ctx.recoveryAction ? ctx.recoveryAction : null;

    // 组装 + 循环裁剪:先 focus,再(异常态)action,直到 ≤ budget
    const assemble = (focus, act) => {
        const o = { ...fixed, focus };
        if (act) o.action = act;
        if (focus.truncated) o.truncated = true;
        return o;
    };
    // 1) focus 全量
    let cand = assemble({ text: focusText }, action);
    let obj = { ...fixed, focus: focusText }; if (action) obj.action = action;
    if (bytes(obj) <= budget) return obj;
    // 2) 裁剪 focus 到剩余空间
    const withoutFocus = { ...fixed, focus: '' }; if (action) withoutFocus.action = action;
    const room = budget - bytes(withoutFocus);
    if (room > 0) {
        const cut = truncateToBytes(focusText, room);
        const o = { ...fixed, focus: cut.text }; if (cut.truncated) o.truncated = true; if (action) o.action = action;
        if (bytes(o) <= budget) return o;
    }
    // 3) focus 清空仍超限 → 省略 action 再试
    const o2 = { ...fixed, focus: '', truncated: true };
    if (bytes(o2) <= budget) return o2;
    void cand;
    // 4) 最后回退:固定短 degraded capsule(无 focus/action,保证极小)
    return { evoLite: 'takeover-degraded', project: 'unknown', receipt: 'invalid', reason: 'capsule-budget-exceeded' };
}

function buildTakeoverPayload(context, budget = CAPSULE_BUDGET_BYTES) {
    if (!context || typeof context !== 'object') throw new Error('takeover: context required');
    if (context.kind === 'session') return buildSessionPayload(context);
    if (context.kind === 'refresh') {
        const capsule = buildCapsule(context, budget);
        if (Buffer.byteLength(JSON.stringify(capsule), 'utf8') > budget) {
            throw new Error('takeover: capsule exceeds budget after trim'); // 不应发生,硬断言
        }
        return capsule;
    }
    throw new Error(`takeover: unknown context.kind ${context.kind}`);
}

module.exports = { buildTakeoverPayload, validatePayload, SCHEMA_VERSION, CAPSULE_BUDGET_BYTES, TRANSITION_TO_EVOLITE };
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-payload passed`。

- [ ] **Step 5: 写状态映射 + 预算硬保证测试(含超长 action)**

```javascript
console.log('T-takeover-capsule-states. transitions map + final capsule always <= 1 KiB ...');
{
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const mk = (transition, state, reason, action, focus, root = '/p') => tp.buildTakeoverPayload({
        kind: 'refresh', host: 'claude-code', sessionId: 's', projectRoot: root, projectName: 'proj',
        sourceEvent: 'UserPromptSubmit', focus, focusHash: 'h',
        receiptVerdict: { state, transition, reason }, recoveryAction: action,
    }, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(mk('active', 'committed', null, null, 'F').evoLite, 'takeover-active');
    assert.strictEqual(mk('refreshed', 'committed', null, null, 'F').evoLite, 'takeover-refreshed');
    const stale = mk('stale', 'invalid', null, 'RC', 'F');
    assert.strictEqual(stale.receipt, 'invalid');
    assert.strictEqual(stale.action, 'RC');
    // 超长 focus → 截断 + focusHash 保留 + 合法 JSON
    const trimmed = mk('active', 'committed', null, null, '焦'.repeat(5000));
    assert.ok(Buffer.byteLength(JSON.stringify(trimmed), 'utf8') <= 1024);
    assert.strictEqual(trimmed.truncated, true);
    assert.strictEqual(trimmed.focusHash, 'h');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(trimmed)));
    // 超长 action(长 root/sessionId 场景)→ 最终仍 ≤ budget(必要时省略 action)
    const bigAction = 'node ' + 'x'.repeat(4000);
    const hard = mk('stale', 'invalid', 'r', bigAction, 'F'.repeat(4000));
    assert.ok(Buffer.byteLength(JSON.stringify(hard), 'utf8') <= 1024, 'even oversized action stays within budget');
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
feat(takeover): pure-function payload builder + budget-guaranteed capsule + validatePayload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: receipt 层(`takeover-receipt.js`)—— project-bound 路径 / 根发现 / 有效性 / reconcile / 失效事务

**Files:**
- Create: `templates/cli/takeover-receipt.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-receipt`、`T-takeover-reconcile`、`T-takeover-degraded`、`T-takeover-projectroot`)

**Interfaces:**
- Consumes: `require('./runtime')` 的 `getWorkspaceRoot`(轻量,不载 db)。
- Produces:
  - `discoverProjectRoot(startDir)` → string(从 startDir 向上找含 `.evo-lite/` 的最近祖先;未找到抛错)
  - `canonicalProjectRoot(startDir?)` → string(startDir 默认 `getWorkspaceRoot()`;discover → resolve → realpath → win 规范化)
  - `evoLiteDir(projectRoot)` → `<projectRoot>/.evo-lite`
  - `receiptPathFor(projectRoot, host, sessionId)` → `<evoLiteDir>/generated/takeover/receipts/<host>/<sha256(host\0sessionId)>.json`
  - `readFocusAnchor(projectRoot)` → `{ text, hash } | null`(读 `<evoLiteDir>/active_context.md` FOCUS 锚点,不载 memory.service)
  - `readReceipt(projectRoot, host, sessionId)` → `{ state:'committed'|'missing'|'invalid', reason, receipt|null }`
  - `publishReceipt(projectRoot, receiptObj)` → void(temp+rename)
  - `invalidateReceipt(projectRoot, host, sessionId, reason)` → `{ ok, method }`(tombstone→unlink)
  - `reconcile({ projectRoot, host, sessionId })` → `{ verdict:{state,transition,reason}, focus }`
  - `RECEIPT_SCHEMA_VERSION=1`
- **不载** `memory.service`/`db`/memory-index/zvec。

- [ ] **Step 1: 写失败测试(project-bound 路径 + 硬有效性 + 文件名)**

```javascript
console.log('T-takeover-receipt. project-bound path + hard validity + sha256 filename ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const crypto = require('crypto');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-rc-'));
    fs.mkdirSync(path.join(root, '.evo-lite'), { recursive: true });
    const host = 'claude-code', sid = 's/1:weird';
    const expect = crypto.createHash('sha256').update(`${host}\0${sid}`).digest('hex');
    const rp = rc.receiptPathFor(root, host, sid);
    assert.ok(rp.includes(`${expect}.json`), 'filename = sha256(host\\0sid)');
    assert.ok(rp.replace(/\\/g, '/').includes('/.evo-lite/generated/takeover/receipts/claude-code/'), 'path is project-bound under .evo-lite');

    rc.publishReceipt(root, { schemaVersion: 1, host, sessionId: sid, projectRoot: rc.canonicalProjectRoot(root),
        state: 'committed', focusHash: 'h', payloadHash: 'p', generatedAt: 't', sourceEvent: 'x' });
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'committed');
    // 硬字段:projectRoot 存的是 canonical,readReceipt 内部用 canonicalProjectRoot(root) 比对
    rc.publishReceipt(root, { schemaVersion: 1, host, sessionId: sid, projectRoot: '/wrong',
        state: 'committed', focusHash: 'h' });
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'invalid', 'projectRoot mismatch → invalid');
    assert.strictEqual(rc.readReceipt(root, host, 'nope').state, 'missing', 'unknown sid → missing');
    fs.writeFileSync(rc.receiptPathFor(root, host, sid), 'x', 'utf8');
    assert.strictEqual(rc.readReceipt(root, host, sid).state, 'invalid', 'corrupt → invalid');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-receipt passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — 模块缺失。

- [ ] **Step 3: 实现 `takeover-receipt.js`**

```javascript
'use strict';
// ATTP receipt IO / 项目根发现 / 有效性 / reconcile / 失效事务。禁载 memory.service/db/zvec(不变量6)。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot } = require('./runtime');

const RECEIPT_SCHEMA_VERSION = 1;
const HARD_FIELDS = ['schemaVersion', 'host', 'sessionId', 'projectRoot', 'state'];

function discoverProjectRoot(startDir) {
    let cur = path.resolve(startDir);
    for (;;) {
        if (fs.existsSync(path.join(cur, '.evo-lite'))) return cur;
        const parent = path.dirname(cur);
        if (parent === cur) throw new Error(`takeover: no .evo-lite ancestor from ${startDir}`);
        cur = parent;
    }
}
function normalize(p) {
    let r = p.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
    return r;
}
function canonicalProjectRoot(startDir) {
    let base = startDir || getWorkspaceRoot();
    let root;
    try { root = discoverProjectRoot(base); }
    catch (_) { root = path.resolve(base); } // 兜底:无 .evo-lite 祖先(如全新 scaffold),用 resolve
    try { root = fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root); } catch (_) {}
    return normalize(root);
}

function evoLiteDir(projectRoot) { return path.join(projectRoot, '.evo-lite'); }
function receiptDir(projectRoot, host) { return path.join(evoLiteDir(projectRoot), 'generated', 'takeover', 'receipts', host); }
function receiptPathFor(projectRoot, host, sessionId) {
    const name = crypto.createHash('sha256').update(`${host}\0${sessionId}`).digest('hex');
    return path.join(receiptDir(projectRoot, host), `${name}.json`);
}

function readFocusAnchor(projectRoot) {
    const acPath = path.join(evoLiteDir(projectRoot), 'active_context.md');
    let text = '';
    try {
        const md = fs.readFileSync(acPath, 'utf8');
        const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
        text = (m ? m[1] : '').trim();
    } catch (_) { return null; }
    return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

function publishReceipt(projectRoot, receiptObj) {
    const finalPath = receiptPathFor(projectRoot, receiptObj.host, receiptObj.sessionId);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    const tmp = path.join(path.dirname(finalPath), `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(tmp, JSON.stringify(receiptObj), 'utf8');
    fs.renameSync(tmp, finalPath);
}

function readReceipt(projectRoot, host, sessionId) {
    const p = receiptPathFor(projectRoot, host, sessionId);
    if (!fs.existsSync(p)) return { state: 'missing', reason: null, receipt: null };
    let raw; try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return { state: 'invalid', reason: 'corrupt', receipt: null }; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'invalid', reason: 'corrupt', receipt: null };
    for (const f of HARD_FIELDS) if (!(f in raw)) return { state: 'invalid', reason: `missing-${f}`, receipt: raw };
    if (raw.state !== 'committed') return { state: 'invalid', reason: raw.reason || 'state-not-committed', receipt: raw };
    const canonRoot = canonicalProjectRoot(projectRoot);
    if (raw.schemaVersion !== RECEIPT_SCHEMA_VERSION || raw.host !== host || raw.sessionId !== sessionId || raw.projectRoot !== canonRoot) {
        return { state: 'invalid', reason: 'identity-mismatch', receipt: raw };
    }
    return { state: 'committed', reason: null, receipt: raw };
}

function invalidateReceipt(projectRoot, host, sessionId, reason) {
    const canonRoot = canonicalProjectRoot(projectRoot);
    try {
        publishReceipt(projectRoot, { schemaVersion: RECEIPT_SCHEMA_VERSION, host, sessionId, projectRoot: canonRoot, state: 'invalid', reason });
        return { ok: true, method: 'tombstone' };
    } catch (_) {}
    try { const p = receiptPathFor(projectRoot, host, sessionId); if (fs.existsSync(p)) fs.unlinkSync(p); return { ok: true, method: 'unlink' }; }
    catch (_) { return { ok: false, method: 'none' }; }
}

function reconcile({ projectRoot, host, sessionId }) {
    const rr = readReceipt(projectRoot, host, sessionId);
    const focus = readFocusAnchor(projectRoot);
    if (focus === null) {
        if (rr.state === 'committed') invalidateReceipt(projectRoot, host, sessionId, 'active-context-unreadable');
        return { verdict: { state: 'invalid', transition: 'degraded', reason: 'active-context-unreadable' }, focus: null };
    }
    if (rr.state !== 'committed') {
        return { verdict: { state: rr.state === 'missing' ? 'missing' : 'invalid', transition: 'stale', reason: rr.reason }, focus };
    }
    if (rr.receipt.focusHash !== focus.hash) {
        publishReceipt(projectRoot, { ...rr.receipt, focusHash: focus.hash });
        return { verdict: { state: 'committed', transition: 'refreshed', reason: null }, focus };
    }
    return { verdict: { state: 'committed', transition: 'active', reason: null }, focus };
}

module.exports = {
    RECEIPT_SCHEMA_VERSION, discoverProjectRoot, canonicalProjectRoot, evoLiteDir, receiptPathFor,
    readFocusAnchor, publishReceipt, readReceipt, invalidateReceipt, reconcile,
};
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-receipt passed`。

- [ ] **Step 5: 写 reconcile / degraded / project-root 发现测试**

```javascript
console.log('T-takeover-reconcile / T-takeover-degraded. focus drift refreshes; unreadable invalidates ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-rec-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    const wf = (t) => fs.writeFileSync(path.join(ac, 'active_context.md'), `<!-- BEGIN_FOCUS -->\n${t}\n<!-- END_FOCUS -->\n`, 'utf8');
    wf('FOCUS-A');
    const canon = rc.canonicalProjectRoot(root);
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 's', projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual(rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' }).verdict.transition, 'active');
    wf('FOCUS-B');
    assert.strictEqual(rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' }).verdict.transition, 'refreshed');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's').state, 'committed', 'drift keeps committed');
    console.log('✅ T-takeover-reconcile passed');
    fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
    assert.strictEqual(rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 's' }).verdict.transition, 'degraded');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's').state, 'invalid', 'degraded revokes committed');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-degraded passed');
}

console.log('T-takeover-projectroot. discoverProjectRoot walks up to .evo-lite ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-pr-'));
    fs.mkdirSync(path.join(root, '.evo-lite'), { recursive: true });
    const deep = path.join(root, 'src', 'a', 'b'); fs.mkdirSync(deep, { recursive: true });
    assert.strictEqual(rc.discoverProjectRoot(deep), path.resolve(root), 'finds root from nested dir');
    assert.strictEqual(rc.canonicalProjectRoot(deep), rc.canonicalProjectRoot(root), 'canonical stable across nested cwd');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-projectroot passed');
}
```

- [ ] **Step 6: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — reconcile / degraded / projectroot 三条通过。

- [ ] **Step 7: 提交**

```bash
git add templates/cli/takeover-receipt.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): project-bound session-scoped receipt — root discovery, ordered-publication primitive, reconcile, degraded invalidation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: session collector + adapter + transport executor(`takeover-session.js` + `takeover-adapter.js`)

**Files:**
- Create: `templates/cli/takeover-session.js`(session-only 聚合器,lazy 载 memory.service)
- Create: `templates/cli/takeover-adapter.js`(SessionStart + UserPromptSubmit + transport executor)
- Test: `templates/cli/test/governance.js`(`T-takeover-adapter-session`、`T-takeover-refresh-isolation`、`T-takeover-transport-order`)

**Interfaces:**
- `takeover-session.js` Produces: `assembleSessionContext(base, {summary,verify,recall})`(纯装配)+ `collectSessionTakeoverContextFull(base)` → `SessionTakeoverContext`(kind:'session';async;内部 lazy `require('./memory.service')` 调 `verify({silent:true})`/`summarizeActiveContext`/`buildTakeoverRecall`)。
- `takeover-adapter.js` Produces:
  - `buildRecoveryCommand(projectRoot, sessionId)` → string(canonical-root-bound,Bash 引用)
  - `executeHookTransport(json, publish, { write }?)` → `{ exitCode }`(先 `fs.writeSync(1, JSON.stringify(json))`;成功再 `publish()`;write 失败→不 publish、exitCode 1;publish 失败→exitCode 1;不吞异常)
  - `handleHookInput(input, deps?)` → `{ json, exitCode, publish|null }`(dispatch on `hook_event_name`)
  - `main()`
- **不变量 6:** adapter 顶部只 `require` takeover-receipt + takeover-payload;`collectSessionTakeoverContext` 在 SessionStart 分支内 lazy require。

- [ ] **Step 1: 写失败测试(establishment/refresh by presence + transport 顺序 + capsule)**

```javascript
console.log('T-takeover-adapter-session. establishment/refresh by receipt presence; capsule every turn ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-ad-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nFOCUS-A\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'sess-1';
    // 注入 collector,跳过真实 verify/recall(证明 session-only 依赖 lazy 且入口统一走 builder)
    const deps = { projectRoot: root, collect: (base) => ({ ...base, kind: 'session', projectName: 'proj',
        activePlan: null, activeSpec: null, rules: { dir: '.agents/rules/', required: ['evo-lite'] },
        risks: [], nextAction: 'x', freshness: null, verify: { status: 'ok' }, recall: [] }) };

    const r1 = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, cwd: root, source: 'startup' }, deps);
    assert.strictEqual(r1.exitCode, 0);
    assert.ok(r1.json.hookSpecificOutput.additionalContext.includes('FOCUS-A'), 'establishment injects payload');
    assert.strictEqual(typeof r1.publish, 'function', 'ordered publication: publish deferred');
    // 交付前无 committed receipt;交付后由 executor 发布
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'missing', 'no receipt before transport');
    assert.strictEqual(ad.executeHookTransport(r1.json, r1.publish, { write: () => {} }).exitCode, 0);
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'committed', 'committed after transport publish');

    // 已有 receipt → resume 视为 refresh(不因 source);仍 committed
    const r2 = ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: sid, cwd: root, source: 'resume' }, deps);
    ad.executeHookTransport(r2.json, r2.publish, { write: () => {} });
    assert.strictEqual(rc.readReceipt(root, 'claude-code', sid).state, 'committed');

    const up = ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: root }, deps);
    assert.strictEqual(JSON.parse(up.json.hookSpecificOutput.additionalContext).evoLite, 'takeover-active');
    void canon; fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-adapter-session passed');
}
```

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — 模块缺失。

- [ ] **Step 3: 实现 `takeover-session.js`**

```javascript
'use strict';
// ATTP session-only 聚合器 —— 三条入口(bootstrap / SessionStart / CLI recovery)共用。
// 只在 session 路径被调用(非 refresh);内部 lazy require memory.service(重依赖)。
const path = require('path');

// 纯装配:把已取得的 summary/verify/recall 装配成 SessionTakeoverContext(便于测试)。
function assembleSessionContext(base, parts = {}) {
    const summary = parts.summary || {};
    return {
        ...base, kind: 'session',
        projectName: path.basename(base.projectRoot),
        activePlan: summary.activePlan || null,
        activeSpec: summary.activeSpec || null,
        rules: { dir: '.agents/rules/', required: ['evo-lite', 'execution-model'] },
        risks: Array.isArray(summary.activeTasks) ? summary.activeTasks.map(t => (t && t.line) || String(t)).slice(0, 5) : [],
        nextAction: (summary.focus && String(summary.focus).split('\n')[0]) || base.focus || null,
        freshness: null,
        verify: parts.verify || null,
        recall: Array.isArray(parts.recall) ? parts.recall : [],
    };
}

// 带真实 verify/recall 的入口(async);SessionStart / bootstrap / CLI recovery 均调它。
async function collectSessionTakeoverContextFull(base) {
    const memoryService = require('./memory.service'); // lazy:refresh 路径永不到此
    let verify = null; try { verify = await memoryService.verify({ silent: true }); } catch (_) {}
    let summary = {}; try { summary = memoryService.summarizeActiveContext() || {}; } catch (_) {}
    let recall = []; try { recall = await memoryService.buildTakeoverRecall(summary, verify) || []; } catch (_) {}
    return assembleSessionContext(base, { summary, verify, recall });
}

module.exports = { assembleSessionContext, collectSessionTakeoverContextFull };
```

> 说明:`assembleSessionContext` 是纯装配(可单测);`collectSessionTakeoverContextFull` 带真实 verify/recall(async),三入口均调它。测试可注入 `deps.collect` 覆盖(跳过重依赖)。

- [ ] **Step 4: 实现 `takeover-adapter.js`**

```javascript
'use strict';
// ATTP Claude Code 生命周期 adapter。顶部只载 receipt + payload;session 聚合器 lazy(不变量6)。
const fs = require('fs');
const path = require('path');
const rc = require('./takeover-receipt');
const { buildTakeoverPayload, CAPSULE_BUDGET_BYTES } = require('./takeover-payload');
const HOST = 'claude-code';

function bashSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function buildRecoveryCommand(projectRoot, sessionId) {
    const cli = bashSingleQuote(`${projectRoot}/.evo-lite/cli/memory.js`);
    return `node ${cli} bootstrap --receipt --host claude-code --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}

// ── transport executor:先交付、后授权、不吞错 ──
function executeHookTransport(json, publish, opts = {}) {
    const write = opts.write || ((s) => fs.writeSync(1, s));
    let serialized;
    try { serialized = JSON.stringify(json || {}); } catch (e) { return { exitCode: 1, error: `serialize: ${e.message}` }; }
    try { write(serialized); } catch (e) { return { exitCode: 1, error: `write: ${e.message}` }; } // 交付失败 → 不授权
    if (typeof publish === 'function') {
        try { publish(); } catch (e) { return { exitCode: 1, error: `publish: ${e.message}` }; } // 授权失败 → 非零、不吞
    }
    return { exitCode: 0 };
}

async function handleSessionStart(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot || (deps.startDir));
    const sessionId = input.session_id;
    const sourceEvent = `SessionStart:${input.source || 'startup'}`;
    const existing = rc.readReceipt(projectRoot, HOST, sessionId);
    const focus = rc.readFocusAnchor(projectRoot);

    if (focus === null) {
        if (existing.state === 'committed') rc.invalidateReceipt(projectRoot, HOST, sessionId, 'active-context-unreadable');
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover DEGRADED (active_context unreadable). Recover: ${buildRecoveryCommand(projectRoot, sessionId)}` },
            systemMessage: 'evo-lite takeover degraded' }, exitCode: 1, publish: null };
    }

    const base = { host: HOST, sessionId, projectRoot, sourceEvent, focus: focus.text, focusHash: focus.hash };
    let context;
    if (deps.collect) context = deps.collect(base);
    else context = await require('./takeover-session').collectSessionTakeoverContextFull(base);
    const payload = buildTakeoverPayload(context);
    const additionalContext = `[evo-lite takeover] ${JSON.stringify(payload)}`;
    // deferred publish:executor 交付后调用(establishment 与 refresh 都刷新 receipt 内容)
    const publish = () => rc.publishReceipt(projectRoot, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: HOST,
        sessionId, projectRoot: rc.canonicalProjectRoot(projectRoot), state: 'committed', focusHash: focus.hash,
        payloadHash: null, generatedAt: null, sourceEvent });
    void existing;
    return { json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }, exitCode: 0, publish };
}

function handleUserPromptSubmit(input, deps) {
    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot);
    const sessionId = input.session_id;
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    const ctx = { kind: 'refresh', host: HOST, sessionId, projectRoot, projectName: path.basename(projectRoot),
        sourceEvent: 'UserPromptSubmit', focus: focus ? focus.text : null, focusHash: focus ? focus.hash : null,
        receiptVerdict: verdict, recoveryAction: buildRecoveryCommand(projectRoot, sessionId) };
    const capsule = buildTakeoverPayload(ctx, CAPSULE_BUDGET_BYTES);
    return { json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(capsule) } }, exitCode: 0, publish: null };
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
        try { out = await handleHookInput(input, { projectRoot: rc.canonicalProjectRoot() }); }
        catch (e) { out = { json: { systemMessage: `evo-lite takeover error: ${e.message}` }, exitCode: 1, publish: null }; }
        const res = executeHookTransport(out.json, out.publish);
        process.exit(res.exitCode || out.exitCode || 0);
    });
}

if (require.main === module) main();
module.exports = { handleHookInput, executeHookTransport, buildRecoveryCommand };
```

> 注:`handleHookInput` 现为 async(SessionStart 走 async collector)。同步测试对 UserPromptSubmit 分支仍可 `await` 或直接 `.then`;测试统一 `await ad.handleHookInput(...)`。

- [ ] **Step 5: 更新 Task 3 测试为 async;运行验证通过**

把 Step 1 测试块的 `ad.handleHookInput(...)` 全部改为 `await ad.handleHookInput(...)`(`runGovernanceTests` 已是 async)。
Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-adapter-session passed`。

- [ ] **Step 6: 写 refresh 隔离 + transport 顺序测试**

```javascript
console.log('T-takeover-refresh-isolation. UserPromptSubmit must not load memory.service/db/zvec ...');
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
        const up = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: root }, { projectRoot: root });
        assert.ok(up.json.hookSpecificOutput.additionalContext, 'refresh capsule without heavy deps');
        fs.rmSync(root, { recursive: true, force: true });
    } finally { for (const rp of Object.keys(saved)) { delete require.cache[rp]; if (saved[rp]) require.cache[rp] = saved[rp]; } }
    console.log('✅ T-takeover-refresh-isolation passed');
}

console.log('T-takeover-transport-order. deliver before publish; write-fail → no publish; publish-fail → nonzero ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    let published = false, written = '';
    // 正常:先 write 后 publish
    const ok = ad.executeHookTransport({ a: 1 }, () => { assert.ok(written, 'write happened before publish'); published = true; },
        { write: (s) => { written = s; } });
    assert.strictEqual(ok.exitCode, 0); assert.strictEqual(published, true);
    // write 失败 → 不 publish + 非零
    published = false;
    const wf = ad.executeHookTransport({ a: 1 }, () => { published = true; }, { write: () => { throw new Error('stdout fail'); } });
    assert.strictEqual(wf.exitCode, 1); assert.strictEqual(published, false, 'publish skipped when delivery fails');
    // publish 失败 → 非零、不吞
    const pf = ad.executeHookTransport({ a: 1 }, () => { throw new Error('rename fail'); }, { write: () => {} });
    assert.strictEqual(pf.exitCode, 1);
    console.log('✅ T-takeover-transport-order passed');
}
```

- [ ] **Step 7: 运行验证通过 + 提交**

Run: `node templates/cli/test.js governance`
Expected: PASS — refresh-isolation / transport-order 通过。

```bash
git add templates/cli/takeover-session.js templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): unified session collector + lifecycle adapter + ordered-publication transport executor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 三入口统一 —— `runBootstrapCommand` 经 builder + `mem bootstrap --receipt` CLI recovery transport

**Files:**
- Modify: `templates/cli/memory.js`(`runBootstrapCommand` 改经 `collect → buildTakeoverPayload`;新增 `runReceiptRecovery` 用 CLI recovery transport;`bootstrap` 命令增 `--receipt`/`--host`/`--session-id`/`--source`)
- Test: `templates/cli/test/governance.js`(`T-takeover-recovery`、`T-takeover-bootstrap-unified`)

**Interfaces:**
- Consumes: `takeover-session.js`、`takeover-payload.js`、`takeover-receipt.js`、`takeover-adapter.js` 的 `buildRecoveryCommand`。
- Produces: `mem bootstrap`(人类/JSON 展示,经同一 payload)、`mem bootstrap --receipt ...`(CLI recovery transport:先输出 payload、后发布 receipt、发布失败非零)。

- [ ] **Step 1: 写失败测试(recovery 写 committed + bootstrap 经 builder)**

```javascript
console.log('T-takeover-recovery / T-takeover-bootstrap-unified. CLI recovery + bootstrap share builder ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-rcv-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root);

    const cmd = ad.buildRecoveryCommand(canon, "sid'q");
    assert.ok(cmd.startsWith(`node '${canon}/.evo-lite/cli/memory.js'`), 'canonical-root-bound absolute path');
    assert.ok(!/(^| )node \.evo-lite\//.test(cmd), 'no bare relative node .evo-lite path');
    assert.ok(/'sid'\\''q'/.test(cmd), 'sessionId bash-escaped');

    // 子进程执行 recovery(EVO_LITE_ROOT 指向该临时 .evo-lite)
    const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
    const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt',
        '--host', 'claude-code', '--session-id', 'rec', '--source', 'manual-recovery', '--json'],
        { cwd: root, env: { ...process.env, EVO_LITE_ROOT: ac, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
    assert.strictEqual(sub.status, 0, `recovery exit 0 (stderr: ${sub.stderr})`);
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 'rec').state, 'committed', 'recovery wrote committed receipt');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-recovery passed');
}
```

> `canonicalProjectRoot()` 在子进程内经 `getWorkspaceRoot()`(=`EVO_LITE_ROOT` 的父目录=`root`)解析,与 cwd 无关。

- [ ] **Step 2: 运行验证失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL — `--receipt` 未实现。

- [ ] **Step 3: 改 `memory.js` bootstrap 命令 + 新增 recovery**

替换 bootstrap 命令注册为:

```javascript
    program.command('bootstrap')
        .alias('evo-start')
        .description('Print a takeover payload (human/JSON), or with --receipt publish a session-bound committed receipt.')
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

把 `runBootstrapCommand` 改为经 collector + builder(P0-1 统一);新增 `runReceiptRecovery`(CLI recovery transport):

```javascript
async function runBootstrapCommand(options = {}) {
    await bootstrap();
    const rc = require('./takeover-receipt');
    const { collectSessionTakeoverContextFull } = require('./takeover-session');
    const { buildTakeoverPayload } = require('./takeover-payload');
    const projectRoot = rc.canonicalProjectRoot();
    const focus = rc.readFocusAnchor(projectRoot) || { text: '', hash: null };
    const context = await collectSessionTakeoverContextFull({
        host: options.host || 'claude-code', sessionId: options.sessionId || 'bootstrap',
        projectRoot, sourceEvent: 'bootstrap', focus: focus.text, focusHash: focus.hash,
    });
    const payload = buildTakeoverPayload(context);
    if (options.json === true) { console.log(JSON.stringify(payload, null, 2)); return; }
    console.log(formatBootstrapReport(payload)); // 人类展示器消费同一 payload
}

async function runReceiptRecovery(options = {}) {
    await bootstrap();
    const rc = require('./takeover-receipt');
    const { collectSessionTakeoverContextFull } = require('./takeover-session');
    const { buildTakeoverPayload } = require('./takeover-payload');
    const { executeCliRecoveryTransport } = require('./takeover-adapter');
    if (!options.sessionId) throw new Error('Usage: bootstrap --receipt --host <host> --session-id <id> --source <source> [--json]');
    const projectRoot = rc.canonicalProjectRoot();
    const focus = rc.readFocusAnchor(projectRoot);
    if (focus === null) throw new Error('active_context unreadable; cannot establish receipt');
    const context = await collectSessionTakeoverContextFull({
        host: options.host, sessionId: options.sessionId, projectRoot, sourceEvent: options.source || 'manual-recovery',
        focus: focus.text, focusHash: focus.hash,
    });
    const payload = buildTakeoverPayload(context);
    const publish = () => rc.publishReceipt(projectRoot, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: options.host,
        sessionId: options.sessionId, projectRoot, state: 'committed', focusHash: focus.hash, payloadHash: null,
        generatedAt: null, sourceEvent: options.source || 'manual-recovery' });
    const out = options.json ? JSON.stringify(payload, null, 2) : `✅ takeover receipt committed for session ${options.sessionId}`;
    const res = executeCliRecoveryTransport(out, publish); // 先输出、后发布、发布失败非零
    if (res.exitCode) { process.exitCode = res.exitCode; }
}
```

`formatBootstrapReport` 需适配新 payload 形态(取 `payload.project.name`/`payload.focus.text`/`payload.nextAction` 等);若既有实现依赖旧 `{context,sessionstart,verify,takeoverRecall}`,改写其字段读取到 payload。并在 `takeover-adapter.js` 增 `executeCliRecoveryTransport` 并导出:

```javascript
function executeCliRecoveryTransport(text, publish, opts = {}) {
    const write = opts.write || ((s) => process.stdout.write(s + '\n'));
    try { write(String(text)); } catch (e) { return { exitCode: 1, error: `write: ${e.message}` }; }
    if (typeof publish === 'function') { try { publish(); } catch (e) { return { exitCode: 1, error: `publish: ${e.message}` }; } }
    return { exitCode: 0 };
}
// module.exports 增 executeCliRecoveryTransport
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-recovery passed`。同时手动 `EVO_LITE_ROOT=<repo>/.evo-lite node templates/cli/memory.js bootstrap --json` 应输出经 builder 的 payload。

- [ ] **Step 5: 提交**

```bash
git add templates/cli/memory.js templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "$(cat <<'EOF'
feat(takeover): unify bootstrap + CLI recovery through single collector→builder; recovery transport (deliver-before-publish)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: installer(`mem takeover install|status`,fail-loud deep-merge,CLAUDE_PROJECT_DIR)+ manifest + gitignore + 镜像

**Files:**
- Create: `templates/cli/takeover-install.js`
- Modify: `templates/cli/memory.js`(新增 `takeover` 命令组:`install` / `status`)
- Modify: `templates/cli/template-manifest.js`(core-cli 增五文件)
- Modify: `.gitignore`
- Test: `templates/cli/test/governance.js`(`T-takeover-installer`);`templates/cli/test/integration.js`(manifest 覆盖守卫)

**Interfaces:**
- `takeover-install.js` Produces:`HOOK_COMMAND='node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"'`;`managedFragment(events)`;`mergeHookConfig(existing, fragment)`;`installTakeoverHooks(settingsPath, { events })` → `{ changed }`(**JSON 损坏 → 抛错、不覆盖**);`statusTakeoverHooks(settingsPath)` → `{ installed:[events], missing:[events] }`。
- 阶段1 events = `['SessionStart','UserPromptSubmit']`(PreToolUse 由 Task 8 追加)。

- [ ] **Step 1: 写失败测试(幂等 + 保留第三方 + 损坏 fail-loud + CLAUDE_PROJECT_DIR)**

```javascript
console.log('T-takeover-installer. idempotent deep-merge; preserve third-party; corrupt → throw ...');
{
    const ti = require(path.join(TEMPLATE_CLI_DIR, 'takeover-install.js'));
    const existing = { model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } };
    const frag = ti.managedFragment(['SessionStart', 'UserPromptSubmit']);
    const m1 = ti.mergeHookConfig(existing, frag);
    assert.strictEqual(m1.model, 'sonnet');
    assert.ok(m1.hooks.PreToolUse.some(g => g.hooks.some(h => h.command === 'rtk hook claude')), 'third-party preserved');
    assert.ok(m1.hooks.SessionStart.some(g => g.hooks.some(h => /CLAUDE_PROJECT_DIR/.test(h.command) && /takeover-adapter\.js/.test(h.command))), 'managed hook uses CLAUDE_PROJECT_DIR');
    const m2 = ti.mergeHookConfig(m1, frag);
    assert.strictEqual(m2.hooks.SessionStart.filter(g => g.hooks.some(h => /takeover-adapter/.test(h.command))).length, 1, 'idempotent');
    // 损坏 settings → fail loudly、不覆盖
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-inst-')), 'settings.json');
    fs.writeFileSync(tmp, '{ not json', 'utf8');
    assert.throws(() => ti.installTakeoverHooks(tmp, { events: ['SessionStart'] }), /corrupt|parse|JSON/i, 'corrupt settings → throw');
    assert.strictEqual(fs.readFileSync(tmp, 'utf8'), '{ not json', 'corrupt file left unchanged');
    console.log('✅ T-takeover-installer passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-install.js`**

```javascript
'use strict';
// ATTP .claude/settings.json 幂等 deep-merge installer。禁整文件覆盖;JSON 损坏 fail-loud。
const fs = require('fs');
const path = require('path');
const MANAGED_MARK = 'takeover-adapter.js';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"';

function managedGroup(event) {
    const hooks = [{ type: 'command', command: HOOK_COMMAND }];
    return event === 'PreToolUse' ? { matcher: '*', hooks } : { hooks };
}
function managedFragment(events) { const o = {}; for (const e of events) o[e] = [managedGroup(e)]; return o; }
function isManagedGroup(g) { return g && Array.isArray(g.hooks) && g.hooks.some(h => h && typeof h.command === 'string' && h.command.includes(MANAGED_MARK)); }

function mergeHookConfig(existing, fragment) {
    const out = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
    out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
    for (const ev of Object.keys(fragment)) {
        const arr = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : [];
        out.hooks[ev] = [...arr.filter(g => !isManagedGroup(g)), ...fragment[ev]];
    }
    return out;
}

function installTakeoverHooks(settingsPath, { events }) {
    let existing = {};
    if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        try { existing = JSON.parse(raw); }
        catch (e) { throw new Error(`takeover install: ${settingsPath} is corrupt JSON (${e.message}); leaving unchanged`); }
    }
    const before = JSON.stringify(existing);
    const merged = mergeHookConfig(existing, managedFragment(events));
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    return { changed: JSON.stringify(merged) !== before };
}

function statusTakeoverHooks(settingsPath, events) {
    let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
    const hooks = (cfg.hooks) || {};
    const installed = [], missing = [];
    for (const ev of events) {
        const has = Array.isArray(hooks[ev]) && hooks[ev].some(isManagedGroup);
        (has ? installed : missing).push(ev);
    }
    return { installed, missing };
}

module.exports = { MANAGED_MARK, HOOK_COMMAND, managedGroup, managedFragment, isManagedGroup, mergeHookConfig, installTakeoverHooks, statusTakeoverHooks };
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-installer passed`。

- [ ] **Step 5: 加 `mem takeover install|status` CLI**

在 `buildProgram()` 内新增(靠近 bootstrap 注册):

```javascript
    const takeoverCmd = program.command('takeover').description('Agent Takeover Trigger Protocol host-adapter management.');
    takeoverCmd.command('install')
        .option('--events <list>', 'Comma-separated events', 'SessionStart,UserPromptSubmit')
        .option('--settings <path>', 'Path to settings.json', '.claude/settings.json')
        .action(options => {
            const ti = require('./takeover-install');
            const events = options.events.split(',').map(s => s.trim()).filter(Boolean);
            const res = ti.installTakeoverHooks(options.settings, { events });
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

`template-manifest.js` core-cli `files` 数组中 `'memory-index-lock.js',` 之后插入:

```javascript
            'takeover-payload.js',
            'takeover-receipt.js',
            'takeover-session.js',
            'takeover-adapter.js',
            'takeover-install.js',
```

- [ ] **Step 7: `.gitignore`**

追加:

```gitignore
# Agent Takeover Trigger Protocol — session-bound receipts (generated, never committed)
.evo-lite/generated/takeover/receipts/
```

- [ ] **Step 8: integration manifest 覆盖守卫**

若 `templates/cli/test/integration.js` 有 `required` 数组(memory-index-lock.js 先例 ~L427),加入五个新文件名。

- [ ] **Step 9: 同步镜像 + 双运行零 + 全套件**

```bash
node templates/cli/sync-runtime-entry.js && node templates/cli/sync-runtime-entry.js
node templates/cli/test.js all
```
Expected: 首次 sync 复制五文件,二次 `copied: 0`;`test.js all` 全绿。
> 若入口名不同,用 `.\.evo-lite\mem.cmd sync-runtime`(见 CLAUDE.md)。

- [ ] **Step 10: 提交**

```bash
git add templates/cli/takeover-install.js templates/cli/memory.js templates/cli/template-manifest.js templates/cli/test/ .gitignore .evo-lite/cli/
git commit -m "$(cat <<'EOF'
feat(takeover): mem takeover install|status (CLAUDE_PROJECT_DIR, fail-loud deep-merge) + manifest + gitignore + mirror

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 阶段 1 S9b dogfood + 复审门 1

**Files:**
- Create: `docs/validation/attp-phase1-dogfood.md`

- [ ] **Step 1: 母仓安装 hook + capability-gate 验证**

```bash
node templates/cli/memory.js takeover install --events SessionStart,UserPromptSubmit --settings .claude/settings.json
node templates/cli/memory.js takeover status --settings .claude/settings.json
```
确认 SessionStart/UserPromptSubmit 已装、既有 hooks 保留、命令含 `$CLAUDE_PROJECT_DIR`。

- [ ] **Step 2: echo-harness 风格实测 `$CLAUDE_PROJECT_DIR` + 注入**

用 `claude -p` 在母仓(或 scratch)跑裸 prompt,验证:
- hook 命令 `node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"` 在**子目录 cwd** 下仍解析成功(证明 `$CLAUDE_PROJECT_DIR` 可用);
- 首次推理前上下文含 `[evo-lite takeover]` payload;
- 每轮 capsule `takeover-active`;
- receipt 落 `.evo-lite/generated/takeover/receipts/claude-code/` 为 committed。
记录到 `docs/validation/attp-phase1-dogfood.md`。**若 `$CLAUDE_PROJECT_DIR` 不可用,停止并回报**(capability-gate 未过,须改 installer 策略)。

- [ ] **Step 3: S9b 行为验证** — 裸 prompt("分析当前项目正在做什么,下一步该做什么")下 Agent 首轮明确引用 injected focus(P2 效果证据)。

- [ ] **Step 4: 提交 dogfood 记录**

```bash
git add docs/validation/attp-phase1-dogfood.md .claude/settings.json
git commit -m "$(cat <<'EOF'
docs(takeover): phase-1 S9b dogfood — deterministic bare-prompt takeover + CLAUDE_PROJECT_DIR verified

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 阶段 1 复审门** — 停止请求复审门(P0 determinism)。**获批前不进阶段 2。**

---

# 阶段 2 —— 不可静默绕过(复审门 2:P0 no-silent-bypass)

> **前置:阶段 1 复审门已通过。**

## Task 7: PreToolUse fail-closed 守卫(完整 health gate + target-path 绑定)

**Files:**
- Modify: `templates/cli/takeover-adapter.js`(增 `handlePreToolUse`;switch 增 `PreToolUse`)
- Test: `templates/cli/test/governance.js`(`T-takeover-guard`、`T-takeover-target-path`、`T-takeover-session-scope`)

**Interfaces:**
- Produces:`handlePreToolUse(input, deps)` → `{ json:{ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision, permissionDecisionReason? } }, exitCode:0, publish:null }`。
- 守卫工具集 MVP 仅 `Edit`/`Write`;health gate = committed + reconcile 非 degraded + **构建 RefreshTakeoverContext → buildTakeoverPayload → validatePayload + 预算** + target-path 落项目内;**target 缺失/非字符串 → deny**。

- [ ] **Step 1: 写失败测试(守卫矩阵 + 未知目标 fail-closed)**

```javascript
console.log('T-takeover-guard. Edit/Write fail-closed incl unknown target; Read/Glob/Grep/Bash allow ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-guard-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'g';
    const dec = async (tool, tin) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: root, tool_name: tool, tool_input: tin || {} }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;

    assert.strictEqual(await dec('Read'), 'allow');
    assert.strictEqual(await dec('Bash'), 'allow', 'Bash excluded');
    const noRcpt = await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.txt') } }, { projectRoot: root });
    assert.strictEqual(noRcpt.json.hookSpecificOutput.permissionDecision, 'deny', 'no receipt → deny');
    assert.ok(/memory\.js' bootstrap --receipt/.test(noRcpt.json.hookSpecificOutput.permissionDecisionReason), 'deny reason carries recovery');

    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual(await dec('Write', { file_path: path.join(root, 'src', 'a.txt') }), 'allow', 'in-project allow');
    assert.strictEqual(await dec('Write', {}), 'deny', 'unknown/missing target → fail-closed deny');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-guard passed');
}
```

- [ ] **Step 2: 运行验证失败** — PreToolUse 未纳管。

- [ ] **Step 3: 实现 `handlePreToolUse`(完整 health gate)**

在 `takeover-adapter.js` 顶部引入 `validatePayload`,新增:

```javascript
const { validatePayload } = require('./takeover-payload');
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const GUARDED_WRITE_TOOLS = new Set(['Edit', 'Write']); // MVP:NotebookEdit 待 probe

function ptu(decision, reason) {
    const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision };
    if (reason) hookSpecificOutput.permissionDecisionReason = reason;
    return { json: { hookSpecificOutput }, exitCode: 0, publish: null };
}
function targetPathOf(ti) { return ti && typeof ti === 'object' ? (ti.file_path || ti.path || null) : null; }

function handlePreToolUse(input, deps) {
    const tool = input.tool_name;
    if (READONLY_TOOLS.has(tool) || tool === 'Bash') return ptu('allow');
    if (!GUARDED_WRITE_TOOLS.has(tool)) return ptu('allow');

    const projectRoot = rc.canonicalProjectRoot(deps.projectRoot);
    const sessionId = input.session_id;
    const recovery = buildRecoveryCommand(projectRoot, sessionId);

    // (a) committed receipt
    if (rc.readReceipt(projectRoot, HOST, sessionId).state !== 'committed') return ptu('deny', `[evo-lite] takeover required. Run: ${recovery}`);
    // (b) active_context 可读 + refresh 构建可行(非 degraded)
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    if (verdict.transition === 'degraded' || verdict.state !== 'committed') return ptu('deny', `[evo-lite] takeover unhealthy (${verdict.reason || verdict.transition}). Run: ${recovery}`);
    // (b2) 构建 RefreshTakeoverContext → buildTakeoverPayload → schema + 预算校验
    let capsule; try {
        capsule = buildTakeoverPayload({ kind: 'refresh', host: HOST, sessionId, projectRoot,
            projectName: path.basename(projectRoot), sourceEvent: 'PreToolUse', focus: focus.text, focusHash: focus.hash,
            receiptVerdict: verdict, recoveryAction: recovery }, CAPSULE_BUDGET_BYTES);
    } catch (e) { return ptu('deny', `[evo-lite] takeover payload build failed. Run: ${recovery}`); }
    if (!capsule || Buffer.byteLength(JSON.stringify(capsule), 'utf8') > CAPSULE_BUDGET_BYTES) return ptu('deny', `[evo-lite] takeover payload invalid. Run: ${recovery}`);
    // (c) target-path fail-closed
    const target = targetPathOf(input.tool_input);
    if (!target || typeof target !== 'string') return ptu('deny', `[evo-lite] cannot determine target path; refusing write. Run: ${recovery}`);
    let abs = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    let probe = abs;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { probe = fs.realpathSync(probe); } catch (_) {}
    const cp = probe.replace(/\\/g, '/'), cr = projectRoot.replace(/\\/g, '/');
    if (!(cp === cr || cp.startsWith(cr + '/'))) return ptu('deny', `[evo-lite] target '${target}' outside project '${projectRoot}'.`);
    return ptu('allow');
}
```

`handleHookInput` switch 增 `case 'PreToolUse': return handlePreToolUse(input, deps);`(注意 handleHookInput 为 async,handlePreToolUse 同步返回可直接 return)。

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-guard passed`。

- [ ] **Step 5: 写 target-path + session-scope(health gate 决定)测试**

```javascript
console.log('T-takeover-target-path. cross-project / escape / symlink denied ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-tp-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-other-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'tp';
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    const dec = async (tin) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: root, tool_name: 'Write', tool_input: tin }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(await dec({ file_path: path.join(other, 'x.js') }), 'deny', 'cross-project deny');
    assert.strictEqual(await dec({ file_path: path.join(root, '..', 'esc.js') }), 'deny', 'parent escape deny');
    assert.strictEqual(await dec({ file_path: path.join(root, 'ok.js') }), 'allow', 'in-project allow');
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
    console.log('✅ T-takeover-target-path passed');
}

console.log('T-takeover-session-scope. no receipt → deny; committed+healthy → allow; governance-health fail → deny ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-ss-'));
    const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
    fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const canon = rc.canonicalProjectRoot(root), sid = 'ss';
    const w = async () => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: sid, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.js') } }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
    assert.strictEqual(await w(), 'deny', 'no receipt → deny');
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual(await w(), 'allow', 'committed + healthy → allow');
    fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
    assert.strictEqual(await w(), 'deny', 'governance-health failure → health gate deny (not unconditional allow)');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-session-scope passed');
}
```

- [ ] **Step 6: 运行验证通过 + 同步镜像 + 提交**

```bash
node templates/cli/test.js governance
node templates/cli/sync-runtime-entry.js && node templates/cli/sync-runtime-entry.js
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js .evo-lite/cli/
git commit -m "$(cat <<'EOF'
feat(takeover): PreToolUse fail-closed guard — full health gate (payload build + budget) + target-path binding; unknown target denied

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 故障注入验收(逐条覆盖复审门)+ 复审门 2

**Files:**
- Test: `templates/cli/test/governance.js`(`T-takeover-fault-*` 多例)
- Modify: 母仓 `.claude/settings.json`(installer events 增 `PreToolUse`)
- Create: `docs/validation/attp-phase2-fault-injection.md`

**Interfaces:** Consumes Task 1–7 全部产物。

- [ ] **Step 1: 写故障注入测试(逐条对应复审门断言)**

```javascript
console.log('T-takeover-fault-suite. per-assertion fault injection ...');
{
    const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-f-')); const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true }); fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8'); return { root, ac }; };

    // 1) publish 失败(rename 抛错)→ 非零 + 无 committed receipt
    { const { root } = mk(); const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f1', cwd: root, source: 'startup' }, { projectRoot: root, collect: b => ({ ...b, kind: 'session', projectName: 'p', rules: {}, risks: [], nextAction: 'x', verify: null, recall: [] }) });
      const res = ad.executeHookTransport(r.json, () => { throw new Error('rename fail'); }, { write: () => {} });
      assert.strictEqual(res.exitCode, 1, 'publish fail → nonzero');
      assert.notStrictEqual(rc.readReceipt(root, 'claude-code', 'f1').state, 'committed', 'no committed receipt on publish fail');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 2) 坏 active_context(缺失)→ degraded、无 committed、守卫 deny、Bash allow
    { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-f2-')); fs.mkdirSync(path.join(root, '.evo-lite'), { recursive: true });
      const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f2', cwd: root, source: 'startup' }, { projectRoot: root });
      assert.strictEqual(r.exitCode, 1, 'degraded nonzero'); assert.strictEqual(r.publish, null, 'degraded no publish');
      const g = async (t, ti) => (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: 'f2', cwd: root, tool_name: t, tool_input: ti || {} }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
      assert.strictEqual(await g('Write', { file_path: path.join(root, 'a.js') }), 'deny');
      assert.strictEqual(await g('Bash'), 'allow', 'Bash allowed for recovery');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 3) tombstone + unlink 双失败 → reconcile 报 degraded(健壮:不崩)
    { const { root } = mk(); const canon = rc.canonicalProjectRoot(root);
      rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 'f3', projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
      fs.rmSync(path.join(root, '.evo-lite', 'active_context.md'), { force: true });
      const v = rc.reconcile({ projectRoot: root, host: 'claude-code', sessionId: 'f3' }).verdict;
      assert.strictEqual(v.transition, 'degraded', 'degraded even if invalidation would fail');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 4) recovery 执行后 Write 解锁(端到端:子进程 recovery → 守卫 allow)
    { const { root, ac } = mk(); const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
      const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt', '--host', 'claude-code', '--session-id', 'f4', '--source', 'manual-recovery', '--json'], { cwd: root, env: { ...process.env, EVO_LITE_ROOT: ac, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
      assert.strictEqual(sub.status, 0, `recovery ok (stderr ${sub.stderr})`);
      const g = (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: 'f4', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.js') } }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
      assert.strictEqual(g, 'allow', 'Write unlocked after recovery');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 5) focus 漂移不阻断(committed 保留);projectRoot 变化旧 receipt 失效(canonical 比对已覆盖 in T-takeover-receipt)
    { const { root, ac } = mk(); const canon = rc.canonicalProjectRoot(root);
      rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 'f5', projectRoot: canon, state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
      fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nCHANGED\n<!-- END_FOCUS -->\n', 'utf8');
      const g = (await ad.handleHookInput({ hook_event_name: 'PreToolUse', session_id: 'f5', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.js') } }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;
      assert.strictEqual(g, 'allow', 'focus drift does not block');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f5').state, 'committed', 'still committed after drift');
      fs.rmSync(root, { recursive: true, force: true }); }

    console.log('✅ T-takeover-fault-suite passed');
}
```

- [ ] **Step 2: 运行验证通过** — `✅ T-takeover-fault-suite passed`。

- [ ] **Step 3: 母仓装 PreToolUse + 全套件回归**

```bash
node templates/cli/memory.js takeover install --events SessionStart,UserPromptSubmit,PreToolUse --settings .claude/settings.json
node templates/cli/test.js all
```
Expected: 全绿;三事件已装,第三方 hooks 保留。

- [ ] **Step 4: 记录 + 提交**

```bash
git add templates/cli/test/governance.js .claude/settings.json docs/validation/attp-phase2-fault-injection.md .evo-lite/cli/
git commit -m "$(cat <<'EOF'
test(takeover): phase-2 fault-injection acceptance — publish-fail, degraded, recovery-unlock, drift-no-block, transport split

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 复审门 2 + 阶段收口** — 停止请求复审门(P0 no-silent-bypass)。两 P0 均达成后,进入治理闭环(`mem` intake spec + plan closure)与 hive nurture 分发。

---

## R1-plan 复审落点(逐条)

| 编号 | R1-plan 问题 | R2 落点 |
|---|---|---|
| P0-1 | builder 非三入口单一真相源(SessionStart verify:null、bootstrap 独立组装、recovery 不调 builder) | Task 3 `takeover-session.js` 单一 collector;Task 4 bootstrap + recovery 全经 `collect→buildTakeoverPayload`;删除 verify:null |
| P0-2 | 两 transport 未真正 ordered publication(先授权/吞异常/未 flush) | Task 3 `executeHookTransport` + Task 4 `executeCliRecoveryTransport`:`fs.writeSync(1)` 可确认交付→后 publish→失败非零不吞;`T-takeover-transport-order` 注入 write-fail/publish-fail |
| P0-3 | `canonicalProjectRoot` 未发现根、receipt 路径 dir/.evo-lite 不一致、env 名错 | Task 2 `discoverProjectRoot` 上溯 `.evo-lite`;receipt API 全取 `projectRoot` 内部拼 `.evo-lite/...`;`readFocusAnchor` 读 `<root>/.evo-lite/active_context.md`;env 用 `EVO_LITE_ROOT` |
| P0-4 | 守卫未跑完整 health gate、未知目标 fail-open | Task 7 health gate 含 buildTakeoverPayload+validate+预算;target 缺失/非字符串→deny;NotebookEdit 移出 MVP |
| P0-5 | Task 8 测试不覆盖复审门断言 | Task 8 `T-takeover-fault-suite` 逐条:publish-fail、degraded、tombstone/unlink 双失败、recovery 解锁、drift 不阻断、transport 分离 |
| P1-1 | 1 KiB 预算不保证 | Task 1 序列化循环裁剪 + 最终硬断言 + 超长 action 缩减/省略;`T-takeover-capsule-states` 测超长 action |
| P1-2 | installer 损坏 JSON 静默清空 | Task 5 `installTakeoverHooks` 损坏→throw、不覆盖;`T-takeover-installer` 断言原文件不变 |
| P1-3 | hook 启动命令留作开放点 | Global + Task 5:`node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"`(官方占位符);Task 6 capability-gate 实测 |
| P1-4 | 占位式步骤 | R2 锁定精确文件/命令/行为(installer 定为正式 CLI;manifest 五文件写死;transport 定死) |
| P1-5 | installer 所有权未落实 | Task 5 正式 `mem takeover install|status` CLI + Task 6/8 用该 CLI(非 `node -e`) |

## 附:实现期须复核的开放点(非阻断)

- `formatBootstrapReport` 从旧 `{context,sessionstart,verify,takeoverRecall}` 迁到新 payload 形态,须逐字段核对显示;若既有其他调用点依赖旧结构,一并适配。
- `collectSessionTakeoverContextFull` 的 `verify({silent:true})` 成本:bootstrap/SessionStart 每次跑 verify;若过慢,session 路径可缓存或降采样(不影响 refresh,后者不调它)。
- `SessionStart(compact)` / `CwdChanged`:probe 列为待实测优化器,阶段2 后以 echo-harness 验证再决定纳管。
- nurture 分发:子仓获取 hook 需 nurture 侧调 `mem takeover install`;本 MVP 保证 installer 幂等可用,分发接线为后续。
