# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: c4663443633635116ae487a9aea1dba192c0180e
> upstreamSha: c4663443633635116ae487a9aea1dba192c0180e
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-07-28T06:45:55.443Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
ATTP host-owned write roots 已在支持拓扑内完成治理闭环(spec/plan done, 9/9);等待用户选择下一项已授权工作。[attp-hive-rollout] 仍 BLOCKED,禁止子仓分发与 hive nurture。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [c482] [wiki-ux-debt] Wiki 三项体验债(实际产物复核确认,不重开 4b-1):1) SVG 超宽溢出 — 用 .map-scroll overflow-x:auto 容器包裹(最小修法),后续再考虑缩放/折叠/minimap;2) 首页治理提醒缺范围解释 — 拆「当前活动范围 / 项目历史治理债务 / 未归属」三行,降低 44 项提醒的认知冲突;3) 模块名称层中文化 — 默认 wiki-groups.json aliases 或 module-id 中文词典,只改展示别名,不动 Architecture IR canonical 名称。
- [ ] [zvec-06-upgrade] 升级 @zvec/zvec 0.5.0→0.6:隔离分支 bump + 现有 memory 测试 + T-zvec06-readonly-matrix 实测(reader/writer 共存行为)+ 旧 collection 打开/重建基准 + Windows native 包 + hive 子仓分发;读路径 readOnly:true 与 coordinated writer 模式拆分随升级落地;规格见 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md 附录 A。索引为派生物,失败恢复=删派生 collection + 降级 + mem rebuild。前置:[a177] 锁协调已收口(0.5.0 baseline,不依赖 0.6)。
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [c466344] 2026-07-28 bug-fix: [57b0] trajectory entry single-line invariant closed. de352ec folds details before truncation; c4663
- [b6ca7c7] 2026-07-27 governance-closure: [attp-guard-allowlist] 在支持拓扑限定下关闭。单工作树 / 独立项目副本拓扑已解决并完成真实验收(docs/validation/attp-guard-allowlist-acc
- [1108e9d] 2026-07-26 governance-closure: ATTP (Agent Takeover Trigger Protocol) closure. spec:agent-takeover-trigger-protocol
- [89cb3d7] 2026-07-23 governance-closure: [a177] mcp-zvec-lock closure. Final review Ready-to-merge:Yes (opus). Implementation 8db7a99..e1a7cc
- [659984d] 2026-07-23 governance-closure: [a177] mcp-zvec-lock 设计+计划阶段收口。设计文档 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md:三层锁协调(
- [b5803d3] 2026-07-23 governance-closure: 4b-1 Architecture-Governance Wiki closure. Q5 user acceptance PASS (2026-07-23). Implementation main
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [06fd][mcp-detect-missing]: templates/cli/mcp-detect.js now exists (6.1K) and te
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [fresh-plan-progress]: fixed pre-2.3.0 in templates/cli/planning.js (plan progre
- [404343f] 2026-07-20 bug-fix: Follow-up to da53d3d. CodePLC re-dogfooded the nurtured fix and found a second, adjacent gap: templa
- [da53d3d] 2026-07-20 bug-fix: CodePLC (registered hive child, no templates/ tree) dogfooded the 2026-07-20 nurture and hit two cla
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
