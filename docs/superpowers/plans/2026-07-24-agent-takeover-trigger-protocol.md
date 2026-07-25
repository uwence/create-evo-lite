# Agent Takeover Trigger Protocol Implementation Plan (R11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让裸 prompt 下的 Claude Code Agent 无需用户提醒即确定性地进入 Evo-Lite 项目接管,并在无有效接管上下文时对 Edit/Write fail-closed。

**Architecture:** 三层协议 —— ①host-agnostic 纯函数 builder(`takeover-payload.js`)+ 两个 discriminated validator;②Claude Code 生命周期 adapter(`takeover-adapter.js`);③PreToolUse fail-closed 守卫。**三条入口(`mem bootstrap` / SessionStart hook / CLI recovery)统一经单一 collector `collectSessionTakeoverContextFull`(`takeover-session.js`)→ `buildTakeoverPayload` → `validateSessionPayload` → 各自 transport**。receipt(`takeover-receipt.js`)session-scoped、ordered publication、硬字段 fail-closed。

**Tech Stack:** Node.js (CommonJS), commander, Claude Code hooks(`hookSpecificOutput.additionalContext` / `permissionDecision` / `${CLAUDE_PROJECT_DIR}`), 现有 `test/harness.js` + assert 骨架。

**契约文档(canonical):** `docs/superpowers/specs/2026-07-24-agent-takeover-trigger-protocol-design.md`(R6:R5 APPROVED 基线 + §0.1 宿主契约勘误)。**probe:** `docs/validation/attp-cc-capability-probe.md`(2.1.218)。

**计划 R1→R10 外部复审(累计 28 个 P0)已折入**,逐条见文末《复审落点》。

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
- Claude Code hooks 官方契约(`code.claude.com/docs/en/hooks`,R6 复核):**JSON 只在 exit 0 时被解析**;exit 2 = 阻断且忽略 stdout/JSON;**exit 1 = 非阻断错误,动作继续**(JSON 同样不生效);`UserPromptSubmit`/`UserPromptExpansion`/`SessionStart` 的 stdout 才会成为 Claude 可见上下文;`additionalContext`/`systemMessage`/stdout **上限 10,000 字符**。
- `memory.js` 的 `runReceiptRecovery(options)` **强制要求 `--session-id`**(缺失即抛 Usage 错误)→ 任何"恢复命令"文案都必须带当前 `session_id`,否则 Agent 执行即失败。
- Node `child_process` 的 `shell` 选项:`shell:true` 在 win32 上取 `process.env.comspec`(通常 `cmd.exe`),**与 Claude Code 执行 hook command 的 shell 不是一回事**;`shell:'<path>'` 时 Node 仅在 basename 为 `cmd.exe` 时用 `/d /s /c`,否则用 `-c`。因此 POSIX 语义命令必须显式传 shell 路径,且**本机 shell 差异不得成为拒装理由**(见 Task 6)。

## Global Constraints

- **宿主范围:** 仅 Claude Code(MVP);非 Claude 宿主只静态 fallback。
- **单一 collector + 单一 builder + 强制校验:** 三条入口全部 `collectSessionTakeoverContextFull(...)` → `buildTakeoverPayload(...)` → **`validateSessionPayload(...)` 通过后才 transport**;禁止任何入口自拼语义或硬编码 `verify:null`/`recall:[]`。**`UserPromptSubmit` 每轮 capsule 同样强制 `validateCapsule`**(probe 已确认宿主静默丢弃类型错字段,无效 capsule = 静默失去再播种能力);校验不过 → emergency degraded capsule + `failure`/`systemMessage`/stderr,**且 `exit 0`**(非零会让宿主丢弃该 capsule)。
- **锚点解析 fail-closed:** `readFocusAnchor` 在 `BEGIN_FOCUS/END_FOCUS` 非严格一对时返回 `null`(文件存在但结构损坏**不得**当作"空 focus 的健康态");`readMetaAnchor` 返回 `{ok, reason, meta}`,锚点缺失/`ahead|behind` 非整数 → `ok:false` 并入 `degraded[]`,**`NaN` 绝不进入 freshness**。
- **schema 深校验:** `validateSessionPayload` 校验 `active.plan/spec`(null 或含非空 `id` 的对象)、`freshness` 三键齐全且数值有限或 null、`health.takeover` 枚举、`verify.hasAlerts` 布尔、`recall.status` 字符串、`degraded[]` 每项 `{part:string, reason:string}`。可恢复降级由 collector 归一化为**保守但合法**的值(`hasAlerts:true` / `recall.status:'unavailable'`),事实由 `degraded[]` + `attention-needed` 承载。
- **失败不可静默:** 承重字段获取失败**禁止空 catch 变 null**。**可恢复**失败(verify/recall/plan-ir/meta)→ 记入 `payload.degraded[]` 结构化状态并 `health.takeover='attention-needed'`,仍交付;**不可恢复**失败(focus 不可读、initDB/memory.service 加载失败、payload 校验不过)→ establishment 失败、**不发布 receipt**、`failure` 字段 + `systemMessage` + stderr 显式报告(**hook 路径仍 exit 0**,见宿主 transport 语义)。
- **项目根严格 fail-closed:** `discoverProjectRoot(startDir)` 向上找最近含 `.evo-lite/` 的祖先,**找不到即抛错**;`canonicalProjectRoot` **不得**退回 `path.resolve(base)`。scaffold 场景不复用此函数。
- **canonicalization / realpath 全链 fail-closed(无一处 fail-open):** ①`canonicalProjectRoot` 的 `realpathSync` 失败**即抛**(未经物理解析的字符串不是 canonical root);②`invalidateReceipt` canonicalization 失败**不得**用 `path.resolve` 造替代 identity —— 跳过 tombstone,只允许"不写入任何身份"的 unlink 撤销,再失败则报 `ok:false`;③守卫解析 target 时,目标或其**最近存在祖先**的 `realpathSync` 失败**即 deny**;④守卫任何一步抛错(含根解析)**一律 deny**,绝不落到 `main` 的通用错误路径(PreToolUse 无 `permissionDecision` = 放行)。
- **receipt 路径 project-bound:** 所有 receipt API 取 canonical `projectRoot`,内部计算 `<projectRoot>/.evo-lite/generated/takeover/receipts/<host>/<sha256(host\0sessionId)>.json`;`readFocusAnchor`/`readMetaAnchor` 直接读 `<projectRoot>/.evo-lite/active_context.md`(**不**用 `getActiveContextPath()`)。gitignore、不入模板真相源、不提交;temp+rename 原子。
- **ordered publication(先确认交付、后授权、不吞错):** 两条 transport 共用 `writeAllSync(fd, text)`(**循环处理 partial write,确认全部 UTF-8 字节写出**)→ 成功后才 `publishReceipt` → 写失败**不 publish**;publish 失败**显式输出 stderr 且返回非零**;发布后无可失败业务操作。CLI recovery **先输出 payload、后发布授权**,不得在发布前打印完成态文案。
- **硬有效性:** `state==="committed"` 且 `schemaVersion`+`host`+`sessionId`+`projectRoot` 全匹配且文件可解析;否则 invalid。软字段不参与 fail-closed。
- **establishment vs refresh 由 receipt 存在性判定,非 `SessionStart.source`。**
- **不变量 6(refresh 隔离):** refresh call graph(UserPromptSubmit / reconcile / readReceipt / readFocusAnchor / 守卫 health gate)**禁载** `memory.service`/`db`/memory-index/zvec/`takeover-session`;collector 仅在 session 路径 lazy require。
- **capsule 预算:** 量最终注入的 additionalContext UTF-8 字节,硬上限 **1 KiB**;序列化后循环裁剪 + 最终硬断言;固定字段 `evoLite`/`project`/`receipt`/**`focusHash`(可为 null 但键必存)**永不删除;先裁 `focus`,再缩减/省略 `action`,最后回退固定短 degraded capsule(**仍尽量携带真实 `focusHash`**,输入无 hash 时才为 `null`);Unicode code point 边界截断。健康 capsule 不含 `action`/`refresh`。
- **宿主 transport 语义:结构化 hook JSON 必须 `exit 0`(R5 复审 P0-1,官方契约):** 文档明确 —— *"Exit 0 means success. Claude Code parses stdout for JSON output fields. **JSON output is only processed on exit 0.** Exit 2 … ignores stdout and any JSON in it"*,且 **exit 1 属非阻断错误,动作继续**。因此**凡是已成功序列化 hook envelope 的处理结果一律 `exitCode: 0`** —— 否则 degraded capsule / 恢复说明 / `systemMessage` 全被宿主丢弃,失败反而变成静默。失败状态改由**四个宿主可见的通道**表达:① `takeover-degraded` capsule;② `systemMessage`;③ **不发布 committed receipt**;④ PreToolUse 的 `permissionDecision:"deny"`。**仅**以下情形返回非零:JSON 序列化失败、stdout 写出失败、receipt ordered publication 失败、CLI recovery 失败(CLI 不是 hook,非零是正确信号)。handler 另返回 `failure:string|null` 供测试与 stderr 断言,**失败可观测性不依赖退出码**。
- **hook 输出字符上限(官方):** `additionalContext`/`systemMessage`/裸 stdout 上限 **10,000 字符**,超出会被转存文件 + 预览替换。本设计 1 KiB capsule 预算远在其下,故无冲突;但**不得**据此放宽 1 KiB。
- **emergency capsule 恒为合法预算内 JSON(不得退回裸文本):** `UserPromptSubmit` 任何失败(builder 抛错 / capsule 非法 / 根解析失败)都走 `buildEmergencyCapsule(input, budget)` —— **不依赖可能已失败的正常 builder**,复用同一套 UTF-8 裁剪,按固定阶梯降级(全量 → 去 `action` → 去 `focusHash` → 裁 `project` → 常量地板),**恒 ≤ 预算且恒过 `validateCapsule`**;恢复命令**只整条带上或整条省略,绝不截断**,省略时完整命令改由 hook 的 `systemMessage` 承载。adapter **禁止**任何"校验不过就发普通文本"的分支。
- **守卫路径解析用 `lstat`,不用 `exists`:** `existsSync` 跟随链接,**断链 symlink/junction 会返回 false**,与"文件尚未创建"无法区分;若按后者退到父目录就会放行,而 Write 仍会沿链接写到项目外。向上查找必须用 `rc.pathEntryInfo`(lstat),**条目存在(含链接)即停并物理解析**,realpath 失败 → deny。
- **受管 settings 唯一:** 本工具只写/删 `<canonicalProjectRoot>/.claude/settings.json` 及其**同目录、精确命名**的备份 `settings.json.attp-backup-<pid>-<12hex>`。`--settings` 可传但解析结果必须精确等于该受管文件;manifest 增 `kind`+`schemaVersion`,`sha256` 须 64 位十六进制。**"项目内 + 名字含 marker" 不构成授权** —— 否则被篡改的 manifest 能让 restore 覆盖、让 discard 删除项目内任意文件。
- **守卫(阶段2):** Edit/Write allow ⟺ committed receipt + reconcile 非 degraded + **`buildTakeoverPayload(refresh)` → `validateCapsule` → 字节预算** 全过 + target-path 落 receipt.projectRoot 内;**target 缺失/非字符串/解析失败 → deny**。Read/Glob/Grep/Bash → allow;**MVP 守卫工具集仅 `Edit`/`Write`**。
- **hook 启动命令与 probe 分层(本机 shell ≠ 宿主 shell):** 命令固定为 `node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"`。**安装闸只用与 shell 无关的两项**:`probeAdapterBinary`(直接 `process.execPath` 跑 adapter,产出 hook envelope)+ `verifyHookCommandShape`(静态断言命令引用受管 adapter 路径且 `$CLAUDE_PROJECT_DIR` 处于双引号内)。`probeHookCommand(projectRoot, {shell})` **降级为诊断,不作安装闸**,且**必须显式指定 shell**(`resolveHostShell()`:`CLAUDE_CODE_GIT_BASH_PATH` / `EVO_LITE_HOOK_SHELL` → win32 上的 Git Bash → 非 win32 的 `/bin/sh`);shell 不可发现时返回 `{ok:true, skipped:true}` —— **绝不因本机 OS shell 与 Claude 宿主 shell 不同而误拒装**。**宿主 transport 的权威证据只有 Step 9 的真实 `claude -p` dogfood**(宿主自己执行那条命令并观测 marker),不是本地 spawn。
- **installer:** 幂等 deep-merge,保留未知字段/第三方 hooks;`install` 与 `status` 遇损坏 JSON **均 fail loudly、不覆盖、不静默降级**;probe 通过才 temp+rename 原子替换,失败保留原文件;正式 CLI `mem takeover install|status|rollback`。
- **settings 物理边界(字符串前缀不算边界):** settings 路径一律经 `resolveManagedSettingsPath` —— realpath 项目根、realpath settings 自身(不存在则解析最近存在祖先再拼尾部),**物理落点必须在项目内**;损坏链接 / realpath 失败 / 越界一律抛错。`.claude` 若是指向项目外的 symlink/junction,字面路径仍在项目内但**必须拒绝**。`restoreSettings`/`discardBackup` 读 manifest 后**再验证**(schema + 两路径物理归属 + `.attp-backup-` 命名),不过即抛,**不写不删**。
- **代码落地前先过语法闸:** 五个新模块在 sync 前逐个 `node --check`,任一不过即停 —— 语法错要到 `require` 阶段才暴露,会同时废掉 installer、CLI 与 dogfood。
- **settings 事务化(备份失败即停,回滚恢复原始字节):** dogfood 前必须 `backupSettings` —— 原文件存在却备份失败(写失败/回读不一致)**立即抛错、绝不继续安装**;备份走**唯一临时路径 + 确定性 manifest**(`.evo-lite/generated/takeover/settings-backup.json`,含 `existed/backupPath/sha256`),manifest 已存在即 fail loud(不覆盖旧备份);`restoreSettings` 按 manifest **恢复原始字节**,仅当 `existed:false` 时才允许"删除新建文件";install 自身失败**自动回滚**。此契约由自动化测试覆盖,不只是手册步骤。
- **可注入 seam(测试用,前缀 `__`):** `takeover-receipt.__setFsOps/__resetFsOps`;transport `{ write }`;adapter `deps.{collect,buildPayload,validate}`。生产路径默认真实实现。
- **镜像:** 新文件落 `templates/cli/**`;不手改 `.evo-lite/cli/**`;`node templates/cli/sync-runtime-entry.js` 后 `git add` 镜像;二次运行 `copied: 0`。
- **两阶段两复审门:** 阶段1(Task 1–6)复审门批准后才进阶段2(Task 7–8);每任务 SDD 独立复审。
- **语言:** 用户可见中文;代码标识符/日志英文。commit trailer:`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

# 阶段 1 —— 确定性接管(复审门 1:P0 determinism)

### Task 1: 纯函数 builder + 两个 discriminated validator(`takeover-payload.js`)

**Files:**
- Create: `templates/cli/takeover-payload.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-payload`、`T-takeover-capsule-states`)

**Interfaces:**
- Produces:
  - `buildTakeoverPayload(context, budget?)` → `TakeoverPayload`(`kind:'session'`)| `Capsule`(`kind:'refresh'`,序列化后硬保证 ≤ budget)
  - `validateSessionPayload(payload)` → `{ ok, errors[] }`(**完整 session schema**:顶层字段 + `project/focus/active/rules/health` 对象形状 + `risks/degraded/recall` 类型)
  - `validateCapsule(capsule, budget)` → `{ ok, errors[] }`(capsule 专用:`evoLite` 枚举、`receipt` 枚举、固定键存在、字节 ≤ budget)
  - `buildEmergencyCapsule({ projectName, focusHash, recoveryAction, reason }, budget?)` → `{ capsule, systemMessage }`(**独立于正常 builder**;恒 ≤ budget 且恒过 `validateCapsule`;`action` 装不下则整条省略并把完整恢复命令放进 `systemMessage`)
  - `SCHEMA_VERSION=1`、`CAPSULE_BUDGET_BYTES=1024`、`EMERGENCY_FLOOR_BYTES`、`TRANSITION_TO_EVOLITE`
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

    // 完整 schema:缺字段必失败
    for (const drop of ['active', 'verify', 'health', 'freshness', 'recall', 'degraded']) {
        const bad = JSON.parse(JSON.stringify(payload)); delete bad[drop];
        assert.strictEqual(tp.validateSessionPayload(bad).ok, false, `missing ${drop} must fail`);
    }
    // 深校验:形似但内容非法的 payload 必须被拒(R3 复审 P0-1 的反例)
    const mutate = (fn) => { const p = JSON.parse(JSON.stringify(payload)); fn(p); return tp.validateSessionPayload(p); };
    assert.strictEqual(mutate(p => { p.risks = 'not-array'; }).ok, false, 'risks must be array');
    assert.strictEqual(mutate(p => { p.risks = [1]; }).ok, false, 'risks entries must be strings');
    assert.strictEqual(mutate(p => { p.project = { name: 'x' }; }).ok, false, 'project.root required');
    assert.strictEqual(mutate(p => { p.active = { plan: 'broken', spec: [] }; }).ok, false, 'active.plan/spec must be null or object with id');
    assert.strictEqual(mutate(p => { p.active.plan = { status: 'draft' }; }).ok, false, 'active.plan.id required');
    assert.strictEqual(mutate(p => { p.freshness = {}; }).ok, false, 'freshness keys required');
    assert.strictEqual(mutate(p => { p.freshness.ahead = NaN; }).ok, false, 'NaN must not pass freshness');
    assert.strictEqual(mutate(p => { p.freshness.ahead = -1; }).ok, false, 'commit counts cannot be negative');
    assert.strictEqual(mutate(p => { p.freshness.behind = 1.5; }).ok, false, 'commit counts must be integers');
    assert.strictEqual(mutate(p => { p.freshness.ahead = null; p.freshness.behind = null; }).ok, true, 'null counts are legal');
    assert.strictEqual(mutate(p => { p.health.takeover = 'anything'; }).ok, false, 'health.takeover is an enum');
    assert.strictEqual(mutate(p => { p.verify = {}; }).ok, false, 'verify.hasAlerts required');
    assert.strictEqual(mutate(p => { p.recall = {}; }).ok, false, 'recall.status required');
    assert.strictEqual(mutate(p => { p.degraded = [42]; }).ok, false, 'degraded entries must be {part,reason}');
    assert.strictEqual(mutate(p => { p.active.plan = null; p.active.spec = null; }).ok, true, 'null plan/spec is legal');

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

const TAKEOVER_HEALTH = new Set(['ready', 'bootstrap-pending', 'attention-needed']);
// ahead/behind 是提交计数:null 或非负整数(NaN / 负数 / 小数一律非法)
const countOrNull = (v) => v === null || (Number.isInteger(v) && v >= 0);

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
    // freshness:规定键齐全,计数必须是非负整数或 null(NaN / 负数 / 小数不得穿过)
    if (!isObj(payload.freshness)) errors.push('bad-freshness');
    else {
        for (const k of ['headSha', 'ahead', 'behind']) if (!(k in payload.freshness)) errors.push(`bad-freshness-${k}`);
        if (!(payload.freshness.headSha === null || typeof payload.freshness.headSha === 'string')) errors.push('bad-freshness-headSha');
        if (!countOrNull(payload.freshness.ahead) || !countOrNull(payload.freshness.behind)) errors.push('bad-freshness-counts');
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
```

- [ ] **Step 4: 运行验证通过**

Run: `node templates/cli/test.js governance`
Expected: PASS — `✅ T-takeover-payload passed`。

- [ ] **Step 5: 写状态映射 + 预算硬保证 + emergency capsule 测试**

```javascript
console.log('T-takeover-capsule-states. transitions + budget always <= 1 KiB + emergency capsule always valid ...');
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
    assert.ok(trimmed.focus.length > 0, 'rung 2 actually trims instead of dropping focus entirely');
    assert.ok('焦'.repeat(5000).startsWith(trimmed.focus), 'the trimmed focus is a real prefix of the original');
    assert.strictEqual(trimmed.focusHash, 'h', 'focusHash preserved when focus trimmed');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(trimmed)));
    // 超长 action + 超长 focus → 仍 ≤ budget,且固定键(含 focusHash)齐全
    const hard = mk('stale', 'invalid', 'r', 'node ' + 'x'.repeat(4000), 'F'.repeat(4000));
    assert.ok(Buffer.byteLength(JSON.stringify(hard), 'utf8') <= 1024, 'oversized action stays within budget');
    for (const k of ['evoLite', 'project', 'receipt', 'focusHash']) {
        assert.ok(k in hard, `fixed key ${k} never dropped`);
    }
    assert.strictEqual(hard.focusHash, 'h', 'real focusHash retained when action is dropped');
    assert.strictEqual(tp.validateCapsule(hard, 1024).ok, true, 'trimmed capsule still valid');
    // 极端回退分支(固定字段本身就超预算)仍保真实 focusHash + 通过校验
    const fallback = tp.buildTakeoverPayload({ kind: 'refresh', host: 'claude-code', sessionId: 's',
        projectRoot: '/p', projectName: 'P'.repeat(3000), sourceEvent: 'UserPromptSubmit',
        focus: 'F', focusHash: 'realhash', receiptVerdict: { state: 'invalid', transition: 'stale', reason: 'r' },
        recoveryAction: 'RC' }, tp.CAPSULE_BUDGET_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(fallback), 'utf8') <= 1024, 'fallback within budget');
    assert.strictEqual(fallback.focusHash, 'realhash', 'fallback keeps the real focusHash (P1-3)');
    assert.strictEqual(tp.validateCapsule(fallback, 1024).ok, true, 'fallback capsule valid');

    // emergency capsule(R4 复审 P0-1):极端超长输入仍必须是【预算内、经校验】的 JSON capsule
    assert.ok(tp.EMERGENCY_FLOOR_BYTES <= tp.CAPSULE_BUDGET_BYTES, 'constant floor fits the standard budget');
    const longRoot = '/' + 'r'.repeat(3000);
    const longSid = 's'.repeat(2000);
    const longAction = `node '${longRoot}/.evo-lite/cli/memory.js' bootstrap --receipt --session-id '${longSid}'`;
    const em = tp.buildEmergencyCapsule({ projectName: 'P'.repeat(4000), focusHash: 'realhash',
        recoveryAction: longAction, reason: 'capsule-invalid' }, tp.CAPSULE_BUDGET_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(em.capsule), 'utf8') <= 1024, 'emergency capsule within budget');
    assert.strictEqual(tp.validateCapsule(em.capsule, tp.CAPSULE_BUDGET_BYTES).ok, true, 'emergency capsule always valid');
    assert.ok(!('action' in em.capsule), 'oversized recovery command omitted entirely, never truncated');
    assert.ok(em.systemMessage.includes(longAction), 'full recovery command moved to systemMessage');
    assert.strictEqual(em.capsule.focusHash, 'realhash', 'project name is trimmed before focusHash is dropped');
    // 正常尺寸:action 内联,systemMessage 为 null
    const emSmall = tp.buildEmergencyCapsule({ projectName: 'proj', focusHash: 'h',
        recoveryAction: 'node mem.js bootstrap --receipt', reason: 'capsule-invalid' }, tp.CAPSULE_BUDGET_BYTES);
    assert.strictEqual(emSmall.capsule.action, 'node mem.js bootstrap --receipt', 'action inlined when it fits');
    assert.strictEqual(emSmall.systemMessage, null, 'no systemMessage needed when action is inlined');
    // 垃圾/缺失输入也必须产出合法 capsule(emergency 路径不得再失败一次)
    for (const junk of [null, undefined, {}, 42, { projectName: 123, focusHash: [], recoveryAction: {} }]) {
        const r = tp.buildEmergencyCapsule(junk, tp.CAPSULE_BUDGET_BYTES);
        assert.strictEqual(tp.validateCapsule(r.capsule, tp.CAPSULE_BUDGET_BYTES).ok, true,
            `emergency capsule valid for junk input ${JSON.stringify(junk)}`);
    }
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

### Task 2: receipt 层(`takeover-receipt.js`)—— 严格根发现 / project-bound 路径 / 有效性 / reconcile / 失效事务 / fs seam

**Files:**
- Create: `templates/cli/takeover-receipt.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-receipt`、`T-takeover-projectroot`、`T-takeover-reconcile`、`T-takeover-degraded`)

**Interfaces:**
- Consumes: `require('./runtime')` 的 `getWorkspaceRoot`(轻量,不载 db)。
- Produces:
  - `discoverProjectRoot(startDir)` → string(向上找最近含 `.evo-lite/` 的祖先;**找不到抛错**)
  - `canonicalProjectRoot(startDir?)` → string(**严格**:discover → realpath → win 规范化;discover 失败**或** realpath 失败**均抛错**,无任何 fail-open 兜底)
  - `evoLiteDir(projectRoot)`、`receiptPathFor(projectRoot, host, sessionId)`
  - `pathEntryInfo(target)` → `{ exists, symbolicLink }`(**用 `lstat`**:断链 symlink 报 `exists:true`,与"尚不存在"严格区分;非 ENOENT 异常抛出)
  - `readFocusAnchor(projectRoot)` → `{ text, hash } | null`
  - `readMetaAnchor(projectRoot)` → `{ ok, reason, meta }`(**永不返回 `null`**;`meta` = `{headSha, upstreamSha, ahead, behind}`,非法数值归一为 `null`;`ok:false` 时 `reason` ∈ `active-context-unreadable|meta-anchor-missing|meta-anchor-malformed|meta-fields-invalid`,由 collector 记入 `degraded[]`)
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
    // realpath 故障注入:canonicalization 失败必须【抛】,不得退回未解析的原路径(R4 复审 P0-2)
    rc.__setFsOps({ realpathSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } });
    try { assert.throws(() => rc.canonicalProjectRoot(root), /cannot canonicalize/i, 'realpath failure is fail-closed'); }
    finally { rc.__resetFsOps(); }
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
    realpathSync: fs.realpathSync, lstatSync: fs.lstatSync,   // lstatSync 供 pathEntryInfo:漏注册会让守卫对健康路径也抛错 → 全 deny
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
// 严格 canonicalization:discover 失败抛;realpath 失败【也抛】。未经物理路径解析的字符串不是
// canonical root —— 用它建立 receipt 身份或做 containment 判断等于 fail-open(R4 复审 P0-2)。
function canonicalProjectRoot(startDir) {
    const root = discoverProjectRoot(startDir || getWorkspaceRoot());
    let real;
    try { real = fsOps.realpathSync(root); }
    catch (e) { throw new Error(`takeover: cannot canonicalize project root ${root}: ${e.message}`); }
    return normalize(real);
}

// 守卫解析 target 时复用同一 fs seam(单一注入点,故障注入可分别覆盖 root 与 target)。
function realpathStrict(p) { return fsOps.realpathSync(p); }   // 失败即抛,调用方 fail-closed
function pathExists(p) { return fsOps.existsSync(p); }

// existsSync 跟随链接:断链 symlink/junction 会返回 false,看起来跟"文件还没建"一模一样。
// 守卫若按后者处理就会退到父目录并放行,而 Write 仍会沿链接写到项目外(R7 复审 P0-1)。
// 这里用 lstat 区分二者:条目本身在不在,以及它是不是链接。
function pathEntryInfo(target) {
    try {
        const st = fsOps.lstatSync(target);
        return { exists: true, symbolicLink: st.isSymbolicLink() };
    } catch (e) {
        if (e && e.code === 'ENOENT') return { exists: false, symbolicLink: false };
        throw e;   // 权限等异常不得当成"不存在"
    }
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
function countMatches(md, re) { const m = md.match(re); return m ? m.length : 0; }

// 锚点解析 fail-closed:BEGIN/END 不是严格一对 → null(视同 active_context 不可用)。
// 文件存在但结构损坏时,绝不返回"空 focus 的健康结果"。
function readFocusAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return null;
    if (countMatches(md, /<!--\s*BEGIN_FOCUS\s*-->/g) !== 1 || countMatches(md, /<!--\s*END_FOCUS\s*-->/g) !== 1) return null;
    const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
    if (!m) return null; // END 在 BEGIN 之前等错序结构
    const text = m[1].trim();
    return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

// META 缺失/字段非法 → { ok:false, reason } 供 collector 记入 degraded;绝不让 NaN 穿到 freshness。
function readMetaAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return { ok: false, reason: 'active-context-unreadable', meta: null };
    if (countMatches(md, /<!--\s*BEGIN_META\s*-->/g) !== 1 || countMatches(md, /<!--\s*END_META\s*-->/g) !== 1) {
        return { ok: false, reason: 'meta-anchor-missing', meta: null };
    }
    const m = md.match(/<!--\s*BEGIN_META\s*-->([\s\S]*?)<!--\s*END_META\s*-->/);
    if (!m) return { ok: false, reason: 'meta-anchor-malformed', meta: null };
    const block = m[1];
    const pick = (key) => { const r = block.match(new RegExp(`${key}:\\s*([^\\s]+)`)); return r ? r[1] : null; };
    const rawAhead = pick('ahead'), rawBehind = pick('behind');
    const toInt = (raw) => {                       // 提交计数:必须是非负整数,否则归一为 null
        if (raw === null) return { ok: false, value: null };
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: null };
    };
    const ahead = toInt(rawAhead), behind = toInt(rawBehind);
    const headSha = pick('headSha');
    const meta = { headSha, upstreamSha: pick('upstreamSha'), ahead: ahead.value, behind: behind.value };
    if (!headSha || !ahead.ok || !behind.ok) {
        return { ok: false, reason: 'meta-fields-invalid', meta }; // meta 仍返回(键齐全、数值为 null)
    }
    return { ok: true, reason: null, meta };
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

// canonicalization 失败时【不得】用 path.resolve 造替代 identity(那会写出一份带假身份的 receipt)。
// 此时只允许"不写入任何身份"的撤销方式 —— unlink;再失败则如实报告 ok:false,由守卫 fail-closed。
function invalidateReceipt(projectRoot, host, sessionId, reason) {
    let canonRoot = null;
    try { canonRoot = canonicalProjectRoot(projectRoot); }
    catch (e) { canonRoot = null; reason = `${reason}; canonicalization-failed: ${e.message}`; }
    if (canonRoot !== null) {
        try {
            publishReceipt(projectRoot, { schemaVersion: RECEIPT_SCHEMA_VERSION, host, sessionId, projectRoot: canonRoot, state: 'invalid', reason });
            return { ok: true, method: 'tombstone', reason: null };
        } catch (_) { /* 回退 unlink */ }
    }
    try {
        const p = receiptPathFor(projectRoot, host, sessionId);
        if (fsOps.existsSync(p)) fsOps.unlinkSync(p);
        return { ok: true, method: 'unlink', reason: null };
    } catch (e) { return { ok: false, method: 'none', reason: e.message }; }
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
    realpathStrict, pathExists, pathEntryInfo, __setFsOps, __resetFsOps,
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
    assert.strictEqual(meta.ok, true);
    assert.strictEqual(meta.meta.headSha, 'abc123'); assert.strictEqual(meta.meta.ahead, 2); assert.strictEqual(meta.meta.behind, 0);

    // 锚点 fail-closed:文件存在但结构损坏 → focus null / meta not-ok(不得当健康处理)
    const acFile = path.join(ac, 'active_context.md');
    const saved = fs.readFileSync(acFile, 'utf8');
    fs.writeFileSync(acFile, '# active_context.md\n这不是合法的 Evo-Lite active context\n', 'utf8');
    assert.strictEqual(rc.readFocusAnchor(root), null, 'missing FOCUS anchor → null (not empty-but-healthy)');
    assert.strictEqual(rc.readMetaAnchor(root).ok, false, 'missing META anchor → not ok');
    assert.strictEqual(rc.readMetaAnchor(root).reason, 'meta-anchor-missing');
    fs.writeFileSync(acFile, '<!-- BEGIN_FOCUS -->\nA\n<!-- END_FOCUS -->\n<!-- BEGIN_FOCUS -->\nB\n<!-- END_FOCUS -->\n', 'utf8');
    assert.strictEqual(rc.readFocusAnchor(root), null, 'duplicated FOCUS anchors → null');
    fs.writeFileSync(acFile, '<!-- BEGIN_META -->\n> headSha: abc\n> ahead: many\n> behind: 0\n<!-- END_META -->\n<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    const badMeta = rc.readMetaAnchor(root);
    assert.strictEqual(badMeta.ok, false, 'non-integer ahead → not ok');
    assert.strictEqual(badMeta.reason, 'meta-fields-invalid');
    assert.strictEqual(badMeta.meta.ahead, null, 'NaN never leaks into freshness');
    fs.writeFileSync(acFile, '<!-- BEGIN_META -->\n> headSha: abc\n> ahead: -3\n> behind: 0\n<!-- END_META -->\n<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
    assert.strictEqual(rc.readMetaAnchor(root).ok, false, 'negative commit count → not ok');
    assert.strictEqual(rc.readMetaAnchor(root).meta.ahead, null, 'negative count normalized to null');
    fs.writeFileSync(acFile, saved, 'utf8');

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

    // pathEntryInfo:守卫的路径判定基元,必须直接测(否则 seam 漏键要等 Task 7 才间接暴露)
    wf('FOCUS-PROBE');   // 前面的 degraded 用例删过 active_context —— 本段自备 fixture,不依赖上游状态
    const existingFile = path.join(ac, 'active_context.md');
    assert.deepStrictEqual(rc.pathEntryInfo(existingFile), { exists: true, symbolicLink: false },
        'a real file exists and is not a link');
    assert.deepStrictEqual(rc.pathEntryInfo(path.join(root, 'nope.txt')), { exists: false, symbolicLink: false },
        'ENOENT means absent, not an error');
    const dangling = path.join(root, 'dangling-link');
    let danglingMade = false;
    try { fs.symlinkSync(path.join(root, 'no-such-target'), dangling, 'file'); danglingMade = true; }
    catch (_) { danglingMade = false; }
    if (!danglingMade) {
        assert.strictEqual(process.platform, 'win32', 'dangling symlink is mandatory on POSIX');
        console.log('   ⏭️ pathEntryInfo dangling case skipped (win32 without symlink privilege)');
    } else {
        assert.strictEqual(fs.existsSync(dangling), false, 'existsSync follows the link and reports absent');
        assert.deepStrictEqual(rc.pathEntryInfo(dangling), { exists: true, symbolicLink: true },
            'lstat sees the link entry itself — this is the distinction the guard depends on');
        fs.rmSync(dangling, { force: true });
    }
    // 非 ENOENT 异常不得被吞成"不存在"
    rc.__setFsOps({ lstatSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } });
    try { assert.throws(() => rc.pathEntryInfo(existingFile), /EACCES/, 'permission errors propagate'); }
    finally { rc.__resetFsOps(); }
    // 生产默认值完整:__setFsOps 合并后所有键仍是函数
    rc.__setFsOps({});
    try { assert.strictEqual(typeof rc.pathEntryInfo(existingFile).exists, 'boolean', 'defaults survive a partial override'); }
    finally { rc.__resetFsOps(); }

    // canonicalization 失败时的失效:绝不写带假身份的 tombstone,只能用不写入身份的 unlink
    wf('FOCUS-D');
    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: 's3', projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    rc.__setFsOps({ realpathSync: () => { throw new Error('EACCES'); } });
    let inv; try { inv = rc.invalidateReceipt(root, 'claude-code', 's3', 'active-context-unreadable'); }
    finally { rc.__resetFsOps(); }
    assert.notStrictEqual(inv.method, 'tombstone', 'no tombstone written without a canonical root');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 's3').state, 'missing', 'receipt revoked by unlink instead');
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

### Task 3: 单一 collector(`takeover-session.js`)—— 现有 bootstrap 四件套 + plan/spec/freshness 派生 + 结构化降级

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

    // 可恢复降级仍须产出【通过 schema 校验】的 payload(保守值 + degraded 承载事实)
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const degradedCtx = ts.assembleSessionContext(
        { host: 'claude-code', sessionId: 's', projectRoot: '/p', sourceEvent: 'x', focus: 'F', focusHash: 'h' },
        { summary: {}, sessionstart: {}, verify: null, recall: null, planSpec: { plan: null, spec: null },
          freshness: { headSha: null, ahead: NaN, behind: null },
          degraded: [{ part: 'verify', reason: 'boom' }, { part: 'recall', reason: 'boom' }] });
    assert.strictEqual(degradedCtx.verify.hasAlerts, true, 'missing verify → conservative hasAlerts=true');
    assert.strictEqual(degradedCtx.recall.status, 'unavailable', 'missing recall → status=unavailable');
    assert.strictEqual(degradedCtx.freshness.ahead, null, 'NaN normalized to null');
    assert.strictEqual(degradedCtx.health.takeover, 'attention-needed');
    assert.strictEqual(tp.validateSessionPayload(tp.buildTakeoverPayload(degradedCtx)).ok, true,
        'recoverable degradation still yields a schema-valid payload');

    // 真实 collector(全新进程内自 initDB,得到真实 verify/recall,不依赖预跑 mem bootstrap)
    const probeScript = `
        const ts = require(${JSON.stringify(path.join(TEMPLATE_CLI_DIR, 'takeover-session.js'))});
        const rc = require(${JSON.stringify(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'))});
        (async () => {
            const root = rc.canonicalProjectRoot();
            const focus = rc.readFocusAnchor(root);
            const c = await ts.collectSessionTakeoverContextFull({ host: 'claude-code', sessionId: 'p',
                projectRoot: root, sourceEvent: 'probe', focus: focus.text, focusHash: focus.hash });
            console.log(JSON.stringify({ verifyHasAlerts: typeof c.verify.hasAlerts, verifyGit: c.verify.git,
                recallStatus: c.recall.status, degraded: c.degraded.map(d => d.part) }));
        })().catch(e => { console.error(e.message); process.exit(3); });`;
    const runtimeRoot = path.join(WORKSPACE_ROOT, '.evo-lite');
    const sub = childProcess.spawnSync(process.execPath, ['-e', probeScript],
        { env: { ...process.env, EVO_LITE_ROOT: runtimeRoot, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
    assert.strictEqual(sub.status, 0, `collector runs in a fresh process (stderr: ${sub.stderr})`);
    const out = JSON.parse(sub.stdout.trim().split('\n').pop());
    // 真实字段断言:verify/recall 双双失败被归一化成保守值时不得误通过(R3 复审 P1-1)
    assert.strictEqual(out.verifyHasAlerts, 'boolean', 'fresh process yields a real verify report');
    assert.ok(typeof out.verifyGit === 'string' && out.verifyGit, 'verify.git present');
    assert.strictEqual(typeof out.recallStatus, 'string', 'recall.status present');
    assert.ok(!out.degraded.includes('verify') && !out.degraded.includes('recall'),
        `verify/recall must not be degraded in a healthy repo (got: ${out.degraded.join(',')})`);
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
    const takeover = needsBootstrap
        ? 'bootstrap-pending'
        : ((verify.hasAlerts || degraded.length > 0) ? 'attention-needed' : 'ready');
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

    return assembleSessionContext(base, {
        summary, sessionstart, verify, recall, planSpec,
        freshness: metaResult.meta || { headSha: null, ahead: null, behind: null }, degraded,
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

### Task 4: 生命周期 adapter + 两条 transport(`takeover-adapter.js`)

**Files:**
- Create: `templates/cli/takeover-adapter.js`
- Test: `templates/cli/test/governance.js`(`T-takeover-adapter-session`、`T-takeover-hook-exit-contract`、`T-takeover-refresh-isolation`、`T-takeover-transport-order`)

**Interfaces:**
- Produces:
  - `writeAllSync(fd, text)`(循环 partial write,确认全部字节;零进展抛错)
  - `reportError(msg)`(**同步**写 fd 2,与业务输出同一套完整写入语义;失败不得再抛)
  - `resolveRoot(deps)` → `{ ok, root } | { ok:false, error }`(canonicalization 失败不抛出到 `main`)
  - `executeHookTransport(json, publish, { write }?)` → `{ exitCode, error? }`
  - `executeCliRecoveryTransport(text, publish, { write }?)` → `{ exitCode, error? }`
  - `buildRecoveryCommand(projectRoot, sessionId)` → string(canonical-root-bound 绝对路径)
  - `buildGenericRecoveryCommand(sessionId)` → `string | null`(根不可知时的相对路径版;**必带 `--session-id`**;无合法 sessionId 返回 `null`)
  - `handleHookInput(input, deps?)` → `Promise<{ json, exitCode, publish|null, failure:string|null }>`(deps 可注入 `{projectRoot, collect, buildPayload, validate, validateCapsule}`)
    - **`exitCode` 恒为 0**(只要 envelope 构造成功);失败由 `failure` + `systemMessage` + degraded capsule + 不发布 receipt 表达
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

    // payload 校验不过 → 不发布;但【exit 0】:非零会让宿主丢弃这段 degraded 上下文(R5 复审 P0-1)
    const bad = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'bad', source: 'startup' },
        { ...deps, buildPayload: () => ({ schemaVersion: 1 }) });
    assert.strictEqual(bad.exitCode, 0, 'structured hook JSON must exit 0 or the host discards it');
    assert.ok(bad.failure && /invalid/.test(bad.failure), 'failure is reported through the failure field, not the exit code');
    assert.ok(bad.json.systemMessage, 'failure also surfaces via systemMessage');
    assert.strictEqual(bad.publish, null, 'invalid payload → no publish');
    assert.strictEqual(rc.readReceipt(root, 'claude-code', 'bad').state, 'missing', 'invalid payload never yields committed receipt');

    const up = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid }, deps);
    assert.strictEqual(up.exitCode, 0);
    assert.strictEqual(JSON.parse(up.json.hookSpecificOutput.additionalContext).evoLite, 'takeover-active');

    // 坏 capsule(builder 被注入返回垃圾)→ validateCapsule 拦截 → emergency capsule,且【exit 0】
    const badUp = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid },
        { ...deps, buildPayload: () => ({ unexpected: true }) });
    assert.strictEqual(badUp.exitCode, 0, 'emergency capsule must exit 0 or it is never ingested');
    assert.ok(badUp.failure, 'failure still reported explicitly (failure field + systemMessage + stderr)');
    const emergency = JSON.parse(badUp.json.hookSpecificOutput.additionalContext);
    assert.strictEqual(emergency.evoLite, 'takeover-degraded', 'emergency capsule emitted');
    assert.ok(/bootstrap --receipt/.test(emergency.action), 'emergency capsule carries recovery command');
    assert.ok(emergency.action.includes(`--session-id '${sid}'`), 'recovery command carries the current session id');
    const tp2 = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    assert.strictEqual(tp2.validateCapsule(emergency, tp2.CAPSULE_BUDGET_BYTES).ok, true, 'emergency capsule itself is valid');

    // 根不可 canonicalize(realpath 抛)→ UPS 仍必须产出【合法 JSON capsule】,绝不退回普通文本;
    // SessionStart 则必须 fail-closed(**exit 0 + 不发布 receipt + failure 标记**),不得抛到 main 的通用错误路径。
    rc.__setFsOps({ realpathSync: () => { throw new Error('EACCES'); } });
    let rootFailUp, rootFailSs;
    try {
        rootFailUp = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid }, deps);
        rootFailSs = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'rootfail', source: 'startup' }, deps);
    } finally { rc.__resetFsOps(); }
    assert.strictEqual(rootFailUp.exitCode, 0, 'root failure still exits 0 (host only parses JSON on exit 0)');
    assert.ok(rootFailUp.failure, 'root failure reported via the failure field');
    const rfCap = JSON.parse(rootFailUp.json.hookSpecificOutput.additionalContext); // 非 JSON 会在此抛
    assert.strictEqual(tp2.validateCapsule(rfCap, tp2.CAPSULE_BUDGET_BYTES).ok, true, 'still a valid capsule, never plain text');
    assert.ok(rfCap.action && rfCap.action.includes(`--session-id '${sid}'`), 'generic recovery command carries the session id');
    assert.strictEqual(rootFailSs.exitCode, 0, 'SessionStart root failure exits 0 so the recovery text is ingested');
    assert.ok(rootFailSs.failure, 'SessionStart root failure reported via the failure field');
    assert.ok(/--session-id 'rootfail'/.test(rootFailSs.json.hookSpecificOutput.additionalContext),
        'SessionStart recovery text carries the session id (runReceiptRecovery requires it)');
    assert.strictEqual(rootFailSs.publish, null, 'no receipt when the root cannot be canonicalized');

    // 无 session_id → 不得谎称可自动恢复
    assert.strictEqual(ad.buildGenericRecoveryCommand(undefined), null, 'no session id → no recovery command');
    assert.ok(/'sid'\\''q'/.test(ad.buildGenericRecoveryCommand("sid'q")), 'session id is bash-escaped');
    const noSid = await ad.handleHookInput({ hook_event_name: 'SessionStart', source: 'startup' }, deps);
    assert.ok(/Cannot auto-recover/i.test(JSON.stringify(noSid.json)), 'missing session id is stated, not papered over');

    // 所有 UPS 失败模式的 additionalContext 都必须是预算内的合法 capsule(统一断言,防止新增分支漏网)
    const failureModes = [
        { label: 'builder-junk', d: { ...deps, buildPayload: () => ({ unexpected: true }) } },
        { label: 'builder-throw', d: { ...deps, buildPayload: () => { throw new Error('boom'); } } },
        { label: 'validator-reject', d: { ...deps, validateCapsule: () => ({ ok: false, errors: ['forced'] }) } },
    ];
    for (const mode of failureModes) {
        const r = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: sid }, mode.d);
        assert.strictEqual(r.exitCode, 0, `${mode.label} → exit 0 (host parses JSON only on exit 0)`);
        assert.ok(r.failure, `${mode.label} → failure reported without relying on the exit code`);
        const cap = JSON.parse(r.json.hookSpecificOutput.additionalContext);
        assert.strictEqual(tp2.validateCapsule(cap, tp2.CAPSULE_BUDGET_BYTES).ok, true, `${mode.label} → valid capsule`);
        assert.ok(Buffer.byteLength(r.json.hookSpecificOutput.additionalContext, 'utf8') <= tp2.CAPSULE_BUDGET_BYTES,
            `${mode.label} → within budget`);
        assert.ok(typeof r.json.systemMessage === 'string' && r.json.systemMessage, `${mode.label} → systemMessage explains it`);
    }
    fs.rmSync(root, { recursive: true, force: true });
    console.log('✅ T-takeover-adapter-session passed');
}

// 真实子进程:证明失败路径在【进程边界】上也满足宿主契约 —— exit 0 + stdout 只有合法 JSON。
// 官方契约:JSON only processed on exit 0;非零时这段 capsule 与 systemMessage 会被整体丢弃。
console.log('T-takeover-hook-exit-contract. failure paths exit 0 with JSON-only stdout ...');
{
    const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
    const tp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-payload.js'));
    const MODULES = ['takeover-adapter.js', 'takeover-payload.js', 'takeover-receipt.js', 'runtime.js'];
    const runHook = (cliDir, runtimeRoot, input) => childProcess.spawnSync(process.execPath,
        [path.join(cliDir, 'takeover-adapter.js')],
        { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, EVO_LITE_ROOT: runtimeRoot } });

    // ① emergency 路径:向上找不到 .evo-lite → 根 canonicalization 失败
    { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-exit-em-'));
      const cli = path.join(dir, 'cli'); fs.mkdirSync(cli, { recursive: true });
      for (const f of MODULES) fs.copyFileSync(path.join(TEMPLATE_CLI_DIR, f), path.join(cli, f));
      const sub = runHook(cli, path.join(dir, 'runtime'), { hook_event_name: 'UserPromptSubmit', session_id: 'x1' });
      assert.strictEqual(sub.status, 0, `emergency path must exit 0 (stderr: ${sub.stderr})`);
      const cap = JSON.parse(JSON.parse(sub.stdout.trim()).hookSpecificOutput.additionalContext); // stdout 必须只有 JSON
      assert.strictEqual(cap.evoLite, 'takeover-degraded', 'emergency capsule emitted across the process boundary');
      assert.strictEqual(tp.validateCapsule(cap, tp.CAPSULE_BUDGET_BYTES).ok, true, 'emergency capsule valid and <= 1 KiB');
      assert.ok(cap.action && cap.action.includes(`--session-id 'x1'`), 'recovery command is executable');
      assert.ok(/evo-lite takeover/.test(sub.stderr), 'diagnosis still reaches stderr (exit code no longer carries it)');
      assert.strictEqual(fs.existsSync(path.join(dir, '.evo-lite')), false, 'no receipt tree fabricated');
      fs.rmSync(dir, { recursive: true, force: true }); }

    // ② degraded 路径:active_context 结构损坏 → 仍 exit 0,且不产生 committed receipt
    { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-exit-dg-'));
      const rt = path.join(root, '.evo-lite'); const cli = path.join(rt, 'cli');
      fs.mkdirSync(cli, { recursive: true });
      fs.writeFileSync(path.join(rt, 'active_context.md'), '# broken: no anchors at all\n', 'utf8');
      for (const f of MODULES) fs.copyFileSync(path.join(TEMPLATE_CLI_DIR, f), path.join(cli, f));
      const sub = runHook(cli, rt, { hook_event_name: 'UserPromptSubmit', session_id: 'x2' });
      assert.strictEqual(sub.status, 0, `degraded path must exit 0 (stderr: ${sub.stderr})`);
      const cap = JSON.parse(JSON.parse(sub.stdout.trim()).hookSpecificOutput.additionalContext);
      assert.strictEqual(cap.evoLite, 'takeover-degraded', 'broken active_context yields a degraded capsule');
      assert.strictEqual(tp.validateCapsule(cap, tp.CAPSULE_BUDGET_BYTES).ok, true, 'degraded capsule valid');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'x2').state, 'missing', 'no committed receipt on the degraded path');
      fs.rmSync(root, { recursive: true, force: true }); }
    console.log('✅ T-takeover-hook-exit-contract passed');
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
const { buildTakeoverPayload, buildEmergencyCapsule, validateSessionPayload, validateCapsule,
    CAPSULE_BUDGET_BYTES } = require('./takeover-payload');
const HOST = 'claude-code';

function bashSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// 恢复命令必须带当前 sessionId —— runReceiptRecovery 缺 --session-id 会直接抛 Usage 错误,
// 一条跑不通的命令等于没有恢复路径。拿不到合法 sessionId → 返回 null,由 recoveryText 如实说明(R5 复审 P0-2)。
function buildRecoveryCommand(projectRoot, sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const cli = bashSingleQuote(`${projectRoot}/.evo-lite/cli/memory.js`);
    return `node ${cli} bootstrap --receipt --host ${HOST} --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}
// 项目根不可知时的相对路径版(同样必带 sessionId)
function buildGenericRecoveryCommand(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    return `node .evo-lite/cli/memory.js bootstrap --receipt --host ${HOST} --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}
function recoveryText(cmd) {
    return cmd ? `Recover: ${cmd}`
        : 'Cannot auto-recover: no session id in the hook input. Restart the Claude Code session.';
}

// ── 同步完整写入:循环处理 partial write,确认全部 UTF-8 字节送出;零进展即抛(不死循环)──
function writeAllSync(fd, text, writeSync = fs.writeSync) {
    const buf = Buffer.from(String(text), 'utf8');
    let off = 0;
    while (off < buf.length) {
        const written = writeSync(fd, buf, off, buf.length - off);
        if (!Number.isInteger(written) || written <= 0) throw new Error('stdout write made no progress');
        off += written;
    }
}

// 错误报告与业务输出用同一套同步完整写入语义:进程可能在写完前 process.exit(),
// process.stderr.write 的异步缓冲会丢失本该显式暴露的失败原因(R4 复审 P1-3)。
function reportError(msg) {
    try { writeAllSync(2, `${msg}\n`); } catch (_) { /* stderr 不可写时不得再抛,交由退出码承载 */ }
}

function runTransport(serialize, publish, write) {
    let serialized;
    try { serialized = serialize(); }
    catch (e) { reportError(`evo-lite takeover: serialize failed: ${e.message}`); return { exitCode: 1, error: `serialize: ${e.message}` }; }
    try { write(serialized); }
    catch (e) { reportError(`evo-lite takeover: delivery failed: ${e.message}`); return { exitCode: 1, error: `write: ${e.message}` }; }
    if (typeof publish === 'function') {
        try { publish(); }
        catch (e) { reportError(`evo-lite takeover: receipt publish failed: ${e.message}`); return { exitCode: 1, error: `publish: ${e.message}` }; }
    }
    return { exitCode: 0 };
}

// canonicalization(discover + realpath)失败不得抛到 main —— 各 handler 自行给出 fail-closed 结果。
function resolveRoot(deps) {
    try { return { ok: true, root: rc.canonicalProjectRoot(deps.projectRoot) }; }
    catch (e) { return { ok: false, error: e.message }; }
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
    const rootRes = resolveRoot(deps);
    if (!rootRes.ok) { // 根不可 canonicalize:不发布、注入 degraded 说明 —— 但【exit 0】,否则宿主会丢弃这段上下文
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover FAILED: ${rootRes.error}. Run from the project root — ${recoveryText(buildGenericRecoveryCommand(input.session_id))}` },
            systemMessage: `evo-lite takeover root canonicalization failed: ${rootRes.error}` },
            exitCode: 0, publish: null, failure: `root: ${rootRes.error}` };
    }
    const projectRoot = rootRes.root;
    const sessionId = input.session_id;
    const sourceEvent = `SessionStart:${input.source || 'startup'}`;
    const existing = rc.readReceipt(projectRoot, HOST, sessionId);
    const focus = rc.readFocusAnchor(projectRoot);
    const recoveryCmd = buildRecoveryCommand(projectRoot, sessionId);
    const recovery = recoveryText(recoveryCmd);

    // 所有 SessionStart 失败共用:注入 degraded 说明 + systemMessage + 不发布 receipt + failure 标记,
    // 但【exitCode 恒 0】—— 非零会让宿主直接丢弃这段 additionalContext,失败反而变静默(R5 复审 P0-1)。
    const ssFailure = (contextText, sysMsg, failure) => ({
        json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contextText },
            systemMessage: sysMsg },
        exitCode: 0, publish: null, failure,
    });

    // 无合法 sessionId → 不得谎称可自动恢复(与 buildRecoveryCommand/buildGenericRecoveryCommand 的
    // null 语义一致);缺此前置检查会让 sessionId 为空时静默走成功路径,recovery 文案永远无法送达。
    if (typeof sessionId !== 'string' || !sessionId) {
        return ssFailure(`[evo-lite] takeover FAILED: missing session id. ${recovery}`,
            'evo-lite takeover failed: missing session id', 'missing-session-id');
    }

    if (focus === null) { // 不可恢复:degraded,失效已有 committed,不发布
        if (existing.state === 'committed') rc.invalidateReceipt(projectRoot, HOST, sessionId, 'active-context-unreadable');
        return ssFailure(`[evo-lite] takeover DEGRADED (active_context unreadable). ${recovery}`,
            'evo-lite takeover degraded: active_context unreadable', 'active-context-unreadable');
    }

    const base = { host: HOST, sessionId, projectRoot, sourceEvent, focus: focus.text, focusHash: focus.hash,
        generatedAt: new Date().toISOString() };
    let context;
    try {
        context = deps.collect ? await deps.collect(base)
            : await require('./takeover-session').collectSessionTakeoverContextFull(base);
    } catch (e) {
        return ssFailure(`[evo-lite] takeover FAILED: ${e.message}. ${recovery}`,
            `evo-lite takeover collector failed: ${e.message}`, `collect: ${e.message}`);
    }
    const build = deps.buildPayload || buildTakeoverPayload;
    const validate = deps.validate || validateSessionPayload;
    let payload;
    try { payload = build(context); }
    catch (e) { // builder 抛错也须给出可执行恢复命令(不落到 main 的通用错误)
        return ssFailure(`[evo-lite] takeover payload build failed: ${e.message}. ${recovery}`,
            `evo-lite takeover build failed: ${e.message}`, `build: ${e.message}`);
    }
    const verdict = validate(payload);
    if (!verdict.ok) { // 校验不过 → 不发布 receipt
        return ssFailure(`[evo-lite] takeover payload invalid (${verdict.errors.join(',')}). ${recovery}`,
            'evo-lite takeover payload validation failed', `invalid: ${verdict.errors.join(',')}`);
    }
    const publish = () => rc.publishReceipt(projectRoot, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: HOST,
        sessionId, projectRoot: rc.canonicalProjectRoot(projectRoot), state: 'committed', focusHash: focus.hash,
        payloadHash: null, generatedAt: base.generatedAt, sourceEvent });
    void existing; // establishment 与 refresh 都刷新 receipt;差异仅诊断
    return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
        additionalContext: `[evo-lite takeover] ${JSON.stringify(payload)}` } }, exitCode: 0, publish, failure: null };
}

// 每轮 capsule 也必须经 validateCapsule —— probe 已确认宿主会【静默丢弃】类型错的字段,
// 无效 capsule 等于静默失去再播种能力。任何失败路径都输出 buildEmergencyCapsule 的结果:
// 恒是预算内、经校验的 JSON capsule。【禁止】退回未预算的普通文本(R4 复审 P0-1)。
// 【exitCode 恒 0】:非零时宿主根本不解析这段 JSON,精心构造的 emergency capsule 会被整体丢弃(R5 复审 P0-1)。
// 失败由 capsule 的 takeover-degraded + systemMessage + failure 标记 + stderr 承载,不由退出码承载。
function emergencyResult(parts) {
    const { projectName, focusHash, recoveryAction, reason } = parts;
    const em = buildEmergencyCapsule({ projectName, focusHash, recoveryAction, reason }, CAPSULE_BUDGET_BYTES);
    const json = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit',
        additionalContext: JSON.stringify(em.capsule) } };
    // action 装不下时,完整恢复命令走 systemMessage(不计入 capsule 预算)
    json.systemMessage = em.systemMessage || `evo-lite takeover capsule degraded: ${reason}`;
    return { json, exitCode: 0, publish: null, failure: reason };   // stderr 由 main 统一报告,避免重复写
}

function handleUserPromptSubmit(input, deps) {
    const sessionId = input.session_id;
    const rootRes = resolveRoot(deps);
    if (!rootRes.ok) {
        return emergencyResult({ projectName: null, focusHash: null,
            recoveryAction: buildGenericRecoveryCommand(sessionId), reason: `root-canonicalization-failed: ${rootRes.error}` });
    }
    const projectRoot = rootRes.root;
    const projectName = path.basename(projectRoot);
    const recoveryCmd = buildRecoveryCommand(projectRoot, sessionId);   // 原始命令(进 capsule.action),非文案
    const build = deps.buildPayload || buildTakeoverPayload;
    const validate = deps.validateCapsule || validateCapsule;

    let verdict = null, focus = null, capsule = null, failure = null;
    try {
        ({ verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId }));
        // 说明:reconcile 判 degraded 属【治理状态】而非 handler 故障 —— failure 保持 null,
        // 诊断由 degraded capsule + 下面的 systemMessage 承担,守卫另行 fail-closed。
    } catch (e) {
        return emergencyResult({ projectName, focusHash: null, recoveryAction: recoveryCmd, reason: `reconcile: ${e.message}` });
    }
    try {
        capsule = build({ kind: 'refresh', host: HOST, sessionId, projectRoot, projectName,
            sourceEvent: 'UserPromptSubmit', focus: focus ? focus.text : null,
            focusHash: focus ? focus.hash : null, receiptVerdict: verdict, recoveryAction: recoveryCmd }, CAPSULE_BUDGET_BYTES);
    } catch (e) { failure = `build: ${e.message}`; }
    if (!failure) {
        const capVerdict = validate(capsule, CAPSULE_BUDGET_BYTES);
        if (!capVerdict.ok) failure = `invalid: ${capVerdict.errors.join(',')}`;
    }
    if (failure) {
        return emergencyResult({ projectName, focusHash: focus ? focus.hash : null,
            recoveryAction: recoveryCmd, reason: failure });
    }
    const json = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(capsule) } };
    if (verdict.transition === 'degraded' || verdict.transition === 'stale') {
        json.systemMessage = `evo-lite takeover ${verdict.transition}${verdict.reason ? `: ${verdict.reason}` : ''}`;
    }
    return { json, exitCode: 0, publish: null, failure: null };
}

async function handleHookInput(input, deps = {}) {
    switch (input && input.hook_event_name) {
        case 'SessionStart': return handleSessionStart(input, deps);
        case 'UserPromptSubmit': return handleUserPromptSubmit(input, deps);
        default: return { json: {}, exitCode: 0, publish: null, failure: null }; // 阶段2 增 PreToolUse
    }
}

function main() {
    let raw = '';
    process.stdin.on('data', d => raw += d).on('end', async () => {
        let input = {}; try { input = JSON.parse(raw); } catch (_) {}
        let out;
        try { out = await handleHookInput(input, {}); }
        catch (e) { // handler 兜底:仍输出 envelope 并 exit 0(非零会让 systemMessage 也失效)
            out = { json: { systemMessage: `evo-lite takeover error: ${e.message}` }, exitCode: 0, publish: null, failure: e.message };
        }
        // 单一诊断出口:所有 handler 的 failure 在此统一落 stderr(handler 内不重复写)
        if (out.failure) reportError(`evo-lite takeover: ${out.failure}`);
        // 退出码只反映 transport 结果:序列化/写出/发布失败才非零(此时 JSON 本就没送达或不可信)
        const res = executeHookTransport(out.json, out.publish);
        process.exit(res.exitCode || out.exitCode || 0);
    });
}

if (require.main === module) main();
module.exports = { handleHookInput, executeHookTransport, executeCliRecoveryTransport, writeAllSync,
    reportError, resolveRoot, buildRecoveryCommand, buildGenericRecoveryCommand };
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-adapter-session passed`、`✅ T-takeover-hook-exit-contract passed`。

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
    const adapterRp = require.resolve(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
    const savedAdapter = require.cache[adapterRp];
    try {
        delete require.cache[require.resolve(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'))];
        const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-iso-'));
        const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
        fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
        const up = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: 's' }, { projectRoot: root });
        const cap = JSON.parse(up.json.hookSpecificOutput.additionalContext);
        assert.ok(cap.evoLite === 'takeover-active' || cap.evoLite === 'takeover-stale',
            `refresh capsule must be a real capsule, got ${cap.evoLite}`);
        fs.rmSync(root, { recursive: true, force: true });
    } finally {
        for (const rp of Object.keys(saved)) { delete require.cache[rp]; if (saved[rp]) require.cache[rp] = saved[rp]; }
        delete require.cache[adapterRp]; if (savedAdapter) require.cache[adapterRp] = savedAdapter;
    }
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

    // partial write:每次只写 3 字节也必须完整写出
    { let sink = Buffer.alloc(0);
      const partial = (_fd, buf, off, len) => { const n = Math.min(3, len); sink = Buffer.concat([sink, buf.slice(off, off + n)]); return n; };
      ad.writeAllSync(1, 'hello-partial-write', partial);
      assert.strictEqual(sink.toString('utf8'), 'hello-partial-write', 'partial writes are looped to completion'); }
    // zero progress:返回 0 必须抛错,不得死循环
    assert.throws(() => ad.writeAllSync(1, 'x', () => 0), /no progress/i, 'zero-progress write throws');

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

### Task 5: 三入口收口 —— `mem bootstrap` 经 builder + `--receipt` CLI recovery

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
    ];
    for (const hit of (Array.isArray(recall.hits) ? recall.hits : [])) {
        if (hit && hit.label) lines.push(`memory_hit: ${hit.label}`);
        if (hit && hit.effect) lines.push(`memory_effect: ${hit.effect}`);
    }
    if (recall.effect !== null) {
        lines.push(`memory_effect: ${recall.effect || 'fresh-takeover'}`);
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

### Task 6: installer(事务化 capability-gate)+ manifest + gitignore + 镜像 + 阶段 1 dogfood/复审门

**Files:**
- Create: `templates/cli/takeover-install.js`
- Modify: `templates/cli/memory.js`(`mem takeover install|status|rollback|probe|backup-discard`)
- Modify: `templates/cli/template-manifest.js`、`templates/cli/test/integration.js`、`.gitignore`
- Test: `templates/cli/test/governance.js`(`T-takeover-installer`)
- Create: `docs/validation/attp-phase1-dogfood.md`

**Interfaces:**
- `HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"'`
- `managedFragment(events)`、`mergeHookConfig(existing, fragment)`、`isManagedGroup(g)`
- **安装闸(与 shell 无关的两项)**
  - `verifyHookCommandShape(command?)` → `{ ok, reason }`(静态:`node ` 开头、引用受管 adapter、`$CLAUDE_PROJECT_DIR` 处于双引号内)
  - `probeAdapterBinary(projectRoot)` → `{ ok, reason }`(直接 `process.execPath` 跑 adapter,喂最小 UserPromptSubmit JSON;解析 envelope → **`validateCapsule` + 1 KiB 预算** → 拒绝 `takeover-degraded`。安装闸 = envelope 合法 ∧ capsule 合法 ∧ ≤1 KiB ∧ 非 degraded;退出码已不能判定健康)
- **诊断(非安装闸)**
  - `resolveHostShell(env?)` → `{ ok, shell } | { ok:false, reason }`(`EVO_LITE_HOOK_SHELL` / `CLAUDE_CODE_GIT_BASH_PATH` → win32 Git Bash → 非 win32 `/bin/sh`)
  - `probeHookCommand(projectRoot, { shell?, resolveShell? })` → `{ ok, skipped, reason }`(在**显式指定的 POSIX shell** 下跑 `HOOK_COMMAND` 原文;shell 不可发现 → `{ok:true, skipped:true}`)
- **事务化 settings**
  - `resolveManagedSettingsPath(projectRoot, settingsPath, fsOps?)` → **验证过的绝对物理路径**(realpath 项目根;settings 存在则 realpath 自身,不存在则解析最近存在祖先再拼尾部;**损坏链接 / realpath 失败 / 物理落点在项目外 / 不是 `<root>/.claude/settings.json` 本身 → 一律抛错**。`--settings` 仍可传,但解析结果必须精确等于该受管文件;用户级 settings 超出 MVP 范围)
  - `resolveManagedBackupPath(managedSettings, backupPath, fsOps?)` → 绝对路径(必须是受管 settings 的**同目录兄弟**、文件名精确匹配 `settings.json.attp-backup-<pid>-<12hex>`、且自身不是链接)
  - `validateBackupManifestShape(raw)` → boolean(**写入侧与消费侧共用的唯一形状判定**;`commitManifest` 回读后与 `readBackupManifest` 读取时都调用它)
  - `readBackupManifest(projectRoot, fsOps?)` → `manifest | null`(**读取即再验证**:`kind`+`schemaVersion`+`sha256` 为 64 位十六进制 + `settingsPath` **恒等于受管文件** + `backupPath` 过兄弟/命名/非链接三关;任何一项不过即抛,**不写不删**)
  - `backupSettings(settingsPath, { projectRoot, fsOps? })` → `{ existed, backupPath, sha256, manifestPath }`(**备份失败即抛**;manifest 已存在即抛)
  - `restoreSettings({ projectRoot, fsOps? })` → `{ restored }`(`existed` → 按 sha256 校验后恢复**原始字节**;否则仅删除新建文件)
  - `discardBackup({ projectRoot, fsOps? })` → `{ discarded }`(阶段门通过后清理备份文件 + manifest,**不触碰当前 settings**)
  - `installWithBackup(settingsPath, { events, projectRoot, fsOps? })` → `{ changed, backup }`(install 失败自动回滚;**回滚也失败时抛 `AggregateError` 保留两个错误 + manifest 路径**)
- `installTakeoverHooks(settingsPath, { events, projectRoot })` → `{ changed }`(**损坏 JSON 抛错不覆盖;闸不过则抛错、原文件不变**)
- `statusTakeoverHooks(settingsPath, events, projectRoot?)` → `{ installed[], missing[] }`(**损坏 JSON 抛错**;给出 `projectRoot` 时同样绝对化)

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

    // 用【临时假项目】做 probe,不依赖尚未 sync 的 runtime mirror(路径含空格,顺带验引用)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-inst-'));
    const fakeProject = path.join(dir, 'my project');           // 故意含空格
    const fakeCli = path.join(fakeProject, '.evo-lite', 'cli');
    fs.mkdirSync(fakeCli, { recursive: true });
    // stub 必须产出【真实形状】的 capsule:probe 现在解析 envelope + capsule,不再只看退出码与子串
    const stubCapsule = (evoLite, reason) => 'process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write('
        + `JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:JSON.stringify(`
        + `{evoLite:${JSON.stringify(evoLite)},project:"p",receipt:"invalid",focusHash:null`
        + (reason ? `,reason:${JSON.stringify(reason)}` : '') + '})}})'
        + ');process.exit(0);});';
    const adapterStub = path.join(fakeCli, 'takeover-adapter.js');
    fs.writeFileSync(adapterStub, stubCapsule('takeover-stale'), 'utf8');
    assert.strictEqual(ti.probeAdapterBinary(fakeProject).ok, true, 'adapter binary probe passes');
    // 运行时故障(degraded capsule)必须拒装 —— 退出码已不能承载失败
    fs.writeFileSync(adapterStub, stubCapsule('takeover-degraded', 'active-context-unreadable'), 'utf8');
    const degradedProbe = ti.probeAdapterBinary(fakeProject);
    assert.strictEqual(degradedProbe.ok, false, 'a degraded runtime blocks installation even though the hook exits 0');
    assert.ok(/degraded runtime/.test(degradedProbe.reason));
    fs.writeFileSync(adapterStub, 'process.stdout.write("not json");process.exit(0);', 'utf8');
    assert.strictEqual(ti.probeAdapterBinary(fakeProject).ok, false, 'non-JSON stdout blocks installation');
    // 残缺 capsule(只有 evoLite)必须拒装:宿主会静默丢弃类型错字段,probe 必须跑真正的 validateCapsule
    fs.writeFileSync(adapterStub, 'process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write('
        + 'JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",'
        + 'additionalContext:JSON.stringify({evoLite:"takeover-stale"})}})'
        + ');process.exit(0);});', 'utf8');
    const thin = ti.probeAdapterBinary(fakeProject);
    assert.strictEqual(thin.ok, false, 'a capsule missing fixed keys must not pass the install gate');
    assert.ok(/capsule invalid/.test(thin.reason), `expected schema rejection, got: ${thin.reason}`);
    fs.writeFileSync(adapterStub, stubCapsule('takeover-stale'), 'utf8');   // 复位为健康 stub

    // 安装闸①:命令形状静态可验证(与本机 shell 无关)
    assert.strictEqual(ti.verifyHookCommandShape(ti.HOOK_COMMAND).ok, true, 'shipped HOOK_COMMAND shape is valid');
    assert.strictEqual(ti.verifyHookCommandShape('node $CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js').ok, false,
        'unquoted $CLAUDE_PROJECT_DIR rejected (breaks on paths with spaces)');
    assert.strictEqual(ti.verifyHookCommandShape('node "$CLAUDE_PROJECT_DIR/other.js"').ok, false, 'must reference the managed adapter');

    // 诊断 probe:在显式 POSIX shell 下跑命令原文(ok 即证明 $CLAUDE_PROJECT_DIR 展开且含空格路径被正确引用)
    const cmdProbe = ti.probeHookCommand(fakeProject);
    assert.ok(cmdProbe.ok, `hook command probe: ${cmdProbe.reason}`);
    if (!cmdProbe.skipped) {
        assert.strictEqual(cmdProbe.skipped, false, 'a discoverable POSIX shell actually ran the command verbatim');
    }
    // 指定一个不存在的 shell → 如实报失败(不得静默当成通过)
    assert.strictEqual(ti.probeHookCommand(fakeProject, { shell: path.join(dir, 'no-such-shell') }).ok, false,
        'a broken shell is reported, not silently passed');
    // shell 不可发现 → skipped,且【不影响安装】—— 本机 shell 差异不得导致误拒装
    const skipped = ti.probeHookCommand(fakeProject, { resolveShell: () => ({ ok: false, reason: 'none found' }) });
    assert.strictEqual(skipped.ok, true); assert.strictEqual(skipped.skipped, true, 'undiscoverable shell → skipped, not failed');

    // ── 安装闸的 shell 独立性回归锚点(R4 P0-3 的护栏,此前无测试保护)──
    // installTakeoverHooks 只能靠 verifyHookCommandShape + probeAdapterBinary 放行,绝不能再去问
    // probeHookCommand/resolveHostShell —— 否则本机 shell 与 Claude 宿主 shell 不同就会误拒装。
    // 用 cmd.exe 冒充"被 resolveHostShell 发现的 shell":它真实存在(existsSync 通过,不会被判 skipped),
    // 但不是 POSIX shell,$CLAUDE_PROJECT_DIR 展不开 —— 这会让 probeHookCommand 【真的】跑失败,而不是
    // 摆设式地假装失败。这就是这条断言的区分力来源:若 installTakeoverHooks 被改成再 consult
    // probeHookCommand(projectRoot)(不传 opts,和现有另外两道闸同款直接本地调用的写法),它会在这里
    // 立刻炸掉;当前实现完全不看它,所以照样成功。
    if (process.platform === 'win32') {
        // `managed` (受管 settings 绝对路径) is declared further below — compute the same
        // path locally rather than forward-referencing that const.
        const managedForShellGuard = path.join(fs.realpathSync(fakeProject), '.claude', 'settings.json');
        const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
        assert.ok(fs.existsSync(comspec), `sanity: ${comspec} must exist to run this guard`);
        const savedHookShell = process.env.EVO_LITE_HOOK_SHELL;
        const savedGitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
        process.env.EVO_LITE_HOOK_SHELL = comspec;
        delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
        try {
            // 先证明:强制 resolveHostShell 命中 cmd.exe 后,诊断 probe 确实会失败(不是空摆设)
            const forcedBad = ti.probeHookCommand(fakeProject);
            assert.strictEqual(forcedBad.ok, false,
                'sanity: cmd.exe masquerading as the resolved shell must actually break probeHookCommand, else this guard proves nothing');
            // 再证明:即便诊断 probe 会失败,安装仍然成功 —— 因为 install 根本不咨询它
            fs.rmSync(managedForShellGuard, { force: true });
            assert.strictEqual(
                ti.installTakeoverHooks('.claude/settings.json', { events: ['SessionStart'], projectRoot: fakeProject }).changed,
                true, 'install must succeed even though the (unconsulted) shell probe would fail under this shell — shell-independence guard');
            fs.rmSync(managedForShellGuard, { force: true });
        } finally {
            if (savedHookShell === undefined) delete process.env.EVO_LITE_HOOK_SHELL; else process.env.EVO_LITE_HOOK_SHELL = savedHookShell;
            if (savedGitBash === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH; else process.env.CLAUDE_CODE_GIT_BASH_PATH = savedGitBash;
        }
    }

    // 受管对象唯一:<canonicalProjectRoot>/.claude/settings.json —— 项目内的其他文件也不许被本工具触碰
    const managed = path.join(fs.realpathSync(fakeProject), '.claude', 'settings.json');
    assert.strictEqual(ti.resolveManagedSettingsPath(fakeProject, '.claude/settings.json'), managed,
        'relative settings bind to the physical project root');
    assert.strictEqual(ti.managedSettingsPath(fakeProject), managed, 'managed path is derived, not supplied');
    assert.throws(() => ti.resolveManagedSettingsPath(fakeProject, path.join(dir, 'outside.json')),
        /outside the project root/i, 'settings outside the project are rejected, not silently accepted');
    assert.throws(() => ti.resolveManagedSettingsPath(fakeProject, '.claude/other.json'),
        /only .* is managed/i, 'another in-project file is not the managed settings file');
    assert.throws(() => ti.resolveManagedSettingsPath(fakeProject, 'src/victim.js'),
        /only .* is managed/i, 'arbitrary in-project paths are rejected too');

    fs.mkdirSync(path.join(fakeProject, '.claude'), { recursive: true });
    fs.writeFileSync(managed, '{ not json', 'utf8');
    assert.throws(() => ti.installTakeoverHooks('.claude/settings.json', { events: ['SessionStart'], projectRoot: fakeProject }), /corrupt|JSON/i, 'install throws on corrupt');
    assert.strictEqual(fs.readFileSync(managed, 'utf8'), '{ not json', 'corrupt file unchanged');
    assert.throws(() => ti.statusTakeoverHooks(managed, ['SessionStart']), /corrupt|JSON/i, 'status throws on corrupt (no silent all-missing)');
    fs.rmSync(managed, { force: true });

    // 语法合法但不是对象(数组/标量/null)同样必须 fail-loud:否则 install 会把它当空对象
    // 悄悄丢弃原内容(changed:true 却无声吞掉用户配置),status 会误报全部事件缺失(R11 复审)
    for (const raw of ['[1,2,3]', '42', '"hi"', 'null']) {
        fs.writeFileSync(managed, raw, 'utf8');
        assert.throws(() => ti.installTakeoverHooks('.claude/settings.json', { events: ['SessionStart'], projectRoot: fakeProject }),
            /not a JSON object/i, `install throws on non-object settings (${raw})`);
        assert.strictEqual(fs.readFileSync(managed, 'utf8'), raw, `non-object settings unchanged after refused install (${raw})`);
        assert.throws(() => ti.statusTakeoverHooks(managed, ['SessionStart']),
            /not a JSON object/i, `status throws on non-object settings (${raw})`);
    }
    fs.rmSync(managed, { force: true });

    // 正常安装(假项目)→ 写入且幂等
    assert.strictEqual(ti.installTakeoverHooks('.claude/settings.json', { events: ['SessionStart', 'UserPromptSubmit'], projectRoot: fakeProject }).changed, true);
    assert.strictEqual(ti.installTakeoverHooks('.claude/settings.json', { events: ['SessionStart', 'UserPromptSubmit'], projectRoot: fakeProject }).changed, false, 'second install is a no-op');
    assert.deepStrictEqual(ti.statusTakeoverHooks(managed, ['SessionStart', 'UserPromptSubmit', 'PreToolUse']).missing, ['PreToolUse']);
    fs.rmSync(managed, { force: true });

    // 闸不过 → 不写 settings(用一个没有 adapter 的项目,settings 仍落在该项目内)
    const badProject = path.join(dir, 'no adapter project');
    fs.mkdirSync(path.join(badProject, '.evo-lite', 'cli'), { recursive: true });
    const fresh = path.join(badProject, '.claude', 'settings.json');
    assert.throws(() => ti.installTakeoverHooks(fresh, { events: ['SessionStart'], projectRoot: badProject }), /probe|adapter/i, 'adapter probe failure blocks install');
    assert.strictEqual(fs.existsSync(fresh), false, 'no settings written when the gate fails');

    // ── settings 事务化:备份失败必须停;回滚必须恢复原始字节(R4 复审 P0-4)──
    const txProject = path.join(dir, 'tx project');
    fs.mkdirSync(path.join(txProject, '.evo-lite', 'cli'), { recursive: true });
    fs.copyFileSync(path.join(fakeCli, 'takeover-adapter.js'), path.join(txProject, '.evo-lite', 'cli', 'takeover-adapter.js'));
    const txSettings = path.join(txProject, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(txSettings), { recursive: true });
    const originalBytes = '{\n  "model": "sonnet"\n}\n';
    fs.writeFileSync(txSettings, originalBytes, 'utf8');

    // 备份写入损坏 → 抛;绝不带着"以为有备份"继续安装
    const brokenFs = { ...fs, writeFileSync: (p) => fs.writeFileSync(p, Buffer.from('corrupted')) };
    assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: brokenFs }),
        /backup does not match|unreadable/i, 'backup verification failure stops the transaction');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'settings untouched when backup fails');
    // 半成品备份必须清掉:否则用户仓库里会留下一份含 settings 原文的孤儿副本(R7 复审 P1-2)
    const orphans = () => fs.readdirSync(path.dirname(txSettings))
        .filter(name => name.startsWith(`${path.basename(txSettings)}.attp-backup-`));
    const installerTemps = () => fs.readdirSync(path.dirname(txSettings))
        .filter(name => name.startsWith(`${path.basename(txSettings)}.evo-tmp-`));
    assert.deepStrictEqual(orphans(), [], 'no orphaned backup left after a failed verification');
    // manifest 写入失败同样要清掉已写的备份(注意 manifest 现在先写 .tmp-,故按前缀注入)
    const manifestPathFor = ti.backupManifestPath(txProject);
    const manifestArtifacts = () => fs.existsSync(path.dirname(manifestPathFor))
        ? fs.readdirSync(path.dirname(manifestPathFor)).filter(n => n.startsWith(path.basename(manifestPathFor)))
        : [];
    const manifestFail = { ...fs,
        writeFileSync: (target, ...rest) => {
            if (path.resolve(String(target)).startsWith(path.resolve(manifestPathFor))) throw new Error('manifest write fail');
            return fs.writeFileSync(target, ...rest);
        } };
    assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: manifestFail }), /not committed|manifest write fail/);
    assert.deepStrictEqual(orphans(), [], 'no orphaned backup left when the manifest write fails');
    assert.deepStrictEqual(manifestArtifacts(), [], 'no manifest artifact left when the write fails');

    // 半写 manifest(写入成功但内容被截断)→ 回读解析失败 → 不提交、不留任何产物
    const halfWrite = { ...fs,
        writeFileSync: (target, data, ...rest) => {
            if (path.resolve(String(target)).startsWith(path.resolve(manifestPathFor))) {
                return fs.writeFileSync(target, String(data).slice(0, 12), ...rest);   // 截断 → 非法 JSON
            }
            return fs.writeFileSync(target, data, ...rest);
        } };
    assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: halfWrite }), /not committed/i,
        'a half-written manifest is never committed');
    assert.deepStrictEqual(manifestArtifacts(), [], 'the temp manifest is cleaned up, so the next backup is not blocked');
    assert.deepStrictEqual(orphans(), [], 'and the half-finished backup is cleaned up too');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'settings untouched throughout');
    // manifest rename 失败(ordered publication 的最后一步)→ 全清理 + 可重试
    const manifestRenameFail = { ...fs,
        renameSync: (src, dst) => {
            if (path.resolve(String(dst)) === path.resolve(manifestPathFor)) throw new Error('manifest rename fail');
            return fs.renameSync(src, dst);
        } };
    assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: manifestRenameFail }),
        /not committed/i, 'a manifest that cannot be renamed is never committed');
    assert.strictEqual(fs.existsSync(manifestPathFor), false, 'no final manifest after a failed rename');
    assert.deepStrictEqual(manifestArtifacts(), [], 'no temp manifest left behind');
    assert.deepStrictEqual(orphans(), [], 'no orphaned backup left behind');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'settings untouched');

    // 写入侧与消费侧必须共用同一 schema 判定:合法 JSON 但 kind/schemaVersion 被改写时
    // 【不得】提交成功 —— 否则 manifest 发布成功而 rollback 拒收(R9 复审 P0-2)
    const mutateManifest = (patch) => ({ ...fs,
        writeFileSync: (target, data, ...rest) => {
            if (path.resolve(String(target)).startsWith(path.resolve(manifestPathFor))) {
                return fs.writeFileSync(target, JSON.stringify({ ...JSON.parse(String(data)), ...patch }), ...rest);
            }
            return fs.writeFileSync(target, data, ...rest);
        } });
    for (const patch of [{ kind: 'wrong-kind' }, { schemaVersion: 99 }]) {
        assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: mutateManifest(patch) }),
            /not committed/i, `a manifest with ${JSON.stringify(patch)} must not be published`);
        assert.strictEqual(fs.existsSync(manifestPathFor), false, 'no final manifest for a mutated shape');
        assert.deepStrictEqual(manifestArtifacts(), [], 'no temp manifest for a mutated shape');
        assert.deepStrictEqual(orphans(), [], 'no orphaned backup for a mutated shape');
    }
    // 写入侧与消费侧确实是同一个判定
    assert.strictEqual(ti.validateBackupManifestShape({ kind: 'attp-settings-backup', schemaVersion: 1,
        settingsPath: txSettings, existed: false, backupPath: null, sha256: null }), true);
    assert.strictEqual(ti.validateBackupManifestShape({ kind: 'wrong-kind', schemaVersion: 1,
        settingsPath: txSettings, existed: false, backupPath: null, sha256: null }), false);

    // 证明下一次备份确实没被挡住
    const proof = ti.backupSettings(txSettings, { projectRoot: txProject });
    ti.discardBackup({ projectRoot: txProject });
    assert.ok(proof.manifestPath, 'a clean backup still works after every aborted attempt');

    // 正常:备份 → 安装 → 回滚恢复原始字节
    const bk = ti.backupSettings(txSettings, { projectRoot: txProject });
    assert.strictEqual(bk.existed, true);
    assert.ok(bk.backupPath.includes('attp-backup'), 'backup goes to a unique path');
    assert.strictEqual(fs.readFileSync(bk.backupPath, 'utf8'), originalBytes, 'backup holds the original bytes');
    assert.throws(() => ti.backupSettings(txSettings, { projectRoot: txProject }), /already exists/i, 'never clobbers an existing backup manifest');
    ti.installTakeoverHooks(txSettings, { events: ['SessionStart'], projectRoot: txProject });
    assert.notStrictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'install did change settings');
    ti.restoreSettings({ projectRoot: txProject });
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'rollback restored the original bytes');
    assert.strictEqual(fs.existsSync(bk.manifestPath), false, 'manifest cleared after restore');

    // 原本不存在 settings:只有这种情况才允许"回滚 = 删除文件"
    fs.rmSync(txSettings, { force: true });
    assert.strictEqual(ti.backupSettings(txSettings, { projectRoot: txProject }).existed, false);
    ti.installTakeoverHooks(txSettings, { events: ['SessionStart'], projectRoot: txProject });
    assert.strictEqual(fs.existsSync(txSettings), true);
    ti.restoreSettings({ projectRoot: txProject });
    assert.strictEqual(fs.existsSync(txSettings), false, 'only a file we created is removed on rollback');

    // 嵌套子目录下用【相对路径】回滚:必须恢复项目根的 settings,且不在子目录制造/删除任何文件
    fs.writeFileSync(txSettings, originalBytes, 'utf8');
    const nested = path.join(txProject, 'src', 'deep'); fs.mkdirSync(nested, { recursive: true });
    ti.installWithBackup('.claude/settings.json', { events: ['SessionStart'], projectRoot: txProject });
    assert.notStrictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'installed via a relative path');
    const prevCwd = process.cwd();
    try { process.chdir(nested); ti.restoreSettings({ projectRoot: txProject }); }
    finally { process.chdir(prevCwd); }
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'rollback from a nested cwd restored the ROOT settings');
    assert.strictEqual(fs.existsSync(path.join(nested, '.claude')), false, 'nothing created or deleted in the nested cwd');

    // backup-discard:阶段门通过后清理备份,但不触碰当前 settings
    ti.installWithBackup('.claude/settings.json', { events: ['SessionStart'], projectRoot: txProject });
    const installed = fs.readFileSync(txSettings, 'utf8');
    assert.strictEqual(ti.discardBackup({ projectRoot: txProject }).discarded, true);
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), installed, 'discard leaves current settings untouched');
    assert.strictEqual(ti.discardBackup({ projectRoot: txProject }).discarded, false, 'discard is idempotent');

    // installWithBackup:install 自身失败 → 自动回滚 + 不留残余 manifest
    fs.writeFileSync(txSettings, '{ not json', 'utf8');
    assert.throws(() => ti.installWithBackup(txSettings, { events: ['SessionStart'], projectRoot: txProject }), /corrupt|JSON/i);
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), '{ not json', 'failed install rolled back automatically');
    assert.strictEqual(fs.existsSync(bk.manifestPath), false, 'no stale manifest after auto-rollback');

    // 回滚【也】失败 → AggregateError 保住两个错误 + manifest 路径(R6 复审 P1-4)
    fs.writeFileSync(txSettings, originalBytes, 'utf8');
    // 注意:两个 seam 都必须【按目的地限定】。manifest 提交同样走 fsOps.renameSync,
    // 若在这里让 renameSync 全局抛,backupSettings 就先失败了,installer 根本进不去,
    // AggregateError 分支永远测不到(R9 复审 P0-1)。
    const doubleFail = { ...fs,
        // 备份文件与 manifest 照写;唯独写回 settings 本体时失败 → 制造 restore 失败
        writeFileSync: (target, ...rest) => {
            if (path.resolve(String(target)) === path.resolve(txSettings)) throw new Error('restore write fail');
            return fs.writeFileSync(target, ...rest);
        },
        // 只让 installer 的 temp → settings 提交失败;manifest 的 rename 必须放行
        renameSync: (src, dst) => {
            if (path.resolve(String(dst)) === path.resolve(txSettings)) throw new Error('install rename fail');
            return fs.renameSync(src, dst);
        },
    };
    let agg = null;
    try { ti.installWithBackup(txSettings, { events: ['SessionStart'], projectRoot: txProject, fsOps: doubleFail }); }
    catch (e) { agg = e; }
    assert.ok(agg instanceof AggregateError, 'double failure surfaces as AggregateError');
    assert.strictEqual(agg.errors.length, 2, 'both errors preserved');
    assert.ok(/install rename fail/.test(agg.errors[0].message), 'first error is the install failure');
    assert.ok(/restore write fail/.test(agg.errors[1].message), 'second error is the rollback failure');
    assert.ok(agg.message.includes(bk.manifestPath), 'message names the manifest path for manual recovery');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'original settings still intact on disk');
    const stranded = ti.readBackupManifest(txProject);
    assert.ok(stranded && fs.existsSync(stranded.backupPath), 'manifest and backup kept for manual recovery');
    // 备份与 manifest 是【故意】保留供人工恢复的;installer 的临时 settings 则不得残留
    assert.deepStrictEqual(installerTemps(), [], 'no orphaned installer temp settings after the double failure');
    ti.discardBackup({ projectRoot: txProject });   // 测试自清理

    // ── installer 临时 settings 的清理(R10 复审 P1-2)──
    // 临时文件含合并后的完整 settings(可能带用户敏感字段),rename 失败必须清掉
    fs.writeFileSync(txSettings, originalBytes, 'utf8');
    const settingsRenameFail = { ...fs,
        renameSync: (src, dst) => {
            if (path.resolve(String(dst)) === path.resolve(txSettings)) throw new Error('settings rename fail');
            return fs.renameSync(src, dst);
        } };
    assert.throws(() => ti.installTakeoverHooks(txSettings, { events: ['SessionStart'], projectRoot: txProject, fsOps: settingsRenameFail }),
        /settings rename fail/, 'install surfaces the rename failure');
    assert.deepStrictEqual(installerTemps(), [], 'the temp settings file is cleaned up on rename failure');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'original settings unchanged');
    // rename 失败【且】清理也失败 → 两个错误都保留 + 报告孤儿路径
    const tempStuck = { ...fs,
        renameSync: (src, dst) => {
            if (path.resolve(String(dst)) === path.resolve(txSettings)) throw new Error('settings rename fail');
            return fs.renameSync(src, dst);
        },
        unlinkSync: (target) => {
            if (path.basename(String(target)).includes('.evo-tmp-')) throw new Error('temp unlink fail');
            return fs.unlinkSync(target);
        } };
    let installAgg = null;
    try { ti.installTakeoverHooks(txSettings, { events: ['SessionStart'], projectRoot: txProject, fsOps: tempStuck }); }
    catch (e) { installAgg = e; }
    assert.ok(installAgg instanceof AggregateError, 'both failures preserved');
    assert.strictEqual(installAgg.errors.length, 2);
    assert.ok(/settings rename fail/.test(installAgg.errors[0].message));
    assert.ok(/temp unlink fail/.test(installAgg.errors[1].message));
    assert.ok(/evo-tmp-/.test(installAgg.message), 'message names the orphaned temp path');
    for (const leftover of installerTemps()) fs.rmSync(path.join(path.dirname(txSettings), leftover), { force: true });

    // backupSettings 的【公开边界】也必须保留错误结构:
    // commitManifest 抛 AggregateError 时,abortBackup 不得把它压成普通 Error(R10 复审 P1-1)
    const commitAndCleanupFail = { ...fs,
        writeFileSync: (target, data, ...rest) => {
            if (path.resolve(String(target)).startsWith(path.resolve(manifestPathFor))) {
                return fs.writeFileSync(target, String(data).slice(0, 12), ...rest);   // 回读解析失败
            }
            return fs.writeFileSync(target, data, ...rest);
        },
        unlinkSync: (target) => {
            if (path.basename(String(target)).startsWith(`${path.basename(manifestPathFor)}.tmp-`)) {
                throw new Error('temp manifest unlink fail');
            }
            return fs.unlinkSync(target);
        } };
    let backupAgg = null;
    try { ti.backupSettings(txSettings, { projectRoot: txProject, fsOps: commitAndCleanupFail }); }
    catch (e) { backupAgg = e; }
    assert.ok(backupAgg instanceof AggregateError, 'backupSettings must not flatten the AggregateError');
    assert.strictEqual(backupAgg.errors.length, 2, 'commit error and temp-cleanup error both preserved');
    assert.ok(/read-back|not committed|JSON/i.test(backupAgg.errors[0].message), 'first error is the commit failure');
    assert.ok(/temp manifest unlink fail/.test(backupAgg.errors[1].message), 'second error is the cleanup failure');
    assert.ok(/\.tmp-/.test(backupAgg.message), 'message names the orphaned temp manifest path');
    assert.strictEqual(fs.readFileSync(txSettings, 'utf8'), originalBytes, 'settings untouched');
    for (const leftover of manifestArtifacts()) fs.rmSync(path.join(path.dirname(manifestPathFor), leftover), { force: true });
    assert.deepStrictEqual(orphans(), [], 'the backup itself was still cleaned up');

    // ── 物理边界:.claude 是指向项目外的 symlink/junction 时必须拒装(R6 复审 P0-2)──
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-outside-'));
    fs.mkdirSync(path.join(outside, '.claude'), { recursive: true });
    const outsideSettings = path.join(outside, '.claude', 'settings.json');
    fs.writeFileSync(outsideSettings, '{"user":"level"}\n', 'utf8');
    const linkProject = path.join(dir, 'link project');
    fs.mkdirSync(path.join(linkProject, '.evo-lite', 'cli'), { recursive: true });
    fs.copyFileSync(adapterStub, path.join(linkProject, '.evo-lite', 'cli', 'takeover-adapter.js'));
    let linked = false;
    try { fs.symlinkSync(path.join(outside, '.claude'), path.join(linkProject, '.claude'), 'junction'); linked = true; }
    catch (_) { try { fs.symlinkSync(path.join(outside, '.claude'), path.join(linkProject, '.claude'), 'dir'); linked = true; } catch (_) { linked = false; } }
    if (linked) {
        assert.throws(() => ti.resolveManagedSettingsPath(linkProject, '.claude/settings.json'),
            /outside the project root/i, 'a symlinked .claude escapes the string prefix but not the physical boundary');
        assert.throws(() => ti.installWithBackup('.claude/settings.json', { events: ['SessionStart'], projectRoot: linkProject }),
            /outside the project root/i, 'install refuses to write through the link');
        assert.strictEqual(fs.readFileSync(outsideSettings, 'utf8'), '{"user":"level"}\n', 'the out-of-project file is untouched');
        assert.strictEqual(fs.existsSync(ti.backupManifestPath(linkProject)), false, 'no manifest created when the path is rejected');
        // 备份名带 pid+随机后缀,固定串断言查不出泄漏 —— 必须扫目录(R7 复审 P1-1)
        const leaked = fs.readdirSync(path.dirname(outsideSettings))
            .filter(name => name.startsWith(`${path.basename(outsideSettings)}.attp-backup-`));
        assert.deepStrictEqual(leaked, [], 'no backup file leaked outside the project');
    } else {
        assert.strictEqual(process.platform, 'win32', 'symlink creation may only be skipped on win32 without privilege');
        console.log('   ⏭️ settings symlink-escape case skipped (win32 without symlink privilege)');
    }

    // ── 篡改 manifest:rollback / discard 必须 fail loud,且不碰项目外文件 ──
    fs.writeFileSync(txSettings, originalBytes, 'utf8');
    const tampered = ti.backupSettings(txSettings, { projectRoot: txProject });
    const rewrite = (patch) => fs.writeFileSync(tampered.manifestPath,
        JSON.stringify({ ...JSON.parse(fs.readFileSync(tampered.manifestPath, 'utf8')), ...patch }), 'utf8');
    rewrite({ settingsPath: outsideSettings });
    assert.throws(() => ti.restoreSettings({ projectRoot: txProject }), /outside the project root/i, 'tampered settingsPath is rejected');
    rewrite({ settingsPath: txSettings, backupPath: outsideSettings });
    assert.throws(() => ti.discardBackup({ projectRoot: txProject }), /sibling|managed naming rule/i, 'tampered backupPath is rejected');
    rewrite({ backupPath: path.join(txProject, '.claude', 'not-a-managed-backup') });
    assert.throws(() => ti.discardBackup({ projectRoot: txProject }), /managed naming rule/i, 'in-project but unmanaged backup path is rejected');

    // ── 项目【内】任意文件同样不得被破坏(R7 复审 P0-2 的两个反例)──
    const victimDir = path.join(txProject, 'src'); fs.mkdirSync(victimDir, { recursive: true });
    const victim = path.join(victimDir, 'important.js');
    fs.writeFileSync(victim, 'const keep = 1;\n', 'utf8');
    rewrite({ settingsPath: victim, existed: false, backupPath: null, sha256: null });
    assert.throws(() => ti.restoreSettings({ projectRoot: txProject }), /only .* is managed/i,
        'a manifest pointing at an in-project source file cannot make restore delete it');
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'const keep = 1;\n', 'victim file untouched');
    // 伪装成受管备份的项目内文件:名字"含 marker"不够,必须是 settings 的同目录兄弟且精确命名
    const fakeBackup = path.join(victimDir, 'important.attp-backup-data');
    fs.writeFileSync(fakeBackup, 'disguised\n', 'utf8');
    rewrite({ settingsPath: txSettings, existed: true, backupPath: fakeBackup, sha256: 'a'.repeat(64) });
    assert.throws(() => ti.discardBackup({ projectRoot: txProject }), /sibling|managed naming rule/i,
        'a disguised in-project backup path is rejected');
    assert.strictEqual(fs.existsSync(fakeBackup), true, 'disguised file still exists');
    // 精确命名但【自身是断链】的 backup:existsSync 为 false,必须靠 lstat 拦下(R8 复审 P1-2)
    const linkBackup = `${txSettings}.attp-backup-${process.pid}-abcdef123456`;
    let backupLinkMade = false;
    try { fs.symlinkSync(path.join(txProject, 'src', 'no-such-target'), linkBackup, 'file'); backupLinkMade = true; }
    catch (_) { backupLinkMade = false; }
    if (!backupLinkMade) {
        assert.strictEqual(process.platform, 'win32', 'dangling backup link case is mandatory on POSIX');
        console.log('   ⏭️ dangling backup link case skipped (win32 without symlink privilege)');
    } else {
        assert.strictEqual(fs.existsSync(linkBackup), false, 'a dangling backup link reads as absent');
        assert.throws(() => ti.resolveManagedBackupPath(txSettings, linkBackup),
            /is a link/i, 'a correctly named but dangling backup link is still rejected');
        fs.rmSync(linkBackup, { force: true });
    }
    // sha256 必须是 64 位十六进制
    rewrite({ settingsPath: txSettings, existed: true, backupPath: tampered.backupPath, sha256: 'nope' });
    assert.throws(() => ti.restoreSettings({ projectRoot: txProject }), /schema validation/i, 'sha256 shape is enforced');
    // kind / schemaVersion 必须存在
    fs.writeFileSync(tampered.manifestPath, JSON.stringify({ settingsPath: txSettings, existed: false, backupPath: null, sha256: null }), 'utf8');
    assert.throws(() => ti.discardBackup({ projectRoot: txProject }), /schema validation/i, 'kind/schemaVersion are required');
    fs.writeFileSync(tampered.manifestPath, '{ not json', 'utf8');
    assert.throws(() => ti.restoreSettings({ projectRoot: txProject }), /manifest is corrupt/i, 'corrupt manifest fails loud');
    fs.writeFileSync(tampered.manifestPath, JSON.stringify({ settingsPath: txSettings }), 'utf8');
    assert.throws(() => ti.discardBackup({ projectRoot: txProject }), /schema validation/i, 'manifest schema is enforced');
    assert.strictEqual(fs.readFileSync(outsideSettings, 'utf8'), '{"user":"level"}\n', 'no out-of-project file was written or deleted');
    fs.rmSync(tampered.manifestPath, { force: true }); fs.rmSync(tampered.backupPath, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });

    // adapter 存在但退出非零 → 安装闸与诊断 probe 均须拦截
    fs.writeFileSync(adapterStub, 'process.exit(9);', 'utf8');
    assert.strictEqual(ti.probeAdapterBinary(fakeProject).ok, false, 'broken adapter fails the install gate');
    assert.strictEqual(ti.probeHookCommand(fakeProject).ok, false, 'broken adapter fails the command probe too');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('✅ T-takeover-installer passed');
}
```

- [ ] **Step 2: 运行验证失败** — 模块缺失。

- [ ] **Step 3: 实现 `takeover-install.js`**

```javascript
'use strict';
// ATTP .claude/settings.json 事务化幂等 deep-merge installer。禁整文件覆盖;损坏 JSON fail-loud;安装前过闸。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { validateCapsule, CAPSULE_BUDGET_BYTES } = require('./takeover-payload');

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

function readSettingsStrict(settingsPath, fsOps = fs) {
    if (!fsOps.existsSync(settingsPath)) return {};
    const raw = fsOps.readFileSync(settingsPath, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new Error(`takeover: ${settingsPath} is corrupt JSON (${e.message}); leaving it unchanged`); }
    // 合法 JSON 但不是对象(数组/标量/null)同样不得静默通过:install 会把它当空对象展开、
    // 悄悄丢弃原内容;status 则会误报"全部缺失"。两者都是这个模块 fail-loud 契约下的数据丢失(R11 复审)。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`takeover: ${settingsPath} is not a JSON object; leaving it unchanged`);
    }
    return parsed;
}

const PROBE_INPUT = (projectRoot) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'probe', cwd: projectRoot });

// ① 二进制级:adapter 能被 node 执行,且产出【可被宿主摄入的】UserPromptSubmit envelope。
// 退出码 + 字符串包含已不足以判定 —— 失败路径现在也 exit 0(宿主契约),必须解析 envelope 与 capsule,
// 并把 takeover-degraded 视为运行时故障拒装(R5 复审 P0-1 配套)。
function probeAdapterBinary(projectRoot) {
    const adapter = path.join(projectRoot, '.evo-lite', 'cli', 'takeover-adapter.js');
    if (!fs.existsSync(adapter)) return { ok: false, reason: `adapter not found: ${adapter}` };
    const res = spawnSync(process.execPath, [adapter], { input: PROBE_INPUT(projectRoot), encoding: 'utf8', timeout: 20000 });
    if (res.status !== 0) return { ok: false, reason: `adapter exited ${res.status}: ${String(res.stderr || '').trim()}` };
    let envelope;
    try { envelope = JSON.parse(String(res.stdout || '').trim()); }
    catch (e) { return { ok: false, reason: `adapter stdout is not a single JSON object (${e.message})` }; }
    const hso = envelope && envelope.hookSpecificOutput;
    if (!hso || hso.hookEventName !== 'UserPromptSubmit' || typeof hso.additionalContext !== 'string') {
        return { ok: false, reason: 'adapter produced no UserPromptSubmit hook envelope' };
    }
    let capsule;
    try { capsule = JSON.parse(hso.additionalContext); }
    catch (e) { return { ok: false, reason: `adapter additionalContext is not a capsule (${e.message})` }; }
    // capsule 必须过【真正的 schema + 预算校验】—— 宿主会静默丢弃类型错字段,
    // `{evoLite:"takeover-stale"}` 这种残缺 capsule 不能算安装通过(R6 复审 P1-3)。
    const capVerdict = validateCapsule(capsule, CAPSULE_BUDGET_BYTES);
    if (!capVerdict.ok) return { ok: false, reason: `adapter capsule invalid (${capVerdict.errors.join(',')})` };
    if (capsule.evoLite === 'takeover-degraded') {
        return { ok: false, reason: `adapter reports a degraded runtime (${capsule.reason || 'unknown'}); fix the runtime before installing hooks` };
    }
    return { ok: true, reason: null };
}

// ② 形状级:命令原文是否结构正确 —— 静态、确定性、与本机 shell 无关,可安全作为安装闸。
function verifyHookCommandShape(command = HOOK_COMMAND) {
    if (typeof command !== 'string' || !command.includes(MANAGED_MARK)) {
        return { ok: false, reason: 'command does not reference the managed adapter' };
    }
    if (!/^node\s/.test(command)) return { ok: false, reason: 'command must invoke node' };
    if (!/"\$CLAUDE_PROJECT_DIR\/[^"]*takeover-adapter\.js"/.test(command)) {
        return { ok: false, reason: '$CLAUDE_PROJECT_DIR must sit inside double quotes (paths contain spaces)' };
    }
    return { ok: true, reason: null };
}

// ③ 命令级(诊断,【不作安装闸】):Claude Code 用 POSIX shell 执行 hook command;win32 上是 Git Bash,
//    不是 cmd.exe。Node 的 shell:true 会取本机 comspec,证明不了宿主行为,所以这里必须显式指定 shell。
function resolveHostShell(env = process.env) {
    const explicit = env.EVO_LITE_HOOK_SHELL || env.CLAUDE_CODE_GIT_BASH_PATH;
    if (explicit && fs.existsSync(explicit)) return { ok: true, shell: explicit };
    if (process.platform !== 'win32') return { ok: true, shell: '/bin/sh' };
    for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
        if (fs.existsSync(c)) return { ok: true, shell: c };
    }
    const where = spawnSync('where', ['bash'], { encoding: 'utf8' });
    const found = String(where.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (found && fs.existsSync(found)) return { ok: true, shell: found };
    return { ok: false, reason: 'no POSIX shell found; cannot reproduce the Claude Code hook shell locally' };
}

// shell 不可发现 → skipped(仍 ok):本机 shell 差异不得导致误拒装。宿主 transport 的权威证据是 Step 9 dogfood。
function probeHookCommand(projectRoot, opts = {}) {
    const shape = verifyHookCommandShape(HOOK_COMMAND);
    if (!shape.ok) return { ok: false, skipped: false, reason: shape.reason };
    const binary = probeAdapterBinary(projectRoot);
    if (!binary.ok) return { ok: false, skipped: false, reason: binary.reason };
    const shellInfo = opts.shell ? { ok: true, shell: opts.shell } : (opts.resolveShell || resolveHostShell)();
    if (!shellInfo.ok) return { ok: true, skipped: true, reason: shellInfo.reason };
    // Node 在 win32 上仅当 shell basename 为 cmd.exe 时用 `/d /s /c`,否则用 `-c` —— 传 bash 路径即得 POSIX 语义。
    const res = spawnSync(HOOK_COMMAND, {
        shell: shellInfo.shell, input: PROBE_INPUT(projectRoot), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    });
    const where = ` under ${shellInfo.shell}`;
    if (res.error) return { ok: false, skipped: false, reason: `hook command failed to spawn${where}: ${res.error.message}` };
    if (res.status !== 0) return { ok: false, skipped: false, reason: `hook command exited ${res.status}${where}: ${String(res.stderr || '').trim()}` };
    if (!String(res.stdout || '').includes('hookSpecificOutput')) return { ok: false, skipped: false, reason: `hook command produced no hook envelope${where}` };
    return { ok: true, skipped: false, reason: null };
}

// ── settings 路径解析:必须绝对、且经【物理路径】绑定 canonical project root ──
// 字符串前缀只能挡字面逃逸。若 `project/.claude` 本身是指向项目外的 symlink/junction,
// 字面路径仍在项目内、实际写入却在项目外 —— 必须按 realpath 判定归属(R6 复审 P0-2)。
const normPath = (p) => {
    let r = String(p).replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
    return r;
};
function realpathOrThrow(fsOps, target) {
    try { return fsOps.realpathSync(target); }
    catch (e) { throw new Error(`takeover: cannot resolve ${target} (${e.message}); refusing to touch settings`); }
}

// 受管对象【唯一】:<canonicalProjectRoot>/.claude/settings.json。
// 只做"项目内 + 名字含 marker"的校验不够 —— 被篡改的 manifest 仍能指向项目内任意文件,
// 让 restore 覆盖、让 discard 删除它(R7 复审 P0-2)。所以身份必须精确到单个文件。
const MANAGED_SETTINGS_RELATIVE = path.join('.claude', 'settings.json');
const MANIFEST_KIND = 'attp-settings-backup';
const MANIFEST_SCHEMA_VERSION = 1;
const BACKUP_NAME_RE = /^settings\.json\.attp-backup-\d+-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function managedSettingsPath(projectRoot, fsOps = fs) {
    return path.join(realpathOrThrow(fsOps, projectRoot), MANAGED_SETTINGS_RELATIVE);
}

// backup 必须是受管 settings 的【同目录兄弟】,且文件名精确匹配生成规则;
// 若该路径已存在且是链接,同样拒绝(否则 discard 会顺链删掉别的文件)。
function resolveManagedBackupPath(managedSettings, backupPathInput, fsOps = fs) {
    const abs = path.resolve(String(backupPathInput));
    if (normPath(path.dirname(abs)) !== normPath(path.dirname(managedSettings))) {
        throw new Error(`takeover: backup must be a sibling of the managed settings file; got ${abs}`);
    }
    if (!BACKUP_NAME_RE.test(path.basename(abs))) {
        throw new Error(`takeover: backup path does not follow the managed naming rule: ${abs}`);
    }
    // 链接判定用 lstat:断链 symlink 的 existsSync 为 false,用 exists 判会漏掉(与守卫同一规则)
    let st = null;
    try { st = fsOps.lstatSync(abs); }
    catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    if (st && st.isSymbolicLink()) {
        throw new Error(`takeover: backup path is a link; refusing to touch it: ${abs}`);
    }
    if (st && normPath(realpathOrThrow(fsOps, abs)) !== normPath(abs)) {
        throw new Error(`takeover: backup path does not resolve to itself; refusing to touch it: ${abs}`);
    }
    return abs;
}

// 返回【验证过的绝对物理路径】。存在则直接 realpath;不存在则解析最近存在祖先再拼回尾部。
// 损坏 symlink / realpath 失败 / 物理落点在项目外 / 不是那个受管文件 → 一律抛错,绝不写也绝不删。
function resolveManagedSettingsPath(projectRoot, settingsPath, fsOps = fs) {
    const canonRoot = normPath(realpathOrThrow(fsOps, projectRoot));
    const abs = path.isAbsolute(settingsPath) ? path.resolve(settingsPath) : path.resolve(projectRoot, settingsPath);
    let existing = abs;
    const tail = [];
    for (;;) {
        if (fsOps.existsSync(existing)) break;                 // existsSync 跟随链接
        let dangling = false;
        try { fsOps.lstatSync(existing); dangling = true; }    // 链接本身在、目标不在 = 损坏链接
        catch (_) { dangling = false; }
        if (dangling) throw new Error(`takeover: ${existing} is a broken link; refusing to touch settings`);
        const parent = path.dirname(existing);
        if (parent === existing) throw new Error(`takeover: no existing ancestor for ${abs}`);
        tail.unshift(path.basename(existing));
        existing = parent;
    }
    const physical = path.join(realpathOrThrow(fsOps, existing), ...tail);
    const target = normPath(physical);
    // 明确决定:MVP 只管项目内 settings。用户级(~/.claude/settings.json)超出范围,拒绝而非隐式处理。
    if (!(target === canonRoot || target.startsWith(canonRoot + '/'))) {
        throw new Error(`takeover: --settings resolves outside the project root (${canonRoot}); got ${physical}. User-level settings are out of MVP scope.`);
    }
    // 身份精确到单个受管文件:项目内的其他文件同样不得被本工具写入或删除。
    const managed = path.join(canonRoot, MANAGED_SETTINGS_RELATIVE);
    if (normPath(physical) !== normPath(managed)) {
        throw new Error(`takeover: only ${managed} is managed; got ${physical}`);
    }
    return managed;
}

// manifest 读取即再验证:损坏或被篡改的 manifest 不得让 rollback/discard 触碰项目外文件。
function readBackupManifest(projectRoot, fsOps = fs) {
    const manifestPath = backupManifestPath(projectRoot);
    if (!fsOps.existsSync(manifestPath)) return null;
    let raw;
    try { raw = JSON.parse(fsOps.readFileSync(manifestPath, 'utf8')); }
    catch (e) { throw new Error(`takeover: settings backup manifest is corrupt (${e.message}); refusing to touch settings`); }
    // 与写入侧同一个 validator:两边判定不一致就会出现"提交成功但恢复路径拒收"的 manifest
    if (!validateBackupManifestShape(raw)) {
        throw new Error('takeover: settings backup manifest failed schema validation; refusing to touch settings');
    }
    // settingsPath 必须【就是】那个受管文件 —— 项目内任意其他文件也不许被 restore 覆盖或被 discard 删除
    const settingsPath = resolveManagedSettingsPath(projectRoot, raw.settingsPath, fsOps);
    const backupPath = raw.existed ? resolveManagedBackupPath(settingsPath, raw.backupPath, fsOps) : null;
    return { ...raw, settingsPath, backupPath, manifestPath };
}

// ── settings 事务化备份/回滚 ──
function backupManifestPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'generated', 'takeover', 'settings-backup.json');
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// manifest 形状的【唯一】判定:写入侧(commitManifest)与消费侧(readBackupManifest)必须共用,
// 否则可能"提交成功"却发布出一份恢复路径拒收的 manifest —— 事务化备份就名存实亡(R9 复审 P0-2)。
function validateBackupManifestShape(raw) {
    return Boolean(raw && typeof raw === 'object' && !Array.isArray(raw)
        && raw.kind === MANIFEST_KIND && raw.schemaVersion === MANIFEST_SCHEMA_VERSION
        && typeof raw.settingsPath === 'string' && typeof raw.existed === 'boolean'
        && (raw.existed
            ? (typeof raw.backupPath === 'string' && typeof raw.sha256 === 'string' && SHA256_RE.test(raw.sha256))
            : (raw.backupPath === null && raw.sha256 === null)));
}
// 六个承重字段的规范化投影:回读比较用它,避免再手写字段清单而漏项
const manifestFingerprint = (m) => JSON.stringify([m.kind, m.schemaVersion, m.settingsPath, m.existed, m.backupPath, m.sha256]);

// manifest 也走"先写临时、回读校验、再 rename 提交":半写的 manifest 会同时挡住下一次 backup
// 和 rollback/discard(前者见 manifest 即拒,后者解析失败即拒),必须不留半成品(R8 复审 P1-3)。
function commitManifest(fsOps, manifestPath, manifest) {
    const tmp = `${manifestPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        const back = JSON.parse(fsOps.readFileSync(tmp, 'utf8'));            // 回读 + 解析验证
        if (!validateBackupManifestShape(back)) throw new Error('manifest read-back failed schema validation');
        if (manifestFingerprint(back) !== manifestFingerprint(manifest)) throw new Error('manifest read-back mismatch');
        fsOps.renameSync(tmp, manifestPath);                                  // 原子提交
    } catch (e) {
        let cleanupError = null;
        try { if (fsOps.existsSync(tmp)) fsOps.unlinkSync(tmp); }
        catch (e2) { cleanupError = e2; }                                     // 清理失败不得静默(R9 复审 P1-1)
        if (cleanupError) {
            throw new AggregateError([e, cleanupError],
                `takeover: settings backup manifest not committed; orphaned temp manifest may remain at ${tmp}`);
        }
        throw new Error(`takeover: settings backup manifest not committed (${e.message})`);
    }
}

// 原文件存在却备份失败(写失败/回读不一致)→ 抛。绝不"以为有备份"就继续安装。
function backupSettings(settingsPathInput, { projectRoot, fsOps = fs } = {}) {
    const settingsPath = resolveManagedSettingsPath(projectRoot, settingsPathInput, fsOps); // 物理验证后的绝对路径
    const manifestPath = backupManifestPath(projectRoot);
    if (fsOps.existsSync(manifestPath)) {
        throw new Error(`takeover: a settings backup manifest already exists (${manifestPath}); resolve it before installing`);
    }
    fsOps.mkdirSync(path.dirname(manifestPath), { recursive: true });
    let manifest;
    if (!fsOps.existsSync(settingsPath)) {
        manifest = { kind: MANIFEST_KIND, schemaVersion: MANIFEST_SCHEMA_VERSION,
            settingsPath, existed: false, backupPath: null, sha256: null };
    } else {
        const original = fsOps.readFileSync(settingsPath);                       // Buffer:按字节,不经编码转换
        const backupPath = `${settingsPath}.attp-backup-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
        // 备份未提交(manifest 未写成)前的任何失败都要清掉半成品 —— 否则会在用户仓库里
        // 遗留一份含 settings 原始内容的孤儿副本(R7 复审 P1-2)。
        // 保留传入错误的【结构】:commitManifest 可能已抛 AggregateError([commitError, tempCleanupError]),
        // 若在这里统一压成 new Error(message),公开 API backupSettings 的调用者就拿不到 errors[](R10 复审 P1-1)。
        const abortBackup = (err) => {
            const errors = err instanceof AggregateError ? [...err.errors] : [err];
            let orphan = '';
            try { if (fsOps.existsSync(backupPath)) fsOps.unlinkSync(backupPath); }
            catch (e2) { errors.push(e2); orphan += `; orphaned backup may remain at ${backupPath}`; }
            // rename 提交前 manifest 不该出现;万一出现也如实报告路径供人工处理
            try { if (fsOps.existsSync(manifestPath)) orphan += `; stray manifest may remain at ${manifestPath}`; }
            catch (_) { /* ignore */ }
            if (err instanceof AggregateError || errors.length > 1) {
                throw new AggregateError(errors, `${err.message}${orphan}`);
            }
            throw new Error(`${err.message}${orphan}`, { cause: err });
        };
        try {
            fsOps.writeFileSync(backupPath, original);
            let readback;
            try { readback = fsOps.readFileSync(backupPath); }
            catch (e) { throw new Error(`takeover: settings backup unreadable after write (${e.message}); refusing to install`); }
            if (!Buffer.isBuffer(readback) || !readback.equals(original)) {
                throw new Error('takeover: settings backup does not match the original bytes; refusing to install');
            }
        } catch (e) { abortBackup(e); }
        manifest = { kind: MANIFEST_KIND, schemaVersion: MANIFEST_SCHEMA_VERSION,
            settingsPath, existed: true, backupPath, sha256: sha256(original) };
        try { commitManifest(fsOps, manifestPath, manifest); }
        catch (e) { abortBackup(e); }                                            // manifest 未提交 → 备份也不留
        return { ...manifest, manifestPath };
    }
    commitManifest(fsOps, manifestPath, manifest);                               // 无原文件:仍走同一提交路径
    return { ...manifest, manifestPath };
}

function restoreSettings({ projectRoot, fsOps = fs } = {}) {
    const manifest = readBackupManifest(projectRoot, fsOps);   // schema + 物理归属再验证,失败即抛
    if (manifest === null) throw new Error(`takeover: no settings backup manifest at ${backupManifestPath(projectRoot)}`);
    if (manifest.existed) {
        const bytes = fsOps.readFileSync(manifest.backupPath);
        if (sha256(bytes) !== manifest.sha256) throw new Error('takeover: backup bytes do not match the recorded digest; not restoring');
        fsOps.writeFileSync(manifest.settingsPath, bytes);                       // 恢复原始字节
        fsOps.unlinkSync(manifest.backupPath);
    } else if (fsOps.existsSync(manifest.settingsPath)) {
        fsOps.unlinkSync(manifest.settingsPath);                                 // 原本不存在 → 才允许删除
    }
    fsOps.unlinkSync(manifest.manifestPath);
    return { restored: manifest.existed ? 'original-bytes' : 'removed-new-file' };
}

// backup 清理:阶段门通过后调用。只删已验证存在的备份文件与 manifest,不触碰当前 settings。
function discardBackup({ projectRoot, fsOps = fs } = {}) {
    const manifest = readBackupManifest(projectRoot, fsOps);   // 同样再验证:篡改的 manifest 不得删项目外文件
    if (manifest === null) return { discarded: false };
    if (manifest.existed && fsOps.existsSync(manifest.backupPath)) fsOps.unlinkSync(manifest.backupPath);
    fsOps.unlinkSync(manifest.manifestPath);
    return { discarded: true };
}

function installWithBackup(settingsPath, { events, projectRoot, fsOps = fs }) {
    const backup = backupSettings(settingsPath, { projectRoot, fsOps });          // 失败即抛,install 根本不会跑
    try { return { ...installTakeoverHooks(settingsPath, { events, projectRoot, fsOps }), backup }; }
    catch (e) {
        try { restoreSettings({ projectRoot, fsOps }); }
        catch (restoreError) {   // 回滚也失败:两个错误都要留下,否则原始安装错误被覆盖(R5 复审 P1-2)
            throw new AggregateError([e, restoreError],
                `takeover install failed AND rollback failed; restore manually from ${backup.manifestPath}`);
        }
        throw e;
    }
}

function installTakeoverHooks(settingsPathInput, { events, projectRoot, fsOps = fs }) {
    const settingsPath = resolveManagedSettingsPath(projectRoot, settingsPathInput, fsOps); // 物理边界内的绝对路径
    const existing = readSettingsStrict(settingsPath, fsOps);     // 损坏 → 抛,原文件不动
    // 安装闸只用与 shell 无关的两项:命令形状 + adapter 可执行。命令级 probe 是诊断,不参与放行判定。
    const shape = verifyHookCommandShape(HOOK_COMMAND);
    if (!shape.ok) throw new Error(`takeover install: hook command shape invalid (${shape.reason}); settings unchanged`);
    const binary = probeAdapterBinary(projectRoot);
    if (!binary.ok) throw new Error(`takeover install: adapter probe failed (${binary.reason}); settings unchanged`);
    const before = JSON.stringify(existing);
    const merged = mergeHookConfig(existing, managedFragment(events));
    const serialized = JSON.stringify(merged, null, 2) + '\n';
    fsOps.mkdirSync(path.dirname(settingsPath), { recursive: true });
    // 临时文件含【合并后的完整 settings】(可能带用户原有敏感字段),rename 失败必须清理,
    // 否则会永久残留在仓库里,且不在 .gitignore 覆盖范围内(R10 复审 P1-2)。
    const tmp = `${settingsPath}.evo-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.writeFileSync(tmp, serialized, 'utf8');
        fsOps.renameSync(tmp, settingsPath);                       // 原子替换;此后不得再有可失败的业务操作
    } catch (installError) {
        let cleanupError = null;
        try { if (fsOps.existsSync(tmp)) fsOps.unlinkSync(tmp); }
        catch (e) { cleanupError = e; }
        if (cleanupError) {
            throw new AggregateError([installError, cleanupError],
                `takeover install failed; orphaned temporary settings may remain at ${tmp}`);
        }
        throw installError;
    }
    return { changed: JSON.stringify(merged) !== before };
}

function statusTakeoverHooks(settingsPathInput, events, projectRoot) {
    // projectRoot 给出时同样做物理解析(子目录下 status 才不会读错文件);测试可省略
    const settingsPath = projectRoot ? resolveManagedSettingsPath(projectRoot, settingsPathInput) : settingsPathInput;
    const cfg = readSettingsStrict(settingsPath);                  // 损坏 → 抛(不误报 all-missing)
    const hooks = cfg.hooks || {};
    const installed = [], missing = [];
    for (const ev of events) {
        (Array.isArray(hooks[ev]) && hooks[ev].some(isManagedGroup) ? installed : missing).push(ev);
    }
    return { installed, missing };
}

module.exports = { MANAGED_MARK, HOOK_COMMAND, managedGroup, managedFragment, isManagedGroup,
    mergeHookConfig, verifyHookCommandShape, probeAdapterBinary, resolveHostShell, probeHookCommand,
    MANAGED_SETTINGS_RELATIVE, managedSettingsPath, resolveManagedSettingsPath, resolveManagedBackupPath,
    backupManifestPath, validateBackupManifestShape, readBackupManifest, backupSettings, restoreSettings,
    discardBackup, installWithBackup, installTakeoverHooks, statusTakeoverHooks };
```

- [ ] **Step 4: 运行验证通过** — `✅ T-takeover-installer passed`。

- [ ] **Step 5: 加 `mem takeover install|status`**

在 `buildProgram()` 内 bootstrap 注册之后新增:

```javascript
    const takeoverCmd = program.command('takeover').description('Agent Takeover Trigger Protocol host-adapter management.');
    takeoverCmd.command('install')
        .option('--events <list>', 'Comma-separated events', 'SessionStart,UserPromptSubmit')
        .option('--settings <path>', 'Path to settings.json', '.claude/settings.json')
        .option('--backup', 'Back up settings transactionally first (required before dogfood)', false)
        .action(options => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const events = options.events.split(',').map(s => s.trim()).filter(Boolean);
            const projectRoot = rc.canonicalProjectRoot();
            const res = options.backup
                ? ti.installWithBackup(options.settings, { events, projectRoot })
                : ti.installTakeoverHooks(options.settings, { events, projectRoot });
            if (res.backup) console.log(`🗄️  settings backed up: ${res.backup.existed ? res.backup.backupPath : '(no prior settings file)'}`);
            console.log(res.changed ? `✅ takeover hooks installed (${events.join(', ')})` : '✅ takeover hooks already in sync');
        });
    takeoverCmd.command('rollback')
        .description('Restore settings.json from the transactional backup manifest.')
        .action(() => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const res = ti.restoreSettings({ projectRoot: rc.canonicalProjectRoot() });
            console.log(`↩️  settings rolled back (${res.restored})`);
        });
    takeoverCmd.command('probe')
        .description('Diagnostic: run the hook command verbatim under the host-equivalent POSIX shell.')
        .action(() => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const r = ti.probeHookCommand(rc.canonicalProjectRoot());
            console.log(JSON.stringify(r));
            if (!r.ok) process.exitCode = 1;
        });
    takeoverCmd.command('backup-discard')
        .description('Drop the settings backup after a review gate passes (leaves current settings untouched).')
        .action(() => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const res = ti.discardBackup({ projectRoot: rc.canonicalProjectRoot() });
            console.log(res.discarded ? '🧹 settings backup discarded' : 'ℹ️  no settings backup to discard');
        });
    takeoverCmd.command('status')
        .option('--events <list>', 'Comma-separated events', 'SessionStart,UserPromptSubmit,PreToolUse')
        .option('--settings <path>', 'Path to settings.json', '.claude/settings.json')
        .action(options => {
            const ti = require('./takeover-install');
            const rc = require('./takeover-receipt');
            const events = options.events.split(',').map(s => s.trim()).filter(Boolean);
            const s = ti.statusTakeoverHooks(options.settings, events, rc.canonicalProjectRoot());
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
# ATTP — transactional settings backup (machine-local, never committed)
.evo-lite/generated/takeover/settings-backup.json
.claude/settings.json.attp-backup-*
.claude/settings.json.evo-tmp-*
```

- [ ] **Step 8: 语法自检 + 同步镜像 + 双运行零 + 全套件**

```bash
# 五个新模块先过语法闸:长文计划里的代码块最易死在转义上,
# 而语法错在 require 阶段才炸,会把 installer/CLI/dogfood 一起拖死(R6 复审 P0-1)
for f in takeover-payload takeover-receipt takeover-session takeover-adapter takeover-install; do
  node --check "templates/cli/$f.js" || exit 1
done
node templates/cli/sync-runtime-entry.js
node templates/cli/sync-runtime-entry.js
node templates/cli/test.js all
```
Expected: 五个 `node --check` 全部无输出(通过);首次复制五文件;二次 `copied: 0`;`test.js all` 全绿。

- [ ] **Step 9: 母仓事务化安装 → dogfood(宿主自证 transport;失败必须回滚)**

镜像已在 Step 8 生成。**注意:本地 spawn 出来的 shell 不是 Claude Code 执行 hook 的 shell** —— 命令级 probe 只作诊断,
**宿主 transport 的权威证据是下面的 `claude -p` dogfood**(由宿主自己执行那条命令并观测 marker)。

**命令入口纠正:** 下面全部使用 `node .evo-lite/cli/memory.js takeover …`,而不是 `node templates/cli/memory.js takeover …`。
`better-sqlite3` 只能从 `.evo-lite/node_modules/` 解析,`templates/cli/memory.js` 在 require 阶段就会直接炸,
走不到任何 takeover 代码;运行时镜像(`.evo-lite/cli/memory.js`,Step 8 已同步)才是真正可执行的入口。

```bash
# ① 诊断(信息用途,失败也不阻止安装,但必须记录到 dogfood 文档)
node .evo-lite/cli/memory.js takeover probe || echo "command probe not conclusive on this machine (recorded)"

# ② 事务化备份 + 安装(备份失败 → 命令直接非零退出,不会安装)
node .evo-lite/cli/memory.js takeover install --backup --events SessionStart,UserPromptSubmit --settings .claude/settings.json
node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json
```

**回滚契约:** 下面任一 dogfood 断言失败 → 立即回滚,再回报,**不得把失效配置留在仓库里**。回滚按 manifest 恢复**原始字节**;
仅当原本没有 settings 文件时才会删除文件:

```bash
node .evo-lite/cli/memory.js takeover rollback
node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json   # 应显示 missing
git diff --stat .claude/settings.json                                          # 应无差异(原始字节已恢复)
```

用 `claude -p` 跑裸 prompt("分析当前项目正在做什么,下一步该做什么"),记录到 `docs/validation/attp-phase1-dogfood.md`:
- 首次推理前上下文含 `[evo-lite takeover]` payload;每轮 capsule `takeover-active`;
- receipt 落 `.evo-lite/generated/takeover/receipts/claude-code/` 为 committed;
- **在子目录 cwd 下**仍生效(证明宿主确实展开了 `$CLAUDE_PROJECT_DIR`,这是命令级 transport 的**权威证据**);
- 命令级 probe 的本机结果(ok / skipped / 失败原因)与宿主实际行为是否一致 —— **不一致本身就是要记录的发现**;
- **hook 进程退出码实测为 0**,stdout 只有 JSON —— 与官方"JSON only processed on exit 0"契约一致(若观察到宿主在非零退出时仍摄入 JSON,记为契约偏差,但**不据此放宽**本设计);
- Agent 首轮明确引用 injected focus(S9b,P2 效果证据)。

- [ ] **Step 10: 提交 + 阶段 1 复审门**

```bash
node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json   # dogfood 全绿后确认事件在位
# 备份保留到【阶段 1 复审门通过后】才丢弃(未通过则 takeover rollback)。
# manifest 不清理会挡住下一次 backupSettings,所以这是复审门后的必做收口动作:
#   node .evo-lite/cli/memory.js takeover backup-discard
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

### Task 7: PreToolUse fail-closed 守卫(完整 health gate + target-path 绑定)

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
    assert.ok(noRcpt.permissionDecisionReason.includes(`--session-id '${sid}'`),
        'deny reason command is actually executable (runReceiptRecovery requires --session-id)');

    rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
        state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });
    assert.strictEqual((await call('Write', { file_path: path.join(root, 'src', 'a.txt') })).permissionDecision, 'allow', 'in-project allow');
    assert.strictEqual((await call('Write', {})).permissionDecision, 'deny', 'missing target → fail-closed');
    assert.strictEqual((await call('Write', { file_path: 123 })).permissionDecision, 'deny', 'non-string target → fail-closed');
    // 坏 capsule(builder 被注入返回垃圾)→ validateCapsule 失败 → deny
    const badCap = await call('Write', { file_path: path.join(root, 'a.txt') }, { buildPayload: () => ({ unexpected: true }) });
    assert.strictEqual(badCap.permissionDecision, 'deny', 'invalid capsule → deny (validator actually runs)');

    // realpath 故障注入 ①:项目根不可 canonicalize → deny(绝不抛到 main 变成放行)
    rc.__setFsOps({ realpathSync: () => { throw new Error('EACCES'); } });
    let rootFail; try { rootFail = await call('Write', { file_path: path.join(root, 'a.txt') }); } finally { rc.__resetFsOps(); }
    assert.strictEqual(rootFail.permissionDecision, 'deny', 'root realpath failure → deny');
    assert.ok(/--session-id 'g'/.test(rootFail.permissionDecisionReason),
        'root-failure deny still hands back an executable recovery command');

    // realpath 故障注入 ②:仅 target 侧不可解析(根仍正常)→ deny
    fs.mkdirSync(path.join(root, 'locked'), { recursive: true });
    rc.__setFsOps({ realpathSync: (p) => { if (String(p).includes('locked')) throw new Error('EPERM'); return fs.realpathSync(p); } });
    let tgtFail; try { tgtFail = await call('Write', { file_path: path.join(root, 'locked', 'a.txt') }); } finally { rc.__resetFsOps(); }
    assert.strictEqual(tgtFail.permissionDecision, 'deny', 'target realpath failure → deny (never string-only containment)');

    // 守卫内部任意抛错也必须 deny(注入一个会抛的 reconcile 路径)
    const boom = await call('Write', { file_path: path.join(root, 'a.txt') },
        { buildPayload: () => { throw new Error('kaboom'); } });
    assert.strictEqual(boom.permissionDecision, 'deny', 'any guard exception → deny');
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

// 守卫【任何】抛错都必须落在 deny 上:PreToolUse 输出里没有 permissionDecision 等于放行,
// 抛到 main 的通用错误路径就是 fail-open(R4 复审 P0-2 ④)。
function handlePreToolUse(input, deps) {
    const tool = input.tool_name;
    if (READONLY_TOOLS.has(tool) || tool === 'Bash') return ptu('allow');
    if (!GUARDED_WRITE_TOOLS.has(tool)) return ptu('allow');
    try { return guardWrite(input, deps); }
    catch (e) {
        const hint = recoveryText(buildGenericRecoveryCommand(input && input.session_id));
        return ptu('deny', `[evo-lite] takeover guard failed (${e.message}); refusing write. Run from the project root — ${hint}`);
    }
}

function guardWrite(input, deps) {
    const rootRes = resolveRoot(deps);   // canonicalization(含 realpath)失败 → deny
    if (!rootRes.ok) {
        return ptu('deny', `[evo-lite] cannot canonicalize the project root (${rootRes.error}); refusing write. Run from the project root — ${recoveryText(buildGenericRecoveryCommand(input.session_id))}`);
    }
    const projectRoot = rootRes.root;
    const sessionId = input.session_id;
    const recovery = recoveryText(buildRecoveryCommand(projectRoot, sessionId));

    // (a) committed receipt
    if (rc.readReceipt(projectRoot, HOST, sessionId).state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover required before writing. ${recovery}`);
    }
    // (b) active_context 可读 + reconcile 非 degraded
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    if (verdict.transition === 'degraded' || verdict.state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover unhealthy (${verdict.reason || verdict.transition}). ${recovery}`);
    }
    // (b2) 构建 refresh capsule → validateCapsule → 字节预算
    const build = deps.buildPayload || buildTakeoverPayload;
    let capsule;
    try {
        capsule = build({ kind: 'refresh', host: HOST, sessionId, projectRoot, projectName: path.basename(projectRoot),
            sourceEvent: 'PreToolUse', focus: focus.text, focusHash: focus.hash,
            receiptVerdict: verdict, recoveryAction: recovery }, CAPSULE_BUDGET_BYTES);
    } catch (e) { return ptu('deny', `[evo-lite] takeover payload build failed (${e.message}). ${recovery}`); }
    const capVerdict = validateCapsule(capsule, CAPSULE_BUDGET_BYTES);
    if (!capVerdict.ok) return ptu('deny', `[evo-lite] takeover payload invalid (${capVerdict.errors.join(',')}). ${recovery}`);

    // (c) target-path fail-closed
    const ti = input.tool_input;
    const target = ti && typeof ti === 'object' ? ti.file_path : null;
    if (!target || typeof target !== 'string') {
        return ptu('deny', `[evo-lite] cannot determine target path; refusing write. ${recovery}`);
    }
    const abs = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    // 向上找最近【条目存在】的一层。注意用 lstat 而非 exists:断链 symlink 的 exists 为 false,
    // 若按"还没建的文件"跳过它退到父目录,守卫就会放行,而 Write 会沿链接写到项目外(R7 复审 P0-1)。
    let probe = abs;
    for (;;) {
        let info;
        try { info = rc.pathEntryInfo(probe); }
        catch (e) { return ptu('deny', `[evo-lite] cannot stat '${probe}' (${e.message}); refusing write.`); }
        if (info.exists) break;                      // 含"存在的链接",下面必须物理解析它
        const parent = path.dirname(probe);
        if (parent === probe) return ptu('deny', `[evo-lite] no existing ancestor for '${target}'; refusing write.`);
        probe = parent;
    }
    // 最近存在条目的 realpath 失败(权限/断链/不可解析 junction)→ deny。
    // 未经解析的字符串做 containment 判断,正是 symlink 逃逸能绕过守卫的原因(R4 复审 P0-2 ③)。
    try { probe = rc.realpathStrict(probe); }
    catch (e) { return ptu('deny', `[evo-lite] cannot resolve target '${target}' (${e.message}); refusing write.`); }
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

        // 断链逃逸(R7 复审 P0-1):目标【尚不存在】的链接,existsSync 为 false,
        // 但 Write 仍会沿链接在项目外创建文件 —— 必须 deny,且不得真的产生该文件。
        const missingOutside = path.join(other, 'new-file.js');
        const broken = path.join(root, 'broken-link.js');
        let brokenMade = false;
        try { fs.symlinkSync(missingOutside, broken, 'file'); brokenMade = true; } catch (_) { brokenMade = false; }
        if (!brokenMade) {
            assert.strictEqual(process.platform, 'win32', 'dangling file symlink case is mandatory on POSIX');
            console.log('   ⏭️ dangling file symlink case skipped (win32 without symlink privilege)');
        } else {
            assert.strictEqual(fs.existsSync(broken), false, 'a dangling link reads as "does not exist" — the exact trap');
            assert.strictEqual(await dec({ file_path: broken }), 'deny', 'dangling symlink target → deny (not treated as a new file)');
            assert.strictEqual(fs.existsSync(missingOutside), false, 'nothing was created outside the project');
        }
        // 中间目录断链:project/link-dir → other/missing-dir
        const brokenDir = path.join(root, 'link-dir');
        let brokenDirMade = false;
        try { fs.symlinkSync(path.join(other, 'missing-dir'), brokenDir, 'junction'); brokenDirMade = true; }
        catch (_) { try { fs.symlinkSync(path.join(other, 'missing-dir'), brokenDir, 'dir'); brokenDirMade = true; } catch (_) { brokenDirMade = false; } }
        if (!brokenDirMade) {
            assert.strictEqual(process.platform, 'win32', 'dangling directory link case is mandatory on POSIX');
            console.log('   ⏭️ dangling directory link case skipped (win32 without symlink privilege)');
        } else {
            assert.strictEqual(await dec({ file_path: path.join(brokenDir, 'a.js') }), 'deny', 'dangling directory link → deny');
        }
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

### Task 8: 故障注入验收(逐条对应复审门)+ 复审门 2

**Files:**
- Test: `templates/cli/test/governance.js`(`T-takeover-fault-suite`)
- Modify: `.claude/settings.json`(installer events 增 `PreToolUse`)
- Create: `docs/validation/attp-phase2-fault-injection.md`

- [ ] **Step 1: 写故障注入测试(八条断言,均用注入 seam 真实制造失败)**

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
      assert.strictEqual(r.exitCode, 0, 'structured envelope exits 0 (host ignores JSON on nonzero)');
      assert.ok(r.failure, 'invalid payload reported via failure field + systemMessage');
      assert.strictEqual(r.publish, null, 'invalid payload → no publish');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f2').state, 'missing');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 3) collector 抛错(不可恢复)→ 无 committed + 非零 + 明示恢复命令
    { const { root } = mkRoot();
      const r = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f3', source: 'startup' },
          { projectRoot: root, collect: () => { throw new Error('initDB boom'); } });
      assert.strictEqual(r.exitCode, 0, 'degraded context must be ingestible → exit 0');
      assert.ok(r.failure && r.publish === null, 'collector failure reported, nothing published');
      assert.ok(/bootstrap --receipt/.test(r.json.hookSpecificOutput.additionalContext), 'degraded context carries recovery command');
      assert.ok(/--session-id 'f3'/.test(r.json.hookSpecificOutput.additionalContext), 'and that command is executable');
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

    // 7) same-session refresh 失败分流(R5 承重语义):旧 receipt 不撤销,终局由 health gate 决定
    { const { root, ac } = mkRoot();
      // 先建立 committed receipt
      const est = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f7', source: 'startup' }, { projectRoot: root, collect: goodCollect });
      ad.executeHookTransport(est.json, est.publish, { write: () => {} });
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f7').state, 'committed');
      // 同 session resume,但 full refresh 失败(collector 抛错)
      const refreshFail = await ad.handleHookInput({ hook_event_name: 'SessionStart', session_id: 'f7', source: 'resume' },
          { projectRoot: root, collect: () => { throw new Error('verify exploded'); } });
      assert.strictEqual(refreshFail.exitCode, 0, 'refresh failure still exits 0 so its context is ingested');
      assert.ok(refreshFail.failure, 'refresh failure reported explicitly via the failure field');
      assert.strictEqual(refreshFail.publish, null, 'refresh failure publishes nothing');
      assert.strictEqual(rc.readReceipt(root, 'claude-code', 'f7').state, 'committed', 'old receipt NOT auto-revoked on refresh failure');
      // governance health 正常 → Write 仍 allow(session-only 失败不阻断)
      assert.strictEqual(await writeDec(root, 'f7'), 'allow', 'session-only refresh failure → health gate allows');
      // capsule 仍每轮注入
      const cap = await ad.handleHookInput({ hook_event_name: 'UserPromptSubmit', session_id: 'f7' }, { projectRoot: root });
      assert.strictEqual(JSON.parse(cap.json.hookSpecificOutput.additionalContext).receipt, 'valid', 'capsule still re-seeds after refresh failure');
      // 反向:governance health 失败(active_context 删除)→ Write deny
      fs.rmSync(path.join(ac, 'active_context.md'), { force: true });
      assert.strictEqual(await writeDec(root, 'f7'), 'deny', 'governance-health failure → health gate denies');
      fs.rmSync(root, { recursive: true, force: true }); }

    // 8) recovery 执行后 Write 解锁(端到端子进程)
    { const { root, ac } = mkRoot();
      const memJs = path.join(TEMPLATE_CLI_DIR, 'memory.js');
      const sub = childProcess.spawnSync(process.execPath, [memJs, 'bootstrap', '--receipt', '--host', 'claude-code',
          '--session-id', 'f8', '--source', 'manual-recovery', '--json'],
          { cwd: root, env: { ...process.env, EVO_LITE_ROOT: ac, EVO_LITE_SKIP_GIT_STATUS: '1' }, encoding: 'utf8' });
      assert.strictEqual(sub.status, 0, `recovery ok (stderr: ${sub.stderr})`);
      assert.strictEqual(await writeDec(root, 'f8'), 'allow', 'Write unlocked after explicit recovery');
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

- [ ] **Step 5: 复审门 2 + 阶段收口** — 停止请求复审门(P0 no-silent-bypass)。通过后 `node templates/cli/memory.js takeover backup-discard` 清理备份;未通过则 `takeover rollback`。两 P0 均达成后,进入治理闭环(`mem` intake spec + plan closure)与 hive nurture 分发。

---

## 复审落点(计划 R1 → R10)

| 编号 | 问题 | 落点 |
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
| R3 P0-1 | session 校验太浅;UserPromptSubmit 完全绕过 validator | Task 1 `validateSessionPayload` 深校验(active 条目 / freshness 三键与有限数值 / health 枚举 / verify.hasAlerts / recall.status / degraded 条目);Task 4 UPS 走可注入 builder + **强制 `validateCapsule`**,失败输出**经自校验的 emergency capsule** + 非零;SessionStart 的 `build()` 纳入 try/catch 并附恢复命令 |
| R3 P0-2 | 损坏 FOCUS/META 锚点被当健康 | Task 2 `readFocusAnchor` 锚点非严格一对 → `null`;`readMetaAnchor` → `{ok,reason,meta}`,缺失/非整数 → `ok:false` 入 `degraded[]`,`NaN` 归一为 `null`;新增损坏锚点 / 重复锚点 / 非法数值三例 |
| R3 P0-3 | probe 未验真实 Hook 命令;Task 6 顺序跑不通 | Task 6 拆分 probe;测试改用**临时假项目 + stub adapter**(不依赖尚未 sync 的镜像);真实仓库 probe 移到 Step 9(sync 之后)并加 settings 备份/回滚契约。**R5 进一步修正**:命令级 probe 降级为诊断,安装闸改用与 shell 无关的两项(见 R4 P0-3) |
| R3 P0-4 | 缺 same-session refresh-failure 分流验收 | Task 8 新增用例 7:建立 committed → 同 session `resume` 且 collector 抛错 → 显式非零 + **旧 receipt 不撤销** → health 正常时 Write **allow** + capsule 仍注入 → 删 active_context 后 Write **deny** |
| R3 P1-1 | fresh-process collector 测试可能误通过 | 断言 `verify.hasAlerts` 为 boolean、`verify.git` 非空、`recall.status` 为 string,且 `degraded` 不含 `verify/recall` |
| R3 P1-2 | `writeAllSync` 零进展死循环 | 返回值非正整数即抛 `no progress`;新增 partial-write(每次 3 字节)与 zero-write 两例 |
| R3 P1-3 | fallback capsule 丢真实 focusHash | fallback 改 `focusHash: ctx.focusHash || null` |
| R3 P1-4 | 残留实施期占位判断 | 已实测:`formatBootstrapReport`/`runBootstrapCommand`/`buildTakeoverRecall` **仅 `memory.js` 内部调用**(282/469/474/475/513),无其他调用点;MCP `evo_active_context` 走独立 `handleActiveContext()`,不受影响 |
| R4 P0-1 | emergency capsule 不保证合法且 ≤1 KiB,超长时退回未预算普通文本 | Task 1 新增 `buildEmergencyCapsule(input, budget)` → `{capsule, systemMessage}`:**独立于正常 builder**、共用同一 UTF-8 裁剪、确定性降级阶梯(全量 → 去 action → 裁 project → 去 focusHash → 常量地板 `EMERGENCY_FLOOR_BYTES`),恒 ≤ 预算且恒过 `validateCapsule`;**恢复命令只整条带上或整条省略**(截断的 shell 命令比没有更危险),省略时完整命令走 `systemMessage`。Task 4 删除普通文本分支,UPS 全部失败模式(builder 垃圾 / builder 抛错 / validator 拒绝 / 根解析失败)统一走 `emergencyResult`;测试注入超长 root+sessionId+action 及垃圾输入,并对四种失败模式统一断言"必是预算内合法 capsule" |
| R4 P0-2 | realpath / canonicalization 三处 fail-open | ①`canonicalProjectRoot` 的 realpath 失败**即抛**(删 try/catch);②`invalidateReceipt` **不再** `path.resolve` 兜底 —— 无 canonical root 时跳过 tombstone,只用"不写入任何身份"的 unlink 撤销,再失败如实报 `ok:false`;③守卫 target 解析改用 `rc.realpathStrict`/`rc.pathExists`(同一 fs seam),失败**即 deny**;④`handlePreToolUse` 外层 try/catch + `resolveRoot`,**任何异常一律 deny**(PreToolUse 缺 `permissionDecision` = 放行,原实现会经 `main` 泄成 fail-open)。故障注入测试分别覆盖 root 与 target(后者用只对含 `locked` 路径抛错的注入隔离) |
| R4 P0-3 | `probeHookCommand` 验的是 Node 默认 OS shell,不是宿主 shell,可能误拒装 | 安装闸改为**与 shell 无关的两项**:`verifyHookCommandShape`(静态:`node ` 开头 + 引用受管 adapter + `$CLAUDE_PROJECT_DIR` 在双引号内)+ `probeAdapterBinary`。`probeHookCommand(projectRoot,{shell,resolveShell})` **降级为诊断**,必须显式指定 shell(`resolveHostShell`:`EVO_LITE_HOOK_SHELL`/`CLAUDE_CODE_GIT_BASH_PATH` → win32 Git Bash → `/bin/sh`),shell 不可发现时返回 `{ok:true,skipped:true}`,**绝不因此拒装**;新增"坏 shell 如实报错""skipped 不影响安装"两例。**宿主 transport 的权威证据改为 Step 9 的真实 `claude -p` dogfood**(子目录 cwd 生效即证明宿主展开了 `$CLAUDE_PROJECT_DIR`),并要求记录本机 probe 与宿主行为不一致的情况 |
| R4 P0-4 | settings 备份失败被 `\|\| true` 吞掉,回滚可能 `rm` 掉用户原配置 | Task 6 新增事务式三件套:`backupSettings`(原文件存在却写失败/回读不一致 → **立即抛**;唯一备份路径 + 确定性 manifest `.evo-lite/generated/takeover/settings-backup.json` 存 `existed/backupPath/sha256`;manifest 已存在即抛,不覆盖旧备份)、`restoreSettings`(按 sha256 校验后**恢复原始字节**;仅 `existed:false` 才允许删文件)、`installWithBackup`(install 失败自动回滚)。CLI 增 `takeover install --backup` / `takeover rollback` / `takeover probe`;Step 9 手册步骤全部换成这些命令;**新增自动化测试**覆盖备份损坏即停、字节级恢复、只删自建文件、自动回滚不留残余 manifest |
| R4 P1-1 | `readMetaAnchor` 接口声明仍是旧返回类型 | Interfaces 改为 `{ ok, reason, meta }`(**永不返回 null**),并列出四种 `reason` 取值 |
| R4 P1-2 | freshness 计数允许负数/小数 | `numOrNull` → `countOrNull`(`null` 或 `Number.isInteger(v) && v >= 0`);META reader 的 `toInt` 同步加 `n >= 0`;新增 `-1` / `1.5` / META `ahead: -3` 三例 |
| R5 P0-1 | 结构化 hook JSON 配非零退出 → 宿主根本不解析,degraded capsule / 恢复说明 / systemMessage 全被丢弃 | **宿主契约勘误**(官方:*JSON output is only processed on exit 0*;exit 1 = 非阻断错误、动作继续)。Task 4 所有已成功序列化 envelope 的返回一律 `exitCode: 0`,新增 `failure:string\|null` 字段承载失败;失败改由 degraded capsule + `systemMessage` + 不发布 receipt + stderr(`reportError`)+ PreToolUse `deny` 表达;非零仅保留给序列化/写出/发布失败与 CLI recovery。`main` 的兜底分支同样 exit 0。Task 6 `probeAdapterBinary` 相应升级为**解析 envelope 与 capsule**并把 `takeover-degraded` 视为拒装理由(退出码已不能判定健康)。新增 `T-takeover-hook-exit-contract`:**真实子进程**证明 emergency 与 degraded 两条路径都 exit 0、stdout 只有 JSON、capsule 合法且 ≤1 KiB、无 committed receipt。Task 8 三条相关断言同步改写。**设计文档同步出勘误**(§0 R6) |
| R5 P0-2 | 通用恢复命令缺 `--session-id`,Agent 执行必失败 | `buildRecoveryCommand` / `buildGenericRecoveryCommand` **均带 `--session-id`(bash 转义)**,且 sessionId 非法时**返回 `null`**;`recoveryText(cmd)` 在无命令时明确输出 *"Cannot auto-recover: no session id … Restart the session"*,不再谎称可恢复。SessionStart / UserPromptSubmit / 守卫三处 deny/degraded 文案全部改用它;测试断言三处文案均含 `--session-id '<sid>'`,并覆盖单引号 sessionId 的转义与"无 sessionId 不谎称可恢复" |
| R5 P0-3 | manifest 存相对 settings 路径,子目录 rollback 会解析错位置 | 新增 `resolveSettingsPath(projectRoot, settingsPath)`:相对路径绑 canonical project root、一律存**绝对路径**;**项目外路径明确抛错**(用户级 settings 明示超出 MVP 范围,不隐式处理)。`installTakeoverHooks`/`backupSettings`/`installWithBackup` 内部统一调用,`statusTakeoverHooks` 增可选 `projectRoot`,CLI `status` 传入。新增测试:项目根 `install --backup`(相对路径)→ **chdir 到嵌套子目录** → `restoreSettings` 恢复**根目录**原始字节,且子目录内不新建/删除任何文件。**R7 升级为物理边界**(见 R6 P0-2) |
| R5 P1-1 | 缺复审门通过后的 backup 清理动作 | 新增 `discardBackup()` 与 `mem takeover backup-discard`:只删已验证存在的备份文件与 manifest,**不触碰当前 settings**;Step 10 与阶段 2 收口写明"通过则 discard、未通过则 rollback";测试断言幂等且 settings 不变 |
| R5 P1-2 | 自动回滚失败会覆盖原始安装错误 | `installWithBackup` 的 catch 中若 `restoreSettings` 也抛,则抛 `AggregateError([installError, restoreError])` 并在 message 中给出 manifest 路径供人工恢复 |
| R5 P1-3 | 计划文本未同步 | Task 6 Files 改为 `install\|status\|rollback\|probe\|backup-discard`;Task 8 Step 1 标题"七条断言"改为"八条断言" |
| R4 P1-3 | 错误输出用异步 `process.stderr.write`,`process.exit` 前可能未写完 | 新增 `reportError(msg)`:走 `writeAllSync(2, ...)`(与业务输出同一完整写入语义),stderr 不可写时不再抛,由退出码承载;`runTransport` 三处失败路径改用它 |

| R6 P0-1 | `normPath` 的正则漏转义(`/\/g`),`takeover-install.js` 直接语法错 | 修正为 `String(p).replace(/\\/g, '/')`。并加**语法闸**:Task 6 Step 8 先对五个新模块跑 `node --check`,任一不过即停(语法错在 `require` 阶段才炸,会把 installer/CLI/dogfood 一起拖死)。**本轮已实跑**:抽出计划中全部 24 个 ```javascript 代码块逐块 `node --check`,22 个真实代码块全部通过(另 2 个是 manifest 数组插入片段,裸元素非完整语句,属预期不适用) |
| R6 P0-2 | settings containment 仍是字符串前缀,`.claude` symlink/junction 可物理逃逸 | `resolveSettingsPath` → **`resolveManagedSettingsPath(projectRoot, settingsPath, fsOps)`**:realpath 项目根;settings 存在则 realpath 自身,不存在则**逐级找最近存在祖先** realpath 后再拼回尾部;**损坏链接**(lstat 成功但 exists 失败)、realpath 失败、物理落点越界一律抛错。manifest 只存验证后的物理路径。新增 **`readBackupManifest`**:`restoreSettings`/`discardBackup` 读取即**再验证**(schema + 两个路径的物理归属 + `.attp-backup-` 命名规则),不过即抛且不写不删。测试:`project/.claude → symlink → outside/.claude` 时 `resolveManagedSettingsPath` 与 `installWithBackup` 均拒绝、项目外文件字节不变、不产生 backup/manifest;篡改 `settingsPath`/`backupPath`/命名/损坏 JSON/缺字段五种 manifest 均 fail loud 且不碰项目外文件 |
| R6 P1-1 | 两处陈旧「非零退出」表述 | Global Constraints「校验不过 → emergency capsule + 非零」改为「+ `failure`/`systemMessage`/stderr,**且 exit 0**」;Task 4 测试注释「SessionStart 必须 fail-closed(非零 + 不发布)」改为「**exit 0 + 不发布 receipt + failure 标记**」 |
| R6 P1-2 | stderr 诊断未统一覆盖所有 handler | 诊断出口收敛到 `main()`:`if (out.failure) reportError(...)`;`emergencyResult` 内的 `reportError` 删除以免重复。`reconcile` 判 degraded/stale 属**治理状态而非 handler 故障** → `failure` 保持 `null`,但 UPS 为其补 `systemMessage`,并在代码注释中把这条规则写死 |
| R6 P1-3 | probe 未真正校验 capsule schema | `takeover-install.js` 直接 `require('./takeover-payload')` 并调 **`validateCapsule(capsule, CAPSULE_BUDGET_BYTES)`**;安装闸 = envelope 合法 ∧ capsule 合法 ∧ ≤1 KiB ∧ 非 degraded。新增用例:`{evoLite:"takeover-stale"}` 这种残缺 capsule 必须以 `capsule invalid` 拒装 |
| R6 P1-4 | AggregateError 分支无测试 | `installTakeoverHooks` 增 `fsOps` 注入并贯穿 `readSettingsStrict`/`mkdir`/`write`/`rename`;测试注入「rename 必失败 + 写回 settings 本体必失败」制造双失败,断言 `AggregateError`、`errors.length===2`、错误顺序(install 在前、rollback 在后)、message 含 manifest 绝对路径、manifest 与 backup **保留**供人工恢复 |

| R7 P0-1 | 守卫可被**断链 symlink** 绕过:`existsSync` 对断链返回 false,守卫当成"文件还没建"退到项目根后 allow,Write 却沿链接写到项目外 | `takeover-receipt.js` 增 `pathEntryInfo(target)`(**lstat**:`{exists, symbolicLink}`;ENOENT → 不存在,其他异常抛出)。守卫向上查找改为逐级 `pathEntryInfo`,**条目存在(含链接)即停**并 `realpathStrict`,realpath 失败 / 无存在祖先 / stat 异常 → 一律 deny。新增两例:`project/broken-link.js → outside/new-file.js`(先断言 `existsSync` 为 false 以固化该陷阱)→ deny 且**项目外文件未被创建**;中间目录断链 `project/link-dir → outside/missing-dir` 写 `link-dir/a.js` → deny |
| R7 P0-2 | 篡改 manifest 仍可覆盖/删除**项目内任意文件**("项目内 + 名字含 marker"不构成授权) | 受管对象锁死为**唯一**文件 `<canonicalProjectRoot>/.claude/settings.json`:`resolveManagedSettingsPath` 末尾追加**恒等判定**,项目内其他路径(`src/victim.js`、`.claude/other.json`)一律拒。备份改由 `resolveManagedBackupPath` 判定:必须是受管 settings 的**同目录兄弟** ∧ 文件名精确匹配 `settings\.json\.attp-backup-\d+-[0-9a-f]{12}` ∧ **自身不是链接**。manifest 增 `kind`/`schemaVersion`,`sha256` 须 `[0-9a-f]{64}`,`existed:false` 时 `backupPath`/`sha256` 必须为 `null`。新增破坏性回归:manifest 指向 `src/important.js` → restore 抛 `only … is managed` 且文件字节不变;伪装文件 `src/important.attp-backup-data` → discard 抛且文件仍在;另加 sha256 形状、缺 `kind`/`schemaVersion` 两例 |
| R7 P1-1 | symlink 用例用固定串断言备份泄漏,查不出真实随机名 | 改为**扫描目录**:`readdirSync(dirname).filter(n => n.startsWith(basename + '.attp-backup-'))` 必须为空 |
| R7 P1-2 | 备份中途失败遗留孤儿备份文件(含用户 settings 原文) | `backupSettings` 内 `abortBackup(err)`:manifest **提交前**的任何失败(写入、回读不一致、manifest 写失败)都先删掉半成品备份;清理也失败时把孤儿路径写进错误信息供人工处理。新增两例:校验失败与 manifest 写失败后目录中均无 `*.attp-backup-*` |

| R8 P0-1 | `pathEntryInfo` 调用了未注册的 `fsOps.lstatSync` → 守卫对**健康路径**也抛 `TypeError`,被外层 catch 成 deny(断链堵住了,正常写入也全堵住) | `DEFAULT_FS_OPS` 补 `lstatSync: fs.lstatSync`;Task 2 增 `pathEntryInfo` **直接单测**(真实文件 → `{exists:true,symbolicLink:false}`;缺失 → `{exists:false,...}`;断链 → `symbolicLink:true` 且先断言 `existsSync` 为 false;注入 `EACCES` → 必须抛;`__setFsOps({})` 后默认值仍完整),不再等 Task 7 间接暴露。**本轮已实跑验证**:抽出计划中的 `takeover-receipt.js` 模块块 + 真实 `runtime.js` 跑上述全部断言,含断链用例,全部通过 |
| R8 P1-1 | 两个断链回归用例可能在 POSIX 上无声跳过 | 改为 `if (!made) { assert.strictEqual(process.platform, 'win32', ...); console.log('⏭️ …') } else { … }` —— POSIX 必跑,仅 win32 无权限时允许显式跳过(与既有 symlink 用例同一范式) |
| R8 P1-2 | backup 的"自身不是链接"判定仍用 `existsSync`,漏断链 | 改用 `lstatSync`(ENOENT 以外异常抛出)先判 `isSymbolicLink()`,再对真实存在项做 realpath 自反校验;新增用例:**精确命名但断链**的 backup(`existsSync` 为 false)仍被 `is a link` 拒绝 |
| R8 P1-3 | manifest 半写残留会同时挡住下次 backup 与 rollback/discard | 新增 `commitManifest()`:写唯一临时文件 → **回读并解析校验**四个承重字段 → `rename` 原子提交;任何失败清理临时文件并抛 `not committed`;`abortBackup` 另清理未提交备份,并在意外出现最终 manifest 时把路径写进错误信息。新增用例:manifest 写失败与**半写(截断)**两种情况下,备份与 manifest 产物**均为空**、settings 字节不变,且随后一次干净备份确实不再被挡 |

| R9 P0-1 | 双失败测试的 `renameSync` 全局抛,把 `commitManifest` 也打断 → `backupSettings` 先失败,installer 根本没跑,`AggregateError` 分支测不到 | 两个 seam 均改为**按目的地限定**:`renameSync(src,dst)` 只在 `dst === txSettings` 时抛,manifest 的 rename 放行;`writeFileSync` 只在写回 settings 本体时抛。并在注释里写死"必须按目的地限定",避免执行者再写成全局故障 |
| R9 P0-2 | `commitManifest` 回读只比四字段,漏 `kind`/`schemaVersion` → 可能"提交成功"却发布出恢复路径拒收的 manifest | 抽出**共享** `validateBackupManifestShape(raw)`,写入侧(`commitManifest` 回读后)与消费侧(`readBackupManifest`)**共用同一判定**;另加 `manifestFingerprint()` 对**六个**承重字段做规范化投影比较,不再手写字段清单。新增两例:合法 JSON 但 `kind`/`schemaVersion` 被改写时必须**不提交**、不留 final/temp manifest、不留备份 |
| R9 P1-1 | 临时 manifest 清理失败被静默吞掉 | 清理失败时抛 `AggregateError([commitError, cleanupError])`,message 明确给出孤儿临时 manifest 路径 |
| R9 P1-2 | 缺 ordered publication 最后一步(rename)的独立回归 | 新增 destination-scoped 注入:temp 写成功 + 回读通过 + **rename 失败** → 无 final manifest、无 temp manifest、无备份、settings 字节不变,且随后一次干净备份仍成功 |

| R10 P1-1 | `abortBackup` 把 `commitManifest` 的 `AggregateError` 压成普通 Error,公开 API `backupSettings` 丢失 `errors[]` | `abortBackup` 改为**保留错误结构**:入参是 `AggregateError` 则展开其 `errors`,备份清理失败再追加一条;`errors.length > 1` 或入参本身是 `AggregateError` → 抛 `AggregateError`,否则 `new Error(msg, { cause: err })`。孤儿路径改为"may remain at …"如实措辞。新增公开边界回归:manifest 回读失败 + temp unlink 失败 → `backupSettings` 抛 `AggregateError`、`errors[0]` 是 commit 失败、`errors[1]` 是清理失败、message 含 temp manifest 路径、settings 字节不变、备份本身仍被清掉 |
| R10 P1-2 | installer 的临时 settings 在 rename 失败后永久残留(含合并后完整配置,且不在 gitignore 覆盖内) | `installTakeoverHooks` 的写入改为**带清理的有序提交**:temp 名加随机后缀,`try { write; rename } catch { 清理 temp }`;清理也失败 → 抛 `AggregateError([installError, cleanupError])` 并报告孤儿路径;**rename 成功后不再有可失败的业务操作**。`.gitignore` 另加 `.claude/settings.json.evo-tmp-*` 作纵深防御。新增两例(rename 失败 → temp 不存在、原字节不变;rename + unlink 双失败 → `AggregateError` 且 message 含 temp 路径),并在既有 install+rollback 双失败用例中补断言:除**故意保留**的 backup/manifest 外,不得残留 `.evo-tmp-*` |

## 附:实现期须复核的开放点(非阻断)

- ~~`formatBootstrapReport` 其他调用点~~ **已实测确认无**:`formatBootstrapReport`(定义 282、调用 475)、`runBootstrapCommand`(469、513)、`buildTakeoverRecall`(474)全部只在 `templates/cli/memory.js` 内部;MCP 的 `evo_active_context` 走 `handleActiveContext()` 独立路径。替换是**单点改动**,无需额外适配。
- `collectSessionTakeoverContextFull` 每次 SessionStart 跑 `verify({silent:true})`;若 dogfood 实测拖慢会话启动,可在 session 路径加缓存(不影响 refresh —— 后者不调 collector)。
- `SessionStart(compact)` / `CwdChanged`:probe 列为待实测优化器,阶段 2 后以 echo-harness 验证再决定纳管。
- **宿主 hook shell 的确切身份**:计划只依赖"命令形状正确 + adapter 可执行 + dogfood 实证",不依赖对宿主 shell 的猜测。若 Step 9 dogfood 显示宿主行为与本机诊断 probe 不一致,把实测结论补进 `docs/validation/attp-cc-capability-probe.md`,再决定是否把 `resolveHostShell` 的候选顺序调整为实测结果。
- nurture 分发:子仓获取 hook 需在 nurture 侧调 `mem takeover install`;本 MVP 只保证 installer 幂等可用。
