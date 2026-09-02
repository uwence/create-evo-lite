# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 19b66c546666414f3b9623ad5fb2789d75ef808c
> upstreamSha: 19b66c546666414f3b9623ad5fb2789d75ef808c
> ahead: 0
> behind: 0
> focusUpdatedAt: 2026-09-02T12:44:29.517Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[0ce0] verify-hook-runtime-health — PHASE 1 CLOSED / MODEL FROZEN。权威在 spec/0ce0-hook-environment-observation-matrix @15de65c（docs/superpowers/specs/2026-08-25-hook-environment-observation-matrix.md）。Topology 已冻结为 5 行：IN-SCOPE / NESTED-TARGET / NO-GIT-ADMIN-TOPOLOGY / SCOPE-UNRESOLVED / OWNER-UNRESOLVED；**不得在没有 spec 变更的情况下把它重新展开成「五种环境」** —— CI checkout 与真实 working copy 同为 IN-SCOPE，无 .git/hooks 是 IN-SCOPE 上的一个观察而非环境，npm pack/scaffold 落 NO-GIT-ADMIN-TOPOLOGY，child project 为 NESTED-TARGET 或 IN-SCOPE。实现仍未授权，理由不再是谨慎而是依赖图判定为不可能：D2 安装一致性权威 NAMED_NOT_INSTANTIATED（live installation observer 不存在）；D3(a) 执行成功的期望权威未决（writer every(i=>i.ok) 与 reader some(c=>c.ok===false) 不等价）；D3(b) 执行发生无任何期望合同，因此 missing 目前无法进入健康比较。在这些权威存在之前不得定义 health consequence。Phase 2 需独立授权，可能范围：实例化 live installation observer、定义安装一致性权威行为、裁定执行成功合同、定义执行发生期望、定义组合健康后果、修改 verify / hook status / producer。Phase 1 完成不蕴含任何实现授权。原则：在没有 authority 的地方，不产生 judgement。[a8a8] 已 DISPROVED / CLOSED——受控 spike 证明前两环、证伪 release-gate 那一环。残余分歧登记为 Backlog Ideas 的 [plan-status-parser-divergence]，未定优先级，contract 冻结前不得改 parser 或 closure production code。[7f8c] R011 closure router 已 durable closed（PR #48，merge f6c1300）。[3d78] 与 [attp-lw-memory-identity] 保持 BLOCKED。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。新增前置依赖(spec:zvec-win-unicode-containment §12,Task 9C 登记):Windows 目标子仓必须在分发前调用 [zvec-win-unicode-containment] 的 containment decision 接口;判定非 SAFE 时拒绝分发并给出结构化原因,不得静默跳过。该依赖未满足前不得执行对应的 Windows rollout。
- [ ] [attp-lw-memory-identity] [attp-lw-memory-identity] RESIDUAL / blocked-upstream — waiting-host-contract。承载 spec:attp-linked-worktree-memory-identity(status: parked)。缺口:git linked worktree 中宿主对 transcript 用当前 worktree 身份、对 memory 用【主工作树】身份,两者不同源,且该映射在路径大小写维度上失稳(小写拼写启动时重定向消失,而 git 仍返回规范大小写)。PreToolUse 完整键集无任何 memory root 字段;Git identity 到 memory root 差一层未文档化且有损的 slug 编码(非 ASCII 塌成 '-',NTFS 上非单射);~/.claude.json 用户可编辑、无 slug 字段、同项目五种非规范拼写。证据 docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md(终止分支 B ∧ C)。已正式排除:slug 重实现 / 目录扫描 / target 自证 / 注册表推断 / git common-dir 猜 slug / settings 或 receipt 配置额外根。当前守卫在该拓扑下 fail-closed 是正确行为,【不需要生产改动】。重新开启需宿主提供权威 memory identity(见 residual spec 的四条条件)。本条同时是 [attp-hive-rollout] 的解阻依据:A 目标子仓全为独立单工作树 / B rollout 增加 topology preflight / C 宿主提供权威 memory identity;「多数子仓可能不是 worktree」不构成解阻证据。
- [ ] [0ce0] [verify-hook-runtime-health] P1-B / design-needed: 评估 `mem verify` 是否应把 stale/missing installed hook 纳入总体治理健康状态。实现前必须先冻结 contract：无 `.git/hooks` 环境、npm pack/scaffold、CI checkout、child project 各自是否要求 hook installed/current；不得搭在 hook-status-freshness 小修上顺手实现。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [19b66c5] 2026-09-02 Zvec070MeasurementPhaseClosed: [zvec-win-unicode-containment] 测量阶段 CLOSED。Step 2C(非 ASCII 桥)经复审 APPROVED,PR #62 以两父 merge 合入 main@1
- [125b9d6] 2026-08-28 HookInstallProvenanceClosure: [hook-install-provenance] CLOSED — removed from the active backlog as stale runtime state. The fact
- [6e399ba] 2026-08-18 A8a8DisprovedSpike: [a8a8] DISPROVED / CLOSED — controlled spike on main proved the first two links but falsified the re
- [f6c1300] 2026-08-18 R011Closure: PR #48 merged f6c1300 (two-parent 84d25f3+f129312, expected-head lock on f129312). R011 stopped bein
- [94e28d0] 2026-08-15 BacklogResolve: [235a] hook-status-freshness RESOLVED: shipped via PR #47 (merge 3e09455, reviewed head 975a67a, CI
- [3e09455] 2026-08-15 HookStatusFreshness: [235a] hook-status-freshness shipped and merged via PR #47 (merge 3e09455, reviewed head 975a67a, CI
- [9c8be0a] 2026-08-14 DispositionLedger: Disposition ledger shipped and merged to main via PR #46 (merge 9c8be0a, reviewed head 6ade6c3). A g
- [0965f6e] 2026-08-10 SpecStatusVocabularyLayer1: Spec 状态词汇表收敛（分层清洗第 1 层）+ 一处 park 误判更正。PR #43 合入 main@e7488aa，PR #44 合入 main@0965f6e，两个 PR CI 均 6/6 全
- [d7ab3b6] 2026-08-09 SpecPortfolioAgingDispositionRound2: Spec Portfolio 老化处置第二轮 + 治理缺陷登记。PR #41 经普通两父 merge 合入 main@d7ab3b6，PR CI 6/6 全绿（含 containment + rele
- [186a269] 2026-08-09 CodePLCChildFeedbackDurableClosure: Closed the complete CodePLC child-hive feedback chain. All 8 requested outbox feedback items are che
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- [plan-status-parser-divergence] RESIDUAL / semantics-consistency / investigation-needed — Superpowers 与 native plan 对「无显式 frontmatter status」采用不同生命周期语义。`parseSuperPowersPlan` 在 tracked tasks 全部 implemented 时派生 `plan.status=done`，否则 `draft`；native `parsePlanFile` 在无显式 status 时始终返回 `unknown`。已确认该分歧会改变 Spec Portfolio 的 `notDonePlans` 与 zombie/aging warnings，并会改变 close-preview/apply 的 mutation planning：全勾且无显式 status 的 Superpowers plan 被视为已 done，因此 closure transaction 不会再持久化 `status: done`；等价 native plan 会。已证伪其 release-gate bypass 影响：`deriveBlocker` 不消费 `anyPlanNotDone`，checkbox 翻转不能改变 release verdict。R011 candidate selection 同样不消费 `plan.status`。第三个已确认消费者是 R012 phantom-focus。R012 以 `plan.status === "draft" || done === 0` 判定 unstarted，并把 `planStatus` 直接写入 finding factInputs。因而该 parser divergence 不仅影响展示：对「无显式 status、已有部分任务完成」的等价 plan，Superpowers 派生 draft，因此仍产生 phantom-focus finding；native 派生 unknown 且 done>0，因此不产生该 finding。对 done=0 的等价 plan，两边都会产生 R012，但 `factInputs.planStatus` 分别为 draft / unknown，导致同一未启动治理事实具有不同 fingerprint / disposition identity。该影响仍不通向 release verdict，且尚未判定哪种 lifecycle 语义才是 authoritative；在 contract 冻结前不修。两条均已在受控夹具上实测复现（partial 1/2：SP 出 finding、native 静默；done=0：两边都出，指纹不同），非仅读码推断。实现前先冻结 contract：`plan.status` 究竟是 authored lifecycle state 还是可派生 convenience；不同格式是否必须统一；close transaction 是否必须持久化显式 `status: done`。未冻结前不得修改 parser 或 closure production code。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
- [memory-lock-win-cim-snapshot-reliability] Parked residual — Phase 3A 已合入 main@d48108a：结构化分类、fail-closed 调用点迁移、timeout-only availability gate 与有界诊断均已完成。main run 30779360735 首跑 5/5；真实 CI 至今均走 alive 路径，因此自然 timeout-success 尚未观测。外部 PowerShell/CIM 延迟尾部仍存在，但不再作为 active release blocker。Phase 3B retry、timeout 增加、预热与 transport 替换均未授权。仅在以下任一条件出现时重新激活：1. Phase 3A 后真实 ETIMEDOUT 仍使 T-lock-ident/job 打红；2. 受支持 Node 版本的真实 timeout 不提供 ETIMEDOUT；3. 新证据足以冻结有界 retry 总预算或 transport 变更。
- [attp-win83-canonical-root-identity] Parked residual — takeover-receipt 使用 fs.realpathSync.native，而 takeover-install 使用 fs.realpathSync；Windows 8.3 短路径与长路径混用时，跨模块项目根身份尚未证明一致。当前不修改生产代码，不占 active backlog；阻断 Windows 8.3 alias topology 的 rollout 声明。重新开启前先执行 long/short 四格 install、status、rollback、discard、receipt 与 containment 矩阵。
- [spec-size-gate-state-blindness] 治理噪声缺陷（登记，未授权修）— `spec-portfolio.js:382` 的 `if (sizeExceeded && !sizeWaiver)` 完全不看 spec 的 state。2026-08-09 实测：3 条 size-exceeded 警告全部落在 shipped/parked 上（zvec-win-unicode-containment=shipped，靠 chars=57220>40000 触发；release-2.2.0-hardening=shipped，AC=9>8 且 depends=16>12；evo-code-perception-foundation=parked），**没有一条落在 active spec 上**。size gate 的立意是防止在飞 spec 膨胀失控，实际 100% 在骚扰已关闭议题。附带可用性缺陷：警告文案只印 AC/Phase 两个维度，漏印真正触发的 chars 与 dependsOn，导致出现看似自相矛盾的「体量超标 (AC=0, Phase=0)」。修法：size-exceeded 仅对 state=active 生效；文案印出实际越界的维度与阈值。**不要用 sizeWaiver 消音** —— 那是用配置掩盖判定缺陷。
- [spec-zombie-plan-parked-deadlock] 判定缺陷（登记，未授权修）— `spec-portfolio.js:373` 的 parked 分支只判 `linkedPlans.length > 0 && anyPlanNotDone`，而 parked plan 同样被算作 notDone。后果：**parked spec + parked plan 这个完全自洽的组合永远无法消警**。实例 spec:unified-code-explore-wiki-projection（parked）× plan:code-wiki-inspector-projection（已 parked）在当前逻辑下无论怎么处置都清不掉 zombie-plan 警告。修法：parked plan 应与 done 一样不计入 anyPlanNotDone。
- [plan-closure-manual-gap] 治理债实体化（登记，未授权修）— 2026-08-09 spec park 后暴露：plan 层缺少任何状态转换 CLI（`mem plan` 只有 status/scan/gaps/progress/trace/lint/freeze/ledger/new/archive-evidence，全是只读或扫描），所以 plan 收口 100% 靠手改文件，而手改从来没人做。实测账：docs/superpowers/plans/2026-06-30-evidence-durability-stale-cascade.md 与 2026-07-03-mother-child-hive-nurture.md **完全没有 YAML frontmatter**（无 id/status，却被 registry 关联为 linkedPlans），两者合计 62 个 checkbox 一个未勾，**但工作实际都已完成并合入 main**（前者产出的 test/harness.js + test/governance.js + test/integration.js 就在树上；后者的 hive nurture 正在子巢 CodePLC 上运行，2026-08-09 复现 hive status=up-to-date）。另有 plan:hive-nurture-engine-migration 20/20 全勾却仍 status=draft，plan:codegraph-adapter-governance-linker-mvp 14/15 且 status=draft。修法需先逐条核实证据再追认，不可批量标 done。**2026-08-18 新增一个母仓真实样本，且是本债最完整的一个**：`plan:r011-closure-router` 五个任务全部实现、逐任务复审、PR #48 两父合入 main@f6c1300、CI 6/6、合并结果全量套件 445、真实数据上验过行为，`[7f8c]` 已 durable closed —— 而 plan 源文件仍是 `status: draft`，SDD 的 checkbox 一个未勾，机器看到的是 `0/5 tasks done`。也就是说「工作完成」与「plan lifecycle / checkbox 状态」之间**完全没有自动收口**，即使走完了本项目最严格的一整套门禁也不例外。此样本与 `[focus-auto-advance-manual-intent-overwrite]` 的 read-side 证据**交叉放大**（错误的 reference 识别 × 过期的 plan lifecycle → 一条 R012 false positive），但两者是独立缺陷，不得合并；只修任一边都无法定义完整合同。同样不得用手工补勾来修历史。
