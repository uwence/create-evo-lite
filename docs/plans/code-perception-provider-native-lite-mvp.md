---
id: plan:code-perception-provider-native-lite-mvp
status: done
linkedSpec: spec:code-perception-provider-native-lite
created: 2026-07-11
---

# Code Perception: Provider Contract & Native Lite — MVP Plan (sub-spec ①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 provider-agnostic 的代码感知底座——`CodePerceptionProvider` 契约(含 capability-method 一致性 + 三态校验)、统一三态状态模型、归一化引用/结果模型、role-aware allowlist-only loader(生产仅 Native Lite,支持测试注入)、两阶段 router(async inspection + 纯选择)、以及零依赖且路径安全、资源有界的 Native Lite fallback,全部由 committed fixture 与 contract test 验证。

**Architecture:** 新模块目录 `templates/cli/code-perception/`,纯库层(无 CLI 注册,`mem code` 属子 spec ③)。fixture provider 属**测试资产**放 `test/fixtures/`,不进生产 registry。所有能力经 governance 测试直接 require 模块 + 注入 fixture provider 验证,不依赖任何外部工具。复用现有 harness / planning IR / architecture IR / sync-runtime 镜像机制。

**Tech Stack:** Node.js (CommonJS)、现有 `test/harness.js`、`git` CLI(只读 `ls-files`/`diff`)、`crypto`(sha256)。零新依赖。

## Global Constraints(binding,逐条来自 spec 与两轮复审)

- **统一三态状态模型**(禁 boolean):`FreshnessState="fresh"|"stale"|"unknown"`、`DirtyState="clean"|"dirty"|"unknown"`、`CompatibilityState="supported"|"untested"|"unsupported"|"unknown"`、`IndexState="ready"|"missing"|"stale"|"not-required"|"unknown"`。normalize/router/native-lite 共用。
- **Availability 用 `ready`+`indexState`**,不用 `indexed:boolean`;Native Lite `indexState="not-required"`、`ready=true`。
- **Router 两阶段**:`inspectProviders`(async,await check/getStatus + 异常隔离)产出 candidates;`selectProvider`(纯同步)对 candidates 决策。排除"不 ready 或不具备请求能力"的 provider,不笼统排除 unindexed。
- **无 ready 且支持 impact 的 provider → 显式 unavailable**,reason 用 **ready-centric** 文案 `"No ready provider exposes impact analysis"`,**不得**把 file dependency 包装为 Impact,不得回落 index-centric 语义。
- **role 是一等模型**:`ProviderRegistration = { provider, role:'structural-primary'|'enrichment'|'fallback', source:'builtin'|'configured', options }`。结构 role 对结构能力优先于 enrichment。
- **Loader allowlist-only + 生产仅 Native Lite**:`DEFAULT_REGISTRY` 只含 `provider:native-lite`(role fallback);`loadProviders(config, { registry = DEFAULT_REGISTRY })` 支持测试注入;配置只选 id + 允许参数,**禁**配置任意 module path / require/import 路径 / 执行任意 JS;未知 id → 忽略 + diagnostic;factory 抛错 → diagnostic + 其他 provider 不受影响。**fixture provider 绝不进生产 registry。**
- **Native Lite 文件系统安全 + 资源预算**(固定常量,禁 subagent 自造):`MAX_FILE_BYTES=1*1024*1024`、`MAX_TOTAL_HASH_BYTES=32*1024*1024`、`MAX_FILES=10000`、`CONTENT_HASH='sha256'`。路径排序后确定性处理;read/hash 前 `lstat + realpath containment`,**用验证后的 realpath 读取,不复用 logical symlink path**;不跟随逃逸工作区的 symlink(排除或仅 metadata);binary detection = 前 8 KiB 出现 NUL 字节;超预算 → diagnostic,**不静默截断成"完整结果"**;不持久化源码/凭据/secrets。
- **文件枚举**:`git ls-files --cached --others --exclude-standard`(覆盖 tracked + eligible untracked + `.gitignore`)。**`.evoignore` 本 MVP 不实现**,移出并记 follow-up(不让 subagent 临时发明与 gitignore 似是而非的语法)。
- **本 spec 不含任何 CodeGraph 命令执行/探测**——属子 spec ②;`check()` 探测由各 provider 自负,loader/router 保持 provider-agnostic。
- CommonJS,零新依赖,风格随 `templates/cli/planning/*.js`(4 空格缩进)。新 `code-perception/**` 生产文件登记进 `template-manifest.js` core-cli family;`sync-runtime` 双跑零变更,`.evo-lite/cli` 镜像 byte-identical。`node ./.evo-lite/cli/test.js governance` 全程绿;不改现有 plan 闭环。

## Design Notes(实现者必读——模块导出契约)

### `code-perception/provider-contract.js`
```js
module.exports = {
  FRESHNESS: Object.freeze({ FRESH:'fresh', STALE:'stale', UNKNOWN:'unknown' }),
  DIRTY:     Object.freeze({ CLEAN:'clean', DIRTY:'dirty', UNKNOWN:'unknown' }),
  COMPAT:    Object.freeze({ SUPPORTED:'supported', UNTESTED:'untested', UNSUPPORTED:'unsupported', UNKNOWN:'unknown' }),
  INDEX:     Object.freeze({ READY:'ready', MISSING:'missing', STALE:'stale', NOT_REQUIRED:'not-required', UNKNOWN:'unknown' }),
  CAPABILITY_KEYS,                 // frozen 15-name array
  // capability -> required query method. incrementalIndex is status-only (no method).
  CAPABILITY_METHOD: Object.freeze({
    files:'getFiles', modules:'getFiles',
    symbols:'search', semanticSearch:'search',
    source:'getEntity',
    callers:'getCallers', callees:'getCallees',
    impact:'impact', affectedTests:'getAffectedTests',
    trace:'explore', flows:'explore', summaries:'explore', layers:'explore', tours:'explore',
  }),
  STATUS_ONLY_CAPABILITIES: Object.freeze(['incrementalIndex']),
  validateProvider(provider) => { valid, diagnostics:[{code,message}] },
  validateAvailability(a)   => { valid, diagnostics:[] },   // ready:boolean, indexState∈INDEX, available:boolean
  validateStatus(s)         => { valid, diagnostics:[] },   // freshness∈FRESHNESS, dirty∈DIRTY, compatibility∈COMPAT, indexState∈INDEX, ready:boolean
};
```
`validateProvider` 检查: id/name/adapterVersion 非空 string、capabilities 含全部 CAPABILITY_KEYS 且值 boolean、check/getStatus 为函数、**capability-method 一致性(全 15 项覆盖)**——`CAPABILITY_METHOD` 中任一 capability=true → 对应方法必须存在且为函数;`STATUS_ONLY_CAPABILITIES`(incrementalIndex)只影响 status,不要求方法。可选方法若存在须为函数。全部返回结构化 diagnostic,**绝不抛异常**。

契约方法集(可选,由 capabilities 决定必需):`check`/`getStatus`(必需)、`search`、`getEntity`、`getFiles`、`getCallers`、`getCallees`、`impact`、`getAffectedTests`、`explore`。`affectedTests` 用**独立** `getAffectedTests`(子 spec ② 接 CodeGraph `affected` 命令),**不塞进 impact()**。`validateAvailability`/`validateStatus` 拒绝非法枚举值(如 `freshness:false` 或未知字符串)。

### `code-perception/normalize.js`
```js
module.exports = {
  makeReferenceId(providerId, providerEntityId) => `code-ref:${providerId}:${sha256hex(providerEntityId).slice(0,12)}`,
  normalizeReference(providerId, raw) => CodeReference,   // 保留原 providerEntityId;snapshot.{freshness,dirty} 用三态枚举
  normalizeSearchResult(providerStatus, rawMatches) => UnifiedSearchResult,
  normalizeRelationship(providerId, src, tgt, kind, confidence) => UnifiedRelationship,  // kind∈calls/called_by/imports/imported_by/references/tests/affected_by
  normalizeImpactResult(providerStatus, raw) => UnifiedImpactResult,
};
```
**禁按 name 合并不同 provider 实体**(id 含 providerId + entity hash)。

### `code-perception/native-lite.js`
```js
module.exports = { create() => Provider };   // id 'provider:native-lite'
// capabilities: files/source/modules = true; 其余全 false
// getStatus(ctx) => { available:true, ready:true, indexState:'not-required', dirty, freshness:'fresh', compatibility:'supported', capabilities, diagnostics:[] }
// getFiles(ctx, query) => NativeFilesResult
// getEntity(ctx, { filePath, lineRange?, maxChars? }) => ProviderEntityResult   // 因 source=true 必须提供
```
`NativeFilesResult`:
```js
{ provider: ProviderStatus,
  files: [{ reference: CodeReference, moduleId: string|null, declaredByTaskIds: string[], changed: boolean }],
  diagnostics: [{ code, message }] }   // 超预算/跳过项在此
```
`getEntity` 读单文件内容片段(经 realpath containment + MAX_FILE_BYTES + maxChars 上限),返回 `{ reference, content, truncated:boolean, diagnostics }`;越界/binary/超限 → diagnostic 且不返回内容。数据源: `git ls-files --cached --others --exclude-standard`、Architecture IR(`.evo-lite/generated/architecture/architecture-ir.json` 的 `files[].module`)、Planning IR(`.evo-lite/generated/planning/plan-ir.json` 的 `tasks[].linkedFiles`)、`git diff --name-only` changed、content sha256。symbol/callers/callees/impact/flows 经 capabilities=false 显式 unavailable。

### `code-perception/provider-loader.js`
```js
const DEFAULT_REGISTRY = Object.freeze({
  'provider:native-lite': { role: 'fallback', create: () => require('./native-lite').create() },
});
module.exports = {
  DEFAULT_REGISTRY,
  loadProviders(config = {}, { registry = DEFAULT_REGISTRY } = {}) => { registrations: ProviderRegistration[], diagnostics: [{code,message,providerId?}] },
};
```
只认 `config.codePerception.providers[].id` ∈ registry;未知 id → 忽略 + diagnostic `unknown-provider`;**永不 require 配置提供的路径**;factory 抛错 → diagnostic `provider-load-failed` 且其他 registration 仍返回;Native Lite(role fallback)恒在返回集合。每个 registration = `{ provider, role, source:'builtin'|'configured', options }`;configured 项的 role 取自 config,builtin native-lite 固定 fallback。

### `code-perception/provider-router.js`
```js
module.exports = {
  inspectProviders(registrations, context) => Promise<Candidate[]>,   // await check()+getStatus(), 异常隔离成 diagnostic
  selectProvider(request, candidates) => { candidate: Candidate|null, degraded: boolean, diagnostics: [], reason?: string },
};
// Candidate = { registration, role, availability, status, diagnostics }
// request = { capability, preferredProvider?, allowFallback }
```
`selectProvider`(纯同步,exhaustive-testable):
```text
freshness 排序: fresh > unknown > stale
preferredProvider: ready 且支持能力 → 优先; 不 ready/不支持 → diagnostic, 仅 allowFallback=true 才继续; allowFallback=false → candidate:null
候选过滤: availability.ready 且 capabilities[request.capability]===true
role 排序(结构能力): structural-primary > 其他 > fallback; 再按 freshness
无满足候选 + 存在 fallback(native-lite)且该 fallback 支持该能力 → 选 fallback, degraded=true
无满足候选 且 fallback 不支持该能力(如 impact)→ candidate:null, degraded:true, reason="No ready provider exposes <capability> analysis"
```

### fixture provider(测试资产,非生产)
`templates/cli/test/fixtures/code-perception/fixture-provider.js` + `*.json`。实现契约(search/getCallers/impact/getStatus,capabilities.symbols=true 等),从 fixture JSON 读,**不跑任何子进程**。测试经 `loadProviders(config, { registry: injected })` 注入,声明 role structural-primary / enrichment / broken(throwing factory)以驱动 router + 隔离测试。**绝不进 DEFAULT_REGISTRY / manifest 生产文件集。**

## Tasks

### Phase 0 — Contract & Fixtures

- [x] [task:cp-state-contract] provider-contract.js: 三态枚举 + capability-method 校验 + status/availability 校验
  - files: templates/cli/code-perception/provider-contract.js
  - verify: node templates/cli/test.js governance
  - acceptance: 导出 FRESHNESS/DIRTY/COMPAT/INDEX 冻结枚举、CAPABILITY_KEYS(15)、CAPABILITY_METHOD(覆盖除 incrementalIndex 外全部)、STATUS_ONLY_CAPABILITIES、validateProvider/validateAvailability/validateStatus;完整合法 provider `valid:true`;缺 id / capabilities 非全 boolean / `impact:true 无 impact` / `source:true 无 getEntity` / `symbols:true 无 search` / `affectedTests:true 无 getAffectedTests` / `trace:true 无 explore` 各 `valid:false` 且 diagnostic 指明;`incrementalIndex:true 且无额外方法` 仍 `valid:true`(status-only);validateStatus 拒 `freshness:false`、`dirty:'nope'` 等非法枚举;三个 validate 均不抛异常
  - test-first: governance.js 新增「T-cp-contract」构造 good + 各 capability↔method 缺失 bad 断言;红→绿

- [x] [task:cp-normalize] normalize.js: reference id(禁 name 合并)+ 三态透传
  - files: templates/cli/code-perception/normalize.js
  - verify: node templates/cli/test.js governance
  - acceptance: makeReferenceId 产出 `code-ref:<provider>:<12hex>`;不同 providerId 同 name/entity → id 不等;normalizeReference 保留原 providerEntityId;normalizeSearch/Impact 的 snapshot.freshness/dirty 为三态枚举(经 validateStatus 类似校验);normalizeRelationship kind 限定 7 值
  - test-first: governance.js 增「T-cp-normalize」,红→绿

- [x] [task:cp-fixture-provider] test fixtures: 契约用假 provider(测试资产)
  - files: templates/cli/test/fixtures/code-perception/fixture-provider.js, templates/cli/test/fixtures/code-perception/fixture-status.json, templates/cli/test/fixtures/code-perception/fixture-query.json, templates/cli/test/fixtures/code-perception/fixture-callers.json, templates/cli/test/fixtures/code-perception/fixture-impact.json
  - verify: node templates/cli/test.js governance
  - acceptance: fixture-provider.create() 通过 validateProvider(capabilities 与其方法一致);getStatus 返三态 status;search/getCallers/impact 从 fixture JSON 读并经 normalize 输出;测试内断言无 execFile/spawn 调用;该文件在 test/fixtures/ 下(Task 7 会进 manifest 以便 mirror),但**不进 DEFAULT_REGISTRY**——生产 config 无法选中它
  - test-first: governance.js 增「T-cp-fixture」,红→绿

### Phase 1 — Native Lite → Loader → Router → Sync

- [x] [task:cp-native-lite] native-lite.js: provider:native-lite + 文件系统安全 + 资源预算
  - files: templates/cli/code-perception/native-lite.js
  - verify: node templates/cli/test.js governance
  - acceptance: capabilities files/source/modules=true 其余 false 且通过 validateProvider;getStatus ready=true/indexState='not-required'/三态字段;getFiles 返 NativeFilesResult——每项含 reference(kind file, provenance.method 'native-file', contentHash sha256)、moduleId(读 arch IR)、declaredByTaskIds(读 plan IR)、changed(git diff);getEntity 返内容片段且受 MAX_FILE_BYTES/maxChars 限;symbol/impact 经 capabilities=false 显式 unavailable;**路径安全**: realpath 越界文件/逃逸 symlink 不读(diagnostic);超 MAX_FILE_BYTES 文件跳过并 diagnostic(非静默);binary(前 8KiB NUL)排除;文件排序确定性
  - test-first: governance.js 增「T-cp-native-lite」用 createTempRuntimeRoot 造 git repo + 假 architecture-ir.json/plan-ir.json + 越界 symlink(guard-skip 无权限 FS)+ 超限文件 + binary 文件,红→绿

- [x] [task:cp-loader] provider-loader.js: role-aware allowlist(生产仅 native-lite)+ 注入 + 隔离
  - files: templates/cli/code-perception/provider-loader.js
  - verify: node templates/cli/test.js governance
  - acceptance: DEFAULT_REGISTRY 只含 provider:native-lite(role fallback);loadProviders 默认只返回 native-lite registration;config 指定未知 id → 忽略 + diagnostic `unknown-provider`;config `{ id:'x', module:'../../evil.js' }` 的 module 字段**不被 require**(断言 evil 未加载);经 `{ registry }` 注入 broken factory → diagnostic `provider-load-failed` 且注入的其他 registration 仍返回;每个 registration 带 role/source
  - test-first: governance.js 增「T-cp-loader」含 arbitrary-module-path 拒绝 + 注入 broken 隔离断言,红→绿

- [x] [task:cp-router] provider-router.js: async inspection + 纯选择 + no-silent-substitution
  - files: templates/cli/code-perception/provider-router.js
  - verify: node templates/cli/test.js governance
  - acceptance: inspectProviders await check/getStatus 并把抛错 provider 隔离成 diagnostic 候选;selectProvider 纯同步;结构能力下 structural-primary(注入 fixture)优先于 enrichment,再 fresh>unknown>stale;preferredProvider ready+支持 → 优先,不 ready 且 allowFallback=false → candidate:null;仅 native-lite(impact=false)请求 impact → candidate:null/degraded/reason="No ready provider exposes impact analysis"(**ready-centric,非 indexed**);无结构 provider 的 files 请求 → 选 native-lite fallback degraded=true
  - test-first: governance.js 增「T-cp-router」用注入 registry(fixture structural + fixture stale + native-lite),红→绿

- [x] [task:cp-manifest-sync] 登记 manifest(5 生产模块 + 5 测试资产)+ mirror 同步 + 全量回归
  - files: templates/cli/template-manifest.js, .evo-lite/cli/code-perception/
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: manifest 加入全部 10 个文件——5 生产模块(provider-contract.js / normalize.js / native-lite.js / provider-loader.js / provider-router.js)**和** 5 测试资产(test/fixtures/code-perception/fixture-provider.js + fixture-status/query/callers/impact.json)。**sync-runtime 只镜像 manifest 逐项列出的文件,不递归拷 test/**,故 fixture 必须进 manifest,否则 `.evo-lite/cli/test/fixtures/` 缺失、runtime governance require fixture 失败。安全边界不靠 manifest 排除,而靠 `DEFAULT_REGISTRY` 仅含 provider:native-lite(测试 provider 不能被生产 config 选中)。第二次 sync-runtime copied:0;.evo-lite/cli 镜像与 templates/cli byte-identical(含 code-perception/** + test/fixtures/code-perception/**);`node ./.evo-lite/cli/test.js governance`(经 .evo-lite runtime)绿;其他治理无回归

## Follow-ups(移出本 MVP)

- `.evoignore` 语法与 matcher(本 MVP 用 `git ls-files --exclude-standard` 覆盖 gitignore;`.evoignore` 待统一 matcher 设计后单独 spec/plan)。
- source 大文件流式/分块读取(本 MVP getEntity 单次上限即可)。
