# Agent Takeover Trigger Protocol — Claude Code Capability Probe

- 议题:`[agent-code-routing]` / ATTP 设计 R2 前置(spec review R1 要求:probe 先于 plan 完成并附证据)。
- 日期:2026-07-24
- 装机版本:**Claude Code 2.1.218**(`claude --version`)。
- 判决(R2 复审 P1-3 更正,如实分级):
  - **基线三事件 = SUPPORTED-BY-CONTRACT + FULLY-OBSERVED** —— SessionStart / UserPromptSubmit /
    PreToolUse 均由 echo-harness 在装机 2.1.218 上**可重复实测**(§D):additionalContext 注入摄入、
    deny 生效 + reason 展示、tool_input 可读,全部亲验。
  - **可选优化事件 = SUPPORTED-BY-CONTRACT + UNOBSERVED** —— SessionStart(compact) / CwdChanged /
    PostCompact 仅文档存在,装机版实际触发未测;设计不依赖(基线兜底),留实现阶段落实。

## 证据分级

### A. 经验确认(本机 `~/.claude/settings.json` 活配置 + 本会话亲历)

装机 2.1.218 实际接受并触发的事件(已配置且在跑):
`SessionStart`、`PreToolUse`(matcher 支持精确 `Bash` 与 `*`)、`UserPromptSubmit`、
`Stop/StopFailure`、`PostToolUse/PostToolUseFailure`、`PermissionRequest`、
`SubagentStart/SubagentStop`、`TeammateIdle`。

- **本会话自身**由 SessionStart hook 经 `additionalContext` 注入 superpowers 上下文 →
  "SessionStart 触发 + hook 输出进模型上下文"在 2.1.218 上**亲历确证**。
- PreToolUse 精确工具名 matcher(`Bash`)在本机活配置中使用 → 名匹配可用,`Bash` 即工具名字面量。

**协议三个承重事件 `SessionStart` + `UserPromptSubmit` + `PreToolUse` 在装机版经验确认存在。**

### B. 权威契约(官方 hooks 参考,latest)

| 契约点 | 事实 |
|---|---|
| SessionStart 源 | `startup` / `resume` / `clear` / `compact` / `fork`(`compact` 存在) |
| 注入机制 | `hookSpecificOutput.additionalContext`(字符串,包进 system reminder,插在 hook 触发点) |
| 注入位置 | SessionStart → 会话开头、首 prompt 前;UserPromptSubmit → 随提交的 prompt |
| PreToolUse 阻断 | `hookSpecificOutput.permissionDecision` ∈ `allow/deny/ask/defer`;`deny` 阻止调用,`permissionDecisionReason` 在 `deny` 时**展示给 Claude** |
| PreToolUse matcher | 工具名(`Bash`、`Edit\|Write`、`mcp__.*`) |
| 公共输入字段 | `session_id` / `transcript_path` / `cwd` / `permission_mode` / `hook_event_name` |
| PreToolUse 额外输入 | `tool_name` / `tool_input` |
| CwdChanged | 文档存在;无 matcher,目录每次变更即触发 |
| PostCompact | 文档存在;输入含 `trigger`(manual/auto)+ `compact_summary`;**无 decision control**;**不在 additionalContext 注入清单** → 不能靠它重注入 |
| 输出字节上限 | 文档**未**规定 additionalContext 硬上限 → 1 KiB 为本设计自设预算 |
| JSON 健壮性 | v2.1.202+ malformed JSON 不再崩会话;**类型错字段被静默丢弃**(→ capsule 格式错 = 静默不注入) |

### C. 装机版待实测残留(不阻断:属可选优化器,基线已满足)

- `SessionStart(source=compact)` 是否在 2.1.218 的**自动压缩**后真实触发?
- `CwdChanged` 是否在 2.1.218 触发?(本机未配置,文档存在)

两者均为**优化器**。基线(`SessionStart` startup/resume/clear + `UserPromptSubmit` + `PreToolUse`)
已经验确认,协议最小可运行集满足;压缩后重注入由 **UserPromptSubmit 每轮无条件 capsule** 兜底
(§设计 P1-1),不依赖 compact 事件。这两项在实现阶段用 echo-hook harness 落实即可,不改设计结论。

### D. echo-harness 实测(基线三事件,可重复)

harness:`$CLAUDE_JOB_DIR/tmp/echo-harness/`(scratch 项目 `.claude/settings.json` 挂 node echo-hook,
`claude -p --model haiku --permission-mode bypassPermissions`)。两次运行,session id 各异,结果一致:

| 事件 | 观测 | 证据 |
|---|---|---|
| SessionStart | additionalContext **摄入** | hook 产 `ECHO_SS_TOKEN_7A` → 模型回显该 token |
| UserPromptSubmit | additionalContext **摄入** | hook 产 `ECHO_UPS_TOKEN_7B` → 模型回显该 token |
| PreToolUse(Write) | deny **生效** + reason 展示给模型 | hook 产 `permissionDecision:"deny"` → `proj.txt` **未创建**,模型见 `ECHO_DENY_TOKEN_7C`("出现在 Write 工具错误响应中") |
| PreToolUse tool_input | **可读** | marker 记 `tin={"file_path":"...proj.txt","content":"hello"}` → P0-4 target-path 绑定可实现 |

结论:基线三事件在装机 2.1.218 上 FULLY-OBSERVED。node hook 命令在 Claude 执行环境下正常运行
(佐证 §7 shell-neutral `node .evo-lite/cli/memory.js` 恢复入口可行)。

## 对设计的直接影响(已折入 R3)

1. 注入用 `additionalContext`;守卫 deny 用 `permissionDecision:"deny"` + `permissionDecisionReason`
   携带平台正确恢复命令(deny reason 展示给 Claude,Bash 放行 → 可自助)。
2. 事件层级改为:阶段 1 最小 = SessionStart + UserPromptSubmit;阶段 2 最小 = +PreToolUse;
   CwdChanged / PostCompact / SessionStart(compact) = 可选优化器(probe-gated)。
3. 无 SessionStart 基线 → UNSUPPORTED/PARK(不宣称 UserPromptSubmit 单独兜底建立 takeover)。
4. 1 KiB 硬上限量 additionalContext UTF-8 串;capsule 必须严格合法 JSON(类型错会被静默丢)。
5. receipt 提交事务必须"先成功序列化并写出注入,再原子发布 committed receipt"(P0-3)。
