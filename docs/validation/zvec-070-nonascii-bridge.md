# 非 ASCII 路径上的真实 adapter 合同(Step 2C · 桥)

- 议题:`[zvec-win-unicode-containment]` 上游复核的**第四步,也是测量阶段的最后一步**
- 阶段:**Step 2C · 只测不改**;生产代码变更:**零**
- 日期:2026-09-02
- baseline:`main@5ded6fa`
- 被测对象:`memory-index-zvec.js` git blob **`d3ffe05d`**
- 前序:`zvec-070-win-unicode-recheck.md`(触发边界)· `zvec-070-install-matrix.md`(2A)
  · `zvec-070-adapter-contract.md`(2B)

> 两块证据一直并排放着,从未接上:
>
> ```
> 非 ASCII 路径   0.6.0 崩溃;0.7.0 未复现触发集     ——但用的是探针 workload
> ASCII 路径      0.7.0 满足真实 adapter 合同 19/19 ——但用的是 ASCII 路径
> ```
>
> 本轮只回答交叉格:**真实 adapter 合同在非 ASCII collection path 上,0.7.0 是否仍然成立。**
> 不重写 workload —— 同一 adapter、同一 A/B/C 三进程事务、同一冻结的 19 项检查集、
> 同一身份门,唯一变量是 runtime root。

## 1. 结果

```
Step 2C    SATISFIED(有界)—— 矩阵是两格本机,不是原定的两格 CI
```

| cell | node | osRelease | 0.6.0 对照 | 0.7.0 三相 | 19 项 | 装置身份 | 判定 |
|---|---|---|---|---|---|---|---|
| local win11 | v22.22.2 | 10.0.26200 | `FAIL_FAST_REPRODUCED` `0xC0000409` | 3/3 clean | 19/19 · 0 fail | 4/4 MATCH | **SATISFIED** |
| local win11 | v24.18.0 | 10.0.26200 | `FAIL_FAST_REPRODUCED` `0xC0000409` | 3/3 clean | 19/19 · 0 fail | 4/4 MATCH | **SATISFIED** |
| github windows-latest | v22.23.2 | 10.0.26100 | **`completed` exit 0** | 未运行 | — | — | NOT_SATISFIED |
| github windows-latest | v24.19.0 | 10.0.26100 | **`completed` exit 0** | 未运行 | — | — | NOT_SATISFIED |

后两格失败在**对照**上,不在被测对象上。含义见 §3 与 §6。

判定的有界范围:

```
Step 2C — SATISFIED
on local Windows 11 10.0.26200, Node 22.22.2 and Node 24.18.0,
for the pre-registered non-ASCII path shape at colPathLen 149.
```

## 2. 对照是强制的,而且它两次都在起作用

只用 0.7.0 在某条非 ASCII 路径上跑通 19 项,绿色可能只意味着**我挑了一条恰好无害的路径**。
所以同一格里先用 0.6.0 跑同样形状的路径,它**必须死**;它活着,则该路径不是触发路径,
本格证明不了任何东西,判定是 `NOT_SATISFIED` 而不是庆祝。

装置里这条是承重的布尔量,不是散文:

```js
record.control.triggerReproduced = record.control.outcome === REPRODUCED;
if (record.control.triggerReproduced) { /* 只有这时才跑 0.7.0 三相 */ }

verdict = triggerReproduced && versionIs060 && allPhases && seamProven && blobOk
          && checkSetOk && lengthOnTarget && apparatusOk && versionMatchesRequested
```

对照与被测的 root 分别叫 `ctl` 与 `tst`,**长度刻意相同**:本调查已经实测到崩溃点随
路径长度移动,两个 root 长度不等就会把 §3 要消除的混淆重新引进来。binding 是唯一差异。

## 3. 第一次 CI 运行:触发不是 segment 的属性

`3db5c3b` 那次两格全红,红在对照:0.6.0 在非 ASCII 路径上正常完成。

差一点就要把它读成「0.6.0 也不崩了」。核对已合并证据后,它其实说的是别的:

```
corpus,本 segment,root,3/3         colPathLen 149    FAIL_FAST(schema_built)
全部 66 次崩溃                       colPathLen 135..156
整个语料的采集区间                    colPathLen 135..160
第一次 CI 运行                       colPathLen  76    completed
本机首跑                             colPathLen 161    process-death
```

76 落在**触发集从未被测量过的长度之外**。而 `zvec-070-win-unicode-recheck.md` §1.1 已经
实测过「路径前缀一变,崩溃点就移动」——那正是它当初必须重做实验的原因。

所以这是**装置缺陷**:桥把触发当成 segment 的属性,而入库证据记录的是
**segment 在某个已测长度上**;长度被交给了「host 恰好把 root 放在哪」,
CI 的 checkout 根很短,本机很长。§1.1 消除过的混淆,从另一扇门回来了。

修法用的是**合并前就已登记的数字**,不是看到结果后调出来的:目标 `colPathLen = 149`,
出处写进工件(`control-0.6.0-R2.json :: o2-kana-hangul-dash :: FAIL_FAST 3/3`),
由**前缀 padding** 达成 —— 即 §1.1 指认的同一个变量 —— 对照与被测同样处理。
base 长到够不着目标就在测量开始前 `exit 2`,而不是带着区间外的长度往下跑。

工件保留在 `fixtures/zvec-070-adapter-contract/results-out-of-regime/`,注明它
**不构成**「0.6.0 不崩」的证据,也不与既有证据冲突。

## 4. 三道门,每一道都能单独否决

「记录了但不判定」是本工作线反复踩到的形状。本轮有三个新增或修正的判据,
**全部进 verdict**,并各自带负控。

### 4.1 `lengthOnTarget` —— 达成的长度必须是门

它立刻抓到一个真缺陷:我手算分隔符,padding 算成了 **150**。那次运行
19/19 全绿、三相 clean、seam/blob 全对,**判定仍是 `NOT_SATISFIED`**,
只因 `lengthOnTarget: false`。若长度只是记录字段,这次会作为成功入库。

padding 因此改为**由构造推导**:用一个字符的 pad 量出实际长度,再补差额,
每多一个字符恰好加一。不再手数分隔符。

### 4.2 对照的结论来自共享词汇表 —— 但输入必须由 caller 自己映射

桥的第一版自己发明了 verdict:

```js
triggerReproduced = outcome === 'process-death' || outcome === 'timeout';   // 作废
```

而 Step 1 的分类器早就冻结了相反的语义:

```js
if (run.timedOut) return 'INCONCLUSIVE';
```

**超时是观察的缺席,不是死亡的观察。** 一个挂死的 0.6.0 会被当作「触发复现」,
subject 随后开跑,并可能在一个从未证明过会崩的格子上拿到 `SATISFIED`。

修法不是就地改一个布尔量,而是**真共享上游的词汇表**:分类器抽到
`fixtures/shared/fail-fast-classifier.js`,Step 1 的 `probe-runner.js` 与本桥
共同 import。抽取行为不变,已用两种方式证明:

```
96 组穷举合成输入                     与抽取前实现不一致 0
726 条已入库真实运行记录回算            与当时记录的 verdict 不一致 0
```

(726 条来自 `results-0.7.0-probe/` 四份工件的全部 `runs`。)

**但共享词汇表不等于共享子进程传输协议 —— 上一轮修完 §4.2 后,复审在这里发现了第二个缺陷。**

分类器共享之后,桥仍然按 Step 1 的方式去**读** `jsError`:

```js
const jsError = String(res.stderr || '').includes('"jsError":true');   // 作废
```

那是 `probe-child.js` 的协议。桥的子进程是 `adapter-txn.js`,它的 JS-error 通道是
**证据文件里的 `error` 字段**,写完再 exit 1,从不往 stderr 写那个标记。于是每一个
**可捕获**的 0.6.0 失败(锁错误、缺原生绑定、0.6.0 没有的 API 形状)都会以
「status 1、无 jsError」的形状到达分类器 —— 而分类器对这个形状的正确答案正是
`FAIL_FAST_REPRODUCED`。

```
0.6.0 抛普通异常 → ev.error,exit 1 → jsError=false → 触发「已复现」→ subject 获准运行
```

修法是让 caller 负起映射自己观察的责任,而不是再动分类器(分类器是对的):

```js
const jsError = Boolean(ev && ev.error);
```

并把**分类器的输入对象本身**写进 record(`control.classifierInput` / `control.error`)。
旧 record 只有结论、没有输入,所以这个错误映射在**读结果**时不可见 ——
它是靠读装置发现的,而不是靠读证据。两份权威 record 现在都能自证输入形状:

```json
"classifierInput": { "timedOut": false, "jsError": false,
                     "status": 3221226505, "signal": null, "completed": false }
```

`adapter-txn.js` 有三个终止态,上述映射覆盖两个。第三个 ——「跑到结尾但 `allPassed:false`,
同样 exit 1」—— 对**对照**不可达,因为对照只跑 phase A,而 phase A 的两项检查断言的是
`upsert` 返回的 id,该 id 来自 adapter 自己的文件计数器 `_nextId()`,不来自 zvec。
这条边界写进了 `bridge-runner.js` 的注释:**给对照加相,这条映射就必须重看。**
共享的是分类词汇表,不共享的是传输协议 —— 每个 caller 都要自己把观察映射成
`timedOut / jsError / status / signal / completed`。

### 4.3 `apparatusOk` —— 产生证据的装置是谁

2B 的权威来自 CI:`run 33609869877 @ 785e429`,「哪一版 harness 产生了这个结果」
由 Actions run 自带。本轮的正向结果来自本机,没有这条链;而 commit 里
「装置与结果 JSON 同时出现」只能证明**它们现在被放在一起**。

这不是洁癖:本条工作线上真实存在过三个装置版本(`colPathLen 76` / 手算 150 /
最终 149)。所以 record 自己在运行时计算四个文件的 git blob 并严格 `=== true` 判定:

```json
"apparatus": {
  "bridge-runner.js":                  { "blob": "207aff34…", "matches": true },
  "adapter-txn.js":                    { "blob": "2a7f6e37…", "matches": true },
  "expected-checks.js":                { "blob": "e14c4f95…", "matches": true },
  "../shared/fail-fast-classifier.js": { "blob": "1ed11be7…", "matches": true }
}
```

四个期望值经 CLI 传入并 fail-closed(缺一个或非 40-hex 即 `exit 2`),因此
「被测对象是谁 / 依赖版本是谁 / 产生证据的装置是谁」三者同级可证,最后一环
不再是作者声明。读者可对树内文件跑 `git hash-object` 直接比对。

**runner 哈希的是自己(`__filename`),不是固定文件名。** 按名取哈希会让一个
改名后的修改副本去哈希原版而蒙混过关 —— 这个洞是被下面的负控 3 当场暴露的。

### 4.4 五个负控,红点都落在该守护的断言上

```
省略 --expect-classifier            测量开始前 exit 2
apparatus blob 合法但错误            对照复现、3/3、19/19、seam/blob/length 全绿
                                    → 仅 apparatusOk=false → NOT_SATISFIED
runner 副本 timeout=1ms             control INCONCLUSIVE → triggerReproduced=false
                                    → subject 一相未跑 → NOT_SATISFIED
改名副本 + 原版 blob                 phases 3、checks 19 全绿
                                    → apparatusOk=false → NOT_SATISFIED
对照抛普通可捕获异常                  control NORMAL_JS_ERROR → triggerReproduced=false
(stub control entry)                → subject 一相未跑 → NOT_SATISFIED,apparatusOk=true
```

第二与第四条是「X 能单独让 SATISFIED 不可能」的直接演示:除该项外全部为真,判定仍是红。

第五条是 §4.2 后半那个缺陷的负控,注入在**集成层**而不是分类器上 —— 只 unit-test
`classifyNativeOutcome()` 证明不了任何东西,因为分类器本来就是对的,错的是喂给它的映射。
注入点是一个 require 即抛的 stub `--control-entry`,其余参数与权威运行完全相同。
它带**突变对照**:同一个注入打在修复前的装置上(`51e0843` 的逐字副本、四个 blob 因此
仍然 4/4 MATCH),得到

```
control FAIL_FAST_REPRODUCED → 三相全跑 → 19/19 → SATISFIED,runner exit 0
```

也就是说,一个**只是抛了普通异常、从未崩溃**的对照,在修复前足以产出 Step 2C 的正向结论。
两份 record 都入库在 `results-negative-control/`,并各自记了 `apparatusOk: true`:
红不是被身份门顺手打红的。存根打中与否也有独立证据 —— `fixed` 一侧
`control.error.message` 就是注入的标记串,`pre-fix` 一侧该字段还不存在(这正是缺陷不可见的
原因之一),因此改从子进程自己的 `phase-A.json` 核对同一条 message。

## 5. 桥实际证明了什么

```
在 colPathLen 149、segment 日本語-한국어(该长度上 0.6.0 三次全部不可捕获崩溃)的
非 ASCII collection path 上,@zvec/zvec@0.7.0 满足 memory-index-zvec.js@d3ffe05d
实际消费的 Node API、返回值形状与跨进程持久化合同,node 22 与 node 24 各一次,
19/19,零失败。
```

同一格内、同一路径形状、同一长度上的 0.6.0 死亡,是这句话里「非 ASCII」三个字的全部分量。

三相与 2B 完全一致,不是另写的 workload:

```
A  initialize · upsert×2 · close(触发 optimizeSync)                          2 检查
B  reopen · fts · colon fallback · scope 双向 · list · stats · delete · close  14 检查
C  reopen · 删除仍生效 · 幸存者仍可查 · close                                    3 检查
```

## 6. 第二次 CI 运行:该镜像不能承载这个实验

长度精确控制到 149、两格一致之后,0.6.0 在 GitHub 镜像上**仍然正常完成**。
这一次不是装置问题。

```
                      osRelease     node              ACP     0.6.0 @ colPathLen 149
本机 Windows 11       10.0.26200    22.22.2/24.18.0   936     FAIL_FAST 3221226505
GitHub windows-latest 10.0.26100    22.23.2/24.19.0   未测    completed exit 0
```

**目前的证据只支持这一句:两侧 Node major 相同且 patch 接近,因此没有证据把差异归因于
Node major。** 当前证据**不足以排除** Node patch、runner 镜像、OS build、
locale / ACP、CRT / native runtime,或其他尚未隔离的环境变量。ACP 936 是**本机的观察**,
CI 侧未测,**不主张任何因果**——隔离这些维度属于 native mechanism,本轮授权明确排除。

结论只到这里:**GitHub 的 windows-latest 镜像当前不能承载这个实验。** 桥因此建在
对照确实复现的那台主机上,矩阵是两格本机 node22 / node24,而不是原定的两格 CI。
这是对既定矩阵的**缩减**,写在这里而不是隐去。

workflow 保留但改为只手动触发:只能一直红的 job 是噪音,而删掉它会丢掉一个
在 runner 镜像变化时值得重跑的探针。

## 7. 它**不**授权什么

```
!= 升 pin
!= 进 RUNTIME_DEPENDENCIES
!= optional → mandatory
!= 默认翻转
!= 放松 containment
!= 任何发布决定
```

**containment 尤其不因本轮而变弱,而且本轮给了一条新的、独立的理由。** 2B 的理由是
崩溃点位置都预测不了(57 次落在 create/open、9 次落在 insert)。本轮的理由是:

> **这个故障的可观测性依赖于尚未被隔离的环境维度。**

在一台标准 Windows CI 镜像上它根本不复现 —— 也就是说,即便当初有人把 CI 全绿
当作安全证据,那份绿色也从来不携带信息。连「能否观察到」都还没被隔离的故障类别,
不是可以停止防守的故障类别。

未覆盖,且本轮明确不覆盖:其他 locale、其他 Windows 版本与镜像、并发多进程写入、
超过 `MAX_ENUM`(1000)的集合规模、穷举 Unicode、以及这个 native failure class 的机制
与它的环境依赖维度。

## 8. 工件

```
workflow   .github/workflows/zvec-070-nonascii-bridge.yml   (workflow_dispatch only)
apparatus  docs/validation/fixtures/zvec-070-adapter-contract/
             bridge-runner.js       207aff345fedf76b018722aa963c311c879cb087
             adapter-txn.js         2a7f6e373c94cc5f2430e6f26cf0425892c0c2f1
             expected-checks.js     e14c4f95e747589a50bb0654e6e9b3c45ec8e0c6
           docs/validation/fixtures/shared/
             fail-fast-classifier.js 1ed11be7a532900babe4478701b5a706875f8617

results-bridge/                       SHA-256                    ← 本轮权威
  local-win11-node22.json   699a07fb43112680b275c5d364b9b9589dfdd2436d354262e9ec44fc863b1143
  local-win11-node24.json   2e6c4385c57e89c99a67d64abb9a1a3b44ee5931e4a5dfb2338a8feff7454854

results-negative-control/             §4.2 后半那个缺陷的负控 + 突变对照(§4.4 第五条)
  ordinary-js-error-fixed.json    NORMAL_JS_ERROR · 0 相 · NOT_SATISFIED
  ordinary-js-error-pre-fix.json  ⚠️ SATISFIED —— 缺陷演示,不是正向证据

results-out-of-regime/    run 33611916358 @ 3db5c3b   区间外测量,非权威(§3)
results-ci-image/         run 33612887037 @ 75a68aa   区间内、该镜像不复现(§6)
```

上面四个 apparatus blob 与两份权威 record 里 `apparatus` 字段记录的值相同,
可用 `git hash-object` 对树内文件直接核对。

每份 record 含逐相的 `status / exitCode / signal / timedOut / collectionPathLen /
checks / checkSet / seam / adapterBlob`,以及对照的
`outcome / exitCode / collectionPathLen / triggerReproduced`,因此 §1 的每一格
都可由工件独立重建,不依赖本文档作者的转录。

两份归档目录里的 record 产生于本轮修正之前,`control.outcome` 用的是桥自己的旧词
(`completed` / `process-death`),不是 §4.2 之后的共享词汇表;它们的地位是诊断数据,
不是权威。

`expected-checks.js` 是本轮新增的共享冻结集:2B 的 runner 与本桥都从它 import。
两份冻结集就是两份会漂移的集合,而且漂移不可见 —— 各自都会把自己的内容报告为完整。
推送前逐相比对过,与已合入的 2B 证据里记录的检查名**逐字相同**(A 2 / B 14 / C 3)。

## 9. 测量阶段到此结束

Step 1(触发边界)· 2A(安装 / 加载 / 原生 smoke)· 2B(真实 adapter 合同)· 2C(非 ASCII 桥)
四步全部完成。下一步不是继续测,而是把 0.6→0.7 的升级论证写成决策记录,
对 pin / `RUNTIME_DEPENDENCIES` / optional→mandatory / 默认翻转 / containment /
发布**分别**裁定。
