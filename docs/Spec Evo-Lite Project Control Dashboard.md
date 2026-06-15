# Spec: Evo-Lite Project Control Dashboard

Status: Draft
Target project: create-evo-lite
Implementation mode: Dogfood-first
Primary goal: Make Evo-Lite able to observe, validate, and govern its own development process before generalizing to other projects.

---

## 1. Executive Summary

Evo-Lite Project Control Dashboard is a project-local control plane for AI-assisted software development.

It is not a generic project management system.
It is not another code graph engine.
It is not a replacement for CodeGraph, GitNexus, Understand-Anything, Spec Kit, or Superpowers.

Its purpose is to connect five things that are currently fragmented in AI coding workflows:

```text
1. What we intended to build
2. What we planned to implement
3. What architecture we said we would follow
4. What code actually exists
5. What evidence proves the work is complete
```

The system will first dogfood itself inside `create-evo-lite`.

The first production target is:

```text
When running `.evo-lite/mem inspect`, the user can see:
- current project plan
- current MVP task tree
- current architecture intent
- current code/module map
- current drift and gaps
- current active_context/archive/verify status
```

The dashboard must remain local, read-only by default, and compatible with Evo-Lite's existing governance chain.

---

## 2. Problem Statement

AI coding works well for small isolated tasks. It breaks down in larger projects because the agent and the human lose synchronized awareness of:

```text
- project intent
- accepted specifications
- active plans
- task progress
- module boundaries
- architecture constraints
- current code reality
- test and archive evidence
```

Without a control plane, AI coding projects drift in several ways:

```text
Plan drift:
Code exists without any linked spec, plan, or task.

Architecture drift:
Implementation violates the intended module boundaries or dependency direction.

Progress drift:
Tasks are marked as done but lack code, tests, commits, or archive evidence.

Context drift:
AI continues from conversation memory instead of project-local canonical state.

Documentation drift:
Specs and plans are created once but are not reconciled against implementation.
```

Evo-Lite already provides workflow protocols, `active_context`, archive, CLI, and a local inspector. The missing layer is a dashboard and data model that connects project plan, architecture, code reality, and closure evidence.

---

## 3. Product Positioning

### 3.1 What this feature is

This feature is a project-local control dashboard for AI development governance.

It answers:

```text
What are we building?
What have we planned?
What has been implemented?
Where is the code?
What evidence proves it?
Where has the project drifted?
What should the agent read before continuing?
```

### 3.2 What this feature is not

This feature is not:

```text
- a SaaS dashboard
- a full IDE
- a task management replacement
- a complete static analysis engine
- a full graph database
- a GitHub Projects replacement
- a direct clone of GitNexus or CodeGraph
- a replacement for Evo-Lite active_context/archive
- an automatic source-of-truth editor
```

---

## 4. Design Principles

### 4.1 Dogfood-first

The feature must first work on `create-evo-lite` itself.

The first useful dashboard should show the development status of this very feature.

### 4.2 Read-only-first

The dashboard must not modify project state in MVP.

All persistent writes must go through CLI commands or explicit file edits.

### 4.3 Planning-first

The first dogfood loop should start from specs and plans, not code graphs.

Reason:

```text
Before the project can understand what code exists,
it must understand what it is supposed to build.
```

### 4.4 Generated data is not truth

Generated files are cache and analysis output.

Canonical truth remains:

```text
.agents/
.evo-lite/active_context.md
.evo-lite/raw_memory/
docs/specs/
docs/plans/
docs/architecture/
docs/decisions/
```

Generated data lives under:

```text
.evo-lite/generated/
```

### 4.5 Provider-optional architecture

External tools may enhance analysis, but the system must work without them.

Provider order:

```text
1. Native scanner
2. Understand-Anything JSON importer
3. CodeGraph provider
4. GitNexus provider
5. GitHub Issues / PR provider
```

MVP only implements native planning and native architecture scanning.

### 4.6 Stable IR before UI complexity

The project must define stable intermediate representations before building advanced UI.

Required IRs:

```text
Planning IR
Architecture IR
Traceability IR
Drift Report
Impact Report
Dashboard Data
```

### 4.7 Human-confirmed progression

Automatic inference must not silently update specs, plans, or architecture documents.

Inferred states must include:

```text
source
confidence
evidence
suggestedAction
```

---

## 5. System Model

The dashboard compares three project states.

```text
As-Planned:
Specs, plans, tasks, backlog, milestones.

As-Designed:
Architecture intent, module boundaries, constraints, flows, data model.

As-Built:
Actual files, modules, imports, routes, code graph, git changes.
```

The dashboard then derives:

```text
Progress:
How much planned work has implementation evidence.

Traceability:
Spec -> Plan -> Task -> Module -> File -> Commit -> Test -> Archive.

Drift:
Where plan, design, and implementation disagree.

Impact:
What current changes affect.
```

---

## 6. Target Architecture

```text
┌──────────────────────────────────────────────┐
│ Canonical Inputs                              │
│ docs/specs, docs/plans, docs/architecture     │
│ .agents/rules, active_context, raw_memory     │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Native Scanners                               │
│ planning scanner, architecture scanner        │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Optional Providers                            │
│ Understand-Anything, CodeGraph, GitNexus      │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Evo-Lite IR Layer                             │
│ Planning IR, Architecture IR, Drift Report    │
│ Traceability IR, Impact Report                │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Dashboard Data Builder                        │
│ produces dashboard-data.json                  │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Local Inspector Dashboard                     │
│ read-only, loopback-only, no external service │
└──────────────────────────────────────────────┘
```

---

## 7. Repository Layout

### 7.1 Canonical project documents

```text
docs/
  specs/
    README.md
    project-control-dashboard.md

  plans/
    README.md
    project-control-dashboard-mvp.md

  architecture/
    README.md
    overview.md
    modules.md
    flows.md
    data-model.md

  decisions/
    ADR-0001-project-control-dashboard.md
```

### 7.2 Compatibility paths

The scanner must also support existing Superpowers-style paths:

```text
docs/superpowers/specs/
docs/superpowers/plans/
```

### 7.3 Generated data

```text
.evo-lite/
  generated/
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

### 7.4 Runtime CLI files

```text
.evo-lite/cli/
  planning.js
  architecture.js
  dashboard-data.js
  inspector.js

  planning/
    scan.js
    parse-markdown.js
    progress.js
    traceability.js

  architecture/
    scan-native.js
    infer-modules.js
    diff.js
    providers/
      native.js
      understand-anything.js
      codegraph.js
      gitnexus.js
```

In templates:

```text
templates/cli/
  planning.js
  architecture.js
  dashboard-data.js
  inspector.js
```

---

## 8. CLI Commands

### 8.1 Planning commands

```bash
.evo-lite/mem plan status
.evo-lite/mem plan scan
.evo-lite/mem plan progress
.evo-lite/mem plan gaps
.evo-lite/mem plan trace
```

#### `plan status`

Reports whether planning sources exist.

Checks:

```text
docs/specs/
docs/plans/
docs/superpowers/specs/
docs/superpowers/plans/
active_context.md
```

Output:

```json
{
  "status": "partial",
  "sources": {
    "docs/specs": "missing",
    "docs/plans": "present",
    "docs/superpowers/specs": "present",
    "docs/superpowers/plans": "present",
    "active_context": "present"
  },
  "warnings": []
}
```

#### `plan scan`

Parses specs and plans into Planning IR.

Inputs:

```text
docs/specs/**/*.md
docs/plans/**/*.md
docs/superpowers/specs/**/*.md
docs/superpowers/plans/**/*.md
.evo-lite/active_context.md
```

Output:

```text
.evo-lite/generated/planning/plan-ir.json
```

#### `plan progress`

Calculates task status from available evidence.

Evidence sources:

```text
task checkbox
linked files
git status
git commits
archive entries
active_context trajectory
```

Output:

```text
.evo-lite/generated/planning/progress-report.json
```

MVP rule:

```text
Do not mutate source plan files.
Only write generated report.
```

#### `plan gaps`

Detects planning gaps.

Examples:

```text
spec_without_plan
plan_without_task
task_without_file
done_task_without_archive
changed_file_without_task
```

#### `plan trace`

Builds traceability matrix.

Output:

```text
.evo-lite/generated/planning/traceability.json
```

---

### 8.2 Architecture commands

```bash
.evo-lite/mem architecture status
.evo-lite/mem architecture scan
.evo-lite/mem architecture diff
.evo-lite/mem architecture providers
.evo-lite/mem architecture impact
```

#### `architecture status`

Checks:

```text
.agents/rules/architecture.md
docs/architecture/
last architecture scan
available providers
```

#### `architecture scan`

MVP behavior:

```text
Use native scanner only.
Do not require external tools.
Do not use AST parser.
Do not call LLM.
```

Native scan detects:

```text
package.json
bin/
index.js
templates/
templates/cli/
templates/.agents/
.evo-lite/cli/
docs/
docs/superpowers/
AGENTS.md
CLAUDE.md
```

Output:

```text
.evo-lite/generated/architecture/architecture-ir.json
```

#### `architecture diff`

Compares architecture intent and implementation reality.

MVP checks:

```text
architecture.md missing
architecture.md placeholder
docs/architecture missing
detected module not documented
generated architecture data stale
```

Output:

```text
.evo-lite/generated/architecture/drift-report.json
```

---

### 8.3 Dashboard commands

```bash
.evo-lite/mem dashboard build
.evo-lite/mem inspect
```

#### `dashboard build`

Aggregates generated IR and current runtime state.

Inputs:

```text
plan-ir.json
progress-report.json
traceability.json
architecture-ir.json
drift-report.json
active_context.md
verify summary
archive summary
git status
```

Output:

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

#### `inspect`

Starts local dashboard.

MVP behavior:

```text
Read dashboard-data.json if present.
If missing, show command hints.
Do not auto-scan unless user passes explicit option.
```

Optional future flag:

```bash
.evo-lite/mem inspect --refresh
```

---

## 9. Markdown Conventions

### 9.1 Spec file

```markdown
---
id: spec:project-control-dashboard
status: planned
owner: human
created: 2026-06-11
---

# Project Control Dashboard

## Goal

## Non-goals

## Requirements

## Acceptance Criteria

## Linked Plans

- plan:project-control-dashboard-mvp
```

### 9.2 Plan file

```markdown
---
id: plan:project-control-dashboard-mvp
status: in_progress
linkedSpec: spec:project-control-dashboard
created: 2026-06-11
---

# Project Control Dashboard MVP Plan

## Tasks

- [ ] [task:define-planning-ir] Define Planning IR
  - files: docs/contracts/planning-ir.schema.md
  - verify: review schema manually

- [ ] [task:add-plan-scan-command] Add plan scan command
  - files: templates/cli/planning.js, templates/cli/memory.js
  - verify: node .evo-lite/cli/memory.js plan scan
```

### 9.3 Task status

Supported states:

```text
todo
in_progress
implemented
verified
archived
blocked
unknown
```

Checkbox mapping:

```text
[ ] -> todo
[x] -> implemented
```

If frontmatter or inline metadata provides more precise status, it wins over checkbox mapping.

### 9.4 Linked evidence

Supported evidence fields:

```text
files
commits
tests
archives
modules
spec
plan
verify
```

MVP parser supports `files` and `verify`.

---

## 10. Intermediate Representations

### 10.1 Planning IR

File:

```text
.evo-lite/generated/planning/plan-ir.json
```

Schema:

```json
{
  "version": "evo-plan-ir@1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "project": {
    "name": "create-evo-lite",
    "root": "."
  },
  "sources": [],
  "specs": [],
  "plans": [],
  "tasks": [],
  "warnings": []
}
```

Spec object:

```json
{
  "id": "spec:project-control-dashboard",
  "title": "Project Control Dashboard",
  "status": "planned",
  "sourcePath": "docs/specs/project-control-dashboard.md",
  "linkedPlans": ["plan:project-control-dashboard-mvp"],
  "acceptanceCriteria": []
}
```

Task object:

```json
{
  "id": "task:add-plan-scan-command",
  "title": "Add plan scan command",
  "status": "todo",
  "sourcePath": "docs/plans/project-control-dashboard-mvp.md",
  "linkedSpec": "spec:project-control-dashboard",
  "linkedPlan": "plan:project-control-dashboard-mvp",
  "linkedFiles": [
    "templates/cli/planning.js",
    "templates/cli/memory.js"
  ],
  "verify": [
    "node .evo-lite/cli/memory.js plan scan"
  ],
  "evidence": [],
  "confidence": 1.0
}
```

---

### 10.2 Architecture IR

File:

```text
.evo-lite/generated/architecture/architecture-ir.json
```

Schema:

```json
{
  "version": "evo-arch-ir@1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "project": {
    "name": "create-evo-lite",
    "root": "."
  },
  "providers": [],
  "modules": [],
  "files": [],
  "edges": [],
  "flows": [],
  "dataModels": [],
  "warnings": []
}
```

Module object:

```json
{
  "id": "module:inspector",
  "name": "Inspector",
  "kind": "runtime-ui",
  "description": "Local read-only dashboard server",
  "paths": [
    "templates/cli/inspector.js",
    ".evo-lite/cli/inspector.js"
  ],
  "source": "native",
  "confidence": 0.8
}
```

Edge object:

```json
{
  "id": "edge:memory-cli-to-inspector",
  "from": "module:memory-cli",
  "to": "module:inspector",
  "type": "invokes",
  "source": "native",
  "confidence": 0.7
}
```

---

### 10.3 Drift Report

File:

```text
.evo-lite/generated/architecture/drift-report.json
```

Schema:

```json
{
  "version": "evo-drift@1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "summary": {
    "critical": 0,
    "warning": 0,
    "info": 0
  },
  "items": []
}
```

Drift item:

```json
{
  "id": "drift:task-without-file",
  "type": "plan",
  "severity": "warning",
  "title": "Task has no linked file evidence",
  "message": "Task task:add-plan-scan-command has no linked files.",
  "evidence": [
    {
      "path": "docs/plans/project-control-dashboard-mvp.md",
      "line": null
    }
  ],
  "suggestedAction": "Add linked files to the task or mark it as planning-only."
}
```

---

### 10.4 Dashboard Data

File:

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Schema:

```json
{
  "version": "evo-dashboard@1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "overview": {},
  "planning": {},
  "architecture": {},
  "drift": {},
  "memory": {},
  "verify": {}
}
```

---

## 11. Dashboard UX

### 11.1 MVP tabs

```text
Overview
Plan
Architecture
Drift
Memory
Verify
```

### 11.2 Post-MVP tabs

```text
Progress
Traceability
Impact
Code Map
Providers
```

### 11.3 Overview tab

Shows:

```text
Project name
Current focus
Planning status
Architecture status
Open tasks
Open drift
Last plan scan
Last architecture scan
Generated data freshness
```

### 11.4 Plan tab

Shows:

```text
Specs
Plans
Tasks
Task status
Linked files
Verification command
Evidence status
```

### 11.5 Architecture tab

Shows:

```text
Detected modules
Module paths
Module confidence
Provider source
Architecture docs status
```

### 11.6 Drift tab

Shows:

```text
Severity
Type
Title
Evidence
Suggested action
```

### 11.7 Memory tab

Reuses existing inspector information.

Shows:

```text
active_context
trajectory
archive files
index status
```

### 11.8 Verify tab

Reuses existing verify output and adds dashboard health.

Shows:

```text
active context health
archive health
plan scan status
architecture scan status
drift count
generated data freshness
```

---

## 12. MVP Scope

### 12.1 Included

MVP includes:

```text
1. Dogfood spec and MVP plan documents
2. Planning IR schema
3. Architecture IR schema
4. Drift Report schema
5. plan status
6. plan scan
7. native architecture status
8. native architecture scan
9. drift report MVP
10. dashboard build
11. inspector read-only tabs
```

### 12.2 Excluded

MVP excludes:

```text
1. MCP server
2. CodeGraph provider
3. GitNexus provider
4. Understand-Anything provider
5. GitHub Issues provider
6. PR review integration
7. automatic plan mutation
8. task editing UI
9. force-directed graph visualization
10. dynamic Mermaid rendering
11. AST-level parsing
12. LLM-based inference
13. CI enforcement
```

---

## 13. Dogfood Implementation Plan

### Phase 0: Dogfood documents

Create:

```text
docs/specs/project-control-dashboard.md
docs/plans/project-control-dashboard-mvp.md
docs/architecture/project-control-dashboard.md
```

Acceptance:

```text
A human can read the documents and understand the MVP.
An agent can identify spec id, plan id, task ids, linked files, and verification commands.
```

---

### Phase 1: Planning scanner

Implement:

```text
templates/cli/planning.js
templates/cli/planning/parse-markdown.js
templates/cli/planning/scan.js
```

Wire into:

```text
templates/cli/memory.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js plan scan
```

Generates:

```text
.evo-lite/generated/planning/plan-ir.json
```

Dogfood validation:

```text
The generated plan-ir contains this dashboard's own spec, plan, and tasks.
```

---

### Phase 2: Inspector Plan tab

Extend inspector.

Acceptance:

```bash
node .evo-lite/cli/memory.js inspect
```

Dashboard shows:

```text
Project Control Dashboard spec
MVP plan
Task list
Task statuses
Linked files
```

---

### Phase 3: Native architecture scanner

Implement:

```text
templates/cli/architecture.js
templates/cli/architecture/scan-native.js
templates/cli/architecture/infer-modules.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js architecture scan
```

Generates:

```text
.evo-lite/generated/architecture/architecture-ir.json
```

Dogfood validation:

```text
The scanner identifies:
- CLI/runtime area
- memory service area
- inspector area
- template area
- agents workflow area
- docs/superpowers planning area
```

---

### Phase 4: Drift MVP

Implement:

```text
templates/cli/architecture/diff.js
templates/cli/planning/gaps.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js architecture diff
node .evo-lite/cli/memory.js plan gaps
```

Produces:

```text
.evo-lite/generated/architecture/drift-report.json
```

---

### Phase 5: Dashboard build

Implement:

```text
templates/cli/dashboard-data.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js dashboard build
```

Produces:

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Inspector reads this file instead of re-running scan logic directly.

---

## 14. Drift Rules MVP

### R001: Architecture rule file missing

Severity: warning
Type: architecture

Condition:

```text
.agents/rules/architecture.md does not exist
```

### R002: Architecture rule file placeholder

Severity: warning
Type: architecture

Condition:

```text
architecture.md contains initialization placeholders
```

### R003: Specs directory missing

Severity: info
Type: plan

Condition:

```text
docs/specs and docs/superpowers/specs are both missing
```

### R004: Plans directory missing

Severity: info
Type: plan

Condition:

```text
docs/plans and docs/superpowers/plans are both missing
```

### R005: Task without linked file

Severity: warning
Type: plan

Condition:

```text
task has no linkedFiles and status is not planning-only
```

### R006: Changed file without linked task

Severity: warning
Type: plan

Condition:

```text
git changed file does not appear in any task linkedFiles
```

### R007: Detected module not documented

Severity: info
Type: architecture

Condition:

```text
native scanner detects module, but docs/architecture/modules.md does not mention it
```

### R008: Done task without archive evidence

Severity: warning
Type: closure

Condition:

```text
task status is implemented or verified, but no archive evidence is found
```

### R009: Generated data stale

Severity: info
Type: freshness

Condition:

```text
generated IR older than last modified source file
```

### R010: Active backlog not reflected in plan

Severity: info
Type: planning

Condition:

```text
active_context backlog contains task-like entries that do not appear in Planning IR
```

---

## 15. Verify Integration

Existing `verify` must not become slow.

MVP behavior:

```text
verify checks whether generated files exist and whether they are stale.
verify does not run scan automatically.
verify reports summary only.
```

New verify fields:

```json
{
  "project_control": {
    "planning": {
      "planIrExists": true,
      "stale": false,
      "taskCount": 12
    },
    "architecture": {
      "architectureIrExists": true,
      "stale": false,
      "moduleCount": 8
    },
    "drift": {
      "critical": 0,
      "warning": 3,
      "info": 5
    }
  }
}
```

---

## 16. Security and Privacy Requirements

The dashboard must:

```text
1. Bind only to 127.0.0.1 by default.
2. Reject non-loopback requests.
3. Avoid external CDN dependencies in MVP.
4. Avoid telemetry.
5. Avoid uploading source code.
6. Avoid executing arbitrary commands from parsed Markdown.
7. Treat verify commands in Markdown as text, not executable instructions.
8. Escape HTML output.
9. Avoid exposing secret file contents.
10. Keep generated reports local.
```

---

## 17. Performance Requirements

MVP target:

```text
Small project under 1,000 files:
plan scan < 1 second
native architecture scan < 3 seconds
dashboard build < 1 second
inspector load < 1 second after data exists
```

Scanning rules:

```text
Skip node_modules
Skip .git
Skip dist
Skip build
Skip coverage
Skip .next
Skip .turbo
Skip vendor unless configured
```

File size limit:

```text
Do not parse Markdown or source files larger than 1 MB in MVP.
Report skipped files as warnings.
```

---

## 18. Testing Strategy

### 18.1 Unit fixtures

Add fixtures:

```text
fixtures/project-control/simple-plans/
fixtures/project-control/superpowers-layout/
fixtures/project-control/no-plan/
fixtures/project-control/with-drift/
fixtures/project-control/simple-node-cli/
```

Each fixture contains:

```text
input files
expected plan-ir
expected architecture-ir
expected drift-report
```

### 18.2 Dogfood tests

Run scanners on `create-evo-lite` itself.

Expected:

```text
plan scan detects project-control-dashboard plan
architecture scan detects Evo-Lite runtime modules
drift report produces no critical errors
dashboard build succeeds
```

### 18.3 Regression tests

Commands:

```bash
node templates/cli/planning.js scan --root fixtures/project-control/simple-plans
node templates/cli/architecture.js scan --root fixtures/project-control/simple-node-cli
```

If the project already has a test harness, integrate into that harness later.

---

## 19. Acceptance Criteria

### AC1: Dogfood plan exists

The repository contains a production-ready spec and MVP plan for Project Control Dashboard.

### AC2: Plan scan works

Running:

```bash
node .evo-lite/cli/memory.js plan scan
```

generates:

```text
.evo-lite/generated/planning/plan-ir.json
```

The file contains at least:

```text
1 spec
1 plan
5 tasks
linked file data where available
```

### AC3: Inspector shows plan

Running:

```bash
node .evo-lite/cli/memory.js inspect
```

shows a Plan tab containing the dogfood MVP plan.

### AC4: Architecture scan works

Running:

```bash
node .evo-lite/cli/memory.js architecture scan
```

generates:

```text
.evo-lite/generated/architecture/architecture-ir.json
```

The file contains detected modules for:

```text
CLI
memory service
inspector
templates
agents workflows
docs/planning
```

### AC5: Drift report works

Running:

```bash
node .evo-lite/cli/memory.js architecture diff
```

generates:

```text
.evo-lite/generated/architecture/drift-report.json
```

The report contains structured drift items with:

```text
id
type
severity
title
message
evidence
suggestedAction
```

### AC6: Dashboard data works

Running:

```bash
node .evo-lite/cli/memory.js dashboard build
```

generates:

```text
.evo-lite/generated/dashboard/dashboard-data.json
```

Inspector can load this data.

### AC7: No external dependency required

MVP works without:

```text
CodeGraph
GitNexus
Understand-Anything
MCP server
Internet access
external CDN
```

### AC8: Existing inspector behavior preserved

Existing inspector views must continue to work:

```text
active context
archive
index spaces
verify
```

### AC9: Read-only guarantee

MVP dashboard must not mutate:

```text
docs/
.agents/
.evo-lite/active_context.md
.evo-lite/raw_memory/
source code
```

---

## 20. Implementation Issues

### Issue 1: Add dogfood spec and MVP plan

Files:

```text
docs/specs/project-control-dashboard.md
docs/plans/project-control-dashboard-mvp.md
```

Acceptance:

```text
Documents follow Markdown conventions.
Tasks include ids, linked files, and verification text.
```

---

### Issue 2: Add Planning IR schema

Files:

```text
docs/contracts/planning-ir.schema.md
```

Acceptance:

```text
Schema documents specs, plans, tasks, evidence, confidence, warnings.
```

---

### Issue 3: Add plan command skeleton

Files:

```text
templates/cli/planning.js
templates/cli/memory.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js plan status
node .evo-lite/cli/memory.js plan scan
```

Both commands execute without crashing.

---

### Issue 4: Add Markdown planning parser

Files:

```text
templates/cli/planning/parse-markdown.js
templates/cli/planning/scan.js
```

Acceptance:

```text
Parses frontmatter.
Parses H1 title.
Parses checkbox tasks.
Parses [task:id] notation.
Parses linked files.
Parses verify lines.
```

---

### Issue 5: Add Plan tab to inspector

Files:

```text
templates/cli/inspector.js
```

Acceptance:

```text
Inspector displays specs, plans, and tasks.
Missing generated data shows helpful command hints.
```

---

### Issue 6: Add Architecture IR schema

Files:

```text
docs/contracts/architecture-ir.schema.md
```

Acceptance:

```text
Schema documents modules, files, edges, flows, providers, confidence.
```

---

### Issue 7: Add native architecture scanner

Files:

```text
templates/cli/architecture.js
templates/cli/architecture/scan-native.js
templates/cli/architecture/infer-modules.js
templates/cli/memory.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js architecture scan
```

Generates Architecture IR.

---

### Issue 8: Add drift report MVP

Files:

```text
templates/cli/architecture/diff.js
templates/cli/planning/gaps.js
docs/contracts/drift-report.schema.md
```

Acceptance:

```text
Detects R001-R010 where applicable.
Writes drift-report.json.
```

---

### Issue 9: Add dashboard data builder

Files:

```text
templates/cli/dashboard-data.js
templates/cli/memory.js
```

Acceptance:

```bash
node .evo-lite/cli/memory.js dashboard build
```

Generates dashboard-data.json.

---

### Issue 10: Extend verify summary

Files:

```text
templates/cli/memory.service.js
```

Acceptance:

```text
verify reports project_control status without running expensive scans.
```

---

## 21. Rollout Plan

### Stage 0: Documentation-only

Create spec, plan, schemas, and conventions.

No runtime behavior change.

### Stage 1: Planning dogfood

Implement plan scan and Plan tab.

Validate against this project.

### Stage 2: Architecture dogfood

Implement native architecture scan and Architecture tab.

Validate against this project.

### Stage 3: Drift MVP

Implement rule-based drift report.

Validate using intentional dogfood gaps.

### Stage 4: Dashboard consolidation

Add dashboard build and unified data file.

### Stage 5: External provider research

Only after MVP stabilizes, evaluate:

```text
Understand-Anything importer
CodeGraph provider
GitNexus provider
GitHub Issues provider
MCP server
```

---

## 22. Open Questions

### OQ1: Should generated IR be committed?

Default answer:

```text
No.
```

Possible exception:

```text
Commit dashboard snapshots for release artifacts.
```

### OQ2: Should plan scan auto-update task status?

Default answer:

```text
No.
```

It should generate suggested status only.

### OQ3: Should verify block commits on drift?

MVP answer:

```text
No.
```

Future answer:

```text
Only critical drift may block, and only after explicit configuration.
```

### OQ4: Should the dashboard render Mermaid?

MVP answer:

```text
No.
```

Future answer:

```text
Export Mermaid as optional text artifact.
```

### OQ5: Should external providers be installed by Evo-Lite?

Default answer:

```text
No.
```

Evo-Lite may detect them and import their output, but should not own their installation.

---

## 23. Production Readiness Criteria

The feature is production-ready when:

```text
1. It can run on create-evo-lite itself.
2. It does not require external services.
3. It does not mutate canonical project documents from the dashboard.
4. It produces stable IR files.
5. It preserves existing Evo-Lite inspector behavior.
6. It detects at least the MVP drift rules.
7. It has fixture tests for markdown parsing and native scanning.
8. It has dogfood evidence in active_context/archive.
9. It documents all commands and generated files.
10. It has a clear migration path for existing Evo-Lite projects.
```

---

## 24. Success Metric

The feature succeeds if a human can open the local inspector and answer these questions within one minute:

```text
What is the current project goal?
Which spec and plan are active?
Which tasks are planned, active, or done?
Which files are expected to change?
Which modules exist in the current codebase?
Which planned items lack implementation evidence?
Which code changes lack plan evidence?
Which architecture or planning drift items need attention?
What should the AI agent read before continuing?
```

---

## 25. Final Product Statement

Evo-Lite Project Control Dashboard turns Evo-Lite from a memory/workflow runtime into a project-local AI development control system.

It connects:

```text
Intent
Plan
Architecture
Code
Evidence
Archive
```

Its first mission is not to manage every project.

Its first mission is to help Evo-Lite manage itself.
