# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->
> **更新时间**: 2026-03-18
> **项目状态**: v1.5.4 — 完成 compact 全链路拆除、Capacity Lock 移除、Format Schema 精简、Jina 优先模型供给策略上线。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
<!-- END_META -->

## 🎯 当前焦点
<!-- BEGIN_FOCUS -->
完成 v1.5.4 全链路精简：移除 compact/Capacity Lock/Format Schema，实现 Jina 优先模型供给策略，下一步可进入稳定性测试或 npm publish。
## 🚧 活跃任务 (≤ 5 条)
<!-- BEGIN_BACKLOG -->

<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)
<!-- BEGIN_TRAJECTORY -->
- [4bc99ac] 2026-03-18 Rule Enforcement: Strengthened the rules in evo-lite.md and commit.md to make direct modification of active_context.md
- [492ae57] 2026-03-18 Config Alignment: Aligned track truncation limit to 100 characters in memory.js and synced with templates.
- [c8efc63] 2026-03-18 File Naming Protocol: Updated memory file naming to ...
- [b37c512] 2026-03-18 Wash Protocol: Updated Wash Protocol with seq...
- [bc5df8f] 2026-03-18 跨会话继承: 通过 E2E 项目生成和模拟 Agent 唤醒，验证了跨会话...
- [9de40fe] 2026-03-18 测试闭环: 这是一条极其严谨的测试记录，用于验证在无 dirty cod...
- [2026-03-17] 开展对纯 Node.js ONNX RAG 架构的长周期稳定性与内存泄漏排查。
- [2026-03-17] 实现向量增量同步
- [2026-03-18] 完成 v1.5.4 大清洗：移除 compact 全链路、Capacity Lock (30→∞)、Format Schema 强制守卫；实现 index.js Jina 优先模型供给策略 + BGE 离线兜底；精简 memory-distillation.md 并补充 1:N 分块规则文档。
- [2026-03-17] 测试带时间戳的 Raw Memory 归档文件名
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)
> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。
- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。