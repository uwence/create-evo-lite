# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 201ba1a29e56d6ac4e6fb863ad45b1289de55ab7
> upstreamSha: 
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-08-01T10:27:54.296Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
Task 5 产品实现已合入 main@201ba1a，代码复审 ACCEPTED，但 closure 被 Windows CIM snapshot reliability defect 阻断：main push run 30694812371 的 windows/node24 在 attempt 1 与唯一授权的 attempt 2 连续在 T-lock-ident 达到 10 秒边界并返回 null。当前 focus 转为 [memory-lock-win-cim-snapshot-reliability] 根因调查（Phase 1 仅观测：区分 PowerShell 启动 / CIM 执行 / 命令退出 / stdout / 解析层，不做生产修复）；Task 6 marker/recovery、Task 7 verify、Task 8 release enforcement 仍未授权且未实现。正式发布与 Windows 非 ASCII rollout 继续阻断。[attp-hive-rollout] 独立保持 BLOCKED。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [zvec-win-unicode-containment] P0 / release-blocker — Windows 上部分非 ASCII Zvec collection 路径在 insertSync 触发 0xC0000409 STATUS_STACK_BUFFER_OVERRUN，进程 fail-fast 且不可捕获；0.5.0 与 0.6.0 同样复现，因此不归因于本次升级。阻断下一正式发布与 Windows 非 ASCII 子仓 rollout，不阻断已经完成的 0.6 正确性合并。范围仅为触发边界、预检、隔离、fail-closed 降级与恢复合同设计（path containment）；生产实现和子仓分发尚未授权。证据：docs/validation/zvec-06-phase0b-verdict.md。
- [ ] [0020] [memory-lock-win-cim-snapshot-reliability] ACTIVE / release-gate reliability blocker — Windows GitHub runners 上 getProcessSnapshot(process.pid) 通过 powershell.exe + Get-CimInstance 获取自身进程快照时，main push run 30694812371 的 Windows Node 24 在 attempt 1 与唯一授权的 attempt 2 连续达到 10 秒边界并返回 null（实测 10.123s / 10.020s，与 execFileSync timeout: 10000 吻合），导致 T-lock-ident 阻断 release-gate。由 Backlog Ideas 的 parked residual 重新激活：重跑此前一直能掩盖它，本次掩盖失败。Task 5 产品代码已合入 main@201ba1a 且代码复审 ACCEPTED，但 closure 因 main gate 未通过而保持 blocked。调查必须先区分 PowerShell 启动、CIM 执行、命令退出、stdout 与解析层；禁止盲目增加 timeout、自动重试、跳过测试或把 null 视为 alive。目标是拆分确定性身份合同与 Windows CIM 集成探针。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [201ba1a] 2026-08-01 MemoryLockWinCimSnapshotReactivation: [memory-lock-win-cim-snapshot-reliability] 由 parked residual 重新激活为 active release-gate reliability b
- [befedf1] 2026-08-01 ZvecWinUnicodeContainmentTask4Closure: [zvec-win-unicode-containment] Task 1–4 收口，运行时上下文对齐。 实现与合入：Task 1–3(判定层)经 PR #6 合入 main@a10dfd7；Task
- [7628fdb] 2026-07-31 ZvecWinUnicodeContainmentDesignFreeze: 完成 [zvec-win-unicode-containment] Phase D 证据与设计冻结：固化 Windows 非 ASCII collection 路径 fail-fast 的有界证据矩阵
- [c862181] 2026-07-31 SpecPortfolioAgingDisposition: 将 spec:provider-first-code-perception-foundation 从 adopted 调整为 parked，保留 umbrella 与 spawned-from 关系。
- [ee98661] 2026-07-31 Zvec06CorrectnessClosure: [zvec-06-upgrade] 收口。议题由「功能升级」重分类为「P0 现存正确性缺陷修复」——原立项理由(0.5.0 无 readOnly、reader/writer 拆分随升级落地)被同版重测
- [b181245] 2026-07-28 feature-completion: [c482] Wiki UX debt closed across three phases. 32911e0 wraps the architecture SVG in a natural-widt
- [c466344] 2026-07-28 bug-fix: [57b0] trajectory entry single-line invariant closed. de352ec folds details before truncation; c4663
- [b6ca7c7] 2026-07-27 governance-closure: [attp-guard-allowlist] 在支持拓扑限定下关闭。单工作树 / 独立项目副本拓扑已解决并完成真实验收(docs/validation/attp-guard-allowlist-acc
- [1108e9d] 2026-07-26 governance-closure: ATTP (Agent Takeover Trigger Protocol) closure. spec:agent-takeover-trigger-protocol
- [89cb3d7] 2026-07-23 governance-closure: [a177] mcp-zvec-lock closure. Final review Ready-to-merge:Yes (opus). Implementation 8db7a99..e1a7cc
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Windows GitHub runner 上 getProcessSnapshot 经 PowerShell/CIM 获取当前进程快照时出现过首次查询超时并返回 null；同一树同一 job 重跑通过。生产端降级为 unknown/report-only，不自动终止进程，属于可用性与 CI 首次通过可靠性问题，不是 fail-open。证据：main@484897c，run 30601168988 attempt 1/2。禁止盲目增加 timeout 或把永久 null 视为成功；重新开启时应拆分确定性 seam 合同与 Windows 真实集成探针。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
