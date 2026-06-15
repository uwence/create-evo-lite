# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。

<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
Project Control Dashboard MVP — all 14 tasks complete, now in dogfood observation cycle (Rollout Stage 4→5)
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [2c4d] Observe Rollout Stage 4→5: two stable dogfood cycles before default-on
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [8824fd2] 2026-06-15 dogfood-observation: Cycle 1 stable: verify clean, architecture diff 0 findings, plan gaps R010x1 info (expected backlog 
- [665815b] 2026-06-15 fix(drift) 665815b: Drift cleanup complete: R005/R007/R008/R009/R010 resolved; only R006 (auto-clears on commit) and R01
- [a5bd27e] 2026-06-15 fix(inspector) a5bd27e: Fix inspector stale-data bug: APIs now run live in-memory scan on every request — no manual rescan n
- [e314952] 2026-06-15 feat(dashboard) e314952: Phase 5 complete: dashboard build, Architecture+Drift inspector tabs, project_control verify field —
- [afe43c2] 2026-06-15 feat: Phase 4 drift engine complete. mem architecture diff (R001,R002,R007) + mem plan gaps (R003-R010). S
- [2d9d54d] 2026-06-15 feat: Phase 3 architecture scanner complete. 9/14 dogfood tasks done. mem architecture scan: 9 modules, 34
- [e3943e1] 2026-06-15 feat: Add /api/planning HTTP endpoint to inspector serving plan-ir.json. Add Planning nav tab with spec/pl
- [0a7cbb9] 2026-06-15 feat: Add mem plan status and mem plan scan commands. Markdown parser reads docs/specs/ and docs/plans/ in
- [a7a94f0] 2026-05-22 FTS5_Deplatform_Upgrade: 完成了 Evo-Lite 2.0 骨架架构重构与去平台化（De-platforming）。移除了 templates/ 下所有平台特定资产（如 .github, .codex, .claude 等），
- [45977cb] 2026-05-14 HookProvenanceSidecar: Stabilized the Codex stop-hook JSON contract, synced the managed workflow templates back into the tr
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
