---
id: spec:evo-code-perception-foundation
status: parked
created: 2026-07-07
title: Evo Code Perception Foundation
parkedUntil: Superseded in direction by spec:provider-first-code-perception-foundation (provider-first is the Provider-First shrink of this self-built code-graph layer); formalize with mem spec supersede in Phase 2
---

## 2. Problem

create-evo-lite 当前已经具备：

* `active_context`
* Spec / Plan / Task IR
* Architecture IR
* Drift rules
* Evidence 与 archive
* Dashboard / Inspector
* MCP server
* Provider contract
* Git post-commit governance

但现有代码感知主要停留在文件和预定义模块层面。

当前系统可以知道：

```text
templates/cli/memory.service.js 属于 memory-service 模块
```

却不能稳定回答：

```text
memory.service.js 定义了哪些函数？
runMemoryAb 调用了哪些实现？
ZvecMemoryIndex 被哪些模块使用？
修改 getMemoryIndex 会影响什么？
某个 Task 实际落实到哪些 symbol？
从 CLI 命令到数据库写入经过什么调用路径？
```

这导致：

1. 用户看到的是状态表，而不是软件运行全貌。
2. Agent 仍需使用 grep、glob 和逐文件 Read 重建代码上下文。
3. Architecture IR 无法验证真实模块依赖是否符合声明边界。
4. Task 的 `linkedFiles` 只能追踪到文件，不能追踪到符号。
5. Code Wiki、Impact Analysis 和架构漂移没有统一事实底座。
6. 外部 CodeGraph / GitNexus provider 只能提高 file/module confidence，无法融入统一 symbol graph。

---

## 3. Product Positioning

Evo Code Perception 是 create-evo-lite 的代码事实层。

```text
Source Code / Config / Docs / Git
                 │
                 ▼
       Evo Code Intelligence
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  Evo Code IR       Queryable Code Store
       │                   │
       ├──────────┬────────┤
       ▼          ▼        ▼
 Architecture   Code Wiki   Agent Context
 Validation     Human UI    MCP / CLI
       │
       ▼
 Unified Project Graph
 Spec → Plan → Task → File → Symbol → Test → Commit → Evidence
```

### 3.1 Truth hierarchy

```text
源代码、配置、Git                   原始事实真源
.agents / Spec / Plan / Evidence    治理语义真源
evo-code-ir / code-intel.db         可重建派生事实
Code Wiki / Mermaid / Dashboard     可重建展示投影
LLM summaries                       可选解释层
```

LLM 不得成为结构关系的唯一来源。

---

## 4. Reference Decisions

### 4.1 From Understand Anything

采用：

* 面向人的交互式项目感知
* 文件、函数、类、概念等多层节点
* Architecture Layer
* Guided Tour
* Domain / Flow 视图
* Git commit 绑定
* Changed-file 增量更新
* 确定性分析与可选 LLM 摘要分离
* Code Wiki 使用用户指定语言输出

不采用：

* 由多 Agent 全量读取仓库作为基础索引方式
* 结构事实依赖 LLM 输出
* 单一大型 JSON 作为唯一查询存储
* 首次索引必须消耗大量模型 Token

### 4.2 From CodeGraph

采用：

* AST 驱动的确定性 symbol extraction
* `files / symbols / edges / unresolved_refs` 数据模型
* stable symbol ID
* source range 与 provenance
* content hash 增量检测
* SQLite 本地存储和 FTS
* Reference resolution
* callers / callees / trace / impact
* 返回原始、带行号的源码片段
* 一个主要 Agent 探索工具，而不是过多相互重叠的工具
* Index staleness 明确暴露
* Watcher 作为可选能力，不作为正确性的唯一保证

不采用：

* MVP 即支持数十种语言
* 在 Node 20 不可用的强制运行时依赖
* 常驻后台进程作为基础要求
* Index 不存在时让 Agent 静默误以为代码已经被分析

### 4.3 From GitNexus

采用：

* 显式的分析 Phase DAG
* Parse 与 Reference Resolution 分阶段
* 未解析引用保留到后续阶段
* 预计算 Module / Community / Process
* execution flow 作为一等数据
* Impact 在索引阶段准备足够信息
* MCP Tools 与 MCP Resources 分工
* Wiki 是 Code Graph 的派生投影
* Provider 错误隔离与能力声明

不采用：

* 复制 PolyForm Noncommercial 代码
* MVP 引入专用图数据库
* MVP 实现完整 PDG、污点分析和跨仓库 Contract Graph
* 一次暴露大量 Agent 工具
* 强制 embedding 模型和向量运行时

---

## 5. Goals

### G1. Deterministic Code Facts

从源码确定性提取：

* files
* symbols
* imports / exports
* contains
* direct calls
* inheritance / implementation
* tests
* commands / routes / workflows
* source ranges
* unresolved references

每个事实必须包含来源和置信度。

### G2. Generic Project Discovery

不能继续只扫描 create-evo-lite 自身的：

```text
templates/cli/
.agents/
docs/
```

必须支持常见项目布局：

```text
src/
app/
lib/
packages/
services/
server/
client/
test/
tests/
scripts/
cmd/
internal/
```

发现规则应由：

```text
Git tracked files
+ project config
+ language adapters
+ ignore rules
```

共同决定，而不是写死目录。

### G3. Incremental and Rebuildable

系统必须：

* 支持 full scan
* 支持 changed-file sync
* 支持新增、修改、删除和重命名
* 检测 dirty working tree
* 检测 index staleness
* 不解析未变化文件
* 可以删除全部派生数据后完整重建

### G4. Shared Human and Agent Model

Inspector、Code Wiki、CLI 和 MCP 必须读取同一套 Code IR。

禁止分别维护：

```text
一套给用户看的架构
一套给 Agent 用的代码索引
```

### G5. Governance-to-Code Traceability

必须建立：

```text
Spec → Plan → Task → File → Symbol → Test → Commit → Evidence
```

第一阶段允许部分关系来自 `linkedFiles`、Git diff 和命名匹配，但必须记录 provenance 和 confidence。

### G6. Provider Extensibility

内置轻量 scanner 是零配置基线。

CodeGraph、GitNexus 或其他工具应通过 provider adapter 提供更深分析，但不能成为 create-evo-lite 正常工作的必要条件。

---

## 6. Non-Goals

本 Spec 不包含：

* 完整 CodeWiki AI 问答 Agent
* 自动修改代码
* 自动重构或 rename
* 完整程序依赖图 PDG
* 污点分析
* 跨仓库服务 Contract Graph
* 所有语言的深层类型解析
* 强制 embedding
* 云端索引服务
* 独立 daemon
* 取代 IDE / LSP
* 自动生成业务需求
* 将 LLM 推测写成确定性调用边
* 直接复制 GitNexus 的实现代码

---

## 7. Core Architecture

### 7.1 Layers

```text
Layer 1 — Source Discovery
Git files, ignore rules, language detection, manifests

Layer 2 — Deterministic Extraction
files, symbols, imports, exports, direct references

Layer 3 — Resolution
cross-file imports, symbol references, calls, inheritance

Layer 4 — Structural Derivation
modules, entrypoints, tests, commands, routes, flows

Layer 5 — Governance Linking
spec, plan, task, evidence, commit links

Layer 6 — Query and Retrieval
search, context, trace, impact, context pack

Layer 7 — Projections
Code Wiki, Inspector, Mermaid, MCP resources
```

### 7.2 IR separation

保留现有：

```text
evo-arch-ir@1
```

其职责继续是：

* 声明或推断模块边界
* 模块角色
* 架构规则
* architecture drift

新增：

```text
evo-code-ir@1
```

其职责是：

* 文件事实
* 符号事实
* 代码关系
* 调用路径
* entrypoint
* flow
* index snapshot
* provenance

新增统一投影：

```text
evo-project-graph@1
```

其职责是连接：

```text
Governance IR + Architecture IR + Code IR + Git
```

不得将全部信息强塞进现有 `evo-arch-ir@1`。

---

## 8. Storage

### 8.1 Project layout

```text
.evo-lite/
├── code-intel.db
├── generated/
│   ├── code/
│   │   ├── code-ir.json
│   │   ├── status.json
│   │   ├── diagnostics.json
│   │   └── project-graph.json
│   └── code-wiki/
│       ├── manifest.json
│       ├── overview.md
│       ├── modules/
│       ├── flows/
│       ├── symbols/
│       └── diagrams/
└── config.json
```

### 8.2 Storage rule

* `code-intel.db` 是本地查询存储。
* `code-ir.json` 是可检查、可导出、可测试的 IR 投影。
* 二者都属于派生数据。
* 删除二者不得导致源信息丢失。
* 不与 memory archive 的数据库生命周期绑定。
* 不在数据库中无条件复制所有源码全文。
* 源码正文优先按 path + line range 从工作树读取。
* 读取源码前必须校验 content hash；不匹配时返回 stale 标记。

---

## 9. Data Model

### 9.1 Snapshot

```ts
interface CodeSnapshot {
  id: string
  projectRoot: string
  gitCommit: string | null
  branch: string | null
  dirty: boolean
  workspaceFingerprint: string
  configHash: string
  generatedAt: string
  scannerVersion: string
}
```

每个 Code IR 必须绑定 snapshot。

### 9.2 File

```ts
interface CodeFile {
  id: string
  path: string
  language: string
  contentHash: string
  size: number
  modifiedAt: number
  indexedAt: number

  moduleId?: string
  role?: string

  parseStatus:
    | "parsed"
    | "unsupported"
    | "skipped"
    | "error"

  symbolCount: number
  diagnostics: CodeDiagnostic[]
}
```

File ID：

```text
file:<normalized-project-relative-path>
```

路径必须：

* project-relative
* POSIX normalized
* 不含 `..`
* 不允许逃出 project root

### 9.3 Symbol

```ts
type CodeSymbolKind =
  | "module"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "variable"
  | "constant"
  | "parameter"
  | "route"
  | "command"
  | "workflow"
  | "config"
  | "test"
  | "document"

interface CodeSymbol {
  id: string
  kind: CodeSymbolKind

  name: string
  qualifiedName: string
  fileId: string
  moduleId?: string
  language: string

  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number

  signature?: string
  docstring?: string
  visibility?: string

  exported?: boolean
  async?: boolean
  static?: boolean

  contentHash: string
  provenance: CodeProvenance
}
```

Symbol ID 不得依赖行号。

推荐：

```text
symbol:<language>:<path>:<kind>:<qualified-name>
```

必要时对末尾部分进行稳定 hash。

### 9.4 Code edge

```ts
type CodeEdgeKind =
  | "contains"
  | "imports"
  | "exports"
  | "calls"
  | "references"
  | "extends"
  | "implements"
  | "instantiates"
  | "type_of"
  | "returns"
  | "reads"
  | "writes"
  | "tests"
  | "handles_route"
  | "handles_command"
  | "configures"
  | "documents"
  | "member_of"
  | "step_in_flow"

interface CodeEdge {
  id: string
  source: string
  target: string
  kind: CodeEdgeKind

  line?: number
  column?: number

  confidence: number
  provenance: CodeProvenance
  metadata?: Record<string, unknown>
}
```

Edge identity：

```text
source + target + kind + source-location
```

重复扫描不得产生重复边。

### 9.5 Provenance

```ts
interface CodeProvenance {
  provider: string
  method:
    | "ast"
    | "manifest"
    | "markdown"
    | "config"
    | "git"
    | "heuristic"
    | "external-provider"
    | "llm"

  filePath?: string
  lineRange?: [number, number]
  snapshotId: string
  confidence: number
}
```

任何 `llm` provenance 的边不得默认成为确定性事实。

### 9.6 Unresolved reference

```ts
interface UnresolvedReference {
  id: string
  fromSymbolId: string
  referenceName: string
  referenceKind: CodeEdgeKind
  filePath: string
  line: number
  column?: number
  candidates: string[]
  reason:
    | "not-found"
    | "ambiguous"
    | "dynamic"
    | "unsupported-language"
}
```

不能为了减少 unresolved 数量而生成低质量错误边。

### 9.7 Flow

```ts
interface CodeFlow {
  id: string
  name: string
  type:
    | "cli"
    | "http"
    | "event"
    | "job"
    | "workflow"
    | "test"
    | "generic"

  entrySymbolId: string
  steps: CodeFlowStep[]
  confidence: number
  provenance: CodeProvenance[]
}

interface CodeFlowStep {
  order: number
  symbolId: string
  edgeId?: string
  description?: string
}
```

MVP Flow 只允许由确定性边组合生成。

### 9.8 Governance link

Code relations 与治理 relations 分开存储。

```ts
type ProjectLinkKind =
  | "declared_in"
  | "planned_by"
  | "implements_task"
  | "changed_by"
  | "verified_by"
  | "documented_by"
  | "evidenced_by"

interface ProjectLink {
  source: string
  target: string
  kind: ProjectLinkKind
  confidence: number
  provenance: CodeProvenance
}
```

---

## 10. Analysis Pipeline

采用显式 Phase DAG。

```text
discover
   ↓
snapshot
   ↓
parse
   ↓
resolve-imports
   ↓
resolve-symbols
   ↓
derive-entrypoints
   ↓
derive-flows
   ↓
link-modules
   ↓
link-governance
   ↓
persist
   ↓
build-projections
   ↓
validate
```

### Phase 1 — Discover

输入：

* Git tracked files
* untracked eligible files
* `.gitignore`
* `.evoignore`
* `.evo-lite/config.json`
* parser capabilities

默认忽略：

```text
.git/
.evo-lite/
node_modules/
dist/
build/
coverage/
vendor/
generated binaries
minified assets
lockfile internals where not needed
```

不得只依赖固定目录。

### Phase 2 — Snapshot

记录：

* HEAD commit
* branch
* dirty status
* file hashes
* scanner version
* configuration hash

Dirty worktree 必须允许扫描，但状态中明确显示：

```text
snapshot = working-tree
commit = HEAD
dirty = true
```

### Phase 3 — Parse

MVP 内置 adapter：

```text
provider:native-jsts
```

支持：

* `.js`
* `.cjs`
* `.mjs`
* `.ts`
* `.tsx`
* `.jsx`

优先采用无原生编译依赖的 TypeScript Compiler API 或等价 parser。

同时提供轻量结构 adapter：

```text
provider:native-project-docs
```

支持：

* Markdown headings / links
* JSON / YAML config keys
* package manifests
* `.agents/rules`
* `.agents/workflows`
* common CLI command declarations

### Phase 4 — Resolve imports

至少解析：

* ES import
* ES export / re-export
* CommonJS `require`
* relative path
* package-local aliases where project manifest明确配置
* index file resolution
* JS / TS extension fallback

无法解析时写入 `unresolved_refs`。

### Phase 5 — Resolve symbols

MVP 保证：

* direct function calls
* direct method calls where receiver can be statically确定
* class extends
* interface implements
* exported symbol references
* test-to-target links where import relation明确

不要求：

* 完整动态 dispatch
* runtime monkey patch
* reflective calls
* dependency injection container 的完整运行时解析

### Phase 6 — Derive entrypoints

至少识别：

* package `bin`
* package `main`
* CLI command handlers
* HTTP route handlers where框架 adapter 支持
* test entrypoints
* Agent workflows
* MCP tool definitions and dispatch handlers

### Phase 7 — Derive flows

从 entrypoint 沿可信调用边生成有限深度 flow。

限制：

* 默认最大深度 8
* 检测环
* 每个 step 保留来源 edge
* 不通过低置信 heuristic 边无限扩展
* 结果必须可解释

### Phase 8 — Link modules

现有 Architecture IR 提供模块边界。

Code IR：

* 将 file/symbol 归属到 module
* 计算 module dependency
* 标记跨边界调用
* 标记 unclassified file
* 不改变 Architecture IR 的 canonical module ID

### Phase 9 — Link governance

第一版链接来源：

1. Plan Task `linkedFiles`
2. Acceptance Criteria `dependsOn`
3. Git commit changed files
4. archive evidence 中的 path / task ID
5. Spec / Plan 显式 ID
6. Test path naming

必须记录：

```text
exact
declared
git-derived
heuristic
```

四种 confidence 来源。

### Phase 10 — Validate

验证：

* 所有 edge 两端存在
* 所有 symbol 指向存在的 file
* line range 合法
* ID 唯一
* edge 不重复
* snapshot 完整
* provider 输出契约有效
* path 不逃逸 project root
* Code Wiki 引用可回到 Code IR

---

## 11. Incremental Update

### 11.1 Change detection

不能只依赖 Git commit diff。

使用：

```text
stored content hash
vs
current content hash
```

识别：

* added
* modified
* deleted
* renamed candidate
* unchanged

Git diff 用于：

* commit provenance
* change summary
* rename hints

### 11.2 Incremental algorithm

```text
detect changed files
        ↓
delete old symbols owned by changed/deleted files
        ↓
delete related outgoing/incoming derived edges
        ↓
parse changed/added files
        ↓
re-run resolution for:
  changed files
  direct importers
  unresolved refs matching changed symbols
        ↓
recompute affected flows/modules
        ↓
update project links
        ↓
commit transaction
```

### 11.3 Correctness rules

* 全量 scan 与增量 sync 对同一工作树必须产生等价 IR。
* 增量失败必须回滚数据库事务。
* 失败不得覆盖最后一次健康 snapshot。
* status 必须显示失败和 stale files。
* 删除文件必须删除对应 symbol 与 dangling edge。
* changed-file sync 不得解析所有 unchanged files。

### 11.4 Trigger model

MVP：

* 手动 `mem code scan`
* 手动 `mem code sync`
* Git post-commit hook
* Inspector / MCP 只读，不隐式进行昂贵 full scan

后续可选：

```text
mem code watch
```

Watcher 不是 MVP 正确性的必要条件。

---

## 12. Provider Contract

新增独立 contract：

```text
CodeIntelligenceProvider
```

不得破坏现有 Architecture Provider。

```ts
interface CodeIntelligenceProvider {
  id: string
  name: string
  version: string

  capabilities: {
    languages: string[]
    symbols: boolean
    references: boolean
    calls: boolean
    types: boolean
    flows: boolean
    impact: boolean
    semanticSearch: boolean
  }

  check(context: ProviderContext): Promise<ProviderAvailability>

  scan(
    context: ScanContext,
    changes: FileChangeSet
  ): Promise<ProviderCodeResult>
}
```

Provider result：

```ts
interface ProviderCodeResult {
  files?: CodeFile[]
  symbols?: CodeSymbol[]
  edges?: CodeEdge[]
  unresolved?: UnresolvedReference[]
  flows?: CodeFlow[]
  diagnostics?: CodeDiagnostic[]
}
```

### 12.1 Merge rules

* 相同 stable ID：高 confidence 可补充字段。
* 不得无条件覆盖 native exact fact。
* 不同 provider 的事实保留 provenance。
* provider error 被隔离并转成 diagnostic。
* external provider 不可用时 native baseline 保持一致。
* LLM provider 只能写 summary/tag/explanation，默认不能写 exact code edge。

### 12.2 Planned adapters

非 MVP 强制项：

```text
provider:codegraph
provider:gitnexus
provider:understand-anything-import
```

规则：

* CodeGraph adapter 可以通过 CLI/MCP 导入 symbol、edge、impact。
* GitNexus adapter 只能调用用户独立安装的工具，不打包或复制其实现。
* Understand Anything adapter 主要导入 summary、layer、tour、domain 等解释性投影。
* 外部工具的许可证与安装由用户独立管理。

---

## 13. Query Layer

### 13.1 Core deterministic queries

内部 Query API 必须支持：

```text
searchSymbols(query)
getSymbol(id)
getFile(path)
getNeighbors(id, direction, edgeKinds)
getCallers(id)
getCallees(id)
trace(from, to)
impact(target, direction, depth)
getFlow(id)
getModule(id)
getTaskCodeLinks(taskId)
getChangedSymbolImpact(diff)
```

### 13.2 Search

MVP 搜索：

```text
exact name
qualified name
path
signature
docstring
FTS text
identifier segmentation
```

不要求 embedding。

排序至少考虑：

```text
exact-name
qualified-name
path match
symbol kind
FTS rank
module proximity
graph distance
```

### 13.3 Source context

Agent 查询返回源码时：

* 返回 path
* 返回 line range
* 返回带行号正文
* 返回 indexed content hash
* 返回当前 content hash
* 两者不一致时标记 `stale: true`
* 不得在 stale 状态下把旧关系描述成当前事实

---

## 14. CLI Contract

新增：

```bash
mem code scan
mem code scan --full
mem code sync
mem code status
mem code status --json

mem code search <query>
mem code symbol <id-or-name>
mem code file <path>
mem code trace <from> <to>
mem code impact <symbol-or-path>
mem code flow <id>
mem code context --focus
mem code context --task <task-id>

mem wiki build
mem wiki status
```

### 14.1 `mem code status`

至少返回：

```json
{
  "version": "evo-code-ir@1",
  "indexedCommit": "...",
  "currentCommit": "...",
  "dirty": false,
  "stale": false,
  "files": 0,
  "symbols": 0,
  "edges": 0,
  "flows": 0,
  "unresolved": 0,
  "providerErrors": []
}
```

### 14.2 `mem code context --focus`

结合 `active_context` 输出：

```text
当前焦点
关联 Spec / Plan / Task
关联模块
关联文件
关联符号
相关调用流
最近修改
测试与证据
风险
推荐阅读顺序
```

---

## 15. MCP Contract

### 15.1 Primary tool

默认新增一个主要工具：

```text
evo_code_explore
```

输入：

```json
{
  "query": "How does mem commit close a task?",
  "includeSource": true,
  "maxDepth": 4,
  "focus": "optional task/spec ID"
}
```

输出：

```json
{
  "status": {
    "stale": false,
    "indexedCommit": "...",
    "dirty": false
  },
  "matches": [],
  "relationships": [],
  "flows": [],
  "impact": [],
  "governanceLinks": [],
  "source": [],
  "diagnostics": []
}
```

该工具应尽量一次提供：

* 相关 symbol
* 相关源码
* 连接路径
* 上下游影响
* Task / Spec 关系

### 15.2 Secondary tool

新增：

```text
evo_code_impact
```

用于：

* symbol impact
* file impact
* current git diff impact

### 15.3 MCP resources

```text
evo://code/status
evo://code/modules
evo://code/entrypoints
evo://code/flows
evo://code/flow/{id}
evo://code/symbol/{id}
evo://task/{id}/code
evo://spec/{id}/code
```

Resources 适合稳定浏览；Tools 适合动态问题。

### 15.4 Error behavior

以下情况返回成功形态的 guidance，而不是让 Agent 放弃工具：

* index 尚未建立
* index stale
* symbol ambiguous
* symbol not found
* provider 不可用
* unsupported language

只有以下情况使用 MCP error：

* path traversal
* DB corruption
* contract violation
* query execution malfunction

---

## 16. Code Wiki Projection

Code Wiki 是 Code IR 的派生读模型。

### 16.1 Required pages

```text
Overview
Modules
Entrypoints
Flows
Symbols
Tests
Changes
Task-to-Code
```

### 16.2 Overview

至少显示：

* 项目语言
* framework / manifest
* module map
* entrypoints
  -主要 flows
* index freshness
* unresolved count
* unclassified files
* architecture drift
* current focus 关联代码
* recent changed symbols

### 16.3 Module page

```text
模块职责
声明边界
实际包含文件
核心 symbols
入口
依赖模块
被依赖模块
跨边界调用
相关 flows
相关 tasks
相关 tests
最近提交
```

### 16.4 Symbol page

```text
signature
docstring
source location
source excerpt
module
callers
callees
references
tests
flows
impact
related tasks/commits/evidence
```

### 16.5 Flow page

提供：

* step list
* Mermaid flowchart 或 sequence diagram
* 每一步源码链接
* entrypoint
* terminal operation
* confidence
* unresolved gap

### 16.6 Guided reading

生成确定性阅读顺序：

1. entrypoint
2. orchestration layer
3. service/domain layer
4. data layer
5. tests
6. configuration

LLM 可改善解释文案，但不得改变底层顺序依据而不记录 provenance。

### 16.7 Human annotation

自动内容和人工内容分区：

```markdown
<!-- BEGIN_GENERATED -->
自动生成，不直接编辑
<!-- END_GENERATED -->

<!-- BEGIN_HUMAN_NOTES -->
人工业务说明
<!-- END_HUMAN_NOTES -->
```

重建 Wiki 不得删除 Human Notes。

---

## 17. Inspector Integration

在现有 Inspector 增加一级入口：

```text
Code Wiki
```

子视图：

```text
Overview
Modules
Flows
Search
Impact
Task → Code
```

MVP 不要求复杂力导向画布。

优先采用：

* 可筛选列表
* 层级图
* Mermaid
* 模块依赖图
* 调用路径
* 详情侧栏

原则：

> 图形必须帮助理解，不能只是展示节点数量和复杂度。

后续再增加：

* force-directed graph
* persona detail level
* domain view
* guided tour mode

---

## 18. Governance Integration

### 18.1 Planning

Planning IR 中的：

```text
linkedFiles
acceptanceCriteria.dependsOn
evidence
```

映射到 Code IR。

增加派生字段：

```ts
task.linkedSymbols
task.affectedModules
task.relatedTests
```

这些字段属于 project graph projection，不直接修改原 Plan 文件。

### 18.2 Drift

新增规则建议：

```text
R012 — linked file no longer exists
R013 — completed task has no changed symbol
R014 — architecture module dependency violates declared boundary
R015 — generated Code Wiki is stale
R016 — acceptance criterion dependency is unindexed
R017 — public symbol changed with no linked task/spec
R018 — flow entrypoint changed but flow projection not refreshed
```

本 Spec MVP 至少实现 R015。

其他规则可作为后续 Spec。

### 18.3 Active context

`/evo` takeover 增加 Code Perception 摘要：

```text
Index health
Current focus related modules
Current focus related symbols
Recent changed symbols
Affected flows
Recommended reading
Unresolved architecture risks
```

### 18.4 Post-commit hook

当 commit 包含 source files：

```text
code sync
→ project graph refresh
→ wiki affected-page refresh
→ dashboard refresh
```

如果 sync 失败：

* commit 不回滚
* governance report 标记 warning/error
* 保留旧健康 index
* status 标记 stale
* 输出明确恢复命令

---

## 19. Language Strategy

### MVP Tier 1

完整 symbol 与 edge：

```text
JavaScript
TypeScript
JSX
TSX
CommonJS
ESM
```

结构级感知：

```text
Markdown
JSON
YAML
package.json
Agent workflows
```

### Tier 2

通过独立 adapter：

```text
Python
Go
Java
C#
Rust
```

### Tier 3

领域 adapter：

```text
PLC Structured Text
CODESYS project exports
TwinCAT PLC exports
EPLAN / industrial configuration
```

Language adapter 必须遵守同一 Code IR contract。

---

## 20. Security and Privacy

* 默认全部本地。
* 不上传源码。
* LLM enrichment 必须显式启用。
* 尊重 `.gitignore` 和 `.evoignore`。
* 默认忽略 `.env`、密钥文件和二进制。
* Provider 不得读取 project root 之外路径。
* MCP 全部为只读。
* Inspector 保持 `127.0.0.1`。
* 所有源码读取进行 realpath 验证。
* 单文件大小限制可配置。
* 遇到疑似 secret，只保存 symbol metadata，不保存正文摘要。
* 生成的 Wiki 不应复制大段源码。
* 所有外部 provider 必须在 status 中显示是否会联网。

---

## 21. Performance and Scale

### Required properties

* 增量 sync 不解析 unchanged files。
* 查询不应每次重新扫描仓库。
* 所有写入使用事务。
* 大图 JSON 输出支持分页或摘要。
* MCP 默认限制返回大小。
* Source excerpt 按 symbol 范围读取。
* 索引状态查询不触发 full scan。

### Dogfood targets

在 create-evo-lite 自身仓库：

* full scan 成功
* second full scan 结果稳定
* no-change sync 解析文件数为 0
* 单文件修改只解析修改文件和必要依赖
* symbol search p95 目标小于 300 ms
* status p95 目标小于 100 ms
* `evo_code_explore` 不要求 Agent 再通过 grep 才能定位核心文件

性能数值属于目标，不以特定机器上的单次运行作为唯一验收标准。

---

## 22. Failure and Recovery

### Parser failure

* 记录 file diagnostic。
* 其他文件继续。
* file 保留为 `parseStatus=error`。
* status 显示 error count。

### Provider failure

* 隔离 provider。
* native result 保留。
* provider diagnostic 进入 status。

### Incremental transaction failure

* 回滚。
* 保留上一个健康 snapshot。
* 标记 stale。
* 提示：

```bash
mem code scan --full
```

### Corrupted index

允许：

```bash
mem code reset
mem code scan --full
```

`reset` 只能删除派生数据。

### Unsupported language

* 建立 file node。
* 标记 `unsupported`。
* 不生成虚假 symbol。
* 推荐可用 provider。

---

## 23. Backward Compatibility

* 不改变现有 `evo-arch-ir@1`。
* 不改变现有 Architecture Provider contract。
* 不改变现有 memory engine。
* 不要求已安装项目迁移手工文档。
* 没有 Code IR 时现有 Planning、Dashboard、MCP 继续工作。
* Code Perception 功能以 additive command 和 additive MCP 能力交付。
* `templates/cli/**` 与 `.evo-lite/cli/**` 保持 mirror parity。
* 新项目初始化时可选择是否立即建立 code index。
* 老项目首次运行 `mem code scan` 时自动创建数据结构。

---

## 24. Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-code-ir-schema",
      "description": "定义并验证 evo-code-ir@1：snapshot、files、symbols、edges、unresolved references、flows 和 provenance；无 dangling edge、重复 ID 或越界 path。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/schema.js",
        "templates/cli/code-intel/types.js"
      ]
    },
    {
      "id": "ac-generic-file-discovery",
      "description": "scanner 基于 Git files、ignore rules 和 language adapters 发现项目代码；可扫描 src/app/packages 等通用目录，不能只依赖 templates/cli 等 dogfood 路径。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/discovery.js"
      ]
    },
    {
      "id": "ac-native-jsts-extraction",
      "description": "内置 JS/TS adapter 提取 file、class、function、method、import、export、CommonJS require、直接调用和 source range；在 create-evo-lite dogfood 中至少识别 runMemoryAb、ZvecMemoryIndex、scanArchitecture 和 runMcpServer。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js code scan --full && node ./.evo-lite/cli/memory.js code status --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/providers/native-jsts.js"
      ]
    },
    {
      "id": "ac-cross-file-resolution",
      "description": "解析项目内 import/export/require 和可静态确定的 direct calls；无法解析的引用进入 unresolved_refs，不得用无证据 heuristic 强行建边。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/resolution/"
      ]
    },
    {
      "id": "ac-incremental-equivalence",
      "description": "full scan 与对同一工作树完成的 incremental sync 产生等价 Code IR；新增、修改、删除文件正确更新；no-change sync 解析文件数为 0。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/sync.js"
      ]
    },
    {
      "id": "ac-staleness-and-source-integrity",
      "description": "Code IR 绑定 commit、dirty 状态、workspace fingerprint 和 content hashes；查询源码时 hash 不一致必须返回 stale=true，不能静默返回旧关系。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/status.js",
        "templates/cli/code-intel/source-reader.js"
      ]
    },
    {
      "id": "ac-query-context-impact",
      "description": "CLI 支持 search、symbol、file、trace、impact 和 context；输出包含源码位置、关系、provenance、confidence 和 stale status。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js code search getMemoryIndex --json && node ./.evo-lite/cli/memory.js code impact templates/cli/memory-index.js --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/query.js",
        "templates/cli/code-intel/impact.js"
      ]
    },
    {
      "id": "ac-governance-code-links",
      "description": "project graph 将 Spec、Plan、Task、linkedFiles、commit 和 evidence 连接到 file/symbol；plan:memory-engine-default-flip 可查询到其声明文件以及其中已索引的相关 symbols。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js code context --task plan:memory-engine-default-flip --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/governance-linker.js"
      ]
    },
    {
      "id": "ac-primary-mcp-tool",
      "description": "MCP 新增 evo_code_explore 和 evo_code_impact；explore 一次返回匹配 symbol、源码、关系、flow、impact 和 governance links；index missing/stale 使用成功形态 guidance。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/mcp-validate.js",
          "scope": "integration"
        }
      },
      "dependsOn": [
        "templates/cli/mcp-server.js"
      ]
    },
    {
      "id": "ac-code-wiki-projection",
      "description": "mem wiki build 从同一 Code IR 生成 Overview、Modules、Flows、Symbols 和 Task-to-Code 页面；每个结构结论可追溯到 path 和 line range；重建不删除 Human Notes。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js wiki build && node ./.evo-lite/cli/memory.js wiki status --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-wiki/"
      ]
    },
    {
      "id": "ac-inspector-code-wiki",
      "description": "Inspector 增加 Code Wiki 入口，至少提供 Overview、Modules、Flows、Search、Impact 和 Task-to-Code；页面与 MCP 使用同一 Query API。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/inspector.js"
      ]
    },
    {
      "id": "ac-provider-isolation",
      "description": "新增 CodeIntelligenceProvider contract；provider 缺失、check false 或 scan throw 不影响 native baseline；输出带 provider provenance；现有 Architecture Provider 保持兼容。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-intel/provider-contract.js"
      ]
    },
    {
      "id": "ac-post-commit-refresh",
      "description": "source commit 触发增量 code sync、project graph refresh 和受影响 Wiki 页面刷新；失败保留上一个健康 index 并将 stale 状态写入 governance report。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/.github/hooks/post-commit",
        "templates/cli/hooks.js"
      ]
    },
    {
      "id": "ac-mirror-parity",
      "description": "templates/cli/** 与 .evo-lite/cli/** 中所有 Code Perception 文件 byte-identical；sync-runtime 第二次运行变更数为 0。",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/",
        ".evo-lite/cli/"
      ]
    }
  ]
}
```

---

## 25. Delivery Slices

本 Spec 可以分四个实施 Slice，但仍属于同一个整体契约。

### Slice A — Deterministic Foundation

* Code IR schema
* SQLite store
* generic discovery
* JS/TS extraction
* imports / exports
* full scan
* status

### Slice B — Resolution and Incremental

* references
* calls
* unresolved refs
* content hash sync
* dirty state
* source integrity
* trace / impact

### Slice C — Unified Project Perception

* Architecture IR linkage
* Spec / Plan / Task linkage
* commit / evidence linkage
* current-focus context pack
* post-commit refresh

### Slice D — Human and Agent Surfaces

* MCP
* Inspector
* Code Wiki
* Mermaid
* guided reading
* provider contract

不得在 Slice A 完成前开始以 LLM 生成大量 Wiki 文本。

---

## 26. Explicit Architectural Decisions

1. **Separate Code IR from Architecture IR.**
2. **SQLite before graph database.**
3. **Deterministic structure before LLM enrichment.**
4. **Content hashes before commit-only staleness.**
5. **One primary MCP exploration tool.**
6. **Code Wiki is a projection, not a source of truth.**
7. **No mandatory daemon.**
8. **No mandatory embedding.**
9. **Native JS/TS baseline before broad language support.**
10. **Provider output always carries provenance.**
11. **GitNexus is a conceptual reference, not a code dependency.**
12. **Human and Agent consume one Query API.**
13. **Task-to-symbol traceability is a first-class differentiator.**
14. **Incorrect missing edges are preferable to confident false edges.**
15. **Every answer must expose index freshness.**

---

## 27. Success Definition

本 Spec 完成后，用户应能在 Inspector 中从：

```text
当前任务
```

一路进入：

```text
相关模块
→ 相关文件
→ 相关符号
→ 调用路径
→ 测试
→ Commit
→ Evidence
```

Agent 应能通过一次 `evo_code_explore` 获得足够上下文，避免重新逐文件扫描。

create-evo-lite 的定位由：

```text
Project-local AI Governance Runtime
```

扩展为：

```text
Project-local AI Governance
and Unified Project Perception Runtime
```

同时保持 Lite 原则：

```text
本地
可重建
无强制服务
无强制模型
结构事实确定性
外部增强可选
```
