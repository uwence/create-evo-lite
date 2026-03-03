# 🚀 create-evo-lite

> **0 侵入、去中心化、自带双核 RAG (检索+重排) 的 Serverless AI 记忆外挂脚手架**

`Evo-Lite` 是专为 Agentic Workflow (智能体辅助编程) 打造的心智约束与状态保护系统。它能在一秒钟内，为你的任何项目（不论是前端、后端还是普通脚本库）**瞬间装入一个具备永久记忆、技术审美校验、且完全寄生于沙盒的超级大脑**。

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
* **🧠 Reranker 精度双核引擎**
  不是简单的模糊检索，内置 Jina Embeddings (粗排) + BGE Reranker (精排) 调用逻辑。精准抓住你踩坑笔记的核心语义。
* **🛡️ 分离式显隐双层记忆区 (.evo-lite/)**
  - **显性状态机 (`active_context.md`)**：强制 AI 每次聊完更新一次工作进度。下一个 AI 醒来没有幻觉，秒懂任务。
  - **隐性长效库 (`memory.db`)**：悄无声息累积经验，随着 Git 流转，不怕换电脑。
* **📦 绝对沙盒：0 依赖溢出污染**
  Evo-Lite 的 Node 依赖 (`sqlite`等) 百分之百被锁死在 `.evo-lite/node_modules/` 下，你的宿主项目根目录干干净净，如同没有安装过一样。
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
node .evo-lite/cli/memory.js remember "遇到 Axios 502 的坑：原因是走了系统代理，加上 proxy:false 秒解"

# 查询过去的挣扎
node .evo-lite/cli/memory.js recall "那个代理报错怎么修的？"
```

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

> *"人类对业务和代码资产充满敬畏，而 Evo-Lite 是负责给 AI 戴上紧箍咒的那根金线。"*
