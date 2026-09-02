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
Step 2C    SATISFIED —— 但矩阵不是原定的两格 CI,而是两格本机
```

| cell | node | osRelease | 0.6.0 对照 | 0.7.0 三相 | 19 项 | 判定 |
|---|---|---|---|---|---|---|
| local win11 | v22.22.2 | 10.0.26200 | `process-death` `0xC0000409` | 3/3 clean | 19/19 · 0 fail | **SATISFIED** |
| local win11 | v24.18.0 | 10.0.26200 | `process-death` `0xC0000409` | 3/3 clean | 19/19 · 0 fail | **SATISFIED** |
| github windows-latest | v22.23.2 | 10.0.26100 | **`completed` exit 0** | 未运行 | — | NOT_SATISFIED |
| github windows-latest | v24.19.0 | 10.0.26100 | **`completed` exit 0** | 未运行 | — | NOT_SATISFIED |

后两格失败在**对照**上,不在被测对象上。含义见 §3 与 §5。

## 2. 对照是强制的,而且它两次都在起作用

只用 0.7.0 在某条非 ASCII 路径上跑通 19 项,绿色可能只意味着**我挑了一条恰好无害的路径**。
所以同一格里先用 0.6.0 跑同样形状的路径,它**必须死**;它活着,则该路径不是触发路径,
本格证明不了任何东西,判定是 `NOT_SATISFIED` 而不是庆祝。

装置里这条是承重的布尔量,不是散文:

```js
record.control.triggerReproduced = outcome === 'process-death' || outcome === 'timeout';
if (record.control.triggerReproduced) { /* 只有这时才跑 0.7.0 三相 */ }
verdict = triggerReproduced && versionIs060 && allPhases && seamProven
          && blobOk && checkSetOk && lengthOnTarget && versionMatchesRequested
```

对照与被测的 root 分别叫 `ctl` 与 `tst`,**长度刻意相同**:本调查已经实测到崩溃点随
路径长度移动,两个 root 长度不等就会把 §3 要消除的混淆重新引进来。binding 是唯一差异。

它两次拦下了会被当成成功的东西,见 §3 与 §4。

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

## 4. 达成的长度必须是门,不是记录下来的数

「记录了但不判定」是本工作线已经踩过三次的形状(`versionMatchesRequested` 只被记录、
`positionsExercised` 只写在散文里、phase `passed` 只听子进程自述)。所以 `lengthOnTarget`
直接进 verdict。

它立刻抓到了一个真缺陷:我手算分隔符,padding 算成了 **150**。那次运行
19/19 全绿、三相 clean、seam/blob 全对,**判定仍然是 `NOT_SATISFIED`**,
只因为 `lengthOnTarget: false`。若长度只是记录字段,这次会作为成功入库。

padding 因此改为**由构造推导**:用一个字符的 pad 量出实际长度,再补差额,
每多一个字符恰好加一。不再手数分隔符。

## 5. 第二次 CI 运行:该镜像不是触发平台

长度精确控制到 149、两格一致之后,0.6.0 在 GitHub 镜像上**仍然正常完成**。
这一次不是装置问题。

```
                      osRelease     ACP     0.6.0 @ colPathLen 149
本机 Windows 11       10.0.26200    936     process-death 3221226505
GitHub windows-latest 10.0.26100    未测    completed exit 0
```

node 版本几乎相同(22.23.2 / 24.19.0 对 22.22.2 / 24.18.0),差异不在 node。
ACP 936 是**本机的观察**,CI 侧未测;**本轮不主张任何因果关系** —— 诊断这个差异属于
native mechanism,本轮授权明确排除。

结论只到这里:**GitHub 的 windows-latest 镜像不能承载这个实验。** 桥因此建在
对照确实复现的那台主机上,矩阵是两格本机 node22 / node24,而不是原定的两格 CI。
这是对既定矩阵的**缩减**,写在这里而不是隐去。

workflow 保留但改为只手动触发:只能一直红的 job 是噪音,而删掉它会丢掉一个
在 runner 镜像变化时值得重跑的探针。

## 6. 这一格实际证明了什么

```
在 colPathLen 149、segment 日本語-한국어(该长度上 0.6.0 三次全部不可捕获崩溃)的
非 ASCII collection path 上,@zvec/zvec@0.7.0 满足 memory-index-zvec.js@d3ffe05d
实际消费的 Node API、返回值形状与跨进程持久化合同,node 22 与 node 24 各一次,
19/19,零失败。
```

同一格内、同一路径形状、同一长度上的 0.6.0 死亡,是这句话里「非 ASCII」三个字的全部分量。

三相与 2B 完全一致,不是另写的 workload:

```
A  initialize · upsert×2 · close(触发 optimizeSync)          2 检查
B  reopen · fts · colon fallback · scope 双向 · list · stats · delete · close   14 检查
C  reopen · 删除仍生效 · 幸存者仍可查 · close                  3 检查
```

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
在一台标准的 Windows CI 镜像上,这个故障**根本不复现** —— 也就是说,
即便当初有人把 CI 全绿当作安全证据,那份绿色也从来不携带信息。
一个连能否观察到都取决于主机的故障类别,不是可以停止防守的故障类别。

未覆盖,且本轮明确不覆盖:其他 locale、其他 Windows 版本与镜像、并发多进程写入、
超过 `MAX_ENUM`(1000)的集合规模、穷举 Unicode、以及这个 native failure class 的机制
与它的主机依赖性。

## 8. 工件

```
workflow   .github/workflows/zvec-070-nonascii-bridge.yml   (workflow_dispatch only)
apparatus  docs/validation/fixtures/zvec-070-adapter-contract/
           bridge-runner.js · adapter-txn.js · expected-checks.js

results-bridge/                       SHA-256                    ← 本轮权威
  local-win11-node22.json   84742eb25260cfbb938160bb2649d13d1767103e89a9fabd8a83d3de1b35bc5d
  local-win11-node24.json   69d6100789855146bfed8ffdde049084a1e020bfe571d414a8bfb0d81bfa0908

results-out-of-regime/    run 33611916358 @ 3db5c3b   区间外测量,非权威(§3)
results-ci-image/         run 33612887037 @ 75a68aa   区间内、该镜像不复现(§5)
```

每份含逐相的 `status / exitCode / signal / timedOut / collectionPathLen / checks /
checkSet / seam / adapterBlob`,以及对照的 `outcome / exitCode / collectionPathLen /
triggerReproduced`,因此 §1 的每一格都可由工件独立重建,不依赖本文档作者的转录。

`expected-checks.js` 是本轮新增的共享冻结集:2B 的 runner 与本桥都从它 import。
两份冻结集就是两份会漂移的集合,而且漂移不可见 —— 各自都会把自己的内容报告为完整。
推送前逐相比对过,与已合入的 2B 证据里记录的检查名**逐字相同**(A 2 / B 14 / C 3)。

## 9. 测量阶段到此结束

Step 1(触发边界)· 2A(安装 / 加载 / 原生 smoke)· 2B(真实 adapter 合同)· 2C(非 ASCII 桥)
四步全部完成。下一步不是继续测,而是把 0.6→0.7 的升级论证写成决策记录,
对 pin / RUNTIME_DEPENDENCIES / optional→mandatory / 默认翻转 / containment /
发布**分别**裁定。
