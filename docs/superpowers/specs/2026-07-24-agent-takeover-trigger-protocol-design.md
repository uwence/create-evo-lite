# Agent Takeover Trigger Protocol — 设计文档

- 议题:backlog `[agent-code-routing]`(4a.x P2 final debt)。谱系:S9b CodePLC dogfood
  实证 —— 干净子仓、零竞争、裸 prompt 下 Agent 自发触发治理面 = **失败**;裁定 P1b
  将"Agent 裸指令路由"定为独立债,Wiki(4b-1)服务人、不能替代 Agent routing。
- 状态:DRAFT(brainstorming 收敛,待外部 spec review)。
- 宿主范围:**仅 Claude Code**(MVP);协议本身 host-agnostic。
- 关联:`[zvec-06-upgrade]`(无关);a177 lock 协调(借鉴其"任何不确定就拒动"的默认姿态)。

---

## 1. 问题诊断:工具已在,缺的是确定性触发

Evo-Lite 已具备完整治理设施:`mem bootstrap`(聚合 takeover 报告)、`mem code`
(explore/impact)、治理 MCP 三件套、`.agents/rules`、`.evo-lite/active_context.md`、
CLAUDE.md Bootstrap 指令。**这些工具一旦被引导调用都有效**(S9b:引导后六件套用满、
治理链有效)。

但 S9b 实测:**裸 prompt 下自发触发 = 失败**。一句 "fix this bug" 不会被 Agent 读成
"接管本项目",于是:

- 裸指令会话零 CLI/MCP,像普通仓库一样"列目录 + 读文件";
- 连 `/evo` 前置的会话都只摸到 `mem portfolio/spec status`,仍未触发 `mem code`;
- 全体未自发触发 `mem code`。

现有触发面全部是 **opt-in**:要么用户显式敲 `/evo` slash 命令,要么 Agent 主动把裸
prompt 识别成"takeover 框架"。裸开发指令两者都不满足。CLAUDE.md 里那条 Bootstrap 指令
**已存在且已被证明不触发** —— 继续加强措辞、赌模型这次会读,是最弱的杠杆。

**结论:这不是"缺命令",是"缺触发"。** 议题重新定义为:

> **Agent Takeover Trigger Protocol —— 把项目接管从"模型自由裁量"提升为"宿主生命周期保证"。**

### 现有代码边界(设计据此,非从零造)

- `runBootstrapCommand`(`templates/cli/memory.js:469`)已组装 payload
  `{ context, sessionstart, verify, takeoverRecall }`,已有 `sessionstart` 子对象 +
  `bootstrap-pending` 状态判定 + `--json`(`printPayload/options.json`);
  `memoryService.buildTakeoverRecall(context, verify)` 已存在。
  → **layer-1 是"把内部组装稳定成命名 builder + 加紧凑投影/预算",不是造新 takeover 系统。**
- `templates/cli/hooks.js` 仍是纯 Git `post-commit` 管理器(27/27)。
  → **生命周期 adapter 必须独立新建,不塞进 git hook 安装逻辑。**
- `memoryService.inspectHookLifecycle(event)` 已存在("为 hook wrapper 提供生命周期
  advice")—— 生命周期感知有前置件可复用。

---

## 2. 架构总览(C+):三层触发协议

```text
第一层  host-agnostic canonical payload
        buildTakeoverPayload({ mode, prompt?, budget? }) —— 单一真相 builder
        mem bootstrap 是人类展示器 / hook 是宿主适配器 / 二者消费同一 payload
        禁止 hook 自行重拼 focus/plan/architecture 语义

第二层  生命周期感知的确定性注入(Claude Code adapter)
        SessionStart        → 完整 payload 注入 + 写 receipt
        UserPromptSubmit    → 无条件注入极小 capsule + reconcile receipt
        可选事件(存在则优化)→ CwdChanged / PostCompact / SessionStart(compact)

第三层  变更前 fail-closed / 只读 fail-open 守卫
        PreToolUse: Edit/Write 无有效 receipt 即阻断;Read/Glob/Grep 恒放行;
        Bash 排除出 MVP;拒绝信息给可执行恢复命令

降级层  无 Hook 宿主 → 静态规则 fallback(CLAUDE.md / .agents),尽力而为、不确定
```

设计对齐 CLAUDE.md 护栏:**宿主文件只是适配层,`.agents` 与 `.evo-lite` 才是真相源;
hook 是"触发适配器",不替代真相源。**

---

## 3. host-agnostic canonical payload

单一 builder,人类展示器与 hook adapter 共同消费。

```
buildTakeoverPayload({ mode, prompt?, budget? }) -> TakeoverPayload

  mode:   "session"  完整 payload(SessionStart / 显式恢复;跑 verify/recall)
          "refresh"  轻量投影(只读 receipt + focus anchor,不跑 verify/recall/DB;
                     capsule 即由此模式产出 —— 保证 capsule 亦经单一 builder,adapter 不手拼语义)
  prompt: 当前 UserPromptSubmit 的 prompt 文本(可选,供未来 prompt-aware routing)
  budget: 字节预算(可选;capsule 投影强制 ≤ 1 KiB,见不变量 1)
```

### TakeoverPayload schema(完整,`mode:"session"`)

```jsonc
{
  "schemaVersion": 1,
  "host": "claude-code",
  "generatedAt": "<ISO8601>",
  "sourceEvent": "SessionStart:startup" | "manual-recovery" | ...,
  "project":   { "name": "create-evo-lite", "root": "<abs path>" },
  "focus":     { "text": "<focus 行>", "hash": "<sha>", "updatedAt": "<ISO8601>" },
  "active":    { "plan": { "id", "status", "progress" } | null,
                 "spec": { "id", "status" } | null },
  "rules":     { "dir": ".agents/rules/", "required": ["evo-lite", "execution-model", ...] },
  "risks":     ["..."],
  "nextAction":"<最小下一步>",
  "freshness": { "ahead": 0, "behind": 0, "headSha": "<sha>" },
  "verify":    { "status": "...", ... },      // 仅 mode:"session"
  "recall":    [ ... ]                         // 仅 mode:"session"
}
```

P1 语义正确性要求 payload 至少含:project identity、current focus、active plan/spec、
required rules、risks/warnings、recommended next action、payload freshness/version。

### capsule 投影(`UserPromptSubmit` 每轮,≤ 1 KiB)

capsule 是 payload 的**状态反射子集**,不是行为指令(见不变量 2):

```jsonc
// 稳态
{ "evoLite":"takeover-active", "project":"create-evo-lite",
  "focus":"<focus 行>", "receipt":"valid", "rules":".agents/rules/",
  "refresh":"mem bootstrap --json" }

// focus 已刷新
{ "evoLite":"takeover-refreshed", "project":"create-evo-lite",
  "focus":"<新 focus>", "receipt":"valid" }

// stale / degraded:升格,带可执行 action
{ "evoLite":"takeover-stale", "project":"create-evo-lite",
  "focus":"<focus 或 unknown>", "receipt":"invalid",
  "action":"mem bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json" }
```

---

## 4. session-bound receipt schema

receipt 证明:**Claude Code adapter 已在该 session/project 下成功生成并提交 takeover
context**。它**不**证明模型"理解了"上下文,也不证明宿主绝对未丢弃 hook 输出(后者属
Claude Code 宿主契约,由 capability probe + S9b dogfood 验证,仓库内文件无法证明)。
receipt 不是防恶意代码的安全凭证,而是防协作型 Agent 在无接管上下文时误操作的治理证明。

```jsonc
{
  // ── 硬有效性字段(不匹配 = invalid,参与 fail-closed)──
  "schemaVersion": 1,
  "host": "claude-code",
  "sessionId": "<current session id>",
  "projectRoot": "<abs path>",

  // ── 软字段(刷新 / 诊断,绝不参与 fail-closed)──
  "focusHash": "<sha>",
  "payloadHash": "<sha>",
  "generatedAt": "<ISO8601>",
  "sourceEvent": "SessionStart:startup" | "manual-recovery" | ...,
  "status": "injected"
}
```

**硬有效性 = `schemaVersion` + `host` + `sessionId` + `projectRoot` 全部匹配当前上下文。**
`focusHash` / `payloadHash` / `generatedAt` / `sourceEvent` 仅供刷新与诊断。

### 存放与写入(不变量 3)

```text
.evo-lite/generated/takeover/receipts/claude-code/<session-id>.json
```

- temp file + rename 原子发布;
- 属生成状态,**gitignore,不入模板真相源,不提交**;
- `SessionEnd` best-effort 清理;历史 receipt 的 TTL 仅用于 GC,**不作当前 receipt 的
  硬有效性条件**。

---

## 5. 注入 — receipt — 守卫状态机

```text
SessionStart(startup/resume/clear)
  → buildTakeoverPayload({ mode:"session" })
  → 成功 → 原子写 session receipt
  → 注入完整上下文

每次 UserPromptSubmit
  职责一 emit capsule(无条件):
    buildTakeoverPayload({ mode:"refresh" }) —— 只读 receipt + focus anchor,不跑 verify/recall/DB
    → 投影为 ≤1 KiB capsule → 无条件注入(capsule 经单一 builder,adapter 不手拼语义)
  职责二 reconcile receipt(条件):
    projectRoot 不匹配 → 旧 receipt 失效(禁跨项目继承)
    focusHash 漂移     → receipt 仍有效,静默更新 focusHash
    focus 无变化       → 不重写 receipt

PreToolUse(阶段 2)
  Read / Glob / Grep           → 恒放行
  Edit / Write                 → receipt 有效放行;无效 exit 2 阻断 + 恢复命令
  NotebookEdit / 其他写工具     → 仅当 capability probe 证明该工具名存在时纳入 matcher
  Bash                         → MVP 全放行(含恢复命令的执行路径)

显式恢复命令
  mem bootstrap --receipt --host claude-code --session-id <id> --source manual-recovery --json
  → buildTakeoverPayload({ mode:"session" }) → 写匹配当前 sessionId/projectRoot 的 receipt
  → 输出 payload → 后续 Edit/Write 解锁
```

**闭环保证:守卫放行 Bash → 恢复命令(一条 Bash 调用)永远可执行 → 坏 hook 永不硬砖化会话。**

### capsule 四态 × receipt 对照

| 状态 | Capsule `evoLite` | Receipt |
|---|---|---|
| 稳态 | `takeover-active` | valid |
| focus 漂移并已刷新 | `takeover-refreshed` | valid |
| receipt 缺失 / session 不匹配 | `takeover-stale` | invalid |
| projectRoot 不匹配 | `takeover-stale` | invalid |
| active_context 无法读取 | `takeover-degraded` | invalid(见不变量 5) |

**focus 漂移绝不使 receipt invalid** —— 它表示项目在合法推进,而非 takeover 从未发生。

---

## 6. Claude Code capability probe(设计阶段前置,must-verify)

生命周期事件名 / matcher / input schema / 输出语义 **不能只据文档假定**,必须由 probe
对**实际安装版**实测(R2)。文档已列出 `CwdChanged` / `PostCompact` /
`SessionStart(source=compact)`,但这些是**版本能力**,不能当项目最低基线(R1)。

probe 输出:

```text
- 当前 claude 版本
- 可用事件清单
- SessionStart.source 的实际取值集
- 是否真实发出 compact 后事件(PostCompact 或 SessionStart(compact))
- 是否存在 CwdChanged
- hook stdout / additionalContext 是否进入模型上下文
- tool name 实际字符串(Edit/Write/Read/Glob/Grep/Bash/NotebookEdit)
```

### 事件策略:UserPromptSubmit 是最低兼容层,其余是优化器

```text
事件存在:
  CwdChanged                          → 立即失效旧 project receipt + 注入新项目 capsule
  PostCompact / SessionStart(compact) → 重新注入完整 payload

事件不存在(最低兼容基线):
  UserPromptSubmit 每轮:
    - 按 cwd 对比 receipt.projectRoot(替代 CwdChanged)
    - 无条件注入极小 routing capsule(覆盖压缩后模型丢治理上下文)
```

**为什么 capsule 必须无条件注入(正式理由):上下文丢失对 hook 状态不可观测。**
压缩后状态是 receipt 仍有效、projectRoot 未变、focus 未变 —— 条件注入(仅在 delta 时注入)
的所有触发条件均不满足,于是什么都不注入;而这恰是模型刚丢失治理上下文之时。上下文丢失
发生在**模型内部**,对 hook 的状态比较不可见;在"不能依赖 post-compact 事件"的最低兼容
条件下,唯一能在压缩后重新播种的策略是**无条件注入**。条件注入结构性地覆盖不了其首要理由。

---

## 7. 守卫粒度与恢复(阶段 2)

- **覆盖必须**:Edit / Write。挡住主文件编辑路径即封住 Agent 的主变更路径。
- **条件纳入**:NotebookEdit / 其他 Notebook 写工具 —— 仅当 capability probe 证明该工具名
  在当前安装版实际暴露时才加入 matcher。
- **完全排除**:Bash mutation。Bash command 分类会重新引入一整套信任边界
  (a177 command-verifier 打过的仗),不值得放进第一版关键路径。MVP 不追求虚假的
  "完全禁止变更",只可靠封住主编辑路径。
- **恢复**:`PreToolUse` 阻断时掌握当前 hook input 的 `session_id` 与 `cwd`,拒绝信息
  (exit code 2)直接给出**含真实 session-id 的完整可执行恢复命令**。Agent 经 Bash 执行
  → canonical builder 生成 payload → 写匹配 sessionId/projectRoot 的 receipt → 再次
  Edit/Write 放行。

---

## 8. 五条不变量

1. **capsule 预算硬约束**:UTF-8 **1 KiB 硬上限**。focus 在预算内尽量完整;超限时
   `{ "focus":"<截断预览>", "focusHash":"<完整 hash>", "truncated":true }`,避免超长
   focus/backlog 把每轮注入成本无限放大。
2. **capsule 是状态反射,不是行为指令**:健康 capsule 只陈述(takeover 已激活 / 当前项目 /
   当前 focus / receipt 状态);不每轮重复"你必须读取…""现在运行…";仅异常态加 `action`。
   降低横幅失明。
3. **receipt 原子写入且不入 Git**:temp+rename;`.evo-lite/generated/takeover/receipts/`;
   gitignore;非模板真相源;TTL 仅 GC,不作硬有效性条件。
4. **receipt 语义准确**:证明"adapter 已成功生成并提交 takeover context",不证明模型
   "理解",不证明宿主未丢输出(后者由 probe + S9b 验证)。不升级为密码学挑战系统。
5. **任何失败必须显式降级**:UserPromptSubmit 无法读 focus 时**不得静默输出健康 capsule**,
   须输出 `{ "evoLite":"takeover-degraded", "project":"unknown", "receipt":"invalid",
   "reason":"active-context-unreadable", "action":"<恢复命令>" }`;阶段 2 守卫据此阻断
   Edit/Write,Bash 仍放行以执行恢复。

---

## 9. 组件与文件结构

新增 host-agnostic 协议件与 Claude Code adapter 分离,遵循"小而聚焦"原则:

- **Create `templates/cli/takeover-payload.js`** —— `buildTakeoverPayload({mode,prompt,budget})`
  canonical builder(复用 `buildTakeoverRecall` 等现有组装)+ capsule 投影 + 1 KiB 预算/截断。
- **Create `templates/cli/takeover-receipt.js`** —— receipt schema、原子写、硬/软有效性判定、
  `reconcile(receipt, ctx)`(projectRoot 失效 / focusHash 静默刷新)。
- **Create `templates/cli/takeover-adapter.js`** —— Claude Code 生命周期 hook 处理器
  (SessionStart / UserPromptSubmit / PreToolUse 入口)+ capability probe;从 hook input 读
  session_id/cwd/tool_name;emit 与 reconcile 职责分离。
- **Modify `templates/cli/memory.js`** —— `mem bootstrap` 增 `--receipt --host --session-id
  --source` 恢复标志(emit payload 同时盖 session-bound receipt);`bootstrap` 仍是人类展示器。
- **Create Claude Code hook 配置** —— 项目级 `.claude/settings.json` hooks 块(随仓库分发,
  子仓继承)指向 adapter 入口;安装/自检经**独立于 hooks.js 的** lifecycle-adapter 安装器
  (不复用 git post-commit 逻辑)。
- **Modify `templates/cli/template-manifest.js`** —— 注册新文件(core-cli)。
- **Modify `.gitignore`** —— 忽略 `.evo-lite/generated/takeover/receipts/`。
- **Modify `templates/cli/test/governance.js`** —— T-takeover-* 测试(见 §11)。

**分发**(母仓 = 模板):新文件落 `templates/cli/**` → `mem sync-runtime` 生成
`.evo-lite/cli/**` 镜像(**不手改镜像**)→ 经 hive nurture 分发子仓。镜像需 `git add`。
a177 教训:子仓分批落盘期间引擎优雅降级、再 sync 收敛;refused 时先 checkpoint 再推。

### 已知边界(非本 MVP 修复,如实记录)

- hook 配置存在但被本地设置禁用:probe/verify 可检测配置在位,但**本地禁用是宿主-用户
  选择,仓库无法覆盖** —— 降级为静态 fallback;若 PreToolUse 亦被禁用,守卫失效。与
  "receipt 非安全凭证"同类:这是宿主契约边界,不是仓库缺陷。
- 非 Claude Code 宿主:仅静态规则 fallback,不实现生命周期 adapter(YAGNI,待协议在 CC
  证明后再议)。

---

## 10. 两阶段 / 两独立复审门

### 阶段 1 复审门 —— 确定性接管(P0 determinism)

必证:

```text
裸 prompt(无 /evo)下,首次模型推理前已存在有效 takeover payload
SessionStart 写入正确 session receipt
UserPromptSubmit 每轮注入 routing capsule
cwd / project 变化不会复用旧 receipt
显式 CLI 能恢复 receipt
S9b:从"普通仓库探索"转为"按治理 focus 接管"
```

阶段 1 完成后已具独立产品价值,但**项目尚不能 CLOSED**。

### 阶段 2 复审门 —— 不可静默绕过(P0 no-silent-bypass)

必证:

```text
无 receipt:  Read/Glob/Grep 放行;Edit/Write 阻断;Bash 放行;拒绝信息含可执行恢复命令
坏 hook/坏 payload: 不静默产生 valid receipt;Agent 可自行运行恢复命令;恢复后 Edit/Write 放行
focus 变化:  不阻断;下一 prompt 自动刷新
projectRoot 变化: 旧 receipt 立即失效
```

**两个 P0 都完成后,项目方可交付关闭。**

---

## 11. 验收契约

- **P0 确定性**(阶段 1):干净子仓、裸 prompt、无 `/evo`,`fix this bug` 场景下首次模型
  推理前已注入有效 takeover payload。
- **P0 不可静默降级**(阶段 2):故障注入 —— 故意破坏 bootstrap 命令 / payload 输出:
  模型看到明确错误;只读探索继续;任何生产修改被守卫拒绝且拒绝信息可执行。
- **P1 语义正确**:注入内容来自 canonical builder,含 §3 全字段。
- **P2 行为效果**(S9b 重跑):Agent 不再把项目当普通仓库;首轮回答/调查明确使用
  injected focus/routing。**效果验证,不作唯一确定性来源。**
- **capability probe**:事件矩阵实测记录归档(§6 probe 输出清单)。
- **回归**:新文件入 template-manifest;`node templates/cli/test.js all` 与镜像侧 all
  EXIT 0;`mem sync-runtime` 二次运行 copied: 0。

### 测试骨架(T-takeover-*)

- `T-takeover-payload`:builder 完整字段 + capsule ≤1 KiB + 超限截断带 focusHash/truncated。
- `T-takeover-receipt`:原子写;硬有效性(schemaVersion/host/sessionId/projectRoot 任一
  不符 → invalid);focusHash 漂移 → 仍 valid + 静默刷新;projectRoot 不符 → invalid。
- `T-takeover-capsule-states`:四态映射(active/refreshed/stale/degraded)。
- `T-takeover-reconcile`:focus 推进不阻断、下轮刷新;跨项目不继承。
- `T-takeover-guard`(阶段 2):Edit/Write fail-closed;Read/Glob/Grep 放行;Bash 放行;
  拒绝信息含真实 session-id 恢复命令。
- `T-takeover-recovery`:恢复命令写匹配 receipt → 解锁。
- `T-takeover-degraded`:active_context 不可读 → degraded capsule + 不静默健康。

---

## 12. 最终边界

```text
Agent Takeover Trigger Protocol MVP
  宿主:      Claude Code only
  结构:      同一项目,两阶段、两个独立复审门
  主触发:    生命周期 Hook 确定性注入(SessionStart 完整 + 可选事件优化)
  兜底触发:  UserPromptSubmit 每轮无条件极小 capsule(≤1 KiB,状态反射)
  真相源:    Evo-Lite canonical builder(buildTakeoverPayload)
  守卫:      Edit/Write fail-closed;Read/Glob/Grep 放行;Bash 排除
  恢复:      显式 mem 命令写 session-bound receipt(Bash 放行保证可自助)
  无 Hook 宿主: 静态规则 fallback,尽力而为
  验收:      P0 确定性 + P0 不可静默绕过 + P1 语义 + P2 行为(S9b)+ 故障注入
```
