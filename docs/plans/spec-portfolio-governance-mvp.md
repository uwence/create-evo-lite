---
id: plan:spec-portfolio-governance-mvp
status: draft
linkedSpec: spec:spec-portfolio-governance
created: 2026-07-10
---

# Spec Portfolio Governance — MVP Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 spec 层补上收编闸门 + 派生状态台账 + 老化 WARN + park/reactivate,让被遗忘的 spec 必然回到 verify 视野。

**Architecture:** 单一新模块 `templates/cli/spec-portfolio.js` 承载全部 portfolio 逻辑(registry 派生、adopt、park、报账格式化),复用 `planning/parse-markdown.js` 的 frontmatter/spec 解析与 plan-ir.json,注册进 memory.js 命令树,verify 末尾挂报账段。人工状态写 spec frontmatter(truth),registry 纯派生可重建。

**Tech Stack:** Node.js (CommonJS)、commander、现有 test/harness.js 测试骨架。零新依赖。

## Global Constraints

- 所有新 templates/cli 文件必须登记进 `template-manifest.js` core-cli family,并保证 `sync-runtime` 双跑零变更(mirror byte-identical)
- 新基因规则文件登记进 agents-rules family
- 退出码约定: 参数无效 exit 2,内部异常 exit 1,degraded 报账 exit 0
- registry 路径固定 `.evo-lite/generated/spec-registry.json`,删除后可由 `mem spec status` 重建,缺失不是错误
- 体量阈值(spec 定死): AC>8、Phase>3、dependsOn 文件>12、字符>40000;老化阈值默认 14 天,可经 `.evo-lite/config.json` `specPortfolio.agingDays` 覆盖
- 不改动现有 plan 闭环与 READY verdict 自动 close 路径;`node ./.evo-lite/cli/test.js all` 全程保持绿

## Design Notes(实现者必读)

### 模块导出契约 `templates/cli/spec-portfolio.js`

```js
module.exports = {
    SIZE_THRESHOLDS,          // { acCount: 8, phaseCount: 3, dependsOnCount: 12, chars: 40000 }
    DEFAULT_AGING_DAYS,       // 14
    buildSpecRegistry,        // (projectRoot, opts?) => registry object; 写 .evo-lite/generated/spec-registry.json
    adoptSpec,                // (projectRoot, filePath, opts) => { id, targetPath, warnings: [], relations: [] }
    parkSpec,                 // (projectRoot, specId, { until }) => { id, status: 'parked' }
    reactivateSpec,           // (projectRoot, specId) => { id, status: 'adopted' | 'active' }
    formatPortfolioReport,    // (registry) => string[]  (verify 报账行, 含 ⚠️ WARN 行)
    registerSpecPortfolioCommands, // (program) => void
};
```

### registry 形状 `evo-spec-registry@1`

```json
{
  "version": "evo-spec-registry@1",
  "generatedAt": "<ISO>",
  "agingDays": 14,
  "specs": [
    {
      "id": "spec:x",
      "file": "docs/specs/x.md",
      "state": "adopted|active|shipped|parked",
      "linkedPlans": ["plan:y"],
      "lastTouchedAt": "<ISO|null>",
      "idleDays": 3,
      "size": { "acCount": 6, "phaseCount": 2, "dependsOnCount": 8, "chars": 12345 },
      "sizeExceeded": false,
      "sizeWaiver": null,
      "relations": [{ "kind": "spawned-from", "target": "spec:z" }],
      "warnings": ["aging-no-plan", "size-exceeded", "zombie-plan"]
    }
  ]
}
```

### 状态派生规则(纯函数,无人工记账)

1. frontmatter `status: done` → `shipped`
2. frontmatter `status: parked` → `parked`;其 linkedPlans 中存在非 done plan → 该 spec 追加 warning `zombie-plan`
3. 无 linkedPlans(经 plan-ir.json `plans[].linkedSpec` 反查 + spec 自身 linkedPlans 双向匹配)→ `adopted`;idleDays > agingDays → warning `aging-no-plan`
4. 有 linkedPlans 且 plan 未 done → `active`;idleDays > agingDays → warning `aging-inactive`
5. `lastTouchedAt` = `git log -1 --format=%cI -- <spec文件> <各linked plan文件>` 的最大值;git 不可用或文件未入库时回退文件 mtime
6. `sizeExceeded` 且 frontmatter 无 `sizeWaiver` → warning `size-exceeded`

### adopt 归一化流程

```text
1. 读入任意路径 draft → parseFrontmatter
2. frontmatter 缺 id → 从文件名/首个 H1 生成 kebab id (spec:<kebab>) 并写入;缺 status → draft→adopted;缺 created → 今日
3. YAML 损坏(parseFrontmatter 返回空且文件以 --- 开头)→ 重建最小合法 frontmatter,原损坏块降级为正文注释保留
4. 目标路径 docs/specs/<kebab>.md(kebab 化去空格);目标已存在 → exit 2 报冲突
5. git mv(未入库则 fs.rename + git add)
6. 体量启发式计算 → 超标打 WARN(不阻断)
7. registry 中存在其他 adopted/active spec 时: 必须带 --relation <kind>:<spec-id>(可多个)或 --independent,否则 exit 2 并列出在途 spec
8. relations 写入 frontmatter (yaml 列表),重建 registry
```

### verify 报账段(插在 🪝 [治理运行] 行之前, memory.service.js verify() 内)

```text
📋 [Spec Portfolio]: adopted=1 active=2 parked=1 shipped=3
⚠️ spec:provider-first-code-perception 已 12 天无活动 (active) — 请表态: mem spec park|reactivate|(supersede 二期)
⚠️ spec:xxx 体量超标 (AC=12, Phase=5) — 建议拆分或在 frontmatter 声明 sizeWaiver
```

registry 构建失败(如 git 异常)→ 打一行 degraded 提示,不让 verify 整体失败。

## Tasks

### Phase 1: 核心模块

- [ ] [task:portfolio-registry-core] 新建 spec-portfolio.js: 常量 + buildSpecRegistry + formatPortfolioReport
  - files: templates/cli/spec-portfolio.js
  - verify: node -e "const p=require('./templates/cli/spec-portfolio'); const r=p.buildSpecRegistry(process.cwd()); console.log(r.version, r.specs.length)"
  - acceptance: 输出 evo-spec-registry@1 与真实 spec 数;registry 文件落盘 .evo-lite/generated/spec-registry.json;删除该文件后重跑可重建;git 不可用时回退 mtime 不抛异常;状态派生符合 Design Notes 规则 1-6
  - test-first: 先在 test/governance.js 新增「spec portfolio registry」测试节(harness.createTempRuntimeRoot + writeText 造 docs/specs 假 spec + 假 plan-ir.json),断言 shipped/parked/adopted/active 四态派生、aging-no-plan 与 zombie-plan warning,跑 `node templates/cli/test.js governance` 确认红→实现→绿

- [ ] [task:portfolio-adopt] adoptSpec: 格式修复 + 归一化搬移 + 体量闸门 + 关系声明
  - files: templates/cli/spec-portfolio.js
  - verify: node templates/cli/test.js governance
  - acceptance: 对「文件名带空格 + YAML 损坏 + 不在 docs/specs」的 fixture draft 执行 adoptSpec 后,产出 docs/specs/<kebab>.md、frontmatter 含合法 id/status/created、损坏块降级注释保留;超阈值 fixture 返回 size WARN 但不阻断;存在在途 spec 且未给 --relation/--independent 时抛参数错误(CLI 层 exit 2);relations 正确写入 frontmatter
  - test-first: governance.js 增「spec adopt gate」测试节,覆盖上述四断言,红→绿

- [ ] [task:portfolio-park-reactivate] parkSpec / reactivateSpec: frontmatter 状态迁移 + 级联检测
  - files: templates/cli/spec-portfolio.js
  - verify: node templates/cli/test.js governance
  - acceptance: park 写入 status: parked + parkedUntil(原样文本);park 后 registry 该 spec 状态 parked 且其活跃 plan 触发 zombie-plan warning(级联报账);reactivate 恢复 adopted/active(按有无 plan 派生);对不存在的 spec id exit 2
  - test-first: governance.js 增「spec park/reactivate」测试节,红→绿

### Phase 2: 接线

- [ ] [task:portfolio-cli-wire] registerSpecPortfolioCommands 注册进 memory.js
  - files: templates/cli/spec-portfolio.js, templates/cli/memory.js
  - verify: node ./.evo-lite/cli/memory.js spec status --json
  - acceptance: memory.js 在 registerPlanCommands 调用处(~699 行)后追加 require('./spec-portfolio').registerSpecPortfolioCommands(program);`mem spec adopt <file> [--relation k:id]... [--independent]`、`mem spec status [--json]`、`mem spec park <id> --until <text>`、`mem spec reactivate <id>` 全部可用;--json 输出完整 registry;人类输出复用 formatPortfolioReport

- [ ] [task:portfolio-verify-section] verify 挂载 Spec Portfolio 报账段
  - files: templates/cli/memory.service.js
  - verify: node ./.evo-lite/cli/memory.js verify
  - acceptance: verify 输出在 🪝 [治理运行] 行前出现 📋 [Spec Portfolio] 统计行;存在老化/超标 spec 时逐条 ⚠️ 且每次 verify 重新计算(表态前 WARN 常驻);registry 构建异常时打 degraded 一行,verify 不因此失败;lazy require 保证 spec-portfolio.js 缺失(旧 child runtime)时静默跳过
  - test-first: governance.js 增「verify portfolio section」测试节(captureConsole 捕获 verify 输出断言),红→绿

- [ ] [task:portfolio-manifest-sync] 登记 manifest + mirror 同步
  - files: templates/cli/template-manifest.js, .evo-lite/cli/spec-portfolio.js
  - verify: node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime
  - acceptance: core-cli family files 数组加入 'spec-portfolio.js';第二次 sync-runtime 报零变更;.evo-lite/cli 镜像与 templates/cli byte-identical

### Phase 3: 基因 + 全量回归 + dogfood

- [ ] [task:portfolio-intake-gene] 新增 spec-intake 规则基因
  - files: templates/.agents/rules/spec-intake.md, templates/cli/template-manifest.js
  - verify: node templates/cli/test.js governance
  - acceptance: 规则内容: agent 讨论产出 spec 时 draft 阶段位置格式自由,结束时必须调用 mem spec adopt 收编,禁止直接手写 docs/specs/ 绕过闸门;文件登记进 agents-rules family;harness 的 rules-family 派生拷贝逻辑自动覆盖新基因(测试通过即证)

- [ ] [task:portfolio-regression] 全量回归 + 退出码检查
  - files: templates/cli/spec-portfolio.js
  - verify: node ./.evo-lite/cli/test.js all
  - acceptance: all 范围(governance + integration)全绿;registry 文件缺失时 verify 与 mem spec status 均正常(重建);现有 plan close / READY 自动 close 路径无行为变化

- [ ] [task:portfolio-dogfood] 真实收编本仓库两份 draft
  - files: docs/specs/provider-first-code-perception-foundation.md
  - verify: node ./.evo-lite/cli/memory.js spec status --json
  - acceptance: 对 "docs/spec provider-first-code-perception-foundation.md" 执行 mem spec adopt(声明 --relation spawned-from:spec:evo-lite-providers),YAML 修复 + 去空格搬移成功且立即收到 size WARN(AC=12>8, Phase=5>3)——闸门在真实超大 spec 上首击命中;空文件 "docs/spec evo-code-perception-foundation.md" adopt 被拒(exit 2, 空内容);registry 中该 spec 状态 adopted 并进入老化倒计时
