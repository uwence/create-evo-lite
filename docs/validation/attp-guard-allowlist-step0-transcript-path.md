# `[attp-guard-allowlist]` Step 0:`transcript_path` 真实观测记录

- 日期:2026-07-26
- 宿主:Claude Code 2.1.220
- 仓库:`create-evo-lite`(母仓),分支 `main`
- 授权范围:**仅观测**。不含设计、生产实现、allowlist、hive nurture。
- 前置结论(本记录要推翻或证实的东西):`transcript_path` 在
  [`attp-cc-capability-probe.md`](attp-cc-capability-probe.md) 里只是一行**文档契约**,
  该文档的 echo-harness 实测表只亲验过 `session_id` / `tool_input` / `additionalContext` / `deny`
  —— 该字段**从未在真实 PreToolUse 输入中被观测过**。

> 脱敏:下文用 `<HOME>` 代替用户目录,`<REPO>` 代替 `D:/Data/ProjectAgent/create-evo-lite`。
> 会话 id 只保留前 8 位。结构关系(层级、分隔符、slug 编码)一律原样保留。

## 结论速览

| 判定门 | 结果 |
|---|---|
| `transcript_path` 是否存在 | **存在**,8/8 次捕获均有 |
| 类型与形态 | `string`,绝对路径 |
| 是否稳定指向当前项目对应的宿主 project-state 目录 | **是** —— 同一项目的两个不同会话导出**同一** root |
| `dirname(transcript_path)/memory` 是否精确命中记忆目录 | **是** —— 落在真实目录上(共 18 个文件,含 `MEMORY.md`) |
| 不同项目是否导出不同 memory root | **是** —— 两个项目得到两个互异 root |

**判定:路径成立。** 四条门全部满足,可以进入后续设计 —— 但设计须避开下面 §4 的前缀陷阱。

---

## §1 观测方法

不手工构造 JSON,也不从已有 transcript 文件反推。做法:

1. 在母仓 `.claude/settings.json` 的 `PreToolUse` 数组里**并列**追加一个诊断 hook,
   与受管 hook 同级但独立成组。诊断 hook **只落盘、不产出任何 stdout** ——
   PreToolUse 响应缺 `permissionDecision` 即等于放行,因此它不参与授权判定,
   受管守卫的 deny/allow 行为完全不变。任何异常也被吞掉并以 exit 0 收场。
2. 从**项目根**启动一个无头会话 `claude -p --model haiku --permission-mode bypassPermissions`,
   让它用 `Write` 工具在项目内建一个文件 → 触发真实 `PreToolUse`。
3. 为取得「不同项目」的对照,在仓内建一个自带 `.claude/settings.json` 的 harness 目录,
   从**该目录**启动第二个无头会话,同样触发一次真实 `Write`。
4. 观测结束按字节恢复 `.claude/settings.json`,并复验守卫。

**未做的事**:没有修改 `takeover-adapter.js` / 守卫 / installer 任何生产逻辑;
没有为任何项目外路径增加 allow;没有关闭或移除 PreToolUse 守卫;没有 hive nurture。

## §2 捕获到的真实事件

共 8 条,覆盖 3 个会话、2 个项目、2 种工具(`Write` / `Bash`)。代表性字段:

```text
hook_event_name : PreToolUse
tool_name       : Write
session_id      : 0950b32a…                       (无头会话)
cwd             : <REPO>
transcript_path : <HOME>\.claude\projects\D--Data-ProjectAgent-create-evo-lite\0950b32a….jsonl
tool_input.file_path : <REPO>\.superpowers\sdd\step0\probe-target.txt
```

顶层字段实测清单(与文档契约一致,并多出三个文档未列的):

```text
session_id, transcript_path, cwd, prompt_id, permission_mode,
hook_event_name, tool_name, tool_input, tool_use_id
（部分事件另有 effort）
```

> 附带观测,与本议题无关但值得记:`tool_name: Bash` 的事件**同样**会送到 PreToolUse。
> 守卫放行 Bash 是设计选择(§0.3 守卫非隔离边界),不是宿主不发事件。

## §3 派生关系

```text
host project state root = dirname(transcript_path)
allowed memory root     = dirname(transcript_path)/memory
```

| 项目 | 派生出的 project-state root | 会话数 | `/memory` 存在 |
|---|---|---|---|
| 母仓 `create-evo-lite` | `…/projects/D--Data-ProjectAgent-create-evo-lite` | 2(含本会话) | **是**(共 18 个文件,含 `MEMORY.md`) |
| harness | `…/projects/D--Data-ProjectAgent-create-evo-lite--superpowers-sdd-step0-harness` | 1 | 否(该项目从未写过记忆) |

两条要点:

- **同项目跨会话稳定**:母仓的两个会话(一个是本交互会话,一个是无头会话)
  导出**同一个** root。因此该锚点绑定的是项目,不是会话。
- **跨项目互异**:harness 得到完全不同的 root,无需猜 `<slug>` 的编码算法。

## §4 设计期必须避开的前缀陷阱(本轮新发现)

harness 在文件系统上是母仓的**子目录**,但它拿到的是一个**独立**的 project-state root
—— slug 由完整路径派生、分隔符编码为 `--`。副作用是两个 slug 形成前缀关系:

```text
A = …/projects/D--Data-ProjectAgent-create-evo-lite
B = …/projects/D--Data-ProjectAgent-create-evo-lite--superpowers-sdd-step0-harness

B.startsWith(A)        -> true    ← 朴素前缀判定会把【别的项目】的 memory 当成本项目的
B.startsWith(A + '/')  -> false   ← 加分隔符即可正确排除
A === B                -> false
```

这与 ATTP 已经修过一次的那类边界缺陷同源(containment 比较必须带分隔符)。

**该风险已经在本机真实存在,不是探测产物。** 清理 harness 后清点
`~/.claude/projects/` 下与母仓 slug 构成前缀关系的目录,发现**两个既有实例**:

```text
D--Data-ProjectAgent-create-evo-lite                                <- 母仓本体(有 memory)
D--Data-ProjectAgent-create-evo-lite--claude-worktrees-…-8d0f4d     <- 一个 git worktree
D--Data-ProjectAgent-create-evo-lite-templates                      <- 曾从 templates/ 启动

裸 startsWith(A)      误纳 2 个
startsWith(A + '/')   误纳 0 个
```

注意第三个是**单破折号** `-templates`。任何以母仓路径为前缀的兄弟目录、worktree
或子目录启动,都会生成这样一个 slug。

**设计结论(Step 0 复审 P2-1 收窄后的表述):** 规则不是「project-state root 精确相等」,
而是:

```text
1. 只从【当前事件】的 transcript_path 派生唯一 allowedMemoryRoot;
2. 对目标路径执行与现有守卫一致的 realpath / 最近存在祖先解析;
3. 判定 target === allowedMemoryRoot,或 target 位于 allowedMemoryRoot + 分隔符之下;
4. 不得对 ~/.claude/projects 下的 slug 做裸字符串前缀匹配。
```

即:

```javascript
target === allowedMemoryRoot ||
target.startsWith(allowedMemoryRoot + '/')
```

且两侧必须先经过真实路径归一化。判定发生在 **memory 目录这一层**,不在 project-state
root 那一层 —— 后者只是派生的中间量,永不直接参与包含判定。

**分隔符必须写字面量 `'/'`,不能写 `path.sep`。** 本项目的 `normalize()` 会把 `\`
全部折成 `/`;在 Windows 上 `path.sep === '\\'`,两者一旦混用,结果是精确路径仍能命中、
而 `allowedMemoryRoot/` 下的**任何子文件全部落空** —— 一个只在真实使用时才暴露的漏放行。
只有在比较**未归一化的原生路径**时才轮得到 `path.sep`,而本设计不存在这种比较。

## §5 后置恢复检查

```text
.claude/settings.json    sha256 bb8a89b8… == 观测前基线（逐字节恢复）
takeover status          installed: SessionStart, UserPromptSubmit, PreToolUse | missing: (none)
项目内 Edit/Write        allow
项目外 Edit/Write        deny — "resolves outside project"
诊断 hook / harness /
原始输入 jsonl           已清理（均在 gitignored 的 .superpowers/sdd/step0/ 下）
```

## §6 尚未授权

本记录只完成 Step 0 观测。`deriveHostOwnedWriteRoots()` 的设计与实现、
allowlist、hive nurture 均 **NOT AUTHORIZED**;ATTP MVP 保持 CLOSED。
