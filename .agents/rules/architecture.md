# PROJECT ARCHITECTURE & STANDARDS

> [!NOTE]
> 本文件定义了项目的核心技术标准、代码范式与架构约束。
> 当 AI 智能体执行 `/evo` 或初始化任务时，必须优先遵循此处的硬约束。

## 1. 核心技术栈 (Core Tech Stack)
- **Language**: JavaScript (Node.js)
- **Package Manager**: npm
- **Database**: SQLite (via `better-sqlite3`, `sqlite3`) - 启用了 WAL (Write-Ahead Logging) 以支持并发写入。
- **Vector Embeddings**: `sqlite-vec` for RAG capabilities
- **CLI Framework**: `commander.js` for robust and structured command-line argument parsing and command routing.
- **AI Models**: Transformers.js. 采用 **Jina-优先** 供给策略 (`jina-embeddings-v2-small-en`)，并带有 BGE (`bge-small-en-v1.5`) 离线兜底加载机制。

## 2. 代码范式 (Coding Standards)
- **代码风格**: Follow the specifications of code style checking tools such as Prettier and ESLint.
- **模块化标准**: 保持代码高内聚、低耦合。例如，`memory` 核心系统被拆分为 `cli` 入口、`service` 业务逻辑、`db` 数据库操作和 `models` 模型管理，职责清晰。
- **模板同步**: `.evo-lite/` 中的核心脚本必须与其在 `templates/` 中的源文件保持一致，以便新初始化的项目始终获得最新版本。

## 3. 架构约束 (Architectural Constraints)
- **Commit Convention**: 遵循 Conventional Commits 规范，这有助于自动生成 Changelog 并在未来实现自动化版本发布。
- **Agent 状态机完整性**:
  - 严禁绕过 CLI 直接修改状态文件（如 `active_context.md`）。
  - 所有的状态流转必须通过 `.evo-lite/mem.cmd` (或其背后的 `memory.js`) 代理，任何直接修改行为都被视为致命错误。
- **数据库指纹验证**: 存储向量特征前，系统会自动验证并存储所使用嵌入模型的维度指纹，防止因模型切换导致 SQLite 崩溃。
- **Directory Structure**:
    - **`.agents/`**: 存放 Agent 相关的协议（`rules/`）和工作流定义（`workflows/`）。这些文件定义了 AI 的行为边界。
    - **`.evo-lite/`**: 存放当前项目实例的 Evo-Lite 核心运行时脚本、CLI 工具和上下文存储（如 `memory.db` 和 `walkthroughs/`）。
    - **`templates/`**: 项目脚手架的源头。其内部结构（尤其是 `templates/.agents` 和 `templates/cli`）被设计为与生成后的项目结构完全镜像（"所见即所得"），从而使 `index.js` 中的初始化逻辑完全解耦为单纯的递归复制操作。
    - **`index.js`**: 位于根目录的脚手架执行入口，其核心职责被严格限制为项目生成和依赖安装，不再包含复杂的模板解析或分发逻辑。