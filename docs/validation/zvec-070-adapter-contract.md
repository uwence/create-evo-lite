# @zvec/zvec 0.7.0 对真实 adapter 的合同(Step 2B)

- 议题:`[zvec-win-unicode-containment]` 上游复核的**第三步**
- 阶段:**Step 2B · 只测不改**;生产代码变更:**零**
- 日期:2026-09-02
- baseline:`main@55e7cce`
- apparatus:`785e429`
- 被测对象:`memory-index-zvec.js` git blob **`d3ffe05d`**(templates 与 .evo-lite 两侧一致)
- workflow run:`33609869877` — 5/5 job success,head `785e429`
- 前序:`zvec-070-win-unicode-recheck.md`(触发边界)· `zvec-070-install-matrix.md`(2A)

> **只回答一个问题**:`@zvec/zvec@0.7.0` 能否满足 `memory-index-zvec.js@d3ffe05d`
> **实际消费**的 Node API、返回值形状与跨进程持久化合同。
>
> Step 2A 问的是「它能不能活着 create/open/close」。这里问的是
> 「它能不能按 create-evo-lite 真正依赖的方式工作」。

## 1. 结果

```
Step 2B    SATISFIED(有界)
5 / 5 cells,每格 3/3 相、19/19 检查、0 失败
```

| cell | node | 3/3 相 clean | checkSet 精确 | seam.requestedBy | blob | version |
|---|---|---|---|---|---|---|
| ubuntu / 20 | v20.20.2 | ✓ | ✓ | adapter | d3ffe05d | 0.7.0 |
| ubuntu / 22 | v22.23.2 | ✓ | ✓ | adapter | d3ffe05d | 0.7.0 |
| ubuntu / 24 | v24.19.0 | ✓ | ✓ | adapter | d3ffe05d | 0.7.0 |
| windows / 22 | v22.23.2 | ✓ | ✓ | adapter | d3ffe05d | 0.7.0 |
| windows / 24 | v24.19.0 | ✓ | ✓ | adapter | d3ffe05d | 0.7.0 |

六个条件逐格核对,**不是从五个绿色 job 反推**:三相全部 `passed` 且 `exitCode 0 / 无 signal /
未超时`;`checkSet` 无 missing / unexpected / duplicated;`seam.requestedBy` 每相都是被测
adapter 本体;blob 与期望相符;`installedVersion === 0.7.0`。

## 2. 被覆盖的合同面

来自 adapter 源码,不是从 2A 的 smoke 推测:

```
schema        ZVecCollectionSchema · ZVecDataType.STRING
              ZVecIndexType.FTS(jieba) · ZVecIndexType.INVERT
open/create   ZVecOpen · ZVecCreateAndOpen
write         insertSync([{id, fields:{content,namespace,timestamp}}]) → upsert 返回数字 id
persist       optimizeSync(经 close() → _finalizeSync)
enumerate     querySync({topk, filter:'namespace != ""'})
fts           querySync({fieldName, topk, filter?, fts:{queryString}})  → match_source zvec-fts
fallback      queryString 抛出 → querySync({..., fts:{matchString}})    → match_source zvec-match
row shape     id · fields.content · fields.namespace · fields.timestamp · score
delete        deleteSync(String(id)) → {ok} → {changes: 1}
lifecycle     closeSync
```

## 3. 三个进程,不是三次调用

adapter 的持久化合同是「写入 → close 时 finalize → **下一个** one-shot CLI 进程能召回」。
同进程内写完立刻查会跳过产品真正依赖的那一段。

```
A  initialize · upsert×2 · close(触发 optimizeSync)
B  reopen · fts · colon fallback · scope 双向 · list · stats · delete · close
C  reopen · 删除仍生效 · 幸存者仍可查 · close
```

`task:alpha-beta` 这类冒号查询不是花活:生产 adapter 明确依赖
`queryString 抛出 → matchString` 这条回退路径,所以它属于真实兼容面。

## 4. seam 在 adapter 外部,且承重的是 requestedBy

adapter 的 `require('@zvec/zvec')` 是惰性的。**不得**为可测性给它加 override:那样被测对象
就不再是准备升级的那份代码。harness 拦 `Module._load`,只重定向这一个 specifier。

`redirectedTo` 是 interceptor **自己写进去的值**,单独验它只能证明「harness 重定向了某个
东西」。承重的是 `requestedBy` —— 必须是被测 adapter 通过它自己的生产 require 请求的,
经 `realpathSync.native` 规范化、win32 折叠大小写后比对物理路径。

seam **可证非空转**:`.evo-lite/node_modules` 内没有 `@zvec`,没有 seam 时 adapter 的
require 会直接抛。

## 5. 装置先弱了一档,四处都是复审抓的

文档冻结了一份合同,verdict 却没强制它 —— 这是本条工作线上同一形状的**第三次**
(前两次:`versionMatchesRequested` 只被记录、`positionsExercised` 只写在散文里)。

```
P1-1  phase passed 只听子进程自述;exitCode/signal 记录了但不判
P1-2  --expect-blob 可省略 → 门退化成「未被证明不符」
P1-3  seam 只验 redirectedTo,等于验 interceptor 自己写的值
P1-4  只问「现存检查是否全绿」,不问「该有的检查是否都在」
```

四个突变控制,不靠断言:

```
子进程写完绿色证据后 exit 7    checksFailed 0 · phase dirty-exit · NOT_SATISFIED
省略 / 非法 --expect-blob      测量开始前 exit 2
harness 自己 require zvec      seamProven false,非 adapter 请求者被拒
一条 check 改名                expected 3 · seen 3 —— 计数完全相同 —— 仍被抓住
```

最后一条是**冻结集合而非计数**的理由:改名、或复制一份再删一份,总数都不变。

另有一处是我自己抓到的:`scoped.every(r => r.namespace === 'code')` 对空数组恒真,而
**空结果也是查询坏掉时的样子**。已改成双向 —— 域外词必须为空,域内词必须非空且命中预期行。

## 6. 两次运行的地位

```
run 33608269340 @ a2a3ad7   硬化前,5/5,19/19
                            装置存在上述四个洞 → 保留为诊断数据,见
                            fixtures/zvec-070-adapter-contract/results-pre-hardening/
                            NOT authority
run 33609869877 @ 785e429   硬化后,5/5 → Step 2B authority
```

它没踩中那四个洞,但**「装置恰好没被抓住」不等于「装置正确」** —— 与 2A 首轮同样处置。

## 7. 结论,以及它**不**授权什么

```
@zvec/zvec@0.7.0 在被测五个 runtime cell 上,满足
memory-index-zvec.js@d3ffe05d 实际消费的 Node API、返回值形状
与跨进程持久化合同。
```

不多一寸:

```
!= 升 pin
!= 进 RUNTIME_DEPENDENCIES
!= optional → mandatory
!= 默认翻转
!= 放松 containment
!= 任何发布决定
```

**containment 尤其不因本轮而变弱。** `zvec-070-win-unicode-recheck.md` §2.4 测到 0.6.0 的
66 次崩溃中 57 次落在 create/open 之内、9 次落在 insert 之内,推翻了旧文档「崩溃恒在
insertSync」的机制断言。**已知触发集未复现 + 合同满足,都不等于我们理解了这个 native
failure class。** 位置都预测不了的故障,不是可以停止防守的故障。

未覆盖:非 ASCII 路径下的这套合同(2B 用 ASCII 路径)、其他 locale / Windows 版本、
并发多进程写入、超过 `MAX_ENUM`(1000)的集合规模。

## 8. 工件

```
workflow   .github/workflows/zvec-070-adapter-contract.yml
apparatus  docs/validation/fixtures/zvec-070-adapter-contract/
           README.md · txn-runner.js · adapter-txn.js

results/                              SHA-256
  ubuntu-node20.json    5fb621226457a1f4fd785837921ad02aaad4bd988ca317a0bc06cac62e96d640
  ubuntu-node22.json    530273f084b252657966662b52aab9f2bf91b0484cee89f3331241469992b143
  ubuntu-node24.json    dab121df2407fa34b5b622a31034b73a9855986cf5651ec6f6d032b682be4633
  windows-node22.json   c01ac9c2df252c43ac6f4095abf0a5823051a7c12211f7fba843165e410ca1ec
  windows-node24.json   3541ac4b93d076c3fff4884c65423f9a778093f7103e5bb40c50051ac1786483
```

每份含逐相的 `status / exitCode / signal / timedOut / checks / checkSet / seam / adapterBlob`,
因此 §1 的每一格都可由工件独立重建,不依赖本文档作者的转录。Actions artifact 会过期;
只留「五个绿色 job」正是本项目反复拒绝退回的状态。
