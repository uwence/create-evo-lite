<div align="center">

# 🧠 create-evo-lite

**The Golden Thread for Agentic Memory & Context Persistence**  
*"Capturing the AI's mental snapshot with ultimate simplicity."*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./docs/AI_AGENT_DEFENSE_ARCHITECTURE.md) • [Usage Guide](#🚀-quick-start) • [中文介绍](./README.md)

---
</div>

> **Zero-Intrusion, Decentralized, Daemonless AI Core Governance & Memory System with Dual-Core RAG (Search + Rerank)**

`Evo-Lite` is a **highly disciplined** mental constraint and state protection system specifically designed for Agentic Workflows (AI-assisted coding). In v1.4.0+, it has evolved from a simple "memory plugin" into a **Rules-driven autonomous governance framework**. It can instantly equip any of your projects (frontend, backend, or even simple script libraries) with a persistent memory, technical aesthetic validation, and a completely sandboxed "Super Brain."

> [!IMPORTANT]
> **Environment Disclaimer**: This project is deeply optimized for the **Google Antigravity** environment. **When initializing, please run this tool using Antigravity's `Fast Mode`**. v1.4.0+ now fully supports `.agents/rules` system-level hard constraints, achieving permanent protocol residence.

---

## 🌟 Why do you need Evo-Lite?

As AI coding assistants become increasingly powerful, we often encounter these **engineering-level pain points**:

1. **Long-Tail Memory Loss**: AI loses context during long conversations, forgetting critical bug fixes from yesterday.
2. **People-Pleasing Personality**: AI lack professional opinion—adding 5 random npm dependencies just because you asked for a simple feature, or mixing CommonJS and ESModules randomly.
3. **Heavy Management Costs**: Most RAG solutions for memory require running Docker or microservices. We need it simple!
4. **Host Pollution**: No one wants to pollute a clean Java or Rust project root directory just for an AI script.

**Evo-Lite solves all of this elegantly with less than 200 lines of code.**

## 🔥 Core Features (v1.4.0 Architecture)

* **🏗️ Governance via Rules (.agents/rules)**
  **Core Upgrade:** Protocols are now enforced by system rules rather than just documentation. v1.4.0 shifts governance from "guide-based" to system-level hard constraints. The first thing an AI does upon waking is read `.agents/rules/evo-lite.md`, intercepting low-quality output at the source.
* **🌐 In-Tree RAG (Pure Local Vector Engine)**
  Uses `sqlite-vec` under the hood. No background services required. Search historical records? Just run `.\.evo-lite\mem recall` in your terminal.
* **🧠 Dual-Pass Retrieval Architecture**
  - **Coarse Retrieval (Embedding)**: Instantly pinpoints candidates using the `Jina-V2` algorithm.
  - **Fine-Grained Re-ranking (Reranker)**: Automatically invokes `BGE-Reranker` for semantic cross-validation, ensuring high-precision recall.
* **🛡️ Isolated Dual-Layer Memory**
  - **Explicit State Machine (`active_context.md`)** : Forces the AI to update progress in real-time, eliminating task hallucinations.
  - **Implicit Long-Term Storage (`memory.db`)**: Silently accumulates experience that syncs with Git permanently.
* **⚓ Space-Time Traceability (Git Anchoring)**
  Every memory is stamped with `[Time]` and Git `[Commit Hash]`. Combined with `memory-distillation.md`, it rejects low-entropy "logs" without traceability.
* **🔄 Seamless Upgrade & Fusion**
  Supports cross-generational upgrades from v1.3.x! Automatically extracts legacy API configs, protects progress documents, and guides AI through manual fusion of backups.
* **⚡ Automated Workflows & Slash Commands**
  - `/evo`: Magic summoning to trigger self-check, tech stack sniffing, and progress sync.
  - `/mem`: Archiving protocol that syncs progress, distills memory, and triggers Git Commit closure.
  - `/wash`: Data washing protocol for offline repair and restructuring of historical "dirty" data.

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

During execution, the wizard will ask a few configuration questions (ports, model names). Press **Enter** to accept the default LM Studio local deployment (jina-v2 + bge-reranker). The system will automatically initiate a real **POST health-check**, ensuring your model is truly "Loaded" and not just the server "Running".

> [!TIP]
> **Recommended Models (GGUF)**:
> - Embedding: [jina-embeddings-v2-base-zh](https://huggingface.co/gpustack/jina-embeddings-v2-base-zh-GGUF)
> - Reranker: [bge-reranker-base](https://huggingface.co/xinming0111/bge-reranker-base-Q8_0-GGUF)

The AI will silently load core architecture rules, run \`verify\` for the database, review the technical dictionary, and enter the service state perfectly.

### 3. Archiving & Handover System
When a task phase is complete, enter the command:
\`\`\`text
/mem
\`\`\`
The AI will automatically: mark completed items in \`active_context.md\`, refine key points into the vector database, and prepare for a Git Commit.


### 4. Direct Interaction with the Brain

Whenever you need, you or your AI agent can query the memory directly:

```bash
# Recall historical挣扎
./.evo-lite/mem recall "Why did the login API integration fail last time?"

# Imprint a new memory
./.evo-lite/mem remember "The user verification relies on XYZ header, do not use ABC cookie anymore."

# Run a self-check to see if the model is actually loaded
./.evo-lite/mem verify
```


### 4. Seamless Upgrade
When Evo-Lite releases a new version (e.g., introducing new `memory.js` skills), simply run the following in your existing project's root directory:
```bash
npx create-evo-lite@latest ./ --yes
```
The system will trigger the **Seamless Upgrade Protocol**:
- Automatically extracts and preserves your legacy API port and model config.
- Absolutely protects your `active_context.md` from being erased.
- Updates core templates and prompts the AI during its next wake-up (/evo) to proactively map and merge your custom settings.

## 📂 Directory Structure at a Glance

```text
MyAwesomeProject/                 <-- (Your Project)
├── .agents/                      <-- (Agent Governance Area)
│   ├── rules/                    <-- Hard Constraints (v1.4.0 Core)
│   │   ├── evo-lite.md           - Boot Sequence Interceptor
│   │   ├── project-archive.md    - Archiving Protocol
│   │   └── memory-distillation.md - Quality Gatekeeper
│   └── workflows/                <-- Slash Commands
│       ├── evo.md                - /evo Script
│       └── mem.md                - /mem Script
│
└── .evo-lite/                    <-- (Memory & Dependency Sandbox)
    ├── cli/                      - Vector DB CLI scripts
    ├── mem.cmd                   - CLI Entry (Win)
    ├── mem                       - CLI Entry (Unix)
    ├── active_context.md         - Explicit Progress Sheet
    └── memory.db                 - Implicit Vector Database
```

---

## 🏛️ The Aesthetics of Restriction

Why challenge massive RAG frameworks with less than 200 lines of code?

In the age of AI, **context is expensive, and mental clarity is fragile**. Traditional RAG solutions tend to be "heavy," requiring Docker, microservices, and complex sync logic. This not only clutters your project but also adds a significant maintenance burden.

The core philosophy of Evo-Lite is **"Order through Simplicity"**:
1. **Zero-Intrusion is True Respect**: A good tool should be like a ghost—existing only when summoned. That's why we insist on a `Daemonless` architecture.
2. **Sandboxing as the Last Line of Defense**: We'd rather increase the scaffolding size slightly (with offline fallbacks) than let a developer's memory fail just because they lack a C++ compiler.
3. **Dual-Pass Retrieval Power**: By leveraging the native speed and simplicity of `sqlite-vec`, we've implemented an industrial-grade retrieval pipeline in milliseconds, proving that high precision doesn't require a massive cluster.

> *"Humans hold reverence for business and code assets; Evo-Lite is the golden thread that places the necessary constraints on AI."*

---
