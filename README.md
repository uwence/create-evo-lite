<div align="center">

# 🧠 create-evo-lite

**The Golden Thread for Agentic Memory & Context Persistence**  
*“以极为克制之简，锁死 AI 的心智快照。”*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) • [Usage Guide](#🚀-极速上手-quick-start) • [中文介绍](./README.md)

---
</div>

> **0 侵入、去中心化、自带双核 RAG (检索+重排) 的 Daemonless (无后台守护进程) AI 核心规则治理与记忆系统**

`Evo-Lite` 是专为 Agentic Workflow (智能体辅助编程) 打造的**高度自律型**心智约束与状态保护系统。在 v1.5.3+ 版本中，它从单纯的“记忆外挂”进化为**基于 Rules 驱动的自治治理框架**。它能在一秒钟内，为你的任何项目（不论是前端、后端还是普通脚本库）瞬间装入一个具备永久记忆、技术审美校验、且完全寄生于沙盒的超级大脑。

> [!IMPORTANT]
> **版本重大更新警示 (v2.0.0)**：本项目架构进行了核心迭代，引入了 **双层协议闭环 (Two-Tier Protocol)**。
> - **`/commit`**: 高频使用，负责代码提交、轨迹追踪与任务闭环，通过 4位 Hash ID 保证任务追踪的唯一性。
> - **`/mem`**: 低频使用，专门负责会话结束、版本跃迁与 Git Tag 发布。
> 建议务必在 Antigravity 等 Agent 终端中运行 `node .evo-lite/cli/memory.js verify` 以确保环境已自动升级。

---

## 🌟 为什么你需要 Evo-Lite？

随着 AI 编程助手变得越发强大，我们常常遇到以下**工程级痛点**：

1. **长尾失忆症**：AI 聊久了上下文崩溃，忘了昨天踩过的关键报错。
2. **讨好型人格**：AI 毫无主见，你提个简单的需求它直接塞进 5 个乱七八糟的 npm 依赖，代码风格今天 ES6 明天 CommonJS。
3. **沉重的管理成本**：市面上解决记忆问题的 RAG 通常要求你跑 Docker，挂着微服务，而我们需要极简！
4. **污染宿主**：不想为了 AI 的一个脚本，污染我原本干净的 Java 或 Rust 项目的根目录。

**Evo-Lite 用不到 200 行代码优雅地解决了这一切。**

## 🔥 核心特性 (Evo-Lite Architecture)

* **🏗️ 规则下沉治理 (.agents/rules)**
  **核心升级：** 以前靠文档说教，现在靠规则锁死。将治理逻辑由“文档引导”升级为系统级硬约束。AI 醒来第一件事就是读取 `.agents/rules/evo-lite.md`，从根源拦截劣质输出。
* **🌐 In-Tree RAG (纯本地向量引擎)**
  底层使用 `sqlite-vec` 向量数据库。AI 想查历史 Bug 记录？只需要原生自带的终端敲下 `.\.evo-lite\mem recall` 即可唤醒。
* **🧠 双核 RAG 架构 (.Dual-Pass Retrieval)**
  - **粗排 (Embedding)**: 基于 `Xenova/bge-small-zh-v1.5` 向量算法定候选。
  - **精排 (Reranker)**: 调用 `Xenova/bge-reranker-base` 进行语义交叉校验，纯本地 ONNX 推理，绝无后台驻留。
* **🛡️ 分离式显隐双层记忆区 (支持 1:N 语义切块)**
  - **显性状态机 (`active_context.md`)**：强制 AI 实时更新进度墙，杜绝任务幻觉。
  - **隐性长效库 (`memory.db` 与 `raw_memory`)**：悄无声息累积经验，随 Git 永久流转。v1.5+ 实装 1:N 语义剥离引擎，一份结构化报告可动态切分并建立多维度的向量索引。
* **🛠️ 交互式模型重铸管线 (Interactive Vectorize)**
  跨代重铸引擎。在终端一键发起脑区升维，系统自动防呆锁定旧库并打上时间戳备份，挂载更高的注意力模型（如无缝切换回 768维 的 `jina-embeddings-v2-base-zh`），从而对所有原始记忆片段进行大刀阔斧的重塑和降维打击！
* **⚓ Space-Time 溯源锚定 (Git Traceability)**
  任何一段记忆都会被强制打上 `[Time]` 和 Git `[Commit Hash]` 戳。配合 `memory-distillation.md` 规则，严禁无溯源的流水账入库。
* **🔄 无损热升级与 Fusion 融合**
  支持从 v1.3.x 跨代无损升级！自动提取旧版 API 配置，保护进度单据，并通过注入 Fusion 指令引导 AI 手动融合新进度的备份。
* **⚡ 自动化工作流与 Slash Command**
  - `/evo`: 魔法唤醒语，执行自检、嗅探技术栈并同步进度。
  - `/commit`: 高频闭环协议，用于日常开发中的代码提交、轨迹记录与任务消灭。
  - `/mem`: 存档协议，用于会话结束、版本跃迁与 Git Tag 发布。
  - `/wash`: 洗盘协议，针对历史脏数据进行脱机修复与重构。

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

运行时，系统将自动使用内置的 **ONNX Runtime (`@xenova/transformers`)** 初始化环境，并在几秒钟内静默缓存量化版模型（默认使用 `bge-small-zh-v1.5` 和 `bge-reranker-base`），无需任何额外的 Docker 或 LM Studio 部署，真正做到“开箱即用、用完即走”。

> [!TIP]
> **内嵌双核引擎**：
> - Embedding: `Xenova/bge-small-zh-v1.5` (纯 CPU 推理只需毫秒级)
> - Reranker: `Xenova/bge-reranker-base` (Quantized 量化保障极低内存占用)

见证奇迹：AI 会开始隐秘加载架构铁律，自动运行数据库 `verify` 校验，审查项目技术字典，并完美地进入状态开始服役。

### 3. 高频追踪与闭环 (/commit)
当完成一个小功能或 Bug 修复后，输入命令：
```text
/commit
```
AI 将自动执行：抓取代码 Commit Hash、记录轨迹、结构化提炼经验至向量库，并精准消除 `active_context.md` 中的对应任务。

### 4. 低频挂起与发布 (/mem)
当迭代彻底结束，需要结束当前工作会话时：
```text
/mem
```
AI 将自动执行：版本号跃迁、打 Git Tag、并挂起会话。


### 4. 给 AI 注入深层记忆 (CLI 体验)
AI (或人类) 可以在项目内随时呼出后台终端记住经验：
```bash
# 死记一个血泪教训
./.evo-lite/mem remember "遇到 Axios 502 的坑：原因是走了系统代理，加上 proxy:false 秒解"

# 查询过去的挣扎
./.evo-lite/mem recall "那个代理报错怎么修的？"

# 运行自检：查看模型是否真的加载
./.evo-lite/mem verify
```


### 4. 无损热更新 (Seamless Upgrade)
当 Evo-Lite 发布新版本（例如引入新的 `memory.js` 技能）时，在已安装的旧项目根目录下直接运行：
```bash
npx create-evo-lite@latest ./ --yes
```
系统会触发**无损热更新协议**：
- 自动提取保留你原有的 API 端口和模型配置。
- 绝对保护你的 `active_context.md` 不被清空。
- 更新核心模板，并在 AI 下次苏醒 (/evo) 时主动引导合并你的自定义设定。

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
│       └── mem.md                - /mem 交接剧本
│
└── .evo-lite/                    <-- (记忆存储与依赖区)
    ├── cli/                      - 向量库 CLI 脚本
    ├── mem.cmd                   - CLI 快捷入口 (Win)
    ├── mem                       - CLI 快捷入口 (Unix)
    ├── active_context.md         - 显性进度单
    └── memory.db                 - 隐性向量数据库
```

---

## 🏛️ 克制的艺术 (The Aesthetics of Restriction)

为什么我们用不到 200 行代码挑战上万行的重量级 RAG 框架？

在 AI 时代，**上下文是昂贵的，而心智是脆弱的**。传统的 RAG 方案倾向于“重”，要求你运行 Docker、挂载数据库服务、维护复杂的同步逻辑。这不但破坏了宿主项目的纯净感，更增加了开发者的维护心智。

Evo-Lite 的哲学内核是 **“以极简之道，御 AI 之乱”**：
1. **0 侵入才是真正的尊重**：好的工具应该像幽灵，只在被唤醒时存在。这也是我们坚持 `Daemonless` 架构的原因。
2. **沙盒是安全的最后防线**：我们宁可让脚手架稍微增大一点体积（离线包），也不愿让用户的开发环境因为缺失一个 C++ 编译器而导致记忆中断。
3. **双核检索的降维打击**：利用 `sqlite-vec` 的原生速度和极简接口，我们在毫秒级实现了“粗排+精排”的工业级逻辑，证明了高精度不一定需要高性能集群。

> *"人类对业务和代码资产充满敬畏，而 Evo-Lite 是负责给 AI 戴上紧箍咒的那根金线。"*

---
