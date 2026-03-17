# PROJECT ARCHITECTURE & STANDARDS

> [!NOTE]
> 本文件定义了项目的核心技术标准、代码范式与架构约束。
> 当 AI 智能体执行 `/evo` 或初始化任务时，必须优先遵循此处的硬约束。

## 1. 核心技术栈 (Core Tech Stack)
- **Language**: Node.js (纯 JavaScript，主打轻量化，无转译包袱)
- **Framework**: 原生 Node CLI 骨架（无重型框架，纯本地 ONNX Runtime 引擎驱动，离线无感计算）
- **Package Manager**: npm
- **Database / Vector Engine**: SQLite3 + sqlite-vec (配合 better-sqlite3 构建极致轻便的本地向量知识库)

## 2. 代码范式 (Coding Standards)
- **极简即插即用**: 坚持无后台守护进程（Daemonless）设计，依靠文件读写与 SQLite 记录状态，保证即时唤醒、快速释放。
- **绝对锚点守卫**: 对 `.evo-lite/active_context.md` 的所有写入必须严格定位于对应的 HTML 注释区块（`META`/`FOCUS`/`BACKLOG`/`TRAJECTORY`）内，严禁越界污染。
- **原子化解耦**: 保证输入输出和动作（Action）的原子性，如将"短文本清理"与"长文向量入库"彻底剥离以规避资源死锁。

## 3. 架构约束 (Architectural Constraints)
- **拒绝过度依赖**: 严禁引入重型的第三方 Web 框架、服务驻留库或复杂的打包链，维持 "Agent 旁路挂件" 的定位。
- **防线要求**:
  - **内存高压防线**: 对本地 ONNX RAG 进行严密的内存泄漏控制（长周期或多轮操作后需自动释放内存池）。
  - **离线兜底防线**: 必须坚持基于 Jina-first 和 BGE 精排兜底的模型供给策略，保证断网或 API 限流时挂件依然完全可用。
  - **结构防线**: 后续所有的 1:N 记忆蒸馏提取必须遵循格式分离引擎（Symptoms 和 Solutions 分块解耦）。
