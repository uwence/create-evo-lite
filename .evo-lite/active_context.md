# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: c8621813b20132bcc694504678b55fd43f365d21
> upstreamSha: 17012e24b2303ad64254cf62df6a481d8cb25c6c
> ahead: 1
> behind: 0
> focusUpdatedAt: 2026-07-31T08:15:20.404Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
@zvec/zvec 0.6.0 正确性升级已合入 main@ee98661，并通过 Ubuntu Node 20/22/24 与 Windows Node 22/24 五组合完整发布链。下一正式发布及任何 Windows 非 ASCII 子仓 rollout 由 [zvec-win-unicode-containment] 阻断；当前仅完成 P0 booking，containment 设计与实现尚未授权。[attp-hive-rollout] 仍按其独立试点、回滚与 topology preflight 条件保持 BLOCKED。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [zvec-win-unicode-containment] P0 / release-blocker — Windows 上部分非 ASCII Zvec collection 路径在 insertSync 触发 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，进程 fail-fast 且不可捕获；0.5.0 与 0.6.0 同样复现，因此不归因于本次升级。阻断下一正式发布与 Windows 非 ASCII 子仓 rollout，不阻断已经完成的 0.6 正确性合并。范围仅为触发边界、预检、隔离、fail-closed 降级与恢复合同设计（path containment）；生产实现和子仓分发尚未授权。证据：docs/validation/zvec-06-phase0b-verdict.md。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [c862181] 2026-07-31 SpecPortfolioAgingDisposition: 将 spec:provider-first-code-perception-foundation 从 adopted 调整为 parked，保留 umbrella 与 spawned-from 关系。
- [ee98661] 2026-07-31 Zvec06CorrectnessClosure: [zvec-06-upgrade] 收口。议题由「功能升级」重分类为「P0 现存正确性缺陷修复」——原立项理由(0.5.0 无 readOnly、reader/writer 拆分随升级落地)被同版重测
- [b181245] 2026-07-28 feature-completion: [c482] Wiki UX debt closed across three phases. 32911e0 wraps the architecture SVG in a natural-widt
- [c466344] 2026-07-28 bug-fix: [57b0] trajectory entry single-line invariant closed. de352ec folds details before truncation; c4663
- [b6ca7c7] 2026-07-27 governance-closure: [attp-guard-allowlist] 在支持拓扑限定下关闭。单工作树 / 独立项目副本拓扑已解决并完成真实验收(docs/validation/attp-guard-allowlist-acc
- [1108e9d] 2026-07-26 governance-closure: ATTP (Agent Takeover Trigger Protocol) closure. spec:agent-takeover-trigger-protocol
- [89cb3d7] 2026-07-23 governance-closure: [a177] mcp-zvec-lock closure. Final review Ready-to-merge:Yes (opus). Implementation 8db7a99..e1a7cc
- [659984d] 2026-07-23 governance-closure: [a177] mcp-zvec-lock 设计+计划阶段收口。设计文档 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md:三层锁协调(
- [b5803d3] 2026-07-23 governance-closure: 4b-1 Architecture-Governance Wiki closure. Q5 user acceptance PASS (2026-07-23). Implementation main
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [06fd][mcp-detect-missing]: templates/cli/mcp-detect.js now exists (6.1K) and te
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Windows GitHub runner 上 getProcessSnapshot 经 PowerShell/CIM 获取当前进程快照时出现过首次查询超时并返回 null；同一树同一 job 重跑通过。生产端降级为 unknown/report-only，不自动终止进程，属于可用性与 CI 首次通过可靠性问题，不是 fail-open。证据：main@484897c，run 30601168988 attempt 1/2。禁止盲目增加 timeout 或把永久 null 视为成功；重新开启时应拆分确定性 seam 合同与 Windows 真实集成探针。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
