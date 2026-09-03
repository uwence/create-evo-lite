# 产品支持范围与验证集合(A0 gate)

- 议题:补一份 create-evo-lite 一直缺失的**产品级兼容性合同**
- 日期:2026-09-03
- baseline:`main@af590b8`
- 缘起:`zvec-070-upgrade-decision.md`(UDR)裁决时,D1 因缺 A0 而 DEFERRED。
  但本 gate **不是** zvec gate —— 见 §0.1。

```text
STAGE 2 — CRITERIA CONTRACT
Stage 1(subject contract)已于 e1084f01 冻结,本阶段不得改动它。
本阶段写「按什么条件裁」,见 §5。四个 verdict 仍为 UNSET;
**Q1 / Q2 仍然不答** —— 理由见 §5 开头。
```

## 0. 阶段顺序(沿用 UDR 已验证的结构)

```text
Stage 1  decision subjects · X→Y · subject_status · authority boundary
             ↓ COMMIT + REVIEW        ✔ FROZEN @ e1084f01(2026-09-03 复审 APPROVED)
Stage 2  required authority · GREEN iff · RED iff · missing-authority disposition
             ↓ COMMIT + REVIEW        ← 当前阶段(§5)
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

## 1. 现状:今天的树里实际存在什么(以及没有什么)

全部为本轮实测,逐条可核。

```text
现状必须拆成**三层**,不能压成一句。前两次复审各拦下一次压缩:

  第一层  产品支持声明
      未定义。树里没有任何一处说「我们承诺支持哪些环境」。

  第二层  package metadata(**声明**,不等于强制)
      package.json:16-18   "engines": { "node": ">=20.0.0" }   兼容性**声明**
      package.json:19      "engineStrict": true
      package.json         os  字段不存在  → npm 不按 OS 阻止安装
                           cpu 字段不存在  → npm 不按 CPU 阻止安装
      仓库内**没有任何 `.npmrc`**(`git ls-files` 无匹配)。

      **`engines` 是否会真的阻止安装,取决于消费者侧的 `engine-strict` 配置,
      而该配置默认为 false。** package.json 里的 `engineStrict` 字段是 npm 早期
      的形式,**它当前是否仍有效果,本文件未予证实** —— 登记为待钉的观察,
      而不是当作既成的强制。若 P4 打算依赖 install-time 强制,
      这一条必须先在 Stage 2/3 钉死。

  第三层  runtime hard enforcement(**真正被强制的只有这一条**)
      index.js:12      const MIN_NODE_MAJOR = 20;
      index.js:17-22   assertNodeVersion() 在入口检查 process.versions.node,
                       不满足即非零退出,文案
                       "Evo-Lite requires Node.js >= 20 (found …)"
      —— 只有**下限**。没有上限,没有平台,没有架构。

  三层之间不得互相顶替:
      installation eligibility  ≠  support commitment
      metadata declaration      ≠  enforcement
  第一条是 UDR 里 `CI coverage ≠ product support scope` 的同型;
  第二条是它的第三个变种 —— **一个读起来像强制的字段,不等于一次强制**。
  今天这个包在 macOS、在 arm64 上都会照常安装,那是机制事实,不是承诺。

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
在 CI 里只测两个 OS、在已发布清单里对平台与架构不施加安装资格限制,
并在规范散文中引用了一个从未被定义的「supported Node range」——
而**「产品承诺支持哪些环境」这句话本身,树里一处都没有**。

上面每一条都是**机制事实**,没有一条是承诺。把其中任何一条读成承诺,
都是同一个错误:拿一个可观测的机制去替一句从未有人说过的话。

## 2. Decision nodes

字段沿用 UDR 的两条独立状态轴:`subject_status` 与 `verdict`,任何一条都不得写进另一条。

本节冻结的是**主语**(Stage 1)。判据由 Stage 2 写在 §5.3–5.6,
不回填到本节 —— 主语与判据分处两节,是为了让「主语已冻结」这件事
在 diff 上一直可见。四个 verdict 仍全部是 `UNSET`。

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
                     平台与架构维度上,published manifest 只是**不施加安装资格限制**,
                     那是机制事实,不是支持承诺(§1)。

candidate state Y:   一份**具名的**声明,至少覆盖三个维度并对每一维给出取值:
                       OS         (win32 / linux / darwin / …)
                       CPU arch   (x64 / arm64 / …)
                       Node       (下限?上限?按 major 枚举?)
                     以及每一维的取值**理由**,而不只是取值本身。

observable delta:    新增一份声明文件;若选择让 package.json 指向它,则另加一处引用。
                     运行时可观测面:本阶段无 —— P1 只声明,不改变任何执行路径。

authority boundary:  **产品意图类**。没有任何测量能证明它;由项目所有者宣布(§0.3)。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     见 §5(Stage 2 已写)

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
                     见 §5(Stage 2 已写)

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
                     见 §5(Stage 2 已写)

does NOT authorize:  不改变 P1 / P2 的取值

verdict:             UNSET
```

---

### Decision P4 —— 是否把 P1 声明的支持边界**落实为安装 / 运行时强制**

```text
decision subject:    是否、以及如何在 package.json(`os` / `cpu`)、
                     runtime preflight(index.js 现有的 assertNodeVersion 一类)
                     等位置,对 unsupported environment 施加强制,
                     使 P1 的声明从「文档里的话」变成「安装或启动时的行为」。
subject_status:      INSTANTIATED

current state X:     manifest 当前对 OS / CPU **不施加安装资格限制**
                     (package.json 无 `os`、无 `cpu`),
                     而**产品支持范围本身尚未声明**(见 P1)。

                     唯一由仓库自身明确 **hard-enforce** 的维度是 Node 下限,
                     强制点是 **index.js:17-22 的入口 `assertNodeVersion()`**。
                     `engines.node >= 20` 是兼容性 **metadata**;在默认 npm 配置下
                     不能与该 runtime hard gate 等同(§1 第二层)。

candidate state Y:   依据 P1 的最终声明,决定是否以及在哪些位置强制。
                     取值不是二元 —— 强制点至少有两个,后果不同:
                       manifest os/cpu    npm 在不匹配平台上拒绝安装
                       runtime preflight  装得上但启动时拒绝运行,可给出可读理由
                     P1 未定之前,本节点的 Y 无法取值。

observable delta:    package.json 的字段 / preflight 的判定;
                     可观测面是**安装是否失败**或**启动是否被拒**。

**若最终选择收窄,那是一个用户可见的变化:** 今天装得上的环境,明天可能装不上。
因此 P4 与 P1 必须分开裁:
    P1  写下我们支持什么          —— 一句陈述
    P4  让不支持的环境装不上/跑不起来 —— 一个有后果的强制
UDR 里 D1(版本)与 D3(依赖类别)分开,正是同一个理由:
**声明与强制是两个主语。**

注意方向只能是 `policy → enforcement`。**不得**反过来从 package.json 现有字段
或 workflow 现有矩阵**推出**产品政策 —— 那正是本 gate 要修的病。

authority boundary:  产品意图 + 用户影响。测量只能回答「哪些环境实际能装」,
                     回答不了「是否应当拒绝其余环境」。

required authority / GREEN iff / RED iff / missing-authority disposition:
                     见 §5(Stage 2 已写)

does NOT authorize:  不定义支持范围(P1)· 不定义验证集合(P2)

verdict:             UNSET
```

## 3. 三个问题:Q1 / Q2 仍未裁定,Q3 已答

```text
Q1  Windows × Node 20 属于哪一类?
      (a) 不支持
      (b) 支持,但当前 CI 环境验证不了
      (c) 支持,且该格的**某些 verification predicate** 可以由 non-runner authority
          承担 —— 例如「better-sqlite3 是否发布了 win-x64 node-20 prebuild」
          是可直接查证的事实,不必依赖 runner 有没有可检测的 MSVC。

    **(c) 的边界(第一轮复审收紧,承重):**
        prebuild 存在  =  该格内**一项** admissible evidence,
                          只能承担 dependency-installability 这一条 predicate
        prebuild 存在  ≠  该 V_PRODUCT cell 的验证成立

    产品自身还有大量 platform-sensitive 的运行路径(§1:九个已发布运行时文件按
    process.platform 分支),它们不因某个依赖能装上而被覆盖。
    若将来 P3 要主张「Windows × Node20 不需要 end-to-end CI」,必须**另行证明**
    那些 Windows 专属行为已由某个 equivalence class 或其他 authority 覆盖。

    这条边界写在 Stage 1,是因为 Stage 2 极易把「一项前置条件绿」洗成
    「整格代表性成立」—— 与 UDR 里「测量阶段 SATISFIED → 升级 YES」同一形状。

    (b) 与 (c) 的差别仍然成立:(b) 留一个洞,(c) 把该格**部分** predicate
    换到一条可执行的验证路径上,但不豁免整格。

Q2  macOS 与 arm64 属于哪一类?
    今天 published manifest **不限制**、CI **完全不测**、代码里却有 9 处平台分支。
    「沉默」既可以读成「支持但没测」,也可以读成「从未想过」——
    这个歧义必须由 P1 消除,而不是继续沉默。

Q3  这份合同最终应当落在哪里?
    ANSWERED —— 2026-09-03 Stage 1 复审裁决,**项目所有者同日接受**。
    落点固定为三层,各自的角色不得互换:

      canonical authority   docs/specs/<product-support-contract>.md
                            = S_PRODUCT · V_PRODUCT · coverage justification
                              · reevaluation triggers
                            它会被 zvec、better-sqlite3、release gate 以及未来的
                            native 依赖长期反复消费 —— 那是**设计合同**,
                            不是一次验证报告。
                            (该文件目前**尚不存在**;本条只固定落点,不假装它已有。)

      decision record       docs/validation/product-support-scope.md(本文件)
                            = 三阶段的裁决记录,回答「为什么形成这个合同」。
                            **不作为长期 canonical policy 的唯一载体。**

      enforcement /         package.json · index.js · workflows
      verification surfaces = 消费 canonical contract 的强制 / 验证面。
                            它们**不因为自己有字段或有矩阵就成为产品政策 authority**。

    方向固定为 `policy → enforcement`。反向推理(`package.json 有什么字段`
    或 `workflow 跑了哪几格` → 因此产品政策是什么)正是本 gate 要修的病;
    若不写死这条,几年后会再长出同一个问题。
```

## 4. Stage 1 的边界(已冻结,记录在此以免回退)

以下是 **Stage 1 当时**的禁止范围。其中「不写 GREEN / RED / required authority /
missing-authority disposition」已随 Stage 2 授权而解除;**当前阶段的边界见 §5.8**。
保留这一节,是为了让「哪些约束在哪个阶段成立」在文件里一直可查。

```text
不写 GREEN / RED                 不写 required authority
不写 missing-authority disposition
不回答 §3 的 Q1 / Q2(Q3 已由 Stage 1 复审裁决)
不裁定任何一项                    不修改 package.json / workflow / 任何生产文件
不由本文件作者宣布 S_PRODUCT ——   那是 §0.3 明确保留给项目所有者的动作
```

## 5. Stage 2 —— criteria contract

```text
STAGE 2 — CRITERIA CONTRACT
Stage 1(subject contract)已于 e1084f01 冻结,本阶段不得改动它。
本阶段写「按什么条件裁」:required authority · GREEN iff · RED iff ·
missing-authority disposition。

四个 verdict 仍为 UNSET。**仍然不回答 Q1 / Q2** —— 即便它们的 authority 就是
项目所有者本人的声明,在判据冻结之前给出,等于让作者带着已知的期望答案去写判据,
又回到「先看结果、再写判据」。压着不给,是为了让那个产品决定以后还能当干净的
authority 用。
```

### 5.0 本 gate 不另建 typed edge graph

P1–P4 之间的依赖全部是同一种形状:**某节点的判据消费另一节点的产出**
(P4 消费 P1 的声明;P3 消费 P1 与 P2)。这可以直接写成 authority 要求,
不需要再造一套边类型。

UDR 需要图,是因为那里存在两类**真正不同**的关系:节点之间的 LOGICAL 冲突,
以及「下游主语是否已经存在」的 SUBJECT_INSTANTIATION。本 gate 两者都没有:
四个主语在 Stage 1 已全部 INSTANTIATED,彼此也不互斥。
少造一层结构,少一处可以出错的地方。

### 5.1 disposition 词汇表与先后规则(与 UDR 对齐,非新发明)

```text
DEFERRED   被点名的 authority 未实例化,且没有独立成立的 RED。
           不得因 authority 缺失而记为 NO。
BOUNDED    authority 已实例化但作用域小于节点作用域,**且候选 Y 本身能够强制执行
           同一条边界**。Y 执行不了该边界时 → DEFERRED,不得 bounded GREEN。

先后规则:  `RED iff` 是**充分条件**。一条独立成立的 RED **不会**被其他 authority
           的缺失擦掉;missing-authority 的 DEFERRED 只在**没有**独立 RED 时生效。

normative authority 的三态(P1 / P4 的 B1 尤其适用):
           authority 缺失或未决              → DEFERRED
           权威证据**明确否定**该命题         → RED
           仅仅「找不到支持性 authority」      → 仍是 DEFERRED,不是 RED
```

### 5.2 Authority 定义

编号用 `B` 前缀,以免与 UDR 的 `A0–A9` 在同时阅读时混淆 —— 两份文件的 authority
不共享,不得互相顶替。

```text
B1  support-scope declaration authority                        (P1 · P4)
    必须给出:项目所有者对 S_PRODUCT 的**声明**,对 OS / CPU arch / Node 三轴
    各自取值,并给出每一轴的取值理由。
    这是**产品意图**类 authority。没有任何测量能产生它 ——
    测量只能回答「哪些环境实际能装 / 能跑」,回答不了「我们承诺支持哪些」。
    candidate source:项目所有者的声明。§3 的 Q1 / Q2 正是它的内容。

B2  Node lifecycle authority                        (条件性;仅当 B1 使用滚动定义)
    仅当 B1 采用「当前维护中的 Node major」这类**随时间变化**的定义时才需要:
    必须指名一个外部生命周期来源(例如 Node 官方发布/维护日程),
    并说明该来源变化时本合同的重评路径。
    B1 若采用静态枚举(例如「20 / 22 / 24」),本 authority **不适用**,
    不得因为它未实例化而使 P1 无法 GREEN。

B3  cell verification predicate authority                            (P2)
    必须给出:一个 V_PRODUCT cell 要算作 **verified**,需要满足哪一组 predicate。
    这组 predicate 必须**逐条具名**,至少区分:
        dependency installability   原生依赖能否在该 cell 装上
        product runtime behaviour   产品自身的 platform-sensitive 路径是否被覆盖
    §1 已记录:`.evo-lite/cli/` 下九个已发布运行时文件按 process.platform 分支,
    因此第二类 predicate **不因第一类成立而被覆盖**。

B4  non-runner evidence delegation authority              (条件性;仅当发生委托)
    仅当某个 cell 的**部分** predicate 由非 runner 证据承担时才需要:
    必须指明该证据承担**哪一条** predicate、以及**不承担**哪些。
    Stage 1 已冻结该边界的现成例子:
        better-sqlite3 win-x64 node-20 prebuild 存在
            = 承担 dependency-installability 这一条
            ≠ 该 cell 已 verified

B5  equivalence-class authority                                      (P3)
    必须给出:每一处从 V_PRODUCT 外推到 S_PRODUCT 的**等价类**由什么建立。
    可能的承担者(本阶段只列举,不预判哪一种成立):
        外部技术合同    例如 N-API / ABI 稳定性保证、Node 官方兼容承诺
        产品自身论证    例如「本产品不使用任何晚于 X 的 API」,可由代码事实支撑
        所有者声明      明确接受未测部分的风险,并把该风险写进合同
    **「我们测了这些,所以这些有代表性」不是等价类**,见 P3-R1。

B6  enforcement-effectiveness authority                   (条件性;仅当 P4 依赖它)
    仅当 P4 的候选方案依赖某个**其效果尚未确立**的强制机制时才需要:
    必须证明该机制在目标 npm / toolchain 语义下**真实生效**。
    现成的待钉例子(Stage 1 §1 第二层登记):
        package.json 的 `engines` 是否会阻止安装,取决于消费者侧的
        `engine-strict` 配置(默认 false);`engineStrict` 字段的当前效果**未证实**。
    **不得**因为现在看见这个字段,就让它成为**所有** P4 候选方案的必需证据 ——
    若 P4 选择 runtime preflight(index.js 一类,其效果已由现有代码确立),
    B6 不适用。
```

### 5.3 P1 —— 声明 S_PRODUCT

```text
required authority:  B1(必需)· B2(条件性,仅当 B1 使用滚动定义)

GREEN iff:
    G1  B1 存在,且对 **OS / CPU arch / Node** 三轴**各自**给出取值。
    G2  **不允许沉默。** 每一轴必须取以下三者之一,且必须是显式的:
            SUPPORTED       具名集合
            UNSUPPORTED     具名集合(显式排除,不是没提到)
            DEFERRED        显式声明「本轮不决定」,并说明该缺口如何流入 P2 / P3
        「没写到」不是取值 —— 那正是今天 macOS 与 arm64 的处境(§3 Q2),
        也是本 gate 存在的原因。
    G3  每一轴的取值附**理由**,而不只是取值本身。理由不必是测量,
        但必须能被复述成一句独立于「我们测过什么」的话。
    G4  若任一轴使用滚动定义,则 B2 存在,且合同写明该外部来源变化时的重评路径。

RED iff:
    R1  三轴中任意一轴**保持沉默**(既不 SUPPORTED、也不 UNSUPPORTED、
        也不显式 DEFERRED)。沉默会被下游读成任意一种,这正是 X 的病灶。
    R2  声明与**同一份合同内**的其他部分自相矛盾。
    R3  B1 的反向(§5.1 三态):存在权威证据**明确否定**该声明所要确立的命题。
        仅仅「找不到支持性 authority」不是 R3。

missing authority disposition:
    B1 未实例化 → DEFERRED。这是本 gate 当前的**预期状态**:
    Q1 / Q2 被刻意压着不答,因此 Stage 3 若在所有者声明之前进行,P1 必然 DEFERRED。
    **这不是缺陷,是设计** —— 它保证判据先于答案冻结。
    B2 在 B1 采用静态枚举时**不适用**,不产生 DEFERRED。

verdict:  见 §2 的节点块 —— verdict 只有一个家,本节不留副本
```

### 5.4 P2 —— 声明 V_PRODUCT

```text
required authority:  B3(必需)· B4(条件性,仅当发生委托)

GREEN iff:
    G1  V_PRODUCT 是**有限且可枚举**的:要么逐 cell 列出,
        要么给出一组具名 equivalence class 并逐个列出其代表 cell。
    G2  B3 存在:每个 cell 的 verification predicate 集合逐条具名,
        且至少区分 dependency installability 与 product runtime behaviour。
    G3  **不得默认继承 CI 配置。** V_PRODUCT 可以恰好等于当前 release-gate 的
        五个格子,但那必须是**被裁定的结论**,并写明理由;
        「workflow 里就是这么写的」不构成理由(UDR §5.0 已冻结同一条)。
    G4  若发生委托,B4 存在,且逐条写明该证据承担哪一条 predicate、不承担哪些。

RED iff:
    R1  **evidence laundering:** 任何一处把「某一条 predicate 成立」当作
        「该 cell 已 verified」。Stage 1 §3 Q1 已把这条边界冻结成现成例子。
    R2  V_PRODUCT 不可枚举(例如直接写「所有受支持的环境」),
        使「覆盖每一格」在原则上无法交付 —— 这正是 UDR 里 `engines >= 20`
        当过一次矩阵的那个错误。
    R3  V_PRODUCT 中存在 S_PRODUCT 之外的 cell,且未说明它为何在验证集内。

missing authority disposition:
    B3 未实例化 → DEFERRED。
    B4 在没有委托时不适用,不产生 DEFERRED。
    **P2 不因 P1 未定而自动 DEFERRED** —— 一个有限验证集可以先被定义出形状,
    但它与 S_PRODUCT 的关系由 P3 承担;两者不得互相顶替。

verdict:  见 §2 的节点块 —— verdict 只有一个家,本节不留副本
```

### 5.5 P3 —— coverage justification

```text
required authority:  B5(必需)· B1 与 P2 的产出(作为被消费的输入)

GREEN iff:
    G1  **逐维映射:** S_PRODUCT 的每一轴(OS / arch / Node)都有一条说明,
        讲清 V_PRODUCT 的哪一部分代表它、代表到什么程度。
        任何一轴缺映射即不满足 —— 不允许「整体看起来充分」。
    G2  每一处外推都有 B5 指名的等价类承担者,且该承担者**不是**
        「我们测了这些」本身。
    G3  **移动定义的重评触发条件**:若 S_PRODUCT 任一轴使用滚动定义,
        合同必须写明什么事件触发重评(新 Node major 进入/退出维护、
        prebuild 覆盖面变化、runner 镜像变化等),否则冻结的 V_PRODUCT 会在
        无人改动的情况下悄悄过期。
    G4  **coverage shortfall 的处置写在合同里**:当某一轴的等价类只覆盖一部分时,
        合同必须说明该轴的结论如何被限制(而不是让下游自行外推)。

RED iff:
    R1  **循环论证:** justification 的实质内容是「我们验证了 V_PRODUCT 中的这些,
        所以它们有代表性」。这是同义反复,不是 justification。
    R2  存在一轴没有任何映射,却在结论中被当作已覆盖。
    R3  使用滚动定义但没有重评触发条件 —— 合同会过期而无人察觉。

missing authority disposition:
    B5 未实例化 → DEFERRED。
    P1 或 P2 未 GREEN 时,P3 的输入不完整 → DEFERRED,**不是 RED**:
    「上游还没定」与「这个 justification 不成立」是两件事。

verdict:  见 §2 的节点块 —— verdict 只有一个家,本节不留副本
```

### 5.6 P4 —— 是否落实为强制

```text
required authority:  B1(必需:强制必须从声明派生)
                     B6(条件性:仅当候选机制的效果尚未确立)

GREEN iff:
    G1  **严格从 P1 派生:** 强制的边界与 B1 声明的边界一致。
        强制比声明**更宽**(拦住了被声明支持的环境)或**更窄**(放行了被声明
        不支持的环境),都不满足。
    G2  选定的强制点及其**用户后果**被写明。至少区分两类,因为后果不同:
            install-time   npm 在不匹配环境上拒绝安装
            runtime        装得上,但入口拒绝启动,并给出可读理由
        (index.js 现有的 assertNodeVersion 是后者的既成例子。)
    G3  若候选机制的效果尚未确立,则 B6 存在。
        若选择 runtime preflight 这类效果已由现有代码确立的机制,B6 不适用。
    G4  **drift 检测**:合同写明「P1 的声明」与「强制面的实际取值」如何保持一致、
        由什么发现不一致。本仓已有同型先例可参照 —— 治理测试 T18e 断言
        `index.js` 的常量与 `templates/runtime/package.json` 逐字相等。
    G5  **「不强制」也是一个合法取值**,但选它同样要过 G1 与 G4:
        必须说明为什么仅有声明就足够,以及声明与实现漂移时靠什么发现。

RED iff:
    R1  强制边界与 B1 的声明不一致(G1 的否定)。
    R2  把一个**效果未经确立**的机制作为强制手段交付 —— 例如仅凭
        package.json 里存在 `engineStrict` 字段就宣称安装期已被强制
        (Stage 1 §1 第二层已把该字段的效果登记为未证实)。
    R3  强制的边界**不是**从 P1 派生,而是从现有字段或现有 CI 矩阵反推出来的。
        方向只能是 `policy → enforcement`。

missing authority disposition:
    B1 未实例化 → DEFERRED。**P4 在 P1 定案之前不可能 GREEN** ——
    没有声明就没有可派生的边界(Stage 1 已冻结:P1 未定之前 P4 的 Y 取不了值)。
    B6 在候选机制效果已确立时不适用,不产生 DEFERRED。

verdict:  见 §2 的节点块 —— verdict 只有一个家,本节不留副本
```

### 5.7 判据自检:拿掉每一条,哪种坏情况会被放过

```text
P1-G2  拿掉 → macOS / arm64 继续沉默,下游各自解读,X 的病灶原样保留
P1-G3  拿掉 → 取值有了但无人知道为什么,下一次讨论从零开始
P1-G4  拿掉 → 滚动定义没有生命周期来源,合同随 Node 发布日程静默过期
P2-G1  拿掉 → V_PRODUCT 写成「所有受支持环境」,覆盖在原则上无法交付
P2-G2  拿掉 → cell「验证过」但没人说得清验证了什么
P2-G3  拿掉 → CI 配置直接升格成产品验证集,workflow 又一次自行定义产品
P3-G1  拿掉 → 某一轴无人映射却被当作已覆盖
P3-G2  拿掉 → 等价类由「我们测了」自我证成,循环论证成立
P3-G3  拿掉 → 冻结的 V_PRODUCT 在无人改动的情况下过期
P3-G4  拿掉 → 部分覆盖被下游读成完全覆盖
P4-G1  拿掉 → 强制与声明各走各的,用户被一条没人声明过的边界拦住
P4-G2  拿掉 → 用户后果不明:装不上与跑不起来被当成同一件事
P4-G4  拿掉 → 声明改了而强制面没改,漂移无人发现
P4-G5  拿掉 → 「不强制」变成默认结论而不是被裁定的选择
```

四条交叉引用继承被引用条,不另作解释:P2-G4 ← B4 的定义;P3 的输入完整性
← P1-G1/G2 与 P2-G1;P4-G3 ← B6 的条件性;P4-G5 的 G1/G4 部分 ← 同节。

### 5.8 Stage 3 之前不得做的事

```text
不填任何最终 verdict
不回答 Q1 / Q2 —— 即便其 authority 就是所有者本人的声明
不判断某个 authority 当前是否真的存在
不判断现有事实是否满足某条 GREEN 或命中某条 RED
不改动 Stage 1 的主语,也不为迎合任何已知答案改动本阶段判据
不创建 docs/specs/ 下的 canonical contract —— 那是 P1 GREEN 之后的产物,
    不是本 gate 的作者可以代写的东西(§0.3)
不修改 package.json / index.js / workflow / 任何生产文件
```
