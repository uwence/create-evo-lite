---
id: plan:project-control-dashboard-mvp
status: in_progress
linkedSpec: spec:project-control-dashboard
created: 2026-06-15
---

# Project Control Dashboard — MVP Plan

## Goal

Deliver the MVP scope of the Project Control Dashboard inside `create-evo-lite` using a dogfood-first approach. The project must be able to parse, scan, and govern its own development process before any other target.

## MVP Scope

Included:

```text
1. Dogfood spec and MVP plan documents  ← Phase 0 (this phase)
2. Planning IR schema
3. Architecture IR schema
4. Drift Report schema
5. mem plan status
6. mem plan scan
7. native architecture status
8. native architecture scan
9. drift report MVP (R001–R010)
10. dashboard build
11. inspector read-only Plan + Architecture + Drift tabs
```

Excluded from MVP:

```text
- MCP server
- CodeGraph, GitNexus, Understand-Anything, GitHub Issues providers
- PR review integration
- automatic plan mutation or task editing UI
- force-directed graph or dynamic Mermaid rendering
- AST-level parsing or LLM-based inference
- CI enforcement
```

## Tasks

### Phase 0: Dogfood documents

- [x] [task:add-dogfood-spec] Create spec file at docs/specs/
  - files: docs/specs/project-control-dashboard.md
  - verify: human review — spec is parseable and contains id, goal, non-goals, requirements, acceptance criteria

- [x] [task:add-dogfood-plan] Create MVP plan file at docs/plans/
  - files: docs/plans/project-control-dashboard-mvp.md
  - verify: human review — plan follows Markdown conventions, tasks have ids and linked files

### Phase 1: Planning scanner

- [x] [task:add-planning-ir-schema] Define Planning IR schema
  - files: docs/contracts/planning-ir.schema.md
  - verify: schema documents specs, plans, tasks, evidence, confidence, warnings

- [x] [task:add-plan-command-skeleton] Add plan command skeleton to memory CLI
  - files: templates/cli/planning.js, templates/cli/memory.js
  - verify: node .evo-lite/cli/memory.js plan status

- [x] [task:add-markdown-parser] Implement Markdown planning parser
  - files: templates/cli/planning/parse-markdown.js, templates/cli/planning/scan.js
  - verify: node .evo-lite/cli/memory.js plan scan
  - acceptance: parses frontmatter, H1 title, checkbox tasks, [task:id] notation, linked files, verify lines

- [x] [task:validate-plan-dogfood] Validate planning scanner against dogfood
  - verify: plan-ir.json contains spec:project-control-dashboard and this plan's tasks

### Phase 2: Inspector Plan tab

- [x] [task:add-inspector-plan-tab] Add Plan tab to inspector HTML
  - files: templates/cli/inspector.js
  - verify: node .evo-lite/cli/memory.js inspect
  - acceptance: dashboard shows spec, MVP plan, task list, task statuses, linked files; missing generated data shows command hints

### Phase 3: Native architecture scanner

- [x] [task:add-architecture-ir-schema] Define Architecture IR schema
  - files: docs/contracts/architecture-ir.schema.md
  - verify: schema documents modules, files, edges, flows, providers, confidence

- [x] [task:add-architecture-scanner] Implement native architecture scanner
  - files: templates/cli/architecture.js, templates/cli/architecture/scan-native.js, templates/cli/architecture/infer-modules.js, templates/cli/memory.js
  - verify: node .evo-lite/cli/memory.js architecture scan
  - acceptance: scanner identifies CLI/runtime area, memory service area, inspector area, template area, agents workflow area, docs planning area

### Phase 4: Drift MVP

- [x] [task:add-drift-report-schema] Define Drift Report schema
  - files: docs/contracts/drift-report.schema.md
  - verify: schema documents findings, severity, type, rule id, evidence

- [x] [task:add-drift-engine] Implement drift engine (R001–R010)
  - files: templates/cli/architecture/diff.js, templates/cli/planning/gaps.js
  - verify: node .evo-lite/cli/memory.js architecture diff && node .evo-lite/cli/memory.js plan gaps
  - acceptance: detects R001–R010 where applicable; writes drift-report.json

### Phase 5: Dashboard build

- [x] [task:add-dashboard-builder] Implement dashboard data builder
  - files: templates/cli/dashboard-data.js, templates/cli/memory.js
  - verify: node .evo-lite/cli/memory.js dashboard build
  - acceptance: generates dashboard-data.json; inspector reads this file instead of re-running scan logic

- [x] [task:add-inspector-architecture-drift-tabs] Add Architecture and Drift tabs to inspector
  - files: templates/cli/inspector.js
  - verify: node .evo-lite/cli/memory.js inspect
  - acceptance: Architecture and Drift panels visible; existing timeline/verify endpoints unchanged

- [x] [task:add-verify-control-status] Extend verify to report project_control status
  - files: templates/cli/memory.service.js
  - verify: node .evo-lite/cli/memory.js verify
  - acceptance: verify reports project_control status without running expensive scans

## Rollout Stages

```text
Stage 0: Documentation-only     ← current stage
Stage 1: Planning scanner live
Stage 2: Architecture scanner live
Stage 3: Drift MVP live
Stage 4: Dashboard build + inspector tabs live
Stage 5: Default-on after two stable dogfood cycles
```

## Acceptance Criteria

- An agent can parse this file and extract: plan id, linkedSpec, task ids, linked files, verify commands, and task statuses.
- `mem plan scan` includes all tasks from this plan in plan-ir.json.
- Dashboard shows this plan under the Planning tab with task progress.
- All Phase 0 tasks are marked `[x]` before proceeding to Phase 1.
