# ATTP 宿主自有写入根 —— 双会话真实记忆终局验收记录

- 日期:2026-07-27
- 宿主:Claude Code 2.1.220
- 被验收实现:`014655f`(Task 1–7,母仓 `main`)
- 载体:**一次性项目副本**,唯一命名 `D:/Data/attp-acc-copy-20260727-3d9e57`
- 会话形态:`claude -p`(headless),`--strict-mcp-config`(不加载任何 MCP server)
- 范围:本任务**只产出证据**。未改 spec / plan status,未跑 `mem archive`,未动 backlog

## 结论速览

| 验收项 | 结果 |
|---|---|
| (1) 首次目录创建不再被误拒 | **部分达成 —— 真实宿主不走该分支**,见 §5.1 |
| (2) 写入是【守卫放行】的结果,而不是守卫压根没参与 | **达成**,3/3 与 2/2 决定逐条对齐,见 §2、§4 |
| (3) 宿主持久记忆功能真正恢复 | **达成**,含负控,见 §3 |
| `memory/` 已存在的常规路径写入 | **达成**,并额外覆盖 `Edit` 臂,见 §4 |
| 收口门 | **达成**,见 §6 |
| 精确清理 | **达成**,母仓状态零变化,见 §7 |
| **新发现:git worktree 场景下豁免失效** | **未解决**,P1,需裁定,见 §5.2 |

---

## §1 一次性 project-state 准备

```text
项目根            D:/Data/attp-acc-copy-20260727-3d9e57
派生 state root   C:/Users/uwenc/.claude/projects/D--Data-attp-acc-copy-20260727-3d9e57
三事件            installed: SessionStart, UserPromptSubmit, PreToolUse | missing: (none)
scope             root-launch-only — engages only when Claude Code starts in
                  D:/Data/attp-acc-copy-20260727-3d9e57
```

副本构造:从 `014655f` 的工作树复制,剔除 `.git` 与 `.evo-lite/generated/`,随后 `git init`
形成**独立单工作树仓库**(HEAD `d245e83`,544 tracked)。`node_modules/`(3550 文件)与
`.evo-lite/node_modules/`(723 文件)从母仓复制 —— `better-sqlite3` 只在后者可解析,
缺它 takeover collector 会直接失败。

`memory/` 初始不存在的证据(Session A 之前):

```text
$ ls -1 C:/Users/uwenc/.claude/projects/D--Data-attp-acc-copy-20260727-3d9e57
5bceb43e-….jsonl
$ ls -d …/memory
ls: cannot access '…/memory': No such file or directory
```

宿主声明的记忆根(探针会话,禁用全部工具,只回答一行):

```text
C:\Users\uwenc\.claude\projects\D--Data-attp-acc-copy-20260727-3d9e57\memory\
```

即**宿主实际使用的记忆根 == `dirname(transcript_path)/memory` 派生出的根**。

---

## §2 Session A —— 真实 Write,守卫放行

会话 `a22222a2-0000-4000-8000-000000000002`,`--disallowedTools Bash`(机械排除 Bash 冒充)。

transcript 中的**全部**工具调用:

```text
TOOL_USE Read   …\D--Data-attp-acc-copy-20260727-3d9e57\memory\MEMORY.md
TOOL_USE Write  …\D--Data-attp-acc-copy-20260727-3d9e57\memory\project-attp-acceptance.md
TOOL_USE Write  …\D--Data-attp-acc-copy-20260727-3d9e57\memory\MEMORY.md
```

同一会话的 hook 调试日志:

```text
Hook PreToolUse (node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js")
  returned permissionDecision: allow      ×3
  returned permissionDecision: deny       ×0
```

**3 次工具调用 ↔ 3 次守卫 allow 一一对应**。这是「守卫参与并放行」,不是「守卫没被触发」——
守卫若未参与,日志里不会有 `returned permissionDecision`。

放行来自**窄豁免**而非项目根分支:目标 `C:\Users\uwenc\.claude\projects\…` 显然在项目根之外。
同一形状的目标在 §5.2 的 worktree 会话中被同一份代码 **deny**,构成对照。

落盘结果:

```text
…/memory/project-attp-acceptance.md   742B   含 ATTP-ACC-MARKER-3d9e57-QUOKKA-4417 ×1
…/memory/MEMORY.md                    117B   含 ATTP-ACC-MARKER-3d9e57-QUOKKA-4417 ×1
```

两个文件都落在 §1 派生出的 memory root 上,别处无落点。

---

## §3 Session B —— 宿主跨会话记忆机制消费

会话 `b33333b3-0000-4000-8000-000000000003`,全新会话,同一 canonical project root,
`--disallowedTools Read Glob Grep Bash Edit Write`。

提示词**不含**该标记:「关于本项目的 ATTP 验收,你记得的那个唯一标记(marker)字符串是什么?」

输出:

```text
ATTP-ACC-MARKER-3d9e57-QUOKKA-4417
```

transcript 中的**全部**工具调用(承重证据):

```text
#14 assistant tool_use  ToolSearch  {"query":"select:Read","max_results":3}
#16 user      tool_result           "No matching deferred tools found"
tool_use count = 1
```

- `Read` / `Glob` / `Grep` / `Bash` 调用数 = **0**;
- 唯一一次工具调用是 `ToolSearch`,它是延迟工具的 schema 装载器,**不访问文件系统**,
  且返回 `No matching deferred tools found`(`Read` 已被禁用,没装上);
- 因此标记不可能来自读盘。**如实披露**:计划 Step 3 列举的禁用面是
  `Read / Glob / Grep / Bash`,`ToolSearch` 不在其中,本次也确实发生了一次;
  它未产出任何内容,不构成读取路径。

**负控**(排除"猜中"与"来自别处的共享上下文"):同一提示词在另一个记忆目录为空的项目
`D:/Data/attp-acc-envprobe-1` 中执行,同样禁用全部读写工具:

```text
NO-MARKER
```

---

## §4 `memory/` 已存在的常规路径写入(+ `Edit` 臂)

会话 `d55555d5-0000-4000-8000-000000000005`,此时 `memory/` 已存在且已有两个文件。

```text
TOOL_USE Read   …\memory\project-attp-acceptance.md
TOOL_USE Edit   …\memory\project-attp-acceptance.md
allow=2  deny=0
```

结果:

```text
- 二次写入验证 ATTP-ACC-SECOND-3d9e57
```

这一轮额外覆盖了守卫的 **`Edit` 臂** —— §2 只走了 `Write`。

---

## §5 未观察到 / 未解决的项

### §5.1 「首次目录创建」在真实宿主中不由 agent 触发

宿主**自己**在 SessionStart 就建好了空的 `memory/`。证据:探针会话
`D--Data-attp-acc-envprobe-1` 全程 **0 次工具调用**,其 state root 下仍然出现了 `memory/`。

因此 Session A 的两次 `Write` 面对的都是「`memory/` 已存在、目标文件不存在」的**单级尾部再拼**;
「`memory/` 整体不存在时的多级尾部再拼」在真实宿主中**未被观察到**,仅由自动化回归覆盖
(`T-takeover-host-owned-roots` / `T-takeover-memory-root`)。不在本文档中冒充实景证据。

对结论 (1) 的影响:原始故障「agent 自己的记忆写入被拒」确实**不再复现**,但复现路径与设计
假设的「首次创建被误拒」不同 —— 真实场景下被拒的从来是**文件**写入,不是目录创建。

### §5.2 【新发现,P1】git worktree 中窄豁免失效

本轮**第一次尝试**用 `git worktree` 作为一次性载体
(`D:/Data/attp-acc-20260727-7f31a9`,由母仓 `git worktree add --detach 014655f` 生成),
Session A 被守卫**拒绝**:

```text
Hook PreToolUse (…takeover-adapter.js) returned permissionDecision: deny
(reason: [evo-lite] target 'C:\Users\uwenc\.claude\projects\
 D--Data-ProjectAgent-create-evo-lite\memory\project-attp-acceptance.md'
 resolves outside project 'D:/Data/attp-acc-20260727-7f31a9'.)
```

根因(两条独立事实):

```text
transcript_path 落点   C:\…\projects\D--Data-attp-acc-20260727-7f31a9\<sid>.jsonl
宿主实际记忆根         C:\…\projects\D--Data-ProjectAgent-create-evo-lite\memory\
                       （即【主工作树】的 slug,不是 cwd 的 slug）
```

也就是说:**在 git worktree 中启动时,宿主对 transcript 用 cwd slug、对 memory 用主工作树
slug,两者不同源**。设计把 `dirname(transcript_path)/memory` 当作运行时信任锚点,该锚点在
worktree 场景下指向一个宿主从不使用的目录,豁免必然不命中,守卫回落到默认 out-of-project 拒绝。

排除性证据(证明这不是环境变量继承或调用方式所致):

```text
非 git 目录 D:/Data/attp-acc-envprobe-1  → 宿主声明记忆根为自己的 slug（正常）
独立单工作树副本 …-copy-20260727-3d9e57  → 宿主声明记忆根为自己的 slug（正常,§1）
git worktree  …-20260727-7f31a9          → 宿主声明记忆根为【母仓】slug（异常）
```

结论:`[attp-guard-allowlist]` 在**单工作树项目**上已解除;在 **git worktree 启动的会话**上
**仍然复现**。母仓当前就挂着两个 worktree,`[attp-hive-rollout]` 的子仓也可能以 worktree 形态
存在,故本条按 P1 上报,**不自行修复、不自行扩大豁免**,请复审裁定归属
(设计范围限制 / 新缺陷 / 独立议题)。

---

## §6 门

```text
node --check templates/cli/takeover-physical-path.js   OK
node .evo-lite/cli/memory.js sync-runtime              copied: 0 ×3（连续两次以上为 0）
node templates/cli/test.js all                         EXIT 0
node .evo-lite/cli/memory.js takeover status           SessionStart, UserPromptSubmit, PreToolUse
node .evo-lite/cli/memory.js verify                    CLI/adapter synced;治理运行 last_run=healthy
```

---

## §7 精确清理

删除对象(全路径逐条列出,**未使用任何通配符**):

```text
项目目录
  D:/Data/attp-acc-copy-20260727-3d9e57
  D:/Data/attp-acc-envprobe-1
  D:/Data/attp-acc-20260727-7f31a9          （git worktree,先 worktree remove 再删目录）

宿主 project-state
  C:/Users/uwenc/.claude/projects/D--Data-attp-acc-copy-20260727-3d9e57
  C:/Users/uwenc/.claude/projects/D--Data-attp-acc-envprobe-1
  C:/Users/uwenc/.claude/projects/D--Data-attp-acc-20260727-7f31a9
```

删除前逐条确认三个目标均**不是**母仓 project-state root
`C:/Users/uwenc/.claude/projects/D--Data-ProjectAgent-create-evo-lite`。

母仓不变量(删除前 / 删除后):

```text
母仓 project-state 顶层条目   67 → 67
母仓 transcript (*.jsonl)     52 → 52
母仓 memory/ 文件数           18 → 18
母仓 node_modules 文件数    3550 → 3550
```

未创建任何可复用的清理脚本。

---

## §8 停止点

本记录写完即停,等待独立验收复审。以下**均未执行**:

```text
spec → done            未执行
plan → done            未执行
mem archive            未执行
backlog 关闭            未执行
[attp-hive-rollout] 解阻  未执行
子仓分发                未执行
```
