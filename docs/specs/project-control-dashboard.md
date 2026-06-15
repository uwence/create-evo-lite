---
id: spec:project-control-dashboard
status: planned
owner: human
created: 2026-06-15
masterSpec: docs/Spec Evo-Lite Project Control Dashboard.md
---

# Project Control Dashboard

## Goal

Make Evo-Lite able to observe, validate, and govern its own development process by connecting five things currently fragmented in AI coding workflows:

1. What we intended to build (intent / specs)
2. What we planned to implement (plans / tasks)
3. What architecture we said we would follow (architecture rules)
4. What code actually exists (as-built scan)
5. What evidence proves the work is complete (archive / verify / tests)

The dashboard must be project-local, read-only by default, and compatible with Evo-Lite's existing governance chain. It is dogfood-first: the first useful dashboard shows the development status of this very feature inside `create-evo-lite`.

## Non-goals

- Not a SaaS dashboard or remote service
- Not a full IDE or editor
- Not a task management replacement (does not replace active_context or /commit)
- Not a code graph engine (does not replace CodeGraph, GitNexus, or Understand-Anything)
- Not a Superpowers replacement
- Not a source-of-truth editor (read-only; canonical truth stays in .agents/, .evo-lite/, docs/)
- Not a replacement for /mem, /verify, /wash, or /commit workflows
- Does not automatically mutate specs, plans, or architecture documents
- Does not infer locked architecture from code alone — placeholder state is surfaced explicitly

## Requirements

### System model

The dashboard compares three project states:

```text
As-Planned:   specs, plans, tasks, backlog, milestones
As-Designed:  architecture intent, module boundaries, constraints, flows
As-Built:     actual files, modules, imports, routes, git changes
```

And derives:

```text
Progress:      how much planned work has implementation evidence
Traceability:  spec → plan → task → module → file → commit → test → archive
Drift:         where plan, design, and implementation disagree
```

### Design principles

- **Dogfood-first** — must first work on `create-evo-lite` itself
- **Read-only-first** — no state mutations in MVP; all writes go through CLI or explicit file edits
- **Planning-first** — start from specs and plans, not code graphs
- **Generated data is not truth** — canonical truth in `.agents/`, `.evo-lite/`, `docs/`; generated output in `.evo-lite/generated/`
- **Provider-optional** — must work without CodeGraph, GitNexus, Understand-Anything, or GitHub
- **Stable IR before UI** — define intermediate representations before building advanced UI
- **Human-confirmed progression** — inferred states must carry source, confidence, evidence, suggestedAction

### Intermediate representations (MVP required)

- Planning IR
- Architecture IR
- Drift Report
- Dashboard Data

Post-MVP: Traceability IR, Impact Report

### Provider order

```text
1. Native scanner (MVP)
2. Understand-Anything JSON importer (post-MVP)
3. CodeGraph provider (post-MVP)
4. GitNexus provider (post-MVP, noncommercial only)
5. GitHub Issues / PR provider (post-MVP)
```

### Repository layout (canonical inputs)

```text
docs/specs/project-control-dashboard.md           ← this file
docs/plans/project-control-dashboard-mvp.md
docs/architecture/
  overview.md
  modules.md
  flows.md
  data-model.md
docs/decisions/
  ADR-0001-project-control-dashboard.md

.agents/rules/architecture.md                      ← existing canonical architecture rule
.evo-lite/active_context.md                        ← existing runtime state
```

### Generated data layout

```text
.evo-lite/generated/
  planning/
    plan-ir.json
    progress-report.json
    traceability.json
  architecture/
    architecture-ir.json
    drift-report.json
    impact-report.json
  dashboard/
    dashboard-data.json
    last-build.json
```

### CLI surface (MVP)

```bash
mem plan status
mem plan scan
mem architecture status
mem architecture scan
mem architecture diff
mem plan gaps
mem dashboard build
mem inspect
```

### Drift rules (MVP, R001–R010)

- R001: `.agents/rules/architecture.md` missing → warning
- R002: architecture.md contains placeholder text → warning
- R003: `docs/specs/` and `docs/superpowers/specs/` both missing → info
- R004: `docs/plans/` and `docs/superpowers/plans/` both missing → info
- R005: task has no linkedFiles and status is not `planning-only` → warning
- R006: git changed file not linked to any task → warning
- R007: native scanner detects module not in `docs/architecture/modules.md` → info
- R008: task status `implemented` or `verified` with no archive evidence → warning
- R009: generated IR older than last modified source file → info
- R010: active_context backlog item not reflected in Planning IR → info

## Acceptance Criteria

- A human can read this spec and understand the MVP.
- An agent can identify: spec id, linked plan id, goal, non-goals, requirements.
- `mem plan status` reports this spec as found and parseable.
- `mem plan scan` includes this spec in plan-ir.json.
- Dashboard shows this spec under the Planning tab.

## Linked Plans

- plan:project-control-dashboard-mvp
