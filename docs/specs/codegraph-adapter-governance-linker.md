---
id: spec:codegraph-adapter-governance-linker
status: adopted
created: 2026-07-10
relations: [{"kind":"spawned-from","target":"spec:provider-first-code-perception-foundation"},{"kind":"blocks","target":"spec:unified-code-explore-wiki-projection"}]
---

# Spec: CodeGraph Adapter & Governance Linker

> 子 spec ② of [[spec:provider-first-code-perception-foundation]]. 实现首个正式结构 Provider(CodeGraph CLI adapter)与 Governance Linker(把代码事实接入 Task/Commit/Evidence),加本地 cache 与真实 CodeGraph dogfood。**Evo-Lite 核心差异化 (Task-to-Code) 落在这里。** depends-on 子 spec ①(契约与 reference model);blocks 子 spec ③。

## 1. Scope

- 提供: `provider:codegraph` adapter(detection / command mapping / JSON normalize / opaque explore / version compat / no-DB-coupling)、Governance Linker(link kinds + 置信度分级 + stored graph)、本地 cache、post-commit 轻量刷新、failure isolation、真实 CodeGraph dogfood 证据。
- 不提供: 契约/router/native-lite(子 spec ①)、CLI/MCP/Wiki/Inspector(子 spec ③)、UA/GitNexus adapter(follow-up)。
- **Governance Linker 与 Adapter 同处本 spec**(价值链耦合: CodeGraph 提供事实 → Linker 接入治理),不单拆。

## 2. CodeGraph Provider (`provider:codegraph`, role: structural-primary)

### 2.0 Upstream identity(必须锁定——"CodeGraph"有同名歧义)

存在至少两个 CLI 完全不同的同名项目;本 spec 的命令映射(§2.2)对应的是:

```text
Upstream repository:            colbymchenry/codegraph
Package:                        @colbymchenry/codegraph
Provider ID:                    provider:codegraph
Initial compatibility target:   1.x
License:                        MIT
```

(另一个 `optave/ops-codegraph-tool`,Apache-2.0,命令集为 `build/query/where/context/fn-impact/diff-impact` 等,**不是**本 spec 目标——后续 agent 勿据其"修正"命令。)`provider:codegraph` 的 `check()` 在运行时须以 fingerprint 确认身份,**不能只验可执行文件名叫 `codegraph`**。无副作用探针: 执行 `codegraph version` + `codegraph help`,确认 (1) semver ∈ `>=1.0.0 <2.0.0`;(2) help 含预期命令集 `status/files/query/explore/node/callers/callees/impact/affected`;(3) 输出形态属本 upstream。不匹配 → `available=false` + diagnostic,而非猜测适配(真正完成同名工具消歧)。

权威范围: files / symbols / source ranges / imports / callers / callees / structural impact / affected tests / index freshness。集成方式: **CodeGraph CLI**(本 provider 自负 executable/version/index 探测,见 §2.1);MVP 不直接读 `.codegraph` 内部 SQLite。

### 2.1 Detection

```text
1. Configured executable → 2. PATH 中 codegraph → 3. `codegraph version` → 4. `codegraph status <root> --json`
executable missing    → installed=false
status fails no index → installed=true, indexed=false
valid JSON status     → available=true, indexed=true
```

### 2.2 Command mapping

| Evo capability | CodeGraph command |
| --- | --- |
| status | `codegraph status <root> --json` |
| files | `codegraph files <root> --json` |
| search | `codegraph query <query> --json` |
| callers | `codegraph callers <symbol> --json` |
| callees | `codegraph callees <symbol> --json` |
| impact | `codegraph impact <symbol> --json` |
| affectedTests | `codegraph affected [files...] --json`(支持文件参数/stdin/深度/测试 glob) |
| explore source | `codegraph explore <query>` |
| entity source | `codegraph node <entity>` |

(上游身份与命令映射已对 `colbymchenry/codegraph` README/CLI 文档核验;current 1.4.1,compat target `>=1.0.0 <2.0.0`。`explore`/`node` 是 MCP 工具的 CLI 表面,不承诺 JSON → 作 opaque text。)

### 2.3 Parsing rule

JSON 命令(status/files/query/callers/callees/impact): 验证 JSON 类型、忽略未知字段、保留原始 provider entity ID、缺失字段降级、错误 schema 产生 diagnostic、不因新增字段失败。
`explore`/`node`: 输出作为 **opaque text** 保存;可提取明确标记的 file/line metadata;**不允许从自然语言说明生成结构 edge**;不能覆盖 JSON 结构结果。

### 2.4 Version compatibility

保存 `adapterVersion / providerVersion / observedSchemaFingerprint`,声明 `minimumProviderVersion / testedProviderVersions`。未知版本: 尝试兼容解析、status 标 `compatibility=untested`、不阻止只读查询、schema validation 失败时**停用该能力而非整个 Provider**。

### 2.5 No direct database coupling & security

禁止打开/执行 `.codegraph` 内部 DB/SQL、依赖未公开表结构、修改 `.codegraph`。执行安全: `command` 为单一 executable;`spawn`/`execFile`、禁 `shell:true`、参数数组、project root 独立参数、强制 timeout、限制 stdout/stderr 大小、清 ANSI、不执行 Provider 输出中的命令。

### 2.6 Network boundary(Local-First 默认)

CodeGraph 默认开启匿名 telemetry + 后台版本检查。Evo-Lite 启动其子进程时**默认注入**关闭这些的环境变量:

```text
DO_NOT_TRACK=1
CODEGRAPH_NO_UPDATE_CHECK=1
```

只有用户在 Evo-Lite 配置中显式允许外部网络行为时才放开。理由不是 CodeGraph 会上传源码(其文档称不发送源码/路径/查询),而是 **Evo-Lite 自身的默认网络边界应由 Evo-Lite 控制**。

## 3. Governance Linker

### 3.1 Inputs
Planning IR、Architecture IR、Active Context、Git commits、Git changed files、Evidence archive、Provider search results、Provider file/symbol references。

### 3.2 Link kinds

```ts
type GovernanceCodeLinkKind =
  "declares_file"|"depends_on_file"|"implements_task"|"changed_by_commit"|"verified_by_test"|"evidenced_by_archive"|"related_to_focus"
```

### 3.3 Link sources & confidence

- **Exact declared** (Task linkedFiles / acceptance dependsOn): confidence 1.0。
- **Git-derived** (Commit changed file): 1.0 for file;symbol 用 Provider resolution confidence。
- **Provider-resolved** (linked file → provider file entity → symbols within file): **不得把文件内所有 symbols 都标为 Task implementation**。只有满足其一才建 symbol link: Plan 显式写出 symbol 名 / Evidence 显式写出 symbol 名 / Commit diff 行范围与 Provider symbol range 相交 / Test/evidence 明确引用该 symbol。
- **Heuristic** (Task title 与 symbol 名模糊匹配): 只作 suggestion,`confidence ≤ 0.5`、`authority=governance`、`status=proposed`;不得默认显示为已确认实现关系。

### 3.4 Stored graph

```ts
interface GovernanceCodeLink {
  id: string; governanceEntityId: string; codeReferenceId: string; kind: GovernanceCodeLinkKind
  status: "confirmed"|"derived"|"proposed"; confidence: number
  evidence: { sourcePath?: string; commitSha?: string; archivePath?: string; lineRange?: [number, number] }
}
```

## 4. Local Cache

可缓存: provider status、normalized search/impact results、opaque source context、governance links。不缓存: Provider 完整 DB/全量 graph、未经限制的大段源码、secrets、凭据。
Cache key: providerID + providerVersion + adapterVersion + provider snapshot + project-root fingerprint + normalized query。失效条件: snapshot 变 / HEAD 变 / dirty hash 变 / adapterVersion 变 / config 变 / TTL 到期。**缓存命中不得把 stale 结果改写为 fresh**(结果仍携带原始 freshness)。

## 5. Post-Commit Integration

post-commit 只: 检测源变更 → 刷新 Native Lite file hashes → snapshot 不同则标记 cached Provider 结果 stale → 刷新 governance file/commit 链接 → 建议 Provider sync 命令。**不隐式跑 `codegraph sync`**;index stale 时 governance report 提示用户手动运行。避免两个工具同时控制同一自动同步生命周期。

## 6. Failure Isolation

Provider missing → "CodeGraph not installed. Native Lite active. Symbol/impact unavailable.";not indexed → 提示用户自行 `codegraph init`(不自动执行);timeout → 杀子进程 + diagnostic + 该请求降级 + 不永久禁用 + 连续失败可短暂 circuit-break;schema drift → compatibility warning + 停用单项能力 + 其他能力继续 + 保存截断 diagnostic(不存大段可能含源码的原始输出);stale index → 结果保留但显式标 `STALE indexed:<sha> current:<sha>`,不得把旧结果当作当前事实;external license(非 MIT Provider)→ status 显示许可证、由用户独立安装、不作强制依赖。

## 7. Testing & Dogfood

- Contract fixtures(committed)覆盖 status/search/callers/callees/impact normalization + unknown/missing fields + malformed JSON + timeout + process exit;Provider failure 不改现有 Architecture IR;Provider query 不写源代码。
- **Optional live dogfood**(不进普通 CI,但 closure 前必须生成 `docs/code-perception-codegraph-dogfood.md`): 记录 create-evo-lite commit、CodeGraph version、Adapter version、provider status、search / callers-callees / impact / current-focus query、Task-to-Code result、stale-index test、fallback test、observed limitations。

## 8. Directory Layout(本 spec 涉及)

```text
templates/cli/code-perception/
├── providers/codegraph.js   # adapter
├── governance-linker.js     # Task/Commit/Evidence → Code links
├── cache.js
└── status.js
templates/cli/test/fixtures/code-perception/codegraph-*.json
docs/code-perception-codegraph-dogfood.md
```
Runtime mirror byte-identical。

## 9. Delivery Phases

### Phase 2 — CodeGraph Adapter
check / version / status / files / query / callers / callees / impact / opaque source context / version compatibility / fixture tests。

### Phase 3 — Governance Linker
Task-to-File / Task-to-Symbol / Commit-to-File / Commit diff-range→symbol / Evidence-to-Code / Active Focus context。

## 10. Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-codegraph-adapter",
      "description": "The CodeGraph adapter invokes only allowlisted CLI commands through execFile/spawn without a shell; normalizes status/files/query/callers/callees/impact JSON fixtures; treats explore/node output as opaque context; and does not read or modify .codegraph internals.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/providers/codegraph.js", "templates/cli/test/fixtures/code-perception/"]
    },
    {
      "id": "ac-governance-linker",
      "description": "The linker generates confirmed file links from Planning linkedFiles, Git-derived commit links, range-intersection symbol links and evidence links; name-only heuristic links remain proposed with confidence <= 0.5.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/governance-linker.js"]
    },
    {
      "id": "ac-provider-failure-isolation",
      "description": "Provider missing, not indexed, timeout, malformed output and unsupported versions do not break Planning IR, Architecture IR, memory or verify; Native Lite remains available, cached stale results stay visibly stale, and diagnostics are actionable.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["templates/cli/code-perception/providers/codegraph.js", "templates/cli/code-perception/cache.js"]
    },
    {
      "id": "ac-live-codegraph-dogfood",
      "description": "A committed dogfood artifact records a real CodeGraph-backed run on create-evo-lite. Because a governance test can only prove the artifact exists and its fields are present — not that it came from a real run — closure additionally requires a dedicated artifact validator asserting providerVersion, adapterVersion, repository commit, captured command/result fingerprints, and a closure-evidence commit, alongside the recorded status/search/callers-callees/impact/focus/Task-to-Code/stale/fallback/limitations sections.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
      "dependsOn": ["docs/code-perception-codegraph-dogfood.md", "templates/cli/code-perception/dogfood-validate.js"]
    }
  ]
}
```
