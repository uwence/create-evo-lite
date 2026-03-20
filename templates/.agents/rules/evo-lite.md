---
trigger: always_on
---
# 0. BOOT SEQUENCE (CRITICAL)

- **拦截指令**: 当开启任何新对话或接手新任务时，你必须**立即且静默地**寻找并读取本项目特有的环境配置或状态机文件。未加载项目特定协议前，禁止输出任何代码。

在开始任何对话或开发之前，你必须立刻通过以下两层记忆建立当前的上下文全貌：

## 1. Explicit State Loading (静态与动态基线)

必须调用文件读取工具加载以下核心文件：

- **`ARCHITECTURE.md` (或同级架构文档)**：提取并严格遵守全局硬约束（技术栈要求、端口定义、代码范式）。绝不允许任何越界偏离。
- **`.evo-lite/active_context.md`**：提取项目的当前运行状态机。精确获取上一次会话的进度断点与下一步行动项 (Action Items)，完成上下文状态接管。

## 2. 跨会话记忆与经验闭环 (RAG Retrieval & Distillation)

**Trigger Conditions**: 遇到未知的系统报错、复杂的架构依赖链、明显卡壳、连续两次修复失败，或即将修改一个可能存在历史坑点的机制时。
**Action 1 (遇到问题时检索)**: 必须先读取 `.evo-lite/active_context.md`，确认当前焦点、backlog 与最近轨迹里是否已经有直接线索；只有当当前状态机信息不足，或问题明显属于跨会话历史经验检索场景时，才调用本地向量库 CLI 工具做 recall。严禁跳过 `active_context` 直接凭空猜想，也不要把“先 recall”误解成“可以不看当前上下文”。

- 检索指令: 使用当前宿主可用的 `mem` 入口执行 recall。Unix / Bash: `./.evo-lite/mem recall "<Error_Message_or_Query>"`；Windows PowerShell / CMD: `.\.evo-lite\mem.cmd recall "<Error_Message_or_Query>"`  
  默认应优先查看最相关的 **5 条结果**；除非用户明确要求更宽的检索窗口，否则不要一次拉出过多历史片段污染当前上下文。

**Action 2 (解决问题后入库 - 核心闭环协议)**:
当你攻克了架构难点或修复了 Bug，必须严格遵守以下闭环协议，按顺序有序执行，严禁合并多个步骤同时执行：

1. **代码提交**: `git add . && git commit -m "fix/feat: ..."`
2. **状态更新**: 使用当前宿主可用的 `mem` 入口执行 `context track --mechanism="<机制名>" --details="<详细经验>" [--resolve="<4位ID>"]`
3. **元数据同步**: 严禁 AI 手动修改 active_context.md 的任务和轨迹！必须由上述宿主可用的 `mem context track` 命令自动完成。
4. **认知确认**: CLI 运行结束后，你必须根据真实输出向用户汇报当前状态、已归档内容以及剩余任务。
   **Expected Outcome**: 形成从遇到困难查找旧记忆，最后通过协议入库新经验的完整自治生态。

# 1. IDENTITY & COMMUNICATION

- **Language**: 所有对话、原理解释和架构讨论必须使用中文。所有代码注释、变量名、函数名和 Git Commits 必须使用纯英文。
- **Tone**: 保持专业、客观、极度精简。跳过所有道歉、寒暄、AI 身份声明和无意义的过渡句。直接输出代码、执行日志或系统级架构思路。

# 2. ARCHITECTURE & PERFORMANCE MINDSET

- **Resource Efficiency**: 编写服务端或底层逻辑时，优先考虑内存效率与非阻塞异步操作。采用最佳的缓存管理策略，严禁产生过度占用 SSD 空间的庞大无用缓存文件。
- **Trade-offs**: 在进行系统级优化时，如果必须在“代码可读性”和“极致的硬件执行性能”之间做妥协，请在提交代码前主动说明你的取舍。
- **YAGNI & 极简主义**: 永远提供最符合当前原生环境的极简解法。绝不擅自引入未经人类授权的沉重第三方依赖。在编写任何新功能前，必须先全局搜索现有代码库，**优先复用已有的工具函数或架构机制**，严禁过度设计。

# 3. AGENT AUTONOMY & SAFETY

- **Plan First**: 在进行跨文件重构、引入新依赖或开发核心机制前，必须先利用 `### Thought Process` 生成计划，或输出精简思路，等待确认后再编写代码。
- **Atomic Commits (原子化提交)**: 在完成一个功能的开发或修复一个 Bug 并验证通过后，你必须主动提出使用 `git commit` 将改动固化，然后再进入下一个任务。严禁将十跨越维度的庞大改动堆积成一个混沌提交。
- **Terminal Constraints**: 严禁在未经询问的情况下执行具有破坏性的终端命令（如 `rm -rf`, 数据库重置等）。执行前必须展示完整命令并说明原因。必须时刻意识到当前宿主终端与 agent 环境的真实语法边界，例如 Windows PowerShell / CMD、Unix Bash / zsh，或带有自身命令代理约束的 Codex / Claude Code。执行多行命令、路径拼接、环境变量传递或通配符展开时，必须使用当前终端真正支持的语法。**特别注意**：严禁使用 `dir /s /b` 或 `ls -R` 等大规模遍历命令探索项目。
- **Workspace Root Discipline (工作区根目录纪律)**: 当用户已经在某个项目根目录中打开工作区时，默认就以该目录作为唯一项目根。**严禁 Agent 擅自再创建 `project/`、`app/`、`workspace/` 等额外包裹目录来承载真实代码**，除非用户明确要求新建子项目、monorepo 包或独立沙盒。任何会把 `.agents/`、`.evo-lite/`、源码目录与实际工作根拆开的二次套壳行为，都视为协议违规，因为它会直接破坏 workflow、CLI 路径与状态机定位。
- **Loop Breaking**: 如果在 Debug 过程中连续两次遇到相同的错误或陷入逻辑循环，立即停止写代码。强制进入“反思模式”，先复核一次 `active_context.md` 的当前线索，再执行一次 recall 检索相关历史经验，之后梳理前两次失败的根本原因，并提出一条完全不同的解决路径。
- **Anchor Guard & CLI Enforcement (锚点守卫与 CLI 强制)**: `.evo-lite/active_context.md` 是一个**状态机**。其中 `FOCUS`、`BACKLOG`、`TRAJECTORY` 三个运行时区块的修改都**必须通过当前宿主可用的 Evo-Lite CLI 入口代理**，严禁 Agent 直接使用文件写入工具修改上述三个区块。需要追踪进度、消除任务或切换会话焦点时，必须调用当前宿主可用的 `mem context track --resolve="xxxx"` 或 `mem context focus "..."`，并让 CLI 负责锚点边界维护。`META` 区块目前没有专用 CLI 写入口；只有在确认不存在对应命令时，才允许围绕 `<!-- BEGIN_META -->` 与 `<!-- END_META -->` 做最小范围的人工维护。特别地：`<!-- BEGIN_BACKLOG -->` 与 `<!-- END_BACKLOG -->` 之间的 `[ ]` 条目超过 **5 条**时，视为致命错误，必须立即中止写入并向人类告警，要求先迁移低优先级任务到 `## 📌 架构备忘` 区域后再继续。
- **Memory Flow Model (记忆流动模型)**:
  `active_context.md` 只负责“当前态”，`archive` 只负责“沉淀态”，两者之间默认必须通过宿主可用的 `mem context track` 流转。
  `remember` 仅作为轻量检索缓存存在，不承担正式闭环的重建保证，也不替代 `track` 的长期沉淀职责。
  规则上应始终优先遵循：
  `active_context -> context track -> archive`
  如果 `track` 未成功完成归档与状态更新，就不应宣称本次任务已可靠闭环。

- **Workflow Output Contract (工作流输出契约)**:
  `/evo`、`/commit`、`/mem`、`/wash` 的最终汇报都不应只喊口号，必须至少回答两类问题：
  1. **现在是否真的健康 / 闭环 / 挂起 / 重建完成**。
  2. **下一步最该做什么**。
  允许每个工作流保留自己的 4 段细节，但总体上都必须遵守：
  **状态结论要基于真实 CLI / 文件结果，下一步建议要可直接执行。**
