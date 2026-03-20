# Evo-Lite Adapter For Claude Code

This file is the Claude Code-facing adapter layer for Evo-Lite.

Canonical Evo-Lite semantics live in:

- `.agents/rules/`
- `.agents/workflows/`
- `.evo-lite/active_context.md`
- `.evo-lite/cli/`

This file is not the canonical rule source. It is a root-level host adapter so Claude Code can discover the project contract quickly.

## Bootstrap

When taking over this project:

1. Read `.agents/rules/` and `.agents/workflows/` as the canonical Evo-Lite semantics.
2. Read `.evo-lite/active_context.md` as the current runtime state.
3. Use the host-appropriate Evo-Lite CLI wrapper when interacting with runtime state:
   - Unix / Bash: `./.evo-lite/mem`
   - Windows PowerShell / CMD: `.\.evo-lite\mem.cmd`

## Workflow Mapping

- `/evo`
  Meaning: takeover + verify + summarize focus, risks, next step.
- `/commit`
  Meaning: code snapshot + `context track` + closure reporting.
- `/mem`
  Meaning: low-frequency handover + version/tag snapshot.
- `/wash`
  Meaning: archive inspection + rebuild/recovery flow.

Claude Code may later map these semantics into native commands or hooks, but the semantic source of truth remains Evo-Lite itself.

## Guardrails

- Do not directly edit runtime anchors in `.evo-lite/active_context.md`.
- Use the Evo-Lite CLI for focus/backlog/trajectory transitions.
- Read `active_context` before using `recall`.
- Do not let host-native commands or hooks replace Evo-Lite's archive and state-machine truth sources.

## Source Of Truth

Treat the following as authoritative:

- `.agents/` for workflow semantics
- `.evo-lite/active_context.md` for current state
- `.evo-lite/raw_memory/` and `.evo-lite/vect_memory/` for long-term archive artifacts
- Evo-Lite CLI output for closure/health status

If this file and `.agents/` ever diverge, `.agents/` wins.
