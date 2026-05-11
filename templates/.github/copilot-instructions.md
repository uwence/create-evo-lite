# Context-Mode Routing

This workspace exposes context-mode through the Docker-backed MCP server defined in `.vscode/mcp.json`.

- Prefer `ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute` for analysis that would otherwise dump large raw output into chat.
- Prefer `ctx_fetch_and_index` plus `ctx_search` for web content instead of pasting or returning raw page bodies.
- Keep file reads and terminal output focused on editing, targeted validation, and short results.
- When using context-mode file tools, pass workspace-relative paths such as `.vscode/mcp.json`; do not pass Windows absolute paths.
- When resuming work after compaction or restart, search prior context with `ctx_search` before asking the user to repeat state.
- Use `ctx stats` to inspect savings and `ctx doctor` when MCP or hook wiring looks unhealthy.

<!-- evo-lite:local-extensions:start -->
<!-- evo-lite:local-extensions:end -->