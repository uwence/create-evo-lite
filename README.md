<div align="center">

# 🧠 create-evo-lite

**给 AI Vibecoding 准备的项目内治理运行时**  
*让 AI 不只是写代码，而是在项目里按规则接管、实施、留证、刷新状态并完成交接。*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![Runtime](https://img.shields.io/badge/Runtime-Project_Local-007acc.svg)](#)
[![Governance](https://img.shields.io/badge/Governance-Post_Commit_Hook-84cc16.svg)](#)
[![Memory](https://img.shields.io/badge/Memory-SQLite_FTS5-ff6600.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) · [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) · [Remember Boundary](./docs/REMEMBER_BOUNDARY_DECISION.md) · [Quick Start](#-极速上手)

---
</div>

## 这是什么？

`create-evo-lite` 是一个寄生在项目树里的 **AI 开发治理脚手架 + 本地运行时**。

它不是单纯的“记忆插件”，也不是独立的后台服务。它把下面这些东西放进你的项目目录：

- 给 AI 读的规则与工作流：`.agents/`、`AGENTS.md`、`CLAUDE.md`
- 项目当前状态机：`.evo-lite/active_context.md`
- 本地记忆与归档：`.evo-lite/raw_memory/`、`.evo-lite/index_memory/`、`.evo-lite/memory.db`
- 本地治理 CLI：`.evo-lite/cli/memory.js`、`.evo-lite/mem`、`.evo-lite/mem.cmd`
- 规划 / 架构 / 漂移 / Dashboard 的生成数据：`.evo-lite/generated/`
- Git post-commit governance hook：自动刷新 IR、进度、证据和 Dashboard

目标是解决大型 AI 辅助开发里的一个核心问题：**AI 可以快速写代码，但很容易忘记为什么写、写到哪、哪个任务完成了、证据在哪里、下一轮 session 应该怎么接上。**

Evo-Lite 的设计目标是成为一个“无感高压治理挂件”：AI/subagent 可以继续快速开发，但每次 commit 后治理层会自动追踪变化、发现漂移、刷新 Dashboard，并提醒缺失的 plan/task/evidence。

---

## 当前状态

当前版本已经进入 **production dogfood RC** 形态：

```text
code commit
→ post-commit governance
→ plan/progress/gaps/dashboard

raw_memory evidence commit
→ archive-evidence backfill
→ plan scan
→ R008 可被自动消除

templates/cli change
→ sync-runtime / runtime lock
→ verify 可检测镜像漂移

architecture source change
→ architecture scan/diff
→ Dashboard 更新
```

这意味着它已经不只是“开场接管 + 结束归档”的工具，而是开始覆盖 AI 实施过程中的真实治理断点。

---

## 核心理念

### 1. 项目内治理，而不是外部记忆服务

Evo-Lite 不要求你跑 Docker、不要求常驻 daemon、不要求单独维护一个 RAG 服务。治理资产和运行时都在项目树内，适合和代码一起被 Git 追踪、review、迁移和升级。

### 2. 状态与记忆双轨

```text
active_context -> context track -> archive
```

- `active_context.md` 是驾驶舱：当前 focus、backlog、trajectory。
- `context track` 是闭环动作：把本次实现/决策写入轨迹。
- `raw_memory/` 是黑匣子：长期结构化 archive。
- `remember` 是轻量检索缓存：适合记录小经验，但不是 durable 主链。

### 3. Spec → Plan → Task → Evidence

Evo-Lite 把 AI 开发任务拆成可治理链路：

```text
Spec
→ Plan
→ Task
→ linkedFiles / evidence
→ archive / raw_memory
→ Dashboard
```

`plan-ir.json` 是中间层，Dashboard、drift rules、MCP 工具都可以基于它消费项目状态。

### 4. Governance 不能靠 agent 记得执行

AI/subagent 很容易只完成代码，不更新 plan、不写 evidence、不刷新 Dashboard。Evo-Lite 的 post-commit hook 会在每次 commit 后自动判断变化类型并执行相应治理动作。

---

## 极速上手

### 1. 初始化项目

```bash
npx create-evo-lite ./MyAwesomeProject
```

或在本仓库开发时：

```bash
npm link
create-evo-lite ./MyAwesomeProject
```

初始化会生成：

```text
MyAwesomeProject/
├── AGENTS.md
├── CLAUDE.md
├── .agents/
│   ├── rules/
│   └── workflows/
├── .claude/commands/
├── .codex/hooks.json
├── .github/hooks/
└── .evo-lite/
    ├── active_context.md
    ├── cli/
    ├── raw_memory/
    ├── index_memory/
    ├── generated/
    ├── mem
    └── mem.cmd
```

### 2. 进入项目根目录

所有 `mem` / `memory.js` / Git 相关命令，都应该先进入目标项目根目录再执行：

```bash
cd MyAwesomeProject
```

不要在别的仓库里用绝对路径调用目标项目的 `.evo-lite/cli/memory.js`，否则 Git commit、工作区状态和 archive provenance 可能会绑定到错误的目录。

### 3. 首次自检

```bash
node .evo-lite/cli/memory.js verify
```

如果在 Bash / Git Bash：

```bash
./.evo-lite/mem verify
```

如果在 Windows PowerShell / CMD：

```powershell
.\.evo-lite\mem.cmd verify
```

建议触发时机：

- 第一次 `/evo` 接管
- 模板升级后
- `rebuild` / `/wash` 之后
- 怀疑 runtime、archive、hook、Dashboard 状态异常时

---

## 日常工作流

### `/evo`：接管当前项目

让 AI 先读取当前项目状态，而不是直接开始写代码。

理想接管顺序：

```text
read active_context
→ verify runtime
→ recall-first takeover
→ 判断 focus/backlog/trajectory
→ 给出下一步
```

### `/commit`：完成一次小闭环

`/commit` 是工作流协议，不一定是宿主 UI 原生命令。它的语义是：

```text
code commit
→ context track
→ raw_memory archive
→ runtime state meta commit
```

也可以使用显式快路：

```bash
./.evo-lite/mem commit "完成本次治理闭环" \
  --code-message="feat(runtime): add governance loop" \
  --mechanism="GovernanceLoop" \
  --resolve="a1b2"
```

默认只接受已经 staged 的代码改动。需要把当前全部非 `.evo-lite` 改动纳入代码快照时，再显式使用：

```bash
./.evo-lite/mem commit "..." --code-message="..." --mechanism="..." --stage=all
```

### `/mem`：低频交接

用于会话结束、版本小跃迁、发布前后交接。它不替代日常 `/commit`，更适合作为 session 级收尾。

---

## Governance Runtime

### Post-commit hook

初始化后会安装 `.git/hooks/post-commit` 中的 Evo-Lite managed block。它会根据本次 commit 的文件类型自动分类：

- `plan`：`docs/specs/`、`docs/plans/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`
- `architecture`：`templates/cli/`、`templates/.github/`、`templates/.codex/`、`.agents/`、`index.js`、`bin/`、`package.json`、`docs/contracts/`、`docs/architecture/`
- `evidence`：`.evo-lite/raw_memory/*.md`
- `code`：其他代码或项目文件

典型自动链路：

```text
plan changed
→ mem plan scan
→ mem plan progress
→ mem plan gaps
→ mem dashboard build

architecture changed
→ mem architecture scan
→ mem architecture diff
→ mem plan progress
→ mem plan gaps
→ mem dashboard build

evidence changed
→ mem plan archive-evidence --backfill
→ mem plan scan
→ mem plan progress
→ mem plan gaps
→ mem dashboard build

code changed
→ mem plan progress
→ mem plan gaps --last-commit --changed-files-from-env
→ mem dashboard build
```

Hook 会写入：

```text
.evo-lite/generated/governance/post-commit-last-run.json
```

常用命令：

```bash
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
./.evo-lite/mem hook last
./.evo-lite/mem hook install --explain
```

### Drift rules

Evo-Lite 当前包含规划和架构两类 drift check：

- R001：缺少 `.agents/rules/architecture.md`
- R002：架构规则仍含 placeholder
- R003：缺少 spec
- R004：缺少 plan
- R005：task 没有 linkedFiles
- R006：changed file 没有链接到 task
- R007：缺少正式模块边界文档
- R008：implemented / verified task 没有 archive evidence
- R009：IR stale
- R011：plan task 已完成但 spec/plan 状态未对齐

---

## Planning / Architecture / Dashboard

### 创建 spec + plan

```bash
./.evo-lite/mem plan new my-feature
```

如果当前已经有未提交改动，并希望自动把 diff 文件写进 plan 的 Files 区：

```bash
./.evo-lite/mem plan new my-feature --from-diff
```

生成的 plan 使用 Superpowers body，但 frontmatter 是显式契约：

```yaml
---
id: plan:my-feature
linkedSpec: spec:my-feature
format: superpowers
status: draft
---
```

### 刷新 planning IR

```bash
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem plan trace
./.evo-lite/mem plan lint
```

Archive evidence backfill：

```bash
./.evo-lite/mem plan archive-evidence --backfill
./.evo-lite/mem plan scan
```

### 刷新 architecture IR

```bash
./.evo-lite/mem architecture scan
./.evo-lite/mem architecture diff
./.evo-lite/mem architecture where index.js
```

Native architecture scanner 会覆盖：

```text
templates/cli/
templates/.github/
templates/.codex/
.agents/rules/
.agents/workflows/
index.js
bin/cli.js
package.json
docs/contracts/
docs/architecture/
```

### 构建 Dashboard 数据

```bash
./.evo-lite/mem dashboard build
```

输出：

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Dashboard 数据会合并：

- planning IR
- progress report
- architecture IR
- drift report
- governance last-run report
- freshness/staleness 信息

---

## 本地记忆与 Archive

### 轻量记忆

```bash
./.evo-lite/mem remember "某个以后可能要 recall 的坑点"
./.evo-lite/mem recall "关键词"
```

底层使用：

```text
SQLite FTS5 + trigram + BM25
```

### 结构化 archive

```bash
./.evo-lite/mem archive "这次实现的关键结论"
./.evo-lite/mem context track --mechanism="FixLoginProxy" --details="说明本次修复、原因和决策"
```

Archive 会进入 `.evo-lite/raw_memory/`，并可被 backfill 到 task evidence。

### 重建索引

```bash
./.evo-lite/mem sync
./.evo-lite/mem rebuild
```

`raw_memory/` 是 durable 主链，`memory.db` 是可重建索引与检索层。

---

## Runtime mirror 与模板同步

在本仓库 dogfood 开发时：

```text
templates/cli/      canonical source
.evo-lite/cli/      dogfood runtime mirror
```

原则：**优先修改 `templates/cli/`，不要直接改 `.evo-lite/cli/`。**

同步 runtime：

```bash
./.evo-lite/mem sync-runtime
```

检查 drift：

```bash
./.evo-lite/mem sync-runtime --check
```

这会使用 `.evo-lite/generated/runtime-mirror.lock.json` 检测 `.evo-lite/cli/**` 是否被手工改坏。

---

## MCP Server

Evo-Lite 提供本地 MCP server：

```bash
./.evo-lite/mem mcp
```

暴露的工具包括：

- `evo_recall`
- `evo_verify`
- `evo_plan_status`
- `evo_architecture_status`
- `evo_drift_status`
- `evo_active_context`

MCP server 是长驻进程，因此内部使用 fresh module loading，避免 scanner 代码更新后还返回旧状态。

---

## 安全边界

Evo-Lite 有基础 secret scanner，会阻断常见 token / key 写入 memory 或 archive。warn 级 PII 会被 redaction 后持久化。

原则：

- 不要把真实密钥写入 `remember` / `archive` / `active_context`
- 不要把 `.evo-lite/memory.db` 当作安全存储
- 发布前确认 `.gitignore` 与仓库策略是否符合你的团队要求

---

## 测试

```bash
npm test
npm run test:governance
```

`test:governance` 覆盖关键治理闭环：

- code-only commit 触发 R006
- plan commit 触发 scan/progress/gaps/dashboard
- evidence-only commit 触发 archive-evidence backfill
- root commit 文件检测
- dashboard freshness
- hook diff / hook last
- sync-runtime lock
- MCP freshRequire
- architecture where
- context auto-refresh
- R008 archive evidence 与 exemption
- plan new scaffold

---

## 升级旧项目

在已安装 Evo-Lite 的项目根目录下：

```bash
npx create-evo-lite@latest ./ --yes
```

之后建议执行：

```bash
node .evo-lite/cli/memory.js verify
./.evo-lite/mem hook status
./.evo-lite/mem sync-runtime --check
```

如果 `verify` 提示 runtime mirror drift：

```bash
./.evo-lite/mem sync-runtime
```

---

## 适合谁？

Evo-Lite 特别适合：

- 非职业软件工程背景，但希望用 AI 长期维护项目的人
- 工控、自动化、硬件、测试、运维、设备软件等跨领域项目
- 小工具逐渐长成中大型项目后，需要 AI 能持续接手的人
- 需要 subagent / Agent Mode / Codex / Claude Code 协同，但不想治理层失控的人
- 希望把“代码 + 计划 + 架构 + 证据 + 交接”都留在 Git 里的团队

---

## License

MIT
