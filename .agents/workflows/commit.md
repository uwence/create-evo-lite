---
description: 核心高频协议：代码提交、轨迹追踪与任务闭环
---
# 🚀 追踪与闭环协议 (/commit)

当你在当前会话中**完成了一次功能修改、Bug 修复、或取得了阶段性进展时**，必须执行本协议。
本协议是 Evo-Lite 架构中最高频的核心协议，它确保了你的代码动作被转化为可检索的长文本向量记忆，并自动维护任务状态的大盘。

// turbo-all
**执行步骤 (严格按顺序执行，禁止跨级或跳过):**

### 1. 代码快照 (Code Commit)
完成代码编写后，立刻执行标准的 Git 提交，以锁定代码快照。
**注意：工作区（除 `.evo-lite` 目录外的所有受追踪文件）必须保持 clean 状态，否则后续脚本将抛出致命错误并强制打回！**
```bash
git add .
git commit -m "fix(module): 解决了某某问题"
```

### 2. 轨迹写入与认知刷新 (Context Track)
代码提交后，通过底层状态机 CLI 记录动作轨迹。CLI 会自动抓取刚才的 Commit Hash、更新 `active_context.md` 的 `FOCUS` / `BACKLOG` / `TRAJECTORY` 运行时区块，并进行结构化归档。
**致命错误：`active_context.md` 是一个状态机。涉及任务、轨迹、焦点的修改都必须通过 `./.evo-lite/mem.cmd` 代理。严禁 Agent 直接使用文件写入工具修改这些运行时区块！`META` 区块当前没有专用 CLI 写入口，只有在确认不存在对应命令时，才允许最小范围的人工维护。如果你检测到自己或任何其他 Agent 正在尝试直接修改 `FOCUS`、`BACKLOG`、`TRAJECTORY` 任一区块，必须立即中止并发出告警。**

请始终记住 Evo-Lite 的主流转模型：

- `active_context.md` 负责“现在正在做什么”
- `context track` 负责把“刚刚完成了什么”沉淀出去
- `archive` 负责保存长期资产
- `remember` 只是轻量检索缓存，不替代正式闭环

也就是说：

```text
active_context -> context track -> archive
```

没有成功 `track`，就不算一次可靠闭环。

根据你的进度，选择以下两种模式之一：

- **场景 A：随手修复、阶段性进展 (仅记录，不消灭任务)**
  ```bash
  .\.evo-lite\mem.cmd context track --mechanism="缓存优化机制" --details="发现在高并发下的死锁问题，通过引入锁机制解决..."
  ```
  *(注：机制名必须简短，details 必须详尽包含前因后果)*

- **场景 B：彻底完成 Backlog 任务 (记录并消除任务)**
  前往 `.evo-lite/active_context.md` 的 `<BEGIN_BACKLOG>` 区域，找到你刚才完成的任务的 **4位哈希 ID (例如 `[a1b2]`)**。
  ```bash
  .\.evo-lite\mem.cmd context track --mechanism="1:N架构完结" --details="长文本向量入库完成，状态标记补齐..." --resolve="a1b2"
  ```
  *(注：必须传入绝对准确的 4 字符 Hash 以避免误删)*

### 3. 认知闭环与汇报 (Cognitive Closure)
在执行完步骤 2 的命令后，CLI 会输出归档结果、轨迹更新结果和可选的任务消除结果。
- CLI 当前不会自动创建额外的 Meta-Commit；如需提交状态文件，请由当前会话显式决定并执行。
- **强制要求：** 你必须根据 CLI 实际输出确认是否已完成 backlog 消除、轨迹更新和归档，然后再向 User 汇报下一步。
- 若 CLI 只更新了状态机、但归档失败或被跳过，不得宣称本次闭环已经完整完成。

建议把最终汇报收敛成 4 个要点，避免“看起来做完了、其实没闭环”的模糊表达：

1. **代码快照**：本次 `git commit` 是否已完成。
2. **闭环状态**：`context track` 输出的是 `closure: complete` 还是 `closure: partial`。
3. **任务状态**：如果使用了 `--resolve`，明确说明 backlog 是否真的被消除。
4. **最小下一步**：若闭环完整，就告知用户可以继续下一个任务；若闭环不完整，就明确指出先补哪一项。

推荐口径：

- 当 `closure: complete` 时，再向 User 说“本次修改已经可靠闭环”。
- 当 `closure: partial` 时，只能说“代码已提交，但 archive / context / resolve 仍需补救”，不得报喜。
