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
- [83af489] 2026-05-12 CommanderCliRouting: Completed the commander.js CLI migration for create-evo-lite. Refactored the public scaffold entrypo
- [9aa0b88] 2026-05-12 VerifySyncStabilization: Stabilized the live regression suite after the RTK and governance work. Rebound the primary test run
- [29d6597] 2026-05-12 RtkHookGovernance: Imported the portable RTK rewrite hook into root and template assets, registered it in scaffold and
- [7be4c52] 2026-05-12 ArchitectureGuardHooks: Hardened the PreToolUse governance path across live and template runtime assets. Added target-aware
- [a5ec6b8] 2026-05-12 HookRuntimeDogfood: Completed live runtime hook dogfood and Codex workflow semantics clarification. Added hooks, MCP det
- [3569d63] 2026-05-07 LocalIndexDeModelCleanup: 完成 create-evo-lite 的去模型化收口：修正 index.js 初始化日志中的 ONNX/跨模型残留；把 root/template workflow 与 Claude command
- [f1e2988] 2026-03-21 LegacyUpgradeGate: Blocked in-place upgrade for npm-published 1.4.9-era runtimes by detecting pre-2.0 context/template/
- [913c0d1] 2026-03-20 VerifyHostAdapterDrift: Extended verify so template sync is no longer limited to the active CLI files. It now compares root
- [d82ea6a] 2026-03-20 ClaudeCommandWrappers: Added the first thin Claude-native command layer on top of Evo-Lite semantics. Projects now scaffold
- [8dc12e3] 2026-03-20 RootHostAdapters: Introduced the first host adapter slice for Codex and Claude Code. New projects now emit root-level
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
