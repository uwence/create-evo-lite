# Agent Takeover Trigger Protocol — 设计文档(R2)

- 议题:backlog `[agent-code-routing]`(4a.x P2 final debt)。谱系:S9b CodePLC dogfood
  实证 —— 干净子仓、零竞争、裸 prompt 下 Agent 自发触发治理面 = **失败**;裁定 P1b
  将"Agent 裸指令路由"定为独立债,Wiki(4b-1)服务人、不能替代 Agent routing。
- 状态:R2(design R1 外部复审 CHANGES REQUIRED 已折入,4×P0 + 5×P1 + 2 清理)。待 R2 复审。
- 宿主范围:**仅 Claude Code**(MVP);协议本身 host-agnostic。
- 前置证据:`docs/validation/attp-cc-capability-probe.md`(装机 2.1.218,PROTOCOL-SUPPORTED)。
- 关联:`[zvec-06-upgrade]`(无关);a177 lock 协调(receipt 授权边界/发布时序/失效事务
  按 a177 同级契约要求书写)。

---

## 0. R1 复审裁定的落点(逐条)

| 编号 | R1 问题 | R2 落点 |
|---|---|---|
| P0-1 | degraded 未真正撤销已存在 valid receipt | §4 receipt 增**硬字段** `state`(committed/invalid);守卫只认 `state==="committed"`;降级 = 原子覆盖 tombstone(§5)+ 失败回退 unlink + 双失败大声降级 |
| P0-2 | builder 输入契约不足 / 破坏 host-agnostic 纯度 | §3 改**显式 context** 签名;§9 模块边界:receipt=IO,payload=纯函数,adapter=归一化;`prompt` MVP 删除 |
| P0-3 | receipt 先于注入发布 = 假授权 | §5 定义**提交事务**:先序列化+写出注入,再原子发布 committed receipt;receipt 语义收紧 |
| P0-4 | 恢复命令在 Windows 不保证可执行 | §7 adapter 按平台生成 `.\.evo-lite\mem.cmd` / `./.evo-lite/mem`,双平台测试 |
| P1-1 | "UserPromptSubmit 是最低兼容层"不成立 | §6 事件层级更正:基线 = SessionStart+UserPromptSubmit(+PreToolUse);无 SessionStart → PARK |
| P1-2 | receipt 文件名/projectRoot 未跨平台规范化 | §4 文件名 = `sha256(host\0sessionId)`;`canonicalProjectRoot()` 单一实现 |
| P1-3 | refresh 缺"无重型传递依赖"约束 | §8 不变量 6:refresh call graph 禁载 memory.service/db/memory-index/zvec |
| P1-4 | settings.json 与 installer 所有权不清 | §9 canonical = managed hook fragment + 幂等 deep-merge installer,禁整文件覆盖 |
| P1-5 | 1 KiB 计量对象与裁剪优先级不明 | §8 不变量 1 明确量 additionalContext UTF-8 串 + 确定性裁剪顺序 + code-point 边界 |
| 清理1 | 健康 capsule 的 `refresh` 与"只反射"冲突 | §3 健康态删 `refresh`;仅 stale/degraded 带 `action` |
| 清理2 | probe 应先于 plan | 已完成:`docs/validation/attp-cc-capability-probe.md` |
| R1自纠 | R1 曾断言"CwdChanged 非原生事件" | 更正:CwdChanged/PostCompact 文档存在,按"版本能力探测"处理(§6) |

---

## 1. 问题诊断:工具已在,缺的是确定性触发

Evo-Lite 已具备完整治理设施:`mem bootstrap`(聚合 takeover 报告)、`mem code`
(explore/impact)、治理 MCP 三件套、`.agents/rules`、`.evo-lite/active_context.md`、
CLAUDE.md Bootstrap 指令。**这些工具一旦被引导调用都有效**(S9b:引导后六件套用满)。

但 S9b 实测:**裸 prompt 下自发触发 = 失败**。一句 "fix this bug" 不会被 Agent 读成
"接管本项目":裸指令会话零 CLI/MCP;连 `/evo` 前置会话都只摸到 `mem portfolio/spec status`,
仍未触发 `mem code`;全体未自发触发 `mem code`。现有触发面全是 opt-in(用户敲 slash 或
Agent 主动识别 takeover 框架),裸开发指令两者都不满足。CLAUDE.md 的 Bootstrap 指令**已存在且
已被证明不触发**。

**结论:不是"缺命令",是"缺触发"。** 议题重定义为:

> **Agent Takeover Trigger Protocol —— 把项目接管从"模型自由裁量"提升为"宿主生命周期保证"。**

### 现有代码边界(设计据此,非从零造)

- `runBootstrapCommand`(`templates/cli/memory.js:469`)已组装 `{ context, sessionstart,
  verify, takeoverRecall }` + `sessionstart` 子对象 + `bootstrap-pending` 状态 + `--json`;
  `memoryService.buildTakeoverRecall(context, verify)` 已存在。→ layer-1 是"稳定成命名 builder
  + 加紧凑投影/预算 + 显式 context",不是造新系统。
- `templates/cli/hooks.js` 仍是纯 Git `post-commit` 管理器(27/27)→ 生命周期 adapter 独立新建。
- **注意**(P1-3 依据):`memory.js:2-3` 顶部即 `require('./memory.service')` +
  `require('./db').initDB`,eager 加载 DB。refresh 路径**不得**经 memory.js。
- `memoryService.inspectHookLifecycle(event)` 已存在,生命周期感知有前置件。

---

## 2. 架构总览(C+):三层触发协议

```text
第一层  host-agnostic canonical payload(纯函数 builder)
        buildTakeoverPayload({ mode, context, budget }) —— 单一真相
        mem bootstrap 是人类展示器 / adapter 是宿主适配器 / 二者消费同一 payload
        payload builder 不做 IO、不读环境、不读 hook input;禁止 adapter 重拼治理语义

第二层  生命周期感知的确定性注入(Claude Code adapter)
        SessionStart      → 完整 payload additionalContext 注入 + 提交事务写 committed receipt
        UserPromptSubmit  → 无条件注入极小 capsule(additionalContext)+ reconcile receipt
        可选优化(probe-gated)→ CwdChanged / PostCompact / SessionStart(compact)

第三层  变更前 fail-closed / 只读 fail-open 守卫(PreToolUse)
        Edit/Write 无 committed receipt → permissionDecision:"deny" + 平台恢复命令
        Read/Glob/Grep 恒 allow;Bash 排除出 MVP

降级层  无 Hook 宿主 → 静态规则 fallback(CLAUDE.md / .agents),尽力而为、不确定
```

对齐 CLAUDE.md 护栏:宿主文件只是适配层,`.agents`/`.evo-lite` 才是真相源;hook 是触发适配器,不替代真相源。

---

## 3. host-agnostic canonical payload(纯函数 builder)

**builder 是纯函数**:只接受已归一化的 `context`,返回 payload / capsule;不做 IO、不读
`process.env`、不读 hook input(P0-2)。所有 IO 与 hook 输入归一化由 adapter/receipt 层承担。

```
buildTakeoverPayload({ mode, context, budget }) -> TakeoverPayload | Capsule

  mode:    "session"  完整 payload(SessionStart / 显式恢复;跑 verify/recall)
           "refresh"  轻量投影(仅由已归一化 context 生成,不跑 verify/recall/DB;
                      capsule 即由此模式产出 —— 保证 capsule 亦经单一 builder)
  context: {
    host,          // "claude-code"
    sessionId,     // 来自 hook input.session_id
    projectRoot,   // canonicalProjectRoot()(§4)
    sourceEvent,   // "SessionStart:startup" | "UserPromptSubmit" | "manual-recovery" ...
    focus,         // 已读出的 focus 文本(receipt/adapter 层读,builder 不读文件)
    receiptState   // "committed" | "invalid" | "missing"(receipt 层判定后传入)
  }
  budget:  additionalContext UTF-8 字节预算(capsule 强制 ≤ 1 KiB,§8 不变量 1)

  // mode:"session" 额外由 adapter 传入已读取的 verify/recall 结果(lazy,见 §8 不变量 6)
```

`prompt` 在 MVP **删除**(未使用);若未来重引入,必须明确不进 receipt、不写日志、不持久化。

### TakeoverPayload schema(完整,`mode:"session"`)

```jsonc
{
  "schemaVersion": 1,
  "host": "claude-code",
  "generatedAt": "<ISO8601>",
  "sourceEvent": "SessionStart:startup" | "manual-recovery" | ...,
  "project":   { "name": "create-evo-lite", "root": "<canonical abs path>" },
  "focus":     { "text": "<focus 行>", "hash": "<sha>", "updatedAt": "<ISO8601>" },
  "active":    { "plan": { "id","status","progress" } | null, "spec": { "id","status" } | null },
  "rules":     { "dir": ".agents/rules/", "required": ["evo-lite","execution-model", ...] },
  "risks":     ["..."],
  "nextAction":"<最小下一步>",
  "freshness": { "ahead":0, "behind":0, "headSha":"<sha>" },
  "verify":    { "status":"...", ... },   // 仅 mode:"session"(lazy 依赖)
  "recall":    [ ... ]                      // 仅 mode:"session"(lazy 依赖)
}
```

P1 语义正确性:payload 至少含 project identity、current focus、active plan/spec、required
rules、risks/warnings、recommended next action、payload freshness/version。

### capsule 投影(`UserPromptSubmit` 每轮,≤ 1 KiB;状态反射,不含行为指令)

```jsonc
// 稳态(健康态删除 refresh 字段,清理1)
{ "evoLite":"takeover-active", "project":"create-evo-lite",
  "focus":"<focus 行>", "focusHash":"<sha>", "receipt":"valid" }

// focus 已刷新
{ "evoLite":"takeover-refreshed", "project":"create-evo-lite",
  "focus":"<新 focus>", "focusHash":"<sha>", "receipt":"valid" }

// stale / degraded:升格,带可执行 action(平台正确,§7)
{ "evoLite":"takeover-stale", "project":"create-evo-lite",
  "focus":"<focus 或 unknown>", "focusHash":"<sha 或 null>", "receipt":"invalid",
  "action":"<平台 wrapper> bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json" }
```

---

## 4. session-bound receipt schema

receipt 证明:**adapter 已成功构建、校验,并向经 capability probe 验证的 hook 输出通道提交
takeover response(注入已写出)**(§5 提交事务)。它**不**证明模型"理解"上下文,也不证明宿主
绝对未丢弃输出(后者属 Claude Code 宿主契约,由 probe + S9b 验证)。receipt 非安全凭证,而是防
协作型 Agent 在无接管上下文时误操作的治理证明。

```jsonc
{
  // ── 硬有效性字段(任一不符 → invalid,参与 fail-closed)──
  "schemaVersion": 1,
  "host": "claude-code",
  "sessionId": "<raw session id>",
  "projectRoot": "<canonical abs path>",
  "state": "committed" | "invalid",        // P0-1:守卫只接受 committed

  // ── 软字段(刷新 / 诊断,绝不参与 fail-closed)──
  "focusHash": "<sha>",
  "payloadHash": "<sha>",
  "generatedAt": "<ISO8601>",
  "sourceEvent": "SessionStart:startup" | "manual-recovery" | ...,
  "reason": "<仅 state=invalid 时:active-context-unreadable | bad-payload | ...>"
}
```

**硬有效性 = `state==="committed"` 且 `schemaVersion`+`host`+`sessionId`+`projectRoot` 全匹配
当前上下文,且文件存在且可解析。** 缺失 / 损坏 / 解析失败 / `state!=="committed"` / 任一硬字段
不符 → **一律 invalid**。`focusHash`/`payloadHash`/`generatedAt`/`sourceEvent`/`reason` 仅刷新与诊断。

### 文件名与路径规范化(P1-2)

```text
receipt 文件名 = sha256(host + "\0" + sessionId) + ".json"   # 处理 / \ : 与超长
存放:.evo-lite/generated/takeover/receipts/claude-code/<hash>.json
JSON 内仍存原始 sessionId。
```

`projectRoot` 一律由单一 `canonicalProjectRoot()` 生成后比较,adapter / CLI recovery / guard
**共用同一实现**,不各写一套:

```text
canonicalProjectRoot() = discover workspace root → path.resolve → realpath/native normalization
                         → Windows 一致的盘符大小写与分隔符
```

### 写入与存放(不变量 3)

- **原子发布**:temp file + rename;committed receipt 与 invalid tombstone 都经此原语。
- 属生成状态,**gitignore,不入模板真相源,不提交**。
- `SessionEnd` best-effort 清理;历史 receipt TTL 仅 GC,**不作当前 receipt 的硬有效性条件**。

---

## 5. 注入 — receipt — 守卫状态机(含提交事务与失效事务)

### SessionStart / 显式恢复:提交事务(P0-3)

**注入必须先于 receipt 发布**,否则 receipt 存在但内容从未送达宿主 = 假授权:

```text
1. 归一化 context(host/sessionId/projectRoot/sourceEvent/focus/receiptState)
2. buildTakeoverPayload({ mode:"session", context })
3. schema 校验 payload
4. 构建并【完整序列化】Claude hook response(hookSpecificOutput.additionalContext)
5. 准备 committed receipt 临时文件(写 temp,【不 rename】)
6. 【同步写出】hook response 到 stdout —— 真正的注入
7. 【原子发布】committed receipt(rename temp → 最终)
8. 无其他可失败操作 → exit 0

任一步在 7 之前失败:
  - 不存在 committed receipt;hook 非零退出;
  - 最坏 = 模型或收到或未收到上下文,但 Edit/Write 暂被守卫挡住 —— 安全失败。
```

宿主健壮性(probe):v2.1.202+ 类型错字段被静默丢弃 → step 4 自校验保证类型正确;step 6
成功写出仍不保证宿主"摄入"(宿主契约边界,receipt 只证"已提交发出",由 probe + S9b 验)。

### 每次 UserPromptSubmit:emit + reconcile

```text
职责一 emit capsule(无条件):
  buildTakeoverPayload({ mode:"refresh", context }) —— 只读 receipt + focus anchor(§8 不变量 6)
  → 投影为 ≤1 KiB capsule → additionalContext 无条件注入(capsule 经单一 builder)

职责二 reconcile receipt(条件):
  projectRoot 不匹配 → committed receipt 视为 invalid(禁跨项目继承;身份不符即失效,无需写)
  focusHash 漂移     → receipt 仍 committed,原子刷新 focusHash(不阻断)
  focus 无变化       → 不重写 receipt
  active_context 不可读 → 降级失效事务(见下)
```

### 降级失效事务(P0-1:degraded 必须真正撤销 committed receipt)

`active_context` 不可读 / payload 损坏时,**不得静默输出健康 capsule,且必须持久失效已存在的
committed receipt**(否则硬字段仍匹配、守卫仍放行):

```text
1. 尝试【原子覆盖】receipt 为 tombstone { ...硬身份, state:"invalid", reason }
2. 覆盖失败 → 回退【unlink】receipt(missing 亦被守卫判 invalid)
3. 覆盖与 unlink 双失败 → 输出 degraded capsule + systemMessage 大声报错 + 非零退出
     (此为已记录残留:同一 FS 条件本会令初始 committed 发布也失败;不静默假装正常)
4. emit degraded capsule(带平台恢复 action)
```

`bad-payload` 与 `active-context-unreadable` **共用**此失效规则。

### PreToolUse 守卫(阶段 2)

```text
Read / Glob / Grep           → permissionDecision:"allow"(恒放行)
Edit / Write                 → committed receipt 有效则 allow;无效则
                               permissionDecision:"deny" + permissionDecisionReason=<平台恢复命令>
NotebookEdit / 其他写工具     → 仅当 capability probe 证明该工具名存在时纳入 matcher
Bash                         → MVP 全 allow(含恢复命令执行路径)
```

**闭环保证:守卫放行 Bash + deny reason 展示给 Claude → 恢复命令(一条 Bash 调用)永远可执行
→ 坏 hook 永不硬砖化会话。**

### capsule 四态 × receipt 对照

| 状态 | Capsule `evoLite` | Receipt |
|---|---|---|
| 稳态 | `takeover-active` | committed |
| focus 漂移并已刷新 | `takeover-refreshed` | committed |
| receipt 缺失 / session 不匹配 | `takeover-stale` | invalid |
| projectRoot 不匹配 | `takeover-stale` | invalid |
| active_context 无法读取 | `takeover-degraded` | invalid(tombstone 或 unlink) |

**focus 漂移绝不使 receipt invalid** —— 它表示项目合法推进,而非 takeover 从未发生。

---

## 6. Claude Code capability probe 与事件层级

probe 已完成:`docs/validation/attp-cc-capability-probe.md`(装机 2.1.218,PROTOCOL-SUPPORTED)。
承重结论:`SessionStart`+`UserPromptSubmit`+`PreToolUse` 经验确认;注入 = `additionalContext`;
阻断 = `permissionDecision:"deny"`(deny reason 展示给 Claude);输入含 `session_id`/`cwd`/
`tool_name`。CwdChanged/PostCompact/SessionStart(compact) 文档存在,按**版本能力**探测,非基线。

### 事件层级(P1-1 更正)

```text
阶段 1 最小必需:  SessionStart + UserPromptSubmit
阶段 2 最小必需:  SessionStart + UserPromptSubmit + PreToolUse
可选优化(probe-gated):
  CwdChanged                 → 存在则:立即失效旧 project receipt + 注入新项目 capsule
  PostCompact / SessionStart(compact) → 存在则:压缩后重注入完整 payload

capability probe 证明装机版无基础 SessionStart → 判 UNSUPPORTED / PARK
（不宣称 UserPromptSubmit 单独可从零建立 takeover:完整 payload 与 committed receipt 仅由
 SessionStart 或显式恢复创建;UserPromptSubmit 无 receipt 时只 emit stale capsule + 恢复 action）
```

**为什么 capsule 每轮无条件注入(正式理由,保留):上下文丢失对 hook 状态不可观测。** 压缩后
receipt 仍 committed、projectRoot 未变、focus 未变 —— 条件注入的所有触发条件均不满足,却正是
模型刚丢治理上下文之时;丢失发生在模型内部,对 hook 状态比较不可见。在"不能依赖 compact 事件"
的基线下,唯一能压缩后重新播种的策略是**无条件注入**。这与"CwdChanged/PostCompact 是优化器"
一致:优化器存在时提前重注入,不存在时 UserPromptSubmit 每轮兜底。

---

## 7. 守卫粒度与恢复(阶段 2)

- **覆盖必须**:Edit / Write。挡住主文件编辑路径即封住 Agent 主变更路径。
- **条件纳入**:NotebookEdit / 其他 Notebook 写工具 —— 仅 probe 证明该工具名在装机版暴露才纳入。
- **完全排除**:Bash mutation。Bash command 分类会重引入整套信任边界(a177 command-verifier
  之战),不进第一版关键路径。MVP 不追求虚假的"完全禁止变更",只可靠封住主编辑路径。
- **恢复命令按平台生成(P0-4)**:adapter 依当前平台产出**完整可复制执行**命令:

```text
win32:  .\.evo-lite\mem.cmd bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json
posix:  ./.evo-lite/mem     bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json
```

  - sessionId 安全引用;deny reason 内命令逐字可跑;
  - PreToolUse deny 时 adapter 掌握 hook input 的 `session_id`/`cwd` → 填入真实值;
  - 测试同覆盖 win32 与 POSIX 命令串。
  - 流程:Edit 被 deny → reason 给精确恢复命令 → Agent 经 Bash 执行 → canonical builder 生成
    payload + 提交事务写匹配 sessionId/projectRoot 的 committed receipt → 再次 Edit 放行。

---

## 8. 六条不变量

1. **capsule 预算硬约束**:量**最终注入的 capsule additionalContext UTF-8 字节数**,硬上限
   **1 KiB**(另单测完整 hook envelope 大小,文档无宿主硬限)。确定性裁剪顺序:
   永不删 `evoLite`/`receipt`/`project`/`focusHash`;优先裁 `focus` 文本(截断带
   `focusHash`+`truncated:true`);异常态尽量保 `reason`/`action`;最小异常 capsule 仍超限 →
   输出固定短错误码 + 平台恢复命令。截断按 **Unicode code point 边界**,绝不产出无效 UTF-8/JSON。
2. **capsule 是状态反射,不是行为指令**:健康 capsule 只陈述(takeover 已激活/当前项目/
   当前 focus/receipt 状态),**健康态不含 `action`/`refresh`**;仅异常态加 `action`。降低横幅失明。
3. **receipt 原子写入且不入 Git**:temp+rename;`.evo-lite/generated/takeover/receipts/`;
   gitignore;非模板真相源;TTL 仅 GC,不作硬有效性条件。
4. **receipt 语义准确**:证明"adapter 已构建、校验并写出 takeover response",不证明模型"理解",
   不证明宿主未丢输出(后者由 probe + S9b 验)。不升级为密码学挑战系统。
5. **任何失败必须显式降级**:无法读 focus / payload 损坏时不得静默输出健康 capsule,须执行
   §5 降级失效事务 + 输出 `takeover-degraded` capsule(带平台恢复 action)。
6. **refresh 无重型传递依赖**:refresh call graph **不得加载** `memory.service` / `db` /
   memory-index / zvec;session-only 依赖(verify/recall/buildTakeoverRecall)必须 lazy require
   或拆入独立 session-only 模块。测试令这些模块加载即抛错,证明 refresh capsule 仍能生成;
   probe 记录每轮 hook 实测延迟以定性能门槛。

---

## 9. 组件与文件结构(严格模块边界,P0-2 / P1-3 / P1-4)

- **Create `templates/cli/takeover-payload.js`** —— **纯函数** `buildTakeoverPayload({mode,context,budget})`
  + capsule 投影 + 1 KiB 预算/裁剪。**无 IO、无 env、无 hook input**;session-only 依赖 lazy require。
- **Create `templates/cli/takeover-receipt.js`** —— receipt IO、schema 校验、硬/软有效性、
  `reconcile(...)`、提交事务发布、tombstone/unlink 失效事务、`canonicalProjectRoot()`。
- **Create `templates/cli/takeover-adapter.js`** —— Claude Code 生命周期 hook 处理器
  (SessionStart / UserPromptSubmit / PreToolUse 入口)+ capability probe 助手;把 hook input
  (stdin JSON:`session_id`/`cwd`/`tool_name`)**归一化为 context**;调 receipt(IO)+ payload(纯);
  **不重拼治理语义**;按平台生成恢复命令。
- **Modify `templates/cli/memory.js`** —— `mem bootstrap` 增 `--receipt --host --session-id
  --source` 恢复标志(经提交事务:emit payload 同时写 committed receipt);`bootstrap` 仍是人类展示器。
- **Claude Code hook 配置(P1-4:managed fragment + 幂等 deep-merge)** —— canonical =
  **Evo-Lite 托管 hook fragment**;独立于 hooks.js(git)的 lifecycle-adapter installer 做
  **结构化幂等 deep-merge** 进项目 `.claude/settings.json`:保留所有未知 settings 字段与第三方
  hooks;status/diff 只比较 Evo-Lite 托管的 hook identity;**禁整文件覆盖**子仓 settings。
  (本仓现有 `.claude/settings.local.json`、无 `.claude/settings.json`,installer 创建/合并后者。)
- **Modify `templates/cli/template-manifest.js`** —— 注册三个新文件(core-cli)。
- **Modify `.gitignore`** —— 忽略 `.evo-lite/generated/takeover/receipts/`。
- **Modify `templates/cli/test/governance.js`** —— T-takeover-*(§11)。

**分发**(母仓 = 模板):新文件落 `templates/cli/**` → `mem sync-runtime` 生成 `.evo-lite/cli/**`
镜像(**不手改镜像**,镜像 `git add`)→ hive nurture 分发子仓;installer 对子仓 settings 亦 deep-merge。
a177 教训:子仓分批落盘期间引擎优雅降级、再 sync 收敛;refused 时先 checkpoint 再推。

### 已知边界(非本 MVP 修复,如实记录)

- hook 配置存在但被本地设置禁用:probe/verify 可检测配置在位,但**本地禁用是宿主-用户选择,
  仓库无法覆盖** → 降级静态 fallback;若 PreToolUse 亦被禁用,守卫失效。属宿主契约边界。
- SessionStart(compact) / CwdChanged 在装机 2.1.218 的实际触发行为:probe 列为待实测优化器,
  基线不依赖(§6)。
- 非 Claude Code 宿主:仅静态规则 fallback,不实现生命周期 adapter(YAGNI)。

---

## 10. 两阶段 / 两独立复审门

### 阶段 1 复审门 —— 确定性接管(P0 determinism)

```text
裸 prompt(无 /evo)下,首次模型推理前已存在有效 takeover payload(经 SessionStart 注入)
SessionStart 经提交事务写入 committed receipt
UserPromptSubmit 每轮注入 routing capsule
cwd/project 变化不复用旧 receipt
显式 CLI 能恢复 receipt
S9b:从"普通仓库探索"转为"按治理 focus 接管"
```

阶段 1 后具独立产品价值,但**项目尚不能 CLOSED**。

### 阶段 2 复审门 —— 不可静默绕过(P0 no-silent-bypass)

```text
无 committed receipt:  Read/Glob/Grep allow;Edit/Write deny;Bash allow;deny reason 含可执行恢复命令
坏 hook / 坏 payload:  提交事务不产生 committed receipt;Agent 可自行恢复;恢复后 Edit/Write 放行
degraded(active_context 不可读): 已存在 committed receipt 被 tombstone/unlink 失效;Edit/Write deny
focus 变化:            不阻断;下一 prompt 自动刷新(仍 committed)
projectRoot 变化:      旧 receipt 立即视为 invalid
```

**两个 P0 都完成后,项目方可交付关闭。**

---

## 11. 验收契约

- **P0 确定性**(阶段 1):干净子仓、裸 prompt、无 `/evo`,首次模型推理前已注入有效 payload。
- **P0 不可静默降级**(阶段 2):故障注入 —— 破坏 bootstrap / payload:提交事务不产生 committed
  receipt;模型看到明确错误;只读探索继续;生产修改被 deny 且 reason 可执行。
- **P0 degraded 真失效**:active_context 不可读 → 已存在 committed receipt 被 tombstone/unlink,
  Edit/Write deny(不得因硬身份仍匹配而放行)。
- **P1 语义正确**:注入内容来自纯函数 builder,含 §3 全字段。
- **P2 行为效果**(S9b 重跑):Agent 不再把项目当普通仓库;首轮明确使用 injected focus/routing。
  **效果验证,不作唯一确定性来源。**
- **capability probe**:事件矩阵已归档(§6 / probe 文档);实现阶段用 echo-hook harness 落实
  SessionStart(compact)/CwdChanged 装机版实际行为 + 每轮 hook 延迟。
- **回归**:三新文件入 template-manifest;`node templates/cli/test.js all` 与镜像侧 all EXIT 0;
  `mem sync-runtime` 二次运行 copied: 0。

### 测试骨架(T-takeover-*)

- `T-takeover-payload`:纯 builder 完整字段(无 IO)+ capsule ≤1 KiB + 超限按 code-point 截断带
  focusHash/truncated + 裁剪优先级。
- `T-takeover-receipt`:提交事务(注入序列化失败 → 无 committed receipt);硬有效性
  (state≠committed / schemaVersion / host / sessionId / projectRoot 任一不符 / 缺失 / 损坏 → invalid);
  文件名 = sha256(host\0sessionId);`canonicalProjectRoot()` 跨平台(盘符大小写 / 分隔符 / realpath)。
- `T-takeover-reconcile`:focusHash 漂移 → 仍 committed + 静默刷新、不阻断;projectRoot 不符 → invalid。
- `T-takeover-degraded`:active_context 不可读 → tombstone/unlink 失效 + degraded capsule + 不静默健康;
  覆盖失败回退 unlink。
- `T-takeover-capsule-states`:四态映射;健康态无 action/refresh。
- `T-takeover-guard`(阶段 2):Edit/Write deny on invalid;Read/Glob/Grep allow;Bash allow;
  deny reason 含真实 session-id 的平台正确恢复命令(win32 + posix 双测)。
- `T-takeover-recovery`:恢复命令经提交事务写匹配 committed receipt → 解锁。
- `T-takeover-refresh-isolation`(不变量 6):memory.service/db/memory-index/zvec 加载即抛错时,
  refresh capsule 仍能生成。
- `T-takeover-installer`(P1-4):deep-merge 保留未知字段 + 第三方 hooks;幂等(二次 install 无新增);
  status/diff 只比 Evo-Lite 托管 identity;不整文件覆盖。

---

## 12. 最终边界

```text
Agent Takeover Trigger Protocol MVP
  宿主:      Claude Code only(装机 2.1.218,PROTOCOL-SUPPORTED)
  结构:      同一项目,两阶段、两个独立复审门
  主触发:    SessionStart 完整 payload 注入(提交事务)+ 可选事件优化(probe-gated)
  兜底触发:  UserPromptSubmit 每轮无条件极小 capsule(≤1 KiB additionalContext,状态反射)
  真相源:    纯函数 builder buildTakeoverPayload({mode,context,budget})
  receipt:   硬字段 state/host/sessionId/projectRoot;committed 才放行;degraded 真失效
  守卫:      Edit/Write deny-on-invalid;Read/Glob/Grep allow;Bash 排除
  恢复:      平台正确 mem 命令写 session-bound committed receipt(Bash 放行保证可自助)
  无 Hook 宿主: 静态规则 fallback,尽力而为
  验收:      P0 确定性 + P0 不可静默绕过 + P0 degraded 真失效 + P1 语义 + P2 行为(S9b)+ 故障注入
```
