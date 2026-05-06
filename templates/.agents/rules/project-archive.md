---
trigger: model_decision
description: Trigger strictly when completing a task or system_state_summary intent
---

# RULE: SYS_MEM_DISTILLATION_PROTOCOL

When a task is complete or a real system-state summary is needed:

1. Commit code first.
2. Use the host-appropriate `mem context track --mechanism=... --details=... [--resolve=...]`.
3. Let the CLI capture commit identity, write structured archive output, and update context.
4. Report the real result from CLI output instead of assuming closure succeeded.

Archive quality rules:

- Reject low-value logs and generic execution diaries.
- Keep durable knowledge: cross-file contracts, workarounds, decision shifts, and anti-regression notes.
- Archive files should follow the schema produced by `memory.js`.
- If malformed archives appear during sync or rebuild, treat them as repair items before claiming the memory layer is healthy.
