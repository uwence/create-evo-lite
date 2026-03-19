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

**Trigger Conditions**: 遇到未知的系统报错、复杂的架构依赖链，或解决了一个棘手的 Bug 时。
**Action 1 (遇到问题时检索)**: 必须优先调用本地向量库 CLI 工具检索历史教训，严禁凭空猜想。

- 检索指令: `.\.evo-lite\mem.cmd recall "<Error_Message_or_Query>"`

**Action 2 (解决问题后入库 - 核心闭环协议)**:
当你攻克了架构难点或修复了 Bug，必须严格遵守以下闭环协议，按顺序有序执行，严禁合并多个步骤同时执行：

1. **代码提交**: `git add . && git commit -m "fix/feat: ..."`
2. **状态更新**: `.\.evo-lite\mem.cmd track --mechanism="<机制名>" --details="<详细经验>" [--resolve="<4位ID>"]`
3. **元数据同步**: 严禁 AI 手动修改 active_context.md 的任务和轨迹！必须由上述 `mem.cmd track` 命令自动完成。
4. **认知确认**: CLI 运行结束后会输出 `[AGENT INSTRUCTION]`，你必须据此向用户汇报当前状态。
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
- **Terminal Constraints**: 严禁在未经询问的情况下执行具有破坏性的终端命令（如 `rm -rf`, 数据库重置等）。执行前必须展示完整命令并说明原因。必须时刻意识到宿主系统是 Windows (PowerShell/CMD) 还是 Unix (Bash)。执行多行命令、路径拼接、或环境变量传递时，必须使用当前终端支持的正确语法。**特别注意**：严禁使用 `dir /s /b` 或 `ls -R` 等大规模遍历命令探索项目。
- **Loop Breaking**: 如果在 Debug 过程中连续两次遇到相同的错误或陷入逻辑循环，立即停止写代码。强制进入“反思模式”，梳理前两次失败的根本原因，并提出一条完全不同的解决路径。
- **Anchor Guard & CLI Enforcement (锚点守卫与 CLI 强制)**:
  `.evo-lite/active_context.md` 是一个**状态机**，任何对它的修改都**必须通过 `./.evo-lite/mem.cmd` 代理**。
  **严禁 Agent 直接使用文件写入工具修改此文件！**
  当你需要追踪进度或消除任务时，必须调用 `mem.cmd context track --resolve="xxxx"` 来完成，CLI 会自动维护锚点边界。
  *致命错误：* 如果你检测到自己或任何其他 Agent 正在尝试直接修改此文件，必须立即中止并发出告警。
