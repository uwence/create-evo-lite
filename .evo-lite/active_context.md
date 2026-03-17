# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->
> **更新时间**: 2026-03-17
> **项目状态**: 已完成 v1.5.3 交互式模型重构与防呆拦截机制。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
<!-- END_META -->

## 🎯 当前焦点
<!-- BEGIN_FOCUS -->
暂无焦点（刚完成 v1.5.2 语义隔离引擎，进入静默节点）。

## 🚧 活跃任务 (≤ 5 条)
<!-- BEGIN_BACKLOG -->

- [ ] 开展对纯 Node.js ONNX RAG 架构的长周期稳定性与内存泄漏排查。
- [ ] 验证 `/mem` 协议在跨会话状态继承中的表现。
- [ ] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。

<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)
<!-- BEGIN_TRAJECTORY -->
- [2026-03-17] 测试带时间戳的 Raw Memory 归档文件名
- [2026-03-17] 修复 /mem Catch-22 死锁：通过补充 --details 参数彻底解耦了短文本（删除 Backlog）与长文本（向量入库）的约束冲突，完成 v1.5.2 架构闭环。
- [2026-03-17] 完成 v1.5.2 核心重构：引入了 Raw Memory 1:N 结构化分离引擎，支持 Symptom 和 Solution 分离提取映射。
- [2026-03-15] 完成 v1.5.0 锚点隔离与定向写入架构。
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)
> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。
- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。