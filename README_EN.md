<div align="center">

# 🧠 create-evo-lite

**Project-local AI Development Governance Runtime**  
*Make AI / subagents do more than write code: they must take over, plan, implement, leave evidence, refresh state, and hand off inside the project.*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![Runtime](https://img.shields.io/badge/Runtime-Project_Local-007acc.svg)](#)
[![Governance](https://img.shields.io/badge/Governance-Post_Commit_Hook-84cc16.svg)](#)
[![Memory](https://img.shields.io/badge/Memory-SQLite_FTS5-ff6600.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[中文 README](./README.md) · [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) · [Contracts](./docs/contracts/) · [Quick Start](#-quick-start) · [Command Reference](#-command-reference)

---
</div>

## TL;DR

`create-evo-lite` is an AI development governance scaffold installed directly into your project tree. It is not merely a memory plugin, and it is not an external daemon. It connects **rules, state, plans, architecture, evidence, archives, dashboard data, and Git hooks** into one local runtime.

It targets the real failure mode of large AI-assisted projects:

```text
AI writes code
but does not update the plan
leaves no evidence
does not refresh the dashboard
does not explain how the next session should continue
subagents complete implementation but bypass governance
```

Evo-Lite 2.x turns those failures into a detectable, refreshable, and increasingly automatic governance loop.

---

## Current Position: Evo-Lite 2.x Governance Runtime

Evo-Lite has evolved from an in-project memory helper into:

```text
project state machine
+ local archive / recall
+ Spec / Plan / Task IR
+ Architecture IR
+ Drift rules
+ Post-commit governance hook
+ Dashboard data
+ MCP server
+ Runtime mirror lock
```

The current repository is in a **production dogfood RC** shape:

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

This means Evo-Lite is no longer only a takeover-and-archive helper. It participates continuously during AI implementation.

---

## Who is it for?

Evo-Lite is especially useful for:

- people who use AI to maintain projects but do not want to become a full software engineering organization first;
- controls, automation, equipment software, testing, operations, hardware integration, and other cross-domain engineering projects;
- projects that started as small tools but have grown large enough to need continuity;
- workflows involving Codex, Claude Code, Agent Mode, subagents, MCP, or other agentic tooling;
- teams that want code, plans, architecture, evidence, and handoff state to live in Git.

If your project is a tiny script, Evo-Lite may feel heavy. If your project has multi-session AI handoff, task decomposition, subagent work, stale docs, or code/plan drift, it becomes valuable.

---

## Core Problem: AI can write code, but it does not reliably govern the work

Vibecoding is easy in small projects. Give the AI a short context and it can ship quickly. As the project grows, the problem changes:

1. **Context breaks**: the next AI session does not know why previous changes were made.
2. **Plan drift**: code changed, but the plan is still old.
3. **Missing evidence**: a task says done, but no archive/evidence exists.
4. **Architecture fog**: modules grow until neither humans nor AI understand the whole system.
5. **Subagent bypass**: subagents finish implementation without updating the governance chain.
6. **Stale dashboard**: the dashboard looks current but actually reflects an older scan.

Evo-Lite's answer:

```text
Do not rely on AI remembering governance.
Embed governance into project structure, workflow protocols, and Git commits.
```

---

## Architecture Overview

```text
                 Human / AI / Subagent
                         │
                         ▼
             .agents/workflows/  semantic workflows
             .agents/rules/      governance rules
                         │
                         ▼
                 .evo-lite/cli/   local governance CLI
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

### Key directories

```text
Project/
├── AGENTS.md                         # Codex host adapter summary
├── CLAUDE.md                         # Claude Code host adapter summary
├── .agents/
│   ├── rules/                        # canonical governance rules
│   └── workflows/                    # /evo /commit /mem /wash semantic workflows
├── .claude/commands/                 # Claude Code thin command wrappers
├── .codex/hooks.json                 # Codex hook config
├── .github/hooks/                    # GitHub/Copilot/host hook scaffold
├── .evo-lite/
│   ├── active_context.md             # current project state machine
│   ├── cli/                          # project-local runtime CLI
│   ├── raw_memory/                   # durable archive chain
│   ├── index_memory/                 # archive index marker files
│   ├── memory.db                     # SQLite FTS/BM25 retrieval layer
│   ├── generated/                    # IR / dashboard / drift / governance reports
│   ├── mem                           # Unix / Bash wrapper
│   └── mem.cmd                       # Windows wrapper
├── docs/
│   ├── specs/                        # formal specs
│   ├── plans/                        # formal plans
│   ├── superpowers/specs/            # Superpowers-style specs
│   ├── superpowers/plans/            # Superpowers-style plans
│   ├── contracts/                    # IR schema / provider contracts
│   └── architecture/                 # module boundary docs
└── templates/                        # canonical templates when developing create-evo-lite itself
```

---

## Mental Model

### 1. `active_context` is the cockpit

`.evo-lite/active_context.md` keeps only the state needed for takeover:

- `FOCUS`: the most important current focus;
- `BACKLOG`: unfinished work;
- `TRAJECTORY`: recent operation history;
- `META`: runtime metadata.

Do not accumulate long retrospectives in `active_context.md`.

### 2. `archive` is the black box

After an implementation, bug fix, or architecture decision, use `context track` / `archive` to write into `.evo-lite/raw_memory/`. This is the durable chain. It can be re-indexed and can be backfilled into task evidence.

### 3. `remember` is a lightweight retrieval cache

`remember` is for short lessons, pitfalls, and recall hints. It is not the closure chain and does not replace archive.

### 4. `plan-ir.json` is the governance intermediate layer

Specs, plans, tasks, linked files, and evidence are scanned into:

```text
.evo-lite/generated/planning/plan-ir.json
```

Dashboard data, drift rules, and MCP tools consume this IR.

### 5. Git hook is the runtime governance entrypoint

The post-commit hook classifies changed files and automatically runs scan/progress/gaps/dashboard steps so AI/subagents cannot silently skip governance.

---

## Quick Start

### 1. Initialize

```bash
npx create-evo-lite ./MyAwesomeProject
cd MyAwesomeProject
```

When developing this repository locally:

```bash
npm link
create-evo-lite ./MyAwesomeProject
cd MyAwesomeProject
```

### 2. First health check

```bash
node .evo-lite/cli/memory.js verify
```

Bash / Git Bash:

```bash
./.evo-lite/mem verify
```

Windows PowerShell / CMD:

```powershell
.\.evo-lite\mem.cmd verify
```

> Run all `mem` / `memory.js` / Git-related commands from the target project root. Do not call a project's `.evo-lite/cli/memory.js` from another repository via an absolute path, or Git provenance may bind to the wrong working directory.

### 3. Check the hook

```bash
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
```

If the hook is missing or drifted:

```bash
./.evo-lite/mem hook install --explain
```

### 4. Start the first task

Tell the AI:

```text
Run Evo-Lite's /evo workflow: read active_context, verify, perform recall-first takeover, and give me the next recommended action.
```

If there are already uncommitted changes but no plan:

```bash
./.evo-lite/mem plan new my-feature --from-diff
./.evo-lite/mem plan scan
```

---

## Workflow Protocols

Evo-Lite's `/evo`, `/commit`, `/mem`, and `/wash` are semantic workflows. They may not appear as native UI commands in Codex or Claude Code, but AI agents should follow their protocol.

### `/evo`: takeover

Goal: understand project state before writing code.

Recommended sequence:

```text
read active_context
→ verify runtime
→ recall-first takeover
→ inspect plan/dashboard/drift if present
→ report current focus, risks, and next step
```

Note: takeover defaults to a recall-first takeover — a bounded recall injects existing context first; when no usable prior context exists, it continues as a fresh takeover without blocking the handoff.

### `/commit`: closure

Goal: complete a small, traceable development loop.

Semantic sequence:

```text
stage / commit code
→ context track
→ raw_memory archive
→ runtime state meta commit
→ post-commit governance hook refreshes generated state
```

Explicit fast path:

```bash
./.evo-lite/mem commit "close this governance loop" \
  --code-message="feat(runtime): add governance loop" \
  --mechanism="GovernanceLoop" \
  --resolve="a1b2"
```

By default, only staged code changes are accepted. To include all current non-`.evo-lite` code changes, explicitly use:

```bash
./.evo-lite/mem commit "..." --code-message="..." --mechanism="..." --stage=all
```

### `/mem`: low-frequency handoff

Use this at the end of a session, before/after release points, or when handing off context. It does not replace daily `/commit` closure.

### `/wash`: cleanup / rebuild

Use this when archive, index, or memory runtime state needs recovery or rebuilding.

---

## Governance Runtime

### Post-commit classification

The hook reads changed files in the latest commit and classifies them:

| Category | Trigger paths | Automatic actions |
|---|---|---|
| `plan` | `docs/specs/`, `docs/plans/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` | `plan scan`, `plan progress`, `plan gaps`, `dashboard build` |
| `architecture` | `templates/cli/`, `templates/.github/`, `templates/.codex/`, `.agents/`, `index.js`, `bin/`, `package.json`, `docs/contracts/`, `docs/architecture/` | `architecture scan`, `architecture diff`, `plan progress`, `plan gaps`, `dashboard build` |
| `evidence` | `.evo-lite/raw_memory/*.md` | `plan archive-evidence --backfill`, `plan scan`, `plan progress`, `plan gaps`, `dashboard build` |
| `code` | other project files | `plan progress`, `plan gaps --last-commit --changed-files-from-env`, `dashboard build` |

The hook writes:

```text
.evo-lite/generated/governance/post-commit-last-run.json
```

Useful commands:

```bash
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
./.evo-lite/mem hook last
./.evo-lite/mem hook install --explain
```

### Drift rules

Current core rules:

| Rule | Meaning |
|---|---|
| R001 | Missing `.agents/rules/architecture.md` |
| R002 | Architecture rule still contains placeholder text |
| R003 | No spec found |
| R004 | No plan found |
| R005 | Task has no linkedFiles |
| R006 | Changed file is not linked to any task |
| R007 | Missing formal module-boundary document |
| R008 | Implemented / verified task has no archive evidence |
| R009 | IR is stale |
| R011 | Task completion status is not aligned with plan/spec status |

---

## Planning System

### Create a spec + plan

```bash
./.evo-lite/mem plan new my-feature
```

Prefill linked files from the current diff:

```bash
./.evo-lite/mem plan new my-feature --from-diff
```

Generated plan frontmatter:

```yaml
---
id: plan:my-feature
linkedSpec: spec:my-feature
format: superpowers
status: draft
---
```

### Scan and check

```bash
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem plan trace
./.evo-lite/mem plan lint
```

### Archive evidence backfill

Archives in `raw_memory` can be backfilled into task evidence using `task:<id>` in the body or `linkedTask` frontmatter:

```bash
./.evo-lite/mem plan archive-evidence --backfill
./.evo-lite/mem plan scan
```

You usually do not need to run this manually. The post-commit hook runs it automatically after evidence commits.

---

## Architecture System

Refresh Architecture IR:

```bash
./.evo-lite/mem architecture scan
./.evo-lite/mem architecture diff
```

Reverse-lookup file ownership:

```bash
./.evo-lite/mem architecture where index.js
```

Native scanner coverage:

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

Module rules live in:

```text
templates/cli/architecture/infer-modules.js
```

---

## Dashboard / Inspector

Build dashboard data:

```bash
./.evo-lite/mem dashboard build
```

Output:

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Dashboard data merges:

- Planning IR
- Progress report
- Architecture IR
- Drift report
- Governance last-run report
- Freshness / staleness metadata

Start the local inspector:

```bash
./.evo-lite/mem inspect
```

---

## Local Memory

### remember / recall

```bash
./.evo-lite/mem remember "a pitfall I may need to recall later"
./.evo-lite/mem recall "keyword"
```

Underlying retrieval:

```text
SQLite FTS5 + trigram + BM25
```

### archive / context track

```bash
./.evo-lite/mem archive "key conclusion from this implementation"
./.evo-lite/mem context track --mechanism="FixLoginProxy" --details="explain the fix, cause, and decision"
```

Archives are written into `.evo-lite/raw_memory/`, which is the durable chain.

### sync / rebuild

```bash
./.evo-lite/mem sync
./.evo-lite/mem rebuild
```

`raw_memory/` is the rebuild source. `memory.db` is a rebuildable retrieval layer.

---

## Runtime Mirror

When dogfooding create-evo-lite itself:

```text
templates/cli/      canonical source
.evo-lite/cli/      dogfood runtime mirror
```

Rule: **edit `templates/cli/`, not `.evo-lite/cli/` directly.**

Sync:

```bash
./.evo-lite/mem sync-runtime
```

Check:

```bash
./.evo-lite/mem sync-runtime --check
```

`sync-runtime --check` returns a non-zero exit code on no-lock or drift, making it suitable for CI or agent checkpoints.

---

## MCP Server

Start MCP server:

```bash
./.evo-lite/mem mcp
```

Current tools:

- `evo_recall`
- `evo_verify`
- `evo_plan_status`
- `evo_architecture_status`
- `evo_drift_status`
- `evo_active_context`

The MCP server is long-lived, so it uses fresh module loading to avoid stale scanner modules from `require.cache`.

---

## Provider Extension

Evo-Lite supports provider contracts for external architecture scanning or planning enrichment, for example:

- GitNexus
- GitHub Issues
- custom scanners

References:

```text
docs/contracts/providers-config-sample.json
templates/cli/architecture/provider-contract.js
templates/cli/architecture/providers/
```

---

## Host Adapter Strategy

Evo-Lite uses a canonical semantics layer plus host adapters:

```text
canonical: .agents/ + .evo-lite/
host adapters: AGENTS.md / CLAUDE.md / .claude/commands / .codex/hooks.json / .github/hooks/
```

- Codex usually consumes `AGENTS.md` and `.agents/workflows/`.
- Claude Code can also consume `CLAUDE.md` and `.claude/commands/`.
- Copilot / GitHub hook scaffold lives in `.github/hooks/`.
- The long-term source of truth remains `.agents/` and `.evo-lite/`.

---

## Subagent Protocol

When a subagent finishes implementation, code changes alone are not enough. It should satisfy at least:

```text
1. modify code
2. update the relevant plan checkbox / task status
3. ensure linkedFiles covers changed files
4. write archive evidence or raw_memory that can be backfilled
5. let the post-commit governance hook refresh IR / Dashboard
```

Relevant rules:

```text
.agents/rules/subagent-checkpoint.md
templates/.agents/rules/subagent-checkpoint.md
```

---

## Safety

Evo-Lite includes a basic secret scanner. It blocks common token/key patterns from being written into memory or archive. Warn-level PII is redacted before persistence.

Principles:

- do not write real secrets into `remember`, `archive`, or `active_context`;
- do not treat `.evo-lite/memory.db` as secure storage;
- before publishing, verify `.gitignore`, raw archives, and generated reports match your repository policy.

---

## Testing

```bash
npm test
npm run test:governance
```

`test:governance` covers:

- code-only commit triggering R006;
- plan commit triggering scan/progress/gaps/dashboard;
- evidence-only commit triggering archive-evidence backfill;
- root commit file detection;
- dashboard freshness;
- hook diff / hook last;
- sync-runtime lock;
- MCP freshRequire;
- architecture where;
- context auto-refresh;
- R008 archive evidence and exemption;
- plan new scaffold.

---

## Upgrade

Inside a project that already has Evo-Lite installed:

```bash
npx create-evo-lite@latest ./ --yes
```

Recommended after upgrade:

```bash
node .evo-lite/cli/memory.js verify
./.evo-lite/mem hook status
./.evo-lite/mem hook diff
./.evo-lite/mem sync-runtime --check
./.evo-lite/mem dashboard build
```

If runtime mirror drift is reported:

```bash
./.evo-lite/mem sync-runtime
```

If Planning IR or dashboard data is stale:

```bash
./.evo-lite/mem plan scan
./.evo-lite/mem plan progress
./.evo-lite/mem plan gaps
./.evo-lite/mem dashboard build
```

---

## Command Reference

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

- Stronger Dashboard UI
- NUL-delimited hook changed-file handling
- More complete provider examples
- Automated subagent completion diagnostics
- CI-friendly governance check command

---

## License

MIT
