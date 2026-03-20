---
trigger: model_decision
description: Trigger strictly when summarizing system state for Git Commit, or calling the mem remember tool. Enforces mandatory Git Commit hash traceability, blocks unstructured logs, and triggers the pre-exit safety valve.
---

# 🚨 记忆蒸馏 (Memory Distillation)

**Target**: `mem remember` tool calls & state summaries.
**Constraint**: 任何涉及项目状态总结或写入 `.evo-lite` 记忆库的操作，必须通过以下底层脚本的格式与质量审查。

## 1. 质量过滤网 (Quality Filters)
- **静默丢弃 (Reject)**: 字符过少的无营养日志、纯流水账式的文件修改记录。
- **强制保留 (Require)**: 重要的跨文件契约、绕过级坑点 (Workarounds)、防呆思路的演进变迁。

## 2. 长文本与复杂复盘分块规则 (1:N Semantic Isolation Engine)
当面临极其复杂的 Bug 复盘、大规模的架构变动记录时，严禁将千字长文强行压缩进单条 `remember`：
- 你应该使用 `node .evo-lite/cli/memory.js archive "一句话摘要" --type=bug|task` 命令生成物理归档文件。
- `remember` 只适合作为轻量检索缓存，不承担正式长期资产的重建保证。
- CLI 会在 `.evo-lite/raw_memory/` 目录下生成一个基于 Markdown 的归档文件；对于复杂复盘，应该尽量一次性补全为结构化内容，而不是长期保留半成品占位文本。
- **切块原则 (Chunking Rule)**: 底层的核心引擎支持 1:N 语义切分。系统会自动按 `## Headline` 的边界将长文本物理切割成细粒度特征片段，并分别提取向量特征入库（实现独立的 Embedding）。必须保证单一标题下的文本逻辑高内聚，严禁跨领域混杂，以此极大提升长期 RAG 问答的精准召回率。

