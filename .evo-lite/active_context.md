# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->
> **更新时间**: 2026-03-17
> **项目状态**: v1.5.0 稳定 → 已完成 v1.5.1 raw_memory 流水线。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
<!-- END_META -->

## 🎯 当前焦点
<!-- BEGIN_FOCUS -->
暂无焦点（刚完成 v1.5.1 raw_memory 三层架构与跨会话状态管道，进入静默节点）。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)
<!-- BEGIN_BACKLOG -->

- [ ] 开展对纯 Node.js ONNX RAG 架构的长周期稳定性与内存泄漏排查。
- [ ] 验证 `/mem` 协议在跨会话状态继承中的表现。
- [ ] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 3 条)
<!-- BEGIN_TRAJECTORY -->
- [2026-03-17] 完成 v1.5.1 raw_memory 三层流水线（context, archive, vectorize）的 CLI 命令开发，打通锚点隔离与自动流转闭环。
- [2026-03-15] 完成 v1.5.0 锚点隔离机制：改造 templates/active_context.md、mem.md、evo.md、rules/evo-lite.md 及 index.js 热更新警告，实现四区块锚点定向写入防漂移架构。
- [2026-03-10] 完成 v1.4.9 自动化补完：修复 `--yes` 静默模式下迁移逻辑失效问题。
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)
> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。
- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。