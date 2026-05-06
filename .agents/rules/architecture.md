# PROJECT ARCHITECTURE & STANDARDS

> [!NOTE]
> 本文件只保留当前项目真正长期有效的硬约束。工作流细节放在 `.agents/workflows/`，运行时细节放在 `.evo-lite/cli/`。

## 1. 核心栈

- Language: JavaScript on Node.js
- Package manager: npm
- Storage and retrieval: local SQLite via `better-sqlite3`
- Search engine: `FTS5 + trigram + BM25`
- Runtime style: daemonless, project-local, no separate memory service

## 2. 模块边界

- `index.js`: scaffold entry; responsible for project initialization, template copy, and upgrade-safe asset refresh
- `templates/`: canonical scaffold source for generated runtime files
- `.evo-lite/`: active runtime copy inside a project instance
- `.agents/`: canonical protocol and workflow layer

## 3. 代码与运行时约束

- Prefer small, composable modules. Current runtime split is `memory.js` -> `memory.service.js` -> `db.js` / `runtime.js` / `models.js` / `safety.js`.
- Keep `.evo-lite/cli/*` and `templates/cli/*` logically aligned so newly initialized projects inherit the latest stable runtime.
- Use Conventional Commits.
- Do not treat root `AGENTS.md` or `CLAUDE.md` as canonical long-term rule sources; they are generated host adapters.

## 4. Non-Negotiables

- Do not mutate `active_context.md` runtime sections by hand when a CLI path exists.
- Do not introduce extra wrapper directories like `project/`, `app/`, or `workspace/` unless the user explicitly asks for a nested project.
- Prefer the current local FTS architecture; do not reintroduce heavy embedding or external service assumptions unless the user explicitly requests an architecture change.
