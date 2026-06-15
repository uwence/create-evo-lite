# Module Boundaries — create-evo-lite

Canonical module definitions for the native architecture scanner (evo-arch-ir@1 provider: native).

## Modules

| ID | Role | Entry paths | Description |
|----|------|-------------|-------------|
| `cli-entry` | cli | `templates/cli/memory.js`, `index.js` | CLI entrypoint; command registration and bootstrap |
| `memory-service` | service | `templates/cli/memory.service.js` | Core memory operations: archive, track, recall, verify |
| `inspector` | ui | `templates/cli/inspector.js` | Read-only HTTP inspector UI (127.0.0.1 only) |
| `planning` | feature | `templates/cli/planning.js`, `templates/cli/planning/` | Planning IR scanner and drift checks (R003–R010) |
| `architecture` | feature | `templates/cli/architecture.js`, `templates/cli/architecture/` | Architecture IR scanner and drift checks (R001, R002, R007) |
| `dashboard` | feature | `templates/cli/dashboard-data.js` | Dashboard data aggregator (plan + arch + drift → dashboard-data.json) |
| `runtime` | runtime | `templates/cli/runtime.js` | Path resolution, workspace root, environment helpers |
| `agents-workflow` | workflow | `.agents/rules/`, `.agents/workflows/` | Evo-Lite governance rules and workflow definitions |
| `docs-planning` | docs | `docs/specs/`, `docs/plans/`, `docs/contracts/` | Planning artifacts: specs, plans, schemas |

## Boundary rules

- `cli-entry` may call any module; no other module calls `cli-entry`.
- `inspector` is stateless and read-only; it must not write to `raw_memory/` or `index_memory/`.
- `planning` and `architecture` scanners must not write to disk (in-memory scan only when called from inspector).
- `dashboard` aggregates by reading generated IRs; it must not re-run scans.
- `runtime` has no dependencies on other project modules.
- `memory-service` owns all DB and archive I/O; other modules route through it or read generated JSON.
