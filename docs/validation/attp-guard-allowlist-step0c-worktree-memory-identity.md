# Step 0c —— linked-worktree 记忆身份观测

- 日期:2026-07-27
- 宿主:Claude Code 2.1.220
- 基线提交:`342dcd0`
- 性质:**纯观测**。未修改生产守卫、未实施任何豁免、未开始 rollout
- 诊断 hook:经 `claude --settings <file>` **临时注入**,`.claude/settings.json`
  与 `.claude/settings.local.json` **自始至终未被触碰**(`git status` 全程只有
  `.evo-lite/active_context.md` 一项运行时变更)。诊断 hook 无任何 stdout,
  因此不影响任何 `permissionDecision`

## 终止分支裁定

```text
B  只能通过 slug 猜测 / 目录扫描 / target 自证 / 持久配置得到 main memory root   成立
C  映射并不稳定                                                                成立（更强）
```

**B ∧ C,以 C 为主。** 停止,fail-closed,不进入设计修订,rollout blocker 保持。

---

## §1 观测矩阵

| # | 启动路径 | `cwd` / `CLAUDE_PROJECT_DIR` | transcript slug | 宿主声明 memory root | 守卫裁定 |
|---|---|---|---|---|---|
| W0 | `D:/Data/ProjectAgent/create-evo-lite`(main) | 同左 | `D--Data-ProjectAgent-create-evo-lite` | `D--Data-ProjectAgent-create-evo-lite` | **allow** |
| W1 | `D:/Data/attp-0c-wt1-4b8e12`(linked, D:) | 同左 | `D--Data-attp-0c-wt1-4b8e12` | `D--Data-ProjectAgent-create-evo-lite` | **deny** |
| W2 | `C:/Users/uwenc/attp-0c-wt2-4b8e12`(linked, C:) | 同左 | `C--Users-uwenc-attp-0c-wt2-4b8e12` | `D--Data-ProjectAgent-create-evo-lite` | **deny** |
| S | W1 内的 **subagent** | 同 W1 | 同 W1(父) | `D--Data-ProjectAgent-create-evo-lite` | **deny** |
| Lc | `/d/data/attp-0c-wt1-4b8e12`(W1 的**小写拼写**) | `D:\data\attp-0c-wt1-4b8e12` | `D--data-attp-0c-wt1-4b8e12` | **`D--data-attp-0c-wt1-4b8e12`** | (未写) |
| J | junction → W1 | 被解析为 `D:\Data\attp-0c-wt1-4b8e12` | `D--Data-attp-0c-wt1-4b8e12` | `D--Data-ProjectAgent-create-evo-lite` | (未写) |
| Mv | `git worktree move` 后的 `…-wt1-moved-4b8e12` | 同左 | `D--Data-attp-0c-wt1-moved-4b8e12` | `D--Data-ProjectAgent-create-evo-lite` | (未写) |
| U | `D:/Data/attp-0c-wt测试-4b8e12` | 同左 | **`D--Data-attp-0c-wt---4b8e12`** | `D--Data-ProjectAgent-create-evo-lite` | (未写) |

拒绝文案在 W1 / W2 / S 三例中形状一致,只有项目根不同:

```text
[evo-lite] target 'C:\Users\uwenc\.claude\projects\D--Data-ProjectAgent-create-evo-lite\
 memory\step0c-probe.md' resolves outside project 'D:/Data/attp-0c-wt1-4b8e12'.
```

**非合成旁证**(不是本轮制造的):母仓早有的 linked worktree
`.claude/worktrees/evo-lite-spec-eval-8d0f4d` 的 project-state 下有两份真实 transcript,
却**没有 `memory/` 目录** —— 它的记忆从来就写在主工作树那一侧。

---

## §2 hook 可见输入的**完整**键集

诊断 hook 抓到的 `PreToolUse` 原始载荷键集(四次观测完全一致):

```text
cwd, effort, hook_event_name, permission_mode, prompt_id,
session_id, tool_input, tool_name, tool_use_id, transcript_path
+ agent_id, agent_type          （仅 subagent 发起的调用带这两项）
```

环境侧:

```text
CLAUDE_PROJECT_DIR = <linked worktree 根>      （跟着 cwd,不指向主工作树）
CLAUDE_CONFIG_DIR  = null
```

**没有任何字段命名 memory root。** `cwd` / `CLAUDE_PROJECT_DIR` / `transcript_path`
三者在 linked worktree 中一致地锚在**当前 worktree**,而宿主实际使用的 memory root
锚在**主工作树**。事件锚与真实记忆根在此拓扑下被真实宿主行为证伪。

---

## §3 四个待确认问题的观测答复

### Q1 同一 common Git directory 下,linked worktree 是否**始终**共享 main-worktree memory root

**不是"始终"。** 规范拼写下的 5 次 linked-worktree 启动(D: 盘、C: 盘、junction、
move 之后、Unicode 名)全部重定向到主工作树 memory root;但**同一个目录的小写拼写(Lc)
没有重定向**,用的是自己 cwd 派生的根。该规则是有条件的,条件不在 hook 可见输入里。

### Q2 subagent 是否沿用同一映射

**是。** subagent 的 `PreToolUse` 携带**父会话**的 `session_id` 与 `transcript_path`,
另带 `agent_id` / `agent_type`;它声明的 memory root 与主 agent 完全相同(主工作树那一个),
写入同样被拒。subagent 不构成独立的记忆身份,也不构成绕过。

### Q3 main-worktree memory root 能否从权威输入或 Git identity **精确派生**

**不能。** 三条路都断:

1. **hook 输入**:§2 的完整键集里没有 memory root,也没有主工作树路径。
2. **Git identity**:`git rev-parse --path-format=absolute --git-common-dir` 确实精确给出
   `D:/Data/ProjectAgent/create-evo-lite/.git`,去掉 `/.git` 即主工作树根 —— 但从
   **路径**到 **memory root** 还差一层 Claude 的 slug 编码。重新实现该编码是禁止项,
   且观测证明它**有损**:`attp-0c-wt测试-4b8e12` → `attp-0c-wt---4b8e12`,
   每个非 ASCII 字符塌成一个 `-`,不同名字会碰撞。
3. **持久注册表**:`~/.claude.json` 的 `projects` 是**用户可编辑**的,条目**不含**任何
   memory / slug 字段(键集只有 `allowedTools`、`hasTrustDialogAccepted`、
   `lastSessionId` 等),而且同一个物理项目在里面有**五种非规范拼写**:

```text
"C:/Data/ProjectAgent/create-evo-lite"                     trusted=true    ← 盘符都不同
"D:\\Data\\ProjectAgent\\create-evo-lite"                  trusted=true
"D:/Data/ProjectAgent/create-evo-lite"                     trusted=true
"d:/Data/ProjectAgent/create-evo-lite"                     trusted=false
"D:\\Data\\ProjectAgent\\create-evo-lite\\.claude\\worktrees\\evo-lite-spec-eval-8d0f4d"
```

它既不规范、也不权威、还可被用户改写,不能作为安全证明的锚点。

### Q4 派生在移动 / 盘符 / junction / 大小写 / Unicode 下是否稳定

**不稳定,且失稳方向是危险的那一侧。**

```text
不同盘符 (W2)    重定向仍成立            —— 稳定
junction (J)     被解析为真实目标后重定向 —— 稳定
worktree move    重定向仍成立,transcript 跟随新路径 —— 稳定
Unicode (U)      重定向仍成立,但 slug 有损塌陷      —— 编码不可复现
大小写 (Lc)      **重定向消失**                     —— 不稳定
```

`Lc` 是承重的:同一物理目录、同一 git 身份,只因启动路径拼写为小写,宿主就改用
cwd 派生的记忆根。而 git 在小写 cwd 下**仍然返回规范大小写**:

```text
$ cd /d/data/attp-0c-wt1-4b8e12
  show-toplevel  : D:/Data/attp-0c-wt1-4b8e12
  git-common-dir : D:/Data/ProjectAgent/create-evo-lite/.git
```

也就是说:**若真按 Git identity 去派生允许根,在 Lc 这一例中会派生出
`D--Data-ProjectAgent-create-evo-lite`,而宿主当时用的是 `D--data-attp-0c-wt1-4b8e12`。**
结果是同时犯两个错 —— 打开了一个宿主并未使用的项目外写入根(**扩权**),
又依然拒绝了宿主真正在用的那个(**没解决问题**)。

补充一条 NTFS 事实:`D--Data-attp-0c-wt1-4b8e12` 与 `D--data-attp-0c-wt1-4b8e12`
在盘上是**同一个物理目录**(`realpath.native` 两者相同),因此宿主侧的 slug
空间本身在 Windows 上也不是单射。

---

## §4 结论

```text
可作为安全证明的权威锚点        不存在
Git identity 能给出主工作树路径   能，但到 memory root 差一层有损且被禁的 slug 编码
映射稳定性                      在大小写维度上被证伪
```

按 Step 0c 终止分支:落在 **B 且 C**。停止,**不实施任何宽松例外**,
`[attp-guard-allowlist]` 保持 OPEN,`[attp-hive-rollout]` 保持 BLOCKED。

当前守卫在 linked worktree 中的行为是 **fail-closed**(拒绝写入,不放行任何项目外根),
方向正确,代价是该拓扑下宿主持久记忆不可用。这是**已知且已记录**的限制,不是静默失败。

---

## §5 清理

观测载体(全路径逐条,**未使用通配符**):

```text
git worktree remove --force
  D:/Data/attp-0c-wt1-moved-4b8e12        （由 D:/Data/attp-0c-wt1-4b8e12 move 而来）
  C:/Users/uwenc/attp-0c-wt2-4b8e12
  D:/Data/attp-0c-wt测试-4b8e12
junction（先删链接再删目标，rmdir 不递归）
  D:/Data/attp-0c-link-4b8e12

宿主 project-state
  C:/Users/uwenc/.claude/projects/D--Data-attp-0c-wt1-4b8e12
  C:/Users/uwenc/.claude/projects/D--Data-attp-0c-wt1-moved-4b8e12
  C:/Users/uwenc/.claude/projects/C--Users-uwenc-attp-0c-wt2-4b8e12
  C:/Users/uwenc/.claude/projects/D--Data-attp-0c-wt---4b8e12

母仓侧被测试污染的两项（W0 观测产生）
  …/D--Data-ProjectAgent-create-evo-lite/memory/step0c-probe.md
  …/D--Data-ProjectAgent-create-evo-lite/0c000000-0000-4000-8000-000000000000.jsonl
```

母仓不变量(观测前 / 清理后):

```text
project-state 顶层条目   67 → 67
transcript (*.jsonl)     52 → 52
memory/ 文件数           18 → 18
```

临时诊断 hook 与原始抓包留在项目内 `docs/validation/step0c-scratch/`,
本记录写完后删除;它们从未进入 `.claude/settings.json`。

**未清理并如实披露的一项**:`~/.claude.json` 的 `projects` 里多出一条
`"D:/data/attp-0c-wt1-4b8e12"`(`hasTrustDialogAccepted: false`),是宿主在 `Lc`
观测时自行写入的。手改用户级配置不属于纯观测,故**保留原样**,需要时可单独授权清除。
