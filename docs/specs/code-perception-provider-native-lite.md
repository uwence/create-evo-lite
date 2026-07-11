---
id: spec:code-perception-provider-native-lite
status: adopted
created: 2026-07-10
relations: [{"kind":"spawned-from","target":"spec:provider-first-code-perception-foundation"}]
---

# Spec: Code Perception Provider Contract & Native Lite

> 子 spec ① of [[spec:provider-first-code-perception-foundation]]. 定义与工具无关的 `CodePerceptionProvider` 契约、归一化引用/结果模型、capability router、freshness/provenance,以及零依赖的 Native Lite fallback。**决定后两层(② adapter/linker、③ explore/wiki)的稳定边界。** 无外部依赖,先行交付。

## 1. Scope

- 提供: Provider 契约 + capabilities/availability/status、归一化 `CodeReference`/结果模型、provider loader、capability router(含 no-silent-substitution + freshness policy)、Native Lite provider、fixture provider、contract tests。
- 不提供: CodeGraph adapter、governance linker、cache、CLI/MCP/Wiki(子 spec ②③);任何自研 AST/调用图/类型推断/多语言解析。

## 2. Provider Contract

```ts
interface CodePerceptionProvider {
  id: string
  name: string
  adapterVersion: string
  capabilities: ProviderCapabilities
  check(context: ProviderContext): Promise<ProviderAvailability>
  getStatus(context: ProviderContext): Promise<ProviderStatus>
  search?(context, query: CodeSearchQuery): Promise<ProviderSearchResult>
  getEntity?(context, query: EntityQuery): Promise<ProviderEntityResult>
  getFiles?(context, query: FileQuery): Promise<ProviderFileResult>
  getCallers?(context, query: RelationshipQuery): Promise<ProviderRelationshipResult>
  getCallees?(context, query: RelationshipQuery): Promise<ProviderRelationshipResult>
  impact?(context, query: ImpactQuery): Promise<ProviderImpactResult>
  explore?(context, query: ExploreQuery): Promise<ProviderExploreResult>
}
```

契约必须能适配 CLI 型、MCP 型、JSON 导入型、未来自研 Native Provider。可选方法缺失即表示该能力不支持(由 capabilities 声明)。

### 2.1 Capabilities

```ts
interface ProviderCapabilities {
  files, symbols, source, callers, callees, trace, impact, affectedTests,
  modules, flows, summaries, layers, tours, semanticSearch, incrementalIndex: boolean
}
```

### 2.2 Availability

```ts
interface ProviderAvailability {
  available: boolean; installed: boolean; indexed: boolean
  executable?: string; providerVersion?: string; reason?: string; suggestedAction?: string
}
```

`check()` 必须: 接收显式 project root、不依赖 `process.cwd()`、不修改项目、不自动安装、不自动建索引、不访问网络、超时或错误返回 unavailable、不抛出导致全局失败的异常。

### 2.3 Provider status

```ts
interface ProviderStatus {
  providerId: string; adapterVersion: string; providerVersion?: string
  available: boolean; indexed: boolean
  indexedCommit?: string; currentCommit?: string; dirty: boolean; stale: boolean
  fileCount?, symbolCount?, edgeCount?: number
  lastIndexedAt?: string
  capabilities: ProviderCapabilities; diagnostics: ProviderDiagnostic[]
}
```

## 3. Normalized Reference Model

Evo-Lite 不复制完整 Provider graph,只存统一引用。

```ts
interface CodeReference {
  id: string                         // code-ref:<provider-id>:<hash(provider-entity-id)>
  providerId: string; providerEntityId: string
  kind: "file"|"module"|"class"|"interface"|"function"|"method"|"route"|"command"|"flow"|"test"|"unknown"
  name: string; qualifiedName?: string
  filePath?: string; lineRange?: [number, number]; signature?: string
  snapshot: ReferenceSnapshot; provenance: ReferenceProvenance
}
interface ReferenceSnapshot { providerSnapshot?, indexedCommit?, currentCommit?, contentHash?: string; dirty: boolean; stale: boolean }
interface ReferenceProvenance {
  providerId: string
  method: "provider-structural"|"provider-enrichment"|"native-file"|"git"|"declared-link"|"heuristic"
  authority: "structural"|"enrichment"|"governance"
  confidence: number
}
```

**禁止仅按 symbol name 合并不同 Provider 的实体**(reference id 含 provider-id + entity-id hash)。

## 4. Normalized Result Models

```ts
interface UnifiedSearchResult { query: string; provider: ProviderStatus; matches: CodeReference[]; diagnostics: ProviderDiagnostic[] }
interface UnifiedRelationship {
  source: CodeReference; target: CodeReference
  kind: "calls"|"called_by"|"imports"|"imported_by"|"references"|"tests"|"affected_by"
  providerId: string; confidence: number
}
interface UnifiedImpactResult {
  target: CodeReference; provider: ProviderStatus
  upstream: CodeReference[]; downstream: CodeReference[]; affectedTests: CodeReference[]
  depth?: number; risk?: "low"|"medium"|"high"|"unknown"; diagnostics: ProviderDiagnostic[]
}
```

(完整 `UnifiedExploreResult` 由子 spec ③ 组装;本 spec 只定义 router 与 native-lite 产出的 search/relationship/impact 归一化形。)

## 5. Provider Routing

```ts
interface RoutingRequest {
  capability: "files"|"symbols"|"source"|"callers"|"callees"|"impact"|"flows"|"summaries"
  preferredProvider?: string; allowFallback: boolean
}
```

Selection: (1) 读配置 providers → (2) capability-aware availability checks → (3) 排除 unavailable/unindexed → (4) 精确 preferredProvider 优先 → (5) 结构 provider 先于 enrichment(对结构能力)→ (6) 选第一个 healthy → (7) 无结构 provider 时用 Native Lite → (8) 返回显式 degradation diagnostics。

### 5.1 No silent capability substitution

请求 `impact` 但只有 Native Lite → 返回 `{available:false, capability:"impact", fallback:"native-lite", reason, suggestedAction}`。**不得把 file dependency 猜测包装为完整 Impact。**

### 5.2 Freshness policy

fresh 优先 stale;stale 可查但结果显著标记;dirty working tree ≠ index stale;无法判断时 `freshness=unknown`;多 Provider 结果不丢各自 freshness;enrichment 可来自旧 snapshot 但须显示差异。

## 6. Native Lite Provider (`provider:native-lite`)

能力: `files/source/modules = true`,其余(symbols/callers/callees/trace/impact/affectedTests/flows/summaries/...)= false。**Native Lite 不伪造 symbol graph。**

数据源: `git ls-files`、eligible untracked、`.gitignore`、`.evoignore`、Architecture IR、Planning IR、Git diff、file content hashes。

能回答: 文件是否存在 / 文件属哪个 Architecture module / 哪些 Task 声明关联该文件 / 当前 Commit 改了哪些文件 / 焦点关联哪些声明文件 / 外部 Provider 是否可用。
不能回答: 函数调用关系 / symbol impact / callers-callees / execution flow(显式 unavailable)。

## 7. Configuration(provider 部分)

```json
{ "codePerception": { "enabled": true,
  "providers": [{ "id": "provider:codegraph", "enabled": true, "role": "structural-primary", "command": "codegraph", "timeoutMs": 15000 }],
  "fallback": "provider:native-lite" } }
```

无配置时: Native Lite 永远启用;自动检测 CodeGraph executable/index 但不改 config、不自动安装/初始化;检测到可用索引时临时选 CodeGraph;status 说明来源为 auto-detected。Provider `command` 安全约束(execFile/无 shell/数组参数/timeout/限制输出/清 ANSI)在子 spec ② 详述。

## 8. Testing Strategy

- **Contract fixtures**: provider status/search/callers/callees/impact normalization、unknown fields、missing fields、malformed JSON、timeout、process exit error。
- **Fake provider** `provider:fixture-code`: 测 capability routing、failure isolation、freshness。
- **Invariants**: 无 Provider 时现有测试全通过;Provider failure 不改 Architecture IR;Provider query 不写源代码;同一 fixture 归一化结果稳定;template/runtime mirror byte-identical。

## 9. Directory Layout(本 spec 涉及)

```text
templates/cli/code-perception/
├── provider-contract.js     # 契约 + validateProvider
├── provider-loader.js       # 加载/隔离 provider,失败不全局崩
├── provider-router.js       # capability routing + freshness
├── normalize.js             # CodeReference / result 归一化
├── native-lite.js           # provider:native-lite
└── providers/fixture-code.js
templates/cli/test/fixtures/code-perception/*.json
```
Runtime mirror `.evo-lite/cli/code-perception*` 必须 byte-identical。

## 10. Delivery Phases

### Phase 0 — Contract
normalized types、Provider contract、fixture provider、loader、capability router、diagnostics、contract tests。

### Phase 1 — Native Lite
files、hashes、Architecture module membership、Planning linkedFiles、Git changed files、status、fallback。

## 11. Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-provider-contract",
      "description": "CodePerceptionProvider contract defines capabilities, availability, status, search, relationships, impact and explore; fixture providers validate successfully while invalid providers are rejected with isolated diagnostics.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/provider-contract.js", "templates/cli/code-perception/provider-loader.js"]
    },
    {
      "id": "ac-capability-router",
      "description": "The router selects providers by requested capability and freshness, honours an explicit preferred provider, falls back to Native Lite, and never silently substitutes an unsupported capability.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/provider-router.js"]
    },
    {
      "id": "ac-native-lite",
      "description": "With no external provider installed, Native Lite reports tracked files, hashes, Architecture IR module membership, Planning linkedFiles, Git changed files and explicit unavailable symbol/impact capabilities without breaking existing commands.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/native-lite.js"]
    },
    {
      "id": "ac-provider-freshness",
      "description": "Every normalized result carries provider ID/version, indexed and current commit when available, dirty/stale state, adapter version and compatibility; stale results remain visibly stale through the router.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/provider-router.js", "templates/cli/code-perception/normalize.js"]
    }
  ]
}
```
