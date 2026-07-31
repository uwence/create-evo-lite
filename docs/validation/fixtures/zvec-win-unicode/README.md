# Evidence fixture — zvec Windows 非 ASCII 路径探针

可复现证据资产，服务于 `docs/validation/zvec-win-unicode-path-matrix.md`
与 `[zvec-win-unicode-containment]`。

> ⚠️ **本 fixture 会故意让子进程崩溃。** 触发路径上，子进程被 OS 以
> `0xC0000409`（`STATUS_STACK_BUFFER_OVERRUN`）终止。这是要采集的观测本身，不是故障。

## 这不是什么

- **不是**生产代码。不在 `templates/`，**未**登记进 `template-manifest.js`，
  不随 scaffold 分发。
- **不是**测试套件的一部分。`npm test` / `EVO_LITE_TEST_SCOPE=all` **不会**执行它。
- **不是**放行依据。它记录观测，不证明任何路径安全。

## 默认不执行

必须显式 opt-in，否则拒绝启动：

```bash
ZVEC_UNICODE_PROBE=1 node docs/validation/fixtures/zvec-win-unicode/probe-runner.js
ZVEC_UNICODE_PROBE=1 node .../probe-runner.js --round R2 --repeats 3
```

不带环境变量运行会以 exit 2 拒绝并说明原因。这道闸门的存在是为了让它
**不可能**被测试扫描或 CI 顺带拾起。

## 文件

| 文件 | 内容 |
|---|---|
| `probe-child.js` | 单样本子进程。复刻生产 schema 与调用链，阶段标记用同步写 |
| `probe-runner.js` | 统一 runner，样本读自 `corpus.json` |
| `corpus.json` | 135 个样本：segment、码点、字节长度、所属轮次、原始证据预期 |
| `results-summary.json` | 四轮逐样本判定 + 每轮元数据 + 原始结果文件 sha256 |

## 两条方法学约束（不得放宽）

**1. binding 必须由父进程绝对注入。**
`probe-runner.js` 执行一次 `require.resolve('@zvec/zvec')`，把绝对路径经 `argv`
下传；`probe-child.js` **从不**裸 `require('@zvec/zvec')`。

裸 require 会从子进程脚本所在目录**向上**解析，可能命中一个与本仓无关的用户级
`node_modules`。`zvec-06` 那轮的首次 readOnly 矩阵正是这样变成了
「0.5-holder × 0.6-prober 混版测量」，同一缺陷也是 release-gate Windows 侧连红八天的根因之一。
子进程会把实际加载的 binding 路径写进 `child_start` 标记，使其成为**可核对的事实**而非假设。

**2. 阶段标记必须用 `fs.writeSync`。**
`console.log` 是缓冲的；进程被 OS 终止时缓冲区不会 flush，恰好会销毁本探针唯一要采集的证据。

## 判定分类

| 判定 | 含义 |
|---|---|
| `COMPLETED_NO_FAILFAST` | 本次执行走完全部阶段、exit 0。**仅此而已 —— 不表示该路径已被证明安全** |
| `FAIL_FAST_REPRODUCED` | 进程异常终止且 JS 层从未获得控制权 |
| `NORMAL_JS_ERROR` | 抛出可捕获的 JS 异常（如超长路径），属正常错误路径 |
| `INCONCLUSIVE` | 超时或无法归类 |
| `UNSTABLE` | 同一样本多轮判定不一致。**不做多数表决平滑** |

`COMPLETED_NO_FAILFAST` 刻意避开「safe/pass」措辞：单次或数次未崩溃**不构成**安全证明。
运行时放行判定用的 `SAFE` 是 spec 中的独立概念，不得与本表混用。

## 原始结果文件

四轮原始 `results*.json`（合计约 400 KB，R3 单文件 254 KB）**未入库**。
`results-summary.json` 保存了逐样本判定与每个原始文件的 sha256。

诚实说明其局限：原始文件不在库内时，该 sha256 **无法被第三方独立验证**，
它只支持本机/本轮的交叉核对。要重新获得可核对的完整结果，用上面的命令重跑
fixture —— corpus 与判定逻辑都在库内，结果应当等价。

`.runs/` 与 `last-run.json` 是运行时产生的临时输出，可随时删除，不应入库。

## 环境（原始采集）

```
node v22.22.2 / win32 / x64
Windows NT 10.0.26200      locale zh-CN
@zvec/zvec 0.6.0
```

跨环境（其他 Windows 版本、非 zh-CN locale、其他 Node、0.5.0）**未验证**。
