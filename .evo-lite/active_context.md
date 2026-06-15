# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **更新时间**: 2026-03-21
> **项目状态**: v2.0.5 — 完成初始化依赖补强、根目录纪律约束、verify/reranker 降级状态持久化与启动边界澄清；下一阶段转向 workflow 兼容 Codex 与 Claude Code。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
完成 live runtime hook dogfood 验证，并收口 Codex 工作流语义澄清相关改动；确认 AGENTS.md / README / runtime hooks 路径一致后进入提交准备。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] 暂无活跃任务。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [afe43c2] 2026-06-15 feat: Phase 4 drift engine complete. mem architecture diff (R001,R002,R007) + mem plan gaps (R003-R010). S
- [2d9d54d] 2026-06-15 feat: Phase 3 architecture scanner complete. 9/14 dogfood tasks done. mem architecture scan: 9 modules, 34
- [e3943e1] 2026-06-15 feat: Add /api/planning HTTP endpoint to inspector serving plan-ir.json. Add Planning nav tab with spec/pl
- [0a7cbb9] 2026-06-15 feat: Add mem plan status and mem plan scan commands. Markdown parser reads docs/specs/ and docs/plans/ in
- [a7a94f0] 2026-05-22 FTS5_Deplatform_Upgrade: 完成了 Evo-Lite 2.0 骨架架构重构与去平台化（De-platforming）。移除了 templates/ 下所有平台特定资产（如 .github, .codex, .claude 等），
- [45977cb] 2026-05-14 HookProvenanceSidecar: Stabilized the Codex stop-hook JSON contract, synced the managed workflow templates back into the tr
- [77f9a5a] 2026-05-14 WorkflowClosureHardening: Completed the managed template manifest pass, expanded recall-first takeover matching with alias/rul
- [4093d9c] 2026-05-14 WorkflowTemplateSync: Aligned root and template /evo workflow content, added .agents/workflows/evo.md to managed template-
- [229889e] 2026-05-14 RecallFirstTakeover: Implemented bounded recall-first takeover for bootstrap, mirrored live/template runtime and tests, d
- [1f8eb6c] 2026-05-13 BaselineInitCommit: Completed the fresh-repo bootstrap hardening pass for create-evo-lite. The scaffold entry now ensure
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
