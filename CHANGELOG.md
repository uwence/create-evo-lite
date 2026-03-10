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
