<div align="center">

# 🧠 create-evo-lite

**给 AI Vibecoding 准备的项目脚手架**  
*“不要求你先成为专业软件工程师，也能让 AI 在项目里有记忆、有交接、有边界。”*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) • [Remember Boundary](./docs/REMEMBER_BOUNDARY_DECISION.md) • [Usage Guide](#🚀-极速上手-quick-start) • [中文介绍](./README.md)

---
</div>

> **一个寄生在项目树里的、Daemonless（无后台守护进程）的 AI vibecoding 脚手架。**

`Evo-Lite` 是专为 Agentic Workflow（智能体辅助编程）打造的项目内脚手架，尤其适合**像工控、自动化、硬件、测试、运维这类并非纯软件工程背景**、但希望借助 AI 持续做项目的人。它不依赖常驻服务，不要求你额外维护一个独立 RAG 系统，而是把**规则、显性上下文、隐性记忆、CLI 工具**一起收进项目目录，让 AI 在接管项目时不只是“看到代码”，还要“继承秩序”。

> [!IMPORTANT]
> **当前版本说明**：仓库现在采用“**工作流协议 + 本地 CLI**”的双层结构。
> - **`/commit` / `/mem` / `/wash`**：定义在 `.agents/workflows/` 中，约束 AI 该在什么时机做什么。
> - **`memory.js` / `mem.cmd`**：定义在 `.evo-lite/cli/` 中，负责真正执行记忆、归档、状态更新与校验。
> 升级旧项目后，建议先运行 `node .evo-lite/cli/memory.js verify` 检查 CLI、模型、状态文件与历史记忆是否处于可继续接管的状态。

---

## 🌟 为什么你需要 Evo-Lite？

如果你本来就不是职业软件工程师，而是靠 AI 把想法、经验和业务问题快速落成小工具、小系统、小产品，那你最容易遇到的不是“不会写第一版”，而是**第二天 AI 已经不记得昨天自己干了什么**。

随着 AI 编程助手变得越发强大，我们常常遇到以下**工程级痛点**：

1. **长尾失忆症**：AI 聊久了上下文崩溃，忘了昨天踩过的关键报错。
2. **讨好型人格**：AI 毫无主见，你提个简单的需求它直接塞进 5 个乱七八糟的 npm 依赖，代码风格今天 ES6 明天 CommonJS。
3. **沉重的管理成本**：市面上解决记忆问题的 RAG 通常要求你跑 Docker，挂着微服务，而我们需要极简！
4. **污染宿主**：不想为了 AI 的一个脚本，污染我原本干净的 Java 或 Rust 项目的根目录。

**Evo-Lite 想做的不是替你变成专业软件团队，而是给你一个能长期接着做下去的 AI 项目骨架。**

## 🔥 核心特性 (Evo-Lite Architecture)

* **🏗️ 规则下沉治理（`.agents/rules`）**
  AI 不是只靠 system prompt 记住规矩，而是会在项目内读到明确的规则文件。协议、交接要求、记忆蒸馏规则都以项目资产形式存在，可被版本管理、审查和升级。
* **🌐 In-Tree RAG (纯本地向量引擎)**
  底层使用 `sqlite-vec`，向量库就跟项目一起待在 `.evo-lite/` 下。想查历史 bug、架构决策或绕坑经验，不需要外部服务。
* **🧠 双阶段检索（Embedding + Rerank）**
  - **粗排**：Embedding 先捞候选。
  - **精排**：Reranker 再把更像“真正答案”的片段排到前面。
  这套链路默认走本地 ONNX 推理，网络差时也有降级路径。
* **🛡️ 显隐双层记忆**
  - **显性状态机（`active_context.md`）**：焦点、backlog、trajectory 都有锚点边界，适合接管与交接。
  - **隐性记忆库（`memory.db` / `raw_memory` / `vect_memory`）**：结构化归档与向量索引并存，支持后续重建与同步。
* **🛠️ 可重建的归档管线**
  `archive`、`sync`、`rebuild` 让记忆不是“一次性写进去就听天由命”，而是可以补向量、重建向量、跨模型迁移。
* **⚓ Space-Time 溯源锚定 (Git Traceability)**
  `remember` 写入数据库时会补上 `[Time]` 与 `[Commit]` 头；`archive` / `track` 生成的原始档案则以 frontmatter 和结构化 Markdown 保留溯源上下文，避免把“流水账”伪装成长期知识。
* **🔄 可升级，不强依赖单次初始化**
  你可以重新运行脚手架升级模板，也可以单独跑 `verify` 检查当前实例是否和新协议脱节。
* **⚡ 工作流协议 + CLI 命令**
  - 工作流层：`/evo`、`/commit`、`/mem`、`/wash`
  - 执行层：`remember`、`recall`、`export`、`import`、`archive`、`sync`、`rebuild`、`context`

## 🧭 记忆双轨模型

Evo-Lite 当前采用一套明确的**双轨记忆模型**：

- **`active_context.md`**：当前状态面板，只维护 `META`、`FOCUS`、`BACKLOG`、`TRAJECTORY` 这类“现在正在发生什么”的信息。
- **`archive` / `track`**：长期结构化资产，用于保存已经闭环的 Bug 复盘、实现结论、架构决策和可复用经验。
- **`remember`**：轻量隐性检索缓存，适合随手记住一条以后可能会 recall 到的坑点，但**不承担主闭环的重建保证**。

推荐把三者理解成：

- `active_context`：驾驶舱
- `archive`：黑匣子
- `context track`：唯一合规落盘通道

### 流动原则

- 正在做的事：写在 `active_context.md`
- 已经闭环的事：通过 `.\.evo-lite\mem.cmd context track ...` 沉淀
- 长期经验：进入 `raw_memory/` 结构化归档
- 轻量检索线索：可使用 `remember`

默认主通道是：

```text
active_context -> context track -> archive
```

这意味着：

- 不应把大段复盘长期堆在 `active_context.md`
- 不应手工把任务记录从 `active_context.md` 复制一份到 archive
- 没有成功 `track`，就不算真正完成一次可靠闭环

---

## 🚀 极速上手 (Quick Start)

这是一个 Node.js CLI 工具。你可以在任何空目录或已有项目的同级目录下执行安装：

### 1. 运行初始化向导
你可以选择临时拉取运行，或是作为全局命令安装在你的电脑上。

**方案 A：临时拉取运行 (适合分享给他人)**
```bash
npx create-evo-lite ./MyAwesomeProject
```

**方案 B：全局安装并运行 (推荐个人日常使用)**
```bash
# 1. 讲源码拉到本地后进行全局软链
cd create-evo-lite
npm link

# 2. 之后在任何目录，都可以直接当成原生命令使用！
create-evo-lite ./我的新游戏项目
```

运行时，系统会初始化本地 ONNX 模型与 SQLite 依赖，把记忆运行时落在 `.evo-lite/` 下。你不需要再额外维护 Docker、独立数据库服务或常驻后台。

> [!TIP]
> **内嵌双核引擎**：
> - Embedding: `Xenova/bge-small-zh-v1.5` (纯 CPU 推理只需毫秒级)
> - Reranker: `Xenova/bge-reranker-base` (Quantized 量化保障极低内存占用)

初始化完成后，建议第一时间在 AI 终端里运行一次：
```bash
node .evo-lite/cli/memory.js verify
```
这一步会检查模型、记忆库、`active_context.md`、离线记忆残留以及当前工作区的可接管性。

### 2. 第一次开工建议 (适合新手)
如果你是第一次把 AI 真正拉进一个项目里，建议不要一上来就折腾所有命令，先按这个最小顺序走：

1. 先执行 `/evo`，让 AI 读取当前上下文并自检。
2. 用一句人话告诉 AI 你现在最想完成的一个小目标。
3. 做完一个小闭环后执行 `/commit`，让 AI 把代码动作沉淀成轨迹和 archive。
4. 当你准备收工时执行 `/mem`，完成一次低频交接。

如果中途 `verify` 提示需要修复 archive 或重建脑区，优先照着 CLI 给出的下一步命令走，不必自己猜。

### 3. 高频追踪与闭环 (/commit)
当完成一个小功能或 Bug 修复后，输入命令：
```text
/commit
```
`/commit` 是**工作流协议**，不是 magic command 本体。它通常会引导 AI：
- 先完成真正的 `git commit`
- 再调用 `.\.evo-lite\mem.cmd context track --mechanism="..." --details="..." [--resolve="xxxx"]`
- 把一次代码动作同步为轨迹、归档和 backlog 状态变化

### 4. 低频挂起与发布 (/mem)
当迭代彻底结束，需要结束当前工作会话时：
```text
/mem
```
`/mem` 负责低频交接。它通常用于会话结束、版本小跃迁、tag 前后的人机确认，而不是替代日常的 `/commit`。


### 5. 给 AI 注入深层记忆 (CLI 体验)
AI (或人类) 可以在项目内随时呼出后台终端记住经验：
```bash
# 记住一段经验
./.evo-lite/mem remember "遇到 Axios 502 的坑：原因是走了系统代理，加上 proxy:false 秒解，且该问题只在 CI 容器里复现。"

# 查询过去的挣扎
./.evo-lite/mem recall "那个代理报错怎么修的？"

# 把一段较长总结归档成结构化原始记忆
./.evo-lite/mem archive "这次登录链路改造的核心结论"

# 给 active_context.md 增加一条待办
./.evo-lite/mem context add "补充 README 中的升级说明"

# 运行自检：查看模型是否真的加载
./.evo-lite/mem verify

# 当 raw_memory 需要重建时，使用标准入口重建结构化归档路径
# 注意：这不会承诺保留仅存在于 memory.db 中的 remember 轻量缓存
node .evo-lite/cli/memory.js rebuild
```


### 6. 无损热更新 (Seamless Upgrade)
当 Evo-Lite 发布新版本（例如引入新的 `memory.js` 技能）时，在已安装的旧项目根目录下直接运行：
```bash
npx create-evo-lite@latest ./ --yes
```
系统会触发升级流程：
- 保护现有 `active_context.md`
- 更新 `.agents/` 与 `.evo-lite/cli/` 的核心模板
- 在检测到旧记忆库时尝试执行迁移/洗盘路径

升级之后，建议立刻执行：
```bash
node .evo-lite/cli/memory.js verify
```

## 📂 目录结构速览

```text
MyAwesomeProject/                 <-- (你的项目)
├── .agents/                      <-- (智能体行为规范区)
│   ├── rules/                    <-- 核心硬约束 (Core Rules)
│   │   ├── evo-lite.md           - Boot Sequence 拦截器
│   │   ├── project-archive.md    - 存档闭环协议
│   │   └── memory-distillation.md - 质量守门员
│   └── workflows/                <-- Slash Commands
│       ├── evo.md                - /evo 唤醒剧本
│       ├── commit.md             - /commit 高频闭环剧本
│       ├── mem.md                - /mem 交接剧本
│       └── wash.md               - /wash 洗盘与重建剧本
│
└── .evo-lite/                    <-- (记忆存储与依赖区)
    ├── cli/                      - 向量库 CLI 脚本
    ├── mem.cmd                   - CLI 快捷入口 (Win)
    ├── mem                       - CLI 快捷入口 (Unix)
    ├── active_context.md         - 显性进度单
    ├── memory.db                 - 隐性向量数据库
    ├── raw_memory/               - 原始结构化记忆档案
    ├── vect_memory/              - 已向量化档案标记
    └── .cache/                   - 本地模型缓存
```

---

## 🏛️ 克制的艺术 (The Aesthetics of Restriction)

为什么要把这套东西做成项目内资产，而不是另起一套重量级外部系统？

在 AI 时代，**上下文是昂贵的，而心智是脆弱的**。传统的 RAG 方案倾向于“重”，要求你运行 Docker、挂载数据库服务、维护复杂的同步逻辑。这不但破坏了宿主项目的纯净感，更增加了开发者的维护心智。

Evo-Lite 的哲学内核是 **“以项目内秩序，对抗 AI 的上下文漂移”**：
1. **0 侵入才是真正的尊重**：好的工具应该像幽灵，只在被唤醒时存在。这也是我们坚持 `Daemonless` 架构的原因。
2. **沙盒是安全的最后防线**：我们宁可让脚手架稍微增大一点体积（离线包），也不愿让用户的开发环境因为缺失一个 C++ 编译器而导致记忆中断。
3. **记忆要可重建，不只是可写入**：长期可维护的记忆系统，关键不在“先记住一次”，而在“以后还能迁移、补向量、重排、校验、升级”。

> *"人类对业务和代码资产充满敬畏，而 Evo-Lite 是负责给 AI 戴上紧箍咒的那根金线。"*

---
