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

## 开放问题(留给 4b-1 spec)

- 架构图渲染:mermaid(生成 md 嵌入)vs 静态 SVG?点击跳转如何实现?
- 人话叙事的生成者:模板化(无 AI、确定性)能到什么程度?哪些段落值得留给 Agent 按 `/wiki` 工作流补写?(治理约束:生成物必须可从零重建,Agent 补写部分需可区分)
- 模块粒度:architecture IR 的 modules 直接用,还是需要人工分组?
