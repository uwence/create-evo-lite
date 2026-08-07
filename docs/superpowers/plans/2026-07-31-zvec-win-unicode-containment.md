---
id: plan:zvec-win-unicode-containment
title: "Plan: Zvec Windows 非 ASCII 路径 containment"
linkedSpec: spec:zvec-win-unicode-containment
format: superpowers
status: done
---

# Zvec Windows Unicode Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **阶段状态**（第 4 版）
>
> ```text
> Tasks 1–6（AC1–AC5）  COMPLETE / MERGED
> Task 7 Step 1（AC6）   RE-FROZEN 2026-08-07 —— 五态模型闭合 D2×M8×D5 冲突
> Task 7（AC6）          ACCEPTED / MERGED（PR #17 → merge commit 985b638，审查 head ac3445c）
> Task 8（AC7）          ACCEPTED / MERGED（PR #18 → merge commit c2eb784，审查 head 42c054e）
> FOCUS 锚点 resync      MERGED（PR #19 → merge commit 04fd869）
> Task 9（收口）          CLOSEOUT PROCEDURE AUTHORIZED / EXECUTION NOT YET AUTHORIZED
>                       分 9A–9D 逐段授权；当前仅 9A（docs-only）
> context closure       NOT AUTHORIZED
> baseline              main@04fd869
> ```
>
> 上表是**人工阶段摘要**。Task 6 已合入 `main@bc3ee2f`，Task 7 已合入 `main@985b638`；
> 本计划下文 Task 6 段落与「前置条件」仍保留「Task 6 需要单独实施授权」的旧文字，
> 那是尚未处理的历史残留，**以本摘要为准**。此处修正不代表 Task 6 的逐 Step 回填或
> mutation 历史导入，也不改动 Task 8 的冻结设计。
>
> 逐任务授权，不再有全局横幅。执行任何**未授权**任务之前，必须先通过 spec §14 /
> §14.1 的授权门（含用户显式授权）。

## 前置条件（执行 Task 1 之前必须已成立）

```
[x] spec:zvec-win-unicode-containment 已 adopted（--independent）
[x] 证据、Spec、详细计划、IR plan 已提交并完成 context track / Meta-Commit
[x] 生产实现已获【单独】授权 —— 对 Tasks 1–5 成立；Task 6 需要单独的实施授权
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

**契约文档（canonical Spec）:** `docs/specs/zvec-win-unicode-containment.md`
**运行时证据:** `docs/validation/zvec-win-unicode-path-matrix.md`
**可复现 fixture:** `docs/validation/fixtures/zvec-win-unicode/`（默认拒绝执行）

## Portfolio 落位决定（第 4 版重写：本文件是唯一 plan）

> **第 3 版的承重错误**：那一版写「`plan scan` **不扫** `docs/superpowers/plans/`」，
> 并据此新建了一份轻量 IR plan。实测 `plan-ir.json.sources` **两棵树都在**，本文件本身
> 就已被扫描。于是两份文件携带同一个 `id: plan:zvec-win-unicode-containment`，IR 中
> 出现**两条同 id 的 plan 记录**，派生的 `task:...-t1..t9` 同样重复 —— 之后的状态、
> linkedFiles、progress 与 plan 选择都会依赖**扫描顺序**。

**决定：删除轻量 IR plan，本文件是唯一 plan。**

```
docs/specs/zvec-win-unicode-containment.md      ← mem spec adopt 归一化产出（--independent）
docs/superpowers/plans/2026-07-31-...(本文件)    ← 唯一 plan，直接被 plan scan 识别
docs/plans/zvec-win-unicode-containment.md      ← 已删除（重复登记）
预期 Portfolio 状态：active（非 adopted）
```

既然扫描器已经读取本文件，IR 副本不提供任何额外能力；而给它另一个 id 会制造**两个
独立生命周期**，治理负担反而更大。

`spec` 状态派生为 `linkedPlans.length === 0 → adopted`，否则 `active`
（`spec-portfolio.js:213-219`）；本文件 frontmatter 带 `linkedSpec`，因此 spec 仍为
`active` 而非 `adopted`，不会触发 `aging-no-plan`。

## Global Constraints

- **不得**实现危险字符黑名单；初始实现**不产生** `UNSAFE`（spec §5.2）。
- **不得** `try/catch` 包裹 `insertSync`（spec F3）。
- **不得**按长度判定（长度维度并未全域排除，spec F5）。
- **不得**改变非 `win32` 平台行为 —— **marker 不存在时**（spec I9，第 4 版收紧）。
  marker 是 trust debt，跨平台继续有效（spec §7.4 M7）。
- **不得**自动搬迁用户数据；**不得**路径转 SAFE 后自动复用旧 collection（spec §7.3）。
  「不得删除旧 collection」**限定于 unsafe 阶段**；显式 recovery rebuild 的 discard
  不属于「打开/修复/复用」（spec §7.3.1）。
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
| **计划解析器只把 `- [x] **Step ...` 计为步骤**：`allSteps` / `doneSteps` 两个过滤器都要求字面 `**Step` 前缀，`status` 仅在 `allSteps.length > 0 && doneSteps.length === allSteps.length` 时才是 `implemented`。**普通 `- [x]` 勾选永远不会推进 task status**，R012 会一直报 0/N | `planning/parse-markdown.js:168-174` |
| `plan scan` **确实**扫描 `docs/superpowers/plans/`（见上文第 4 版更正） | 实测 `plan-ir.json.sources` |

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

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [x] **Step 1:** 固化 `resolveActiveImpl` 现有行为：`choice=zvec`+可用 → `impl=zvec, degraded=false`；
      不可用 → `impl=sqlite, degraded=true`；`choice=sqlite` → `degraded=false`
- [x] **Step 2:** **固化双路径事实**：断言 `getMemoryIndex()` 与 `resolveActiveImpl()` 各自触发一次
      `loadZvecIndex`（用注入 seam 计数）——这条 characterization 是 Task 4 的 RED 前置
- [x] **Step 3:** 用既有 `loadZvecIndex` 注入 seam 模拟不可用，不触碰模块系统
- [x] **Step 4:** 确认全部在**当前 main** 上绿

**验收**：新增测试通过；生产文件零 diff。

### Task 2: Lexical classifier（AC1）

**Files:**
- Create: `.evo-lite/cli/zvec-path-containment.js`
- Create: `templates/cli/zvec-path-containment.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Sync: `templates/cli/template-manifest.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [x] **Step 1:** 新建 `zvec-path-containment.js`，导出 `classifyLexical(collectionPath, platform)`
      → `'LEXICALLY_ELIGIBLE' | 'UNKNOWN'` + reason
- [x] **Step 2:** `platform !== 'win32'` → 直接 eligible（spec I9）
- [x] **Step 3:** 实现 spec §5.1 Layer 1 全部条件：本地盘符绝对路径、ASCII 字符集、
      拒 `\\?\` / UNC / `\\.\` / `\??\`、拒保留设备名、拒尾随空格或点、
      拒 ADS、要求已规范化
- [x] **Step 4:** **禁止** `require('@zvec/zvec')`、**禁止**任何 FS 访问（spec I4/I5）
- [x] **Step 5:** T1 纯度测试：以模块加载计数 + FS 桩断言零访问

**验收**：T1 绿；模块不引入新依赖。

### Task 3: Supported-profile evaluator（AC2）

**Files:**
- Modify: `.evo-lite/cli/zvec-path-containment.js`
- Sync: `templates/cli/zvec-path-containment.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [x] **Step 1:** 同模块导出 `evaluateProfile(collectionPath, fsOps)` → `'IN_PROFILE' | 'UNKNOWN'` + reason
- [x] **Step 2:** 只读探查：祖先链无 reparse point（junction/symlink）；`realpath` 结果仍满足 Layer 1；
      检出 8.3 短名别名即判 `UNKNOWN`
- [x] **Step 3:** **探查失败（权限/IO/不支持）→ `UNKNOWN`**，不得当作通过（spec §5.1）
- [x] **Step 4:** **禁止写盘**、禁止加载 zvec（spec I6）
- [x] **Step 5:** 导出合成判定 `classifyCollectionPath()` → `SAFE` 仅当两层均通过
- [x] **Step 6:** T2 只读性测试；T5 fail-closed 矩阵（UNC / `\\?\` / reparse / 尾随点 / 保留名 / 未知非 ASCII）
- [x] **Step 7:** T3：崩溃 corpus 全部 `verdict !== 'SAFE'`（读 fixture corpus，**不执行 native**）
- [x] **Step 8:** T4：supported profile 对照路径 → `SAFE`（防过度拦截）

**验收**：T1–T5 绿。

**⛔ 停止点 1**：判定层行为需复审通过后，才可接入生产 seam。

### Task 4: 单一 engine decision（AC3）—— 本计划最关键的一步

**Files:**
- Create: `.evo-lite/cli/zvec-collection-path.js`
- Create: `templates/cli/zvec-collection-path.js`
- Modify: `.evo-lite/cli/memory-index.js`
- Sync: `templates/cli/memory-index.js`
- Modify: `.evo-lite/cli/memory-index-zvec.js`
- Sync: `templates/cli/memory-index-zvec.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Sync: `templates/cli/template-manifest.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [x] **Step 1:** 提取 `zvec-collection-path.js`：不依赖 zvec 地计算 collection 路径
      （**不得**从 `memory-index.js` 调用未导出的 `zvecRoot()`）
- [x] **Step 2:** 新增 `resolveEngineDecision()`：读 choice → 算路径 → win32 上判定 →
      非 `SAFE` 直接返回 sqlite decision（**且不调用 `loadZvecIndex()`**）→
      仅 `SAFE ∧ choice==='zvec'` 才允许调用
- [x] **Step 3:** `resolveActiveImpl()` 与 `getMemoryIndex()`/`selectEngine()` **改为消费同一 decision**
- [x] **Step 4:** **T6 零加载断言**：非 `SAFE` 路径下 `loadZvecIndex` 调用次数 = 0
      （Task 1 的双路径 characterization 此时应从「各调用一次」翻转为「零次」）
- [x] **Step 5:** 非 `SAFE` 时不创建 zvec 目录、不打开已有 collection
- [x] **Step 6:** T9 平台隔离：非 win32 行为逐位不变
- [x] **Step 7:** `templates/cli/` 同步；两个新文件登记进 `template-manifest.js`；`sync-runtime --check` in-sync

**验收**：T6/T9 绿；Task 1 中**非 containment 场景**的 characterization 仍全绿。

**⛔ 停止点 2**：需在**真实 Windows 非 ASCII 路径**上端到端人工验收
（预期：不崩溃、明确降级、archive 可写），再继续。

### Task 5: native 入口收口（AC4）

**Files:**
- Modify: `.evo-lite/cli/memory-ab.js`
- Sync: `templates/cli/memory-ab.js`
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Modify: `.evo-lite/cli/memory-index-zvec.js`
- Sync: `templates/cli/memory-index-zvec.js`
- Add: `docs/validation/zvec-win-unicode-native-entry-audit.md`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [x] **Step 1:** `memory-ab`：非 `SAFE` → **拒绝执行并输出 containment 诊断**；
      **不得**自动降级为 sqlite-vs-sqlite（那会把对比实验静默变成自比）
- [x] **Step 2:** 走查并留证：`recall` / `remember` / `archive` / `track` / `sync` / `rebuild` / MCP
      是否全部消费同一 decision，不得假定它们都经由 `getMemoryIndex()`
- [x] **Step 3:** `memory-index-lock.js:333` **静态、非 native 代码审查**（不跑崩溃实验），逐条书面结论：
      ①它是否只在已捕获的 Zvec error 之后执行；
      ②`UNKNOWN` 路径在此之前是否根本不会进入会产生 Zvec error 的调用；
      ③能否用**依赖注入**获得 `isZVecError` 从而彻底移除运行时裸 require（可行则优先采用）；
      ④若保留，须证明「加载 binding 本身」在支持矩阵内不访问 collection path
- [x] **Step 4:** 全仓复查：不存在其他直接 `require('@zvec/zvec')` 或 `new ZvecMemoryIndex()` 的生产路径
- [x] **Step 5:** T7 入口覆盖测试

**验收**：T7 绿；入口清单与 spec §6.3 一致。

### Task 6: 降级恢复状态机（AC5）

> **授权状态**：机制与计划补完**已授权**（仅文档）；**生产实施未授权**。
> 合同：spec §7.3 + §7.3.1 + §7.4 M0–M8。本任务不得偏离这些冻结项；
> 若实施现场发现冻结项本身有误，**停止并上报**，不得在编码中静默改判。

**Files:**
- Create: `.evo-lite/cli/zvec-containment-state.js`
- Create: `templates/cli/zvec-containment-state.js`
- Modify: `.evo-lite/cli/memory-index.js`
- Sync: `templates/cli/memory-index.js`
- Modify: `.evo-lite/cli/memory.service.js`
- Sync: `templates/cli/memory.service.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Sync: `templates/cli/template-manifest.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

**当前没有证据要求修改**（擅自扩大范围即为越界）：

```text
memory.js              verify 输出属于 Task 7
memory-index-zvec.js   Task 5 已收口，recovery 走 index seam 注入
.gitignore             marker 落在既有 .evo-lite/* 之下，不得新增 unignore 规则
package.json           发布门属于 Task 8
.github/**             证据 job 属于 Task 8
```

#### 承重前提（M0）：恢复不能使用正常 decision

marker 存在时正常 decision 必须给出 sqlite —— 这正是 marker 的意义。于是：

```text
正常 decision + marker      → 仍是 sqlite → 根本建不出新 collection
先清 marker → 再 rebuild    → 中途失败后，下次启动可能打开半成品 collection
```

两条都是错的。必须走 **one-shot recovery decision**，且 marker 全程留在盘上。

#### Interfaces（签名冻结）

新模块 `zvec-containment-state.js`：

```js
// 读：绝不抛错，把失败编码进 status（spec §7.4 M2）
readContainmentState(dir, seams = {})
  -> { status: 'absent' | 'present' | 'invalid' | 'unreadable',
       markerPath: string,
       state: object | null,     // status === 'present' 时才非空
       errorCode: string | null } // EVO_ZVEC_CONTAINMENT_STATE_READ 系列

// 写：【排他创建】(wx / O_EXCL)，首次写入即定稿，EEXIST → alreadyPresent，
// 绝不覆盖、绝不重试（spec §7.4 M1.1）。不使用 tmp + rename —— rename 会替换目标。
writeContainmentState(dir, { collectionPath, containment }, seams = {})
  -> { written: boolean, alreadyPresent: boolean, markerPath: string }
  throws EVO_ZVEC_CONTAINMENT_STATE_WRITE
  // dir / collectionPath 不可靠解析 → 同样 throw，detail.reason =
  // 'collection-path-unresolvable'（M6.1），不得降级为「成功」

// 清：仅由 recovery 成功路径调用（M5 十一条全成立之后）
clearContainmentState(dir, seams = {})
  -> { cleared: boolean }
  throws EVO_ZVEC_CONTAINMENT_STATE_CLEAR

// 纯校验，供读路径与测试共用
validateContainmentState(value) -> { valid: boolean, reason: string | null }
```

`memory-index.js` 新增：

```js
// 纯：marker 读取发生在 collectDecisionInputs()；本函数不做任何 FS 写入。
// 新增 reason 'containment-recovery-pending'（M3）与 recovery 字段
// {required, markerStatus, markerPath, reason}。
resolveEngineDecisionFromInputs(inputs)
  -> provisional decision + markerAction: 'none' | 'ensure-present'

// 副作用边界（M3.1）：唯一写 marker 的地方。
// 【必须】是 resolveEngineDecision() 与 sharedEngineDecision() 的共同出口 ——
// 已核实 sharedEngineDecision() 直接调纯 resolver 并缓存（memory-index.js:329-337），
// 只给 resolveEngineDecision() 挂写入会让生产共享路径整条绕过 marker。
persistEngineDecision(inputs, provisional, seams = {}) -> final decision
  // ensure-present 失败 → throw；decision 不得返回、不得进 shared cache

// one-shot（M4）：不进 shared cache，不被 getMemoryIndex() 使用
resolveRecoveryRebuildDecision(options = {}) -> decision | { eligible: false, reason }
```

`memory.service.js` 新增可选 index seam（**已核实目前不存在**）：

```js
syncIndexMemory(options = {})            // options.index 缺省 → getMemoryIndex()
ingestArchiveFile(filePath, type, sourceId, timestamp, options = {})  // 透传 options.index
memorize(text, options = {})             // options.index 缺省 → getMemoryIndex()
```

> 已核实：`syncIndexMemory()` 当前**无参数**；`ingestArchiveFile()` 只透传
> `allowSecrets` / `namespace` / `silent` / `commitHash`；`memorize()` 直接调用
> `getMemoryIndex().upsert(...)`。三处都要加可选参数，**默认行为不得改变**。

> 已核实：`rebuildLocalIndex()` 末行 `return true`，结构化结果属于 `syncIndexMemory()`。
> **不得**为 marker 判定扩大 `rebuildLocalIndex()` 的公开返回面（M5）。

#### 当前适配器限制 —— 不是语义合同

已核实:`ZvecMemoryIndex.stats()` 经 `_allDocs()` 枚举,而后者是
`querySync({ topk: MAX_ENUM })`,`MAX_ENUM = 1000`(`memory-index-zvec.js:19,142-146`,
源码注释亦已写明超过该规模时 `stats` / `list` / `_maxId` 会**少计**)。

这是**当前适配器的实现限制**,不是恢复状态机的语义边界 —— 所以它记录在这里,
**不写进 spec §7.4 M5.2**。把 `1000` 固化进机制 Spec 会有两个后果:将来实现 pagination
时还要改机制合同;而且容易被误读成「1000 条以内才是产品支持范围」。

**M5.2 的精确相等仍然是权威。** Spec 侧保持后端无关的合同:无法证明精确计数 →
recovery incomplete → marker 保留 → 非零退出。

```text
Current adapter limitation — not a semantic contract:

ZvecMemoryIndex.stats() currently enumerates through
_allDocs(topk=MAX_ENUM=1000).

M5.2 exact equality remains authoritative.

If an exact validator count cannot be established—including
syncResult.chunks > 1000 under the current adapter—the recovery
must fail with EVO_ZVEC_RECOVERY_INCOMPLETE, preserve the marker,
close/reset all recovery indexes, and exit nonzero.

Prohibited in Task 6:
- clamp expected count to 1000
- compare Math.min(syncResult.chunks, 1000)
- skip count equality
- downgrade mismatch to warning
- clear marker after an inexact result
- modify memory-index-zvec.js
- add pagination or another counting API

Pagination/exact-count expansion requires separate authorization.
```

**方向是安全的,但要说清代价**:archive 超过 1000 chunks 时,恢复会 fail-closed 卡住
—— marker 保留、命令失败、无法切回 zvec。本仓当前 139 条记录,离上限尚远;子仓不一定。
放宽比较会把这个「卡住」换成「静默地用一个不完整的索引清掉 marker」,那正是本任务
存在的理由,所以宁可卡住。pagination / 精确计数扩展需要**单独授权**。

#### TDD 步骤（九步，逐步 RED → GREEN）

- [ ] **Step 1 (RED, characterization):** 先固化现状 —— 当前无 marker 概念时，
      `SAFE` 路径直接进 zvec；`rebuildLocalIndex()` 在 `impl === 'sqlite'` 时走 sqlite 分支、
      `fs.rmSync(zvecDir)` 调用次数为 0。这两条是后续所有断言的基线，必须先在
      **未改动的 main** 上绿
- [ ] **Step 2:** 实现 `zvec-containment-state.js` 的读 / 校验 / **排他创建写** / 清除，
      四类 status 与四个错误码齐全；`dir` 或 `collectionPath` 不可解析 → 按 M6.1 抛错；
      登记进 `template-manifest.js` 的 `core-cli` family `files` 数组
      （否则 `sync-runtime` 不镜像它）
- [ ] **Step 3:** `collectDecisionInputs()` 读取 marker；
      `resolveEngineDecisionFromInputs()` **保持纯函数**，只产出 provisional decision +
      `markerAction`：非 SAFE → `'ensure-present'` + `reason='containment'`；
      SAFE + marker → `'none'` + `reason='containment-recovery-pending'`。
      两条分支的 `loadZvecIndex` 调用次数断言均为 **0**
- [ ] **Step 4:** `persistEngineDecision()`（M3.1）—— 唯一写 marker 的地方。
      断言 `resolveEngineDecision()` 与 `sharedEngineDecision()` **两条入口都经过它**，
      且 marker 写入失败时 decision **既不返回也不进 shared cache**
      （直接给 shared 路径注入写失败，验证它不会缓存出一个「已成功降级」的判断）
- [ ] **Step 5:** `resolveRecoveryRebuildDecision()`；断言它不进 shared cache、
      不被 `getMemoryIndex()` 使用、不接受任何布尔 bypass 参数
- [ ] **Step 6:** `memory.service.js` 的三处 index seam；默认路径行为零变化的回归断言
- [ ] **Step 7:** `rebuildLocalIndex()` 接入两阶段语义（spec §7.3.1）：
      阶段 U 只重建 SQLite 且 marker 保留；阶段 R 按 **M5.1 发布顺序**
      （build → close builder → fresh validator 重开 → M5.2 四条断言 → close validator
      → 清 marker → reset），失败按 M6 退出
- [ ] **Step 8:** 并发与 fail-closed 边界：双 writer 首次写入（第 21 格）、
      path-unresolvable（第 20 格）
- [ ] **Step 9:** T8 全状态矩阵 + 两个突变负控（见下），live 与 template 双份

#### 事务合同（spec §7.4 M5.4 / M5.5，第 5 版新增）

全量复审在已通过 CI 的实现上发现两个 P1 —— 两者都不是"某一步写错了",而是
**恢复缺少事务边界**:

```text
P1-1  两个并发恢复：A 取到 eligible 后暂停，B 完整跑完并清掉 marker，
      A 再醒来删除 B 刚验证过的 collection 并中途失败
      → marker 已 absent + collection 是半成品 → 下一个进程直接开 Zvec
      已核实窗口：rmSync 发生在 ZvecMemoryIndex.initialize()（即 openWithCoordination）
      之前，构造函数只存路径，所以 Zvec 自己的锁盖不住

P1-2  失败的恢复污染在役 SQLite 的账本：ingestArchiveFile() 无条件写【全局】
      archive marker，与写入哪个 index 无关；恢复又在受保护 try 之前删掉它们
      → 已写进 builder 的档案：marker 谎称 SQLite 已索引（漏）
      → 未及写入的档案：marker 已删，下次 sync 重新 INSERT（重，upsert 无去重）
```

实现必须落实 M5.4(marker-generation-bound lease)与 M5.5(archive marker 事务化发布)。
要点:

```text
lease        wx/O_EXCL；身份含 markerFingerprint（marker 字节的 SHA-256）
             取得后【重新】判定，禁止沿用取 lease 前的 eligible
             释放按 leaseId CAS；不得按时间清 stale lease
             持有到 containment marker 清除完成之后
staging      build/validate 期间 archive marker 写进隔离集合，
             全局集合【从不就地修改】——"逐字节不变"由此保证，而不是靠回滚
manifest     文件名 + 内容 SHA-256；发布前重新核对；只比数量是不够的
发布         目录级换位：现集合改名让位 → staging 改名就位 → 失败则改回
```

#### T8 状态矩阵（必须全部固定）

| # | 场景 | 预期 |
|---|---|---|
| 1 | zvec + non-SAFE + marker absent | 写 marker；sqlite；`loadZvecIndex`=0 |
| 2 | 同一 non-SAFE 再次运行 | **不覆盖**首次 marker（证据保真） |
| 3 | SAFE + valid marker | `containment-recovery-pending`；sqlite；load=0 |
| 4 | SAFE + invalid marker | 同上（损坏不等于 absent） |
| 5 | SAFE + unreadable marker | recovery-pending；rebuild **拒绝触碰** zvec |
| 6 | sqlite pin + marker absent | 不创建 marker |
| 7 | sqlite pin + marker present | marker 保留；sqlite rebuild 不清它 |
| 8 | 再 pin 回 zvec + SAFE | **不得**绕过 marker |
| 9 | unsafe rebuild | 只重建 SQLite；旧 zvec 零触碰（`rmSync`=0，load=0） |
| 10 | SAFE recovery + dependency absent | 在删除旧目录**之前**失败；marker 保留 |
| 11 | SAFE recovery 完整成功 | build → close builder → **fresh validator 重开** → M5.2 四条 → close → 清 marker |
| 11b | builder close 后 fresh reopen 失败 | marker **保留**；命令失败（这是 optimize/close 被吞掉的唯一外部证据） |
| 11c | fresh validator `stats.count !== syncResult.chunks` | marker 保留；命令失败 |
| 11d | `syncResult.chunks = 1001`，validator `stats.count/chunks = 1000`（MAX_ENUM 上界，**注入结果**，禁止真造 1001 条数据） | `EVO_ZVEC_RECOVERY_INCOMPLETE`；marker 保留；validator close；shared cache reset；命令失败 |
| 12 | archive invalid / partial | marker 保留 |
| 13 | rebuild 中途抛错 | marker 保留 |
| 14 | marker clear 失败 | reset recovery index；marker 保留；命令失败 |
| 15 | marker write 失败 | **不得**返回「成功降级」的 SQLite 实例 |
| 16 | marker 存在时普通 `getMemoryIndex()` | 永远拿不到 zvec |
| 17 | one-shot recovery decision | 只能被 rebuild 使用，不污染 shared cache |
| 18 | 非 win32 + marker absent | 原行为不变 |
| 19 | 非 win32 + marker present | 仍需显式恢复（M7） |
| 20 | collection path / marker 目录不可解析 | `EVO_ZVEC_CONTAINMENT_STATE_WRITE`，`reason='collection-path-unresolvable'`；**不返回 SQLite 实例**（M6.1） |
| 21 | 两个 writer 并发首次写入 | 恰好一个 `written=true`，另一个 `alreadyPresent=true`；盘上内容 = 第一个成功者（M1.1） |

#### 第 6 版:所有权与发布仍不是完整事务（spec §7.4 M5.4a / M5.5a / M5.5b）

第 5 版实现了 lease 与 staging 的**主体**,CI 五格首跑通过。全量复审发现**最后两层**
仍然漏:

```text
P1-3  lease 的「CAS」实际是 read → unlink → write，跨进程不原子：
      两个新 generation 获取者可以互相删掉对方刚写的 lease → 同代两个 owner；
      而且【正常成功路径】就能让旧 owner 的 release 删掉新 generation 的 lease
P1-4  发布事务的三条失败路径：回滚失败后 finally 无条件删 parked（原件永久丢失）；
      已换位后删 parked 失败却报 archive-publish-failed（命令失败与盘面不符）；
      发布成功但清 containment marker 失败 → SQLite 继续服役，账本却已被换成新集合
P1-5  recovery lease 只隔离 recovery↔recovery，挡不住【正常 sync 闯入目录换位窗口】
```

修法要点:

```text
M5.4a  每个 generation 一个 lease 文件 zvec-containment-recovery.<fingerprint>.lease.json
       获取 = 单次 wx；EEXIST = 同代进行中；【绝不删除或替换任何 lease】
       所有权由文件名身份 + O_EXCL 保证，不再依赖读-改-写时序
M5.5a  发布顺序：staging → 验证 → manifest → 取发布锁 → 锁内再校验 manifest
       → park 原件 → 换位 → 清 containment marker → 释放锁 → 【此时才】删 parked
       回滚失败 → 保留 parked 与锁，reason=archive-publish-rollback-failed，不删证据
       已提交后删 parked 失败 → 仍算成功，保留备份并诊断，不得误报失败
M5.5b  全局 archive-marker 锁：普通 sync、普通 archive 写入、recovery 最终换位共同遵守
       recovery 构建 staging 时不取锁；不按时间回收；不可确认所有权时 fail-closed
```

#### 第 7 版:source fence 与 quarantine 所有权（spec §7.4 M5.5c / M5.5d / M5.5e）

```text
P1-6  archive() 在取锁【之前】就 ensureDir(indexDir) 并把 raw archive 落盘
      → 竞态 A：重建正在换位的 indexDir，普通 archive 仍能制造 rollback-failed
      → 竞态 B：锁内 manifest 校验之后改源 → marker 被清，而新 Zvec 不含那个 archive
P1-7  rollback-failed 时只保留了 publication lock，外层 finally 仍释放 recovery lease
      → 第二个恢复可重新取得同代 lease 并删除/重建 collection，直到发布阶段才被挡
P2-1  锁的 acquire 抛错未转成 coded reason；release 失败被空 catch 吞掉、
      released=false 从不检查 → 静默的持久 lockout，命令却报成功
```

修法要点:

```text
M5.5c  archive() 的五项（raw 目录、index 目录、raw 落盘、ingestion、marker 写入）
       全部移进锁内；锁未取得时零修改
       边界：外部编辑器 / git checkout 不受本进程锁约束，那类变化由 manifest 校验负责
M5.5d  rollback-failed 时【连同 recovery lease 一起保留】；
       第二个恢复必须在任何 rmSync / builder 构造之前返回 recovery-in-progress
M5.5e  acquire 失败 → coded archive-marker-lock-failed；
       release 失败：未提交则保留原因并保持 fail-closed，已提交则 WARN + appendLog 但仍算成功；
       released=false 与抛错同等对待
```

#### 第 8 版:锁的稳定身份与 lease 终态可见性（spec §7.4 M5.5f / M5.4b）

```text
P1-8  锁路径直接派生自 getIndexMemoryDir()，而该函数会实时把 vect_memory rename 成
      index_memory，并在 rename 失败时【返回 legacy 路径】
      → 首次升级期间 A 拿 modern 锁、B 拿 legacy 锁，两者都以为持有全局锁
      → B 进回调后重新解析目录会拿到 modern，于是【持 legacy 锁改 modern marker set】
      → M5.5b/M5.5c 关掉的窗口全部重新打开
P2-2  recovery lease 的释放仍是 try { ... } catch (_) {}，也不检查 released === false
      → marker 未清 + unlink EBUSY/EACCES/not-owner ⇒ 永久 recovery-in-progress，
        而命令只报告原始恢复失败
```

修法要点:

```text
M5.5f  archiveLockPathFor(indexDir) 保留签名，但返回【共同父目录 + 固定文件名】；
       archiveLockPathFor(vect_memory) === archiveLockPathFor(index_memory)；
       诊断消息中的锁路径一律取自该函数，不得就地拼接 `${indexDir}.publication.lock`；
       不修改 runtime.js
M5.4b  非 quarantine 路径也必须检查 releaseRecoveryLease 的返回值与异常：
       marker 未清 → console.error + appendLog，保留原始 failure reason；
       marker 已清 → console.warn + appendLog，仍算成功；
       absent → 释放目标已达成，不报告；not-owner / unreadable / 抛错 → 必须报告
```

#### 第 9 版:legacy migration 也必须受同一把锁约束（spec §7.4 M5.5g）

```text
P1-9  锁的身份稳定了，被保护的目录本身却仍会在锁外改名。
      getIndexMemoryDir() 就地执行 vect_memory → index_memory，任何调用者都能触发，
      包括 summarizeArchiveHealth() 这样的【只读】路径；
      而锁包装器在【取锁之前】调用它，archive/sync/rebuild 又在事务内重新解析。
      → 普通 sync：ensureDir(legacy) 重建空目录、从空集合算 skipped、
        重复插入 SQLite、marker 却写到 modern —— 一次事务用了两个 ledger identity
      → recovery：park/publish 落在 legacy，marker 清除后 getter 返回 modern，
        刚验证并发布的那一份被搁死 —— 直接违反 AC5
```

修法要点:

```text
M5.5g  getIndexMemoryDir() 变为纯解析（modern 优先，其次 legacy，都无则 modern）；
       migrateLegacyIndexMemoryDir() 保留为显式 writer，只有 publication-lock owner 可调用；
       withArchiveMarkerLock 先用纯计算的 anchor 取锁，取锁后才 migrate，
       并把唯一 activeIndexDir 传给回调；
       archive / sync / rebuild / recovery publication 全程使用该 activeIndexDir，
       事务内不得再调用 ambient getter
```

#### T8f — 双 recovery 的 stale-eligibility 竞态（M5.4）

确定性地制造 P1-1 的交错(注入暂停点,不靠时序侥幸):

```text
A 读到 eligible 后暂停
B 取 lease → 重建 → 验证 → 清 marker → 释放 lease
A 恢复执行
```

断言:

```text
A 必须在【任何 rmSync 之前】停止
A rmSync 调用数        = 0
A builder 构造数        = 0
B 验证过的 collection    完整保留
normal decision         = zvec
```

再覆盖反向:

```text
A 持有 lease 期间 B 启动
→ B reason = recovery-in-progress
→ B 破坏性调用数 = 0
```

#### T8g — archive marker 事务（M5.5）

初始状态:

```text
SQLite 已含 A/B；archive marker A/B 存在；containment marker 存在
```

在 Zvec builder 写入 B 时注入异常,断言:

```text
containment marker        present
archive marker 目录        与失败前【逐字节相同】
SQLite 行数               不变
随后一次普通 SQLite sync   新增 0 条（这条才真正证明账本没被污染）
```

再加 source mutation:

```text
恢复期间修改 / 新增 raw_memory 文件
→ manifest mismatch
→ recovery incomplete
→ 不发布 archive marker
→ 不清 containment marker
```

#### 突变负控（证明矩阵不是空转）

- [ ] **Step 10 (mutation A):** 让 `SAFE + marker` 允许调用 `loadZvecIndex` → T8 **必须**变红
- [ ] **Step 11 (mutation B):** 把清 marker 提前到 rebuild 之前 → 「中途失败后 marker 仍在」的断言
      **必须**变红
- [ ] **Step 12 (mutation C):** 把清 marker 提前到 **fresh validator 重开之前**（即只用 builder
      进程内的 stats 就判定成功）→ 第 11b 格**必须**变红。
      这条专门守 M5.1：optimize / close 的异常被吞掉，builder 进程内读得到**不等于**
      下一个进程打得开
- [ ] **Step 13 (mutation D):** 只给 `resolveEngineDecision()` 加 marker 写入、让
      `sharedEngineDecision()` 继续直调纯 resolver → 共享路径的 marker 断言**必须**变红。
      这条专门守 M3.1 —— 生产走的正是共享路径
- [ ] **Step 14 (mutation E):** 绕过 recovery lease（不取或不在取得后重新判定）
      → T8f 的 stale-eligibility 用例**必须**变红。守 M5.4
- [ ] **Step 15 (mutation F):** 恢复期间直接写全局 archive marker（不走 staging）
      → T8g 的「逐字节相同」断言**必须**变红。守 M5.5
- [ ] **Step 16 (mutation G):** 退回单一共享 lease 路径 + read/unlink 替换
      → F1 或 F2 **必须**变红。守 M5.4a
- [ ] **Step 17 (mutation H):** 清 marker 失败时不回滚 archive markers，
      或 finally 无条件删除 parked → G1/G2 **必须**变红。守 M5.5a
- [ ] **Step 18 (mutation I):** 把 archive 的 raw / indexDir 写入移回锁外
      → G5 或 G6 **必须**变红。守 M5.5c
- [ ] **Step 19 (mutation J):** rollback-failed 后仍无条件释放 recovery lease
      → G7 **必须**变红。守 M5.5d
- [ ] **Step 20 (mutation K):** 把锁路径恢复成 `` `${indexDir}.publication.lock` ``
      → G9 **必须**变红。守 M5.5f
- [ ] **Step 21 (mutation L):** recovery lease 释放退回空 catch / 忽略 released=false
      → G10 **必须**变红。守 M5.4b
- [ ] **Step 22 (mutation M):** 把 `getIndexMemoryDir()` 恢复为隐式调用
      `migrateLegacyIndexMemoryDir()`，或把 migration 移回取锁之前
      → G11 **必须**因双目录 / marker 分裂 / 重复 row 变红。守 M5.5g

#### 合同回写:两处实施期采用的语义（spec §7.4 M5.2 / M3.1）

实施期作出、复审已接受、本轮正式写回 canonical contract 的两条判断。它们改的是合同**字面**，
不是机制：

```text
① engine predicate —— Zvec engine-family identity check
   原文 validator.engine === 'zvec' 永远不可能成立：适配器公开的是 zvec-jieba-fts。
   字面执行会让每一次恢复都以 validator-not-zvec 失败。
   改为 typeof === 'string' && startsWith('zvec')；
   sqlite-fts5-trigram 或任何非 zvec 前缀仍必须失败。
   精确计数、真实 native query、fresh reopen 三项要求不变。

② 注入路径的 marker 语义 —— 路径注入是纯判定 seam，不是 ambient 项目身份
   「非 SAFE → ensure-present」只对真实 ambient 路径成立。
   注入 paths/collectionPath 且无显式 markerDir → 不读也不写 ambient marker，
     记 markerSkipped: 'injected-path'；
   显式 marker 只作输入快照，不因此获得写权限；
   只有真实 ambient production path 或显式 markerDir 才允许 marker I/O。
   读与写必须分别判定：只栅栏住写，会让假设性 SAFE 路径继承真实项目的债务。
```

#### T8g 再扩展 — source fence 与 quarantine（M5.5c / M5.5d / M5.5e）

```text
G5  锁被 recovery 持有、indexDir 暂时不存在时调用 archive()
    → reason=archive-marker-busy
    → indexDir 仍不存在；raw_memory 文件名/内容/mtime 全不变；
      DB 行数不变；全局 marker 集合不变
    专门防住 ensureDir(getIndexMemoryDir()) 与 fs.writeFileSync(filePath) 跑回锁外

G6  recovery 在【锁内 manifest 校验之后】暂停，此时 archive() 竞争
    → archive busy，raw 文件不得落盘
    → 恢复继续后：success、source==rebuilt、marker cleared、新 Zvec 不缺 archive

G7  rollback-failed 之后的完整 quarantine
    → 当前 generation 的 recovery lease 仍在
    → 第二个恢复 reason=recovery-in-progress，rmSync=0，builder=0
    → parked 原件与 publication lock 均未变

G8  锁的终态报告
    → exclusive-create 抛 EACCES → recovery reason=archive-marker-lock-failed
    → 已提交后 release 失败 → 仍 success、marker absent、有可见 WARN/日志、
      保留的锁让后续 global sync fail-closed
```

#### T8g 再扩展 — 锁身份与 lease 终态（M5.5f / M5.4b）

```text
G9  legacy/modern 只能有一把锁
    legacy = <root>/vect_memory，modern = <root>/index_memory
    → archiveLockPathFor(legacy) === archiveLockPathFor(modern)
    → A 经 legacy 取锁后，B 经 modern 取锁必须 archive-marker-busy
    → A 释放后 B 才能取得
    再加 migration-shaped 用例：首次解析返回 legacy、后续解析返回 modern，
    整个 operation 仍始终受【同一个】lock 文件保护

G10 recovery lease 终态
    失败路径：恢复先以 validator/build 错误失败 + lease unlink 注入 EBUSY
      → 原始 failure reason 不变；marker present；lease present；
        console.error 与 memory.log 均有记录；
        第二次 recovery 在 rm/builder 之前返回 recovery-in-progress
    成功路径：marker 已清后 lease unlink 失败
      → recovery success；marker absent；console.warn + memory.log；
        不得改判为失败
```

#### T8g 再扩展 — legacy migration 的串行化（M5.5g）

G9 证明了「只有一把锁」，但没有覆盖「已经只有一把锁，仍有人不取这把锁就迁移整个受保护
目录」。G11 补的是这一层。

```text
G11a  getter 纯度
      初始：legacy 存在、modern 不存在
      → getIndexMemoryDir() 返回 legacy
      → legacy 仍在、modern 仍不存在、目录名/内容/mtime 均未变
      → renameSync 调用数 = 0

G11b  持锁 sync 与只读探针
      A 取得 publication lock；锁内 migration 第一次被注入失败，因此固定用 legacy；
      A 读完 marker set 后暂停；B 调用 summarizeArchiveHealth() / getIndexMemoryDir()
      → B 不得迁移 legacy
      → A 完成后只有一个有效 ledger，新旧 marker 全在同一目录
      → SQLite 不出现重复 row
      A 释放后再跑一次正常持锁 sync
      → 允许 migration legacy → modern
      → modern 含完整 marker set，legacy 不再存在

G11c  recovery publication 使用 pinned directory
      在锁内固定 active dir 后暂停，再跑只读 getter
      → 只读路径不发生 migration
      → park / publish / rollback 全部使用同一 active dir
      → 成功后 marker cleared，且此后纯 getter 返回的 ledger
        正是刚发布并验证过的那一份
```

#### T8f 扩展 — 真实的 lease 所有权竞态（M5.4a）

```text
F1  旧 generation 的 lease 在场，B1 与 B2 同时获取新 generation
    → 恰好一个 acquired=true，另一个 recovery-in-progress
    → 两个 owner 绝不可同时成立
F2  旧 owner 释放与新 owner 获取交错
    → B 的 lease 仍在；A 不能删掉 B 的 lease
F3  同 fingerprint 的 lease 内容损坏
    → fail-closed；不删除；不开始任何破坏性动作
```

#### T8g 扩展 — 完整的发布回滚（M5.5a / M5.5b）

初始 archive-marker 文件必须有**非空内容**,否则「旧集合」与「staging 的空文件」在
逐字节比较下无法区分。

```text
G1  清 containment marker 失败
    → containment marker 保留；全局 marker 目录逐字节相同；行数不变；
      普通 sync 新增 0；staging 已删；回滚成功后 parked 已删
G2  staging 换位失败【且】回滚也失败
    → reason=archive-publish-rollback-failed；parked 原件完好；
      finally 不得删除 parked；containment marker 保留；锁保持 fail-closed
G3  正常 sync 与发布争锁（两个方向都要覆盖）
    → recovery 撞上：archive-marker-busy，canonical 集合不变，marker 保留
    → 正常 sync 撞上：不得创建新的 indexDir
G4  已成功清除 containment marker 之后，删除 parked 备份失败
    → 恢复仍算成功；canonical 新集合保留；下一个进程判定为 zvec；
      保留 parked 备份；【不得】误报 archive-publish-failed
```

六条突变都要留下书面记录（哪条断言、什么消息），未验证的矩阵不算完成。

#### 真实安全路径集成测试（必须，不得以 mock 替代）

seam 注入能证明**决策**正确，但证明不了 fresh reopen 这件事本身 —— 一个全 mock 的
验证器可以「重开成功」而真实 collection 根本没落盘。因此必须有一条走**真实
`@zvec/zvec`** 的端到端用例。

路径必须是 **ASCII 临时目录**；**不得**使用危险路径、**不得**设 `ZVEC_UNICODE_PROBE`、
**不得**触发任何 native crash 实验。

```text
 1. 建最小 raw_memory fixture
 2. 写入合法的 recovery-required marker
 3. 执行 recovery rebuild
 4. builder close
 5. fresh validator 真实 reopen
 6. stats 精确相等
 7. searchText no-match 探针返回数组
 8. validator close
 9. marker 已被清除
10. 启动【第二个独立子进程】
11. 正常 decision 得到 zvec
12. recall / read 可用
```

第 10–12 步是这条用例不可替代的部分:只有另一个进程才能证明「持久化完成」。

CI 覆盖要求:

```text
必须实际执行于  windows-latest / node 22
                windows-latest / node 24
Ubuntu 可同时运行
不得因为是 Windows 就 skip
依赖确实不可用 → 判为失败，不得把真实恢复成功路径降级为纯 mock
```

确定性 seam 矩阵仍必须在**全部**平台运行。

#### Commit boundary

```text
最多 5 个提交，一个任务阶段一个：
  1. feat: add zvec containment state marker         （Step 2）
  2. feat: gate engine decision on recovery marker    （Step 3–5）
  3. refactor: thread an index seam through sync      （Step 6）
  4. feat: recover zvec through explicit rebuild      （Step 7）
  5. test: freeze the containment recovery matrix     （Step 1、8、9 与四条突变）
禁止 amend / force push；Ready 与 merge 需另行授权。
```

**验收**：T8 二十一格（含 11b / 11c）全绿 + 四条突变负控各自验证过；
`raw_memory` **仅被只读消费** —— 文件内容、mtime 与目录结构均不得修改
（「不得触碰」与「从 raw_memory 重建」字面冲突，此处取前者的真实含义）；
`sync-runtime --check` in-sync；live 与 template SHA256 逐对一致。

### Task 7: verify 诊断与恢复指引（AC6）

> **授权状态**（2026-08-07 复审后更新）：
> **Step 1 RE-FROZEN** —— §7.5 局部重开，D5 由四态改为五态（`no-debt` / `unsafe` /
> `recovery-pending` / `marker-damaged` / `debt-under-pin`），闭合 D2 × §7.4 M8 × D5
> 的内部冲突；D3 明确 `present` 必须呈现 marker 原始记录；D4.1 要求 call-level 计数；
> D7 把 C 拆为 C1/C2/C3 并规定 durable evidence 格式。
> **Step 2 CHANGES REQUIRED** —— 首轮实现被复审退回，返工中。
>
> ⚠️ **本轮退回的首要原因是流程，不是设计**：首轮实现发现 D5 未覆盖
> 「pin sqlite + marker present」组合后，**现场补设计了第五状态并继续推进到 CI**，
> 而计划要求的是「发现冻结项本身有误 → 停止并上报」。设计方向后被复审采纳，
> 但裁定权本应留在复审。若返工中再次发现 re-freeze 后的合同仍无法覆盖某个组合，
> **立即在该点停止**，不得先做成 commit 再请求追认。

**Files:**（spec §7.5 D8；D1 的审计结论是诊断**不需要**改任何模块的导出面）
- Modify: `.evo-lite/cli/memory.service.js`
- Sync: `templates/cli/memory.service.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`
- Test: `.evo-lite/cli/test/integration.js`
- Sync: `templates/cli/test/integration.js`
- Create: `docs/validation/zvec-win-unicode-verify-diagnostics.md`

**当前没有证据要求修改**（擅自扩大范围即为越界）：

```text
memory-index.js              peekEngineDecision 已导出于 :649，直接消费即可
zvec-containment-state.js    readContainmentState 已导出于 :458，直接消费即可
memory-index-zvec.js         Task 5 已收口
runtime.js / memory.js / template-manifest.js / package.json / .github/**
active_context.md / raw_memory/**      属 context closure，本轮 FROZEN
```

#### Step 1：诊断合同冻结（docs only）—— COMPLETE

- [x] **裁定收法 A/B**：采纳 **B（verify 参与 ambient 判定）**，理由与被否决的 A 记入 §7.5 D0
- [x] **审计数据来源**：核实 `peekEngineDecision()`（`memory-index.js:501`，导出 `:649`）与
      `readContainmentState()`（`zvec-containment-state.js:118`，导出 `:458`）均已可用；
      `memory.service.js` 已 require state 模块（`:40-43`）与 `getDbPath`（`:24`）→ **零导出面扩大**（D1）
- [x] **审计 decision 覆盖面**：两处真实缺口 —— 非 SAFE 分支只有写入结果、无 marker 读取态；
      显式 pin sqlite 分支完全不带 marker。故合同要求独立只读一次 marker（D2）
- [x] **marker 四态呈现**与「一律不得建议删除、不得折叠进 present」（D3）
- [x] **裁定「collection 未被打开」的可观测证据边界** —— verify 运行时**不能**证明，
      只能报本进程 decision 事实；证明属测试层（D4）+ 九项零副作用计数（D4.1）
- [x] **五种用户可见状态与 nextSteps**（`no-debt` / `unsafe` / `recovery-pending` /
      `marker-damaged` / `debt-under-pin`），钉死 `unsafe` 与 `recovery-pending` 不得共用文案，
      且 `no-debt` 文案不得断言引擎状态（D5，2026-08-07 re-freeze）
- [x] **措辞禁令**（D6）与**承重负控 A–I 完整内联**（D7，C1/C2/C3/C4 拆分 + durable 证据格式）
      + 文件范围（D8）
- [x] spec 测试矩阵新增 **T12 八条**；AC6 指向 §7.5；AC8 由 T1–T11 扩为 T1–T12

#### Step 2：生产实施 —— AUTHORIZED

- [x] **Step 2.1（基线）**：先在未改产品代码的状态下跑并记录
      `npm test` / `TEMP=RUNNER~1 npm test` / `sync-runtime --check`
- [x] **Step 2.2**：`verify` 增加 containment 段，数据来源**只允许**
      `peekEngineDecision()` + 一次 `readContainmentState(path.dirname(getDbPath()))`；
      **禁止**经 `resolveEngineDecision()` / `sharedEngineDecision()` /
      `resolveRecoveryRebuildDecision()` / `getMemoryIndex()` 刷新诊断（D1）
- [x] **Step 2.3**：五态呈现与各自独立的 nextSteps（D5）；显式 pin sqlite 且 marker 尚存 →
      `debt-under-pin`，单独显示尚存 marker
- [x] **Step 2.4**：措辞按 D4 边界与 D6 禁令 —— **不得**承诺 collection 内容未被读取，
      **不得**在任何状态下建议删除 marker
- [x] **Step 2.5**：T12 八条（live + template 双份）
- [x] **Step 2.6**：承重负控 A–I 逐条施加并确认变红，按 D7 记录七项字段；
      负控还原后再完整跑一次两种环境的绿色基线
- [x] **Step 2.7**：证据落成 `docs/validation/zvec-win-unicode-verify-diagnostics.md`，
      区分「仓库可复现证据」与「人工结论」
- [x] **Step 2.8**：`templates/cli/` 同步；`sync-runtime --check` in-sync；三对 live/template 逐字节一致

#### Step 2 返工项（2026-08-07 复审 CHANGES REQUIRED）

首轮实现（`51fc7d6`…`1cea66b`，CI 5/5）被退回，四项发现：

- [x] **R1（BLOCKER）** 采纳 re-frozen 五态：`normal` → `no-debt`，正式实现
      `debt-under-pin`；修掉两处错误兜底 —— `pin+marker absent` 与
      `dependency-unavailable+marker absent` 此前都被压成 `normal`，而旧 `normal`
      的判据含 `impl==='zvec'`
- [x] **R2（BLOCKER）** D3：report 与 CLI 输出补 marker 原始记录
      `recordedCollectionPath` + `recordedContainment{verdict,layer,reason}`，
      并与「当前判定」分层显示；复用 D2 已取得的那一次 snapshot，不再读第二次
- [x] **R3（BLOCKER）** D4.1 九项改为 **call-level 计数** guard（测试侧模块拦截），
      终态哈希/指纹降为辅助佐证；补 mutation C2（auto rebuild）、C3（recovery
      ownership / lease）
- [x] **R4（IMPORTANT）** validation 增 durable appendix，逐条转录 A–I 的
      mutation point / hunk / 施加变化 / 观察到的断言 / 三段 SHA-256 / 镜像哈希

#### Step 2 第 2 轮返工项（2026-08-07 复审 CHANGES REQUIRED）

第 1 轮的 R1/R2/R4 判为实质闭环；剩余问题集中在 D4.1 的证明机制与由此产生的一次接口越界。

- [x] **R5（BLOCKER）** 撤销为测试而加的产品导出 —— `buildContainmentDiagnostics`
      从 `module.exports` 移除。允许修改某个文件 ≠ 允许扩大它的产品接口。
      改由测试侧 `Module.prototype._compile` 桥接注入 `__testBuildContainmentDiagnostics`，
      产品导出面逐字节回到 Task 7 开始前
- [x] **R6（BLOCKER）** 补足 D4.1 的三处证明缺口：`C1b`（以 fs 直写 marker、字节相同，
      末态无差异）、`B2`/`B3`/`B4`（构造 / `initialize()` / `stats()` 分别独立守护，
      不再折叠成一条）、`C2` 改为调用真实 `rebuildLocalIndex()` 而非决策 helper。
      负控总数 12 → **16**
- [x] **R7（IMPORTANT）** plan 机械同步 re-frozen 合同：四态→五态、T12 六条→八条、A–G→A–I
- [x] **R8（装置，非产品）** mutation runner 事务化 —— crash recovery 移入下一次启动的
      PRE（`SIGKILL` 下不存在进程内兜底）；residue 检测由手写 pattern 改为按干净基线
      派生的**出现次数**比对（G 的特判随之删除）；每条跑完清理 temp runtime root。
      事故与旧 E/F 的 `inadmissible` 处置见 validation §11
- [ ] 重跑本地 gates（node 24 三项 + sync-runtime + node 22），新 head SHA 触发
      新的 `pull_request / attempt 1`；旧失败 run 不 rerun

**验收**：`npm test` 与 `TEMP=<绝对短名路径> npm test` 均 EXIT 0；`sync-runtime --check` EXIT 0；
三对镜像逐字节一致；T12 八条全过；负控 A–I 全部 effective 且 guardHit 命中各自性质；
危险路径样本上 `verify` 可诊断且不崩溃。

**⛔ 停止点 3**：CI 首轮 gate（`pull_request` / attempt 1 / 5-of-5）完成后**硬停**，
等待 Task 7 全量实现复审。不 Ready、不 merge、不进入 Task 8/9、不做 context closure。

### Task 8: 发布 enforcement point（AC7）

> **已核实的阻塞事实**：`buildSpecRegistry()` 当前**不输出** `releaseBlocking`，也没有
> blockers 集合（逐 spec 字段见 spec §8.2.1）。仅写 frontmatter **不会**形成机器发布门。
> 好消息是 `adoptSpec` 的 `reservedKeys` 不含该键，非保留键**原样保留追加**
> （`spec-portfolio.js:490-496`），字段能在 adopt 后存活 —— 缺的只是 registry 的解析与派生。

- [x] **第 1 步（决策点，已定稿）**：结构化 blocker 载体 = **Spec Portfolio 字段**。
      理由：复用既有结构化治理域，不引入第二个真相源，天然满足「不扫自然语言」，
      且字段已能在 adopt 流程中存活。备选（release manifest / 独立 governance IR）
      **需书面否决理由方可改选**，不得在编码中静默切换。
- [x] **负责文件**：`spec-portfolio.js`（live + template）、`release-preflight.js`（live + template）、
      `package.json`（`prepublishOnly`）、`test/governance.js`（live + template）
- [x] **严格 scalar 解释**（spec §8.2.2.0）——**已实测** `parseFrontmatter()` 不是 YAML parser，
      `releaseBlocking: true` 得到字符串 `"true"`，`"2026-07-31"` 得到**含引号**的
      `"\"2026-07-31\""`。故按原始字符串判定：`"true"`→true、`"false"`→false、
      **其余一切（`ture`/`yes`/`1`/带引号 `"true"`）→ schema error**。
      不 trim 引号、不折叠大小写、不做宽松 YAML 推断
- [x] `spec-portfolio.js`：registry 逐 spec 输出 `releaseBlocking`，顶层新增 `blockers`、
      **`errors`、`source{directoryReadable,discoveredFileCount,parsedSpecCount}`**，
      按 spec §8.2.2 表派生；`parked` 默认仍 BLOCK
- [x] **registry health（spec §8.2.3.1，堵 fail-open）**：现有 builder 正常退化时**不抛错**
      （目录不可读 → 空集；单文件解析失败 → `parsed=null` 后跳过），因此损坏的
      release-blocking spec 会**静默消失并放行 publish**。必须把退化编码进 `errors`：
      目录不可读 / 任意 `*.md` 读取或解析失败（保留路径）/
      `discoveredFileCount !== parsedSpecCount` → 全部 FAIL
- [x] waiver schema（spec §8.2.2.1，**canonical 不带引号**）：
      `releaseBlockDisposition: waived`（原始值严格等于，封闭枚举）+
      `releaseBlockReason`（trim 后非空）+ `releaseBlockReviewedAt`（`^\d{4}-\d{2}-\d{2}$`
      且**日期 round-trip 校验**，挡掉 `2026-02-31`），三项**同时**有效才放行；
      缺一或非法 → 保持 BLOCK + schema error；
      **waiver 只对 `parked` 生效，不可放行 `adopted`/`active`**
- [x] 实现 `prepublishOnly` → `release-preflight`：**现场** `buildSpecRegistry(projectRoot, {write:false})`
      派生 blockers（**禁止**读取 `.evo-lite/generated/spec-registry.json` —— 该文件实际存在
      且可能 stale，漏读方向是放行）。
      **放行条件是 `registry.errors.length === 0 && registry.blockers.length === 0`，
      不是「调用未抛异常」**；任一不满足 → `exit != 0`
- [x] `release-gate.yml` 新增 containment **证据** job（非阻断角色）
- [x] **验收测试（T10，十条）**：①`adopted`/`active` blocker → prepublish fail
      （`npm publish --dry-run` 验证）；②`parked` blocker 无 waiver → fail；
      ③`parked` + 三项齐全合法 waiver → pass；④`done` spec → pass；
      ⑤字段缺失/`false` → 不影响 publish；
      ⑥**`releaseBlocking: ture` 之类非布尔值 → schema error → fail**；
      ⑦disposition 非法或不完整 → 保持 fail；
      ⑧`adopted`/`active` blocker 不可被 waiver 放行；
      ⑨**FOCUS 自然语言含 "release-blocker" 字样 → 不产生机器判断**；
      ⑩**stale `spec-registry.json` 与现场结果冲突 → 以现场为准**
- [x] **T11 registry health 回归（四条）**：①**损坏一个 release-blocking spec 的 frontmatter
      → 该文件不得静默消失**，须进 `errors`（含路径）且 prepublish fail；
      ②`docs/specs` 不可读 → errors + fail；③`discoveredFileCount !== parsedSpecCount` → fail；
      ④放行条件为 `errors.length === 0 && blockers.length === 0`
- [x] 补充验收：containment 合同回归时该 PR **变红**；普通 PR 不执行 crash probe
- [x] 记录：`release-gate.yml` 是 informational，提升为 required 是手动 repo-admin 步骤
- [x] `templates/cli/` 同步；`release-preflight.js` 登记进 `template-manifest.js`

**验收**：T10 十条 + T11 四条 + 两条补充验收全绿。

### Task 9: 生命周期收口（2026-08-07 kickoff audit 后重新冻结）

> **adopt 不在此处**。它已按 spec §13 前移到 Phase D 治理闭环、实施授权之前；
> 本任务的前提是 spec **早已 adopted**。

- [x] ~~建立 `docs/plans/zvec-win-unicode-containment.md`~~ —— **已作废并删除**。
      它建立在「`plan scan` 不扫 `docs/superpowers/plans/`」这个错误前提上，实际造成
      同 id 重复登记（见上文 Portfolio 落位决定）。本文件即唯一 plan

#### 9.0 kickoff audit 的两处接口错位（承重，已裁定）

原 Task 9 的六条清单**不可照做**。只读 audit 在 `main@04fd869` 上机械确认了两处
Task 9 原计划与现有治理机制之间的真实错位：

**① `mem close --apply` 不适用于本 spec。**

```text
$ mem close docs/specs/zvec-win-unicode-containment.md --preview
readiness: NO-CONTRACT
```

`applyClose` 的 Gate 2 是 `readiness !== 'READY' → refuse`，所以它会拒绝本 spec。
裁定：**`NO-CONTRACT` 是一种诚实的 opt-out，不是 machinery 故障** ——
它表示这个历史 spec 没有采用 verification-contract 的 criteria schema。
closure 子系统自己的文案就写着 "add a criteria block for a real gate, **or close manually**"。

```text
方案 1  事后补 criteria           REJECTED —— 给已完成 Tasks 1–8、已过多轮复审与真实 CI 的
                                 spec 补验收合同，会制造「合同在实施结束后才定义」的伪证据链
方案 2  裸改 status: done         REJECTED —— 这才是真正的绕过 enforcement point
方案 3  reviewer-attested 人工关闭  ACCEPTED
```

**真正的绕过不是「人工关闭」，而是「在收口证据完成前提前改 `status: done`」。**
因此 lifecycle state 的变更必须是收口的**最后一步**。

**② `mem commit` 会一并执行 context closure，必须移出 Task 9。**

```text
commitWithContext() → track() → archive(...)                      写 raw_memory
                             → fs.writeFileSync(ACTIVE_CONTEXT_PATH)  写 focus/backlog
                → git add <active_context> <archivePath>
                → git commit                                       第二个 commit
```

裁定：

```text
Task 9 governance closeout   ≠   context closure

mem commit / track / archive / trajectory / META    → 不属于 Task 9，留给独立 context closure
backlog / FOCUS 的必要运行时更新                      → 走受支持的 mem context 命令，属 Task 9C
Task 9 的仓库变更                                    → 用普通 git commit / PR
```

#### 9.1 承重不变量

```text
releaseBlocking: true      全程保留，永不删除、永不改 false
```

收口成功要证明的是 AC7 的**生命周期闭环**，不是把 gate 拆掉：

```text
active  + releaseBlocking:true   →  BLOCKED
shipped + releaseBlocking:true   →  CLEAR
```

`deriveBlocker()` 正是这么实现的（`state === 'shipped'` 返回 no blocker）。

#### 9.2 分段授权：9A–9D

**9A — closeout procedure re-freeze（docs-only）**

- [x] 同步 spec / plan 顶部阶段摘要至真实状态与 `main@04fd869`
- [x] 用本节固化 kickoff audit 的裁定
- [x] 普通 git commit → Draft PR → 首轮 `pull_request` CI → 硬停（PR #20 → main@a56ae21）

**9B — 上游上报（外部写操作，单独授权）—— DONE 2026-08-07**

> **durable issue URL**：<https://github.com/alibaba/zvec/issues/665>
> `alibaba/zvec#665`，OPEN，创建于 2026-08-07T16:07:21Z。

- [x] 目标为 **`alibaba/zvec`** —— `@zvec/zvec` 0.6.0 的 `bugs.url` 指向它；
      `zvec-ai/zvec-node` 只是 Node binding 源码仓，不是 bug tracker
- [x] **新建 issue，不并入 `alibaba/zvec#626`**。#626（2026-07-28，仍 open）现象相关但
      并非同一故障：它是 Python binding、可捕获的 `RuntimeError`
      （"No mapping for the Unicode character exists in the target multi-byte code page"）；
      本议题是 Node `insertSync` 的 `0xC0000409` / `STATUS_STACK_BUFFER_OVERRUN`
      进程级 fail-fast，JS `try/catch` 拿不到控制权。#665 开头即注明
      `Possibly related: #626` 并说明这一实质差异
- [x] 资产：`docs/validation/fixtures/zvec-win-unicode/`
      （`README.md` / `probe-runner.js` / `probe-child.js` / `corpus.json` 135 样本 /
      `results-summary.json` 四轮逐样本判定 + 原始结果 sha256）。
      **精确表述**：#665 逐文件**列出并说明**了这些资产，并提出可附件上传或对上游
      fixtures 目录开 PR —— **文件本身尚未上传**，等上游选择投递方式
- [x] **可声称**：0.5.0 与 0.6.0 同样复现，故不归因于版本升级；binding 由父进程以
      绝对路径注入，已排除混版测量。
      **发出前逐条回到原始工件核实**：两版逐行对照表在
      `docs/validation/zvec-06-phase0b-verdict.md` §8 —— **不在 fixture 里**
      （fixture 的 R1–R4 全部是 0.6.0）；混版排除的依据是同文件「测量方法更正
      （2026-07-31）」，早先探针在 `os.tmpdir()` 裸 require 命中了游离的用户级
      `node_modules`(0.5.0)，修复后两版各重测、七行逐行相同
- [x] 另补两条 fixture 已有、原清单未列但承重的证据：
      **R4 长度控制实验 `anyFlip: false`**（7 segment × 24 档 padding，
      总路径约 108..134 字符跨度零翻转）；
      **`虜-golf`**（一个汉字 + ASCII、8 字节仍硬崩）
- [x] **上游措辞收窄（2026-08-07 复审 R1）**：#665 初版有两处推论超出 canonical
      证据边界，已改并线上复核。**这两条越界表述不得再出现在任何对外文本里**：
      - `Not a length effect.` → 现为
        **`No simple length threshold, within the range actually tested.`**
        R4 只排除了**已测区间内**的简单长度阈值，**不**证明长度在测试空间之外永不起作用
      - `"provably safe" collapses to "ASCII only" on Windows` → **删除**。
        它与同篇的 `No path is claimed to be safe` 自相矛盾，且把 §5.1 的
        **有界 supported profile** 压缩成了「ASCII 即安全」。现改为陈述这是一条
        **containment policy 而非安全性证明**，并列出 profile 的其余必要条件
        （本地盘符绝对路径 / 无 UNC・device・NT namespace / 无保留设备名段 /
        段无尾随空格或点 / 已规范化 / 祖先链无 reparse point / realpath 仍满足全部条件 /
        无 8.3 短名别名），profile 之外一律判 UNKNOWN 并拒绝
- [x] **不可声称**：触发条件已收敛（§3.1 明确未收敛）；任何路径「安全」
      （fixture README：它记录观测，不证明任何路径安全）；非 Windows 平台有无同类边界（未测）。
      三条在 #665 中**全部以否定形式出现**，无任何正面主张；另额外声明位置维度
      只比较了两个位置
- [x] 产出 durable issue URL → 硬停

**9C — runtime governance dependency 登记（窄改 active_context）**

- [x] 在 `[attp-hive-rollout]` 登记「Windows 目标必须消费 containment decision 接口」的依赖
      —— 该依赖目前**只**写在 spec §12，`[attp-hive-rollout]` 自己的 backlog 条目没有它
- [x] FOCUS 必要同步（经 `mem context focus`；FOCUS 有 CLI path，不得手改）
- [x] **仍禁止**：`context track` / `archive` / META / trajectory / `mem commit` —— 已遵守（PR #22 → main@6e855eb）

**9D — 受控人工关闭（最后一步）—— 执行于 2026-08-07，基线 `main@6e855eb`**

前置门必须**同时**成立。逐条机械核验结果：

```text
Tasks 1–8                ACCEPTED / MERGED   PR #16 / #17 / #18
9A                       MERGED              PR #20 → main@a56ae21
9B upstream issue URL    存在                https://github.com/alibaba/zvec/issues/665（OPEN）
9C dependency 登记        MERGED              PR #22 → main@6e855eb
worktree                 clean               0 changes
sync-runtime --check     EXIT 0
live/template SHA pairs  identical           sync-always 124/124，diverged 0
registry.errors          0                   blockers=1，15/15 计数守恒
release-preflight BEFORE BLOCKED
```

> `copy-on-init` 家族的 `.agents/rules/architecture.md` 与 `evo-lite.md` 两对哈希不同，
> **属设计预期**（脚手架播种一次后由项目自有、从不 nurture），不属于本门的判据；
> `sync-runtime --check` 也只强制 `sync-always` 范围。

然后事务顺序：

```text
1  完成 Task 9 清单
2  plan frontmatter status → done
3  spec frontmatter status → done        ← lifecycle 变更放在最后
4  releaseBlocking: true 保持原样
5  planning backfill / scan
6  Portfolio state → shipped
7  registry.blockers → 0
8  release-preflight → CLEAR
9  npm test / test:governance / sync-runtime --check
10 Draft PR + CI + 全量 closeout 复审
```

#### 9.3 已知债：不在 Task 9 范围，逐条留档不修

```text
closure linkedPlan asymmetry   previewClose() 只读 spec frontmatter 的正向 linkedPlan，
                               而本 spec 没有该键；Portfolio 用的是双向 union
                               （plan-ir 的 linkedSpec 反查）。因此 Portfolio 看得见
                               唯一 plan，mem close 看不见。既然不走 applyClose，
                               它不是 Task 9 blocker；**也不得为迁就 machinery 而
                               给本 spec 临时加 linkedPlan 键**

size-exceeded warning          `if (sizeExceeded && !sizeWaiver)` 与 state 无关，
                               关闭为 shipped 后**仍会继续出现**。这可以接受：
                               release-preflight 承重的是 errors 与 blockers，不是 warnings。
                               **不得为了让报告好看而补 sizeWaiver** —— 那是另一项治理决策

ci-1 job slicing debt          wf.slice(containment-contract:) 一直切到 EOF，
                               仅因该 job 当前在最后才精确
createTempRuntimeRoot          测试基础设施 cleanup debt
fs.indexWrite                  supplemental corroboration，未独立证伪
spec §14.1 两个 Task 6 门 / plan 中 Task 7 最后一条 local gate —— 文档债
```

**⛔ 停止点 4**：Task 9 分 9A–9D 逐段授权，每段自成一个 PR 并在首轮 CI 后硬停。
不得因为前一段已合并就自动进入下一段；context closure 始终需要独立授权。

---

## 停止点（四处，均为硬停）

1. **Task 3 后** —— 判定层复审通过前不接入生产 seam。
2. **Task 4 后** —— 真实 Windows 非 ASCII 路径端到端人工验收通过前不继续。
3. **Task 7 Step 2 的 CI 首跑后** —— 首轮 gate 完成即硬停，等待 Task 7 全量实现复审；
   不执行 Ready、不 merge、不进入 Task 8/9、不做 context closure。
4. **Task 9 前** —— 复审 ACCEPTED 前不做治理闭环。

## 范围外（本计划不做）

- 修改 hive nurture（spec §8.4；留待 `[attp-hive-rollout]` 重新授权）
- 修复上游 native 缺陷
- 解阻 `[attp-hive-rollout]`
- 解决 8.3 短名身份 residual（只检出并判 `UNKNOWN`）
- `[memory-lock-win-cim-snapshot-reliability]`（parked residual）
- `spec:evo-code-perception-foundation` 的 size warning
- architecture IR 刷新
