# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
Rollout Stage 5: Project Control Dashboard default-on. Post-MVP planning.
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] 暂无活跃任务。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [d2226a5] 2026-06-16 rc-closure-phase2-prep: Two RC blockers resolved.

1. Hook order: post-commit-last-run.json now written BEFORE dashboard bui
- [b256b86] 2026-06-16 DogFood: Dogfood governance operator pass: hardened code-only post-commit governance, last-commit plan gaps,
- [ab967cb] 2026-06-16 mem plan gaps / plan trace / dashboard build / node fixtures/project-control/run-tests.js: dashboard+gaps: 完成 master spec §23 remaining production readiness — verify project_control struct, d
- [5a3009d] 2026-06-16 fix(archive): namespace fidelity fix complete: archive() writes namespace to raw_memory frontmatter, syncIndexMemo
- [498e12f] 2026-06-15 feat(providers): all three phases complete: plan:evo-lite-providers-mvp 8/8 complete. Phase 1 provider contract+config loader+scan-native loader
- [f9ed492] 2026-06-15 inspector-planning-layout: Planning tab redesigned: spec+plan grouped in cards, task list collapsible by default.
- [67d3ce7] 2026-06-15 mcp-phase3: MCP server 11/11 tasks complete. Phase 3: config sample + validation script (6/6 tools OK). plan:evo
- [44945f4] 2026-06-15 mcp-phase1-2: MCP server Phase 0+1+2 complete. 9/11 tasks done. 6 tools implemented and smoke-tested over stdio. R
- [3c1bfb6] 2026-06-15 stage5-upgrade: Two dogfood cycles complete. Rollout Stage 5: default-on.
- [3c1bfb6] 2026-06-15 dogfood-cycle-2: Cycle 2 stable: verify clean, arch-diff 0, plan-gaps R010x1 info (expected). Stage 5 conditions met
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
