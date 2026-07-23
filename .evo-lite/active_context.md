# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 035afb0b6879e7ce5ccb79df4c33b6425abde3da
> upstreamSha: 035afb0b6879e7ce5ccb79df4c33b6425abde3da
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-07-22T08:59:06.029Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
Architecture-Governance Wiki (4b-1) Implementation Plan: [W1] wiki/page-map.js — 统一页面路径映射
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [agent-code-routing] 4a.x debt (P2 final): agents never discover mem code under bare prompts, even with zero competing surface (S9b CodePLC). Fix direction: takeover aggregate command or explicit routing in .agents/rules. Independent of 4b-1 — the Wiki serves humans and cannot substitute agent routing.
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [06fd][mcp-detect-missing]: templates/cli/mcp-detect.js now exists (6.1K) and te
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [fresh-plan-progress]: fixed pre-2.3.0 in templates/cli/planning.js (plan progre
- [404343f] 2026-07-20 bug-fix: Follow-up to da53d3d. CodePLC re-dogfooded the nurtured fix and found a second, adjacent gap: templa
- [da53d3d] 2026-07-20 bug-fix: CodePLC (registered hive child, no templates/ tree) dogfooded the 2026-07-20 nurture and hit two cla
- [1ee4237] 2026-07-20 bug-fix: advanceFocusFromCommit extracts a plan/spec token from the LATEST commit message (full body, via git
- [366b66a] 2026-07-20 focus-fix: Post-commit hook auto-advanced focus onto plan:code-wiki-inspector-projection (parked, 0/3) since it
- [5ebbc1b] 2026-07-20 focus-fix: Rewrote focus text to describe only the shipped Phase 4a plan (dropped the stray plan:code-wiki-insp
- [f004e62] 2026-07-20 plan-closure: Retroactive closure of plan:unified-code-explore-agent-surface-mvp. All 6 tasks (M1/M2 seam, unified
- [8645418] 2026-07-15 plan-progress-reflection: Sub-spec ② (codegraph-adapter-governance-linker) plan-progress reflection: 14/15 tasks implemented +
- [3818745] 2026-07-11 spec-portfolio-governance re-closed after 3 independent review rounds: P0 adopt path containment BOTH sides: source (a92c7e7 realpath/symlink/isFile/.md) + target-dir/pare
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
