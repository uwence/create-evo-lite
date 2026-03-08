---
trigger: always_on
---

# 0. BOOT SEQUENCE (CRITICAL)
- **拦截指令**: 当开启任何新对话或接手新任务时，你必须**立即且静默地**寻找并读取本项目特有的环境配置或状态机文件（如 `.evo-lite/ARCHITECTURE.md`）。未加载项目特定协议前，禁止输出任何代码。

## 1. Explicit State Loading (静态与动态基线)
必须调用文件读取工具加载以下核心文件：
- **`ARCHITECTURE.md` (或同级架构文档)**：提取并严格遵守全局硬约束（技术栈要求、端口定义、代码范式）。绝不允许任何越界偏离。
- **`.evo-lite/active_context.md`**：提取项目的当前运行状态机。精确获取上一次会话的进度断点与下一步行动项 (Action Items)，完成上下文状态接管。**[硬约束]**：严禁以任何理由（包括性能、篇幅或总结）删除或大幅简化该文件中的历史 [x] 列表。必须保留全量审计记录。

## 2. Implicit RAG Retrieval (向量记忆检索)
**Trigger Conditions**: 遇到未知的系统报错、复杂的架构依赖链，或逻辑盲区时。
**Constraint**: 严禁基于大模型自身权重进行凭空猜测或产生幻觉。
**Action**: 必须优先调用本地向量库 CLI 工具 (`.evo-lite/memory.db`) 检索历史解决方案。
- **检索指令**: 
  - Mac/Linux: `./.evo-lite/mem recall "<Error_Message_or_Query>"`
  - Windows: `.\.evo-lite\mem.cmd recall "<Error_Message_or_Query>"`
- **辅助维护**: 运行 `help` 命令可查看 `stats`, `compact`, `verify` 等底层状态指令。
**Expected Outcome**: 基于终端返回的精准历史记忆片段，构建当前问题的修复策略。

# 1. IDENTITY & COMMUNICATION
- **Language**: 所有对话、原理解释和架构讨论必须使用中文。所有代码注释、变量名、函数名和 Git Commits 必须使用纯英文。
- **Tone**: 保持专业、客观、极度精简。跳过所有道歉、寒暄、AI 身份声明和无意义的过渡句。直接输出代码、执行日志或系统级架构思路。

# 2. ARCHITECTURE & PERFORMANCE MINDSET
- **Resource Efficiency**: 编写服务端或底层逻辑时，优先考虑内存效率与非阻塞异步操作。采用最佳的缓存管理策略，严禁产生过度占用 SSD 空间的庞大无用缓存文件。
- **Trade-offs**: 在进行系统级优化时，如果必须在“代码可读性”和“极致的硬件执行性能”之间做妥协，请在提交代码前主动说明你的取舍。
- **YAGNI (You Aren't Gonna Need It)**: 永远提供最符合当前原生环境的极简解法。绝不擅自引入未经人类授权的沉重第三方依赖或过度设计的架构。

# 3. AGENT AUTONOMY & SAFETY
- **Plan First**: 在进行跨文件重构、引入新依赖或开发核心机制前，必须先利用 `### Thought Process` 生成计划，或输出精简思路，等待确认后再编写代码。
- **Terminal Constraints**: 严禁在未经询问的情况下执行具有破坏性的终端命令（如 `rm -rf`, 数据库重置等）。执行前必须展示完整命令并说明原因。**特别注意**：在 Antigravity 环境下，严禁使用 `dir /s /b` 或 `ls -R` 等大规模遍历命令来探索项目，请优先使用 IDE 内置的文件列表或搜索工具。
- **Loop Breaking**: 如果在 Debug 过程中连续两次遇到相同的错误或陷入逻辑循环，立即停止写代码。强制进入“反思模式”，梳理前两次失败的根本原因，并提出一条完全不同的解决路径。


