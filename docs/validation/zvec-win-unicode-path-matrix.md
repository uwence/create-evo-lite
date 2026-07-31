# zvec Windows 非 ASCII 路径 — 触发边界证据矩阵

- 议题：`[zvec-win-unicode-containment]`（P0 / release-blocker）
- 阶段：**Phase D**（证据固化）；生产代码变更：**零**
- 日期：2026-07-31
- 分支：`codex/zvec-win-unicode-containment-design`（base `main@6fdfe51`）
- 前序证据：`docs/validation/zvec-06-phase0b-verdict.md` §8

## 0. 环境与基线

```
node            v22.22.2 / win32 / x64
os              Windows NT 10.0.26200（Windows 11 Pro）
locale          zh-CN     console encoding  utf-8
@zvec/zvec      0.6.0
binding         D:\Data\ProjectAgent\create-evo-lite\node_modules\@zvec\zvec\src\index.js
known failure   Windows + 部分非 ASCII collection path
failure mode    0xC0000409 / STATUS_STACK_BUFFER_OVERRUN / 不可捕获 fail-fast
```

**binding 钉死**：父进程一次性 `require.resolve('@zvec/zvec')`，以绝对路径经 `argv` 下传；子进程
**从不**裸 `require('@zvec/zvec')`。这是对 `zvec-06` 那次「0.5-holder × 0.6-prober 混版测量」
的直接防范 —— 探针若写在 `os.tmpdir()` 并裸 require，会向上解析命中开发机上游离的用户级
`node_modules`。本轮全部子进程记录了实际加载的 binding 路径，见
`docs/validation/fixtures/zvec-win-unicode/results-summary.json`。

## 1. 方法与隔离契约

目标故障会**杀死进程**，因此：

- 每个样本一个**独立子进程**；父进程只观察 `status` / `signal` / `stdout` / `stderr`。
- 阶段标记用 `fs.writeSync(1, ...)`（同步无缓冲）。`console.log` 是缓冲的，进程被 OS 终止时
  缓冲区**不会 flush**，恰好会销毁本探针唯一要采集的证据。
- 子进程复刻生产 schema（`content` jieba-FTS + `namespace` INVERT + `timestamp`）与生产调用链
  `ZVecCreateAndOpen`/`ZVecOpen` → `insertSync` → `optimizeSync` → `querySync` → `closeSync`，
  取自 `.evo-lite/cli/memory-index-zvec.js`。schema 或调用链不同即是在探另一条 native 路径。
- 每样本重复 **3 次**（R4 为 2 次）。单次未崩溃**不判定为安全**；轮次间判定不一致一律记为
  `UNSTABLE`，不做平滑。

判定分类：

| 判定 | 含义 |
|---|---|
| `COMPLETED_NO_FAILFAST` | 本次执行走完全部阶段、exit 0。**仅此而已** |
| `FAIL_FAST_REPRODUCED` | 进程异常终止且 JS 层从未获得控制权（无 jsError） |
| `NORMAL_JS_ERROR` | 抛出可捕获的 JS 异常，exit 1 |
| `INCONCLUSIVE` | 超时或无法归类 |
| `UNSTABLE` | 同一样本多轮判定不一致（不做多数表决平滑） |

> **命名说明**：本文档刻意**不使用** `PASS_SAFE` 一类措辞。本文档同时承认「单次未崩溃不能
> 判定安全」「ASCII 只是有界观察」「上游无路径安全合同」—— 若把执行完成命名为 "safe"，
> 就会在同一份文档里把**观测**偷换成**证明**。
> spec 中的 `SAFE` 是**运行时放行判定**，与本表判定是两个概念，不得混用。

**证据资产**：`docs/validation/fixtures/zvec-win-unicode/`（corpus、统一 runner、逐样本判定
摘要、原始结果 sha256、复现说明）。fixture 默认拒绝执行，需 `ZVEC_UNICODE_PROBE=1` 显式 opt-in，
未登记进 `template-manifest.js`，不随 scaffold 分发，也不参与 `npm test`。

## 2. 轮次总览

| 轮次 | 样本 | 判定分布 | 结论 |
|---|---|---|---|
| R1 单一脚本类别扫描 | 14 | 12 `COMPLETED_NO_FAILFAST` / 2 `NORMAL_JS_ERROR` | **零复现 —— 是盲区，不是反证** |
| R2 原始样本复刻 + 分隔符 + 脚本对 | 42 | 19 `FAIL_FAST` / 23 `COMPLETED_NO_FAILFAST` | 原始证据 **0 mismatch** 全复现 |
| R3 中英文范围密集证伪 | 79 | 76 `COMPLETED_NO_FAILFAST` / **3 `FAIL_FAST`** | **中文范围内存在崩溃样本** |
| R4 长度控制实验 | 7 × 24 档 | 见 §5 | 在**所测长度区间内**未观察到判定翻转 |

### R1 为何全绿（重要方法学教训）

R1 只测了**单一脚本**样本（纯中文 / 纯假名 / 纯谚文各自独立）。原始证据里单一脚本本来就是 OK 的，
崩溃集全是**混合脚本 + `-`/空格/`.` 分隔**。R1 的全绿因此**不构成对立项前提的反驳**，它只证明
R1 的样本集不含触发组合。把 R1 直接读成「缺陷不存在」会是本轮最危险的一次误判。

## 3. R2 — 原始证据复刻（承重对照）

`docs/validation/zvec-06-phase0b-verdict.md` §8 的 9 个样本逐字复刻，**9/9 与原判定一致**
（`originalEvidenceMismatches: 0`）。这是整套夹具可信的前提；若此块不复现，后续一切结论作废。

| 样本 | 字节 | 原证据 | 本轮 |
|---|---|---|---|
| `中文-日本語-한국어` | 26 | CRASH | `FAIL_FAST_REPRODUCED` |
| `日本語-한국어` | 19 | CRASH | `FAIL_FAST_REPRODUCED` |
| `中文語-中文語` | 19 | CRASH | `FAIL_FAST_REPRODUCED` |
| `日本語 한국어` | 19 | CRASH | `FAIL_FAST_REPRODUCED` |
| `日本語.한국어` | 19 | CRASH | `FAIL_FAST_REPRODUCED` |
| `日本語_한국어` | 19 | OK | `COMPLETED_NO_FAILFAST` |
| `中文中文-中文中文` | 25 | OK | `COMPLETED_NO_FAILFAST` |
| `中文目录` | 12 | OK | `COMPLETED_NO_FAILFAST` |
| `ascii-control` | 13 | OK | `COMPLETED_NO_FAILFAST` |

**崩溃阶段精确定位**：最后一个成功阶段标记恒为 `create_or_open`，`insert` 标记从未出现
→ 崩溃发生在 **`insertSync`**，`create` 与 index 均成功。与原证据 §8 一致。

> 下列表中 `OK` = `COMPLETED_NO_FAILFAST`（本次执行完成），**不表示该路径已被证明安全**。

### 分隔符扫描（`日本語<SEP>한국어`，脚本对固定）

| 分隔符 | `-` | 空格 | `.` | `+` | `_` | `~` | 无 | `的` |
|---|---|---|---|---|---|---|---|---|
| 判定 | CRASH | CRASH | CRASH | CRASH | OK | OK | OK | OK |

### 脚本对扫描（`A-B`，分隔符固定为 `-`）

| A \ B | 中文 | 日本語 | 한국어 | ascii | 西里尔 |
|---|---|---|---|---|---|
| **中文** | OK | OK | OK | OK | OK |
| **日本語** | CRASH | CRASH | CRASH | CRASH | CRASH |
| **한국어** | CRASH | CRASH | CRASH | CRASH | CRASH |
| **ascii** | OK | OK | OK | OK | OK |
| **西里尔** | OK | OK | OK | OK | OK |

顺序敏感：`中文-日本語` OK，`日本語-中文` CRASH。

## 4. R3 — 中英文范围的证伪结果

R2 的脚本对表看起来支持「中文/ASCII 打头即安全」。R3 以**证伪**为目的对中英文范围做密集扫描
（20 种分隔符 × 3 种脚本排布、CJK 标点与全角形、罕用/扩展平面/兼容汉字、真实 ASCII 目录名形态；
每样本 × 2 个路径位置 × 3 轮 = 474 次子进程）。

**结果：76 `COMPLETED_NO_FAILFAST` / 3 `FAIL_FAST_REPRODUCED`。中文范围内存在崩溃样本。**

| 崩溃样本 | segment 字节 | 码点 |
|---|---|---|
| `虜-golf` | **8** | `U+865C U+002D U+0067 U+006F U+006C U+0066` |
| `𠀋𠮷-项目` | 15 | `U+2000B U+20BB7 U+002D U+9879 U+76EE` |
| `龘齉爩-项目` | 16 | `U+9F98 U+9F49 U+7229 U+002D U+9879 U+76EE` |

对照（同范围、同分隔符、更长）全部 `COMPLETED_NO_FAILFAST`：

| 完成样本 | segment 字节 | 码点 |
|---|---|---|
| `中文-项目` | 13 | `U+4E2D U+6587 U+002D U+9879 U+76EE` |
| `氵扌-项目` | 13 | `U+6C35 U+624C U+002D U+9879 U+76EE` |
| `繁體中文-專案` | 19 | `U+7E41 U+9AD4 U+4E2D U+6587 U+002D U+5C08 U+6848` |

`虜-golf` 是最锋利的反例：**一个汉字 + ASCII、8 字节**，比多个完成样本都短，仍然硬崩。

**位置维度（有界）**：本轮只比较了**两个**位置 —— Unicode 作为项目根目录名、
作为 collection 目录名本身。二者判定一致。准确表述是
**「在已测样本与这两个位置之间，位置变化未改变判定」**，
**不能**提升为「与路径位置无关」这一全局事实。中间层目录、盘符层、
`.evo-lite` 与 `zvec` 之间的其他层级均**未测**。

## 5. R4 — 长度控制实验（内容 vs 长度）

R1–R3 让样本 id 参与路径，**总路径长度是未受控变量**。对
`STATUS_STACK_BUFFER_OVERRUN` 而言这不是脚注：固定栈缓冲区溢出本身就是长度故事。
R4 把 segment **完全固定**，只让一个 padding 目录名逐字符增长（pad 0..23），
每档 2 轮。若判定随长度翻转，则任何基于字符的白名单都不成立。

**结果：`anyFlip: false`。7 个 segment × 24 档 padding，判定全部稳定，零翻转。**

| segment | 判定 | 完整路径长度跨度 | 24 档结果 |
|---|---|---|---|
| `日本語-한국어` | `FAIL_FAST` | 109..132 | `XXXXXXXXXXXXXXXXXXXXXXXX` |
| `中文語-中文語` | `FAIL_FAST` | 109..132 | `XXXXXXXXXXXXXXXXXXXXXXXX` |
| `虜-golf` | `FAIL_FAST` | 108..131 | `XXXXXXXXXXXXXXXXXXXXXXXX` |
| `龘齉爩-项目` | `FAIL_FAST` | 108..131 | `XXXXXXXXXXXXXXXXXXXXXXXX` |
| `中文中文-中文中文` | `COMPLETED_NO_FAILFAST` | 111..134 | `........................` |
| `中文-repo` | `COMPLETED_NO_FAILFAST` | 109..132 | `........................` |
| `ascii-control` | `COMPLETED_NO_FAILFAST` | 115..138 | `........................` |

崩溃样本与完成样本的**完整路径长度区间几乎完全重叠**（108–132 vs 109–138），
同一长度下判定却相反。

### R4 结论的准确边界

R4 真正证明的**只有**：

> 对选定的 7 个 segment，在追加 0–23 个 ASCII padding 字符、完整路径长度约 108–138
> 的实验范围内，未观察到判定翻转。

它**没有**证明下列任何一条，以下均为**未证实**：

- 任意路径长度均无关；
- segment 自身长度无关（R4 固定 segment，未变动它）；
- UTF-8 字节边界无关；
- 260 字符附近无边界效应（该区间**未测**，且已知 >260 会产生另一类可捕获错误）；
- 其他目录层级与路径形态下无长度效应；
- 「内容是唯一因素」。

因此本轮的稳妥表述是：

```
在 R4 覆盖的 padding 方式与长度区间内，总路径长度不是已观察到的判别器；
尚未建立可泛化的内容判定规则。
```

R4 支持的是「**不要按长度猜**」，**不支持**「未来一定可以按内容精准分类」。
§6 的现状是：内容谓词同样没有收敛。

## 6. 被证伪的候选规则

每一条都曾看似成立，都有反例：

| 候选规则 | 反例 | 结论 |
|---|---|---|
| 按脚本类别（中文可放行） | `虜-golf`、`龘齉爩-项目`、`𠀋𠮷-项目` 均为中文范围且崩溃 | **证伪** |
| 按首段脚本（中文/ASCII 打头可放行） | `中文語-中文語` 全汉字仍崩 | **证伪** |
| 按 segment 字节长度 | 崩 8–26 字节 / 完成 7–25 字节，区间重叠 | **证伪** |
| 按总路径长度 | R4：判定在所测 24 档长度上不翻转 | **在 R4 覆盖区间内不成立**（非全域证伪，见 §5） |
| 按 CP936 可往返性 | `虜`/`龘`/`齉`/`爩` 往返正常却崩溃 | **证伪** |
| 按 GBK 尾字节落入 ASCII 区 | `體`（`0xF3 0x77`，尾字节 `w`）完成 | **证伪** |
| 按分隔符字符集 | `-` 在 `日本語-한국어` 崩、在 `中文-项目` 完成 | **单独不成立** |
| 「纯中文实测通过即放行」 | 同上三个中文崩溃样本 | **证伪**（原证据已预先警告） |

> 原证据判定「触发规则未能收敛」。本轮扩大到 135 个样本后，该判定**依然成立**，
> 并且新增了中文范围内的反例。任何试图用简单谓词收敛触发条件的方案都应视为不安全。

## 7. 已证实事实

1. 故障在 `@zvec/zvec` **0.6.0** 上于本机确定性复现；原始 9 样本 9/9 一致。
2. 崩溃点是 **`insertSync`**；`create`/`open` 与 index 构建均成功返回。
3. 故障是 **`0xC0000409` 原生 fail-fast**，JS 层从不获得控制权 —— `try/catch` 无效，
   **不存在进程内降级的可能**。
4. 在**已测的两个路径位置**（项目根名 / collection 目录名）之间，位置变化未改变判定。
   其他层级未测，**不可**读作「与位置无关」。
5. 在 **R4 覆盖的 padding 方式与长度区间**（108–138）内，总路径长度不是已观察到的判别器。
   **不可**读作「与长度无关」（§5 已列出六项未证实项）。
6. 本轮全部**纯 ASCII** 样本（R1/R2/R3 合计）判定均为 `COMPLETED_NO_FAILFAST`，**零崩溃**。
   这是**有界观测**，不是安全证明（§8）。
7. 超长路径（>260 字符）产生的是**可捕获的 JS 异常**
   （`create collection path failed: ...`），属正常错误路径，**不是** fail-fast。

## 8. 未证实边界（不得据此放行）

- **根因未定位**。CP936 与 GBK 尾字节两条机制假设均被反例证伪；本轮**不主张**任何根因。
- **未跨环境验证**：单机、单 OS 版本、单 locale（zh-CN）、单 Node（22.22.2）、单 zvec（0.6.0）。
  非 zh-CN locale、其他 Windows 版本、其他 Node 与 0.5.0 上的行为**本轮未测**。
  （0.5.0 的同源行为由前序证据 §8 记载，本轮未重测。）
- **ASCII 是有界观察，不是安全证明**。它覆盖的只是本轮列出的样本形态；它**不是**上游合同，
  上游未承诺任何路径字符集保证。特别地，本轮 ASCII 样本**全部**是
  「本地盘符绝对路径 + 全新 create + 无 reparse 祖先」这一单一形态；
  device namespace（`\\.\`）、NT namespace（`\??\`）、尾随空格或点、
  保留设备名（`CON`/`NUL`/`AUX` 等）、alternate data stream、非规范化路径、
  ASCII 表面但 target 为非 ASCII 的 junction/symlink 等形态**均未测**。
- **R4 的长度结论有六项未证实项**（见 §5），不得读作长度维度已被全域排除。
- **未测**：UNC 路径、`\\?\` 长路径前缀、网络驱动器、大小写差异、8.3 短名别名
  （与 parked residual `[attp-win83-canonical-root-identity]` 相邻，本轮不触碰）、
  符号链接/junction、非 NTFS 卷。
- **未测**：已经存在于危险路径上的 collection 被 `ZVecOpen`（非 create）打开后的 `insertSync`
  行为 —— 本轮样本每次都是全新 create。

## 9. 对 containment 合同的输入

证据直接约束设计空间：

1. **进程内 `try/catch` 降级不可能**（事实 3）→ 判定必须发生在
   **加载并进入 zvec native 生命周期之前**，而不仅是「调用 `insertSync` 之前」。
2. **不存在可靠的危险字符谓词**（§6）→ 不得实现字符黑名单；
   **也不得**把「非 ASCII」整体当作唯一危险信号来做精细放行。
3. **唯一有实测支撑的完成类别是纯 ASCII**（事实 6）→ 合同应为
   **supported ASCII profile 放行 / 其余一律 `UNKNOWN` → fail-closed**，而非「危险则拦」。
   注意这是**有界 profile**，不是「任意 ASCII 路径绝对安全」定理。
4. **ASCII 观测亦非证明**（§8）→ profile 需可被上游或后续证据推翻，不得写成永久事实。
5. 崩溃在 `insertSync` 而非 `create` → 仅在 create 处预检**不足以**保护写入路径；
   合同必须覆盖**所有**会到达 native 的入口。
6. **长度维度不可用作判据，内容维度也尚未收敛**（§5/§6）→ 合同不得建立在
   「未来能精准分类内容」的预期上；当前唯一可交付的是**保守 profile + fail-closed**。

### 关于「只要英文和中文就够了」

这一范围收窄**未被证据支持**：R3 在中英文范围内实测出 3 个 `FAIL_FAST` 样本，
其中 `虜-golf` 仅 8 字节。因此**不能**以「目标子仓只用中英文目录名」作为解除
rollout blocker 的依据。ASCII 部分有实测支撑；**中文部分没有**。
