# Changelog

All notable changes to this project will be documented in this file.

## [1.4.2] - 2026-03-08
### Added
- **Diagnostic Verbosity**: Added detailed response reporting for Reranker health checks in `verify` command to help diagnose LM Studio configuration issues.
- **Robustness Patch**: Hardened the check for Rereanker success to ignore "200 OK" responses that return error messages in the body (common in LM Studio misconfigurations).

## [1.4.2] - 2026-03-08

### Fixed
- **Reranker Compatibility**: Fixed a critical bug where Reranker results failed to parse due to LM Studio's unexpected API behavior ("Fake 200").
- **Robust Error Handling**: Added deep body verification to health checks in `index.js` and `memory.js` to detect and diagnose provider-side endpoint limitations.
- **Result Support**: Support for multiple Reranker response formats (`.results`, `.data.results`, or raw arrays).

## [1.4.1] - 2026-03-08
### Added
- **Global Version Sync**: Unified project and sandbox versions to 1.4.1 for cleaner releases.
- **Workflow Optimization**: Refined `/mem` protocol to include mandatory small version bump step for consistent versioning.
- **Health Check Robustness**: Fixed Reranker probe payload structure in `index.js` and added detailed error logging in `memory.js` verify command to help diagnose "Offline" false positives.
- **Wording Alignment**: Updated status messages to use cleaner "向量模型" and "精排模型" terminology.

### Changed
- **Antigravity-Native Prompts**: Optimized initialization messages in `index.js` to prioritize IDE-based slash command workflows.
- **Dual-Pass Health Check**: Enhanced `verify` command to perform real-time activity probing for both Embedding and Reranker models via POST requests.

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
