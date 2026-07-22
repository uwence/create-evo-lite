---
id: spec:codegraph-adapter-governance-linker
status: adopted
created: 2026-07-10
linkedPlan: plan:codegraph-adapter-governance-linker-mvp
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
executable missing    → installed=false, ready=false, indexState=missing
status fails no index → installed=true,  ready=false, indexState=missing
valid JSON status     → available=true,  ready=true,  indexState=ready
```
(统一用 `ready` + `indexState`,不用 `indexed:boolean`——与子 spec ① 的 availability 模型一致。)

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

- **Exact declared**: Task `linkedFiles` → `declares_file`;调用方**显式传入**的 `acceptanceDependencies` → `depends_on_file`;confidence 1.0。当前 Planning IR 每 task 只输出 `linkedFiles`,acceptance `dependsOn` 的自动提取属 Planning IR v2 follow-up——本 MVP Linker 不从 Markdown/文本猜测,只消费 `linkedFiles` 与显式 `acceptanceDependencies` 输入。
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

### 3.5 Known default-pipeline limitation (symbol/evidence links are not reachable end-to-end today)

Linker 的 rule-gated 规则(range-intersection symbol links、`verified_by_test`、`evidenced_by_archive`)要求**结构化输入**:`task.symbols[]`、或带 `symbols`/`commitSha`/`codeReferenceId`/可解析 `filePath` 的 evidence 行。这些规则由 linker 的单元 fixtures 证明。

**但内建 Planning producer 目前不产出这种输入。** `planning/scan.js` 从不填充 `task.symbols`(实测 0/205 task),`task.evidence` 是 opaque 字符串(`- evidence:` 行 + `backfillArchiveEvidence` 的 `archive:<file>.md`,实测 131/131 为字符串,0 对象)。因此在**默认 end-to-end pipeline** 上:

| 能力 | 默认路径 |
|---|---|
| `declares_file` / `changed_by_commit` / `related_to_focus` | 可用(confidence 1.0) |
| `implements_task:proposed`(标题启发式) | 有结构 Provider 且标题命中符号名时可用(≤0.5) |
| `implements_task:derived` / `verified_by_test` / `evidenced_by_archive` | **不可达** —— 无 producer 提供结构化 evidence |

这是一个**尚未接通的 producer-integration gap**,不是已确认的产品能力。fixture 证明的规则**不得被表述为默认产品能力**。接通它属于独立的 follow-up(Evidence IR / Code Reference Bridge,见 §11),由外部验证决定优先级;本 spec 无需现在重写规则本身,但 §10 的 AC 措辞应理解为"linker 规则正确且单测通过",而非"默认 pipeline 端到端产出这些链接"。

## 4. Local Cache

可**持久**缓存: provider status、normalized metadata(search/relationship/impact)、governance links。**仅进程内瞬时**使用(不落盘): opaque source context。**不得持久化**: 源码、getEntity content、explore opaqueText、raw stdout/stderr、Provider 完整 DB/全量 graph、secrets、凭据。(1 MiB 大小上限无法判定内容是否含凭据,故 source context 待有明确 redaction/classification 合同后才可持久化——见 Plan Follow-ups。)
Cache key: providerID + providerVersion + adapterVersion + provider snapshot + project-root fingerprint + normalized query。失效条件: snapshot 变 / HEAD 变 / dirty hash 变 / adapterVersion 变 / config 变 / TTL 到期。**缓存命中不得把 stale 结果改写为 fresh**(结果仍携带原始 freshness)。

## 5. Post-Commit Integration

post-commit 只: 检测源变更 → 刷新 Native Lite file hashes → snapshot 不同则标记 cached Provider 结果 stale → 刷新 governance file/commit 链接 → 建议 Provider sync 命令。**不隐式跑 `codegraph sync`**;index stale 时 governance report 提示用户手动运行。避免两个工具同时控制同一自动同步生命周期。

## 6. Failure Isolation

Provider missing → "CodeGraph not installed. Native Lite active. Symbol/impact unavailable.";not indexed → 提示用户自行 `codegraph init`(不自动执行);timeout → 杀子进程 + diagnostic + 该请求降级 + 不永久禁用 + 连续失败可短暂 circuit-break;schema drift → compatibility warning + 停用单项能力 + 其他能力继续 + 保存截断 diagnostic(不存大段可能含源码的原始输出);stale index → 结果保留但显式标 `STALE indexed:<sha> current:<sha>`,不得把旧结果当作当前事实;external license(非 MIT Provider)→ status 显示许可证、由用户独立安装、不作强制依赖。

## 7. Testing & Dogfood

- Contract fixtures(committed)覆盖 status/search/callers/callees/impact normalization + unknown/missing fields + malformed JSON + timeout + process exit;Provider failure 不改现有 Architecture IR;Provider query 不写源代码。
- **Host-gated live dogfood**(普通 CI **可选**;**Spec closure 强制**): 由 in-plan task `cg-live-dogfood` 在装有真实 CodeGraph 的宿主上产出 `docs/code-perception-codegraph-dogfood.md`,记录 create-evo-lite commit、CodeGraph version、Adapter version、provider status、search / callers-callees / impact / current-focus query、Task-to-Code result、stale-index test、fallback test、observed limitations,并带可重算的 command/result SHA fingerprint。closure 门由 `node ./.evo-lite/cli/test.js governance --require-live-codegraph` 严格模式验证(工件缺失/非法/fingerprint 被篡改 → exit 1)。宿主无 CodeGraph 时该 task 不勾选,Plan 与 Spec 诚实保持 active,不得伪造工件。

## 8. Directory Layout(本 spec 涉及)

```text
templates/cli/code-perception/
├── providers/codegraph-exec.js      # 安全命令执行层(no-shell / timeout / output-cap / ANSI / 网络边界注入)
├── providers/codegraph.js           # adapter
├── governance-linker.js             # Task/Commit/Evidence → Code links
├── cache.js                         # 文件型有界 cache(.evo-lite/.cache/code-perception/,跨进程可 markStale)
├── status.js                        # code-perception 状态汇总 + stale hint
├── dogfood-validate.js              # dogfood 工件验证器(重算 SHA 比对)
└── post-commit-code-perception.js   # §5 post-commit 集成(markStale + 刷新 file/commit links + 建议手动 sync)
templates/cli/test/fixtures/code-perception/
├── codegraph-*.json / *.txt         # 来自 pinned upstream 1.4.1 的 fixture
├── codegraph-fixture-manifest.json  # fixture provenance(upstream/version/commit/captureMethod/sha256)
└── fake-codegraph.js                # 测试用 fake CLI(经 node process.execPath 驱动)
docs/code-perception-codegraph-dogfood.md
```
Runtime mirror byte-identical。（`cache.js` 为文件型的理由: §5 post-commit 是独立进程,无法访问业务进程内的 in-memory Map,故 cache 必须落盘方能被 post-commit `markStale`/invalidate。）

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
      "dependsOn": ["templates/cli/code-perception/providers/codegraph-exec.js", "templates/cli/code-perception/providers/codegraph.js", "templates/cli/test/fixtures/code-perception/"]
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
      "description": "A committed dogfood artifact records a real CodeGraph-backed run on create-evo-lite. Because the plain governance suite only proves the process exit code — not that a real artifact exists — this criterion's verifier runs strict mode (`--require-live-codegraph`), which recomputes the artifact's command/result SHA fingerprints and asserts providerVersion, adapterVersion, repository commit, closure-evidence commit, and the recorded status/search/callers-callees/impact/focus/Task-to-Code/stale/fallback/limitations sections; a missing/invalid/tampered artifact exits non-zero so this AC cannot PASS without a real run.",
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance --require-live-codegraph", "scope": "governance" } },
      "dependsOn": ["docs/code-perception-codegraph-dogfood.md", "templates/cli/code-perception/dogfood-validate.js", "templates/cli/test.js"]
    }
  ]
}
```

## 11. Follow-up (parked): Evidence IR / Code Reference Bridge

**Not `"parse evidence strings"`.** Turning `archive:mem_….md` into `{kind:'archive', archivePath}` does NOT revive `evidenced_by_archive`: the linker requires `codeReferenceId` OR a resolvable code `filePath`, and an archive path is the *source* of evidence, not the code entity it attests. Inferring "this archive proves all of the task's linkedFiles" would fabricate semantics.

**Goal:** an explicit, producer-owned **structured Evidence IR** that can associate a task and its evidence source with a concrete code entity — file, symbol, test, or commit — WITHOUT inferring links from free text. Minimum shape per row:

```text
taskId                       // the owning task; a row must never claim a different one

at least one LINKER SIGNAL:
  symbols?                   // enables implements_task:derived (no code anchor required)
  commitSha?                 // enables implements_task:derived via commit diff-range tie
  codeReferenceId?           // enables verified_by_test / evidenced_by_archive (with kind)
  filePath?                  // resolvable code path — same, when no codeReferenceId

kind                         // 'test' | 'archive' | ... — required for verified_by_test / evidenced_by_archive
archivePath?                 // provenance
sourcePath? / traceability
```

Note: `symbols` / `commitSha` alone ARE valid linker signals (they drive `implements_task:derived`); a code anchor is required only for `verified_by_test` / `evidenced_by_archive`. This matches the service's `hasLinkerSignal` split and the B2 compatibility contract — the Evidence IR must not re-narrow "linkable" back to code anchors.

**Activation:** prioritize only AFTER the Primary-User Multi-Agent Dogfood Sprint (`docs/validation/multi-agent-dogfood-sprint.md`), and only if repeated real-work evidence — agents (or the primary user) needing confirmed Task→Symbol / Evidence→Code relationships beyond declared files and commit links, e.g. agents repeatedly failing to associate tasks with functions — requires it. Until then this is **parked** — the honest default remains file/commit/focus governance. This is the sole sanctioned way to make the dormant M1/M2 seams live; the built-in string-evidence path must never be back-filled with synthesized code anchors.
