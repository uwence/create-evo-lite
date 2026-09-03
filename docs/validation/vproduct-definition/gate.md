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
             一个 cell 是什么 · 必须验证哪些性质 · 怎样合成「verified」
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

## 4. 全局非授权(对每个 Step 都成立)

```text
!= V_PRODUCT membership          != equivalence class / 任何外推
!= A0 的 P3 coverage justification
!= 修改 S_PRODUCT                != 修改 CI matrix
!= enforcement                   != canonical support spec
!= UDR 的 A0 satisfied           != UDR 的 D1 重裁
!= 任何实施或生产变更
!= 回改 A0 gate 已冻结的任何内容 —— 包括那句 `P2 = DEFERRED`
```

## 5. Status ledger

```text
Step A  Cell Verification Contract          OPEN     Stage 1 进行中
Step B  Evidence Acceptance & Delegation    BLOCKED  待 Step A 冻结
Step C  V_PRODUCT candidate                 BLOCKED  待 Step B 冻结
Step D  adjudication                        BLOCKED  待 Step C 冻结
```

各 Step 的 decision node 与 verdict **不在此登记** —— 见该 Step 自己的文件。
