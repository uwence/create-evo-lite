---
id: contract:drift-report
version: evo-drift-report@1
status: active
created: 2026-06-15
---

# Drift Report Schema

Intermediate representation produced by `mem architecture diff` and `mem plan gaps`. Written to `.evo-lite/generated/architecture/drift-report.json`.

Both commands contribute to the same file using scoped merging: each command replaces only its own scope's findings.

## Root Object

```json
{
  "version": "evo-drift-report@1",
  "generatedAt": "<ISO 8601 timestamp>",
  "project": { "name": "<basename>", "root": "." },
  "findings": [],
  "summary": {
    "total": 0,
    "warnings": 0,
    "info": 0,
    "errors": 0
  }
}
```

## Finding Object

```json
{
  "id": "<rule>:<discriminator>",
  "rule": "R001",
  "scope": "architecture | planning",
  "level": "warning | info | error",
  "type": "<type slug>",
  "message": "<human-readable description>",
  "evidence": ["<path or detail>"],
  "suggestedAction": "<what to do to resolve>"
}
```

### Type Values

| Type | Rule(s) | Meaning |
|------|---------|---------|
| `missing-file` | R001 | Required file absent |
| `placeholder` | R002 | File contains TODO/TBD/placeholder text |
| `no-specs` | R003 | No spec files found |
| `no-plans` | R004 | No plan files found |
| `no-linked-files` | R005 | Task has no linked files |
| `unlinked-file` | R006 | Git-changed file not linked to any task |
| `unknown-module` | R007 | Module not documented in architecture docs |
| `no-evidence` | R008 | Implemented task has no archive evidence |
| `stale-ir` | R009 | Generated IR older than source files |
| `untracked-backlog` | R010 | Backlog item not reflected in Planning IR |

## Drift Rules (MVP)

| Rule | Scope | Condition | Level |
|------|-------|-----------|-------|
| R001 | architecture | `.agents/rules/architecture.md` missing | warning |
| R002 | architecture | architecture.md contains TODO/TBD/placeholder | warning |
| R003 | planning | No spec files in docs/specs/ or docs/superpowers/specs/ | info |
| R004 | planning | No plan files in docs/plans/ or docs/superpowers/plans/ | info |
| R005 | planning | Task has no linkedFiles and status ≠ `planning-only` | warning |
| R006 | planning | Git-changed file not linked to any task | warning |
| R007 | architecture | Native scanner module not in docs/architecture/modules.md | info |
| R008 | planning | Task `implemented` with no archive evidence | warning |
| R009 | planning | Generated IR older than last modified source file | info |
| R010 | planning | active_context backlog item not in Planning IR | info |

## Scope Merging

Each command owns one scope:

| Command | Scope | Rules |
|---------|-------|-------|
| `mem architecture diff` | `architecture` | R001, R002, R007 |
| `mem plan gaps` | `planning` | R003, R004, R005, R006, R008, R009, R010 |

On write, findings from the other scope are preserved unchanged.

## Generated Output Location

```
.evo-lite/generated/architecture/
  drift-report.json
```
