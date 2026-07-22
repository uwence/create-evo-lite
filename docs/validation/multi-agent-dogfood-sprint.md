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

| 维度 | Codex | Claude | Antigravity | Hermes(本地,代位) | ChatGPT GitHub(真远程,S7) | 原因/备注 |
|---|---|---|---|---|---|---|
| 找到正确文件 | 通过 | 通过 | 部分通过 | 部分通过 | 通过 | CG(S7): GitHub-only 达行号级(plan-not-startable 实存 memory.service.js:1455、code-perception.js 四函数名全对、plan status:done、META 逐字)。AG(S1): 所引文件全部存在;正确区分 templates/cli 权威源 vs .evo-lite/cli 运行副本。AG(S3): 结构图正确且补全 sync 纪律,但列举了不存在的 `templates/cli/specs.js`(实为 spec-portfolio.js)。CL: 全部正确,且给出 sync 方向,S4 达行号级。CX(S5): 职责表全对,4 个行号引用 ±1 命中。HM(S6): 拓扑正确、3 个文件体积精确命中(104K/27K/135K),但计数系统性偏差(plan/spec 实为 9/9 报 8/8;"31 个文件"与实际不符;"4 条 Non-Negotiables"把章节号当条数,实为 7 条) |
| 理解当前 focus | 通过 | 通过 | 通过 | 通过 | 通过 | CG: 全场唯一双层区分"正式治理 focus(无活跃 plan)vs 实际工作(Phase V sprint)";并正确把上传的旧评审文档判为历史时点而非现状。AG: focus 文本逐字准确读自 active_context.md。CL: 逐字准确 + 主动对照 Session 1 时点差异(backlog 已清空),并区分"parked/draft 方向 ≠ 正在做"。CX: 唯一以"当前工作是 dogfood sprint 本身,非新功能"作顶层框架的 Agent;4b parked 边界明确;正确推断下一步是任务 B。HM: focus 逐字 + trajectory 最新 3 条准确 + "主动留白的 idle 态"解读到位 |
| 区分确定/推测链接 | | 未验证 | 未验证 | | 通过 | CG(S7) 首次触发此维度:准确陈述默认 pipeline 只能产 declares_file / changed_by_commit / related_to_focus,而 implements_task:derived / verified_by_test / evidenced_by_archive 默认端到端不可产出(与 spec §3.5 逐点一致);本地 Agent 均未触及 |
| 识别能力降级 | | 未验证 | 未验证 | | 通过 | CG: 正确描述"能力不足返回成功形态降级而非报错"与"MCP 不得误报 isError:true"(§3.1 语义) |
| 避免虚构 Task→Symbol | 未验证 | 未验证 | 未验证 | 未验证 | 通过 | CG: 主动解释"为什么不能把 linkedFile 全部 symbol 当作 Task 实现"。AG: 未触及 Task→Symbol;但出现**别处虚构**——给项目冠名"(EvoRouter)",仓库零出现(系本机另一项目名,跨项目串联幻觉)。CL: 全文零虚构,所有可复核数字精确命中。CX: 零虚构。HM: **任务 C 描述虚构**("写一份 code wiki",实为"继续实现"——且指向 parked 4b 方向);自称 Codex(实为 Hermes);引用不可核实的"上次答" |
| 正确识别影响范围 | 通过 | 通过 | 未验证 | | 未验证 | CX(S9b): 无任何结构工具辅助,凭源码给出跨 CLI/workspace/MCP/bridge/治理五层影响面,行号抽查 4/4 命中;mem code 第二轮补强治理维度而不推翻。CL(S8,控制会话非干净被测体): GitNexus impact 预测与 detect_changes 实际改动完全一致;`mem code impact` 母仓零信息量(P5) |
| 使用 Code Explore | 部分通过 | 部分通过 | 部分通过 | 部分通过 | 未验证(无运行时) | CX(S9b 子项目,零竞争): 裸场景自发性=**失败**;引导后六件套用满,效用=部分(治理链有效、结构查询空)—— P2/P7 终版证据。CG: GitHub-only 无法执行 CLI/MCP,维度不适用;但准确列出 8 个 mem code 子命令与注册位置。AG(S1 裸指令): 零 CLI/MCP,靠目录列举 + 读文件。AG(S3 /evo 前置): 用了 `mem portfolio status` + `mem spec status`(治理 CLI 面),仍未用 `mem code`。CL: 重度使用治理 MCP 三件套,但未用 evo_code_explore 本体。CX: /evo 治理面,未用 mem code。HM: 同前。**全体未触发 mem code —— 见 P5,母仓任务 A 不构成 4a 证据** |
| 需要人工补充上下文 | 通过 | 通过 | 部分通过 | 部分通过 | 通过 | CG: 零纠偏,且自行完成陈旧上传材料的时点甄别。AG: 能自助读治理面,但把陈旧 backlog 当活跃待办上报,需人工纠正(见 Session 1 产品侧发现)。CL: 零人工纠偏;唯一小瑕:闭环 commit 指认 035afb0(实为 8ef921f 落库;035afb0 是 resolve 时点 HEAD,治理数据本身如此记录)。CX: 零纠偏,时点自洽。HM: 任务 C 虚构与计数偏差需人工纠正 |
| 是否需要可视化页面 | | 未验证 | 未验证 | | 通过(不需要) | **CG(S7) 决定性证据:GitHub-only 仅凭现有文本面(plan/spec/rules/sprint/active_context)重建全貌至行号级,并明确反对现在创建 wiki.js —— 4b 激活标准第 3 条被测且不触发**。CL: 终端表格自答了 plan 全景,未表现出可视化需求 |

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

### Session 5 — 2026-07-22 — 任务 A 项目接手(Codex,`/evo` 前置)

- 任务类型:A(时点:HEAD=f3ffa16,S4 记录尚未 push —— 其"已完成 3 次 Task A"与"最新三次提交都在记录实测结果"对该时点完全自洽)
- Agent:Codex(/evo 接管)
- 矩阵增量:Codex 列首次填入 —— 找到正确文件=通过;理解当前 focus=通过;Code Explore=部分通过;人工补充上下文=通过
- **复核结果:**
  - ✅ 4 个行号引用全部 ±1 命中:index.js:87(≈L88 buildProgram,description 逐字 "Scaffold Evo-Lite into a target project")、memory.js:698(≈L699 safeRegister —— 命令注册机制本体)、memory-index-zvec.js:53(≈L54 initialize/loadZvec)、post-commit-code-perception.js:79(≈L80 runPostCommitCodePerception)
  - ✅ 职责分布表九行全对(hooks/planning/spec-portfolio/sync-runtime/test 等)
  - ✅ 零虚构;所有点名文件实存
  - ✅ **唯一以"当前工作是 dogfood sprint 本身,不是新功能开发"作顶层框架的 Agent**;4b parked 边界明确("不应当作正在开发");正确从决策规则推断下一步为任务 B
  - ✅ 阅读顺序把 sprint 文档列第 2 位 —— 对"为什么会收到这个 prompt"的语境自觉
- **跨 Agent 定位:**Codex 的强项是**任务语境判断**(它答的是"项目此刻处在什么阶段",而非仅"项目是什么");代码定位精度介于 AG 与 CL(S4) 之间;深度上未主动跑 plan/drift 全景(任务 A 不要求,不扣分)
- 摩擦点:零。
- **任务 A 横向小结(S1-S5,4 个本地 Agent 全部完成):**/evo 前置下四家全部达到"可信接手"水平;失败仅出现在裸指令场景(S1)。产品结论收敛于:① 治理数据质量主线 P1/P3/P4;② 裸指令引导缺口 P2(4a.x);③ mem code 生态位澄清 P5。**4b 五条激活标准在本地 Agent 侧零触发**;唯一未测面是 GitHub-only(任务 D)。

### Session 6 — 2026-07-22 — 任务 A 项目接手(Hermes,`/evo` 前置,顶替 ChatGPT GitHub 位)

- 任务类型:A(注:Hermes 为**本地读取**,ChatGPT GitHub 位的 "GitHub-only" 前提未被满足 —— 4b 激活标准第 3 条仍无测试者)
- Agent:Hermes(报告自称 "(Codex)" —— 身份自述错误;另引用一段不可核实的"上次答"自评)
- 矩阵增量:第 4 列首次填入(列注明代位与未测前提)
- **复核结果:**
  - ✅ focus 逐字;BACKLOG 空;TRAJECTORY 最新 3 条(2×backlog-closure 07-22 + bug-fix 07-20)准确;"主动留白的 idle 态"解读到位
  - ✅ 3 个文件体积精确命中:memory.service.js 104K、index.js 27K、4a plan 135K
  - ✅ 4a shipped / 4b parked 边界正确;识别受控实验语境(同 CX)
  - ❌ **任务 C 描述虚构**:称任务 C 为"写一份 code wiki" —— sprint 文档任务 C 实为"继续实现";该虚构还危险地指向 parked 4b 方向
  - ❌ 计数系统性偏差:docs/plans、docs/specs 实为 9/9,报 8/8;".evo-lite/cli 31 个文件"与实际不符;"4 条 Non-Negotiables"把章节号当条数(实为 7 条)
  - ⚠️ 身份自述错误(自称 Codex);阅读建议整体合理(README TL;DR → active_context → evo.md → architecture.md 因果序是全场唯一给出"读的目的"的)
- **Agent 特质画像:**叙事与解读最佳(idle 态、受控实验、因果阅读序),但**数字与列表边界不可靠**——体积能精确到 K 却数不对文件数,说明其信息来自部分采样 + 补全,与 AG 的"似真名称补全"同类但表现在计数层。
- **产品侧注记:**GitHub-only 面(4b 激活标准第 3 条)因代位失去测试者 —— 该条标准要么后续找真远程 Agent 补测,要么在决策时按"不可评估"处理,不得默认触发。
- 摩擦点:任务 C 虚构需纠正(若被执行会误开 4b 方向的工作);计数不可直接引用。

### Session 7 — 2026-07-22 — 任务 A/D 项目接手(ChatGPT 网页版,GitHub-only 真远程)

- 任务类型:A + D(**首个真正的 GitHub-only 被测体**,补上 Hermes 代位留下的空格;另带少量用户上传的历史文档)
- Agent:ChatGPT(GitHub 仓库读取,无本地运行时,无法执行 CLI/MCP)
- 矩阵增量:第 5 列全新填入 —— **首次触发 3 个此前全场未验证的维度**(区分确定/推测链接=通过;识别能力降级=通过;避免虚构 Task→Symbol=通过);是否需要可视化页面=通过(不需要)
- **复核结果(独有断言逐项实测,零虚构):**
  - ✅ `plan-not-startable` 逐字实存(memory.service.js:1455)—— GitHub-only 达行号级
  - ✅ code-perception.js 四函数名全对(safeReadActiveContext L52 / resolveFocusReferences L83 / callProvider L160 / rankRecommendedReading L440)
  - ✅ 4a plan `status: done`、8 个 mem code 子命令、provider 目录结构、META"无感高压治理挂件"逐字
  - ✅ spec §3.5 默认 pipeline 边界逐点复述正确(只产 declares_file/changed_by_commit/related_to_focus)
  - ✅ 4b 五条激活标准转述准确;明确"目前不应创建 wiki.js"
  - ✅ 双层 focus 区分(正式治理 focus vs Phase V 实际工作)全场最佳;把上传的旧评审文档正确判为历史时点
- **决定性产品发现:**
  - **P6 — 4b 激活标准第 3 条被测且不触发**:GitHub-only Agent 凭现有文本面高效重建了项目全貌(定位、阶段、边界、下一步),精度达行号级 —— "GitHub-only Agent 无法高效重建项目结构"不成立。**4b 激活标准至此 5 条全部可评估,0 条触发。**
  - 值得注意的机制:它能做到这一点,靠的正是 Evo-Lite 强迫沉淀的文本产物(plan/spec/rules/sprint/active_context)—— 治理文本面本身就是"可浏览的项目全貌",这是 4a 路线的间接胜利。
- **任务 A/D 阶段终局(S1-S7):**5 个 Agent、裸指令/协议/本地/远程四象限覆盖完毕。接手向证据全部收齐,矩阵 9 维中 8 维至少被一个 Agent 触发(仅"正确识别影响范围"待任务 B)。
- 摩擦点:零(其引用系统 fileciteturn 占位符为 ChatGPT 界面产物,非内容错误)。

### Session 8 — 2026-07-22 — 任务 B+C 合并:影响分析 + 真实修复 P3(Claude 控制会话)

- 任务类型:B(影响分析)+ C(继续实现)。真实工作:修复 Session 2 发现的 P3(R011 多 plan 盲区),非造题
- 执行者:Claude(本 sprint 的控制会话,已载入全量上下文 —— 非干净被测体,矩阵记录已注明)
- **任务 B 实测:**
  - `mem code impact checkR011` → "no structural provider",exit 0 诚实降级;`mem code callers` → 0。**首次在真实任务中主动使用 4a 面,结果零信息量** —— 母仓只有 native-lite(fallback),CodeGraph 未安装。P5 第三次实证,且暴露新问题:**主用户自己的仓库尚未安装 4a 设计所依赖的 structural provider**,"CLI/MCP 是否足够"的问题在母仓实际上是"provider 是否在场"的问题。
  - GitNexus impact:CRITICAL(共享底层高扇出);d1 仅 runPlanningDrift;d2 波及 MCP evo_drift_status / mem plan gaps / Inspector API。判定可安全推进(只收紧触发条件、不改输出形状)。
  - 事后校验:detect_changes 实际改动符号(checkR011 + 测试)与预测完全一致。
- **任务 C 实施(TDD):**
  - RED:multi=1(应 0,盲区)、dup=2(应 1,重复 finding —— 复核中发现的**潜伏第二缺陷**:同 spec 两个完成 plan 产生重复 `R011:<spec>` id)
  - GREEN:checkR011 改为按 spec 分组,仅当该 spec 全部 linked plan 完成才触发;单 plan 消息保持旧措辞;补导出 checkR011;新增 T26b(压制/触发/去重三例)
  - 实景效果:`plan gaps` 由 2×R011 → 1×R011(wiki-projection 误报消失,hive-nurture 真债保留);双侧 all EXIT 0;镜像二次 sync copied:0
  - 纪律核查:只改 templates/cli 后同步;未触碰 parked 4b;R009(architecture IR 落后)为治理机对本次在途编辑的正确感知,commit 后由钩子刷新
  - 落库:fix b4477a8 + chore 493b52c(GitNexus 索引头 2045→3332,系 S4 刷新副产物,数字与 S4 报告互证)
- **P3 状态:已修复关闭。**
- **产品侧新发现:**
  - **P7 — 母仓 provider 缺席**:4a 的结构能力(impact/callers/callees)在主用户自己的仓库不可用,因 CodeGraph 未安装、native-lite 只有文件级降级。要让"CLI/MCP 是否足够"得到公平回答,需要:在母仓安装 CodeGraph 做真实 dogfood,或在无 GitNexus 的子项目(CodePLC 等)测任务 B/C。否则 4a 结构面的 dogfood 恒为空转。
- 摩擦点:`mem code impact` 空转(P7);其余流程(TDD/sync/双侧回归)顺滑。

### Session 9(准备)— 2026-07-22 — 子项目 CodePLC dogfood 环境就绪

- 依据 Session 8 P7 决策:转入无 GitNexus 的子项目验证 4a 真实生态位(用户选定路线 b)
- 环境动作:`mem hive nurture CodePLC` applied(copied=2,恰为当日 R011 修复 + T26b;rollback tag evo-nurture-pre-2.3.0-20260722T114446);子项目已 commit 248ea0b 收编
- **子项目 4a 基线(后续 Session 的对照原点):**
  - providers:仅 native-lite(fallback, ready, degraded)—— 无 GitNexus、无 CodeGraph,4a 是唯一代码感知面
  - governance links:**confirmed=202 / derived=0 / proposed=0**(子项目自有 Planning IR 产生的真实链)
  - `code search`:0 matches(native-lite 无符号级检索,诚实降级)
- 待执行:在 CodePLC 用干净 Agent 跑任务 A(裸指令 vs /evo)、任务 B(真实改动的影响分析,先裸后引导)、任务 C(真实小改动);观察 mem code 在无竞争环境下的自发使用率与实际效用

### Session 9a/9b/9c — 2026-07-22 — 子项目 CodePLC 任务 A+B+C(Codex)

- 执行环境:CodePLC(无 GitNexus / 无 CodeGraph,4a 唯一感知面);执行者 Codex
- **9a 任务 A 复核:**focus 逐字准确(P0-3 await Task 5 review / Task 6 未授权);`7fdf1f08` 实存且文件对应;"main ahead 1"与当时未推的 nurture 收编 commit 一致;主动指出 active_context 焦点时效性(07-17 记录 vs 07-22 HEAD)—— 子项目同样存在轻度状态陈旧(P1 家族)。质量:通过。
- **9b 任务 B(两轮对照,本 sprint 最关键的 4a 数据):**
  - 第一轮(裸):完全凭源码分析给出跨层影响面(CLI/workspace/MCP/bridge/治理),行号引用抽查 4/4 命中(drift.py:381=projectLogicalId、operations.py:58=build_project、server.py:483=call_tool、apply.py:85);质量高。**全程未用 mem code —— 在零竞争环境下自发性仍为失败**(Codex 自评"未达标",诚实)。
  - 第二轮(引导):用满 providers/status/context/search/explore/impact 六件套。**效用自评"部分有效",与实测一致**:治理链(confirmed=202)把改动关联到 apply safety / Windows 受控路径 / workspace manifest 等治理资产 —— 真实增益;但 search/explore/impact 全部 0 结果(native-lite 无结构能力),**不能替代第一轮的源码调用链分析**。结论未被推翻,只被治理维度补强。
- **9c 任务 C:**落地 managed-project-copy 于分支 codex/managed-project-copy;608 passed / 契约 2/2 PASS / active_context valid / 工作树干净;**完整治理闭环三连 commit 实存**(verify contract → close spec → context track)。
- **矩阵增量:**Codex 正确识别影响范围=通过;使用 Code Explore 裸场景自发性=失败(见 P2 终版)。
- **产品侧定论级发现:**
  - **P2(终版):可发现性缺口是结构性的,与竞争无关** —— 零竞争环境 + 裸指令,Agent 依然不用 mem code。修复只能靠引导面(4a.x:接手聚合命令 + AGENTS.md/rules 显式路由)。
  - **P7(终版):无 structural provider 时,4a 结构面在真实任务 B 中为零产出**;4a 今天的真实价值 = **治理上下文面**(202 条 confirmed 链真实帮到了影响分析的治理维度)。要结构面兑现,需在子项目采纳 CodeGraph,或明确将 mem code 定位为治理上下文工具。
  - **P8(正向):子项目治理全闭环被非 Claude Agent 走通** —— spec→plan→契约→close→track→干净工作树,由 Codex 独立完成。治理系统的可迁移性得到最强实证。
- 摩擦点:native-lite 结构查询空转伴"文件被占用"诊断;其余顺滑。

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
