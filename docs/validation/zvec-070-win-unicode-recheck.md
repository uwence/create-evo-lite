# zvec 0.7.0 — Windows 非 ASCII 路径触发边界复测

- 议题：`[zvec-win-unicode-containment]` 的**上游状态复核**
- 阶段：**步骤一 · 只测不改**；生产代码变更：**零**
- 日期：2026-09-01 / 修正重测 2026-09-02
- base：`main@962f622`
- 前序证据：`docs/validation/zvec-win-unicode-path-matrix.md`（2026-07-31，@zvec/zvec 0.6.0）

> **本文档只回答一个问题**：0.6.0 上那 22 个不可捕获崩溃样本，在 0.7.0 上是否仍然复现。
> 它**不**回答「zvec 是否可以默认启用」，也**不**构成任何 pin / 默认值 / containment 的变更授权。

## 0. 触发来源

真实使用：`hungersnakegame5` / `hungersnakegame6` 两次部署都出现
`⚠️ memory engine "zvec" selected but @zvec/zvec is unavailable`。追问「为何不默认安装」时，
在树内确认这是**设计如此**（`optionalDependencies` + `children not forced`，见
`docs/superpowers/specs/2026-07-07-memory-engine-default-flip.md`），而不装的理由之一是
Windows 非 ASCII 路径的不可捕获崩溃。

上游 `alibaba/zvec` v0.7.0（2026-08-24）release notes 的 *Build and versioning* 条目写有：

> UTF-8 paths are handled correctly on Windows

这是**一条声明，不是证据**。本仓在同一个包上已经栽过一次（`zvec-06` 那轮「0.5 没有
readOnly」的前提被实测证伪），因此按门槛先测量。

## 1. 方法 —— 以及第一版为什么作废

**复用既有夹具，不另写探针。** runner、corpus、判定逻辑、重复次数全部沿用。两条不得放宽的
方法学约束原样保留：binding 由父进程绝对注入（子进程把**实际加载路径**写进 `child_start`）；
阶段标记用 `fs.writeSync`。

### 1.1 第一版把 runner 搬走了，那不是单变量

初版把夹具**复制到** 0.7.0 所在目录来切换 binding。但 runner 里：

```js
const HERE = __dirname;
const BASE = path.join(HERE, '.runs');     // 每个 collection path 都从这里往下构造
```

搬动 runner ⇒ 同时改变 **binding** 与**被测路径的绝对前缀**。对一个 path-sensitive 的原生
fail-fast，这两者就此不可分离，任何差异都不能单独归因给 binding。初版写的
「the binding version is the only variable」是**过强断言**，已作废。

**这不是理论风险，本轮实测到了它：** 同一样本 `o2-kana-hangul-dash`、同一 binding 0.6.0，

```
BASE 在探针目录   colPathLen 176   lastStage = create_or_open   （死在 insert）
BASE 在夹具目录   colPathLen 149   lastStage = schema_built     （死在 create/open）
```

路径前缀一变，**崩溃点就移动了**。

### 1.2 修法：显式 binding 覆盖，位置不动

给夹具 runner 加 `--binding <abs path>`（仅证据夹具，非生产代码）。两次运行**同一个 runner
文件、同一个 BASE、同一批 collection 路径**，只换 binding：

```
node docs/validation/fixtures/zvec-win-unicode/probe-runner.js \
     --round R2 --repeats 3 --binding <abs path to 0.6.0 | 0.7.0>
```

**绝对路径是 fail-closed 的约束,不是文档里的礼貌要求。** 传相对值 runner 直接
`exit 2` 并拒绝启动 —— 而**不是** `path.resolve()` 把它「修好」后继续跑。后者会悄悄放行
一个已经违反测量契约的调用方,并让 binding 身份重新依赖 cwd 与文件位置,那正是绝对注入
要消除的东西。

对照与实验的 `colPathLen` 区间因此**逐档相同**（R2 135..156，R3 137..160），这是混淆已被
消除的直接证据，写在工件里可核。

### 1.3 位置维度：本轮只跑 `root`

runner 的执行循环是 `runOnce(sample, i, 'root')`。`runOnce` 里存在 `leaf` 分支，但**从未被
调用** —— 自该文件唯一一次入库（`7628fdb`，2026-07-31）起即如此。

因此本文档**不**声称「× 2 位置」。初版曾这样写，那是从前序文档的散文继承的，不是从装置读出的。
前序 `results-summary.json` 记录 `R3 positions=["root","leaf"]`，与该装置不符；**本轮不修改
既有历史文档**，仅在此声明本轮不继承该说法。工件里现在直接记录：

```json
"positionsExercised": ["root"]
```

让读者从**产物**读布局，而不是从任何散文。

```
node        v22.22.2 / win32 / x64
os          Windows NT 10.0.26200
control     @zvec/zvec 0.6.0   仓库 node_modules（package.json optionalDependencies pin）
test        @zvec/zvec 0.7.0   .evo-lite/generated/zvec070-probe/node_modules（gitignored）
rounds      R2（42 样本）+ R3（79 样本）× 3 轮 × 位置 root
```

## 2. 结果（四组，同一 runner 位置）

```
                     0.6.0（对照）        0.7.0（实验）
R2  42 样本      19 FAIL_FAST / 23 完成    0 / 42
R3  79 样本       3 FAIL_FAST / 76 完成    0 / 79
合计 121 样本    22 次不可捕获崩溃          0
UNSTABLE                                   0
回归（完成 → 崩溃）                         0
```

逐样本：22 个崩溃样本 **22/22** 翻转为完成，零回归。

### 2.1 对照在今天仍然复现

0.6.0 的 R2 得 **19 / 23**、R3 得 **3 / 76**，与 2026-07-31 原始采集的分布一致，
R2 `mismatches vs original evidence: 0`。没有这一步，0.7.0 的任何「全绿」都可能只是
测量装置失效。

R3 的三个崩溃样本（原矩阵中最锋利的一组）：

| 样本 | segment 字节 | colPathLen | 0.6.0 | 0.7.0 |
|---|---|---|---|---|
| `han-compat`（`虜-golf`） | 8 | 139 | `FAIL_FAST` | `child_done` |
| `han-ext-b`（`𠀋𠮷-项目`） | 15 | 139 | `FAIL_FAST` | `child_done` |
| `han-rare`（`龘齉爩-项目`） | 16 | 137 | `FAIL_FAST` | `child_done` |

`虜-golf` 是一个汉字 + ASCII、8 字节，比多个完成样本都短。

### 2.2 探针没有退化成「一律完成」

9 个原始证据样本自带对照。0.7.0 上原本 CRASH 的 5 个变 `MISMATCH`（现在完成），
原本 OK 的 4 个保持 `MATCH`。若 0.7.0 让探针整体失效，这 4 个不会保持原判定。

### 2.3 阶段级证据（现已入库，可独立重建）

同一样本、**同一 `colPathLen`**：

```
o1-han-kana-hangul-dash   colPathLen 156
  0.6.0  child_start > binding_loaded > schema_built            exit 3221226505
  0.7.0  ... > create_or_open > insert > optimize > query > close > child_done   exit 0

han-rare                  colPathLen 137
  0.6.0  child_start > binding_loaded > schema_built > create_or_open   exit 3221226505
  0.7.0  ... > insert > optimize > query > close > child_done           exit 0
```

### 2.4 崩溃阶段与前序文档不一致（记录，不修改历史）

本轮 0.6.0 的 66 次崩溃运行，最后成功阶段分布为：

```
schema_built      57    → 死在 create/open 之中
create_or_open     9    → 死在 insertSync 之中
```

前序矩阵写的是「最后一个成功阶段标记**恒为** `create_or_open` → 崩溃发生在 `insertSync`」。
本轮不成立。结合 §1.1 中 `o2` 随路径前缀改变崩溃点的观察，合理的读法是：
**崩溃点本身随样本与路径布局变化，并非固定在某一次调用上。**

这也意味着：不要把「崩溃发生在 insertSync」当成已确立的机制事实。本文档不修改前序文档，
只登记这处不一致。

## 3. 本次**不能**得出的结论

```
不能说   「zvec 在 Windows 上安全了」
         COMPLETED_NO_FAILFAST 按夹具自身措辞纪律 = 本次执行完成，
         不构成安全证明；上游仍无路径安全合同。

不能说   「全部已知触发边界」
         准确表述：在本轮 runner 实际覆盖的 path layout（位置 root、
         colPathLen 135..160）下，R2+R3 共 121 个 corpus 样本
         均未在 0.7.0 复现 fail-fast。

未覆盖   R1（14 样本）—— 0.6.0 本就全绿，是盲区不是反证
未覆盖   R4 长度控制实验；leaf 位置（装置从未执行过）
未覆盖   其他 Windows 版本 / 非 zh-CN locale / node 24 / Linux / macOS
未覆盖   五平台安装矩阵（本轮只证明 win32 + node 22 装得上）
未覆盖   0.7.0 breaking change（C++ 公共 API 改 snake_case）对 Node 绑定其余面的影响
```

## 4. 结论

```
在 §3 限定的范围内，R2 + R3 的 121 个样本在 0.7.0 上不再复现 fail-fast   OBSERVED
风险性质从「可能杀死进程」变为「五平台是否装得上」                        本轮未回答
```

**本文档不授权任何变更。** 升 pin、把 `@zvec/zvec` 纳入 `RUNTIME_DEPENDENCIES`、翻默认、
放松 containment —— 每一项都需要独立授权，且安装矩阵那一关只有 release-gate 能回答。

containment 层的存废也不由本文档决定：它防的是**不可捕获的进程猝死**，而
「本轮 121 个样本未复现」与「该类故障不可能再发生」是两件事。§2.4 的不一致进一步说明
该故障的机制尚未被理解到可以据此放松防护。

## 5. 复现

```bash
B060=<abs path to 0.6.0 @zvec/zvec entry>
B070=<abs path to 0.7.0 @zvec/zvec entry>
R=docs/validation/fixtures/zvec-win-unicode/probe-runner.js

for round in R2 R3; do
  for b in "$B060" "$B070"; do
    ZVEC_UNICODE_PROBE=1 node "$R" --round "$round" --repeats 3 --binding "$b"
    # 每轮结束后复制 last-run.json，它会被下一轮覆盖
  done
done
```

原始逐样本结果**已入库**，含每次运行的 `status / signal / stages / lastStage / colPathLen`，
因此 §2.3 与 §2.4 可由工件独立重建，不依赖本文档作者的转录：

```
fixtures/zvec-win-unicode/results-0.7.0-probe/
  control-0.6.0-R2.json    66 KB
  control-0.6.0-R3.json   138 KB
  test-0.7.0-R2.json       74 KB
  test-0.7.0-R3.json      139 KB
```

合计约 417 KB。前序矩阵因原始文件过大（R3 单文件 254 KB）未入库，只留了无法被第三方验证的
sha256；本轮文件保留逐次运行细节后仍在可入库范围内，故直接入库。每份文件的 `binding`、
`base`、`positionsExercised` 字段记录了该轮的实际装置状态，可据此核对。
