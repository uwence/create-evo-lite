---
trigger: always_on
---
# EVO-LITE CORE RULES

## 1. Boot

- On takeover, read project architecture rules and `.evo-lite/active_context.md` before proposing code.
- Use `mem verify` at takeover, after rebuild, after template upgrade, or when runtime state looks unreliable.

## 2. Retrieval and closure

- For debugging or historical pitfalls, read `active_context` first. Use `mem recall` only when current state is insufficient.
- After a real fix or architectural conclusion, close the loop in order:
  1. commit code
  2. run `mem context track --mechanism=... --details=... [--resolve=...]`
  3. report the real closure state from CLI output

## 3. State-machine discipline

- `FOCUS`, `BACKLOG`, and `TRAJECTORY` are runtime-controlled sections.
- Do not edit those sections by hand when a CLI path exists.
- Use `mem context focus` and `mem context track` for state transitions.
- `META` may be edited manually only when no dedicated CLI entry exists.

## 4. Memory model

- `active_context.md` = current state
- `track` = compliant transition path
- `archive` = long-term structured asset
- `remember` = lightweight recall cache, not the primary closure path
- `session_events` = lifecycle telemetry and resume hints only, not a durable closure replacement

Preferred flow:

`active_context -> context track -> archive`

Do not claim reliable closure if `track` failed to write archive or update context.
Do not evolve `remember` or `session_events` into a parallel durable archive chain.

## 5. Safety and behavior

- Use Chinese for explanations and discussion. Use English for code, identifiers, and commit messages.
- Prefer minimal solutions, reuse existing mechanisms, and avoid heavy new dependencies unless explicitly requested.
- Do not create extra wrapper directories like `project/`, `app/`, or `workspace/` unless the user explicitly asks for a nested project.
- After two failed attempts on the same bug, stop, reread `active_context`, run recall if needed, and take a meaningfully different path.

## 6. Output contract

- Workflow summaries must report the real state, not slogans.
- Always answer:
  1. is the system / closure / rebuild actually healthy or partial
  2. what is the smallest correct next step
