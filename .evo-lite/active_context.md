# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **更新时间**: 2026-03-21
> **项目状态**: v2.0.5 — 完成初始化依赖补强、根目录纪律约束、verify/reranker 降级状态持久化与启动边界澄清；下一阶段转向 workflow 兼容 Codex 与 Claude Code。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
下一阶段主线：梳理并改造现有 workflow/rules/CLI 提示，使 Evo-Lite 在 Codex 与 Claude Code 两种 agent 环境下都能稳定工作。重点检查 slash workflow 口径、路径与终端语法假设、状态机写入口限制，以及哪些协议当前带有单一宿主假设。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] 暂无活跃任务。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [8dc12e3] 2026-03-20 RootHostAdapters: Introduced the first host adapter slice for Codex and Claude Code. New projects now emit root-level 
- [86a2cfc] 2026-03-20 ShellAwareWorkflowDocs: Extended the Codex and Claude Code compatibility pass beyond mem entrypoints into shell semantics. T
- [eb43318] 2026-03-20 HostAwareMemEntrypoints: Clarified the workflow and rule contracts so Evo-Lite no longer assumes a single mem.cmd-only comman
- [9f358b1] 2026-03-20 ActiveContextBeforeRecall: Clarified the debugging retrieval order so agents must inspect active_context.md before deciding to
- [9de7dd8] 2026-03-20 EvoVerifyTakeoverSync: Tightened the /evo takeover contract so the agent must wait for mem.cmd verify to exit before summar
- [73ba4c8] 2026-03-20 InitTrackBootstrap: Fixed a fresh-project initialization regression where the first context track path could hit archive
- [a4be939] 2026-03-20 RecallFirstDebugging: Updated the evo-lite debugging contract so agents should prefer recall before blind trial-and-error
- [73c6b70] 2026-03-20 RerankerDegradePersistence: Changed verify and model-loading behavior so reranker download failures no longer spam retries on ev
- [c8b5da5] 2026-03-20 WorkspaceRootDiscipline: Hardened the evo-lite protocol against agents inventing nested wrapper directories like project/, ap
- [2bf2424] 2026-03-20 InitStartupHardening: Fixed two concrete initialization regressions found from a fresh generated project. First, the scaff
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
