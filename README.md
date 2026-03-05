<div align="center">

# 🧠 create-evo-lite

**The Golden Thread for Agentic Memory & Context Persistence**  
*“以极为克制之简，锁死 AI 的心智快照。”*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./templates/ACTIVATE_EVO_LITE.md) • [Usage Guide](#🚀-极速上手-quick-start) • [中文介绍](./README.md)

---
</div>

> **0 侵入、去中心化、自带双核 RAG (检索+重排) 的 Daemonless (无后台守护进程) AI 记忆外挂脚手架**

`Evo-Lite` 是专为 Agentic Workflow (智能体辅助编程) 打造的心智约束与状态保护系统。它能在一秒钟内，为你的任何项目（不论是前端、后端还是普通脚本库）**瞬间装入一个具备永久记忆、技术审美校验、且完全寄生于沙盒的超级大脑**。

> [!IMPORTANT]
> **开发环境声明**：本项目目前深度基于 **Google Antigravity** 智能体开发环境进行设计与优化。**在进行初始化操作时，建议务必在 Antigravity 中开启 `Fast 模式` 调用本工具**，以确保 AI 严格执行初始化路径，避免出现逻辑偏离。目前暂未在 Cursor, Cline 或 GitHub Copilot 等其他环境进行适配测试。

---

## 🌟 为什么你需要 Evo-Lite？

随着 AI 编程助手变得越发强大，我们常常遇到以下**工程级痛点**：

1. **长尾失忆症**：AI 聊久了上下文崩溃，忘了昨天踩过的关键报错。
2. **讨好型人格**：AI 毫无主见，你提个简单的需求它直接塞进 5 个乱七八糟的 npm 依赖，代码风格今天 ES6 明天 CommonJS。
3. **沉重的管理成本**：市面上解决记忆问题的 RAG 通常要求你跑 Docker，挂着微服务，而我们需要极简！
4. **污染宿主**：不想为了 AI 的一个脚本，污染我原本干净的 Java 或 Rust 项目的根目录。

**Evo-Lite 用不到 200 行代码优雅地解决了这一切。**

## 🔥 核心特性 (The Art of Evo-Lite)

* **🌐 In-Tree RAG (纯本地向量引擎)**
  完全脱离后台服务！底层使用 `sqlite-vec` 向量数据库。AI 想查历史 Bug 记录？只需要原生自带的终端敲下 `node memory.js recall` 即可唤醒尘封细节。
* **🧠 双核 RAG 架构 (.Dual-Pass Retrieval)**
  **拒绝“似是而非”的低精度回复。** 本项目内置了工业级 RAG 检索链路：
  - **粗排 (Embedding)**: 基于 `Jina-V2` 向量算法，从万千记忆中瞬间定位相关候选。
  - **精排 (Reranker)**: 自动调用 `BGE-Reranker` 对候选进行深度语义交叉校验。即便关键词不匹配，也能通过语义“嗅觉”抓回真正的历史教训。
* **🛡️ 分离式显隐双层记忆区 (.evo-lite/)**
  - **显性状态机 (`active_context.md`)**：强制 AI 每次聊完更新一次工作进度。下一个 AI 醒来没有幻觉，秒懂任务。
  - **隐性长效库 (`memory.db`)**：悄无声息累积经验，随着 Git 流转，不怕换电脑。
* **📦 绝对沙盒：0 依赖溢出污染**
  Evo-Lite 的 Node 依赖 (`sqlite`等) 百分之百被锁死在 `.evo-lite/node_modules/` 下，你的宿主项目根目录干干净净，如同没有安装过一样。
* **⚓ Space-Time 刚性锚定 (Git Traceability)**
  任何一段记忆在打入向量库前，都会被系统强制打上当前的 `[Time]` 和 Git `[Commit Hash]` 思想戳。让 AI 甚至能在几个月后，自动帮人类 `git checkout` 回到踩坑当时的物理现场。
* **🤖 IDE Agent Handover (降维打击)**
  放弃用端侧小模型进行羸弱的知识总结。通过特制的架构交接协议，在进行记忆压缩 (`compact`) 时，彻底将底层数据抛出，直接由宿主 IDE 中满血版的前沿通用大模型接手推理，完成中文架构级浓缩。
* **⚡ 魔法唤醒语：`/evo` 协议 (Anti-gravity Workflow)**
  无需繁冗的 Prompt。一键在输入框敲下 `/evo` 回车，AI 立刻执行强制自检：嗅探技术栈、校验模型指纹、播报当前进度，进入“严格领航员”人格。
* **🛑 强制 Check-in (Git) 提醒机制**
  AI 在写完阶段性大功能时，被代码级约束必须强制弹窗要求人类 `git commit`，彻底告别写了 10 个文件突然写崩回档无门的悲剧。

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

运行时，向导会弹出一系列配置询问（端口、模型名），支持**一键回车拉满默认的 LM Studio 本地部署配置** (jina-v2 + bge-reranker)。

> [!TIP]
> **推荐模型下载 (GGUF)**：
> - Embedding: [jina-embeddings-v2-base-zh](https://huggingface.co/gpustack/jina-embeddings-v2-base-zh-GGUF)
> - Reranker: [bge-reranker-base](https://huggingface.co/xinming0111/bge-reranker-base-Q8_0-GGUF)

### 2. 激活你的 AI (在 IDE 中)
打开目标项目 `MyAwesomeProject`，在 Antigravity (或你的 IDE AI 助手) 的聊天框中输入神圣的指令：
```text
/evo
```
见证奇迹：AI 会开始隐秘加载架构铁律，自动运行数据库 `verify` 校验，审查项目技术字典，并完美地进入状态开始服役。

### 3. 给 AI 注入深层记忆 (CLI 体验)
AI (或人类) 可以在项目内随时呼出后台终端记住经验：
```bash
# 死记一个血泪教训
./.evo-lite/evo remember "遇到 Axios 502 的坑：原因是走了系统代理，加上 proxy:false 秒解"

# 查询过去的挣扎
./.evo-lite/evo recall "那个代理报错怎么修的？"
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

## 📂 生成的目录结构速览

```text
MyAwesomeProject/                 <-- (你的项目，完全不被污染)
├── .agents/                      <-- (IDE 工作流挂载点)
│   └── workflows/evo.md          <-- 魔法指令 /evo 响应剧本
│
└── .evo-lite/                    <-- (黑暗森林：记忆与规则区)
    ├── package.json              <-- 沙盒依赖管理
    ├── node_modules/             <-- EvoLite 的库全部在这里
    ├── ACTIVATE_EVO_LITE.md      <-- AI 第二人格启动指南 (人设规约)
    ├── active_context.md         <-- 当前进度与目标流转单
    ├── memory.db                 <-- (Lazy Load) 记忆触发后自动生成的离线大脑
    └── cli/
        └── memory.js             <-- AI 专用的命令行法杖 (RAG 脚本)
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
