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
- [1f8eb6c] 2026-05-13 BaselineInitCommit: Completed the fresh-repo bootstrap hardening pass for create-evo-lite. The scaffold entry now ensure
- [bc1ae84] 2026-05-13 BootstrapFlowHardening: Closed the dogfood feedback loop for empty-repo onboarding and takeover friction. The scaffold now a
- [39d7cfc] 2026-05-13 HookOwnershipBoundary: Completed the Evo-Lite hook-ownership boundary split for scaffolded host assets. Narrowed managed Gi
- [62e6dda] 2026-05-13 RuntimeBoundaryGuardrails: Added session_events observability as non-durable telemetry, introduced context events read path, an
- [daf68c1] 2026-05-13 GitNexusLocalHookRefresh: Switched the Codex GitNexus post-tool hook from localhost-service-first behavior to a local-CLI-firs
- [df7e188] 2026-05-13 CodexHookBridge: Completed the Codex-native hook integration pass for create-evo-lite. Added project and template .co
- [83af489] 2026-05-12 CommanderCliRouting: Completed the commander.js CLI migration for create-evo-lite. Refactored the public scaffold entrypo
- [9aa0b88] 2026-05-12 VerifySyncStabilization: Stabilized the live regression suite after the RTK and governance work. Rebound the primary test run
- [29d6597] 2026-05-12 RtkHookGovernance: Imported the portable RTK rewrite hook into root and template assets, registered it in scaffold and
- [7be4c52] 2026-05-12 ArchitectureGuardHooks: Hardened the PreToolUse governance path across live and template runtime assets. Added target-aware
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
