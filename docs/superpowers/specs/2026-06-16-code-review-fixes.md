---
id: spec:code-review-fixes
status: done
created: 2026-06-16
linkedPlan: plan:code-review-fixes
---

# Code Review Fixes — Spec

## Goal

Fix 8 bugs identified in the June 2026 external code review of `create-evo-lite` main branch (2 P0 crash bugs, 6 P1 correctness / coverage issues).

## Problem Statement

The external review found:

- **P0-1**: `create-evo-lite init` crashes with EISDIR when `templates/cli/` contains subdirectories — `readFileSync` called on a directory entry.
- **P0-2**: Test helper `createTempTemplateCli` uses flat `copyFileSync` loop, same crash pattern.
- **P1-1**: `template-manifest.js` `core-cli` family missing 17 files added in Stage 5.
- **P1-2**: `@modelcontextprotocol/sdk` not in runtime install command — init silently breaks on MCP-using projects.
- **P1-3**: R008 drift rule only checks `implemented` status, misses `verified`.
- **P1-4**: R009 drift rule uses shallow `readdirSync`, misses nested file changes.
- **P1-5**: `checkArchiveHits` matches filename not file content — false negatives.
- **P1-6**: `package.json` has no `files` whitelist — npm pack ships test/dev artifacts.

## Acceptance Criteria

- EISDIR crash on `create-evo-lite init` with nested cli dirs is eliminated
- Test `createTempTemplateCli` copies subdirectories correctly
- `template-manifest.js` covers all planning, architecture, dashboard, mcp cli files
- `@modelcontextprotocol/sdk` included in runtime install command (log, install, fallback)
- R008 fires for both `implemented` and `verified` tasks with no evidence
- R009 recurses into subdirectories when checking source staleness
- `checkArchiveHits` scans file content for taskId/slug matches
- `package.json` has `files` whitelist excluding dev artifacts
- `npm test` script defined

## Non-Goals

- No new CLI commands
- No schema changes to plan-ir.json
- No changes to `.agents/` rules
