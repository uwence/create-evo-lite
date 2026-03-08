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

## 2. 强校验溯源格式 (Format Schema Enforcement)
写入的日志必须严格遵循以下结构，任何偏离都会导致底层脚本拒收：
```text
1. [主题词 A]: [技术细节记录]。(溯源历史点: [Commit: <hash1>, <hash2>])
2. [契约词 B]: [防御机制]。(溯源历史点: [Commit: <hash3>])