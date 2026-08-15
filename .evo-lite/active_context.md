# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 94e28d0909700f4642ad7e3d62e7128ac39e0c91
> upstreamSha: 94e28d0909700f4642ad7e3d62e7128ac39e0c91
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-08-15T02:12:18.985Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[r011-evidence-blind-completion-advice] NEXT / DESIGN-AUTHORIZED ([7f8c]): 重新冻结 R011 completion advice 的 evidence contract。已确认旧的 [progress-empty-evidence-vacuous-pass] 因果链失效（该条目已删除，git history 保留原诊断）；当前缺陷是 R011 仅信任人工 t.status=implemented，而不消费已有 evidence strength——progress.js 已经算出无正证据时 confidence 只有 0.50，gaps.js 的 isComplete() 却完全丢弃它。本阶段只授权现状侦察、设计与实现计划；不得修改生产代码。不得简单硬编码 confidence 阈值，也不得在 R011 中复制一套 evidence 判定逻辑；应复用/抽取共享 evidence evaluator，并明确 stale / unavailable evidence 的 fail-closed 行为。修复前不得仅因 R011 建议而关闭 spec。[0ce0] 保持 QUEUED / DESIGN-NEEDED；[3d78] 与 [attp-lw-memory-identity] 保持 BLOCKED。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。新增前置依赖(spec:zvec-win-unicode-containment §12,Task 9C 登记):Windows 目标子仓必须在分发前调用 [zvec-win-unicode-containment] 的 containment decision 接口;判定非 SAFE 时拒绝分发并给出结构化原因,不得静默跳过。该依赖未满足前不得执行对应的 Windows rollout。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [0ce0] [verify-hook-runtime-health] P1-B / design-needed: 评估 `mem verify` 是否应把 stale/missing installed hook 纳入总体治理健康状态。实现前必须先冻结 contract：无 `.git/hooks` 环境、npm pack/scaffold、CI checkout、child project 各自是否要求 hook installed/current；不得搭在 hook-status-freshness 小修上顺手实现。
- [ ] [7f8c] [r011-evidence-blind-completion-advice] P1 / governance correctness: R011 当前把 planIR.tasks[].status === "implemented" 直接当作计划完成证据，并据此建议把 linked spec 改为 status: done；它不检查这些 implemented 状态是否有任何独立证据支撑。2026-08-15 在 current main 上重新验证：原 [progress-empty-evidence-vacuous-pass] 的因果链已失效。progress.js 仍把空 linkedFiles 表示为 ratio=1.0，但 hasPositiveFileEvidence 要求 total>0 && exist>0，所以空 linkedFiles 不会形成 positive evidence。task:governance-observation-budget-t5 与 task:planning-truth-controls-t6 之所以仍被 progress 派生为 implemented，是因为 plan markdown 已人工标记 status: implemented；无正证据时 confidence 只有 0.50。未人工标 implemented 的 t8/t9 正确落为 todo。真正缺陷位于 R011 信任边界：gaps.js 的 isComplete() 只检查 t.readOnly || t.status === "implemented"，完全丢弃已经存在的 evidence / confidence 信号，因此可以基于纯人工 checkbox 给出 spec status: done 建议。影响：这是主动产生错误治理建议的 correctness 缺陷，不是单纯 observability 缺口。修复前不得仅因 R011 建议而关闭 spec；必须人工核实实际 evidence。设计要求：先冻结「什么证据足以支撑 R011 completion advice」的 contract。不得简单把 confidence >= 某阈值硬编码进 R011，也不得在 gaps.js 本地复制一套 evidence 逻辑；应复用/抽取共享 evidence evaluator，并明确 stale / unavailable evidence 的 fail-closed 行为。实现尚未授权。Supersedes: [progress-empty-evidence-vacuous-pass]。
- [ ] [a8a8] [implicit-plan-done-release-gate-bypass] P1 / release-governance correctness / investigation-required: parse-markdown.js:304 对 superpowers 格式的 plan 执行 status: frontmatter.status || (allDone ? "done" : "draft") —— frontmatter 未写 status 时，勾满 checkbox 即隐式把 plan 提升为 status: done。而 spec-portfolio.js 的 notDonePlans 读 plan.status !== "done"，再经 state 派生喂给 release-preflight 的 publish blocker。因此存在一条与 R011 完全独立的链：checkbox allDone → 隐式 plan done → notDonePlans 改变 → release blocker 可能消失。比 [7f8c] 更严重之处在于：R011 只是建议一个错误动作，这条路径可能直接改变 machine release judgment。注意 parsePlanFile（native 格式）不做此提升，默认 unknown —— 同一问题两种不兼容答案。2026-08-15 于 main@37f9fcd 由 [7f8c] 侦察发现，代码事实已核实，但尚未冻结「哪些 spec topology 下 release verdict 会真正从 BLOCKED→CLEAR」的最小复现，故暂定 P1 而非 P0。禁止顺手修：先做独立复现与 contract 冻结。不属于 [7f8c] 实现范围。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [94e28d0] 2026-08-15 BacklogResolve: [235a] hook-status-freshness RESOLVED: shipped via PR #47 (merge 3e09455, reviewed head 975a67a, CI 
- [3e09455] 2026-08-15 HookStatusFreshness: [235a] hook-status-freshness shipped and merged via PR #47 (merge 3e09455, reviewed head 975a67a, CI
- [9c8be0a] 2026-08-14 DispositionLedger: Disposition ledger shipped and merged to main via PR #46 (merge 9c8be0a, reviewed head 6ade6c3). A g
- [0965f6e] 2026-08-10 SpecStatusVocabularyLayer1: Spec 状态词汇表收敛（分层清洗第 1 层）+ 一处 park 误判更正。PR #43 合入 main@e7488aa，PR #44 合入 main@0965f6e，两个 PR CI 均 6/6 全
- [d7ab3b6] 2026-08-09 SpecPortfolioAgingDispositionRound2: Spec Portfolio 老化处置第二轮 + 治理缺陷登记。PR #41 经普通两父 merge 合入 main@d7ab3b6，PR CI 6/6 全绿（含 containment + rele
- [186a269] 2026-08-09 CodePLCChildFeedbackDurableClosure: Closed the complete CodePLC child-hive feedback chain. All 8 requested outbox feedback items are che
- [efe393e] 2026-08-09 PrStateSyncDurableClosure: [pr-state-sync] and [pr-state-sync-postmerge-correction] DURABLE CLOSED. PR #33 merged at 23b6b095c8
- [364505a] 2026-08-08 BacklogEditCliGapClosure: PR #31 merged by ordinary two-parent merge at main@364505aafcd44747b70d7a228d5edf99a9d71906 with rev
- [a5b1fa8] 2026-08-08 TestTempRootLifecycleClosure: PR #29 merged by ordinary two-parent merge at main@a5b1fa8641110db29f24a5e1b9af906039ff2755, with re
- [78a792e] 2026-08-07 ZvecWinUnicodeContainmentClosure: [zvec-win-unicode-containment] P0 / release-blocker 收口。AC1-AC7 全部交付并合入 main@78a792e。 问题：Windows 上部分非
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- [focus-auto-advance-manual-intent-overwrite] P1 / governance correctness / design-needed — `advanceFocusFromCommit()` 把 commit message 里第一个字面 `plan:<slug>` / `spec:<slug>` 提及当作替换 BEGIN_FOCUS 的授权。2026-08-15 真实复现：`[7f8c]` 是人工设定的当前 focus，R011 设计 commit 仅把 `spec:disposition-ledger` 作为范围外例子提及，post-commit auto-advance 就静默把人工 focus 换成了 Disposition Ledger plan。这违反已交付的 Phase-2 合同「auto-advance must be conservative, never silently overwrite an intentional manual focus」。核心区分：**reference != focus-transfer authorization**；当前实现既未证明人类意图转移，也未检查现 FOCUS 是否为人工设定。不得靠追加更多子串启发式来打补丁——先冻结 ownership/provenance 或等价的显式 transfer contract。候选方向（待 brainstorming 比较，勿今日实现）：A 显式 focus-transfer trailer；B manual/derived provenance；C CAS 式「仅当旧 focus 满足某条件才自动替换」。修复前，跨引用较多的 commit 应设 `EVO_LITE_NO_FOCUS_AUTOADVANCE=1`，并在 post-commit 后核对 BEGIN_FOCUS。当前 active backlog 已满 5/5，故先驻留此区，待 `[7f8c]` 结束腾出槽位再 promote。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Phase 3A 已合入 main@d48108a：结构化分类、fail-closed 调用点迁移、timeout-only availability gate 与有界诊断均已完成。main run 30779360735 首跑 5/5；真实 CI 至今均走 alive 路径，因此自然 timeout-success 尚未观测。外部 PowerShell/CIM 延迟尾部仍存在，但不再作为 active release blocker。Phase 3B retry、timeout 增加、预热与 transport 替换均未授权。仅在以下任一条件出现时重新激活：1. Phase 3A 后真实 ETIMEDOUT 仍使 T-lock-ident/job 打红；2. 受支持 Node 版本的真实 timeout 不提供 ETIMEDOUT；3. 新证据足以冻结有界 retry 总预算或 transport 变更。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
- [spec-size-gate-state-blindness] 治理噪声缺陷（登记，未授权修）— `spec-portfolio.js:382` 的 `if (sizeExceeded && !sizeWaiver)` 完全不看 spec 的 state。2026-08-09 实测：3 条 size-exceeded 警告全部落在 shipped/parked 上（zvec-win-unicode-containment=shipped，靠 chars=57220>40000 触发；release-2.2.0-hardening=shipped，AC=9>8 且 depends=16>12；evo-code-perception-foundation=parked），**没有一条落在 active spec 上**。size gate 的立意是防止在飞 spec 膨胀失控，实际 100% 在骚扰已关闭议题。附带可用性缺陷：警告文案只印 AC/Phase 两个维度，漏印真正触发的 chars 与 dependsOn，导致出现看似自相矛盾的「体量超标 (AC=0, Phase=0)」。修法：size-exceeded 仅对 state=active 生效；文案印出实际越界的维度与阈值。**不要用 sizeWaiver 消音** —— 那是用配置掩盖判定缺陷。
- [spec-zombie-plan-parked-deadlock] 判定缺陷（登记，未授权修）— `spec-portfolio.js:373` 的 parked 分支只判 `linkedPlans.length > 0 && anyPlanNotDone`，而 parked plan 同样被算作 notDone。后果：**parked spec + parked plan 这个完全自洽的组合永远无法消警**。实例 spec:unified-code-explore-wiki-projection（parked）× plan:code-wiki-inspector-projection（已 parked）在当前逻辑下无论怎么处置都清不掉 zombie-plan 警告。修法：parked plan 应与 done 一样不计入 anyPlanNotDone。
- [plan-closure-manual-gap] 治理债实体化（登记，未授权修）— 2026-08-09 spec park 后暴露：plan 层缺少任何状态转换 CLI（`mem plan` 只有 status/scan/gaps/progress/trace/lint/freeze/ledger/new/archive-evidence，全是只读或扫描），所以 plan 收口 100% 靠手改文件，而手改从来没人做。实测账：docs/superpowers/plans/2026-06-30-evidence-durability-stale-cascade.md 与 2026-07-03-mother-child-hive-nurture.md **完全没有 YAML frontmatter**（无 id/status，却被 registry 关联为 linkedPlans），两者合计 62 个 checkbox 一个未勾，**但工作实际都已完成并合入 main**（前者产出的 test/harness.js + test/governance.js + test/integration.js 就在树上；后者的 hive nurture 正在子巢 CodePLC 上运行，2026-08-09 复现 hive status=up-to-date）。另有 plan:hive-nurture-engine-migration 20/20 全勾却仍 status=draft，plan:codegraph-adapter-governance-linker-mvp 14/15 且 status=draft。修法需先逐条核实证据再追认，不可批量标 done。
