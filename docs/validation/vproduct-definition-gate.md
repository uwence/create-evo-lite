# V_PRODUCT Definition Gate

- 议题:为 A0 gate 里 **DEFERRED 的 P2** 生产它所缺的 authority
- 日期:2026-09-03
- baseline:`main@a3f7395`
- 前序:`product-support-scope.md`(A0 gate,三阶段已冻结并合入 `main@46abcf96`)

```text
STEP A — Cell Verification Contract (B3)
STAGE 1 — DECISION SUBJECT CONTRACT

本次只回答「到底在裁什么」。不写 GREEN / RED,不写 required authority,
不裁定任何一项,**不选任何 V_PRODUCT cell**,不改任何生产文件。
```

## 0. 这条 gate 与 A0 的关系

### 0.1 它**不是**「A0 Stage 4」

A0 gate 已于 `aa59c36c` 三阶段全部冻结,**不重开**。其中:

```text
P2 = DEFERRED  是 aa59c36c 当时 authority 状态下的**正确历史裁决**,是不可变历史。
```

本 gate 的任务是**生产新的 authority**,使 A0 的 P2 将来可以被**重新消费**。
将来有了结论,应当写一份**新的 consumption / re-adjudication record**,
而**不是**回头把 A0 文档里的 `DEFERRED` 改成 `GREEN` —— 那会重写 evidence history。

### 0.2 Step 顺序(冻结):定义先于证据,证据先于成员资格

```text
Step A   cell verification contract(B3)  ← 当前
             ↓ 冻结后
Step B   delegation contract:哪些 predicate 必须 runner 实证,
                             哪些可由 non-runner authority 承担
             ↓ 冻结后
Step C   V_PRODUCT candidate:选定有限 cell / equivalence class
             ↓
Step D   按已冻结的 A + B 裁决该 candidate
```

**这个顺序不可颠倒。** 反过来做就是:

```text
先看见现有 release-gate 五格
→ 再设计一套刚好让这五格成立的「verified」定义
```

与本工作线一路在防的「先看结果、再写判据」同型。

### 0.3 Step A 内部沿用三阶段

```text
Stage 1  decision subjects · X→Y · authority boundary · non-authorization   ← 当前
             ↓ COMMIT + REVIEW
Stage 2  required authority · GREEN iff · RED iff · missing-authority disposition
             ↓ COMMIT + REVIEW
Stage 3  消费 authority · 填 verdict
```

### 0.4 文档组织(登记为待裁,不自行固化)

本文件目前**承载整条 gate 的四个 Step**,理由是四者耦合很紧:B 的委托规则引用 A 的
predicate;C 的候选要按 A + B 判;D 是对 C 的裁决。拆成四份文件会让
「定义 → 证据 → 成员资格 → 代表性」这条顺序更难被强制,也更容易被绕过。

代价是它会长。A0 gate 四个节点写到 1129 行;本 gate 若四个 Step 都在同一份里,
体量会更大。**若复审认为应当拆分,现在拆比以后拆便宜** —— 登记为待裁。

## 1. current X —— 严格限定在已建立的范围内

```text
A0 Stage 3 建立的只有这一句:

    本轮没有任何 source 被提名、验证并消费为 B3,因此 B3 当时未实例化。

**不得**把它扩张成「仓库中不存在任何相关材料」。
判据绑定的是 authority provenance,不是全文检索的质量 ——
这是 A0 Stage 3 复审逐条改掉过的三处措辞之一。
```

因此本 gate 的起点不是「一片空白」,而是「**尚无被提名并消费为 B3 的来源**」。
Step A 的产出正是要造出一个可被提名的对象。

**已经冻结、可以直接消费的上游事实**(来自 A0,不是本 gate 重新裁定的):

```text
S_PRODUCT(P1 = GREEN,authoritative)
    OS     SUPPORTED  win32 · linux        UNSUPPORTED  darwin
    arch   SUPPORTED  x64                  UNSUPPORTED  arm64
    Node   静态枚举    SUPPORTED  20 · 22 · 24

A0 的 B3 已经冻结了本 Step 的**最低要求**:
    「一个 cell 要算作 verified,需要满足哪一组 predicate」,
    该组 predicate 必须**逐条具名**,且至少区分
        dependency installability   原生依赖能否在该 cell 装上
        product runtime behaviour   产品自身的 platform-sensitive 路径是否被覆盖
    并已写明:第二类**不因第一类成立而被覆盖**。

A0 的 P2-R1 已经把 evidence laundering 定为 RED:
    把「某一条 predicate 成立」当作「该 cell 已 verified」。
```

## 2. Decision nodes

沿用两条独立状态轴:`subject_status` 与 `verdict`,任何一条都不得写进另一条。

### 2.0 本 Step 的主语被拆成三个,不是一个

复审给出的形状是单一主语「一套具名、可重复应用的 cell-verification contract」。
核对之后,**它至少含三个可独立取值、且互不蕴含的决定**:

```text
V1  一个 cell 是什么          —— 不定义坐标系,「该 cell 是否 verified」就没有主语
V2  必须验证哪些性质          —— B3 的正面内容
V3  怎样由逐 predicate 的结果合成「该 cell verified」
                              —— 缺它,「4/5 条成立算不算 verified」无解,
                                 而 A0-P2-R1 恰恰把「拿一条当全部」定成了 RED
```

拆开的依据不是对称美感,是 V1 有一个**具体的、已在证据里出现过的**歧义 —— 见 V1。

---

### Decision V1 —— cell 的坐标系

```text
decision subject:    「一个 product-support cell」由哪些维度构成。
                     它是本 Step 其余两个节点的**主语前提**:
                     不先说清 cell 是什么,「该 cell 是否 verified」就无从谈起。
subject_status:      INSTANTIATED

current state X:     **未定义,且已经产生过实际歧义。**
                     A0 全篇使用「cell」而从未定义它;S_GATE 的五格写作
                     (os, node) 二元组,arch 隐含。
                     而 UDR 在**同一个 (os, node) 网格**上区分了三种**不同的安装形态**,
                     并把它们列为三条**互不蕴含**的 authority:

                       A1  install / load compatibility        母体安装形态
                       A2  scaffolded-runtime install          子项目安装形态
                       A4  published-package installability    mandatory 语义下的
                                                               npm i create-evo-lite

                     UDR Stage 3 的裁定里,A1 INSTANTIATED 而 A2 NOT INSTANTIATED ——
                     **同一批 (os, node) 格子上,一种安装形态被证实、另一种从未被测过。**
                     若 cell 只是 (OS, arch, Node),这个区别在 V_PRODUCT 里**表达不出来**。

candidate state Y:   一个具名的坐标系定义。**至少**要回答:
                       · (OS, arch, Node major) 三维是否足够
                       · 安装形态(install shape)是否是**第四个维度**,
                         还是被降为 V2 的一条 predicate,还是不进模型
                       · 同一 cell 的重复运行如何计(单次 / 多次 / 需否稳定性)
                     取值本身与理由都要给。

observable delta:    本文件中的一节定义;后续 Step C 的 V_PRODUCT 逐 cell 列举
                     将按该坐标系书写。**本 Step 不产生任何生产文件变化。**

authority boundary:  **产品 / 架构判断。** 没有任何测量能回答「cell 应该有几个维度」——
                     测量只能告诉我们「不同安装形态确实会给出不同结果」(UDR 已经给出),
                     而「因此它是否该成为坐标轴」是判断。

does NOT authorize:  不选任何 cell(Step C)· 不规定谁来验证(Step B)
                     · 不规定验证什么(V2)· 不改 S_PRODUCT

verdict:             UNSET
```

---

### Decision V2 —— 必须验证哪些性质

```text
decision subject:    一个 cell 要被称为 verified,**必须被验证的性质集合**,逐条具名。
subject_status:      INSTANTIATED

current state X:     不存在这样的集合。最接近的两样都不是它:
                       · release-gate 的 job 步骤 —— 是 CI 配置,不是 predicate 契约;
                         A0-P2-G3 已冻结「不得默认继承 CI 配置」
                       · UDR 的 A1 / A2 / A3 / A4 —— 是**为那次裁决**命名的 authority,
                         不是一份可重复应用于任意 cell 的契约

candidate state Y:   一份 verification predicate schema:逐条具名的性质列表,
                     每条写明它断言什么。A0 的 B3 已冻结**下限**:
                     至少区分 dependency installability 与 product runtime behaviour,
                     且后者不因前者成立而被覆盖。
                     **本节点只定义「验证什么」,不填任何 cell 的结果。**

observable delta:    本文件中的一节 schema。

authority boundary:  **混合。** 「哪些性质对本产品要紧」是产品 / 架构判断;
                     「某个机制实际如何工作」(例如 native 依赖的安装路径会走到哪里)
                     是技术 authority;而「某个 cell 是否满足某条 predicate」
                     是后续的 evidence / measurement —— **不属于本 Step**。

does NOT authorize:  不规定谁可以承担哪条 predicate(Step B)
                     · 不规定几条成立才算 verified(V3)· 不选 cell(Step C)

verdict:             UNSET
```

---

### Decision V3 —— 由 predicate 结果合成「verified」的规则

```text
decision subject:    给定某个 cell 上各条 predicate 的结果,**按什么规则**判定
                     「该 cell 已 verified」。
subject_status:      INSTANTIATED

current state X:     不存在。而且这不是「没写下来」而已 ——
                     今天没有任何规则能回答「5 条 predicate 中成立 4 条,
                     这个 cell 算不算 verified」。
                     A0-P2-R1 已经把一个极端定成 RED(拿一条当全部),
                     但**没有**规定另一端:全部成立才算,还是允许部分成立 + 有界结论。

candidate state Y:   一条合成规则。至少要回答:
                       · 「verified」是**二元**的,还是允许**逐 predicate 记录**
                         并给出有界结论
                       · 若允许部分成立,该 cell 能否进入 V_PRODUCT,
                         以及它的结论如何被限制
                       · 某条 predicate 结果**不可得**(而非失败)时如何处理 ——
                         这与「失败」是两回事,A0 已在别处冻结过同型区分

observable delta:    本文件中的一节规则。

authority boundary:  **产品 / 架构判断。** 它决定 V_PRODUCT 里一个 cell 的语义强度,
                     测量给不出这个门槛。

does NOT authorize:  不改 V1 / V2 的取值 · 不选 cell · 不谈代表性(那是 A0 的 P3)

verdict:             UNSET
```

## 3. 登记但**不**回答的问题

```text
Q-A1  cell 的坐标系是否包含 install shape?
      UDR 的 A1 / A2 / A4 证明三种安装形态会给出不同结果,但「是否升为坐标轴」是判断。
      本 Stage 只登记该歧义,由 V1 在后续 Stage 裁。

Q-A2  本文件是否应按 Step 拆成四份?
      见 §0.4。现在拆比以后拆便宜,故现在登记。

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

## 4. 本 Step 明确**不**授权什么

```text
!= V_PRODUCT membership          != equivalence class / 任何外推
!= A0 的 P3 coverage justification
!= 修改 S_PRODUCT                != 修改 CI matrix
!= enforcement                   != canonical support spec
!= UDR 的 A0 satisfied           != UDR 的 D1 重裁
!= 任何实施或生产变更
```

## 5. Stage 2 之前不得做的事

```text
不写 GREEN / RED                     不写 required authority
不写 missing-authority disposition
不回答 Q-A1 / Q-A2
不选任何 V_PRODUCT cell              不写任何 predicate 的具体内容
不裁定任何一项                        不修改任何生产文件
不回改 A0 gate 已冻结的任何内容 —— 包括那句 `P2 = DEFERRED`
```
