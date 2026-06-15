---
id: contract:architecture-ir
version: evo-arch-ir@1
status: active
created: 2026-06-15
---

# Architecture IR Schema

Intermediate representation produced by `mem architecture scan`. Written to `.evo-lite/generated/architecture/architecture-ir.json`.

## Root Object

```json
{
  "version": "evo-arch-ir@1",
  "generatedAt": "<ISO 8601 timestamp>",
  "project": { "name": "<basename of project root>", "root": "." },
  "provider": "native",
  "modules": [],
  "files": [],
  "warnings": []
}
```

## Module Object

A named functional area inferred from file paths. The native scanner uses static path rules; post-MVP providers (CodeGraph, GitNexus) may refine boundaries.

```json
{
  "id": "module:<slug>",
  "name": "<display name>",
  "description": "<what this module is responsible for>",
  "paths": ["<glob prefix or exact path>"],
  "fileCount": 0,
  "role": "entry | service | ui | runtime | scanner | governance | docs | test | unknown",
  "confidence": 1.0
}
```

### Role Values

| Role | Meaning |
|------|---------|
| `entry` | CLI or process entry point |
| `service` | Core domain logic / service layer |
| `ui` | User-facing display (inspector, dashboard) |
| `runtime` | Infrastructure: paths, DB, models, safety |
| `scanner` | IR scanners (planning, architecture) |
| `governance` | Evo-Lite rules, workflows, agents |
| `docs` | Specification, planning, contract documents |
| `test` | Test harnesses and fixtures |
| `unknown` | Unclassified |

## File Object

One entry per file walked by the scanner. Files not matched by any module rule get `module: null` and `role: "unknown"`.

```json
{
  "path": "<relative path from project root>",
  "module": "module:<slug> | null",
  "role": "<role>",
  "confidence": 1.0
}
```

## Warning Object

```json
{
  "level": "info | warning | error",
  "rule": "R007 | null",
  "message": "<description>"
}
```

### Warning Rules

| Rule | Condition | Level |
|------|-----------|-------|
| R007 | Native scanner detects file not matched by any module | info |
| —    | Walk error | error |

## Module Definitions (native scanner, MVP)

| Module ID | Name | Paths |
|-----------|------|-------|
| `module:cli-entry` | CLI Entry | `templates/cli/memory.js` |
| `module:memory-service` | Memory Service | `templates/cli/memory.service.js` |
| `module:inspector` | Inspector | `templates/cli/inspector.js` |
| `module:runtime` | Runtime | `templates/cli/runtime.js`, `templates/cli/db.js`, `templates/cli/models.js`, `templates/cli/safety.js`, `templates/cli/recall-rules.js`, `templates/cli/template-manifest.js` |
| `module:planning` | Planning | `templates/cli/planning.js`, `templates/cli/planning/` |
| `module:architecture` | Architecture | `templates/cli/architecture.js`, `templates/cli/architecture/` |
| `module:agents-workflow` | Agents & Workflow | `.agents/rules/`, `.agents/workflows/` |
| `module:docs-planning` | Docs & Planning | `docs/specs/`, `docs/plans/`, `docs/contracts/`, `docs/` |
| `module:test` | Test | `templates/cli/test.js` |

## Generated Output Location

```
.evo-lite/generated/architecture/
  architecture-ir.json
```

Canonical architecture truth stays in `.agents/rules/architecture.md`. Generated IR is derived data.
