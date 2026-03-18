# PROJECT ARCHITECTURE & STANDARDS

> [!NOTE]
> 本文件定义了项目的核心技术标准、代码范式与架构约束。
> 当 AI 智能体执行 `/evo` 或初始化任务时，必须优先遵循此处的硬约束。

## 1. 核心技术栈 (Core Tech Stack)
- **Language**: JavaScript (Node.js)
- **Package Manager**: npm
- **Database**: SQLite (via `better-sqlite3`, `sqlite3`)
- **Vector Embeddings**: `sqlite-vec` for RAG capabilities
- **CLI Framework**: `commander` for parsing command-line arguments

## 2. 代码范式 (Coding Standards)
- **代码风格**: Follow the specifications of code style checking tools such as Prettier and ESLint.
- **模块化标准**: Keep the code clean and comments clear.

## 3. 架构约束 (Architectural Constraints)
- **Commit Convention**: Follow the Conventional Commits specification to facilitate the generation of Changelog and version releases.
- **Data Persistence**: The project uses SQLite for storing and managing data. Vector embeddings are leveraged for Retrieval-Augmented Generation (RAG), enabling context-aware AI operations.
- **Directory Structure**:
    - **`.agents/`**: Contains Agent-related configurations, such as rules and workflows.
    - **`.evo-lite/`**: Contains Evo-Lite core scripts and context.
    - **`src/`**: Contains the core source code of the project. (Note: As of current analysis, the primary logic is in `index.js` at the root, not a `src` directory).
    - **`templates/`**: Contains project template files.
    - **`index.js`**: Main entry point and core logic of the application.
