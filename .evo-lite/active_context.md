# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **更新时间**: 2026-03-19
> **项目状态**: v2.0.3 — 彻底重构了 memory 服务底座，全面拆解 db.js, models.js，加上 SQLite WAL 锁防护，完成 CLI 和 templates 的全链路自动化测试与文件同步校验。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
dogfooding verify 已恢复到无活跃告警状态。当前主焦点：整理本轮自循环修复（SQLite 兼容回退、CRLF archive 兼容、sync 补标记、状态机锚点修复），并决定是否按 /commit 闭环沉淀。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->

<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [RuntimeSelfHeal] 2026-03-20 Dogfooding runtime entered a self-healing loop: verify initially crashed on the local SQLite runtime
- [并发容错与自检增强] 2026-03-19 为数据库插入了WAL并发保护和模型降级重启表机制，在verify命令中增加模板文件同步检测\n- [QA_TEST] 2026-03-19 Verified memory core loop\n
- [5f3a641] 2026-03-18 Architecture Refactor: Decoupled the init script (index.js) from the template structure by implementing a recursive copy me
- [4bc99ac] 2026-03-18 Rule Enforcement: Strengthened the rules in evo-lite.md and commit.md to make direct modification of active_context.md
- [492ae57] 2026-03-18 Config Alignment: Aligned track truncation limit to 100 characters in memory.js and synced with templates.
- [c8efc63] 2026-03-18 File Naming Protocol: Updated memory file naming to ...
- [b37c512] 2026-03-18 Wash Protocol: Updated Wash Protocol with seq...
- [bc5df8f] 2026-03-18 跨会话继承: 通过 E2E 项目生成和模拟 Agent 唤醒，验证了跨会话...
- [9de40fe] 2026-03-18 测试闭环: 这是一条极其严谨的测试记录，用于验证在无 dirty cod...
- [2026-03-17] 开展对纯 Node.js ONNX RAG 架构的长周期稳定性与内存泄漏排查。
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
