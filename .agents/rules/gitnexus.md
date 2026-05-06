---
trigger: always_on
---
# GitNexus Usage Convention

> [!NOTE]
> GitNexus is an auxiliary code-intelligence tool for this project.
> It helps with architecture reading, impact analysis, and change verification.
> It does not replace `.agents/`, `.evo-lite/active_context.md`, or Evo-Lite CLI output as the canonical source of truth.

## 1. Positioning

- Treat GitNexus as a navigation and risk-analysis layer.
- Treat `.agents/` and `.evo-lite/` as the canonical semantics and runtime truth.
- Prefer reading `templates/cli/*` as the canonical runtime implementation when GitNexus results differ between `templates/cli/*` and `.evo-lite/cli/*`.
- Treat `.evo-lite/cli/*` as the active runtime copy unless the task is specifically about scaffold template generation.

## 2. Default Workflow

Use GitNexus in the following order when it materially helps:

1. Architecture exploration:
   - `gitnexus query --repo create-evo-lite "<concept>"`
   - `gitnexus context --repo create-evo-lite --file <path> <symbol>`
2. Before editing a core symbol:
   - `gitnexus impact --repo create-evo-lite <symbol>`
3. Before commit or handover:
   - `gitnexus detect-changes --scope all --repo create-evo-lite`
4. After large code changes:
   - `gitnexus analyze`

## 3. Best-Fit Scenarios

- Understanding architecture and call chains.
- Checking blast radius before changing core functions like `track`, `verify`, `archive`, `initDB`, or scaffold entry logic in `index.js`.
- Verifying whether a change only touched expected symbols and execution flows.

## 4. Limits

- Do not treat GitNexus output as the only truth when the repo contains generated assets and mirrored runtime files.
- Do not let GitNexus replace `node .evo-lite/cli/memory.js verify` or the `/evo` workflow during project takeover.
- If GitNexus output conflicts with live runtime files, manually inspect both layers and prefer the canonical layer for the current task.

## 5. Project-Specific Guidance

- For scaffold behavior, start from `index.js` and `templates/*`.
- For runtime behavior, start from `templates/cli/*` and then compare with `.evo-lite/cli/*` only when needed.
- If a task modifies generated host adapter assets like `AGENTS.md` or `CLAUDE.md`, remember they may be regenerated during template upgrades and should not hold exclusive long-term rules.
