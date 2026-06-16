---
id: spec:evo-lite-mcp-server
status: done
owner: human
created: 2026-06-15
---

# Evo-Lite MCP Server

## Goal

Expose Evo-Lite's memory, planning, architecture, and drift state as MCP tools so that Claude Code agents and other MCP-compatible clients can query project state without invoking the CLI directly.

The MCP server must be read-only, project-local, and run under the same security model as the inspector (loopback only, no auth required for localhost).

## Non-goals

- Not a write interface — does not mutate specs, plans, active_context, or archive
- Not a remote service — loopback only, no TLS, no public exposure
- Not a replacement for the inspector — both can run simultaneously
- Not a general-purpose MCP proxy — only exposes Evo-Lite–specific tools
- Does not replace `mem commit`, `mem recall`, or `mem verify` CLI workflows
- Does not implement sampling or prompt injection

## Requirements

### Transport

- Protocol: MCP over stdio (primary) — compatible with Claude Code's `mcpServers` config
- Optionally: HTTP SSE transport on loopback for inspector integration
- Entrypoint: `mem mcp` or `node .evo-lite/cli/memory.js mcp`

### Tools exposed

| Tool | Maps to | Returns |
|------|---------|---------|
| `evo_recall` | `mem recall <query>` | Top-K recall hits |
| `evo_verify` | `mem verify` | Verify snapshot JSON |
| `evo_plan_status` | `mem plan status` | Planning IR summary |
| `evo_architecture_status` | `mem architecture status` | Architecture IR summary |
| `evo_drift_status` | `mem architecture diff + mem plan gaps` | Drift findings |
| `evo_active_context` | reads `active_context.md` | focus, backlog, trajectory |

### Schema

Each tool must declare a JSON Schema for its input and output so that Claude Code can invoke it without guessing parameter names.

### Security

- Bind stdio only — no network socket by default
- If HTTP SSE is offered: bind `127.0.0.1` only
- No tool may write to disk or execute shell commands beyond reading generated IRs

### Configuration

MCP server registration in `claude_desktop_config.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "evo-lite": {
      "command": "node",
      "args": [".evo-lite/cli/memory.js", "mcp"],
      "cwd": "${workspaceRoot}"
    }
  }
}
```

## Linked Plans

- plan:evo-lite-mcp-server-mvp

## Acceptance Criteria

- `mem mcp` starts an MCP server that Claude Code can connect to via stdio transport
- All six tools respond correctly and return structured JSON
- `evo_recall` returns same results as `mem recall` for the same query
- `evo_drift_status` live-scans on every call (no stale cache risk)
- Server exits cleanly on SIGINT/SIGTERM
- No tool writes to disk
