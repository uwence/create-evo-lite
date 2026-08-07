---
id: spec:zvec-win-unicode-containment
status: done
created: 2026-07-31
releaseBlocking: true
relationMode: independent
---

# Spec: Zvec Windows 非 ASCII 路径 Containment

> **阶段状态**（第 4 版）：
>
> ```text
> Tasks 1–6（AC1–AC5）  COMPLETE / MERGED
> Task 7 Step 1（AC6）   RE-FROZEN 2026-08-07 —— 五态模型闭合 D2×M8×D5 冲突（§7.5）
> Task 7（AC6）          ACCEPTED / MERGED（PR #17 → merge commit 985b638）
> Task 8（AC7）          ACCEPTED / MERGED（PR #18 → merge commit c2eb784）
> FOCUS 锚点 resync      MERGED（PR #19 → merge commit 04fd869）
> Task 9A（收口程序冻结）  MERGED（PR #20 → merge commit a56ae21）
> Task 9B（上游上报）      MERGED（PR #21 → merge commit 59efcf7）
> Task 9C（依赖登记）      MERGED（PR #22 → merge commit 6e855eb）
> Task 9D（生命周期关闭）  由 PR #23 承载；base main@6e855eb
> context closure       NOT AUTHORIZED
> ```
>
> 上表是**人工阶段摘要**。Tasks 1–8（AC1–AC7）全部交付、经外部复审 ACCEPTED 并已合入；
> `main` 基线依次推进 `bc3ee2f → 985b638 → c2eb784 → 04fd869 → a56ae21 → 59efcf7 → 6e855eb`。
> 最终审查 head：Task 7 = `ac3445c`，Task 8 = `42c054e`。
> 上游已报 `alibaba/zvec#665`。
>
> **AC7 证明的是 lifecycle enforcement，不是 gate removal。** `releaseBlocking: true`
> 全程保留、从未删除也未改 `false`；Task 9D 只把 lifecycle 由 `active` 推进到 `shipped`，
> release-preflight 随之由 `BLOCKED` 转为 `CLEAR`（§8.2.2 的 `done/shipped → ALLOW` 行）。
> 门仍在，只是这个 spec 不再欠它。
>
> 本次除 lifecycle frontmatter 由 `adopted` → `done` 与阶段状态同步外，
> **§8.2 / §8.3 等冻结合同语义未改动**。Task 6 的逐 Step 回填与 mutation 历史导入
> 仍属未处理的历史债，不在本次收口范围内。
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

##### 注入路径的 marker 语义(冻结)

路径注入是**纯判定 seam**,不代表 ambient 项目身份。合同的 "非 SAFE → ensure-present"
只对真实 ambient 路径成立;对合成路径字面执行,会让用合成路径(如 `C:\evo\项目\...`)
做判定的测试与诊断在真实位置建 marker,甚至写进开发者仓库的 `.evo-lite/`,把一个从未降级
的项目永久降级。

```text
ambient production path
  → 正常读取 marker，并按需写入真实 marker

注入 paths / collectionPath，且没有显式 markerDir
  → 只是假设性判定
  → 不读取 ambient marker
  → 不写入 ambient marker
  → 记录 markerSkipped: 'injected-path'

显式 marker
  → 仅作为输入快照参与判定
  → 不因此获得写权限

显式 markerDir
  → 允许在该隔离目录中读取与写入
```

读与写必须分别判定:只栅栏住写、让注入路径继续读 ambient marker,会让一条假设性的 SAFE
路径继承真实项目的债务。生产路径从不注入,因此在真正重要的地方合同未变。

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
// Zvec engine-family identity check（不是字面相等）。
typeof validator.engine === 'string'
    && validator.engine.startsWith('zvec')

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

engine predicate 的语义(冻结):

```text
验证的是 Zvec engine family，不是某一个字面量
当前具体 identifier 为 zvec-jieba-fts（适配器公开值）
sqlite-fts5-trigram，或任何不以 zvec 开头的 identifier，必须失败
```

本版之前此处写作 `validator.engine === 'zvec'`。适配器从未公开过这个值,该断言**永远不可能
成立**,字面执行会让每一次恢复都以 `validator-not-zvec` 失败。改动只针对 identifier 的匹配
方式:精确计数、真实 native query、fresh reopen 三项要求一律不变 —— 这条断言存在的理由,
是证明重开的是 Zvec 而不是会老老实实数行数的 SQLite fallback,该目的不受影响。

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

### M5.4a lease 的所有权必须由文件名身份保证，而不是 read/unlink 时序

M5.4 的第一版实现让所有 generation 共用一个 `zvec-containment-recovery.json`,于是
「CAS」退化成 read → unlink → write,而这在跨进程下不是原子的:

```text
旧 generation A 的 lease 存在

B1                         B2
读到 lease A               读到 lease A
判定与 generation B 不同    判定与 generation B 不同
unlink A
写入 lease B1
                           unlink（实际删掉的是 B1）
                           写入 lease B2

→ B1 与 B2 都 acquired=true：同一 generation 出现两个 owner
```

释放路径同样危险,而且**正常成功路径**就能制造:

```text
旧 owner A                  新 generation B
清除 containment marker
                            新降级写入 marker B
读取旧 lease
                            删除 A、写入 lease B
unlink lease path           ← 删掉的是 B 的 lease
```

冻结:**每个 generation 一个 lease 文件**。

```text
zvec-containment-recovery.<markerFingerprint>.lease.json
```

- 获取只允许**一次** `wx` / `O_EXCL`;
- `EEXIST` 一律表示**同代 recovery in progress**;
- 获取过程中**不得删除或替换任何 lease**;
- 不同 generation 是不同文件,天然互不阻塞 —— 不需要「回收异代 lease」这个动作,
  于是那条竞态从根上消失;
- 同代 lease 内容 invalid / unreadable → **fail-closed**,且不得自动删除;
- 释放同时按 **fingerprint(文件名)与 leaseId** 限定,owner 只删自己那一个;
- 历史 generation 的孤儿 lease 可以留着,不影响当前 generation;
- Task 6 **不**按时间或 PID 自动清理历史 lease。

所有权由**文件名身份 + `O_EXCL`** 保证,不再依赖任何读-改-写的时序。

### M5.5a 发布是一个事务，失败路径不得销毁唯一的原件

第一版发布顺序里有三条未覆盖的失败路径,每条都会破坏 M5.5 承诺的「失败后逐字节不变」:

```text
1  staging 就位失败 → 回滚 rename 也失败
   → 原件只存在于 parked 目录，而 finally 无条件删除 parked → 原账本永久丢失

2  已完成换位后删除 parked 失败
   → 函数报 archive-publish-failed，但 canonical 目录已经是新集合
   → 「命令失败」与盘面事实不一致

3  发布成功后清除 containment marker 失败
   → 系统继续使用 SQLite，而它的 archive 账本已被 Zvec recovery 的新集合替换
   → 新 marker 声称那些档案已索引；若旧 SQLite 并未真正包含它们，后续 sync 会跳过
```

冻结顺序:

```text
build staging
→ fresh reopen 验证
→ manifest 校验
→ 获取【全局 archive-marker 发布锁】
→ 在锁内【再次】manifest 校验
→ park 原 archive-marker 目录
→ 发布 staging 目录
→ 清除 containment marker
→ 释放发布锁
→ 【此时才】删除 parked 备份
```

失败语义:

```text
清除 containment marker 失败
  → 恢复原 archive-marker 目录
  → containment marker 保留
  → 命令失败

发布回滚失败
  → 保留 parked 原件
  → 保留发布锁 / recovery lease
  → reason = archive-publish-rollback-failed
  → 【不得】删除证据
  → 正常全局 sync 必须 fail-closed

已提交成功之后删除 parked 备份失败
  → 事务仍然算成功
  → 保留这份无害的备份并输出诊断
  → 【不得】误报 archive-publish-failed
```

第三条是最容易写错的方向:备份删不掉不影响任何正确性,把它当失败反而会让一次已经成功
的恢复被报成失败,而 marker 已经清了。

### M5.5b 全局 archive-marker 锁

recovery lease 只隔离 recovery 与 recovery。它挡不住**正常 sync 闯进目录换位窗口**:

```text
Recovery                          Normal sync
rename indexDir → parkedDir
                                  发现 indexDir 不存在 → ensureDir → 开始写 marker
rename stagingDir → indexDir  → EEXIST
rollback parkedDir → indexDir → EEXIST
finally 删除 parkedDir
```

一次交错同时破坏 staging、正常 sync 与原件。

冻结:引入**全局 archive-marker 锁**,由以下路径**共同**遵守:

```text
普通 syncIndexMemory() 对全局 marker 集合的读取与写入
普通 archive 写入全局 marker 的路径
recovery 的最终目录换位与 containment-marker 清除
```

recovery **构建 staging 时不获取**该锁 —— staging 与全局集合无关,那段时间正常 sync
应当照常工作。

不得按时间自动回收该锁;无法确认所有权时 **fail-closed**。

新增 reason:

```text
archive-marker-busy               发布锁被占用
archive-publish-rollback-failed   回滚失败，原件保留，证据不得删除
archive-marker-lock-failed        锁本身无法建立或状态不可确认
```

### M5.5c source writer fence

M5.5b 把锁装在了 ingestion 与 marker 写入上,但 `archive()` 在取锁**之前**就已经改了两个
受保护的域:`ensureDir(indexDir)` 与 raw archive 落盘。于是留下两条确定性竞态。

```text
竞态 A —— 重建正在换位的 indexDir

Recovery                         archive()
持有 publication lock
rename indexDir → parkedDir
                                 ensureDir(indexDir)   ← 锁外重建
                                 写 raw archive
                                 取锁 → busy
rename staging → indexDir  → EEXIST
rollback parked → indexDir → EEXIST
```

普通 archive 命令因此仍能制造出 M5.5b 本来要消除的 rollback-failed 状态。

```text
竞态 B —— 锁内 manifest 校验【之后】改动源

Recovery                         archive()
持有 publication lock
锁内 manifest 校验通过
                                 写入新的 raw archive  ← 锁外
                                 取锁 → busy
park / publish / clear marker

结果：marker 已清；raw_memory 多出一个 archive；新 Zvec 不含它
```

这违反 AC5 的核心语义:**marker 只能在「已验证的 collection」与「恢复所消费的源快照」
一致时清除**。

冻结:**Evo-Lite 自己的 archive writer 必须在 publication lock 之内完成全部五项**:

```text
raw 目录创建
index 目录创建
raw archive 写盘
index ingestion
全局 archive marker 写入
```

锁未取得(busy 或建立失败)时,上述五项**全部零修改**。

边界说明:外部编辑器、`git checkout`、人工改动**不受本进程的锁约束** —— manifest 校验仍然
负责侦测那类外部变化。这条 fence 管的是「Evo-Lite 自己的命令不得绕过自己的锁,去制造一个
最终校验之后的源变化」。

### M5.5d quarantine ownership

M5.5a 要求 rollback-failed 时保留 parked 原件与发布锁。第一版实现只保留了发布锁:外层
`finally` 仍无条件释放 recovery lease。于是:

```text
publication lock:   保留
recovery lease:     已释放      ← 第二个恢复可以重新取得同代 lease
containment marker: 保留
```

第二个恢复因此能删除并重建 Zvec collection,一路走到最终发布阶段才被全局锁挡住 —— 但那时
破坏已经发生。处于人工处置状态的 generation,**不应再开始第二次破坏性恢复**。

冻结:

```text
archive-publish-rollback-failed
  → parked 原件保留
  → publication lock 保留
  → 【当前 generation 的 recovery lease 保留】
  → 第二个恢复在任何 rmSync / builder 构造【之前】返回 recovery-in-progress
  → 不按时间或 PID 自动清理
```

### M5.5e lock terminal reporting

锁禁止自动超时回收,因此**静默的 release 失败会造成持久 lockout**,而当前命令却声称正常
完成。空 catch 在这里不是稳健,是把一个需要人工处置的状态藏起来。

冻结:

```text
acquire 失败（非 EEXIST）
  → recovery 返回 coded reason = archive-marker-lock-failed
  → containment marker 保留
  → 不发布

release 失败，且事务【尚未提交】
  → 保留原始失败原因
  → 输出明确诊断
  → 锁继续 fail-closed

release 失败，且事务【已提交】
  → 恢复仍算成功
  → 输出明确 WARN + appendLog
  → 【不得】静默
  → 【不得】把一次已清 marker 的成功恢复改判为失败
```

`released === false` 的返回值同样必须被检查 —— 它和抛错一样是「锁没放掉」。

### M5.5f stable publication-lock identity

M5.5b 的锁路径由 `getIndexMemoryDir()` 的返回值直接派生。该函数不是纯 getter:它会把
`vect_memory` 实时 rename 成 `index_memory`,并在 rename 失败时返回 legacy 路径。因此
首次升级期间存在确定性交错:

```text
进程 A                                   进程 B

看到 vect_memory 存在 / index_memory 不存在
                                         看到 vect_memory 存在 / index_memory 不存在
rename legacy → modern 成功 → 返回 modern
                                         rename 失败 → catch → 返回 legacy

锁 index_memory.publication.lock          锁 vect_memory.publication.lock
```

两个进程都认为自己持有「全局」锁。更糟的是 B 进入回调后会再次解析目录,此时 legacy 已
不存在,于是 B 会**持 legacy 锁修改 modern marker set**。M5.5b/M5.5c 想关掉的窗口
(archive 与 recovery 同时进入、sync 与 publication 同时改同一集合、rollback-failed、
final manifest 之后源发生变化)会因此全部重新打开。

冻结:

```text
publication lock 位于【不随 vect_memory/index_memory 迁移而改变】的位置
legacy 与 modern 两个别名必须映射到【同一个】lock path
迁移竞态不得形成两名 owner

archiveLockPathFor(<root>/vect_memory) === archiveLockPathFor(<root>/index_memory)
```

`archiveLockPathFor(indexDir)` 的公开签名保留,但返回值必须由**共同父目录 + 固定文件名**
构成,不得继续拼接 `indexDir + '.publication.lock'`。所有诊断与错误消息中的锁路径也必须
经由该函数取得,不得就地拼接第二份真相。

`runtime.js` 不在本轮可改范围内 —— 该修法不需要修改它。

### M5.4b recovery-lease terminal reporting

M5.5e 只覆盖了 publication lock。recovery lease 同样禁止按时间或 PID 回收,因此它的
release 失败同样是持久 lockout:

```text
恢复在 marker 清除前失败
  + lease unlink 遇到 EBUSY / EACCES,或返回 not-owner / unreadable

containment marker: present
recovery lease:     present
命令报告:            只有原始恢复失败
后续 rebuild:        永久 recovery-in-progress
```

冻结(非 quarantine 路径也必须检查返回值与异常):

```text
marker 尚未清除 + release 失败
  → 保留原始 recovery failure（不得改写 reason）
  → console.error + appendLog
  → 明确说明同 generation 的后续恢复会被阻止

marker 已成功清除 + release 失败
  → recovery 仍算【成功】
  → console.warn + appendLog
  → 旧 generation 的残留 lease 无害,不得误报恢复失败

release 返回 absent
  → 释放目标已达成,视为无残留,不报告
```

`not-owner`、`unreadable` 与抛错都必须报告。空 catch 在此禁止。

### M5.5g serialized ledger migration

M5.5f 稳定了**锁的身份**,却没有约束**被锁保护的目录本身会改名**。`getIndexMemoryDir()`
仍会就地执行 `vect_memory → index_memory`,而且任何调用者都能触发它 —— 包括
`summarizeArchiveHealth()` 这样的只读路径。锁包装器又在取锁**之前**调用它。

于是仍存在确定性交错:

```text
进程 A：普通 sync                         进程 B：verify / health 只读

getIndexMemoryDir()
  rename 暂时失败 → 返回 legacy
取得固定 publication lock
vectDir = legacy
                                          summarizeArchiveHealth()
                                          getIndexMemoryDir()
                                          rename legacy → modern 成功

ensureDir(legacy) 重新建出空目录
从空 legacy marker set 计算 skipped
把已有档案再次插入 SQLite
ingestArchiveFile() 又重新解析 → marker 写到 modern
```

一次事务内用了两个 ledger identity:SQLite 重复插入,legacy 被重建,marker 落在 modern。

恢复路径后果更重。publication 也在取锁前解析并缓存 `indexDir`:

```text
锁前解析 → legacy
取得 publication lock
                                          锁外 migrate legacy → modern
ensureDir(legacy) 重新建出空目录
park 空 legacy → publish staging → legacy
clear containment marker

此后 getIndexMemoryDir() 看到 modern 已存在 → 用旧 modern ledger
刚发布并验证过的那一份被搁死在 legacy
```

盘面变成 marker 已清、在役 bookkeeping 却不是经过验证并发布的那一份 —— 直接违反 AC5。

冻结:

```text
getIndexMemoryDir() 必须是纯解析：不得 rename、不得 mkdir、不得任何写入

vect_memory → index_memory 是对全局 archive-marker ledger 的写操作，
  必须【只在持有 publication lock 时】执行

持锁操作必须在锁内完成 migration/resolve，
  并把最终 activeIndexDir 固定传给整个事务

事务内禁止再次通过 ambient getter 重新解析 marker 目录
```

纯 getter 的解析规则(冻结):

```text
modern 存在                  → modern
modern 不存在且 legacy 存在   → legacy
两者都不存在                 → modern
两者都存在                   → modern
```

`migrateLegacyIndexMemoryDir()` 保留为**显式 writer**,只有 publication-lock 的持有者可以
调用它。

锁包装器的顺序因此固定为:

```text
纯计算出固定 lock anchor
取得 publication lock
  → migrateLegacyIndexMemoryDir() → 唯一 activeIndexDir
  → fn(activeIndexDir)
释放 publication lock
```

`archive` / `sync` / 普通 `rebuild` / recovery publication 的删除、枚举、park、swap、
rollback、marker 写入,一律使用这一个传入的 `activeIndexDir`。

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

## 7.5 只读诊断合同冻结（Task 7 Step 1 / AC6）

本节冻结 `verify` 的 containment 诊断合同。**仅合同，不含实现授权。**
D1–D3 的每条事实都经 2026-08-05 的代码审计核实，行号随核实一并记录
（审计基线 `main@bc3ee2f`）。本节**自包含**：执行它不需要引用任何其他证据文件。

### D0 承重裁定：verify 参与 ambient 判定（收法 B）

**已裁定，不得在编码中改判。**

冲突是真实的：`verify()`（`memory.service.js:2330`）在 `:2618` 调 `resolveActiveImpl()`，
该路径经 `sharedEngineDecision()` → `persistEngineDecision()` —— 即 §7.4 M3.1 中**唯一**
写 marker 的地方。因此在一台路径刚变成非 SAFE 的机器上，若 `verify` 是此后第一条被执行的
命令，**是 verify 记下了这笔债**。

```text
收法 A（已否决）  verify 纯旁观，只用 peekEngineDecision()
收法 B（采纳）    verify 走的就是每条命令都走的 ambient decision
```

否决 A 的理由有两条，第二条是审计新增的：

1. `peekEngineDecision()`（`memory-index.js:501`）返回的是模块级 `decision` 变量，
   **只有本进程已做过判定时才非 null**。而 verify 通常是进程里第一条命令 ——
   A 会让最需要诊断的时刻恰好无话可说。
2. 为使 A 可用，只能扩大 `peekEngineDecision()` 的返回面，或让 verify 自行重算
   （后者又回到写 marker）。**前者直接触发「不扩大产品接口」的限定**，两条限定互相打架。

因此合同措辞固定为：

```text
不得因【诊断本身】引入 ambient 路径之外的 marker I/O。
verify 写的 marker 与 memorize / recall 写的是同一笔债，不是诊断造成的。
```

`resolveActiveImpl()` 在生产中并非 verify 专有：`rebuildLocalIndex()` 内 `:2259`
是第二个调用点。ambient 铸造是常态路径，这正是 B 成立的前提。

### D1 数据来源：零导出面扩大（审计结论）

诊断所需的两个来源**都已经导出**，实现轮次只需在 `memory.service.js` 现有的 require
列表里消费它们，**不新增任何模块导出**：

```text
peekEngineDecision()     memory-index.js:501，已导出于 :649
                         收法 B 下 verify 走过 :2618，故此处必然非 null
readContainmentState()   zvec-containment-state.js:118，已导出于 :458
                         memory.service.js 已 require 该模块（:40-43）
marker 目录               path.dirname(getDbPath())
                         getDbPath 已导入（:24），DB_PATH 已存在（:161）
```

直接从 state 模块消费而不扩大 `memory-index` 的导出面，与 `:38-39` 既有注释所记的
recovery lease 处理方式是同一模式。

> **这不构成接口扩大**：导出面逐字节不变，改变的只是 `memory.service.js` 消费了哪些
> 已有导出。「除非审计证明现有导出面无法完成只读诊断，否则不扩大产品接口」的限定
> 因此得到满足 —— 审计的结论是**够用**。
>
> 若实施中发现导出面确实不足，**不得现场扩大接口**：硬停并提交具体不可实现路径。

诊断段**只允许**组合上述两个来源。**禁止**通过下列入口"刷新诊断"，因为它们可能重新判定、
加载依赖、写 marker、取得 lease 或进入恢复语义：

```text
resolveEngineDecision()
sharedEngineDecision()
resolveRecoveryRebuildDecision()
getMemoryIndex()
```

### D2 为什么必须独立读一次 marker（decision 的覆盖缺口）

`peekEngineDecision()` 返回的 decision **不含 `inputs.marker`**。marker 的读取态只在
一个分支被部分透传，实测覆盖矩阵：

| 场景 | decision 中的 marker 信息 | 诊断是否够用 |
|---|---|---|
| 非 SAFE（`ensure-present`） | `markerPersisted` / `markerAlreadyPresent` / `markerPath` | ❌ 只有写入结果，**没有写入前的读取态** |
| SAFE + marker 非 absent | `recovery.{required,markerStatus,markerPath,reason}` | ✅ 完整 |
| SAFE + marker absent | 无 marker 字段 | ✅ 无债，正确 |
| 显式 pin sqlite（M8） | 无 marker 字段 | ❌ M8 规定「marker 保留」，诊断却拿不到它 |
| 注入路径（M3.1） | `markerSkipped: 'injected-path'` | ✅ 按设计不参与 |

两处 ❌ 是真实缺口：

- **非 SAFE 分支**：`writeContainmentState` 是排他创建，`EEXIST` 只会得到
  `alreadyPresent`，诊断**无法区分「marker 正常存在」与「marker 损坏 / 不可读」**。
- **pin sqlite 分支**：用户 pin 走之后跑 verify，将看不到仍未清偿的 containment 债。

**因此合同要求**：verify 除消费 decision 外，**必须独立调用 `readContainmentState()`
取一次权威只读快照**。这是 ambient 路径内的纯读，不违反 D0。

显式 `choice=sqlite` 时，即便当前并未 degraded，**也必须单独显示尚存的 marker**；
不得因为用户 pin 而掩盖债务。

### D3 marker 四态的呈现（且不得建议自动删除）

`readContainmentState()` 的 `status` 是封闭四值，逐一都要有可见呈现：

```text
absent      无债
present     有债；显示 markerPath 与 state 中的 collectionPath / containment
invalid     schema 或字段不合法 → 人工处置
unreadable  IO / 权限 / 路径不可解析 → 人工处置；显示 errorCode 与 detail
```

**`present` 的呈现要求是承重的，不是可选的。** 诊断必须把 marker `state` 里记录的
`collectionPath` 与 `containment { verdict, layer, reason }` **原样呈现给用户**，
且必须与「本进程当前 decision」分层显示，不得混为一谈：

```text
当前判定
  choice / impl / degraded / reason
  当前 containment verdict / layer / reason（decision 有才显示）

containment marker 原始记录
  status / markerPath
  recordedCollectionPath
  recorded verdict / layer / reason
```

这一条在 `debt-under-pin` 下尤其承重：`resolveEngineDecisionFromInputs()` 在
`choice !== 'zvec'` 时**直接返回 `containment: null`**（§7.4 M8 分支在分类之前就返回），
所以那条路径上唯一能说明「这笔债针对哪个 collection、当初为何产生」的信息，
**全部只存在于 marker 里**。不显示它，等于让操作者拿着一笔无法追溯来由的债。

呈现所用的数据必须来自 D2 已经取得的**那一次** marker snapshot；不得为了输出再读第二次。

**`invalid` 与 `unreadable` 一律不得建议删除 marker，也不得折叠成普通 `present`。**
二者都是「债的存在已知、内容不可信」，删除等于把未知状态伪装成无债 —— 正是 §7.4 M2
fail-closed 方向要防的。诊断只报告并指引人工检查 marker 文件、权限或内容；
`clearContainmentState` 不得出现在任何 verify 建议文案里。

### D4 「collection 未被打开」用什么可观测证据表达

**诚实边界：`verify` 在运行时无法证明这件事，合同不得要求它假装能。**

verify 可报告的是本进程 decision 的可观测事实：

```text
decision.impl === 'sqlite'
decision.ZvecIndex === null
decision.reason ∈ { 'containment', 'containment-recovery-pending' }
```

真正的证明属于测试层 —— 非 `SAFE` 路径下 `loadZvecIndex` 调用次数为 0（Task 4 的 T6、
Task 6 的 T8b 已经钉住）。合同因此区分两句话：

```text
允许："本次 verify 进程未加载 Zvec native binding，也未实例化或打开该 collection。"
禁止："该 collection 从未被读取。"   ← verify 无从证实，属于 D6 禁令
```

诊断只能说明**本次进程行为**与**当前 containment 状态**，不能证明全局历史事实。

### D4.1 副作用要求（可计数，供 T12 与负控断言）

执行 `verify` 时必须保持：

```text
Zvec native require count:       0
Zvec index constructor count:    0
collection open count:           0
collection read/query count:     0
marker write count:              0
marker clear count:              0
rebuild count:                   0
recovery lease acquisition:      0
archive publication lock write:  0
```

`verify` 的其余健康检查可继续读取无关信息，但 **containment 段自身**不得引入上述副作用。

**每一项都必须有 call-level 的可证伪 guard（2026-08-07 re-freeze）。**
验收标准是一句话：

> 若 containment 段真的执行了一次被禁止的动作，**即使它随后把现场恢复原样，测试仍必须变红。**

因此 **end-state inference 不得作为主要证明**：

```text
marker hash + mtime 未变        ⇏ write count = 0   （覆写回相同 bytes 即可绕过）
目录指纹未变                    ⇏ rebuild count = 0 （重建成相同形状即可绕过）
lease 文件最终不存在            ⇏ acquire count = 0 （create → release 终态相同）
lock 文件最终不存在             ⇏ lock write = 0    （同上）
```

正确做法是**测试侧 instrumentation**：在 `memory.service.js` 被加载**之前**拦截模块解析，
给它将要解构的依赖套上计数代理，从而统计真实调用次数。文件系统层面的哈希/指纹
可以保留为**辅助佐证**，但不得充当调用计数的替代。

若某一项确实无法通过测试侧 instrumentation 建立可证伪 guard，
**停止并上报**——不得为测试便利扩大产品接口（不新增 production testing API，
不改 `memory-index.js` / `zvec-containment-state.js`，不新增依赖）。
对确实无法直接代理的项（如模块内部私有函数），允许改由**专属 mutation** 证明：
把被禁止的调用插入 containment 段后，必须稳定命中其专属断言。

### D5 五种 containment 状态与 nextSteps（2026-08-07 局部 re-freeze）

> **本节经复审局部重开并重新冻结。** 第 1 版只列四态，且把 `normal` 的判据写成
> 「marker absent **且** `impl==='zvec'`」—— 它在一个状态里同时表达了**两个独立维度**：
> 「有没有 containment trust debt」与「当前引擎是不是 zvec」。于是
> `pin sqlite + marker absent` 与 `dependency-unavailable + marker absent`
> 两种真实组合在四态模型里无处可去。
>
> 同时 D2 要求显式 pin **不得掩盖**既有 marker，而 §7.4 M8 又允许
> `pin + marker present` 继续以 sqlite 正常运行 —— 四态模型无法同时满足这两条。
> **这是合同自身的缺口。** 实现遇到它时必须停止并上报，不得现场补设计。

**`containment.state` 是封闭五值，只表达 containment trust debt，不表达引擎是否为 zvec。**
判据自上而下，首个命中者胜：

| # | 状态 | 判据 | nextSteps 必须说 |
|---|---|---|---|
| 1 | `marker-damaged` | marker `invalid` / `unreadable` | fail-closed；不得折叠成普通 `present`；**不得**建议删除或自动 rebuild；提示人工检查 marker 文件、权限与内容 |
| 2 | `unsafe` | `reason === 'containment'` | 继续使用 SQLite；**不允许** recovery rebuild；先迁移到受支持路径（§5.1）后重新 verify |
| 3 | `recovery-pending` | `reason === 'containment-recovery-pending'` | 继续使用 SQLite；人工执行显式 rebuild；重建并经 fresh validator 重开验证通过后 marker 才会被清除 |
| 4 | `debt-under-pin` | marker `present`，且当前为显式 sqlite pin（`reason === 'engine-choice'`） | 债仍在；该分支不做路径判定，故无法断言路径是否受支持；要清债需先取消 pin 回到 zvec，并在受支持路径上人工执行显式 rebuild |
| 5 | `no-debt` | marker `absent` | **仅**表示当前没有未清偿的 containment trust debt |

> 判据 4 的实现兜底可写作「marker `present` 且未命中 1–3」：在 SAFE 路径上
> `marker present` 必然已由 `resolveEngineDecisionFromInputs()` 归入
> `containment-recovery-pending`（§7.4 M3），因此走到该档的 `present` 只可能来自
> `choice !== 'zvec'` 的 pin 分支。两种写法语义等价，兜底写法更 fail-safe。

**引擎状态由独立的 `engine.{choice, impl, degraded, reason}` 表达，与 `state` 不得再合并。**
因此下列三种情况必须都报 `no-debt`，而各自的引擎事实互不相同：

```text
pin sqlite + marker absent
    state = no-debt   engine.impl = sqlite   engine.reason = engine-choice
SAFE + binding unavailable + marker absent
    state = no-debt   engine.impl = sqlite   engine.reason = dependency-unavailable
SAFE + zvec available + marker absent
    state = no-debt   engine.impl = zvec     engine.reason = zvec
```

`no-debt` 的文案**禁止**出现「当前引擎按正常判定运行」这类把两个维度重新粘回去的表述
（见 D6）。它只能陈述「没有未清偿的 containment trust debt」。

`unsafe` 与 `recovery-pending` 的区别是本节最容易做错的一处：前者跑 rebuild 纯属浪费
（路径仍不受支持，重建出的 collection 一样不可用），后者才是 rebuild 能解决的。
**两者的 nextSteps 不得共用同一段模板。**

### D6 措辞禁令

```text
禁止："该 collection 从未被读取"
禁止："该 collection 内容确认完整"
禁止："上游缺陷已经修复"
禁止："路径问题已经修复"
禁止："系统已自动恢复"
禁止：把 containment 说成"错误"（它是设计内的 fail-closed 结果）
禁止：在任何状态下建议删除 marker
禁止：在 no-debt 文案中断言引擎状态（如"当前引擎按正常判定运行"）——
      debt 与 engine 是两个独立维度，D5 刚把它们拆开，文案不得再粘回去
```

### D7 承重负控 A–G（实现轮次逐条验证）

七条完整内联，实施时不得依据实现方便重新解释：

```text
A   verify 加载 @zvec/zvec
    → native-load guard 必须变红
B   verify 实例化或打开 collection
    → constructor/open guard 必须变红
C1  verify 清 marker
    → marker-clear guard 必须变红
C2  verify 自动触发 rebuild
    → rebuild guard 必须变红
C3  verify 取得 recovery ownership / lease（或 archive publication lock）
    → ownership guard 必须变红
D   输出声称上游缺陷已修复或 collection 已修复
    → wording contract 必须变红
E   SAFE + marker present 未显示 recovery-pending
    → state/nextSteps assertion 必须变红
F   invalid / unreadable 被折叠成普通 present
    → marker-status assertion 必须变红
G   unsafe 与 recovery-pending 共用同一段 nextSteps
    → state-specific remediation assertion 必须变红
```

> 第 1 版把 C 写成「清 marker、自动 rebuild 或取得恢复所有权」三合一，实施时只施加了
> 清 marker 一种，另外两种性质因而从未被证伪过。编号在此拆开，**编号本身不是合同，
> 守护性质才是**；实施可按需继续扩展（B2、C4…），但每条性质都必须各自有 mutation。

纪律：突变负控只在**完整绿色基线**上运行，逐条按 SHA-256 还原并与 template 镜像比对，
突变态下绝不中断。**基线红时不得以「仍然非零」判定突变有效。**

每条负控必须记录：

```text
mutation ID
guard property（守护的性质）
target file
exact mutation point / 周边 hunk
施加的具体变化
expected guard
observed relevant assertion（原文）
guardHit
exit code
baseline SHA-256 / mutated SHA-256 / restored SHA-256
restored live SHA-256 / restored template SHA-256 / mirror-identical
```

证据落成 `docs/validation/zvec-win-unicode-verify-diagnostics.md`，
**不得只留在 PR 正文或 gitignored 装置里。** 验收标准是：**任何后来的 reviewer
仅凭仓库内的 durable evidence 就能重建每一条负控究竟改了什么、由哪条断言捕获**，
而不需要访问 harness 文件。只写「C2 auto rebuild → failed」不满足该标准。

### D8 文件范围（实现轮次）

```text
可改：.evo-lite/cli/memory.service.js        templates/cli/memory.service.js
      .evo-lite/cli/test/governance.js       templates/cli/test/governance.js
      .evo-lite/cli/test/integration.js      templates/cli/test/integration.js

新增：docs/validation/zvec-win-unicode-verify-diagnostics.md

不得改：memory-index.js / zvec-containment-state.js / memory-index-zvec.js /
        runtime.js / memory.js / template-manifest.js / package.json /
        .github/** / .evo-lite/active_context.md / .evo-lite/raw_memory/**
```

`memory-index.js` 与 `zvec-containment-state.js` 进入"不得改"清单，正是 D1 结论的直接
后果：诊断不需要它们改任何一行。

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
| T12 **verify 诊断状态矩阵**（§7.5） | ①**五态**各自呈现且互不折叠：`no-debt` / `unsafe` / `recovery-pending` / `marker-damaged` / `debt-under-pin`（`invalid` 与 `unreadable` **不得**折叠进 `present`）；②`unsafe` 与 `recovery-pending` 的 nextSteps **不共用模板**——前者指向迁移受支持路径且不允许 rebuild、后者指向显式 rebuild；③任何状态下**不出现**删除 marker 的建议；④文案不含 D6 禁令中的任何表述，既**不承诺** collection 内容未被读取（D4 边界），也**不在 `no-debt` 中断言引擎状态**；⑤诊断段满足 D4.1 九项零副作用，且每项均由 **call-level 计数**（而非终态推断）守护；⑥危险路径样本上 `verify` 可诊断且不崩溃；⑦**债与引擎两维度分离**：`pin+marker absent` 与 `dependency-unavailable+marker absent` 均为 `no-debt` 且各自 `engine.reason` 正确；⑧`debt-under-pin` 下 marker 原始 `collectionPath` 与 `containment{verdict,layer,reason}` 全部可见（D3） |

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
| AC6 | `verify` 报告 containment 状态与人工恢复指引；危险路径上已存在的 collection 只报告不打开；合同冻结于 §7.5 D0–D8（T12） |
| AC7 | `spec-portfolio.js` registry 输出 `releaseBlocking`（按 §8.2.2.0 严格原始值解释）、waiver schema、`errors` 与 `source` 计数，并按 §8.2.2 派生 blockers；发布阻断落在 `prepublishOnly`/release-preflight，放行条件为 `errors.length === 0 && blockers.length === 0`；`release-gate.yml` 提供合同证据且**回归时 PR 变红**（§8.2.1–§8.3，T10/T11） |
| AC8 | T1–T12 固化为常驻合同测试（live + template 双份）；崩溃 corpus 测试不实际触发崩溃 |

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
Task 6（AC5）          已交付、已复审 ACCEPTED、已合入（PR #16 → main@bc3ee2f）
Task 7（AC6）          已交付、已复审 ACCEPTED、已合入（PR #17 → main@985b638）
Task 8（AC7）          已交付、已复审 ACCEPTED、已合入（PR #18 → main@c2eb784）
Task 9（收口）          收口程序已冻结；执行分 9A–9D 逐段授权
                      9A → PR #20 / a56ae21，9B → PR #21 / 59efcf7，9C → PR #22 / 6e855eb
                      9D（生命周期关闭）由 PR #23 承载，base main@6e855eb
context closure       未授权
```

> Task 9 的收口程序见 plan 的 Task 9 段落（2026-08-07 kickoff audit 后重新冻结）。
> 承重结论：本 spec 的 closure readiness 是 `NO-CONTRACT`，**不补事后 criteria、
> 不调用 `mem close --apply`**，改为 reviewer-attested 受控人工关闭；`mem commit`
> 从 Task 9 移出，归入独立的 context closure。**`releaseBlocking: true` 全程保留、
> 永不删除也不改 false** —— 收口要证明的是 `shipped + releaseBlocking:true → CLEAR`，
> 而不是把 gate 拆掉。

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
