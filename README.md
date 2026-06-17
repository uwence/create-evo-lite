<div align="center">

# 🧠 create-evo-lite

**项目内 AI 开发治理运行时（Project-local AI Governance Runtime）**  
*让 AI / subagent 不只是写代码，而是在项目里按规则接管、规划、实施、留证、刷新状态并完成交接。*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![Runtime](https://img.shields.io/badge/Runtime-Project_Local-007acc.svg)](#)
[![Governance](https://img.shields.io/badge/Governance-Post_Commit_Hook-84cc16.svg)](#)
[![Memory](https://img.shields.io/badge/Memory-SQLite_FTS5-ff6600.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) · [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) · [Contracts](./docs/contracts/) · [Quick Start](#-quick-start--极速上手) · [Command Reference](#-command-reference--命令速查)

---
</div>

## TL;DR

`create-evo-lite` 是一个安装到项目树里的 AI 开发治理脚手架。它不是单纯的 memory 插件，也不是独立后台服务，而是一套把 **规则、状态、计划、架构、证据、归档、Dashboard 和 Git hook** 串起来的本地运行时。

它解决的是大型 AI 辅助开发里的核心断点：

```text
AI 写了代码
但没有更新 plan
没有留下 evidence
没有刷新 dashboard
没有说明下一轮怎么接手
subagent 做完任务后 governance 断链
```

Evo-Lite 2.x 的目标是把这种断链变成可检测、可提醒、可自动刷新的治理闭环。

---

## 当前定位：Evo-Lite 2.x Governance Runtime

从早期版本到当前 2.x，Evo-Lite 已经从“项目内记忆工具”演进成了：

```text
项目状态机
+ 本地 archive / recall
+ Spec / Plan / Task IR
+ Architecture IR
+ Drift rules
+ Post-commit governance hook
+ Dashboard data
+ MCP server
+ Runtime mirror lock
```

当前仓库已经进入 **production dogfood RC** 形态：

```text
code commit
→ post-commit governance
→ plan progress
→ plan gaps
→ dashboard build

plan/spec commit
→ plan scan
→ plan progress
→ plan gaps
→ dashboard build

raw_memory evidence commit
→ archive-evidence backfill
→ plan scan
→ R008 evidence closure
→ dashboard build

architecture/runtime/template commit
→ architecture scan
→ architecture diff
→ dashboard build
```

这意味着 Evo-Lite 不再只是“开场接管 + 结束归档”的工具，而是在 AI 实施过程中持续参与治理。

---

## 适合谁？

Evo-Lite 特别适合：

- 用 AI 长期维护项目，但不想自己先成为完整软件工程团队的人
- 工控、自动化、设备软件、测试、运维、硬件集成等跨领域项目
- 小工具逐渐长成中大型项目后，希望 AI 能持续接手的人
- 使用 Codex、Claude Code、Agent Mode、subagent、MCP 等工具的人
- 希望把“代码 + 计划 + 架构 + 证据 + 交接”都留在 Git 项目里的团队

如果你的项目只有几十行脚本，Evo-Lite 可能显得重；如果你的项目开始出现多轮 AI 交接、任务拆分、subagent 并发、文档和代码不同步，它会非常有价值。

---

## 核心问题：AI 不是不会写代码，而是不会持续治理

Vibecoding 在小项目里很轻松：给 AI 一段上下文，它能快速写完。但项目变大后，常见问题会变成：

1. **上下文断裂**：下一轮 AI 不知道上一轮为什么这么改。
2. **计划漂移**：代码变了，plan 还是旧的。
3. **证据缺失**：任务显示完成，但没有 archive / evidence。
4. **架构失真**：模块越来越多，人类和 AI 都不知道全貌。
5. **subagent 旁路**：subagent 完成代码任务，却没有更新治理链路。
6. **Dashboard 过期**：看起来像当前状态，其实是上一次 scan 的缓存。

Evo-Lite 的回答是：

```text
不要指望 AI 记得治理。
把治理嵌入项目结构、命令协议和 Git 提交链路。
```

---

## Architecture Overview / 架构总览

```text
                 Human / AI / Subagent
                         │
                         ▼
             .agents/workflows/  语义工作流
             .agents/rules/      治理规则
                         │
                         ▼
                 .evo-lite/cli/   本地治理 CLI
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
 active_context      planning IR     architecture IR
 focus/backlog       spec/plan/task   modules/files
 trajectory          evidence         provider scan
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 drift-report.json
                         │
                         ▼
                 dashboard-data.json
                         ▲
                         │
          Git post-commit governance hook
```

### 关键目录

```text
Project/
├── AGENTS.md                         # Codex 宿主入口摘要
├── CLAUDE.md                         # Claude Code 宿主入口摘要
├── .agents/
│   ├── rules/                        # canonical 治理规则
│   └── workflows/                    # /evo /commit /mem /wash 语义工作流
├── .claude/commands/                 # Claude Code 薄包装命令
├── .codex/hooks.json                 # Codex hook 配置
├── .github/hooks/                    # GitHub/Copilot/host hook scaffold
├── .evo-lite/
│   ├── active_context.md             # 当前状态机
│   ├── cli/                          # 项目本地运行时 CLI
│   ├── raw_memory/                   # durable archive 主链
│   ├── index_memory/                 # archive index marker
│   ├── memory.db                     # SQLite FTS/BM25 检索层
│   ├── generated/                    # IR / dashboard / drift / governance report
│   ├── mem                           # Unix / Bash wrapper
│   └── mem.cmd                       # Windows wrapper
├── docs/
│   ├── specs/                        # formal specs
│   ├── plans/                        # formal plans
│   ├── superpowers/specs/            # Superpowers-style specs
│   ├── superpowers/plans/            # Superpowers-style plans
│   ├── contracts/                    # IR schema / provider contracts
│   └── architecture/                 # module boundary docs
└── templates/                        # create-evo-lite 自身开发时的 canonical templates
```

---

## Mental Model / 心智模型

### 1. `active_context` 是驾驶舱

`.evo-lite/active_context.md` 只保存当前接管需要的信息：

- `FOCUS`：当前最重要的工作焦点
- `BACKLOG`：未完成任务
- `TRAJECTORY`：最近操作轨迹
- `META`：运行态元数据

不要把长篇复盘长期堆在 `active_context.md` 里。

### 2. `archive` 是黑匣子

完成一次实现、修复或架构决策后，通过 `context track` / `archive` 写入 `.evo-lite/raw_memory/`。这是 durable 主链，后续可以重建 index，也可以被 task evidence backfill 引用。

### 3. `remember` 是轻量检索缓存

`remember` 适合记录短经验、坑点、查询线索。它不是闭环主链，不替代 archive。

### 4. `plan-ir.json` 是治理中间层

Spec、Plan、Task、linkedFiles、evidence 会被扫描进：

```text
.evo-lite/generated/planning/plan-ir.json
```

Dashboard、drift rules、MCP 工具都基于它工作。

### 5. Git hook 是治理运行时入口

post-commit hook 会根据本次 commit 的文件类别自动跑 scan/progress/gaps/dashboard，避免 AI/subagent 忘记治理。

---

## Quick Start / 极速上手

### 1. 初始化

```bash
npx create-evo-lite ./MyAwesomeProject
cd MyAwesomeProject
```

开发本仓库时也可以：

```bash
npm link
create-evo-lite ./MyAwesomeProject
cd MyAwesomeProject
```

### 2. 首次自检

```bash
node .evo-lite/cli/memory.js verify
```

Bash / Git Bash：

```bash
./.evo-lite/mem verify
```

Windows PowerShell / CMD：

```powershell
.\.evo-lite\mem.cmd verify
```

> 所有 `mem` / `memory.js` / Git 相关命令，都应该在目标项目根目录执行。不要从别的仓库用绝对路径调用目标项目的 `.evo-lite/cli/memory.js`，否则 Git provenance 可能绑定到错误目录。

### 3. 检查 hook

```bash
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
```

如果 hook 没安装或漂移：

```bash
./.evo-lite/mem hook install --explain
```

### 4. 开始第一轮任务

建议直接告诉 AI：

```text
执行 Evo-Lite 的 /evo 工作流，读取 active_context、verify，并基于 recall-first takeover 给我下一步建议。
```

如果当前已有改动但还没有 plan：

```bash
./.evo-lite/mem plan new my-feature --from-diff
./.evo-lite/mem plan scan
```

---

## Workflow Protocols / 工作流协议

Evo-Lite 的 `/evo`、`/commit`、`/mem`、`/wash` 是语义工作流。它们不一定会出现在 Codex 或 Claude Code 的 UI 菜单里，但 AI 应该按这些协议执行。

### `/evo`：接管

目标：让 AI 先理解项目状态，而不是直接写代码。

推荐顺序：

```text
read active_context
→ verify runtime
→ recall-first takeover
→ inspect plan/dashboard/drift if present
→ 给出当前 focus、风险、下一步
```

### `/commit`：闭环

目标：完成一次小的、可追踪的开发闭环。

语义顺序：

```text
stage / commit code
→ context track
→ raw_memory archive
→ runtime state meta commit
→ post-commit governance hook 自动刷新
```

显式快路：

```bash
./.evo-lite/mem commit "完成本次治理闭环" \
  --code-message="feat(runtime): add governance loop" \
  --mechanism="GovernanceLoop" \
  --resolve="a1b2"
```

默认只提交已经 staged 的代码快照。需要把当前全部非 `.evo-lite` 代码改动纳入时，显式使用：

```bash
./.evo-lite/mem commit "..." --code-message="..." --mechanism="..." --stage=all
```

### `/mem`：低频交接

用于 session 结束、版本小跃迁、发布前后，不替代日常 `/commit`。

### `/wash`：清洗 / 重建

用于 archive / index / memory runtime 异常时的恢复和重建。

---

## Governance Runtime / 治理运行时

### Post-commit 分类

Hook 会读取本次 commit 的 changed files，并分类：

| 类别 | 触发路径 | 自动动作 |
|---|---|---|
| `plan` | `docs/specs/`, `docs/plans/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` | `plan scan`, `plan progress`, `plan gaps`, `dashboard build` |
| `architecture` | `templates/cli/`, `templates/.github/`, `templates/.codex/`, `.agents/`, `index.js`, `bin/`, `package.json`, `docs/contracts/`, `docs/architecture/` | `architecture scan`, `architecture diff`, `plan progress`, `plan gaps`, `dashboard build` |
| `evidence` | `.evo-lite/raw_memory/*.md` | `plan archive-evidence --backfill`, `plan scan`, `plan progress`, `plan gaps`, `dashboard build` |
| `code` | 其他项目文件 | `plan progress`, `plan gaps --last-commit --changed-files-from-env`, `dashboard build` |

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

当前核心 rules：

| Rule | 含义 |
|---|---|
| R001 | 缺少 `.agents/rules/architecture.md` |
| R002 | 架构规则仍含 placeholder |
| R003 | 缺少 spec |
| R004 | 缺少 plan |
| R005 | task 没有 linkedFiles |
| R006 | changed file 没有链接到任何 task |
| R007 | 缺少正式模块边界文档 |
| R008 | implemented / verified task 没有 archive evidence |
| R009 | IR stale |
| R011 | task 完成状态与 plan/spec 状态未对齐 |

---

## Planning System / 规划系统

### 创建 spec + plan

```bash
./.evo-lite/mem plan new my-feature
```

从当前 diff 自动填充 linked files：

```bash
./.evo-lite/mem plan new my-feature --from-diff
```

生成 plan 的 frontmatter：

```yaml
---
id: plan:my-feature
linkedSpec: spec:my-feature
format: superpowers
status: draft
---
```

### 扫描与检查

```bash
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem plan trace
./.evo-lite/mem plan lint
```

### Archive evidence backfill

`raw_memory` 里的 archive 可以通过 `task:<id>` 或 frontmatter `linkedTask` 自动回填到 task evidence：

```bash
./.evo-lite/mem plan archive-evidence --backfill
./.evo-lite/mem plan scan
```

通常不需要手动跑；post-commit hook 会在 evidence commit 后自动执行。

---

## Architecture System / 架构系统

刷新 architecture IR：

```bash
./.evo-lite/mem architecture scan
./.evo-lite/mem architecture diff
```

反查文件归属模块：

```bash
./.evo-lite/mem architecture where index.js
```

Native scanner 覆盖：

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

模块规则定义在：

```text
templates/cli/architecture/infer-modules.js
```

---

## Dashboard / Inspector

构建 Dashboard 数据：

```bash
./.evo-lite/mem dashboard build
```

输出：

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Dashboard 数据合并：

- planning IR
- progress report
- architecture IR
- drift report
- governance last-run report
- freshness / staleness 信息

启动本地 inspector：

```bash
./.evo-lite/mem inspect
```

---

## Local Memory / 本地记忆

### remember / recall

```bash
./.evo-lite/mem remember "某个以后可能要 recall 的坑点"
./.evo-lite/mem recall "关键词"
```

底层：

```text
SQLite FTS5 + trigram + BM25
```

### archive / context track

```bash
./.evo-lite/mem archive "这次实现的关键结论"
./.evo-lite/mem context track --mechanism="FixLoginProxy" --details="说明本次修复、原因和决策"
```

Archive 会写入 `.evo-lite/raw_memory/`，是 durable 主链。

### sync / rebuild

```bash
./.evo-lite/mem sync
./.evo-lite/mem rebuild
```

`raw_memory/` 是重建依据，`memory.db` 是可重建的本地检索层。

---

## Runtime Mirror / 模板同步

在 create-evo-lite 自身 dogfood 开发时：

```text
templates/cli/      canonical source
.evo-lite/cli/      dogfood runtime mirror
```

原则：**修改 `templates/cli/`，不要直接修改 `.evo-lite/cli/`。**

同步：

```bash
./.evo-lite/mem sync-runtime
```

检查：

```bash
./.evo-lite/mem sync-runtime --check
```

`sync-runtime --check` 在 no-lock 或 drift 时会返回非零 exit code，适合 CI 或 agent checkpoint。

---

## MCP Server

启动 MCP server：

```bash
./.evo-lite/mem mcp
```

当前工具：

- `evo_recall`
- `evo_verify`
- `evo_plan_status`
- `evo_architecture_status`
- `evo_drift_status`
- `evo_active_context`

MCP server 是长驻进程，内部使用 fresh module loading，避免 scanner 更新后仍读旧 require cache。

---

## Provider Extension

Evo-Lite 支持 provider contract，用于接入外部架构扫描或计划增强来源，例如：

- GitNexus
- GitHub Issues
- 其他自定义扫描器

参考：

```text
docs/contracts/providers-config-sample.json
templates/cli/architecture/provider-contract.js
templates/cli/architecture/providers/
```

---

## Host Adapter Strategy / 宿主适配策略

Evo-Lite 使用“canonical 语义层 + 宿主适配层”：

```text
canonical: .agents/ + .evo-lite/
host adapters: AGENTS.md / CLAUDE.md / .claude/commands / .codex/hooks.json / .github/hooks/
```

- Codex 通常读取 `AGENTS.md` 和 `.agents/workflows/`。
- Claude Code 可读取 `CLAUDE.md` 与 `.claude/commands/`。
- Copilot / GitHub hook scaffold 位于 `.github/hooks/`。
- 真正的长期规则真源仍是 `.agents/` 与 `.evo-lite/`。

---

## Subagent Protocol

Subagent 完成实现时，不能只提交代码。至少要满足：

```text
1. 修改代码
2. 更新对应 plan checkbox / task status
3. 确认 linkedFiles 覆盖本次修改文件
4. 写入 archive evidence 或可回填的 raw_memory
5. commit 后让 post-commit governance hook 刷新 IR / Dashboard
```

相关规则：

```text
.agents/rules/subagent-checkpoint.md
templates/.agents/rules/subagent-checkpoint.md
```

---

## Safety / 安全边界

Evo-Lite 有基础 secret scanner，会阻断常见 token / key 写入 memory 或 archive。warn 级 PII 会被 redaction 后持久化。

原则：

- 不要把真实密钥写入 `remember` / `archive` / `active_context`
- 不要把 `.evo-lite/memory.db` 当安全存储
- 发布前确认 `.gitignore`、raw archive、generated report 是否符合你的仓库策略

---

## Testing / 测试

```bash
npm test
npm run test:governance
```

`test:governance` 覆盖：

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

## Upgrade / 升级旧项目

在已安装 Evo-Lite 的项目根目录：

```bash
npx create-evo-lite@latest ./ --yes
```

升级后建议：

```bash
node .evo-lite/cli/memory.js verify
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
./.evo-lite/mem sync-runtime --check
./.evo-lite/mem dashboard build
```

如果 runtime mirror drift：

```bash
./.evo-lite/mem sync-runtime
```

如果 planning IR / dashboard stale：

```bash
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem dashboard build
```

---

## Command Reference / 命令速查

```bash
# health / takeover
./.evo-lite/mem verify
./.evo-lite/mem bootstrap

# memory
./.evo-lite/mem remember "..."
./.evo-lite/mem recall "..."
./.evo-lite/mem archive "..."
./.evo-lite/mem sync
./.evo-lite/mem rebuild

# context
./.evo-lite/mem context summary
./.evo-lite/mem context validate
./.evo-lite/mem context add "..."
./.evo-lite/mem context focus "..."
./.evo-lite/mem context track --mechanism="..." --details="..."
./.evo-lite/mem context auto-refresh

# commit fast path
./.evo-lite/mem commit "..." --code-message="..." --mechanism="..."

# planning
./.evo-lite/mem plan new my-feature --from-diff
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem plan trace
./.evo-lite/mem plan lint
./.evo-lite/mem plan archive-evidence --backfill

# architecture
./.evo-lite/mem architecture scan
./.evo-lite/mem architecture diff
./.evo-lite/mem architecture where index.js

# dashboard / inspector
./.evo-lite/mem dashboard build
./.evo-lite/mem inspect

# hooks
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
./.evo-lite/mem hook last
./.evo-lite/mem hook install --explain

# runtime mirror
./.evo-lite/mem sync-runtime
./.evo-lite/mem sync-runtime --check

# MCP
./.evo-lite/mem mcp
```

---

## Roadmap Ideas

- README_EN 同步到 2.x 语义
- 更强的 Dashboard UI
- 更严格的 NUL-delimited hook changed-file handling
- 更完整的 provider examples
- subagent task completion 自动诊断
- CI-friendly governance check 命令

---

## License

MIT
