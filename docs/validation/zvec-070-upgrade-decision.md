# @zvec/zvec 0.6 → 0.7 升级决策记录(UDR)

- 议题:`[zvec-win-unicode-containment]` 测量阶段结束之后的**裁决**阶段
- 日期:2026-09-02
- baseline:`main@99c6f87`(测量阶段收口后)
- 前序证据:Step 1 `zvec-070-win-unicode-recheck.md` · 2A `zvec-070-install-matrix.md`
  · 2B `zvec-070-adapter-contract.md` · 2C `zvec-070-nonascii-bridge.md`

```text
STAGE 2 — CRITERIA CONTRACT
Stage 1(subject contract)已于 d235e99 冻结,本阶段不得改动它。
本阶段写的是「按什么条件裁」:required authority · GREEN iff · RED iff ·
missing-authority disposition · evidence edges。

所有 verdict 仍为 UNSET。仍然不读取任何证据的结果,不判断任何 authority
当前是否存在,不判断现有证据是否满足 GREEN 或命中 RED —— 那些都是 Stage 3。
```

## 0. 三阶段顺序(冻结)

```text
Stage 1   decision subjects · X → Y · subject_status · typed dependency graph
          · deliberately absent edges · verdict = UNSET · GREEN/RED = NOT WRITTEN
              ↓ COMMIT + REVIEW        ✔ FROZEN @ d235e99(2026-09-02 复审 APPROVED)
Stage 2   GREEN iff · RED iff · required authority · missing-authority disposition
          · evidence edges · 仍然不填 verdict
              ↓ COMMIT + REVIEW        ← 当前阶段
Stage 3   consume frozen evidence · fill dispositions / verdicts
```

拆成三段的理由是本轮的实际发现,不是仪式:六项的历史标签里有三项的**主语**站不住。
先冻结主语再写判据,可以保证以后即使某条 GREEN/RED 很难写,也**不能**为了迎合现有证据
回头重新定义 D3 / D5 / D6 在裁什么。

### 0.1 主语为什么必须先冻结

历史标签(`pin` / `RUNTIME_DEPENDENCIES` / `optional → mandatory` / `default flip` /
`containment` / `release`)来自已合入的 Step 2C §9。它们是**登记**,不是定义。
核对代码后,其中三项的标签所指与树里的实际状态不符或不唯一:

```text
default flip   DEFAULT_ENGINE_CHOICE 早在 2026-07-07 就已是 'zvec'
release        release-preflight 实测 VERDICT=CLEAR,blockers=0
optional→...   「optional」在本仓有三个互不相同的面(published manifest /
               scaffold runtime manifest / 加载失败回落语义)
```

对未定义的主语做 YES/NO,产生的是没有稳定语义的裁定。历史标签保留,
但**只作为历史标签**,不再充当裁定对象。

### 0.2 本轮裁决(2026-09-02,独立复审)

```text
SUBJECT_INSTANTIATION 边类型   APPROVED —— 作用于 subject_status,不得传播 verdict
D3 主语                        FROZEN —— published package manifest 的 dependency class
D4 subject_status              NOT_INSTANTIATED
D6 subject_status              NOT_INSTANTIATED,直到存在具体的 candidate change set
Stage 1 commit                 AUTHORIZED(subject contract freeze,非 criteria freeze)
Stage 2 GREEN/RED              尚未授权
verdicts                       ALL UNSET
implementation planning        FORBIDDEN
```

### 0.3 Stage 1 冻结与 Stage 2 授权(2026-09-02,独立复审)

Stage 1 经四轮复审后 **APPROVED / FROZEN @ d235e99**。四轮里被拦下的三处越界
全部是同一种错误 —— 把 Stage 2 的字段换个位置提前写掉:

```text
第 2 轮   E1/E2/E3 在 graph 里命名了 authority,E3 还宣告它「当前不存在」
第 3 轮   §2.3 写了「该组合该由 Stage 2 判红」,提前冻结了一个 RED 方向
第 4 轮   EVIDENCE_PREREQUISITE 的**类型定义**替所有未来实例规定了缺失时算什么
```

Stage 2 授权范围(严格限定为 criteria freeze):

```text
允许:为 D1 / D2 / D3 / D5 写 required authority · GREEN iff · RED iff ·
      missing-authority disposition;实例化新的 EVIDENCE_PREREQUISITE 边
      (新 ID,不复用 E1/E2/E3/E5);把 candidate source 绑定到
      「需要它证明哪个具体事实」。

禁止:填任何最终 verdict;判断某个 authority 当前是否真的存在;
      判断现有证据是否满足 GREEN 或命中 RED;用 Step 1/2A/2B/2C 的**实际结果**
      反推 criteria;实例化 D6;为 D4 写 criteria;写实施计划或改生产文件。
```

**本阶段作者纪律(自陈,供复审核对):** 撰写本阶段判据期间未读取 2A / 2B / Step 1
的正文;这三份在本工作线的当前会话中只有标题与 2C 对它们的转述。2C 的结果作者已知,
因此 D5 的每一条 GREEN 都标注了它的来源是 **[主语推导]** 还是 **[通用方法论]**,
以便复审检查是否有从结果倒推的痕迹。

## 1. 六个 decision node

### 1.0 两条状态轴(冻结)

`subject_status` 与 `verdict` 是**两条独立的轴**,任何一条都不得写进另一条:

```text
subject_status:   INSTANTIATED | UNRESOLVED | NOT_INSTANTIATED
verdict:          UNSET  (Stage 3 之前不允许出现任何最终 disposition)
```

因此**不得**出现 `D4 verdict = NOT_INSTANTIATED` 这样的写法 —— 那会让 Stage 1
偷偷变成一次裁定。主语不存在时,`subject_status` 说明它,`verdict` 仍然是 `UNSET`。

Stage 2 已填入 D1 / D2 / D3 / D5 的 `required authority` · `GREEN iff` · `RED iff`
· `missing authority disposition`。D4 与 D6 的这四个字段是 `N/A`,理由写在字段里:
它们的 `subject_status` 是 `NOT_INSTANTIATED`,**为不存在的主语写判据本身就是越界**。
六个 `verdict` 仍然全部是 `UNSET`。

---

### Decision D1

```text
historical label:    pin
decision subject:    create-evo-lite 自身 published package manifest 里声明的
                     @zvec/zvec 版本常量:该 manifest **请求 / 钉定**哪个版本。
                     **是否必须成功安装由 D3 决定** —— 当前该条目在
                     optionalDependencies 下,因此 D1 本身不保证依赖最终存在。
                     也不决定被脚手架出的子项目装什么(D2)。
subject_status:      INSTANTIATED

current state X:     package.json:13-15
                       "optionalDependencies": { "@zvec/zvec": "0.6.0" }
                     精确钉,非范围。package-lock.json 中对应条目锁在 0.6.0。

candidate state Y:   "@zvec/zvec": "0.7.0",同样精确钉。
                     Y 取精确版本而非 ^0.7.0,与本仓既有约定一致
                     (index.js:28-30「Exact-pinned … Bump these deliberately」)。
                     改为范围声明是另一个 decision subject,不在本节点内。

observable
tree/runtime delta:  package.json 一行 + package-lock.json 的 @zvec/zvec 条目
                     (version / resolved / integrity)。
                     运行时可观测面:本仓 node_modules/@zvec/zvec/package.json 的 version。

required authority:  A0 product-support scope
                        (给出 S_PRODUCT · V_PRODUCT · coverage justification)
                     A1 install / load compatibility(母体安装形态)
                     A3 real-adapter contract conformance
                     A7 upgrade-benefit
                     定义见 §5。

GREEN iff:           以下全部成立:
                     G1  A1 覆盖 **V_PRODUCT(§5 A0)的全部格子**,且每一格上 0.7.0
                         都能安装、其原生绑定都能被 require 解析。
                     G2  A3 证明本仓生产 adapter **实际消费的**那一组 API、返回值形状
                         与跨进程持久化行为在 0.7.0 上成立。
                     G3  作用域规则:G1 / G2 必须覆盖 V_PRODUCT 全部格子。
                         **作用域不足时的处置是 DEFERRED,不是 bounded GREEN** ——
                         D1 的 Y 是全局变更(唯一的 published pin),
                         树里没有机制做到「某些格子用 0.7.0、其余继续 0.6.0」,
                         因此不满足 BOUNDED 的可执行边界条件(§5.1)。
                     G4  A7 证明 0.6.0 上存在一个已登记、产品相关的问题,且 0.7.0
                         对它有实质、范围显式有界的改善。
                         **G1–G3 只能推出「0.7.0 兼容到可以使用」,推不出「该升」;**
                         没有 G4,两个在产品意义上完全等价的版本也会让本节点变绿。

RED iff:             任一成立即为 RED。**RED 绑定 S_PRODUCT,GREEN 绑定 V_PRODUCT** ——
                     这个不对称是刻意的:GREEN 是全称命题(必须覆盖每一格),
                     所以需要一个有限可枚举的 verification partition;
                     RED 是存在命题(一个反例即成立),反例落在**承诺范围内**的任何
                     位置都算数,不需要分区。
                     决策作用域之外的环境出现问题,本身不使本节点变红 ——
                     那属于 A0 该不该把该环境纳入 S_PRODUCT 的问题。

                     R1  S_PRODUCT 内存在一格:0.6.0 可安装 / 可加载,而 0.7.0 不能。
                     R2  合同回归 —— 在 S_PRODUCT 内存在一项:
                         0.6.0 满足而 0.7.0 不满足。
                     R3  0.7.0 在**当前被 containment 判为 SAFE** 的路径上出现
                         不可捕获的进程级失败。那意味着现有 containment 不再足够,
                         而 D1 本身不携带任何 containment 变更(见 does NOT authorize)。
                     R4  A7 的反向(§5.1a):存在**权威评估明确认定** 0.7.0 对已登记
                         的那个问题没有实质改善,或候选收益不足以成立 A7 的
                         upgrade premise。
                         **仅仅「找不到 A7」不是 R4**,那是 DEFERRED。

missing authority
disposition:         A0 / A1 / A3 / A7 任一未实例化 → DEFERRED(§5.1)。
                     不得因 authority 缺失而记为 NO。
                     A0 缺失时尤其不得退而用 S_GATE 代替 S_PRODUCT 继续裁 —— 见 A0。

depends on:          E4 · E6 (IMPLEMENTATION_COUPLING)
                     E8 · E9 · E15 · E18 (EVIDENCE_PREREQUISITE)

does NOT authorize:  不改变 dependency class(D3)· 不把 zvec 送进子项目 runtime(D2)
                     · 不改 containment 的任何不变量(D5)· 不构成发布决定(D6)

verdict:             UNSET
```

---

### Decision D2

```text
historical label:    RUNTIME_DEPENDENCIES
decision subject:    被 create-evo-lite 脚手架出的**子项目** .evo-lite/package.json
                     的依赖集合。它与 D1 / D3 是不同的安装面:D1 决定版本,
                     D3 决定 published package 的 npm 依赖语义,
                     D2 决定每个被创建的项目装什么。
subject_status:      INSTANTIATED

current state X:     index.js:31-36
                       { better-sqlite3 12.11.1, tar 7.5.16,
                         commander 15.0.0, @modelcontextprotocol/sdk 1.29.0 }
                     @zvec/zvec **不在其中**。
                     该常量由治理测试 T18e(templates/cli/test/governance.js:834-848)
                     断言与 templates/runtime/package.json 的 dependencies 逐字相等。

candidate state Y:   上述集合 ∪ { "@zvec/zvec": "<version>" }。
                     <version> 的取值与 D1 是协同项(E4),不是同一个决定。

observable
tree/runtime delta:  三处必须同步,否则 T18e 变红:
                       index.js 的 RUNTIME_DEPENDENCIES
                       templates/runtime/package.json
                       templates/runtime/package-lock.json
                     运行时可观测面:新建项目的 .evo-lite/package.json 与其 node_modules。

required authority:  A0 product-support scope
                        (给出 S_PRODUCT · V_PRODUCT · coverage justification)
                     A2 scaffolded-runtime install compatibility
                     A3 real-adapter contract conformance
                     A8 scaffold-runtime zvec-availability policy
                     定义见 §5。

GREEN iff:           G1  A2 覆盖被脚手架出的项目**实际使用的安装形态**
                         (templates/runtime 清单复制进 .evo-lite/ 后
                         `npm ci --prefix .evo-lite`),而不是母体的开发安装形态,
                         并在 **V_PRODUCT(§5 A0)的每一格**上成立。
                     G2  同 D1-G2(A3)。
                     G3  加入该条目后 index.js 的 RUNTIME_DEPENDENCIES、
                         templates/runtime/package.json 与其 package-lock.json
                         三者仍逐字一致(T18e 绿),且锁文件可复现。
                     G4  作用域规则同 D1-G3(V_PRODUCT 全覆盖;不足则 DEFERRED,
                         不得 bounded GREEN —— D2 的 Y 是所有 scaffold 共用的
                         runtime 清单,同样无法执行按格边界)。
                     G5  A8 证明:脚手架成功之后,child runtime **被产品要求**具备
                         zvec 依赖,而不是允许缺席后降级。
                         **G1–G4 只能推出「我们可以把 zvec 塞进每一个 scaffold
                         runtime」,推不出「每个 scaffold runtime 都应该必须有它」;**
                         而现有设计明确允许 require 失败时返回 null 并回落 Sqlite,
                         所以「zvec 是默认引擎」也不能替代这条。

RED iff:             R1  存在一格在 S_PRODUCT 内、而 zvec 在**子项目安装形态**下
                         无法安装或构建。RUNTIME_DEPENDENCIES 是必需依赖集合,
                         没有 optional 桶,因此这一格的失败会使**脚手架本身失败**,
                         而不只是记忆引擎降级。
                     R2  合同回归(同 D1-R2)。
                     R3  加入后锁文件不可复现,或三者无法同时保持一致(T18e 不可能同时绿)。
                     R4  A8 的反向(§5.1a):存在**明确的产品政策**规定
                         child runtime 必须允许在没有 zvec 的情况下作为**正常完成态**。
                         **仅仅「没有政策说明 child 必须具备 zvec」不是 R4**,
                         那是 DEFERRED。

missing authority
disposition:         A0 / A2 / A3 / A8 任一未实例化 → DEFERRED。
                     特别地:**只覆盖母体安装形态的 authority 不自动成为 A2** ——
                     两者的清单、锁文件与执行目录都不同(见本节点主语)。
                     同样地,**A5 不能顶替 A8**:一个是 published package 的安装结果,
                     一个是 child runtime 的依赖集合,Stage 1 已把它们冻结为独立主语。

depends on:          E4 (IMPLEMENTATION_COUPLING)
                     E10 · E11 · E16 · E19 (EVIDENCE_PREREQUISITE)

does NOT authorize:  不改母体自身的版本(D1)· 不改 published package 的依赖语义(D3)
                     · 不改 containment(D5)

verdict:             UNSET
```

---

### Decision D3

```text
historical label:    optional → mandatory
decision subject:    **Published-package dependency classification** ——
                     create-evo-lite 发布出去的 package manifest 对 @zvec/zvec
                     采用 optional 还是 required 的 npm 依赖语义。
                     主语于 2026-09-02 由独立复审冻结(§0.2)。
subject_status:      INSTANTIATED

current state X:     package.json:13   "optionalDependencies": { "@zvec/zvec": … }
                     npm 语义:安装失败不阻断 create-evo-lite 的安装。

candidate state Y:   同一条目移入 "dependencies",版本取值沿用该 manifest 另行选定的值
                     (即 D1 的结果;D3 自身不选版本)。

observable
tree/runtime delta:  package.json 中该条目所属的键名,以及 package-lock.json 中
                     该包的 optional/dev 标记。
                     运行时可观测面:在 zvec 安装失败的环境里
                     `npm i create-evo-lite` 本身是否失败。

**明确不属于 D3**(冻结):
                     · 把 zvec 加进 templates/runtime/package.json —— 那是 D2
                     · 把 zvec 加进 RUNTIME_DEPENDENCIES —— 那是 D2
                     · 删除 SqliteFtsIndex
                     · 删除 defaultLoadZvecIndex 的加载失败回落
                       (memory-index.js:194-198 在 require 失败时返回 null,
                        缺包不是不可恢复的 fatal condition;该语义不在本节点内)
                     · 改变 containment —— 那是 D5
                     · 改变 DEFAULT_ENGINE_CHOICE —— 见 D4

                     把上述任一项并进 D3,等于把三个不同问题
                     (dependency packaging / runtime availability / engine fallback
                     semantics)粘在一起,并会与 D5 直接相撞。冻结后的 D3 与 D5 正交。

required authority:  A0 product-support scope
                        (给出 S_PRODUCT · V_PRODUCT · coverage justification)
                     A4 published-package installability under required semantics
                     A5 product install-policy(与本节点 manifest-only 主语等宽)
                     定义见 §5。

GREEN iff:           G1  A4 证明:该条目移入 dependencies 后,在 **V_PRODUCT(§5 A0)
                         的每一格**上 `npm i create-evo-lite` 仍然成功。
                     G2  A5 证明:在 published-package 作用域内,
                         「create-evo-lite 安装成功、但 @zvec/zvec 缺席」
                         **不是产品允许的安装结果**。
                         它**不裁定**安装完成之后的 runtime fallback 是否仍可存在 ——
                         那不在 D3 的主语内(见「明确不属于 D3」)。
                     G3  作用域规则同 D1-G3(V_PRODUCT 全覆盖;不足则 DEFERRED,
                         不得 bounded GREEN —— D3 的 Y 是 published manifest 的
                         bucket,无法做到「证据覆盖的格子 mandatory、其余仍 optional」)。

RED iff:             R1  存在一格在 S_PRODUCT 内、而 zvec 在其上无法安装或构建 ——
                         mandatory 会把「记忆引擎降级」升级为「本包装不上」。
                     R2  存在一条**相反**的产品要求:明确要求「安装成功但 zvec 缺席」
                         必须是被允许的**安装结果**(例如对离线或受限环境的安装保证)。
                         这里说的是**安装结果中的依赖缺席**,不是安装后的运行时降级;
                         后者不在 D3 的主语内。

                     注意:A5 仅仅「未实例化」**不是** RED,见 disposition。
                     「没有要求它必装」与「要求它可以不装」是两回事。

missing authority
disposition:         A0 或 A4 未实例化 → DEFERRED。
                     A5 未实例化 → DEFERRED,且裁定必须点明一件事:
                     §3 的 candidate source inventory 全部是**测量**类文件,
                     而 A5 是**产品意图**类 authority。它是否由 inventory 之外的
                     来源提供,属 Stage 3 判定;Stage 2 对此不作断言。

depends on:          E6 (IMPLEMENTATION_COUPLING)
                     E12 · E13 · E20 (EVIDENCE_PREREQUISITE)

does NOT authorize:  不决定版本(D1)· 不决定子项目装什么(D2)· 不放松 containment(D5)

verdict:             UNSET
```

---

### Decision D4

```text
historical label:    default flip
decision subject:    ——
subject_status:      NOT_INSTANTIATED

理由(事实陈述,非裁定):
  该标签指向的决策已于 2026-07-07 由 spec `memory-engine-default-flip` §A3
  执行并 shipped。树里的当前状态就是它的终态:

      memory-index.js:177      const DEFAULT_ENGINE_CHOICE = 'zvec';
      memory-index.js:183-189  仅当 .evo-lite/memory-engine.json 显式声明时才覆盖

  在 0.6 → 0.7 语境下为该标签寻找残余主语,得到三个候选,全部不成立:

    (a)「让 zvec 在 Windows 非 ASCII 路径上成为实际默认」
        —— 与 D5 是同一个主语;重复登记会让同一件事被裁两次。
    (b)「子项目的默认引擎」
        —— 子项目消费同一份 cli 镜像与同一个 DEFAULT_ENGINE_CHOICE,无独立主语。
    (c)「移除 memory-engine.json 覆盖通道」
        —— 与 0.6 → 0.7 无关,属独立议题。

  即:历史标签 `default flip` 所描述的 X → Y 已经不再存在。

current state X:     'zvec'(自 2026-07-07 起)
candidate state Y:   ——(写不出与 D5 相区分的 Y)
observable
tree/runtime delta:  ——

required authority:  N/A —— subject_status = NOT_INSTANTIATED
GREEN iff:           N/A
RED iff:             N/A
missing authority
disposition:         N/A

depends on:          ——

does NOT authorize:  ——

verdict:             UNSET
```

---

### Decision D5

```text
historical label:    containment
decision subject:    containment 决策是否由**版本无关**变为**版本相关** ——
                     即它是否被允许区分「已证明的 0.7.0」与「0.6.0 / 未知版本」。
                     要裁的是这一条不变量,不是「containment 是否还要」。
subject_status:      INSTANTIATED

current state X:     containment decision is **version-blind**。
                     输入只有路径、平台与文件系统探测:

                       zvec-path-containment.js:50
                         SUPPORTED_CHARS = /^[A-Za-z0-9_\-.\\/: ]+$/
                       zvec-path-containment.js:277-294  classifyCollectionPath(collectionPath, options)
                         → SAFE(platform)      非 win32
                         → UNKNOWN(lexical)    含非 ASCII 字符等
                         → UNKNOWN(profile)    探测未通过
                         → SAFE(both)          supported-ascii-profile

                     非 ASCII collection path 在 win32 上得到 UNKNOWN,
                     memory-index.js:575-580 以 reason='containment' 回落 SqliteFtsIndex,
                     并明确不打开、不修改既有 collection。
                     上层 decision snapshot 采集 choice / platform / classifier / fs /
                     path / marker 等输入,**其中没有 binding version**。
                     **containment decision chain 上没有任何 installed-zvec-version 输入。**
                     `zvec-path-containment.js` 自身唯一的版本引用是第 8 行的注释
                     (「@zvec/zvec 0.6.0 terminates the process with 0xC0000409」),
                     它不参与判定。(版本值在树里当然还有很多处 —— package.json、
                     lockfile、validation 文档 —— 但它们都不是这条决策链的输入。)

candidate state Y:   containment decision becomes **version-aware**,
                     并可据此区分已证明的 0.7.0 与 0.6.0 / 未知版本。

                     结构事实(属 X/Y 定义,不属判据):
                       决策链上当前没有任何一处读取已安装的 zvec 版本。因此
                       **新增 version identity input 是 Y 的组成部分**,
                       不是将来实施时偶然冒出来的细节。

                     实现形态不改变主语:该输入既可进入 classifyCollectionPath 的签名,
                     也可留在上层由消费方按版本决定是否消费 containment 结论。
                     两者是同一个 Y 的两种落法。

**明确不属于 D5**(冻结):
                     直接放宽 SUPPORTED_CHARS 使非 ASCII 落入 SAFE。
                     它放宽的是**路径字符集而不是版本**,后果是
                     **0.6.0 与 0.7.0 同时被放行** —— 那是另一个 decision subject,
                     与「0.7 containment relaxation」不能混写在同一个节点里。

observable
tree/runtime delta:  containment decision 的输入集合(是否含 version);
                     classifyCollectionPath 的签名与返回 verdict;
                     memory-index.js 的 reason 取值分布;
                     `mem verify` 的 containment 段落输出。

required authority:  A6 version-bounded fault attribution(能不能安全地做)
                     A9 containment-change benefit / product policy(有没有理由做)
                     定义见 §5。

GREEN iff:           每条后面标注它的来源,以便复审检查有无从测量结果倒推:

                     G1  A6 提供一个**稳定且可泛化的版本 discriminant**:或者把该
                         native 失败类归因到一个可指名的机制并证明 0.7.0 改变了它,
                         **或者**一份强度相当的上游版本有界合同 / 修复保证。
                         无论哪一种,都必须强于「在若干样本上 0.7.0 没有崩」。
                         [主语推导:版本感知门断言的是「按版本有界」,样本本身界定不出
                          版本这条边界。第二轮复审收紧:严格从主语能推出的是
                          「需要一个稳定可泛化的版本判据」,不必然只能是内部 root-cause;
                          写死成机制会先验排除「机制未知但上游给出明确版本修复合同」
                          这一类有效 authority。]
                     G2  A6 能识别并隔离 observability-limited / control-not-reproduced
                         的 cell,使它们不被用作 0.7.0 的 safety 或 version-effect
                         证据(准入规则见 §5 A6)。
                         [通用方法论:缺席的观察不是缺席的证明。
                          与任何一次具体测量的结果无关。
                          第三轮复审收紧:原文写的是「与『该失败在那个环境下本就
                          不可观察』区分开」,那要求的是一个结构性不可观察的断言 ——
                          比这里需要的强,而且与 A6 的准入规则相冲突。]
                     G3  版本门开启的 SAFE 区域有一个**声明的边界**,且该边界不是
                         「已被测过的路径集合」。
                         [主语推导:门必须在未测路径上也给出答案,
                          否则它不是判定而是查表。]
                     G4  **pre-load provenance binding。** 版本身份必须绑定到
                         「若本次 decision 放行,loader 将实际解析并加载的那个
                         package / native target」,且该绑定必须在**执行 native
                         binding 之前**建立。

                         允许:对 exact module resolution target 做 package
                               identity / provenance 校验;读取**不会执行 native
                               addon** 的 metadata;证明其后 loader 使用的是同一个
                               resolved target。
                         禁止:为了知道版本而先 require / 执行 native binding;
                               只相信与实际 resolve target 没有绑定关系的 root
                               manifest 字符串。

                         [第二轮复审修正。原文写的是「必须标识**实际被加载的**
                          binding」,那与现有 zero-load 不变量**循环**:
                            memory-index.js:16-17  这两个模块 zvec-free by construction,
                                                   否则 containment decision 会发生在
                                                   hazard 之后
                            memory-index.js:212-214 decision 先于 loadZvecIndex,
                                                   zero-load 是最重要的性质
                            zvec-path-containment.js:12  唯一可用的 containment 就是
                                                   在 require('@zvec/zvec') 之前决定(I1)
                          「先确认实际加载的 binding → 再决定能否安全加载」不可实现。
                          改写后同时守住两条性质:身份不可过期 / 不可伪造,
                          **且** containment decision 仍然发生在 native load 之前。]
                     G5  containment marker 与 recovery 状态机在门开启时的行为已定义。
                         [来自现有 containment 合同的存在,不来自任何测量结果。]
                     G6  作用域规则:与 D1-G3 **不同** —— D5 允许 BOUNDED。
                         version-aware gate 本身能把开启范围限制在 A6 的覆盖范围内,
                         满足 §5.1 对 BOUNDED 的可执行边界要求。
                     G7  A9 证明:当前 version-blind 的 X 对某个产品相关范围造成了
                         需要解决的降级,而 version-aware 的 Y 能恢复所需能力,
                         且收益值得引入新的 version-identity 输入与随之增加的复杂度。
                         **G1–G6 全部只回答「能不能安全地建立这道门」,不回答
                         「为什么值得改变现在的 version-blind containment」。**
                         A9 不参与安全边界的判定 —— 安全仍完全由 A6 决定。

RED iff:             RED 条件同样标注来源。编号保留空档:R2 已移出本节点。

                     R1  在 candidate gate **新判为 SAFE / 新放行**的范围内,
                         0.7.0 表现出同一不可捕获的失败类;或者该失败发生的条件
                         **无法被 gate 的边界排除**。
                         [主语推导。第二轮复审收紧:D5 断言的不是「0.7.0 在任何路径上
                          都不崩」,而是「在门新放行的范围内不崩」。门外仍被 containment
                          拦住的路径不否决本节点 —— 否则一个可有界的门会被门外的事实杀死。]
                     R2  **已移出** —— 见 §5 中 A6 的 evidence admissibility 规则。
                         原文把「用对照未复现的环境去支持 0.7.0」写成 D5 的 RED,
                         那是把**坏证据**与**坏决策**混为一谈:后果应当是该 evidence cell
                         被判定不可采信,而不是 D5 这个产品决策本身变红。否则只要历史上
                         提交过一份方法有误的实验,即使之后存在完整有效的 authority,
                         D5 也会被永久 RED。
                     R3  版本输入可被伪造或过期:读到的不是实际加载的 binding。
                         [主语推导:G4 的对偶。]
                     R4  门开启后,既有 containment marker 的语义变为未定义。
                         [来自现有 containment 合同的存在。]
                     R5  A9 的反向(§5.1a):存在**明确政策**规定当前 containment 的
                         保守性必须保持,或该收益不足以抵偿引入 version-aware
                         复杂度的代价。
                         **仅仅「没有 authority 说明值得改」不是 R5**,那是 DEFERRED。

missing authority
disposition:         A6 或 A9 未实例化 → DEFERRED。
                     A6 已实例化但作用域小于本节点作用域 → BOUNDED(§5.1):
                     GREEN 只能在该有界范围内成立,**且版本门的开启范围不得超过它**。
                     A9 的作用域不足**不产生 BOUNDED** —— A9 不划安全边界,
                     它要么给出改变现状的理由,要么没有(→ DEFERRED)。

depends on:          E14 · E17 (EVIDENCE_PREREQUISITE)

does NOT authorize:  不改版本(D1)· 不改依赖分类(D2 / D3)· 不构成发布决定(D6)

verdict:             UNSET
```

---

### Decision D6

```text
historical label:    release
decision subject:    ——(条件性;见 E7)
subject_status:      NOT_INSTANTIATED

current state X:     实测(read-only,`node .evo-lite/cli/release-preflight.js`):

                       [release-preflight] create-evo-lite: no release blockers
                       [release-preflight] specs discovered=45 parsed=45, errors=0, blockers=0
                       [release-preflight] VERDICT=CLEAR

                     containment spec 的 `releaseBlocking: true` **仍在**
                     (docs/specs/zvec-win-unicode-containment.md frontmatter),
                     从未删除也未改 false;Task 9D 只把 lifecycle 推到 `status: done`,
                     于是它落在 §8.2.2 的 `done/shipped → ALLOW` 行。
                     **门没有被删除,只是这个 shipped spec 当前已经不欠它。**

candidate state Y:   三个候选:

    (a)「解除某个 zvec 相关 release blocker」
        —— 无 referent:blockers=0。
    (b)「授权一个具体的、携带升级的 candidate change set 发布」
        —— 只有当这样一个 change set 实际存在时,该对象才存在。
    (c)「把 containment spec 的 releaseBlocking 改为 false」
        —— 与 0.6 → 0.7 无关,且 AC7 已明确门要保留。

                     D6 的主语由 E7 在**具体 candidate change set 存在时**实例化为 (b)。
                     在此之前不得为它编写判据。

observable
tree/runtime delta:  release-preflight 的 VERDICT 行;spec frontmatter 的
                     releaseBlocking / status;发布产物的 package.json。

required authority:  N/A —— subject_status = NOT_INSTANTIATED
GREEN iff:           N/A
RED iff:             N/A
missing authority
disposition:         N/A

depends on:          E7 (SUBJECT_INSTANTIATION)

does NOT authorize:  ——

verdict:             UNSET
```

## 2. Typed dependency graph

**图只约束裁定,不替裁定。** 每个节点仍然独立出自己的 verdict;边不合并任何两个节点,
也不允许从一个节点的 verdict 推出另一个节点的 verdict。

### 2.1 四种边类型(冻结)

```text
LOGICAL
    A=YES 与 B=NO 在语义上无法同时成立。

EVIDENCE_PREREQUISITE
    B 要得到 YES,必须先存在 authority E。
    该边只声明「E 是必要条件」,**不声明 E 是充分条件** —— 充分性属于 GREEN,Stage 2 才写。
    **E 的身份,以及 E 缺失时如何 disposition,均由 Stage 2 定义。**

IMPLEMENTATION_COUPLING
    A 与 B 同时为 YES 会要求协同实施,但并不决定任一项本身的 verdict。

SUBJECT_INSTANTIATION                                    (2026-09-02 APPROVED)
    它只回答一个问题:「下游的 decision subject 是否已经存在?」
    缺失时:  subject_status = NOT_INSTANTIATED
    它作用于 **subject_status 这条轴**,绝不传播 verdict ——
    不得由它推出 YES / NO / DEFER,也不得在下游主语未实例化时为其编写判据。
```

### 2.2 边

Stage 1 不实例化任何 `EVIDENCE_PREREQUISITE` 边;**Stage 2 实例化它们**,
见下方 **E8–E20**(E1 / E2 / E3 / E5 保持 retired,不复用)。
当时的理由仍然有效并记录在此:在 Stage 1 写出「edge E 的
authority 是 X」「X 当前不存在」,等于把 `required authority` 与
`missing-authority` 这两个 Stage 2 字段从节点搬进图里,换个位置提前完成 Stage 2。

Stage 2 的边**只命名 authority 必须证明什么**,仍然不声明该 authority 是否存在 ——
那是 Stage 3。

```text
已撤回的边 id(Stage 1 不成立,且 id 不再复用):

  E1  D1 ← EVIDENCE_PREREQUISITE   撤回 —— 具体 authority 属 Stage 2
  E2  D2 ← EVIDENCE_PREREQUISITE   撤回 —— 同上
  E3  D5 ← EVIDENCE_PREREQUISITE   撤回 —— 同上;原文还写了「该 authority 当前不存在」,
                                   那是 missing-authority fact,更不属于 Stage 1
  E5  D2 ↔ D3 IMPLEMENTATION_COUPLING
                                   删除 —— 理由见 §2.3

Stage 2 若创建 evidence edge,使用新的 id;E1 / E2 / E3 / E5 不复用,
以免两轮复审之间同一个 id 指向不同的边。
```

```text
E4  D1 ↔ D2  IMPLEMENTATION_COUPLING
        两者同时为 YES 时版本取值需协同。
        无逻辑冲突:母体与子项目是两个独立安装,版本不同不构成矛盾。

E6  D1 ↔ D3  IMPLEMENTATION_COUPLING
        两者操作 published manifest 中**同一个条目**:
            D1 改 value   0.6.0 → 0.7.0
            D3 改 bucket  optionalDependencies → dependencies
        若二者同时实施,最终的 manifest / lockfile edit 必须组合这两项独立 delta。
        **允许顺序提交,不要求原子 commit,也不要求同一批次发布。**
        该边仅记录 shared-entry composition,不表达任一 verdict 对另一项的约束 ——
        §2.3 中「D1 → D3 LOGICAL 不成立」仍然完全有效。

E8   D1 ← EVIDENCE_PREREQUISITE   authority A1
E9   D1 ← EVIDENCE_PREREQUISITE   authority A3
E10  D2 ← EVIDENCE_PREREQUISITE   authority A2
E11  D2 ← EVIDENCE_PREREQUISITE   authority A3
E12  D3 ← EVIDENCE_PREREQUISITE   authority A4
E13  D3 ← EVIDENCE_PREREQUISITE   authority A5
E14  D5 ← EVIDENCE_PREREQUISITE   authority A6

E15  D1 ← EVIDENCE_PREREQUISITE   authority A7
E16  D2 ← EVIDENCE_PREREQUISITE   authority A8
E17  D5 ← EVIDENCE_PREREQUISITE   authority A9
E18  D1 ← EVIDENCE_PREREQUISITE   authority A0
E19  D2 ← EVIDENCE_PREREQUISITE   authority A0
E20  D3 ← EVIDENCE_PREREQUISITE   authority A0

        A0–A9 的定义见 §5。每条边只声明「该 authority 是必要条件」;
        充分性写在节点的 GREEN,缺失时的处置写在节点的 disposition。
        一个节点可以有多条 evidence 边:A1 与 A3 是两件不同的事,
        任一缺失都足以让该节点无法 GREEN。

        E15 / E16 / E17 是第二轮复审补上的一整类:此前 D1 / D2 / D5 只有
        **技术可行性** authority,没有任何一条回答「即使安全、兼容、可实现,
        为什么应该做它」。D3 早就有 A4(可行)+ A5(意图)这一对,
        另外三个节点缺的正是后一半。

        E18 / E19 / E20 把 A0 接进三个**全局 Y** 的节点:它们的 GREEN 都需要一个
        作用域,而作用域不能由 CI 覆盖面自行给出(§5.0)。

E7  D6 ← SUBJECT_INSTANTIATION
        instantiator 是「一个具体的、携带升级的 candidate change set 存在」,
        **而不是任何上游节点的 verdict 本身**:

            D1 / D2 / D3 / D5 decisions
                      ↓
            concrete upgrade-bearing candidate change set exists
                      ↓ SUBJECT_INSTANTIATION
            D6 becomes INSTANTIATED

        D5 也被列入来源,因为 containment 代码变化同样可能产生发布差异。
        该边只推进 subject_status,不推进 verdict。
```

### 2.3 图里**没有**的边

以下几条容易被顺手画上,此处明确记为**不成立**,以免把作者偏好编码进图结构:

```text
D6 ← D1 / D2 / D3 / D5   LOGICAL
        不成立。D6 的主语前提是「实际待发布对象存在」,而不是某个上游 verdict。
        上游 YES 本身不是 release verdict 的逻辑前提 —— 这正是 E7 用
        SUBJECT_INSTANTIATION 而不用 LOGICAL 表达的原因。

D5 ← D1   任意类型
        不成立。当前 classifier 不读版本;而即便 D5 为 YES 从而引入版本输入,
        一个版本门在仍装着 0.6.0 的环境里只是**不开启** —— 那是正确行为,
        既不是语义冲突(非 LOGICAL),也不要求两者协同实施(非 IMPLEMENTATION_COUPLING)。

D1 → D3   LOGICAL
        不成立。版本与依赖语义正交:即便 D1 最终为 NO,
        「0.6.0 是否从 optional 改为 mandatory」仍然是一个可讨论的独立问题。
        版本裁定不得结构性吞掉 dependency-class 裁定。

D3 ↔ D2   任意类型
        LOGICAL 不成立:D3=YES / D2=NO 不是逻辑矛盾。
        该组合是否可接受、以及它是否构成任何 RED 条件,属于 Stage 2 criteria;
        **Stage 1 不预判**,也不得在图里提前禁止 —— 图不替裁定。

        IMPLEMENTATION_COUPLING 同样不成立(原 E5,已删除)。它当时的理由是
        「否则会出现 published package 要求必装、而脚手架项目拿不到的中间状态,
        所以必须同批发布」—— 那是对**该组合是否可接受**的评价,属 Stage 2,
        不是结构约束。而且这个中间状态并不破坏任何现存不变量:
        defaultLoadZvecIndex()(memory-index.js:194-198)在 require 失败时返回 null,
        运行点本来就允许 zvec 不可用并回落 SqliteFtsIndex。
        把一句评价包装成 IMPLEMENTATION_COUPLING,等于在 Stage 1 提前施压。

D3 ↔ D5   任意类型
        不成立(**冻结后**)。D3 曾有一个候选主语「完全必装 / 移除 SqliteFtsIndex
        回落面」,它与 D5 确实构成 LOGICAL 冲突(containment 的降级目标正是该回落路径)。
        2026-09-02 的裁决把 D3 冻结为 manifest dependency class,该候选被排除,
        因此这条边随之消失。此处保留记录,以免将来有人重新把 fallback 语义并进 D3
        而不知道它会重新引入一条 LOGICAL 边。
```

## 3. Candidate source inventory

**这只是文件清单。** 它不把任何一份文档绑定为任何一种 authority,也不声明任何一份
文档证明了什么 —— 「这份文件是哪一类 authority」是 Stage 2 的工作。
列在此处只是为了指明 Stage 2 将从哪里取材。

```text
Step 1  docs/validation/zvec-070-win-unicode-recheck.md
2A      docs/validation/zvec-070-install-matrix.md
2B      docs/validation/zvec-070-adapter-contract.md
2C      docs/validation/zvec-070-nonascii-bridge.md
```

**禁止的推理形状**(明确写下,因为它正是本工作线一路在防的那个跳跃):

```text
measurement phase SATISFIED  →  upgrade YES          ✗
Step 1/2A/2B/2C 全绿          →  某节点 GREEN         ✗
```

「全绿」不是任何节点的总括 GREEN 条件。消费规则按 authority 的**类型**分开:

```text
measurement 类 authority(A1 / A2 / A3 / A4 / A6)
    若引用本节 inventory,必须逐项写明消费的是哪一份文件里的哪一个具体事实。

product-policy / support-scope 类 authority(A0 / A5 / A8 / A9)
    **不被限定在本节 inventory 之内** —— 本节四份全是测量文件,
    而没有任何一次测量能证明一条产品要求或一个支持范围承诺。
    它们的来源属 Stage 3 判定。

A7(升级收益)介于两者之间:「0.6.0 上存在已登记的产品相关问题」可由测量承担,
    「该改善是否构成升级理由」不行。Stage 3 必须分别说明这两半各自的来源。
```

## 4. Stage 3 之前不得做的事(当前阶段的边界)

```text
不填任何最终 verdict
不判断某个 authority 当前是否真的存在
不判断现有证据是否满足某条 GREEN 或命中某条 RED
不用 Step 1 / 2A / 2B / 2C 的**实际结果**反推 criteria
不实例化 D6(除非此时确已存在 concrete upgrade-bearing change set)
不为 D4 写 criteria
不写实施计划                        不修改 D1-D6 涉及的任何生产文件
```

### 4.1 Stage 1 的边界(已冻结,记录在此以免回退)

Stage 1 的禁止范围比现在更严,四轮复审拦下的三处越界全部是同一种错误 ——
把 Stage 2 的字段换个位置提前写掉。清单保留:

```text
不写 GREEN / RED · 不写 required authority · 不写 missing-authority disposition
不实例化任何 EVIDENCE_PREREQUISITE 边 · 不把任何文件绑定为某一类 authority
不声明某个 authority「存在」或「不存在」
不在边的**类型定义**里规定 authority 缺失时算什么
```

其中最后一条来自第四轮:撤回了 E1/E2/E3 三个实例之后,越界仍留在
`EVIDENCE_PREREQUISITE` 的类型定义里 —— 实例撤了,规则还在,口子只是更难看见。

## 5. Authority 定义(Stage 2)

每个 authority 只定义**它必须证明什么**。这里不声明任何 authority 是否存在,
也不声明 §3 里的任何文件是否已经证明了它 —— 那是 Stage 3。

`candidate source` 的含义同样受限:它指出 Stage 3 **应当去哪里找**,
不表示那里一定找得到,也不表示找到的东西一定够。

### 5.0 两个作用域:S_GATE 与 S_PRODUCT(冻结定义)

第一轮修掉了「拿 `engines` 当有限矩阵」,但随即走进了一个近似的错误:
把 release-gate 的 **CI 覆盖面**直接当成**产品支持面**。这一步同样没有 authority。

逐条可核的事实:

```text
package.json            "engines": { "node": ">=20.0.0" }
                        只有 Node floor,没有平台轴,也没有把支持范围限定成有限格子。

release-gate.yml:24-32  ubuntu-latest × [20,22,24] + windows-latest × [22,24]
                        windows × node20 的 exclude 理由是:better-sqlite3 在 GitHub
                        runner 上没有 win-x64 的 node-20 prebuild,且没有 node-gyp
                        可检测的 MSVC。
```

**「CI 无法以 build-tool-free 的方式验证某一格」不等于「产品已把该格移出支持范围」。**
那条 exclude 描述的是**证据环境**的能力边界,不是产品承诺。第一版把它升级成产品支持面,
等于让一份 workflow 自行缩小产品的支持范围。因此两个作用域必须分开:

```text
S_GATE     = baseline release-gate 实际覆盖的有限 CI cells
           = { ubuntu-latest × node 20, 22, 24 } ∪ { windows-latest × node 22, 24 }
             (.github/workflows/release-gate.yml:24-32)
           它是**证据环境**的范围,不是产品承诺。

S_PRODUCT  = 产品承诺支持的环境范围。
           本 UDR **不自行认定**它等于什么 —— 由 A0 承担,见下。
```

`engines.node >= 20` 在本 UDR 中只承担 **Node floor contract**;两个作用域都不由它给出。

A1 / A2 / A4 与 D1 / D2 / D3 的 GREEN 一律引用 **V_PRODUCT**;
**V_PRODUCT 对 S_PRODUCT 的代表性只由 A0 的 coverage justification 建立。**
(RED 是例外,且是刻意的:它绑定 S_PRODUCT —— 全称证明需要有限分区,
存在反例不需要,见 D1 的 RED 前言。)

```text
A0  product-support scope authority
    必须给出**三样**,缺一不可:

      1. S_PRODUCT   D1 / D2 / D3 这类全局 Y 实际需要承诺的环境范围。
      2. V_PRODUCT   本 UDR 用来证明 S_PRODUCT 的**有限、可枚举的 verification
                     partition**,或一组有权威依据的 equivalence class。
      3. coverage justification —— 为什么 V_PRODUCT 足以代表 S_PRODUCT。

    只给 (1) 不够。S_PRODUCT 完全可能是「Windows + Linux / Node >= 20 / x64」
    这样的**连续开放范围**,那时「S_PRODUCT 的每一格」依然无法穷尽证明,
    第一版的问题只是从 `engines` 搬到了 A0 上。
    **本 UDR 尤其不得自行假定**「Node >= 20 只测 20 / 22 / 24 就代表全部」——
    这类 equivalence 必须由 A0 或另一个 authority 明确给出,不能由判据自己发明。

      A0 规定 S_PRODUCT == S_GATE   →  D1 / D2 / D3 可按 S_GATE 裁,V_PRODUCT = S_GATE。
      A0 规定 S_PRODUCT ⊋ S_GATE    →  A1 / A2 / A4 必须覆盖 **V_PRODUCT**;
                                       覆盖不足 → DEFERRED,**不得 bounded GREEN**
                                       (理由同 §5.1:全局 Y 执行不了按格边界)。
      A0 未实例化                    →  DEFERRED。
                                       **不得由一份 workflow 自行缩小产品支持面。**
      S_PRODUCT 已知,但拿不到有权威依据的 V_PRODUCT
                                     →  DEFERRED。**「范围已知」不等于「可裁决」。**

    candidate source:package.json 的 `engines` · `.github/workflows/release-gate.yml`
    · docs/superpowers/specs/ 下的 release hardening / release closure 系列。
    其中哪一份(若有)真正承担 S_PRODUCT,属 Stage 3 判定;本阶段不作断言。

A1  install / load compatibility(母体安装形态)
    必须证明:在 A0 给出的 **V_PRODUCT 的每一个 verification cell / equivalence
    class** 上,0.7.0 可安装,且其原生绑定可被 require 解析。
    **外推权只属于 A0** —— 「为什么这个有限 partition 能代表 S_PRODUCT」由 A0 的
    coverage justification 承担,A1 不得自行主张覆盖了整个 S_PRODUCT。
    candidate source:2A
    需要它证明的具体事实:上述每一项的安装结果与加载结果,逐项可辨。

A2  scaffolded-runtime install compatibility
    必须证明:同样的结论 —— 同样在 **V_PRODUCT 的每一项**上、同样把外推权留给 A0 ——
    在**子项目安装形态**下成立:templates/runtime 清单被复制到
    .evo-lite/ 之后执行 `npm ci --prefix .evo-lite`。
    A1 不蕴含 A2:两者的清单、锁文件与执行目录都不同。
    candidate source:2A
    需要它证明的具体事实:它测的究竟是哪一种安装形态,以及该形态是否就是子项目形态。

A3  real-adapter contract conformance
    必须证明:memory-index-zvec.js **实际消费的**那一组 API、返回值形状与跨进程
    持久化合同在 0.7.0 上成立,且被测对象是树内的生产 adapter 本身而不是复现脚本。
    candidate source:2B(ASCII 路径)· 2C(非 ASCII 路径,有界)
    需要它们证明的具体事实:各自覆盖到哪一段路径形态;
    合并使用时必须分别说明边界,不得相加成一个更大的作用域。

A4  published-package installability under required semantics
    必须证明:在 mandatory 语义下 —— 即 @zvec/zvec 已移入 dependencies ——
    在 **V_PRODUCT 的每一项**上 `npm i create-evo-lite` 仍然成功。
    其对 S_PRODUCT 的代表性同样由 A0 的 coverage justification 承担,A4 不自行外推。
    它与 A1 的差别是承重的:A1 问「zvec 装得上吗」,
    A4 问「zvec 装不上时,会不会连本包一起装不上」。
    candidate source:§3 的 inventory 中是否有来源覆盖它,属 Stage 3 判定。

A5  product install-policy authority(与 D3 的 manifest-only 主语等宽)
    必须证明:在 D3 的 published-package 作用域内,
    「create-evo-lite 安装成功、但 @zvec/zvec 缺席」**不是产品允许的安装结果** ——
    即产品政策要求 installation success implies zvec present,
    并接受「zvec 装不上时整个 package 安装失败」这一后果。

    它**不对**安装完成之后的 runtime fallback 是否仍可存在作任何裁定。
    第二轮复审收紧:原文要求证明「SqliteFtsIndex 形态不是可接受的长期状态」,
    那比 D3 的主语更宽。一条自洽的产品政策完全可以同时是:
    安装必须带上 zvec,**而**安装后原生加载临时失败时仍保留 SqliteFtsIndex 回落。
    这样的政策足以支持 D3=YES,却并不要求「fallback 长期不可接受」。

    这是产品意图类 authority,不是测量类 —— 没有任何一次测量能证明「我们要求它必装」。
    candidate source:§3 的 inventory 全部为测量类文件;A5 的来源属 Stage 3 判定。

A6  version-bounded fault attribution
    必须同时证明四件事,缺一不可:
      (1) 版本 discriminant:该失败类可由一个**稳定且可泛化**的版本判据区分 ——
          机制归因(指名机制并证明 0.7.0 改变了它),**或**一份强度相当的
          上游版本有界合同 / 修复保证;
      (2) 版本改变:所选判据确实把 0.6.0 与 0.7.0 分到两侧;
      (3) 可观测性区分:能把
          「fault absence 的有效证据」
          与
          「当前 apparatus / 环境下 trigger 未被建立,因此观察的缺席不能解释为
            fault 的缺席」
          这两者区分开。
          注意它**不要求**证明某环境「结构性不可观察」—— 那是更强的断言,
          需要独立 authority,不是本项的门槛(见下方 admissibility);
      (4) 边界声明:版本门开启的区域有一个界定,且该界定不是「已被测过的路径集合」。
    candidate source:Step 1 · 2C
    需要它们证明的具体事实:各自覆盖 (1)–(4) 的哪一部分、覆盖到什么范围;
    四项的覆盖必须分别说明,不得由「整体看起来充分」代替。

    **A6 的 evidence admissibility 规则(authority 的准入规则,不是 D5 的 RED):**
      准入按 **claim 分类**,不是整个 cell 的二元取舍。
      若某个 evidence cell 中 0.6.0 对照**未复现**该失败类:

        不得用于:· 证明 0.7.0 相对 0.6.0 的 version effect
                  · 证明 newly-admitted domain 对 0.7.0 安全
                  · 支持 (1) / (2) 的任何 positive discriminant 主张
                  在那种环境里 0.6.0 与 0.7.0 的结果不可区分,它不携带这类信息。

        可以用于:· 记录「在该 cell / 该装置下,对照未复现」这一事实本身
                  · 与**能够复现**的 cell 形成受控对比,支持 observability dependence
                  · 支持 (3) 对「观察的缺席不能直接解释成 fault 的缺席」的区分

        额外不得用于:· 声称该 trigger 在该环境「不可能被观察到」。
                      **not reproduced ≠ impossible** —— 一次未复现只能证明
                      「在这套装置 / 这一格下未被复现」;要断言某环境**结构性地**
                      不可观察,那是一个独立且更强的 authority,不能从「没复现」推出来。

        无论用于哪一类,该 cell 必须显式标记为 **observability-only**,
        且**不得**在后续汇总中被重新计入 0.7.0 的 safety evidence。

      [演进史。第一版把这条写成 D5 的 RED —— 那会把坏证据与坏决策混为一谈:
       只要历史上提交过一份方法有误的实验,即使之后存在完整有效的 authority,
       D5 也会被永久 RED。移入本 authority 后,第二版写成「整 cell 剔除」,又过头了,
       且与本 authority 自己的 (3) 相冲突 —— 对照不复现的环境证明不了 0.7.0 安全,
       却正是「环境影响可观测性」的信息来源,整块丢掉等于把负控信息一起扔掉。
       第三版则把「可以用于证明该环境不可观察」写进了可用清单,那是同一个
       not-proven/impossible 倒置换了个方向,已按上文收回。
       **本规则不指向任何具体环境**,哪些 cell 属于此类是 Stage 3 判定。]

A7  upgrade-benefit authority(D1)
    必须证明:X = 0.6.0 上存在一个**已登记的、产品相关的**缺陷 / 降级 / 限制,
    且 Y = 0.7.0 对该问题产生**实质改善**;改善的范围必须显式有界,
    不得只证明「新版本也能跑」。

    为什么必须有它:A1 + A3 合起来只能推出「0.7.0 兼容到可以使用」,
    推不出「0.6 → 0.7 是有理由的」。极端反例:若两个版本在所有产品相关问题上完全等价,
    仅仅因为 0.7.0 也通过了兼容性测试,当前判据就会让 D1 变绿。
    candidate source:Step 1 · 2A · 2B · 2C 中是否有来源承担它,属 Stage 3 判定。

A8  scaffold-runtime zvec-availability policy(D2)
    必须证明:create-evo-lite 脚手架成功完成之后,child 的 .evo-lite runtime
    **被产品要求具备 zvec 依赖**,而不是允许依赖缺席后降级到 SqliteFtsIndex。

    **不得复用 A5。** A5 管的是 published package 的安装结果;A8 管的是被脚手架出的
    child runtime 依赖集合 —— 这两个安装面是 Stage 1 已冻结的独立主语。
    同理,「zvec 是默认引擎」也不能自动推出「zvec 必须被安装」:现有设计明确允许
    `defaultLoadZvecIndex()` 在 require 失败时返回 null 并回落 SqliteFtsIndex。
    这是产品政策类 authority,不是测量类。
    candidate source:属 Stage 3 判定。

A9  containment-change benefit / product-policy authority(D5)
    必须证明:当前 version-blind 的 X 对某个**产品相关范围**造成了需要解决的降级,
    而 version-aware 的 Y 能恢复所需能力;且这份收益值得引入新的 version-identity
    输入与随之增加的 containment 复杂度。

    A9 **不决定安全边界** —— 安全仍然完全由 A6 决定。两者的分工是:
        A6 = can we safely do it
        A9 = is there a reason to do it
    这与 D3 已有的 A4(技术可行)+ A5(产品意图)是同一种结构。
    candidate source:属 Stage 3 判定。
```

### 5.1 missing-authority disposition 词汇表

```text
DEFERRED
    被点名的 authority 未实例化。该节点**不得**因此被记为 NO,也不得记为 YES;
    它在 Stage 3 的结果是「不裁定,待 authority 出现」。

BOUNDED
    authority 已实例化、作用域小于节点作用域,**且 candidate Y 本身能够强制执行
    同一条边界**。此时 GREEN 只能在该有界范围内成立,边界必须写进裁定结论本身。

    第二个条件是硬条件,不是措辞:
        Y 无法执行该边界  →  DEFERRED,而不是 bounded GREEN。
    给一个实际会全局生效的 Y 补一句 BOUNDED 脚注,等于用脚注授权它。
```

按此规则,本 UDR 四个已实例化节点的 scope shortfall 处置**不同**:

```text
D1 / D2 / D3   scope shortfall → DEFERRED
               三个 Y 都是全局变更:唯一的 published pin、所有 scaffold 共用的
               runtime 清单、published manifest 的 bucket。树里没有任何机制做到
               「ubuntu/node22 用 0.7.0,其余格子继续 0.6.0」,
               也没有机制做到「证据覆盖的格子 mandatory,其余格子仍 optional」。
               证据作用域小于 V_PRODUCT 时,只能 DEFERRED。

D5             scope shortfall → BOUNDED 合法
               version-aware gate 本身就能把开启范围限制在 authority 的覆盖范围内,
               D5 的 disposition 已写明「版本门的开启范围不得超过它」。
               这正是 BOUNDED 与 DEFERRED 的分界:边界能不能被 Y 执行。
```

这两个词是 **Stage 3 应用的规则**,不是 Stage 2 对任何节点作出的判断:
Stage 2 不判断任何 authority 当前是否存在,因此本阶段没有任何节点被置于
DEFERRED 或 BOUNDED。

### 5.1a normative / benefit authority 的三态规则(A5 · A7 · A8 · A9)

```text
authority 缺失或未决
    → DEFERRED

存在**权威性证据明确否定**该 authority 本应确立的那个命题
    → RED

仅仅是「找不到支持性 authority」
    → 不是 RED,仍然是 DEFERRED
```

**absence of positive evidence != negative evidence。**

只写「未实例化 → DEFERRED」是不够的:它把两种状态混成一种,于是 Stage 3 遇到一条
**明确反向**的政策时,会被迫把一个本该 RED 的节点记成 DEFERRED。D3 早就按正确形状
写过(A5 未实例化 → DEFERRED;存在相反产品要求 → RED),本规则把它一般化到
A7 / A8 / A9;各节点在自己的 RED 里补出「明确相反」在该节点意味着什么。

### 5.2 判据自检(本阶段作者自陈)

写完后对每条 GREEN 反问一次:「如果把这条拿掉,哪一种坏情况会被放过?」
逐条可答,则判据是在守某个性质;答不上来,则它只是描述了现有证据的形状。

```text
D1-G1  拿掉 → 某些声明支持的格子上装不上也能过
D1-G2  拿掉 → 装得上就算数,不问 adapter 实际用到的合同
D1-G3  拿掉 → 有界证据被当成无界结论
D2-G1  拿掉 → 用母体安装形态的结论替子项目背书
D2-G3  拿掉 → 三处清单漂移,脚手架产出不可复现
D3-G1  拿掉 → 把「引擎降级」升级成「本包装不上」而无人发现
D3-G2  拿掉 → 没有产品要求也能把依赖改成必装
D5-G1  拿掉 → 「几个样本没崩」被当成「按版本有界」
D5-G2  拿掉 → 对照 trigger 未被建立的 cell 也会被汇总成 0.7.0 的 safety evidence
D5-G3  拿掉 → 门变成查表:测过的放行,没测过的无答案
D5-G4  拿掉 → 门读的是清单字符串,与实际加载的 binding 可以不一致
D5-G5  拿掉 → 门开启后既有 containment marker 语义未定义
D1-G4  拿掉 → 「0.7.0 也能跑」就足以升级;两个产品意义上等价的版本也会变绿
D2-G5  拿掉 → 「我们能把 zvec 塞进每个 scaffold」被当成「每个 scaffold 都必须有它」
D5-G7  拿掉 → 只证明了门可以安全地建,没人问过为什么要改现在的 version-blind 状态
```

GREEN 共 19 条(D1 4 · D2 5 · D3 3 · D5 7),上表列了 15 条。
其余 4 条是交叉引用,自检**继承**被引用条,不另作解释:

```text
D2-G2  ← D1-G2
D2-G4  ← D1-G3
D3-G3  ← D1-G3
D5-G6  ← D1-G3 的作用域规则,但处置相反(D5 允许 BOUNDED,§5.1)
```

「逐条自检」是一条可执行的复审声明,所以这四条必须显式点名 —— 否则该声明字面不成立。

D5 的每条 GREEN 在正文里都标注了来源是 [主语推导] 还是 [通用方法论];
作者在撰写本阶段期间未读取 2A / 2B / Step 1 的正文(§0.3)。
