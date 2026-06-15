---
id: plan:evo-lite-mcp-server-mvp
status: in_progress
linkedSpec: spec:evo-lite-mcp-server
created: 2026-06-15
---

# Evo-Lite MCP Server — MVP Plan

## Goal

Expose Evo-Lite state as MCP tools over stdio so Claude Code can query recall, verify, planning, architecture, and drift without invoking the CLI directly.

## MVP Scope

Included:

```text
1. MCP SDK dependency (stdio transport)
2. mem mcp entrypoint command
3. evo_recall tool
4. evo_verify tool
5. evo_plan_status tool
6. evo_architecture_status tool
7. evo_drift_status tool
8. evo_active_context tool
9. Claude Code config sample in docs/
10. Dogfood validation via Claude Code MCP connection
```

Excluded from MVP:

```text
- HTTP SSE transport
- Inspector integration (MCP alongside HTTP server)
- Authentication or multi-user access
- Write tools (mem commit, mem context add)
- Sampling or prompt injection support
```

## Tasks

### Phase 0: Dogfood documents

- [ ] [task:add-mcp-server-spec] Create spec file at docs/specs/
  - files: docs/specs/evo-lite-mcp-server.md
  - verify: human review — spec is parseable and contains id, goal, non-goals, requirements, acceptance criteria
  - evidence: git:6581bbc

### Phase 1: MCP foundation

- [ ] [task:add-mcp-sdk-dep] Add @modelcontextprotocol/sdk to package.json
  - files: package.json
  - verify: node -e "require('@modelcontextprotocol/sdk/server/index.js')"
  - acceptance: SDK importable; no runtime errors

- [ ] [task:add-mcp-server-module] Implement mcp-server.js with stdio transport and tool registry
  - files: templates/cli/mcp-server.js, templates/cli/memory.js
  - verify: echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' | node .evo-lite/cli/memory.js mcp
  - acceptance: server responds with valid MCP initialize response; exits cleanly on SIGINT

### Phase 2: Tool implementations

- [ ] [task:add-mcp-tool-recall] Implement evo_recall tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_recall with query returns recall hits array
  - acceptance: same results as mem recall for identical query

- [ ] [task:add-mcp-tool-verify] Implement evo_verify tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_verify returns verify snapshot JSON
  - acceptance: matches output of buildVerifyJson()

- [ ] [task:add-mcp-tool-plan-status] Implement evo_plan_status tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_plan_status returns planning IR summary
  - acceptance: spec count, plan count, task counts correct

- [ ] [task:add-mcp-tool-architecture-status] Implement evo_architecture_status tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_architecture_status returns module list
  - acceptance: module count matches mem architecture status output

- [ ] [task:add-mcp-tool-drift-status] Implement evo_drift_status tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_drift_status returns findings array and summary
  - acceptance: live scan; no stale data

- [ ] [task:add-mcp-tool-active-context] Implement evo_active_context tool
  - files: templates/cli/mcp-server.js
  - verify: MCP tool call evo_active_context returns meta, focus, backlog, trajectory
  - acceptance: matches extractActiveContext() output

### Phase 3: Integration and docs

- [ ] [task:add-mcp-claude-config-sample] Add Claude Code config sample to docs/
  - files: docs/contracts/mcp-server-config-sample.json
  - verify: human review — config is valid JSON with correct mcpServers entry
  - acceptance: copy-paste ready for .claude/settings.json or claude_desktop_config.json

- [ ] [task:validate-mcp-dogfood] Validate MCP server with Claude Code connection
  - files: .evo-lite/generated/mcp-validation.json
  - verify: Claude Code connects to mem mcp and successfully calls all six tools
  - acceptance: all tools return correct structured responses; no errors in MCP inspector

## Rollout Stages

```text
Stage 0: Spec only
Stage 1: Foundation + stdio transport working
Stage 2: All six tools implemented
Stage 3: Dogfood validated with Claude Code
```

## Acceptance Criteria

- `mem mcp` starts an MCP stdio server Claude Code can connect to
- All six tools respond with correct structured JSON
- No tool writes to disk
- Server exits cleanly on SIGINT/SIGTERM
