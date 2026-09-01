# zvec 0.7.0 — Windows 非 ASCII 路径触发边界复测

- 议题：`[zvec-win-unicode-containment]` 的**上游状态复核**
- 阶段：**步骤一 · 只测不改**；生产代码变更：**零**
- 日期：2026-09-01
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

## 1. 方法

**复用既有夹具，不另写探针。** `docs/validation/fixtures/zvec-win-unicode/` 的 runner、
corpus、判定逻辑、样本位置（leaf / parent）、重复次数全部沿用，**唯一变量是 binding 版本**。
两条不得放宽的方法学约束原样保留：

- binding 由父进程 `require.resolve` 一次性解析、经 `argv` 绝对注入；子进程从不裸 require。
  子进程把**实际加载的路径**写进 `child_start`，使版本身份成为可核对的事实。
- 阶段标记用 `fs.writeSync`（进程被 OS 终止时缓冲区不会 flush）。

0.7.0 装在隔离目录 `.evo-lite/generated/zvec070-probe/`（gitignored），夹具副本放在同目录，
使该处的 `require.resolve('@zvec/zvec')` 命中 0.7.0 而非仓库钉死的 0.6.0。

```
node        v22.22.2 / win32 / x64
os          Windows NT 10.0.26200
control     @zvec/zvec 0.6.0   仓库 node_modules（package.json optionalDependencies pin）
test        @zvec/zvec 0.7.0   .evo-lite/generated/zvec070-probe/node_modules
rounds      R2（42 样本）+ R3（79 样本）× 2 位置 × 3 轮
```

## 2. 结果

```
                     0.6.0（对照）        0.7.0（实验）
R2  42 样本      19 FAIL_FAST / 23 完成    0 / 42
R3  79 样本       3 FAIL_FAST / 76 完成    0 / 79
合计 121 样本    22 次不可捕获崩溃          0
UNSTABLE                                   0
回归（完成 → 崩溃）                         0
```

### 2.1 夹具在今天仍然有效（前提，不是脚注）

0.6.0 重跑 R2 得 **19 / 23**，`mismatches vs original evidence: 0`，与 2026-07-31 原始采集
**逐样本一致**。没有这一步，0.7.0 的任何「全绿」都可能只是测量装置失效。

R3 的三个崩溃样本按**码点**重建后当天单独复测（不依赖字面量输入的编码传输）：

| 样本 | segment 字节 | 0.6.0 | 0.7.0 |
|---|---|---|---|
| `han-compat`（`虜-golf`） | 8 | `FAIL_FAST`，止于 `create_or_open` | `child_done` |
| `han-ext-b`（`𠀋𠮷-项目`） | 15 | `FAIL_FAST`，止于 `create_or_open` | `child_done` |
| `han-rare`（`龘齉爩-项目`） | 16 | `FAIL_FAST`，止于 `create_or_open` | `child_done` |

`虜-golf` 是原矩阵里最锋利的反例：一个汉字 + ASCII、8 字节，比多个完成样本都短。

### 2.2 探针没有退化成「一律完成」

9 个原始证据样本自带对照。0.7.0 上：

```
原本 CRASH 的 5 个  → MISMATCH（现在完成）
原本 OK 的 4 个     → MATCH   （仍然完成，判定语义未变）
```

若 0.7.0 让探针整体失效，这 4 个不会保持原判定。

### 2.3 阶段级，而不是退出码级

同一样本 `o2-kana-hangul-dash`（`日本語-한국어`）、同一路径长度（176）：

```
0.6.0   child_start → binding_loaded → schema_built → create_or_open
        exit 3221226505 (0xC0000409 / STATUS_STACK_BUFFER_OVERRUN)

0.7.0   child_start → binding_loaded → schema_built → create_or_open
        → insert → optimize → query → close → child_done      exit 0
```

0.6.0 死在 `insertSync`，与原矩阵定位一致；0.7.0 走完**完整生产调用链**，不是提前 exit 0。

## 3. 本次**不能**得出的结论

```
不能说   「zvec 在 Windows 上安全了」
         COMPLETED_NO_FAILFAST 按夹具自身措辞纪律 = 本次执行完成，
         不构成安全证明；上游仍无路径安全合同。

未覆盖   R1（14 样本）—— 0.6.0 本就全绿，是盲区不是反证
未覆盖   R4 长度控制实验
未覆盖   其他 Windows 版本 / 非 zh-CN locale / node 24 / Linux / macOS
未覆盖   五平台安装矩阵（本轮只证明 win32 + node 22 装得上）
未覆盖   0.7.0 breaking change（C++ 公共 API 改 snake_case）对 Node 绑定其余面的影响
```

## 4. 结论

```
R2 + R3 的全部已知触发边界，在 0.7.0 上不再复现     OBSERVED
风险性质从「可能杀死进程」变为「五平台是否装得上」   本轮未回答
```

**本文档不授权任何变更。** 升 pin、把 `@zvec/zvec` 纳入 `RUNTIME_DEPENDENCIES`、翻默认、
放松 containment —— 每一项都需要独立授权，且安装矩阵那一关只有 release-gate 能回答。

containment 层的存废也不由本文档决定：它防的是**不可捕获的进程猝死**，而
「本轮 121 个样本未复现」与「该类故障不可能再发生」是两件事。

## 5. 复现

```bash
# 对照（仓库 pin 的 0.6.0）
ZVEC_UNICODE_PROBE=1 node docs/validation/fixtures/zvec-win-unicode/probe-runner.js --round R2 --repeats 3

# 实验（隔离目录内的 0.7.0，夹具副本使 require.resolve 命中它）
cd .evo-lite/generated/zvec070-probe
ZVEC_UNICODE_PROBE=1 node probe-runner.js --round R2 --repeats 3
ZVEC_UNICODE_PROBE=1 node probe-runner.js --round R3 --repeats 3
```

原始逐样本结果**已入库**（与上一份矩阵不同，本轮文件足够小，因此 sha256 可被第三方独立验证）：

```
fixtures/zvec-win-unicode/results-0.7.0-probe/
  control-0.6.0-R2.json   043f577b7dbcf658f41c47061c8b47cd9bb5ef83f733800563a7cdb4ee0bdaf1
  test-0.7.0-R2.json      2c36c7493e5b126dc2eff88be0ff180e660cb109f6a2653f37585589c8af0ae8
  test-0.7.0-R3.json      ae7720057d9840178a5fb8f7466509092b28ecb669ee13c25b569f212f394df0
```

每份文件的 `binding` 字段记录了该轮实际加载的绝对路径，可据此核对版本身份。
