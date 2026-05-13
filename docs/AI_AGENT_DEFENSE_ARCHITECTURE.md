# 🛡️ Evo-Lite 智能体治理边界与闭环架构 (AI Agent Governance & Closure Architecture)

> **文档目的**: 本文档说明 `create-evo-lite` 当前采用的项目内治理架构，以及它对 Hook、CLI、显性状态、长期归档和外部工具集成的边界定义。它不再把 Evo-Lite 描述为“统管所有宿主 Hook 的总调度器”，而是把它限定为一个**项目内治理与闭环运行时**。

为了让 AI 助手能够长期、稳定地维护一个复杂项目，单纯依赖 `system_prompt` 或 Markdown 里的软性自然语言约束是远远不够的。AI 会因为上下文截断、回合制盲区或注意力漂移而忽略规则。

Evo-Lite 的应对方式不是去接管所有外部工具，而是把**项目协议、当前状态、闭环落盘和少量必要的宿主治理 Hook**沉到项目树内部，让 AI 每次接管时都能看到并执行同一套最小治理面。

---

## 🏗️ 1. 核心状态池：`active_context.md` (对抗闭环失忆症)

这是整个项目流动状态的心脏，也是 AI 最容易忘记更新的地方。

* **静态协议层**: `.agents/rules/` 与 `.agents/workflows/` 定义了接管、闭环、挂起与清洗的 canonical 语义。这里是 Evo-Lite 的制度层，而不是宿主命令菜单本身。
* **CLI 提醒层**: `memory.js` 在 `remember`、`context track`、`verify` 等动作后输出明确的下一步提醒，把“该不该交接”“该不该补闭环”直接推回 AI 的视觉流中。
* **启动健康检查**: `/evo` 语义会驱动 `verify`，检查 `active_context.md`、本地索引、归档健康度以及工作区状态；如果上下文长期未更新，会提示当前接管者优先梳理状态，而不是盲目继续编码。

---

## 🗄️ 2. 隐性持久层：`memory.db` + `raw_memory` + `index_memory`

为了防止 AI 遗忘宝贵经验，或把低质量流水账塞进长期记忆层，Evo-Lite 把记忆拆成“轻量可召回缓存”和“可重建结构化归档”两条线。

* **`remember` 轻量线**: 对短期可召回知识写入本地数据库，但会施加最小质量门槛，避免长期被低熵片段污染。
* **`archive` / `track` 主闭环线**: 闭环后的结论进入结构化 Markdown 归档，并同步生成 index marker；这条线才承担长期可审计与可重建职责。
* **`verify` / `sync` / `rebuild` 自愈线**: 当归档损坏、索引缺失或数据库需要重建时，Evo-Lite 通过 CLI 自检和重建，而不是依赖外部守护进程替它兜底。

---

## 📜 3. 宿主最小治理面：Evo-Lite 自有 Hook 与生成资产

Evo-Lite 当前只拥有一组**最小、明确、可重建**的宿主治理资产，而不是所有外部工具的统一入口。

* **受管 GitHub 资产**: `.github/copilot-instructions.md`、`.github/hooks/evo-lite.json`、`.github/hooks/evo-lite-hook.js`、`.github/hooks/dogfood-commit-hook.js`
* **受管 Codex 资产**: `.codex/hooks.json`
* **受管含义**: 这些文件是 Evo-Lite 自己生成、校验和必要时覆盖的资产。它们负责当前工作流的接管提醒、闭环提醒、PreToolUse 治理和 dogfood 约束。
* **非受管含义**: RTK、GitNexus、context-mode、MCP server config 等外部能力，不再由 Evo-Lite 负责脚手架分发、统一接线或校验漂移。若项目需要它们，应由各自安装器或配置体系单独管理。

---

## 🌳 4. 版本闭环与 Git 树约束 (`package.json` & Commit)

* **残余状态扫描**: `/evo` 驱动的 `verify` 会读取 Git 工作区状态，并对遗留的未提交改动给出明确提示。
* **闭环要求**: 版本变更、提交、tag、push 与 `context track` 不是彼此无关的动作，而是一条需要明确完成的闭环链。Evo-Lite 通过协议和 CLI 提示去强调这条链，而不是假设 AI 会自发记住。

---

## 🧭 5. 边界结论 (Boundary Conclusion)

当前架构的核心不是“把所有能力都拉进一个 Hook 网里”，而是划清楚下面三层边界：

1. **canonical 语义层**：`.agents/` 与 `.evo-lite/`，负责制度、状态机、CLI 和长期归档。
2. **宿主最小治理层**：Evo-Lite 自有 GitHub/Codex Hook 资产，只负责接管、闭环、dogfood 与必要守卫。
3. **外部能力层**：context-mode、RTK、GitNexus、独立 MCP 服务等，可选接入，但不属于 Evo-Lite scaffold ownership。

也就是说，Evo-Lite 追求的不是“总线式全能接管”，而是**项目内治理运行时的最小闭环**：

- 当前状态要有地方承载
- 已完成闭环要有标准落盘通道
- AI 接管时要能被提醒风险与下一步
- 宿主侧只保留 Evo-Lite 自己真正需要拥有的 Hook 面

这才是当前版本最准确的工程边界。
