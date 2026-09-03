# Step A —— Cell Verification Contract (B3)

- 所属:`gate.md`(V_PRODUCT Definition Gate)—— 全局纪律与 Step 顺序见该文件
- baseline:`main@a3f7395`

```text
STAGE 1 — DECISION SUBJECT CONTRACT
本次只回答「到底在裁什么」。本 Step 的 decision node 是 **V2 与 V3 两个**。
不写 GREEN / RED,不写 required authority,**不裁定 V2 / V3**,
**不选任何 V_PRODUCT cell**,**不写任何 predicate 的具体内容**,不改任何生产文件。

cell identity(Q-A1)**不是**本 Step 的 decision node —— 它已在本 Stage 之前
被裁定,作为 frozen input 进入,见 §2。
```

```text
Stage 1  decision subjects · X→Y · authority boundary · non-authorization   ← 当前
             ↓ COMMIT + REVIEW
Stage 2  required authority · GREEN iff · RED iff · missing-authority disposition
             ↓ COMMIT + REVIEW
Stage 3  消费 authority · 填 verdict
```

## 1. current X —— 严格限定在已建立的范围内

A0 Stage 3 建立的只有这一句:

```text
本轮没有任何 source 被提名、验证并消费为 B3,因此 B3 当时未实例化。
```

**不得**把它扩张成「仓库中不存在任何相关材料」。判据绑定的是 **authority
provenance**,不是全文检索的质量 —— 这是 A0 Stage 3 复审逐条改掉过的三处措辞之一。
本文件的 `current X` **全部按同一语义书写**。

**已经冻结、可以直接消费的上游事实**(来自 A0,不是本 gate 重新裁定的):

```text
S_PRODUCT(A0 的 P1 = GREEN,authoritative)
    OS     SUPPORTED  win32 · linux        UNSUPPORTED  darwin
    arch   SUPPORTED  x64                  UNSUPPORTED  arm64
    Node   静态枚举    SUPPORTED  20 · 22 · 24

A0 的 B3 已冻结本 Step 的**最低要求**:
    「一个 cell 要算作 verified,需要满足哪一组 predicate」,
    该组 predicate 必须**逐条具名**,且至少区分
        dependency installability   原生依赖能否在该 cell 装上
        product runtime behaviour   产品自身的 platform-sensitive 路径是否被覆盖
    并已写明:第二类**不因第一类成立而被覆盖**。

A0 的 P2-R1 已把 evidence laundering 定为 RED:
    把「某一条 predicate 成立」当作「该 cell 已 verified」。
```

## 2. Frozen input —— Cell Identity(Q-A1)

### 2.1 provenance:它为什么是 input,而不是本 Step 的 decision node

Q-A1 是**交给复审裁的 architecture question**,并已于 2026-09-03 裁定 —— 时间上
**早于本 Step 的任何 criteria**。这条时间关系决定了它的层级:

```text
如果继续把它挂成 decision node V1,那么本工作线一路依赖的那句话
    「criteria 冻结于答案之前,所以判据不可能被答案塑形」
对 V1 就是**假的** —— 它的答案已经先于 criteria 出现在 git history 里。
```

处理方式**不是**把答案删掉、假装它仍未知 —— 那才是重写 evidence history。
正确的做法是承认真实 provenance,把它放到对应的层:

```text
Q-A1  =  external architecture disposition
      =  frozen prerequisite to Step A

V1    =  不再是 decision node
         没有 subject_status,没有 verdict,不进入 Stage 2 criteria
```

**本 Step 此后只有 V2 与 V3 两个 decision node**,Stage 2 也只为这两个写判据。

### 2.2 disposition(冻结)

```text
cell coordinates  =  (OS, arch, Node major)

    CellIdentity := { os, arch, nodeMajor }

install shape     ≠  coordinate
install shape     =  verification surface / scenario,
                     表达在 V2 的 predicate schema **之内**
```

### 2.3 rationale —— 复审给出的三层理由

```text
一、S_PRODUCT 冻结的支持空间就是 OS × arch × Node。
    若 V_PRODUCT 变成 OS × arch × Node × install-shape,
    将来 P3 比较「V_PRODUCT 是否足以代表 S_PRODUCT」时,两边已不是同一个坐标空间,
    还要额外解释「第四维如何投影回前三维」—— 这完全可以避免。

二、UDR 的 A1 / A2 / A4 真正证明的是:
    **同一个产品环境上存在多个不可互相替代的 verification surface**,
    而不是「支持环境本身多了一个 install-shape 维度」。
    同一个 (win32, x64, Node22) 可以要求分别验证母体安装、子项目安装、
    published 包在 mandatory 语义下的安装、以及运行时行为 ——
        cell        = environment
        predicates  = 该 environment 上必须通过的不同产品表面
    这恰好表达了 A1 ≠ A2 ≠ A4,而不污染 S_PRODUCT 的坐标系。

三、A4 尤其不适合当 axis:它不只是「另一种目录安装方式」,还含
    **published-package + required/mandatory 语义** —— 那是 package-policy scenario。
    硬塞成 environment coordinate,会把 environment / deployment surface / product
    policy 三类不同变量压成一维枚举。
```

理由二所引的那个歧义**是真的在证据里出现过的**,记录如下 —— 它现在是本 disposition
的 rationale,不再是某个节点的 candidate state:

```text
A0 全篇使用「cell」而未定义它;S_GATE 的五格写作 (os, node) 二元组,arch 隐含。
这些既有用法**不足以**消除 install-surface 歧义:

  UDR 在**同一个 (os, node) 网格**上区分了三种安装形态,
  并列为三条**互不蕴含**的 authority:
      A1  install / load compatibility        母体安装形态
      A2  scaffolded-runtime install          子项目安装形态
      A4  published-package installability    mandatory 语义
  UDR Stage 3 裁定:A1 INSTANTIATED,而 A2 NOT INSTANTIATED ——
  **同一批格子上,一种安装形态被证实、另一种从未被测过。**

在当前 governing authority 中,没有任何 source 被提名并消费为 cell-coordinate
definition;**不由此推出**仓库或历史材料中不存在相关定义。
```

### 2.4 这条 disposition 不授权什么

```text
!= 选任何 cell(Step C)          != 规定验证什么(V2)
!= 规定谁来验证、需要几次观察(Step B)
!= 修改 S_PRODUCT
```

**它只是 architecture disposition。** 具体有哪些 surface / predicate,仍然要等 V2
走完自己的 Stage 3,本 Stage 一个都不写。

### 2.5 从第一版 V1 移出的一项(记录去向)

第一版的 V1 还要求回答「同一 cell 的重复运行如何计(单次 / 多次 / 是否需要稳定性)」。
那不是「一个 cell 是什么」,而是「**需要多少 evidence 才能接受某个 predicate
result**」—— 即 evidence sufficiency,放在坐标系里会把 coordinate identity 与
evidence acceptance 混成一层。合法去向有二:

```text
若「重复稳定」本身是产品要求的性质   → V2 定义一条 stability / repeatability predicate
若只是「该 predicate 需要几次观察」  → **Step B**(Evidence Acceptance & Delegation)
```

复审倾向后者;本 Stage 只记录去向,不裁定。

## 3. Decision nodes

沿用两条独立状态轴:`subject_status` 与 `verdict`,任何一条都不得写进另一条。

### 3.0 主语的实际经过(照实记录)

复审最初的形状是单一主语「一套具名、可重复应用的 cell-verification contract」。
核对之后,它至少含三个可独立取值、且互不蕴含的决定:

```text
V1  一个 cell 是什么          —— 不定义坐标系,「该 cell 是否 verified」就没有主语
V2  必须验证哪些性质          —— B3 的正面内容
V3  怎样由逐 predicate 的结果合成一个 verification state
                              —— 缺它,「5 条里成立 4 条」无解,
                                 而 A0-P2-R1 恰恰把「拿一条当全部」定成了 RED
```

拆分本身仍然成立:这三件事确实互不蕴含。**变化的只是 V1 的层级** —— Q-A1 在
Stage 2 之前就把它裁完了,所以它按 §2.1 降为 frozen input,而不是继续留在这里
装作一个待裁的节点。本 Step 实际进入 Stage 2 的 decision node 是:

```text
V2   必须验证哪些性质
V3   predicate 结果 → verification state
```

---

### Decision V2 —— 必须验证哪些性质

```text
decision subject:    一个 cell 要被称为 verified,**必须被验证的性质集合**,逐条具名。
                     按 §2,每条 predicate 携带它所属的 **surface / scenario**
                     (母体安装 / 子项目安装 / published 包在 mandatory 语义下的安装 /
                      运行时行为 …),因为 surface 不是坐标轴而是 predicate 的一部分。
subject_status:      INSTANTIATED

current state X:     **当前没有 source 被提名、验证并消费为「可重复适用于任意 cell 的
                     verification-predicate contract」。**
                     两个最接近的东西都不是它:
                       · release-gate 的 job 步骤 —— 是 CI 配置,不是 predicate 契约;
                         A0-P2-G3 已冻结「不得默认继承 CI 配置」
                       · UDR 的 A1 / A2 / A3 / A4 —— 是**为那一次裁决**命名的 authority,
                         不是一份可重复应用于任意 cell 的契约
                     **不由此推出**仓库或历史材料中不存在相关材料。

candidate state Y:   一份 verification predicate schema。每条至少含

                         { predicateId, surface/scenario, assertion }

                     并满足 A0 的 B3 下限:逐条具名,至少区分 dependency
                     installability 与 product runtime behaviour,且后者不因前者成立
                     而被覆盖。
                     **本节点只定义「验证什么」,不填任何 cell 的结果。**

observable delta:    本文件中的一节 schema。**本 Step 不产生任何生产文件变化。**

authority boundary:  **混合。**
                       「哪些性质对本产品要紧」            产品 / 架构判断
                       「某个机制实际如何工作」            技术 authority
                       「某 cell 是否满足某条 predicate」  后续 evidence / measurement,
                                                          **不属于本 Step**

does NOT authorize:  不规定谁可以承担哪条 predicate、需要几次观察(Step B)
                     · 不规定几条成立才算 verified(V3)· 不选 cell(Step C)
                     · 不改 §2 的 CellIdentity

verdict:             UNSET
```

---

### Decision V3 —— 由 predicate 结果合成 verification state 的规则

```text
decision subject:    **输入**:某个 cell 上每条 required predicate 的结果。
                     **输出**:该 cell 的一个 **verification state**。
                     本节点只定义这个合成函数,**不涉及该 state 是否有资格进入
                     V_PRODUCT** —— 那是 Step C 的 membership policy。
subject_status:      INSTANTIATED

current state X:     **当前没有 source 被提名、验证并消费为 predicate-outcome
                     composition contract。**
                     A0-P2-R1 只钉住了一端(把一条 predicate 成立当作整格 verified
                     = RED),**另一端空着**:全部成立才算,还是允许部分成立并另记状态。
                     因此「5 条里成立 4 条」目前无解。
                     **不由此推出**仓库或历史材料中不存在相关规则。

candidate state Y:   一条合成规则。本 Stage 只冻结它**必须提供什么**,
                     **不预先给出任何候选状态名** ——

                       · 一个**有限的** verification-state 取值域
                       · 每个 state 各自的成立条件
                       · 「某条 predicate 的结果**不可得**」与「该 predicate
                         **失败**」不得被静默合并成同一个 state

                     取值域到底有几个状态、各叫什么,留给本节点自己的 Stage 2 / 3。

observable delta:    本文件中的一节规则。

authority boundary:  **产品 / 架构判断。** 它决定一个 cell 的语义强度,测量给不出门槛。

does NOT authorize:  不改 §2 的 CellIdentity · 不改 V2 的取值 · 不选 cell
                     · **不裁定某个 state 能否进入 V_PRODUCT(Step C)**
                     · 不谈代表性(那是 A0 的 P3)

verdict:             UNSET
```

**三处第一版的越界,记录在此以免回退:**

```text
一、V3 曾要求回答「若允许部分成立,该 cell 能否进入 V_PRODUCT」。
    那是 membership eligibility,属 Step C;而 V3 自己的 does NOT authorize
    又写着「不选 cell」—— 同一节点内前后冲突。已删,V3 只到 state 为止。

二、V3 曾用 `BOUNDED` 描述「只过了部分 predicate」。
    **`BOUNDED` 在 A0 里已有确切语义**:P3 coverage-justification 的一个 verdict。
    在这里复用它,会把
        cell verification completeness   (本 Step)
        V_PRODUCT → S_PRODUCT representativeness   (A0 的 P3)
    混成一件事。本 Step 一律改用中性说法:partial evidence · unresolved predicate ·
    non-verified with recorded predicate results。**不复用 P3 的 `BOUNDED`。**

三、V3 的 candidate Y 曾列出三个「起点参考」状态名。它当时不构成逻辑冲突,
    但在「criteria 先于取值」的结构里没有必要 —— Stage 2 会很自然地围着那三个名字
    写判据,然后无法回答「是判据得出了三态模型,还是三态模型提前塑造了判据」。
    已删,只留 finite domain + failure/unobtainable 区分这两条形状要求。
```

## 4. 登记但**不**回答的问题

```text
Q-A1  install shape 是否第四坐标轴?     **已裁,且已降为 frozen input** —— 不是;
                                        它是 V2 的 verification surface / scenario。
                                        见 §2;它**不是**本 Step 的 decision node。
Q-A2  文件是否按 Step 拆分?             **已裁** —— 拆,一个 Step 一份文件;
                                        见 `gate.md` §3。

Q-A3  `win32 × Node20` 是本 Step 的**压力测试 referent**,不是待答问题。
      已知且已冻结:  win32 × Node20 ∈ S_PRODUCT
      **本 Step 不得裁定**:它是否必须进入 V_PRODUCT;
                          它的哪些 predicate 必须由 runner 实证;
                          哪些可由 delegated evidence 承担。
      两个方向的偷跑都要防:
        不得因为它难测,就把它从 predicate 定义里绕开;
        也不得因为它属于 S_PRODUCT,就提前规定它必须成为 runner cell ——
        后者属于代表性问题,是 A0 的 P3,不是 B3。
```

## 5. Stage 2 之前不得做的事

```text
不写 GREEN / RED                     不写 required authority
不写 missing-authority disposition
不回答 Q-A3
不选任何 V_PRODUCT cell              不写任何 predicate 的具体内容
不裁定 win32 × Node20 的 membership 或 runner requirement
不裁定 V2 / V3(本 Step 仅有的两个 decision node)
不修改任何生产文件
不把 Q-A1 重新表述成「在 criteria 之后才裁的」—— 它先于 criteria,见 §2.1
不回改 A0 gate 已冻结的任何内容 —— 包括那句 `P2 = DEFERRED`
```

全局与分 Step 的非授权见 `gate.md` §4。
