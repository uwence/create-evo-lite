# [memory-lock-win-cim-snapshot-reliability] 确定性身份合同与外部查询可用性的分离 — 设计

- 日期:2026-08-02
- 状态:**设计冻结 — ACCEPTED;生产实现未授权**
- 本轮采纳:**A1(合同拆分 + CI 语义分离)**;**A2(timeout-only 有界重试)暂缓**
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

**已排除(跨复现层面)**:event 类型、Task 5 回归 —— 三次复现横跨两种 event
与两个 image,且同一产品内容多次全绿。

**关于失败调用本身,措辞必须严格**:当前失败的**直接外部表现是 timeout**;
没有证据支持把它归类为 `no-row`、`parse-error` 或 `nonzero-exit`。随后同一条
命令成功,证明**查询与 PID 在复现之后仍可正常工作** —— 但**不能回溯观察**
被终止的第一次调用是否已经产生部分 stdout。不得写成「随后成功,所以逻辑上
排除了第一次调用的一切其他内部状态」。

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

**一处必须说准的现状**:畸形身份行(`invalid-row`)在当前实现里**并不**折叠
成 `null`。`Name`/`CommandLine`/`StartedAt` 会被 `String(x || '')`、`|| null`
一类的写法强制转换,于是返回一个**字段为空但结构完整**的 snapshot;真正拦住
它的是下游 `diagnoseLockConflict` 里的
`!snapshot.commandLine || !snapshot.startedAt` 分支。

结果同样安全(→ unknown),但分类发生在**错误的层**:调用方拿到的是"看起来
是个快照,只是字段是空的",而不是"这一行不可信"。A1 要做的正是把这个判断
移进结果本身 —— 只有 `ProcessId` 缺失这一种畸形今天会走到 `null`。

---

## 2. 三个候选方向

### 2.1 方向 A —— 合同拆分 + 有界恢复

**A 必须拆成两半,且只有前一半在本轮采纳:**

```text
A1  合同拆分与 CI 语义分离      本轮 REQUIRED
A2  timeout-only 有界重试        独立、可选、暂缓
```

理由:Phase 1 对 A1 的证据是充分的 —— 六种事件被折叠成一个 `null`,这是
**结构性**缺陷,与长尾的具体形状无关。但对 A2,证据只够支持「值得评估」,
不够支持「现在冻结策略」:

```text
只有三次复现（其中两次带仪表化）
后续成功耗时 5 511 ms 与 1 427 ms —— 无稳定倍数
不知道被杀死的第一次调用是否已产生部分 stdout
没有长尾上界
重试会影响锁冲突路径与杀进程前的身份复核路径
```

先修「不可区分」这个合同缺陷与 release-gate 语义;是否还需要用重试改善
产品可用性,留到证据更充分时单独决定。**这样当前 10 秒生产预算保持不变,
也不必在证据不足时武断选择 12 / 15 / 20 秒总预算。**

把「结果」与「不可用原因」拆成结构化返回:

```text
snapshot.state:
  alive          进程存活且身份字段齐备且合法
  dead           进程确认不存在
  unavailable    外部查询未能给出【可用的】答案

snapshot.reason (仅 unavailable):
  timeout        命令达到时间边界
  spawn-error    host 无法启动
  nonzero-exit   host 非零退出
  empty-output   成功退出但 stdout 为空或只有空白
  parse-error    非空 stdout 无法解析
  no-row         可解析但没有结果行（null / 空数组 / 无行）
  invalid-row    结果行存在，但身份字段缺失、类型非法或不匹配
```

`invalid-row` 是本轮补上的**可表示性空洞**。上一稿的 taxonomy 里,
「JSON 合法、行存在,但 `ProcessId` 不匹配 / `CommandLine` 非字符串 /
`StartedAt` 不可解析」无处可去 —— 只能被伪装成 `alive`(把畸形数据当身份
证据,危险)或折叠进 `no-row`(把"查到了但不可信"说成"没查到",与 D4 的
gate 政策冲突)。两条路都错,所以它必须有自己的名字。

**安全语义完全不变**:

```text
unavailable → 调用方仍视为 unknown / report-only → 绝不自动终止进程
```

这一点是本设计的不可协商项。拆分只增加**可观测性**,不增加任何"可以杀"
的分支。

#### A2(暂缓,本轮不实施)

以下内容记录**为什么将来若要重试只能这样重试**,而不是本轮要落地的东西。
Phase 3A 的重试次数固定为 0。

在合同拆分之上,可评估一次**仅针对 `timeout`** 的有界重试:

```text
第 1 次 timeout
  → 完全相同的命令,至多重试 1 次
  → 成功:消费该快照
  → 第 2 次仍失败:unavailable / fail-closed
```

**为什么只对 timeout**:两次带仪表化的复现中,超时后同一条命令**立即**成功
(5 511 ms / 1 427 ms)。这是重试**可能**有效的直接证据 —— 但只是两个样本,
且倍数不稳定,不足以据此冻结一个总预算。而
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

### 2.4 结论

```text
采纳    A1  合同拆分 + CI 语义分离
暂缓    A2  timeout-only 有界重试（Phase 3B 候选，需单独授权与总预算）
不采纳  B   单纯增大 timeout（保留为对照记录）
暂缓    C   更换 transport（需先做专门的冷态对照实验）
```

B 的 timeout 数值与 C 的 transport 选择都**不**在本轮冻结:改动它们各自需要
自己的证据,把它们塞进 A1 只会让一次修改承担三种风险。

---

## 3. CI 合同 —— 两层分离

这是本设计的另一半,且比代码改动更重要。当前只有一层测试,它同时承担
「代码正确」和「runner 可用」两种含义。

### 3.1 确定性合同测试(必须稳定阻断 release gate)

通过 executor / seam 注入,不依赖真实 runner:

```text
成功快照                  → alive,字段齐备
dead PID                  → dead
连续 timeout               → unavailable / timeout
首次 timeout → 第二次成功  → 【Phase 3B 才需要】alive；3A 下不存在此路径
spawn failure              → unavailable / spawn-error
nonzero exit               → unavailable / nonzero-exit
empty stdout               → unavailable / empty-output
parse failure              → unavailable / parse-error
no CIM row                 → unavailable / no-row
malformed identity row     → unavailable / invalid-row
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
查询成功却返回畸形数据（= invalid-row）
错误地进入自愈路径
违反 fail-closed 映射
```

即:**放宽的只是"外部没回答"这一种情形**,不是放宽身份判定本身。

### 3.3 长期观测方式 —— 已决(见 D5)

三个候选:

```text
方案 1  保留一个低噪声独立 workflow（如 schedule + workflow_dispatch）
方案 2  只保留 workflow_dispatch，按需取证
方案 3  删除 PR 触发器，只把诊断脚本用于失败现场      ← 采用
```

**临时诊断 workflow 不得原样长期进入 main。** PR #11 里的那个是 Phase 1
资产,带 `pull_request` 触发器,会附着到面向 main 的 PR 上。冻结结论见 D5。

---

## 4. 不变量(实施时不得违反)

```text
I1  unavailable 绝不授权终止进程 —— 任何不确定一律 report-only
I2  Phase 3A 不重试(retry count = 0);若将来采纳 A2,只有 timeout 可被重试,
    语义性失败一律不重试
I3  若将来采纳 A2,重试必须有总时间硬顶,不得只写"重试一次"
I4  owner sidecar 语义、CAS 删除、四道闸、backoff 阶梯均不改动
I4b 空行/空输出绝不升级为 dead —— dead 在四道闸里可触发 stale owner 清理,
    把不可确认当成确认已死会给它错误的权重(见 D2)
I4c 畸形身份行绝不呈现为 alive —— 必须分类为 unavailable / invalid-row。
    身份字段是杀进程决策的输入;字段非法不是"较差的证据",是【没有】证据
I5  isExpectedMcpProcess 的判定条件不放宽(entrypoint 精确等值、
    startedAt 容差、mcp token)
I6  确定性合同测试必须稳定阻断 release gate
I7  真实集成探针只对"外部没回答"宽容,对畸形数据与错误自愈不宽容
I8  非 win32 路径行为不变
```

---

## 5. 冻结的决定(D1–D6)

上一稿把六件事留给「Phase 3 计划定夺」。其中至少四件不是实施顺序问题,
而是设计决策 —— **计划不能代替设计做这些决定**。现全部冻结如下。

### D1 — 结构化 API 与兼容面

新增内部详细接口:

```text
getProcessSnapshotResult(pid, seams)

→ { state: 'alive',       snapshot }
→ { state: 'dead',        snapshot }
→ { state: 'unavailable', reason, detail }
```

**保留现有导出** `getProcessSnapshot(pid, seams)` 作为兼容 wrapper:

```text
alive / dead  → 返回旧 snapshot 对象
unavailable   → 返回 null
```

理由:该函数是模块导出面。仅因为**当前仓内**只找到两个生产调用点,就破坏
一个已导出的契约,对潜在消费者(子仓镜像、外部集成)没有正当理由。兼容
wrapper 的成本接近零。

内部两个生产调用点改用 `getProcessSnapshotResult()`,从而拿到 `reason`:

```text
memory-index-lock.js:248  diagnoseLockConflict
memory-index-lock.js:387  attemptSelfHeal（杀进程前的身份复核）
```

### D2 — 判定优先级(穷尽且互斥)

现有实现先执行 `pidAlive(pid)`;若进程明确不存在,**在调用 PowerShell 之前**
就返回 `alive:false`。完整判定顺序冻结如下,**按序短路,第一个命中者为准**:

```text
1  pidAlive === false                      → dead
2  命令达到时间边界                          → unavailable / timeout
     即使已捕获到部分 stdout 仍然是 timeout；
     部分输出只记录进 detail，不改变分类
3  host 无法启动                            → unavailable / spawn-error
4  host 非零退出                            → unavailable / nonzero-exit
5  成功退出但 stdout 为空或只有空白           → unavailable / empty-output
6  非空 stdout 无法解析                      → unavailable / parse-error
7  可解析但没有结果行（null / 空数组 / 无行）  → unavailable / no-row
8  结果行存在但身份字段无效或不完整            → unavailable / invalid-row
9  合法且完整的结果                          → alive
```

第 8 步的「无效或不完整」至少覆盖:

```text
ProcessId 缺失或与请求的 pid 不匹配
Name 类型非法
CommandLine 非字符串或不可用
StartedAt 缺失或不可解析
ParentProcessId 类型非法
```

两条不可协商的边界:

**空行绝不升级为 `dead`。** 空行可能是查询失败,也可能是 precheck 与查询
之间进程退出的竞态 —— 两者不可区分,fail-closed 是唯一正确处理。把它当成
`dead` 会让一个不可确认的状态获得"确认已死"的权重,而 `dead` 在四道闸里是
可以触发 stale owner 清理的分支。

**畸形行绝不伪装成 `alive`。** 第 8 步必须在第 9 步之前:身份字段是杀进程
决策的输入,一个字段非法的行不是"较差的身份证据",而是**没有**身份证据。

### D3 — 本阶段不实施 retry

```text
Phase 3A:
  retry count                 = 0
  单次尝试预算                 = 10 000 ms（不变）
  生产墙钟语义                 不变
```

A2(timeout-only 有界重试)保留为后续 Phase 3B 候选,**需单独授权并明确
总预算**。这同时回答了上一稿的 Q1 与 Q2:

```text
Q1  本轮总预算不变
Q2  diagnoseLockConflict 与 attemptSelfHeal 均不重试
```

### D4 — 真实 Windows 集成测试的 gate 政策

**只有一种结果**可作为外部可用性事件而不使 release-gate 失败:

```text
unavailable / timeout
```

且此时必须同时成立:

```text
输出结构化诊断
验证该结果被映射为 unknown / report-only
验证未进入 kill 路径
```

以下一律**仍然打红**:

```text
unavailable / spawn-error      —— PowerShell 不存在或无法启动
unavailable / nonzero-exit     —— 命令写错或宿主报错
unavailable / empty-output     —— 契约变化
unavailable / parse-error      —— JSON 结构变化
unavailable / no-row           —— 查询语义问题
unavailable / invalid-row      —— 返回了行但身份字段不可信
错误进入 self-heal
任何 fail-closed 违规
```

注意「成功返回但字段畸形」不再是一个游离于 taxonomy 之外的散条 —— 它就是
`invalid-row`,与其余六种 reason 一样有名字、有 detail、有 gate 政策。

理由:当前**实证的**缺陷只有 timeout 一种。不能借本议题顺手把"PowerShell
不存在""命令写错""JSON 结构变了"这些确定性问题一起降级 —— 那会把这次
修复变成一张长期免死金牌。

### D5 — 长期诊断资产:采用方案 3

```text
保留   诊断脚本
保留   失败现场的结构化输出
不保留 自动 diagnostic workflow
```

具体:

```text
PR #11 不合并
Phase 3 分支按需带入诊断脚本与失败现场 instrumentation
.github/workflows/memory-lock-cim-diagnostic.yml 不进 main
不新增 schedule / PR / push 触发的诊断 workflow
需要专项复现时，单独授权后按需运行
```

同时满足低噪声与可取证:失败现场仍会自动产出证据,但不为此常驻占用两台
Windows runner。

### D6 — 不增加 verify 的 unavailable 计数

```text
verify unavailable count:  OUT OF SCOPE
```

目前没有持久化采样、没有统计窗口、没有消费方。为一次**瞬时**外部查询增加
用户可见的 verify 指标属于范围膨胀,且会诱导把偶发环境事件读成产品健康度
下降。

---

## 5.1 仍需实施阶段现场核实的细节

只保留真正无法在设计期定夺的:

```text
E1  `detail` 字段的具体形状（elapsedMs / status / signal / errorCode /
    stdout 字节数）—— 取决于实现时能从 execFileSync 稳定拿到哪些字段，
    不影响任何安全语义
E2  确定性 seam 测试如何注入九种结果 —— 现有 seams.snapshotFn 是否够用，
    还是需要更低一层的 executor seam
E3  真实集成探针在同一个测试内如何分成两个断言块（可用性块 vs 确定性块），
    使 timeout 只放宽前者
```

这三条都是实现形态问题,不改变 D1–D6 的任何结论。
## 6. 范围声明

```text
本文状态:               设计冻结候选，待复审
本轮采纳:               A1（合同拆分 + CI 语义分离）
本轮暂缓:               A2（timeout-only 有界重试）、B、C
生产实现:               未授权
Phase 3A 实施计划:       未编写、未授权
Phase 3B（retry）:      未授权，需单独证据与总预算
Task 6–8:               未授权
PR #11:                 保持 Draft，冻结，不合并
诊断 workflow 去留:      已决 —— D5 方案 3，不进 main
```

本设计不提出任何可直接落地的代码改动。它冻结的是**问题定义、候选方向的
取舍理由、不变量,以及 D1–D6 六项设计决定**。

上一稿把 D1–D6 中至少四项留给「Phase 3 计划定夺」,那是错的:实施计划的
职责是排顺序和定验收,不是替设计做架构决策。§5.1 只保留三条真正无法在
设计期定夺的实现形态问题,它们不改变 D1–D6 的任何结论。
