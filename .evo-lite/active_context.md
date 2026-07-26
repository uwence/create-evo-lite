# 🧠 Evo-Lite Active Context (EvoRouter)

<!-- BEGIN_META -->

> **核心目标**: 持续打磨 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极"无感高压治理挂件"。
> headSha: 1108e9d7603da56aa2b926c06a38ed156fa6fb22
> upstreamSha: 16ee1cd94e6d9d79bdd9400343461881fd56538e
> ahead: 1
> behind: 0
> focusUpdatedAt: 2026-07-26T13:21:33.888Z
<!-- END_META -->

## 🎯 当前焦点

<!-- BEGIN_FOCUS -->
[agent-code-routing] ATTP SHIPPED & CLOSED(spec:agent-takeover-trigger-protocol, plan 8/8)。阶段一+阶段二均 ACCEPTED,Gate 1 / Gate 2 均 PASSED;三事件(SessionStart/UserPromptSubmit/PreToolUse)已装入母仓,阶段二备份已 discard,settings 字节未被触碰。范围限制承重:root-launch-only(子目录启动无接管无守卫,无 workaround);守卫是治理保证非隔离边界(只守 Edit/Write,Bash 可绕)。重开:否。后续独立议题:[attp-hive-rollout](子仓分发,未授权)。
<!-- END_FOCUS -->

## 🚧 活跃任务 (≤ 5 条)

<!-- BEGIN_BACKLOG -->
- [ ] [c482] [wiki-ux-debt] Wiki 三项体验债(实际产物复核确认,不重开 4b-1):1) SVG 超宽溢出 — 用 .map-scroll overflow-x:auto 容器包裹(最小修法),后续再考虑缩放/折叠/minimap;2) 首页治理提醒缺范围解释 — 拆「当前活动范围 / 项目历史治理债务 / 未归属」三行,降低 44 项提醒的认知冲突;3) 模块名称层中文化 — 默认 wiki-groups.json aliases 或 module-id 中文词典,只改展示别名,不动 Architecture IR canonical 名称。
- [ ] [zvec-06-upgrade] 升级 @zvec/zvec 0.5.0→0.6:隔离分支 bump + 现有 memory 测试 + T-zvec06-readonly-matrix 实测(reader/writer 共存行为)+ 旧 collection 打开/重建基准 + Windows native 包 + hive 子仓分发;读路径 readOnly:true 与 coordinated writer 模式拆分随升级落地;规格见 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md 附录 A。索引为派生物,失败恢复=删派生 collection + 降级 + mem rebuild。前置:[a177] 锁协调已收口(0.5.0 baseline,不依赖 0.6)。
- [ ] [3d78] [attp-hive-rollout] Distribute the already-accepted ATTP runtime and invoke the idempotent takeover installer in selected child repositories through hive nurture. 独立 rollout 议题,不是 ATTP MVP 的一部分 —— MVP 已 ACCEPTED & CLOSED(spec:agent-takeover-trigger-protocol)。需要自己的范围/试点子仓/失败回滚策略/验收门。前置提醒:子仓装上守卫后项目外 Edit/Write 会被 deny;root-launch-only 限制同样适用。
- [ ] [57b0] [traj-truncate] active_context trajectory 摘要按字符截断但不先折叠换行 — templates/cli/memory.service.js:1519 `details.substring(0, 100)`。归档正文前 100 字符内若含换行,写出的条目会拆成两行,续行没有 '- ' 前缀(实例:1108e9d 断在 'plan:ag')。下游 splitTrajectoryEntries(:847) 用 startsWith('-') 过滤,所以形状会在下次写入时自愈但尾部内容永久丢失;真正风险是续行恰好以 '-' 开头时会被提升为幽灵条目,占掉 10 槽之一挤掉真实条目。修法:截断前先 replace(/\s+/g,' ')(与其它摘要一致),并加回归覆盖'归档正文含换行/含 - 列表'两种输入。来源:ATTP 治理闭环复审 P2-1(非阻断)。
- [ ] [db8a] [attp-guard-allowlist] P1 ROLLOUT BLOCKER — [attp-hive-rollout] 的前置,必须先关。ATTP PreToolUse guard currently denies Claude Code's project-scoped persistent memory writes because ~/.claude/projects/<project>/memory lies outside the canonical repository root. Introduce narrowly derived host-owned write roots without weakening ordinary out-of-project containment. This is an independent compatibility debt and a blocking prerequisite for [attp-hive-rollout], not a reopening of the accepted ATTP MVP. || 不得实现成普通路径白名单(allow ~/.claude/projects/** 会把窄例外变成近乎任意的项目外写入通道)。正解:由当前 hook input 派生 —— deriveHostOwnedWriteRoots(hookInput),host project state root = dirname(transcript_path),allowed = <that>/memory。路径代数已实测成立(dirname(transcript)/memory 精确落在记忆目录,无需猜 <slug> 编码)。|| STEP 0 先补观测:transcript_path 在 attp-cc-capability-probe.md 只是【文档契约行】,echo-harness 实测表只亲验过 session_id/tool_input/additionalContext/deny,该字段在 PreToolUse 输入中【从未被观测】。未观测到就不实施。|| 允许条件 = A(target 在 receipt.projectRoot 内)或 B(在派生的 <host-project-state-root>/memory 内)。B 必须:transcript_path 存在/绝对/结构合法否则不启用例外;只允许精确 memory/**,不得放宽到 <slug>/**;复用现有 realpath + 最近存在祖先算法;.. / symlink / junction / Unicode case-fold 逃逸继续 deny;其他项目的 memory 必须 deny;第一版不提供任意用户 glob 接口;Bash 边界维持原设计,不借此声称成为安全隔离。|| 回归矩阵(至少):项目内代码 allow / 项目外普通文件 deny / 当前 transcript 对应 memory/MEMORY.md allow / 当前 memory 下新建 allow / 其他项目 memory deny / <slug> 下非 memory deny / memory/../escape deny / memory 内 symlink 指向外部 deny / transcript_path 缺失或畸形 deny / Windows 大小写与 Unicode 变体不得扩大权限。并须在真实 Claude Code 会话中证明一次跨会话 memory 写入成功,不能只喂 adapter JSON。|| 来源:2026-07-26 ATTP 闭环后 dogfood 实撞(守卫拒绝了 agent 自身记忆写入),用户裁定 AUTHORIZED TO ENTER BACKLOG,生产实现 NOT YET AUTHORIZED。
<!-- END_BACKLOG -->

## 🔄 最近轨迹 (≤ 10 条)

<!-- BEGIN_TRAJECTORY -->
- [1108e9d] 2026-07-26 governance-closure: ATTP (Agent Takeover Trigger Protocol) closure. spec:agent-takeover-trigger-protocol
[done], plan:ag
- [89cb3d7] 2026-07-23 governance-closure: [a177] mcp-zvec-lock closure. Final review Ready-to-merge:Yes (opus). Implementation 8db7a99..e1a7cc
- [659984d] 2026-07-23 governance-closure: [a177] mcp-zvec-lock 设计+计划阶段收口。设计文档 docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md:三层锁协调(
- [b5803d3] 2026-07-23 governance-closure: 4b-1 Architecture-Governance Wiki closure. Q5 user acceptance PASS (2026-07-23). Implementation main
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [06fd][mcp-detect-missing]: templates/cli/mcp-detect.js now exists (6.1K) and te
- [035afb0] 2026-07-22 backlog-closure: Close stale backlog [fresh-plan-progress]: fixed pre-2.3.0 in templates/cli/planning.js (plan progre
- [404343f] 2026-07-20 bug-fix: Follow-up to da53d3d. CodePLC re-dogfooded the nurtured fix and found a second, adjacent gap: templa
- [da53d3d] 2026-07-20 bug-fix: CodePLC (registered hive child, no templates/ tree) dogfooded the 2026-07-20 nurture and hit two cla
- [1ee4237] 2026-07-20 bug-fix: advanceFocusFromCommit extracts a plan/spec token from the LATEST commit message (full body, via git
- [366b66a] 2026-07-20 focus-fix: Post-commit hook auto-advanced focus onto plan:code-wiki-inspector-projection (parked, 0/3) since it
<!-- END_TRAJECTORY -->

## 📌 架构备忘 / 搁置区 (Backlog Ideas)

> ⚠️ 此区域无锚点保护，可自由追加灵感与低优先级任务，但严禁在此堆积已完成任务。

- 考虑 `raw_memory/` 原始文件层（YAML Frontmatter + Markdown），提升向量库抗毁性与换模型能力（参考 Gemini 设计文档讨论）。
- [f9b1] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。
- [llm-wiki] Karpathy LLM-wiki 思路: raw_memory 之上建主题页蒸馏层(主题页知识单元/原地更新/密集互链/低频维护),与 code wiki 互为姐妹投影。等 spec:spec-portfolio-governance 落地后作首批 adopt 候选。详见该 spec Follow-ups。
