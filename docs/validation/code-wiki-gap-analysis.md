# Google Code Wiki 差距分析(4b-1 设计输入)

> 2026-07-22,Session 11 后续。实地调研 codewiki.google(Playwright 实拍 protocolbuffers/protobuf 的 wiki 页)。目的:回答主用户"看下它就知道我们和它之间的差异"。

## Google Code Wiki 实测信息架构

以 `codewiki.google/github.com/protocolbuffers/protobuf` 为样本(页面快照 2026-07-22):

1. **侧栏 "On this page" 架构树**:层级化、可折叠的章节树,节点是**架构分区**("Compiler and Code Generation" → "C++ Code Generation Details" 等两级),不是数据源分页。
2. **溯源块(侧栏底部)**:`Updated on Feb 10, 2026` + `Commit 0e4441f`(链到 GitHub tree)+ "Gemini can make mistakes" 免责 —— 每页锚定到一个确定的 commit。
3. **概览区**:可缩放**架构图(Diagram)**与叙事段落并排。
4. **叙事形态(核心)**:纯人话段落,但**每个技术名词都是链接**——
   - 具体术语(`.proto`、`protoc`、`upb`)→ GitHub 精确 **file#line** 深链;
   - 架构概念("Build Systems")→ 本 wiki 的**章节锚点**。
5. **每章节**:自有锚点 + share 按钮;H2/H3 层级与侧栏树一致。
6. **Chat 按钮**:与代码库对话(Gemini)。
7. **刷新机制**(官网主张):PR merge 后自动更新相关文档。

## 差距表(vs 现有 `mem inspect`)

| 维度 | Google Code Wiki | 现 inspector | 差距本质 |
|---|---|---|---|
| 导航骨架 | 架构分区层级树 | 数据源平铺 tab(timeline/planning/archive/…) | **按架构空间组织 vs 按治理数据源组织** |
| 内容形态 | 人话叙事,术语全可点 | IR 字段直投(治理术语) | **缺翻译层** —— 主用户评"专业术语面板" |
| 图 | 可缩放架构图为概览之骨 | 无图 | 图是入口,不是装饰 |
| 链接密度 | 名词→file#line;概念→锚点 | archive 只有文件名、**点不开** | 一切可点是底线 |
| 溯源 | Updated on + Commit sha | 无 | 信任锚(我们有 headSha,数据已在) |
| 刷新 | PR merge 自动 | 实时读运行态 | 我们本地按需重生成**更容易**(主用户已接受非同步) |
| 问答 | 内嵌 Gemini chat | 无 | **可不做**:主用户本来就在 AI chat 界面里工作 |

## 我们独有、Code Wiki 没有的数据

Code Wiki 只讲"代码是什么";Evo-Lite 治理面另有"**做到哪了**":

- plan/task 进度(35 spec / 35 plan / 205 task IR)
- focus / trajectory(当前在动哪个模块)
- drift / verify 健康
- governance links(module ↔ task ↔ commit,confirmed=202 级别的真实链)

**4b-1 的定位由此确定:Code Wiki 的形态 × Evo-Lite 的治理数据** —— 架构图为骨、模块页为肉,每模块页 = 人话描述 + 该模块的进展/状态/最近变更,名词与文件全可点。

## 对 4b-1 的具体设计约束(从差距推出)

1. 首页 = 架构图(architecture IR 的 modules 为节点)+ 概览叙事;点击模块 → 模块页。
2. 模块页 = 人话职责描述 + 进度条(该模块关联 task 的 implemented/total)+ 状态(drift/verify 摘录,翻译成人话)+ 关键文件列表(可点开源码)+ 最近 commit。
3. 每页脚注:`生成于 <时间> @ <headSha>`(溯源锚)。
4. 生成模型:`mem wiki build` 一次性静态生成(HTML/Markdown),按需刷新 —— 不做实时服务器。
5. 术语翻译层是硬要求:出现治理词(R008/IR/drift)必须伴人话解释或直接用人话替代。
6. 不做内嵌 chat(主用户的 chat 就是 AI 助手本体)。

## 开放问题(留给 4b-1 brainstorm/spec)

1. 架构图渲染:mermaid(生成 md 嵌入)vs 静态 SVG?点击跳转如何实现?
2. 人话叙事的生成者:模板化(无 AI、确定性)能到什么程度?哪些段落值得留给 Agent 按 `/wiki` 工作流补写?(治理约束:生成物必须可从零重建,Agent 补写部分需可区分)
3. 模块粒度:architecture IR 的 modules 直接用,还是需要人工分组?
4. **链接契约(2026-07-22 复审补充):**"一切可点"必须先定义链到哪 —— GitHub `blob/<sha>/file#L` / 本地生成的源码 HTML 页 / wiki 章节锚点 / VS Code URI / `file://`。难点:未 push 的本地 commit 无 GitHub 深链;静态 HTML 难以可靠唤起本地编辑器精确行号。
5. **进度与健康的计算语义(2026-07-22 复审补充):**"implemented/total"背后必须先锁定 —— 跨模块 task 是否重复计数;todo/active/implemented/verified/done 各如何计入;无 task 模块显示 0/0、N/A 还是"尚未纳入规划";proposed link 是否参与;drift warning → 正常/注意/风险的映射;verify 失败与 provider stale 的优先级;"最近变更"的时间窗。**这些不能交给叙事层自由发挥。**

## 初步倾向(2026-07-22 复审,brainstorm 起点非终裁)

- **架构图:优先静态 SVG**(节点精确点击、状态/进度/焦点可视化、无运行时依赖、离线可开、输出可测试);mermaid 仅作低成本 fallback/调试输出。
- **叙事分两层:事实层 100% 确定性生成(可删可重建);解释层 Agent 可补写但必须标注来源/时间/commit**,且只能翻译已确定的事实,不得新增任务状态、依赖或健康结论。MVP 必须在无模型时也能生成可用页面。
- **模块粒度:Architecture IR 为 canonical,页面层允许独立 view grouping**(一个展示分组可含多个 IR 模块),不为布局改 IR、不动治理链接身份。
- **链接契约倾向:MVP 自生成轻量源码查看页** `source/<encoded-path>.html#L123`(本地离线可用、行号稳定、无服务器、名词皆可链),另提供可选 GitHub commit permalink。
- **进度/健康倾向:先建确定性 `ModuleProjection` 模型**(moduleId / taskCounts / progressState / healthState / focusState / changedFiles / recentCommits / provenance),叙事层只解释该模型,不自行计算事实。
