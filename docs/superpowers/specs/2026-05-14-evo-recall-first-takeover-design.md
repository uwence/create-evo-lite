# Evo Recall-First Takeover Design

Date: 2026-05-14
Author: GitHub Copilot + uwenc

## 背景 / Background

Evo-Lite 当前已经有显性状态和隐性记忆两条线，但新会话接管时并不会默认把记忆真正拉进决策面。

- [README.md](../../../README.md) 已经把当前模型定义为 `active_context` 驾驶舱、`context track / archive` durable 主链、`remember` 轻量 recall 缓存。
- [docs/REMEMBER_BOUNDARY_DECISION.md](../../REMEMBER_BOUNDARY_DECISION.md) 明确要求 `remember` 保持 lightweight searchable cache，而不是第二条长期资产链。
- [.agents/workflows/evo.md](../../../.agents/workflows/evo.md) 要求 `/evo` 接管时读取 [active_context.md](../../../.evo-lite/active_context.md)、运行 verify、自检架构与风险，但没有要求默认 recall 历史经验。
- 当前 bootstrap 运行路径在 [.evo-lite/cli/memory.js](../../../.evo-lite/cli/memory.js) 的 `runBootstrapCommand()` 中，只组合 `summarizeActiveContext()`、`verify()` 与 `inspectHookLifecycle('sessionstart')`，最终交给 `formatBootstrapReport()` 输出；这条路径没有调用 recall。
- recall 本身已经存在于 [.evo-lite/cli/memory.service.js](../../../.evo-lite/cli/memory.service.js) 的 `recall()` 中，说明问题不是“没有记忆能力”，而是“接管协议没有默认消费记忆”。

这会带来一个实际产品缺口：memory 会持续积累，但 agent 在新 session 最关键的接管点仍可能只看显性状态，不看历史经验，导致重复解释、重复踩坑、或者按错误顺序开始检查。当前仓库的实际 dogfood 也证明 recall 对具体术语有效，对抽象问法较弱，因此需要一个明确的、锚点驱动的 recall-first takeover 设计，而不是更重的自动注入系统。

## 目标 / Goals

1. `/evo` 与 `bootstrap` 接管必须在最终 takeover 总结前执行一次有界的 targeted recall。
2. recall query 必须来自当前显性状态锚点，而不是自由发挥式 prompt 改写；首期锚点仅允许来自 FOCUS、最近 TRAJECTORY 标签、verify 治理术语。
3. 接管输出必须显式告诉用户：是否执行了记忆检索、用了哪些 query、是否命中、哪些命中改变了下一步。
4. recall 未命中时必须优雅回退为 fresh takeover 口径，而不是静默忽略。
5. V1 不改变 durable 主链 `active_context -> context track -> archive`，不引入 worker、常驻服务、system prompt 自动注入、embedding、schema 迁移。
6. V1 必须同时覆盖 live runtime 与 template mirror，避免 verify 再次出现 active/template 漂移。

## 方案选择 / Options Considered

### 方案 A: Recall-First Targeted Takeover（采纳）

在 `/evo` / `bootstrap` 接管里增加一个 bounded recall 步骤，从显性状态抽 1 到 3 个 query，命中后只输出会改变下一步的历史约束。

为什么采纳：

- 与 [docs/AI_AGENT_DEFENSE_ARCHITECTURE.md](../../AI_AGENT_DEFENSE_ARCHITECTURE.md) 的“项目内最小闭环运行时”边界一致。
- 与 [docs/REMEMBER_BOUNDARY_DECISION.md](../../REMEMBER_BOUNDARY_DECISION.md) 不冲突，remember 仍然只是 recall 缓存，不会升格为 durable 主链。
- 吸收了 context-mode 的核心纪律: resume 时先 search，再问人；但不引入它的整套外部插件边界。
- 能直接回应当前产品问题: 让 memory 在最高价值的接管时刻默认参与，而不是为了记而记。

### 方案 B: Auto Context Injection（不采纳）

参考 claude-mem 的 SessionStart / before_prompt_build 自动注入做法，在每个新 session 一开始就把历史上下文灌入 prompt。

为什么不采纳：

- 会把 Evo-Lite 从“项目内最小治理运行时”拉向“常驻记忆平台”。
- 需要更多宿主 hook、token 预算、worker/service 管理与上下文污染控制。
- 与当前仓库最近几轮围绕 bootstrap、hook ownership、最小治理面的演化方向不一致。

### 方案 C: Remember Promotion / Dual Durable Paths（不采纳）

给 `remember` 增加 promotion 或双写，让轻量记忆自动转成 archive 资产。

为什么不采纳：

- 会直接模糊 `remember` 与 `archive` 的边界。
- 当前首要问题是“agent 不先查”，不是“持久化路径不够多”。
- 如果没有先证明 recall-first 接管确实能提升体验，过早改 durable 边界只会增加认知负担。

## 架构 / Architecture

### 受影响层次

- Protocol / Workflow layer: [.agents/workflows/evo.md](../../../.agents/workflows/evo.md)、[README.md](../../../README.md)、[docs/AI_AGENT_DEFENSE_ARCHITECTURE.md](../../AI_AGENT_DEFENSE_ARCHITECTURE.md)
- Runtime layer: [.evo-lite/cli/memory.js](../../../.evo-lite/cli/memory.js)、[.evo-lite/cli/memory.service.js](../../../.evo-lite/cli/memory.service.js)
- Template mirror layer: [templates/cli/memory.js](../../../templates/cli/memory.js)、[templates/cli/memory.service.js](../../../templates/cli/memory.service.js)
- Regression layer: [.evo-lite/cli/test.js](../../../.evo-lite/cli/test.js)、[templates/cli/test.js](../../../templates/cli/test.js)

### 模块改动建议

1. 在 [.evo-lite/cli/memory.service.js](../../../.evo-lite/cli/memory.service.js) 增加 takeover recall orchestration：
   - 从 `summarizeActiveContext()` 结果中提取 focus 与 recent trajectory anchors。
   - 从 `verify()` 结果中提取少量治理锚点。
   - 生成最多 3 个 recall query。
   - 对 recall 结果做极短的 actionable summary，只保留会改变下一步的命中。

2. 在 [.evo-lite/cli/memory.js](../../../.evo-lite/cli/memory.js) 改造 bootstrap path：
   - `runBootstrapCommand()` 在拿到 `context` 和 `verify` 后调用新的 takeover recall service。
   - `formatBootstrapReport()` 输出新的 `memory_*` 字段，保证 human/text 与 `--json` 输出都能反映 recall 结果。

3. 在 [templates/cli/memory.js](../../../templates/cli/memory.js) 与 [templates/cli/memory.service.js](../../../templates/cli/memory.service.js) 做镜像同步，确保新脚手架继承同样行为。

4. 在回归测试层增加 recall-first takeover 的正反例，防止未来回归成“有 recall 能力，但 bootstrap 不用”。

### 运行时临时数据契约

V1 不引入新的持久化表，只在 bootstrap 流程中构造一个短生命周期的 recall bundle：

```js
const takeoverRecall = {
  status: 'matched', // 'matched' | 'no-match' | 'skipped'
  queries: [
    { source: 'trajectory-tag', text: 'HookRuntimeDogfood' },
    { source: 'trajectory-phrase', text: 'hook dogfood' },
    { source: 'focus-keyword', text: 'runtime hook' }
  ],
  hits: [
    {
      query: 'hook dogfood',
      memoryId: 41,
      label: 'HookRuntimeDogfood',
      reason: 'template-only edits do not count as live runtime dogfood',
      effect: 'inspect live .evo-lite hook path before syncing templates'
    }
  ]
};
```

这个 bundle 只服务于当前 takeover 输出，不进入 durable archive，也不回写 `memory.db`。

## API & 契约 / Contracts

### CLI / bootstrap 输出契约

`node .evo-lite/cli/memory.js bootstrap` 与宿主 wrapper 的 bootstrap 等价输出，需要新增以下字段：

- `memory_status: matched | no-match | skipped`
- `memory_query: <source>:<text>`，最多 3 行
- `memory_hit: <label>`，仅对 actionable 命中输出
- `memory_effect: <what changes next>`，仅对 actionable 命中输出

无命中时的最小口径：

```text
memory_status: no-match
memory_effect: fresh-takeover
```

### 内部服务契约

`recall(query, topK = 5)` 现有契约保持不变。V1 在其上增加一个 takeover-specific orchestrator，而不是重写 recall 本身。

建议的内部契约：

```js
async function buildTakeoverRecall(contextSummary, verifyReport) {
  return {
    status: 'matched' | 'no-match' | 'skipped',
    queries: [],
    hits: []
  };
}
```

### REST / Socket / Config

- REST endpoints: 不适用。V1 不新增 HTTP 接口。
- Socket.IO channels: 不适用。V1 不新增推送通道。
- localStorage / config keys: 不适用。V1 不引入新的用户配置键。
- Hook lifecycle contract: `inspectHookLifecycle('sessionstart')` 继续只提供治理提醒，不承担自动上下文注入职责。

## 持久化 & 迁移 / Persistence & Migration

V1 不涉及持久化格式变更。

- 不新增 `memory.db` 表结构。
- 不新增 `raw_memory/` frontmatter 字段。
- 不要求 schema version bump。
- 不要求 rebuild 或数据迁移。

本设计唯一依赖的是现有 recall 能力读取已存在的 `raw_memory` / FTS 数据。如果未来需要 alias 持久化、remember promotion 或 recall quality metadata，应单独立项，而不是在本设计中顺带引入。

## 测试策略 / Testing

当前仓库没有通用 `npm test` 脚本，runtime 回归以 Node 脚本为主，因此 V1 的测试策略应落到真实现有文件与命令上。

### 自动化回归

在 [.evo-lite/cli/test.js](../../../.evo-lite/cli/test.js) 增加以下覆盖：

1. bootstrap path 在 recall 完全未命中时输出 `memory_status: no-match`，并保留 fresh takeover 口径。
2. 当 recent trajectory 含有具体标签时，会生成 bounded queries，而不是把整个 focus 段落原样拿去 recall。
3. 当 recall 命中 actionable 历史时，bootstrap 输出会包含 `memory_hit` 与 `memory_effect`，且 effect 会改变建议下一步的顺序。
4. 当 recall 只命中噪声或不具约束价值的结果时，这些结果不会进入主摘要。

在 [templates/cli/test.js](../../../templates/cli/test.js) 同步镜像覆盖，避免 template drift。

### 手工 smoke

建议至少做两条手工 smoke：

1. 在仓库根目录执行 `.\.evo-lite\mem.cmd bootstrap`，验证首屏能显示 memory search status。
2. 先通过 `remember` 或已有 dogfood 数据制造一个可命中的具体标签，再执行 bootstrap，确认输出中的下一步顺序真的变化。

### 建议命令

- `node .evo-lite/cli/test.js`
- `npm run test:dogfood-hook`
- `.\.evo-lite\mem.cmd bootstrap`

## 风险 / Risks & Mitigations

### 风险 1: query 仍然过于抽象，导致 recall 命中率低

缓解：首期只允许锚点驱动 query，固定优先级为 trajectory label > label phrase expansion > focus keyword；不允许整段自然语言直接进 recall。

### 风险 2: 历史记忆与当前显性状态冲突，导致接管被旧事实带偏

缓解：明确协议优先级为 `active_context + verify + working tree > recall`。命中冲突时要显式报告冲突，不允许 silently override 当前状态。

### 风险 3: 输出区块膨胀，首屏重新变噪声

缓解：最多 3 个 query、每个 query 最多 1 条 actionable hit、主摘要最多 3 条历史命中。

### 风险 4: live runtime 和 template mirror 再次漂移

缓解：把 live/template 改动当成一个 slice 设计；测试层同步覆盖；继续依赖 verify 的 template sync 检查。

### 风险 5: 团队误解为“remember 已经等同 archive”

缓解：文档与输出中持续强调 recall 只是 evidence layer，不改变 durable 主链；必要时在 README 的 dual-lane 模型里补一句 recall-first takeover 说明。

## 里程碑 / Milestones

### Milestone 1: 设计冻结

- 确认 recall-first takeover 的边界、输出契约和非目标。

### Milestone 2: Runtime 接入

- 在 live runtime 中完成 query 生成、recall bundle、bootstrap 输出接线。

### Milestone 3: Template 与回归同步

- 同步 templates 镜像与测试，确保 scaffold 行为一致。

### Milestone 4: Dogfood 验证

- 用已有 repo memory / dogfood 数据做手工接管 smoke，验证 recall 命中是否真正改变下一步顺序。

Please review and request changes before I create the implementation plan.