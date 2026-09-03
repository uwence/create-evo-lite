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
             ← 当前,见 §6
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

---

## 6. Stage 2 —— criteria(V2 / V3)

```text
STAGE 2 — CRITERIA ONLY
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

DEFERRED 必须同时记录 `deferral_reason`,恰好取一个:

```text
MISSING_AUTHORITY        某项已触发的 required authority 未实例化
CANDIDATE_ABSENT         本轮没有为该节点提出 candidate
CANDIDATE_FAILS_CLAUSE   candidate 已提出、材料齐备,但某条 GREEN 不成立
                         —— 这一条**不是**「还差材料」,是「这份 candidate 不够」
```

不加这条区分,一份写坏的 candidate 会以「authority 未就绪」的面貌进入 ledger,读者据此
以为补材料即可,而真正要做的是重写 candidate。

### 6.3 为什么不设中间 verdict,以及什么会迫使引入

本 Step **不定义中间 verdict**,也不复用 A0 P3 的 `BOUNDED`(Stage 1 已冻结此项)。

```text
V2 / V3 的主语都是「一份 contract 是否成立」,不是「它覆盖了多少」。
一份**只要求较少 predicate、但把残余写明**的 schema,按 §6.5 是可以 GREEN 的 ——
它的弱不体现在 verdict,而体现在它自己写下的 residual。
「野心小」不构成中间态。
```

唯一会迫使引入中间态的情形:

```text
candidate 完整、自洽、满足下限,但其成立**只在 CellIdentity 的一个真子集上**,
且该边界是可执行的。这时「成立」与「不成立」都是错误描述。

Stage 3 若遇到此形,**必须停下上报**,不得就地发明一个 verdict。
```

### 6.4 V2 —— required authority

```text
A-V2-1  product-property declaration authority            UNCONDITIONAL
        谁有权说「这些性质对本产品要紧」。Stage 1 已把它归为产品 / 架构判断,
        因此由**声明**建立(与 A0 的 P1 同型),不需要测量。

A-V2-2  mechanism authority                               CONDITIONAL
        触发条件:某条 predicate 的 assertion **描述某个机制的实际行为**。
        纯规范性断言(「必须成立」)不触发。

A-V2-3  surface-definition authority                      CONDITIONAL
        触发条件:schema 使用 surface / scenario 作区分。
        ⚠ UDR 的 A1 / A2 / A4 只能作为 **provenance 引用**,不得据以继承 authority ——
        V2 的 current X 已冻结:它们是为那一次裁决命名的 authority,
        不是可重复适用于任意 cell 的契约。surface 集合必须在 schema 内自行定义。

A-V2-4  scope-derivation authority                        CONDITIONAL
        触发条件:某条 predicate 的**适用范围**由一个需要枚举才能确定的集合定义
        (形如「产品中所有具备某类特征的路径」)。
        若 schema 改为逐条具名该范围,本项 NOT APPLICABLE。
```

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

G-V2-5  每条 predicate 的 assertion **可证伪**:schema 写明什么观察会使它为假。
        不要求写明由谁观察、观察几次 —— 那是 Step B。

G-V2-6  若 schema 自行规定了单条 predicate 的结果取值域,该取值域必须与 V3 的一致
        (§6.10)。若 schema 不规定(推荐形态),本项自动成立。

G-V2-7  §6.4 中所有**已触发**的 required authority 状态均为 INSTANTIATED。
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
```

### 6.7 V3 —— required authority

```text
A-V3-1  composition-declaration authority                 UNCONDITIONAL
        谁有权规定「什么样的结果组合算 verified」。Stage 1 已冻结:这是产品 / 架构判断,
        测量给不出门槛,因此由声明建立。

无技术 authority 需求。 若 Stage 3 发现某个 state 的成立条件需要技术事实才能判定,
那说明 V3 的 candidate 越过了自己的主语 —— 应当修 candidate,**不得**顺势新增一项
authority 把它合法化。
```

### 6.8 V3 —— GREEN iff(以下全部成立)

```text
G-V3-1  规则给出一个**有限**的 verification-state 取值域,并逐个给出成立条件。

G-V3-2  规则显式给出**单条 predicate 的结果取值域**,其中「失败」与「结果不可得」
        是**不同的取值**。—— Stage 1 已冻结的形状要求。

G-V3-3  规则是**全函数**:对该取值域上每一种可能的结果组合都有定义,没有落空组合。

G-V3-4  规则指明取值域中**哪一个 state 承载「该 cell 已 verified」这一主张**,
        并写明它在何种结果下成立。
        本判据**不规定**该条件是「全部成立」还是别的 —— Stage 1 明确把这一端留空,
        那是 V3 自己的内容;判据只要求它被写明且可判定。

G-V3-5  规则**参数化于 required predicate 集合**:对任意条数、任意 predicateId 都成立,
        不依赖 V2 最终列出哪些 predicate(§6.10)。

G-V3-6  §6.7 中所有已触发的 required authority 状态均为 INSTANTIATED。
```

### 6.9 V3 —— RED iff(命中任一即 RED)

```text
R-V3-1  「verified」state 可以在**未记录哪些 predicate 未成立**的情况下成立。
        —— 允许部分成立是 V3 的自由(Stage 1 留空的那一端);**静默的**部分成立不是。
        这是 A0-P2-R1 在合成层的形态。

R-V3-2  「结果不可得」与「结果为失败」被映射到同一个 state,且规则未写明这是**有意为之
        并给出理由**。—— 两者不同:一个说产品坏了,一个说我们没看。

R-V3-3  规则对某些结果组合无定义(非全函数),从而要靠 Stage 3 临场补齐 ——
        而「5 条里成立 4 条无解」正是 V3 存在的理由。

R-V3-4  规则复用 A0 P3 的 `BOUNDED` 作为 state 名(Stage 1 已冻结不复用)。
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

    归 V3。
    理由:V3 的主语就是 outcome → state 的合成,而 Stage 1 已经要求它区分
    「不可得」与「失败」—— 那本身就是一条关于单条结果取值域的规定。

    V2 相应地不得另立一个冲突的取值域;其 assertion 必须可被求值到 V3 的取值域上。
    该约束落在 G-V2-5 与 G-V2-6,不产生 verdict 传播。
```

### 6.11 突变自检:拿掉每一条,什么会通过

```text
G-V2-3 拿掉  →  运行时行为 predicate 可以不写残余,
                「验了运行时行为」与「验了其中一小块」在工件上无法区分。
G-V2-4 拿掉  →  schema 退化成逐 cell 手工列举:V_PRODUCT 加一格就要重写契约,
                且「这一格为什么少要求一条」无从追问。
G-V2-6 拿掉  →  V2 与 V3 各自定义结果取值域,合成函数的输入类型不确定,
                而两个节点又互不传播 —— 冲突要到 Step D 才炸。
R-V2-2 拿掉  →  「测试通过」即可充当 product-runtime predicate,
                该 cell 的 verified 主张变成不可证伪。
R-V2-3 拿掉  →  可以先跑一遍,再把跑通的那些定为 required —— 本工作线的签名缺陷。
R-V2-4 拿掉  →  UDR 的一次性 authority 被当作可重复契约继承,
                V2 已冻结的 current X 被绕过。
G-V3-3 拿掉  →  「5 条成立 4 条」在规则里无定义,靠 Stage 3 临场补,
                而这正是 V3 存在的理由。
R-V3-1 拿掉  →  部分成立可静默通过,A0-P2-R1 在合成层被绕过。
R-V3-2 拿掉  →  「我们没看」被记成「它坏了」或反之 ——
                两类完全不同的后续动作被合并成一个 state。
§6.2 的 CANDIDATE_FAILS_CLAUSE 拿掉
             →  写坏的 candidate 以「authority 未就绪」的面貌进入 ledger,
                读者以为补材料即可。
```

### 6.12 Stage 3 之前不得做的事

```text
不填 V2 / V3 的 verdict            不写任何 predicate 的具体内容
不写任何 verification-state 的名字  不消费任何 cell evidence
不选任何 V_PRODUCT cell            不提名 equivalence class(`gate.md` §4.2)
不裁 win32 × Node20 的 membership 或 runner requirement
不改 Stage 1 的任何主语             不创建 Step B 文件
不修改任何生产文件                  不回改 A0 gate 已冻结的任何内容

遇到 §6.3 所述的中间态情形 → **停下上报**,不得就地发明 verdict。
```
