# [memory-lock-win-cim-snapshot-reliability] 确定性身份合同与外部查询可用性的分离 — 设计

- 日期:2026-08-02
- 状态:**设计草案 —— 仅设计授权,生产实现未授权**
- 议题来源:active backlog `[0020] [memory-lock-win-cim-snapshot-reliability]`
- 证据:`docs/validation/memory-lock-win-cim-snapshot-reliability.md`
  (Phase 1 观测,两次带仪表化的完整复现)
- 上游关联:`[a177]` mcp-zvec-lock 三层锁协调设计(本文不改动其安全语义)
- 分发范围:母仓;子仓随 `templates/cli/**` 镜像自然继承

---

## 1. 问题陈述

要解决的**不是**「怎样让 PowerShell 更快」。那是外部环境问题,本仓无法控制。

要解决的是:

> 如何把**确定性的进程身份安全合同**,与**不确定的 Windows 外部查询可用性**,
> 在代码语义和 CI 语义两个层面分离开?

Phase 1 已经证明安全行为本身是**正确的**:快照不可确认时降级为
`unknown` / report-only,绝不授权终止进程。真正的缺陷是:

```text
「外部查询这次没在 10 秒内回来」
与
「身份判定代码坏了」
```

对调用方和对 release gate 而言**不可区分**。前者是环境事件,后者是缺陷;
把两者压成同一个 `null`、并让同一条断言同时承担两种含义,是这次
release gate 反复失去首跑确定性的直接原因。

### 1.1 Phase 1 结论(承重事实)

```text
生产调用超时(10.503 s / 10.019 s)→ null
其后同一条命令:5 511 ms / 1 427 ms → 成功，返回正确行
其后第 3–5 次调用:244–741 ms
健康 runner 首次调用:3 184–3 447 ms;预热后 190–462 ms
```

**已排除**:查询语义错误、PID 不存在、JSON 解析失败、CIM 空行、非零退出、
event 类型、Task 5 回归。

**未证明**:延迟落在 PowerShell 宿主启动还是 CIM provider;长尾的倍数与
时长不稳定(5 511 vs 1 427,无稳定缩放因子);`pwsh` 冷态成本(从未作为
首次调用被测量)。

### 1.2 当前实现为何无法表达这件事

`getProcessSnapshot()` 把六种事件折叠成同一个返回值:

```text
powershell 启动失败 / 超时 / 非零退出 / 空 stdout / JSON 解析失败 / CIM 空行
                              ↓
                            null
```

调用方(`diagnoseLockConflict`)只能一律按「不可确认」处理。这在**安全**
上是对的,在**可诊断性**上是灾难:同一个 `null` 既可能是"这台 runner 慢",
也可能是"我们把命令写错了"。

---

## 2. 三个候选方向

### 2.1 方向 A —— 合同拆分 + 有界恢复(推荐)

把「结果」与「不可用原因」拆成结构化返回:

```text
snapshot.state:
  alive          进程存活且身份字段齐备
  dead           进程确认不存在
  unavailable    外部查询未能给出答案

snapshot.reason (仅 unavailable):
  timeout
  spawn-error
  nonzero-exit
  empty-output
  parse-error
  no-row
```

**安全语义完全不变**:

```text
unavailable → 调用方仍视为 unknown / report-only → 绝不自动终止进程
```

这一点是本设计的不可协商项。拆分只增加**可观测性**,不增加任何"可以杀"
的分支。

在此基础上,评估一次**仅针对 `timeout`** 的有界重试:

```text
第 1 次 timeout
  → 完全相同的命令,至多重试 1 次
  → 成功:消费该快照
  → 第 2 次仍失败:unavailable / fail-closed
```

**为什么只对 timeout**:两次复现中,超时后同一条命令**立即**成功
(5 511 ms / 1 427 ms)。这是重试有效性的直接证据。而
`parse-error`、`no-row`、`nonzero-exit`、`empty-output` 都是**语义性**
结果 —— 重试它们是盲目重试,会把确定性缺陷伪装成偶发问题,正是本议题要
消灭的东西。

**必须在设计冻结时定死、不得实施时临时决定的量**:

```text
单次尝试预算            (当前 10 000 ms)
重试次数                (提议 1)
总时间上限              (含重试的墙钟硬顶)
重试是否适用于诊断路径   (diagnoseLockConflict 在锁冲突时调用,
                         此时已有用户在等待)
```

**风险(必须写明)**:`getProcessSnapshot` 被 `diagnoseLockConflict` 与
`attemptSelfHeal` 调用,后者在**锁冲突**路径上。总预算翻倍意味着最坏
阻塞时间翻倍。这不是免费的,设计必须给出总上限而不是"重试一次"。

### 2.2 方向 B —— 单纯增加 timeout(不推荐,作为对照记录)

例如 10 s → 20 s。

```text
✗ 消除不了长尾 —— 只是把失败边界往后挪
✗ 加大锁冲突路径的最坏阻塞时间
✗ 真实集成测试仍随 runner 负载波动
✗ 无法区分「慢」与「坏」——本议题的核心诉求原封不动
```

Phase 1 数据也不支持它:健康首次调用 3.2–3.4 s,失败时 > 10 s,长尾的
形状与倍数**不稳定**。没有任何证据表明 20 s 能覆盖分布的尾部,也没有
证据表明尾部有上界。

保留为对照方案,不作为默认结论。

### 2.3 方向 C —— 更换 transport(暂缓)

包括 `pwsh`、其他命令行工具、或直接调用 Windows API。

```text
✗ 没有冷态 pwsh 证据 —— Phase 1 的所有 pwsh 数字都取自 powershell.exe
   预热之后,对其首次调用成本毫无说明力
✗ 没有替代 transport 在目标 Windows 环境(GitHub runner + 真实用户机)
   的兼容性证明
✗ 现在切换属于过早扩大范围:会把一个可观测性问题变成一个移植问题
```

若 Phase 3 决定需要,应先做一次**专门的冷态 transport 对照实验**,而不是
在修复本议题时顺手替换。

### 2.4 推荐

采纳 **A**,并把 B 的 timeout 数值与 C 的 transport 选择都留在 A 的
「设计冻结参数」里,而不是各自成为一次修改。

---

## 3. CI 合同 —— 两层分离

这是本设计的另一半,且比代码改动更重要。当前只有一层测试,它同时承担
「代码正确」和「runner 可用」两种含义。

### 3.1 确定性合同测试(必须稳定阻断 release gate)

通过 executor / seam 注入,不依赖真实 runner:

```text
成功快照                  → alive,字段齐备
dead PID                  → dead
首次 timeout → 第二次成功  → alive(若采纳有界重试)
连续 timeout               → unavailable / timeout
spawn failure              → unavailable / spawn-error
nonzero exit               → unavailable / nonzero-exit
empty stdout               → unavailable / empty-output
parse failure              → unavailable / parse-error
no CIM row                 → unavailable / no-row
```

并且对**每一种** unavailable 验证:

```text
diagnoseLockConflict → unknown / report-only
attemptSelfHeal      → 绝不进入 kill 路径
```

这些测试**必须**稳定红/绿,因为它们检验的是代码,不是环境。

### 3.2 Windows 真实集成探针

外部查询**成功**时:

```text
验证 alive / isNode / commandLine / startedAt / ppid 的真实形状
```

外部查询 **unavailable** 时:

```text
输出结构化证据（沿用 Phase 1 的 CIM_SNAPSHOT_DIAG 格式）
验证 fail-closed 映射成立
不得把外部 runner 可用性当作确定性代码失败
```

但以下情形**仍必须**打红 release gate:

```text
查询成功却返回畸形数据
错误地进入自愈路径
违反 fail-closed 映射
```

即:**放宽的只是"外部没回答"这一种情形**,不是放宽身份判定本身。

### 3.3 长期观测方式(设计必须择一并说明理由)

```text
方案 1  保留一个低噪声独立 workflow（如 schedule + workflow_dispatch）
方案 2  只保留 workflow_dispatch，按需取证
方案 3  删除 PR 触发器，只把诊断脚本用于失败现场
```

**临时诊断 workflow 不得原样长期进入 main。** PR #11 里的那个是
Phase 1 资产,带 `pull_request` 触发器,会附着到面向 main 的 PR 上;它必须
在收口时删除或转为上述之一。

---

## 4. 不变量(实施时不得违反)

```text
I1  unavailable 绝不授权终止进程 —— 任何不确定一律 report-only
I2  只有 timeout 可被重试;语义性失败一律不重试
I3  重试必须有总时间硬顶,不得只写"重试一次"
I4  owner sidecar 语义、CAS 删除、四道闸、backoff 阶梯均不改动
I5  isExpectedMcpProcess 的判定条件不放宽(entrypoint 精确等值、
    startedAt 容差、mcp token)
I6  确定性合同测试必须稳定阻断 release gate
I7  真实集成探针只对"外部没回答"宽容,对畸形数据与错误自愈不宽容
I8  非 win32 路径行为不变
```

---

## 5. 未决问题(Phase 3 实施计划必须先回答)

```text
Q1  总时间预算定多少?锁冲突路径能接受的最坏阻塞是多少?
Q2  重试是否同时适用于 diagnoseLockConflict 与 attemptSelfHeal 的复核调用?
    (后者是杀进程前的最后一次身份确认,语义更敏感)
Q3  snapshot 结构化返回是否需要保留旧的 null 返回作为兼容面?
    ——【已实测,便于 Phase 3 直接定夺】生产调用点只有 2 处,均在
    memory-index-lock.js 内:
        :248  diagnoseLockConflict  —— 诊断入口
        :387  attemptSelfHeal       —— 杀进程前的身份复核
    两处紧随其后的判定都是 `!snapshot || snapshot.isNode == null || ...`
    形态的"不可确认"分支,而不是对 `=== null` 的字面依赖。
    测试侧有一处显式 `assert.strictEqual(..., null)`(governance.js:2282,
    seam 抛错分支)。
    因此爆炸半径小:兼容面可以做成"state 字段 + 保留 falsy 语义",
    也可以直接改判定分支。**由 Phase 3 定夺,本文不预设。**
Q4  真实集成探针如何在不"跳过 Windows"的前提下,把 unavailable 与
    代码失败区分开?(候选:探针自身分两个断言块)
Q5  长期观测方式三选一,以及诊断脚本是否需要进 templates 分发给子仓
Q6  是否需要在 verify 输出中暴露 unavailable 计数,作为可用性可观测面
```

---

## 6. 范围声明

```text
本文授权范围:           设计
生产实现:               未授权
Phase 3 实施计划:        未编写
Task 6–8:               未授权
PR #11:                 保持 Draft，冻结，不合并
诊断 workflow 去留:      待本设计复审时裁定
```

本设计不提出任何可直接落地的代码改动。它冻结的是**问题定义、候选方向的
取舍理由、不变量与未决问题**;具体参数与实施顺序由 Phase 3 计划在获得
单独授权后确定。
