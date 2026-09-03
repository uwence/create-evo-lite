# 产品支持范围与验证集合(A0 gate)

- 议题:补一份 create-evo-lite 一直缺失的**产品级兼容性合同**
- 日期:2026-09-03
- baseline:`main@af590b8`
- 缘起:`zvec-070-upgrade-decision.md`(UDR)裁决时,D1 因缺 A0 而 DEFERRED。
  但本 gate **不是** zvec gate —— 见 §0.1。

```text
STAGE 1 — DECISION SUBJECT CONTRACT
本次只回答「到底在裁什么」。不写 GREEN / RED,不写 required authority,
不写 missing-authority disposition,不裁定任何一项,不改任何生产文件。
```

## 0. 阶段顺序(沿用 UDR 已验证的结构)

```text
Stage 1  decision subjects · X→Y · subject_status · authority boundary
             ↓ COMMIT + REVIEW        ← 当前阶段
Stage 2  required authority · GREEN iff · RED iff · missing-authority disposition
             ↓ COMMIT + REVIEW
Stage 3  消费证据与来源 · 填 verdict
```

UDR 用这个结构跑完了三阶段、九次独立复审,被拦下的越界几乎全是同一形状:
**把下一阶段的字段换个位置提前写掉**。本 gate 沿用同一纪律。

### 0.1 本 gate 的主语**不是** UDR 里那个 A0

UDR 的 A0 是「那次裁决需要的一份 authority」。本 gate 的主语是**产品自己的承诺**,
必须独立成立 —— 然后 UDR 的 A0 才**被它满足**(或仍然不被满足)。

反过来做,就是拿一个下游需求当上游主语,与 UDR 里 D4 / D6 被判主语不成立是同一种错误。
因此本文件**不引用 D1 的判据**,也不以「让 D1 变绿」为目标。

它同样不是为 zvec 补的一张许可证。以后每一个 native 依赖 —— `better-sqlite3`、
未来的 native addon、prebuild 覆盖面、Node major 兼容性 —— 都会再问同一个问题:
**「CI 五格绿了,究竟能不能代表我们声称支持的范围?」**

### 0.2 要防的倒置:用 V_PRODUCT 反推 S_PRODUCT

「把 CI 恰好覆盖的格子当作产品承诺」与「看到结果再定判据」是同一个形状,只是换了一层。
顺序因此冻结为:

```text
先定 S_PRODUCT(产品承诺)
→ 再定 V_PRODUCT(有限验证集)
→ 再写 coverage justification(为什么后者能代表前者)
```

`release-gate.yml` 中 windows × node20 的 exclude 是这条纪律的现场考题:
它的既有理由是「GitHub runner 上 better-sqlite3 无 win-x64 node-20 prebuild、
且无可检测的 MSVC」—— 那描述的是**证据环境的能力**,不是产品承诺。

### 0.3 结论只能由人宣布

S_PRODUCT 是**产品意图**类命题。没有任何一次测量能证明「我们承诺支持什么」。
本文件的作者负责把现状、选项与后果摆清;**宣布由项目所有者做**。

这条写在最前面,是因为它最容易被违反:当一个节点卡在「缺 authority」时,
最顺手的动作就是把缺的那条 authority 自己写出来 —— 那等于裁决者给自己发授权。

## 1. 现状:今天的树实际承诺了什么

全部为本轮实测,逐条可核。

```text
被强制执行、且用户可见的边界 —— 只有一条:
    index.js:12      const MIN_NODE_MAJOR = 20;
    index.js:17-22   assertNodeVersion() 在入口即检查 process.versions.node,
                     不满足则非零退出,文案 "Evo-Lite requires Node.js >= 20 (found …)"
    package.json     "engines": { "node": ">=20.0.0" }
    —— 只有**下限**。没有上限,没有平台,没有架构。

published manifest 的平台声明:
    package.json     os  = 字段不存在
                     cpu = 字段不存在
    按 npm 语义,二者缺席即**不加限制**。也就是说今天这个包在 macOS、
    在 arm64 上都会照常安装 —— 当前的已发布承诺是「不限制」。

CI 覆盖(S_GATE,证据环境):
    release-gate.yml:24-32   ubuntu-latest × node 20/22/24
                             windows-latest × node 22/24
                             windows × node20 显式 exclude,理由见 §0.2
    **没有任何一个 workflow 跑 macOS。**

散文层的预设:
    release-hardening-phase1.md R4
        "CI MUST run on Linux and Windows across the supported Node range"
        —— 它**预设**「supported Node range」是个已定义的东西,
        而树里除了 `>=20` 这个下限之外,没有任何地方定义它。
    README   没有「支持平台 / 环境要求」章节。

平台差异在代码里早已承重:
    .evo-lite/cli/ 下 **9 个已发布运行时文件**按 process.platform 分支,
    包括 zvec-path-containment.js(win32 专属的 containment)、
    memory-index-lock.js、takeover-install.js、wiki/cli.js 等。
    即:**行为按平台不同,而清单一个平台限制都没声明。**

native 依赖(prebuild 覆盖面决定装不装得上):
    子项目 runtime 必需   better-sqlite3 12.11.1
    published 可选        @zvec/zvec 0.6.0
```

**一句话概括这个 X:** 产品在运行时强制一条 Node 下限、在代码里按平台分叉、
在 CI 里只测两个 OS,却在**已发布的清单里对平台与架构不作任何限制**,
并在规范散文中引用了一个从未被定义的「supported Node range」。

## 2. Decision nodes

字段沿用 UDR 的两条独立状态轴:`subject_status` 与 `verdict`,任何一条都不得写进另一条。
`NOT WRITTEN (Stage 2)` 是故意留空。

---

### Decision P1 —— 声明 S_PRODUCT

```text
decision subject:    产品承诺支持的运行环境范围,作为一条**被声明的**命题存在。
                     它是「我们说我们支持什么」,不含任何强制手段(强制属 P4)。
subject_status:      INSTANTIATED

current state X:     不存在这样的声明。最接近的三样都不是它:
                       · `engines.node >= 20` 与 index.js 的运行时检查 —— 只是**下限**
                       · release-gate 矩阵 —— 是**证据环境**(S_GATE)
                       · R4 的 "the supported Node range" —— 引用了一个未定义的东西
                     平台与架构维度上,published manifest 当前**不作限制**。

candidate state Y:   一份**具名的**声明,至少覆盖三个维度并对每一维给出取值:
                       OS         (win32 / linux / darwin / …)
                       CPU arch   (x64 / arm64 / …)
                       Node       (下限?上限?按 major 枚举?)
                     以及每一维的取值**理由**,而不只是取值本身。

observable delta:    新增一份声明文件;若选择让 package.json 指向它,则另加一处引用。
                     运行时可观测面:本阶段无 —— P1 只声明,不改变任何执行路径。

authority boundary:  **产品意图类**。没有任何测量能证明它;由项目所有者宣布(§0.3)。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     NOT WRITTEN (Stage 2)

does NOT authorize:  不改 package.json 的 os / cpu(P4)· 不定义验证集合(P2)
                     · 不承诺 CI 覆盖任何格子(P3)

verdict:             UNSET
```

---

### Decision P2 —— 声明 V_PRODUCT

```text
decision subject:    用于 release / 依赖兼容性判定的**有限、可枚举**验证集合,
                     或一组具名的 equivalence class。
subject_status:      INSTANTIATED

current state X:     不存在。release-gate 的矩阵是一份 **CI 配置**,
                     它从未被声明为「代表产品支持范围的验证集合」——
                     UDR §5.0 已冻结:一份 workflow 不得自行缩小产品支持面。

candidate state Y:   一个具名集合。它**可以**恰好等于当前的五个 CI 格子,
                     但那必须是**被裁定的结论**,不能是默认继承。

observable delta:    声明文件中的一节;可选地由 release-gate 引用它而非各自硬编矩阵。

authority boundary:  部分可由事实支撑(某格能不能跑、prebuild 存不存在),
                     但「这个有限集合足以代表承诺范围」是**判断**,不是测量。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     NOT WRITTEN (Stage 2)

does NOT authorize:  不定义承诺范围(P1)· 不解释代表性(P3)

verdict:             UNSET
```

---

### Decision P3 —— coverage justification

```text
decision subject:    为什么 V_PRODUCT 足以代表 S_PRODUCT。
subject_status:      INSTANTIATED

current state X:     不存在。而且这不是「没写下来」而已 ——
                     今天没有任何机制阻止「五格绿 → 视同全范围通过」这一步推理。

candidate state Y:   一份说明,必须逐维回答**外推凭什么成立**:
                       Node    测 20/22/24 凭什么代表 `>= 20` 的全部?
                               (若答案是「按 major 枚举且只承诺维护中的 major」,
                                那是一个**会移动的定义** —— 见下)
                       OS      测 ubuntu + windows 凭什么代表承诺的 OS 集合?
                       arch    只在 x64 runner 上测,凭什么代表承诺的 arch 集合?

                     **移动定义的处置**必须一并写:若 S_PRODUCT 采用「当前维护中的
                     Node major」这类随时间变化的定义,则冻结的 V_PRODUCT 需要一个
                     **显式的重评触发条件**,否则合同会在无人改动的情况下悄悄过期。

observable delta:    声明文件中的一节。

authority boundary:  纯判断。这一节是整份合同里最容易写成同义反复的一节 ——
                     「我们测了这些所以这些有代表性」不构成 justification。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     NOT WRITTEN (Stage 2)

does NOT authorize:  不改变 P1 / P2 的取值

verdict:             UNSET
```

---

### Decision P4 —— 是否把已发布的承诺**收窄**为可强制的形式

```text
decision subject:    published manifest 是否新增 `os` / `cpu` 字段(或其他强制手段),
                     使 P1 的声明从「文档里的话」变成「安装时的行为」。
subject_status:      INSTANTIATED

current state X:     package.json 无 `os`、无 `cpu` 字段 —— 当前**不加限制**,
                     该包在 macOS / arm64 上都会照常安装。
                     唯一被强制的维度是 Node 下限(index.js:12-22 + engines)。

candidate state Y:   新增 `os` / `cpu` 声明,使 npm 在不匹配的平台上拒绝安装
                     (或选择其他强制点)。

observable delta:    package.json 的字段;运行时可观测面是**安装是否失败**。

**这是一个用户可见的收窄。** 今天装得上的环境,明天可能装不上。
因此 P4 与 P1 必须分开裁:
    P1  写下我们支持什么          —— 一句陈述
    P4  让不支持的环境装不上      —— 一个有后果的强制
UDR 里 D1(版本)与 D3(依赖类别)分开,正是同一个理由:
**声明与强制是两个主语。**

authority boundary:  产品意图 + 用户影响。测量只能回答「哪些环境实际能装」,
                     回答不了「是否应当拒绝其余环境」。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     NOT WRITTEN (Stage 2)

does NOT authorize:  不定义支持范围(P1)· 不定义验证集合(P2)

verdict:             UNSET
```

## 3. 三个尚未裁定的问题(Stage 1 只登记,不回答)

```text
Q1  Windows × Node 20 属于哪一类?
      (a) 不支持
      (b) 支持,但当前 CI 环境验证不了
      (c) 支持,且验证**委托给另一种机制** —— 「better-sqlite3 是否有 win-x64
          node-20 prebuild」本身是可直接查证的事实,不必依赖 runner 有没有 MSVC
    (b) 与 (c) 差别很大:(b) 留一个洞,(c) 换一条可执行的验证路径。

Q2  macOS 与 arm64 属于哪一类?
    今天 published manifest **不限制**、CI **完全不测**、代码里却有 9 处平台分支。
    「沉默」既可以读成「支持但没测」,也可以读成「从未想过」——
    这个歧义必须由 P1 消除,而不是继续沉默。

Q3  这份合同最终应当落在哪里?
      docs/validation/     与本 gate 同族的决策记录(本文件现在的位置)
      docs/specs/          本仓存放**设计合同**的地方;将来会被其他决策消费
      package.json         若含 P4,则强制点必然在这里
    Y 的落点会影响它能不能充当 authority,因此属于主语的一部分,
    但本阶段不替项目决定。
```

## 4. Stage 2 之前不得做的事

```text
不写 GREEN / RED                 不写 required authority
不写 missing-authority disposition
不回答 §3 的 Q1 / Q2 / Q3
不裁定任何一项                    不修改 package.json / workflow / 任何生产文件
不由本文件作者宣布 S_PRODUCT ——   那是 §0.3 明确保留给项目所有者的动作
```
