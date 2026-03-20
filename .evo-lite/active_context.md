# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **更新时间**: 2026-03-21
> **项目状态**: v2.0.4 — 完成 verify 边界收口、Git 注入链健壮化、trajectory 标签修复与 dogfooding 资产整理；普通开发循环不再默认触发 verify，/evo 与恢复场景边界已澄清。
> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
下一阶段优先评估 Python/Go 等非 Node 轻量适配方案，并继续完善 raw_memory 原始层的抗毁性与可重建边界；如无新异常，普通开发循环不再默认触发 verify，只在 /evo 接管、重建后验收或 runtime 异常时执行。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] 暂无活跃任务。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [c8b5da5] 2026-03-20 WorkspaceRootDiscipline: Hardened the evo-lite protocol against agents inventing nested wrapper directories like project/, ap
- [2bf2424] 2026-03-20 InitStartupHardening: Fixed two concrete initialization regressions found from a fresh generated project. First, the scaff
- [790f3b9] 2026-03-20 VerifyScopeClarification: Clarified the protocol boundary for verify so it is treated as an /evo startup and runtime-recovery
- [ad6bfe6] 2026-03-20 InjectedCleanGitStatus: Fixed the git-status injection edge case so mem wrapper flows no longer confuse an intentionally emp
- [25caa9b] 2026-03-20 VerifyGitNoiseFilter: Unified the git-status filtering path used by both track and verify so pure .evo-lite runtime artifa
- [391ba68] 2026-03-20 MinimalTrajectoryFixCleanup: Reduced the trajectory-label fix back to the minimal long-term behavior: future context track entrie
- [a2709c7] 2026-03-20 TrajectoryHashRepair: Restored the trajectory label contract so square brackets carry the short commit hash instead of the
- [1a83470] 2026-03-20 Committed the dogfooding asset migration that aligned historical raw_memory archives and vect_memory
- [ca32c37] 2026-03-20 Completed the runtime hardening loop in two commits: first injected git metadata through mem wrapper
- [261f33c] 2026-03-20 Dogfooding runtime entered a self-healing loop: verify initially crashed on the local SQLite runtime
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
