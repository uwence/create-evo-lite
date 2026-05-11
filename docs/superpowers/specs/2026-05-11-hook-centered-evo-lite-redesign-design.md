# Hook-Centered Evo-Lite Redesign

Date: 2026-05-11
Status: approved for phased implementation

## Summary

Evo-Lite should remain host-neutral and durable, but the drifting parts of its soft protocol should move out of always-on prompt text and into deterministic lifecycle hooks. The CLI remains the write gateway for runtime state transitions. Project files remain the durable source of truth. MCP integrations are advisory capability discovery, not deployment or state ownership.

Phase 1 keeps the current Markdown `active_context.md` format and preserves current `remember` / `recall` behavior. It adds structured CLI context read/validate surfaces for hooks, thin generated adapters, short hook-driven reminders, and MCP capability detection. Phase 2 can explore JSON canonical state plus an HTML notebook-style viewer.

## Goals

- Reduce prompt/context load by slimming always-on rules and generated adapters.
- Replace fragile soft reminders with deterministic VS Code/Copilot hook checks.
- Keep state transitions auditable through the Evo-Lite CLI.
- Preserve `remember` / `recall` behavior in the first implementation round.
- Clarify the boundary between Evo-Lite project memory and GitNexus code intelligence.
- Support MCP detection and usage guidance without adding Docker/deployment scope.

## Non-Goals

- Do not remove `remember` / `recall` in Phase 1.
- Do not make hooks auto-commit, auto-track, auto-archive, tag, or push.
- Do not make GitNexus or any MCP a hard dependency of Evo-Lite core.
- Do not migrate `active_context.md` to JSON canonical state in Phase 1.
- Do not use HTML as canonical state. HTML is only a future viewer surface.

## Architecture Boundaries

### Hook Layer

Hooks enforce timing and visibility. They can inject context, block unsafe direct state edits, and remind the agent about missed closure steps.

Default policy:

- Block unsafe direct edits to runtime state anchors when a CLI path exists.
- Remind after commits, stale context, dirty state, or partial closure.
- Inject read-only context summaries at session start or resume.
- Never perform hidden closure actions by default.

### CLI Layer

The CLI remains the only reliable state transition gateway for:

- `context focus/add/track`
- archive writes and archive sync/rebuild
- verify and validation
- safety scanning at write choke points
- import/export
- current `remember` / `recall`

Phase 1 adds structured context outputs for hooks, so hooks do not parse Markdown directly.

### Active Context Layer

`active_context.md` remains the fast resume surface for Phase 1. It should be small, strict, and optimized for handoff:

- `META`: compact project status and verification metadata.
- `FOCUS`: one current objective.
- `BACKLOG`: up to five active tasks.
- `TRAJECTORY`: recent 10-20 progress entries.

Long workflow explanations move out of active context and always-on prompts.

### Adapter Layer

`AGENTS.md`, `CLAUDE.md`, and command wrappers are generated transport adapters. They should summarize bootstrap behavior, link back to canonical files, and avoid duplicating the entire rule tree.

### MCP Detection Layer

MCP support in this repo is limited to detection and guidance:

- detect available MCP servers/tools/resources when host config is accessible
- summarize capabilities as short cards
- recommend when to use each MCP
- degrade cleanly when no MCP configuration exists

Docker deployment and MCP server hosting belong to a separate project.

### GitNexus Boundary

GitNexus owns code intelligence:

- code graph and symbol relationships
- execution flows
- impact analysis
- safe rename/refactor support
- git-diff affected-flow analysis

Evo-Lite owns project intent and handoff:

- current focus
- backlog and trajectory
- why a change happened
- architecture decisions
- session state and handoff archive

The two systems are complementary. Evo-Lite should not duplicate code graph memories that GitNexus can derive from source.

## Hook Workflow Model

### SessionStart / Resume

- Read the active context through a CLI summary/JSON command.
- Surface focus, active tasks, recent trajectory, stale/dirty warnings, and detected MCP capability cards.
- Do not write state.

### PreToolUse

- Block or ask before direct edits to runtime anchors in `active_context.md`.
- Warn before risky edits to generated adapters or runtime internals.
- Allow ordinary source edits.

### PostToolUse

- Detect successful commits and remind about `context track`.
- Detect version edits and remind about release/tag closure.
- Inspect CLI closure output so agents cannot report success after partial closure.

### PreCompact

- Prompt the agent to preserve unresolved decisions and focus before compaction.
- Prefer a short handoff update or `/mem` semantics.

### Stop / SessionEnd

- Warn on dirty git state, stale context, or untracked closure state.
- Do not mutate state by default.

## Phase Plan

### Phase 0: Baseline And Contract Lock

Inventory current CLI commands, workflow docs, generated adapters, verify output, and tests. Confirm exact VS Code/Copilot hook file locations and input/output contracts before implementation.

Output:

- frozen CLI command names for Phase 1
- frozen hook asset locations
- ownership map for parallel worktrees
- verification matrix

### Phase 1: Core Context API

Add structured context read/summary/validate surfaces without changing the canonical Markdown format.

Target commands:

- `context read [--json]`
- `context summary [--json]`
- `context validate [--json]`

Hooks should consume these outputs instead of parsing Markdown.

### Phase 1: Hook Scaffolding

Generate hook assets and small hook commands/scripts for the approved default policy.

### Phase 1: Runtime Guard Cleanup

Move long instructional nagging out of CLI stdout when hooks can provide shorter deterministic messages. Keep core enforcement and safety checks in CLI code.

### Phase 1: Adapter And Rule Slimming

Shorten generated adapters and always-on rule files. Keep detailed workflows on demand.

### Phase 1: MCP Capability Detection

Add read-only `mcp detect` / `mcp explain` behavior with short advisory output and safe degradation.

### Phase 2: JSON Canonical And HTML Viewer

Explore JSON as canonical state and HTML as a notebook-style read-only viewer.

Requirements:

- JSON has schema and migrations.
- HTML loads JSON and does not become state truth.
- CLI/hooks remain the only write gateway.
- Text or Markdown projection remains available for non-HTML hosts.

## Parallel Worktree Plan

Use one coordinator session/worktree as integration owner. Start with at most three active implementation/research branches.

### `worktree/core-context-api`

Scope: CLI structured context read/summary/validate API and tests.

Owned files:

- `templates/cli/memory.js`
- `templates/cli/memory.service.js`
- `templates/cli/runtime.js`
- `templates/cli/test.js`

Risk: high. One agent only. Merge first.

### `worktree/adapters-docs-slimming`

Scope: generated adapter and always-on rule slimming.

Owned files:

- `templates/AGENTS.md`
- `templates/CLAUDE.md`
- `templates/.claude/commands/*.md`
- `templates/.agents/rules/*.md`
- `templates/.agents/workflows/*.md`
- relevant docs

Risk: medium wording drift, low code risk. Can begin after Phase 0 terms are frozen.

### `worktree/mcp-detect`

Scope: read-only MCP capability detection and fixtures.

Owned files:

- likely new `templates/cli/mcp-detect.js`
- tests/fixtures
- minimal CLI registration after a routing seam exists

Risk: medium. Must degrade cleanly when config is absent or malformed.

### `worktree/hooks-runtime`

Scope: hook templates, hook install/verify command, lifecycle check scripts.

Dependencies: stable core context API.

Risk: medium. Start after `core-context-api` stabilizes.

### `worktree/phase2-context-viewer-design`

Scope: design-only JSON canonical + HTML viewer exploration.

Risk: low if design-only. Do not merge into Phase 1 runtime without explicit approval.

## Serial-Only Decisions

- Exact hook file format and event names.
- CLI command names and JSON output contract.
- Deep edits to `memory.service.js`.
- `index.js` generation changes spanning multiple template families.
- Final integration and temp-project scaffold verification.

## Verification Matrix

1. Run existing runtime tests: `node templates/cli/test.js`.
2. Initialize a temporary project: `node index.js <temp-dir> --yes`.
3. In the temp project, run `.\.evo-lite\mem.cmd verify` and `node .evo-lite/cli/memory.js verify`.
4. Test hook scenarios: blocked direct context anchor edit, commit without track reminder, partial closure warning, PreCompact/Stop dirty state warning.
5. Test MCP detection: no config, GitNexus present, malformed config.
6. Confirm generated adapters stay short and link to canonical files.
7. Confirm `remember` / `recall` behavior is unchanged in Phase 1.
8. For Phase 2 only, validate JSON schema migration, HTML viewer loading, and generated text/Markdown projection.

## Open Questions

- Should Phase 2 make `active_context.md` a generated projection, or keep it as a compatibility source?
- Should aggressive automation become a separately named opt-in mode after Phase 1?
- Which host-specific hook surfaces should be emitted by default versus documented as optional user setup?