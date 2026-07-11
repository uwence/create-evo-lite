---
id: spec:unified-code-explore-wiki-projection
status: adopted
created: 2026-07-10
relations: [{"kind":"spawned-from","target":"spec:provider-first-code-perception-foundation"}]
---

# Spec: Unified Code Explore & Code Wiki Projection

> 子 spec ③ of [[spec:provider-first-code-perception-foundation]]. 人类与 Agent 的统一代码感知面: `mem code` CLI + MCP `evo_code_explore`(共用一个 service)+ Minimal Code Wiki 投影 + Inspector Code 页。depends-on 子 spec ①(契约/router)+ ②(adapter/linker 结果);被 ② blocks(无有效 Task-to-Code 前不交付)。

## 1. Scope

- 提供: `mem code` 命令组、Unified Explore service、MCP `evo_code_explore`、Minimal Code Wiki(overview/current-focus/providers/modules/tasks 投影 + Human Notes 保护)、Inspector Code 页与只读 API、mirror parity。
- 不提供: 契约/router/native-lite(①)、adapter/linker/cache(②)、Code Wiki 高级可视化/力导图(follow-up `spec:code-wiki-interactive-visualization`)。
- **人类 Wiki 与 Agent 查询共用一个 service**(不做两套逻辑)。

## 2. Unified Explore Result

```ts
interface UnifiedExploreResult {
  query: string
  freshness: { stale: boolean; dirty: boolean; indexedCommit?: string; currentCommit?: string }
  providers: ProviderStatus[]
  matches: CodeReference[]
  relationships: UnifiedRelationship[]
  impact?: UnifiedImpactResult
  source: SourceExcerpt[]
  governance: GovernanceContext          // specs/plans/tasks/commits/evidence
  recommendedReading: ReadingItem[]
  diagnostics: ProviderDiagnostic[]
}
```

### 2.1 Inputs

```ts
interface ExploreQuery {
  query: string; focusId?: string; preferredProvider?: string
  includeSource?, includeImpact?, includeGovernance?: boolean
  maxResults?, maxSourceChars?: number
}
```

### 2.2 Processing

```text
1. Load Active Context + Planning IR
2. Resolve optional focus/task/spec
3. Select structural provider (via ① router)
4. Search query + governance-derived terms
5. Retrieve callers/callees when supported
6. Retrieve Impact when requested
7. Retrieve source context when requested
8. Add Task/Spec/Commit/Evidence links (via ② linker)
9. Rank recommended reading
10. Return freshness + diagnostics
```

### 2.3 Recommended reading(必须解释原因)

排序: explicit linked file → current focus relation → exact symbol match → entrypoint → call-path centrality → changed file → test file → documentation。

## 3. CLI Contract (`mem code`)

```bash
mem code providers [--json]
mem code status [--json]
mem code search <query> [--json]
mem code explore <query> [--json]
mem code callers <symbol>
mem code callees <symbol>
mem code impact <symbol>
mem code context --focus | --task <task-id> | --spec <spec-id>
mem code wiki build
mem code wiki status [--json]
```

Wiki 命令置于 `mem code wiki` 命名空间(**不占用通用 `mem wiki`**)——为姐妹投影 LLM Wiki([[spec:llm-wiki-memory-projection]])的独立命名空间(如 `mem memory wiki`)预留,避免 CLI 所有权冲突。

### 3.1 统一退出/错误模型(CLI 与 MCP 同一套,见 §4)

"能力不足"是产品能力问题,**不等同于程序执行失败**:

```text
外部 Provider timeout/malformed/process failure + Native Lite 能满足该请求
    → exit 0 / isError false / degraded diagnostics
外部 Provider failure + 该能力无法 fallback(如 impact 无结构 Provider)
    → 对"能力不可用"返回成功形态 guidance(exit 0 / isError false)
仅以下 → exit 1 / isError true:
    安全违规(path traversal / Provider 输出违反安全限制)、
    内部 invariant 破坏 / Adapter 异常、
    JSON schema 完全不可解析、
    无法形成任何合法响应且无 fallback。
用户参数无效 → exit 2(CLI)。
```

## 4. MCP Contract

新增**一个**主要 MCP tool `evo_code_explore`(不新增多个重叠代码工具),背后同一 Unified Explore service。

```json
{ "name": "evo_code_explore",
  "description": "Explore code and its Evo-Lite governance context using the best available code-perception provider.",
  "inputSchema": { "type": "object", "properties": {
    "query": {"type":"string"}, "focusId": {"type":"string"},
    "includeSource": {"type":"boolean","default":true},
    "includeImpact": {"type":"boolean","default":true},
    "maxResults": {"type":"number","default":10} }, "required": ["query"] } }
```

Response 形: freshness / provider / matches / relationships / impact / source / governance{specs,plans,tasks,commits,evidence} / recommendedReading / diagnostics。

**不得返回 `isError:true`**: CodeGraph 未安装/未 index、symbol 未找到/ambiguous、Provider stale、只有 Native Lite、某能力不支持 → 一律成功形态 guidance。
**允许 `isError:true`**: 路径越界、Provider 输出违反安全限制、Adapter 内部异常、JSON schema 完全不可解析、Provider process 异常终止且无 fallback。

## 5. Minimal Code Wiki(派生投影)

```text
.evo-lite/generated/code-wiki/
├── manifest.json
├── overview.md          # 焦点 / provider status / index freshness / modules / focus linked files+symbols / recently changed / degraded caps / 推荐阅读
├── current-focus.md
├── providers.md
├── modules/<module-id>.md    # 描述 / files / 代表 symbols / callers-callees summary / related tasks+commits / freshness
└── tasks/<task-id>.md        # Task / linkedFiles / resolved provider files / confirmed-derived-proposed symbol links / related commits+tests / evidence / unresolved links
```

页面 frontmatter 记 provenance: `generatedBy / generatedAt / provider / providerVersion / indexedCommit / currentCommit / freshness / dependencies[]`。

**Human Notes 语义(MVP = 纯派生只读)**: `.evo-lite/generated/code-wiki/` 是可删可重建的派生投影,**不得**在其中保存 canonical 人工 truth(否则 `git clean -fdx` / 重建会永久丢失)。MVP: Code Wiki 页面纯派生、只读,**不含 Human Notes**。将来若需人工注记,canonical notes 单独存 `docs/code-wiki-notes/<stable-page-id>.md`,build 时读取并投影进页面——删除整个 generated 目录后人工笔记仍可完整重建;**不得**依赖"重写前从生成文件摘 block 再塞回"。MVP 不要求完整模块依赖力导图。

## 6. Inspector Integration

现有 Inspector 增加 `Code` 页(不建独立复杂前端): 展示 selected provider / version / indexed-current commit / stale-dirty / capabilities / focus files / resolved symbols / Task-to-Code links / Code Wiki 入口 / degraded guidance。
API: `GET /api/code/status`、`/api/code/focus`、`/api/code/task?id=<task-id>`。Inspector 只读、不自动安装 Provider、不自动 `codegraph init`、可执行有超时的只读 Provider query、Provider 失败返回 diagnostic。

## 7. Directory Layout(本 spec 涉及)

```text
templates/cli/
├── code-perception.js       # mem code / unified explore service 入口
├── code-perception/
│   ├── normalize.js         # (与 ① 共享;此处消费 UnifiedExploreResult 组装)
│   └── wiki.js
├── mcp-server.js            # + evo_code_explore
└── inspector.js             # + Code 页 + /api/code/*
.evo-lite/generated/code-wiki/**
```
Runtime mirror `.evo-lite/cli/**` 必须 byte-identical;第二次 `sync-runtime` 零变更。

## 8. Delivery Phases

### Phase 4a — Agent + CLI surface
`mem code`(providers/status/search/explore/callers/callees/impact/context)、Unified Explore service、`evo_code_explore` MCP,共用同一 service;Native Lite degradation 成功形态。

### Phase 4b — Human projection
Minimal Code Wiki(overview/current-focus/providers/modules/tasks)、Inspector Code 页 + `/api/code/*`、Human Notes 保护、mirror parity。

## 9. Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-unified-explore",
      "description": "mem code explore uses one shared service to return freshness, provider status, normalized code references, relationships, optional impact/source, governance links, diagnostics and explained recommended reading; Native Lite degradation is success-shaped.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/memory.js code explore \"memory engine selection\" --json", "scope": "dogfood" } },
      "dependsOn": ["templates/cli/code-perception.js", "templates/cli/code-perception/normalize.js"]
    },
    {
      "id": "ac-mcp-code-explore",
      "description": "The MCP server exposes evo_code_explore backed by the same unified explore service; missing, unindexed, stale, ambiguous and unsupported-capability conditions return successful guidance rather than isError.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/mcp-validate.js", "scope": "governance" } },
      "dependsOn": ["templates/cli/mcp-server.js"]
    },
    {
      "id": "ac-minimal-code-wiki",
      "description": "mem code wiki build produces provider status, overview, current-focus, module and task pages from the unified query layer; pages record freshness and dependencies; pages are pure-derived and read-only (no canonical Human Notes stored under the generated dir), so deleting the whole generated code-wiki dir and rebuilding reproduces every page.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/memory.js code wiki build && node ./.evo-lite/cli/memory.js code wiki status --json", "scope": "dogfood" } },
      "dependsOn": ["templates/cli/code-perception/wiki.js"]
    },
    {
      "id": "ac-inspector-code-surface",
      "description": "The Inspector Code page renders selected provider/version, indexed/current commit, index/freshness/dirty state, capabilities, current-focus files and resolved symbols, Task-to-Code links, Code Wiki entry and degraded guidance; GET /api/code/status, /api/code/focus and /api/code/task?id= return the same unified data read-only, never auto-install or index a provider, and surface diagnostics on provider failure.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/inspector.js"]
    },
    {
      "id": "ac-mirror-parity",
      "description": "All new templates/cli code-perception + surface files and their .evo-lite/cli mirrors are byte-identical; a second sync-runtime run reports zero changes.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception.js", "templates/cli/code-perception/wiki.js"]
    }
  ]
}
```
