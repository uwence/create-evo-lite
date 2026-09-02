# 负控:普通 JS 异常不得被读成原生 fail-fast

> ⚠️ 本目录里的 `ordinary-js-error-pre-fix.json` **verdict 是 `SATISFIED`,而它恰恰是一个缺陷的展示**,
> 不是任何关于 zvec 的正向证据。它是修复前的装置在一个**从未崩溃过**的对照上给出的错误结论。
> 权威结果在 `../results-bridge/`。

## 缺陷

共享分类器(`../../shared/fail-fast-classifier.js`)本身是对的,桥喂给它的 `jsError` 是错的。

`"jsError":true` 写在 stderr 上,是 Step 1 的 `probe-child.js` 的协议。桥的子进程是
`adapter-txn.js`,它的 JS-error 通道是**证据文件里的 `error` 字段**,写完再 exit 1,
从不往 stderr 写那个标记。于是:

```
0.6.0 抛出一个普通的、可捕获的异常
  → adapter-txn 捕获,写 ev.error,exit 1
  → 桥读 stderr:jsError = false
  → 分类器 status !== 0 && !jsError → FAIL_FAST_REPRODUCED
  → triggerReproduced = true → 0.7.0 subject 获准运行
```

**共享的是分类词汇表,不是子进程传输协议。** 每个 caller 仍然要把自己的观察映射成
`timedOut / jsError / status / signal / completed`,这一步是漏掉的地方。

## 注入方式(集成层,不是 unit test)

不能只测 `classifyNativeOutcome()` —— 它本来就是对的。被测的是**桥 → 分类器的映射**。
所以注入点在 `--control-entry`:一个 require 即抛的 stub 模块。

```js
// <stub>/src/index.js
'use strict';
throw new Error("NEGATIVE-CONTROL-ORDINARY-JS-ERROR");

// <stub>/package.json —— 让 versionIs060 为真,红点才不会落在版本门上
{"name":"@zvec/zvec","version":"0.6.0"}
```

真实 adapter 的惰性 `require('@zvec/zvec')` 被 `adapter-txn.js` 的 seam 重定向到该 stub,
异常从 `loadZvec()` 抛出、被子进程 catch、写进 `ev.error`。除 `--control-entry` 外,
其余参数与权威运行完全一致(同一 adapter、同一 0.7.0 entry、同一四个装置期望值)。

## 结果

同一个注入,分别打在修复后与修复前的装置上:

| | `control.outcome` | `triggerReproduced` | subject 相数 | `apparatusOk` | verdict |
|---|---|---|---|---|---|
| **fixed**(树内 `bridge-runner.js`) | `NORMAL_JS_ERROR` | `false` | **0** | `true` | `NOT_SATISFIED` |
| **pre-fix**(HEAD 51e0843 的逐字副本) | `FAIL_FAST_REPRODUCED` | `true` | **3** | `true` | **`SATISFIED`** |

两条都记了 `apparatusOk: true`:红**不是**被身份门顺手打红的,而是落在被守护的那条断言上。

**存根确实打中了**,不是打空后走正常成功路径:

```
fixed    control.error.message == "NEGATIVE-CONTROL-ORDINARY-JS-ERROR"
pre-fix  修复前的 record 没有 control.error 字段(这正是缺陷不可见的原因之一),
         因此改从子进程自己的 phase-A.json 证据文件核对同一条 message
```

`pre-fix` 那一行是完整的假阳性演示:一个**只是抛了普通异常**的 0.6.0 对照,
让 0.7.0 跑满三相 19 项、`lengthOnTarget` / `seamProven` / `blobOk` 全绿,
最终产出 `SATISFIED`、runner exit 0。Step 2C 最核心的前提(「对照必须真的死」)被绕过。

## 修法

```js
const jsError = Boolean(ev && ev.error);
```

并把分类器的**输入对象**一起写进 record(`control.classifierInput` / `control.error`):
旧 record 只有结论没有输入,所以这个错误映射在**读结果**时是不可见的,只能靠读装置发现。

`adapter-txn.js` 有三个终止态,上述映射覆盖两个。第三个 ——「跑到结尾但
`allPassed:false`,同样 exit 1」—— 对**对照**不可达:对照只跑 phase A,而 phase A 的两项
检查断言的是 `upsert` 返回的 id,该 id 来自 adapter 自己的文件计数器 `_nextId()`,
不来自 zvec。若将来给对照加相,这条映射必须重看。边界写在 `bridge-runner.js` 注释里。

## 重建

修复后的那一格可直接重跑:参数同 `.github/workflows/zvec-070-nonascii-bridge.yml`,
只把 `--control-entry` 换成上面的 stub、`--expect-bridge-runner` 换成当前树内 blob。
修复前的那一格需要把 `51e0843` 的四个装置文件按原相对布局
(`zvec-070-adapter-contract/` + `../shared/`)取出后运行,期望值用该 commit 的四个 blob。
