# Primary-User Multi-Agent Dogfood Sprint(主用户多 Agent 实战验证)

> Phase V — Phase 4a 之后的验证阶段。本文件是工作文档,不是治理 plan/spec:无 Planning IR frontmatter,不进 plan scanner。

## 定位

本项目不是通用开源产品。核心目标:

> **让主用户(作者本人)更清楚地掌控大型 AI 编程项目,并让不同 Agent 更可靠地理解和继续开发。**

因此验证对象不是"外部用户喜不喜欢",而是:

1. 主用户使用时是否真的更容易理解项目;
2. 不同 Agent 是否能通过同一套治理信息正确接手项目;
3. 现有 CLI/MCP 是否已经足够;
4. 主用户是否仍然需要一个可视化、可浏览的 Code Wiki。

## 参与者(消费端,不是用户样本)

| 消费端 | 角色 |
|---|---|
| 主用户本人 | 最终体验与需求裁决者 |
| Codex | 本地代码修改与测试 |
| Claude / Claude Code | 代码分析和实现 |
| Antigravity | 多 Agent / 复杂任务拆解 |
| ChatGPT + GitHub | 远程仓库审查、架构分析、决策支持(GitHub-only,无本地 CLI/MCP) |

验证重点:它们能否稳定消费 Phase 4a 交付的统一 Code Explore 能力(`mem code` CLI + `evo_code_explore` MCP + plan/spec/test 文本产物)。

## V1:选择真实任务,不造验证题

不写假 demo。直接从 create-evo-lite 的下一批真实工作中选任务,覆盖四类:

### 任务 A:项目接手

给每个 Agent 相同指令:

```text
请分析当前项目正在做什么、当前 focus 是什么、
相关代码在哪里,以及建议先阅读哪些文件。
```

观察点:

- 是否能找到当前 focus;
- 是否正确理解 task、plan、spec;
- 是否引用正确文件;
- 是否把 proposed link 当成确定事实;
- 是否能解释为什么推荐这些文件。

### 任务 B:影响分析

例:

```text
如果修改 planning evidence 的数据结构,
会影响哪些模块、测试和治理链路?
```

观察点:

- 是否能找到调用关系;
- 是否识别 CLI、MCP、linker、tests;
- 是否遗漏 template/runtime mirror;
- 是否错误声称已有 Task→Symbol 实链(M1/M2 是休眠 seam,内建 producer 只产 opaque string evidence)。

### 任务 C:继续实现

让 Codex、Claude 或 Antigravity 完成一个小型真实改动。

观察点:

- 是否主动使用 `mem code` 或 MCP;
- 是否减少盲目全文搜索;
- 是否遵守 current focus;
- 是否会修改错误层级;
- 是否知道同时维护 template 与 mirror;
- 是否会误触 parked 4b。

### 任务 D:远程审查

让 ChatGPT GitHub 对某个 commit 或 branch 做 review。

观察点:

- 仅有 GitHub 访问时,Phase 4a 产物是否仍有帮助;
- 是否能从 plan/spec/test 理解代码;
- 是否缺少持久化浏览页面;
- 是否需要 Code Wiki 才能快速建立项目全貌。

## 验证矩阵

每个 Agent 执行相同或相近任务,记录结果。取值:`通过 / 部分通过 / 失败 / 未验证`,并补一列原因。

| 维度 | Codex | Claude | Antigravity | ChatGPT GitHub | 原因/备注 |
|---|---|---|---|---|---|
| 找到正确文件 | | 通过 | 部分通过 | | AG(S1): 所引文件全部存在;正确区分 templates/cli 权威源 vs .evo-lite/cli 运行副本。AG(S3): 结构图正确且补全 sync 纪律,但列举了不存在的 `templates/cli/specs.js`(实为 spec-portfolio.js)。CL: 全部正确,且给出 sync 方向 |
| 理解当前 focus | | 通过 | 通过 | | AG: focus 文本逐字准确读自 active_context.md。CL: 逐字准确 + 主动对照 Session 1 时点差异(backlog 已清空),并区分"parked/draft 方向 ≠ 正在做" |
| 区分确定/推测链接 | | 未验证 | 未验证 | | 两者均未触及 governance links |
| 识别能力降级 | | 未验证 | 未验证 | | |
| 避免虚构 Task→Symbol | | 未验证 | 未验证 | | AG: 未触及 Task→Symbol;但出现**别处虚构**——给项目冠名"(EvoRouter)",仓库零出现(系本机另一项目名,跨项目串联幻觉)。CL: 全文零虚构,所有可复核数字精确命中 |
| 正确识别影响范围 | | 未验证 | 未验证 | | 任务 A 不含 |
| 使用 Code Explore | | 部分通过 | 部分通过 | | AG(S1 裸指令): 零 CLI/MCP,靠目录列举 + 读文件。AG(S3 /evo 前置): 用了 `mem portfolio status` + `mem spec status`(治理 CLI 面),仍未用 `mem code`。CL: 重度使用治理 MCP 三件套,但未用 evo_code_explore 本体(任务 A 无代码查询需求,情有可原) |
| 需要人工补充上下文 | | 通过 | 部分通过 | | AG: 能自助读治理面,但把陈旧 backlog 当活跃待办上报,需人工纠正(见 Session 1 产品侧发现)。CL: 零人工纠偏;唯一小瑕:闭环 commit 指认 035afb0(实为 8ef921f 落库;035afb0 是 resolve 时点 HEAD,治理数据本身如此记录) |
| 是否需要可视化页面 | | 未验证 | 未验证 | | CL: 终端表格自答了 plan 全景,未表现出可视化需求 |

## 主用户五问(每次真实开发结束后回答)

1. 我是否比以前更容易知道项目当前状态?
2. 我是否知道 Agent 修改了哪个架构层?
3. 我是否能快速判断 Agent 是否偏离目标?
4. 更换 Agent 后,是否还需要重新解释大量上下文?
5. 我是否经常希望有一个可点击、可浏览的项目全貌?

**第五个问题决定 4b。**

## 会话记录

目标:记录 3~5 次实际开发过程。每次一节,格式:

```markdown
### Session N — YYYY-MM-DD — <任务一句话>
- 任务类型:A/B/C/D
- Agent:
- 矩阵增量:(只记有变化的维度)
- 五问答案:1) 2) 3) 4) 5)
- 摩擦点:
```

### Session 1 — 2026-07-22 — 任务 A 项目接手(Antigravity)

- 任务类型:A
- Agent:Antigravity(目录列举 + 读 active_context.md / package.json / templates/cli 结构,共 5 次工具调用)
- 矩阵增量:找到正确文件=通过;理解当前 focus=通过;使用 Code Explore=**失败**;需要人工补充上下文=部分通过;其余未验证
- **Agent 侧发现:**
  - ✅ focus/backlog 逐字准确;正确识别 templates/cli(权威)vs .evo-lite/cli(运行副本);推荐阅读顺序合理(状态→规则→架构→实现)。
  - ❌ 冠名虚构:称项目为"上下文/记忆流转框架 (EvoRouter)"——仓库全文零出现,EvoRouter 是同机另一项目,属跨项目串联幻觉。
  - ❌ 零验证转述:把 backlog 两条陈旧项当"活跃待处理问题"上报,未做任何一步核实(`ls templates/cli/mcp-detect.js` 一条命令即可证伪 [06fd])。
  - ❌ 未使用 `mem code` / MCP:接手路径完全绕开 Phase 4a 交付面。
- **产品侧发现(更重要):**
  - **P1 — backlog 闭环债在实战中直接误导接手 Agent**:`[fresh-plan-progress]` 已于 2.3.0 修复发布、`[06fd]` 的 mcp-detect.js 现已存在且 `test.js all` 长期 EXIT 0,但两条 backlog 均未勾销 → 治理面向 Agent 提供了错误的"当前待办"。这是 governance-closure-debt 方向的实证,**不是** 4b 证据。
  - **P2 — Code Explore 可发现性缺口**:接手指令未提及工具时,Agent 不会自发使用 `mem code`;AGENTS.md / .agents/rules 的接手路径也未引导到它 → 4a.x DX Hardening 候选("项目接手聚合命令" + 接手文档引导)。
- 摩擦点:陈旧 backlog 需人工纠偏;Code Explore 零使用。

### Session 2 — 2026-07-22 — 任务 A 项目接手(Claude,干净会话)

- 任务类型:A
- Agent:Claude Code(evo_active_context + evo_plan_status + evo_drift_status 实时 MCP 读取,自称"非转述"——复核属实)
- 矩阵增量:找到正确文件=通过;理解当前 focus=通过;使用 Code Explore=部分通过;需要人工补充上下文=**通过**;避免虚构=备注零虚构
- **复核结果(逐项对照 CLI 实测):**
  - ✅ 35 specs / 35 plans / 205 tasks、190 implemented / 15 todo —— 精确命中
  - ✅ 4 个未完成 plan 及进度(4b parked 0/3、linker-mvp draft 14/15、evidence-durability 0/5、hive-nurture 0/6)—— 精确命中
  - ✅ drift 45 warnings 0 errors(43×R008 evidence + 2×R011)、R011 语义解读正确 —— 精确命中
  - ✅ templates/cli 顶层 26 个 .js —— 精确命中
  - ✅ 主动声明"没跑 mem verify,属 /evo 完整协议范畴"—— 诚实的范围披露
  - ⚠️ 唯一瑕疵:把 backlog 闭环指认为 commit 035afb0(实际落库于 8ef921f;035afb0 是 resolve 时点 HEAD,trajectory/archive 文件名即如此记录 —— 治理数据自身的时点语义所致,详见 P4)
- **A/B 对照(P1 修复生效验证):**backlog 清空后,Session 2 正确报告"暂无活跃任务"并主动指出与 Session 1 时点的状态差异 —— 治理面修复直接改变了接手结论,P1 闭环有效。
- **验证效度注记:**Session 2 读过本 sprint 文档,知晓 Session 1 的失败模式并刻意规避("我这次刻意用了实时 MCP……就是针对第一个问题")。跨 Agent 盲测可比性受损;但这恰是产品期望行为 —— **入库的失败模式记录真的能引导后续 Agent**,本身是正面产品信号。
- **产品侧发现:**
  - **P3 — R011 多 plan 盲区**:spec:unified-code-explore-wiki-projection 有意保持 adopted(等 4b 收口),但 R011 只看到已全部 implemented 的 4a plan 就要求 status: done,无视同 spec 下 parked 0/3 的 4b plan → 4b parked 期间该警告将永久误报,且无 waiver 机制。
  - **P4 — trajectory/archive 记录 resolve 时点 HEAD 而非落库 commit**:导致 Agent 从治理数据推断出"035afb0 关闭了 backlog"的错误归因。轻微,但属"治理数据把 Agent 引向错误结论"一类。
- 摩擦点:几乎为零;两条产品侧误导(P3、P4)均源于治理面自身语义,非 Agent 能力。

### Session 3 — 2026-07-22 — 任务 A 项目接手(Antigravity,`/evo` 前置)

- 任务类型:A(变体:同一 Agent、同一指令,但先执行 `/evo` 接管协议 —— 与 Session 1 构成协议 A/B 对照)
- Agent:Antigravity(`mem portfolio status` + `mem spec status` + 目录列举 + 读 package.json)
- 矩阵增量:使用 Code Explore=失败→**部分通过**;找到正确文件=通过→**部分通过**(新虚构见下)
- **复核结果:**
  - ✅ focus 准确(无活跃 plan / Phase 4a 6/6 / advanceFocusFromCommit 修复)
  - ✅ spec 体量告警转述精确(`AC=14, Phase=10`,与 verify 输出逐字一致)
  - ✅ 4 锚点块 META/FOCUS/BACKLOG/TRAJECTORY 精确
  - ✅ sync 纪律表述正确(只改 templates/cli,跑 sync-runtime,勿直改镜像)
  - ✅ 本轮无 "EvoRouter" 级冠名虚构
  - ❌ 仍有小虚构:列举了不存在的 `templates/cli/specs.js`(实为 spec-portfolio.js;`ls` 一条命令可证伪)
  - ⚠️ 把 `/wash` 归到 `.agents/workflows/`(该目录实为 evo/commit/mem/walkthrough 四文件,无 wash.md;/wash 语义在 CLAUDE.md 适配层)
  - ⚠️ 未报告 backlog 状态(当前为空 —— 接手报告应含)
- **协议 A/B 对照(本 Session 核心发现):**同一 Agent,裸指令(S1)→ 零 CLI + 冠名虚构 + 陈旧转述;`/evo` 前置(S3)→ 主动用治理 CLI、无大虚构、状态转述精确。**接管协议实质性提升了接手质量** —— P2 的答案是:协议驱动的可发现性已生效,缺的是裸指令场景的引导(4a.x "项目接手聚合命令" 的价值边界就在这)。
- **Agent 特质画像(跨 S1/S3 稳定):**Antigravity 的失败类固定为"似真名称补全"(EvoRouter → specs.js)—— 对不确定的名字宁可编一个像的也不验证。协议可压制其幅度,不能根除。
- 摩擦点:小虚构仍需人工纠偏;backlog 状态遗漏。

### Session 4 — 2026-07-22 — 任务 A 项目接手(Claude,`/evo` 前置)

- 任务类型:A(变体:`/evo` 前置,与 Session 2 干净会话对照;与 Session 3 构成同协议跨 Agent 对照)
- Agent:Claude Code(/evo 接管 + GitNexus 索引刷新至 HEAD + 行号级代码定位)
- 矩阵增量:无降级;找到正确文件维持通过(升至**行号级精度**)
- **复核结果(逐项实测):**
  - ✅ extractPlanRefFromMessage L1404(报告"约 L1403-1408")、checkR012 L324(报告 L323-359)、checkR011 L277、checkR003 L108 —— 行号级命中
  - ✅ buildGovernanceSummary L81 / buildDashboardData L137、T27 用例存在 —— 命中
  - ✅ advanceFocusFromCommit 修复机制描述精确:`if (plan.status === 'parked')` 守卫确实存在(commit 1ee4237),含 R012 phantom-focus 关联
  - ✅ trajectory 解读正确(两条 backlog 收尾在前、autofocus 修复在后);linker-mvp 只剩 1 task 正确
  - ✅ GitNexus "288 flows" 与 .gitnexus/meta.json 精确命中(索引确实被刷新;3332 symbols 未独立复核但同源可信)
  - ⚠️ "FOCUS 目前为空" —— 字面不准(锚点非空,内容为 "No active plan...");语义正确且随即给出完整收敛史,读者不致误判
- **产品侧发现:**
  - **P5 — mem code 在母仓被 GitNexus 挤出**:S4 的代码定位全部走 GitNexus(且 CLAUDE.md 适配层本身强制 GitNexus 做代码探索)→ 在配备 GitNexus 的仓库里,任务 A 永远不会自然触发 `mem code`。4a 面向的真实生态位是**无 GitNexus 的子项目 / GitHub-only Agent / 任务 B·C 类查询**;sprint 后续必须用这些场景验证 4a,否则"使用 Code Explore"维度在母仓恒为未触发,不构成 4a 失败证据。
  - 跨会话记忆生效:S4 从 Claude 自动记忆中调出本 sprint 文档并主动列入阅读建议 —— Claude 特有优势,非产品面贡献。
- **跨 Session 对照:**S2(干净)→ 治理面精确转述;S4(/evo)→ 在此之上叠加行号级代码定位与修复机制解释。/evo 对 Claude 的增益是**深度**(治理→代码语义),对 Antigravity 的增益是**纪律**(裸猜→用 CLI)。协议对不同能力档 Agent 的收益维度不同。
- 摩擦点:仅"FOCUS 为空"字面表述;近零纠偏。

## 决策规则

| 情况 | 证据 | 结论 |
|---|---|---|
| 一 | Agent 表现良好,主用户能掌握项目 | 4a 足够;4b 继续 parked;至多优化文档/提示词/使用说明 |
| 二 | Agent 能使用,但命令输出不够直观 | 进入 **4a.x Agent/DX Hardening**(见下),不开发 Wiki |
| 三 | 主用户反复需要图形化项目全貌(五问第 5 条重复出现,CLI/MCP 无法替代) | 激活 **4b-1 Minimal Code Wiki**(仅 cw-wiki;Inspector 继续 parked) |
| 四 | Agent 经常无法准确关联 task 和函数 | 走 **Evidence IR / Task-to-Code Producer**(spec codegraph-adapter-governance-linker §11),不是 4b —— Wiki 只能展示已有信息,不能凭空产生可信 Task→Symbol 链路 |

### 4a.x Agent/DX Hardening 候选(情况二)

- 更好的 `mem code context` 文本输出;
- 更明确显示 confirmed / derived / proposed;
- recommended reading 附原因;
- Agent 使用指南;
- 针对不同 Agent 的提示模板;
- 一条"项目接手"聚合命令。

## 4b 激活标准(与 4b 计划 Activation criteria 同步)

证据来源:**主用户持续真实使用中的重复需求,或真实协作者** —— 不再要求非作者外部用户。硬标准:

```text
主用户在多个真实开发任务中,
至少两次明确需要持久化、可浏览、可导航的代码与治理视图,
且 CLI/MCP 无法有效替代。
```

激活时先做 4b-1 Minimal Code Wiki,验证静态 Wiki 是否解决问题后,再决定是否需要实时 Inspector。

## 执行顺序

1. ✅ 修订 Validation Sprint 定位(本文件)
2. ✅ 修订 4b activation criteria(`docs/plans/code-wiki-inspector-projection.md`)
3. ✅ 建立多 Agent 验证矩阵(本文件)
4. ⬜ 用真实任务连续 dogfood
5. ⬜ 记录 3~5 次实际开发过程(上方"会话记录")
6. ⬜ 决定下一阶段:4a.x Hardening / 4b-1 Minimal Code Wiki / Evidence IR / 暂不开发
