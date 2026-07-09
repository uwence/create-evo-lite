# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: eb25af21fb15c42c4ea18a145a54c59b392dfe16
> upstreamSha: 9c99006b8e4d4bd0dac87f7528c61bff5fb66ec0
> ahead: 8
> behind: 0
> focusUpdatedAt: 2026-07-09T14:57:44.715Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
Memory Engine Default-Flip Implementation Plan: all tasks implemented
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [36e1] dirty-worktree下context track拒绝但错误不可见(context-mode吞stderr叠加显示no output). 修: 拒绝信息打到stdout+actionable提示. CodePLC dogfood 2026-07-08
- [ ] [20bb] zvec fallback WARN不给开启zvec的具体命令(装@zvec/zvec+撤memory-engine.json pin+rebuild). 修: WARN body加3步. 新genes已大幅缓解. CodePLC dogfood 2026-07-08
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [eb25af2] 2026-07-09 backlog-dogfood-fixes: Three CodePLC dogfood fixes: (1) nurture-tag: rollback tag now evo-nurture-pre-<v>-<stamp> via injec
- [a5ffd9f] 2026-07-09 plan:hive-child-feedback-loop: hive-child-feedback-loop shipped: feedback outbox (parse/mark/read module, nurture exactly-once coll
- [20e5fb7] 2026-07-08 db.js exports DEFAULT_ENGINE(_VERSION); SqliteFtsIndex.engine concrete; tests de-vacuumed (literal + sqlite-mode guard): Latent bug exposed by config-retrieval fix during CodePLC nurture: db.js never exported DEFAULT_ENGI
- [005b511] 2026-07-08 backlog id = hash|label via extractBacklogId; add --label + resolve-by-label; checkbox-anchored, validated, ambiguity-safe: Closes dogfood backlog 79e9 (resolve semantics). resolveBacklog+parseBacklogTasks+addTask now share
- [8a319d3] 2026-07-08 verify config-retrieval line sources active engine from live index; complements P2 memory-space fix: Fixes residual half of the engine-display bug: [配置/检索] top line read a stale models.js const (always
- [6e83d68] 2026-07-08 impl-keyed rebuild drop + degradation WARN + nurture engine preflight; closes plan hive-nurture-engine-migration: Closes plan:hive-nurture-engine-migration (all 5 tasks). Fixes destructive genes-vs-state engine-mig
- [8cf8cb5] 2026-07-08 exact-boost-router + active-engine-display: Two zvec-flip follow-ups closed. P1 exact-boost router: multi-token recall now tier-ranks literal-ph
- [6ab1c55] 2026-06-30 release-cut-2.1.0: PR5 release cut: package.json + package-lock.json 2.0.10->2.1.0 (T18h lockfile sync), CHANGELOG Unre
- [83992b3] 2026-06-30 SDD + mem close --apply: verification-contract-closure-correctness: PR-CC 6 closure-path bug fixes (T56-T61) shipped via suba
- [689453e] 2026-06-27 verification-contract-phase2-closure: Closure for plan:verification-contract-phase2 (spec done), TDD-green (T38-T39 + integration, both sc
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
