# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 3e09455918915298276605722263deaaf91c3788
> upstreamSha: 3e09455918915298276605722263deaaf91c3788
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-08-15T01:54:31.612Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[hook-status-freshness] NEXT / AUTHORIZED ([235a]): 让 `mem hook status` 消费已经存在的 `diffInstalledHook()` freshness evidence，报告四态 no-hook / no-block / in-sync / drifted，drifted 时 exit != 0 并提示 `mem hook diff` + `mem hook install`；status 保持纯 observer，绝不改写 hook。SCOPE HARD-LOCKED — IN: templates/cli/hooks.js + 镜像 + 测试；OUT: mem verify、自动升级、hook install 行为重设计、P1-B contract、其他 known debt。起源：Disposition Ledger 合并后 installed hook 比模板旧两个月，功能静默失活而所有绿色都是真的。[0ce0] verify-hook-runtime-health = QUEUED / DESIGN-NEEDED，实现未授权。[3d78] 与 [attp-lw-memory-identity] 保持 BLOCKED，不因空闲而硬开。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。新增前置依赖(spec:zvec-win-unicode-containment §12,Task 9C 登记):Windows 目标子仓必须在分发前调用 [zvec-win-unicode-containment] 的 containment decision 接口;判定非 SAFE 时拒绝分发并给出结构化原因,不得静默跳过。该依赖未满足前不得执行对应的 Windows rollout。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [235a] [hook-status-freshness] P1: `mem hook status` 目前只验证 post-commit 中存在 evo-lite managed block，不验证已安装 block 是否与当前 `buildHookBody()` 一致。Dogfood 已证明 stale hook 会让新合入的 post-commit 能力静默失活，即使 full suite 与 CI 全绿。已有 `diffInstalledHook()` 可区分 no-hook / no-block / in-sync / drifted。目标：status 对 drifted 明确报告 outdated、返回非零并提示 `mem hook diff` / `mem hook install`；status 保持纯 observer，不自动改写 hook。
- [ ] [0ce0] [verify-hook-runtime-health] P1-B / design-needed: 评估 `mem verify` 是否应把 stale/missing installed hook 纳入总体治理健康状态。实现前必须先冻结 contract：无 `.git/hooks` 环境、npm pack/scaffold、CI checkout、child project 各自是否要求 hook installed/current；不得搭在 hook-status-freshness 小修上顺手实现。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [3e09455] 2026-08-15 HookStatusFreshness: [235a] hook-status-freshness shipped and merged via PR #47 (merge 3e09455, reviewed head 975a67a, CI
- [9c8be0a] 2026-08-14 DispositionLedger: Disposition ledger shipped and merged to main via PR #46 (merge 9c8be0a, reviewed head 6ade6c3). A g
- [0965f6e] 2026-08-10 SpecStatusVocabularyLayer1: Spec 状态词汇表收敛（分层清洗第 1 层）+ 一处 park 误判更正。PR #43 合入 main@e7488aa，PR #44 合入 main@0965f6e，两个 PR CI 均 6/6 全
- [d7ab3b6] 2026-08-09 SpecPortfolioAgingDispositionRound2: Spec Portfolio 老化处置第二轮 + 治理缺陷登记。PR #41 经普通两父 merge 合入 main@d7ab3b6，PR CI 6/6 全绿（含 containment + rele
- [186a269] 2026-08-09 CodePLCChildFeedbackDurableClosure: Closed the complete CodePLC child-hive feedback chain. All 8 requested outbox feedback items are che
- [efe393e] 2026-08-09 PrStateSyncDurableClosure: [pr-state-sync] and [pr-state-sync-postmerge-correction] DURABLE CLOSED. PR #33 merged at 23b6b095c8
- [364505a] 2026-08-08 BacklogEditCliGapClosure: PR #31 merged by ordinary two-parent merge at main@364505aafcd44747b70d7a228d5edf99a9d71906 with rev
- [a5b1fa8] 2026-08-08 TestTempRootLifecycleClosure: PR #29 merged by ordinary two-parent merge at main@a5b1fa8641110db29f24a5e1b9af906039ff2755, with re
- [78a792e] 2026-08-07 ZvecWinUnicodeContainmentClosure: [zvec-win-unicode-containment] P0 / release-blocker 收口。AC1-AC7 全部交付并合入 main@78a792e。 问题：Windows 上部分非
- [6780911] 2026-08-03 MemoryLockWinCimSnapshotReliabilityClosure: Phase 3A 已通过 PR #14 合入 main@d48108a。实现 getProcessSnapshotResult 结构化分类、兼容 wrapper、两个生产调用点 fail-closed
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Phase 3A 已合入 main@d48108a：结构化分类、fail-closed 调用点迁移、timeout-only availability gate 与有界诊断均已完成。main run 30779360735 首跑 5/5；真实 CI 至今均走 alive 路径，因此自然 timeout-success 尚未观测。外部 PowerShell/CIM 延迟尾部仍存在，但不再作为 active release blocker。Phase 3B retry、timeout 增加、预热与 transport 替换均未授权。仅在以下任一条件出现时重新激活：1. Phase 3A 后真实 ETIMEDOUT 仍使 T-lock-ident/job 打红；2. 受支持 Node 版本的真实 timeout 不提供 ETIMEDOUT；3. 新证据足以冻结有界 retry 总预算或 transport 变更。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
- [spec-size-gate-state-blindness] 治理噪声缺陷（登记，未授权修）— `spec-portfolio.js:382` 的 `if (sizeExceeded && !sizeWaiver)` 完全不看 spec 的 state。2026-08-09 实测：3 条 size-exceeded 警告全部落在 shipped/parked 上（zvec-win-unicode-containment=shipped，靠 chars=57220>40000 触发；release-2.2.0-hardening=shipped，AC=9>8 且 depends=16>12；evo-code-perception-foundation=parked），**没有一条落在 active spec 上**。size gate 的立意是防止在飞 spec 膨胀失控，实际 100% 在骚扰已关闭议题。附带可用性缺陷：警告文案只印 AC/Phase 两个维度，漏印真正触发的 chars 与 dependsOn，导致出现看似自相矛盾的「体量超标 (AC=0, Phase=0)」。修法：size-exceeded 仅对 state=active 生效；文案印出实际越界的维度与阈值。**不要用 sizeWaiver 消音** —— 那是用配置掩盖判定缺陷。
- [spec-zombie-plan-parked-deadlock] 判定缺陷（登记，未授权修）— `spec-portfolio.js:373` 的 parked 分支只判 `linkedPlans.length > 0 && anyPlanNotDone`，而 parked plan 同样被算作 notDone。后果：**parked spec + parked plan 这个完全自洽的组合永远无法消警**。实例 spec:unified-code-explore-wiki-projection（parked）× plan:code-wiki-inspector-projection（已 parked）在当前逻辑下无论怎么处置都清不掉 zombie-plan 警告。修法：parked plan 应与 done 一样不计入 anyPlanNotDone。
- [progress-empty-evidence-vacuous-pass] 判定假阳性（登记，未授权修）— `plan progress` 的 `linkedFilesRatio` 对空集返回 `1`：`linkedFilesTotal=0, linkedFilesExist=0` 被算作「全部证据齐备」，于是**零 linkedFiles 的任务空真（vacuously）通过 implemented 判定**，进而让 R011 报出「linked plan has all tasks implemented → 建议 status: done」。2026-08-10 实测两例：`task:governance-observation-budget-t5`、`task:planning-truth-controls-t6`，两者 linkedFiles 均为 0。**同一棵树上 R005 正在警告这两个任务 `has no linkedFiles`——两条规则互相矛盾**：R005 判「无证据」，progress 判「证据完整」。后果是 R011 的 done 建议在这两个 spec 上不可信，照做会把无证据任务收口成已完成。修法：空 linkedFiles 集不得计为 ratio=1，应视为无证据（或至少不足以支撑 implemented）；R011 在依赖 progress 判定前应先排除零证据任务。**在修好之前，R011 的 status: done 建议必须逐条核实 linkedFilesTotal>0 才可采纳。**
- [plan-closure-manual-gap] 治理债实体化（登记，未授权修）— 2026-08-09 spec park 后暴露：plan 层缺少任何状态转换 CLI（`mem plan` 只有 status/scan/gaps/progress/trace/lint/freeze/ledger/new/archive-evidence，全是只读或扫描），所以 plan 收口 100% 靠手改文件，而手改从来没人做。实测账：docs/superpowers/plans/2026-06-30-evidence-durability-stale-cascade.md 与 2026-07-03-mother-child-hive-nurture.md **完全没有 YAML frontmatter**（无 id/status，却被 registry 关联为 linkedPlans），两者合计 62 个 checkbox 一个未勾，**但工作实际都已完成并合入 main**（前者产出的 test/harness.js + test/governance.js + test/integration.js 就在树上；后者的 hive nurture 正在子巢 CodePLC 上运行，2026-08-09 复现 hive status=up-to-date）。另有 plan:hive-nurture-engine-migration 20/20 全勾却仍 status=draft，plan:codegraph-adapter-governance-linker-mvp 14/15 且 status=draft。修法需先逐条核实证据再追认，不可批量标 done。
