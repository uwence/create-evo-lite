---
trigger: model_decision
description: Trigger strictly when summarizing system state for Git Commit, or calling the mem remember tool. Enforces mandatory Git Commit hash traceability, blocks unstructured logs, and triggers the pre-exit safety valve.
---

# 🚨 记忆蒸馏 (Memory Distillation)

Target: `remember`, state summaries, and any long-term memory write.

- Reject low-entropy logs and step-by-step noise.
- Keep cross-file contracts, workarounds, architectural decisions, and anti-regression notes.
- Use `remember` for lightweight recall hints only.
- Use `archive` for long bug postmortems, implementation conclusions, or anything that should survive rebuild.
- For long records, prefer one structured archive over many vague short memories.
- Preserve coherent headings and topic boundaries so archive chunks stay semantically clean after ingestion.

