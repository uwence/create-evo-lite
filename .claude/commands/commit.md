# /commit

Run the Evo-Lite high-frequency closure workflow.

## Intent

- ensure the code snapshot is committed
- run `context track`
- report whether closure is complete or partial

## Command guidance

- Use the host-appropriate `mem` wrapper for `context track`
- Do not edit runtime anchors in `.evo-lite/active_context.md` directly

## Important

- Closure truth comes from Evo-Lite CLI output, not from this wrapper command alone.
- `.agents/` and `.evo-lite/` remain canonical.
