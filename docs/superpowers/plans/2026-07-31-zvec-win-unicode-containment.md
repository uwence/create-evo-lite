---
id: plan:zvec-win-unicode-containment
title: "Plan: Zvec Windows 非 ASCII 路径 containment"
linkedSpec: spec:zvec-win-unicode-containment
format: superpowers
status: draft
---

# Zvec Windows Unicode Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ **本计划未获实施授权。** Phase D 只交付设计与计划；执行前必须先通过
> spec §14 的实施授权门（含用户显式授权）。第 3 版，经三轮独立复审修订。

## 前置条件（执行 Task 1 之前必须已成立）

```
[ ] spec:zvec-win-unicode-containment 已 adopted（--independent）
[ ] 证据、Spec、详细计划、IR plan 已提交并完成 context track / Meta-Commit
[ ] 生产实现已获【单独】授权
```

**adopt 不属于本计划**。它发生在 Phase D 治理闭环阶段、实施授权**之前**
（spec §13 冻结的时序）。若在这三项成立前开始 Task 1，则该议题在
Spec Portfolio 中对整个实施期不可见 —— 一条 release-blocking P0 不应处于这种状态。

**Goal:** 在 Windows 上，让任何可能进入 `@zvec/zvec` native 生命周期的调用，
**在 `require('@zvec/zvec')` 发生之前**完成路径判定；非 `SAFE` 时走既有 sqlite 降级通道，
并通过显式状态机管控恢复与重启用。

**Architecture:** 四层。①`zvec-path-containment.js` 纯谓词 lexical 层；
②supported-profile evaluator（只读 FS 探查）；③单一 `resolveEngineDecision()`，
诊断与实例化**消费同一决策**；④发布阻断落在 `prepublishOnly`/release-preflight，
`release-gate.yml` 只提供合同证据。

**Tech Stack:** Node.js (CommonJS)、既有 `templates/cli/test/harness.js` + `assert`、
GitHub Actions、`sync-runtime` 模板镜像。

**契约文档（canonical）:** `docs/superpowers/specs/2026-07-31-zvec-win-unicode-containment-design.md`
**运行时证据:** `docs/validation/zvec-win-unicode-path-matrix.md`
**可复现 fixture:** `docs/validation/fixtures/zvec-win-unicode/`（默认拒绝执行）

## Portfolio 落位决定（IR plan 已就位，adopt 在实施前的治理闭环执行）

已核实：`plan scan` 只扫描 `docs/specs/` 与 `docs/plans/`，**不扫 `docs/superpowers/plans/`**；
spec 状态派生为 `linkedPlans.length === 0 → adopted`，否则 `active`
（`spec-portfolio.js:213-219`）。

因此若只保留本文件，adopt 后 spec 会被判为 **`adopted`（无计划）**，并在超过 agingDays 后
触发 `aging-no-plan` —— 正是刚被 park 的 `provider-first` 那类警告。

**决定**：

```
docs/specs/zvec-win-unicode-containment.md      ← mem spec adopt 归一化产出（--independent）
docs/plans/zvec-win-unicode-containment.md      ← 新建，IR 可识别，带 linkedSpec + ### Task 结构
docs/superpowers/plans/2026-07-31-...(本文件)    ← 保留为详细任务分解
预期 Portfolio 状态：active（非 adopted）
```

本文件 frontmatter 已带 `linkedSpec`，迁移/建立 IR plan 时直接沿用。

## Global Constraints

- **不得**实现危险字符黑名单；初始实现**不产生** `UNSAFE`（spec §5.2）。
- **不得** `try/catch` 包裹 `insertSync`（spec F3）。
- **不得**按长度判定（长度维度并未全域排除，spec F5）。
- **不得**改变非 `win32` 平台行为（spec I9）。
- **不得**自动搬迁用户数据；**不得**路径转 SAFE 后自动复用旧 collection（spec §7.3）。
- **不得**在本轮修改 hive nurture（spec §8.4）。
- `.evo-lite/cli/*` 与 `templates/cli/*` 必须**逐文件保持逻辑对齐**；新增受管 CLI 文件
  **必须登记进 `template-manifest.js` 的 `core-cli` family `files` 数组**（当前 107 项，
  `scope: sync-always`），否则 `sync-runtime` 不会镜像它。
- 崩溃 corpus 测试**只断言 `verdict !== 'SAFE'`**，绝不进入 native。
- durable 链 `active_context → context track → archive(raw_memory)` 不得被本改动触碰。

## 已核实的代码事实（实现须以此为准，勿再猜测）

| 事实 | 位置 |
|---|---|
| `zvecRoot()` = `dirname(getDbPath())/zvec`；`_colPath` = `zvecRoot()/collection` | `memory-index-zvec.js:20-33` |
| **`memory-index-zvec.js` 只导出 `ZvecMemoryIndex`；`zvecRoot()` 未导出** → 必须提取不依赖 zvec 的共享路径函数 | 实测 `Object.keys(require(...))` |
| native 打开：`ZVecOpen`/`ZVecCreateAndOpen` 于 `initialize()`，并在其中建目录 | `memory-index-zvec.js:60-69` |
| 崩溃点：`col.insertSync([...])` 于 `upsert()` | `memory-index-zvec.js:146-157` |
| **`defaultLoadZvecIndex()` 第一步即 `require('@zvec/zvec')`** | `memory-index.js:187-194` |
| **双路径**：`resolveActiveImpl()` 与 `getMemoryIndex()→selectEngine()` 各自独立调用 `loadZvecIndex()` | `memory-index.js:196-222` |
| 导出面无 engine decision：`{SqliteFtsIndex, getMemoryIndex, resetMemoryIndex, peekMemoryIndex, resolveEngine, resolveActiveImpl, selectEngine, DEFAULT_ENGINE_CHOICE}` | `memory-index.js:236` |
| **`memory-ab` 绕过 selector**：`:77-78` 直接 require zvec + memory-index-zvec；`:29` `new ZvecMemoryIndex()` → `initialize()` → `upsert()` | `memory-ab.js` |
| `memory-index-lock.js:333` 亦直接 `require('@zvec/zvec').isZVecError(err)`（只加载、不传路径） | `memory-index-lock.js` |
| `release-gate.yml` 仅 `push:main`/`PR:main`，**自我声明 informational**；scaffold 目标为纯 ASCII | `.github/workflows/release-gate.yml:1-17,61-67` |
| **`package.json` 无 `prepublishOnly`**（scripts 仅 `start`/`test`/`test:governance`） | `package.json` |
| `core-cli` family 为显式 `files` 清单（107 项），含 `memory-ab.js`、`test/governance.js`、`memory.service.js` | `template-manifest.js` |
| 实施前 `memory-index.js` / `memory-index-zvec.js` 的 live 与 template SHA256 一致 | 实测 |

## File Structure

```
新增
  .evo-lite/cli/zvec-path-containment.js        lexical + profile 判定
  templates/cli/zvec-path-containment.js        镜像
  .evo-lite/cli/zvec-collection-path.js         共享路径函数（不依赖 zvec）
  templates/cli/zvec-collection-path.js         镜像

改动
  .evo-lite/cli/memory-index.js                 单一 engine decision
  templates/cli/memory-index.js                 镜像
  .evo-lite/cli/memory-ab.js                    关闭绕行入口
  templates/cli/memory-ab.js                    镜像
  .evo-lite/cli/memory.js                       verify 诊断段接线
  templates/cli/memory.js                       镜像
  .evo-lite/cli/memory.service.js               恢复状态机 / rebuild 语义
  templates/cli/memory.service.js               镜像
  .evo-lite/cli/spec-portfolio.js               registry 输出 releaseBlocking + 派生 blockers
  templates/cli/spec-portfolio.js               镜像
  .evo-lite/cli/template-manifest.js            登记两个新文件
  templates/cli/template-manifest.js            镜像
  .evo-lite/cli/test/governance.js              T1–T11
  templates/cli/test/governance.js              镜像
  package.json                                  prepublishOnly → release-preflight
  .github/workflows/release-gate.yml            containment 证据 job

新增（发布门载体，Task 8 第 1 步定稿具体文件名）
  .evo-lite/cli/release-preflight.js            消费 registry blockers
  templates/cli/release-preflight.js            镜像

已就位（本轮不改）
  docs/validation/zvec-win-unicode-path-matrix.md
  docs/validation/fixtures/zvec-win-unicode/
```

> `release-preflight` 的载体文件在 Task 8 第 1 步定稿（见该任务）。

---

### Task 1: Characterization —— 锁住现状（零生产改动）

- [ ] 固化 `resolveActiveImpl` 现有行为：`choice=zvec`+可用 → `impl=zvec, degraded=false`；
      不可用 → `impl=sqlite, degraded=true`；`choice=sqlite` → `degraded=false`
- [ ] **固化双路径事实**：断言 `getMemoryIndex()` 与 `resolveActiveImpl()` 各自触发一次
      `loadZvecIndex`（用注入 seam 计数）——这条 characterization 是 Task 4 的 RED 前置
- [ ] 用既有 `loadZvecIndex` 注入 seam 模拟不可用，不触碰模块系统
- [ ] 确认全部在**当前 main** 上绿

**验收**：新增测试通过；生产文件零 diff。

### Task 2: Lexical classifier（AC1）

- [ ] 新建 `zvec-path-containment.js`，导出 `classifyLexical(collectionPath, platform)`
      → `'LEXICALLY_ELIGIBLE' | 'UNKNOWN'` + reason
- [ ] `platform !== 'win32'` → 直接 eligible（spec I9）
- [ ] 实现 spec §5.1 Layer 1 全部条件：本地盘符绝对路径、ASCII 字符集、
      拒 `\\?\` / UNC / `\\.\` / `\??\`、拒保留设备名、拒尾随空格或点、
      拒 ADS、要求已规范化
- [ ] **禁止** `require('@zvec/zvec')`、**禁止**任何 FS 访问（spec I4/I5）
- [ ] T1 纯度测试：以模块加载计数 + FS 桩断言零访问

**验收**：T1 绿；模块不引入新依赖。

### Task 3: Supported-profile evaluator（AC2）

- [ ] 同模块导出 `evaluateProfile(collectionPath, fsOps)` → `'IN_PROFILE' | 'UNKNOWN'` + reason
- [ ] 只读探查：祖先链无 reparse point（junction/symlink）；`realpath` 结果仍满足 Layer 1；
      检出 8.3 短名别名即判 `UNKNOWN`
- [ ] **探查失败（权限/IO/不支持）→ `UNKNOWN`**，不得当作通过（spec §5.1）
- [ ] **禁止写盘**、禁止加载 zvec（spec I6）
- [ ] 导出合成判定 `classifyCollectionPath()` → `SAFE` 仅当两层均通过
- [ ] T2 只读性测试；T5 fail-closed 矩阵（UNC / `\\?\` / reparse / 尾随点 / 保留名 / 未知非 ASCII）
- [ ] T3：崩溃 corpus 全部 `verdict !== 'SAFE'`（读 fixture corpus，**不执行 native**）
- [ ] T4：supported profile 对照路径 → `SAFE`（防过度拦截）

**验收**：T1–T5 绿。

**⛔ 停止点 1**：判定层行为需复审通过后，才可接入生产 seam。

### Task 4: 单一 engine decision（AC3）—— 本计划最关键的一步

- [ ] 提取 `zvec-collection-path.js`：不依赖 zvec 地计算 collection 路径
      （**不得**从 `memory-index.js` 调用未导出的 `zvecRoot()`）
- [ ] 新增 `resolveEngineDecision()`：读 choice → 算路径 → win32 上判定 →
      非 `SAFE` 直接返回 sqlite decision（**且不调用 `loadZvecIndex()`**）→
      仅 `SAFE ∧ choice==='zvec'` 才允许调用
- [ ] `resolveActiveImpl()` 与 `getMemoryIndex()`/`selectEngine()` **改为消费同一 decision**
- [ ] **T6 零加载断言**：非 `SAFE` 路径下 `loadZvecIndex` 调用次数 = 0
      （Task 1 的双路径 characterization 此时应从「各调用一次」翻转为「零次」）
- [ ] 非 `SAFE` 时不创建 zvec 目录、不打开已有 collection
- [ ] T9 平台隔离：非 win32 行为逐位不变
- [ ] `templates/cli/` 同步；两个新文件登记进 `template-manifest.js`；`sync-runtime --check` in-sync

**验收**：T6/T9 绿；Task 1 中**非 containment 场景**的 characterization 仍全绿。

**⛔ 停止点 2**：需在**真实 Windows 非 ASCII 路径**上端到端人工验收
（预期：不崩溃、明确降级、archive 可写），再继续。

### Task 5: native 入口收口（AC4）

- [ ] `memory-ab`：非 `SAFE` → **拒绝执行并输出 containment 诊断**；
      **不得**自动降级为 sqlite-vs-sqlite（那会把对比实验静默变成自比）
- [ ] 走查并留证：`recall` / `remember` / `archive` / `track` / `sync` / `rebuild` / MCP
      是否全部消费同一 decision，不得假定它们都经由 `getMemoryIndex()`
- [ ] `memory-index-lock.js:333` **静态、非 native 代码审查**（不跑崩溃实验），逐条书面结论：
      ①它是否只在已捕获的 Zvec error 之后执行；
      ②`UNKNOWN` 路径在此之前是否根本不会进入会产生 Zvec error 的调用；
      ③能否用**依赖注入**获得 `isZVecError` 从而彻底移除运行时裸 require（可行则优先采用）；
      ④若保留，须证明「加载 binding 本身」在支持矩阵内不访问 collection path
- [ ] 全仓复查：不存在其他直接 `require('@zvec/zvec')` 或 `new ZvecMemoryIndex()` 的生产路径
- [ ] T7 入口覆盖测试

**验收**：T7 绿；入口清单与 spec §6.3 一致。

### Task 6: 降级恢复状态机（AC5）

- [ ] 首次 containment 降级 → 写入**非 Zvec** 的持久 degradation/trust marker
- [ ] 路径转 `SAFE` 后**仍保持 sqlite**，提示执行 `mem rebuild`（不自动切回）
- [ ] `mem rebuild`：从 `raw_memory` 重建**全新** collection → 验证成功 → 清除 marker
- [ ] unsafe 期间 `rebuild` **只重建 SQLite**；不打开/不删除/不修复旧 collection
- [ ] T8 状态机测试（含 marker 未清除时不得切回 zvec）

**验收**：T8 绿；`raw_memory` 全程未被触碰。

### Task 7: verify 诊断与恢复指引（AC6）

- [ ] `verify` 增加 containment 段：判定结果、原因、受影响路径、当前引擎、degraded 状态、marker 状态
- [ ] 危险路径上已存在的 collection：只报告不打开，说明其内容未被读取
- [ ] 输出**人工**恢复指引，不自动执行
- [ ] 措辞不得暗示「已修复上游缺陷」，应说明这是 containment 降级

**验收**：危险路径样本上 `verify` 可诊断且不崩溃。

### Task 8: 发布 enforcement point（AC7）

> **已核实的阻塞事实**：`buildSpecRegistry()` 当前**不输出** `releaseBlocking`，也没有
> blockers 集合（逐 spec 字段见 spec §8.2.1）。仅写 frontmatter **不会**形成机器发布门。
> 好消息是 `adoptSpec` 的 `reservedKeys` 不含该键，非保留键**原样保留追加**
> （`spec-portfolio.js:490-496`），字段能在 adopt 后存活 —— 缺的只是 registry 的解析与派生。

- [ ] **第 1 步（决策点，已定稿）**：结构化 blocker 载体 = **Spec Portfolio 字段**。
      理由：复用既有结构化治理域，不引入第二个真相源，天然满足「不扫自然语言」，
      且字段已能在 adopt 流程中存活。备选（release manifest / 独立 governance IR）
      **需书面否决理由方可改选**，不得在编码中静默切换。
- [ ] **负责文件**：`spec-portfolio.js`（live + template）、`release-preflight.js`（live + template）、
      `package.json`（`prepublishOnly`）、`test/governance.js`（live + template）
- [ ] **严格 scalar 解释**（spec §8.2.2.0）——**已实测** `parseFrontmatter()` 不是 YAML parser，
      `releaseBlocking: true` 得到字符串 `"true"`，`"2026-07-31"` 得到**含引号**的
      `"\"2026-07-31\""`。故按原始字符串判定：`"true"`→true、`"false"`→false、
      **其余一切（`ture`/`yes`/`1`/带引号 `"true"`）→ schema error**。
      不 trim 引号、不折叠大小写、不做宽松 YAML 推断
- [ ] `spec-portfolio.js`：registry 逐 spec 输出 `releaseBlocking`，顶层新增 `blockers`、
      **`errors`、`source{directoryReadable,discoveredFileCount,parsedSpecCount}`**，
      按 spec §8.2.2 表派生；`parked` 默认仍 BLOCK
- [ ] **registry health（spec §8.2.3.1，堵 fail-open）**：现有 builder 正常退化时**不抛错**
      （目录不可读 → 空集；单文件解析失败 → `parsed=null` 后跳过），因此损坏的
      release-blocking spec 会**静默消失并放行 publish**。必须把退化编码进 `errors`：
      目录不可读 / 任意 `*.md` 读取或解析失败（保留路径）/
      `discoveredFileCount !== parsedSpecCount` → 全部 FAIL
- [ ] waiver schema（spec §8.2.2.1，**canonical 不带引号**）：
      `releaseBlockDisposition: waived`（原始值严格等于，封闭枚举）+
      `releaseBlockReason`（trim 后非空）+ `releaseBlockReviewedAt`（`^\d{4}-\d{2}-\d{2}$`
      且**日期 round-trip 校验**，挡掉 `2026-02-31`），三项**同时**有效才放行；
      缺一或非法 → 保持 BLOCK + schema error；
      **waiver 只对 `parked` 生效，不可放行 `adopted`/`active`**
- [ ] 实现 `prepublishOnly` → `release-preflight`：**现场** `buildSpecRegistry(projectRoot, {write:false})`
      派生 blockers（**禁止**读取 `.evo-lite/generated/spec-registry.json` —— 该文件实际存在
      且可能 stale，漏读方向是放行）。
      **放行条件是 `registry.errors.length === 0 && registry.blockers.length === 0`，
      不是「调用未抛异常」**；任一不满足 → `exit != 0`
- [ ] `release-gate.yml` 新增 containment **证据** job（非阻断角色）
- [ ] **验收测试（T10，十条）**：①`adopted`/`active` blocker → prepublish fail
      （`npm publish --dry-run` 验证）；②`parked` blocker 无 waiver → fail；
      ③`parked` + 三项齐全合法 waiver → pass；④`done` spec → pass；
      ⑤字段缺失/`false` → 不影响 publish；
      ⑥**`releaseBlocking: ture` 之类非布尔值 → schema error → fail**；
      ⑦disposition 非法或不完整 → 保持 fail；
      ⑧`adopted`/`active` blocker 不可被 waiver 放行；
      ⑨**FOCUS 自然语言含 "release-blocker" 字样 → 不产生机器判断**；
      ⑩**stale `spec-registry.json` 与现场结果冲突 → 以现场为准**
- [ ] **T11 registry health 回归（四条）**：①**损坏一个 release-blocking spec 的 frontmatter
      → 该文件不得静默消失**，须进 `errors`（含路径）且 prepublish fail；
      ②`docs/specs` 不可读 → errors + fail；③`discoveredFileCount !== parsedSpecCount` → fail；
      ④放行条件为 `errors.length === 0 && blockers.length === 0`
- [ ] 补充验收：containment 合同回归时该 PR **变红**；普通 PR 不执行 crash probe
- [ ] 记录：`release-gate.yml` 是 informational，提升为 required 是手动 repo-admin 步骤
- [ ] `templates/cli/` 同步；`release-preflight.js` 登记进 `template-manifest.js`

**验收**：T10 十条 + T11 四条 + 两条补充验收全绿。

### Task 9: 实施完成后的状态推进与闭环（复审 ACCEPTED 后另行授权）

> **adopt 不在此处**。它已按 spec §13 前移到 Phase D 治理闭环、实施授权之前；
> 本任务的前提是 spec **早已 adopted**。

- [x] 建立 `docs/plans/zvec-win-unicode-containment.md`（IR 可识别，带 `linkedSpec`）
      —— 已于 Phase D 复审阶段单独授权并完成，不占实施授权
- [ ] 推进 spec 状态至实施完成态；确认 Portfolio 仍为 **active** 直至收口
- [ ] `sync-runtime --check` in-sync；live/template SHA256 一致
- [ ] 上游上报：向 `@zvec/zvec` 提交最小复现（fixture 可直接作附件）
- [ ] 在 `[attp-hive-rollout]` 登记「Windows 目标必须消费 containment decision 接口」的依赖
- [ ] `mem commit` 闭环 + backlog `[zvec-win-unicode-containment]` 状态推进

**⛔ 停止点 3**：治理闭环不得与实现任务一并执行，须复审 ACCEPTED 后单独授权。

---

## 停止点（三处，均为硬停）

1. **Task 3 后** —— 判定层复审通过前不接入生产 seam。
2. **Task 4 后** —— 真实 Windows 非 ASCII 路径端到端人工验收通过前不继续。
3. **Task 9 前** —— 复审 ACCEPTED 前不做治理闭环。

## 范围外（本计划不做）

- 修改 hive nurture（spec §8.4；留待 `[attp-hive-rollout]` 重新授权）
- 修复上游 native 缺陷
- 解阻 `[attp-hive-rollout]`
- 解决 8.3 短名身份 residual（只检出并判 `UNKNOWN`）
- `[memory-lock-win-cim-snapshot-reliability]`（parked residual）
- `spec:evo-code-perception-foundation` 的 size warning
- architecture IR 刷新
