# Step A —— Cell Verification Contract (B3)

- 所属:`gate.md`(V_PRODUCT Definition Gate)—— 全局纪律与 Step 顺序见该文件
- baseline:`main@a3f7395`

```text
STAGE 1 — DECISION SUBJECT CONTRACT        ·  FROZEN @ a4e747da
本 Stage 只回答「到底在裁什么」。本 Step 的 decision node 是 **V2 与 V3 两个**。
不写 GREEN / RED,不写 required authority,**不裁定 V2 / V3**,
**不选任何 V_PRODUCT cell**,**不写任何 predicate 的具体内容**,不改任何生产文件。

cell identity(Q-A1)**不是**本 Step 的 decision node —— 它已在本 Stage 之前
被裁定,作为 frozen input 进入,见 §2。
```

```text
Stage 1  decision subjects · X→Y · authority boundary · non-authorization
             FROZEN @ a4e747da        —— §1 – §5 不再改动
             ↓ COMMIT + REVIEW
Stage 2  required authority · GREEN iff · RED iff · missing-authority disposition
             FROZEN @ c39f5919        —— §6 不再改动
             ↓ COMMIT + REVIEW
Stage 3  消费 authority · 填 verdict
             ← 当前,见 §7
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

---

## 6. Stage 2 —— criteria(V2 / V3)

```text
STAGE 2 — CRITERIA ONLY                    ·  FROZEN @ c39f5919
写:   required authority · GREEN iff · RED iff · missing-authority disposition
      · V2 与 V3 之间的依赖与求值规则
不写: 任何 verdict · 任何 predicate 的具体内容 · 任何 state 的名字
      · 任何 cell · 任何 evidence
不改: Stage 1 的任何主语(已冻结于 a4e747da)· 任何生产文件

Q-A1 不进入本 Stage —— 它是 frozen input,不是节点(§2.1)。
```

判据的书写形式受一条硬约束:

```text
判据只能描述 candidate 的**性质**,不得描述它的**内容**。
    允许:「每条 predicate 必须写明它覆盖什么、不覆盖什么」
    禁止:「schema 必须包含一条 XXX predicate」
后者会把 Stage 3 变成照判据抄答案,判据本身也就失去判别力。
```

### 6.1 评价对象:candidate,不是当前仓库

```text
评价对象  =  Stage 3 提出的 schema / rule(candidate)
          ≠  「当前仓库里已经有什么」
```

没有任何判据可以把「某生产文件当前是否含有 X」当作成立条件。若某条判据只能靠改生产
代码来满足,那就是让 implementation 反过来决定 decision —— `gate.md` §4.1 明令禁止,
这也是 A0 Stage 2 复审当场改掉过的同一形态。

### 6.2 verdict 取值域、总裁决函数与 missing-authority disposition

```text
verdict ∈ { GREEN, RED, DEFERRED }        —— V2 / V3 相同

求值顺序(总函数,第一个命中者即为 verdict):
    1  命中任一 RED 条件            → RED
    2  否则 GREEN 的全部条件成立     → GREEN
    3  否则                        → DEFERRED
```

两条不变量:

```text
RED 是**充分条件**,不因某项 required authority 缺失而被抹掉。
    先判 RED,再看 authority —— 一份自己就在洗证据的 candidate,
    不会因为「反正材料还不齐」而逃过 RED。

DEFERRED 是**兜底**,不等于「缺 authority」。缺 authority 只是它的来源之一。
```

required authority 的状态取值 —— **沿用 A0 与 UDR 已在用的写法,不新造词**:

```text
INSTANTIATED        已被提名、验证并消费
NOT INSTANTIATED    已具名,但本轮不存在可消费的实例
NOT APPLICABLE      条件性 authority,其触发条件未成立
```

两份已冻结记录靠**下划线**区分两条轴,本文件照办:

```text
subject_status   写作 NOT_INSTANTIATED   (带下划线)  UDR §105 / §1488
authority 状态   写作 NOT INSTANTIATED   (带空格)    A0 §878 / UDR §1218

本 Step 的两个节点 subject_status 均为 INSTANTIATED(Stage 1 已冻结),
因此本文件里出现的带空格形式**一律指 authority 状态**。
```

任何**已触发**的 required authority 为 `NOT INSTANTIATED` 时,依赖它的 GREEN 条件
不成立;在没有 RED 的情况下 → DEFERRED。

DEFERRED 必须同时记录 `deferral_reason`。三个取值会**同时成立**(没有 candidate 时
authority 通常也没实例化),因此它不能是「挑一个」,必须是一个**确定的函数**:

```text
若 verdict = DEFERRED,按顺序取第一个命中者:

    1  该节点本轮没有 candidate
           → CANDIDATE_ABSENT
    2  否则,存在任一**已触发**的 required authority = NOT INSTANTIATED
           → MISSING_AUTHORITY
    3  否则
           → CANDIDATE_FAILS_CLAUSE
              candidate 已提出、材料齐备,但某条 GREEN 不成立
              —— 这**不是**「还差材料」,是「这份 candidate 不够」
```

顺序不是任选的:排在前面的是**更靠近源头的阻塞**。没有 candidate 时谈「哪条 GREEN
不成立」没有对象;材料没齐时谈「candidate 不够」会冤枉一份可能本来合格的 candidate。

```text
记录一条**不蕴含**其余两条不成立。Stage 3 可以在散文里写明还同时缺什么,
但 ledger 字段只取上面这个函数的输出 —— 否则 reason 自己就不确定,
而它存在的全部目的正是让 ledger 不误导。
```

不加 `CANDIDATE_FAILS_CLAUSE` 这一格,一份写坏的 candidate 会以「authority 未就绪」的
面貌进入 ledger,读者据此以为补材料即可,而真正要做的是重写 candidate。

### 6.3 为什么不设中间 verdict —— 且不留无 verdict 的出口

本 Step **不定义中间 verdict**,也不复用 A0 P3 的 `BOUNDED`(Stage 1 已冻结此项)。

```text
V2 / V3 的主语都是「一份 contract 是否成立」,不是「它覆盖了多少」。
一份**只要求较少 predicate、但把残余写明**的 schema,按 §6.5 是可以 GREEN 的 ——
它的弱不体现在 verdict,而体现在它自己写下的 residual。
「野心小」不构成中间态。
```

第一版在这里留了一个**无 verdict 的出口**:candidate 只在 CellIdentity 的真子集上
成立时「停下上报,不发 verdict」。那与上一节自称的**总函数**直接冲突 —— 取值域要么是
闭合的三态,要么不是,不能对某类合法 candidate 例外。已删。该情形的正确去向:

```text
candidate 只在 CellIdentity 的真子集上成立
    → 它没有满足自己的 subject:V2 的 schema 本就要求对**给定任一 cell**
      给出 required predicate 集合(G-V2-4 的参数化要求)
    → G-V2-4 不成立
    → 无 RED 时 → DEFERRED / CANDIDATE_FAILS_CLAUSE
```

这不是把问题藏进 DEFERRED:`CANDIDATE_FAILS_CLAUSE` 恰好说明的就是「材料齐备,是这份
candidate 不够」,并且 ledger 会指名是哪一条 GREEN 不成立。

```text
若 Stage 3 认为三态确实不够用,那是一次 **Stage 2 判据修订** ——
退回本节、改判据、重新冻结、重新复审,
**不得**在 Stage 3 就地扩张 verdict 取值域。
```

### 6.4 V2 —— required authority

编号用 `A-V2` / `A-V3` 前缀。**与 A0 的 `B0–B7`、UDR 的 `A0–A9` 不共享,不得互相顶替**
—— 沿用 A0 §5.2 立下的同一条纪律。

```text
A-V2-1  product-property & surface-taxonomy declaration authority   UNCONDITIONAL

        必须给出:**项目所有者**(或所有者显式委派的 product / architecture
        authority)的声明,内容为
            (a) 哪些性质是「一个 cell 被称为 verified」必须验证的
            (b) 这些性质要覆盖哪些 surface / scenario
        并给出理由。

        issuer 是本项的一部分,不是形式要件。**「存在一份声明」不等于「声明者有
        authority」** —— 没有 issuer 约束时,Stage 3 可以自己写一句
        「我声明这些性质要紧」再把它消费成 A-V2-1,那是 self-authorization,
        由 R-V2-6 判 RED。判的是**来源**,不是这段文字最终誊写在哪个文件里
        (见 §6.6 R-V2-6)。

        (a) 与 (b) 合为一项,不拆:两者是同一类问题(产品意图),同一个 issuer,
        且没有任何一方可以独立实例化 —— Stage 1 已冻结「每条 predicate 携带其
        surface」,所以一份只答 (a) 的声明无法产出一份可用的 schema。

        与 A0 的 B1 同型(产品意图类,测量产生不了),但**不继承** A0 §5.1 给
        normative authority 的三态(明确否定 → RED)。那三态适用于「声明一个命题」;
        本项声明的是**内容**,其反面只是另一份内容不同的声明,不构成对命题的否定。

A-V2-2  mechanism authority                               CONDITIONAL
        触发条件:某条 predicate 的 assertion **描述某个机制的实际行为**。
        纯规范性断言(「必须成立」)不触发。

        实例化条件(最低成立门槛):
            该实例必须**独立于 candidate 的断言本身**,建立该断言所依赖的机制
            实际如何行为,以及该行为在什么 scope / version 范围内成立。
            **candidate 复述一遍同一事实不构成 authority** —— 那是断言,不是它的依据。
        判据不规定该实例必须是代码、文档还是实测,也不规定要观察几次 ——
        那属于 Step B,本 Step 不得侵入。

A-V2-3  —— 已并入 A-V2-1。编号留空,不再复用。
        它原为「surface-definition authority(条件性:仅当 schema 使用 surface 区分)」。
        两个缺陷:其一,Stage 1 已冻结每条 predicate 都带 surface,**触发条件恒真**,
        「条件性」是假的;其二,它写的是「surface 集合必须在 schema 内自行定义」——
        那是 candidate 的**结构要求**,回答不了「谁授权这套 taxonomy 是产品需要覆盖的」。
        结构要求移入 G-V2-8,授权问题归 A-V2-1。

A-V2-4  scope-derivation authority                        CONDITIONAL

        触发条件由 scope 的**语义**决定,不由它最后写成集合表达式还是逐项列举决定:

            TRIGGERED —— applicability scope 的语义是
                「所有满足某特征 F 的对象」「某类对象的完整集合」,
                或其他**需要 derivation 才能证明完备性**的集合。
                **即使 candidate 把当前成员逐条列出,仍然 TRIGGERED** ——
                逐条列举是 derivation 的**输出**,不是 derivation 本身。

            NOT APPLICABLE —— 当且仅当 predicate 的规范性 scope 本身就是一个
                固定、显式具名的有限集合,**且 candidate 不声称**该列表是某个更大的
                特征定义域的完整枚举。

        两者的差别只在有没有那句完备性主张:

            「本 predicate 只覆盖 A、B、C,其余明确属于 residual」   → NOT APPLICABLE
            「本 predicate 覆盖所有具备特征 F 的路径;它们是 A、B、C」 → TRIGGERED
                                                                     必须回答为什么没有 D

        这与 G-V2-3 的 residual 设计是同一条:**野心小可以,但必须承认野心小**;
        不能把 derivation 的结果手抄成列表,来伪装成不需要 derivation。

        实例化条件(最低成立门槛):
            该实例必须给出**可追溯的集合来源**,或一条**可重复执行的推导规则**,
            足以让第三方重新得到该 predicate 所声称的 applicability set。
            **「candidate 列了这几项」本身不是 derivation authority** ——
            那是结论,不是得到结论的方法;它无法回答「有没有漏」。
        同样不规定来源形式,那属于 Step B。
```

两项**条件性** authority 的实例化条件写在这里,是因为 G-V2-7 只说「已触发的必须
INSTANTIATED」,却没说什么才算 INSTANTIATED。没有这两段,`INSTANTIATED` 就是一个
**没有判据的标签**:candidate 写一句「机制就是这样」,Stage 3 把它命名为 mechanism
authority,再标成已实例化。

A-V2-1 的实例化必须沿用 A0 已经跑通的次序:

```text
判据先冻结  →  声明后给出  →  逐字记录并注明日期与 issuer
```

A0 的 B1 就是这样做的(判据早于 owner declaration 四个 commit),这条 git 次序本身
就是「不是先看答案再定规则」的证据。

### 6.5 V2 —— GREEN iff(以下全部成立)

```text
G-V2-1  schema 逐条具名 predicate,每条至少含
            { predicateId, surface/scenario, assertion }

G-V2-2  满足 A0 的 B3 下限:至少区分 dependency installability 与
        product runtime behaviour,且后者的成立**不由**前者成立推出。

G-V2-3  每条 predicate 写明它**覆盖什么、不覆盖什么**(residual 显式)。
        判据不要求 residual 小,只要求它被写出来。

G-V2-4  schema **参数化于 CellIdentity**:它规定「给定一个 cell,required predicate
        集合是什么」,而不是逐个 cell 手工列举。
        允许某条 predicate 的 required 与否取决于坐标(例如只在某 OS 上要求),
        但该条件必须写在 schema 里,且**只依赖 CellIdentity**。

G-V2-5  每条 predicate 的 assertion **可判定**:schema 写明什么事实构成它**成立**,
        以及什么事实构成它**不成立**。
        不规定由谁观察、观察几次、何种 evidence 足够 —— 那是 Step B。
        第一版只要求写出 falsifier(什么使它为假),不要求写出成立条件;
        而 V3 的 outcome domain 已被 G-V3-2 要求语义区分「成立 / 不成立 / 不可得」,
        只给一半的 assertion 无法被求值到那个取值域上。
        本条不规定这两类事实各自叫什么 —— outcome taxonomy 归 V3(§6.10)。

G-V2-6  —— 已删除。编号留空,不再复用。
        它原为「若 schema 自行规定了单条 predicate 的结果取值域,须与 V3 的一致」。
        那句「若…则与 V3 比较」本身就是一条 **conditional LOGICAL edge**:V3 的
        candidate 尚不存在时,该条根本无法求值 —— 而 §6.10 同时冻结着「V2 / V3 可
        独立裁决、顺序任意」。嘴上说无边、判据里连一条,是不能同时成立的。
        替代:outcome domain **唯一归 V3**(§6.10),V2 越界由 R-V2-7 判 RED ——
        该项只看 V2 自己的文本,不引用 V3,因此不产生边。

G-V2-7  §6.4 中所有**已触发**的 required authority 状态均为 INSTANTIATED。

G-V2-8  schema 使用的 surface / scenario 集合在 schema **内部**给出定义,
        每个 surface 说明它指的是哪一种产品表面。
        允许引用 UDR 的 A1/A2/A4 作 provenance,**不得**据以继承 authority
        (授权归 A-V2-1;继承由 R-V2-4 判 RED)。
        —— 本项由已作废的 A-V2-3 移入:它是 candidate 的结构要求,不是一项 authority。
```

### 6.6 V2 —— RED iff(命中任一即 RED)

```text
R-V2-1  laundering:schema 允许「某一条 predicate 成立」被当作「该 cell 已 verified」。
        —— A0-P2-R1 的直接继承。

R-V2-2  某条 predicate 的覆盖范围**不可界定** —— 以无边界断言充当 predicate
        (「产品正常工作」「测试通过即可」之类),且未写明其边界。
        它会让 V3 的合成对象不确定,并使「该 cell verified」变成不可证伪的主张。

R-V2-3  某条 predicate **是否 required**,在 evidence 阶段才决定,或取决于该 cell 的
        实际观察结果。—— 「先看结果、再写判据」在 predicate 层的形态。

R-V2-4  schema 直接**继承** UDR 的 A1/A2/A4 或 release-gate 配置,作为自身的 surface
        或 predicate 权威,而不在 schema 内自行定义。
        —— reference ≠ authority;A0-P2-G3 亦已冻结「不得默认继承 CI 配置」。

R-V2-5  schema 的**成立**以修改某个生产文件为前提。
        注意区分:某条 predicate 在当前产品上会**失败**,不属本项 —— 那是 cell 的结果,
        属后续 Step;predicate 有权要求产品尚未具备的性质。

R-V2-6  self-authorization —— 判的是 **provenance,不是文字写在哪个文件里**。

            RED:  adjudicator / candidate 作者自己产生的产品判断,
                  被当作 owner 或委派者的 authority 消费。
            不是 RED:  在本文件中**逐字转录**一份独立作出的 owner / 委派者声明,
                  并记明 issuer、日期与可追溯的来源,然后消费它。

        A0 的 B1 走的正是后一条路径 —— 声明由所有者作出,逐字誊写进 decision record
        再消费。若按「文字出现在 gate 文件里就算自证」来判,连合法记录 owner 声明这件事
        都做不了。**file location ≠ authority provenance。**

R-V2-7  boundary violation:schema 自行建立一套**单条 predicate 的结果取值域**。
        该边界已由 §6.10 划归 V3。V2 的 assertion 只需写明「什么事实使它成立 / 不成立」
        (G-V2-5),不拥有 outcome taxonomy 的定义权。
        本项只检 V2 自己的文本,**不引用 V3 的 candidate**,因此不产生 verdict 边。
```

### 6.7 V3 —— required authority

```text
A-V3-1  composition-declaration authority                 UNCONDITIONAL

        必须给出:**项目所有者**(或所有者显式委派的同层级 architecture / product
        authority)的声明,内容为 verification-state 取值域如何划分、每个 state 在
        何种结果组合下成立,并给出理由。

        Stage 1 已冻结:这是产品 / 架构判断,测量给不出门槛。
        与 A-V2-1 同样,**issuer 是本项的一部分** —— 本 gate 自己写下的划分不是它的
        实例,那是 self-authorization,由 R-V3-5 判 RED。

        注意:A-V3-1 **不能**覆盖「verified state 必须要求全部 required predicate
        satisfied」这一条(G-V3-4)。那条来自上游已冻结的 A0-B3,不在本声明的处分范围内。

无技术 authority 需求。 若 Stage 3 发现某个 state 的成立条件需要技术事实才能判定,
那说明 V3 的 candidate 越过了自己的主语 —— 应当修 candidate,**不得**顺势新增一项
authority 把它合法化。
```

### 6.8 V3 —— GREEN iff(以下全部成立)

```text
G-V3-1  规则给出一个**有限**的 verification-state 取值域,并逐个给出成立条件。

G-V3-2  规则显式给出**单条 predicate 的结果取值域**,且该取值域至少在**语义上**区分
        以下三类,三者互不合并:

            1  assertion 成立        (G-V3-4 的 satisfied 所指)
            2  assertion 不成立      (失败)
            3  结果不可得            (没看,而非看了不过)

        **三者叫什么名字由 candidate 决定,判据不给 token。**
        第 2 / 3 类的分离是 Stage 1 已冻结的形状要求;第 1 类是本轮补上的 ——
        没有一个可明确解释为「assertion 成立」的取值,G-V3-4 的「每条 required
        predicate 均为 satisfied」就没有机械可判的语义载体,取值域写成
        {失败, 不可得, 其它} 也能形式上满足本条。

G-V3-3  规则是**全函数**:对该取值域上每一种可能的结果组合都有定义,没有落空组合。

G-V3-4  规则指明取值域中**哪一个 state 承载「该 cell 已 verified」这一主张**,
        且**该 state 的成立条件要求每一条 required predicate 均为 satisfied**。
        其余 state 怎么划分(失败 / 不可得 / 部分证据 / 多少条成立 …)是 V3 的自由,
        判据不规定,也不限制状态个数。

G-V3-5  规则**参数化于 required predicate 集合**:对任意条数、任意 predicateId 都成立,
        不依赖 V2 最终列出哪些 predicate(§6.10)。

G-V3-6  §6.7 中所有已触发的 required authority 状态均为 INSTANTIATED。
```

**G-V3-4 关掉了 Stage 1 记为「空着」的那一端 —— 这一步必须说清楚。**

```text
Stage 1 的 V3 描述 current X 时写:A0-P2-R1 只钉住一端,
「全部成立才算,还是允许部分成立并另记状态」空着。
本 Stage 第一版据此写下 G-V3-4「判据不规定该条件」。

那是**读漏了上游**。A0 的 B3 冻结的原文是:
    「一个 cell 要算作 verified,**需要满足**哪一组 predicate」
一组 predicate 被 V2 定为 required,而其中一条未 satisfied 时该 cell 仍叫 verified,
`required` 这个词就没有语义了 —— 那不是 V3 的设计自由,是在削弱已冻结的 B3。
```

```text
这不是 Stage 2 偷写 V3 的答案:
    Stage 2 的职责就是**消费上游 authority 并把它变成判据**,而 B3 已经定了这一条。
    真正留给 V3 的自由仍然完整 —— 有几个 state、其余 state 怎么划、
    「不可得」落在哪里、部分证据如何表达,判据一律不管。
    V2 那一侧的自由也不受影响:required 列得少、把 residual 写清楚,依然可以 GREEN。
    收紧的只有一句:**被列为 required 的,失败了就不叫 verified。**
```

### 6.9 V3 —— RED iff(命中任一即 RED)

```text
R-V3-1  「verified」state 在**某条 required predicate 非 satisfied** 时仍可成立 ——
        无论该结果是失败、不可得,还是根本没有结果。
        这是 A0-P2-R1 在合成层的形态,也是 `required` 一词的语义底线。
        (第一版这里写的是「未**记录**哪些未成立才 RED」,即允许「记录在案的部分成立」
        仍叫 verified。那已被 G-V3-4 推翻,见上一节。)

R-V3-2  「结果不可得」与「结果为失败」被映射到同一个 state,且规则未写明这是**有意为之
        并给出理由**。—— 两者不同:一个说产品坏了,一个说我们没看。

R-V3-3  规则对某些结果组合无定义(非全函数),从而要靠 Stage 3 临场补齐 ——
        而「5 条里成立 4 条无解」正是 V3 存在的理由。

R-V3-4  规则复用 A0 P3 的 `BOUNDED` 作为 state 名(Stage 1 已冻结不复用)。

R-V3-5  self-authorization:adjudicator / candidate 作者自己作出的状态划分,
        被当作 owner 或委派者的 authority 消费。
        —— 与 R-V2-6 完全同型,包括那条区分:逐字转录一份独立作出的声明并注明
        issuer / 日期 / 来源,**不是**本项;判的是 provenance,不是文字写在哪里。
```

### 6.10 V2 与 V3 的依赖:没有 verdict 传播边

按 UDR 冻结的四种边类型逐个检验:

```text
LOGICAL?                  否。
    合成规则可以对**任意** predicate 列表参数化 —— 形如「所有 required predicate
    成立才算某 state;不可得落在另一个 state」的规则,在不知道 V2 最终列出哪些
    predicate 时就已完全可判定。因此 V3 的 GREEN **不需要** V2 先 GREEN。
EVIDENCE_PREREQUISITE?    否。两者都不消费 cell evidence(那在 Step B / C / D)。
SUBJECT_INSTANTIATION?    否。两个节点的 subject_status 在 Stage 1 已同为 INSTANTIATED。
IMPLEMENTATION_COUPLING?  否。本 gate 不产生实现。

结论:V2 与 V3 **可独立裁决,顺序任意**。
Stage 3 **不得**制造「V2 = DEFERRED,所以 V3 也 DEFERRED」——
那是把一条没有任何边支持的依赖塞进 ledger。
```

唯一真实的耦合是**边界归属**,不是 verdict:

```text
问题:「单条 predicate 的结果可以取哪些值」由谁定义?

Stage 1 没有裁定它。**本 Stage 做出分配**(这是 Stage 2 的行为,不是对 Stage 1 的
转述,复审可据此驳回):

    **唯一归 V3**,V2 不拥有这项定义权(不是「可以定义但要一致」)。
    理由:V3 的主语就是 outcome → state 的合成,而 Stage 1 已经要求它区分
    「不可得」与「失败」—— 那本身就是一条关于单条结果取值域的规定。

    V2 那一侧只需 G-V2-5:写明什么事实使某条 assertion 成立 / 不成立。
    越界(自建一套 outcome taxonomy)由 R-V2-7 判 RED。
```

**「唯一归属」与「可定义但须一致」的差别不是措辞,而是有没有一条边:**

```text
第一版写的是 G-V2-6「若 V2 定义了,须与 V3 一致」。
    V3 的 candidate 尚不存在时,这一条无法求值
    → 事实上就是一条 conditional LOGICAL edge:V2 的裁决要等 V3
    → 与本节冻结的「可独立裁决、顺序任意」直接冲突。

改成唯一归属后,R-V2-7 只问「V2 自己的文本里有没有一套 outcome taxonomy」,
不引用 V3 的任何内容 → 两个节点的 verdict 仍然正交。
```

### 6.11 突变自检:逐条承重判据,拿掉它什么会通过

一条判据说不出「拿掉它什么会通过」,就说明它没有承重,应当删掉而不是留着凑数。
下面覆盖 §6.5 – §6.9 的**全部** GREEN / RED 条款,外加 §6.2 的一格。

```text
G-V2-1 拿掉  →  predicate 可以只有散文描述,没有 id 与 surface,
                V3 无法逐条引用它们,合成函数没有可寻址的输入。
G-V2-2 拿掉  →  A0-B3 的下限失守:一份只验「依赖装得上」的 schema 即可 GREEN,
                而 B3 恰恰写明第二类不因第一类成立而被覆盖。
G-V2-3 拿掉  →  运行时行为 predicate 可以不写残余,
                「验了运行时行为」与「验了其中一小块」在工件上无法区分。
G-V2-4 拿掉  →  schema 退化成逐 cell 手工列举:V_PRODUCT 加一格就要重写契约,
                且「这一格为什么少要求一条」无从追问。
G-V2-5 拿掉  →  predicate 可以写成不可判定的断言,
                「它成立」与「它不成立」在观察上无差别,V3 的输入随之失去意义。
G-V2-5 只要求 falsifier、不要求成立条件(第一版的写法)
             →  assertion 只有一半可判:什么使它为假写了,什么使它为真没写。
                G-V3-2 要求 outcome domain 语义区分「成立 / 不成立 / 不可得」,
                这种半条 assertion 求值不到「成立」那一类上。
G-V2-7 拿掉  →  已触发但未实例化的 authority 不再阻挡 GREEN,
                一份没有 owner 声明支撑的 schema 可以直接 GREEN。
G-V2-8 拿掉  →  surface 名字可以只出现在 predicate 行里而从不定义,
                「子项目安装」到底指什么由读者各自脑补。
R-V2-1 拿掉  →  evidence laundering 回来:一条 predicate 成立即可宣称整格 verified,
                A0-P2-R1 在 schema 层被绕过。
R-V2-2 拿掉  →  「测试通过」即可充当 product-runtime predicate,
                该 cell 的 verified 主张变成不可证伪。
R-V2-3 拿掉  →  可以先跑一遍,再把跑通的那些定为 required —— 本工作线的签名缺陷。
R-V2-4 拿掉  →  UDR 的一次性 authority 被当作可重复契约继承,
                V2 已冻结的 current X 被绕过。
R-V2-5 拿掉  →  判据可以要求先改生产代码才成立,
                implementation 反过来决定 decision。
R-V2-6 拿掉  →  Stage 3 自己写一句「这些性质要紧」,再把它消费成 A-V2-1;
                A-V2-1 的 issuer 约束形同虚设。
R-V2-6 若按「文字写在 gate 文件里」来判(第一版的读法)
             →  反向误杀:逐字转录 owner 声明再消费 —— A0 的 B1 用的正是这条路径 ——
                会被判红,Stage 3 连合法记录声明都做不了。
R-V2-7 拿掉  →  V2 自建一套 outcome taxonomy,与 V3 的取值域并存;
                两者互不传播,冲突要到 Step D 才炸。
                (若改回 G-V2-6 那种「若定义了须与 V3 一致」,则等于承认一条
                 conditional LOGICAL edge,§6.10 的正交性当场失效。)
G-V3-1 拿掉  →  state 取值域可以无限或开放,「该 cell 处于哪个 state」不可判定。
G-V3-2 拿掉  →  单条结果的取值域没写,或把「不可得」并进「失败」,
                G-V3-4 的「全部 satisfied」也就无从判断。
G-V3-2 只保留「失败 ≠ 不可得」而不要求存在「成立」这一类(第一版的写法)
             →  取值域可以是 {失败, 不可得, 其它},形式上满足本条,
                但 G-V3-4 的 `satisfied` 没有语义载体,「全部 satisfied」不可机械判定。
G-V3-3 拿掉  →  「5 条成立 4 条」在规则里无定义,靠 Stage 3 临场补,
                而这正是 V3 存在的理由。
G-V3-4 拿掉  →  被列为 required 的 predicate 失败,该 cell 仍可叫 verified,
                `required` 一词失去语义,A0-B3 被削弱。
G-V3-5 拿掉  →  合成规则可以绑死在某个具体 predicate 列表上,
                V2 一改就得重写 V3,两个节点之间凭空长出依赖。
G-V3-6 拿掉  →  同 G-V2-7,在合成层。
R-V3-1 拿掉  →  G-V3-4 只剩正面要求而没有对应的 RED:
                一份把「verified」条件写松的规则不会被判红,只会 DEFERRED。
R-V3-2 拿掉  →  「我们没看」被记成「它坏了」或反之 ——
                两类完全不同的后续动作被合并成一个 state。
R-V3-3 拿掉  →  同 G-V3-3 的反面:非全函数不再被判红,
                缺口留到 Stage 3 临场填。
R-V3-4 拿掉  →  `BOUNDED` 被借去当 state 名,cell 验证完整度与 P3 代表性混成一词。
R-V3-5 拿掉  →  同 R-V2-6,在合成层。
§6.2 的 CANDIDATE_FAILS_CLAUSE 拿掉
             →  写坏的 candidate 以「authority 未就绪」的面貌进入 ledger,
                读者以为补材料即可。
§6.2 的 reason 优先级拿掉
             →  三个取值同时成立时 Stage 3 各记各的,
                同一种阻塞在 ledger 里呈现成不同原因。
A-V2-2 的实例化条件拿掉
             →  candidate 写一句「机制就是这样」,Stage 3 命名它为 mechanism authority
                并标 INSTANTIATED;断言自己给自己当依据。
A-V2-4 的实例化条件拿掉
             →  「candidate 列了这几项」即算 derivation authority;
                「有没有漏」这个问题永远不会被问出来。
A-V2-4 的触发条件按**书写形式**判(第一版:逐条具名即 NOT APPLICABLE)
             →  绕过路径:声称「覆盖所有具备特征 F 的路径」,再把它们逐条抄出来,
                于是同一个完备性主张不必再回答「为什么没有 D」——
                实例化条件写得再对,也在触发这一步就被跳过了。
```

### 6.12 Stage 3 之前不得做的事

```text
不填 V2 / V3 的 verdict            不写任何 predicate 的具体内容
不写任何 verification-state 的名字  不消费任何 cell evidence
不选任何 V_PRODUCT cell            不提名 equivalence class(`gate.md` §4.2)
不裁 win32 × Node20 的 membership 或 runner requirement
不改 Stage 1 的任何主语             不创建 Step B 文件
不修改任何生产文件                  不回改 A0 gate 已冻结的任何内容

verdict 取值域是闭合三态。若认为不够用 → 退回 §6.3 修判据、重新冻结、重新复审,
**不得**在 Stage 3 就地扩张取值域,也不得对某类 candidate 不发 verdict。

A-V2-1 / A-V3-1 的实例必须来自项目所有者或其显式委派者,逐字记录并注明日期与 issuer;
本 gate 自己写下的判断不是它们的实例(R-V2-6 / R-V3-5)。
```

---

## 7. Stage 3 —— 消费 authority · 填 verdict

```text
STAGE 3 — ADJUDICATION
Stage 1 冻结于 a4e747da,Stage 2 冻结于 c39f5919,**两者都不再改动**。
本 Stage:提名 V2 / V3 candidate · 消费 A-V2-* / A-V3-* · 按已冻结判据独立裁决 ·
填 verdict 与(若 DEFERRED)deferral_reason。

仍然禁止:改 Stage 1 / Stage 2 · 用 cell evidence 决定 predicate 内容 ·
选 V_PRODUCT cell · 提名 equivalence class · 裁 win32×Node20 的 membership 或
runner requirement · 创建 Step B 文件 · 改任何生产文件 · 重裁 A0 的历史 P2。
```

### 7.1 先决:两项声明类 authority 只能由 owner 实例化

`A-V2-1` 与 `A-V3-1` 都是**产品意图**类 authority。按 `R-V2-6` / `R-V3-5`,本 gate
作者代写一份产品判断再自我消费即判 RED —— 因此在 owner 或其显式委派者作出声明之前,
两个节点都不可能取到 GREEN。

本节先把**要问的问题逐字登记下来,不带任何答案**,提交后再请 owner 作答。这样 git 顺序
证明的不只是「判据早于答案」,还包括**「问题早于答案」** —— 后者同样可能被答案塑形。

```text
c39f5919   判据冻结
    ↓
本 commit  问题登记,无答案
    ↓
后续       owner 声明,逐字记录 issuer / 日期 / provenance
    ↓
再后       candidate 提名 + 裁决
```

### 7.2 A-V2-1 待答两问(登记,未答)

```text
Q-S1  运行时行为那一侧,契约**主张覆盖到什么程度**?

      这一问决定 A-V2-4 是否触发,而不只是决定野心大小:
          主张「覆盖所有具备某特征的行为」   → A-V2-4 TRIGGERED,
                                              须交出可重复的 derivation rule
          主张「覆盖这几条,其余属 residual」 → A-V2-4 NOT APPLICABLE
      两者都可以 GREEN(G-V2-3 只要求残余被写出来,不要求残余小)。

Q-S2  哪些 **surface / scenario** 必须被这份契约覆盖?

      备选来自 UDR 已区分过的几种安装形态与运行时行为。注意一处措辞差异:
      UDR 的 A4 带 **mandatory 语义**,而 UDR 已裁定 D3 = RED(被现行产品政策挡住);
      因此此处若选「published 包」,指的是**按当前 optional 语义发布的包**,
      不是 mandatory —— 本 gate 无权改动那条政策。
```

### 7.3 A-V3-1 待答一问(登记,未答)

```text
Q-S3  verification state 的取值域怎么划?

      判据已冻结的约束(不由本问处分):
          G-V3-4  承载「该 cell 已 verified」的那个 state,必须要求每条 required
                  predicate 均为 satisfied —— 来自 A0-B3,不在本声明的处分范围内。
          R-V3-2  若把「结果不可得」并入「不成立」,必须写明这是有意为之并给理由。
      本问处分的是:取值域有几个 state、各自的成立条件、「不可得」落在哪里。
```

### 7.4 此刻两个节点的状态

```text
V2  verdict = UNSET        V3  verdict = UNSET
```

```text
UNSET **不是** DEFERRED。
DEFERRED 是一个裁决结果,要走完 §6.2 的求值顺序才能得到;
现在 candidate 尚未提名、authority 尚未实例化,裁决**还没有开始**。
此刻写 DEFERRED,就是把「还没开工」记成「已裁定为待定」。
```

> 以下 §7.5 起在 `db8d92b9`(问题登记)之后写入。
>
> ⚠ **§7.5 – §7.12 是第一次 Stage 3 裁决,已被独立复审推翻(2026-09-03)。**
> 保留不擦除 —— 它是「一次裁决被外部复审驳回」的证据本身。
> 更正后的 authority consumption 与 re-adjudication 见 **§7.13**;
> 当前 live verdict 以 §7.13 为准,§7.9 / §7.10 的两个 GREEN 已作废。

### 7.5 owner declaration —— 逐字记录

```text
issuer      项目所有者(uwence)
date        2026-09-03
channel     本工作会话中的交互式提问
provenance  问题登记于 db8d92b9,**先于任何答案存在**;
            判据冻结于 c39f5919,更早。
```

**四问四答,逐字**:

```text
Q-S1  运行时行为那一侧,这份契约主张覆盖到什么程度?
A-S1  「具名有限集 + 显式 residual」

Q-S2  哪些 surface / scenario 必须被这份契约覆盖?
A-S2  「母体安装 + 子项目 scaffold 安装 + 运行时」

Q-S1b(A-V2-1(a) 待完成)运行时那一侧,哪些性质是 required?
A-S1b 「核心链路三条」= ① 原生依赖在该 cell 上装得上并能被加载
                        ② 内存索引完成一次 开→写→查→关 且不泄句柄
                        ③ Windows 非 ASCII 路径下的路径包容不越界
      其余(hooks 安装/执行 · takeover receipt · wiki 打开命令 · 锁并发)
      明写为 residual。

Q-S3  verification state 的取值域怎么划?
A-S3  「三态:verified / not-verified / indeterminate」
```

**关于 provenance 的一处诚实交代**(供复审据以驳回):

```text
备选项的**措辞由本 gate 撰写**,owner 作出的是**选择**,并可在备选之外自由作答。
A-V2-1 要求的是 owner 对「哪些性质要紧」的声明 —— 提出候选是提名,作出选择是声明,
两者分属 candidate 与 authority,这正是 R-V2-6 划的那条线:
判的是 authority 的来源,不是文字由谁敲进文件。

若复审认为备选措辞已窄到使「选择」不再构成独立声明,那么 A-V2-1 应判 NOT
INSTANTIATED,V2 随之 DEFERRED / MISSING_AUTHORITY。本节把判断材料摆出来,不代判。
```

`Q-S1b` 是本轮补问的:`A-S1`/`A-S2` 给的是**覆盖政策与表面**,而 `A-V2-1(a)` 要的是
**性质本身**。少了这一问,A-V2-1 只被答了一半。候选取自本仓真实存在的平台敏感代码
(`memory-index*.js` · `zvec-path-containment.js` · `hooks.js` · `takeover-*.js` ·
`wiki/cli.js` 的 darwin 分支),不是凭空拟的清单。

### 7.6 V2 candidate —— verification predicate schema

**surface 定义(G-V2-8,在 schema 内自行给出)**:

```text
S-MOTHER   母体安装形态:本仓自身作为一个已完成依赖安装的工作副本。
S-CHILD    子项目安装形态:由本产品 scaffold 出的子项目,在其内部完成依赖安装。
S-RUNTIME  运行形态:在一个**已完成安装**的实例内执行产品自身的行为,而非执行安装动作。

引用关系:UDR 的 A1 / A2 与上面前两者形态相近,此处**仅作 provenance 引用**,
不从中继承任何 authority —— 授权来自 §7.5 的 owner declaration(A-V2-1)。
```

**required predicate 集合(G-V2-4)**:

```text
规则:  对 S_PRODUCT 中的**任意** cell (os, arch, nodeMajor),
       required predicate 集合恒为下面六条,不随坐标变化。

这是一个 CellIdentity 上的**常值函数**,仍然是 G-V2-4 要求的参数化形式 ——
判据要求的是「给定任一 cell 能算出 required 集合」,不是「集合必须随坐标变化」。
不做坐标条件化是有意的:条件化每多一条,就多一处「为什么这格少要求一条」要回答。
```

```text
P-DEP-MOTHER   surface  S-MOTHER
    成立:  在该 cell 上完成母体依赖安装后,产品实际加载的原生 / 可选依赖模块
           均可被成功加载。
    不成立:安装过程失败,或安装后其中任一模块加载失败。
    覆盖:  依赖在该 cell 上「装得上并能加载」。
    不覆盖:装上之后产品行为是否正确 —— 那是 P-IDX-* / P-PATH-*;
           也不覆盖依赖的任何版本策略。

P-DEP-CHILD    surface  S-CHILD
    成立:  在该 cell 上 scaffold 出子项目并在其中完成依赖安装后,
           子项目实际加载的原生 / 可选依赖模块均可被成功加载。
    不成立:scaffold 失败、子项目依赖安装失败,或安装后任一模块加载失败。
    覆盖:  子项目形态下的依赖可安装性与可加载性。
    不覆盖:子项目的产品行为正确性;也不覆盖 published 包形态
           —— 那一形态本轮**明确不主张**(residual)。

P-IDX-MOTHER   surface  S-RUNTIME(母体实例)
    成立:  内存索引在该实例上完成一次 开 → 写 → 查 → 关,查询返回写入的内容,
           且关闭后不残留其打开的文件句柄。
    不成立:上述任一步骤报错、查询取不到已写入的内容,或关闭后仍有残留句柄。
    覆盖:  索引主链路的一次完整生命周期。
    不覆盖:并发 / 锁行为、崩溃恢复、跨进程可见性 —— 明写为 residual。

P-IDX-CHILD    surface  S-RUNTIME(子项目实例)
    同 P-IDX-MOTHER,评估对象为 scaffold 出的子项目实例。
    覆盖 / 不覆盖同上。它**不因** P-IDX-MOTHER 成立而被覆盖:
    两者是不同实例上的不同观察。

P-PATH-MOTHER  surface  S-RUNTIME(母体实例)
    成立:  当实例根路径含非 ASCII 字符时,内存索引所写的文件全部落在其声明的
           collection 根之内,且不因路径编码而失败。
    不成立:出现落在声明根之外的写入,或因路径编码导致失败。
    覆盖:  非 ASCII 路径下的写入位置与可用性。
    不覆盖:任何具体的路径解析实现方式,也不覆盖 ASCII 路径下的行为
           (后者不在本条主张范围内)。

P-PATH-CHILD   surface  S-RUNTIME(子项目实例)
    同 P-PATH-MOTHER,评估对象为子项目实例。
```

**residual 总述(G-V2-3 的汇总,不替代逐条 residual)**:

```text
本 schema **不主张**覆盖产品的全部平台敏感行为。明确列入 residual、本轮不要求的有:
    hooks 的安装与执行 · takeover receipt · wiki 打开命令的平台分支 ·
    索引锁的并发行为 · published 包形态的安装 · 崩溃恢复
这是一份**具名有限集**,不是完备枚举 —— 因此不主张「这六条就是全部」。
```

### 7.7 V3 candidate —— 合成规则

```text
单条 predicate 的结果取值域(本域归 V3,§6.10):

    SATISFIED       观察确立了该 assertion 的成立事实
    FAILED          观察确立了该 assertion 的不成立事实
    UNOBTAINABLE    未能取得可判定的观察 —— 「没看」,不是「看了不过」

verification state 取值域(A-S3:三态):

    VERIFIED        每一条 required predicate 均为 SATISFIED
    NOT_VERIFIED    至少一条 required predicate 为 FAILED
    INDETERMINATE   无 FAILED,但至少一条为 UNOBTAINABLE

优先级:FAILED 压过 UNOBTAINABLE。
       既有失败又有不可得时,该 cell 是 NOT_VERIFIED —— 我们确实看见了坏,
       把它记成「没看」会把一个已知缺陷降级成信息不足。

空集边界:若 required 集合为空,state = INDETERMINATE,**不是** VERIFIED。
       空集上「全部 SATISFIED」在形式逻辑上恒真,但那时没有任何东西被验证过,
       让它取到 VERIFIED 就是用真空真值洗出一个通过。
       (本轮 V2 的 required 集合恒为六条,不会取到这一格;规则仍需对它有定义,
        因为 G-V3-5 要求本规则对任意 predicate 集合成立。)
```

全函数性(G-V3-3):任给一组结果,「有无 FAILED」二分,无 FAILED 时再按「是否全
SATISFIED」二分,三个 state 互斥且穷尽,无落空组合。

### 7.8 authority ledger

```text
A-V2-1  product-property & surface-taxonomy declaration    INSTANTIATED
        §7.5 的 owner declaration,issuer / date / provenance 齐备。

A-V2-2  mechanism authority                                NOT APPLICABLE
        触发条件是「某条 assertion **描述某个机制的实际行为**」。
        §7.6 六条 assertion 全部写成**规范性**表述(「必须落在声明根之内」
        「关闭后不残留句柄」),没有一条描述某机制如何实现该性质。
        这是有意的写法选择,也正是把实现细节留在 Step B 之外的做法。
        ⚠ 若复审认定 P-PATH-* 实质上已在描述路径解析机制,则本项 TRIGGERED
        且当前 NOT INSTANTIATED → V2 转为 DEFERRED / MISSING_AUTHORITY。
        这是本轮最接近翻转的一处,见 §7.11。

A-V2-3  —— 已并入 A-V2-1(§6.4),编号留空。

A-V2-4  scope-derivation authority                         NOT APPLICABLE
        触发条件按语义判(§6.4):schema 是否作出完备性主张。
        §7.6 的 residual 总述明写「不主张这六条就是全部」,scope 是一个固定、
        显式具名的有限集合,没有「所有具备特征 F 的对象」这类主张。

A-V3-1  composition-declaration authority                  INSTANTIATED
        §7.5 的 A-S3,同一 issuer / date / provenance。
        注意它**没有**处分 G-V3-4(那条来自 A0-B3),也不需要处分。
```

### 7.9 V2 裁决

按 §6.2 的求值顺序:先 RED,再 GREEN,否则 DEFERRED。

```text
RED 逐条:
R-V2-1  laundering?          否。§7.7 的 VERIFIED 要求全部六条 SATISFIED。
R-V2-2  不可界定的 assertion? 否。六条都给出了成立与不成立的具体事实,
                              且各自写明覆盖与不覆盖。
R-V2-3  required 与否在 evidence 阶段才定? 否。集合是 CellIdentity 上的常值函数,
                              本轮未观察任何 cell。
R-V2-4  继承 UDR / CI 作 authority? 否。§7.6 显式声明 UDR 的 A1/A2 仅作 provenance
                              引用,授权来自 A-V2-1。
R-V2-5  以修改生产文件为成立前提? 否。某些 cell 今天可能过不了 P-PATH-*,
                              那是 cell 的结果,不是 schema 的成立条件。
R-V2-6  self-authorization?  否 —— 但这是本轮**唯一有争议**的一条,材料已摆在 §7.5,
                              复审可据此驳回。
R-V2-7  V2 自建 outcome taxonomy? 否。§7.6 只写「什么事实使 assertion 成立 /
                              不成立」,没有给结果命名;取值域在 §7.7 由 V3 给出。
                              (两者的区别:前者是断言的真值条件,后者是结果的取值集合。)

GREEN 逐条:
G-V2-1  ✓  六条均含 predicateId / surface / assertion。
G-V2-2  ✓  P-DEP-* 属 dependency installability,P-IDX-* / P-PATH-* 属 product
           runtime behaviour;后者**不因**前者成立而被覆盖 —— 依赖装得上不蕴含
           索引生命周期正确,更不蕴含非 ASCII 路径下写入不越界。
G-V2-3  ✓  六条各自写明覆盖 / 不覆盖,另有 residual 总述。
G-V2-4  ✓  常值函数形式,规则写在 schema 内且只依赖 CellIdentity。
G-V2-5  ✓  六条均给出成立事实与不成立事实两个方向。
G-V2-7  ✓  已触发的 required authority 只有 A-V2-1,状态 INSTANTIATED。
G-V2-8  ✓  S-MOTHER / S-CHILD / S-RUNTIME 在 schema 内定义。
```

```text
verdict:  GREEN
```

### 7.10 V3 裁决

```text
RED 逐条:
R-V3-1  verified 在某条 required 非 SATISFIED 时仍成立? 否。
R-V3-2  UNOBTAINABLE 与 FAILED 并入同一 state? 否,分属 INDETERMINATE 与 NOT_VERIFIED。
R-V3-3  非全函数? 否,见 §7.7 的二分论证。
R-V3-4  复用 BOUNDED? 否。
R-V3-5  self-authorization? 与 R-V2-6 同,材料在 §7.5。

GREEN 逐条:
G-V3-1  ✓  三个 state,逐个给出成立条件。
G-V3-2  ✓  单条取值域语义区分「成立 / 不成立 / 不可得」三类。
G-V3-3  ✓  全函数,含空集边界的显式定义。
G-V3-4  ✓  VERIFIED 要求每条 required predicate 均为 SATISFIED。
G-V3-5  ✓  规则只引用「required predicate 集合」这一抽象,不依赖 V2 列出哪六条;
           把 V2 换成任意别的 schema,本规则一字不改仍可判定。
G-V3-6  ✓  A-V3-1 INSTANTIATED。
```

```text
verdict:  GREEN
```

### 7.11 两个 GREEN 的自检:哪里最可能翻

判据由本 gate 撰写,candidate 也由本 gate 提名 —— 两个 GREEN 因此需要指出**它可能
错在哪**,而不是只陈述它通过了。三处最接近翻转:

```text
一、A-V2-2 的触发判断(最接近)
    P-PATH-* 写的是「文件必须落在声明的 collection 根之内」。这是规范性表述。
    但若复审认为「collection 根」这个概念本身已在描述某个既有机制的行为,
    则 A-V2-2 TRIGGERED,而它当前 NOT INSTANTIATED
    → V2 变为 DEFERRED / MISSING_AUTHORITY。

二、R-V2-6 的 provenance 判断
    备选项措辞由本 gate 撰写。若复审认为选择空间已窄到使「选择」不构成独立声明,
    A-V2-1 判 NOT INSTANTIATED → V2 DEFERRED / MISSING_AUTHORITY,
    A-V3-1 同理 → V3 亦 DEFERRED。

三、G-V2-2 的「后者不因前者覆盖」
    本轮的论证是语义论证(装得上 ≠ 行为正确),没有引用任何观察。
    若复审要求这条必须由 authority 而非论证支撑,那是一条新的 required authority,
    属 Stage 2 判据修订,不能在本 Stage 就地补。
```

### 7.12 Step A 结论与边界

```text
V2  必须验证哪些性质                       verdict = GREEN
V3  predicate 结果 → verification state    verdict = GREEN

Q-A1 CellIdentity = { os, arch, nodeMajor }        frozen input(§2)
```

**关于 §3 里那两行 `verdict: UNSET`**:它们是 Stage 1 的冻结字节,记录的是 `a4e747da`
当时的状态,**不回写**。verdict 的**当前**归属是 §7.9 / §7.10。

```text
一个 live home(§7.9 / §7.10) + 一个 historical record(§3,冻结)
≠ 两个互相竞争的 verdict home
```

分辨方法是 Stage 标记:§3 顶着 `FROZEN @ a4e747da`。若复审认为这仍会误导读者,
正确的修法是在 §3 之外加指针,而**不是**去改已冻结的字节。

---

## 7.13 第一次裁决被推翻 —— 更正后的 consumption 与 re-adjudication

`3ace08f2` 的两个 GREEN 经独立复审驳回。判据(`c39f5919`)未变,变的是对 authority
状态的判定 —— **四条 finding 全部成立**。

### 7.13.1 A-V2-1 缺判据明确要求的「理由」

冻结的 A-V2-1 原文要求的不止 (a)(b),还有**并给出理由**。§7.5 逐字记录的是三个
**选择**,没有任何 owner 撰写的 rationale。

```text
gate 自己解释「为什么这样选是合理的」 ≠ owner 的理由
```

后者若被前者顶替,就又回到了 decision author 替产品意图补 authority ——
正是 A-V2-1 的 issuer 约束要挡的东西。

### 7.13.2 A-V3-1 只拿到了取值域的**大小**

owner 逐字给的是「三态」。而真正决定语义的四项:

```text
NOT_VERIFIED 的成立条件
INDETERMINATE 的成立条件
FAILED 压过 UNOBTAINABLE 的优先关系
空 required 集合的语义
```

全部是 §7.7 由本 gate 补出的。其中只有 `G-V3-4`(VERIFIED ⇒ 全部 SATISFIED)来自
A0-B3、不需 owner 授权;**其余四项恰恰落在 A-V3-1 已冻结的处分范围内**。

### 7.13.3 P-PATH 的 scope 被 candidate 悄悄扩大了

```text
owner 逐字授权    ③ **Windows** 非 ASCII 路径下的路径包容不越界
candidate 写成    对 S_PRODUCT 任意 cell,六条恒为 required(P-PATH-* 无 os 条件)
                  → win32 **与 linux** 都被要求
```

这不是 declaration 的等价展开,是扩大 required-property scope。而 `G-V2-4` 本来就
**允许** required 与否依赖 CellIdentity —— 完全不需要靠常值函数去扩大 authority。
§7.6 里那句「不做坐标条件化是有意的」在这里成了反效果:它为了少答一个问题,
多主张了一份 authority。

两条合法出路,择一:

```text
A  改 candidate:P-PATH-* 仅当 os == win32 时 required(其余四条不动)
B  owner 新声明:该性质对 win32 与 linux 均属 required,并给理由
```

### 7.13.4 provenance 目前无法被独立核实

§7.5 只写到 channel 一级,没有可追溯的 source pointer;复审查了可取的既往上下文,
找不到那四个 owner 原始回答,因此**无法独立核实「逐字转录」这一 claim**。

另有一处 git 次序的弱化 —— `db8d92b9` 写下的理想链路是:

```text
criteria → questions → declaration → candidate + adjudication
```

而 git 实际只能证明:

```text
c39f5919 criteria → db8d92b9 questions → 3ace08f2 {declaration + candidate + adjudication}
```

最后那一格是**一个 commit**,所以 `declaration → candidate` 的次序证明不出来。

```text
「缺来源」**不能**升级成「来源一定有问题」 —— 所以不是 RED。
但它也不足以支持 §7.9 / §7.10 写下的「R-V2-6 = 否」「R-V3-5 = 否」。
```

### 7.13.5 更正后的 ledger 与 verdict

```text
A-V2-1  product-property & surface-taxonomy declaration    NOT INSTANTIATED
        缺 owner rationale(§7.13.1);且已记录的内容与 candidate 的 scope 不一致(§7.13.3)
A-V2-2  mechanism authority                                NOT APPLICABLE   (复审接受)
A-V2-3  —— 已并入 A-V2-1,编号留空
A-V2-4  scope-derivation authority                         NOT APPLICABLE   (复审接受)

A-V3-1  composition-declaration authority                  NOT INSTANTIATED
        只拿到取值域大小,四项 state 语义未获授权(§7.13.2)
```

按 §6.2 的求值顺序逐步走:

```text
1  RED?      两个节点均无 RED 命中 —— 尤其 R-V2-6 / R-V3-5:
             缺来源不构成「已证实的自授权」,不判 RED。
2  GREEN?    G-V2-7 不成立(A-V2-1 已触发且 NOT INSTANTIATED)
             G-V3-6 不成立(A-V3-1 同)
3  → DEFERRED

deferral_reason(按 §6.2 的优先级函数):
    candidate 存在        → 不取 CANDIDATE_ABSENT
    有已触发的 authority 为 NOT INSTANTIATED → **MISSING_AUTHORITY**
```

```text
V2   verdict = DEFERRED    deferral_reason = MISSING_AUTHORITY
V3   verdict = DEFERRED    deferral_reason = MISSING_AUTHORITY
```

`MISSING_AUTHORITY` 而非 `CANDIDATE_FAILS_CLAUSE`:这正是 §6.2 那条优先级函数存在的
理由 —— 两份 candidate 本身没有被判为不够(见下),欠的是 authority。

### 7.13.6 复审明确通过、下一轮不得重开的四项

```text
A-V2-2 = NOT APPLICABLE   六条 assertion 定义的是 observable property,
                          没有规定路径解析算法、句柄管理机制或任何实现手法。
                          §7.11 列为「最接近翻转」的那一处,**不翻**。
A-V2-4 = NOT APPLICABLE   具名有限集 + residual,无 completeness claim。
G-V2-2 的语义分离           依赖装得上 ≠ 索引生命周期正确 ≠ 非 ASCII 路径包容正确,
                          是命题间的非蕴含关系,不需要 cell observation 才成立,
                          也不需要为它追加一条 Stage-2 authority。§7.11 第三项不翻。
V3 合成逻辑本身            三 outcome × 三 state 的函数在非空集上互斥穷尽,
                          空集有显式 override,不存在真空真值洗出 VERIFIED。
                          问题不是规则写坏,而是它尚未取得 A-V3-1。
```

### 7.13.7 一处必须写下的次序事实

```text
六条 predicate 的提名(3ace08f2)**早于**本轮将要取得的 declaration。
```

candidate 不是 authority,提名在前本身不构成 self-authorization。但它意味着一件事:

```text
新的 declaration 必须**有能力否决这份 candidate**,而不只是追认它。
```

§7.13.3 恰好就是一次否决 —— P-PATH 的 scope 要按 declaration 改,不是反过来让
declaration 去迁就已经写好的六条。

### 7.13.8 登记待补的 declaration(无答案)

```text
D-1  A-V2-1  重新给出,需含:
         · required 的性质(可沿用或修改「核心链路三条」)
         · required 的 surface / scenario
         · **理由** —— 判据明文要求,上一轮缺的就是这一项
         · P-PATH 的 scope:仅 win32,还是全部 supported OS(§7.13.3 的 A / B)

D-2  A-V3-1  重新给出,需含:
         · state 取值域
         · **每个 state 的成立条件** —— 含 FAILED 与 UNOBTAINABLE 的优先关系、
           以及空 required 集合的语义
         · 理由
         注:G-V3-4(VERIFIED ⇒ 全部 required 为 satisfied)来自 A0-B3,
         **不在本声明的处分范围内**,不必也不能被它推翻。

D-3  source pointer  本轮要求 declaration 以 **owner 自己撰写的文本**给出,再逐字转录。
         一段 owner 亲笔的文本本身就是可追溯来源,强于「在若干备选里选了一个」——
         后者的措辞由本 gate 撰写,正是 §7.13.4 无法被独立核实的那一环。
```

本节写入时 D-1 / D-2 / D-3 **均无答案**,与 `db8d92b9` 的做法一致:先登记,后作答,
让 git 顺序而不是作者自陈来承担「问题早于答案」。

**本 Step 建立了什么**:一份具名、可重复适用于任意 cell 的 cell-verification
contract —— A0 的 B3 所要求的那份东西。

**本 Step 没有建立什么**(逐条,防止被读大):

```text
!= 任何 cell 的验证结果 —— 本轮未观察任何 cell,六条 predicate 一个结果都没填
!= 谁可以承担哪条 predicate、需要几次观察          → Step B
!= V_PRODUCT 选哪些 cell / 任何 equivalence class   → Step C
!= win32 × Node20 是否必须进入 V_PRODUCT 或必须由 runner 实证
!= 代表性 —— A0 的 P3 完全未被触及
!= A0 的 P2 就此变成 GREEN。P2 = DEFERRED 是不可变历史(`gate.md` §1);
   本 gate 产出的是**新 authority**,将来由一份新的 consumption record 重新消费。
```
