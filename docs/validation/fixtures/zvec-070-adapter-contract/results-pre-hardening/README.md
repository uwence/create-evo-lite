# 硬化前的五格结果(pre-hardening measurement)

run `33608269340` @ `a2a3ad7`,五格全部 `SATISFIED`,19/19 检查,adapter blob `d3ffe05d`。

**这不是 Step 2B 的最终接受证据。** 独立复审在这一轮之后指出:verdict 比文档宣称的合同弱
一档,四处判定门缺失:

```
P1-1  phase passed 未要求子进程正常退出 —— exitCode / signal 只被记录,不参与判定
P1-2  --expect-blob 可省略 → 身份门退化为「未被证明不符」,而非「相符」
P1-3  seam 记录了 requestedBy 却未纳入判定 —— 只验 redirectedTo 等于验 harness 自己写的值
P1-4  文档冻结 19 项,verdict 只问「现存检查是否全绿」,不问「该有的检查是否都在」
```

这一轮**没有踩中其中任何一条**,所以数据本身仍有诊断价值,保留在此供对照。

但**「装置恰好没被抓住」不等于「装置正确」** —— 与 Step 2A 首轮(`706f9af`)同样的处置。
权威结果见上一级目录的 `results/`。
