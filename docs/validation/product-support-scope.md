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
                     NOT WRITTEN (Stage 2)

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

## 4. Stage 2 之前不得做的事

```text
不写 GREEN / RED                 不写 required authority
不写 missing-authority disposition
不回答 §3 的 Q1 / Q2(Q3 已由 Stage 1 复审裁决)
不裁定任何一项                    不修改 package.json / workflow / 任何生产文件
不由本文件作者宣布 S_PRODUCT ——   那是 §0.3 明确保留给项目所有者的动作
```
