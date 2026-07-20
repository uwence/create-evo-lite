# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: da53d3de5662e237396ca3eb01ab6008d5cd9c69
> upstreamSha: 614fb32fae946756b38546a06abaa269c4678bbe
> ahead: 7
> behind: 0
> focusUpdatedAt: 2026-07-20T13:23:07.320Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
No active plan. Phase 4a shipped 6/6. Fixed advanceFocusFromCommit: a commit message naming a parked plan no longer auto-advances focus onto it (task:postcommit-autofocus-parked).
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [fresh-plan-progress] fresh scaffold baseline commit的governance hook中plan progress因无plan-ir.json而fail, 导致新项目verify显示last_run=failed-last-run. 修: plan progress在无IR时应graceful no-op(提示run plan scan)而非exit 1. 非回归, 2.3.0 consume-test发现
- [ ] [06fd] [mcp-detect-missing] test/integration.js:551 + test/harness.js:330 require templates/cli/mcp-detect.js which has NEVER existed in git (absent at 63c019c baseline). Pre-existing: 'test.js all' fails in integration section. Fix: create mcp-detect.js OR remove the dangling references. Surfaced during spec-portfolio Task 8 regression.
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [da53d3d] 2026-07-20 bug-fix: CodePLC (registered hive child, no templates/ tree) dogfooded the 2026-07-20 nurture and hit two cla
- [1ee4237] 2026-07-20 bug-fix: advanceFocusFromCommit extracts a plan/spec token from the LATEST commit message (full body, via git
- [366b66a] 2026-07-20 focus-fix: Post-commit hook auto-advanced focus onto plan:code-wiki-inspector-projection (parked, 0/3) since it
- [5ebbc1b] 2026-07-20 focus-fix: Rewrote focus text to describe only the shipped Phase 4a plan (dropped the stray plan:code-wiki-insp
- [f004e62] 2026-07-20 plan-closure: Retroactive closure of plan:unified-code-explore-agent-surface-mvp. All 6 tasks (M1/M2 seam, unified
- [8645418] 2026-07-15 plan-progress-reflection: Sub-spec ② (codegraph-adapter-governance-linker) plan-progress reflection: 14/15 tasks implemented +
- [3818745] 2026-07-11 spec-portfolio-governance re-closed after 3 independent review rounds: P0 adopt path containment BOTH sides: source (a92c7e7 realpath/symlink/isFile/.md) + target-dir/pare
- [d7eb5d0] 2026-07-10 spec-portfolio-governance shipped: plan 9/9, whole-branch SHIP: intake gate (mem spec adopt: normalize+size WARN+relation+transactional
- [8402c32] 2026-07-09 release-cut-2.3.0: 2.3.0 cut: CHANGELOG Unreleased -> 2.3.0 (feedback loop, mutation preflight w/ CRLF exemption, zvec-
- [64267b4] 2026-07-09 child-feedback-closure: zvec-optin-docs closed: new managed rule gene .agents/rules/zvec-optin.md (agents-rules family) - wh
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
