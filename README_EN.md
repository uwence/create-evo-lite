<div align="center">

# 🧠 create-evo-lite

**The Golden Thread for Agentic Memory & Context Persistence**  
*"Capturing the AI's mental snapshot with ultimate simplicity."*

[![Vibecoding](https://img.shields.io/badge/Vibecoding-AI_Assisted-8a2be2.svg)](#)
[![System](https://img.shields.io/badge/System-Daemonless_RAG-007acc.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-Antigravity-ff6600.svg)](#)
[![Agent](https://img.shields.io/badge/Agent-Evo--Lite-84cc16.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-4ade80.svg)](./LICENSE)

[English README](./README_EN.md) • [Architecture](./templates/ACTIVATE_EVO_LITE.md) • [Usage Guide](#🚀-quick-start) • [中文介绍](./README.md)

---
</div>

> **Zero-Intrusion, Decentralized, Daemonless AI Memory Plugin Scaffolding with Dual-Core RAG (Search + Rerank)**

`Evo-Lite` is a mental constraint and state protection system specifically designed for Agentic Workflows (AI-assisted coding). In just one second, it can **instantly equip any of your projects (frontend, backend, or even simple script libraries) with a persistent memory, technical aesthetic validation, and a completely sandboxed "Super Brain."**

> [!IMPORTANT]
> **Environment Disclaimer**: This project is currently deeply optimized based on the **Google Antigravity** agent development environment (utilizing its powerful Workflow / Slash Commands mechanism). It has not been fully tested in other IDE environments such as Cursor, Cline, or GitHub Copilot, and currently lacks official plugin adapters for them.

---

## 🌟 Why do you need Evo-Lite?

As AI coding assistants become increasingly powerful, we often encounter these **engineering-level pain points**:

1. **Long-Tail Memory Loss**: AI loses context during long conversations, forgetting critical bug fixes from yesterday.
2. **People-Pleasing Personality**: AI lack professional opinion—adding 5 random npm dependencies just because you asked for a simple feature, or mixing CommonJS and ESModules randomly.
3. **Heavy Management Costs**: Most RAG solutions for memory require running Docker or microservices. We need it simple!
4. **Host Pollution**: No one wants to pollute a clean Java or Rust project root directory just for an AI script.

**Evo-Lite solves all of this elegantly with less than 200 lines of code.**

## 🔥 Core Features (The Art of Evo-Lite)

* **🌐 In-Tree RAG (Pure Local Vector Engine)**
  Completely independent of background services! Uses `sqlite-vec` under the hood. Need to search historical bug records? Just run `node memory.js recall` in your native terminal to awaken forgotten details.
* **🧠 Dual-Core Reranker for Precision**
  More than just simple fuzzy search. Built-in logic for Jina Embeddings (coarse-grained) + BGE Reranker (fine-grained). It pinpoints the core semantics of your past struggles.
* **🛡️ Isolated Dual-Layer Memory (.evo-lite/)**
  - **Explicit State Machine (`active_context.md`)**: Forces the AI to update the progress after every session. The next AI wakes up with zero hallucination and clear goals.
  - **Implicit Long-Term Storage (`memory.db`)**: Silently accumulates experience that syncs with Git, keeping your memory safe across machines.
* **📦 Absolute Sandbox: Zero Dependency Leakage**
  Evo-Lite’s Node dependencies (like `sqlite`) are 100% locked inside `.evo-lite/node_modules/`. Your host project root remains pristine.
* **⚡ Magic Summoning: `/evo` Protocol (Antigravity Workflow)**
  No verbose prompts needed. Type `/evo` in the chat box to trigger an immediate AI self-check: sniffing the tech stack, verifying model fingerprints, and announcing current progress as a "Strict Pilot."
* **🛑 Mandatory Git Check-in Protocol**
  After completing major features, the AI is programmatically constrained to remind you to `git commit`, preventing tragedies where a single mistake ruins hours of work.

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

During execution, the wizard will ask a few configuration questions (ports, model names). Press **Enter** to accept the default LM Studio local deployment (jina-v2 + bge-reranker).

### 2. Activate your AI (In IDE)
Open `MyAwesomeProject` and type the following magic command in the Antigravity (or AI assistant) chat box:
```text
/evo
```
The AI will silently load core architecture rules, run `verify` for the database, review the technical dictionary, and enter the service state perfectly.

### 3. Inject Deep Memory (CLI Experience)
AI (or humans) can invoke the terminal at any time to remember experiences:
```bash
# Remember a hard-earned lesson
node .evo-lite/cli/memory.js remember "Fix for Axios 502: Due to system proxy, solved by adding proxy:false"

# Query past struggles
node .evo-lite/cli/memory.js recall "How did we fix that proxy error?"
```

## 📂 Directory Structure at a Glance

```text
MyAwesomeProject/                 <-- (Your project, untouched)
├── .agents/                      <-- (IDE Workflow Hook)
│   └── workflows/evo.md          <-- Master script for /evo summoning
│
└── .evo-lite/                    <-- (The Dark Forest: Memory & Rules)
    ├── package.json              <-- Sandbox dependency management
    ├── node_modules/             <-- EvoLite libraries reside here
    ├── ACTIVATE_EVO_LITE.md      <-- AI persona & guide
    ├── active_context.md         <-- Current progress snapshot
    ├── memory.db                 <-- (Lazy Load) Database created upon first memory
    └── cli/
        └── memory.js             <-- The AI's Command Line Wand (RAG script)
```

---

> *"Humans hold reverence for business and code assets; Evo-Lite is the golden thread that places the necessary constraints on AI."*
