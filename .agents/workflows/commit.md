---
description: 核心高频协议：代码提交、轨迹追踪与任务闭环
---
# 🚀 追踪与闭环协议 (/commit)

会话里**完成一次功能修改、Bug 修复、或阶段性进展时**，必须执行本协议。  
协议是 Evo-Lite 核心高频链路，把代码动作变成可检索长文本向量记忆，并自动维护任务大盘。

### 0. 低摩擦显式快路 (Explicit Fast Path)
如果你已经明确知道本次代码快照的 commit message、轨迹 mechanism、闭环 details，以及可选的 backlog resolve hash，可以直接调用显式 helper，而不是手动分三段敲命令：

```bash
# Unix / Bash
./.evo-lite/mem commit "将代码快照、context track 与 runtime state snapshot 封成一次显式闭环。" --code-message="feat(runtime): add commit fast path" --mechanism="CommitFastPath" --resolve="a1b2"

# Windows PowerShell / CMD
.\.evo-lite\mem.cmd commit "将代码快照、context track 与 runtime state snapshot 封成一次显式闭环。" --code-message="feat(runtime): add commit fast path" --mechanism="CommitFastPath" --resolve="a1b2"
```

- 这个 helper 仍然严格执行同一协议：先代码快照 commit，再 `context track`，最后在需要时补独立的 runtime state Meta-Commit。
- 默认 `--stage=staged`，只接受已经 staged 的非 `.evo-lite` 代码改动；只有你明确要把当前全部受追踪代码变更一起纳入快照时，才显式传 `--stage=all`。
- `mem commit` 是显式降摩擦入口，不是隐藏自动化；最终仍要逐项确认 `code_snapshot`、`context_closure`、`runtime_meta` 的实际结果。
- 在 Windows 上，如果是人类交互式执行，优先在 Git Bash 里运行 `./.evo-lite/mem commit ...`；`.\.evo-lite\mem.cmd` 继续保留给 PowerShell / CMD 兼容与自动化场景。若要把结果交给脚本或 Agent 继续消费，优先追加 `--json`。

// turbo-all
**执行步骤 (严格按顺序执行，禁止跨级或跳过):**

### 1. 代码快照 (Code Commit)
代码写完，立刻做标准 Git 提交，锁定代码快照。  
**注意：工作区（除 `.evo-lite` 目录外的所有受追踪文件）必须保持 clean 状态，否则后续脚本将抛出致命错误并强制打回！**
```bash
git add .
git commit -m "fix(module): 解决了某某问题"
```

### 2. 轨迹写入与认知刷新 (Context Track)
提交后，用底层状态机 CLI 记动作轨迹。CLI 自动抓取刚才 Commit Hash，更新 `active_context.md` 的 `FOCUS` / `BACKLOG` / `TRAJECTORY` 运行时区块，并做结构化归档。  
**致命错误：`active_context.md` 是一个状态机。涉及任务、轨迹、焦点的修改都必须通过当前宿主可用的 Evo-Lite CLI 入口代理（Unix: `./.evo-lite/mem`；Windows: `\\.\\evo-lite\\mem.cmd`）。严禁 Agent 直接使用文件写入工具修改这些运行时区块！`META` 区块当前没有专用 CLI 写入口，只有在确认不存在对应命令时，才允许最小范围的人工维护。如果你检测到自己或任何其他 Agent 正在尝试直接修改 `FOCUS`、`BACKLOG`、`TRAJECTORY` 任一区块，必须立即中止并发出告警。**

对人类使用者的补充口径：Windows 交互式场景优先 Git Bash + `./.evo-lite/mem`；PowerShell / CMD 仍是受支持的兼容入口，但更适合自动化和宿主集成。若输出将被机器继续消费，优先使用 `--json`。

记住 Evo-Lite 主流转模型：

- `active_context.md` 负责“现在正在做什么”
- `context track` 负责把“刚刚完成了什么”沉淀出去
- `archive` 负责保存长期资产
- `remember` 只是轻量检索缓存，不替代正式闭环

也就是说：

```text
active_context -> context track -> archive
```

没成功 `track`，不算可靠闭环。

根据进度，选两种模式之一：

- **场景 A：随手修复、阶段性进展 (仅记录，不消灭任务)**
  ```bash
  # Unix / Bash
  ./.evo-lite/mem context track --mechanism="缓存优化机制" --details="发现在高并发下的死锁问题，通过引入锁机制解决..."

  # Windows PowerShell / CMD
  .\.evo-lite\mem.cmd context track --mechanism="缓存优化机制" --details="发现在高并发下的死锁问题，通过引入锁机制解决..."
  ```
  *(注：机制名必须简短，details 必须详尽包含前因后果)*

- **场景 B：彻底完成 Backlog 任务 (记录并消除任务)**
  前往 `.evo-lite/active_context.md` 的 `<BEGIN_BACKLOG>` 区域，找你刚完成任务的 **4位哈希 ID (例如 `[a1b2]`)**。
  ```bash
  # Unix / Bash
  ./.evo-lite/mem context track --mechanism="1:N架构完结" --details="长文本向量入库完成，状态标记补齐..." --resolve="a1b2"

  # Windows PowerShell / CMD
  .\.evo-lite\mem.cmd context track --mechanism="1:N架构完结" --details="长文本向量入库完成，状态标记补齐..." --resolve="a1b2"
  ```
  *(注：必须传入绝对准确的 4 字符 Hash 以避免误删)*

### 3. 认知闭环与汇报 (Cognitive Closure)
步骤 2 跑完后，CLI 会输出归档结果、轨迹更新结果和可选任务消除结果。
- CLI 当前不会自动创建额外 Meta-Commit；如需提交状态文件，请按下面的“显式 Meta-Commit”标准动作执行。
- **强制要求：** 必须根据 CLI 实际输出确认是否已完成 backlog 消除、轨迹更新和归档，然后再向 User 汇报下一步。
- 若 CLI 只更新了状态机、但归档失败或被跳过，不得宣称本次闭环已经完整完成。

#### 标准附加动作：显式 Meta-Commit (Runtime State Snapshot)

只要步骤 2 已经返回 `closure: complete`，并且 `context track` 产出了新的受追踪运行时状态文件（典型如 `.evo-lite/active_context.md`、本次新增的 `raw_memory/*.md`），就把它当成 **同一次 `/commit` 的标准后继动作** 执行：

1. **单独开一个状态提交，不要混进代码快照**。这个提交只用于版本化 `.evo-lite/active_context.md`、本次新增的 `raw_memory/*.md`，以及你明确知道属于本次闭环产物的其他运行时状态文件。
2. **这仍然属于同一次 `/commit`，但不是同一个 Git commit object**。代码快照已经在步骤 1 固化，后续 `context track` 才生成运行时状态文件，所以这些文件在 Git 语义上只能进入紧随其后的独立 Meta-Commit。
3. **这是附加提交，不是重新跑一次闭环**。执行这个 Meta-Commit 后，**不要**再对这次状态提交追加第二轮 `context track`，否则会把“提交状态文件”再次写成新的轨迹，形成递归闭环。
4. **口径上必须和代码快照分开汇报**。先说明代码提交是否完成，再说明是否额外执行了 runtime state 的 Meta-Commit。

示例：

```bash
# Unix / Bash
git add .evo-lite/active_context.md .evo-lite/raw_memory/
git commit -m "chore(meta): snapshot evo-lite runtime state"

# Windows PowerShell / CMD
git add .evo-lite/active_context.md .evo-lite/raw_memory/
git commit -m "chore(meta): snapshot evo-lite runtime state"
```

最终汇报收敛成 4 点，避开“看起来做完了、其实没闭环”：

1. **代码快照**：本次 `git commit` 是否已完成。
2. **闭环状态**：`context track` 输出的是 `closure: complete` 还是 `closure: partial`。
3. **任务状态**：如果用了 `--resolve`，明确说明 backlog 是否真的被消除。
4. **最小下一步**：若闭环完整且 `context track` 产出了受追踪运行时状态文件，就执行上面的显式 Meta-Commit；若闭环完整且没有新的运行时状态文件要版本化，就告知用户可以继续下一个任务；若闭环不完整，就明确指出先补哪一项。

推荐口径：

- 当 `closure: complete` 时，再向 User 说“本次修改已经可靠闭环”。
- 当 `closure: partial` 时，只能说“代码已提交，但 archive / context / resolve 仍需补救”，不得报喜。