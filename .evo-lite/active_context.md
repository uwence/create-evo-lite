# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 89cb3d71d40530f946ba40124bc3b7dc9b03315a
> upstreamSha: 8db7a992040ad7517c823fed5d158e17e74b974f
> ahead: 14
> behind: 0
> focusUpdatedAt: 2026-07-23T15:45:07.047Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[a177] mcp-zvec-lock SHIPPED(母仓,main@459d713):三层锁协调全绿收口,终局复审 Ready-to-merge:Yes,实景 mem commit 双 MCP 在场未撞锁。剩余:hive nurture CodePLC + hungersnakegame4(分发 Layer 1-3 基因)。后续独立议题:[zvec-06-upgrade](升级时首验 isLockError 文案匹配)。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [agent-code-routing] 4a.x debt (P2 final): agents never discover mem code under bare prompts, even with zero competing surface (S9b CodePLC). Fix direction: takeover aggregate command or explicit routing in .agents/rules. Independent of 4b-1 — the Wiki serves humans and cannot substitute agent routing.
- [ ] [c482] [wiki-ux-debt] Wiki 三项体验债(实际产物复核确认,不重开 4b-1):1) SVG 超宽溢出 — 用 .map-scroll overflow-x:auto 容器包裹(最小修法),后续再考虑缩放/折叠/minimap;2) 首页治理提醒缺范围解释 — 拆「当前活动范围 / 项目历史治理债务 / 未归属」三行,降低 44 项提醒的认知冲突;3) 模块名称层中文化 — 默认 wiki-groups.json aliases 或 module-id 中文词典,只改展示别名,不动 Architecture IR canonical 名称。
- [ ] [zvec-06-upgrade] 升级 @zvec/zvec 0.5.0→0.6:隔离分支 bump + 现有 memory 测试 + T-zvec06-readonly-matrix 实测(reader/writer 共存行为)+ 旧 collection 打开/重建基准 + Windows native 包 + hive 子仓分发;读路径 readOnly:true 与 coordinated writer 模式拆分随升级落地;规格见 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md 附录 A。索引为派生物,失败恢复=删派生 collection + 降级 + mem rebuild。前置:[a177] 锁协调已收口(0.5.0 baseline,不依赖 0.6)。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [89cb3d7] 2026-07-23 governance-closure: [a177] mcp-zvec-lock closure. Final review Ready-to-merge:Yes (opus). Implementation 8db7a99..e1a7cc
- [659984d] 2026-07-23 governance-closure: [a177] mcp-zvec-lock 设计+计划阶段收口。设计文档 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md:三层锁协调(
- [b5803d3] 2026-07-23 governance-closure: 4b-1 Architecture-Governance Wiki closure. Q5 user acceptance PASS (2026-07-23). Implementation main
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [06fd][mcp-detect-missing]: templates/cli/mcp-detect.js now exists (6.1K) and te
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [fresh-plan-progress]: fixed pre-2.3.0 in templates/cli/planning.js (plan progre
- [404343f] 2026-07-20 bug-fix: Follow-up to da53d3d. CodePLC re-dogfooded the nurtured fix and found a second, adjacent gap: templa
- [da53d3d] 2026-07-20 bug-fix: CodePLC (registered hive child, no templates/ tree) dogfooded the 2026-07-20 nurture and hit two cla
- [1ee4237] 2026-07-20 bug-fix: advanceFocusFromCommit extracts a plan/spec token from the LATEST commit message (full body, via git
- [366b66a] 2026-07-20 focus-fix: Post-commit hook auto-advanced focus onto plan:code-wiki-inspector-projection (parked, 0/3) since it
- [5ebbc1b] 2026-07-20 focus-fix: Rewrote focus text to describe only the shipped Phase 4a plan (dropped the stray plan:code-wiki-insp
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
