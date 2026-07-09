## 2.3.0 - 2026-07-09

### Added
- Managed zvec opt-in decision guide gene (`.agents/rules/zvec-optin.md`):
  when a child should enable, verify (no-WARN + stable record count +
  `mem memory-ab` A/B), or roll back the optional Zvec memory engine.
  First gene sourced from the live child feedback outbox (CodePLC).
- Hive child feedback loop (`spec:hive-child-feedback-loop`): child outbox
  `.evo-lite/hive/feedback.md` is collected exactly-once by `hive nurture`
  (read-only surfaced in `hive status`); new managed genes rule
  `.agents/rules/hive-feedback.md` documents the protocol for child agents;
  the outbox is scaffolded at init and on first nurture.
- Nurture mutation preflight: committed child edits to non-anchored managed
  genes (detected against `runtime-mirror.lock.json` checksums) are now
  `refused` with a 🧬 mutation report instead of silently overwritten;
  `--force` is the explicit overwrite. Lockless legacy children WARN and
  proceed. Line-ending-only drift (git autocrlf worktrees) is exempt.

### Fixed
- Timestamped nurture rollback tags (`evo-nurture-pre-<v>-<stamp>`): a
  same-version re-nurture now mints a fresh rollback point instead of
  colliding with the stale first tag.
- CLI top-level errors print to stdout (host wrappers that swallow stderr
  surfaced refusals as "no output"); dirty-worktree track refusal message
  is now actionable.
- Engine degradation WARN gives the concrete 3-step zvec enable path
  (install dep, remove pin, rebuild) alongside the sqlite pin option.
- Fresh scaffolds no longer double-copy `.agents/rules` (whole-dir copy +
  manifest copy), which minted `.bak` files and falsely injected the
  hot-update warning into brand-new projects; rules are now split into
  sync-always genes vs copy-on-init seeds and flow through the managed
  manifest only.

## 2.2.0 - 2026-07-06

### Security
- Closed an evidence `commitSha` shell-injection path: `git diff` is now invoked
  in argv form (never through a shell), gated by a strict OID-format check, so
  a hostile `commitSha` can no longer reach a shell.
- `readEvidence` now validates the evidence store's shape and every individual
  record. A malformed evidence file fails closed (throws) instead of silently
  reading as "no evidence" and flipping a real FAIL into UNVERIFIED; an invalid
  record is excluded with a loud warning instead of passing through unchecked.
- Verifier path resolution (`resolveWithin`) is now symlink-aware: containment
  is re-checked via `realpath` after the existing string-prefix check, closing
  an escape where a symlink inside the repo pointed at a file outside it.
- Removed the declared-but-dead `cwd` parameter from the command-verifier
  schema (an attack surface with no real behavior behind it); `scope` is now
  documented as informational-only.

### Added
- Mother-child hive (`mem hive register|status|nurture`): register a child
  evo-lite project into a mother's registry, compare each child's gene/version
  drift against the mother (up-to-date / behind / drifted / unreachable), and
  push the mother's managed governance files into a child.
- `nurture` and `mem close --apply` now share one transaction module
  (snapshot → journal → apply, with automatic rollback on failure), making
  both operations atomic.
- Verification-contract command policy: a default-deny allowlist trust
  boundary for machine verifiers (P1-8), enforced on the run/engine path.
- `mem verify-contract lint|run|status|attest`: validate a spec's
  machine-readable acceptance-criteria block, run its machine verifiers and
  write commit-bound evidence, show live four-state verdicts per criterion,
  and record manual attestations for human-judged criteria.
- `mem close --preview|--apply`: preview a spec's closure readiness, or
  atomically apply it (flip plan checkboxes, mark status done, backfill
  missing evidence).
- R013 `active-context-remote-drift` rule: flags a stale `active_context.md`
  META block against live git state. `context track` now refreshes structured
  META git fields (`headSha`/`upstreamSha`/`ahead`/`behind`/`focusUpdatedAt`)
  so the recorded state stops drifting from reality.

### Changed
- Hive now reads a child's product version from `evo-lite-version.json`
  instead of the child's pinned runtime `package.json`; `package.json` is
  used only as a documented legacy fallback for children scaffolded before
  the version file existed.
- `nurture` writes the pushed version into the child's
  `evo-lite-version.json` and never mutates the child's pinned runtime
  manifest version.

## 2.1.0 - 2026-06-30

### Fixed
- Restored missing CLI protocol-layer commands and behaviors across the memory runtime, including `export`, `import`, `archive`, `sync`, `vectorize`, and `context add/focus/track --resolve`.
- Fixed `context add` / `context focus` argument parsing so subcommand names are no longer written into state by mistake.
- Fixed `verify` so template drift is treated as a real alert instead of still ending with a clean-health message.
- Fixed false drift reports for dynamically patched `models.js` by normalizing template comparisons.
- Fixed `sync` so malformed raw archives are no longer silently marked as vectorized.
- Fixed rebuild guidance when `raw_memory` survives but `chunks` are empty: `verify` now points to a real recovery command.
- Fixed stale dogfooding guidance that still described obsolete manual recovery steps.
- Fixed `mem commit` when invoked through the generated `mem` wrappers so pre-command injected Git hash/status no longer poison the post-commit `context track` and runtime-state snapshot stages.
- Fixed `mem commit --json` so nested remember/archive hints no longer pollute machine-readable output during programmatic consumption on Windows PowerShell.

### Changed
- Formalized the primary durable memory flow as:
  `active_context -> context track -> archive`
- Clarified the role split between:
  - `active_context.md` as live state
  - `track/archive` as durable structured knowledge
  - `remember` as lightweight searchable cache
- Introduced `rebuild` as the standard user-facing recovery entry point.
- Kept `wash` as the workflow/compatibility entry and `vectorize` as the lower-level rebuild implementation path.
- Improved `track` CLI output so closure state is easier for both humans and agents to interpret.
- Improved `verify` output with explicit next-step guidance instead of only listing alerts.
- Improved `rebuild` output with a clearer summary of rebuilt archives, chunks, backup file, and follow-up action.
- Replaced the hand-maintained template sync/init copy lists with a shared managed template manifest, bringing `.agents/workflows/*` governance assets into the same managed family model.
- Expanded recall-first takeover matching from a single dogfood-shaped memory hit into alias tables plus rule-based hit summarization.
- Added an explicit `mem commit` fast path that sequences the code snapshot, `context track`, and runtime-state snapshot behind one command surface while preserving separate Git commits for code and runtime state.
- Refined `/evo` so the expected first response now includes:
  - takeover status
  - current focus
  - current risks
  - most actionable next step
- Added a beginner-friendly “first session” onboarding flow to both README files.

### Added
- Added structured `track()` status reporting for archive write state, context update state, and backlog resolution state.
- Added recovery-path tests for the “raw_memory preserved, chunks empty” scenario.
- Added test coverage for invalid raw archives, template sync drift, dynamic model normalization, and clearer health-check messaging.
- Added `docs/REMEMBER_BOUNDARY_DECISION.md` to formally document the long-term boundary of `remember`.
- Added shared `template-manifest.js` and `recall-rules.js` modules to both the template runtime and the live dogfooding mirror.
- Added regression coverage for the `mem commit` fast path, including staged-only guards and wrapper-injected Git state.
- Added regression coverage that `mem commit --json` stays directly parseable instead of being prefixed by human-facing remember logs.

### Docs
- Updated workflow, rule, and README docs to align with actual runtime behavior.
- Replaced outdated rebuild guidance with the new `rebuild` entry point.
- Clarified that `remember` does not provide the same rebuild guarantees as structured archive paths.
- Updated dogfooding walkthrough assets so historical notes no longer present obsolete recovery steps as current guidance.
- Documented the explicit `mem commit` fast path across `/commit` workflow docs, README usage guides, and host adapter entrypoints.

### Notes
- The runtime and dogfooding mirrors are kept in sync.
- Current recovery guidance should prefer:
  `node .evo-lite/cli/memory.js rebuild`
- `remember` remains intentionally lightweight unless future usability evidence justifies a dual-write promotion mode.

## 2.0.10

### Fixed
- **Deterministic runtime install**: the scaffolded `.evo-lite/` now ships a
  pinned `package.json` + `package-lock.json` and installs with `npm ci` instead
  of bare `npm install`, so a given `create-evo-lite` version always restores the
  same runtime dependency tree. Supersedes the ad-hoc install path.
- **rc2 — `--skip-install`/`--offline` recovery**: a skipped install now still
  copies the runtime manifest + lockfile, so the documented `cd .evo-lite && npm ci`
  recovery actually works (previously left an empty `.evo-lite/`).
- **rc2 — MCP version reporting**: the scaffold now writes `evo-lite-version.json`
  and the runtime reports the product version, fixing MCP servers advertising the
  pinned manifest `1.0.0` instead of the real version.
- **rc2 — version metadata consistency**: the root `package-lock.json` tracks
  `package.json` (was left at `2.0.9`), guarded by a test.
- **rc2 — test coverage gap**: `npm test` now runs the governance suite as well as
  the integration suite (scope `all` previously ran integration only), so the
  guards above actually execute in CI.

### Added
- **Node 24 in the release gate**: the pack-and-consume CI matrix now covers
  Node 24 alongside 20 (Linux) and 22, on Linux and Windows.

## [1.4.9] - 2026-03-11
### Fixed
- **Silent Mode Auto-Migration**: Fixed an issue where the `--yes` (silent mode) flag would skip the cross-model data migration check. Version 1.4.9 now automatically triggers the migration pipeline if an old database is detected during a silent initialization.

## [1.4.8] - 2026-03-10
### Added
- **Offline Embedding Model**: Bundled `bge-small-zh-v1.5` quantized ONNX model (~15MB) as `templates/embedding-model.tar.gz`. New projects now get pre-cached model files, enabling `remember` and `recall` to work even with zero network access.
- **Cross-Model Migration**: Implemented a full automatic migration pipeline in `index.js`. When upgrading from old LM Studio-based projects, the initializer now exports old memories, destroys the incompatible DB, and re-embeds everything with the new ONNX engine in one seamless flow.

### Fixed
- **Execution Order Bug**: Fixed a critical timing issue where the data washing script (`memory.js export`) was called before `npm install` had installed its dependencies, causing `MODULE_NOT_FOUND` crashes.
- **Fingerprint Deadlock**: `export` and `import` commands now bypass the model fingerprint check, allowing cross-model data extraction and migration without fatal errors.
- **Import Guard Bypass**: All quality validators (length check, format check, capacity lock) are now skipped during `import` operations to prevent old memories from being rejected by new rules.

### Changed
- **Zero-Config Init**: Removed the interactive model selection wizard. Since Evo-Lite now uses built-in ONNX models, the setup is fully automatic for new projects. The only prompt that remains is the data washing confirmation for existing projects with a `memory.db`.

## [1.4.7] - 2026-03-10
### Changed
- **Capacity Expansion**: Increased the `memory.js` capacity lock threshold from 15 to 30 to better utilize the performance of the new ONNX pipeline.
- **Agent Directives Reinforcement**: Upgraded `.agents/rules/evo-lite.md` with stricter constraints on YAGNI (forcing function reuse), enforced Atomic Commits, and added explicit Windows Terminal syntax defenses.

## [1.4.6] - 2026-03-10
### Added
- **Serverless AI Engine**: Completely decoupled from LM Studio. Integrated `@xenova/transformers` for a pure Node.js in-process ONNX Runtime.
- **In-Tree ONNX Models**: Switched to `Xenova/bge-small-zh-v1.5` for 512-dim Embeddings and `Xenova/bge-reranker-base` for Cross-Encoder re-ranking directly within the CLI, effectively making Evo-Lite a 100% standalone, daemonless memory solution without requiring any external AI server.

## [1.4.3] - 2026-03-08
### Fixed
- **Workflow Compliance**: Strengthened the `/mem` SOP with "MUST" constraints for task list updates and internal version synchronization.

## [1.4.2] - 2026-03-08
### Fixed
- **Antigravity-Native Prompts**: Optimized initialization messages in `index.js` to prioritize IDE-based slash command workflows.
- **Dual-Pass Health Check**: Enhanced `verify` command to perform real-time activity probing for both Embedding and Reranker models via POST requests.
- **Workflow Optimization**: Refined `/mem` protocol to include mandatory small version bump step for consistent versioning.
- **Terminal Constraints**: Added specific rules to block redundant terminal-based file exploration (like `dir /s /b`) in Antigravity environments.

## [1.4.1] - 2026-03-08
### Added
- **Global Version Sync**: Unified project and sandbox versions to 1.4.1 for cleaner releases.

## [1.4.0] - 2026-03-08
### Added
- **Rule-Based Governance Framework**: Lowered governance protocols from documentation (`ACTIVATE_EVO_LITE.md`) to persistent system rules (`.agents/rules/`). AI agents are now constrained by `evo-lite.md` boot sequence and `project-archive.md` lifecycle closure.
- **Silent Initialization Mode**: Added `--yes` / `-y` flag to `index.js` for automated, non-interactive setup in CI/CD or agentic environments.
- **Data Washing Protocol**: Introduced the `/wash` workflow and supporting template for proactive restructuring of historical legacy memory data.
- **Fallback Dependency System**: Implemented an automated `tar`-based fallback to inject pre-compiled `better-sqlite3` and `sqlite-vec` binaries if `npm install` fails.

### Changed
- **Config-Aware Upgrades**: The initializer now automatically sniffs and extracts `LM_STUDIO_URL` and model names from previous installations to perform truly seamless hot-updates.
- **POST-Based Active Probing**: Upgraded model health checks to use real POST payloads, ensuring the model stack is fully loaded and ready for inference, not just the port listening.
- **Integrated Handover Loop**: Refactored the archival process to strictly enforce Git commit traceability as a hard requirement for memory distillation.

## [1.3.30] - 2026-03-05
... (keeping the rest)
