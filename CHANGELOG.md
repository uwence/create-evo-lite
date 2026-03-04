# Changelog

All notable changes to this project will be documented in this file.
## [1.3.2] - 2026-03-04
### Fixed
- **Compact Fetch Refactor Bug**: Fixed an issue where the `compact` method failed to select the `id` column, causing the IDE handover's 'Wait List' ID array to be undefined.

## [1.3.1] - 2026-03-04
### Changed
- **IDE Agent Handover Protocol**: Removed internal reliance on local LLMs (LM Studio) within the `compact` method. The memory distillation process now systematically generates `.evo-lite/MEMORIES_TO_COMPACT.md` and halts, securely delegating the high-level reasoning and summarization task to the superior IDE-native agent.

## [1.3.0] - 2026-03-04
### Added
- **Space-Time Traceability Anchors**: Every memory inserted via CLI now automatically injects the current local time and the `git HEAD hash` as a prefix, granting historical exactness and allowing developers to checkout the precise snapshot of the codebase when the memory occurred.
- **AI Distillation Rules**: Appended strict AI behavioral constraints to the `ACTIVATE_EVO_LITE.md` templates. Agents are now mathematically forbidden from logging daily debugging chatter and are guided to only memorize high-density architectural signals and cross-file contracts.

## [1.2.0] - 2026-03-04
### Added
- **Robust CLI File Input**: Added `--file=<path>` argument support to `remember` and `recall` for safe input parsing avoiding OS shell string truncation.

### Fixed
- **OOM during Compact**: Implemented a sliding window Map-Reduce algorithm for the `compact` process to prevent LLM context overflows.
- **SQLite Concurrency Locks**: Applied `PRAGMA journal_mode=WAL` and `busy_timeout=5000` to prevent `SQLITE_BUSY` crashes when multiple AI agents attempt to write context simultaneously under high concurrency.

## [1.1.0] - 2026-03-03
### Added
- **CLI Commands Expansion**: Added `forget`, `stats`, `import`, `export`, and `compact` local commands to `memory.js`.
- **Dynamic Model Sniffing**: The `verify` command now dynamically sniffs the active chat model in LM Studio.
- **Wait Strategies**: Added exponential backoff and retry for LM Studio cold-start scenarios.
- **Offline Fallback for Memory CLI**: Graceful degradation to basic text extraction via `offline_memories.json` when the LM Studio API is unavailable (guiding IDE agent intervention).
- **Seamless Upgrade Protocol**: Non-destructive upgrades that protect user configurations (`active_context.md`) and automatically backup outdated templates to `.bak`.

## [1.0.3] - 2026-03-02
### Fixed
- **CLI Abort Catching**: Gracefully handled `Ctrl+C` interrupt (`ABORT_ERR`) during CLI prompt via Node `readline`.
- **Offline Install Fallback**: Unpacks a pre-compiled `sqlite-vec` binary when `npm install` goes offline or lacks local compile environments.

## [1.0.0] - 2026-02-28
- Initial Release.
