# V_PRODUCT Definition Gate

- 议题:为 A0 gate 里 **DEFERRED 的 P2** 生产它所缺的 authority
- 日期:2026-09-03
- baseline:`main@a3f7395`
- 前序:`../product-support-scope.md`(A0 gate,三阶段已冻结并合入 `main@46abcf96`)

本文件**只承担全局纪律与状态 ledger**。各 Step 的主语、判据与裁决**只写在该 Step
自己的文件里** —— 本文件不复制任何 V1 / V2 / V3 内容,以免产生第二个 verdict home。

## 1. 与 A0 的关系:不是「A0 Stage 4」

A0 gate 已于 `aa59c36c` 三阶段全部冻结,**不重开**。其中:

```text
P2 = DEFERRED  是 aa59c36c 当时 authority 状态下的**正确历史裁决**,是不可变历史。
```

本 gate 的任务是**生产新的 authority**,使 A0 的 P2 将来可以被**重新消费**。
将来有了结论,应当写一份**新的 consumption / re-adjudication record**,
而**不是**回头把 A0 文档里的 `DEFERRED` 改成 `GREEN` —— 那会重写 evidence history。

## 2. Step 顺序(冻结):定义先于证据,证据先于成员资格

```text
Step A   Cell Verification Contract (B3)
             frozen input:cell 是什么(Q-A1 已裁,见 step-a §2)
             decision:必须验证哪些性质 · 怎样合成一个 verification state
             ↓ 冻结后
Step B   Evidence Acceptance & Delegation Contract
             什么**形式**的 evidence 足以承担某条 predicate
             (单次观察 / 重复观察 / artifact / runner 执行 …)
             以及**谁**能承担(runner evidence / non-runner delegated authority)
             ↓ 冻结后
Step C   V_PRODUCT candidate:选定有限 cell / equivalence class
             ↓ 冻结后
Step D   按已冻结的 A + B 裁决该 candidate
```

**这个顺序不可颠倒。** 反过来做就是:

```text
先看见现有 release-gate 五格
→ 再设计一套刚好让这五格成立的「verified」定义
```

与本工作线一路在防的「先看结果、再写判据」同型。

## 3. 文件组织(Q-A2 已裁,2026-09-03)

```text
SPLIT = YES
粒度   = **一个 Step 一份文件**,不是一个 Stage 一份
```

```text
docs/validation/vproduct-definition/
    gate.md                          ← 本文件:全局纪律 + ledger
    step-a-cell-verification.md      ← 已创建
    step-b-evidence-delegation.md    ← **Step A 冻结后**才创建
    step-c-vproduct-candidate.md     ← Step B 冻结后才创建
    step-d-adjudication.md           ← Step C 冻结后才创建
```

**未获授权的 Step 文件一律不预先创建。**

拆分的理由不是篇幅美观,是 A0 暴露出的一个实际成本:1129 行的单一 decision record,
在后续阶段即使冻结主体未变,stage banner、指针、历史说明仍会不断产生 diff ——
这会让 **semantic freeze** 与 **byte freeze** 长期混在一起。
(A0 期间那三次 nested fence 错误,也与一份不断增长的大文件有关。)

拆分之后:

```text
Step A 冻结于某个 SHA
    → 该文件可以**真正停止变化**
Step B
    → 只能通过引用那个 frozen SHA 来消费 Step A
```

**git history 本身成为 dependency gate** —— 这比把顺序写在同一份文件里更强。

## 4. 非授权 —— 分两层

第一版把「V_PRODUCT membership / equivalence class」写进了**对每个 Step 都成立**的
永久禁令,而本文件 §2 又把 Step C 定义为「选定有限 cell / equivalence class」——
**Step C 会被本 gate 自己永久禁止执行**。两者是不同层级的东西:

```text
永久禁令        整个 V_PRODUCT gate 自始至终都不得做
分 Step 禁令    某个 Step **当前**不得做,因为它是后续 Step 的主语
```

### 4.1 永久非授权(整个 gate,任何 Step 都不得做)

```text
!= A0 的 P3 coverage justification    != 任何从 V_PRODUCT 到 S_PRODUCT 的外推
!= 修改 S_PRODUCT                     != 修改 CI matrix
!= enforcement                        != canonical support spec
!= UDR 的 A0 satisfied                != UDR 的 D1 重裁
!= 任何实施或生产变更
!= 回改 A0 gate 已冻结的任何内容 —— 包括那句 `P2 = DEFERRED`
```

其中要分清的一对:

```text
提名一个 equivalence-class candidate     ← A0 的 P2 主语本来就含它
    A0 P2 decision subject 原文:
    「用于 release / 依赖兼容性判定的**有限、可枚举**验证集合,
      或**一组具名的 equivalence class**。」

用等价类做外推、并主张代表性               ← A0 的 P3(B5 equivalence-class authority)
                                          **本 gate 自始至终不得偷做**
```

前者是本 gate 存在的目的,后者不是。

### 4.2 分 Step 非授权

```text
Step A / Step B
    != V_PRODUCT membership       != 提名任何 equivalence-class candidate
    (它们是 Step C 的主语;在 contract 与 evidence 规则冻结之前提名,
     就是「先看见格子、再写定义」)

Step C
    MAY  提名 V_PRODUCT candidate:有限 cell 集合 / 具名 equivalence class
    但提名本身**不**建立代表性(P3),也**不**回改 A0 的历史 P2

Step D
    按已冻结的 Step A + Step B 裁决该 candidate;
    仍受 §4.1 约束 —— 不得就此进入 P3
```

## 5. Status ledger

```text
Step A  Cell Verification Contract          PARKED   Stage 1 FROZEN @ a4e747da
                                                     Stage 2 FROZEN @ c39f5919
                                                     Stage 3 已裁决:V2 / V3 均为
                                                       DEFERRED / MISSING_AUTHORITY
Step B  Evidence Acceptance & Delegation    BLOCKED  待 Step A **冻结**(现为 PARKED)
Step C  V_PRODUCT candidate                 BLOCKED  待 Step B 冻结
Step D  adjudication                        BLOCKED  待 Step C 冻结
```

各 Step 的 decision node 与 verdict **不在此登记** —— 见该 Step 自己的文件。

`PARKED` 不是失败,也不是冻结:Step A 已经走完三个 Stage 并得出裁决,结论是 DEFERRED
(缺 owner 的产品意图声明)。解冻门槛只有一件事 —— owner 的一份声明;不需要重做任何
Stage,也不需要新 gate。详见 `step-a-cell-verification.md` §8。
