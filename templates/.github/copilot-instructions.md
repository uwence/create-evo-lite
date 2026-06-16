# Evo-Lite Workspace Bootstrap

This workspace uses Evo-Lite as the project-local workflow, handoff, and runtime-state layer.

- Read `.agents/rules/` and `.agents/workflows/` as the canonical workflow semantics.
- Read `.evo-lite/active_context.md` as the current runtime state before starting a new implementation slice.
- Use `./.evo-lite/mem` on Unix / Bash and `.\.evo-lite\mem.cmd` on Windows PowerShell / CMD for focus, backlog, trajectory, and handoff transitions.
- Do not hand-edit protected runtime anchors when an Evo-Lite CLI path already exists.
- External integrations such as context-mode, RTK, and GitNexus are optional and are managed by their own installers and configs, not by Evo-Lite scaffold ownership.

# Architecture Rule

- During `/evo` takeover or before the first substantive implementation step, read `.agents/rules/architecture.md`.
- If `architecture.md` is configured, treat it as a hard constraint for language, framework/runtime, package manager, storage/retrieval, and module boundaries.
- If `architecture.md` is missing or still placeholder content, do not assume a stack as fact. Propose 2-3 candidate architecture/language options from the current repo signals or project name, then ask the user whether to adopt your proposal or customize it before coding.

<!-- evo-lite:local-extensions:start -->


<!-- evo-lite:local-extensions:end -->
