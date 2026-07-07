---
trigger: always_on
---
# EXECUTION MODEL — DECOMPOSE/REVIEW vs EXECUTE

The Claude Code reasoning models (**opus**, **fable**) do **task decomposition
and review only**. Task **execution** (writing the implementation code) is
**delegated to the openai-codex plugin**.

## Division of Labor

| Phase | Owner | Output |
|-------|-------|--------|
| Brainstorm → spec | opus / fable | `docs/superpowers/specs/…` |
| Decompose → plan | opus / fable | `docs/superpowers/plans/…` (codex-executable tasks) |
| **Execute tasks** | **openai-codex** | code + tests + commits per task |
| Review | opus / fable | accept / request-changes against the spec |
| Closure | opus / fable | `mem verify-contract`, `mem close`, focus update |

## What "codex-executable" means for the plan

When opus/fable write the plan, each task MUST be self-contained enough for
codex to run without further context:

- Exact file paths (create / modify / mirror).
- Complete code in every code step — no "implement the rest", no placeholders.
- Exact commands with expected output for every verify step.
- An `Interfaces` block naming the exact signatures a task produces/consumes.

## Review gate (opus/fable)

After codex reports a task DONE, opus/fable MUST, before accepting:

1. Read the diff — not just codex's summary.
2. Confirm the plan checkboxes are `- [x]` (see `subagent-checkpoint.md`).
3. Re-run the task's verify command and read the real output (evidence before
   assertions — no "looks done").
4. Check the change against the spec's Acceptance Criteria and Non-Goals; a task
   that adds scope beyond the plan is request-changes, not accept.

## Boundaries

- opus/fable do **not** hand-write feature implementation when a codex-executable
  plan exists — that defeats the model. They may write the plan's example code
  (it is decomposition), and may make trivial mechanical fixes during review.
- Delegation does not lower the review bar. A wrong-but-plausible codex diff that
  passes a shallow read is exactly what the review gate exists to catch.
- This rule governs *how work is executed*; it does not override Evo-Lite's
  canonical spec → plan → verify → close state machine, which still applies.

## Fallback (codex unavailable)

If the codex plugin cannot run (crash, missing platform binary, auth failure),
opus/fable MAY execute the plan inline — but only as an explicit exception, and
the review discipline does not relax: still read the resulting diff, re-run every
verify command, and check against the spec before closing. Prefer fixing codex
and re-delegating when the outage is transient; go inline when the user asks to
skip codex or the outage blocks progress.
