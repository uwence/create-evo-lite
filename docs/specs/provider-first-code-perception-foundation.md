---
id: spec:provider-first-code-perception-foundation
status: adopted
created: 2026-07-07
relations: [{"kind":"spawned-from","target":"spec:evo-lite-providers"}]
---

# Spec: Provider-First Code Perception Foundation

## 1. Summary

为 create-evo-lite 建立 Provider-First 的代码感知底座。

create-evo-lite 不在本阶段重复实现完整 AST 解析、跨文件符号解析、调用图和影响分析，而是通过统一的 `CodePerceptionProvider` 契约接入已有代码智能工具，并将外部代码事实与 Evo-Lite 自身的 Spec、Plan、Task、Commit、Evidence 和 Active Context 连接起来。

MVP 组成：

```text
Native Lite Provider
        +
CodeGraph Structural Provider
        +
Evo Governance Linker
        +
Unified Explore Contract
        +
Minimal Code Wiki Projection
```

后续增强：

```text
Understand Anything
→ summary / layer / tour / domain enrichment

GitNexus
→ process / community / advanced impact / cross-repo
```

核心定位：

```text
外部 Provider 负责理解代码结构
Evo-Lite 负责理解项目为什么这样开发
Unified Project Perception 负责把两者连接起来
```

---

## 2. Problem

create-evo-lite 当前已经具备：

* `active_context`
* Spec / Plan / Task IR
* Architecture IR
* Drift rules
* archive / recall
* evidence closure
* Git post-commit governance
* Inspector
* MCP server
* Architecture Provider contract

现有系统可以回答：

```text
当前开发焦点是什么？
有哪些未完成任务？
某个 Task 是否有 evidence？
哪个 Plan 已经完成？
当前有哪些模块？
架构或计划是否过期？
```

但无法可靠回答：

```text
某个功能由哪些 symbols 实现？
一个 CLI 命令经过怎样的调用链？
修改某个函数会影响哪些调用者和测试？
某个 Task 实际落到了哪些函数？
一个 Commit 改变了哪些代码实体？
当前焦点涉及哪些模块、文件和调用流程？
```

如果由 create-evo-lite 自研完整代码图谱，将面临：

* 多语言解析器维护；
* import、类型和动态调用解析；
* 增量索引；
* 图查询和 Impact；
* 文件 watcher；
* MCP 上下文质量；
* 大型仓库性能；
* 与现有成熟项目重复建设。

因此需要把 create-evo-lite 的差异化放在：

```text
统一 Provider 契约
代码事实与治理事实连接
人类与 Agent 共用的项目感知
```

而不是重新实现全部代码分析基础设施。

---

## 3. Architectural Decision

采用：

```text
Provider-First
Capability-Routed
Reference-Oriented
Governance-Linked
Local-First
```

### 3.1 Provider-First

完整 symbol graph、call graph 和 impact graph 由外部 Provider 管理。

Evo-Lite 不将某个 Provider 的内部数据库或私有数据结构视为自己的 canonical truth。

### 3.2 Capability-Routed

查询根据 Provider 能力路由，而不是假设一个 Provider 支持全部功能。

例如：

```text
symbol search        → CodeGraph
callers/callees      → CodeGraph
basic impact         → CodeGraph
human summary        → Understand Anything
architecture layer   → Understand Anything
process/community    → GitNexus
advanced impact      → GitNexus
task/spec/evidence   → Evo-Lite
```

### 3.3 Reference-Oriented

Evo-Lite 本地保存：

* Provider 状态；
* snapshot；
* Provider entity references；
* Task-to-Code links；
* Commit-to-Code links；
* Wiki 页面依赖；
* 必要的轻量摘要。

Evo-Lite 不复制完整外部代码图。

### 3.4 Governance-Linked

外部 Provider 一般只知道代码。

Evo-Lite 负责建立：

```text
Spec
  → Plan
    → Task
      → File
        → Provider Symbol
          → Test
            → Commit
              → Evidence
```

### 3.5 Local-First

* 默认不上传代码；
* 不自动安装外部工具；
* 不自动创建外部索引；
* 不要求后台云服务；
* Provider 不可用时降级到 Native Lite。

---

## 4. Goals

### G1. Unified Provider Contract

定义一个与具体工具无关的 `CodePerceptionProvider` 契约。

该契约必须能够适配：

* CLI 型 Provider；
* MCP 型 Provider；
* JSON 导入型 Provider；
* 未来自研 Native Provider。

### G2. CodeGraph First Provider

实现首个正式 Provider：

```text
provider:codegraph
```

支持：

* availability；
* provider version；
* index status；
* symbol search；
* file listing；
* callers；
* callees；
* impact；
* source/context passthrough；
* snapshot/staleness。

### G3. Native Lite Fallback

即使没有任何外部 Provider，create-evo-lite 仍能提供：

* tracked file discovery；
* file hashes；
* Architecture IR module membership；
* Task `linkedFiles`；
* Commit changed files；
* Provider availability；
* freshness status。

Native Lite 不伪造 symbol graph。

### G4. Governance-to-Code Links

将现有：

* Spec；
* Plan；
* Task；
* linkedFiles；
* acceptance criteria dependencies；
* Commit；
* Evidence；
* Active Context；

连接到 Provider file/symbol references。

### G5. Unified Agent Query

Agent 通过一个主要工具：

```text
evo_code_explore
```

取得：

* Provider 状态；
* 匹配文件和 symbols；
* 相关源码；
* 调用关系；
* Impact；
* 关联治理对象；
* 推荐阅读顺序。

### G6. Minimal Human Projection

生成最小 Code Wiki：

* Overview；
* Modules；
* Current Focus；
* Task-to-Code；
* Provider Status。

本 Spec 不要求完成复杂力导图 UI。

### G7. Explicit Freshness and Provenance

任何代码感知结果必须说明：

* 来自哪个 Provider；
* Provider 版本；
* Provider snapshot；
* 当前工作树是否 dirty；
* 索引是否 stale；
* 事实是结构事实还是解释性 enrichment；
* confidence。

---

## 5. Non-Goals

本 Spec 不包含：

* 自研完整 AST 解析器；
* 自研调用图；
* 自研类型推断；
* 自研多语言解析；
* 完整代码图数据库；
* 全量复制 CodeGraph 或 GitNexus 图数据；
* 自动安装 CodeGraph；
* 自动运行 `codegraph init`；
* 打包 GitNexus；
* 复制 GitNexus 源码；
* Understand Anything 多 Agent 分析流程集成；
* embedding 或 vector search；
* 完整业务 Domain 建模；
* 完整 execution process；
* 跨仓库 Contract Graph；
* PDG、污点分析；
* 自动重构或 rename；
* 自动代码修改；
* 独立 daemon；
* Code Wiki 高级可视化；
* 对所有外部 Provider 同时实现正式 Adapter。

---

## 6. Reference Provider Roles

### 6.1 CodeGraph

角色：

```text
structural-primary
```

权威范围：

* files；
* symbols；
* source ranges；
* imports；
* callers；
* callees；
* structural impact；
* affected tests；
* index freshness。

集成方式：

```text
CodeGraph CLI
```

MVP 不直接读取：

```text
.codegraph 内部 SQLite
```

MVP 允许调用：

```text
codegraph version
codegraph status <root> --json
codegraph query <query> --json
codegraph files <root> --json
codegraph callers <symbol> --json
codegraph callees <symbol> --json
codegraph impact <symbol> --json
codegraph explore <query>
codegraph node <symbol-or-file>
```

其中：

* JSON 命令可以规范化为结构化结果；
* `explore` 和 `node` 的文本输出只能作为 opaque source/context；
* 不得从人类可读文本反向推断结构边；
* Adapter 不依赖未公开的数据库 schema。

### 6.2 Understand Anything

计划角色：

```text
enrichment
```

计划提供：

* summaries；
* tags；
* complexity；
* layers；
* guided tour；
* domain and flow descriptions。

计划集成方式：

```text
读取 .understand-anything/knowledge-graph.json
```

由于其 JSON 没有保证每个字段都包含精确生成来源，以下字段默认只能视为 enrichment：

* summary；
* tags；
* complexity；
* layers；
* tour；
* domain descriptions；
* semantic relationships。

这些字段不能覆盖 CodeGraph 的确定性 symbol、source range 或 call edge。

本 Provider 不在本 Spec 中正式实现。

### 6.3 GitNexus

计划角色：

```text
structural-advanced
```

计划提供：

* processes；
* communities；
* advanced impact；
* change impact；
* route map；
* tool map；
* trace；
* cross-repository relations。

计划集成方式：

```text
外部 CLI / MCP
```

GitNexus 必须由用户独立安装和授权。

create-evo-lite：

* 不打包 GitNexus；
* 不复制 GitNexus 实现；
* 不把它变成默认依赖；
* 不保证其商业使用权；
* 必须在 UI 和状态中显示许可证提示。

本 Provider 不在本 Spec 中正式实现。

---

## 7. System Architecture

```text
                       Human / Agent
                            │
                            ▼
                  Evo Unified Query API
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       Governance Data   Query Router   Code Wiki
              │             │
              │       ┌─────┴─────┐
              │       ▼           ▼
              │  Native Lite   CodeGraph
              │                    │
              └──────────┬─────────┘
                         ▼
               Unified Perception Result
```

未来：

```text
                    Query Router
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    CodeGraph   Understand Anything  GitNexus
    structural      enrichment       advanced
```

---

## 8. Directory Layout

```text
templates/cli/
├── code-perception.js
├── code-perception/
│   ├── provider-contract.js
│   ├── provider-loader.js
│   ├── provider-router.js
│   ├── normalize.js
│   ├── native-lite.js
│   ├── governance-linker.js
│   ├── cache.js
│   ├── status.js
│   ├── wiki.js
│   └── providers/
│       └── codegraph.js
└── test/
    └── fixtures/
        └── code-perception/
            ├── codegraph-status.json
            ├── codegraph-query.json
            ├── codegraph-callers.json
            ├── codegraph-callees.json
            └── codegraph-impact.json
```

Runtime mirror：

```text
.evo-lite/cli/code-perception*
```

Generated state：

```text
.evo-lite/generated/code-perception/
├── provider-status.json
├── references.json
├── governance-links.json
├── wiki-manifest.json
└── cache/
```

生成文件均为派生数据，可以删除重建。

---

## 9. Provider Contract

```ts
interface CodePerceptionProvider {
  id: string
  name: string
  adapterVersion: string

  capabilities: ProviderCapabilities

  check(context: ProviderContext): Promise<ProviderAvailability>

  getStatus(
    context: ProviderContext
  ): Promise<ProviderStatus>

  search?(
    context: ProviderContext,
    query: CodeSearchQuery
  ): Promise<ProviderSearchResult>

  getEntity?(
    context: ProviderContext,
    query: EntityQuery
  ): Promise<ProviderEntityResult>

  getFiles?(
    context: ProviderContext,
    query: FileQuery
  ): Promise<ProviderFileResult>

  getCallers?(
    context: ProviderContext,
    query: RelationshipQuery
  ): Promise<ProviderRelationshipResult>

  getCallees?(
    context: ProviderContext,
    query: RelationshipQuery
  ): Promise<ProviderRelationshipResult>

  impact?(
    context: ProviderContext,
    query: ImpactQuery
  ): Promise<ProviderImpactResult>

  explore?(
    context: ProviderContext,
    query: ExploreQuery
  ): Promise<ProviderExploreResult>
}
```

### 9.1 Capabilities

```ts
interface ProviderCapabilities {
  files: boolean
  symbols: boolean
  source: boolean
  callers: boolean
  callees: boolean
  trace: boolean
  impact: boolean
  affectedTests: boolean
  modules: boolean
  flows: boolean
  summaries: boolean
  layers: boolean
  tours: boolean
  semanticSearch: boolean
  incrementalIndex: boolean
}
```

### 9.2 Availability

```ts
interface ProviderAvailability {
  available: boolean
  installed: boolean
  indexed: boolean
  executable?: string
  providerVersion?: string
  reason?: string
  suggestedAction?: string
}
```

`check()` 必须：

* 接收显式 project root；
* 不依赖 `process.cwd()`；
* 不修改项目；
* 不自动安装；
* 不自动建立索引；
* 不访问网络；
* 在超时或错误时返回 unavailable；
* 不抛出导致全局失败的异常。

### 9.3 Provider status

```ts
interface ProviderStatus {
  providerId: string
  adapterVersion: string
  providerVersion?: string

  available: boolean
  indexed: boolean

  indexedCommit?: string
  currentCommit?: string
  dirty: boolean
  stale: boolean

  fileCount?: number
  symbolCount?: number
  edgeCount?: number

  lastIndexedAt?: string

  capabilities: ProviderCapabilities
  diagnostics: ProviderDiagnostic[]
}
```

---

## 10. Normalized Reference Model

Evo-Lite 不复制完整 Provider graph，而是保存统一引用。

```ts
interface CodeReference {
  id: string

  providerId: string
  providerEntityId: string

  kind:
    | "file"
    | "module"
    | "class"
    | "interface"
    | "function"
    | "method"
    | "route"
    | "command"
    | "flow"
    | "test"
    | "unknown"

  name: string
  qualifiedName?: string

  filePath?: string
  lineRange?: [number, number]
  signature?: string

  snapshot: ReferenceSnapshot
  provenance: ReferenceProvenance
}
```

### 10.1 Reference identity

Evo reference ID：

```text
code-ref:<provider-id>:<hash(provider-entity-id)>
```

禁止仅按 symbol name 合并不同 Provider 的实体。

### 10.2 Snapshot

```ts
interface ReferenceSnapshot {
  providerSnapshot?: string
  indexedCommit?: string
  currentCommit?: string
  contentHash?: string
  dirty: boolean
  stale: boolean
}
```

### 10.3 Provenance

```ts
interface ReferenceProvenance {
  providerId: string

  method:
    | "provider-structural"
    | "provider-enrichment"
    | "native-file"
    | "git"
    | "declared-link"
    | "heuristic"

  authority:
    | "structural"
    | "enrichment"
    | "governance"

  confidence: number
}
```

---

## 11. Normalized Result Models

### 11.1 Search result

```ts
interface UnifiedSearchResult {
  query: string
  provider: ProviderStatus
  matches: CodeReference[]
  diagnostics: ProviderDiagnostic[]
}
```

### 11.2 Relationship result

```ts
interface UnifiedRelationship {
  source: CodeReference
  target: CodeReference

  kind:
    | "calls"
    | "called_by"
    | "imports"
    | "imported_by"
    | "references"
    | "tests"
    | "affected_by"

  providerId: string
  confidence: number
}
```

### 11.3 Impact result

```ts
interface UnifiedImpactResult {
  target: CodeReference
  provider: ProviderStatus

  upstream: CodeReference[]
  downstream: CodeReference[]
  affectedTests: CodeReference[]

  depth?: number
  risk?: "low" | "medium" | "high" | "unknown"

  diagnostics: ProviderDiagnostic[]
}
```

### 11.4 Explore result

```ts
interface UnifiedExploreResult {
  query: string

  freshness: {
    stale: boolean
    dirty: boolean
    indexedCommit?: string
    currentCommit?: string
  }

  providers: ProviderStatus[]

  matches: CodeReference[]
  relationships: UnifiedRelationship[]
  impact?: UnifiedImpactResult

  source: SourceExcerpt[]
  governance: GovernanceContext

  recommendedReading: ReadingItem[]
  diagnostics: ProviderDiagnostic[]
}
```

---

## 12. Provider Routing

### 12.1 Router inputs

```ts
interface RoutingRequest {
  capability:
    | "files"
    | "symbols"
    | "source"
    | "callers"
    | "callees"
    | "impact"
    | "flows"
    | "summaries"

  preferredProvider?: string
  allowFallback: boolean
}
```

### 12.2 Selection algorithm

```text
1. Read configured providers.
2. Run capability-aware availability checks.
3. Exclude unavailable or unindexed providers.
4. Rank exact preferred provider first.
5. Rank structural providers before enrichment providers
   for structural capabilities.
6. Select the first healthy provider.
7. Use Native Lite when no structural provider is available.
8. Return explicit degradation diagnostics.
```

### 12.3 No silent capability substitution

如果用户请求：

```text
impact
```

但只有 Native Lite：

```json
{
  "available": false,
  "capability": "impact",
  "fallback": "native-lite",
  "reason": "No indexed provider exposes impact analysis",
  "suggestedAction": "Install and index CodeGraph, or configure another impact provider."
}
```

不能把 file dependency 猜测包装为完整 Impact。

### 12.4 Freshness policy

* fresh Provider 优先于 stale Provider；
* stale Provider 可以被查询，但结果必须显著标记；
* dirty working tree 不等同于 index stale；
* Provider 无法判断 dirty 文件是否已同步时，视为 `freshness=unknown`；
* 多 Provider 结果不能丢失各自 freshness；
* enrichment 可来自旧 snapshot，但必须显示 snapshot 差异。

---

## 13. Configuration

```json
{
  "codePerception": {
    "enabled": true,
    "providers": [
      {
        "id": "provider:codegraph",
        "enabled": true,
        "role": "structural-primary",
        "command": "codegraph",
        "timeoutMs": 15000
      }
    ],
    "fallback": "provider:native-lite",
    "cache": {
      "enabled": true,
      "ttlMs": 300000
    },
    "wiki": {
      "enabled": true,
      "language": "zh-CN"
    }
  }
}
```

### 13.1 Defaults

没有配置时：

```text
1. Native Lite 永远启用。
2. 自动检测 CodeGraph executable。
3. 自动检测项目是否存在 CodeGraph index。
4. 不自动修改 config。
5. 不自动安装或初始化 CodeGraph。
6. 已检测到可用索引时，临时选择 CodeGraph。
7. status 明确说明选择来源是 auto-detected。
```

### 13.2 Security

`command`：

* 必须是单个 executable path 或 command name；
* 使用 `spawn` / `execFile`；
* 禁止 `shell: true`；
* 参数使用数组；
* project root 作为独立参数；
* 强制 timeout；
* 限制 stdout/stderr 大小；
* 清理 ANSI；
* 不执行 Provider 输出中的命令。

---

## 14. Native Lite Provider

Provider ID：

```text
provider:native-lite
```

能力：

```json
{
  "files": true,
  "symbols": false,
  "source": true,
  "callers": false,
  "callees": false,
  "trace": false,
  "impact": false,
  "affectedTests": false,
  "modules": true,
  "flows": false,
  "summaries": false,
  "layers": false,
  "tours": false,
  "semanticSearch": false,
  "incrementalIndex": false
}
```

### 14.1 Data sources

* `git ls-files`；
* eligible untracked files；
* `.gitignore`；
* `.evoignore`；
* Architecture IR；
* Planning IR；
* Git diff；
* file content hashes。

### 14.2 Native Lite guarantees

能够回答：

* 文件是否存在；
* 文件属于哪个 Architecture module；
* 哪些 Task 声明关联该文件；
* 当前 Commit 改了哪些文件；
* 当前焦点关联哪些声明文件；
* 外部 Provider 是否可用。

不能回答：

* 函数调用关系；
* symbol impact；
* callers/callees；
* execution flow。

---

## 15. CodeGraph Provider

Provider ID：

```text
provider:codegraph
```

### 15.1 Detection

检查顺序：

```text
1. Configured executable.
2. PATH 中的 codegraph。
3. `codegraph version`.
4. `codegraph status <projectRoot> --json`.
```

状态：

```text
executable missing   → installed=false
status fails no index → installed=true, indexed=false
valid JSON status     → available=true, indexed=true
```

### 15.2 Command mapping

| Evo capability | CodeGraph command                   |
| -------------- | ----------------------------------- |
| status         | `codegraph status <root> --json`    |
| files          | `codegraph files <root> --json`     |
| search         | `codegraph query <query> --json`    |
| callers        | `codegraph callers <symbol> --json` |
| callees        | `codegraph callees <symbol> --json` |
| impact         | `codegraph impact <symbol> --json`  |
| explore source | `codegraph explore <query>`         |
| entity source  | `codegraph node <entity>`           |

### 15.3 Parsing rule

以下命令必须使用 JSON：

* status；
* files；
* query；
* callers；
* callees；
* impact。

Adapter 必须：

* 验证 JSON 类型；
* 忽略未知字段；
* 保留原始 provider entity ID；
* 对缺失字段降级；
* 对错误 schema 产生 diagnostic；
* 不因新增字段失败。

`explore` 和 `node`：

* 输出作为 opaque text 保存；
* 可以提取明确标记的 file/line metadata；
* 不允许从自然语言说明生成结构 edge；
* 不能覆盖 JSON 结构结果。

### 15.4 Version compatibility

Provider Adapter 保存：

```text
adapterVersion
providerVersion
observedSchemaFingerprint
```

支持范围：

```text
minimumProviderVersion
testedProviderVersions
```

未知版本：

* 可以尝试兼容解析；
* status 标记 `compatibility=untested`；
* 不直接阻止只读查询；
* schema validation 失败时停用该能力，而不是停用全部 Provider。

### 15.5 No direct database coupling

禁止：

```text
直接打开 .codegraph 内部数据库
直接执行其内部 SQL
依赖其未公开表结构
修改 .codegraph
```

---

## 16. Governance Linker

### 16.1 Inputs

* Planning IR；
* Architecture IR；
* Active Context；
* Git commits；
* Git changed files；
* Evidence archive；
* Provider search results；
* Provider file and symbol references。

### 16.2 Link kinds

```ts
type GovernanceCodeLinkKind =
  | "declares_file"
  | "depends_on_file"
  | "implements_task"
  | "changed_by_commit"
  | "verified_by_test"
  | "evidenced_by_archive"
  | "related_to_focus"
```

### 16.3 Link sources

#### Exact declared link

来源：

```text
Task linkedFiles
Acceptance criterion dependsOn
```

置信度：

```text
1.0
```

#### Git-derived link

来源：

```text
Commit changed file
```

置信度：

```text
1.0 for file
Provider resolution confidence for symbol
```

#### Provider-resolved link

流程：

```text
linked file
  → provider file entity
  → provider symbols within file
```

不得把文件中的所有 symbols 都标记为 Task implementation。

只有以下条件之一满足才建立 symbol link：

* Plan 显式写出 symbol 名；
* Evidence 显式写出 symbol 名；
* Commit diff 行范围与 Provider symbol range 相交；
* Test/evidence 明确引用该 symbol。

#### Heuristic link

例如：

```text
Task title 与 symbol 名模糊匹配
```

只能作为 suggestion：

```text
confidence <= 0.5
authority = governance
status = proposed
```

不得默认显示为已确认实现关系。

### 16.4 Stored graph

```ts
interface GovernanceCodeLink {
  id: string
  governanceEntityId: string
  codeReferenceId: string
  kind: GovernanceCodeLinkKind

  status:
    | "confirmed"
    | "derived"
    | "proposed"

  confidence: number

  evidence: {
    sourcePath?: string
    commitSha?: string
    archivePath?: string
    lineRange?: [number, number]
  }
}
```

---

## 17. Local Cache

### 17.1 Cache scope

可以缓存：

* provider status；
* normalized search results；
* normalized impact results；
* opaque source context；
* governance links；
* Wiki dependencies。

不缓存：

* Provider 完整数据库；
* Provider 全量 graph；
* 未经限制的大段源码；
* secrets；
* Provider 凭据。

### 17.2 Cache key

```text
provider ID
+ provider version
+ adapter version
+ provider snapshot
+ project root fingerprint
+ normalized query
```

### 17.3 Cache invalidation

发生以下条件时失效：

* Provider snapshot 改变；
* HEAD 改变；
* dirty file hash 改变；
* Adapter version 改变；
* Provider config 改变；
* TTL 到期。

### 17.4 Cache safety

缓存结果仍必须携带原始 freshness。

缓存命中不能把 stale 结果改写为 fresh。

---

## 18. CLI Contract

新增顶级命令组：

```bash
mem code
```

### 18.1 Provider commands

```bash
mem code providers
mem code providers --json

mem code status
mem code status --json
```

### 18.2 Query commands

```bash
mem code search <query>
mem code search <query> --json

mem code explore <query>
mem code explore <query> --json

mem code callers <symbol>
mem code callees <symbol>
mem code impact <symbol>

mem code context --focus
mem code context --task <task-id>
mem code context --spec <spec-id>
```

### 18.3 Wiki commands

```bash
mem wiki build
mem wiki status
mem wiki status --json
```

### 18.4 Exit behavior

* Provider unavailable：命令返回成功形态 guidance，exit code 0；
* 用户参数无效：exit code 2；
* path traversal：exit code 2；
* Adapter malfunction：exit code 1；
* Provider process timeout：exit code 1；
* Native Lite fallback 成功：exit code 0，并显示 degraded。

---

## 19. Unified Explore

`mem code explore` 和 MCP `evo_code_explore` 使用同一 service。

### 19.1 Inputs

```ts
interface ExploreQuery {
  query: string

  focusId?: string
  preferredProvider?: string

  includeSource?: boolean
  includeImpact?: boolean
  includeGovernance?: boolean

  maxResults?: number
  maxSourceChars?: number
}
```

### 19.2 Processing

```text
1. Load Active Context and Planning IR.
2. Resolve optional focus/task/spec.
3. Select structural provider.
4. Search query and governance-derived terms.
5. Retrieve callers/callees when supported.
6. Retrieve Impact when requested.
7. Retrieve source context when requested.
8. Add Task/Spec/Commit/Evidence links.
9. Rank recommended reading.
10. Return freshness and diagnostics.
```

### 19.3 Recommended reading

排序依据：

```text
explicit linked file
current focus relation
exact symbol match
entrypoint
call-path centrality from Provider result
changed file
test file
documentation
```

推荐阅读必须解释原因。

---

## 20. MCP Contract

新增一个主要 MCP tool：

```text
evo_code_explore
```

不在 MVP 中新增多个相互重叠的代码工具。

### 20.1 Tool definition

```json
{
  "name": "evo_code_explore",
  "description": "Explore code and its Evo-Lite governance context using the best available code-perception provider.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string"
      },
      "focusId": {
        "type": "string"
      },
      "includeSource": {
        "type": "boolean",
        "default": true
      },
      "includeImpact": {
        "type": "boolean",
        "default": true
      },
      "maxResults": {
        "type": "number",
        "default": 10
      }
    },
    "required": ["query"]
  }
}
```

### 20.2 Response

```json
{
  "freshness": {
    "stale": false,
    "dirty": false,
    "indexedCommit": "...",
    "currentCommit": "..."
  },
  "provider": {
    "id": "provider:codegraph",
    "version": "...",
    "compatibility": "tested"
  },
  "matches": [],
  "relationships": [],
  "impact": {},
  "source": [],
  "governance": {
    "specs": [],
    "plans": [],
    "tasks": [],
    "commits": [],
    "evidence": []
  },
  "recommendedReading": [],
  "diagnostics": []
}
```

### 20.3 Expected conditions

以下情况不能返回 `isError: true`：

* CodeGraph 未安装；
* CodeGraph 未 index；
* symbol 未找到；
* symbol ambiguous；
* Provider stale；
* 当前只有 Native Lite；
* 某项 capability 不支持。

应返回成功形态 guidance。

以下情况允许 `isError: true`：

* 路径越界；
* Provider 输出违反安全限制；
* Adapter 内部异常；
* JSON schema 完全不可解析；
* Provider process 被异常终止且没有 fallback。

---

## 21. Minimal Code Wiki

Code Wiki 是 Provider 查询结果与治理数据的派生投影。

### 21.1 Required pages

```text
.evo-lite/generated/code-wiki/
├── manifest.json
├── overview.md
├── current-focus.md
├── providers.md
├── modules/
│   └── <module-id>.md
└── tasks/
    └── <task-id>.md
```

### 21.2 Overview

包含：

* 当前焦点；
* Provider status；
* index freshness；
* Architecture modules；
* current focus linked files；
* current focus resolved symbols；
* recently changed files；
* unresolved/degraded capabilities；
* 推荐阅读顺序。

### 21.3 Module page

包含：

* Architecture IR module description；
* files；
* Provider-resolved representative symbols；
* callers/callees summary where supported；
* related tasks；
* related commits；
* freshness。

MVP 不要求完整模块依赖力导图。

### 21.4 Task page

包含：

* Task；
* linkedFiles；
* resolved Provider files；
* confirmed/derived/proposed symbol links；
* related commits；
* related tests；
* evidence；
* unresolved code links。

### 21.5 Page provenance

每个页面 frontmatter：

```yaml
generatedBy: evo-code-wiki@1
generatedAt: 2026-07-07T00:00:00Z
provider: provider:codegraph
providerVersion: x.y.z
indexedCommit: abc123
currentCommit: abc123
stale: false
dependencies:
  - file:templates/cli/memory-index.js
  - task:memory-engine-default-flip-t4
```

### 21.6 Human notes

```markdown
<!-- BEGIN_GENERATED -->
自动生成区域
<!-- END_GENERATED -->

<!-- BEGIN_HUMAN_NOTES -->
人工补充区域
<!-- END_HUMAN_NOTES -->
```

重建不得删除 Human Notes。

---

## 22. Inspector Integration

MVP 不建立独立复杂 Code Wiki 前端。

现有 Inspector 增加：

```text
Code
```

页面至少展示：

* selected Provider；
* provider version；
* indexed/current commit；
* stale/dirty；
* capabilities；
* current focus files；
* resolved symbols；
* Task-to-Code links；
* Code Wiki 文件入口；
* degraded guidance。

Inspector API：

```text
GET /api/code/status
GET /api/code/focus
GET /api/code/task?id=<task-id>
```

Inspector：

* 只读；
* 不自动安装 Provider；
* 不自动执行 `codegraph init`；
* 可以执行有超时限制的只读 Provider query；
* Provider 失败时返回 diagnostic。

---

## 23. Post-Commit Integration

本 Spec 不要求 post-commit 自动执行外部 Provider 的完整索引。

post-commit 只执行：

```text
1. Detect source changes.
2. Refresh Native Lite file hashes.
3. Mark cached Provider results stale when snapshot differs.
4. Refresh governance file/commit links.
5. Refresh Code Wiki status and affected task pages.
6. Suggest Provider sync command.
```

对于 CodeGraph：

```text
如果其 watcher 或自身 hook 已保持 index fresh：
    Evo status 将其识别为 fresh。

如果 index stale：
    Evo 不隐式运行 codegraph sync。
    Governance report 提示用户运行 codegraph sync。
```

避免两个工具同时控制同一自动同步生命周期。

---

## 24. Failure Isolation

### 24.1 Provider missing

返回：

```text
CodeGraph not installed.
Native Lite active.
Symbol and impact capabilities unavailable.
```

现有 Evo 功能继续。

### 24.2 Provider not indexed

返回：

```text
CodeGraph installed but this project is not indexed.
Run `codegraph init` from the project root if you choose to enable it.
```

Evo-Lite 不自动执行。

### 24.3 Provider timeout

* 杀死子进程；
* 记录 diagnostic；
* 该请求降级；
* 不永久禁用 Provider；
* 连续失败可以短暂 circuit-break。

### 24.4 Provider output schema drift

* status 显示 compatibility warning；
* 单项 capability 停用；
* 其他可解析能力继续；
* 保存截断后的 diagnostic sample；
* 不保存可能含源码的大段原始输出。

### 24.5 Stale index

结果保留但显示：

```text
STALE
indexed: <sha>
current: <sha>
```

不得把旧结果描述成当前事实。

### 24.6 External license

GitNexus 或其他非 MIT Provider：

* status 显示许可证；
* Adapter 文档声明由用户独立安装；
* create-evo-lite 不负责商业授权；
* Provider 不作为 required dependency。

---

## 25. Testing Strategy

外部工具不得成为基础 CI 的强制依赖。

### 25.1 Contract fixtures

使用 committed fixtures 测试：

* Provider status normalization；
* search normalization；
* callers/callees normalization；
* impact normalization；
* unknown fields；
* missing fields；
* malformed JSON；
* timeout；
* process exit error。

### 25.2 Fake provider

建立：

```text
provider:fixture-code
```

用于测试：

* capability routing；
* failure isolation；
* freshness；
* governance linker；
* Wiki generation；
* MCP response。

### 25.3 Optional live dogfood

真实 CodeGraph dogfood不进入普通 CI，但在 Spec closure 前必须生成：

```text
docs/code-perception-codegraph-dogfood.md
```

记录：

* create-evo-lite commit；
* CodeGraph version；
* Adapter version；
* Provider status；
* search query；
* callers/callees query；
* impact query；
* current-focus query；
* Task-to-Code result；
* stale-index test；
* fallback test；
* observed limitations。

### 25.4 Invariants

* 无 Provider 时现有测试全部通过；
* Provider failure 不改变现有 Architecture IR；
* Provider query 不写源代码；
* 同一 fixture 归一化结果稳定；
* Human Notes 重建保留；
* template/runtime mirror byte-identical。

---

## 26. Delivery Phases

### Phase 0 — Contract

* normalized types；
* Provider contract；
* fixture provider；
* loader；
* capability router；
* diagnostics；
* contract tests。

### Phase 1 — Native Lite

* files；
* hashes；
* Architecture module membership；
* Planning linkedFiles；
* Git changed files；
* status；
* fallback。

### Phase 2 — CodeGraph Adapter

* check；
* version；
* status；
* files；
* query；
* callers；
* callees；
* impact；
* opaque source context；
* version compatibility；
* fixture tests。

### Phase 3 — Governance Linker

* Task-to-File；
* Task-to-Symbol；
* Commit-to-File；
* Commit diff range to symbol；
* Evidence-to-Code；
* Active Focus context。

### Phase 4 — Agent and Human Surface

* `mem code`；
* `evo_code_explore`；
* minimal Code Wiki；
* Inspector Code page；
* dogfood evidence。

Follow-up Specs：

```text
spec:understand-anything-enrichment-provider
spec:gitnexus-advanced-code-provider
spec:code-wiki-interactive-visualization
spec:native-code-intelligence-provider
```

---

## 27. Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-provider-contract",
      "description": "CodePerceptionProvider contract defines capabilities, availability, status, search, relationships, impact and explore; fixture providers validate successfully while invalid providers are rejected with isolated diagnostics.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/provider-contract.js",
        "templates/cli/code-perception/provider-loader.js"
      ]
    },
    {
      "id": "ac-capability-router",
      "description": "The router selects providers by requested capability and freshness, honours an explicit preferred provider, falls back to Native Lite, and never silently substitutes an unsupported capability.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/provider-router.js"
      ]
    },
    {
      "id": "ac-native-lite",
      "description": "With no external provider installed, Native Lite reports tracked files, hashes, Architecture IR module membership, Planning linkedFiles, Git changed files and explicit unavailable symbol/impact capabilities without breaking existing commands.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/native-lite.js"
      ]
    },
    {
      "id": "ac-codegraph-adapter",
      "description": "The CodeGraph adapter invokes only allowlisted CLI commands through execFile/spawn without a shell; normalizes status/files/query/callers/callees/impact JSON fixtures; treats explore/node output as opaque context; and does not read or modify .codegraph internals.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/providers/codegraph.js",
        "templates/cli/test/fixtures/code-perception/"
      ]
    },
    {
      "id": "ac-provider-freshness",
      "description": "Every normalized result carries provider ID/version, indexed and current commit when available, dirty/stale state, adapter version and compatibility; cached stale results remain visibly stale.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/status.js",
        "templates/cli/code-perception/cache.js"
      ]
    },
    {
      "id": "ac-governance-linker",
      "description": "The linker generates confirmed file links from Planning linkedFiles, Git-derived commit links, range-intersection symbol links and evidence links; name-only heuristic links remain proposed with confidence <= 0.5.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/governance-linker.js"
      ]
    },
    {
      "id": "ac-unified-explore",
      "description": "mem code explore uses one shared service to return freshness, provider status, normalized code references, relationships, optional impact/source, governance links, diagnostics and explained recommended reading; Native Lite degradation is success-shaped.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js code explore \"memory engine selection\" --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception.js",
        "templates/cli/code-perception/normalize.js"
      ]
    },
    {
      "id": "ac-mcp-code-explore",
      "description": "The MCP server exposes evo_code_explore backed by the same unified explore service; missing, unindexed, stale, ambiguous and unsupported-capability conditions return successful guidance rather than isError.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/mcp-validate.js",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/mcp-server.js"
      ]
    },
    {
      "id": "ac-minimal-code-wiki",
      "description": "mem wiki build produces provider status, overview, current-focus, module and task pages from the unified query layer; pages record freshness and dependencies; rebuilding preserves Human Notes.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js wiki build && node ./.evo-lite/cli/memory.js wiki status --json",
          "scope": "dogfood"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/wiki.js"
      ]
    },
    {
      "id": "ac-provider-failure-isolation",
      "description": "Provider missing, not indexed, timeout, malformed output and unsupported versions do not break Planning IR, Architecture IR, memory, verify or Inspector; Native Lite remains available and diagnostics are actionable.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/provider-loader.js",
        "templates/cli/code-perception/providers/codegraph.js"
      ]
    },
    {
      "id": "ac-live-codegraph-dogfood",
      "description": "A committed dogfood artifact records a real CodeGraph-backed run on create-evo-lite, including versions, commit, provider status, search, callers/callees, impact, focus context, Task-to-Code links, stale behavior, fallback behavior and known limitations.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "docs/code-perception-codegraph-dogfood.md"
      ]
    },
    {
      "id": "ac-mirror-parity",
      "description": "All new templates/cli code-perception files and their .evo-lite/cli mirrors are byte-identical; a second sync-runtime run reports zero changes.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/code-perception/",
        ".evo-lite/cli/code-perception/"
      ]
    }
  ]
}
```

---

## 28. Explicit Decisions

1. CodeGraph is the first implementation Provider.
2. Understand Anything and GitNexus are follow-up Providers.
3. Native Lite is always available.
4. Evo-Lite does not open Provider internal databases.
5. Evo-Lite does not automatically install or index Providers.
6. Provider capabilities are selected per query.
7. Structural facts and enrichment are distinct authority classes.
8. Provider entities are not merged by name alone.
9. Full external graphs are not copied into Evo-Lite.
10. Evo-Lite stores lightweight references and governance links.
11. One primary MCP code tool is exposed in the MVP.
12. Provider absence is a supported degraded state.
13. Staleness must appear in every code result.
14. Human Code Wiki and Agent queries share one service.
15. Task-to-Code is the main Evo-Lite differentiation.
16. External Provider licenses remain external responsibilities.
17. Post-commit does not implicitly run expensive external indexing.
18. A real CodeGraph dogfood run is required before closure.

---

## 29. Success Definition

本 Spec 完成后，在安装并索引 CodeGraph 的项目中：

```text
用户查看当前 Task
        ↓
Evo-Lite 读取 Planning IR
        ↓
解析 linkedFiles / Commit / Evidence
        ↓
CodeGraph 解析对应 symbols 和影响范围
        ↓
生成 Task-to-Code 页面
        ↓
Agent 通过 evo_code_explore 获取同一份结果
```

在没有 CodeGraph 的项目中：

```text
Native Lite
→ 文件、模块、任务、提交仍然可见
→ symbol、调用链和 Impact 显示为 unavailable
→ Evo-Lite 其他治理功能完全不受影响
```

create-evo-lite 由：

```text
Project-local AI Governance Runtime
```

演进为：

```text
Project-local AI Governance
and Provider-First Project Perception Runtime
```

同时保持：

```text
本地优先
可降级
可重建
无强制 Provider
无强制 daemon
无强制模型
不复制完整外部图
不绑定单一工具
```
