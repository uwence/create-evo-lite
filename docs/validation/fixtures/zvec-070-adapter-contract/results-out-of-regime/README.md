# 第一次 CI 运行 —— 区间外测量,非权威

run `33611916358` @ `3db5c3b`,windows-latest node 22 / 24。两格都 `NOT_SATISFIED`,
原因是**控制组没有复现触发**:0.6.0 在该路径上正常完成了 phase A。

保留它不是为了记录一次失败,而是因为它本身是一条数据,并且是本轮唯一一次
真正抓住装置缺陷的运行:

```
colPathLen 76        0.6.0 completed(2/2 checks,exit 0)
```

既有已合并证据里,整个语料的采集区间是 `colPathLen 135..160`,66 次崩溃全部落在
`135..156`;本 segment(`o2-kana-hangul-dash`)被记录为 **149 → FAIL_FAST 3/3**
(`../zvec-win-unicode/results-0.7.0-probe/control-0.6.0-R2.json`)。76 落在这个区间
**之外**,是触发集从未被测量过的长度。

因此这两份工件**不构成**「0.6.0 在非 ASCII 路径上不崩溃」的证据,也不与既有证据冲突。
它们说明的是装置缺陷:bridge 把触发当成 segment 的属性,而入库证据记录的是
**segment 在某个已测长度上**;长度被交给了「host 恰好把 root 放在哪」,而
`zvec-070-win-unicode-recheck.md` §1.1 早已实测「路径前缀一变,崩溃点就移动」。

修法:目标长度取自上述工件里的 **149**(合并前即已登记,不是看到结果后调出来的),
由前缀 padding 达成,对照与被测**同样**处理,且达成值本身是 verdict gate
(`lengthOnTarget`)——记录而不判定,正是本工作线已经踩过三次的形状。

本目录的 record 同样产生于共享分类器之前,`control.outcome` 用的是旧词 `completed`。
