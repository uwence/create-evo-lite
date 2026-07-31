---
id: spec:zvec-win-unicode-containment
status: adopted
created: 2026-07-31
releaseBlocking: true
relationMode: independent
---

# Spec: Zvec Windows 非 ASCII 路径 Containment

> **阶段状态**：Phase D 设计稿（第 3 版，经三轮独立复审修订）。**生产实现未授权**。
> 本文冻结合同与边界，不含实现。证据：`docs/validation/zvec-win-unicode-path-matrix.md`；
> 可复现资产：`docs/validation/fixtures/zvec-win-unicode/`。

**Provenance**：源自已关闭 backlog `[zvec-06-upgrade]` 的后续 residual/P0。
`zvec-06-upgrade` **不是**已登记的 Portfolio spec，因此本 spec **不声明** `spawned-from` 关系；
adopt 时应使用 `--independent`。（第 1 版曾声明 `spawned-from: spec:zvec-06-upgrade`，
该 target 在 `docs/specs/` 中不存在，属伪造关系，已删除。）

## 1. 问题

Windows 上部分非 ASCII collection 路径在 `insertSync` 触发 `0xC0000409`
（`STATUS_STACK_BUFFER_OVERRUN`），进程被 OS 终止。**JS 层从不获得控制权**：
没有异常、没有栈、`try/catch` 拿不到、进程内无法降级。

`@zvec/zvec` 0.5.0 与 0.6.0 行为相同 → 非升级引入，`[zvec-06-upgrade]` 的合并不受影响；
但它阻断**下一次正式发布**与 **Windows 非 ASCII 子仓 rollout**。

## 2. 已证实事实（承重）

引自证据矩阵（135 样本 / 本机 Windows 11 + Node 22.22.2 + zvec 0.6.0）：

| # | 事实 |
|---|---|
| F1 | 原始证据 9 样本 **9/9 复现**，夹具可信 |
| F2 | 崩溃点是 **`insertSync`**；`create`/`open` 与 index 构建均成功 |
| F3 | **不可捕获**：原生 fail-fast，进程内降级不可能 |
| F4 | 在**已测的两个位置**（项目根名 / collection 目录名）间，位置未改变判定 —— **非全局事实** |
| F5 | 在 **R4 覆盖的 padding 方式与长度区间（108–138）** 内，长度不是已观察到的判别器 —— **非全域排除** |
| F6 | 本轮全部纯 ASCII 样本零崩溃 —— **有界观测，非安全证明** |
| F7 | 超长路径（>260）产生的是**可捕获 JS 异常**，与本议题无关 |

> F4/F5/F6 的限定词是承重的。把它们读成「与位置无关 / 与长度无关 / ASCII 安全」
> 会直接导出一个过宽的放行规则。

## 3. 未证实边界（不得据此放行）

- **根因未定位**。CP936 可往返性、GBK 尾字节两条机制假设均被反例证伪。
- **单环境**：单机 / 单 OS 版本 / 单 locale(zh-CN) / 单 Node / 单 zvec 版本。
- **ASCII 观测的形态是单一的**：本轮 ASCII 样本全部为「本地盘符绝对路径 + 全新 create +
  无 reparse 祖先」。见 §5.1 未覆盖清单。
- **未测**：危险路径上**已存在**的 collection 被 `ZVecOpen` 后的写入行为。
- **R4 六项未证实项**：任意长度、segment 自身长度、UTF-8 字节边界、260 边界、
  其他层级形态、「内容是唯一因素」。

### 3.1 触发条件未收敛（设计的硬约束）

七类候选规则全部有反例（证据矩阵 §6）。

> **`虜-golf`（8 字节、一个汉字 + ASCII）崩溃，而 `氵扌-项目`（13 字节）完成。**

**推论**：任何试图**识别危险路径**的谓词都不可靠。合同只能反过来做 ——
**识别一小组有实测支撑的 supported profile，其余全部视为不安全**。
同时，长度维度不可用作判据，**内容维度也尚未收敛**；合同不得建立在
「未来能精准分类内容」的预期上。

## 4. 威胁模型

- **资产**：`raw_memory/` durable 治理归档；`active_context → context track → archive` 闭环。
- **触发者**：**合法用户路径**，非恶意输入。一个名为 `虜-golf` 的目录即可。
- **后果链**：
  1. `insertSync` 崩溃 → 进程被杀 → `context track` 静默失败，治理闭环中断；
  2. 进程被杀**根本走不到** `_finalizeSync()`，未 optimize 的写入不落地；
  3. 子仓 rollout 后，该仓所有 agent 记忆操作不可用且**不可诊断**（无错误输出）。
- **不是**机密性问题，不按 security vulnerability 表述。

## 5. Containment 不变量（冻结）

| # | 不变量 |
|---|---|
| I1 | 判定发生在**加载 `@zvec/zvec` 并进入 native 生命周期之前**，而非仅在 `insertSync` 之前。 |
| I2 | 分类值域 `SAFE` / `UNKNOWN` / `UNSAFE`；**只有 `SAFE` 允许进入 zvec native**。 |
| I3 | `UNKNOWN` 与 `UNSAFE` **同等处理**（fail-closed）。缺证据不等于安全。 |
| I4 | 判定链**不得加载或调用任何 zvec API**。 |
| I5 | **Lexical 层**是纯谓词（字符串 + 平台），无副作用、不访问文件系统。 |
| I6 | **Profile 层**可做**只读**文件系统探查（`lstat`/`realpath`），**不得写盘**、不得加载 zvec。 |
| I7 | `SAFE` 只能是**白名单**。**禁止**字符黑名单（§3.1）。 |
| I8 | profile **可被推翻**：出现新反例即收紧，不得写成永久事实。 |
| I9 | 非 `win32` 平台**不改变现行为**。 |
| I10 | 判定对象是**即将原样传给 `ZVecOpen`/`ZVecCreateAndOpen` 的 collection 路径**，不是「项目路径」或「用户路径」。 |

### 5.0 两层判定（第 1 版的合同冲突已修复）

第 1 版把 `SAFE` 定义为单一纯字符串谓词，同时又要求把 junction / symlink / 8.3 alias
等拓扑判为非 `SAFE` —— 后者**必须读文件系统**，与「纯谓词」直接冲突。故拆为两层：

```
Layer 1  Lexical classifier
  输入：即将传给 Zvec 的 collection 路径字符串、platform
  特性：纯函数；不加载 zvec；不访问文件系统
  输出：LEXICALLY_ELIGIBLE | UNKNOWN

Layer 2  Supported-profile evaluator
  输入：Layer 1 结果 + 只读文件系统拓扑信息
  特性：可 lstat/realpath；不得写盘；不得加载 zvec
  输出：IN_PROFILE | UNKNOWN

Final decision
  SAFE      仅当 Layer 1 与 Layer 2 均通过
  UNKNOWN   其余一切
```

### 5.1 Supported ASCII profile（有界，非定理）

Layer 1 必要条件：

```
platform !== 'win32'                                  → SAFE（I9，不进入 Layer 2）
或全部满足：
  - 本地盘符绝对路径（形如 X:\...）
  - 每个字符 ∈ [A-Za-z0-9_\-.\\:/ ]
  - 无 \\?\ 前缀、无 UNC（\\server\share）
  - 无 \\.\ device namespace、无 \??\ NT namespace
  - 无保留设备名段（CON/PRN/AUX/NUL/COM1-9/LPT1-9）
  - 任何路径段无尾随空格或尾随点
  - 无 alternate data stream（段内 ':'，盘符冒号除外）
  - 路径已规范化（无 . / .. 段，无重复分隔符）
```

Layer 2 必要条件（只读探查）：

```
  - 沿祖先链无 reparse point（junction / symlink），含尚不存在的 collection 的已存在祖先
  - realpath 结果仍满足 Layer 1 全部条件（防「ASCII 表面路径指向非 ASCII target」）
  - 无 8.3 短名别名参与（与 parked residual [attp-win83-canonical-root-identity] 相邻，
    本 spec 不解决该 residual，只要求检出即判 UNKNOWN）
  - 探查本身失败（权限/IO/不支持）→ UNKNOWN，不得当作通过
```

**这是 supported profile，不是「任意 Windows ASCII 路径绝对安全」定理。**
未覆盖形态一律落入 `UNKNOWN`。

### 5.2 `UNSAFE` 初始不产生（与 I7 的冲突已修复）

第 1 版写「命中证据矩阵已确认崩溃的样本形态 → `UNSAFE`」，这实质是一个小型黑名单，
且「样本形态」未严格定义（完整字符串？包含某 segment？码点组合？basename 匹配？），
与 I7 冲突。修正为：

```
SAFE    = 完整满足 supported ASCII profile（Layer 1 ∧ Layer 2）
UNKNOWN = 其余全部
UNSAFE  = 保留值，初始实现不产生；仅当未来出现稳定、可泛化的上游合同才启用
```

已知崩溃 corpus 的合同测试只断言 **`verdict !== 'SAFE'`**，不断言它是 `UNSAFE`。

## 6. 单一 engine decision 与 native 入口收口

### 6.1 现状：两条独立路径（核心实现风险）

已核实的代码事实：

```
诊断:   resolveActiveImpl()  → loadZvecIndex()          memory-index.js:196-204
实例化: getMemoryIndex() → selectEngine() → loadZvecIndex()   memory-index.js:206-222
```

二者**各自独立**调用 `loadZvecIndex()`，而 `defaultLoadZvecIndex()` 的**第一步就是
`require('@zvec/zvec')`**（`memory-index.js:189`）。因此只改 `resolveActiveImpl()`
**不能**保护运行时 —— `getMemoryIndex()` 仍会独立加载并实例化 Zvec。

### 6.2 合同：一个决策，两处消费

```
resolveEngineDecision()
  1. 读取用户 engine choice
  2. 计算精确 collection path（即将传给 Zvec 的那一个）
  3. win32 上执行 §5 两层判定
  4. 非 SAFE → 直接返回 sqlite decision，且【不调用 loadZvecIndex()】
  5. 仅当 SAFE ∧ choice==='zvec' 才允许调用 loadZvecIndex()

resolveActiveImpl()  → 只消费 decision（诊断用）
getMemoryIndex()     → 消费同一 decision（实例化用）
```

**常驻测试断言**：非 `SAFE` 路径下 **`loadZvecIndex` 调用次数 = 0**。
这条断言是本 spec 最重要的可执行保证 —— 它同时覆盖 I1 与 6.1 的双路径缺陷。

**实现约束**：`zvecRoot()` 当前是 `memory-index-zvec.js` 的**内部函数、未导出**
（该模块只导出 `ZvecMemoryIndex`）。因此**不得**从 `memory-index.js` 直接调用它；
必须提取一个**不依赖 zvec** 的共享路径函数供两侧使用。
Zvec 真正的 native 初始化发生在 `ZvecMemoryIndex.initialize()`，并在其中创建目录、打开 collection。

### 6.3 native 入口清单（AC 覆盖面）

已核实的直接入口（不止 selector 一条）：

| 入口 | 位置 | 性质 |
|---|---|---|
| MemoryIndex selector | `memory-index.js:187-213` | 主路径 |
| **`memory-ab`** | `memory-ab.js:77-78` `require('@zvec/zvec')` + `require('./memory-index-zvec')`；`:29` `new ZvecMemoryIndex()` → `initialize()` → `upsert()` | **完全绕过** selector；是正式 CLI 命令，不是内部脚本；`upsert` 会走到 `insertSync` |
| `memory-index-lock` | `memory-index-lock.js:333` `require('@zvec/zvec').isZVecError(err)` | 错误分类路径；只加载模块、不传路径、不建 collection。**复审未提，本版新增记录** |

`memory-ab` 的处置：**非 `SAFE` → 拒绝执行并输出 containment 诊断**。
不得让 A/B 工具自动降级成 sqlite-vs-sqlite —— 那会把一个对比实验静默变成无意义的自比。

`memory-index-lock` 的处置：**本 spec 不给出"风险低"的最终结论** —— 那是一个尚未论证的判断。
实施阶段必须完成一次**静态、非 native 的代码审查**，逐条给出书面结论：

1. 确认它**只在**已捕获的 Zvec error 之后执行；
2. 确认 `UNKNOWN` 路径在此之前**根本不会**进入任何会产生 Zvec error 的调用
   —— 若能进入，则该 require 就是一条真实的绕行入口；
3. 判断该 helper 能否通过**依赖注入**获得 `isZVecError`，从而**彻底移除**运行时裸 require
   （若可行，应优先采用，而不是论证现状安全）；
4. 若保留裸 require，必须证明「**加载 binding 本身**」在支持矩阵内不访问 collection path。

本项**不要求** Phase D 或实施阶段再运行崩溃实验。

### 6.4 消费同一 decision 的完整面

`recall` / `remember` / `archive` / `track` / `sync` / `rebuild` / MCP **必须**消费同一
engine decision。实现阶段需逐一走查并留证，不得假定它们都经由 `getMemoryIndex()`。

## 7. 降级、恢复与重启用状态机

### 7.1 复用既有降级通道

`selectEngine` 已实现 zvec→`SqliteFtsIndex` fallback，`verify` 已在报账
`engineImpl.degraded`。containment 接入同一 seam，附 `degradedReason='win-unicode-containment'`。

### 7.2 一致性论证

架构铁律：`active_context → context track → archive(raw_memory)` 是**唯一** durable 链，
索引是**派生**产物。因此降级不丢用户数据；SQLite 索引可从 `raw_memory` 重建。

### 7.3 恢复状态机（第 1 版缺失，本版冻结）

第 1 版允许「把项目移到 ASCII 路径」即恢复，但**移动后默认引擎仍是 zvec，
旧的 `zvec/collection` 会随项目一起移动**，下次运行可能直接打开这个历史 collection。
该 collection 可能：崩溃前完成 create 但未完成 insert、含未 optimize segment、
与 `raw_memory` 不一致、来自 containment 生效前的未知状态。

因此**禁止**「路径变 SAFE → 自动复用已有 zvec collection」。冻结如下状态机：

```
containment 首次降级
  → 写入一个【非 Zvec】的持久 degradation/trust marker

路径后来变为 SAFE
  → 仍保持 sqlite（marker 未清除前不自动切回）
  → 明确提示执行 mem rebuild

mem rebuild
  → 从 raw_memory 重建【全新】zvec collection
  → 验证成功后清除 marker
  → 下次运行才允许重新选择 zvec
```

附加约束：

- unsafe 期间的 `rebuild` **只能重建 SQLite**；
- **不打开、不删除、不修复**旧 Zvec collection（§3 未测边界）；
- 切回 Zvec 的**唯一可信来源是 `raw_memory`**，不是旧 collection；
- **不自动搬迁**用户数据到 ASCII storage root（越权，且搬迁本身要读写危险路径）。

## 8. 两道 gate（职责分离 + 真实 enforcement point）

### 8.1 现状事实

- `release-gate.yml` 仅 `push:main` / `PR:main` 触发，且**自我声明为 informational**，
  是否 required 取决于仓库管理员的 branch protection 配置，CLI 不能单独完成。
- `package.json` 当前**没有** `prepublishOnly`、没有 release-preflight、没有自动发布 workflow
  （scripts 仅 `start` / `test` / `test:governance`）。

因此「新增一个 CI job」最多是**机器化验证证据**，**不是**机器化阻止 `npm publish`。
第 1 版把它写成 release gate 是不准确的。

### 8.2 冻结的 enforcement 分工

| 载体 | 职责 |
|---|---|
| `release-gate.yml` 的 containment job | 常驻**合同证据**：断言 containment 未回归 |
| **`prepublishOnly` / canonical release command → release-preflight** | **真正的发布阻断**：读取结构化 blocker，未满足即中止 publish |

**blocker 来源必须结构化**，不得扫描 FOCUS 自然语言。选定方案为 **Spec Portfolio 字段**，
理由：复用既有结构化治理域，不引入第二个真相源。决策点、负责文件与验收测试见 plan Task 8。

### 8.2.1 `releaseBlocking` 当前不生效（必须一并实现）

已核实的现状：

```
buildSpecRegistry() 逐 spec 输出字段 =
  id, file, state, linkedPlans, lastTouchedAt, idleDays, size,
  sizeExceeded, sizeWaiver, relations, relationMode, notDonePlans, warnings
registry 顶层 = version, generatedAt, agingDays, specs
```

**其中没有 `releaseBlocking`，也没有 blockers 集合。** 因此仅在 frontmatter 写入该字段
**不会**自动形成机器发布门 —— 它只会成为一个惰性保留字段。

（补充事实：`adoptSpec` 的 `reservedKeys` 只覆盖
`id/status/owner/created/relations/relationMode`，其余键**原样保留并追加**
（`spec-portfolio.js:490-496`）。所以字段本身**能**在 adopt 后存活；
缺口精确地只在于 **registry 不解析、不派生**它。）

### 8.2.2 冻结的 blocker 派生语义

| 条件 | 判定 |
|---|---|
| `releaseBlocking` **缺失**，或明确为 `false` | 非 blocker |
| `releaseBlocking: true` + 状态 `adopted` / `active` | **BLOCK** |
| `releaseBlocking: true` + 状态 `parked` + **无合法 disposition** | **BLOCK** |
| `releaseBlocking: true` + 状态 `parked` + **合法 disposition** | ALLOW（临时放行） |
| `releaseBlocking: true` + 状态 `done` / `shipped` | ALLOW |
| `releaseBlocking` **存在但不是合法布尔值** | **schema error → release-preflight FAIL** |
| disposition **非法或不完整** | **保持 BLOCK** 并报告 schema error |

**`parked` 仍阻断是刻意的**：park 表示「暂缓实现」，不表示「风险消失」。
若 park 自动解除发布门，任何人都能通过切换治理状态绕过真正的产品风险。
要解除必须显式写出 waiver（一次有记录的人为决定），
而不是靠改变 spec 状态**顺带**解除。

**非法字段必须 fail-closed（第 2 版曾写成 fail-open，已修正）**：
第 2 版把「字段缺失**或非法**」一并归为「不产生 blocker + warning」。
那意味着一个拼写错误 —— 例如

```yaml
releaseBlocking: ture     # 不是布尔值
```

—— 会让该 spec 静默地**不再阻断发布**。一个 typo 直接绕过发布门，是典型的 fail-open。
现修正为：**缺失 = 非 blocker（合理），存在但非法 = schema error 且 preflight FAIL**。

### 8.2.2.0 Scalar 解析规则（承重：frontmatter 不产生布尔值）

**已实测**：`parseFrontmatter()` **不是 YAML parser**，它把冒号后的整段原样存为字符串
（`planning/parse-markdown.js:12-15`，`fm[kv[1]] = kv[2].trim()`）。实测结果：

```
releaseBlocking: true          →  "true"（字符串），=== true 为 false
releaseBlockReviewedAt: "2026-07-31"  →  "\"2026-07-31\""（**引号被保留在值里**）
```

因此「必须是合法布尔值」这种泛泛表述**不可实现**。冻结**严格的原始字符串解释**：

```
字段缺失            → absent（非 blocker）
原始值 === "true"   → true
原始值 === "false"  → false
其他任何值          → schema error
```

明确判为**非法**（除非将来显式扩展 schema）：

```yaml
releaseBlocking: ture      # typo
releaseBlocking: yes       # 非本 schema 取值
releaseBlocking: 1         # 非本 schema 取值
releaseBlocking: "true"    # 带引号 —— 原始值是 "\"true\""，不等于 "true"
```

**不做宽松 YAML 推断**：不 trim 引号、不做大小写折叠、不接受 `True`/`TRUE`。
理由：宽松推断会让「看起来像 true 的东西」悄悄放行，而本字段的错误方向必须是阻断。

### 8.2.2.1 Waiver schema（最小且封闭）

`parked` blocker 的临时放行**仅**接受下列三项**同时**有效。
**canonical 形式一律不带引号** —— 因为引号会被 parser 保留进值里：

```yaml
releaseBlockDisposition: waived
releaseBlockReason: Risk accepted for a documented one-time release
releaseBlockReviewedAt: 2026-07-31
```

约束（同样按原始字符串判定）：

- `releaseBlockDisposition` 原始值必须**严格等于** `waived`。封闭枚举，
  **不接受任意字符串**，不接受带引号形式；未来新增取值必须先改 schema。
- `releaseBlockReason` trim 后必须**非空**。
- `releaseBlockReviewedAt` 必须匹配 `^\d{4}-\d{2}-\d{2}$`，
  并做**日期 round-trip 校验**（解析后重新格式化须与原值一致，挡掉 `2026-02-31` 这类）。
- 三项缺一、格式不符或校验失败 → **不构成 waiver**，保持 `BLOCK` 并报 schema error。
- waiver 只对 `parked` 生效；`adopted`/`active` 的 blocker **不可**被 waiver 放行 ——
  在途议题要发布，应先把它做完或显式 park 并给出理由。

### 8.2.3 release-preflight 必须**现场重建** registry

**禁止**让 `prepublishOnly` 读取磁盘上可能过期的
`.evo-lite/generated/spec-registry.json`（**该文件确实存在，实测 8.9 KB**）。
一次 stale generated file 就可能让已登记的 blocker 被整个漏掉 —— 而漏掉的方向是放行。

```
prepublishOnly
  → release-preflight
  → buildSpecRegistry(projectRoot, { write: false })      # 现场派生，实测签名可用
  → 从 docs/specs 与当前 planning IR 现场计算 blockers
```

### 8.2.3.1 registry 的正常退化本身就是 fail-open（承重）

**仅 `try/catch buildSpecRegistry()` 不够。** 现有 builder 的合同恰恰是
**正常退化时尽量不抛错**：`docs/specs` 不存在或不可读时返回空集；单个 spec 解析失败时
`parsed = null` 后**直接跳过**。于是 registry 仍会「成功返回」，只是 `specs` 少了几条。

后果是明确的 fail-open：**一个 frontmatter 损坏的 release-blocking spec 会从 registry 里
静默消失，然后 publish 被放行。** 损坏的方向恰好是解除阻断。

因此 registry 必须**显式编码退化**，而不是靠抛异常。目标形状：

```json
{
  "version": "evo-spec-registry@2",
  "specs": [],
  "blockers": [],
  "errors": [],
  "source": {
    "directoryReadable": true,
    "discoveredFileCount": 14,
    "parsedSpecCount": 14
  }
}
```

冻结规则：

```
docs/specs 不存在或不可读
  → registry.errors
  → preflight FAIL

任意 *.md 读取或解析失败
  → registry.errors（必须保留文件路径）
  → preflight FAIL

discoveredFileCount !== parsedSpecCount
  → preflight FAIL          # 计数守恒：有文件被吞掉就必须暴露

releaseBlocking / waiver schema 非法（§8.2.2.0 / §8.2.2.1）
  → registry.errors
  → preflight FAIL

blockers 非空
  → preflight FAIL
```

`buildSpecRegistry()` **可以**保持「不因普通退化直接 throw」的现有合同 ——
但退化必须落进 `errors`。release-preflight 的放行条件是：

```
registry.errors.length === 0  AND  registry.blockers.length === 0
```

**而不是**「调用没抛异常」。`discoveredFileCount !== parsedSpecCount` 这条计数守恒是
最后一道防线：即使某种新的退化路径没被 `errors` 覆盖，被吞掉的文件也会让计数对不上。

### 8.2.4 必须实现的面

```
.evo-lite/cli/spec-portfolio.js      registry 输出 releaseBlocking + waiver schema + 派生 blockers
templates/cli/spec-portfolio.js      镜像
release-preflight 载体                现场调用 buildSpecRegistry，消费 blockers
package.json                         prepublishOnly → release-preflight
live/template 合同测试                见 §9 T10
```

### 8.3 PR 变红的正确合同

第 1 版写「普通 PR 不因本 job 变红」，这会让 gate 失去防回归价值。修正为：

```
普通 PR 不执行已知会杀死进程的 crash probe；
但 containment 合同发生回归时，该 PR 必须变红。
```

崩溃复现探针只存在于 `docs/validation/fixtures/`，默认拒绝执行（需 `ZVEC_UNICODE_PROBE=1`），
不参与 `npm test`，也未登记进 `template-manifest.js`。

### 8.4 Rollout gate 移出本轮实施

`[attp-hive-rollout]` 当前仍是独立 BLOCKED 议题。在本 P0 中直接修改 hive nurture
会跨入另一个尚未授权的生产议题。因此本 spec 交付的是：

- 稳定、可调用的 **containment decision 接口**；
- 明确的 **rollout integration contract**；
- 在 `[attp-hive-rollout]` 中登记「Windows 目标必须消费此接口」的依赖。

**真正修改 hive nurture 留到 `[attp-hive-rollout]` 被重新授权时**。
这不削弱 blocker —— rollout 本来就处于禁止状态。

## 9. 测试矩阵

| 测试 | 断言 |
|---|---|
| T1 lexical 纯度 | 不加载 zvec、不触碰 FS；同输入同输出 |
| T2 profile 层只读 | 只 lstat/realpath；不写盘；探查失败 → `UNKNOWN` |
| T3 已知崩溃 corpus | 全部 `verdict !== 'SAFE'`（**不执行 native**，不断言 `UNSAFE`） |
| T4 supported profile 对照 | 合规 ASCII 路径 → `SAFE` 且正常进入 zvec（防过度拦截） |
| T5 fail-closed | 未知非 ASCII、UNC、`\\?\`、reparse、尾随点/空格、保留名 → 非 `SAFE` |
| T6 **零加载断言** | 非 `SAFE` 时 `loadZvecIndex` 调用次数 = 0 |
| T7 入口覆盖 | selector / `memory-ab` / recall / remember / archive / track / sync / rebuild / MCP 均消费同一 decision |
| T8 状态机 | 降级写 marker；路径转 SAFE 仍保持 sqlite；rebuild 后清除 marker 方可切回 |
| T9 平台隔离 | 非 win32 行为逐位不变 |
| T10 blocker 派生 | ①`adopted`/`active` blocker → prepublish **fail**；②`parked` blocker 无 waiver → **fail**；③`parked` blocker + 三项齐全的合法 waiver → pass；④`done` spec → pass；⑤字段缺失/`false` → 不影响 publish；⑥**原始值非 `"true"`/`"false"`（`ture` / `yes` / `1` / 带引号 `"true"`）→ schema error → fail**（§8.2.2.0）；⑦disposition 非法或不完整（缺 reason / 缺日期 / 非 `waived` 原始字面量 / 日期 round-trip 失败如 `2026-02-31`）→ **保持 fail**；⑧`adopted`/`active` blocker **不可**被 waiver 放行；⑨**FOCUS 自然语言含 "release-blocker" 字样 → 不产生任何机器判断**；⑩**stale `spec-registry.json` 与现场结果冲突时以现场为准** |
| T11 **registry health**（fail-open 回归防线） | ①**损坏一个 release-blocking spec 的 frontmatter → 该文件不得静默消失**：必须进 `registry.errors`（含路径）且 prepublish **fail**；②`docs/specs` 不可读 → `errors` + fail；③`discoveredFileCount !== parsedSpecCount` → fail；④放行条件是 `errors.length === 0 && blockers.length === 0`，**不是**「调用未抛异常」 |

## 10. 明确排除项

- ❌ 危险字符黑名单（§3.1 / I7）
- ❌ 初始版本产生 `UNSAFE` 判定（§5.2）
- ❌ `try/catch` 包裹 `insertSync`（F3）
- ❌ 按字节长度或路径长度判定（F5 且长度维度未全域排除）
- ❌ 「纯中文实测通过即放行」（`虜-golf` 反例）
- ❌ 路径转 SAFE 后自动复用旧 zvec collection（§7.3）
- ❌ 自动搬迁用户数据
- ❌ 修复上游 native 缺陷
- ❌ 改变非 Windows 平台行为（I9）
- ❌ **本轮修改 hive nurture**（§8.4）
- ❌ 解阻 `[attp-hive-rollout]`
- ❌ 处理 8.3 短名身份 residual（只要求检出即判 `UNKNOWN`）

## 11. 验收标准（AC）

| # | AC |
|---|---|
| AC1 | Lexical classifier：纯函数、不加载 zvec、不访问 FS，实现 §5.1 Layer 1（T1） |
| AC2 | Supported-profile evaluator：只读 FS 探查，实现 §5.1 Layer 2，探查失败 → `UNKNOWN`（T2） |
| AC3 | 单一 `resolveEngineDecision()`；诊断与实例化消费同一决策；非 `SAFE` 时 `loadZvecIndex` 调用次数 = 0（§6.2，T6） |
| AC4 | 全部 native 入口收口，含 `memory-ab`（非 `SAFE` 拒绝执行而非自动降级）与 §6.4 完整消费面（T7） |
| AC5 | 降级复用既有 sqlite 通道并附 containment 原因；§7.3 恢复状态机完整实现（T8） |
| AC6 | `verify` 报告 containment 状态与人工恢复指引；危险路径上已存在的 collection 只报告不打开 |
| AC7 | `spec-portfolio.js` registry 输出 `releaseBlocking`（按 §8.2.2.0 严格原始值解释）、waiver schema、`errors` 与 `source` 计数，并按 §8.2.2 派生 blockers；发布阻断落在 `prepublishOnly`/release-preflight，放行条件为 `errors.length === 0 && blockers.length === 0`；`release-gate.yml` 提供合同证据且**回归时 PR 变红**（§8.2.1–§8.3，T10/T11） |
| AC8 | T1–T11 固化为常驻合同测试（live + template 双份）；崩溃 corpus 测试不实际触发崩溃 |

> **计量说明（如实表述）**：上表为**人工合同计数** —— AC 8 项，实施计划分为 3 个 Phase。
> 这**不是** Portfolio intake 的实测指标。已实测：本 spec 的 AC 用 Markdown 表格书写，
> 正文也没有 `### Phase ...` 标题，而 `computeSizeMetrics()` 的 `acCount` 取自
> **最后一个含 `"criteria"` 的 ```json fenced block**、`phaseCount` 取自
> `^### Phase ` 或 `^#{2,3} .*Phase` 标题，因此 registry 实际会计为
> **`acCount = 0`、`phaseCount = 0`**。
> 结论：体量门（AC>8 / Phase>3）**不会触发**，但触发不了的原因是**计量口径不匹配**，
> 不是「实测 8/3 恰好卡线」。不得把人工计数说成 registry 实测值。
>
> 原 AC7（rollout gate 生产接入）已移出为 §12 integration contract。

## 12. Integration contract（follow-up，非本轮 AC）

- **Rollout gate**：`[attp-hive-rollout]` 重新授权时，Windows 目标子仓必须在分发前调用本
  containment decision 接口；非 `SAFE` 拒绝分发并给出结构化原因，不静默跳过。
  本轮只交付接口与依赖登记。
- **上游上报**：向 `@zvec/zvec` 提交最小复现（fixture 可直接作附件）。
- 若上游修复并给出路径字符集合同，本 spec 的 profile 应随之放宽或整体退役。
- 非 Windows 平台是否存在同类边界：本轮未测，需要时另立议题。

## 13. 治理时序（adopt 在实施之前）

第 2 版把 `mem spec adopt` 放在实施计划的**末尾**（Task 9），时序错误：
spec 不能等实现完成才收编 —— 那期间 Portfolio 对这条 release-blocking P0 是不可见的。

冻结顺序：

```
Phase D 设计复审通过
  → adopt Spec（--independent）
  → 提交证据、Spec、详细计划、IR plan
  → context track / Meta-Commit
  → 【再单独授权生产实现】
  → 执行 Task 1–8
  → Task 9 关闭 implemented spec
```

因此：

- 实施计划 Task 9 中**删除** `mem spec adopt --independent`；
- 实施计划的**前置条件**写明：`spec:zvec-win-unicode-containment` 已 adopted；
- Task 9 只负责实施完成后的状态推进、证据闭环与 backlog resolve。

## 14. 实施授权门

```
[x] Windows 真实环境最小复现矩阵完成
[x] 危险测试全部在隔离子进程执行
[x] Zvec binding 被绝对路径钉死
[x] 可复现 evidence fixture 已保存（默认不执行）
[x] SAFE / UNKNOWN / UNSAFE 合同冻结（两层判定）
[x] fail-closed 行为冻结
[x] 降级、恢复与重启用状态机冻结
[x] release enforcement point 与 rollout integration 职责分开
[ ] Spec 与 plan 第 3 版完成审查
[x] 生产文件仍为零变更
[ ] 用户显式授权实施
```
