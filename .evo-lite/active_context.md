# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 6780911e9d09356683fdb188bfcc7574f4d3b2a9
> upstreamSha: d48108a7521654168816673d8449e362bce72814
> ahead: 1
> behind: 0
> focusUpdatedAt: 2026-08-03T02:56:33.983Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[zvec-win-unicode-containment] Tasks 1-8（AC1-AC7）已全部交付、复审 ACCEPTED 并合入 main@c2eb784。AC7 发布门已生效：prepublishOnly -> release-preflight 现场重建 Spec Portfolio registry，本仓 npm publish 目前被自己的 active + releaseBlocking:true containment spec 阻断，这是预期 enforcement 而非故障。下一步仅为 Task 9（收口）的 kickoff / baseline audit，且 Task 9 与 context closure 当前仍未授权。[memory-lock-win-cim-snapshot-reliability] 保持 parked residual。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [zvec-win-unicode-containment] P0 / release-blocker — Windows 上部分非 ASCII Zvec collection 路径在 insertSync 触发 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，进程 fail-fast 且不可捕获；0.5.0 与 0.6.0 同样复现，因此不归因于本次升级。阻断下一正式发布与 Windows 非 ASCII 子仓 rollout，不阻断已经完成的 0.6 正确性合并。范围仅为触发边界、预检、隔离、fail-closed 降级与恢复合同设计（path containment）；生产实现和子仓分发尚未授权。证据：docs/validation/zvec-06-phase0b-verdict.md。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [6780911] 2026-08-03 MemoryLockWinCimSnapshotReliabilityClosure: Phase 3A 已通过 PR #14 合入 main@d48108a。实现 getProcessSnapshotResult 结构化分类、兼容 wrapper、两个生产调用点 fail-closed
- [201ba1a] 2026-08-01 MemoryLockWinCimSnapshotReactivation: [memory-lock-win-cim-snapshot-reliability] 由 parked residual 重新激活为 active release-gate reliability b
- [befedf1] 2026-08-01 ZvecWinUnicodeContainmentTask4Closure: [zvec-win-unicode-containment] Task 1–4 收口，运行时上下文对齐。 实现与合入：Task 1–3(判定层)经 PR #6 合入 main@a10dfd7；Task
- [7628fdb] 2026-07-31 ZvecWinUnicodeContainmentDesignFreeze: 完成 [zvec-win-unicode-containment] Phase D 证据与设计冻结：固化 Windows 非 ASCII collection 路径 fail-fast 的有界证据矩阵
- [c862181] 2026-07-31 SpecPortfolioAgingDisposition: 将 spec:provider-first-code-perception-foundation 从 adopted 调整为 parked，保留 umbrella 与 spawned-from 关系。
- [ee98661] 2026-07-31 Zvec06CorrectnessClosure: [zvec-06-upgrade] 收口。议题由「功能升级」重分类为「P0 现存正确性缺陷修复」——原立项理由(0.5.0 无 readOnly、reader/writer 拆分随升级落地)被同版重测
- [b181245] 2026-07-28 feature-completion: [c482] Wiki UX debt closed across three phases. 32911e0 wraps the architecture SVG in a natural-widt
- [c466344] 2026-07-28 bug-fix: [57b0] trajectory entry single-line invariant closed. de352ec folds details before truncation; c4663
- [b6ca7c7] 2026-07-27 governance-closure: [attp-guard-allowlist] 在支持拓扑限定下关闭。单工作树 / 独立项目副本拓扑已解决并完成真实验收(docs/validation/attp-guard-allowlist-acc
- [1108e9d] 2026-07-26 governance-closure: ATTP (Agent Takeover Trigger Protocol) closure. spec:agent-takeover-trigger-protocol
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Phase 3A 已合入 main@d48108a：结构化分类、fail-closed 调用点迁移、timeout-only availability gate 与有界诊断均已完成。main run 30779360735 首跑 5/5；真实 CI 至今均走 alive 路径，因此自然 timeout-success 尚未观测。外部 PowerShell/CIM 延迟尾部仍存在，但不再作为 active release blocker。Phase 3B retry、timeout 增加、预热与 transport 替换均未授权。仅在以下任一条件出现时重新激活：1. Phase 3A 后真实 ETIMEDOUT 仍使 T-lock-ident/job 打红；2. 受支持 Node 版本的真实 timeout 不提供 ETIMEDOUT；3. 新证据足以冻结有界 retry 总预算或 transport 变更。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
