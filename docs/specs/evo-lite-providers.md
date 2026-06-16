---
id: spec:evo-lite-providers
status: done
owner: human
created: 2026-06-15
---

# Evo-Lite Provider Interface

## Goal

Define a stable provider interface that allows the architecture and drift scanners to accept richer data from external tools (CodeGraph, GitNexus, GitHub Issues, etc.) without coupling core scanner logic to any specific tool.

The native file-system scanner remains the default and zero-dependency baseline. Providers are opt-in and additive.

## Non-goals

- Not a replacement for the native scanner — native always runs first as the baseline
- Not a plugin marketplace — providers are project-local Node.js modules
- Not an AST engine — providers supply pre-analyzed data, core scanner does not re-parse source
- Does not require any provider to be installed — absence of a provider is not an error
- Does not define LLM-based inference providers in this spec (future)

## Requirements

### Provider contract

Each provider is a Node.js module exporting a single object:

```js
module.exports = {
    id: 'provider:gitnexus',          // unique id
    name: 'GitNexus',
    version: '1',
    check() { return boolean },        // true if provider is available in this environment
    scan(root, nativeIR) {             // nativeIR = output of native scanner
        return {
            modules: [],               // additional or overriding module entries
            files: [],                 // additional file classifications
            edges: [],                 // call-graph or import edges
            flows: [],                 // execution flows (optional)
            confidence: 0.0–1.0,
        };
    },
};
```

### Merge semantics

- Provider output is merged into the native IR — native entries are never deleted
- If a provider classifies a file already classified by native: provider wins if `confidence > native.confidence`
- Edges and flows are purely additive

### Provider discovery

Providers are declared in `.evo-lite/config.json` (new file):

```json
{
  "providers": ["./providers/gitnexus.js"]
}
```

Absent `config.json` → only native scanner runs.

### Error isolation

If a provider's `check()` returns false or `scan()` throws: log a warning, continue with native-only IR. One bad provider must not fail the whole scan.

### First provider: GitNexus

GitNexus is already indexed for this project (`create-evo-lite`, 1175 symbols). The GitNexus provider calls `gitnexus_context` and `gitnexus_impact` MCP tools to enrich module boundaries and call-graph edges.

Available only when GitNexus MCP server is active in the session.

### Provider for GitHub Issues

Queries open GitHub Issues and links them to Planning IR tasks by issue number references in task `- verify:` lines. Adds `issueRefs` to affected tasks in Planning IR.

Available only when `GH_TOKEN` is set and `gh` CLI is installed.

## Linked Plans

- plan:evo-lite-providers-mvp

## Acceptance Criteria

- Native scanner continues to work with zero config (no breaking change)
- `.evo-lite/config.json` absent → no providers loaded, no error
- `check()` returning false → provider skipped, warning logged, scan completes normally
- Provider `scan()` throwing → same as `check()` false
- GitNexus provider: when MCP active, `mem architecture scan` shows elevated confidence on modules it recognises
- GitHub Issues provider: when `GH_TOKEN` set, Planning IR tasks with `- verify: issue:#N` gain `issueRefs: [N]`
- All provider output merged correctly into architecture-ir.json
