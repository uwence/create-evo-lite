<div align="center">

# 🧠 create-evo-lite

**A Project Scaffold for AI Vibecoding**  
*"You do not need to be a professional software engineer to keep AI work durable, traceable, and handoff-friendly."*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) • [Remember Boundary](./docs/REMEMBER_BOUNDARY_DECISION.md) • [Usage Guide](#🚀-quick-start) • [中文介绍](./README.md)

---
</div>

> **A daemonless, project-local scaffold for AI vibecoding.**

`Evo-Lite` is a project-local scaffold for Agentic Workflows, especially useful for people who come from **automation, controls, hardware, testing, ops, or other non-pure-software backgrounds** but still want to build real projects with AI. Instead of asking you to run an external RAG stack, it keeps **rules, explicit context, implicit memory, and CLI tooling** inside the repo, so an AI agent inherits not only code, but also discipline.

> [!IMPORTANT]
> **Current structure**: Evo-Lite uses a two-layer model.
> - **Workflow protocols** such as `/commit`, `/mem`, and `/wash` live in `.agents/workflows/`.
> - **Executable behavior** lives in `.evo-lite/cli/` via `memory.js` / `mem.cmd`.
> After upgrading an existing project, run `node .evo-lite/cli/memory.js verify` before continuing work.

---

## 🌟 Why do you need Evo-Lite?

If you are not a full-time software engineer and rely on AI to turn ideas, domain knowledge, and field problems into small tools or products quickly, the hardest part is usually not shipping version one. It is making sure the AI can still continue the project tomorrow without losing the thread.

As AI coding assistants become increasingly powerful, we often encounter these **engineering-level pain points**:

1. **Long-Tail Memory Loss**: AI loses context during long conversations, forgetting critical bug fixes from yesterday.
2. **People-Pleasing Personality**: AI lack professional opinion—adding 5 random npm dependencies just because you asked for a simple feature, or mixing CommonJS and ESModules randomly.
3. **Heavy Management Costs**: Most RAG solutions for memory require running Docker or microservices. We need it simple!
4. **Host Pollution**: No one wants to pollute a clean Java or Rust project root directory just for an AI script.

**Evo-Lite is not trying to turn you into a full software team. It is trying to give you a project skeleton that AI can keep working with over time.**

## 🔥 Core Features (Evo-Lite Architecture)

* **🏗️ Governance via Rules (`.agents/rules`)**
  Protocols are no longer just suggestions in a chat. They live as project assets, can be versioned, reviewed, and upgraded, and serve as durable constraints for the next agent taking over.
* **🌐 In-Tree RAG (Pure Local Vector Engine)**
  Built on `sqlite-vec`, with the whole runtime living under `.evo-lite/`. No daemon, no separate memory service, no extra deployment tier.
* **🧠 Dual-Stage Retrieval**
  - **Embedding** for coarse candidate retrieval
  - **Reranker** for better semantic ordering
  Both are designed around local ONNX inference with downgrade paths when the environment is constrained.
* **🛡️ Explicit + Implicit Memory**
  - **Explicit state machine (`active_context.md`)** for focus, backlog, and trajectory handover
  - **Implicit memory store (`memory.db`, `raw_memory`, `vect_memory`)** for long-term searchable recall and rebuildable archives
* **🛠️ Rebuildable Archive Pipeline**
  `archive`, `sync`, and `rebuild` make memory maintainable over time, instead of turning it into a one-shot write-only cache.
* **⚓ Space-Time Traceability (Git Anchoring)**
  `remember` writes are stamped with `[Time]` and Git `[Commit Hash]`, while `archive` / `track` artifacts keep their traceability in frontmatter plus structured Markdown sections. The goal is durable provenance, without pretending every memory path uses the exact same envelope.
* **🔄 Upgradeable Runtime**
  Existing projects can be re-initialized and verified without treating the first scaffold as the only valid moment of setup.
* **⚡ Workflow Protocols + CLI Commands**
  - Workflow layer: `/evo`, `/commit`, `/mem`, `/wash`
  - Execution layer: `remember`, `recall`, `export`, `import`, `archive`, `sync`, `rebuild`, `context`

## 🧭 Dual-Lane Memory Model

Evo-Lite currently uses an explicit **dual-lane memory model**:

- **`active_context.md`**: the live state panel, only for `META`, `FOCUS`, `BACKLOG`, `TRAJECTORY`, and other “what is happening right now” signals.
- **`archive` / `track`**: long-lived structured assets for closed-loop bug reviews, implementation conclusions, architecture decisions, and reusable project knowledge.
- **`remember`**: a lightweight implicit recall cache for quick searchable hints, but **not the primary rebuild-guaranteed closure path**.

The intended mental model is:

- `active_context`: cockpit
- `archive`: black box
- `context track`: the only compliant transition bridge

### Flow Rule

- Work in progress lives in `active_context.md`
- Closed-loop progress is persisted through `.\.evo-lite\mem.cmd context track ...`
- Long-term experience belongs in structured archives under `raw_memory/`
- Lightweight searchable hints may use `remember`

The default main lane is:

```text
active_context -> context track -> archive
```

This means:

- do not keep large retrospectives inside `active_context.md`
- do not manually duplicate records from `active_context.md` into archive
- if `track` did not succeed, the loop is not considered reliably closed

---

## 🚀 Quick Start

This is a Node.js CLI tool. You can install it in any empty directory or the same level as an existing project:

### 1. Run the Scaffolding Wizard
Choose between a one-time execution or global installation.

**Option A: Temporary Run (Ideal for sharing)**
```bash
npx create-evo-lite ./MyAwesomeProject
```

**Option B: Global Installation (Recommended for daily use)**
```bash
# 1. Clone the source and link it globally
cd create-evo-lite
npm link

# 2. Use it as a native command anywhere!
create-evo-lite ./MyAwesomeProject
```

During setup, Evo-Lite initializes a local ONNX-based runtime and keeps the memory stack inside `.evo-lite/`. No separate service tier is required.

> [!TIP]
> **Built-in Dual-Core Engines**:
> - Embedding: `Xenova/bge-small-zh-v1.5` (Millisecond inference even on pure CPU)
> - Reranker: `Xenova/bge-reranker-base` (Quantized for minimal memory footprint)

After setup, the first thing to run is:
```bash
node .evo-lite/cli/memory.js verify
```
This checks the memory runtime, model availability, context freshness, offline-memory residue, and whether the current workspace is still safe to hand over.

### 3. High-Frequency Tracking & Closure (/commit)
When a small feature or bug fix is complete, enter the command:
```text
/commit
```
`/commit` is a workflow contract, not magic by itself. In practice it should drive the agent to:
- complete the real `git commit`
- run `.\.evo-lite\mem.cmd context track --mechanism="..." --details="..." [--resolve="xxxx"]`
- convert the code action into trajectory, archive, and backlog updates

### 4. Low-Frequency Release & Handover (/mem)
When the iteration is complete, and you need to end the session:
```text
/mem
```
`/mem` is the low-frequency handover protocol for version bumps, release tagging, and explicit session suspension.


### 5. Direct Interaction with the Brain

Whenever you need, you or your AI agent can query the memory directly:

```bash
# Recall historical struggle
./.evo-lite/mem recall "Why did the login API integration fail last time?"

# Imprint a new memory
./.evo-lite/mem remember "The user verification relies on XYZ header, do not use ABC cookie anymore, and this only broke in CI after the proxy layer was introduced."

# Create a structured archive stub
./.evo-lite/mem archive "Core conclusions from the login pipeline refactor"

# Add a new backlog item into active_context.md
./.evo-lite/mem context add "Tighten the upgrade notes in README"

# Run a self-check to see if the model is actually loaded
./.evo-lite/mem verify

# Rebuild the structured archive path when raw_memory needs to be re-indexed
# Note: this does not guarantee preservation of remember-only cache entries stored only in memory.db
node .evo-lite/cli/memory.js rebuild
```


### 6. Seamless Upgrade
When Evo-Lite releases a new version (e.g., introducing new `memory.js` skills), simply run the following in your existing project's root directory:
```bash
npx create-evo-lite@latest ./ --yes
```
The upgrade flow will:
- preserve the existing `active_context.md`
- refresh `.agents/` and `.evo-lite/cli/` templates
- attempt migration / washing paths when an older memory store is detected

After upgrading, run:
```bash
node .evo-lite/cli/memory.js verify
```

## 📂 Directory Structure at a Glance

```text
MyAwesomeProject/                 <-- (Your Project)
├── .agents/                      <-- (Agent Governance Area)
│   ├── rules/                    <-- Hard Constraints (Core Rules)
│   │   ├── evo-lite.md           - Boot Sequence Interceptor
│   │   ├── project-archive.md    - Archiving Protocol
│   │   └── memory-distillation.md - Quality Gatekeeper
│   └── workflows/                <-- Slash Commands
│       ├── evo.md                - /evo Script
│       ├── commit.md             - /commit Script
│       ├── mem.md                - /mem Script
│       └── wash.md               - /wash Script
│
└── .evo-lite/                    <-- (Memory & Dependency Sandbox)
    ├── cli/                      - Vector DB CLI scripts
    ├── mem.cmd                   - CLI Entry (Win)
    ├── mem                       - CLI Entry (Unix)
    ├── active_context.md         - Explicit Progress Sheet
    ├── memory.db                 - Implicit Vector Database
    ├── raw_memory/               - Structured source archives
    ├── vect_memory/              - Vectorized archive markers
    └── .cache/                   - Local model cache
```

---

## 🏛️ The Aesthetics of Restriction

Why keep this as project-local infrastructure instead of turning it into another heavyweight external system?

In the age of AI, **context is expensive, and mental clarity is fragile**. Traditional RAG solutions tend to be "heavy," requiring Docker, microservices, and complex sync logic. This not only clutters your project but also adds a significant maintenance burden.

The core philosophy of Evo-Lite is **"Use project-local order to resist AI context drift."**:
1. **Zero-Intrusion is True Respect**: A good tool should be like a ghost—existing only when summoned. That's why we insist on a `Daemonless` architecture.
2. **Sandboxing as the Last Line of Defense**: We'd rather increase the scaffolding size slightly (with offline fallbacks) than let a developer's memory fail just because they lack a C++ compiler.
3. **Memory must be rebuildable, not merely writable**: durable AI memory is not about recording one event once; it is about being able to migrate, re-vectorize, verify, and keep using it later.

> *"Humans hold reverence for business and code assets; Evo-Lite is the golden thread that places the necessary constraints on AI."*

---
