---
id: plan:evo-lite-providers-mvp
status: done
linkedSpec: spec:evo-lite-providers
created: 2026-06-15
r008Exempt: true
---

# Evo-Lite Provider Interface — MVP Plan

## Goal

Add a stable, opt-in provider interface to the architecture scanner so that external tools (GitNexus, GitHub Issues) can enrich architecture IR and planning IR without changing core scanner logic.

## MVP Scope

Included:

```text
1. Provider contract (interface definition + JSDoc)
2. .evo-lite/config.json loading and validation
3. Provider loader with check() guard and error isolation
4. GitNexus provider (MCP-based, available when MCP active)
5. GitHub Issues provider (GH_TOKEN + gh CLI required)
6. Dogfood validation for both providers
```

Excluded from MVP:

```text
- LLM-based inference providers
- Understand-Anything provider
- CodeGraph provider (no MCP available in this project)
- Provider hot-reload or file watching
- Provider versioning or compatibility checks
- UI for provider status in inspector (future)
```

## Tasks

### Phase 0: Dogfood documents

- [x] [task:add-providers-spec] Create spec file at docs/specs/
  - files: docs/specs/evo-lite-providers.md
  - verify: human review — spec is parseable and contains id, goal, non-goals, requirements, acceptance criteria
  - evidence: git:6581bbc

### Phase 1: Provider infrastructure

- [x] [task:add-provider-contract] Define provider contract module with JSDoc interface
  - files: templates/cli/architecture/provider-contract.js
  - verify: node -e "const c = require('./templates/cli/architecture/provider-contract'); console.log(c.PROVIDER_INTERFACE)"
  - acceptance: exports PROVIDER_INTERFACE spec and validateProvider() checker
  - evidence: git:9b1f3e3

- [x] [task:add-provider-config] Implement .evo-lite/config.json loading in runtime.js
  - files: templates/cli/runtime.js
  - verify: node -e "const r = require('./.evo-lite/cli/runtime'); console.log(r.getEvoConfig())"
  - acceptance: returns parsed config or empty defaults when file absent; no error thrown
  - evidence: git:9b1f3e3

- [x] [task:add-provider-loader] Implement provider loader in scan-native.js
  - files: templates/cli/architecture/scan-native.js
  - verify: mem architecture scan with no providers config → same output as before
  - acceptance: absent config.json → native-only; bad provider check() → warning + skip; scan() throw → warning + skip
  - evidence: git:9b1f3e3

### Phase 2: GitNexus provider

- [x] [task:add-gitnexus-provider] Implement GitNexus provider module
  - files: templates/cli/architecture/providers/gitnexus.js
  - verify: node -e "const p = require('./templates/cli/architecture/providers/gitnexus'); console.log(p.check())"
  - acceptance: check() returns false when GitNexus MCP not active (no crash); when active, scan() returns module enrichment with higher confidence
  - evidence: git:0aa4336

- [x] [task:validate-gitnexus-dogfood] Validate GitNexus provider against create-evo-lite index
  - files: .evo-lite/generated/architecture/architecture-ir.json
  - verify: mem architecture scan with gitnexus provider active → modules show elevated confidence
  - acceptance: at least one module has confidence > 0.8 from GitNexus; no provider errors logged
  - evidence: git:0aa4336

### Phase 3: GitHub Issues provider

- [x] [task:add-github-issues-provider] Implement GitHub Issues provider module
  - files: templates/cli/architecture/providers/github-issues.js, templates/cli/planning/scan.js
  - verify: node -e "const p = require('./templates/cli/architecture/providers/github-issues'); console.log(p.check())"
  - acceptance: check() returns false when GH_TOKEN unset or gh CLI absent; when available, enriches Planning IR tasks with issueRefs array
  - evidence: git:38d707f

- [x] [task:validate-github-dogfood] Validate GitHub Issues provider with real GH_TOKEN
  - files: .evo-lite/generated/planning/plan-ir.json
  - verify: mem plan scan with github-issues provider active → tasks with issue refs show issueRefs field
  - verify: see issue:#2 (uwence/create-evo-lite) for integration test tracking
  - acceptance: at least one task gains issueRefs; no provider errors logged
  - evidence: git:38d707f

## Rollout Stages

```text
Stage 0: Spec only
Stage 1: Provider infrastructure (contract + config + loader)
Stage 2: GitNexus provider working
Stage 3: GitHub Issues provider working
Stage 4: Both providers dogfood validated
```

## Acceptance Criteria

- Native scanner unchanged when no config.json exists
- Provider errors are isolated — never fail the whole scan
- GitNexus provider enriches architecture IR when MCP active
- GitHub Issues provider enriches planning IR when GH_TOKEN available
- Both providers declared in .evo-lite/config.json sample
