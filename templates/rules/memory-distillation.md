---
trigger: model_decision
description: Trigger strictly when summarizing system state for Git Commit, or calling the mem remember tool. Enforces mandatory Git Commit hash traceability, blocks unstructured logs, and triggers the pre-exit safety valve.
---

# 🚨 记忆蒸馏 (Memory Distillation)

**Target**: `mem remember` tool calls & state summaries.
**Constraint**: 任何涉及项目状态总结或写入 `.evo-lite` 记忆库的操作，必须通过以下底层脚本的格式与质量审查。

## 1. 容量守卫 (Capacity Lock) - 强制约束
**CRITICAL**: Evo-Lite 记忆库拥有硬编码的 **30 条记忆容量上限**。
- 当探针或执行写入时发现碎片池达到 30 条，系统将触发**满载熔断**，拒绝任何新记忆录入。
- **强制动作**: 你必须立即停止手头工作，执行 `/mem` 协议，或直接运行终端命令 `node .evo-lite/cli/memory.js compact` 进入深度清理流程。
- **清理规范**: 严格按照 `MEMORIES_TO_COMPACT.md` 中的指示，将 30 条零散日志**降维打击式总结 (Distill)** 为 3-5 条高维度的架构级结论并重新存入，最后物理销毁旧数据。

## 2. 质量过滤网 (Quality Filters)
- **静默丢弃 (Reject)**: 字符过少的无营养日志、纯流水账式的文件修改记录。
- **强制保留 (Require)**: 重要的跨文件契约、绕过级坑点 (Workarounds)、防呆思路的演进变迁。

## 3. 强校验溯源格式 (Format Schema Enforcement)
写入的日志必须严格遵循以下结构，任何偏离都会导致底层脚本拒收：
```text
1. [主题词 A]: [技术细节记录]。(溯源历史点: [Commit: <hash1>, <hash2>])
2. [契约词 B]: [防御机制]。(溯源历史点: [Commit: <hash3>])
```