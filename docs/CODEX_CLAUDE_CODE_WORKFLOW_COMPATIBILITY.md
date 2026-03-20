# Codex / Claude Code Workflow Compatibility Matrix

## Goal

This document defines how Evo-Lite workflows should map onto the native capabilities of Codex and Claude Code, so we stop treating every host as if it supported the same command model.

The core principle is:

- Keep Evo-Lite's semantic workflows stable: `/evo`, `/commit`, `/mem`, `/wash`
- Adapt the transport layer to the host:
  - Codex: rules, app/CLI behavior, approvals, shells, agents, worktrees
  - Claude Code: slash commands, hooks, `CLAUDE.md`, agents, shell/runtime controls

## Host Capability Matrix

| Capability | Codex | Claude Code | Evo-Lite Implication |
| --- | --- | --- | --- |
| Project rule file | `AGENTS.md` | `CLAUDE.md` | Evo-Lite rules should be host-neutral where possible, then mirrored into the host's preferred rule surface. |
| Native slash workflows | Present in some surfaces, but not the core universal transport assumption | First-class concept | `/evo`, `/commit`, `/mem`, `/wash` should be treated as semantic workflows, not assumed native commands everywhere. |
| Shell execution | Strong local shell/tool execution model, approvals and sandbox are central | Strong shell execution model, but command routing and slash command UX are more explicit | Command examples must describe host/shell-aware entrypoints rather than one canonical string. |
| Approvals / safety modes | Core primitive | Core primitive | Evo-Lite should express intent and closure semantics, not assume identical execution timing or approval UX. |
| Subagents / agents | Native agent model exists | Native agent/subagent model exists | Future workflow routing can reuse host-native delegation instead of emulating it in prompt text alone. |
| Session compaction / memory controls | Host-managed context controls exist | Explicit `/compact` and related lifecycle hooks exist | Evo-Lite should avoid fighting native compaction and instead complement it with `active_context` and archive flow. |
| Hooks / lifecycle events | Host-specific app/CLI lifecycle primitives, less hook-centric in our current integration surface | Explicit hooks such as SessionStart, SessionEnd, PreCompact, Stop | Claude Code can carry more workflow automation in native hooks; Codex may need rule-driven or command-driven equivalents. |
| Worktrees / isolated task environments | Native concept in Codex app | Different environment model; not the same default mental model | Evo-Lite should not assume the host edits the current checkout in exactly one way. |

## Semantic Mapping

### `/evo`

Intent:

- Load `active_context`
- verify runtime health
- summarize current focus, risks, and next step

Preferred host mapping:

- Codex:
  - Treat as a takeover protocol defined by rules and local CLI execution.
  - Do not assume a first-class slash command is the transport.
  - Must respect host approvals, shell execution timing, and app/CLI result boundaries.
- Claude Code:
  - Can map more naturally to a native slash command or command file.
  - Can later use SessionStart / resume-oriented hooks to preload or validate context.

Design constraint:

- `/evo` must remain semantically stable even if one host implements it as a slash command and another as a documented rule-driven ritual.

### `/commit`

Intent:

- Freeze code snapshot
- run `context track`
- report closure state

Preferred host mapping:

- Codex:
  - Keep this as a protocol that the agent executes via git + Evo-Lite CLI.
  - Do not assume host-native slash command plumbing is required.
- Claude Code:
  - Can be implemented as a slash command wrapper around the same protocol.

Design constraint:

- Closure status must come from CLI truth, not host UX assumptions.

### `/mem`

Intent:

- low-frequency handover
- focus rollover
- release/tag snapshot

Preferred host mapping:

- Codex:
  - Better as an explicit protocol sequence than as a host-magic command.
- Claude Code:
  - Can later be wrapped in a command and optionally coordinated with session-end hooks.

Design constraint:

- `/mem` should remain optional for ordinary iterations and should not be turned into a host-specific auto-behavior without user intent.

### `/wash`

Intent:

- inspect damaged archives
- rebuild vector state
- verify post-recovery health

Preferred host mapping:

- Both hosts can run the same underlying CLI flow.
- Claude Code may later automate reminders or post-checks through hooks.
- Codex compatibility mainly depends on shell-safe command guidance and truthful reporting.

## Design Rules For Compatibility

### 1. Separate semantic workflow from transport

Evo-Lite should define what `/evo` means, not assume how each host exposes it.

Bad:

- “Every host must support `/evo` as a first-class slash command.”

Good:

- “Every host must support the `/evo` semantic workflow, whether via slash command, rules, or explicit command sequence.”

### 2. Treat command examples as host-relative

Every workflow that references `mem`, git, or shell behavior should describe:

- the intent
- the Unix/Bash example
- the Windows PowerShell/CMD example when relevant

This avoids encoding one shell's syntax as if it were universal.

### 3. Keep host-native lifecycle features additive

Claude Code hooks, slash commands, and session lifecycle features are powerful, but they should enhance Evo-Lite rather than redefine its semantics.

Likewise, Codex-specific agent/app/worktree behaviors should be treated as host accelerators, not as the core definition of the workflow.

### 4. Prefer host-neutral truth sources

The canonical state of a completed workflow should continue to come from:

- `active_context.md`
- Evo-Lite CLI output
- archive artifacts in `raw_memory/` and `vect_memory/`

Host UX should not become the source of truth.

## Immediate Retrofit Targets

### Already improved

- Workflow docs no longer assume `mem.cmd` is the only valid entrypoint.
- Rules now explicitly account for host-aware shell boundaries.

### Next high-value targets

1. Replace or clarify `// turbo-all`
   - It currently reads like a host-specific execution affordance rather than a semantic hint.
   - We should either define it neutrally or remove it from user-facing workflow files.

2. Audit native command assumptions
   - Some files still talk as if slash workflows are equally native everywhere.
   - We should distinguish “semantic workflow name” from “host-native command binding”.

3. Add a host adapter layer in documentation
   - A short section that says:
     - Codex: use `AGENTS.md` + rules + shell-driven workflow execution
     - Claude Code: use `CLAUDE.md` + commands/hooks when available

4. Decide whether to generate host-specific overlays
   - Example:
     - `.agents/` remains the canonical Evo-Lite semantics
     - host adapters generate or mirror:
       - `AGENTS.md` for Codex
       - `CLAUDE.md` and/or `.claude/commands/` for Claude Code

## Recommended Implementation Strategy

Phase 1:

- Normalize docs and rules so they stop assuming one shell or one wrapper.

Phase 2:

- Introduce a host adapter design.
- Define which Evo-Lite semantics map into:
  - Codex `AGENTS.md`
  - Claude `CLAUDE.md`
  - Claude command / hook surfaces where useful

Phase 3:

- If we support automatic project generation for both hosts, emit host-specific compatibility assets from templates instead of asking one host to pretend it is the other.

## Working Decision

For now, Evo-Lite should be treated as:

- a host-neutral workflow semantics layer
- plus host-specific adapters

It should not be treated as:

- a Claude-only slash command pack
- or a Codex-only rule bundle

That distinction is what will let us support both without flattening them into the least-common-denominator UX.
