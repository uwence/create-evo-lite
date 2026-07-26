# `[attp-guard-allowlist]` Step 0b:子 agent 关联观测记录

- 日期:2026-07-26
- 宿主:Claude Code 2.1.220
- 仓库:`create-evo-lite`(母仓),分支 `main`
- 授权范围:**仅观测**。不含设计实现、生产代码、installer 改动、hive nurture。
- 前置:[`attp-guard-allowlist-step0-transcript-path.md`](attp-guard-allowlist-step0-transcript-path.md)
  只覆盖了主会话(交互 + 无头)。本记录补的是**子 agent** 这条路径。
- 本记录要判定的东西(设计复审 P1-1 冻结的分支):子 agent 的 `transcript_path`
  与它**实际要写的 memory target** 之间的对应关系。只看 transcript 落在哪个目录**不足以**判定。

> 脱敏:`<HOME>` = 用户目录,`<REPO>` = `D:/Data/ProjectAgent/create-evo-lite`。
> 会话 id 保留前 8 位,`agent_id` 保留前 12 位。结构关系一律原样保留。

## 结论速览

**判定:分支 A —— 当前设计成立。**

```text
子 agent 的 transcript root  ==  父会话的 transcript root
子 agent 的 memory target    在  该 root/memory 之下
```

子 agent 的工具调用携带的是**父会话的** `session_id` 与 `transcript_path`;宿主
不为子 agent 另开 project-state 目录。因此从当前事件派生的 `allowedMemoryRoot`
对子 agent 的记忆写入同样正确,无需为子 agent 追加任何身份绑定机制。

---

## §1 观测方法

必须是真实 subagent 机制,不能用「从另一个 cwd 另起一个 Claude Code 项目」冒充。做法:

1. 在母仓 `.claude/settings.json` 的 `PreToolUse` 数组里**并列**追加一个诊断 hook
   (与 Step 0 同一手法):只落盘、不产出任何 stdout,异常吞掉并 exit 0。
   PreToolUse 响应缺 `permissionDecision` 即等于放行,故它不参与授权判定,
   受管守卫的 deny/allow 行为完全不变。
2. 从**项目根**启动一个无头会话 `claude -p --model sonnet --permission-mode bypassPermissions`,
   要求它**用 `Task` 工具派发一个真实 subagent**(`subagent_type: general-purpose`)。
3. 给子 agent 的任务分三问,刻意把「自然目标」和「显式目标」分开:
   - (1) 在项目内 `Write` 一个控制文件 —— 证明子 agent 的工具调用确实触发 PreToolUse;
   - (2) **不给它任何路径**,让它报告自己系统提示里是否指定了持久记忆目录、路径为何;
   - (3) 再向一个**由我给定**的绝对路径(父会话的 memory root 下)尝试 `Write`,
     并明确要求「被拒是预期,不要重试、不要改用 Bash、不要绕开」。
4. 观测结束按字节恢复 `.claude/settings.json`,并复验守卫三门。

第 (2) 问是本轮的承重设计:如果只做第 (3) 问,「实际 memory target」就只是我在
prompt 里喂进去的值,毫无证明力。第 (2) 问独立确认了该路径本来就写在子 agent
自己的系统提示里,因此第 (3) 问观测到的 target **不是提示词造出来的产物**。

**未做的事**:没有修改 `takeover-adapter.js` / 守卫 / installer 任何生产逻辑;
没有放宽守卫;没有为任何项目外路径增加 allow;没有用 Bash 写 memory 冒充结果;
没有 hive nurture;没有在子仓安装 ATTP。

## §2 子 agent 的自述(第 (2) 问,未喂路径)

无头会话把子 agent 的三行返回原样透出:

```text
MEMORY_DIR=<HOME>\.claude\projects\D--Data-ProjectAgent-create-evo-lite\memory
CONTROL_WRITE=ok
MEMORY_WRITE=denied: [evo-lite] target '<HOME>\.claude\projects\D--Data-ProjectAgent-create-evo-lite\memory\step0b-subagent-probe.md' resolves outside project '<REPO>'.
```

两点:

- 子 agent **确实带有持久记忆目录指令**,且指向的就是**父项目**的 memory root
  —— 子 agent 发起的记忆写入是真实存在的路径,不是假想场景。
- 该写入**当前被守卫拒绝**,拒绝理由与母仓主会话遇到的是同一条(`resolves outside project`)。
  这正是 `[attp-guard-allowlist]` 要解决的问题,在子 agent 侧同样成立。

## §3 关联捕获(复审 P1-1 要求的六项)

同一次派发共捕获 3 条 PreToolUse。父与子的区分不靠推断 —— 宿主在事件里
**直接给出** `agent_id` / `agent_type`,父发起的调用**没有**这两个字段:

| # | tool_name | session_id | agent_id | agent_type | 发起方 |
|---|---|---|---|---|---|
| 1 | `Agent` | `caef7f86` | **(absent)** | **(absent)** | 父会话(派发动作本身) |
| 2 | `Write` | `caef7f86` | `a36d3ff1cf60` | `general-purpose` | **子 agent** |
| 3 | `Write` | `caef7f86` | `a36d3ff1cf60` | `general-purpose` | **子 agent** |

三条的 `transcript_path` **完全相同**:

```text
父 session_id        : caef7f86
父 transcript_path   : <HOME>/.claude/projects/D--Data-ProjectAgent-create-evo-lite/caef7f86….jsonl

子 session_id        : caef7f86          ← 与父相同
子 transcript_path   : <HOME>/.claude/projects/D--Data-ProjectAgent-create-evo-lite/caef7f86….jsonl
                                          ← 与父相同,宿主未为子 agent 另开 project-state 目录

子 tool_name         : Write
子 tool_input.file_path
  #2 (控制)          : <REPO>/.superpowers/sdd/step0b/subagent-control.txt          → 项目内
  #3 (记忆)          : <HOME>/.claude/projects/D--Data-…-evo-lite/memory/step0b-subagent-probe.md

derived allowedMemoryRoot
  = dirname(子 transcript_path)/memory
  = <HOME>/.claude/projects/D--Data-ProjectAgent-create-evo-lite/memory

actual attempted memory target
  = <HOME>/.claude/projects/D--Data-…-evo-lite/memory/step0b-subagent-probe.md
  → 严格位于 allowedMemoryRoot + '/' 之下   ✅
```

## §4 分支判定

| 分支 | 条件 | 是否命中 |
|---|---|---|
| **A** | 子 root == 父 root,且 memory target 在该 root/memory 下 | **命中** |
| B | 子 root != 父 root,但 target 仍是父 root/memory | 未命中 |
| C | 子 root != 父 root,target 是子自身 root/memory | 未命中 |
| D | `transcript_path` 缺失 / hook 未触发 / target 不可观测 | 未命中(3/3 捕获齐全) |

**分支 A ⇒ 当前事件单锚设计成立**,不需要重设身份绑定,不需要为子 agent 增加第二个 allowed root。

设计含义一句话:`deriveHostOwnedWriteRoots(hookInput)` 只需消费**当前事件**的
`transcript_path`,无需关心事件由父还是子发起 —— 因为宿主在这条路径上根本不做区分。
`agent_id` / `agent_type` **不得**进入派生逻辑:它们是新观测到的字段,不在任何文档契约里,
而且分支 A 下它们对结果没有影响。用了只会增加对未文档化字段的依赖。

## §5 附带观测(与判定无关,但值得记)

- `.claude/settings.json` 的 hook 变更**当前会话内即时生效**,不需要重启会话:
  本交互会话在编辑 settings 之后发出的 `Write` / `Bash` 调用都被诊断 hook 捕获到了。
  这解释了为什么安装类操作能立刻改变行为,也意味着卸载同样立刻生效。
- 顶层字段实测清单(比 Step 0 多出 `agent_id` / `agent_type`,均为文档未列):

```text
session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
hook_event_name, tool_name, tool_input, tool_use_id, agent_id, agent_type
```

- `tool_name: Agent`(即 Task 派发动作本身)同样送到 PreToolUse。

## §6 后置恢复检查

```text
.claude/settings.json    sha256 bb8a89b8… == 观测前基线（逐字节恢复）
takeover status          installed: SessionStart, UserPromptSubmit, PreToolUse | missing: (none)
项目内 Write             allow            （exit 0，stdout 仅 JSON）
项目外 memory Write      deny — "resolves outside project"   （exit 0）
诊断 hook / 探测脚本 /
原始输入 jsonl           已清理（均在 gitignored 的 .superpowers/sdd/step0b/ 下）
```

## §7 尚未授权

本记录只完成 Step 0b 观测。`deriveHostOwnedWriteRoots()` 的实现、生产测试、
installer 重构、子仓分发、hive nurture 均 **NOT AUTHORIZED**;ATTP MVP 保持 CLOSED。
