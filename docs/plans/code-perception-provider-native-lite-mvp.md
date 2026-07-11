---
id: plan:code-perception-provider-native-lite-mvp
status: draft
linkedSpec: spec:code-perception-provider-native-lite
created: 2026-07-11
---

# Code Perception: Provider Contract & Native Lite — MVP Plan (sub-spec ①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 provider-agnostic 的代码感知底座——`CodePerceptionProvider` 契约、统一三态状态模型、归一化引用/结果模型、allowlist-only loader、capability router、以及零依赖且路径安全的 Native Lite fallback,全部由 committed fixture 与 contract test 验证。

**Architecture:** 新模块目录 `templates/cli/code-perception/`,纯库层(无 CLI 注册,`mem code` 命令属子 spec ③)。所有能力经 governance 测试直接 require 模块 + fixture provider 验证,不依赖任何外部工具。复用现有 harness/planning/architecture IR 读取与 sync-runtime 镜像机制。

**Tech Stack:** Node.js (CommonJS)、现有 `test/harness.js`、`git` CLI(只读 ls-files/diff)。零新依赖。

## Global Constraints(binding,逐条来自 spec 与本轮复审)

- **统一三态状态模型**(禁 boolean):`FreshnessState = "fresh"|"stale"|"unknown"`、`DirtyState = "clean"|"dirty"|"unknown"`、`CompatibilityState = "supported"|"untested"|"unsupported"|"unknown"`、`IndexState = "ready"|"missing"|"stale"|"not-required"|"unknown"`。normalize/router/native-lite 共用同一套。
- **Availability 用 `ready` + `indexState`**,不用 `indexed:boolean`;Native Lite 的 `indexState = "not-required"`、`ready = true`。
- **Router 排除"不 ready 或不具备请求能力"的 Provider**,不笼统排除 unindexed;`impact` 无结构 Provider 时返回显式 unavailable,**不得把 file dependency 猜测包装为 Impact**。
- **Loader allowlist-only**:只加载代码内注册的 factory;配置只选 provider id + 允许参数;禁配置任意 module path / `require`/`import` 路径 / 执行任意 JS。
- **Native Lite 文件系统安全**:每个路径 workspace-relative normalize → read/hash 前 `lstat + realpath containment`,不跟随逃逸工作区的 symlink(symlink 只作 metadata 或排除),跳过 binary/ignored/超上限文件,read+hash 有大小上限,不持久化源码/凭据/secrets。
- **本 spec 不含任何 CodeGraph 命令执行/探测**——那属子 spec ②;`check()` 探测逻辑由各 provider 自负,loader/router 保持 provider-agnostic。
- CommonJS,零新依赖,风格与 `templates/cli/planning/*.js` 一致(4 空格缩进)。
- 新 `templates/cli/code-perception/**` 文件登记进 `template-manifest.js` core-cli family;`sync-runtime` 双跑零变更,`.evo-lite/cli` 镜像 byte-identical。
- `node ./.evo-lite/cli/test.js governance` 全程绿;不改动现有 plan 闭环。

## Design Notes(实现者必读——模块导出契约)

### `code-perception/provider-contract.js`
```js
module.exports = {
  FRESHNESS: Object.freeze({ FRESH:'fresh', STALE:'stale', UNKNOWN:'unknown' }),
  DIRTY: Object.freeze({ CLEAN:'clean', DIRTY:'dirty', UNKNOWN:'unknown' }),
  COMPAT: Object.freeze({ SUPPORTED:'supported', UNTESTED:'untested', UNSUPPORTED:'unsupported', UNKNOWN:'unknown' }),
  INDEX: Object.freeze({ READY:'ready', MISSING:'missing', STALE:'stale', NOT_REQUIRED:'not-required', UNKNOWN:'unknown' }),
  CAPABILITY_KEYS,          // frozen array of the 15 capability names
  validateProvider(provider) => { valid: boolean, diagnostics: [{code,message}] },
};
```
`validateProvider` 检查: `id`(非空 string)、`name`、`adapterVersion`、`capabilities`(含全部 CAPABILITY_KEYS 且值为 boolean)、`check`/`getStatus` 为函数;可选方法若存在须为函数。任一失败 → `valid:false` + **该 provider 的隔离 diagnostic**(不抛异常)。

### `code-perception/normalize.js`
```js
module.exports = {
  makeReferenceId(providerId, providerEntityId) => `code-ref:${providerId}:${sha1_12(providerEntityId)}`,
  normalizeReference(providerId, raw) => CodeReference,     // 保留 providerEntityId 原值
  normalizeSearchResult(providerStatus, rawMatches) => UnifiedSearchResult,
  normalizeRelationship(providerId, src, tgt, kind, confidence) => UnifiedRelationship,
  normalizeImpactResult(providerStatus, raw) => UnifiedImpactResult,
};
```
`snapshot.freshness`/`dirty` 用三态枚举透传,不新造 boolean。**禁按 name 合并不同 provider 实体**(id 含 providerId + entity hash)。

### `code-perception/provider-loader.js`
```js
const REGISTRY = Object.freeze({ 'provider:native-lite': () => require('./native-lite').create(), 'provider:fixture-code': () => require('./providers/fixture-code').create() });
module.exports = {
  REGISTRY_IDS,   // Object.keys(REGISTRY)
  loadProviders(config = {}) => { providers: Provider[], diagnostics: [{code,message,providerId?}] },
};
```
`loadProviders`: 只认 `config.codePerception.providers[].id` ∈ REGISTRY;未知 id → 忽略 + diagnostic `unknown-provider`;**永不 `require` 配置提供的路径**;factory 抛错 → diagnostic `provider-load-failed` 且不影响其他 provider;Native Lite 永远包含在返回集合(fallback 保底)。

### `code-perception/provider-router.js`
```js
module.exports = {
  selectProvider(request, providers) => { provider: Provider|null, fallback: 'provider:native-lite'|null, degraded: boolean, diagnostics: [], reason?: string },
};
```
入参 `request = { capability, preferredProvider?, allowFallback }`,`providers` 为 loader 输出(每个带其 `getStatus()` 缓存或现算的 `ProviderStatus`)。算法见 spec §5.2。`impact` 且唯一可用是 native-lite(其 `capabilities.impact === false`)→ `provider:null, degraded:true`,reason=`No indexed provider exposes impact analysis`,**不 fallback 成假 Impact**。

### `code-perception/native-lite.js`
```js
module.exports = {
  create() => Provider,   // id 'provider:native-lite'
};
// Provider.capabilities: files/source/modules = true; 其余全 false
// getStatus(ctx) => { ready:true, indexState:'not-required', dirty, freshness:'fresh', compatibility:'supported', capabilities, diagnostics:[] }
// getFiles(ctx, {}) => CodeReference[] (kind 'file', provenance.method 'native-file')
// helpers: resolveContainedPath(root, rel) (lstat+realpath containment, symlink refuse), moduleOfFile(archIR, rel), tasksDeclaringFile(planIR, rel)
```
数据源: `git ls-files`(+ eligible untracked)、Architecture IR(`.evo-lite/generated/architecture/architecture-ir.json`)module→files、Planning IR(`plan-ir.json`)task.linkedFiles、`git diff` changed files、content hashes。**symbol/callers/callees/impact/flows 一律经 capabilities=false 显式 unavailable。**

### `code-perception/providers/fixture-code.js`
从 `test/fixtures/code-perception/*.json` 读预置结构,实现契约的 search/getCallers/getCallees/impact/getStatus,`capabilities.symbols=true` 等——**纯 fixture,不跑任何外部进程**。用于 router/failure/freshness 测试。

## Tasks

### Phase 0 — Contract & Fixtures

- [ ] [task:cp-state-contract] provider-contract.js: 三态枚举 + capability keys + validateProvider
  - files: templates/cli/code-perception/provider-contract.js
  - verify: node templates/cli/test.js governance
  - acceptance: 导出 FRESHNESS/DIRTY/COMPAT/INDEX 冻结枚举、CAPABILITY_KEYS(15 项)、validateProvider;一个完整合法 provider 对象 `valid:true`;缺 id / capabilities 非全 boolean / check 非函数的三个坏 provider 各 `valid:false` 且 diagnostics 指明原因;validateProvider 绝不抛异常(坏输入返回结构化 diagnostic)
  - test-first: governance.js 新增「T-cp-contract」,构造 good + 3 bad provider fixtures 断言;红→绿

- [ ] [task:cp-normalize] normalize.js: reference id + 三态透传的归一化
  - files: templates/cli/code-perception/normalize.js
  - verify: node templates/cli/test.js governance
  - acceptance: makeReferenceId 产出 `code-ref:<provider>:<12hex>`;两个不同 providerId 但同 name/entity 的引用 id 不相等(禁 name 合并);normalizeReference 保留原 providerEntityId;normalizeSearch/Impact 结果的 snapshot.freshness/dirty 为三态枚举值(非 boolean);normalizeRelationship kind 限定在 calls/called_by/imports/imported_by/references/tests/affected_by
  - test-first: governance.js 增「T-cp-normalize」,红→绿

- [ ] [task:cp-fixture-provider] providers/fixture-code.js + fixtures: 契约用假 provider
  - files: templates/cli/code-perception/providers/fixture-code.js, templates/cli/test/fixtures/code-perception/fixture-status.json, templates/cli/test/fixtures/code-perception/fixture-query.json, templates/cli/test/fixtures/code-perception/fixture-callers.json, templates/cli/test/fixtures/code-perception/fixture-impact.json
  - verify: node templates/cli/test.js governance
  - acceptance: fixture-code.create() 返回的 provider 通过 validateProvider;getStatus 返回三态 status(ready/indexState/freshness/compatibility);search/getCallers/impact 从 fixture JSON 读并经 normalize 输出 UnifiedSearchResult/Relationship/Impact;不启动任何子进程(测试内可断言无 execFile 调用)
  - test-first: governance.js 增「T-cp-fixture」,红→绿

- [ ] [task:cp-loader] provider-loader.js: allowlist-only + 隔离
  - files: templates/cli/code-perception/provider-loader.js
  - verify: node templates/cli/test.js governance
  - acceptance: loadProviders 只返回 REGISTRY 内 id;config 指定未知 id → 忽略 + diagnostic `unknown-provider`;config 指定 `{ id:'provider:evil', module:'../../evil.js' }` 或任意 path **不被 require**(断言 evil 模块未加载);某 factory 抛错 → diagnostic `provider-load-failed` 且其他 provider 仍返回;Native Lite 恒在返回集合内
  - test-first: governance.js 增「T-cp-loader」含 arbitrary-module-path 拒绝断言,红→绿

### Phase 1 — Router & Native Lite

- [ ] [task:cp-router] provider-router.js: capability routing + no-silent-substitution + freshness
  - files: templates/cli/code-perception/provider-router.js
  - verify: node templates/cli/test.js governance
  - acceptance: selectProvider 按 capability 选 provider;精确 preferredProvider 优先;结构 provider 先于 enrichment(对结构能力);无结构 provider 时选 Native Lite 且 degraded=true;请求 `impact` 而唯一可用是 native-lite(capabilities.impact=false)→ provider=null/degraded/reason="No indexed provider exposes impact analysis",**不返回 native-lite 假冒 impact**;两个同能力 provider 一 fresh 一 stale → 选 fresh(stale 仍可被显式请求但排在后)
  - test-first: governance.js 增「T-cp-router」用 fixture-code(structural)+ native-lite + 一个 stale fixture,红→绿

- [ ] [task:cp-native-lite] native-lite.js: provider:native-lite + 文件系统安全
  - files: templates/cli/code-perception/native-lite.js
  - verify: node templates/cli/test.js governance
  - acceptance: capabilities files/source/modules=true 其余 false;getStatus ready=true/indexState='not-required'/freshness 三态;getFiles 返回 tracked 文件的 CodeReference(kind file, provenance.method 'native-file')带 contentHash;能报文件所属 Architecture module + 声明关联该文件的 Task(读 IR);symbol/impact 经 capabilities=false 显式 unavailable;**路径安全**: 请求 realpath 落在 workspace 外的文件 → 排除/不读;指向工作区外的 symlink → 不跟随(排除或仅 metadata);超大小上限文件跳过;不写任何源码/secret 到磁盘
  - test-first: governance.js 增「T-cp-native-lite」用 createTempRuntimeRoot 造 git repo + 假 arch-ir/plan-ir + 一个越界 symlink(guard-skip 无权限 FS)+ 一个超限文件,红→绿

- [ ] [task:cp-manifest-sync] 登记 manifest + mirror 同步 + 全量回归
  - files: templates/cli/template-manifest.js, .evo-lite/cli/code-perception/
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: core-cli family files 加入 6 个 code-perception 文件 + 4 个 fixture JSON;第二次 sync-runtime copied:0;.evo-lite/cli 镜像与 templates/cli byte-identical(含 code-perception/**);`node ./.evo-lite/cli/test.js governance` 绿;registry/其他治理无回归
