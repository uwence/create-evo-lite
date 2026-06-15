---
id: contract:planning-ir
version: evo-plan-ir@1
status: active
created: 2026-06-15
---

# Planning IR Schema

Intermediate representation produced by `mem plan scan`. Written to `.evo-lite/generated/planning/plan-ir.json`.

## Root Object

```json
{
  "version": "evo-plan-ir@1",
  "generatedAt": "<ISO 8601 timestamp>",
  "project": {
    "name": "<basename of project root>",
    "root": "."
  },
  "sources": [],
  "specs": [],
  "plans": [],
  "tasks": [],
  "warnings": []
}
```

## Source Object

One entry per scanned file.

```json
{
  "type": "spec | plan",
  "path": "<relative path from project root>"
}
```

## Spec Object

Parsed from files in `docs/specs/` (or `docs/superpowers/specs/`). File must have YAML frontmatter with `id` starting with `spec:`.

```json
{
  "id": "spec:<slug>",
  "title": "<H1 heading from body>",
  "status": "planned | in_progress | implemented | verified",
  "sourcePath": "<relative path>",
  "linkedPlans": ["plan:<slug>"],
  "acceptanceCriteria": ["<criterion text>"]
}
```

## Plan Object

Parsed from files in `docs/plans/` (or `docs/superpowers/plans/`). File must have YAML frontmatter with `id` starting with `plan:`.

```json
{
  "id": "plan:<slug>",
  "title": "<H1 heading>",
  "status": "planned | in_progress | implemented | verified",
  "sourcePath": "<relative path>",
  "linkedSpec": "spec:<slug> | null",
  "taskIds": ["task:<slug>"]
}
```

## Task Object

Flattened from plan task blocks. One entry per `[task:id]` checkbox in any plan file.

```json
{
  "id": "task:<slug>",
  "title": "<description text after [task:id]>",
  "status": "todo | implemented",
  "phase": "<### heading text | null>",
  "sourcePath": "<relative path of plan file>",
  "linkedSpec": "spec:<slug> | null",
  "linkedPlan": "plan:<slug>",
  "linkedFiles": ["<relative path>"],
  "verify": ["<shell command>"],
  "evidence": [],
  "confidence": 0.0
}
```

### Task Status Mapping

| Checkbox | Status |
|----------|--------|
| `[ ]`    | `todo` |
| `[x]` or `[X]` | `implemented` |

`confidence` is `1.0` when status is `implemented`, `0.0` otherwise.

## Warning Object

```json
{
  "level": "info | warning | error",
  "rule": "R001 | ... | R010 | null",
  "message": "<human-readable description>"
}
```

### Warning Rules (MVP)

| Rule | Condition | Level |
|------|-----------|-------|
| R003 | No spec files found | info |
| R004 | No plan files found | info |
| —    | File skipped (no `spec:`/`plan:` prefix) | warning |
| —    | File parse failure | error |

## Markdown File Conventions

### Spec File Format

```markdown
---
id: spec:<slug>
status: planned
owner: human
created: YYYY-MM-DD
---

# <Title>

## Goal
...

## Non-goals
...

## Requirements
...

## Acceptance Criteria

- <criterion>

## Linked Plans

- plan:<slug>
```

### Plan File Format

```markdown
---
id: plan:<slug>
status: in_progress
linkedSpec: spec:<slug>
created: YYYY-MM-DD
---

# <Title>

## Tasks

### Phase N: <phase name>

- [ ] [task:<slug>] <description>
  - files: path/to/file.js, path/to/other.js
  - verify: node .evo-lite/cli/memory.js plan scan
  - acceptance: <optional text>
```

## Generated Output Location

```
.evo-lite/generated/planning/
  plan-ir.json
```

Canonical truth stays in `docs/specs/` and `docs/plans/`. Generated IR is derived data.
