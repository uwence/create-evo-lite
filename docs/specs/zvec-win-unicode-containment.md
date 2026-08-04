---
id: spec:zvec-win-unicode-containment
status: adopted
created: 2026-07-31
releaseBlocking: true
relationMode: independent
---

# Spec: Zvec Windows 非 ASCII 路径 Containment

> **阶段状态**（第 4 版）：
>
> ```text
> Tasks 1–5（AC1–AC4）  COMPLETE / ACCEPTED / MERGED
> Task 6（AC5）          机制与计划补完已授权；生产实施未授权
> Tasks 7–8（AC6/AC7）   未授权
> Task 9（收口）          未授权
> ```
>
> 本文冻结合同与边界。§7.4 是第 4 版新增的**恢复机制冻结**（marker 载体、损坏方向、
> decision reason、one-shot recovery decision、失败语义、跨平台 trust debt），
> 它是 §7.3 状态机的实现合同，不改变 §7.3 的行为结论。
> 证据：`docs/validation/zvec-win-unicode-path-matrix.md`；
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
| I9 | 非 `win32` 平台**在 marker 不存在时**不改变现行为。**marker 是旧 collection 的信任债务，不是 Windows 字符分类结果**，因此 marker 存在（含 `invalid` / `unreadable`）时，跨平台同样要求显式恢复 —— 见 §7.4 M7。 |
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

- 切回 Zvec 的**唯一可信来源是 `raw_memory`**，不是旧 collection；
- **不自动搬迁**用户数据到 ASCII storage root（越权，且搬迁本身要读写危险路径）。

#### 7.3.1 「不得删除旧 collection」是**阶段限定**的（第 3 版的字面冲突，本版修正）

第 3 版把「重建**全新** collection」与「**不删除**旧 collection」并列书写。按字面读，
恢复动作本身被自己的约束禁止 —— 已核实 `rebuildLocalIndex()` 的 zvec 分支实现正是
`fs.rmSync(zvecDir, { recursive: true })`，即「全新」在现有代码里就是靠 discard 达成的。

因此该约束**限定于 unsafe 阶段**，两个阶段分开冻结：

```text
阶段 U —— 当前路径非 SAFE
  mem rebuild
    → 只重建 SQLite
    → 不加载 Zvec binding
    → 不打开 / 不删除 / 不修复旧 collection
    → marker 保留

阶段 R —— 当前路径 SAFE + marker 要求恢复 + 用户显式执行 mem rebuild
    → 校验 recovery 前置条件（§7.4 M5）
    → marker 保持在盘上，全程不提前清除
    → 确认 Zvec dependency 可用（在任何破坏性动作之前）
    → discard 整个旧 zvec 派生目录
    → 从 raw_memory 建立全新 collection
    → 验证成功（§7.4 M5 十一条）
    → 清除 marker
    → 关闭 recovery index 并 reset
    → 下一个进程 / 命令才正常选择 Zvec
```

阶段 R 的删除是**显式恢复流程对不可信派生索引的 discard**，不是「打开、修复或复用旧
collection」。三者的区别在于:discard 不读取旧 collection 的任何内容,因此不进入 §3
的未测边界。

## 7.4 恢复机制冻结（第 4 版新增）

§7.3 冻结的是**行为**；本节冻结**机制**。M1–M8 与 §7.3 同级承重。

### M0 承重缺口：恢复不能使用正常 decision

marker 存在时正常 decision 必须给出 sqlite（这正是 marker 的意义）。于是有两条错误路线：

```text
正常 decision + marker
  → 仍然得到 sqlite → 根本建不出新的 Zvec collection

先清 marker → 再 rebuild
  → rebuild 中途崩溃或失败
  → 下次启动可能自动打开一个半成品 collection
```

因此必须存在一个**仅供显式 rebuild 使用、marker 全程留在磁盘上的 one-shot recovery
decision**（M4）。

### M1 marker 载体

```text
路径      .evo-lite/zvec-containment-state.json
运行时    path.join(path.dirname(getDbPath()), 'zvec-containment-state.json')
可见性    machine-local —— 落在 .gitignore 的 `.evo-lite/*` 之下，
          且【不得】为它增加 unignore 规则
```

不复用：`memory-engine.json`、`memory.db`、`zvec/collection`、`raw_memory/`、
`active_context.md`。

| 方案 | 裁定 | 理由 |
|---|---|---|
| 独立 ignored JSON | **采用** | 用户意图与系统 trust debt 分离；不随 Git 传播；删除 collection 时仍保留 |
| 复用 `memory-engine.json` | 拒绝 | 它是**用户显式 engine intent**（文档教用户手工编辑），且 `.gitignore:16` 有 `!.evo-lite/memory-engine.json` 显式 unignore —— 混入系统状态会随仓库传播，清 marker 还可能误删用户 pin |
| SQLite metadata | 拒绝 | rebuild / 替换 db 会与 marker 生命周期耦合，unsafe rebuild 可能意外消除信任债务 |

冻结 schema：

```json
{
  "version": 1,
  "state": "recovery-required",
  "createdAt": "2026-08-03T08:00:00.000Z",
  "collectionPath": "C:\\path\\.evo-lite\\zvec\\collection",
  "containment": {
    "verdict": "UNKNOWN",
    "layer": "lexical",
    "reason": "lexical:character-outside-supported-ascii-set"
  }
}
```

- `version` 严格等于 `1`；`state` 严格等于 `recovery-required`；
- `createdAt` / `collectionPath` / `containment.layer` / `containment.reason` 为非空字符串；
- `containment.verdict` 只接受 `UNKNOWN`，或未来一旦启用的 `UNSAFE`；
- **首次成功写入后不得被后续判定覆盖** —— 保留最初的证据；
- **排他创建**（见 M1.1），不是 `tmp + rename`；
- 不修改 `.gitignore`。

#### M1.1 写入用排他创建，不用 `tmp + rename`

第 4 版初稿同时要求「首次写入后不得覆盖」与「同目录临时文件 + `rename`」。这两条
**不相容**：在多个平台上 `rename` 到已存在目标会**替换**目标。两个并发进程若都先观察到
`absent`，后发布者会覆盖第一份 marker，与「首次证据保真」直接冲突 —— 而先 `stat` 再
`rename` 只是把竞态窗口挪个位置，消不掉它。

冻结为排他创建：

```text
以 wx / O_EXCL 打开 marker 路径
EEXIST → { written: false, alreadyPresent: true }，绝不覆盖、绝不重试
```

**为什么不需要 `rename` 的原子性**：若进程在写入中途终止，残缺 JSON 会被下一次读取
按 M2 分类为 `invalid`，而 `invalid` 与 `present` 一样 fail-closed —— 半个 marker
和一个完整 marker 对正常路径的效果完全相同。因此这里优先保证的是**不覆盖**，
而不是「要么全有要么全无」。

T8 必须有并发负控（第 21 格）：

```text
两个 writer 同时首次写入
  → 恰好一个 written=true
  → 另一个 alreadyPresent=true
  → 最终盘上内容等于第一个成功 writer 的内容
```

### M2 marker 读取状态与损坏方向（fail-closed）

```text
absent      仅限 ENOENT
present     JSON 与 schema 均有效
invalid     文件可读，但 JSON 或 schema 非法
unreadable  EACCES / EPERM / EIO 等读取失败
```

正常运行行为：

```text
present / invalid / unreadable
  → 一律视为 recovery required
  → loadZvecIndex 调用次数 = 0
  → 保持 sqlite
```

**不得**：把 parse error 当作 absent；自动覆盖损坏 marker；自动删除损坏 marker；
因 marker 损坏而回到 Zvec。

恢复资格进一步区分：

```text
present / invalid   → SAFE 时可以进入显式 rebuild recovery
unreadable          → 不允许触碰旧 Zvec collection；rebuild 失败退出
```

理由：`unreadable` 状态下既无法证明 marker 会在重建失败时继续保留，也无法可靠完成
最终清除 —— 两个前提都塌了，就不该开始破坏性动作。

### M3 新的 decision reason

现有 reason 枚举为 `engine-choice` / `containment` / `zvec` / `dependency-unavailable`。
新增第五个：

```text
containment-recovery-pending
```

触发条件（三者同时成立）：

```text
choice === 'zvec'
当前 containment.verdict === 'SAFE'
marker status !== 'absent'
```

返回形状：

```js
{
  choice: 'zvec',
  impl: 'sqlite',
  degraded: true,
  reason: 'containment-recovery-pending',
  ZvecIndex: null,
  containment: { verdict: 'SAFE', ... },
  recovery: {
    required: true,
    markerStatus: 'present' | 'invalid' | 'unreadable',
    markerPath: '...',
    reason: 'marker-not-cleared'
  }
}
```

必须保证 `loadZvecIndex` 调用 = 0、Zvec 实例化 = 0、collection 打开 = 0。

#### M3.1 纯 resolver 与副作用边界（承重）

第 4 版初稿一边要求 `resolveEngineDecisionFromInputs()` **保持纯函数**，一边要求它在
非 SAFE 时**写 marker**。同一个函数不可能两者兼得。

更关键的是已核实的这条：`sharedEngineDecision()` **直接**调用
`resolveEngineDecisionFromInputs(inputs)` 并缓存结果（`memory-index.js:329-337`）。因此
若只给 `resolveEngineDecision()` 挂上写入逻辑，**生产共享路径会整条绕过 marker 写入** ——
降级发生了，trust debt 却没被记录，下次路径变 SAFE 就直接重开旧 collection。

冻结 effect boundary：

```js
resolveEngineDecisionFromInputs(inputs)
  // 纯：无 FS 写入
  -> provisional decision + markerAction: 'none' | 'ensure-present'

persistEngineDecision(inputs, provisional, seams)
  // 副作用：唯一写 marker 的地方
  -> final decision
  // ensure-present 失败 → throw（见 M6）
```

**两条入口都必须经过 `persistEngineDecision()`**：

```text
resolveEngineDecision()
sharedEngineDecision()
```

且顺序固定：**只有 marker 确认存在之后，decision 才允许被返回或写入 shared cache**。
先缓存再写盘，等于在写失败时把一个「已成功降级」的判断留在内存里。

没有这个独立 reason，Task 7 的 `verify` 就无法区分「当前路径仍危险」与「路径已安全、
只差一次 rebuild」—— 两者给用户的指引完全不同。

`resolveActiveImpl()` 的兼容返回面保持 `{ choice, impl, degraded }` 不变；
Task 7 通过 `peekEngineDecision()` 消费 `reason` / `recovery`。

### M4 one-shot recovery decision

```js
resolveRecoveryRebuildDecision(options)
```

只有下列前提**同时**成立才返回 zvec decision：

```text
正常 decision.reason === 'containment-recovery-pending'
当前 containment.verdict === 'SAFE'
marker status ∈ { present, invalid }
choice === 'zvec'
dependency available
```

约束：

- **不进入** shared decision cache；
- **不被** 普通 `getMemoryIndex()` 使用；
- **不允许**任何调用方传一个布尔标志就绕过 marker；
- marker 全程保留，直到验证成功之后才清除。

重建走**显式 index seam**，而不是污染全局 singleton：

```js
syncIndexMemory({ index: recoveryIndex })
ingestArchiveFile(..., { index: recoveryIndex })
```

普通调用不传 `index`，继续使用 `getMemoryIndex()`。

> 已核实：该 seam **目前不存在**。`syncIndexMemory()` 无参数，`ingestArchiveFile()` 只
> 透传 `allowSecrets` / `namespace` / `silent` / `commitHash`，而 `memorize()` 直接调用
> `getMemoryIndex().upsert(...)`。因此 Task 6 需要在 `memory.service.js` 内为这三个函数
> 增加可选 `index` 参数，默认行为不变。

### M5 恢复成功标准与发布顺序

仅凭 archive 计数不足 —— 还必须证明实际建立的确实是 Zvec，**而且下一个进程能重新
打开它**。

#### M5.1 发布顺序（承重：清 marker 必须在 fresh reopen 之后）

已核实：Zvec 的持久化关键动作发生在 `close()` —— `_finalizeSync()` 在 `_dirty` 时执行
`optimizeSync()` 再 `closeSync()`，而**这两个调用的异常目前都被 `catch (_) {}` 吞掉**
（`memory-index-zvec.js:104-126`）。因此在 close **之前**做的任何 stats / 读回，只能证明
「当前进程内的 collection 可读」，**不能**证明下一个进程能重新打开并读到完整索引 ——
optimize 或 close 失败时,builder 进程内的读取仍然会成功。

冻结顺序：

```text
build recovery index（写入全部 chunk）
  → close builder —— 触发 optimize / finalize
  → 用【同一个 recovery decision.paths】新建一个 fresh validator index
  → 重新打开 collection
  → 对 fresh validator 执行 M5.2 的精确持久化验证
  → close validator
  → 【此时才】清除 marker
  → reset
```

任一步失败：

```text
marker 保留
命令以非零码失败
正常 decision 继续阻止 Zvec
```

这**不要求**修改 `memory-index-zvec.js`：fresh reopen 本身就是对那两个被吞掉的
finalize / close 错误的**外部**验证。

#### M5.2 fresh validator 的精确验证

已核实：`_allDocs()` 在 `querySync` 抛错时 `catch (_) { return []; }`，而 `stats()` 与
`list()` 都建立在它之上。因此单看 `stats()` 或 `list()`，在空 archive 场景中
**无法区分**「真正的空 collection」与「查询失败被折叠成 `[]`」。

fresh validator 必须逐条断言（已核实 `stats()` 返回
`{chunks, count, namespaces, first, last}`，两个键都存在）：

```js
validator.engine === 'zvec'

const stats = validator.stats();
stats.count  === syncResult.chunks
stats.chunks === syncResult.chunks

// searchText() 走真实 native query path，即使 archive 数为零，
// 也能证明 fresh reopen 之后查询接口确实可用。
const probe = validator.searchText(
    '__evo_lite_recovery_read_probe_no_match__',
    { topK: 1, scope: 'all' }
);
Array.isArray(probe)
```

#### M5.3 清除 marker 的全部条件

```text
 1. choice === 'zvec'
 2. 当前 containment.verdict === 'SAFE'
 3. marker status ∈ { present, invalid }
 4. Zvec dependency 在任何破坏性动作【之前】确认可用
 5. recovery 使用专用 one-shot decision，且 impl === 'zvec'
 6. 旧 zvec 目录已完整 discard
 7. sourceArchives === syncResult.files
 8. syncResult.invalid.length === 0
 9. syncResult.skipped.length === 0
10. builder 已 close（触发 optimize / finalize）
11. fresh validator 重新打开成功，且 M5.2 四条断言全部成立
```

全部成立才清 marker。

> 已核实：full rebuild 会先移除 `vect_memory` 下的既有文件 marker，再调用
> `syncIndexMemory()`，因此在**全量**重建语境下 `files === sourceArchives` 与
> `skipped.length === 0` 是有意义的验收，而不是对增量 sync 的错误要求。
> 另已核实：`syncIndexMemory()` 返回 `{files, chunks, invalid, processed, skipped}`，
> 而 `rebuildLocalIndex()` 末行返回 `true` —— 结构化结果不在其公开返回合同内。
> **Task 6 不得为此扩大 `rebuildLocalIndex()` 的公开返回面**；清 marker 的判定在函数
> 内部使用该结构化结果完成。

### M5.4 recovery lease（承重:序列化恢复）

M5.1–M5.3 描述的是**一个**恢复的正确顺序。它们没有回答第二个问题:**同时有两个恢复
时会怎样**。

已核实的窗口:`runContainmentRecoveryRebuild()` 取到 eligible 快照后,直接
`fs.rmSync(zvecDir)`,而 `ZvecMemoryIndex` 的构造函数只保存路径 ——
真正的 `openWithCoordination()` 发生在 `initialize()`,即首次操作 collection 时。
**目录删除发生在任何协调之前**,所以 Zvec 自己的锁盖不住这一段。

于是存在这条合法交错:

```text
进程 A                          进程 B
读到 marker，eligible
  （暂停）
                                读到同一 marker，eligible
                                删除旧 collection、重建、fresh reopen 验证通过
                                清除 marker，退出
  （恢复执行）
删除 B 刚刚验证过的 collection
开始第二次重建 → 中途失败

结果：containment marker = absent（B 清的）
      collection        = A 留下的半成品
      下一个进程        = SAFE + 无 marker → 直接打开 Zvec
```

这直接违反 AC5 最核心的不变量:**任何未完成的恢复,都不得让下一个进程自动进入 Zvec。**

冻结:

```text
获取 recovery lease
  → lease 身份【绑定当前 containment marker 的 fingerprint】
  → 取得 lease 之后【重新】读 marker、重新解析 containment decision
  → fingerprint / SAFE / choice / dependency 四项全部重新确认
  → 才允许执行第一个 rm / unlink
```

约束:

- 同一个 marker generation 只能有一个 recovery owner;
- lease 用 `wx` / `O_EXCL` 创建;
- lease 内容至少包含 `version` / `leaseId` / `pid` / `createdAt` / `markerFingerprint`;
- 释放按 `leaseId` 做 CAS —— 只有自己写的那把才由自己删;
- lease 存在且 fingerprint 与当前 marker 相同 → 第二个恢复返回
  `EVO_ZVEC_RECOVERY_INCOMPLETE`,reason `recovery-in-progress`,**零破坏性调用**;
- **不得**按时间自动删除「疑似 stale」的 lease —— 时间不是所有权的证据;
- 属于**旧 marker generation** 的遗留 lease 不得阻塞未来的新 marker。这正是 lease
  身份必须包含 fingerprint 的原因:marker 换代意味着上一次恢复要么完成(会释放
  lease)、要么进程已死,两种情况下那把旧 lease 都不再代表活着的恢复;
- 取得 lease **之后**必须重新判定,**禁止**沿用取 lease 之前的 stale `eligible`;
- lease 一直持有到 containment marker 清除完成之后才释放。

`markerFingerprint` 取 marker 文件字节的 SHA-256。它标识的是「哪一次降级」,不是
「哪个时刻」。

### M5.5 archive marker 的事务化发布（承重:失败的恢复不得污染在役 SQLite）

已核实:`ingestArchiveFile()` 把 per-archive marker 写进**全局** `getIndexMemoryDir()`,
**与写入的是哪个 index 无关** —— 注入 recovery builder 时也照写;而 `syncIndexMemory()`
正是用这些 marker 判断跳过。当前实现又在受保护的 `try` **之前**就删掉了这些 marker,
失败路径不恢复。

于是一次失败的恢复会**双向**破坏仍在服役的 SQLite 账本:

```text
1. SQLite 已含档案 A、B；marker A、B 存在
2. recovery 删除 marker A、B
3. Zvec builder 写入 A 成功 → 全局 marker A 被重建
4. 写入 B 时抛错 → marker B 不存在
5. containment marker 保留，系统继续用原 SQLite
6. 下一次 SQLite sync 看到 B 缺 marker → 再写一次 B
```

`SqliteFtsIndex.upsert()` 是无条件 `INSERT`,没有 archive/source 唯一性,所以第 6 步
产生**重复记录**;而第 3 步产生相反的错误 —— 全局 marker 声称 A 已被 SQLite 索引,
实际上 A 只进了那个随后被丢弃的 builder。

即:现有的「失败 → marker 保留 → 引擎留在 SQLite」只保护了**引擎选择**,没有保护
SQLite 赖以工作的**派生同步元数据**。

冻结:

```text
build / validate 阶段
  → 不读取全局 archive marker 来决定跳过
  → 不修改全局 archive marker（写入隔离的 staging 集合）

fresh reopen 验证成功之后
  → 重新核对 raw_memory manifest 未发生变化
  → 事务化发布新的 archive marker 集合
  → 清除 containment marker

任一步失败
  → 全局 archive marker 集合逐字节不变
  → containment marker 保留
  → SQLite bookkeeping 不变
```

`raw_memory` manifest 至少覆盖:

```text
相对文件名
文件内容的 SHA-256
```

**不得**只比较文件数量:数量相同而内容已改,恰恰是最需要挡住的那种。

「逐字节不变」由**从不就地修改**保证,而不是由「失败后再恢复」保证 —— 后者需要一个
自己也可能失败的回滚。发布采用目录级换位:staging 集合就绪后,先把现集合改名让位,
再把 staging 改名就位,任一步失败则改回。

### M6 失败语义

任一失败：

```text
marker 保留
recovery index close
resetMemoryIndex()
命令以非零码退出
```

两条特别固定：

```text
marker 写入失败
  → 编码为失败
  → 【不得】返回一个「成功降级」的 SQLite 实例

marker 清除失败
  → 新 collection 可以留在磁盘
  → recovery index 必须 close / reset
  → marker 仍然阻止正常 Zvec
  → 本次 rebuild 判定为不成功
```

#### M6.1 collection path 无法解析时的合同

现有 decision 已经支持 `paths === null`，返回
`path:collection-path-unresolvable` 的 containment degradation；而 M1 的 schema 要求
`collectionPath` 是非空字符串。这两者原本没有接口。

冻结：

```text
collection path / marker 目录无法可靠解析
  → 【不得】声称成功降级
  → throw EVO_ZVEC_CONTAINMENT_STATE_WRITE
  → detail.reason = 'collection-path-unresolvable'
  → 不返回 SQLite 实例
```

理由与 M6 主条一致:**无法记录 trust debt 的位置时,允许本次「成功」就等于把未来的
自动恢复交给一个没有任何记录的状态** —— 那正是 fail-open 的另一种形状。

T8 第 20 格覆盖这条。

错误码：

```text
EVO_ZVEC_CONTAINMENT_STATE_WRITE
EVO_ZVEC_CONTAINMENT_STATE_READ
EVO_ZVEC_RECOVERY_INCOMPLETE
EVO_ZVEC_CONTAINMENT_STATE_CLEAR
```

`EVO_ZVEC_RECOVERY_INCOMPLETE` 的 reason 集合新增(M5.4 / M5.5):

```text
recovery-in-progress        另一个恢复持有当前 marker generation 的 lease
lease-acquire-failed        lease 无法创建（非 EEXIST）
stale-eligibility           取得 lease 后重新判定不再成立
manifest-changed            raw_memory 在恢复期间发生变化
archive-publish-failed      archive marker 集合发布失败（已回退）
```

### M7 跨平台 trust debt

```text
非 win32 且 marker absent          → 行为完全不变（I9 原义）
marker present / invalid / unreadable → trust debt 跨平台继续有效
                                      → 不因切到 Linux / WSL 自动复用旧 collection
```

否则存在这条绕过：Windows 上 unsafe 产生 marker → 项目切到 Linux/WSL →
classifier 返回 SAFE → 自动打开旧 collection，直接违反 §7.3「路径变 SAFE 后不得
自动复用旧 collection」。

这不是把 Windows classifier 扩大到其他平台，而是让持久 trust marker 兑现它本来的语义。

### M8 与显式 engine pin 的交互

```text
显式 pin 为 sqlite
  marker absent                    → 不创建 marker；正常 sqlite
  marker present/invalid/unreadable → 正常 sqlite；marker 保留；
                                      SQLite rebuild 不清 marker
```

用户显式选择 SQLite 本身**不是** containment degradation，因此不产生 marker。

```text
pin 或环境变量重新选择 zvec
  当前路径非 SAFE          → containment → sqlite（确保 marker 已持久化）
  当前路径 SAFE + marker   → containment-recovery-pending → sqlite（不加载 zvec）
  当前路径 SAFE + 无 marker → 原有 zvec / dependency decision
```

即：`memory-engine.json` 或 `EVO_LITE_MEMORY_ENGINE=zvec` 只能表达**用户意图**，
不能充当 trust marker 的 bypass。**切换 pin 永远不能清除 marker。**

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
| AC5 | 降级复用既有 sqlite 通道并附 containment 原因；§7.3 恢复状态机 + §7.3.1 阶段限定 + §7.4 M1–M8 机制完整实现（T8） |
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
  → 提交证据、Spec、详细计划
     （第 4 版更正：不再另建 IR plan —— plan scan 本就扫描
      docs/superpowers/plans/，另建一份只会造成同 id 重复登记）
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
[x] Spec 与 plan 第 3 版完成审查
[x] 用户显式授权实施 —— Tasks 1–5，已交付并合入
```

> 第 3 版此处曾有一条 `[x] 生产文件仍为零变更`。Tasks 1–5 合入后该条**已不成立**，
> 且它本就是「实施前」的状态描述，不是一条可持续成立的门。故删除，改为按任务分段
> 记录授权状态：

```text
Tasks 1–5（AC1–AC4）  实施授权已给出；已交付、已复审 ACCEPTED、已合入
Task 6（AC5）          机制与计划补完授权（仅文档）；【生产实施未授权】
Tasks 7–8（AC6/AC7）   未授权
Task 9（收口）          未授权
```

### 14.1 Task 6 实施授权门（新增）

在给出 Task 6 生产实施授权之前，下列各条必须成立：

```
[x] §7.3.1 阶段限定（unsafe 不删 / recovery discard）已冻结
[x] M1 marker 载体、路径与 schema 已冻结
[x] M2 损坏方向 fail-closed 与恢复资格已冻结
[x] M3 containment-recovery-pending reason 已冻结
[x] M4 one-shot recovery decision 与 index seam 已冻结
[x] M5 恢复成功十一条已冻结
[x] M6 失败语义与错误码已冻结
[x] M7 跨平台 trust debt 已冻结
[x] M8 engine pin 交互已冻结
[ ] 本次机制补完通过外部复审
[ ] 用户对 Task 6 生产实施的显式授权
```
